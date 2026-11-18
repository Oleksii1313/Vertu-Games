"""Тесты колеса «Рулетки Vert»: конфигурация, таблица выплат, RTP и геометрия.

Колесо — это 20 одинаковых секторов по 18°, только четыре множителя:

    x0 — 7 секторов (35 %) · x1 — 10 секторов (50 %)
    x2 — 2 сектора (10 %)  · x5 — 1 сектор (5 %)

Сумма вероятностей — ровно 100 %, теоретический RTP — 95 %
(0.35·0 + 0.50·1 + 0.10·2 + 0.05·5 = 0.95).

Множитель — это **полная** выплата от ставки, а не чистая прибыль:
``payout = stake × multiplier``, ставка списывается отдельно, поэтому
при x1 игрок получает ставку назад (баланс не меняется), при x0 — теряет её.

Что здесь проверяется:

* таблица «4 множителя × 6 ставок» = 24 комбинации, каждая — реальным спином
  с подменённым RNG (и по выплате, и по фактическому балансу);
* приёмочные примеры из ТЗ: из 100 V ставка 20 V даёт 80/100/120/180,
  а ставка 100 V при балансе 50 V отклоняется;
* вероятности по секторам, их сумма и RTP;
* отсутствие старых множителей (x0.25, x0.5, x3, x4, x10) и дробных значений;
* геометрия: 20 равных секторов, колесо останавливается ровно на оплаченном
  секторе (плюс ``tools/test_wheel_math.js`` на настоящем JS);
* вёрстка страницы, карточка в каталоге и отсутствие дублей.

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
        os.environ['VERT_DB'] = '/tmp/wheel-test-%d.sqlite3' % os.getpid()
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
REQUIRED_CHANCES = {0: 0.35, 1: 0.50, 2: 0.10, 5: 0.05}
# Сколько секторов приходится на каждый множитель (всего 20 по 18°).
REQUIRED_SECTORS = {0: 7, 1: 10, 2: 2, 5: 1}
# Старые множители, которых не должно остаться ни в конфиге, ни в интерфейсе.
RETIRED = ('x0.25', 'x0.5', 'x3', 'x4', 'x10')

# Полная таблица выплат: payout = stake × multiplier.
PAYOUT_TABLE = {
    5: {0: 0, 1: 5, 2: 10, 5: 25},
    10: {0: 0, 1: 10, 2: 20, 5: 50},
    20: {0: 0, 1: 20, 2: 40, 5: 100},
    25: {0: 0, 1: 25, 2: 50, 5: 125},
    50: {0: 0, 1: 50, 2: 100, 5: 250},
    100: {0: 0, 1: 100, 2: 200, 5: 500},
}


class WheelConfig(unittest.TestCase):
    """Конфигурация колеса: множители, секторы, вероятности и RTP."""

    def test_only_allowed_multipliers(self):
        self.assertEqual(sorted(set(WHEEL_SEGMENTS)), [0, 1, 2, 5])
        for multiplier in WHEEL_SEGMENTS:
            self.assertIsInstance(multiplier, int, f'{multiplier} не целое')
        for legacy in (0.5, 0.25, 3, 4, 10):
            self.assertNotIn(legacy, WHEEL_SEGMENTS, f'множитель x{legacy} запрещён')

    def test_twenty_equal_sectors_of_eighteen_degrees(self):
        self.assertEqual(len(WHEEL_SEGMENTS), 20)
        self.assertEqual(len(WHEEL_WEIGHTS), 20)
        self.assertEqual(len(set(WHEEL_WEIGHTS)), 1, 'все секторы одного размера')
        self.assertEqual(game_catalog.WHEEL_SECTORS, 20)
        self.assertEqual(game_catalog.WHEEL_SECTOR_DEGREES, 18)
        self.assertEqual(game_catalog.WHEEL_SECTORS * game_catalog.WHEEL_SECTOR_DEGREES, 360)

    def test_sector_counts_per_multiplier(self):
        counts = {multiplier: WHEEL_SEGMENTS.count(multiplier) for multiplier in REQUIRED_SECTORS}
        self.assertEqual(counts, REQUIRED_SECTORS)
        self.assertEqual(sum(counts.values()), 20, 'все 20 секторов распределены')

    def test_neighbours_never_repeat(self):
        """Соседние секторы разные (включая стык 19 → 0), иначе они сливаются."""
        total = len(WHEEL_SEGMENTS)
        for index in range(total):
            neighbour = WHEEL_SEGMENTS[(index + 1) % total]
            self.assertNotEqual(WHEEL_SEGMENTS[index], neighbour,
                                f'секторы {index} и {(index + 1) % total} совпадают')

    def test_probabilities_are_exactly_as_required(self):
        rows = {row['multiplier']: row for row in game_catalog.wheel_probabilities()}
        self.assertEqual(set(rows), set(REQUIRED_CHANCES))
        for multiplier, chance in REQUIRED_CHANCES.items():
            self.assertAlmostEqual(rows[multiplier]['chance'], chance, places=12,
                                   msg=f'вероятность x{multiplier}')
            self.assertEqual(rows[multiplier]['sectors'], REQUIRED_SECTORS[multiplier])
        self.assertAlmostEqual(sum(rows[m]['chance'] for m in rows), 1.0, places=12,
                               msg='сумма вероятностей должна быть ровно 100 %')

    def test_theoretical_rtp_is_95_percent(self):
        rtp = sum(chance * multiplier for multiplier, chance in REQUIRED_CHANCES.items())
        self.assertAlmostEqual(rtp, 0.95, places=12)
        self.assertAlmostEqual(game_catalog.wheel_rtp(), 0.95, places=6)
        self.assertEqual(game_catalog.CASINO_CARD['rtp'], 95)

    def test_rules_api_publishes_new_wheel(self):
        rules = game_catalog.casino_rules()
        payload = rules['wheel']
        self.assertEqual(payload['segments'], WHEEL_SEGMENTS)
        self.assertEqual(payload['weights'], WHEEL_WEIGHTS)
        self.assertEqual(payload['sectors'], 20)
        self.assertEqual(payload['sectorDegrees'], 18)
        self.assertAlmostEqual(payload['rtp'], 0.95, places=6)
        self.assertEqual(sorted(item['multiplier'] for item in payload['probabilities']),
                         [0, 1, 2, 5])
        self.assertEqual(rules['stakes'], [5, 10, 20, 25, 50, 100])


class PayoffFormula(unittest.TestCase):
    """payout = stake × multiplier — без скрытых коэффициентов и округлений."""

    def test_helper_matches_formula_for_all_stakes(self):
        for stake in CASINO_STAKES:
            for multiplier in sorted(set(WHEEL_SEGMENTS)):
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
            for multiplier in sorted(set(WHEEL_SEGMENTS)):
                value = casino_logic.wheel_payout(stake, multiplier)
                self.assertIsInstance(value, int)
                self.assertGreaterEqual(value, 0)


class WheelPayoutMath(unittest.TestCase):
    """Реальные спины: выплата, баланс и журнал для каждого сектора и ставки."""

    def setUp(self):
        self.st = store.get_store()
        # Дневной лимит колеса — 5 платных вращений, поэтому каждому спину
        # достаётся свой игрок: проверяем математику, а не лимит
        # (лимит покрыт в tools/test_economy.py).
        self.uid = self._new_player()

    def _new_player(self, coins: int = 5000) -> int:
        uid = self.st.create_user('Wheel%s' % uuid.uuid4().hex[:8], 'StrongPass123')['id']
        self.st.add_coins(uid, coins, 'test', 'пополнение', 'wheel-topup:%s' % uid)
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

    def test_full_table_of_four_multipliers_and_six_stakes(self):
        """24 комбинации: выплата, credit/charge/net и фактический баланс."""
        for stake in CASINO_STAKES:
            for multiplier in sorted(set(WHEEL_SEGMENTS)):
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

    def test_server_result_matches_segment_multiplier(self):
        """Сектор из ответа — тот же множитель, что в сегменте колеса."""
        for multiplier in sorted(set(WHEEL_SEGMENTS)):
            with self.subTest(multiplier=multiplier):
                result, _, _ = self._spin(multiplier, stake=25)
                self.assertEqual(WHEEL_SEGMENTS[result['segment']], multiplier)
                self.assertEqual(result['payout'], 25 * multiplier)

    def test_acceptance_examples_from_100_coins(self):
        """ТЗ: из 100 V ставка 20 V даёт 80 / 100 / 120 / 180 V."""
        for multiplier, expected in ((0, 80), (1, 100), (2, 120), (5, 180)):
            with self.subTest(multiplier=multiplier):
                uid = self._new_player()
                self.st.set_balance(uid, 100)
                self.uid = uid
                self.assertEqual(self.st.balance(uid), 100)
                result, before, after = self._spin(multiplier, stake=20, fresh=False)
                self.assertEqual(before, 100)
                self.assertEqual(result['payout'], 20 * multiplier)
                self.assertEqual(after, expected, f'x{multiplier}: баланс {after} вместо {expected}')

    def test_stake_above_balance_is_rejected(self):
        """ТЗ: ставка 100 V при балансе 50 V отклоняется, баланс остаётся 50 V."""
        uid = self._new_player()
        self.st.set_balance(uid, 50)
        import unittest.mock as mock
        index = WHEEL_SEGMENTS.index(5)
        with mock.patch.object(casino_logic, '_rng_choice_weighted', return_value=index):
            with self.assertRaises(store.InsufficientFunds):
                casino_logic.spin_wheel(uid, stake=100)
        self.assertEqual(self.st.balance(uid), 50, 'баланс не должен измениться')
        self.assertFalse(self.st.casino_history(uid, limit=5, game='wheel'),
                         'отклонённый спин не попадает в историю')

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

    def test_x5_pays_five_times_the_stake(self):
        for stake in CASINO_STAKES:
            with self.subTest(stake=stake):
                result, _, _ = self._spin(5, stake=stake)
                self.assertEqual(result['payout'], stake * 5)

    def test_api_reports_charge_credit_and_net(self):
        """Списание на старте и зачисление в конце — разные поля, а не одно число."""
        result, _, _ = self._spin(2, stake=20)
        self.assertEqual(result['charge'], 20, 'ставка списывается на старте')
        self.assertEqual(result['credit'], 40, 'в конце зачисляется вся выплата')
        self.assertEqual(result['payout'], 40, 'payout == credit == stake * multiplier')
        self.assertEqual(result['net'], 20, 'чистый выигрыш = выплата - ставка')

    def test_ledger_has_separate_charge_and_credit_rows(self):
        """В журнале списание и зачисление — две строки, а не одна «итоговая»."""
        self.uid = self._new_player()
        result, _, _ = self._spin(2, stake=100, fresh=False)
        ref = result['ref']
        rows = self.st.transactions(limit=10, user_id=self.uid)
        by_ref = {row['reference_id']: row for row in rows if row.get('reference_id')}
        self.assertIn(f'bet:{ref}', by_ref, 'ставка должна быть отдельной проводкой')
        self.assertIn(f'win:{ref}', by_ref, 'выплата должна быть отдельной проводкой')
        self.assertEqual(int(by_ref[f'bet:{ref}']['amount']), -100)
        self.assertEqual(int(by_ref[f'win:{ref}']['amount']), 200)

    def test_history_records_new_labels_only(self):
        self.uid = self._new_player()
        self._spin(5, stake=20, fresh=False)
        rows = self.st.casino_history(self.uid, limit=5, game='wheel')
        self.assertTrue(rows)
        self.assertEqual(rows[0]['outcome'], 'x5')
        self.assertEqual(int(rows[0]['payout']), 100)
        stats = self.st.casino_stats(self.uid)
        self.assertEqual(int(stats['won']), 100)
        self.assertEqual(int(stats['staked']), 20)
        self.assertEqual(int(stats['won']) - int(stats['staked']), 80)

    def test_legacy_outcomes_are_migrated(self):
        """Старые подписи x0.5/x0.25/x3/x4/x10 переименовываются миграцией."""
        self.assertEqual(sorted(self.st.LEGACY_WHEEL_LABELS),
                         ['x0.25', 'x0.5', 'x10', 'x3', 'x4'])
        migrations = dict(self.st.MIGRATIONS)
        self.assertIn('0005_wheel_retired_multipliers', migrations)
        self.assertEqual(migrations['0005_wheel_retired_multipliers'],
                         ('_migrate_wheel_outcomes',))

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
    """20 равных секторов по 18°, колесо встаёт на оплаченный сектор.

    Повторяет `assets/vg/js/wheel-math.js` на Python: доли секторов берутся из
    весов. Инвариант тот же, что проверяет `tools/test_wheel_math.js` на JS.
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

    def test_all_sectors_are_eighteen_degrees(self):
        spans = self._spans()
        widths = [end - start for start, end, _ in spans]
        self.assertEqual(len(widths), 20)
        self.assertAlmostEqual(sum(widths), 2 * math.pi, places=9)
        for index, width in enumerate(widths):
            self.assertAlmostEqual(math.degrees(width), 18.0, places=9,
                                   msg=f'сектор {index}')
        self.assertEqual(len(set(round(width, 9) for width in widths)), 1,
                         'все секторы одинаковые')

    def test_probability_matches_sector_share(self):
        """Вероятность множителя = доля его секторов на колесе."""
        for multiplier, sectors in REQUIRED_SECTORS.items():
            share = WHEEL_SEGMENTS.count(multiplier) / len(WHEEL_SEGMENTS)
            self.assertAlmostEqual(share, REQUIRED_CHANCES[multiplier], places=12)
            self.assertAlmostEqual(share, sectors / 20, places=12)

    def test_every_segment_lands_under_pointer(self):
        for start in (0.0, 0.37, 1.1, 2.9, 4.4, 5.8, math.pi):
            for segment in range(len(WHEEL_SEGMENTS)):
                landed = self._target(start, segment) % (2 * math.pi)
                self.assertEqual(self._segment_at(landed), segment,
                                 f'rotation={start}, segment={segment} ({WHEEL_SEGMENTS[segment]})')

    def test_x5_sector_lands_exactly(self):
        """x5 — единственный сектор с максимальным множителем."""
        index = WHEEL_SEGMENTS.index(5)
        for start in (0.0, 2.2, 3.9, 6.0):
            landed = self._target(start, index) % (2 * math.pi)
            self.assertEqual(self._segment_at(landed), index)


