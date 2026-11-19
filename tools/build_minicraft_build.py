#!/usr/bin/env python3
"""Вставить модуль продвинутой стройки в games/minicraft.html.

Модуль живёт внутри замыкания игры (ему нужны мир, сцена и игрок), поэтому
исходник хранится отдельно (``tools/minicraft_build_module.js``) и вставляется
между маркерами. Скрипт идемпотентный: повторный запуск обновляет код модуля и
не дублирует патчи.

    python tools/build_minicraft_build.py           # пересобрать игру
    python tools/build_minicraft_build.py --check   # только проверить, что файл актуален
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GAME = ROOT / 'games' / 'minicraft.html'
MODULE = ROOT / 'tools' / 'minicraft_build_module.js'

START = '/* @@MCB_START@@ */'
END = '/* @@MCB_END@@ */'

# Патчи движка: каждый ровно один раз, каждый — с проверкой «уже применён?».
PATCHES = [
    (
        'ui(s, r, a, F.slot + 1), F.dirty = !0;',
        'mcxBuildPlace(s, r, a), F.dirty = !0;',
        'постановка блока идёт через систему стройки',
    ),
    (
        '} else e && cs(e.x, e.y, e.z) !== Vl && (ui(e.x, e.y, e.z, Ai), F.dirty = !0)',
        '} else e && mcxBuildBreak(e.x, e.y, e.z) && (F.dirty = !0)',
        'снос блока идёт через систему стройки',
    ),
    (
        'ao = requestAnimationFrame(jh);',
        'ao = requestAnimationFrame(jh);\n  try { mcbTick(); } catch (mcbErr) {}',
        'покадровая часть стройки идёт в общем цикле отрисовки',
    ),
    (
        'cs(s, r, a) !== Ai || Math.abs(s + .5 - F.x)',
        '(cs(s, r, a) !== Ai && cs(s, r, a) !== qh) || Math.abs(s + .5 - F.x)',
        'блок можно ставить в воду (вытесняя её)',
    ),
    (
        'Qh(n, s, MCX_LOOK_TOUCH)',
        'Qh(n, s, MCX_LOOK_TOUCH * (mcbState.sensitivity || 1))',
        'чувствительность обзора пальцем настраивается',
    ),
    (
        '/^Digit[1-6]$/.test(i.code) && Jl(Number(i.code.slice(-1)) - 1)',
        '/^Digit[1-9]$/.test(i.code) && mcbKeySlot(Number(i.code.slice(-1)) - 1)',
        'цифры выбирают слот нового хотбара (1–9)',
    ),
]

ANCHOR = '\nmcxInit();\n'


def insert_module(html: str, module: str) -> str:
    """Заменить (или добавить) блок модуля между маркерами."""
    block = f'{START}\n{module.rstrip()}\n{END}\n'
    if START in html and END in html:
        head = html.index(START)
        tail = html.index(END) + len(END)
        return html[:head] + block.rstrip('\n') + html[tail:]
    if ANCHOR not in html:
        raise SystemExit('не найден вызов mcxInit() — структура страницы изменилась')
    if html.count(ANCHOR) != 1:
        raise SystemExit('вызов mcxInit() не найден однозначно — структура страницы изменилась')
    position = html.index(ANCHOR)
    return html[:position + 1] + block + html[position + 1:]


def apply_patches(html: str) -> tuple[str, list[str]]:
    applied = []
    for old, new, reason in PATCHES:
        if new in html:
            applied.append(f'уже применён: {reason}')
            continue
        count = html.count(old)
        if count != 1:
            raise SystemExit(f'патч «{reason}» не найден однозначно ({count} совпадений)')
        html = html.replace(old, new, 1)
        applied.append(f'применён: {reason}')
    return html, applied


def main(argv: list[str]) -> int:
    check_only = '--check' in argv
    html = GAME.read_text(encoding='utf-8')
    module = MODULE.read_text(encoding='utf-8')
    updated = insert_module(html, module)
    updated, applied = apply_patches(updated)
    if check_only:
        if updated != html:
            print('games/minicraft.html устарел: запустите python tools/build_minicraft_build.py')
            return 1
        print('модуль стройки в игре актуален')
        return 0
    if updated != html:
        GAME.write_text(updated, encoding='utf-8')
        print(f'обновлён games/minicraft.html ({len(updated)} байт)')
    else:
        print('изменений нет: игра уже собрана')
    for line in applied:
        print(' ·', line)
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
