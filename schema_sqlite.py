#!/usr/bin/env python3
"""Vertu Games — та же схема, что в ``schema_sql.py``, но для SQLite.

SQLite используется только локально и в тестах (``tools/check_platform.py``,
``unittest``), когда ``DATABASE_URL`` не задан. Набор таблиц и колонок совпадает
с PostgreSQL, отличаются лишь типы, поэтому слой данных (``db.py``) пишется
одним SQL для обеих СУБД.

Отличия от PostgreSQL, которые компенсирует драйвер:

* ``TIMESTAMPTZ`` → ``TEXT`` с ISO-8601 (драйвер сам сериализует ``datetime``);
* ``JSONB`` → ``TEXT``;
* ``SELECT … FOR UPDATE`` → драйвер вырезает (в SQLite блокировка пишущая);
* ``BIGSERIAL`` → ``INTEGER PRIMARY KEY AUTOINCREMENT``.

Совместимые представления (``coin_ledger``, ``casino_bets``, ``game_stats``,
``purchases``, ``shop_items``) объявлены так же, как в PostgreSQL.
"""

SCHEMA_SQLITE = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL,
    username_key  TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL DEFAULT 'player',
    avatar        TEXT    NOT NULL DEFAULT 'av:rocket',
    color         TEXT    NOT NULL DEFAULT 'col:teal',
    title         TEXT    NOT NULL DEFAULT 't:new',
    experience    INTEGER NOT NULL DEFAULT 0,
    level         INTEGER NOT NULL DEFAULT 1,
    is_active     INTEGER NOT NULL DEFAULT 1,
    is_admin      INTEGER NOT NULL DEFAULT 0,
    banned        INTEGER NOT NULL DEFAULT 0,
    ban_reason    TEXT    NOT NULL DEFAULT '',
    legacy_email  TEXT    NOT NULL DEFAULT '',
    created_at    TEXT    NOT NULL,
    last_login    TEXT,
    last_seen     TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users(last_seen DESC);

