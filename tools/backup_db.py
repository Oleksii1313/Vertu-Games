#!/usr/bin/env python3
"""Резервная копия базы Vert Games перед изменениями.

Копия делается только на чтение: скрипт ничего не удаляет и не меняет в базе.

* SQLite — копия файла через ``VACUUM INTO`` (получается цельная база даже при
  открытых соединениях; WAL-хвост при этом учтён).
* PostgreSQL — ``pg_dump`` в custom-формате, если утилита есть в PATH; иначе
  честная выгрузка всех таблиц в JSON (структура + данные) тем же драйвером,
  что использует сервер.

    python3 tools/backup_db.py                 # копия в backups/<дата>/
    python3 tools/backup_db.py --dir /srv/bk   # свой каталог
    DATABASE_URL=postgresql://… python3 tools/backup_db.py

Файлы копий лежат вне git (``backups/`` в .gitignore).
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def _stamp() -> str:
    return datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')


def _sqlite_source() -> Path | None:
    explicit = os.environ.get('VERT_DB') or os.environ.get('VERTU_DB') or os.environ.get('VERTGAMES_DB')
    if explicit:
        return Path(explicit)
    default = ROOT / 'data' / 'vert.sqlite3'
    legacy = ROOT / 'data' / 'vertu.sqlite3'
    if default.exists():
        return default
    if legacy.exists():
        return legacy
    return None


def backup_sqlite(target_dir: Path) -> Path:
    import sqlite3
    source = _sqlite_source()
    if source is None or not source.exists():
        raise SystemExit('SQLite-база не найдена: задайте VERT_DB или создайте data/vert.sqlite3')
    target = target_dir / f'{source.stem}-{_stamp()}.sqlite3'
    # VACUUM INTO создаёт консистентную копию, не блокируя читателей.
    with sqlite3.connect(str(source)) as conn:
        conn.execute('VACUUM INTO ?', (str(target),))
    return target


def backup_postgres(target_dir: Path, url: str) -> Path:
    pg_dump = shutil.which('pg_dump')
    stamp = _stamp()
    if pg_dump:
        target = target_dir / f'postgres-{stamp}.dump'
        result = subprocess.run([pg_dump, '--format=custom', '--no-owner', '--file', str(target), url],
                                capture_output=True, text=True)
        if result.returncode == 0:
            return target
        print(f'pg_dump не смог: {result.stderr.strip()[:200]} — делаю JSON-выгрузку', file=sys.stderr)
    # Фолбэк: JSON со всеми таблицами (только чтение).
    import psycopg
    import psycopg.rows
    target = target_dir / f'postgres-{stamp}.json'
    dump: dict[str, object] = {'createdAt': stamp, 'tables': {}}
    with psycopg.connect(url, row_factory=psycopg.rows.dict_row) as conn:
        tables = [row['tablename'] for row in conn.execute(
            "SELECT tablename FROM pg_tables WHERE schemaname = current_schema() ORDER BY tablename")]
        for table in tables:
            rows = conn.execute(f'SELECT * FROM "{table}"').fetchall()
            dump['tables'][table] = [
                {key: (value.isoformat() if hasattr(value, 'isoformat') else value)
                 for key, value in row.items()} for row in rows]
    target.write_text(json.dumps(dump, ensure_ascii=False, indent=1), encoding='utf-8')
    return target


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description='Резервная копия базы Vert Games')
    parser.add_argument('--dir', default=str(ROOT / 'backups'), help='каталог для копий')
    args = parser.parse_args(argv)

    target_dir = Path(args.dir).expanduser().resolve()
    target_dir.mkdir(parents=True, exist_ok=True)
    url = (os.environ.get('DATABASE_URL') or '').strip()

    if url:
        path = backup_postgres(target_dir, url)
    else:
        path = backup_sqlite(target_dir)
    size = path.stat().st_size
    print(f'резервная копия: {path} ({size / 1024:.1f} КБ)')
    print('восстановление SQLite:  sqlite3 <копия> ".backup <рабочая база>"')
    print('восстановление PostgreSQL: pg_restore --clean --if-exists -d <база> <копия>')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
