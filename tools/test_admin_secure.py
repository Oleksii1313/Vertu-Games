#!/usr/bin/env python3
"""Защита админ-панели: вход, сессии, права, журнал и новые разделы.

Проверяется то, что важно для продакшена, а не «есть ли страница admin.html»:

* пароль администратора берётся **только** из переменной окружения
  ``ADMIN_PASSWORD`` (резерв — ``SECRET_KEY``); без неё вход отвечает
  ``503 ADMIN_NOT_CONFIGURED``, а не «пускает всех»;
* пароль не попадает ни в одну страницу, скрипт или ответ API — в исходниках
  нет ни литерала, ни значения по умолчанию;
* каждый ``/api/admin/*`` маршрут отвечает ``401`` без админ-сессии, включая
  новые разделы (ошибки, блоки стройки, подозрительная активность);
* обычный игрок с валидной сессией не получает доступ к админке;
* перебор пароля упирается в rate-limit, неудачные попытки пишутся в журнал;
* сессия администратора живёт ограниченное время и перестаёт работать после
  истечения срока;
* кука админ-сессии ``HttpOnly`` + ``SameSite=Lax``;
* действия администратора (баланс, скрытие блоков, закрытие сообщения об
  ошибке) попадают в ``admin_log``;
* сообщение об ошибке от игрока сохраняется, видно в админке и закрывается;
* список доступных блоков стройки проверяется на сервере по справочнику id, а
  игра получает его из публичного ``/api/game/blocks``.

Запуск::

    python -m unittest tools.test_admin_secure -v
"""
from __future__ import annotations

import os
import re
import sys
import unittest
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

SECRET = 'Adm-' + uuid.uuid4().hex + '-Pass!42'

if not os.environ.get('VERT_DB') and not os.environ.get('DATABASE_URL'):
    os.environ['VERT_DB'] = '/tmp/admin-secure-%d.sqlite3' % os.getpid()
# Свои лимиты: тесты про вход, а не про общий rate-limit регистрации.
os.environ.setdefault('REGISTER_RATE', '1000')
os.environ.setdefault('RATE_SOCKET_FACTOR', '1000')

import db as store  # noqa: E402
import server  # noqa: E402

GET_ENDPOINTS = [
    '/api/admin/stats', '/api/admin/users', '/api/admin/items', '/api/admin/achievements',
    '/api/admin/tasks', '/api/admin/transactions', '/api/admin/casino', '/api/admin/log',
    '/api/admin/settings', '/api/admin/games', '/api/admin/errors', '/api/admin/suspicious',
    '/api/admin/blocks',
]
POST_ENDPOINTS = [
    ('/api/admin/balance', {'username': 'nobody', 'delta': 1}),
    ('/api/admin/banned', {'username': 'nobody', 'banned': True}),
    ('/api/admin/is_admin', {'username': 'nobody', 'isAdmin': True}),
    ('/api/admin/items', {'id': 'x', 'enabled': False}),
    ('/api/admin/achievements', {'id': 'x', 'unlocked': False}),
    ('/api/admin/tasks', {'id': 'x', 'enabled': False}),
    ('/api/admin/settings', {'settings': {'casino_enabled': '0'}}),
    ('/api/admin/games', {'id': 'x', 'enabled': False}),
    ('/api/admin/errors/resolve', {'id': 1}),
    ('/api/admin/blocks', {'disabled': [12]}),
]


class AdminBase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        server.app.config.update(TESTING=True)
        cls.store = store.get_store()

    def setUp(self):
        os.environ['ADMIN_PASSWORD'] = SECRET
        os.environ.pop('ADMIN_USERNAME', None)
        self._clear_limits()
        self.client = server.app.test_client()

    def _clear_limits(self):
        with self.store.driver.transaction() as c:
            c.execute('DELETE FROM rate_limits')

    def _csrf(self, client=None):
        client = client or self.client
        client.get('/api/session')
        return {'X-CSRF-Token': client.get('/api/session').get_json()['csrf']}

    def _admin_login(self):
        headers = self._csrf()
        response = self.client.post('/api/admin/login', json={'password': SECRET}, headers=headers)
        return response, headers

    def _player(self, name=None):
        username = name or ('AdmPlayer' + uuid.uuid4().hex[:8])
        response = self.client.post('/api/auth/register', json={
            'username': username, 'password': 'StrongPass123'})
        self.assertEqual(response.status_code, 201, response.get_data(as_text=True))
        headers = self._csrf()
        return username, headers


