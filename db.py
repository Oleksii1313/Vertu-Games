#!/usr/bin/env python3
"""Vertu Games — единый слой данных (PostgreSQL, SQLite для локального запуска).

Правила, которые соблюдает этот модуль:

* Баланс V-монет меняется ТОЛЬКО через :func:`add_coins` — внутри транзакции,
  с блокировкой строки пользователя, записью в ``coin_ledger`` и запретом
  отрицательного остатка.
* Каждая денежная операция имеет ``ref`` (уникальная ссылка). Повторный вызов с
  тем же ``ref`` не меняет баланс (идемпотентность) и возвращает признак повтора.
* Всё, что нужно для проверок прав (админ, бан), читается из БД, а не с клиента.

Драйвер выбирается по ``DATABASE_URL``:

    DATABASE_URL=postgres://user:pass@host:5432/db  → store_pg.PgDriver
    (не задан)                                      → store_sqlite.SqliteDriver

Оба драйвера исполняют один и тот же SQL: схема описана в одном месте,
``?``-плейсхолдеры конвертируются драйвером PostgreSQL.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import threading
import time
from datetime import datetime, timezone

# --------------------------------------------------------------------------- #
#  Настройки
# --------------------------------------------------------------------------- #
PBKDF2_ROUNDS = int(os.environ.get('PBKDF2_ROUNDS', '310000') or 310000)
SESSION_TTL = 30 * 24 * 3600          # 30 дней
ADMIN_SESSION_TTL = 2 * 3600          # 2 часа
WELCOME_COINS = int(os.environ.get('WELCOME_COINS', '100') or 100)
MAX_BALANCE = 100_000_000

USERNAME_RE = re.compile(r'^[A-Za-z0-9](?:[A-Za-z0-9 _.\-]{1,22})[A-Za-z0-9_.]$')
RESERVED_NAMES = {'admin', 'administrator', 'root', 'moderator', 'support', 'system',
                  'vertu', 'vertugames', 'null', 'undefined', 'constructor', 'prototype'}

# Схема. Идентична для PostgreSQL и SQLite; типы подобраны так, чтобы работать в обоих.
SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL,
    username_key  TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    coins         BIGINT  NOT NULL DEFAULT 0,
    is_admin      INTEGER NOT NULL DEFAULT 0,
    banned        INTEGER NOT NULL DEFAULT 0,
    ban_reason    TEXT    NOT NULL DEFAULT '',
    avatar        TEXT    NOT NULL DEFAULT 'av:rocket',
    color         TEXT    NOT NULL DEFAULT 'col:teal',
    title         TEXT    NOT NULL DEFAULT 't:new',
    created       BIGINT  NOT NULL,
    last_seen     BIGINT  NOT NULL DEFAULT 0,
    legacy_email  TEXT    NOT NULL DEFAULT '',
    casino_limit  BIGINT  NOT NULL DEFAULT 0,
    casino_exclude_until BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created    BIGINT  NOT NULL,
    expires    BIGINT  NOT NULL,
    ip_hash    TEXT    NOT NULL DEFAULT '',
    agent      TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires);

CREATE TABLE IF NOT EXISTS coin_ledger (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    delta   BIGINT  NOT NULL,
    balance BIGINT  NOT NULL,
    reason  TEXT    NOT NULL DEFAULT '',
    kind    TEXT    NOT NULL DEFAULT 'other',
    ref     TEXT,
    created BIGINT  NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_ref ON coin_ledger(ref);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON coin_ledger(user_id, id DESC);

CREATE TABLE IF NOT EXISTS game_stats (
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game      TEXT    NOT NULL,
    plays     INTEGER NOT NULL DEFAULT 0,
    score     BIGINT  NOT NULL DEFAULT 0,
    coins     BIGINT  NOT NULL DEFAULT 0,
    last_play BIGINT  NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, game)
);

CREATE TABLE IF NOT EXISTS game_receipts (
    ref     TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game    TEXT NOT NULL,
    amount  BIGINT NOT NULL,
    created BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS game_limits (
    user_id INTEGER NOT NULL,
    game    TEXT NOT NULL,
    day     TEXT NOT NULL,
    amount  BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, game, day)
);

CREATE TABLE IF NOT EXISTS shop_items (
    id       TEXT PRIMARY KEY,
    kind     TEXT    NOT NULL,
    name_ru  TEXT    NOT NULL,
    name_en  TEXT    NOT NULL,
    price    BIGINT  NOT NULL,
    icon     TEXT    NOT NULL DEFAULT '',
    payload  TEXT    NOT NULL DEFAULT '',
    on_sale  INTEGER NOT NULL DEFAULT 1,
    item_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS purchases (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id  TEXT    NOT NULL,
    price    BIGINT  NOT NULL,
    created  BIGINT  NOT NULL,
    UNIQUE (user_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_purchases_user ON purchases(user_id, id DESC);

CREATE TABLE IF NOT EXISTS achievements (
    id       TEXT PRIMARY KEY,
    name_ru  TEXT NOT NULL,
    name_en  TEXT NOT NULL,
    desc_ru  TEXT NOT NULL DEFAULT '',
    desc_en  TEXT NOT NULL DEFAULT '',
    icon     TEXT NOT NULL DEFAULT 'trophy',
    coins    BIGINT NOT NULL DEFAULT 0,
    item_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_achievements (
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ach_id      TEXT    NOT NULL,
    unlocked    BIGINT  NOT NULL,
    PRIMARY KEY (user_id, ach_id)
);

CREATE TABLE IF NOT EXISTS casino_bets (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game    TEXT    NOT NULL,
    stake   BIGINT  NOT NULL,
    payout  BIGINT  NOT NULL,
    outcome TEXT    NOT NULL DEFAULT '',
    detail  TEXT    NOT NULL DEFAULT '',
    created BIGINT  NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bets_user ON casino_bets(user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_bets_user_game ON casino_bets(user_id, game, id DESC);

CREATE TABLE IF NOT EXISTS casino_limits (
    user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    daily_limit BIGINT NOT NULL DEFAULT 0,
    exclude_until BIGINT NOT NULL DEFAULT 0,
    updated     BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS admin_log (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    admin   TEXT    NOT NULL,
    action  TEXT    NOT NULL,
    target  TEXT    NOT NULL DEFAULT '',
    detail  TEXT    NOT NULL DEFAULT '',
    ip_hash TEXT    NOT NULL DEFAULT '',
    created BIGINT  NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_log ON admin_log(id DESC);

CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT   PRIMARY KEY,
    created    BIGINT NOT NULL,
    expires    BIGINT NOT NULL,
    ip_hash    TEXT   NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS shop_orders (
    id          TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL,
    provider    TEXT    NOT NULL,
    pack        TEXT    NOT NULL,
    coins       BIGINT  NOT NULL,
    amount_minor BIGINT NOT NULL,
    currency    TEXT    NOT NULL,
    status      TEXT    NOT NULL,
    provider_ref TEXT   NOT NULL DEFAULT '',
    claimed     INTEGER NOT NULL DEFAULT 0,
    created     BIGINT  NOT NULL,
    paid        BIGINT
);
CREATE TABLE IF NOT EXISTS shop_ledger (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT,
    user_id  INTEGER,
    coins    BIGINT,
    reason   TEXT NOT NULL,
    provider_ref TEXT NOT NULL DEFAULT '',
    created  BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_shop_ledger_order ON shop_ledger(order_id);

CREATE TABLE IF NOT EXISTS platform_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
    key   TEXT PRIMARY KEY,
    count BIGINT NOT NULL,
    until BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_migrations (
    name    TEXT PRIMARY KEY,
    applied BIGINT NOT NULL
);
"""

