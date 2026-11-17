"""Тесты античита: подписанные билеты, аномалии и лимиты.

Запуск: ``python -m unittest tools.test_anticheat`` (venv с flask/psycopg).

Проверяем именно то, чем атакуют экономику:
* подделанная сумма/подпись в билете;
* повтор одного билета (двойная выплата);
* просроченный и чужой билет;
* запрос награды без билета вообще (старый «клиент»);
* шквал запросов (429) и «нечеловеческий» темп событий (throttle/аномалия);
* CSP и заголовки безопасности на ответах.
"""
from __future__ import annotations

import json
import os
import re
import time
import unittest
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in os.sys.path:
    os.sys.path.insert(0, str(ROOT))


def _prepare_database() -> dict:
    """SQLite-файл или отдельная схема PostgreSQL (как в tools/test_economy.py)."""
    url = (os.environ.get('DATABASE_URL') or '').strip()
    if not url:
        os.environ['VERTU_DB'] = '/tmp/anticheat-test-%d.sqlite3' % os.getpid()
        return {}
    schema = 'test_anti_' + uuid.uuid4().hex[:10]
    sep = '&' if '?' in url else '?'
    os.environ['DATABASE_URL'] = f'{url}{sep}options=-csearch_path%3D{schema}'
    import psycopg
    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute(f'CREATE SCHEMA IF NOT EXISTS "{schema}"')
    return {'schema': schema, 'base': url}


DB = _prepare_database()


def tearDownModule():
    """Убрать временную схему PostgreSQL после прогона."""
    schema = DB.get('schema')
    if not schema:
        return
    import psycopg
    with psycopg.connect(DB['base'], autocommit=True) as conn:
        conn.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')

import server  # noqa: E402
import anticheat  # noqa: E402
import guard  # noqa: E402


class TicketCrypto(unittest.TestCase):
    def setUp(self):
        self.user = 4242

    def test_roundtrip(self):
        ticket = anticheat.issue(self.user, 'flappy', 2)
        checked = anticheat.verify(ticket, self.user, game='flappy')
        self.assertEqual(checked['amount'], 2)
        self.assertEqual(checked['sid'], ticket['sid'])

    def test_amount_tampering_rejected(self):
        ticket = anticheat.issue(self.user, 'flappy', 2)
        ticket['amount'] = 1000          # «хочу больше»
        with self.assertRaises(anticheat.TicketError):
            anticheat.verify(ticket, self.user, game='flappy')

    def test_forged_signature_rejected(self):
        ticket = anticheat.issue(self.user, 'flappy', 2)
        ticket['sig'] = anticheat.sign('что-угодно')
        with self.assertRaises(anticheat.TicketError):
            anticheat.verify(ticket, self.user, game='flappy')

    def test_foreign_user_rejected(self):
        ticket = anticheat.issue(self.user, 'flappy', 2)
        with self.assertRaises(anticheat.TicketError):
            anticheat.verify(ticket, self.user + 1, game='flappy')

    def test_other_game_rejected(self):
        ticket = anticheat.issue(self.user, 'flappy', 2)
        with self.assertRaises(anticheat.TicketError):
            anticheat.verify(ticket, self.user, game='snake')

    def test_expired_rejected(self):
        ticket = anticheat.issue(self.user, 'flappy', 2, ttl=5)
        with self.assertRaises(anticheat.TicketError):
            anticheat.verify(ticket, self.user, game='flappy', now=ticket['expiresAt'] + 1)

    def test_garbage_rejected(self):
        for bad in ({}, None, 'строка', {'sid': 'x'}, {'sid': 'x' * 32}):
            with self.assertRaises(anticheat.TicketError):
                anticheat.verify(bad, self.user, game='flappy')

    def test_receipt_is_unique_per_ticket(self):
        one = anticheat.issue(self.user, 'flappy', 2)
        two = anticheat.issue(self.user, 'flappy', 2)
        self.assertNotEqual(anticheat.receipt_for(self.user, one),
                            anticheat.receipt_for(self.user, two))