class AdminLogin(AdminBase):
    def test_password_comes_only_from_environment(self):
        os.environ.pop('ADMIN_PASSWORD', None)
        os.environ.pop('SECRET_KEY', None)
        headers = self._csrf()
        response = self.client.post('/api/admin/login', json={'password': 'anything'}, headers=headers)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()['code'], 'ADMIN_NOT_CONFIGURED')

    def test_wrong_password_is_rejected_and_logged(self):
        before = self.store.admin_log_rows(200)
        headers = self._csrf()
        response = self.client.post('/api/admin/login', json={'password': 'wrong-pass'},
                                    headers=headers)
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()['code'], 'PASSWORD')
        rows = self.store.admin_log_rows(200)
        self.assertGreater(len(rows), len(before))
        self.assertEqual(rows[0]['action'], 'admin_login_failed')
        # В журнале только хеш IP, самого адреса нет.
        self.assertNotIn('127.0.0.1', str(rows[0].get('ip_hash') or ''))

    def test_correct_password_creates_http_only_session(self):
        response, headers = self._admin_login()
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        cookie = response.headers.get('Set-Cookie', '')
        self.assertIn('HttpOnly', cookie)
        self.assertIn('SameSite=Lax', cookie)
        self.assertNotIn(SECRET, response.get_data(as_text=True))
        stats = self.client.get('/api/admin/stats')
        self.assertEqual(stats.status_code, 200)
        self.assertIn('stats', stats.get_json())

    def test_bruteforce_is_rate_limited(self):
        os.environ['ADMIN_LOGIN_RATE'] = '3'
        try:
            headers = self._csrf()
            codes = []
            for _ in range(5):
                codes.append(self.client.post('/api/admin/login', json={'password': 'nope'},
                                              headers=headers).status_code)
            self.assertIn(429, codes, codes)
        finally:
            os.environ.pop('ADMIN_LOGIN_RATE', None)

    def test_session_expires(self):
        response, _ = self._admin_login()
        self.assertEqual(response.status_code, 200)
        with self.store.driver.transaction() as c:
            c.execute("UPDATE admin_sessions SET expires_at=?", (store.iso(0),))
        self.assertEqual(self.client.get('/api/admin/stats').status_code, 401)

    def test_logout_revokes_session(self):
        self._admin_login()
        self.assertEqual(self.client.get('/api/admin/stats').status_code, 200)
        self.client.post('/api/admin/logout', json={}, headers=self._csrf())
        self.assertEqual(self.client.get('/api/admin/stats').status_code, 401)