class WheelUiContract(unittest.TestCase):
    """Страница рулетки и карточка каталога собраны из нужных блоков."""

    def setUp(self):
        self.html = (ROOT / 'roulette.html').read_text(encoding='utf-8')
        self.catalog = (ROOT / 'top.html').read_text(encoding='utf-8')

    def test_page_markup(self):
        self.assertIn('<body data-page="roulette"', self.html)
        self.assertIn('id="wheelCanvas"', self.html)
        self.assertIn('class="rl-stage"', self.html)
        self.assertIn('class="rl-pointer"', self.html)
        self.assertIn('class="rl-balance"', self.html)
        self.assertIn('id="rlPayouts"', self.html)
        self.assertIn('id="wheelResult"', self.html)
        self.assertIn('id="wheelStakes"', self.html)
        self.assertIn('id="spinWheel"', self.html)
        self.assertIn('id="wheelLimits"', self.html)
        self.assertIn('id="useFree"', self.html)
        self.assertIn('id="wheelHistory"', self.html)
        for stake in CASINO_STAKES:
            self.assertIn(f'data-stake="{stake}"', self.html, f'нет кнопки ставки {stake} V')

    def test_page_publishes_odds_and_rtp(self):
        self.assertIn('35.0%', self.html)
        self.assertIn('50.0%', self.html)
        self.assertIn('10.0%', self.html)
        self.assertIn('5.0%', self.html)
        self.assertIn('RTP колеса: 95.0%', self.html)
        for legacy in RETIRED:
            self.assertNotIn(legacy, self.html, f'остался множитель {legacy}')

    def test_page_does_not_use_old_layout(self):
        for old in ('class="machine"', 'wheel-stage', 'id="wheelStakes" class="stakes"'):
            self.assertNotIn(old, self.html, f'старая вёрстка: {old}')

    def test_catalog_has_one_roulette_card(self):
        self.assertEqual(self.catalog.count('data-game="roulette"'), 1)
        self.assertIn('href="roulette.html"', self.catalog)
        self.assertIn('Рулетка Vert', self.catalog)
        self.assertIn('Испытай удачу и забери выигрыш до x5', self.catalog)
        self.assertIn('data-cats="Казино|Удача"', self.catalog)
        cards = self.catalog.count('class="game-card')
        self.assertEqual(cards, len(game_catalog.visible_games()) + 1,
                         'ровно одна новая карточка, остальные на месте')

    def test_catalog_keeps_every_other_game(self):
        for game in game_catalog.visible_games():
            self.assertIn(f'data-game="{game["id"]}"', self.catalog,
                          f'{game["id"]} пропала из каталога')
            self.assertIn(game['name'], self.catalog)

    def test_no_duplicate_roulette_page(self):
        pages = [p.name for p in ROOT.glob('*.html') if 'roulette' in p.name.lower()]
        self.assertEqual(pages, ['roulette.html'], f'дубли страницы: {pages}')


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

    def test_no_retired_multipliers_in_pages(self):
        """В интерфейсе не осталось старых секторов и дробных множителей."""
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