CREATE TABLE IF NOT EXISTS wallets (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    balance    INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
    updated_at TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_wallets_balance ON wallets(balance DESC);

CREATE TABLE IF NOT EXISTS transactions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wallet_id        INTEGER REFERENCES wallets(id) ON DELETE SET NULL,
    amount           INTEGER NOT NULL,
    balance_after    INTEGER NOT NULL CHECK (balance_after >= 0),
    transaction_type TEXT    NOT NULL,
    description      TEXT    NOT NULL DEFAULT '',
    reference_id     TEXT    UNIQUE,
    created_at       TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(transaction_type, created_at DESC);

CREATE TABLE IF NOT EXISTS games (
    id          TEXT    PRIMARY KEY,
    name        TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    category    TEXT    NOT NULL DEFAULT '',
    file        TEXT    NOT NULL DEFAULT '',
    icon        TEXT    NOT NULL DEFAULT '',
    reward      INTEGER NOT NULL DEFAULT 0,
    daily_cap   INTEGER NOT NULL DEFAULT 0,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS game_statistics (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_id   TEXT    NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    score     INTEGER NOT NULL DEFAULT 0,
    plays     INTEGER NOT NULL DEFAULT 0,
    coins     INTEGER NOT NULL DEFAULT 0,
    played_at TEXT    NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_game_statistics_unique ON game_statistics(user_id, game_id);
CREATE INDEX IF NOT EXISTS idx_game_statistics_game ON game_statistics(game_id, score DESC);

CREATE TABLE IF NOT EXISTS achievements (
    id          TEXT    PRIMARY KEY,
    name        TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    icon        TEXT    NOT NULL DEFAULT 'trophy',
    reward      INTEGER NOT NULL DEFAULT 0,
    name_en     TEXT    NOT NULL DEFAULT '',
    desc_en     TEXT    NOT NULL DEFAULT '',
    item_order  INTEGER NOT NULL DEFAULT 0,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS user_achievements (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    achievement_id TEXT    NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
    unlocked_at    TEXT    NOT NULL,
    UNIQUE (user_id, achievement_id)
);
CREATE INDEX IF NOT EXISTS idx_user_achievements_user ON user_achievements(user_id, unlocked_at DESC);

CREATE TABLE IF NOT EXISTS items (
    id          TEXT    PRIMARY KEY,
    name        TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    item_type   TEXT    NOT NULL,
    rarity      TEXT    NOT NULL DEFAULT 'common',
    image       TEXT    NOT NULL DEFAULT '',
    price       INTEGER NOT NULL DEFAULT 0 CHECK (price >= 0),
    payload     TEXT    NOT NULL DEFAULT '',
    name_en     TEXT    NOT NULL DEFAULT '',
    is_active   INTEGER NOT NULL DEFAULT 1,
    item_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id     TEXT    NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    quantity    INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    acquired_at TEXT    NOT NULL,
    UNIQUE (user_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_inventory_user ON inventory(user_id, acquired_at DESC);

CREATE TABLE IF NOT EXISTS daily_tasks (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT    NOT NULL,
    description  TEXT    NOT NULL DEFAULT '',
    reward       INTEGER NOT NULL DEFAULT 0,
    task_type    TEXT    NOT NULL DEFAULT 'play',
    target_value INTEGER NOT NULL DEFAULT 1,
    title_en     TEXT    NOT NULL DEFAULT '',
    desc_en      TEXT    NOT NULL DEFAULT '',
    is_active    INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS user_daily_tasks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_id    INTEGER NOT NULL REFERENCES daily_tasks(id) ON DELETE CASCADE,
    progress   INTEGER NOT NULL DEFAULT 0,
    completed  INTEGER NOT NULL DEFAULT 0,
    claimed    INTEGER NOT NULL DEFAULT 0,
    task_date  TEXT    NOT NULL,
    updated_at TEXT    NOT NULL,
    UNIQUE (user_id, task_id, task_date)
);
CREATE INDEX IF NOT EXISTS idx_user_daily_tasks_user ON user_daily_tasks(user_id, task_date);

CREATE TABLE IF NOT EXISTS casino_history (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_type    TEXT    NOT NULL,
    bet          INTEGER NOT NULL DEFAULT 0,
    reward       INTEGER NOT NULL DEFAULT 0,
    result       TEXT    NOT NULL DEFAULT '',
    detail       TEXT    NOT NULL DEFAULT '',
    reference_id TEXT    UNIQUE,
    created_at   TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_casino_history_user ON casino_history(user_id, id DESC);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT    NOT NULL,
    expires_at TEXT    NOT NULL,
    ip_hash    TEXT    NOT NULL DEFAULT '',
    agent      TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    ip_hash    TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS game_receipts (
    ref        TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_id    TEXT    NOT NULL,
    amount     INTEGER NOT NULL,
    created_at TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS game_limits (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_id TEXT    NOT NULL,
    day     TEXT    NOT NULL,
    amount  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, game_id, day)
);

CREATE TABLE IF NOT EXISTS casino_limits (
    user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    daily_limit   INTEGER NOT NULL DEFAULT 0,
    exclude_until TEXT,
    updated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    admin      TEXT NOT NULL,
    action     TEXT NOT NULL,
    target     TEXT NOT NULL DEFAULT '',
    detail     TEXT NOT NULL DEFAULT '',
    ip_hash    TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shop_orders (
    id           TEXT    PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider     TEXT    NOT NULL,
    pack         TEXT    NOT NULL,
    coins        INTEGER NOT NULL,
    amount_minor INTEGER NOT NULL,
    currency     TEXT    NOT NULL,
    status       TEXT    NOT NULL,
    provider_ref TEXT    NOT NULL DEFAULT '',
    claimed      INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT    NOT NULL,
    paid_at      TEXT
);

CREATE TABLE IF NOT EXISTS shop_ledger (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id     TEXT    UNIQUE,
    user_id      INTEGER,
    coins        INTEGER,
    reason       TEXT    NOT NULL,
    provider_ref TEXT    NOT NULL DEFAULT '',
    created_at   TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS platform_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
    key        TEXT PRIMARY KEY,
    count      INTEGER NOT NULL,
    expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS turnstile_tokens (
    token_hash TEXT PRIMARY KEY,
    used_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_migrations (
    name    TEXT PRIMARY KEY,
    applied TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_actions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action     TEXT NOT NULL,
    entity     TEXT NOT NULL DEFAULT '',
    entity_id  TEXT NOT NULL DEFAULT '',
    payload    TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);

CREATE VIEW IF NOT EXISTS coin_ledger AS
SELECT id, user_id, amount AS delta, balance_after AS balance, description AS reason,
       transaction_type AS kind, reference_id AS ref,
       CAST(strftime('%s', created_at) AS INTEGER) AS created
FROM transactions;

CREATE VIEW IF NOT EXISTS casino_bets AS
SELECT id, user_id, game_type AS game, bet AS stake, reward AS payout, result AS outcome,
       detail AS detail, CAST(strftime('%s', created_at) AS INTEGER) AS created
FROM casino_history;

CREATE VIEW IF NOT EXISTS game_stats AS
SELECT user_id, game_id AS game, plays, score, coins,
       CAST(strftime('%s', played_at) AS INTEGER) AS last_play
FROM game_statistics;

CREATE VIEW IF NOT EXISTS purchases AS
SELECT i.id AS id, i.user_id AS user_id, i.item_id AS item_id,
       COALESCE(t.price, 0) AS price,
       CAST(strftime('%s', i.acquired_at) AS INTEGER) AS created
FROM inventory i LEFT JOIN items t ON t.id = i.item_id;

CREATE VIEW IF NOT EXISTS shop_items AS
SELECT id, item_type AS kind, name AS name_ru, name_en AS name_en, price AS price,
       image AS icon, payload AS payload, is_active AS on_sale, item_order AS item_order
FROM items;
"""