class AdminAccess(AdminBase):
    def test_every_get_endpoint_requires_admin(self):
        for path in GET_ENDPOINTS:
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 401, response.get_data(as_text=True))

    def test_every_post_endpoint_requires_admin(self):
        headers = self._csrf()
        for path, body in POST_ENDPOINTS:
            with self.subTest(path=path):
                response = self.client.post(path, json=body, headers=headers)
                self.assertEqual(response.status_code, 401, response.get_data(as_text=True))

    def test_regular_player_has_no_admin_access(self):
        _, headers = self._player()
        self.assertEqual(self.client.get('/api/admin/stats').status_code, 401)
        self.assertEqual(self.client.get('/api/admin/errors').status_code, 401)
        self.assertEqual(self.client.get('/api/admin/blocks').status_code, 401)
        response = self.client.post('/api/admin/balance',
                                    json={'username': 'x', 'delta': 10}, headers=headers)
        self.assertEqual(response.status_code, 401)

    def test_password_not_in_pages_or_scripts(self):
        self._admin_login()
        for path in ('/admin.html', '/assets/vg/js/admin.js', '/assets/vg/js/platform.js'):
            with self.subTest(path=path):
                response = self.client.get(path)
                try:
                    self.assertEqual(response.status_code, 200, path)
                    self.assertNotIn(SECRET, response.get_data(as_text=True), path)
                finally:
                    response.close()
        stats = self.client.get('/api/admin/stats').get_data(as_text=True)
        settings = self.client.get('/api/admin/settings').get_data(as_text=True)
        self.assertNotIn(SECRET, stats)
        self.assertNotIn('ADMIN_PASSWORD', stats)
        self.assertNotIn(SECRET, settings)
        self.assertNotIn('ADMIN_PASSWORD', settings)

    def test_sources_never_hardcode_admin_password(self):
        """Пароль читается только из окружения; литералов и дефолтов нет."""
        for path in ('server.py', 'db.py', 'render.yaml', 'admin.html', 'AUTH_SETUP.md',
                     'assets/vg/js/admin.js', 'assets/vg/js/platform.js'):
            with self.subTest(path=path):
                text = (ROOT / path).read_text(encoding='utf-8')
                # Никаких присваиваний вида ADMIN_PASSWORD = 'секрет'.
                self.assertIsNone(re.search(r'ADMIN_PASSWORD\s*[:=]\s*[\'"][^\'"]+[\'"]', text),
                                  f'{path}: пароль задан литералом')
                # Старый пароль из README не должен остаться ни в одном файле.
                self.assertNotIn('219384', text, f'{path}: старый пароль в исходниках')
        server_py = (ROOT / 'server.py').read_text(encoding='utf-8')
        self.assertIn("os.environ.get('ADMIN_PASSWORD'", server_py,
                      'пароль должен читаться из переменной окружения')
        # Значение по умолчанию не подставляется: пустая переменная = 503.
        self.assertNotIn("ADMIN_PASSWORD', '", server_py.replace("ADMIN_PASSWORD', '')", ''))


class AdminActions(AdminBase):
    def test_balance_change_is_logged(self):
        username, _ = self._player()
        self._admin_login()
        headers = self._csrf()
        response = self.client.post('/api/admin/balance', json={
            'username': username, 'delta': 50, 'reason': 'тест'}, headers=headers)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        rows = self.store.admin_log_rows(50)
        self.assertTrue(any(row['action'] == 'balance' and row['target'] == username for row in rows),
                        rows[:3])

    def test_error_report_flow(self):
        reporter = server.app.test_client()
        headers = self._csrf(reporter)
        response = reporter.post('/api/report/error', json={
            'message': 'Дом построился со сдвигом на один блок',
            'page': '/games/minicraft.html', 'kind': 'player'}, headers=headers)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        report_id = response.get_json()['id']
        self.assertTrue(report_id)

        self._admin_login()
        items = self.client.get('/api/admin/errors').get_json()['items']
        mine = [row for row in items if row['id'] == report_id]
        self.assertEqual(len(mine), 1, items[:3])
        self.assertEqual(mine[0]['resolved'], False)
        self.assertIn('сдвигом', mine[0]['message'])

        resolved = self.client.post('/api/admin/errors/resolve', json={'id': report_id},
                                    headers=self._csrf())
        self.assertEqual(resolved.status_code, 200)
        items = self.client.get('/api/admin/errors').get_json()['items']
        self.assertTrue([row for row in items if row['id'] == report_id][0]['resolved'])
        log = self.store.admin_log_rows(50)
        self.assertTrue(any(row['action'] == 'error_resolved' for row in log))

    def test_error_report_works_for_guest_without_cookie(self):
        """Гость может сообщить об ошибке с первого визита (без CSRF-куки)."""
        guest = server.app.test_client()
        response = guest.post('/api/report/error', json={'message': 'Игра не запускается'})
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))

    def test_error_report_requires_text_and_is_rate_limited(self):
        client = server.app.test_client()
        headers = self._csrf(client)
        empty = client.post('/api/report/error', json={'message': ' '}, headers=headers)
        self.assertEqual(empty.status_code, 400)
        long_text = 'x' * 5000
        ok = client.post('/api/report/error', json={'message': long_text}, headers=headers)
        self.assertEqual(ok.status_code, 200)
        stored = self.store.error_reports(1)[0]
        self.assertLessEqual(len(stored['message']), 600)
        self._clear_limits()
        codes = [client.post('/api/report/error', json={'message': 'повтор номер ' + str(i)},
                             headers=headers).status_code for i in range(14)]
        self.assertIn(429, codes, codes)

    def test_build_blocks_whitelist_and_public_list(self):
        self._admin_login()
        headers = self._csrf()
        response = self.client.post('/api/admin/blocks',
                                    json={'disabled': [12, 999, 'nope', 5]}, headers=headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['disabled'], [5, 12])
        public = self.client.get('/api/game/blocks').get_json()
        self.assertEqual(public['blocks']['disabled'], [5, 12])
        blocks = self.client.get('/api/admin/blocks').get_json()['blocks']
        enabled = {row['id']: row['enabled'] for row in blocks}
        self.assertFalse(enabled[12])
        self.assertFalse(enabled[5])
        self.assertTrue(enabled[1])
        log = self.store.admin_log_rows(50)
        self.assertTrue(any(row['action'] == 'blocks_update' for row in log))
        cleared = self.client.post('/api/admin/blocks', json={'disabled': []},
                                   headers=self._csrf())
        self.assertEqual(cleared.get_json()['disabled'], [])
        self.assertEqual(self.client.get('/api/game/blocks').get_json()['blocks']['disabled'], [])

    def test_suspicious_report_has_shape(self):
        self._admin_login()
        report = self.client.get('/api/admin/suspicious?hours=24').get_json()['report']
        for key in ('failedAdminLogins', 'adminLogins', 'largeTransactions', 'topWinners',
                    'failedByIp', 'newAccounts'):
            self.assertIn(key, report)
        self.assertIsInstance(report['largeTransactions'], list)

    def test_casino_history_is_readable_for_admin(self):
        self._admin_login()
        data = self.client.get('/api/admin/casino?limit=5').get_json()
        self.assertIn('items', data)
        for row in data['items']:
            self.assertIn('stake', row)
            self.assertIn('payout', row)
            self.assertIn('username', row)


