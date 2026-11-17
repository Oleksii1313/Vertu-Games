#!/usr/bin/env python3
"""Тесты экономики и авторизации Vertu Games (PostgreSQL и SQLite).

Проверяется именно то, что важно для продакшена:

* регистрация по нику и паролю, Argon2id-хеш, вход и неверный пароль;
* баланс только на сервере: отрицательная сумма отклоняется, списание больше
  баланса невозможно (``CHECK (balance >= 0)`` + проверка в коде);
* атомарность: изменение баланса и запись в ``transactions`` происходят вместе,
  при ошибке не остаётся «полусписанных» монет;
* идемпотентность: повтор с тем же ``reference_id`` не начисляет второй раз;
* гонки: 20 параллельных списаний не уводят баланс в минус;
* казино: лимит 1 бесплатное + 5 платных вращений в сутки, история пишется;
* пароли из старых баз (pbkdf2_sha256) продолжают работать и перехешируются.

Запуск:

    python -m unittest tools/test_economy.py -v                       # SQLite
    DATABASE_URL=postgresql://… python -m unittest tools/test_economy.py -v

На PostgreSQL тесты работают в отдельной схеме (``test_econ_<hex>``), поэтому
не мешают боевым данным.
"""
from __future__ import annotations

import os
import sys
import threading
import unittest
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def _prepare_database() -> dict:
    """Подготовить окружение: SQLite-файл или отдельную схему в PostgreSQL."""
    env = {}
    url = (os.environ.get('DATABASE_URL') or '').strip()
    if url:
        schema = 'test_econ_' + uuid.uuid4().hex[:10]
        sep = '&' if '?' in url else '?'
        env['DATABASE_URL'] = f'{url}{sep}options=-csearch_path%3D{schema}'
        env['_SCHEMA'] = schema
        env['_BASE_URL'] = url
    else:
        import tempfile
        tmp = tempfile.mkdtemp(prefix='vg-econ-')
        env['VERTU_DB'] = str(Path(tmp) / 'test.sqlite3')
    return env


ENV = _prepare_database()


def _create_schema() -> None:
    if not ENV.get('_SCHEMA'):
        return
    import psycopg
    with psycopg.connect(ENV['_BASE_URL'], autocommit=True) as conn:
        conn.execute(f'CREATE SCHEMA IF NOT EXISTS "{ENV["_SCHEMA"]}"')


def _drop_schema() -> None:
    if not ENV.get('_SCHEMA'):
        return
    import psycopg
    with psycopg.connect(ENV['_BASE_URL'], autocommit=True) as conn:
        conn.execute(f'DROP SCHEMA IF EXISTS "{ENV["_SCHEMA"]}" CASCADE')


_create_schema()


