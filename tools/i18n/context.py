"""Минимальный контекст для переводчика: число игр в нужном языке."""
from __future__ import annotations

LANG = 'ru'


def games_count(lang: str = 'ru') -> str:
    from game_catalog import visible_games
    n = len(visible_games())
    if lang == 'en':
        return f'{n} games' if n != 1 else '1 game'
    if n % 10 == 1 and n % 100 != 11:
        return f'{n} игра'
    if n % 10 in (2, 3, 4) and n % 100 not in (12, 13, 14):
        return f'{n} игры'
    return f'{n} игр'