# --------------------------------------------------------------------------- #
#  Ошибки
# --------------------------------------------------------------------------- #
class StoreError(Exception):
    """Базовая ошибка слоя данных."""


class DuplicateUser(StoreError):
    """Ник уже занят."""


class InvalidCredentials(StoreError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class InsufficientFunds(StoreError):
    """Недостаточно V-монет."""


class LimitExceeded(StoreError):
    """Превышен лимит (ставка, оборот, дневной лимит)."""


class NotFound(StoreError):
    """Запись не найдена."""


class AccountBanned(StoreError):
    """Аккаунт заблокирован."""


# --------------------------------------------------------------------------- #
#  Драйверы
# --------------------------------------------------------------------------- #
class SqliteDriver:
    """SQLite — для локального запуска и автотестов."""

    name = 'sqlite'

    def __init__(self, path: str):
        import sqlite3
        self.sqlite3 = sqlite3
        self.path = path
        if path != ':memory:':
            os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        self._lock = threading.Lock()
        self._shared = None
        if path == ':memory:':
            # Одно общее соединение, чтобы схема не терялась между запросами.
            self._shared = self._open()
            self._shared.executescript(SCHEMA)
            self._shared.commit()

    def _open(self):
        # :memory: — одно общее соединение, иначе схема терялась бы между потоками.
        if self._shared is not None:
            return self._shared
        # Драйвер используется и из нескольких потоков: соединение на поток.
        if getattr(self._local, 'conn', None) is not None:
            return self._local.conn
        c = self.sqlite3.connect(self.path if self.path != ':memory:' else ':memory:',
                                 timeout=20, check_same_thread=False)
        c.row_factory = self.sqlite3.Row
        c.execute('PRAGMA journal_mode=WAL')
        c.execute('PRAGMA synchronous=NORMAL')
        c.execute('PRAGMA foreign_keys=ON')
        c.execute('PRAGMA busy_timeout=20000')
        self._local.conn = c
        return c

    _local = threading.local()

    def connect(self):
        return self._open()

    def init(self):
        if self._shared is not None:
            self._shared.executescript(SCHEMA)
            self._shared.commit()
            return
        with self._lock:
            c = self.sqlite3.connect(self.path, timeout=20)
            try:
                c.executescript(SCHEMA)
                c.commit()
            finally:
                c.close()

    def transaction(self):
        return _SqliteTx(self)

    def close(self):
        if self._shared is not None:
            self._shared.close()


class _SqliteTx:
    def __init__(self, driver):
        self.driver = driver
        self.conn = None

    def __enter__(self):
        self.conn = self.driver._open()
        self.conn.execute('BEGIN IMMEDIATE')
        return _SqliteCursor(self.conn)

    def __exit__(self, exc_type, exc, tb):
        try:
            if exc_type is None:
                self.conn.commit()
            else:
                self.conn.rollback()
        finally:
            self.conn = None
        return False


class _SqliteCursor:
    def __init__(self, conn):
        self.conn = conn

    def execute(self, sql, params=()):
        cur = self.conn.execute(sql, tuple(params))
        return _SqliteRows(cur)

    def executescript(self, sql):
        self.conn.executescript(sql)

    def commit(self):
        self.conn.commit()

    def rollback(self):
        self.conn.rollback()


class _SqliteRows:
    def __init__(self, cur):
        self.cur = cur

    def fetchone(self):
        row = self.cur.fetchone()
        return dict(row) if row is not None else None

    def fetchall(self):
        return [dict(r) for r in self.cur.fetchall()]

    @property
    def rowcount(self):
        return self.cur.rowcount

    @property
    def lastrowid(self):
        return self.cur.lastrowid


class PgDriver:
    """PostgreSQL через psycopg 3 (пул соединений)."""

    name = 'postgresql'

    def __init__(self, url: str):
        import psycopg
        from psycopg_pool import ConnectionPool
        self._psycopg = psycopg
        dsn = url.replace('postgres://', 'postgresql://', 1)
        self.pool = ConnectionPool(dsn, min_size=1, max_size=int(os.environ.get('DB_POOL_SIZE', '10') or 10),
                                   timeout=15, open=True, kwargs={'autocommit': True})

    def _prepare(self, sql: str) -> str:
        # Один SQL на оба драйвера: ? → %s, кавычки для зарезервированных имён сняты.
        sql = sql.replace('?', '%s')
        sql = sql.replace('INTEGER PRIMARY KEY AUTOINCREMENT', 'BIGSERIAL PRIMARY KEY')
        return sql

    def connect(self):
        return _PgConn(self.pool)

    def init(self):
        with self.pool.connection() as conn:
            with conn.cursor() as cur:
                for statement in SCHEMA.split(';'):
                    text = statement.strip()
                    if not text:
                        continue
                    text = self._prepare(text)
                    try:
                        cur.execute(text)
                    except Exception as exc:  # noqa: BLE001 - показываем реальную причину
                        if 'already exists' in str(exc):
                            continue
                        raise

    def transaction(self):
        return _PgTx(self)

    def close(self):
        self.pool.close()


class _PgConn:
    def __init__(self, pool):
        self.pool = pool
        self.raw = pool.getconn()
        self.raw.autocommit = True

    def execute(self, sql, params=()):
        with self.raw.cursor() as cur:
            cur.execute(_pg_sql(sql), tuple(params))
            rows = None
            if cur.description:
                rows = [dict(zip([d.name for d in cur.description], r))
                        for r in cur.fetchall()]
            return _PgRows(rows, cur.rowcount)

    def executescript(self, sql):
        with self.raw.cursor() as cur:
            for statement in sql.split(';'):
                text = statement.strip()
                if text:
                    cur.execute(_pg_sql(text))

    def commit(self):
        self.raw.commit()

    def rollback(self):
        self.raw.rollback()

    def close(self):
        self.pool.putconn(self.raw)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        try:
            if exc_type is None:
                self.raw.commit()
            else:
                self.raw.rollback()
        finally:
            self.close()
        return False


def _pg_sql(sql: str) -> str:
    sql = sql.replace('?', '%s')
    return sql


class _PgRows:
    def __init__(self, rows, rowcount):
        self.rows = rows or []
        self._rowcount = rowcount

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def fetchall(self):
        return self.rows

    @property
    def rowcount(self):
        return self._rowcount

    @property
    def lastrowid(self):
        return None


class _PgTx:
    def __init__(self, driver):
        self.driver = driver
        self.conn = None

    def __enter__(self):
        self.conn = self.driver.connect()
        self.conn.raw.autocommit = False
        return self.conn

    def __exit__(self, exc_type, exc, tb):
        try:
            if exc_type is None:
                self.conn.raw.commit()
            else:
                self.conn.raw.rollback()
        finally:
            self.conn.close()
        return False


# --------------------------------------------------------------------------- #
#  Публичный API
# --------------------------------------------------------------------------- #
def now() -> int:
    return int(time.time())


def today() -> str:
    return datetime.now(timezone.utc).strftime('%Y-%m-%d')


def hash_password(password: str) -> str:
    """pbkdf2_sha256$<rounds>$<salt>$<hash> — формат совместим с прежней базой."""
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), PBKDF2_ROUNDS).hex()
    return f'pbkdf2_sha256${PBKDF2_ROUNDS}${salt}${digest}'


