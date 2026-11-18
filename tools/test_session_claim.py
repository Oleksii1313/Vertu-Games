#!/usr/bin/env python3
"""Итоговая награда сессии MiniCraft 3D (зелёные V-монеты).

Проверяется именно серверная часть — то, что нельзя «нарисовать» в браузере:

* сумму считает сервер (монеты × награда каталога), клиентское число V не
  принимается;
* один подписанный билет платит один раз, повтор того же билета не начисляет;
* число монет обрезается лимитом каталога, а не отклоняется целиком;
* невозможный итог (150 монет за 5 секунд, отрицательные числа) отклоняется;
* суточный лимит игры соблюдается и после него выплата не идёт;
* билет другой игры и подделанная подпись не принимаются;
* сценарий из ТЗ: 538 + 20 монет × 3 V = 598 и та же сумма после перезахода.

Запуск:

    python -m unittest tools/test_session_claim.py -v
    DATABASE_URL=postgresql://… python -m unittest tools/test_session_claim.py -v
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
        schema = 'test_mcs_' + uuid.uuid4().hex[:10]
        sep = '&' if '?' in url else '?'
        env['DATABASE_URL'] = f'{url}{sep}options=-csearch_path%3D{schema}'
        env['_SCHEMA'] = schema
        env['_BASE_URL'] = url
    else:
        tmp = tempfile.mkdtemp(prefix='vg-mcs-')
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
from game_catalog import GAMES_BY_ID  # noqa: E402

store = db_module.get_store()
server.app.config.update(TESTING=True)
PASSWORD = 'Str0ng-Pass!23'
MINICRAFT = GAMES_BY_ID['minicraft']


class Client:
    """Клиент как браузер: куки плюс CSRF-заголовок."""

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

    def login(self, name):
        return self.post('/api/auth/login', {'username': name, 'password': PASSWORD})

    def ticket(self, game='minicraft'):
        data = self.get('/api/games/session?game=' + game).get_json()
        self.assert_has_sig = bool(data.get('sig'))
        return data

    def claim(self, **body):
        payload = {'game': 'minicraft'}
        payload.update(body)
        return self.post('/api/games/session/claim', payload)


class SessionClaimTest(unittest.TestCase):
    counter = 0

    def setUp(self):
        SessionClaimTest.counter += 1
        self.name = f'Sc{SessionClaimTest.counter}{os.getpid() % 1000}'
        self.client = Client()
        response = self.client.register(self.name)
        self.assertEqual(response.status_code, 201, response.get_json())
        self.uid = response.get_json()['user']['id']

    # ------------------------------------------------------------- доступ
    def test_requires_login(self):
        anon = server.app.test_client()
        anon.get('/')
        cookie = anon.get_cookie('vg_csrf')
        headers = {'X-CSRF-Token': cookie.value} if cookie else {}
        response = anon.post('/api/games/session/claim', json={'game': 'minicraft', 'coins': 1},
                             headers=headers)
        self.assertIn(response.status_code, (401, 403), response.get_json())

    def test_only_minicraft_has_session_reward(self):
        response = self.client.post('/api/games/session/claim', {
            'game': 'flappy', 'coins': 10, 'time': 60, 'ticket': self.client.ticket('flappy')})
        self.assertEqual(response.status_code, 404, response.get_json())
        self.assertTrue(MINICRAFT.get('session_claim'))

    # ------------------------------------------------------- основная выплата
    def test_pays_exactly_three_v_per_coin(self):
        before = store.balance(self.uid)
        ticket = self.client.ticket()
        self.assertTrue(ticket.get('sig'), ticket)
        response = self.client.claim(coins=12, time=90, kills=4, chests=2,
                                     sessionId='mc-test-1', ticket=ticket)
        payload = response.get_json()
        self.assertEqual(response.status_code, 200, payload)
        self.assertEqual(payload['awarded'], 12 * MINICRAFT['reward'])
        self.assertEqual(payload['rate'], MINICRAFT['reward'])
        self.assertEqual(payload['coins'], before + 36)
        self.assertEqual(payload['coinsCount'], 12)
        # В журнале одна строка «игра» с точной суммой и ссылкой на билет.
        row = store.ledger(self.uid, 1)[0]
        self.assertEqual(row['delta'], 36)
        self.assertEqual(row['kind'], 'game')
        self.assertEqual(store.balance(self.uid), before + 36)

    def test_scenario_538_plus_60_is_598_and_survives_relogin(self):
        self.assertEqual(store.set_balance(self.uid, 538), 538)
        response = self.client.claim(coins=20, time=150, sessionId='mc-598', ticket=self.client.ticket())
        payload = response.get_json()
        self.assertEqual(response.status_code, 200, payload)
        self.assertEqual(payload['awarded'], 60, payload)
        self.assertEqual(payload['coins'], 598, payload)
        # Новая сессия браузера (перезаход) видит ту же сумму.
        other = Client()
        other.login(self.name)
        self.assertEqual(other.get('/api/profile/' + self.name).get_json()['user']['coins'], 598)

    # ------------------------------------------------------- без дублей
    def test_same_ticket_is_paid_once(self):
        ticket = self.client.ticket()
        first = self.client.claim(coins=10, time=60, sessionId='mc-dup', ticket=ticket).get_json()
        self.assertEqual(first['awarded'], 30, first)
        balance = first['coins']
        second = self.client.claim(coins=10, time=60, sessionId='mc-dup', ticket=ticket).get_json()
        self.assertTrue(second['repeated'], second)
        self.assertEqual(second['awarded'], 0, second)
        self.assertEqual(second['coins'], balance, second)
        # Даже если клиент «нарисует» другое число монет, повтор не платит.
        third = self.client.claim(coins=99, time=150, sessionId='mc-dup2', ticket=ticket).get_json()
        self.assertEqual(third['awarded'], 0, third)
        self.assertEqual(store.balance(self.uid), balance)

    def test_repeated_payment_keeps_single_ledger_row(self):
        ticket = self.client.ticket()
        rows_before = len(store.ledger(self.uid, 50))
        self.client.claim(coins=6, time=30, ticket=ticket)
        self.client.claim(coins=6, time=30, ticket=ticket)
        rows_after = len(store.ledger(self.uid, 50))
        self.assertEqual(rows_after - rows_before, 1, store.ledger(self.uid, 50))

    # ------------------------------------------------------- лимиты и обрезка
    def test_coin_count_is_clamped_not_rejected(self):
        ticket = self.client.ticket()
        response = self.client.claim(coins=999, time=180, ticket=ticket)
        payload = response.get_json()
        self.assertEqual(response.status_code, 200, payload)
        self.assertTrue(payload['clamped'], payload)
        self.assertEqual(payload['coinsCount'], MINICRAFT['session_max_coins'])
        self.assertEqual(payload['awarded'], MINICRAFT['session_max_coins'] * MINICRAFT['reward'])

    def test_impossible_result_is_clamped_to_play_time(self):
        # 140 монет за 5 секунд физически не собрать: платим за две монеты в
        # секунду, но не отказываем целиком.
        ticket = self.client.ticket()
        before = store.balance(self.uid)
        response = self.client.claim(coins=140, time=5, ticket=ticket)
        payload = response.get_json()
        self.assertEqual(response.status_code, 200, payload)
        self.assertTrue(payload['clamped'], payload)
        self.assertEqual(payload['coinsCount'], 10, payload)
        self.assertEqual(payload['awarded'], 30, payload)
        self.assertEqual(store.balance(self.uid), before + 30)

    def test_instant_session_pays_nothing(self):
        before = store.balance(self.uid)
        payload = self.client.claim(coins=5, time=1, ticket=self.client.ticket()).get_json()
        self.assertEqual(payload['awarded'], 0, payload)
        self.assertEqual(store.balance(self.uid), before)

    def test_negative_coins_rejected(self):
        negative = self.client.claim(coins=-5, time=60, ticket=self.client.ticket())
        self.assertEqual(negative.status_code, 400, negative.get_json())

    def test_zero_coins_awards_nothing(self):
        before = store.balance(self.uid)
        rows = len(store.ledger(self.uid, 50))
        response = self.client.claim(coins=0, time=180, sessionId='mc-zero', ticket=self.client.ticket())
        payload = response.get_json()
        self.assertEqual(response.status_code, 200, payload)
        self.assertEqual(payload['awarded'], 0, payload)
        self.assertFalse(payload.get('claimed'))
        self.assertEqual(store.balance(self.uid), before)
        self.assertEqual(len(store.ledger(self.uid, 50)), rows)

    def test_daily_limit_stops_further_payouts(self):
        before = store.balance(self.uid)
        first = self.client.claim(coins=MINICRAFT['session_max_coins'], time=180,
                                  ticket=self.client.ticket()).get_json()
        self.assertEqual(first['awarded'], MINICRAFT['daily'], first)
        self.assertEqual(store.balance(self.uid), before + MINICRAFT['daily'])
        second = self.client.claim(coins=10, time=60, ticket=self.client.ticket()).get_json()
        self.assertEqual(second['awarded'], 0, second)
        self.assertTrue(second['capped'], second)
        self.assertEqual(second['dailyLeft'], 0, second)
        self.assertEqual(store.balance(self.uid), before + MINICRAFT['daily'])

    # ------------------------------------------------------- билеты
    def test_bad_ticket_and_foreign_ticket_rejected(self):
        before = store.balance(self.uid)
        broken = {'sid': 'x', 'sig': 'deadbeef', 'amount': 500, 'game': 'minicraft'}
        response = self.client.claim(coins=10, time=60, ticket=broken)
        self.assertEqual(response.status_code, 403, response.get_json())
        foreign = self.client.claim(coins=10, time=60, ticket=self.client.ticket('flappy'))
        self.assertEqual(foreign.status_code, 403, foreign.get_json())
        self.assertEqual(store.balance(self.uid), before)

    def test_ticket_is_single_use_across_games(self):
        ticket = self.client.ticket()
        response = self.client.claim(coins=8, time=40, ticket=ticket)
        self.assertEqual(response.status_code, 200, response.get_json())
        # Тот же билет уже оплачен: снова ничего.
        again = self.client.claim(coins=8, time=40, ticket=ticket).get_json()
        self.assertEqual(again['awarded'], 0, again)


if __name__ == '__main__':
    unittest.main(verbosity=2)
