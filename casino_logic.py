#!/usr/bin/env python3
"""Казино Vert Games — вся игровая логика на сервере.

Клиент присылает только: игру, ставку и (для анимации) желаемый результат он не
присылает вообще. Сервер сам:

1. проверяет лимиты (ставка, дневной лимит, самоисключение, доступность игры);
2. криптографически выбирает результат (``secrets``);
3. считает выплату по опубликованным коэффициентам;
4. списывает ставку и начисляет выигрыш в одной транзакции БД.

Только виртуальные V-монеты: никаких реальных денег, покупок монет «на вывод» или
конвертации выигрыша в деньги.
"""
from __future__ import annotations

import hashlib
import math
import secrets

import db as store
from game_catalog import (CASINO_STAKES, SLOT_SYMBOLS, SLOT_TWO_PAY, WHEEL_SEGMENTS,
                          WHEEL_WEIGHTS, casino_rules)

FREE_SPIN_KIND = 'wheel'
FREE_SPIN_RECORD = 'wheel_free'
FREE_SPIN_GAME = 'daily'
# Суточные лимиты колеса: одно бесплатное вращение и не больше пяти платных.
WHEEL_FREE_PER_DAY = 1
WHEEL_PAID_PER_DAY = 5


class CasinoError(Exception):
    def __init__(self, code: str, message: str, status: int = 400, extra: dict | None = None):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status
        self.extra = extra or {}


def wheel_limits(user_id: int) -> dict:
    """Публичное состояние суточных лимитов колеса (для UI и таймера)."""
    data = store.get_store()
    state = data.casino_wheel_limits(user_id, WHEEL_FREE_PER_DAY, WHEEL_PAID_PER_DAY)
    return {
        'freeLeft': state['free_left'], 'freeLimit': state['free_limit'],
        'paidLeft': state['paid_left'], 'paidLimit': state['paid_limit'],
        'resetAt': state['reset_at'], 'serverNow': state['server_now'],
        'blocked': state['paid_left'] <= 0 and state['free_left'] <= 0,
    }


def wheel_payout(stake: int, multiplier) -> int:
    """Выплата за сектор: **строго** ``FLOOR(ставка × множитель)``.

    Единственное место, где ставка умножается. На колесе 20 равных секторов и
    только целые множители (0, 1, 2, 5), ставки тоже целые, поэтому выплата
    всегда целое число V и равна ровно ``ставка × множитель``:

    * ставка 20: x0 → 0, x1 → 20, x2 → 40, x5 → 100;
    * ставка 100: x0 → 0, x1 → 100, x2 → 200, x5 → 500.

    Множитель — это **полная** выплата (возврат ставки + выигрыш), поэтому
    итог за спин считается как ``payout - charge``.

    Множитель — это **полная** выплата от ставки (возврат ставки + выигрыш), а не
    чистая прибыль: при x1 игрок получает свою ставку назад. Ставка списывается
    отдельно (``charge``), поэтому «итог» считаётся как ``payout - charge``.

    ``math.floor`` оставлен намеренно: если когда-нибудь появится дробный
    множитель, монеты всё равно останутся целыми (V — только целые).

    Проверяется в ``tools/test_wheel.py`` (вся таблица 7 × 6) и
    ``tools/test_wheel_api.py`` (сквозь HTTP).
    """
    return int(math.floor(int(stake) * multiplier))


def _rng_choice_weighted(items, weights) -> int:
    total = sum(weights)
    roll = secrets.randbelow(total)          # [0, total)
    upto = 0
    for index, weight in enumerate(weights):
        upto += weight
        if roll < upto:
            return index
    return len(weights) - 1


def request_ref(user_id: int, request_id, prefix: str = 'spin') -> str | None:
    """Идемпотентный ключ спина из идентификатора запроса клиента.

    Клиент присылает ``requestId`` один раз на попытку вращения. Повтор того же
    запроса (двойной тап, повтор после обрыва связи, дубль от прокси) попадёт в
    ту же строку ``casino_history`` и не спишет ставку второй раз.
    """
    if request_id in (None, ''):
        return None
    text = str(request_id).strip()
    if not text or len(text) > 120:
        return None
    digest = hashlib.sha256(f'{prefix}:{int(user_id)}:{text}'.encode()).hexdigest()
    return f'rq:{digest[:40]}'


