#!/usr/bin/env python3
"""Локальный PostgreSQL для разработки/тестов (не для production).

Запускает встроенный PostgreSQL (пакет ``pgserver``) и печатает DATABASE_URL.
Данные лежат в ``.pgdata/`` и сохраняются между запусками.

    .venv/bin/python tools/dev_pg.py
"""
from pathlib import Path
import sys

try:
    import pgserver
except ImportError:  # pragma: no cover
    print('pgserver не установлен: .venv/bin/pip install pgserver', file=sys.stderr)
    raise SystemExit(1)

ROOT = Path(__file__).resolve().parents[1]
data = ROOT / '.pgdata'
data.mkdir(exist_ok=True)
server = pgserver.get_server(data, cleanup_mode=None)
print(server.get_uri())
