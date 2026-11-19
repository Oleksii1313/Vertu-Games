#!/usr/bin/env python3
"""CAPTCHA Cloudflare Turnstile: проверка только на сервере.

Проверяем не «наличие капчи», а её настоящие свойства:

* без ключей в окружении капча выключена и не мешает реальным игрокам, но
  ``TURNSTILE_REQUIRED=1`` превращает это в ошибку конфигурации;
* с ключами сервер сам ходит в ``siteverify``: пустой, просроченный и повторно
  использованный токен отклоняются (каждый токен одноразовый — в БД);
* недоступность Cloudflare не съедает попытку: бронь снимается, игрок может
  повторить, а не «застрять»;
* регистрация и вход требуют капчу до создания аккаунта и сессии: без токена
  аккаунт не появляется, cookie не выдаётся;
* секрет не попадает в ответы API — клиент получает только siteKey;
* остаются ограничения попыток, honeypot и проверка «слишком быстро».

Запуск:

    python -m unittest tools.test_captcha -v
"""
from __future__ import annotations

import os
import sys
import time
import unittest
import uuid
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

SECRET = 'test-secret-' + uuid.uuid4().hex
SITE_KEY = '1x00000000000000000000AA'

if not os.environ.get('VERT_DB'):
    os.environ['VERT_DB'] = '/tmp/captcha-test-%d.sqlite3' % os.getpid()
os.environ.setdefault('REGISTER_RATE', '1000')
os.environ.setdefault('REGISTER_NAME_RATE', '1000')

import captcha  # noqa: E402
import server  # noqa: E402


class Siteverify:
    """Подмена запроса к Cloudflare: считает вызовы и отдаёт заданный ответ."""

    def __init__(self, success=True, codes=None, raises=None):
        self.success = success
        self.codes = codes or []
        self.raises = raises
        self.calls = 0
        self.last_body = ''

    def __call__(self, request, timeout=0):
        self.calls += 1
        self.last_body = (request.data or b'').decode()
        if self.raises:
            raise self.raises

        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def read(self):
                import json
                payload = {'success': self_outer.success}
                if self_outer.codes:
                    payload['error-codes'] = self_outer.codes
                return json.dumps(payload).encode()

        self_outer = self
        return Response()


def configured(required='0'):
    return mock.patch.dict(os.environ, {
        'TURNSTILE_SECRET_KEY': SECRET,
        'TURNSTILE_SITE_KEY': SITE_KEY,
        'TURNSTILE_REQUIRED': required,
    })


def unconfigured(required=''):
    env = {'TURNSTILE_SECRET_KEY': '', 'TURNSTILE_SITE_KEY': ''}
    if required:
        env['TURNSTILE_REQUIRED'] = required
    return mock.patch.dict(os.environ, env)