class AdminShopAndCovers(AdminBase):
    """Магазин и фоны: админ управляет, игрок экипирует, чужие данные не трогаются."""

    def test_admin_manages_cosmetic_items_and_covers(self):
        self._admin_login()
        headers = self._csrf()
        # Админ добавляет новый фон профиля.
        response = self.client.post('/api/admin/items', json={
            'id': 'bg:test-cover', 'kind': 'bg', 'name_ru': 'Тестовый фон',
            'name_en': 'Test cover', 'price': 0, 'payload': 'vg-cover-grid'}, headers=headers)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        catalog = self.client.get('/api/shop').get_json()
        self.assertIn('bg', catalog['kinds'])
        covers = [item for item in catalog['items'] if item['kind'] == 'bg']
        self.assertTrue([item for item in covers if item['id'] == 'bg:test-cover'], covers)
        # Скрытый предмет не должен попадать в каталог игрока.
        off = self.client.post('/api/admin/items', json={
            'id': 'bg:test-cover', 'kind': 'bg', 'name_ru': 'Тестовый фон',
            'name_en': 'Test cover', 'price': 0, 'payload': 'vg-cover-grid', 'active': False},
            headers=self._csrf())
        self.assertEqual(off.status_code, 200)
        catalog = self.client.get('/api/shop').get_json()
        self.assertFalse([i for i in catalog['items'] if i['id'] == 'bg:test-cover'])

    def test_player_equips_background_without_touching_other_fields(self):
        username, headers = self._player()
        before = self.client.get('/api/me').get_json()['user']
        response = self.client.post('/api/shop/equip',
                                    json={'item': 'bg:aurora'}, headers=headers)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        catalog = self.client.get('/api/shop').get_json()
        equipped = [i for i in catalog['items'] if i['kind'] == 'bg' and i['equipped']]
        self.assertEqual([i['id'] for i in equipped], ['bg:aurora'])
        after = self.client.get('/api/me').get_json()['user']
        for field in ('avatar', 'color', 'title'):
            self.assertEqual(before[field], after[field], field)


if __name__ == '__main__':
    unittest.main()
