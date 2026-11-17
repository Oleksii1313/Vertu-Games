"""Сквозной тест колеса через HTTP: выплата = ставка × множитель.

Зачем отдельно от `tools/test_wheel.py`. Юнит-тесты дергают `spin_wheel`
напрямую, а игрок ходит в `/api/casino/wheel`: там ещё сериализация ответа,
достижения, лимиты и начисление награды за задание. Достаточно одного места,
где выплату поделят (или подставят чужой множитель), и игрок увидит «×2 → 5
монет» при ставке 20 — то есть 20 × 0.25 вместо 20 × 2.

Тест поднимает настоящее приложение Flask с тестовым клиентом и принудительно
выставляет результат колеса, чтобы проверить **каждый** сектор:

* `payout == stake * multiplier` (ни деления на 4, ни подмены коэффициента);
* `credit == payout`, `charge == stake`, `net == payout - stake`;
* баланс после запроса равен `было - ставка + выплата` (учитывая бонусы за
  достижения, они вычитаются из ожидания);
* `segment` однозначно определяет `multiplier` — показ и оплата из одного поля.

Запуск: ``python -m unittest tools.test_wheel_api``.
"""
from __future__ import annotations

import os
import sys
import unittest
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _prepare_database() -> dict:
    url = (os.environ.get('DATABASE_URL') or '').strip()
    if not url:
        os.environ['VERTU_DB'] = '/tmp/wheel-api-%d.sqlite3' % os.getpid()
        return {}
    schema = 'test_wheel_api_' + uuid.uuid4().hex[:10]
    sep = '&' if '?' in url else '?'
    os.environ['DATABASE_URL'] = f'{url}{sep}options=-csearch_path%3D{schema}'
    import psycopg
    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute(f'CREATE SCHEMA IF NOT EXISTS "{schema}"')
    return {'schema': schema, 'base': url}


DB = _prepare_database()


def tearDownModule():
    schema = DB.get('schema')
    if not schema:
        return
    import psycopg
    with psycopg.connect(DB['base'], autocommit=True) as conn:
        conn.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')


import math  # noqa: E402

import casino_logic  # noqa: E402
import server  # noqa: E402
from game_catalog import CASINO_STAKES, WHEEL_SEGMENTS  # noqa: E402

START_COINS = 150  # приветственный бонус


class WheelApiFormula(unittest.TestCase):
    """/api/casino/wheel: выплата строго ставка × множитель."""

    def setUp(self):
        server.app.config.update(TESTING=True)
        # Дневной лимит — 5 платных вращений, поэтому каждый спин проверяем на
        # своём игроке: тест про математику выплат, а не про лимит.
        self._new_player()

    def _new_player(self):
        self.client = server.app.test_client()
        self.username = 'ApiWheel' + uuid.uuid4().hex[:8]
        # Первый POST без куки разрешён (защита — Turnstile и rate-limit),
        # дальше берём CSRF-токен из /api/session и шлём его заголовком.
        reg = self.client.post('/api/auth/register', json={
            'username': self.username, 'password': 'StrongPass123'})
        self.assertEqual(reg.status_code, 201, reg.get_data(as_text=True))
        self.csrf = self.client.get('/api/session').get_json()['csrf']
        self.headers = {'X-CSRF-Token': self.csrf}

    @staticmethod
    def _bonus(data: dict) -> int:
        """Монеты за достижения, которые сервер начислил вместе со спином."""
        total = 0
        for entry in (data.get('achievements') or []):
            ach = entry.get('achievement') or {}
            total += int(ach.get('coins') or 0)
        return total

    def _balance(self) -> int:
        return self.client.get('/api/balance').get_json()['coins']

    def _spin(self, segment: int, stake: int):
        """Спин с принудительным сектором (RNG подменяем только в тесте)."""
        original = casino_logic._rng_choice_weighted
        casino_logic._rng_choice_weighted = lambda seq, weights: segment
        try:
            return self.client.post('/api/casino/wheel', json={'stake': stake},
                                    headers=self.headers)
        finally:
            casino_logic._rng_choice_weighted = original

    def test_every_segment_pays_stake_times_multiplier(self):
        for index, multiplier in enumerate(WHEEL_SEGMENTS):
            for stake in CASINO_STAKES:
                with self.subTest(segment=multiplier, stake=stake):
                    self._new_player()
                    before = self._balance()
                    response = self._spin(index, stake)
                    self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
                    data = response.get_json()
                    expected = math.floor(stake * multiplier)

                    self.assertEqual(data['segment'], index)
                    self.assertEqual(data['multiplier'], multiplier,
                                     'множитель должен совпадать с сектором под указателем')
                    self.assertEqual(data['stake'], stake)
                    self.assertEqual(data['payout'], expected,
                                     f'x{multiplier} при ставке {stake}: '
                                     f'выплата {data["payout"]}, ждали {expected}')
                    self.assertEqual(data['credit'], expected, 'credit — вся выплата')
                    self.assertEqual(data['charge'], stake, 'charge — вся ставка')
                    self.assertEqual(data['net'], expected - stake)

                    after = self._balance()
                    bonus = self._bonus(data)
                    self.assertEqual(after, before - stake + expected + bonus,
                                     f'баланс {before} -> {after}, ждали '
                                     f'{before - stake + expected}+бонусы {bonus}')

    def test_x2_with_stake_20_credits_forty_not_five(self):
        """x2 при ставке 20 — это ровно 40 V."""
        index = WHEEL_SEGMENTS.index(2)
        before = self._balance()
        data = self._spin(index, 20).get_json()
        self.assertEqual(data['payout'], 40)
        self.assertNotIn(data['payout'], (5, 10), 'выплата не должна считаться от половины/четверти')
        bonus = self._bonus(data)
        self.assertEqual(self._balance(), before - 20 + 40 + bonus)

    def test_x1_returns_the_whole_stake(self):
        index = WHEEL_SEGMENTS.index(1)
        before = self._balance()
        data = self._spin(index, 20).get_json()
        self.assertEqual(data['payout'], 20)
        bonus = self._bonus(data)
        self.assertEqual(self._balance(), before + bonus, 'баланс не меняется: ставка вернулась')

    def test_stake_is_charged_before_spin_and_rejected_when_short(self):
        """Если денег меньше ставки — спина нет, баланс не двигается."""
        store = casino_logic.store.get_store()
        user = store.find_user(self.username)
        rest = self._balance()
        store.add_coins(user['id'], -(rest - 4), 'test', 'списать остаток',
                        'drain:%s' % uuid.uuid4().hex[:8])
        before = self._balance()
        response = self._spin(WHEEL_SEGMENTS.index(2), 20)
        self.assertGreaterEqual(response.status_code, 400)
        self.assertIn(response.get_json().get('code'),
                      ('NO_FUNDS', 'STAKE_RANGE', 'LIMIT', 'WHEEL_LIMIT'))
        self.assertEqual(self._balance(), before, 'неудачный спин не двигает баланс')


if __name__ == '__main__':
    unittest.main()
