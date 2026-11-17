"""Тесты «Рулетки Vert»: математика выплат и совпадение с тем, что видит игрок.

Зачем отдельный модуль. Выплата (`payout = stake * multiplier`) и анимация
остановки колеса живут в разных местах — в `casino_logic.py` и в JS. Если они
разъезжаются, игрок видит сектор ×0.25, а деньги приходят за ×3 (или наоборот),
и это выглядит как «сломанная математика». Поэтому здесь проверяются оба слоя
и их согласованность:

* `payout` строго равен `stake * multiplier` для каждого сектора;
* фраза «ставка списывается до вращения» означает, что чистое изменение
  баланса равно `payout - stake` (x1 → 0, x3 при ставке 100 → +200);
* остановка колеса: угол `target` из JS ставит под указатель именно тот сектор,
  который вернул сервер (формула повторена здесь на Python — она же в
  `assets/vg/js/roulette.js` и `casino.js`).

Запуск: ``python -m unittest tools.test_wheel``.
"""
from __future__ import annotations

import math
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
        os.environ['VERTU_DB'] = '/tmp/wheel-test-%d.sqlite3' % os.getpid()
        return {}
    schema = 'test_wheel_' + uuid.uuid4().hex[:10]
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


import casino_logic  # noqa: E402
import db as store  # noqa: E402
from game_catalog import WHEEL_SEGMENTS  # noqa: E402

STAKE = 20


class WheelPayoutMath(unittest.TestCase):
    """Выплата = ставка × множитель, в любом секторе."""

    def setUp(self):
        self.st = store.get_store()
        # Дневной лимит колеса — 5 платных вращений, поэтому каждому спину в
        # тестах достаётся свой игрок: проверяем математику, а не лимит
        # (лимит покрыт в tools/test_economy.py).
        self.uid = self._new_player()

    def _new_player(self) -> int:
        uid = self.st.create_user('Wheel%s' % uuid.uuid4().hex[:8], 'StrongPass123')['id']
        self.st.add_coins(uid, 5000, 'test', 'пополнение', 'wheel-topup:%s' % uid)
        return uid

    def _spin(self, multiplier, stake=STAKE, fresh=True):
        index = WHEEL_SEGMENTS.index(multiplier)
        import unittest.mock as mock
        if fresh:
            self.uid = self._new_player()
        with mock.patch.object(casino_logic, '_rng_choice_weighted', return_value=index):
            before = self.st.balance(self.uid)
            result = casino_logic.spin_wheel(self.uid, stake=stake)
            after = self.st.balance(self.uid)
        return result, before, after

    def test_every_segment_pays_stake_times_multiplier(self):
        for multiplier in WHEEL_SEGMENTS:
            result, before, after = self._spin(multiplier)
            expected = int(round(STAKE * multiplier))
            self.assertEqual(result['multiplier'], multiplier)
            self.assertEqual(result['stake'], STAKE)
            self.assertEqual(result['payout'], expected,
                             f'x{multiplier}: payout={result["payout"]}, ждали {expected}')
            # Ставка списана до вращения, выигрыш начислен — итог = payout - stake.
            self.assertEqual(after, before - STAKE + expected,
                             f'x{multiplier}: баланс {before} -> {after}')

    def test_api_reports_charge_credit_and_net(self):
        """Списание на старте и зачисление в конце — разные поля, а не одно число."""
        result, before, after = self._spin(2, stake=20)
        self.assertEqual(result['charge'], 20, 'ставка списывается на старте')
        self.assertEqual(result['credit'], 40, 'в конце зачисляется вся выплата')
        self.assertEqual(result['payout'], 40, 'payout == credit == bet * multiplier')
        self.assertEqual(result['net'], 20, 'чистый выигрыш = выплата - ставка')
        self.assertEqual(after - before, result['net'])

    def test_x2_half_is_return_and_half_is_win(self):
        """×2: половина выплаты — возврат ставки, половина — чистый выигрыш."""
        result, before, after = self._spin(2, stake=100)
        self.assertEqual(result['payout'], 200)
        self.assertEqual(result['net'], 100)          # 200 = 100 возврат + 100 выигрыш
        self.assertEqual(after, before + 100)

    def test_ledger_has_separate_charge_and_credit_rows(self):
        """В журнале списание и зачисление — две строки, а не одна «итоговая»."""
        self.uid = self._new_player()
        result, _, _ = self._spin(3, stake=100, fresh=False)
        ref = result['ref']
        rows = self.st.transactions(limit=10, user_id=self.uid)
        by_ref = {row['reference_id']: row for row in rows if row.get('reference_id')}
        self.assertIn(f'bet:{ref}', by_ref, 'ставка должна быть отдельной проводкой')
        self.assertIn(f'win:{ref}', by_ref, 'выплата должна быть отдельной проводкой')
        self.assertEqual(int(by_ref[f'bet:{ref}']['amount']), -100)
        self.assertEqual(int(by_ref[f'win:{ref}']['amount']), 300)

    def test_x1_returns_the_stake(self):
        result, before, after = self._spin(1)
        self.assertEqual(result['payout'], STAKE)
        self.assertEqual(after, before, 'x1 должен вернуть ставку целиком, баланс не меняется')

    def test_x3_pays_triple_not_a_tenth(self):
        result, before, after = self._spin(3, stake=100)
        self.assertEqual(result['payout'], 300)
        self.assertNotEqual(result['payout'], 30)
        self.assertEqual(after, before - 100 + 300)

    def test_x0_takes_only_the_stake(self):
        result, before, after = self._spin(0)
        self.assertEqual(result['payout'], 0)
        self.assertEqual(after, before - STAKE)

    def test_history_and_stats_match_payout(self):
        self.uid = self._new_player()
        result, _, _ = self._spin(3, stake=100, fresh=False)
        rows = self.st.casino_history(self.uid, limit=5, game='wheel')
        self.assertTrue(rows)
        self.assertEqual(int(rows[0]['stake']), 100)
        self.assertEqual(int(rows[0]['payout']), 300)
        self.assertEqual(rows[0]['outcome'], 'x3')
        stats = self.st.casino_stats(self.uid)
        self.assertEqual(int(stats['won']), 300)
        self.assertEqual(int(stats['staked']), 100)
        # «Итог» на странице = won - staked = +200, а не +300 и не -70.
        self.assertEqual(int(stats['won']) - int(stats['staked']), 200)

    def test_slots_charge_and_credit_are_separate(self):
        """Слоты: списание всей ставки на старте, зачисление всей выплаты в конце."""
        import unittest.mock as mock
        self.uid = self._new_player()
        # «три в ряд» символа V: m3 = 12 → выплата 12× ставки
        triple = ('v', 'v', 'v')
        before = self.st.balance(self.uid)
        with mock.patch.object(casino_logic, '_rng_choice_weighted', side_effect=[0, 0, 0]):
            result = casino_logic.spin_slots(self.uid, 20)
        after = self.st.balance(self.uid)
        self.assertEqual(tuple(result['reels']), triple)
        self.assertEqual(result['charge'], 20)
        self.assertEqual(result['credit'], result['payout'])
        self.assertEqual(result['payout'], 20 * result['symbols'][0]['m3'])
        self.assertEqual(result['net'], result['payout'] - 20)
        self.assertEqual(after, before - 20 + result['payout'])

    def test_free_spin_does_not_charge_but_pays(self):
        import unittest.mock as mock
        self.uid = self._new_player()
        index = WHEEL_SEGMENTS.index(2)
        with mock.patch.object(casino_logic, '_rng_choice_weighted', return_value=index):
            before = self.st.balance(self.uid)
            result = casino_logic.spin_wheel(self.uid, stake=100, allow_free=True)
            after = self.st.balance(self.uid)
        self.assertTrue(result['free'])
        self.assertEqual(result['payout'], 200)
        self.assertEqual(after, before + 200, 'бесплатный спин не списывает ставку')


