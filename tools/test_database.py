#!/usr/bin/env python3
"""Тесты слоя хранения данных (database.py).

Запуск:  python3 -m unittest discover -s tools -p test_database.py
База создаётся во временной папке, рабочая data/accounts.sqlite3 не затрагивается.
"""
import os, sqlite3, tempfile, unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import database as store


class StoreTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / 'test.sqlite3'
        self.c = store.connect(self.path)
        store.init_db(self.c)

    def tearDown(self):
        self.c.close()
        self.tmp.cleanup()

    def test_create_and_find(self):
        user = store.create_user('NeonPro', 'Neon@Example.com', 'secret123', coins=100, conn=self.c)
        self.assertEqual(user['coins'], 100)
        self.assertEqual(store.find_user('neonpro', conn=self.c)['id'], user['id'])
        self.assertEqual(store.find_user('neon@example.com', conn=self.c)['id'], user['id'])
        self.assertIsNone(store.find_user('ghost', conn=self.c))

    def test_duplicates_rejected(self):
        store.create_user('A', 'a@example.com', 'secret123', conn=self.c)
        with self.assertRaises(store.DuplicateUser):
            store.create_user('a', 'other@example.com', 'secret123', conn=self.c)
        with self.assertRaises(store.DuplicateUser):
            store.create_user('other', 'A@example.com', 'secret123', conn=self.c)

    def test_password_roundtrip(self):
        stored = store.hash_password('secret123')
        self.assertTrue(store.verify_password('secret123', stored))
        self.assertFalse(store.verify_password('wrong', stored))
        self.assertFalse(store.verify_password('secret123', 'garbage'))
        self.assertFalse(store.verify_password('secret123', '!google-only'))

    def test_authenticate(self):
        store.create_user('Ace', 'ace@example.com', 'secret123', conn=self.c)
        self.assertEqual(store.authenticate('ACE', 'secret123', conn=self.c)['username'], 'Ace')
        with self.assertRaises(store.InvalidCredentials) as ctx:
            store.authenticate('ace', 'nope', conn=self.c)
        self.assertEqual(ctx.exception.code, 'WRONG_PASSWORD')
        with self.assertRaises(store.InvalidCredentials) as ctx:
            store.authenticate('ghost', 'nope', conn=self.c)
        self.assertEqual(ctx.exception.code, 'ACCOUNT_NOT_FOUND')

    def test_balance_never_negative_and_logged(self):
        user = store.create_user('A', 'a@example.com', 'secret123', coins=50, conn=self.c)
        self.assertEqual(store.add_coins(user['id'], 100, 'win', conn=self.c), 150)
        self.assertEqual(store.add_coins(user['id'], -999, 'bet', conn=self.c), 0)
        self.assertEqual(store.get_balance(user['id'], conn=self.c), 0)
        rows = store.ledger(user['id'], conn=self.c)
        self.assertEqual([r['delta'] for r in rows][:3], [-999, 100, 50])

    def test_set_balance(self):
        user = store.create_user('A', 'a@example.com', 'secret123', conn=self.c)
        self.assertEqual(store.set_balance(user['id'], 300, conn=self.c), 300)
        self.assertEqual(store.set_balance(user['id'], -5, conn=self.c), 0)

    def test_sessions(self):
        user = store.create_user('A', 'a@example.com', 'secret123', conn=self.c)
        token = store.new_session(user['id'], conn=self.c)
        self.c.commit()
        self.assertEqual(store.user_for_token(token, conn=self.c)['username'], 'A')
        self.assertIsNone(store.user_for_token('bogus', conn=self.c))
        store.delete_session(token, conn=self.c)
        self.c.commit()
        self.assertIsNone(store.user_for_token(token, conn=self.c))

    def test_leaderboard(self):
        store.create_user('Low', 'low@example.com', 'secret123', coins=10, conn=self.c)
        store.create_user('High', 'high@example.com', 'secret123', coins=900, conn=self.c)
        top = store.top_users(5, conn=self.c)
        self.assertEqual([u['username'] for u in top], ['High', 'Low'])
        self.assertEqual(top[0]['balance'], 900)

    def test_rate_limit(self):
        allowed = [store.rate_limit('k', 2, 60, conn=self.c) for _ in range(3)]
        self.assertEqual(allowed, [True, True, False])

    def test_migrates_legacy_schema(self):
        """Старая база без колонки coins должна домигрировать без потери аккаунтов."""
        legacy = Path(self.tmp.name) / 'legacy.sqlite3'
        raw = sqlite3.connect(legacy)
        raw.executescript('''
        CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT NOT NULL,username_key TEXT NOT NULL UNIQUE,
          email TEXT NOT NULL,email_key TEXT NOT NULL UNIQUE,password TEXT NOT NULL,created INTEGER NOT NULL,verified INTEGER NOT NULL);
        CREATE TABLE pending(id TEXT PRIMARY KEY,username TEXT NOT NULL,username_key TEXT NOT NULL,email TEXT NOT NULL,
          email_key TEXT NOT NULL,password TEXT NOT NULL,code_hash TEXT NOT NULL,expires INTEGER NOT NULL,sent INTEGER NOT NULL);
        CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL,expires INTEGER NOT NULL);
        CREATE TABLE limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,until INTEGER NOT NULL);
        ''')
        raw.execute('INSERT INTO users VALUES(1,?,?,?,?,?,1,1)',
                    ('Old', 'old', 'old@example.com', 'old@example.com', store.hash_password('oldpass1')))
        raw.commit()
        raw.close()
        c = store.connect(legacy)
        store.init_db(c)
        user = store.find_user('old', conn=c)
        self.assertEqual(user['coins'], 0)
        self.assertEqual(store.authenticate('old', 'oldpass1', conn=c)['username'], 'Old')
        self.assertEqual(store.add_coins(user['id'], 500, conn=c), 500)
        c.close()


if __name__ == '__main__':
    unittest.main()
