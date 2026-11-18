#!/usr/bin/env python3
"""Итоговая награда забега Snake (обычные и золотые яблоки).

Проверяется серверная часть — то, что нельзя «нарисовать» в браузере:

* сумму считает сервер по правилам каталога (яблоко, уровни, золотое яблоко);
* клиентское число V не принимается вообще;
* обычные и золотые яблоки учитываются раздельно;
* невозможный итог обрезается по времени и лимиту сессии, а не отклоняется;
* повтор той же сессии (тот же sessionId) не платит второй раз — в том числе
  после перезагрузки страницы, когда билет уже другой;
* суточный лимит игры (300 V) соблюдается;
* чужой билет и подделанная подпись не принимаются;
* начисление видно с новой сессии браузера (перезаход).

Запуск:

    python -m unittest tools/test_snake_claim.py -v
    DATABASE_URL=postgresql://… python -m unittest tools/test_snake_claim.py -v
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
        schema = 'test_snk_' + uuid.uuid4().hex[:10]
        sep = '&' if '?' in url else '?'
        env['DATABASE_URL'] = f'{url}{sep}options=-csearch_path%3D{schema}'
        env['_SCHEMA'] = schema
        env['_BASE_URL'] = url
    else:
        tmp = tempfile.mkdtemp(prefix='vg-snk-')
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
SNAKE = GAMES_BY_ID['snake']


def snake_amount(normal: int, golden: int) -> int:
    """Правило каталога: яблоко + бонус за каждые 5 яблок + золотые."""
    return (normal * SNAKE['apple_reward']
            + (normal // SNAKE['level_every']) * SNAKE['level_reward']
            + golden * SNAKE['gold_reward'])


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

    def ticket(self, game='snake'):
        return self.get('/api/games/session?game=' + game).get_json()

    def claim(self, **body):
        payload = {'game': 'snake'}
        payload.update(body)
        return self.post('/api/games/session/claim', payload)


class SnakeClaimTest(unittest.TestCase):
    counter = 0

    def setUp(self):
        SnakeClaimTest.counter += 1
        self.name = f'Sn{SnakeClaimTest.counter}{os.getpid() % 1000}'
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
        response = anon.post('/api/games/session/claim',
                             json={'game': 'snake', 'apples': 3, 'time': 30}, headers=headers)
        self.assertIn(response.status_code, (401, 403), response.get_json())

    def test_other_games_still_have_no_session_reward(self):
        response = self.client.post('/api/games/session/claim', {
            'game': 'flappy', 'apples': 5, 'time': 60, 'ticket': self.client.ticket('flappy')})
        self.assertEqual(response.status_code, 404, response.get_json())

    def test_card_and_daily_cap_are_unchanged(self):
        # Карточка каталога (+5 V) и лимит 300 V в сутки не меняются.
        self.assertEqual(SNAKE['reward'], 5)
        self.assertEqual(SNAKE['daily'], 300)

    # ------------------------------------------------------- основная выплата
    def test_pays_by_catalog_rule_and_keeps_apples_apart(self):
        before = store.balance(self.uid)
        ticket = self.client.ticket()
        self.assertTrue(ticket.get('sig'), ticket)
        response = self.client.claim(apples=12, gold=2, time=90, score=34,
                                     sessionId='sn-test-1', ticket=ticket)
        payload = response.get_json()
        self.assertEqual(response.status_code, 200, payload)
        self.assertEqual(payload['applesCount'], 12, payload)
        self.assertEqual(payload['goldCount'], 2, payload)
        self.assertEqual(payload['awarded'], snake_amount(12, 2), payload)
        self.assertEqual(payload['awarded'], 12 + 10 + 20)
        self.assertEqual(payload['coins'], before + 42, payload)
        self.assertFalse(payload['clamped'])
        row = store.ledger(self.uid, 1)[0]
        self.assertEqual(row['delta'], 42)
        self.assertEqual(row['kind'], 'game')
        self.assertEqual(store.balance(self.uid), before + 42)

    def test_client_cannot_send_its_own_v_amount(self):
        before = store.balance(self.uid)
        payload = self.client.claim(apples=4, gold=0, time=40, coins=9999,
                                    amount=9999, ticket=self.client.ticket()).get_json()
        self.assertEqual(payload['awarded'], snake_amount(4, 0), payload)
        self.assertEqual(store.balance(self.uid), before + 4)

    def test_reward_survives_relogin(self):
        self.assertEqual(store.set_balance(self.uid, 500), 500)
        payload = self.client.claim(apples=15, gold=1, time=120, sessionId='sn-relog',
                                    ticket=self.client.ticket()).get_json()
        self.assertEqual(payload['awarded'], snake_amount(15, 1), payload)  # 15 + 15 + 10 = 40
        other = Client()
        other.login(self.name)
        profile = other.get('/api/profile/' + self.name).get_json()
        self.assertEqual(profile['user']['coins'], 540, profile)

    # ------------------------------------------------------- без дублей
    def test_same_session_is_paid_once_even_with_new_ticket(self):
        first = self.client.claim(apples=10, gold=1, time=60, sessionId='sn-dup',
                                  ticket=self.client.ticket()).get_json()
        self.assertEqual(first['awarded'], snake_amount(10, 1), first)   # 10 + 10 + 10 = 30
        balance = first['coins']
        # Повтор с тем же sessionId и НОВЫМ билетом (как после перезагрузки).
        second = self.client.claim(apples=10, gold=1, time=60, sessionId='sn-dup',
                                   ticket=self.client.ticket()).get_json()
        self.assertTrue(second['repeated'], second)
        self.assertEqual(second['awarded'], 0, second)
        self.assertEqual(second['coins'], balance, second)
        # Даже с «накрученными» числами повтор не платит.
        third = self.client.claim(apples=36, gold=7, time=300, sessionId='sn-dup',
                                  ticket=self.client.ticket()).get_json()
        self.assertEqual(third['awarded'], 0, third)
        self.assertEqual(store.balance(self.uid), balance)

    def test_repeated_payment_keeps_single_ledger_row(self):
        rows_before = len(store.ledger(self.uid, 50))
        ticket = self.client.ticket()
        self.client.claim(apples=6, gold=0, time=40, sessionId='sn-row', ticket=ticket)
        self.client.claim(apples=6, gold=0, time=40, sessionId='sn-row', ticket=ticket)
        rows_after = len(store.ledger(self.uid, 50))
        self.assertEqual(rows_after - rows_before, 1, store.ledger(self.uid, 50))

    def test_different_players_may_use_same_session_id(self):
        other = Client()
        name = self.name + 'b'
        self.assertEqual(other.register(name).status_code, 201)
        uid2 = other.get('/api/me').get_json()['user']['id']
        before2 = store.balance(uid2)
        first = self.client.claim(apples=5, gold=0, time=40, sessionId='sn-shared',
                                  ticket=self.client.ticket()).get_json()
        second = other.claim(apples=5, gold=0, time=40, sessionId='sn-shared',
                             ticket=other.ticket()).get_json()
        self.assertGreater(first['awarded'], 0, first)
        self.assertGreater(second['awarded'], 0, second)
        self.assertEqual(store.balance(uid2), before2 + second['awarded'])

    # ------------------------------------------------------- лимиты и обрезка
    def test_impossible_result_is_clamped_not_rejected(self):
        # 20 обычных и 20 золотых яблок за 5 секунд физически не собрать.
        before = store.balance(self.uid)
        payload = self.client.claim(apples=20, gold=20, time=5,
                                    ticket=self.client.ticket()).get_json()
        self.assertTrue(payload['clamped'], payload)
        self.assertEqual(payload['goldCount'], 1, payload)   # золото реже: 5 // 5
        self.assertEqual(payload['applesCount'], 4, payload)  # 5 всего − 1 золотое
        self.assertEqual(payload['awarded'], snake_amount(4, 1), payload)  # 4 + 0 + 10 = 14
        self.assertEqual(store.balance(self.uid), before + 14)

    def test_total_is_capped_by_session_limit(self):
        payload = self.client.claim(apples=999, gold=99, time=600,
                                    ticket=self.client.ticket()).get_json()
        self.assertTrue(payload['clamped'], payload)
        self.assertEqual(payload['applesCount'] + payload['goldCount'],
                         SNAKE['session_max_coins'], payload)
        self.assertEqual(payload['goldCount'], SNAKE['session_max_coins'] // 5, payload)
        self.assertLessEqual(payload['awarded'], SNAKE['daily'])

    def test_honest_golden_apple_is_kept(self):
        # 30 обычных + 4 золотых за 120 секунд — правдоподобный хороший забег.
        payload = self.client.claim(apples=30, gold=4, time=120,
                                    ticket=self.client.ticket()).get_json()
        self.assertFalse(payload['clamped'], payload)
        self.assertEqual(payload['goldCount'], 4, payload)
        self.assertEqual(payload['awarded'], snake_amount(30, 4), payload)  # 30 + 30 + 40 = 100

    def test_instant_session_pays_nothing(self):
        before = store.balance(self.uid)
        payload = self.client.claim(apples=5, gold=0, time=1,
                                    ticket=self.client.ticket()).get_json()
        self.assertEqual(payload['awarded'], 0, payload)
        self.assertTrue(payload['zero'], payload)
        self.assertEqual(store.balance(self.uid), before)

    def test_negative_and_garbage_rejected(self):
        negative = self.client.claim(apples=-5, gold=0, time=60, ticket=self.client.ticket())
        self.assertEqual(negative.status_code, 400, negative.get_json())
        garbage = self.client.claim(apples='много', gold='золото', time=60,
                                    ticket=self.client.ticket())
        self.assertEqual(garbage.status_code, 400, garbage.get_json())
        negative_gold = self.client.claim(apples=3, gold=-2, time=60, ticket=self.client.ticket())
        self.assertEqual(negative_gold.status_code, 400, negative_gold.get_json())

    def test_zero_apples_awards_nothing(self):
        before = store.balance(self.uid)
        rows = len(store.ledger(self.uid, 50))
        payload = self.client.claim(apples=0, gold=0, time=180, sessionId='sn-zero',
                                    ticket=self.client.ticket()).get_json()
        self.assertEqual(payload['awarded'], 0, payload)
        self.assertFalse(payload['claimed'], payload)
        self.assertEqual(store.balance(self.uid), before)
        self.assertEqual(len(store.ledger(self.uid, 50)), rows)

    def test_daily_limit_stops_further_payouts(self):
        before = store.balance(self.uid)
        paid = 0
        for i in range(4):
            guard.reset()                       # лимит частоты не мешает проверке лимита суток
            payload = self.client.claim(apples=36, gold=7, time=300, sessionId='sn-day-%d' % i,
                                        ticket=self.client.ticket()).get_json()
            paid += payload['awarded']
            if payload['capped']:
                self.assertEqual(payload['dailyLeft'], 0, payload)
                self.assertEqual(payload['awarded'], 0, payload)
                break
        self.assertEqual(paid, SNAKE['daily'])
        self.assertEqual(store.balance(self.uid), before + SNAKE['daily'])
        guard.reset()
        last = self.client.claim(apples=10, gold=0, time=60, sessionId='sn-day-x',
                                 ticket=self.client.ticket()).get_json()
        self.assertEqual(last['awarded'], 0, last)
        self.assertTrue(last['capped'], last)
        self.assertEqual(store.balance(self.uid), before + SNAKE['daily'])

    # ------------------------------------------------------- билеты
    def test_bad_ticket_and_foreign_ticket_rejected(self):
        before = store.balance(self.uid)
        broken = {'sid': 'x', 'sig': 'deadbeef', 'amount': 500, 'game': 'snake'}
        response = self.client.claim(apples=5, gold=0, time=60, ticket=broken)
        self.assertEqual(response.status_code, 403, response.get_json())
        foreign = self.client.claim(apples=5, gold=0, time=60, ticket=self.client.ticket('flappy'))
        self.assertEqual(foreign.status_code, 403, foreign.get_json())
        self.assertEqual(store.balance(self.uid), before)


if __name__ == '__main__':
    unittest.main(verbosity=2)
