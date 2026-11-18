#!/usr/bin/env python3
"""Награды, баланс и даты достижений Vert Games (SQLite и PostgreSQL).

Проверяется то, что игрок видит на экране и что нельзя «сделать в браузере»:

* баланс — единственный источник правды сервер: после перезахода, перезагрузки
  и нового клиента сумма та же;
* приветственный вход начисляется один раз: повторный вход не создаёт второй
  транзакции, а запись в журнале имеет реальную метку времени (не 1970 год);
* награда за игровое событие: сумму задаёт каталог, квитанция дедуплицируется,
  суточный лимит соблюдается, каждая выплата — отдельная строка `ledger`;
* сценарий из ТЗ: 538 + 50 (вход) + 120 (геймплей) = 708 и после перезахода;
* даты достижений: unix-секунды в пределах разумного и не «20775 дней назад»;
* отклонённые/порченые квитанции не начисляют ничего.

Запуск:

    python -m unittest tools/test_rewards.py -v
    DATABASE_URL=postgresql://… python -m unittest tools/test_rewards.py -v
"""
from __future__ import annotations

import os
import sys
import tempfile
import time
import unittest
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def _prepare_database() -> dict:
    env = {}
    url = (os.environ.get('DATABASE_URL') or '').strip()
    if url:
        schema = 'test_reward_' + uuid.uuid4().hex[:10]
        sep = '&' if '?' in url else '?'
        env['DATABASE_URL'] = f'{url}{sep}options=-csearch_path%3D{schema}'
        env['_SCHEMA'] = schema
        env['_BASE_URL'] = url
    else:
        tmp = tempfile.mkdtemp(prefix='vg-reward-')
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


class Client:
    """Клиент как браузер: держит куки и присылает CSRF-заголовок."""

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


