#!/usr/bin/env python3
"""Перенос базы Vertu Games из SQLite в PostgreSQL.

Что переносится:

* **аккаунты** — ник, хеш пароля (как есть: pbkdf2_sha256 / bcrypt / argon2),
  роль администратора, бан, даты создания и последнего входа;
* **балансы** — из ``users.coins`` (старая схема) или ``wallets.balance``;
  каждая сумма приходит одной записью в ``transactions`` с уникальным
  ``reference_id`` (``import:<id>``), поэтому повторный запуск не задваивает монеты;
* **достижения**, **статистика игр**, **история казино** — если они есть в файле;
* **покупки** — превращаются в записи ``inventory``.

Гарантии:

* файла нет или он битый — это не ошибка: скрипт печатает отчёт и выходит с
  кодом 0 (деплой на Render не должен падать из-за отсутствия локальной базы);
* дубликаты не создаются: сравнение идёт по ``username_key`` (ник без регистра),
  конфликт «тот же ник, другой пароль» пропускается и попадает в отчёт;
* ничего не перезаписывается: существующие аккаунты остаются как есть;
* по умолчанию — **сухой прогон**, запись только с ``--apply``.

Запуск:

```bash
export DATABASE_URL=postgresql://…          # Internal Database URL с Render
python migrate_sqlite_to_postgres.py                      # проверка, без записи
python migrate_sqlite_to_postgres.py --apply              # перенос
python migrate_sqlite_to_postgres.py --source data/vertu.sqlite3 --apply
python migrate_sqlite_to_postgres.py --report migration-report.json --apply
```
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

DEFAULT_SOURCES = (
    os.environ.get('VERTU_DB') or '',
    os.environ.get('VERTGAMES_DB') or '',
    str(ROOT / 'data' / 'vertu.sqlite3'),
    str(ROOT / 'data' / 'accounts.sqlite3'),
    str(ROOT / 'data' / 'platform.sqlite3'),
)


# --------------------------------------------------------------------------- #
#  Чтение источника
# --------------------------------------------------------------------------- #
def pick_source(explicit: str | None) -> Path | None:
    if explicit:
        path = Path(explicit)
        return path if path.exists() else None
    for candidate in DEFAULT_SOURCES:
        if candidate and Path(candidate).exists():
            return Path(candidate)
    return None


def read_sqlite(path: Path) -> dict:
    """Прочитать всё, что есть в файле. Отсутствующие таблицы — пустые списки."""
    data = {'users': [], 'wallets': [], 'achievements': [], 'game_stats': [],
            'casino_history': [], 'purchases': [], 'tables': []}
    conn = sqlite3.connect(f'file:{path}?mode=ro', uri=True, timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        data['tables'] = sorted({row['name'] for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type IN ('table','view')")})

        def columns(table: str) -> set:
            try:
                return {row['name'] for row in conn.execute(f'PRAGMA table_info("{table}")')}
            except sqlite3.Error:
                return set()

        def rows(table: str):
            if table not in data['tables']:
                return []
            try:
                return [dict(r) for r in conn.execute(f'SELECT * FROM "{table}"').fetchall()]
            except sqlite3.Error:
                return []

        if 'users' in data['tables']:
            cols = columns('users')
            for row in rows('users'):
                data['users'].append({
                    'id': int(row.get('id') or 0),
                    'username': row.get('username') or '',
                    'password_hash': (row.get('password_hash') or row.get('password')
                                      or row.get('pass') or ''),
                    'coins': int(row.get('coins') or 0) if 'coins' in cols else 0,
                    'is_admin': bool(row.get('is_admin') or 0),
                    'banned': bool(row.get('banned') or 0),
                    'ban_reason': row.get('ban_reason') or '',
                    'legacy_email': row.get('legacy_email') or row.get('email') or '',
                    'created': int(row.get('created') or row.get('created_at') or 0),
                    'last_seen': int(row.get('last_seen') or 0),
                    'avatar': row.get('avatar') or 'av:rocket',
                    'color': row.get('color') or 'col:teal',
                    'title': row.get('title') or 't:new',
                })
        if 'wallets' in data['tables']:
            data['wallets'] = rows('wallets')
        if 'user_achievements' in data['tables']:
            data['achievements'] = rows('user_achievements')
        for table, key in (('game_stats', 'game_stats'), ('game_statistics', 'game_stats'),
                           ('casino_bets', 'casino_history'), ('casino_history', 'casino_history'),
                           ('purchases', 'purchases'), ('inventory', 'purchases')):
            if table in data['tables'] and not data[key]:
                data[key] = rows(table)
    finally:
        conn.close()
    return data


# --------------------------------------------------------------------------- #
#  Перенос
# --------------------------------------------------------------------------- #
def migrate(source: Path, apply: bool, store) -> dict:
    report = {
        'source': str(source), 'started': int(time.time()), 'apply': apply,
        'users': {'total': 0, 'created': 0, 'skipped': 0, 'conflicts': 0, 'invalid': 0},
        'balances': {'transferred': 0, 'coins': 0, 'from_wallets': 0},
        'achievements': {'transferred': 0},
        'game_stats': {'transferred': 0},
        'casino_history': {'transferred': 0},
        'inventory': {'transferred': 0},
        'warnings': [], 'errors': [],
    }
    if source is None:
        report['warnings'].append('SQLite-файл не найден — переносить нечего.')
        return report
    try:
        data = read_sqlite(source)
    except sqlite3.Error as exc:
        report['warnings'].append(f'SQLite-файл не читается ({exc}) — перенос пропущен.')
        return report

    report['tables'] = data['tables']
    report['users']['total'] = len(data['users'])
    wallet_by_id = {int(w.get('user_id') or 0): int(w.get('balance') or 0) for w in data['wallets']}
    id_map: dict[int, int] = {}

    for row in data['users']:
        name = str(row['username']).strip()
        stored = str(row['password_hash'] or '').strip()
        if not name:
            report['users']['invalid'] += 1
            continue
        if not stored:
            report['users']['invalid'] += 1
            report['warnings'].append(f'{name}: нет хеша пароля — аккаунт пропущен')
            continue
        if apply:
            status = store.import_legacy_user(
                name, stored, int(row['coins'] or 0), row['is_admin'], row['legacy_email'],
                int(row['created'] or 0), row['banned'])
        else:
            existing = store.find_user(name)
            if not existing:
                status = 'created'
            elif existing['password_hash'] == stored:
                status = 'exists'
            else:
                status = 'conflict'
        old_id = None
        if apply:
            found = store.find_user(name)
            if found:
                old_id = found['id']
        if status == 'created':
            report['users']['created'] += 1
            if wallet_by_id and apply and old_id:
                target = wallet_by_id.get(int(row.get('id') or 0))
                if target is not None:
                    current = store.balance(old_id)
                    if target > current:
                        extra = target - current
                        store.add_coins(old_id, extra, 'import', 'Баланс из wallets',
                                        f'import-wallet:{old_id}')
                        report['balances']['from_wallets'] += 1
                        report['balances']['coins'] += extra
            if int(row['coins'] or 0):
                report['balances']['transferred'] += 1
                report['balances']['coins'] += int(row['coins'])
            if not apply:
                id_map[int(row.get('id') or 0)] = -1
        elif status == 'exists':
            report['users']['skipped'] += 1
        else:
            report['users']['conflicts'] += 1
            report['warnings'].append(f'{name}: ник занят аккаунтом с другим паролем — пропуск')

    # -------- достижения, статистика, казино, инвентарь: переносим для
    # существующих аккаунтов (по нику), чтобы прогресс не потерялся.
    if apply and data['users']:
        by_old_id = {}
        for row in data['users']:
            found = store.find_user(str(row['username']).strip())
            if found:
                by_old_id[int(row.get('id') or 0)] = found['id']
        for ach in data['achievements']:
            uid = by_old_id.get(int(ach.get('user_id') or 0))
            ach_id = ach.get('achievement_id') or ach.get('ach_id') or ach.get('id')
            if uid and ach_id and store.unlock_achievement(uid, str(ach_id)):
                report['achievements']['transferred'] += 1
        for stat in data['game_stats']:
            uid = by_old_id.get(int(stat.get('user_id') or 0))
            game = stat.get('game') or stat.get('game_id')
            if uid and game:
                store.record_play(uid, str(game), int(stat.get('score') or 0))
                report['game_stats']['transferred'] += 1
        for bet in data['casino_history'][:5000]:
            uid = by_old_id.get(int(bet.get('user_id') or 0))
            if not uid:
                continue
            # История переносится «как запись»: баланс уже перенесён выше, поэтому
            # повторное начисление выигрышей недопустимо.
            ok = store.import_casino_history(
                uid, str(bet.get('game') or bet.get('game_type') or 'wheel'),
                int(bet.get('stake') or bet.get('bet') or 0),
                int(bet.get('payout') or bet.get('reward') or 0),
                str(bet.get('outcome') or bet.get('result') or ''),
                str(bet.get('detail') or bet.get('id') or ''),
                int(bet.get('created') or 0))
            if ok:
                report['casino_history']['transferred'] += 1
        for buy in data['purchases']:
            uid = by_old_id.get(int(buy.get('user_id') or 0))
            item_id = buy.get('item_id') or buy.get('id')
            if not uid or not item_id:
                continue
            try:
                store.buy_item_free(uid, str(item_id))
                report['inventory']['transferred'] += 1
            except Exception as exc:  # noqa: BLE001
                report['warnings'].append(f'покупка {item_id}: {exc}')
    return report


def print_report(report: dict) -> None:
    if not report.get('source'):
        print('Источник: SQLite-файл не найден')
    else:
        print(f'Источник:   {report["source"]}')
    print(f'Режим:      {"ЗАПИСЬ" if report["apply"] else "проверка (--apply для записи)"}')
    print(f'Пользователи: всего {report["users"]["total"]}, '
          f'создано {report["users"]["created"]}, пропущено {report["users"]["skipped"]}, '
          f'конфликтов {report["users"]["conflicts"]}, некорректных {report["users"]["invalid"]}')
    print(f'Балансы:    операций {report["balances"]["transferred"]}, '
          f'сумма {report["balances"]["coins"]} V, из wallets {report["balances"]["from_wallets"]}')
    print(f'Достижения: {report["achievements"]["transferred"]}, '
          f'статистика игр: {report["game_stats"]["transferred"]}, '
          f'казино: {report["casino_history"]["transferred"]}, '
          f'инвентарь: {report["inventory"]["transferred"]}')
    for warning in report['warnings'][:20]:
        print(f'  ⚠ {warning}')
    if len(report['warnings']) > 20:
        print(f'  … ещё {len(report["warnings"]) - 20} предупреждений (см. --report)')
    if not report['apply'] and report['users']['created']:
        print('\nЭто был сухой прогон. Повторите с --apply, чтобы записать данные.')


def main() -> int:
    parser = argparse.ArgumentParser(description='Перенос SQLite → PostgreSQL (Vertu Games)')
    parser.add_argument('--source', default=None, help='путь к SQLite-файлу')
    parser.add_argument('--apply', action='store_true', help='записать данные в PostgreSQL')
    parser.add_argument('--report', default='', help='сохранить JSON-отчёт по пути')
    args = parser.parse_args()

    database_url = (os.environ.get('DATABASE_URL') or '').strip()
    if args.apply and not database_url:
        print('DATABASE_URL не задан: переносить некуда.\n'
              'Задайте Internal Database URL из Render и повторите.', file=sys.stderr)
        return 2

    source = pick_source(args.source)
    if args.source and source is None:
        print(f'Файл {args.source} не найден — переносить нечего.', file=sys.stderr)
        report = {'source': None, 'apply': args.apply,
                  'users': {'total': 0, 'created': 0, 'skipped': 0, 'conflicts': 0, 'invalid': 0},
                  'balances': {'transferred': 0, 'coins': 0, 'from_wallets': 0},
                  'achievements': {'transferred': 0}, 'game_stats': {'transferred': 0},
                  'casino_history': {'transferred': 0}, 'inventory': {'transferred': 0},
                  'warnings': ['файл не найден'], 'errors': []}
        print_report(report)
        return 0

    import db as platform_db

    store = platform_db.get_store()
    print(f'Целевая база: {store.backend}\n')
    report = migrate(source, args.apply, store)
    report['finished'] = int(time.time())
    report['backend'] = store.backend
    print_report(report)
    if args.report:
        Path(args.report).write_text(json.dumps(report, ensure_ascii=False, indent=2),
                                     encoding='utf-8')
        print(f'\nОтчёт сохранён: {args.report}')
    return 1 if report['errors'] else 0


if __name__ == '__main__':
    raise SystemExit(main())