def verify_password(password: str, stored: str) -> bool:
    try:
        alg, rounds, salt, expected = str(stored).split('$')
        if alg != 'pbkdf2_sha256':
            return False
        actual = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), int(rounds)).hex()
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError, AttributeError):
        return False


def digest(value: str) -> str:
    return hashlib.sha256(str(value).encode()).hexdigest()


def valid_username(name) -> bool:
    if not isinstance(name, str):
        return False
    name = name.strip()
    if not USERNAME_RE.match(name):
        return False
    if name.casefold() in RESERVED_NAMES:
        return False
    if '  ' in name or re.search(r'[\x00-\x1f]', name):
        return False
    return True


def valid_password(password) -> bool:
    return isinstance(password, str) and 8 <= len(password) <= 128


class DataStore:
    """Высокоуровневый API поверх драйвера. Один экземпляр на процесс."""

    def __init__(self, driver):
        self.driver = driver
        self.driver.init()
        self._migrations()
        self._seed()

    # ---------------------------------------------------------------- migrations
    # Каждая миграция идемпотентна и записывается в schema_migrations, поэтому
    # повторный запуск на существующей базе ничего не ломает.
    MIGRATIONS = (
        ('0001_base_schema', ()),
        ('0002_users_profile_columns', (
            "ALTER TABLE users ADD COLUMN avatar TEXT NOT NULL DEFAULT 'av:rocket'",
            "ALTER TABLE users ADD COLUMN color TEXT NOT NULL DEFAULT 'col:teal'",
            "ALTER TABLE users ADD COLUMN title TEXT NOT NULL DEFAULT 't:new'",
            "ALTER TABLE users ADD COLUMN casino_limit BIGINT NOT NULL DEFAULT 0",
            "ALTER TABLE users ADD COLUMN casino_exclude_until BIGINT NOT NULL DEFAULT 0",
            "ALTER TABLE users ADD COLUMN legacy_email TEXT NOT NULL DEFAULT ''",
        )),
    )

    def _migrations(self):
        with self.driver.transaction() as c:
            done = {row['name'] for row in c.execute('SELECT name FROM schema_migrations').fetchall()}
        for name, statements in self.MIGRATIONS:
            if name in done:
                continue
            for statement in statements:
                try:
                    with self.driver.transaction() as c:
                        c.execute(statement)
                except Exception:  # noqa: BLE001 - колонка уже есть в старой базе
                    pass
            with self.driver.transaction() as c:
                c.execute('INSERT INTO schema_migrations(name,applied) VALUES(?,?)', (name, now()))

    # ---------------------------------------------------------------- constants
    @property
    def backend(self) -> str:
        return self.driver.name

    # ---------------------------------------------------------------- seed data
    def _seed(self):
        from game_catalog import ACHIEVEMENTS, SHOP_ITEMS, SHOP_PACKS
        with self.driver.transaction() as c:
            for item in SHOP_ITEMS:
                existing = c.execute('SELECT id FROM shop_items WHERE id=?', (item['id'],)).fetchone()
                if existing:
                    c.execute('UPDATE shop_items SET kind=?,name_ru=?,name_en=?,price=?,icon=?,payload=?,'
                              'on_sale=?,item_order=? WHERE id=?',
                              (item['kind'], item['name_ru'], item['name_en'], item['price'],
                               item['icon'], item.get('payload', ''), 1, item.get('order', 0), item['id']))
                else:
                    c.execute('INSERT INTO shop_items(id,kind,name_ru,name_en,price,icon,payload,on_sale,item_order)'
                              ' VALUES(?,?,?,?,?,?,?,1,?)',
                              (item['id'], item['kind'], item['name_ru'], item['name_en'], item['price'],
                               item['icon'], item.get('payload', ''), item.get('order', 0)))
            for ach in ACHIEVEMENTS:
                existing = c.execute('SELECT id FROM achievements WHERE id=?', (ach['id'],)).fetchone()
                if existing:
                    c.execute('UPDATE achievements SET name_ru=?,name_en=?,desc_ru=?,desc_en=?,icon=?,coins=?,'
                              'item_order=? WHERE id=?',
                              (ach['name_ru'], ach['name_en'], ach['desc_ru'], ach['desc_en'],
                               ach['icon'], ach['coins'], ach.get('order', 0), ach['id']))
                else:
                    c.execute('INSERT INTO achievements(id,name_ru,name_en,desc_ru,desc_en,icon,coins,item_order)'
                              ' VALUES(?,?,?,?,?,?,?,?)',
                              (ach['id'], ach['name_ru'], ach['name_en'], ach['desc_ru'], ach['desc_en'],
                               ach['icon'], ach['coins'], ach.get('order', 0)))
            packs = json.dumps(SHOP_PACKS, ensure_ascii=False)
            row = c.execute('SELECT value FROM platform_settings WHERE key=?', ('shop_packs',)).fetchone()
            if row:
                c.execute('UPDATE platform_settings SET value=? WHERE key=?', (packs, 'shop_packs'))
            else:
                c.execute('INSERT INTO platform_settings(key,value) VALUES(?,?)', ('shop_packs', packs))
            for key, value in (('casino_enabled', '1'), ('wheel_enabled', '1'), ('slots_enabled', '1'),
                               ('min_stake', '5'), ('max_stake', '100'), ('wheel_free_daily', '1')):
                if not c.execute('SELECT 1 FROM platform_settings WHERE key=?', (key,)).fetchone():
                    c.execute('INSERT INTO platform_settings(key,value) VALUES(?,?)', (key, value))
        self.ensure_admin()

    def ensure_admin(self):
        """Первый администратор: из ADMIN_USERNAME, если аккаунта ещё нет.

        Существующие ники и пароли не меняются — это требование проекта.
        """
        name = (os.environ.get('ADMIN_USERNAME') or '').strip()
        if not name or not valid_username(name):
            return
        password = os.environ.get('ADMIN_PASSWORD') or ''
        with self.driver.transaction() as c:
            row = c.execute('SELECT id,is_admin FROM users WHERE username_key=?', (name.casefold(),)).fetchone()
            if row:
                if not row['is_admin']:
                    c.execute('UPDATE users SET is_admin=1 WHERE id=?', (row['id'],))
                return
            if len(password) < 8:
                return
            c.execute('INSERT INTO users(username,username_key,password_hash,coins,is_admin,created)'
                      ' VALUES(?,?,?,?,1,?)',
                      (name, name.casefold(), hash_password(password), 0, now()))

    # ---------------------------------------------------------------- settings
    def get_setting(self, key: str, default: str = '') -> str:
        with self.driver.transaction() as c:
            row = c.execute('SELECT value FROM platform_settings WHERE key=?', (key,)).fetchone()
        return row['value'] if row else default

    def set_setting(self, key: str, value: str):
        with self.driver.transaction() as c:
            if c.execute('SELECT 1 FROM platform_settings WHERE key=?', (key,)).fetchone():
                c.execute('UPDATE platform_settings SET value=? WHERE key=?', (str(value), key))
            else:
                c.execute('INSERT INTO platform_settings(key,value) VALUES(?,?)', (key, str(value)))

    def settings_map(self):
        with self.driver.transaction() as c:
            return {r['key']: r['value'] for r in c.execute('SELECT key,value FROM platform_settings').fetchall()}

    # ---------------------------------------------------------------- users
    def find_user(self, identifier: str):
        key = str(identifier or '').strip().casefold()
        if not key:
            return None
        with self.driver.transaction() as c:
            return c.execute('SELECT * FROM users WHERE username_key=?', (key,)).fetchone()

    def get_user(self, user_id: int):
        with self.driver.transaction() as c:
            return c.execute('SELECT * FROM users WHERE id=?', (int(user_id),)).fetchone()

    def username_taken(self, username: str) -> bool:
        with self.driver.transaction() as c:
            return bool(c.execute('SELECT 1 FROM users WHERE username_key=?',
                                  (str(username).strip().casefold(),)).fetchone())

    def create_user(self, username: str, password: str, coins: int = WELCOME_COINS,
                    is_admin: bool = False, legacy_email: str = ''):
        name = username.strip()
        if not valid_username(name):
            raise StoreError('Некорректный ник')
        if not valid_password(password):
            raise StoreError('Пароль должен содержать 8–128 символов')
        key = name.casefold()
        pwd = hash_password(password)
        ts = now()
        with self.driver.transaction() as c:
            if c.execute('SELECT 1 FROM users WHERE username_key=?', (key,)).fetchone():
                raise DuplicateUser('Ник уже занят')
            c.execute('INSERT INTO users(username,username_key,password_hash,coins,is_admin,created,last_seen,legacy_email)'
                      ' VALUES(?,?,?,?,?,?,?,?)',
                      (name, key, pwd, 0, 1 if is_admin else 0, ts, ts, legacy_email[:254]))
            row = c.execute('SELECT * FROM users WHERE username_key=?', (key,)).fetchone()
            if coins:
                self._apply_delta(c, row['id'], int(coins), 'welcome', 'Приветственный бонус', f'welcome:{row["id"]}')
            updated = c.execute('SELECT * FROM users WHERE id=?', (row['id'],)).fetchone()
        return updated

    def authenticate(self, username: str, password: str):
        user = self.find_user(username)
        if not user:
            # Тратим время на хеш, чтобы ответ не выдавал существование ника.
            verify_password(password if isinstance(password, str) else '', hash_password('x'))
            raise InvalidCredentials('INVALID', 'Неверный ник или пароль')
        if not isinstance(password, str) or not verify_password(password, user['password_hash']):
            raise InvalidCredentials('INVALID', 'Неверный ник или пароль')
        if user['banned']:
            raise AccountBanned(user['ban_reason'] or 'Аккаунт заблокирован')
        return user

    def set_password(self, user_id: int, password: str):
        if not valid_password(password):
            raise StoreError('Пароль должен содержать 8–128 символов')
        with self.driver.transaction() as c:
            c.execute('UPDATE users SET password_hash=? WHERE id=?', (hash_password(password), int(user_id)))
            c.execute('DELETE FROM sessions WHERE user_id=?', (int(user_id),))

    def update_profile(self, user_id: int, avatar=None, color=None, title=None):
        fields, params = [], []
        for column, value in (('avatar', avatar), ('color', color), ('title', title)):
            if value is not None:
                fields.append(f'{column}=?')
                params.append(str(value)[:64])
        if not fields:
            return
        params.append(int(user_id))
        with self.driver.transaction() as c:
            c.execute(f'UPDATE users SET {", ".join(fields)} WHERE id=?', params)

    def ban_user(self, user_id: int, banned: bool, reason: str = ''):
        with self.driver.transaction() as c:
            c.execute('UPDATE users SET banned=?, ban_reason=? WHERE id=?',
                      (1 if banned else 0, reason[:200], int(user_id)))
            if banned:
                c.execute('DELETE FROM sessions WHERE user_id=?', (int(user_id),))

    def touch(self, user_id: int):
        with self.driver.transaction() as c:
            c.execute('UPDATE users SET last_seen=? WHERE id=?', (now(), int(user_id)))

    def balance(self, user_id: int) -> int:
        with self.driver.transaction() as c:
            row = c.execute('SELECT coins FROM users WHERE id=?', (int(user_id),)).fetchone()
        return int(row['coins']) if row else 0

    # ---------------------------------------------------------------- money
    def _apply_delta(self, c, user_id: int, delta: int, kind: str, reason: str, ref: str | None):
        row = c.execute('SELECT coins FROM users WHERE id=?', (int(user_id),)).fetchone()
        if row is None:
            raise NotFound('Пользователь не найден')
        before = int(row['coins'])
        after = before + int(delta)
        if after < 0:
            raise InsufficientFunds('Недостаточно V-монет')
        if after > MAX_BALANCE:
            raise LimitExceeded('Баланс превышает допустимый максимум')
        c.execute('UPDATE users SET coins=? WHERE id=?', (after, int(user_id)))
        c.execute('INSERT INTO coin_ledger(user_id,delta,balance,reason,kind,ref,created)'
                  ' VALUES(?,?,?,?,?,?,?)',
                  (int(user_id), int(delta), after, reason[:160], kind[:24], ref, now()))
        return after

    def add_coins(self, user_id: int, delta: int, kind: str = 'other', reason: str = '',
                  ref: str | None = None) -> dict:
        """Изменить баланс в транзакции. ``ref`` делает операцию идемпотентной."""
        delta = int(delta)
        if delta == 0:
            return {'balance': self.balance(user_id), 'repeated': False, 'ledger_id': None}
        try:
            with self.driver.transaction() as c:
                if ref:
                    row = c.execute('SELECT id FROM coin_ledger WHERE ref=?', (ref,)).fetchone()
                    if row:
                        bal = c.execute('SELECT coins FROM users WHERE id=?', (int(user_id),)).fetchone()
                        return {'balance': int(bal['coins']) if bal else 0, 'repeated': True,
                                'ledger_id': row['id']}
                balance = self._apply_delta(c, user_id, delta, kind, reason, ref)
                row = c.execute('SELECT id FROM coin_ledger WHERE user_id=? ORDER BY id DESC LIMIT 1',
                                (int(user_id),)).fetchone()
                return {'balance': balance, 'repeated': False, 'ledger_id': row['id'] if row else None}
        except Exception as exc:
            if ref and 'unique' in str(exc).lower():
                return {'balance': self.balance(user_id), 'repeated': True, 'ledger_id': None}
            raise

    def set_balance(self, user_id: int, value: int, kind: str = 'admin', reason: str = 'admin set') -> int:
        value = max(0, min(MAX_BALANCE, int(value)))
        current = self.balance(user_id)
        result = self.add_coins(user_id, value - current, kind, reason)
        return result['balance']

    def ledger(self, user_id: int, limit: int = 30, offset: int = 0):
        with self.driver.transaction() as c:
            rows = c.execute('SELECT id,delta,balance,reason,kind,created FROM coin_ledger'
                             ' WHERE user_id=? ORDER BY id DESC LIMIT ? OFFSET ?',
                             (int(user_id), max(1, min(200, int(limit))), max(0, int(offset)))).fetchall()
        return rows

    def ledger_count(self, user_id: int) -> int:
        with self.driver.transaction() as c:
            row = c.execute('SELECT COUNT(*) AS n FROM coin_ledger WHERE user_id=?', (int(user_id),)).fetchone()
        return int(row['n']) if row else 0

    # ---------------------------------------------------------------- sessions
    def new_session(self, user_id: int, ttl: int = SESSION_TTL, ip: str = '', agent: str = '') -> str:
        token = secrets.token_urlsafe(32)
        ts = now()
        with self.driver.transaction() as c:
            c.execute('DELETE FROM sessions WHERE expires<?', (ts,))
            c.execute('INSERT INTO sessions(token_hash,user_id,created,expires,ip_hash,agent)'
                      ' VALUES(?,?,?,?,?,?)',
                      (digest(token), int(user_id), ts, ts + int(ttl),
                       digest(ip) if ip else '', str(agent)[:160]))
        return token

    def user_for_token(self, token: str):
        if not token:
            return None
        with self.driver.transaction() as c:
            row = c.execute('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id'
                            ' WHERE s.token_hash=? AND s.expires>?', (digest(token), now())).fetchone()
            if row:
                c.execute('UPDATE sessions SET expires=? WHERE token_hash=?',
                          (now() + SESSION_TTL, digest(token)))
        return row

    def delete_session(self, token: str):
        if not token:
            return
        with self.driver.transaction() as c:
            c.execute('DELETE FROM sessions WHERE token_hash=?', (digest(token),))

    def delete_all_sessions(self, user_id: int):
        with self.driver.transaction() as c:
            c.execute('DELETE FROM sessions WHERE user_id=?', (int(user_id),))

    # ---------------------------------------------------------------- rate limit
    def find_user_by_legacy_email(self, email: str):
        """Поиск перенесённого аккаунта по старому email (для входа по email)."""
        key = str(email or '').strip().casefold()
        if not key or '@' not in key:
            return None
        with self.driver.transaction() as c:
            return c.execute('SELECT * FROM users WHERE LOWER(legacy_email)=?', (key,)).fetchone()

    def import_legacy_user(self, username: str, password_hash: str, coins: int = 0,
                           is_admin: bool = False, legacy_email: str = '',
                           created: int = 0, banned: bool = False) -> str:
        """Импорт аккаунта из старой базы. Возвращает 'created' | 'exists' | 'conflict'.

        Хеш пароля переносится как есть (формат pbkdf2_sha256$rounds$salt$hash
        совместим), поэтому старый пароль продолжает работать.
        """
        name = str(username or '').strip()
        if not valid_username(name):
            return 'conflict'
        if not str(password_hash or '').startswith('pbkdf2_sha256$'):
            return 'conflict'
        key = name.casefold()
        ts = now()
        with self.driver.transaction() as c:
            existing = c.execute('SELECT * FROM users WHERE username_key=?', (key,)).fetchone()
            if existing:
                if existing['password_hash'] == password_hash:
                    if legacy_email and not existing['legacy_email']:
                        c.execute('UPDATE users SET legacy_email=? WHERE id=?',
                                  (legacy_email[:254], existing['id']))
                    return 'exists'
                return 'conflict'
            c.execute('INSERT INTO users(username,username_key,password_hash,coins,is_admin,created,last_seen,'
                      'banned,legacy_email) VALUES(?,?,?,?,?,?,?,?,?)',
                      (name, key, password_hash, 0, 1 if is_admin else 0, int(created) or ts, ts,
                       1 if banned else 0, str(legacy_email or '')[:254]))
            row = c.execute('SELECT id FROM users WHERE username_key=?', (key,)).fetchone()
            if coins:
                self._apply_delta(c, row['id'], int(coins), 'import', 'Перенос баланса из старой базы',
                                  f'import:{row["id"]}')
        return 'created'

    def rate_limit(self, key: str, limit: int, seconds: int) -> bool:
        """True — попытка разрешена."""
        ts = now()
        with self.driver.transaction() as c:
            c.execute('DELETE FROM rate_limits WHERE until<?', (ts,))
            row = c.execute('SELECT count,until FROM rate_limits WHERE key=?', (key,)).fetchone()
            if row and int(row['until']) > ts and int(row['count']) >= limit:
                return False
            if row and int(row['until']) > ts:
                c.execute('UPDATE rate_limits SET count=count+1 WHERE key=?', (key,))
            else:
                if row:
                    c.execute('DELETE FROM rate_limits WHERE key=?', (key,))
                c.execute('INSERT INTO rate_limits(key,count,until) VALUES(?,?,?)',
                          (key, 1, ts + int(seconds)))
        return True

    def rate_reset(self, key: str):
        with self.driver.transaction() as c:
            c.execute('DELETE FROM rate_limits WHERE key=?', (key,))

    rate_forget = rate_reset

    # ---------------------------------------------------------------- games
    def record_play(self, user_id: int, game: str, score: int = 0):
        ts = now()
        with self.driver.transaction() as c:
            row = c.execute('SELECT plays,score FROM game_stats WHERE user_id=? AND game=?',
                            (int(user_id), game)).fetchone()
            if row:
                best = max(int(row['score'] or 0), int(score))
                c.execute('UPDATE game_stats SET plays=plays+1, score=?, last_play=?'
                          ' WHERE user_id=? AND game=?', (best, ts, int(user_id), game))
            else:
                c.execute('INSERT INTO game_stats(user_id,game,plays,score,coins,last_play)'
                          ' VALUES(?,?,1,?,0,?)', (int(user_id), game, int(score), ts))

    def game_reward(self, user_id: int, game: str, amount: int, ref: str, reason: str,
                    daily_cap: int) -> dict:
        """Начислить награду за игру с идемпотентностью и суточным лимитом."""
        amount = int(amount)
        if amount <= 0:
            raise StoreError('Некорректная награда')
        day = today()
        with self.driver.transaction() as c:
            existing = c.execute('SELECT user_id FROM game_receipts WHERE ref=?', (ref,)).fetchone()
            if existing:
                bal = c.execute('SELECT coins FROM users WHERE id=?', (int(user_id),)).fetchone()
                return {'balance': int(bal['coins']) if bal else 0, 'repeated': True, 'awarded': 0}
            spent = c.execute('SELECT amount FROM game_limits WHERE user_id=? AND game=? AND day=?',
                              (int(user_id), game, day)).fetchone()
            already = int(spent['amount']) if spent else 0
            if daily_cap and already >= daily_cap:
                return {'balance': self.balance(user_id), 'repeated': False, 'awarded': 0,
                        'capped': True, 'daily_left': 0}
            allowed = amount
            if daily_cap:
                allowed = min(amount, max(0, daily_cap - already))
            c.execute('INSERT INTO game_receipts(ref,user_id,game,amount,created) VALUES(?,?,?,?,?)',
                      (ref, int(user_id), game, allowed, now()))
            if spent:
                c.execute('UPDATE game_limits SET amount=amount+? WHERE user_id=? AND game=? AND day=?',
                          (allowed, int(user_id), game, day))
            else:
                c.execute('INSERT INTO game_limits(user_id,game,day,amount) VALUES(?,?,?,?)',
                          (int(user_id), game, day, allowed))
            balance = 0
            if allowed:
                balance = self._apply_delta(c, int(user_id), allowed, 'game', reason,
                                            f'game:{ref}')
            else:
                balance = self.balance(user_id)
            c.execute('UPDATE game_stats SET coins=coins+? WHERE user_id=? AND game=?',
                      (allowed, int(user_id), game))
            left = (daily_cap - already - allowed) if daily_cap else None
        return {'balance': balance, 'repeated': False, 'awarded': allowed, 'daily_left': left}

    def game_stats(self, user_id: int):
        with self.driver.transaction() as c:
            return c.execute('SELECT game,plays,score,coins,last_play FROM game_stats'
                             ' WHERE user_id=? ORDER BY last_play DESC', (int(user_id),)).fetchall()

    def plays_total(self, user_id: int) -> int:
        with self.driver.transaction() as c:
            row = c.execute('SELECT COALESCE(SUM(plays),0) AS n FROM game_stats WHERE user_id=?',
                            (int(user_id),)).fetchone()
        return int(row['n']) if row else 0

    # ---------------------------------------------------------------- shop
    def shop_items(self):
        with self.driver.transaction() as c:
            return c.execute('SELECT * FROM shop_items WHERE on_sale=1 ORDER BY item_order, price').fetchall()

    def purchases(self, user_id: int):
        with self.driver.transaction() as c:
            return c.execute('SELECT p.item_id,p.price,p.created,s.kind,s.name_ru,s.name_en,s.icon,s.payload'
                             ' FROM purchases p LEFT JOIN shop_items s ON s.id=p.item_id'
                             ' WHERE p.user_id=? ORDER BY p.id DESC', (int(user_id),)).fetchall()

    def owned_ids(self, user_id: int) -> set:
        with self.driver.transaction() as c:
            rows = c.execute('SELECT item_id FROM purchases WHERE user_id=?', (int(user_id),)).fetchall()
        return {r['item_id'] for r in rows}

    def buy_item(self, user_id: int, item_id: str) -> dict:
        with self.driver.transaction() as c:
            item = c.execute('SELECT * FROM shop_items WHERE id=? AND on_sale=1', (str(item_id),)).fetchone()
            if not item:
                raise NotFound('Товар не найден')
            if c.execute('SELECT 1 FROM purchases WHERE user_id=? AND item_id=?',
                         (int(user_id), item['id'])).fetchone():
                row = c.execute('SELECT coins FROM users WHERE id=?', (int(user_id),)).fetchone()
                return {'already': True, 'balance': int(row['coins']) if row else 0, 'item': item}
            price = int(item['price'])
            if price > 0:
                self._apply_delta(c, int(user_id), -price, 'shop', f'Куплено: {item["name_ru"]}',
                                  f'buy:{int(user_id)}:{item["id"]}')
            c.execute('INSERT INTO purchases(user_id,item_id,price,created) VALUES(?,?,?,?)',
                      (int(user_id), item['id'], price, now()))
            balance = c.execute('SELECT coins FROM users WHERE id=?', (int(user_id),)).fetchone()['coins']
        return {'already': False, 'balance': int(balance), 'item': item}

    # ---------------------------------------------------------------- achievements
    def achievements(self):
        with self.driver.transaction() as c:
            return c.execute('SELECT * FROM achievements ORDER BY item_order').fetchall()

    def user_achievements(self, user_id: int):
        with self.driver.transaction() as c:
            rows = c.execute('SELECT a.*, ua.unlocked FROM user_achievements ua'
                             ' JOIN achievements a ON a.id=ua.ach_id WHERE ua.user_id=?'
                             ' ORDER BY ua.unlocked DESC', (int(user_id),)).fetchall()
        return rows

    def unlock_achievement(self, user_id: int, ach_id: str) -> dict | None:
        with self.driver.transaction() as c:
            ach = c.execute('SELECT * FROM achievements WHERE id=?', (ach_id,)).fetchone()
            if not ach:
                return None
            if c.execute('SELECT 1 FROM user_achievements WHERE user_id=? AND ach_id=?',
                         (int(user_id), ach_id)).fetchone():
                return None
            c.execute('INSERT INTO user_achievements(user_id,ach_id,unlocked) VALUES(?,?,?)',
                      (int(user_id), ach_id, now()))
            if int(ach['coins']) > 0:
                self._apply_delta(c, int(user_id), int(ach['coins']), 'achievement',
                                  f'Достижение: {ach["name_ru"]}', f'ach:{int(user_id)}:{ach_id}')
            balance = c.execute('SELECT coins FROM users WHERE id=?', (int(user_id),)).fetchone()['coins']
        return {'achievement': ach, 'balance': int(balance)}

    def recent_achievements(self, limit: int = 10):
        with self.driver.transaction() as c:
            return c.execute('SELECT a.name_ru,a.name_en,a.icon,a.coins,ua.unlocked,u.username'
                             ' FROM user_achievements ua JOIN achievements a ON a.id=ua.ach_id'
                             ' JOIN users u ON u.id=ua.user_id ORDER BY ua.unlocked DESC LIMIT ?',
                             (max(1, min(50, int(limit))),)).fetchall()

    # ---------------------------------------------------------------- casino
    def casino_bet(self, user_id: int, game: str, stake: int, outcome: str, detail: str,
                   payout: int, ref: str, charge: int | None = None,
                   free_key: str | None = None) -> dict:
        """Провести ставку: списать, записать, начислить выигрыш — всё в одной транзакции.

        ``charge`` — сколько реально списать (0 для бесплатного спина),
        ``free_key`` — ключ настройки, который занимается атомарно (бесплатный спин дня).
        """
        stake, payout = int(stake), int(payout)
        charge = stake if charge is None else max(0, int(charge))
        with self.driver.transaction() as c:
            existing = c.execute('SELECT * FROM casino_bets WHERE user_id=? AND detail=? ORDER BY id DESC LIMIT 1',
                                 (int(user_id), ref)).fetchone()
            if existing:
                row = c.execute('SELECT coins FROM users WHERE id=?', (int(user_id),)).fetchone()
                return {'repeated': True, 'balance': int(row['coins']) if row else 0, 'bet': existing}
            cfg = {r['key']: r['value'] for r in c.execute(
                'SELECT key,value FROM platform_settings').fetchall()}
            if cfg.get('casino_enabled', '1') != '1':
                raise LimitExceeded('Казино временно отключено')
            if cfg.get(f'{game}_enabled', '1') != '1':
                raise LimitExceeded('Этот автомат временно отключён')
            min_stake = int(cfg.get('min_stake', '5') or 5)
            max_stake = int(cfg.get('max_stake', '100') or 100)
            if stake < min_stake or stake > max_stake:
                raise LimitExceeded(f'Ставка должна быть от {min_stake} до {max_stake} V')
            user = c.execute('SELECT casino_exclude_until,casino_limit,coins FROM users WHERE id=?',
                             (int(user_id),)).fetchone()
            if user and int(user['casino_exclude_until'] or 0) > now():
                raise LimitExceeded('Вы добровольно ограничили игру в казино')
            if free_key:
                if c.execute('SELECT 1 FROM platform_settings WHERE key=?', (free_key,)).fetchone():
                    raise LimitExceeded('Бесплатный спин уже использован сегодня')
                c.execute('INSERT INTO platform_settings(key,value) VALUES(?,?)', (free_key, now()))
            daily = int(user['casino_limit'] or 0) if user else 0
            if daily > 0 and charge > 0:
                spent = c.execute('SELECT COALESCE(SUM(stake),0) AS s FROM casino_bets'
                                  ' WHERE user_id=? AND created>=?', (int(user_id), now() - 86400)).fetchone()
                if int(spent['s']) + charge > daily:
                    raise LimitExceeded(f'Дневной лимит ставок {daily} V исчерпан')
            if charge > 0:
                self._apply_delta(c, int(user_id), -charge, 'casino', f'Ставка: {game}', f'bet:{ref}')
            if payout > 0:
                self._apply_delta(c, int(user_id), payout, 'casino-win', f'Выигрыш: {game}',
                                  f'win:{ref}')
            c.execute('INSERT INTO casino_bets(user_id,game,stake,payout,outcome,detail,created)'
                      ' VALUES(?,?,?,?,?,?,?)',
                      (int(user_id), game, stake, payout, outcome[:120], ref, now()))
            row = c.execute('SELECT coins FROM users WHERE id=?', (int(user_id),)).fetchone()
            balance = int(row['coins']) if row else 0
        return {'repeated': False, 'balance': balance, 'stake': stake, 'charge': charge,
                'payout': payout}

    def casino_history(self, user_id: int, limit: int = 25, game: str | None = None):
        with self.driver.transaction() as c:
            if game:
                rows = c.execute('SELECT * FROM casino_bets WHERE user_id=? AND game=?'
                                 ' ORDER BY id DESC LIMIT ?',
                                 (int(user_id), game, max(1, min(200, int(limit))))).fetchall()
            else:
                rows = c.execute('SELECT * FROM casino_bets WHERE user_id=? ORDER BY id DESC LIMIT ?',
                                 (int(user_id), max(1, min(200, int(limit))))).fetchall()
        return rows

    def casino_stats(self, user_id: int):
        with self.driver.transaction() as c:
            row = c.execute('SELECT COUNT(*) AS bets, COALESCE(SUM(stake),0) AS staked,'
                            ' COALESCE(SUM(payout),0) AS won, COALESCE(MAX(payout),0) AS best'
                            ' FROM casino_bets WHERE user_id=?', (int(user_id),)).fetchone()
            today_row = c.execute('SELECT COALESCE(SUM(stake),0) AS s FROM casino_bets'
                                  ' WHERE user_id=? AND created>=?', (int(user_id), now() - 86400)).fetchone()
        stats = dict(row or {})
        stats['today_staked'] = int(today_row['s']) if today_row else 0
        return stats

    def casino_limits(self, user_id: int):
        with self.driver.transaction() as c:
            row = c.execute('SELECT casino_limit,casino_exclude_until FROM users WHERE id=?',
                            (int(user_id),)).fetchone()
            last = c.execute('SELECT MAX(created) AS t FROM casino_bets WHERE user_id=? AND game=?',
                             (int(user_id), 'daily')).fetchone()
        out = {'daily_limit': int(row['casino_limit'] or 0) if row else 0,
               'exclude_until': int(row['casino_exclude_until'] or 0) if row else 0,
               'next_free_spin': 0}
        return out

    def set_casino_limits(self, user_id: int, daily_limit=None, exclude_until=None):
        with self.driver.transaction() as c:
            if daily_limit is not None:
                c.execute('UPDATE users SET casino_limit=? WHERE id=?',
                          (max(0, int(daily_limit)), int(user_id)))
            if exclude_until is not None:
                c.execute('UPDATE users SET casino_exclude_until=? WHERE id=?',
                          (max(0, int(exclude_until)), int(user_id)))

    # ---------------------------------------------------------------- admin
    def top_users(self, limit: int = 10):
        with self.driver.transaction() as c:
            return c.execute('SELECT username,coins,avatar,color,title,created,is_admin FROM users'
                             ' WHERE banned=0 ORDER BY coins DESC, created ASC LIMIT ?',
                             (max(1, min(100, int(limit))),)).fetchall()

    def platform_stats(self):
        ts, day_ago = now(), now() - 86400
        with self.driver.transaction() as c:
            users = c.execute('SELECT COUNT(*) AS n FROM users').fetchone()['n']
            active = c.execute('SELECT COUNT(*) AS n FROM users WHERE last_seen>?', (day_ago,)).fetchone()['n']
            coins = c.execute('SELECT COALESCE(SUM(coins),0) AS n FROM users').fetchone()['n']
            bets = c.execute('SELECT COUNT(*) AS n FROM casino_bets').fetchone()['n']
            staked = c.execute('SELECT COALESCE(SUM(stake),0) AS n FROM casino_bets').fetchone()['n']
            paid = c.execute('SELECT COALESCE(SUM(payout),0) AS n FROM casino_bets').fetchone()['n']
            plays = c.execute('SELECT COALESCE(SUM(plays),0) AS n FROM game_stats').fetchone()['n']
            ledger = c.execute('SELECT COUNT(*) AS n FROM coin_ledger').fetchone()['n']
            banned = c.execute('SELECT COUNT(*) AS n FROM users WHERE banned=1').fetchone()['n']
            new_today = c.execute('SELECT COUNT(*) AS n FROM users WHERE created>?', (day_ago,)).fetchone()['n']
        return {'users': int(users), 'active24': int(active), 'coins': int(coins),
                'bets': int(bets), 'staked': int(staked), 'paid': int(paid),
                'plays': int(plays), 'ledger': int(ledger), 'banned': int(banned),
                'new24': int(new_today), 'backend': self.backend}

    def search_users(self, query: str = '', limit: int = 30, offset: int = 0):
        q = str(query or '').strip()
        limit = max(1, min(100, int(limit)))
        with self.driver.transaction() as c:
            if q:
                rows = c.execute('SELECT id,username,coins,is_admin,banned,created,last_seen FROM users'
                                 ' WHERE username_key LIKE ? ORDER BY last_seen DESC LIMIT ? OFFSET ?',
                                 (f'%{q.casefold()}%', limit, max(0, int(offset)))).fetchall()
                total = c.execute('SELECT COUNT(*) AS n FROM users WHERE username_key LIKE ?',
                                  (f'%{q.casefold()}%',)).fetchone()['n']
            else:
                rows = c.execute('SELECT id,username,coins,is_admin,banned,created,last_seen FROM users'
                                 ' ORDER BY last_seen DESC LIMIT ? OFFSET ?',
                                 (limit, max(0, int(offset)))).fetchall()
                total = c.execute('SELECT COUNT(*) AS n FROM users').fetchone()['n']
        return rows, int(total)

    def set_admin(self, user_id: int, is_admin: bool):
        with self.driver.transaction() as c:
            c.execute('UPDATE users SET is_admin=? WHERE id=?', (1 if is_admin else 0, int(user_id)))

    def admin_log(self, admin: str, action: str, target: str = '', detail: str = '',
                  ip_hash: str = ''):
        with self.driver.transaction() as c:
            c.execute('INSERT INTO admin_log(admin,action,target,detail,ip_hash,created)'
                      ' VALUES(?,?,?,?,?,?)',
                      (str(admin)[:64], str(action)[:64], str(target)[:64], str(detail)[:400],
                       str(ip_hash)[:64], now()))

    def admin_log_rows(self, limit: int = 50):
        with self.driver.transaction() as c:
            return c.execute('SELECT * FROM admin_log ORDER BY id DESC LIMIT ?',
                             (max(1, min(200, int(limit))),)).fetchall()

    def new_admin_session(self, ip: str = '') -> str:
        token = secrets.token_urlsafe(32)
        ts = now()
        with self.driver.transaction() as c:
            c.execute('DELETE FROM admin_sessions WHERE expires<?', (ts,))
            c.execute('INSERT INTO admin_sessions(token_hash,created,expires,ip_hash) VALUES(?,?,?,?)',
                      (digest(token), ts, ts + ADMIN_SESSION_TTL, digest(ip) if ip else ''))
        return token

    def admin_session_valid(self, token: str) -> bool:
        if not token:
            return False
        with self.driver.transaction() as c:
            row = c.execute('SELECT expires FROM admin_sessions WHERE token_hash=?',
                            (digest(token),)).fetchone()
        return bool(row and int(row['expires']) > now())

    def delete_admin_session(self, token: str):
        if not token:
            return
        with self.driver.transaction() as c:
            c.execute('DELETE FROM admin_sessions WHERE token_hash=?', (digest(token),))

    # ---------------------------------------------------------------- shop orders
    def create_order(self, order: dict):
        with self.driver.transaction() as c:
            c.execute('INSERT INTO shop_orders(id,user_id,provider,pack,coins,amount_minor,currency,status,'
                      'provider_ref,claimed,created,paid) VALUES(?,?,?,?,?,?,?,?,?,0,?,NULL)',
                      (order['id'], order['user_id'], order['provider'], order['pack'], order['coins'],
                       order['amount_minor'], order['currency'], 'new', '', order['created']))

    def order(self, order_id: str):
        with self.driver.transaction() as c:
            return c.execute('SELECT * FROM shop_orders WHERE id=?', (str(order_id),)).fetchone()

    def set_order_ref(self, order_id: str, ref: str):
        with self.driver.transaction() as c:
            c.execute('UPDATE shop_orders SET provider_ref=? WHERE id=?', (str(ref)[:120], order_id))

    def fail_order(self, order_id: str):
        with self.driver.transaction() as c:
            c.execute('UPDATE shop_orders SET status=? WHERE id=?', ('failed', order_id))

    def mark_order_paid(self, order_id: str, reference: str) -> bool:
        ts = now()
        with self.driver.transaction() as c:
            order = c.execute('SELECT * FROM shop_orders WHERE id=?', (order_id,)).fetchone()
            if not order or order['status'] == 'paid':
                return False
            c.execute('UPDATE shop_orders SET status=?, paid=?, provider_ref=? WHERE id=?',
                      ('paid', ts, str(reference)[:120], order_id))
            c.execute('INSERT INTO shop_ledger(order_id,user_id,coins,reason,provider_ref,created)'
                      ' VALUES(?,?,?,?,?,?)',
                      (order_id, order['user_id'], order['coins'], 'purchase', str(reference)[:120], ts))
        return True

    def claim_order(self, order_id: str, user_id: int):
        """Начислить купленные монеты на серверный баланс ровно один раз."""
        with self.driver.transaction() as c:
            order = c.execute('SELECT * FROM shop_orders WHERE id=? AND user_id=?',
                              (str(order_id), int(user_id))).fetchone()
            if not order:
                raise NotFound('Заказ не найден')
            if order['status'] != 'paid':
                raise StoreError('Оплата ещё не подтверждена')
            if int(order['claimed']):
                row = c.execute('SELECT coins FROM users WHERE id=?', (int(user_id),)).fetchone()
                return {'already': True, 'coins': int(order['coins']),
                        'balance': int(row['coins']) if row else 0}
            c.execute('UPDATE shop_orders SET claimed=1 WHERE id=?', (order['id'],))
            balance = self._apply_delta(c, int(user_id), int(order['coins']), 'purchase',
                                        f'Покупка пакета {order["pack"]}', f'order:{order["id"]}')
        return {'already': False, 'coins': int(order['coins']), 'balance': balance}

    def order_history(self, user_id: int, limit: int = 10):
        with self.driver.transaction() as c:
            return c.execute('SELECT pack,coins,status,created FROM shop_orders WHERE user_id=?'
                             ' ORDER BY created DESC LIMIT ?',
                             (int(user_id), max(1, min(100, int(limit))))).fetchall()


# --------------------------------------------------------------------------- #
#  Синглтон
# --------------------------------------------------------------------------- #
_store: DataStore | None = None
_store_lock = threading.Lock()


def get_store() -> DataStore:
    global _store
    if _store is None:
        with _store_lock:
            if _store is None:
                url = (os.environ.get('DATABASE_URL') or '').strip()
                if url:
                    driver = PgDriver(url)
                else:
                    driver = SqliteDriver(os.environ.get('VERTU_DB', 'data/vertu.sqlite3'))
                _store = DataStore(driver)
    return _store


def reset_store():
    """Только для тестов: закрыть текущий синглтон."""
    global _store
    with _store_lock:
        if _store is not None:
            try:
                _store.driver.close()
            except Exception:
                pass
        _store = None