class EconomyTest(unittest.TestCase):
    counter = 0

    @classmethod
    def setUpClass(cls):
        os.environ.update(ENV)
        import db
        cls.db = db
        cls.store = db.get_store()

    def setUp(self):
        EconomyTest.counter += 1
        self.name = f'Econ{os.getpid() % 1000}{EconomyTest.counter}'
        self.user = self.store.create_user(self.name, 'password123')
        self.uid = self.user['id']

    # ---------------------------------------------------------------- авторизация
    def test_registration_and_welcome_bonus(self):
        self.assertEqual(self.user['coins'], self.db.WELCOME_COINS)
        self.assertEqual(self.user['role'], 'player')
        self.assertEqual(self.store.balance(self.uid), self.db.WELCOME_COINS)

    def test_password_is_argon2(self):
        stored = self.store.find_user(self.name)['password_hash']
        self.assertTrue(stored.startswith('$argon2id$'), stored[:24])
        self.assertTrue(self.db.verify_password('password123', stored))
        self.assertFalse(self.db.verify_password('wrong-password', stored))

    def test_login_and_wrong_password(self):
        self.assertEqual(self.store.authenticate(self.name, 'password123')['id'], self.uid)
        with self.assertRaises(self.db.InvalidCredentials):
            self.store.authenticate(self.name, 'nope-nope-nope')

    def test_duplicate_username_rejected(self):
        with self.assertRaises(self.db.DuplicateUser):
            self.store.create_user(self.name.upper(), 'password123')

    def test_legacy_pbkdf2_hash_still_works_and_upgrades(self):
        import hashlib
        salt = 'abcdef0123456789'
        legacy = ('pbkdf2_sha256$310000$' + salt + '$' +
                  hashlib.pbkdf2_hmac('sha256', b'old-password', salt.encode(), 310000).hex())
        name = self.name + 'L'
        self.assertEqual(self.store.import_legacy_user(name, legacy, 4321), 'created')
        # повтор без изменений — «уже есть», монеты не задваиваются
        self.assertEqual(self.store.import_legacy_user(name, legacy, 4321), 'exists')
        user = self.store.authenticate(name, 'old-password')
        self.assertEqual(user['coins'], 4321)
        # после успешного входа хеш обновился до Argon2id
        self.assertTrue(self.store.find_user(name)['password_hash'].startswith('$argon2id$'))

    # ---------------------------------------------------------------- деньги
    def test_balance_updates_and_ledger(self):
        result = self.store.add_coins(self.uid, 25, 'test', 'начисление', 'test:1')
        self.assertEqual(result['balance'], self.db.WELCOME_COINS + 25)
        self.assertEqual(self.store.ledger(self.uid)[0]['delta'], 25)

    def test_negative_balance_impossible(self):
        with self.assertRaises(self.db.InsufficientFunds):
            self.store.add_coins(self.uid, -10_000, 'test', 'слишком много')
        self.assertEqual(self.store.balance(self.uid), self.db.WELCOME_COINS)

    def test_idempotency_by_reference(self):
        first = self.store.add_coins(self.uid, 100, 'game', 'награда', 'ref:unique:1')
        second = self.store.add_coins(self.uid, 100, 'game', 'награда', 'ref:unique:1')
        self.assertFalse(first['repeated'])
        self.assertTrue(second['repeated'])
        self.assertEqual(second['balance'], self.db.WELCOME_COINS + 100)

    def test_transaction_yields_balance_and_row_together(self):
        """Баланс и запись в transactions либо оба есть, либо обоих нет."""
        before = self.store.balance(self.uid)
        with self.assertRaises(RuntimeError):
            with self.store.driver.transaction() as c:
                self.store._apply_delta(c, self.uid, 500, 'test', 'rollback', 'ref:rollback:1')
                raise RuntimeError('сбой после списания')
        self.assertEqual(self.store.balance(self.uid), before)
        with self.store.driver.transaction(isolation='read committed') as c:
            row = c.execute('SELECT 1 FROM transactions WHERE reference_id=?',
                            ('ref:rollback:1',)).fetchone()
        self.assertIsNone(row)

    def test_parallel_spending_never_goes_negative(self):
        """20 потоков списывают по 20 V: баланс не уходит в минус."""
        self.store.set_balance(self.uid, 100)
        ok, failed = [], []

        def spend(index):
            try:
                self.store.add_coins(self.uid, -20, 'test', f'поток {index}', f'race:{index}')
                ok.append(index)
            except Exception as exc:  # noqa: BLE001
                failed.append(exc)

        threads = [threading.Thread(target=spend, args=(i,)) for i in range(20)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(len(ok), 5, f'должно пройти ровно 5 списаний, прошло {len(ok)}')
        self.assertGreaterEqual(self.store.balance(self.uid), 0)
        self.assertEqual(self.store.balance(self.uid), 0)

    def test_balance_ceiling(self):
        with self.assertRaises(self.db.LimitExceeded):
            self.store.add_coins(self.uid, self.db.MAX_BALANCE + 1, 'test', 'too much')

    # ---------------------------------------------------------------- игры
    def test_game_reward_daily_cap_and_receipts(self):
        reward = {'balance': 0, 'repeated': False, 'awarded': 0, 'daily_left': 0}
        for index in range(12):
            reward = self.store.game_reward(self.uid, 'flappy', 5, f'evt:{self.name}:{index}',
                                            'Игра: Flappy', 20)
        self.assertEqual(reward['daily_left'], 0)
        self.assertEqual(reward['awarded'], 0)
        self.assertEqual(self.store.balance(self.uid), self.db.WELCOME_COINS + 20)
        again = self.store.game_reward(self.uid, 'flappy', 5, f'evt:{self.name}:0',
                                       'Игра: Flappy', 20)
        self.assertTrue(again['repeated'])

    # ---------------------------------------------------------------- магазин
    def test_shop_purchase_is_atomic_and_once(self):
        self.store.set_balance(self.uid, 500)
        first = self.store.buy_item(self.uid, 'av:fox')
        self.assertFalse(first['already'])
        self.assertEqual(first['balance'], 400)
        second = self.store.buy_item(self.uid, 'av:fox')
        self.assertTrue(second['already'])
        self.assertEqual(second['balance'], 400)
        self.assertIn('av:fox', self.store.owned_ids(self.uid))

    def test_no_v_packs_in_shop(self):
        import game_catalog
        self.assertEqual(game_catalog.SHOP_PACKS, {}, 'пакеты V должны быть удалены')
        self.assertNotIn('boost', game_catalog.SHOP_KINDS)

    # ---------------------------------------------------------------- казино
    def test_wheel_one_free_and_five_paid(self):
        import casino_logic
        self.store.set_balance(self.uid, 1000)
        free = casino_logic.spin_wheel(self.uid, 10, allow_free=True)
        self.assertTrue(free['free'])
        # бесплатный спин не списывает ставку: меняется только выплата
        self.assertEqual(free['balance'], 1000 + free['payout'])
        for _ in range(5):
            casino_logic.spin_wheel(self.uid, 10, allow_free=False)
        limits = casino_logic.wheel_limits(self.uid)
        self.assertEqual(limits['freeLeft'], 0)
        self.assertEqual(limits['paidLeft'], 0)
        self.assertTrue(limits['blocked'])
        with self.assertRaises(casino_logic.CasinoError) as ctx:
            casino_logic.spin_wheel(self.uid, 10, allow_free=False)
        self.assertEqual(ctx.exception.code, 'WHEEL_LIMIT')
        self.assertGreater(ctx.exception.extra.get('resetAt', 0), self.db.now())
        history = self.store.casino_history(self.uid)
        self.assertEqual(len(history), 6)
        stats = self.store.casino_stats(self.uid)
        self.assertEqual(stats['bets'], 6)

    def test_casino_bet_idempotent_reference(self):
        self.store.set_balance(self.uid, 500)
        first = self.store.casino_bet(self.uid, 'slots', 10, 'no win', 'ref:bet:1', 0)
        second = self.store.casino_bet(self.uid, 'slots', 10, 'no win', 'ref:bet:1', 0)
        self.assertFalse(first['repeated'])
        self.assertTrue(second['repeated'])
        self.assertEqual(self.store.balance(self.uid), 490)

    # ---------------------------------------------------------------- сессии
    def test_session_lifecycle(self):
        token = self.store.new_session(self.uid, ip='127.0.0.1', agent='unittest')
        self.assertEqual(self.store.user_for_token(token)['id'], self.uid)
        self.store.delete_session(token)
        self.assertIsNone(self.store.user_for_token(token))

    def test_banned_user_cannot_login(self):
        self.store.ban_user(self.uid, True, 'тест')
        with self.assertRaises(self.db.AccountBanned):
            self.store.authenticate(self.name, 'password123')


def tearDownModule():
    try:
        import db
        db.reset_store()
    except Exception:  # noqa: BLE001
        pass
    _drop_schema()


if __name__ == '__main__':
    unittest.main(verbosity=2)