class WheelAnimationGeometry(unittest.TestCase):
    """Остановка колеса обязана совпадать с сектором, за который заплатили.

    Формула ровно та же, что в `assets/vg/js/roulette.js` и `casino.js`:

        pointer  = 3π/2                 (указатель сверху)
        desired  = pointer - (i*arc + arc/2)
        delta    = (desired - rotation) mod 2π
        target   = rotation + 6*2π + delta

    Проверяем, что после `target` под указателем оказывается сектор `i` при
    любом начальном повороте — иначе игрок видит «×0.25», а получает за «×3».
    """

    arc = 2 * math.pi / len(WHEEL_SEGMENTS)
    pointer = 3 * math.pi / 2

    def _landing_index(self, data_segment: int, rotation: float) -> int:
        desired = self.pointer - (data_segment * self.arc + self.arc / 2)
        delta = (desired - rotation) % (2 * math.pi)
        target = rotation + 2 * math.pi * 6 + delta
        final = target % (2 * math.pi)
        return int(((self.pointer - final) % (2 * math.pi)) // self.arc)

    def test_every_segment_lands_under_pointer(self):
        for start in (0.0, 0.7, 1.9, 3.3, 5.6, math.pi):
            for segment in range(len(WHEEL_SEGMENTS)):
                self.assertEqual(self._landing_index(segment, start), segment,
                                 f'rotation={start}, segment={segment}')

    def test_x3_wheel_stops_on_x3(self):
        index = WHEEL_SEGMENTS.index(3)
        for start in (0.0, 1.2, 4.4, 6.1):
            self.assertEqual(self._landing_index(index, start), index)