class RewardTest(unittest.TestCase):
    counter = 0

    def setUp(self):
        RewardTest.counter += 1
        # Ник уникален: 3–16 символов, разрешённые знаки.
        self.name = f'Rw{RewardTest.counter}{os.getpid() % 1000}'
        self.client = Client()
        response = self.client.register(self.name)
        self.assertEqual(response.status_code, 201, response.get_json())
        self.uid = response.get_json()['user']['id']

    # ------------------------------------------------------------------ баланс
    def test_balance_is_authoritative_after_relogin(self):
        self.assertEqual(store.set_balance(self.uid, 538), 538)
        fresh = Client()
        fresh.login(self.name)
        data = fresh.get(f'/api/profile/{self.name}').get_json()
        self.assertEqual(data['user']['coins'], 538)
        # «Другое устройство»: третий клиент видит ту же сумму.
        other = Client()
        other.login(self.name)
        self.assertEqual(other.get('/api/profile/' + self.name).get_json()['user']['coins'], 538)

    # ------------------------------------------------------- награда за вход
    def test_login_reward_once_with_real_timestamp(self):
        # Регистрация сразу выдаёт приветственный вход.
        ledger = store.ledger(self.uid, 50)
        kinds = [row['kind'] for row in ledger]
        self.assertIn('welcome', kinds)
        ach_rows = [row for row in ledger if row['kind'] == 'achievement']
        self.assertEqual(len(ach_rows), 1, ledger)

        now = int(time.time())
        for row in ledger:
            self.assertGreater(int(row['created']), now - 600, row)
            self.assertLessEqual(int(row['created']), now + 60, row)

        # Повторный вход не начисляет второй раз.
        before = store.balance(self.uid)
        self.client.login(self.name)
        self.client.login(self.name)
        self.assertEqual(store.balance(self.uid), before)
        again = [row for row in store.ledger(self.uid, 50) if row['kind'] == 'achievement']
        self.assertEqual(len(again), 1)

    def test_achievement_timestamps_are_sane(self):
        data = self.client.get(f'/api/profile/{self.name}').get_json()
        self.assertTrue(data['achievements'], data)
        now = int(time.time())
        for item in data['achievements']:
            stamp = item['unlocked']
            self.assertIsInstance(stamp, int, item)
            self.assertGreater(stamp, now - 600, item)
            self.assertLessEqual(stamp, now + 60, item)
            # Никаких «20775 дней назад»: метка не может быть раньше 2024 года.
            self.assertGreater(stamp, 1_700_000_000, item)

    # ---------------------------------------------------- награда за геймплей
    def test_gameplay_reward_uses_catalog_amount(self):
        self.client.get('/api/games/session?game=flappy')
        ticket = self.client.get('/api/games/session?game=flappy').get_json()
        self.assertTrue(ticket.get('sig'), ticket)
        spec = GAMES_BY_ID['flappy']
        before = store.balance(self.uid)
        response = self.client.post('/api/games/reward', {
            'game': 'flappy', 'receipt': 'evt:flappy:1', 'amount': 999999,
            'ticket': ticket})
        payload = response.get_json()
        self.assertEqual(response.status_code, 200, payload)
        self.assertEqual(payload['awarded'], spec['reward'], payload)
        self.assertEqual(payload['coins'], before + spec['reward'])
        # Клиентская сумма проигнорирована: в журнале ровно каталожная награда.
        row = store.ledger(self.uid, 1)[0]
        self.assertEqual(row['delta'], spec['reward'])
        self.assertEqual(row['kind'], 'game')

    def test_gameplay_reward_is_deduplicated(self):
        ticket = self.client.get('/api/games/session?game=pong').get_json()
        body = {'game': 'pong', 'receipt': 'evt:pong:dup', 'ticket': ticket}
        first = self.client.post('/api/games/reward', body).get_json()
        self.assertTrue(first['awarded'] > 0, first)
        balance = first['coins']
        second = self.client.post('/api/games/reward', body).get_json()
        self.assertTrue(second['repeated'], second)
        self.assertEqual(second['awarded'], 0)
        self.assertEqual(store.balance(self.uid), balance)

    def test_bad_ticket_and_receipt_rejected(self):
        before = store.balance(self.uid)
        bad = self.client.post('/api/games/reward', {
            'game': 'flappy', 'receipt': 'evt:flappy:bad',
            'ticket': {'sid': 'x', 'sig': 'deadbeef', 'amount': 500}})
        self.assertEqual(bad.status_code, 403, bad.get_json())
        short = self.client.post('/api/games/reward', {
            'game': 'flappy', 'receipt': 'no', 'ticket': {}})
        self.assertEqual(short.status_code, 400, short.get_json())
        unknown = self.client.post('/api/games/reward', {
            'game': 'no-such-game', 'receipt': 'evt:unknown:1'})
        self.assertEqual(unknown.status_code, 404, unknown.get_json())
        self.assertEqual(store.balance(self.uid), before)

    def test_daily_limit_is_enforced(self):
        spec = GAMES_BY_ID['pong']
        cap = int(spec['daily'])
        # Начисляем «в обход» HTTP ровно до лимита, затем просим ещё.
        granted = 0
        while granted + spec['reward'] <= cap:
            result = store.game_reward(self.uid, 'pong', spec['reward'],
                                       f'cap:test:{granted}', 'Игра: Pong', cap)
            granted += result['awarded']
        self.assertEqual(granted, cap)
        over = store.game_reward(self.uid, 'pong', spec['reward'], 'cap:test:over',
                                 'Игра: Pong', cap)
        self.assertTrue(over.get('capped'), over)
        self.assertEqual(over['awarded'], 0)

    # --------------------------------------------- сценарий из ТЗ: 538/50/120
    def test_scenario_538_plus_50_plus_120_equals_708(self):
        store.set_balance(self.uid, 538)
        # Вход: награда «Добро пожаловать» (50 V). При регистрации она уже была
        # выдана, поэтому откатываем отметку — так тест проверяет именно механизм
        # начисления на «пришедший с 538 V» аккаунт.
        # Исторические аккаунты могли получить баланс без этой отметки — так и
        # моделируем: снимаем отметку и её транзакцию, баланс не трогаем.
        with store.driver.transaction() as c:
            c.execute('DELETE FROM user_achievements WHERE user_id=? AND achievement_id=?',
                      (self.uid, 'first_login'))
            c.execute('DELETE FROM transactions WHERE user_id=? AND reference_id=?',
                      (self.uid, f'ach:{self.uid}:first_login'))
        unlocked = store.unlock_achievement(self.uid, 'first_login')
        self.assertIsNotNone(unlocked, unlocked)
        self.assertEqual(unlocked['balance'], 588)
        login_rows = [row for row in store.ledger(self.uid, 50)
                      if row['kind'] == 'achievement' and int(row['delta']) == 50]
        self.assertEqual(len(login_rows), 1, login_rows)

        # Геймплей: platformer платит 5 V за событие — 24 события = 120 V.
        spec = GAMES_BY_ID['platformer']
        self.assertEqual(spec['reward'], 5)
        paid = 0
        n = 0
        while paid < 120:
            n += 1
            result = store.game_reward(self.uid, 'platformer', spec['reward'],
                                       f'play:platformer:{n}', 'Игра: Platformer',
                                       spec['daily'])
            paid += int(result['awarded'])
        self.assertEqual(paid, 120)

        # Итог и отдельный учёт: вход и геймплей — разные строки журнала.
        self.assertEqual(store.balance(self.uid), 708)
        ledger = store.ledger(self.uid, 100)
        game_rows = [row for row in ledger if row['kind'] == 'game']
        self.assertEqual(len(game_rows), 24)
        self.assertEqual(sum(int(row['delta']) for row in game_rows), 120)

        # Перезаход в новом клиенте — сумма та же, история на месте.
        fresh = Client()
        fresh.login(self.name)
        data = fresh.get(f'/api/profile/{self.name}').get_json()
        self.assertEqual(data['user']['coins'], 708)
        # API отдаёт последнюю страницу журнала (не всю историю) — сверяем
        # свежие строки и то, что каждая имеет настоящую дату.
        self.assertTrue(data['ledger'])
        page = data['ledger']
        self.assertEqual([row['id'] for row in page], [row['id'] for row in ledger[:len(page)]])
        now = int(time.time())
        for row in page:
            self.assertGreater(int(row['created']), now - 600, row)
            self.assertLessEqual(int(row['created']), now + 60, row)


