"""Начальная схема Vertu Games (PostgreSQL).

Revision ID: 0001_initial
Revises:
Create Date: 2026-11-11

Создаёт все таблицы, индексы, внешние ключи и ограничения целостности:

* канонические таблицы ТЗ — ``users``, ``wallets``, ``transactions``, ``games``,
  ``game_statistics``, ``achievements``, ``user_achievements``, ``inventory``,
  ``items``, ``daily_tasks``, ``user_daily_tasks``, ``casino_history``;
* служебные таблицы приложения — сессии, лимиты, заказы, журнал админа;
* совместимые представления — ``coin_ledger``, ``casino_bets``, ``game_stats``,
  ``purchases``, ``shop_items`` (старый код читает их как таблицы).

SQL берётся из ``schema_sql.py``: один файл — одна структура и для Alembic, и
для создания схемы при старте приложения.
"""
from __future__ import annotations

import os
import sys

from alembic import op

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')))

import schema_sql  # noqa: E402

revision = '0001_initial'
down_revision = None
branch_labels = None
depends_on = None

# Порядок удаления — обратный порядку создания (сначала зависимые таблицы).
TABLES = (
    'admin_actions', 'admin_log', 'admin_sessions', 'sessions', 'rate_limits',
    'turnstile_tokens', 'platform_settings', 'shop_ledger', 'shop_orders',
    'casino_limits', 'casino_history', 'user_daily_tasks', 'daily_tasks',
    'inventory', 'user_achievements', 'achievements', 'game_limits',
    'game_receipts', 'game_statistics', 'games', 'transactions', 'wallets',
    'items', 'users', 'schema_migrations',
)

VIEWS = ('coin_ledger', 'casino_bets', 'game_stats', 'purchases', 'shop_items')


def _statements(sql: str):
    for chunk in sql.split(';'):
        chunk = chunk.strip()
        if chunk:
            yield chunk


def upgrade() -> None:
    bind = op.get_bind()
    for statement in _statements(schema_sql.ALL_SCHEMA):
        bind.exec_driver_sql(statement)
    for statement in _statements(schema_sql.COMPAT_VIEWS):
        bind.exec_driver_sql(statement)


def downgrade() -> None:
    bind = op.get_bind()
    for view in VIEWS:
        bind.exec_driver_sql(f'DROP VIEW IF EXISTS {view} CASCADE')
    for table in TABLES:
        bind.exec_driver_sql(f'DROP TABLE IF EXISTS {table} CASCADE')
