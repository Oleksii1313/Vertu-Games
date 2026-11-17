#!/usr/bin/env python3
"""Vertu Games — каноническая схема PostgreSQL.

Единственное описание структуры базы. Из него берут данные:

* ``db.py`` — создаёт схему при старте (``CREATE TABLE IF NOT EXISTS``);
* Alembic (``alembic/versions/0001_initial.py``) — начальная миграция;
* ``migrate_sqlite_to_postgres.py`` — проверяет, что таблицы на месте.

Правила:

* все суммы — ``BIGINT``, баланс физически не может стать отрицательным
  (``CHECK (balance >= 0)``);
* связи описаны внешними ключами с ``ON DELETE CASCADE`` там, где данные
  принадлежат пользователю;
* таблицы, которые нужны прежнему коду (``coin_ledger``, ``purchases``,
  ``casino_bets`` и т.д.), сохранены — это представления/таблицы-совместимости,
  чтобы существующие страницы и API не ломались.

Три уровня:

1. **Канонические таблицы** из технического задания — ``users``, ``wallets``,
   ``transactions``, ``games``, ``game_statistics``, ``achievements``,
   ``user_achievements``, ``inventory``, ``items``, ``daily_tasks``,
   ``user_daily_tasks``, ``casino_history``.
2. **Служебные таблицы приложения** — сессии, лимиты, заказы, журнал.
3. **Представления совместимости** (views) — ``coin_ledger``, ``purchases``,
   ``casino_bets``, ``shop_items`` и др. Читать можно как раньше; запись идёт
   только в канонические таблицы через ``db.py``.
"""
from __future__ import annotations

