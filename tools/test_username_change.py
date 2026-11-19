#!/usr/bin/env python3
"""Смена ника за V-монеты (услуга магазина «Change Username», 1000 V).

Проверяется то, что важно для денег и для аккаунта:

* услуга есть в каталоге магазина и стоит ровно 1000 V, вид — ``service``;
* успешная смена: ник меняется, списывается ровно 1000 V, в журнале одна
  запись, сумма уходит в минус только один раз;
* ник сохраняется после «перезагрузки/повторного входа» — читаем аккаунт из
  хранилища заново и логинимся уже под новым ником;
* нехватка монет — отказ, ни ник, ни баланс не меняются (списания нет);
* занятый ник — отказ без списания;
* смена на текущий ник — отказ без списания;
* пустой/короткий/недопустимый ник — отказ без списания;
* повторный запрос с тем же ником (двойной клик) не списывает второй раз;
* HTTP-эндпоинт ``/api/shop/rename`` отдаёт правильные коды ошибок и обновлённый
  профиль при успехе.

Запуск:

    python -m unittest tools.test_username_change -v
    DATABASE_URL=postgresql://… python -m unittest tools.test_username_change -v
"""
from __future__ import annotations

import os
import sys
import unittest
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def _prepare_database() -> dict:
    env = {}
    url = (os.environ.get('DATABASE_URL') or '').strip()
    if url:
        schema = 'test_rename_' + uuid.uuid4().hex[:10]
        sep = '&' if '?' in url else '?'
        env['DATABASE_URL'] = f'{url}{sep}options=-csearch_path%3D{schema}'
        env['_SCHEMA'] = schema
        env['_BASE_URL'] = url
    else:
        import tempfile
        tmp = tempfile.mkdtemp(prefix='vg-rename-')
        env['VERT_DB'] = str(Path(tmp) / 'test.sqlite3')
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