class VerifyUnit(unittest.TestCase):
    def test_disabled_without_keys(self):
        with unconfigured():
            self.assertFalse(captcha.enabled())
            self.assertEqual(captcha.verify('', '1.2.3.4'), (True, ''))
            self.assertEqual(captcha.verify('any-token'), (True, ''))

    def test_required_without_keys_is_config_error(self):
        with unconfigured(required='1'):
            ok, code = captcha.verify('токен')
            self.assertFalse(ok)
            self.assertEqual(code, 'CAPTCHA_NOT_CONFIGURED')
            self.assertEqual(captcha.config_error(), 'CAPTCHA_NOT_CONFIGURED')

    def test_public_config_has_no_secret(self):
        with configured():
            cfg = captcha.public_config()
            self.assertEqual(cfg, {'enabled': True, 'required': False, 'siteKey': SITE_KEY})
            self.assertNotIn(SECRET, str(cfg))

    def test_empty_and_huge_tokens_rejected_without_network(self):
        with configured():
            network = Siteverify()
            with mock.patch.object(captcha, 'urlopen', network):
                self.assertEqual(captcha.verify('   '), (False, 'CAPTCHA_REQUIRED'))
                self.assertEqual(captcha.verify('x' * 5000), (False, 'CAPTCHA_REQUIRED'))
                self.assertEqual(network.calls, 0)

    def test_valid_token_passes_and_is_single_use(self):
        with configured():
            network = Siteverify(success=True)
            token = 'valid-' + uuid.uuid4().hex
            with mock.patch.object(captcha, 'urlopen', network):
                self.assertEqual(captcha.verify(token, '10.0.0.1'), (True, ''))
                self.assertEqual(network.calls, 1)
                self.assertIn('secret=' + SECRET, network.last_body)
                self.assertIn('remoteip=10.0.0.1', network.last_body)
                ok, code = captcha.verify(token, '10.0.0.1')
                self.assertFalse(ok)
                self.assertEqual(code, 'CAPTCHA_REUSED')
                self.assertEqual(network.calls, 1)

    def test_failed_token_rejected(self):
        with configured():
            network = Siteverify(success=False, codes=['invalid-input-response'])
            with mock.patch.object(captcha, 'urlopen', network):
                ok, code = captcha.verify('bad-' + uuid.uuid4().hex)
                self.assertFalse(ok)
                self.assertEqual(code, 'invalid-input-response')

    def test_outage_releases_reservation(self):
        with configured():
            token = 'outage-' + uuid.uuid4().hex
            broken = Siteverify(raises=OSError('network down'))
            with mock.patch.object(captcha, 'urlopen', broken):
                self.assertEqual(captcha.verify(token), (False, 'CAPTCHA_UNAVAILABLE'))
            working = Siteverify(success=True)
            with mock.patch.object(captcha, 'urlopen', working):
                self.assertEqual(captcha.verify(token), (True, ''))
                self.assertEqual(working.calls, 1)