def _repeat_result(row, game: str, balance: int) -> dict:
    """Ответ на повторный запрос: те же числа, что были записаны в историю."""
    bet = int(row['bet'] or 0)
    payout = int(row['reward'] or 0)
    outcome = str(row['result'] or '')
    multiplier = None
    if outcome[:1] in ('x', 'X'):
        try:
            multiplier = int(float(outcome[1:]))
        except ValueError:
            multiplier = None
    free = str(row['game_type'] or '').endswith('_free')
    charge = 0 if (free or bet == 0) else bet
    payload = {
        'game': game, 'stake': bet, 'payout': payout, 'win': payout > 0,
        'multiplier': multiplier, 'outcome': outcome,
        'charge': charge, 'credit': payout, 'net': payout - charge,
        'balance': balance, 'ref': row['reference_id'], 'repeated': True,
        'free': free,
    }
    if game == 'wheel' and multiplier is not None:
        payload['segment'] = WHEEL_SEGMENTS.index(multiplier) \
            if multiplier in WHEEL_SEGMENTS else 0
    return payload


def spin_wheel(user_id: int, stake=None, allow_free: bool = False,
               request_id=None) -> dict:
    """Колесо: результат и выплата считаются здесь.

    ``allow_free=True`` — первый спин за сутки бесплатный (ставка сохраняется для
    расчёта выплаты, но с баланса не списывается).
    """
    data = store.get_store()
    cfg = data.settings_map()
    if cfg.get('casino_enabled', '1') != '1':
        raise CasinoError('DISABLED', 'Казино временно отключено', 503)
    if cfg.get('wheel_enabled', '1') != '1':
        raise CasinoError('DISABLED', 'Колесо временно отключено', 503)
    # Повтор того же запроса отвечаем ДО проверки суточных лимитов: спин уже
    # случился, и клиент, потерявший ответ, обязан получить свой результат, а не
    # «лимит исчерпан».
    ref = request_ref(user_id, request_id, 'wheel')
    if ref:
        existing = data.casino_bet_by_ref(ref)
        if existing is not None and int(existing['user_id']) == int(user_id):
            payload = _repeat_result(existing, 'wheel', data.balance(user_id))
            payload['limits'] = wheel_limits(user_id)
            return payload
    limits = data.casino_limits(user_id)
    if limits['exclude_until'] > store.now():
        raise CasinoError('SELF_EXCLUDED', 'Вы добровольно ограничили игру в казино.', 403)
    min_stake, max_stake = _limits()
    # Суточные лимиты: бесплатный спин возможен только если он не потрачен,
    # платных вращений не больше пяти — иначе колесо блокируется до полуночи UTC.
    limits_state = data.casino_wheel_limits(user_id, WHEEL_FREE_PER_DAY, WHEEL_PAID_PER_DAY)
    limit_info = {'resetAt': limits_state['reset_at'], 'serverNow': limits_state['server_now']}
    use_free = bool(allow_free) and limits_state['free_left'] > 0
    if not use_free and limits_state['paid_left'] <= 0:
        raise CasinoError(
            'WHEEL_LIMIT',
            'Лимит вращений на сегодня исчерпан: 1 бесплатное и 5 платных. Колесо откроется после полуночи UTC.',
            429, limit_info)
    free_key = _daily_key(user_id) if use_free else None
    if stake is None:
        stake = min_stake
    try:
        stake = int(stake)
    except (TypeError, ValueError):
        raise CasinoError('STAKE', 'Некорректная ставка')
    if stake < min_stake or stake > max_stake:
        raise CasinoError('STAKE_RANGE', f'Ставка от {min_stake} до {max_stake} V')

    index = _rng_choice_weighted(WHEEL_SEGMENTS, WHEEL_WEIGHTS)
    multiplier = WHEEL_SEGMENTS[index]
    # Выплата — это ВСЯ сумма, которая возвращается на баланс: stake * multiplier.
    # Множители целые: x0, x1, x2, x5 (см. game_catalog.WHEEL_SEGMENTS);
    # сектор из ответа (`segment`) — тот же индекс, что и здесь, поэтому
    # колесо обязано остановиться на оплаченном множителе.
    # Ставка списана отдельно (charge), поэтому итоговое изменение баланса равно
    # payout - charge: x1 -> 0 (ставка вернулась), x2 -> +stake (чистый выигрыш),
    # x0 -> -stake (ставка потеряна).
    payout = wheel_payout(stake, multiplier)
    charge = 0 if use_free else stake
    net = payout - charge
    ref = ref or secrets.token_urlsafe(18)
    # Отдельный вид записи для бесплатного вращения: по нему считается дневной лимит.
    kind = FREE_SPIN_RECORD if use_free else FREE_SPIN_KIND
    result = data.casino_bet(user_id, kind, stake, f'x{multiplier:g}', ref,
                             payout, detail=f'x{multiplier:g}',
                             charge=charge, free_key=free_key)
    if result.get('repeated'):
        # Тот же requestId уже обработан: отдаём записанный результат, а не
        # второй раз списываем ставку.
        payload = _repeat_result(result['bet'], 'wheel', result['balance'])
        payload['limits'] = wheel_limits(user_id)
        return payload
    return {
        'game': 'wheel', 'segment': index, 'multiplier': multiplier, 'stake': stake,
        'payout': payout, 'win': payout > 0, 'free': bool(use_free and not result['repeated']),
        # charge — списано на старте, payout — зачислено в конце, net — разница.
        'charge': charge, 'credit': payout, 'net': net,
        'balance': result['balance'], 'ref': ref, 'repeated': False,
        'limits': wheel_limits(user_id),
    }


