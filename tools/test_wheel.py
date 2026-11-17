"""Тесты колеса «Рулетки Vert»: таблица выплат, вероятности, RTP и геометрия.

Колесо теперь использует только целые множители:

    x0 48% · x1 27% · x2 16% · x3 6% · x4 1% · x5 1.5% · x10 0.5%

Сумма вероятностей — ровно 100 %, теоретический RTP — 93.5 %
(0.48·0 + 0.27·1 + 0.16·2 + 0.06·3 + 0.01·4 + 0.015·5 + 0.005·10 = 0.935).

Множитель — это **полная** выплата от ставки, а не чистая прибыль:
``payout = FLOOR(stake × multiplier)``, при x1 игрок получает ставку назад
(баланс не меняется), при x0 — теряет её полностью.

Что здесь проверяется:

* таблица «7 множителей × 6 ставок» = 42 комбинации, каждая — реальным спином
  с подменённым RNG (и по выплате, и по фактическому балансу);
* вероятности по весам, их сумма и RTP;
* отсутствие дробных множителей и дубликатов;
* геометрия: секторы пропорциональны весам, колесо останавливается ровно на
  оплаченном секторе (плюс ``tools/test_wheel_math.js`` на настоящем JS).

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
import game_catalog  # noqa: E402
from game_catalog import CASINO_STAKES, WHEEL_SEGMENTS, WHEEL_WEIGHTS  # noqa: E402

STAKE = 20

# Требования к колесу: множитель → вероятность (доля единицы).
REQUIRED_CHANCES = {0: 0.48, 1: 0.27, 2: 0.16, 3: 0.06, 4: 0.01, 5: 0.015, 10: 0.005}

# Полная таблица выплат: payout = floor(stake × multiplier).
PAYOUT_TABLE = {
    5: {0: 0, 1: 5, 2: 10, 3: 15, 4: 20, 5: 25, 10: 50},
    10: {0: 0, 1: 10, 2: 20, 3: 30, 4: 40, 5: 50, 10: 100},
    20: {0: 0, 1: 20, 2: 40, 3: 60, 4: 80, 5: 100, 10: 200},
    25: {0: 0, 1: 25, 2: 50, 3: 75, 4: 100, 5: 125, 10: 250},
    50: {0: 0, 1: 50, 2: 100, 3: 150, 4: 200, 5: 250, 10: 500},
    100: {0: 0, 1: 100, 2: 200, 3: 300, 4: 400, 5: 500, 10: 1000},
}


class WheelConfig(unittest.TestCase):
    """Конфигурация колеса: множители, вероятности и RTP."""

    def test_multipliers_are_integers_only(self):
        self.assertEqual(sorted(WHEEL_SEGMENTS), [0, 1, 2, 3, 4, 5, 10])
        for multiplier in WHEEL_SEGMENTS:
            self.assertIsInstance(multiplier, int, f'{multiplier} не целое')
        self.assertNotIn(0.5, WHEEL_SEGMENTS, 'дробные множители удалены')
        self.assertNotIn(0.25, WHEEL_SEGMENTS, 'дробные множители удалены')

    def test_no_duplicate_multipliers(self):
        self.assertEqual(len(set(WHEEL_SEGMENTS)), len(WHEEL_SEGMENTS))

    def test_probabilities_are_exactly_as_required(self):
        rows = {row['multiplier']: row for row in game_catalog.wheel_probabilities()}
        self.assertEqual(set(rows), set(REQUIRED_CHANCES))
        for multiplier, chance in REQUIRED_CHANCES.items():
            self.assertAlmostEqual(rows[multiplier]['chance'], chance, places=12,
                                   msg=f'вероятность x{multiplier}')
        self.assertAlmostEqual(sum(rows[m]['chance'] for m in rows), 1.0, places=12,
                               msg='сумма вероятностей должна быть ровно 100 %')

    def test_weights_sum_to_thousand(self):
        self.assertEqual(sum(WHEEL_WEIGHTS), 1000, WHEEL_WEIGHTS)

    def test_theoretical_rtp_is_93_5_percent(self):
        rtp = sum(chance * multiplier for multiplier, chance in REQUIRED_CHANCES.items())
        self.assertAlmostEqual(rtp, 0.935, places=12)
        self.assertAlmostEqual(game_catalog.wheel_rtp(), 0.935, places=4)

    def test_rules_api_publishes_new_wheel(self):
        rules = game_catalog.casino_rules()
        payload = rules['wheel']
        self.assertEqual(payload['segments'], WHEEL_SEGMENTS)
        self.assertEqual(payload['weights'], WHEEL_WEIGHTS)
        self.assertAlmostEqual(payload['rtp'], 0.935, places=4)
        self.assertEqual(sorted(item['multiplier'] for item in payload['probabilities']),
                         [0, 1, 2, 3, 4, 5, 10])
        self.assertEqual(rules['stakes'], [5, 10, 20, 25, 50, 100])


class PayoffFormula(unittest.TestCase):
    """payout = floor(stake × multiplier) — без скрытых коэффициентов."""

    def test_helper_matches_floor_formula_for_all_stakes(self):
        for stake in CASINO_STAKES:
            for multiplier in WHEEL_SEGMENTS:
                self.assertEqual(casino_logic.wheel_payout(stake, multiplier),
                                 math.floor(stake * multiplier),
                                 f'x{multiplier} при ставке {stake}')

    def test_helper_matches_the_required_table(self):
        for stake, row in PAYOUT_TABLE.items():
            for multiplier, expected in row.items():
                self.assertEqual(casino_logic.wheel_payout(stake, multiplier), expected,
                                 f'ставка {stake}, x{multiplier}')

    def test_payouts_are_integer_coins(self):
        for stake in CASINO_STAKES:
            for multiplier in WHEEL_SEGMENTS:
                value = casino_logic.wheel_payout(stake, multiplier)
                self.assertIsInstance(value, int)
                self.assertGreaterEqual(value, 0)


class WheelPayoutMath(unittest.TestCase):
    """Реальные спины: выплата, баланс и журнал для каждого сектора и ставки."""

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

    def _spin(self, multiplier, stake=STAKE, fresh=True, free=False):
        index = WHEEL_SEGMENTS.index(multiplier)
        import unittest.mock as mock
        if fresh:
            self.uid = self._new_player()
        with mock.patch.object(casino_logic, '_rng_choice_weighted', return_value=index):
            before = self.st.balance(self.uid)
            result = casino_logic.spin_wheel(self.uid, stake=stake, allow_free=free)
            after = self.st.balance(self.uid)
        return result, before, after

    def test_full_table_of_seven_multipliers_and_six_stakes(self):
        """42 комбинации: выплата, credit/charge/net и фактический баланс."""
        for stake in CASINO_STAKES:
            for multiplier in WHEEL_SEGMENTS:
                expected = PAYOUT_TABLE[stake][multiplier]
                with self.subTest(stake=stake, multiplier=multiplier):
                    result, before, after = self._spin(multiplier, stake=stake)
                    self.assertEqual(result['stake'], stake)
                    self.assertEqual(result['multiplier'], multiplier)
                    self.assertEqual(result['payout'], expected,
                                     f'ставка {stake}, x{multiplier}: '
                                     f'{result["payout"]} вместо {expected}')
                    self.assertEqual(result['credit'], expected, 'credit — вся выплата')
                    self.assertEqual(result['charge'], stake, 'charge — вся ставка')
                    self.assertEqual(result['net'], expected - stake)
                    self.assertEqual(after, before - stake + expected,
                                     f'ставка {stake}, x{multiplier}: баланс {before} -> {after}')
                    self.assertEqual(after - before, expected - stake,
                                     'итог по балансу равен выплата − ставка')

    def test_x1_returns_the_stake_for_every_stake(self):
        for stake in CASINO_STAKES:
            with self.subTest(stake=stake):
                result, before, after = self._spin(1, stake=stake)
                self.assertEqual(result['payout'], stake)
                self.assertEqual(after, before, 'x1 возвращает ставку: баланс не меняется')

    def test_x0_takes_the_whole_stake_for_every_stake(self):
        for stake in CASINO_STAKES:
            with self.subTest(stake=stake):
                result, before, after = self._spin(0, stake=stake)
                self.assertEqual(result['payout'], 0)
                self.assertEqual(after, before - stake)

    def test_x10_pays_ten_times_the_stake(self):
        for stake in CASINO_STAKES:
            with self.subTest(stake=stake):
                result, _, _ = self._spin(10, stake=stake)
                self.assertEqual(result['payout'], stake * 10)

    def test_api_reports_charge_credit_and_net(self):
        """Списание на старте и зачисление в конце — разные поля, а не одно число."""
        result, _, _ = self._spin(2, stake=20)
        self.assertEqual(result['charge'], 20, 'ставка списывается на старте')
        self.assertEqual(result['credit'], 40, 'в конце зачисляется вся выплата')
        self.assertEqual(result['payout'], 40, 'payout == credit == bet * multiplier')
        self.assertEqual(result['net'], 20, 'чистый выигрыш = выплата - ставка')

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

    def test_history_records_new_labels_only(self):
        self.uid = self._new_player()
        self._spin(10, stake=20, fresh=False)
        rows = self.st.casino_history(self.uid, limit=5, game='wheel')
        self.assertTrue(rows)
        self.assertEqual(rows[0]['outcome'], 'x10')
        self.assertEqual(int(rows[0]['payout']), 200)
        stats = self.st.casino_stats(self.uid)
        self.assertEqual(int(stats['won']), 200)
        self.assertEqual(int(stats['staked']), 20)
        self.assertEqual(int(stats['won']) - int(stats['staked']), 180)

    def test_slots_charge_and_credit_are_separate(self):
        """Слоты: списание всей ставки на старте, зачисление всей выплаты в конце."""
        import unittest.mock as mock
        self.uid = self._new_player()
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
        self.assertEqual(result['charge'], 0)
        self.assertEqual(after, before + 200, 'бесплатный спин не списывает ставку')


class WheelAnimationGeometry(unittest.TestCase):
    """Секторы пропорциональны вероятностям, колесо встаёт на оплаченный сектор.

    Повторяет `assets/vg/js/wheel-math.js` на Python: доли секторов берутся из
    весов, а не делятся поровну. Инвариант тот же, что проверяет
    `tools/test_wheel_math.js` на настоящем JS.
    """

    pointer = 3 * math.pi / 2

    def _spans(self):
        total = sum(WHEEL_WEIGHTS)
        spans, cursor = [], 0.0
        for weight in WHEEL_WEIGHTS:
            sweep = (weight / total) * 2 * math.pi
            spans.append((cursor, cursor + sweep, cursor + sweep / 2))
            cursor += sweep
        return spans

    def _target(self, rotation: float, segment: int, turns: int = 6) -> float:
        _, _, mid = self._spans()[segment]
        delta = (self.pointer - mid - rotation) % (2 * math.pi)
        return rotation + 2 * math.pi * turns + delta

    def _segment_at(self, rotation: float) -> int:
        inside = (self.pointer - rotation) % (2 * math.pi)
        for index, (start, end, _) in enumerate(self._spans()):
            if start <= inside < end:
                return index
        return len(WHEEL_WEIGHTS) - 1

    def test_sector_sizes_follow_probabilities(self):
        spans = self._spans()
        widths = [end - start for start, end, _ in spans]
        self.assertAlmostEqual(sum(widths), 2 * math.pi, places=9)
        for index, width in enumerate(widths):
            share = width / (2 * math.pi)
            self.assertAlmostEqual(share, REQUIRED_CHANCES[WHEEL_SEGMENTS[index]], places=12,
                                   msg=f'сектор x{WHEEL_SEGMENTS[index]}')
        self.assertEqual(len(set(round(width, 9) for width in widths)), 7,
                         'секторы не должны быть одинаковыми')

    def test_every_segment_lands_under_pointer(self):
        for start in (0.0, 0.37, 1.1, 2.9, 4.4, 5.8, math.pi):
            for segment in range(len(WHEEL_SEGMENTS)):
                landed = self._target(start, segment) % (2 * math.pi)
                self.assertEqual(self._segment_at(landed), segment,
                                 f'rotation={start}, segment={segment} ({WHEEL_SEGMENTS[segment]})')

    def test_narrow_sectors_still_land_exactly(self):
        """x10 — самый узкий (1.8°); попадание должно быть точным."""
        index = WHEEL_SEGMENTS.index(10)
        for start in (0.0, 2.2, 3.9, 6.0):
            landed = self._target(start, index) % (2 * math.pi)
            self.assertEqual(self._segment_at(landed), index)


class WheelFormulaSingleSource(unittest.TestCase):
    """Выплата и геометрия живут в одном месте и оно покрыто тестами.

    * выплата — ``casino_logic.wheel_payout`` (единственная точка умножения);
    * геометрия и отрисовка — ``assets/vg/js/wheel-math.js`` (обе страницы);
    * ``tools/test_wheel_math.js`` гоняет настоящий JS.
    """

    def test_pages_load_the_shared_wheel_math(self):
        for page, script in (('roulette.html', 'roulette.js'), ('casino.html', 'casino.js')):
            html = (ROOT / page).read_text(encoding='utf-8')
            self.assertIn('assets/vg/js/wheel-math.js', html, f'{page} без wheel-math.js')
            self.assertLess(html.index('wheel-math.js'), html.index(script),
                            f'{page}: wheel-math.js должен подключаться раньше {script}')

    def test_client_does_not_duplicate_the_landing_formula(self):
        """Формулы остановки не должно быть в страничных скриптах — только в модуле."""
        for name in ('roulette.js', 'casino.js'):
            source = (ROOT / 'assets' / 'vg' / 'js' / name).read_text(encoding='utf-8')
            self.assertNotIn('Math.PI * 3 / 2', source, f'{name}: скопированная формула указателя')
            self.assertIn('VGWheel.target(', source, f'{name}: должна использоваться VGWheel.target')
            self.assertIn('VGWheel.draw(', source, f'{name}: отрисовка должна быть общей')

    def test_no_fractional_multipliers_in_pages(self):
        """В интерфейсе не осталось старых дробных секторов."""
        for page in ('roulette.html', 'casino.html', 'profile.html'):
            html = (ROOT / page).read_text(encoding='utf-8')
            for legacy in ('x0.25', 'x0.5'):
                self.assertNotIn(legacy, html, f'{page}: остался старый множитель {legacy}')

    def test_node_geometry_suite_passes(self):
        """Настоящий JS-модуль: вероятности, пропорции и попадание в сектор."""
        import shutil
        import subprocess
        node = shutil.which('node')
        if not node:
            self.skipTest('node недоступен')
        result = subprocess.run([node, str(ROOT / 'tools' / 'test_wheel_math.js')],
                                capture_output=True, text=True, timeout=120)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
