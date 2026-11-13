#!/usr/bin/env python3
"""Казино Vertu Games — вся игровая логика на сервере.

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

import secrets

import db as store
from game_catalog import (CASINO_STAKES, SLOT_SYMBOLS, SLOT_TWO_PAY, WHEEL_SEGMENTS,
                          WHEEL_WEIGHTS, casino_rules)

FREE_SPIN_KIND = 'wheel'
FREE_SPIN_GAME = 'daily'


class CasinoError(Exception):
    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


def _rng_choice_weighted(items, weights) -> int:
    total = sum(weights)
    roll = secrets.randbelow(total)          # [0, total)
    upto = 0
    for index, weight in enumerate(weights):
        upto += weight
        if roll < upto:
            return index
    return len(weights) - 1


def spin_wheel(user_id: int, stake=None, allow_free: bool = False) -> dict:
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
    limits = data.casino_limits(user_id)
    if limits['exclude_until'] > store.now():
        raise CasinoError('SELF_EXCLUDED', 'Вы добровольно ограничили игру в казино.', 403)
    min_stake, max_stake = _limits()
    free_key = _daily_key(user_id) if allow_free else None
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
    payout = int(round(stake * multiplier))
    ref = secrets.token_urlsafe(18)
    result = data.casino_bet(user_id, FREE_SPIN_KIND, stake, f'x{multiplier:g}', ref,
                             payout, ref, charge=stake, free_key=free_key)
    return {
        'game': 'wheel', 'segment': index, 'multiplier': multiplier, 'stake': stake,
        'payout': payout, 'win': payout > 0, 'free': bool(free_key and not result['repeated']),
        'balance': result['balance'], 'ref': ref,
    }


def _daily_key(user_id: int) -> str:
    return f'free_spin:{user_id}:{store.today()}'


def free_spin_available(user_id: int) -> bool:
    data = store.get_store()
    with data.driver.transaction() as c:
        row = c.execute('SELECT 1 FROM platform_settings WHERE key=?',
                        (_daily_key(user_id),)).fetchone()
    return not bool(row)


def _limits():
    cfg = store.get_store().settings_map()
    return int(cfg.get('min_stake', '5') or 5), int(cfg.get('max_stake', '100') or 100)


def spin_slots(user_id: int, stake) -> dict:
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
    limits = data.casino_limits(user_id)
    if limits['exclude_until'] > store.now():
        raise CasinoError('SELF_EXCLUDED', 'Вы добровольно ограничили игру.', 403)

    weights = [s['w'] for s in SLOT_SYMBOLS]
    reels = [_rng_choice_weighted(SLOT_SYMBOLS, weights) for _ in range(3)]
    ids = [SLOT_SYMBOLS[i]['id'] for i in reels]
    payout, outcome = _slot_payout(ids, stake)
    ref = secrets.token_urlsafe(18)
    result = data.casino_bet(user_id, 'slots', stake, outcome, f'{ref}',
                             payout, ref)
    return {
        'game': 'slots', 'reels': ids, 'symbols': [SLOT_SYMBOLS[i] for i in reels],
        'stake': stake, 'payout': payout, 'win': payout > 0, 'outcome': outcome,
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
