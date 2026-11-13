#!/usr/bin/env python3
"""Перенос старых аккаунтов в новую базу Vertu Games.

Старая версия платформы хранила пользователей в SQLite (`data/accounts.sqlite3`,
модуль `database.py`) с полями username / email / password. Новая платформа
работает без email, поэтому:

* ник переносится как есть (если свободен);
* хеш пароля переносится как есть — формат `pbkdf2_sha256$rounds$salt$hash`
  одинаковый, старый пароль продолжает работать;
* старый email сохраняется в `legacy_email` только для входа по email
  (см. обработчик `/api/auth/login`) и больше нигде не используется;
* баланс переносится одной записью в журнал операций;
* если такой ник уже занят другим паролем, аккаунт пропускается — ничего не
  перезаписывается.

Запуск (по умолчанию только проверка, ничего не пишет):

    .venv/bin/python tools/migrate_legacy.py
    .venv/bin/python tools/migrate_legacy.py --apply

Путь к старой базе: --source / path (по умолчанию data/accounts.sqlite3 или
переменная окружения VERTGAMES_DB). Новая база — DATABASE_URL или VERTU_DB.
"""
from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import db as platform_db  # noqa: E402


def read_legacy(path: Path):
    if not path.exists():
        raise SystemExit(f'Старая база не найдена: {path}')
    conn = sqlite3.connect(f'file:{path}?mode=ro', uri=True)
    conn.row_factory = sqlite3.Row
    try:
        tables = {row['name'] for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")}
        if 'users' not in tables:
            raise SystemExit('В файле нет таблицы users — это не база Vertu Games.')
        columns = {row['name'] for row in conn.execute('PRAGMA table_info(users)')}
        rows = conn.execute('SELECT * FROM users ORDER BY id').fetchall()
    finally:
        conn.close()
    out = []
    for row in rows:
        out.append({
            'username': row['username'],
            'password': row['password'],
            'email': (row['email'] if 'email' in columns else '') or '',
            'coins': int(row['coins']) if 'coins' in columns else 0,
            'is_admin': bool(row['is_admin']) if 'is_admin' in columns else False,
            'created': int(row['created']) if 'created' in columns else 0,
            'banned': bool(row['banned']) if 'banned' in columns else False,
        })
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description='Перенос старых аккаунтов Vertu Games')
    parser.add_argument('--source', default=os.environ.get('VERTGAMES_DB', str(ROOT / 'data' / 'accounts.sqlite3')))
    parser.add_argument('--apply', action='store_true', help='записать изменения в новую базу')
    parser.add_argument('--limit', type=int, default=0, help='перенести не больше N аккаунтов')
    args = parser.parse_args()

    legacy = read_legacy(Path(args.source))
    if args.limit > 0:
        legacy = legacy[:args.limit]
    store = platform_db.get_store()
    print(f'Старая база: {args.source} — аккаунтов: {len(legacy)}')
    print(f'Новая база:  {store.backend}' + ('' if args.apply else ' (режим проверки, без записи)'))

    created = exists = conflict = 0
    for row in legacy:
        current = store.find_user(row['username'])
        if current and current['password_hash'] != row['password']:
            conflict += 1
            print(f'  ⚠ конфликт: ник {row["username"]} уже занят другим паролем — пропуск')
            continue
        if current:
            exists += 1
            continue
        if not args.apply:
            created += 1
            print(f'  + будет перенесён: {row["username"]} ({row["coins"]} V)')
            continue
        status = store.import_legacy_user(row['username'], row['password'], row['coins'],
                                          row['is_admin'], row['email'], row['created'], row['banned'])
        if status == 'created':
            created += 1
            print(f'  + перенесён: {row["username"]} ({row["coins"]} V)')
        elif status == 'exists':
            exists += 1
        else:
            conflict += 1
            print(f'  ⚠ пропущен: {row["username"]}')

    print(f'\nИтого: перенесено {created}, уже было {exists}, конфликтов {conflict}.')
    if not args.apply and created:
        print('Повторите команду с --apply, чтобы записать изменения.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