class UsernameChangeTest(unittest.TestCase):
    counter = 0

    @classmethod
    def setUpClass(cls):
        os.environ.update(ENV)
        import db
        import shop
        cls.db = db
        cls.shop = shop
        cls.store = db.get_store()

    def setUp(self):
        UsernameChangeTest.counter += 1
        self.name = f'Renamer{os.getpid() % 1000}x{UsernameChangeTest.counter}'
        self.user = self.store.create_user(self.name, 'password123')
        self.uid = self.user['id']
        self.store.add_coins(self.uid, 2000, 'test', 'Тестовое начисление')

    # ------------------------------------------------------------------ каталог
    def test_item_in_catalog_costs_1000(self):
        items = {i['id']: i for i in self.store.shop_items()}
        self.assertIn('username_change', items)
        item = items['username_change']
        self.assertEqual(int(item['price']), 1000)
        self.assertEqual(item['kind'], 'service')
        self.assertEqual(item['name_ru'], 'Смена ника')
        self.assertEqual(item['name_en'], 'Change username')
        # Услуга не считается «купленной навсегда» — её можно покупать снова.
        catalog = self.shop.catalog(self.uid)
        entry = next(i for i in catalog['items'] if i['id'] == 'username_change')
        self.assertFalse(entry['owned'])
        self.assertEqual(entry['price'], 1000)

    # ------------------------------------------------------------------- успех
    def test_rename_charges_once_and_saves(self):
        before = self.store.balance(self.uid)
        result = self.store.rename_user(self.uid, 'LegitNewNick', 1000)
        self.assertEqual(result['name'], 'LegitNewNick')
        self.assertEqual(self.store.balance(self.uid), before - 1000)
        fresh = self.store.get_user(self.uid)
        self.assertEqual(fresh['username'], 'LegitNewNick')
        # Ник работает при входе, старый — уже нет.
        self.assertEqual(self.store.authenticate('LegitNewNick', 'password123')['id'], self.uid)
        with self.assertRaises(self.db.InvalidCredentials):
            self.store.authenticate(self.name, 'password123')
        # В журнале ровно одно списание по услуге.
        with self.store.driver.transaction(isolation='read committed') as c:
            rows = c.execute("SELECT amount, transaction_type FROM transactions "
                             "WHERE user_id=? AND transaction_type='shop'", (self.uid,)).fetchall()
        self.assertEqual([int(r['amount']) for r in rows], [-1000])
        self.assertEqual(self.store.balance(self.uid), before - 1000)

    def test_rename_via_shop_layer(self):
        data = self.shop.rename(self.uid, 'ShopLayerNick')
        self.assertTrue(data['ok'])
        self.assertEqual(data['price'], 1000)
        self.assertEqual(data['user']['username'], 'ShopLayerNick')
        self.assertEqual(data['balance'], self.store.balance(self.uid))

    # --------------------------------------------------------------- отказы
    def test_insufficient_funds_changes_nothing(self):
        self.store.add_coins(self.uid, -self.store.balance(self.uid) + 500, 'test', 'оставим 500')
        self.assertEqual(self.store.balance(self.uid), 500)
        with self.assertRaises(self.db.InsufficientFunds):
            self.store.rename_user(self.uid, 'PoorNick', 1000)
        self.assertEqual(self.store.balance(self.uid), 500)
        self.assertEqual(self.store.get_user(self.uid)['username'], self.name)
        self.assertFalse(self.store.username_taken('PoorNick'))

    def test_taken_name_rejected_without_charge(self):
        other = self.store.create_user('TakenNick' + str(os.getpid() % 1000), 'password123')
        before = self.store.balance(self.uid)
        with self.assertRaises(self.db.DuplicateUser):
            self.store.rename_user(self.uid, other['username'], 1000)
        self.assertEqual(self.store.balance(self.uid), before)
        self.assertEqual(self.store.get_user(self.uid)['username'], self.name)

    def test_same_name_rejected_without_charge(self):
        before = self.store.balance(self.uid)
        with self.assertRaises(self.db.SameUsername):
            self.store.rename_user(self.uid, self.name, 1000)
        self.assertEqual(self.store.balance(self.uid), before)

    def test_invalid_names_rejected_without_charge(self):
        before = self.store.balance(self.uid)
        for bad in ['', '   ', 'a', 'ab', 'x' * 40, '<script>', 'ник', 'two  spaces', 'admin',
                    '-dash', 'foo@bar', 'nick!', 'con  sec']:
            with self.assertRaises((self.db.StoreError,), msg=bad):
                self.store.rename_user(self.uid, bad, 1000)
        self.assertEqual(self.store.balance(self.uid), before)
        self.assertEqual(self.store.get_user(self.uid)['username'], self.name)

    def test_double_click_charges_once(self):
        before = self.store.balance(self.uid)
        self.store.rename_user(self.uid, 'DoubleClickNick', 1000)
        # Второй запрос того же окна: текущий ник уже новый — повторный списания нет.
        with self.assertRaises(self.db.SameUsername):
            self.store.rename_user(self.uid, 'DoubleClickNick', 1000)
        self.assertEqual(self.store.balance(self.uid), before - 1000)
        self.assertEqual(self.store.get_user(self.uid)['username'], 'DoubleClickNick')

    # -------------------------------------------------------------- HTTP-слой
    def _endpoint(self, payload, user_id=None):
        import server
        original_user = server.current_user
        original_rate = server.rate
        server.current_user = lambda: self.store.get_user(user_id or self.uid)
        server.rate = lambda *a, **k: True
        try:
            with server.app.test_request_context('/api/shop/rename', json=payload,
                                                 headers={'X-Requested-With': 'XMLHttpRequest'}):
                view = getattr(server.shop_rename, '__wrapped__', server.shop_rename)
                response = view()
                if isinstance(response, tuple):
                    return response[1], response[0].get_json()
                return response.status_code, response.get_json()
        finally:
            server.current_user = original_user
            server.rate = original_rate

    def test_endpoint_success_returns_user(self):
        status, body = self._endpoint({'name': 'HttpNickName'})
        self.assertEqual(status, 200)
        self.assertTrue(body['ok'])
        self.assertEqual(body['user']['username'], 'HttpNickName')
        self.assertEqual(body['balance'], self.store.balance(self.uid))

    def test_endpoint_error_codes(self):
        status, body = self._endpoint({'name': ''})
        self.assertEqual((status, body['code']), (400, 'BAD_NAME'))
        status, body = self._endpoint({'name': self.name})
        self.assertEqual((status, body['code']), (400, 'SAME_NAME'))
        other = self.store.create_user('Busy' + str(os.getpid() % 1000) + 'x', 'password123')
        status, body = self._endpoint({'name': other['username']})
        self.assertEqual((status, body['code']), (409, 'NAME_TAKEN'))
        # Опустошаем кошелёк и проверяем отказ по балансу.
        self.store.add_coins(self.uid, -self.store.balance(self.uid), 'test', 'в ноль')
        status, body = self._endpoint({'name': 'NoMoneyNick'})
        self.assertEqual((status, body['code']), (402, 'NO_FUNDS'))
        self.assertEqual(self.store.get_user(self.uid)['username'], self.name)

    @classmethod
    def tearDownClass(cls):
        _drop_schema()


if __name__ == '__main__':
    unittest.main(verbosity=2)