class CatalogRewardTest(unittest.TestCase):
    """Каждая карточка каталога платит ровно ту сумму, что обещана игроку."""

    def test_every_visible_game_pays_its_card_reward(self):
        from game_catalog import public_games, visible_games
        cards = {game['id']: game for game in public_games()}
        self.assertEqual(len(cards), len(visible_games()))
        # На витрине 10 игр: Redline скрыт по требованию заказчика, но запись в
        # GAMES осталась — вместе с историей и финансовыми транзакциями.
        self.assertEqual(len(cards), 10, 'на витрине должно быть 10 игр')
        self.assertEqual(len(GAMES_BY_ID), 11, 'все 11 записей каталога сохранены')
        self.assertNotIn('redline', cards)
        self.assertTrue(GAMES_BY_ID['redline'].get('hidden'))
        client = Client()
        name = f'Cat{os.getpid() % 1000}'
        self.assertEqual(client.register(name).status_code, 201)
        uid = store.find_user(name)['id']
        for game in visible_games():
            spec = GAMES_BY_ID[game['id']]
            card = cards[game['id']]
            # Обещанная на карточке сумма = сумма, которую знает сервер.
            self.assertEqual(card['reward'], spec['reward'], game['id'])
            self.assertGreater(card['reward'], 0, game['id'])
            self.assertGreater(card['daily'], 0, game['id'])
            before = store.balance(uid)
            result = store.game_reward(uid, game['id'], spec['reward'],
                                       f'card:{game["id"]}:{uid}', f'Игра: {spec["name"]}',
                                       spec['daily'])
            self.assertEqual(result['awarded'], card['reward'], game['id'])
            self.assertEqual(store.balance(uid), before + card['reward'], game['id'])

    def test_unknown_game_pays_nothing(self):
        client = Client()
        name = f'Unk{os.getpid() % 1000}'
        client.register(name)
        uid = store.find_user(name)['id']
        before = store.balance(uid)
        response = client.post('/api/games/reward', {'game': 'pacman', 'receipt': 'evt:pacman:1'})
        self.assertEqual(response.status_code, 404, response.get_json())
        self.assertEqual(store.balance(uid), before)


if __name__ == '__main__':
    unittest.main(verbosity=2)