# --------------------------------------------------------------------------- #
#  1. Канонические таблицы
# --------------------------------------------------------------------------- #
CORE_TABLES = """
CREATE TABLE IF NOT EXISTS users (
    id            BIGSERIAL PRIMARY KEY,
    username      TEXT        NOT NULL,
    username_key  TEXT        NOT NULL UNIQUE,
    password_hash TEXT        NOT NULL,
    role          TEXT        NOT NULL DEFAULT 'player',
    avatar        TEXT        NOT NULL DEFAULT 'av:rocket',
    color         TEXT        NOT NULL DEFAULT 'col:teal',
    title         TEXT        NOT NULL DEFAULT 't:new',
    experience    BIGINT      NOT NULL DEFAULT 0,
    level         INTEGER     NOT NULL DEFAULT 1,
    is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
    is_admin      BOOLEAN     NOT NULL DEFAULT FALSE,
    banned        BOOLEAN     NOT NULL DEFAULT FALSE,
    ban_reason    TEXT        NOT NULL DEFAULT '',
    legacy_email  TEXT        NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login    TIMESTAMPTZ,
    last_seen     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users(last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role) WHERE role <> 'player';

CREATE TABLE IF NOT EXISTS wallets (
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT      NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    balance    BIGINT      NOT NULL DEFAULT 0 CHECK (balance >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wallets_balance ON wallets(balance DESC);

CREATE TABLE IF NOT EXISTS transactions (
    id               BIGSERIAL PRIMARY KEY,
    user_id          BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wallet_id        BIGINT      REFERENCES wallets(id) ON DELETE SET NULL,
    amount           BIGINT      NOT NULL,
    balance_after    BIGINT      NOT NULL CHECK (balance_after >= 0),
    transaction_type TEXT        NOT NULL,
    description      TEXT        NOT NULL DEFAULT '',
    reference_id     TEXT        UNIQUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(transaction_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at DESC);

CREATE TABLE IF NOT EXISTS games (
    id          TEXT        PRIMARY KEY,
    name        TEXT        NOT NULL,
    description TEXT        NOT NULL DEFAULT '',
    category    TEXT        NOT NULL DEFAULT '',
    file        TEXT        NOT NULL DEFAULT '',
    icon        TEXT        NOT NULL DEFAULT '',
    reward      BIGINT      NOT NULL DEFAULT 0,
    daily_cap   BIGINT      NOT NULL DEFAULT 0,
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_games_active ON games(is_active);

CREATE TABLE IF NOT EXISTS game_statistics (
    id       BIGSERIAL   PRIMARY KEY,
    user_id  BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_id  TEXT        NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    score    BIGINT      NOT NULL DEFAULT 0,
    plays    BIGINT      NOT NULL DEFAULT 0,
    coins    BIGINT      NOT NULL DEFAULT 0,
    played_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_game_statistics_unique ON game_statistics(user_id, game_id);
CREATE INDEX IF NOT EXISTS idx_game_statistics_game ON game_statistics(game_id, score DESC);

CREATE TABLE IF NOT EXISTS achievements (
    id          TEXT        PRIMARY KEY,
    name        TEXT        NOT NULL,
    description TEXT        NOT NULL DEFAULT '',
    icon        TEXT        NOT NULL DEFAULT 'trophy',
    reward      BIGINT      NOT NULL DEFAULT 0,
    name_en     TEXT        NOT NULL DEFAULT '',
    desc_en     TEXT        NOT NULL DEFAULT '',
    item_order  INTEGER     NOT NULL DEFAULT 0,
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_achievements (
    id             BIGSERIAL   PRIMARY KEY,
    user_id        BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    achievement_id TEXT        NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
    unlocked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, achievement_id)
);
CREATE INDEX IF NOT EXISTS idx_user_achievements_user ON user_achievements(user_id, unlocked_at DESC);

CREATE TABLE IF NOT EXISTS items (
    id          TEXT        PRIMARY KEY,
    name        TEXT        NOT NULL,
    description TEXT        NOT NULL DEFAULT '',
    item_type   TEXT        NOT NULL,
    rarity      TEXT        NOT NULL DEFAULT 'common',
    image       TEXT        NOT NULL DEFAULT '',
    price       BIGINT      NOT NULL DEFAULT 0 CHECK (price >= 0),
    payload     TEXT        NOT NULL DEFAULT '',
    name_en     TEXT        NOT NULL DEFAULT '',
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    item_order  INTEGER     NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_items_type ON items(item_type, item_order);

CREATE TABLE IF NOT EXISTS inventory (
    id          BIGSERIAL   PRIMARY KEY,
    user_id     BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id     TEXT        NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    quantity    INTEGER     NOT NULL DEFAULT 1 CHECK (quantity > 0),
    acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_inventory_user ON inventory(user_id, acquired_at DESC);

CREATE TABLE IF NOT EXISTS daily_tasks (
    id          BIGSERIAL   PRIMARY KEY,
    title       TEXT        NOT NULL,
    description TEXT        NOT NULL DEFAULT '',
    reward      BIGINT      NOT NULL DEFAULT 0,
    task_type   TEXT        NOT NULL DEFAULT 'play',
    target_value BIGINT     NOT NULL DEFAULT 1,
    title_en    TEXT        NOT NULL DEFAULT '',
    desc_en     TEXT        NOT NULL DEFAULT '',
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_daily_tasks (
    id         BIGSERIAL   PRIMARY KEY,
    user_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_id    BIGINT      NOT NULL REFERENCES daily_tasks(id) ON DELETE CASCADE,
    progress   BIGINT      NOT NULL DEFAULT 0,
    completed  BOOLEAN     NOT NULL DEFAULT FALSE,
    claimed    BOOLEAN     NOT NULL DEFAULT FALSE,
    task_date  DATE        NOT NULL DEFAULT CURRENT_DATE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, task_id, task_date)
);
CREATE INDEX IF NOT EXISTS idx_user_daily_tasks_user ON user_daily_tasks(user_id, task_date);

CREATE TABLE IF NOT EXISTS casino_history (
    id         BIGSERIAL   PRIMARY KEY,
    user_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_type  TEXT        NOT NULL,
    bet        BIGINT      NOT NULL DEFAULT 0,
    reward     BIGINT      NOT NULL DEFAULT 0,
    result     TEXT        NOT NULL DEFAULT '',
    detail     TEXT        NOT NULL DEFAULT '',
    reference_id TEXT      UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_casino_history_user ON casino_history(user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_casino_history_game ON casino_history(user_id, game_type, created_at DESC);
"""

