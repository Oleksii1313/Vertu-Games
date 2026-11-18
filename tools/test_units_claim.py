#!/usr/bin/env python3
"""Итоговая награда забега для 2D-игр (flappy, 2048, platformer, pong, shooter, doodle, rover).

Проверяется то, что нельзя «нарисовать» в браузере:

* сумму считает сервер: клиент присылает число единиц (трубы, волны, сотни
  очков, заказы), а V = единицы × ставка каталога;
* одна сессия платит один раз: повтор с тем же sessionId не начисляет второй
  раз (ключ ``uss:<uid>:<sessionId>``), поэтому клиенту можно повторять запрос;
* невозможный темп обрезается: за 10 секунд нельзя пройти 60 труб;
* суточный лимит игры соблюдается, после него выплата равна нулю;
* билет другой игры, отсутствие билета и гость не получают денег;
* каждая выплата — строка журнала с точной суммой, ссылкой и статусом;
* баланс и история согласованы после нескольких забегов подряд.

Запуск:

    python -m unittest tools/test_units_claim.py -v
    DATABASE_URL=postgresql://… python -m unittest tools/test_units_claim.py -v
"""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def _prepare_database() -> dict:
    env = {}
    url = (os.environ.get('DATABASE_URL') or '').strip()
    if url:
        schema = 'test_usc_' + uuid.uuid4().hex[:10]
        sep = '&' if '?' in url else '?'
        env['DATABASE_URL'] = f'{url}{sep}options=-csearch_path%3D{schema}'
        env['_SCHEMA'] = schema
        env['_BASE_URL'] = url
    else:
        tmp = tempfile.mkdtemp(prefix='vg-usc-')
        env['VERT_DB'] = str(Path(tmp) / 'test.sqlite3')
    return env


ENV = _prepare_database()
if ENV.get('_SCHEMA'):
    import psycopg
    with psycopg.connect(ENV['_BASE_URL'], autocommit=True) as _conn:
        _conn.execute(f'CREATE SCHEMA IF NOT EXISTS "{ENV["_SCHEMA"]}"')

os.environ.update(ENV)
os.environ.setdefault('RATELIMIT', 'off')
os.environ.setdefault('REGISTER_RATE', '1000')
os.environ.setdefault('REGISTER_NAME_RATE', '1000')

import db as db_module  # noqa: E402
import guard  # noqa: E402
import server  # noqa: E402
from game_catalog import GAMES_BY_ID, public_games  # noqa: E402

store = db_module.get_store()
server.app.config.update(TESTING=True)
PASSWORD = 'Str0ng-Pass!23'
UNIT_GAMES = ['flappy', '2048', 'platformer', 'pong', 'shooter', 'doodle', 'rover']


class Client:
    def __init__(self):
        self.flask = server.app.test_client()
        self.flask.get('/')
        guard.reset()

    def _headers(self):
        cookie = self.flask.get_cookie('vg_csrf')
        return {'X-CSRF-Token': cookie.value} if cookie else {}

    def post(self, path, body=None):
        return self.flask.post(path, json=body or {}, headers=self._headers())

    def get(self, path):
        return self.flask.get(path)

    def register(self, name):
        return self.post('/api/auth/register', {'username': name, 'password': PASSWORD})

    def ticket(self, game):
        return self.get('/api/games/session?game=' + game).get_json()

    def claim(self, game, units, time=120, session_id='', ticket=None):
        body = {'game': game, 'units': units, 'time': time, 'sessionId': session_id or ('t-%s' % uuid.uuid4().hex[:8])}
        if ticket is not None:
            body['ticket'] = ticket
        return self.post('/api/games/session/claim', body)