class RateAndAnomaly(unittest.TestCase):
    def setUp(self):
        guard.reset()
        guard.ANOMALIES.forget(99)

    def test_token_bucket_blocks_burst(self):
        allowed = sum(1 for _ in range(50) if guard.allow('burst', rate=1, burst=5))
        self.assertLessEqual(allowed, 5)

    def test_token_bucket_refills(self):
        key = 'refill'
        for _ in range(5):
            guard.allow(key, rate=100, burst=5)
        time.sleep(0.06)
        self.assertTrue(guard.allow(key, rate=100, burst=5))

    def test_anomaly_marks_machine_tempo(self):
        os.environ['ANOMALY_EVENTS_PER_MIN'] = '5'
        os.environ['ANOMALY_MIN_INTERVAL'] = '10'
        try:
            info = {}
            for _ in range(8):
                info = guard.ANOMALIES.observe(99, 5)
            self.assertTrue(info['flags'] > 0, info)
            self.assertIn(guard.anomaly_verdict(info), ('throttle', 'block'))
        finally:
            os.environ.pop('ANOMALY_EVENTS_PER_MIN', None)
            os.environ.pop('ANOMALY_MIN_INTERVAL', None)

    def test_normal_player_not_flagged(self):
        os.environ['ANOMALY_EVENTS_PER_MIN'] = '90'
        info = guard.ANOMALIES.observe(99, 2)
        self.assertEqual(guard.anomaly_verdict(info), 'ok', info)


class RewardEndpoint(unittest.TestCase):
    """Сквозные проверки HTTP-эндпоинта награды (клиент = Flask test client)."""

    @classmethod
    def setUpClass(cls):
        import db as store
        cls.app = server.app
        cls.app.config['TESTING'] = True
        cls.store = store.get_store()

    def _register(self):
        client = self.app.test_client()
        token = client.get('/api/session').get_json()['csrf']
        client.environ_base['HTTP_X_CSRF_TOKEN'] = token
        name = 'Anti%d' % (int(time.time() * 1000) % 10 ** 9)
        response = client.post('/api/auth/register', json={
            'username': name, 'password': 'StrongPass123', 'startedAt': 1})
        self.assertEqual(response.status_code, 201, response.get_json())
        return client, response.get_json()['user']

    def test_reward_requires_ticket(self):
        client, _ = self._register()
        response = client.post('/api/games/reward', json={
            'game': 'flappy', 'receipt': 'no-ticket-abc', 'amount': 999})
        self.assertEqual(response.status_code, 403, response.get_json())
        self.assertEqual(response.get_json()['code'], 'TICKET')

    def test_signed_ticket_pays_catalog_amount_only(self):
        guard.reset()
        client, user = self._register()
        ticket = client.get('/api/games/session?game=flappy').get_json()
        self.assertEqual(ticket['amount'], 2)
        response = client.post('/api/games/reward', json={
            'game': 'flappy', 'receipt': 'flappy-abc-1', 'ticket': ticket, 'amount': 1000})
        body = response.get_json()
        self.assertEqual(response.status_code, 200, body)
        self.assertEqual(body['awarded'], 2)          # сумма из каталога, не из запроса
        self.assertEqual(body['coins'], 150 + 2)

    def test_same_ticket_never_pays_twice(self):
        guard.reset()
        client, _ = self._register()
        ticket = client.get('/api/games/session?game=flappy').get_json()
        first = client.post('/api/games/reward',
                            json={'game': 'flappy', 'receipt': 'repeat-1', 'ticket': ticket}).get_json()
        self.assertIn('awarded', first, first)
        second = client.post('/api/games/reward',
                             json={'game': 'flappy', 'receipt': 'repeat-1', 'ticket': ticket}).get_json()
        self.assertGreater(first['awarded'], 0)
        self.assertEqual(second['awarded'], 0)
        self.assertTrue(second['repeated'])
        self.assertEqual(first['coins'], second['coins'])

    def test_ticket_of_other_game_rejected(self):
        guard.reset()
        client, _ = self._register()
        ticket = client.get('/api/games/session?game=snake').get_json()
        response = client.post('/api/games/reward',
                               json={'game': 'flappy', 'receipt': 'other-game-1', 'ticket': ticket})
        self.assertEqual(response.status_code, 403, response.get_json())

    def test_burst_is_rate_limited(self):
        guard.reset()
        client, _ = self._register()
        codes = []
        for index in range(20):
            ticket = client.get('/api/games/session?game=flappy').get_json()
            if ticket.get('ok') is not True:
                codes.append(429)
                continue
            response = client.post('/api/games/reward',
                                   json={'game': 'flappy', 'receipt': 'burst-%d' % index, 'ticket': ticket})
            codes.append(response.status_code)
        self.assertIn(429, codes, codes)

    def test_forwarded_header_spoofing_does_not_escape_limits(self):
        """Подделка X-Forwarded-For не обходит лимит: есть ключ по сокету."""
        guard.reset()
        client = self.app.test_client()
        token = client.get('/api/session').get_json()['csrf']
        codes = []
        for index in range(40):
            response = client.post('/api/auth/login',
                                   json={'username': 'ghost%d' % index, 'password': 'WrongPass123'},
                                   headers={'X-CSRF-Token': token,
                                            'X-Forwarded-For': '203.0.113.%d' % index})
            codes.append(response.status_code)
        self.assertIn(429, codes, codes[:20])

    def test_security_headers_present(self):
        client = self.app.test_client()
        headers = client.get('/').headers
        self.assertEqual(headers.get('X-Frame-Options'), 'DENY')
        self.assertEqual(headers.get('X-Content-Type-Options'), 'nosniff')
        csp = headers.get('Content-Security-Policy') or ''
        self.assertIn("default-src 'self'", csp)
        self.assertIn("frame-ancestors 'none'", csp)
        self.assertIn("object-src 'none'", csp)
        self.assertNotIn('unsafe-eval', csp)

    def test_no_secrets_in_health(self):
        body = self.app.test_client().get('/api/health').get_json()
        text = json.dumps(body)
        self.assertNotIn(os.environ.get('SECRET_KEY', 'no-secret-set'), text)
        self.assertTrue(body['signing']['enabled'])
        self.assertFalse(any('key' in str(v).lower() and len(str(v)) > 40
                             for v in body['signing'].values()))