# --------------------------------------------------------------------------- #
#  2. Служебные таблицы приложения
# --------------------------------------------------------------------------- #
SERVICE_TABLES = """
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT        PRIMARY KEY,
    user_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    ip_hash    TEXT        NOT NULL DEFAULT '',
    agent      TEXT        NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT        PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    ip_hash    TEXT        NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS game_receipts (
    ref        TEXT        PRIMARY KEY,
    user_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_id    TEXT        NOT NULL,
    amount     BIGINT      NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS game_limits (
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_id TEXT   NOT NULL,
    day     DATE   NOT NULL,
    amount  BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, game_id, day)
);

CREATE TABLE IF NOT EXISTS casino_limits (
    user_id       BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    daily_limit   BIGINT NOT NULL DEFAULT 0,
    exclude_until TIMESTAMPTZ,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_log (
    id         BIGSERIAL   PRIMARY KEY,
    admin      TEXT        NOT NULL,
    action     TEXT        NOT NULL,
    target     TEXT        NOT NULL DEFAULT '',
    detail     TEXT        NOT NULL DEFAULT '',
    ip_hash    TEXT        NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_log_created ON admin_log(created_at DESC);

CREATE TABLE IF NOT EXISTS shop_orders (
    id           TEXT        PRIMARY KEY,
    user_id      BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider     TEXT        NOT NULL,
    pack         TEXT        NOT NULL,
    coins        BIGINT      NOT NULL,
    amount_minor BIGINT      NOT NULL,
    currency     TEXT        NOT NULL,
    status       TEXT        NOT NULL,
    provider_ref TEXT        NOT NULL DEFAULT '',
    claimed      BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    paid_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS shop_ledger (
    id           BIGSERIAL   PRIMARY KEY,
    order_id     TEXT        UNIQUE,
    user_id      BIGINT,
    coins        BIGINT,
    reason       TEXT        NOT NULL,
    provider_ref TEXT        NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
    key        TEXT   PRIMARY KEY,
    count      BIGINT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS turnstile_tokens (
    token_hash TEXT        PRIMARY KEY,
    used_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS schema_migrations (
    name    TEXT PRIMARY KEY,
    applied TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_actions (
    id         BIGSERIAL   PRIMARY KEY,
    admin_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
    action     TEXT        NOT NULL,
    entity     TEXT        NOT NULL DEFAULT '',
    entity_id  TEXT        NOT NULL DEFAULT '',
    payload    JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_actions_created ON admin_actions(created_at DESC);
"""

# --------------------------------------------------------------------------- #
#  3. Представления совместимости со старым кодом
# --------------------------------------------------------------------------- #
COMPAT_VIEWS = """
CREATE OR REPLACE VIEW coin_ledger AS
SELECT t.id                        AS id,
       t.user_id                   AS user_id,
       t.amount                    AS delta,
       t.balance_after             AS balance,
       t.description               AS reason,
       COALESCE(t.transaction_type, 'other') AS kind,
       t.reference_id              AS ref,
       EXTRACT(EPOCH FROM t.created_at)::BIGINT AS created
FROM transactions t;

CREATE OR REPLACE VIEW casino_bets AS
SELECT h.id                        AS id,
       h.user_id                   AS user_id,
       h.game_type                 AS game,
       h.bet                       AS stake,
       h.reward                    AS payout,
       h.result                    AS outcome,
       h.detail                    AS detail,
       EXTRACT(EPOCH FROM h.created_at)::BIGINT AS created
FROM casino_history h;

CREATE OR REPLACE VIEW game_stats AS
SELECT s.user_id                   AS user_id,
       s.game_id                   AS game,
       s.plays                     AS plays,
       s.score                     AS score,
       s.coins                     AS coins,
       EXTRACT(EPOCH FROM s.played_at)::BIGINT AS last_play
FROM game_statistics s;

CREATE OR REPLACE VIEW purchases AS
SELECT i.id                        AS id,
       i.user_id                   AS user_id,
       i.item_id                   AS item_id,
       COALESCE(t.price, 0)        AS price,
       EXTRACT(EPOCH FROM i.acquired_at)::BIGINT AS created
FROM inventory i LEFT JOIN items t ON t.id = i.item_id;

CREATE OR REPLACE VIEW shop_items AS
SELECT i.id            AS id,
       i.item_type     AS kind,
       i.name          AS name_ru,
       i.name_en       AS name_en,
       i.price         AS price,
       i.image         AS icon,
       i.payload       AS payload,
       CASE WHEN i.is_active THEN 1 ELSE 0 END AS on_sale,
       i.item_order    AS item_order
FROM items i;
"""

# Обратная совместимость: часть кода обращается к shop_items как к таблице и
# делает UPDATE … Сильно упрощаем: представления доступны только на чтение,
# поэтому запись в них идёт через db.py (WRITE_* функции).

ALL_SCHEMA = CORE_TABLES + SERVICE_TABLES

# Какой тип БД считается «каноническим»
STATEMENTS = [s.strip() for s in ALL_SCHEMA.split(';') if s.strip()]