class UnitsClaimTest(unittest.TestCase):
    counter = 0

    def setUp(self):
        UnitsClaimTest.counter += 1
        self.name = f'Uc{UnitsClaimTest.counter}{os.getpid() % 1000}'
        self.client = Client()
        response = self.client.register(self.name)
        self.assertEqual(response.status_code, 201, response.get_json())
        self.uid = response.get_json()['user']['id']
        self.guard = guard

    def tearDown(self):
        guard.reset()

    # ------------------------------------------------------------- доступ
    def test_requires_login(self):
        anon = server.app.test_client()
        anon.get('/')
        cookie = anon.get_cookie('vg_csrf')
        headers = {'X-CSRF-Token': cookie.value} if cookie else {}
        response = anon.post('/api/games/session/claim',
                             json={'game': 'flappy', 'units': 3, 'time': 60}, headers=headers)
        self.assertIn(response.status_code, (401, 403), response.get_json())

    def test_games_without_session_reward_rejected(self):
        response = self.client.post('/api/games/session/claim', {
            'game': 'skyisle', 'units': 3, 'time': 60, 'ticket': self.client.ticket('skyisle')})
        self.assertEqual(response.status_code, 404, response.get_json())

    # ------------------------------------------------ ставка из каталога
    def test_pays_catalog_rate_for_every_unit_game(self):
        cards = {g['id']: g for g in public_games()}
        for game in UNIT_GAMES:
            with self.subTest(game=game):
                guard.reset()
                card = cards[game]
                before = store.balance(self.uid)
                response = self.client.claim(game, units=5, time=180,
                                             ticket=self.client.ticket(game))
                payload = response.get_json()
                self.assertEqual(response.status_code, 200, payload)
                self.assertEqual(payload['unitsCount'], 5, payload)
                self.assertEqual(payload['rate'], card['reward'], payload)
                self.assertEqual(payload['awarded'], 5 * card['reward'], payload)
                self.assertEqual(store.balance(self.uid), before + 5 * card['reward'])

    # ----------------------------------------------------- идемпотентность
    def test_same_session_id_pays_once(self):
        ticket = self.client.ticket('flappy')
        first = self.client.claim('flappy', units=4, time=120, session_id='run-1', ticket=ticket)
        self.assertEqual(first.status_code, 200, first.get_json())
        after_first = store.balance(self.uid)
        second = self.client.claim('flappy', units=4, time=120, session_id='run-1',
                                   ticket=self.client.ticket('flappy'))
        payload = second.get_json()
        self.assertEqual(second.status_code, 200, payload)
        self.assertTrue(payload['repeated'], payload)
        self.assertEqual(payload['awarded'], 0, payload)
        self.assertEqual(store.balance(self.uid), after_first)

    def test_new_session_id_pays_again(self):
        before = store.balance(self.uid)
        for i in range(3):
            response = self.client.claim('2048', units=2, time=120, session_id='run-%d' % i,
                                         ticket=self.client.ticket('2048'))
            self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual(store.balance(self.uid), before + 3 * 2 * GAMES_BY_ID['2048']['reward'])

    # -------------------------------------------------- правдоподобность
    def test_impossible_pace_is_clamped_not_rejected(self):
        card = GAMES_BY_ID['flappy']
        response = self.client.claim('flappy', units=card['session_max_units'], time=10,
                                     ticket=self.client.ticket('flappy'))
        payload = response.get_json()
        self.assertEqual(response.status_code, 200, payload)
        ceiling = min(card['session_max_units'], max(3, int(10 * card['session_units_per_sec']) + 1))
        self.assertTrue(payload['clamped'], payload)
        self.assertEqual(payload['unitsCount'], ceiling, payload)
        self.assertEqual(payload['awarded'], ceiling * card['reward'], payload)

    def test_too_short_session_pays_nothing(self):
        response = self.client.claim('pong', units=10, time=2, ticket=self.client.ticket('pong'))
        payload = response.get_json()
        self.assertEqual(response.status_code, 200, payload)
        self.assertEqual(payload['awarded'], 0, payload)
        self.assertEqual(payload['unitsCount'], 0, payload)
        self.assertTrue(payload['zero'], payload)

    def test_negative_units_rejected(self):
        response = self.client.claim('shooter', units=-3, time=60, ticket=self.client.ticket('shooter'))
        self.assertEqual(response.status_code, 400, response.get_json())

    # ------------------------------------------------------------ билеты
    def test_ticket_of_other_game_rejected(self):
        response = self.client.claim('flappy', units=5, time=120,
                                     ticket=self.client.ticket('2048'))
        self.assertEqual(response.status_code, 403, response.get_json())

    def test_missing_ticket_rejected(self):
        response = self.client.claim('flappy', units=5, time=120, ticket={})
        self.assertEqual(response.status_code, 403, response.get_json())

    # ------------------------------------------------------ суточный лимит
    def test_daily_cap_limits_payout(self):
        card = GAMES_BY_ID['rover']
        per_run = card['session_max_units'] * card['reward']
        runs = card['daily'] // per_run + 2
        total = 0
        for i in range(runs):
            guard.reset()
            response = self.client.claim('rover', units=card['session_max_units'], time=600,
                                         session_id='cap-%d' % i, ticket=self.client.ticket('rover'))
            payload = response.get_json()
            if response.status_code == 429:
                continue
            self.assertEqual(response.status_code, 200, payload)
            total += payload['awarded']
        self.assertLessEqual(total, card['daily'])
        self.assertGreater(total, 0)

    # --------------------------------------------------- журнал и баланс
    def test_ledger_matches_balance(self):
        before = store.balance(self.uid)
        delta = 0
        for game in ('flappy', 'platformer', 'doodle'):
            guard.reset()
            payload = self.client.claim(game, units=3, time=200, ticket=self.client.ticket(game)).get_json()
            delta += payload['awarded']
        rows = store.ledger(self.uid, 10)
        game_rows = [r for r in rows if r['kind'] == 'game']
        self.assertEqual(sum(r['delta'] for r in game_rows[:3]), delta)
        self.assertEqual(store.balance(self.uid), before + delta)

    def test_contract_exposed_to_browser(self):
        # Платформа узнаёт из каталога, что сумму считает сервер.
        cards = {g['id']: g for g in public_games()}
        for game in UNIT_GAMES:
            self.assertTrue(cards[game]['sessionClaim'], game)
            self.assertEqual(cards[game]['unitReward'], cards[game]['reward'], game)
            self.assertIsNotNone(cards[game]['sessionMaxUnits'], game)


if __name__ == '__main__':
    unittest.main(verbosity=2)