class HeadersAndClickjacking(unittest.TestCase):
    def setUp(self):
        self.client = server.app.test_client()

    def test_frames_denied_everywhere(self):
        for path in ('/', '/games/flappy.html', '/api/health'):
            response = self.client.get(path)
            self.assertEqual(response.headers.get('X-Frame-Options'), 'DENY', path)

    def test_csp_allows_only_expected_hosts(self):
        csp = self.client.get('/').headers.get('Content-Security-Policy') or ''
        self.assertIn('https://challenges.cloudflare.com', csp)
        self.assertNotRegex(csp, r"default-src[^;]*\*")
        self.assertNotIn('unsafe-eval', csp)
        # Babylon.js нужен только 3D-играм, а не всем страницам.
        self.assertNotIn('babylon', csp)
        game_csp = self.client.get('/games/minicraft.html').headers.get('Content-Security-Policy') or ''
        self.assertIn('https://cdn.babylonjs.com', game_csp)

    def test_hsts_only_on_https(self):
        plain = self.client.get('/')
        self.assertIsNone(plain.headers.get('Strict-Transport-Security'))
        secure = self.client.get('/', environ_base={'HTTP_X_FORWARDED_PROTO': 'https'})
        self.assertIn('max-age=31536000', secure.headers.get('Strict-Transport-Security') or '')

    def test_client_ip_ignores_forwarded_header_without_proxy(self):
        server.TRUSTED_PROXY = False
        with server.app.test_request_context('/', environ_base={
                'REMOTE_ADDR': '10.0.0.5', 'HTTP_X_FORWARDED_FOR': '1.2.3.4'}):
            self.assertEqual(server.client_ip(), '10.0.0.5')
        server.TRUSTED_PROXY = True
        # Прокси дописывает реальный адрес в конец: берём последний, а не
        # подделываемый первый.
        with server.app.test_request_context('/', environ_base={
                'REMOTE_ADDR': '10.0.0.5',
                'HTTP_X_FORWARDED_FOR': '6.6.6.6, 1.2.3.4'}):
            self.assertEqual(server.client_ip(), '1.2.3.4')
        # Cloudflare перезаписывает CF-Connecting-IP — он приоритетнее.
        with server.app.test_request_context('/', environ_base={
                'REMOTE_ADDR': '10.0.0.5', 'HTTP_CF_CONNECTING_IP': '9.9.9.9',
                'HTTP_X_FORWARDED_FOR': '6.6.6.6, 1.2.3.4'}):
            self.assertEqual(server.client_ip(), '9.9.9.9')
        server.TRUSTED_PROXY = False


if __name__ == '__main__':
    unittest.main(verbosity=2)