class AuthFlow(unittest.TestCase):
    def setUp(self):
        self.app = server.app
        self.app.config['TESTING'] = True

    def client(self, ip=None):
        client = self.app.test_client()
        client.environ_base['REMOTE_ADDR'] = ip or '10.%d.%d.%d' % (
            int(time.time() * 1000) % 250, uuid.uuid4().int % 250, uuid.uuid4().int % 250)
        token = client.get('/api/session').get_json()['csrf']
        client.environ_base['HTTP_X_CSRF_TOKEN'] = token
        return client

    @staticmethod
    def name():
        return 'Cap%d' % (uuid.uuid4().int % 10 ** 9)

    def register(self, client, username=None, **extra):
        body = {'username': username or self.name(), 'password': 'StrongPass123',
                'startedAt': int(time.time() * 1000) - 5000}
        body.update(extra)
        return client.post('/api/auth/register', json=body)

    def test_session_announces_configuration_without_secret(self):
        with configured('1'):
            data = self.client().get('/api/session').get_json()
            self.assertEqual(data['captcha'], {'enabled': True, 'required': True, 'siteKey': SITE_KEY})
            self.assertEqual(data['turnstile'], data['captcha'])
            self.assertNotIn(SECRET, str(data))

    def test_register_without_token_creates_nothing(self):
        with configured():
            client = self.client()
            username = self.name()
            response = self.register(client, username)
            body = response.get_json()
            self.assertEqual(response.status_code, 400)
            self.assertEqual(body['code'], 'CAPTCHA_REQUIRED')
            self.assertFalse(server.get_store().find_user(username))
            self.assertNotIn('Set-Cookie', response.headers.get('Set-Cookie', ''), )

    def test_register_with_token_creates_account(self):
        with configured():
            client = self.client()
            network = Siteverify(success=True)
            with mock.patch.object(captcha, 'urlopen', network):
                response = self.register(client, turnstileToken='tok-' + uuid.uuid4().hex)
            self.assertEqual(response.status_code, 201, response.get_json())
            self.assertEqual(network.calls, 1)
            self.assertTrue(server.get_store().find_user(response.get_json()['user']['username']))

    def test_reused_token_blocks_second_registration(self):
        with configured():
            network = Siteverify(success=True)
            token = 'reuse-' + uuid.uuid4().hex
            with mock.patch.object(captcha, 'urlopen', network):
                first = self.register(self.client(), turnstileToken=token)
                second = self.register(self.client(), turnstileToken=token)
            self.assertEqual(first.status_code, 201, first.get_json())
            self.assertEqual(second.status_code, 400, second.get_json())
            self.assertEqual(second.get_json()['code'], 'CAPTCHA_REUSED')

    def test_required_but_not_configured_fails_closed(self):
        with unconfigured(required='1'):
            response = self.register(self.client(), turnstileToken='x')
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.get_json()['code'], 'CAPTCHA_NOT_CONFIGURED')

    def test_not_configured_does_not_block_players(self):
        with unconfigured():
            response = self.register(self.client())
            self.assertEqual(response.status_code, 201, response.get_json())

    def test_cloudflare_outage_is_reported_and_retryable(self):
        with configured():
            client = self.client()
            with mock.patch.object(captcha, 'urlopen', Siteverify(raises=OSError('down'))):
                first = self.register(client, turnstileToken='out-' + uuid.uuid4().hex)
                self.assertEqual(first.status_code, 400)
                self.assertEqual(first.get_json()['code'], 'CAPTCHA_UNAVAILABLE')
            with mock.patch.object(captcha, 'urlopen', Siteverify(success=True)):
                second = self.register(client, turnstileToken='out-' + uuid.uuid4().hex)
            self.assertEqual(second.status_code, 201, second.get_json())

    def test_honeypot_and_speed_traps_still_work(self):
        with unconfigured():
            honeypot = self.register(self.client(), website='http://bot.example')
            self.assertEqual(honeypot.status_code, 400)
            self.assertEqual(honeypot.get_json()['code'], 'BOT')
            fast = self.register(self.client(), startedAt=int(time.time() * 1000))
            self.assertEqual(fast.status_code, 400)
            self.assertEqual(fast.get_json()['code'], 'TOO_FAST')

    def login(self, client, username, password):
        return client.post('/api/auth/login', json={'username': username, 'password': password,
                                                    'turnstileToken': 'log-' + uuid.uuid4().hex})

    def test_login_requires_captcha_before_password_check(self):
        with unconfigured():
            client = self.client()
            username = self.name()
            created = self.register(client, username)
            self.assertEqual(created.status_code, 201)
        with configured():
            client = self.client()
            response = client.post('/api/auth/login', json={'username': username,
                                                           'password': 'StrongPass123'})
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.get_json()['code'], 'CAPTCHA_REQUIRED')
            self.assertIsNone(server.get_store().get_session(
                client.get_cookie(server.COOKIE).value) if client.get_cookie(server.COOKIE) else None)
            network = Siteverify(success=True)
            with mock.patch.object(captcha, 'urlopen', network):
                good = self.login(client, username, 'StrongPass123')
            self.assertEqual(good.status_code, 200, good.get_json())
            self.assertIsNotNone(client.get_cookie(server.COOKIE))

    def test_login_rate_limit_survives_captcha(self):
        with unconfigured():
            username = self.name()
            self.assertEqual(self.register(self.client(), username).status_code, 201)
        with configured():
            client = self.client()
            codes = []
            with mock.patch.object(captcha, 'urlopen', Siteverify(success=True)):
                for _ in range(12):
                    response = client.post('/api/auth/login', json={
                        'username': username, 'password': 'WrongPass123',
                        'turnstileToken': 'log-' + uuid.uuid4().hex})
                    codes.append(response.status_code)
            self.assertIn(429, codes, codes)
            self.assertEqual(codes[-1], 429)


if __name__ == '__main__':
    unittest.main(verbosity=2)
