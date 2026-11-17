"""Alembic environment для Vertu Games.

URL берётся из переменной окружения ``DATABASE_URL`` (на Render — Internal
Database URL). Если переменная не задана, Alembic честно падает с подсказкой,
а не пытается молча создать SQLite-файл: продовая база — только PostgreSQL.

```
export DATABASE_URL=postgresql://user:pass@host:5432/dbname
alembic upgrade head
```
"""
from __future__ import annotations

import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool

# Метаданные не описываем вручную: 0001_initial импортирует schema_sql.py, чтобы
# единственным источником структуры оставался один файл.
config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = None


def database_url() -> str:
    url = (os.environ.get('DATABASE_URL') or config.get_main_option('sqlalchemy.url') or '').strip()
    if not url:
        raise RuntimeError(
            'DATABASE_URL не задан.\n'
            'Задайте строку подключения Render (Internal Database URL), например:\n'
            '  export DATABASE_URL=postgresql://vertu:secret@dpg-xxxx-a.frankfurt-postgres.render.com/vertu_games\n'
        )
    # Render иногда отдаёт postgres:// — SQLAlchemy принимает только postgresql://
    if url.startswith('postgres://'):
        url = url.replace('postgres://', 'postgresql://', 1)
    return url


def run_migrations_offline() -> None:
    context.configure(
        url=database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={'paramstyle': 'named'},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = create_engine(database_url(), poolclass=pool.NullPool, future=True)
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata,
                          compare_type=True)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