def _daily_key(user_id: int) -> str:
    return f'free_spin:{user_id}:{store.today()}'


def free_spin_available(user_id: int) -> bool:
    """Есть ли ещё бесплатное вращение сегодня (считаем по истории, не по флагу)."""
    data = store.get_store()
    state = data.casino_wheel_limits(user_id, WHEEL_FREE_PER_DAY, WHEEL_PAID_PER_DAY)
    return state['free_left'] > 0


def _limits():
    cfg = store.get_store().settings_map()
    return int(cfg.get('min_stake', '5') or 5), int(cfg.get('max_stake', '100') or 100)


def spin_slots(user_id: int, stake, request_id=None) -> dict:
    data = store.get_store()
    cfg = data.settings_map()
    if cfg.get('slots_enabled', '1') != '1':
        raise CasinoError('DISABLED', 'Слоты временно отключены', 503)
    if cfg.get('casino_enabled', '1') != '1':
        raise CasinoError('DISABLED', 'Казино временно отключено', 503)
    try:
        stake = int(stake)
    except (TypeError, ValueError):
        raise CasinoError('STAKE', 'Некорректная ставка')
    min_stake, max_stake = _limits()
    if stake < min_stake or stake > max_stake:
        raise CasinoError('STAKE_RANGE', f'Ставка от {min_stake} до {max_stake} V')
    ref = request_ref(user_id, request_id, 'slots')
    if ref:
        existing = data.casino_bet_by_ref(ref)
        if existing is not None and int(existing['user_id']) == int(user_id):
            payload = _repeat_result(existing, 'slots', data.balance(user_id))
            payload['outcome'] = str(existing['result'] or '')
            return payload
    limits = data.casino_limits(user_id)
    if limits['exclude_until'] > store.now():
        raise CasinoError('SELF_EXCLUDED', 'Вы добровольно ограничили игру.', 403)

    weights = [s['w'] for s in SLOT_SYMBOLS]
    reels = [_rng_choice_weighted(SLOT_SYMBOLS, weights) for _ in range(3)]
    ids = [SLOT_SYMBOLS[i]['id'] for i in reels]
    payout, outcome = _slot_payout(ids, stake)
    ref = ref or secrets.token_urlsafe(18)
    result = data.casino_bet(user_id, 'slots', stake, outcome, ref, payout,
                             detail=outcome)
    if result.get('repeated'):
        payload = _repeat_result(result['bet'], 'slots', result['balance'])
        payload['outcome'] = str(result['bet']['result'] or '')
        payload['reels'] = []
        return payload
    return {
        'game': 'slots', 'reels': ids, 'symbols': [SLOT_SYMBOLS[i] for i in reels],
        'stake': stake, 'payout': payout, 'win': payout > 0, 'outcome': outcome,
        # Списание на старте и зачисление в конце — разные величины.
        'charge': stake, 'credit': payout, 'net': payout - stake,
        'balance': result['balance'], 'ref': ref, 'refId': ref,
    }


def _slot_payout(ids, stake) -> tuple[int, str]:
    if ids[0] == ids[1] == ids[2]:
        symbol = next(s for s in SLOT_SYMBOLS if s['id'] == ids[0])
        return int(round(stake * symbol['m3'])), f"triple {ids[0]}"
    counts = {i: ids.count(i) for i in set(ids)}
    for symbol, count in counts.items():
        if count == 2:
            return int(round(stake * SLOT_TWO_PAY)), f'pair {symbol}'
    return 0, 'no win'


def rules() -> dict:
    data = store.get_store()
    cfg = data.settings_map()
    payload = casino_rules()
    payload['min_stake'] = int(cfg.get('min_stake', '5') or 5)
    payload['max_stake'] = int(cfg.get('max_stake', '100') or 100)
    payload['enabled'] = cfg.get('casino_enabled', '1') == '1'
    payload['wheel_enabled'] = cfg.get('wheel_enabled', '1') == '1'
    payload['slots_enabled'] = cfg.get('slots_enabled', '1') == '1'
    payload['stakes'] = [s for s in CASINO_STAKES if payload['min_stake'] <= s <= payload['max_stake']]
    return payload
