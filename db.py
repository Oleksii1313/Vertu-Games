#!/usr/bin/env python3
"""Vertu Games — единый слой данных (PostgreSQL; SQLite только для тестов).

Главные правила экономики:

* баланс V-монет живёт в ``wallets.balance`` с ``CHECK (balance >= 0)``;
* **любое** изменение баланса проходит через :meth:`DataStore.add_coins` внутри
  одной транзакции ``SERIALIZABLE``-уровня с ``SELECT … FOR UPDATE`` по строке
  кошелька, записью в ``transactions`` и (для совместимости) чтением через
  представление ``coin_ledger``;
* клиент не может прислать баланс: API принимает только «события», сумму
  определяет сервер по каталогу;
* у каждой финансовой операции есть ``reference_id`` с ``UNIQUE`` — повторный
  запрос с тем же ключом не меняет баланс (идемпотентность).

Драйвер выбирается по окружению:

    DATABASE_URL=postgres://…        → PgDriver (psycopg 3 + psycopg_pool)
    DATABASE_URL пуст                → SqliteDriver (локальные тесты, data/*.sqlite3)

Оба драйвера понимают один SQL с плейсхолдерами ``?`` (в PostgreSQL они
превращаются в ``%s``), поэтому остальной код не зависит от СУБД.
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
from pathlib import Path

import schema_sql

# --------------------------------------------------------------------------- #
#  Константы
# --------------------------------------------------------------------------- #
SESSION_TTL = 30 * 24 * 3600
ADMIN_SESSION_TTL = 8 * 3600
PBKDF2_ROUNDS = 310000
WELCOME_COINS = int(os.environ.get('WELCOME_COINS', '100') or 100)
MAX_BALANCE = 100_000_000

USERNAME_RE = re.compile(r'^[A-Za-z0-9](?:[A-Za-z0-9 _.\-]{1,22})[A-Za-z0-9_.]$')
RESERVED_NAMES = {'admin', 'administrator', 'root', 'moderator', 'support', 'system',
                  'vertu', 'vertugames', 'null', 'undefined', 'constructor', 'prototype'}

# Явный список колонок пользователя (в канонической схеме их больше, чем нужно
# старым страницам; ``password_hash`` и служебные поля наружу не отдаём).
USER_COLUMNS = ('id, username, username_key, password_hash, role, avatar, color, title, '
                'experience, level, is_active, is_admin, banned, ban_reason, created_at, '
                'last_login, last_seen')


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


class AccountDisabled(StoreError):
    """Аккаунт отключён администратором (is_active = false)."""


# --------------------------------------------------------------------------- #
#  Пароли.
#
#  Новые пароли — Argon2id (argon2-cffi). Старые базы хранили
#  pbkdf2_sha256$rounds$salt$hash и bcrypt-хеши: они продолжают проверяться, а при
#  успешном входе перехешируются в Argon2id (см. DataStore.authenticate).
# --------------------------------------------------------------------------- #
def _argon2():
    try:
        from argon2 import PasswordHasher  # noqa: WPS433
        from argon2.exceptions import InvalidHashError, VerifyMismatchError  # noqa: F401
        return PasswordHasher(memory_cost=64 * 1024, time_cost=3, parallelism=2)
    except ImportError:  # окружение без argon2-cffi — остаётся bcrypt/pbkdf2
        return None


_PASSWORD_HASHER = _argon2()


def hash_password(password: str) -> str:
    """Захешировать пароль: Argon2id → bcrypt → pbkdf2 (первый доступный)."""
    password = str(password)
    if _PASSWORD_HASHER is not None:
        return _PASSWORD_HASHER.hash(password)
    try:
        import bcrypt  # noqa: WPS433
        return 'bcrypt$' + bcrypt.hashpw(password.encode()[:72], bcrypt.gensalt(rounds=12)).decode()
    except ImportError:
        salt = secrets.token_hex(16)
        digest = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), PBKDF2_ROUNDS).hex()
        return f'pbkdf2_sha256${PBKDF2_ROUNDS}${salt}${digest}'


def verify_password(password: str, stored: str) -> bool:
    """Проверить пароль против любого поддерживаемого формата хеша."""
    if not isinstance(password, str) or not stored:
        return False
    stored = str(stored)
    try:
        if stored.startswith('$argon2'):
            hasher = _PASSWORD_HASHER or _argon2()
            if hasher is None:
                return False
            try:
                return hasher.verify(stored, password)
            except Exception:  # noqa: BLE001 - VerifyMismatchError/InvalidHashError
                return False
        if stored.startswith('bcrypt$'):
            import bcrypt  # noqa: WPS433
            return bcrypt.checkpw(password.encode()[:72], stored[len('bcrypt$'):].encode())
        if stored.startswith('pbkdf2_sha256$'):
            _, rounds, salt, expected = stored.split('$')
            actual = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), int(rounds)).hex()
            return hmac.compare_digest(actual, expected)
    except Exception:  # noqa: BLE001
        return False
    return False


def password_needs_rehash(stored: str) -> bool:
    """True, если хеш старого формата и его стоит обновить при входе."""
    if _PASSWORD_HASHER is None:
        return False
    stored = str(stored or '')
    if not stored.startswith('$argon2'):
        return True
    try:
        return _PASSWORD_HASHER.check_needs_rehash(stored)
    except Exception:  # noqa: BLE001
        return True


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


def now() -> int:
    """Unix-время в секундах — формат, который понимает весь старый код."""
    return int(time.time())


def today() -> str:
    return datetime.now(timezone.utc).strftime('%Y-%m-%d')


def _today_iso() -> str:
    """Дата в формате YYYY-MM-DD — совпадает и с DATE в PostgreSQL, и с TEXT в SQLite."""
    return datetime.now(timezone.utc).strftime('%Y-%m-%d')


def day_start(ts: int | None = None) -> int:
    ts = now() if ts is None else int(ts)
    return ts - (ts % 86400)


def next_reset(ts: int | None = None) -> int:
    return day_start(ts) + 86400


def iso(ts: float | None = None) -> datetime:
    """Unix → aware datetime (для записи в TIMESTAMPTZ)."""
    return datetime.fromtimestamp(float(ts if ts is not None else now()), tz=timezone.utc)


def _epoch(value) -> int:
    """TIMESTAMPTZ/DATE/число → unix-секунды (совместимость со старым API)."""
    if value is None:
        return 0
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return int(value.timestamp())
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return int(parsed.timestamp())
        except ValueError:
            return 0
    if hasattr(value, 'year') and not isinstance(value, (int, float)):
        return int(datetime(value.year, value.month, value.day, tzinfo=timezone.utc).timestamp())
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


# --------------------------------------------------------------------------- #
#  Драйверы
# --------------------------------------------------------------------------- #
class SqliteDriver:
    """SQLite — только для локальных тестов и разработки без PostgreSQL."""

    name = 'sqlite'

    def __init__(self, path: str):
        import sqlite3
        self.sqlite3 = sqlite3
        self.path = path
        if path != ':memory:':
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._local = threading.local()
        self._shared = None
        if path == ':memory:':
            self._shared = self._open()
            self._shared.commit()

    def _open(self):
        if getattr(self._local, 'conn', None) is not None:
            return self._local.conn
        conn = self.sqlite3.connect(self.path, timeout=20, check_same_thread=False)
        conn.row_factory = self.sqlite3.Row
        conn.execute('PRAGMA journal_mode=WAL')
        conn.execute('PRAGMA synchronous=NORMAL')
        conn.execute('PRAGMA foreign_keys=ON')
        conn.execute('PRAGMA busy_timeout=20000')
        self._local.conn = conn
        return conn

    def connect(self):
        return self._open()

    def init(self):
        # В SQLite каноническая схема недоступна (JSONB, TIMESTAMPTZ, CHECK) —
        # тесты используют упрощённый набор таблиц, достаточный для логики.
        from schema_sqlite import SCHEMA_SQLITE
        conn = self._open()
        conn.executescript(SCHEMA_SQLITE)
        conn.commit()

    def transaction(self, isolation: str | None = None):
        # В SQLite уровней изоляции нет: BEGIN IMMEDIATE сериализует писателей.
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


def _sqlite_params(params):
    """datetime/date → ISO-строка: SQLite хранит время текстом."""
    out = []
    for value in params:
        if isinstance(value, datetime):
            out.append(value.isoformat())
        elif hasattr(value, 'isoformat') and not isinstance(value, (str, bytes)):
            out.append(value.isoformat())
        elif isinstance(value, bool):
            out.append(1 if value else 0)
        else:
            out.append(value)
    return tuple(out)


class _SqliteCursor:
    def __init__(self, conn):
        self.conn = conn

    def execute(self, sql, params=()):
        # `SELECT … FOR UPDATE` — синтаксис PostgreSQL; в SQLite блокировка ставится
        # при первом изменении в транзакции.
        sql = sql.replace(' FOR UPDATE', '')
        cur = self.conn.execute(sql, _sqlite_params(params))
        return _SqliteRows(cur)

    def executescript(self, sql):
        self.conn.executescript(sql)


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
    """PostgreSQL через psycopg 3 с пулом соединений (Render-friendly)."""

    name = 'postgresql'

    def __init__(self, url: str):
        import psycopg
        from psycopg_pool import ConnectionPool
        self._psycopg = psycopg
        dsn = url.replace('postgres://', 'postgresql://', 1)
        # Пул обязателен на Render: бесплатный тариф ограничивает число соединений,
        # а gunicorn/threads открывают их параллельно.
        self.pool = ConnectionPool(
            dsn, min_size=int(os.environ.get('DB_POOL_MIN', '1') or 1),
            max_size=int(os.environ.get('DB_POOL_SIZE', '5') or 5),
            timeout=float(os.environ.get('DB_POOL_TIMEOUT', '15') or 15),
            max_idle=60, max_lifetime=900, open=False,
            kwargs={'connect_timeout': 10, 'application_name': 'vertu-games'},
        )
        self.pool.open(wait=True, timeout=30)

    def connect(self):
        return _PgConn(self.pool)

    def init(self):
        with self.pool.connection() as conn:
            conn.autocommit = True
            with conn.cursor() as cur:
                for statement in schema_sql.STATEMENTS:
                    cur.execute(statement)
                for statement in [s.strip() for s in schema_sql.COMPAT_VIEWS.split(';') if s.strip()]:
                    cur.execute(statement)

    def transaction(self, isolation: str = 'serializable'):
        return _PgTx(self, isolation)

    def close(self):
        try:
            self.pool.close()
        except Exception:  # noqa: BLE001
            pass


def _pg_sql(sql: str) -> str:
    """Перевести ``?``-плейсхолдеры в ``%s`` (psycopg 3)."""
    return sql.replace('?', '%s')


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
                names = [d.name for d in cur.description]
                rows = [dict(zip(names, r)) for r in cur.fetchall()]
            return _PgRows(rows, cur.rowcount)

    def executescript(self, sql):
        with self.raw.cursor() as cur:
            for statement in [s.strip() for s in sql.split(';') if s.strip()]:
                cur.execute(_pg_sql(statement))

    def commit(self):
        self.raw.commit()

    def rollback(self):
        self.raw.rollback()

    def close(self):
        try:
            self.raw.autocommit = True
        except Exception:  # noqa: BLE001
            pass
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
    """Транзакция PostgreSQL с уровнем изоляции, защищающим экономику."""

    def __init__(self, driver, isolation: str = 'serializable'):
        self.driver = driver
        self.isolation = isolation
        self.conn = None

    def __enter__(self):
        self.conn = self.driver.connect()
        self.conn.raw.autocommit = False
        if self.isolation:
            with self.conn.raw.cursor() as cur:
                cur.execute(f'SET TRANSACTION ISOLATION LEVEL {self.isolation.upper()}')
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
#  Хранилище
# --------------------------------------------------------------------------- #
def _user_row(row: dict) -> dict:
    """Привести строку users к формату, который ждёт остальной код.

    Старые модули читают ``coins``, ``created``, ``last_seen`` как числа —
    поэтому здесь же подмешиваются значения из кошелька и Unix-время.
    """
    if row is None:
        return None
    out = dict(row)
    out['coins'] = int(out.get('coins') or 0)
    out['created'] = _epoch(out.get('created_at')) or _epoch(out.get('created'))
    out['last_seen'] = _epoch(out.get('last_seen'))
    out['last_login'] = _epoch(out.get('last_login'))
    out['is_admin'] = 1 if out.get('is_admin') else 0
    out['banned'] = 1 if out.get('banned') else 0
    out['is_active'] = 1 if out.get('is_active') else 0
    out['casino_limit'] = int(out.get('casino_limit') or 0)
    out['casino_exclude_until'] = _epoch(out.get('casino_exclude_until'))
    out['legacy_email'] = out.get('legacy_email') or ''
    out['ban_reason'] = out.get('ban_reason') or ''
    out['role'] = out.get('role') or ('admin' if out['is_admin'] else 'player')
    return out


class DataStore:
    """Высокоуровневый API поверх драйвера. Один экземпляр на процесс."""

    def __init__(self, driver):
        self.driver = driver
        self.driver.init()
        self._migrations()
        self._seed()

    # ---------------------------------------------------------------- migrations
    MIGRATIONS = (
        ('0003_wallets_from_users', ()),
    )

    def _migrations(self):
        with self.driver.transaction(isolation='read committed') as c:
            done = {row['name'] for row in c.execute('SELECT name FROM schema_migrations').fetchall()}
        if '0003_wallets_from_users' not in done:
            self._migrate_wallets()
            with self.driver.transaction(isolation='read committed') as c:
                c.execute('INSERT INTO schema_migrations(name) VALUES(?)', ('0003_wallets_from_users',))

    def _migrate_wallets(self):
        """Старые базы держали баланс в users.coins — переносим в wallets.

        Только PostgreSQL (в SQLite канонической users.coins нет) и только один
        раз — запись фиксируется в ``schema_migrations``.
        """
        if self.driver.name != 'postgresql':
            return
        with self.driver.transaction(isolation='read committed') as c:
            # current_schema() уважает search_path (тесты работают в отдельной схеме).
            cols = {r['column_name'] for r in c.execute(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_schema=current_schema() AND table_name='users'").fetchall()}
            if 'coins' not in cols:
                return
            rows = c.execute('SELECT u.id, GREATEST(COALESCE(u.coins,0),0) AS coins '
                             'FROM users u WHERE NOT EXISTS '
                             '(SELECT 1 FROM wallets w WHERE w.user_id=u.id)').fetchall()
            for row in rows:
                c.execute('INSERT INTO wallets(user_id,balance,updated_at) VALUES(?,?,?)',
                          (int(row['id']), int(row['coins']), iso()))

    # ---------------------------------------------------------------- constants
    @property
    def backend(self) -> str:
        return self.driver.name

    # ---------------------------------------------------------------- seed data
    def _seed(self):
        """Каталог игр, товаров, достижений и настроек — из game_catalog.py."""
        import game_catalog
        ts_now = iso()
        with self.driver.transaction(isolation='read committed') as c:
            # -------- игры
            for game in game_catalog.GAMES:
                exists = c.execute('SELECT id FROM games WHERE id=?', (game['id'],)).fetchone()
                values = (game['name'], game.get('desc') or '', ','.join(game.get('cat') or []),
                          game.get('file') or '', game.get('icon') or '', int(game.get('reward') or 0),
                          int(game.get('daily') or 0), not bool(game.get('hidden')), ts_now)
                if exists:
                    c.execute('UPDATE games SET name=?,description=?,category=?,file=?,icon=?,'
                              'reward=?,daily_cap=?,is_active=? WHERE id=?',
                              values[:-1] + (game['id'],))
                else:
                    c.execute('INSERT INTO games(id,name,description,category,file,icon,reward,'
                              'daily_cap,is_active,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
                              (game['id'],) + values)
            # -------- товары магазина (без пакетов V — только предметы)
            for item in game_catalog.SHOP_ITEMS:
                exists = c.execute('SELECT id FROM items WHERE id=?', (item['id'],)).fetchone()
                values = (item['kind'], item['name_ru'], item['name_en'], item['price'],
                          item['icon'], item.get('payload', ''), item.get('order', 0), ts_now)
                if exists:
                    c.execute('UPDATE items SET item_type=?,name=?,name_en=?,price=?,image=?,'
                              'payload=?,item_order=?,is_active=TRUE WHERE id=?',
                              values[:-1] + (item['id'],))
                else:
                    c.execute('INSERT INTO items(id,item_type,name,name_en,price,image,payload,'
                              'item_order,is_active,created_at) VALUES(?,?,?,?,?,?,?,?,TRUE,?)',
                              (item['id'],) + (item['kind'], item['name_ru'], item['name_en'],
                                               item['price'], item['icon'], item.get('payload', ''),
                                               item.get('order', 0), ts_now))
            # -------- достижения
            for ach in game_catalog.ACHIEVEMENTS:
                exists = c.execute('SELECT id FROM achievements WHERE id=?', (ach['id'],)).fetchone()
                values = (ach['name_ru'], ach['desc_ru'], ach['icon'], int(ach['coins']),
                          ach['name_en'], ach['desc_en'], ach.get('order', 0), ts_now)
                if exists:
                    c.execute('UPDATE achievements SET name=?,description=?,icon=?,reward=?,'
                              'name_en=?,desc_en=?,item_order=? WHERE id=?',
                              values[:-1] + (ach['id'],))
                else:
                    c.execute('INSERT INTO achievements(id,name,description,icon,reward,name_en,'
                              'desc_en,item_order,is_active,created_at) VALUES(?,?,?,?,?,?,?,?,TRUE,?)',
                              (ach['id'],) + values)
            # -------- настройки
            defaults = {
                'casino_enabled': '1', 'wheel_enabled': '1', 'slots_enabled': '1',
                'min_stake': '5', 'max_stake': '100', 'wheel_free_daily': '1',
                'wheel_paid_daily': '5',
            }
            for key, value in defaults.items():
                if not c.execute('SELECT 1 FROM platform_settings WHERE key=?', (key,)).fetchone():
                    c.execute('INSERT INTO platform_settings(key,value) VALUES(?,?)', (key, value))
        self.ensure_admin()

    def ensure_admin(self):
        """Первый администратор из ADMIN_USERNAME/ADMIN_PASSWORD (пароль не меняем)."""
        name = (os.environ.get('ADMIN_USERNAME') or '').strip()
        if not name or not valid_username(name):
            return
        password = os.environ.get('ADMIN_PASSWORD') or ''
        with self.driver.transaction(isolation='read committed') as c:
            row = c.execute('SELECT id,is_admin,role FROM users WHERE username_key=?',
                            (name.casefold(),)).fetchone()
            if row:
                if not row['is_admin']:
                    c.execute("UPDATE users SET is_admin=TRUE, role='admin' WHERE id=?", (row['id'],))
                return
            if len(password) < 8:
                return
            cur = c.execute('INSERT INTO users(username,username_key,password_hash,role,is_admin,'
                            'created_at,last_seen) VALUES(?,?,?,?,TRUE,?,?)',
                            (name, name.casefold(), hash_password(password), 'admin', iso(), iso()))
            uid = cur.lastrowid
            if uid is None:
                uid = c.execute('SELECT id FROM users WHERE username_key=?',
                                (name.casefold(),)).fetchone()['id']
            c.execute('INSERT INTO wallets(user_id,balance) VALUES(?,0) '
                      'ON CONFLICT (user_id) DO NOTHING', (uid,))

    # ---------------------------------------------------------------- settings
    def get_setting(self, key: str, default: str = '') -> str:
        with self.driver.transaction(isolation='read committed') as c:
            row = c.execute('SELECT value FROM platform_settings WHERE key=?', (key,)).fetchone()
        return row['value'] if row else default

    def set_setting(self, key: str, value: str):
        with self.driver.transaction(isolation='read committed') as c:
            c.execute('INSERT INTO platform_settings(key,value) VALUES(?,?) '
                      'ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value',
                      (key, str(value)))

    def settings_map(self):
        with self.driver.transaction(isolation='read committed') as c:
            return {r['key']: r['value'] for r in
                    c.execute('SELECT key,value FROM platform_settings').fetchall()}

    # ---------------------------------------------------------------- users
    _SELECT_USER = (
        'SELECT u.id, u.username, u.username_key, u.password_hash, u.role, u.avatar, u.color, '
        'u.title, u.experience, u.level, u.is_active, u.is_admin, u.banned, u.ban_reason, '
        'u.created_at, u.last_login, u.last_seen, u.legacy_email, '
        'COALESCE(w.balance,0) AS coins, '
        'COALESCE(cl.daily_limit,0) AS casino_limit, cl.exclude_until AS casino_exclude_until '
        'FROM users u LEFT JOIN wallets w ON w.user_id=u.id '
        'LEFT JOIN casino_limits cl ON cl.user_id=u.id'
    )

    def find_user(self, identifier: str):
        key = str(identifier or '').strip().casefold()
        if not key:
            return None
        with self.driver.transaction(isolation='read committed') as c:
            row = c.execute(self._SELECT_USER + ' WHERE u.username_key=?', (key,)).fetchone()
        return _user_row(row)

    def get_user(self, user_id: int):
        with self.driver.transaction(isolation='read committed') as c:
            row = c.execute(self._SELECT_USER + ' WHERE u.id=?', (int(user_id),)).fetchone()
        return _user_row(row)

    def username_taken(self, username: str) -> bool:
        with self.driver.transaction(isolation='read committed') as c:
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
        ts = iso()
        with self.driver.transaction() as c:
            if c.execute('SELECT 1 FROM users WHERE username_key=?', (key,)).fetchone():
                raise DuplicateUser('Ник уже занят')
            cur = c.execute(
                'INSERT INTO users(username,username_key,password_hash,role,is_admin,created_at,'
                'last_seen) VALUES(?,?,?,?,?,?,?)',
                (name, key, pwd, 'admin' if is_admin else 'player', bool(is_admin), ts, ts))
            uid = cur.lastrowid
            if uid is None:
                uid = c.execute('SELECT id FROM users WHERE username_key=?', (key,)).fetchone()['id']
            c.execute('INSERT INTO wallets(user_id,balance) VALUES(?,0)', (uid,))
            if coins:
                self._apply_delta(c, uid, int(coins), 'welcome', 'Приветственный бонус',
                                  f'welcome:{uid}')
            row = c.execute(self._SELECT_USER + ' WHERE u.id=?', (uid,)).fetchone()
        return _user_row(row)

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
        if not user['is_active']:
            raise AccountDisabled('Аккаунт отключён')
        # Апгрейд старого хеша (pbkdf2/bcrypt → Argon2id) при успешном входе.
        if password_needs_rehash(user['password_hash']):
            try:
                with self.driver.transaction(isolation='read committed') as c:
                    c.execute('UPDATE users SET password_hash=? WHERE id=?',
                              (hash_password(password), user['id']))
                user['password_hash'] = ''
            except StoreError:
                pass
        self.touch(user['id'], login=True)
        return user

    def set_password(self, user_id: int, password: str):
        if not valid_password(password):
            raise StoreError('Пароль должен содержать 8–128 символов')
        with self.driver.transaction(isolation='read committed') as c:
            c.execute('UPDATE users SET password_hash=? WHERE id=?',
                      (hash_password(password), int(user_id)))
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
        with self.driver.transaction(isolation='read committed') as c:
            c.execute(f'UPDATE users SET {", ".join(fields)} WHERE id=?', params)

    def ban_user(self, user_id: int, banned: bool, reason: str = ''):
        with self.driver.transaction(isolation='read committed') as c:
            c.execute('UPDATE users SET banned=?, ban_reason=? WHERE id=?',
                      (bool(banned), reason[:200], int(user_id)))
            if banned:
                c.execute('DELETE FROM sessions WHERE user_id=?', (int(user_id),))

    def set_active(self, user_id: int, active: bool):
        with self.driver.transaction(isolation='read committed') as c:
            c.execute('UPDATE users SET is_active=? WHERE id=?', (bool(active), int(user_id)))
            if not active:
                c.execute('DELETE FROM sessions WHERE user_id=?', (int(user_id),))

    def touch(self, user_id: int, login: bool = False):
        with self.driver.transaction(isolation='read committed') as c:
            if login:
                c.execute('UPDATE users SET last_seen=?, last_login=? WHERE id=?',
                          (iso(), iso(), int(user_id)))
            else:
                c.execute('UPDATE users SET last_seen=? WHERE id=?', (iso(), int(user_id)))

    def add_experience(self, user_id: int, amount: int) -> dict:
        """Опыт и уровень: уровень растёт каждые 1000 XP (потолок 100)."""
        amount = max(0, int(amount))
        with self.driver.transaction(isolation='read committed') as c:
            row = c.execute('SELECT experience FROM users WHERE id=?', (int(user_id),)).fetchone()
            if not row:
                raise NotFound('Пользователь не найден')
            total = int(row['experience'] or 0) + amount
            level = min(100, 1 + total // 1000)
            c.execute('UPDATE users SET experience=?, level=? WHERE id=?',
                      (total, level, int(user_id)))
        return {'experience': total, 'level': level}

    # ---------------------------------------------------------------- деньги
    def balance(self, user_id: int) -> int:
        with self.driver.transaction(isolation='read committed') as c:
            row = c.execute('SELECT balance FROM wallets WHERE user_id=?', (int(user_id),)).fetchone()
        return int(row['balance']) if row else 0

    def _wallet_for_update(self, c, user_id: int) -> int:
        """Заблокировать строку кошелька (SELECT … FOR UPDATE) и вернуть баланс."""
        row = c.execute('SELECT id,balance FROM wallets WHERE user_id=? FOR UPDATE',
                        (int(user_id),)).fetchone()
        if row is None:
            # Кошелёк мог быть не создан у старых аккаунтов — создаём нулевым.
            c.execute('INSERT INTO wallets(user_id,balance) VALUES(?,0) '
                      'ON CONFLICT (user_id) DO NOTHING', (int(user_id),))
            row = c.execute('SELECT id,balance FROM wallets WHERE user_id=? FOR UPDATE',
                            (int(user_id),)).fetchone()
        if row is None:
            raise NotFound('Пользователь не найден')
        return int(row['balance'] if row['balance'] is not None else 0)

    def _apply_delta(self, c, user_id: int, delta: int, kind: str, reason: str,
                     ref: str | None) -> int:
        """Ядро экономики: изменение баланса + запись в transactions."""
        before = self._wallet_for_update(c, user_id)
        after = before + int(delta)
        if after < 0:
            raise InsufficientFunds('Недостаточно V-монет')
        if after > MAX_BALANCE:
            raise LimitExceeded('Баланс превышает допустимый максимум')
        wallet = c.execute('SELECT id FROM wallets WHERE user_id=?', (int(user_id),)).fetchone()
        c.execute('UPDATE wallets SET balance=?, updated_at=? WHERE user_id=?',
                  (after, iso(), int(user_id)))
        c.execute('INSERT INTO transactions(user_id,wallet_id,amount,balance_after,'
                  'transaction_type,description,reference_id,created_at) '
                  'VALUES(?,?,?,?,?,?,?,?)',
                  (int(user_id), wallet['id'] if wallet else None, int(delta), after,
                   str(kind)[:32], str(reason)[:200], ref, iso()))
        return after

    def add_coins(self, user_id: int, delta: int, kind: str = 'other', reason: str = '',
                  ref: str | None = None) -> dict:
        """Изменить баланс в атомарной транзакции. ``ref`` делает вызов идемпотентным."""
        delta = int(delta)
        if delta == 0:
            return {'balance': self.balance(user_id), 'repeated': False, 'ledger_id': None}
        try:
            with self.driver.transaction() as c:
                if ref:
                    row = c.execute('SELECT id FROM transactions WHERE reference_id=?',
                                    (ref,)).fetchone()
                    if row:
                        bal = c.execute('SELECT balance FROM wallets WHERE user_id=?',
                                        (int(user_id),)).fetchone()
                        return {'balance': int(bal['balance']) if bal else 0,
                                'repeated': True, 'ledger_id': row['id']}
                balance = self._apply_delta(c, user_id, delta, kind, reason, ref)
                row = c.execute('SELECT id FROM transactions WHERE user_id=? '
                                'ORDER BY id DESC LIMIT 1', (int(user_id),)).fetchone()
                return {'balance': balance, 'repeated': False,
                        'ledger_id': row['id'] if row else None}
        except Exception as exc:
            lowered = str(exc).lower()
            if ref and ('unique' in lowered or 'duplicate key' in lowered):
                return {'balance': self.balance(user_id), 'repeated': True, 'ledger_id': None}
            raise

    def set_balance(self, user_id: int, value: int, kind: str = 'admin',
                    reason: str = 'admin set') -> int:
        value = max(0, min(MAX_BALANCE, int(value)))
        current = self.balance(user_id)
        result = self.add_coins(user_id, value - current, kind, reason)
        return result['balance']

    def ledger(self, user_id: int, limit: int = 30, offset: int = 0):
        with self.driver.transaction(isolation='read committed') as c:
            rows = c.execute('SELECT id,delta,balance,reason,kind,created FROM coin_ledger '
                             'WHERE user_id=? ORDER BY id DESC LIMIT ? OFFSET ?',
                             (int(user_id), max(1, min(200, int(limit))), max(0, int(offset)))).fetchall()
        return rows

    def ledger_count(self, user_id: int) -> int:
        with self.driver.transaction(isolation='read committed') as c:
            row = c.execute('SELECT COUNT(*) AS n FROM transactions WHERE user_id=?',
                            (int(user_id),)).fetchone()
        return int(row['n']) if row else 0

    def transactions(self, limit: int = 50, kind: str | None = None, user_id: int | None = None):
        """Журнал операций для админки (все пользователи или один)."""
        sql = ('SELECT t.id, t.user_id, u.username, t.amount, t.balance_after, t.transaction_type, '
               't.description, t.reference_id, t.created_at FROM transactions t '
               'LEFT JOIN users u ON u.id=t.user_id WHERE 1=1')
        params: list = []
        if user_id:
            sql += ' AND t.user_id=?'
            params.append(int(user_id))
        if kind:
            sql += ' AND t.transaction_type=?'
            params.append(kind)
        sql += ' ORDER BY t.id DESC LIMIT ?'
        params.append(max(1, min(500, int(limit))))
        with self.driver.transaction(isolation='read committed') as c:
            rows = c.execute(sql, params).fetchall()
        for row in rows:
            row['created'] = _epoch(row.pop('created_at', None))
        return rows

    # ---------------------------------------------------------------- sessions
    def new_session(self, user_id: int, ttl: int = SESSION_TTL, ip: str = '', agent: str = '') -> str:
        token = secrets.token_urlsafe(32)
        expires = time.time() + int(ttl)
        with self.driver.transaction(isolation='read committed') as c:
            c.execute('DELETE FROM sessions WHERE expires_at<?', (iso(),))
            c.execute('INSERT INTO sessions(token_hash,user_id,created_at,expires_at,ip_hash,agent) '
                      'VALUES(?,?,?,?,?,?)',
                      (digest(token), int(user_id), iso(), iso(expires),
                       digest(ip) if ip else '', str(agent)[:160]))
        return token

    def user_for_token(self, token: str):
        if not token:
            return None
        token_hash = digest(token)
        with self.driver.transaction(isolation='read committed') as c:
            row = c.execute('SELECT user_id, expires_at FROM sessions WHERE token_hash=?',
                            (token_hash,)).fetchone()
            if not row or _epoch(row['expires_at']) <= now():
                return None
            c.execute('UPDATE sessions SET expires_at=? WHERE token_hash=?',
                      (iso(time.time() + SESSION_TTL), token_hash))
            user_id = int(row['user_id'])
            user = c.execute(self._SELECT_USER + ' WHERE u.id=?', (user_id,)).fetchone()
        return _user_row(user)

    def delete_session(self, token: str):
        if not token:
            return
        with self.driver.transaction(isolation='read committed') as c:
            c.execute('DELETE FROM sessions WHERE token_hash=?', (digest(token),))

    def delete_all_sessions(self, user_id: int):
        with self.driver.transaction(isolation='read committed') as c:
            c.execute('DELETE FROM sessions WHERE user_id=?', (int(user_id),))

    def import_legacy_user(self, username: str, password_hash: str, coins: int = 0,
                           is_admin: bool = False, legacy_email: str = '',
                           created: int = 0, banned: bool = False) -> str:
        """Импорт аккаунта из старой базы (никаких изменений в исходной БД).

        Хеш пароля переносится как есть — поддерживаются pbkdf2_sha256, bcrypt и
        argon2, поэтому старый пароль продолжает работать.
        """
        name = str(username or '').strip()
        stored = str(password_hash or '')
        if not valid_username(name):
            return 'conflict'
        if not (stored.startswith('pbkdf2_sha256$') or stored.startswith('$argon2')
                or stored.startswith('bcrypt$')):
            return 'conflict'
        key = name.casefold()
        stamp = int(created) or now()
        with self.driver.transaction() as c:
            existing = c.execute('SELECT id, password_hash, legacy_email FROM users '
                                 'WHERE username_key=?', (key,)).fetchone()
            if existing:
                if existing['password_hash'] == stored:
                    if legacy_email and not existing['legacy_email']:
                        c.execute('UPDATE users SET legacy_email=? WHERE id=?',
                                  (str(legacy_email)[:254], existing['id']))
                    return 'exists'
                return 'conflict'
            cur = c.execute('INSERT INTO users(username,username_key,password_hash,role,is_admin,'
                            'banned,legacy_email,created_at,last_seen) VALUES(?,?,?,?,?,?,?,?,?)',
                            (name, key, stored, 'admin' if is_admin else 'player', bool(is_admin),
                             bool(banned), str(legacy_email or '')[:254], iso(stamp), iso(stamp)))
            uid = cur.lastrowid
            if uid is None:
                uid = c.execute('SELECT id FROM users WHERE username_key=?',
                                (key,)).fetchone()['id']
            c.execute('INSERT INTO wallets(user_id,balance) VALUES(?,0) '
                      'ON CONFLICT (user_id) DO NOTHING', (uid,))
            if coins:
                self._apply_delta(c, uid, int(coins), 'import',
                                  'Перенос баланса из старой базы', f'import:{uid}')
        return 'created'

    # ---------------------------------------------------------------- совместимость
    # Старые вызовы (server.py, tools/*) обращались к этим именам напрямую.
    def get_balance(self, user_id: int) -> int:
        return self.balance(user_id)

    # ---------------------------------------------------------------- rate limit
    def rate_limit(self, key: str, limit: int, seconds: int) -> bool:
        """True — попытка разрешена. Атомарно, устойчиво к гонкам."""
        ts = time.time()
        with self.driver.transaction() as c:
            c.execute('DELETE FROM rate_limits WHERE expires_at<?', (iso(ts),))
            row = c.execute('SELECT count,expires_at FROM rate_limits WHERE key=? FOR UPDATE',
                            (key,)).fetchone()
            if row and _epoch(row['expires_at']) > ts and int(row['count']) >= limit:
                return False
            if row and _epoch(row['expires_at']) > ts:
                c.execute('UPDATE rate_limits SET count=count+1 WHERE key=?', (key,))
            else:
                c.execute('INSERT INTO rate_limits(key,count,expires_at) VALUES(?,?,?) '
                          'ON CONFLICT (key) DO UPDATE SET count=1, expires_at=EXCLUDED.expires_at',
                          (key, 1, iso(ts + int(seconds))))
        return True

    def rate_reset(self, key: str):
        with self.driver.transaction(isolation='read committed') as c:
            c.execute('DELETE FROM rate_limits WHERE key=?', (key,))

    rate_forget = rate_reset

    # ---------------------------------------------------------------- игры
    def record_play(self, user_id: int, game: str, score: int = 0):
        """Учесть запуск игры. Двумя шагами: GREATEST() есть только в PostgreSQL,
        а тесты гоняются и на SQLite — транзакция всё равно атомарная."""
        with self.driver.transaction() as c:
            row = c.execute('SELECT score FROM game_statistics WHERE user_id=? AND game_id=?',
                            (int(user_id), game)).fetchone()
            best = max(int(score or 0), int(row['score'] or 0) if row else 0)
            c.execute('INSERT INTO game_statistics(user_id,game_id,score,plays,coins,played_at) '
                      'VALUES(?,?,?,1,0,?) ON CONFLICT (user_id,game_id) DO UPDATE SET '
                      'plays=game_statistics.plays+1, score=?, played_at=?',
                      (int(user_id), game, best, iso(), best, iso()))

    def game_reward(self, user_id: int, game: str, amount: int, ref: str, reason: str,
                    daily_cap: int) -> dict:
        """Награда за игровое событие: идемпотентность + суточный лимит + транзакция."""
        amount = int(amount)
        if amount <= 0:
            raise StoreError('Некорректная награда')
        day = today()
        with self.driver.transaction() as c:
            existing = c.execute('SELECT user_id FROM game_receipts WHERE ref=?', (ref,)).fetchone()
            if existing:
                bal = c.execute('SELECT balance FROM wallets WHERE user_id=?',
                                (int(user_id),)).fetchone()
                return {'balance': int(bal['balance']) if bal else 0, 'repeated': True, 'awarded': 0}
            spent = c.execute('SELECT amount FROM game_limits WHERE user_id=? AND game_id=? AND day=? '
                              'FOR UPDATE', (int(user_id), game, day)).fetchone()
            already = int(spent['amount']) if spent else 0
            if daily_cap and already >= daily_cap:
                bal = c.execute('SELECT balance FROM wallets WHERE user_id=?',
                                (int(user_id),)).fetchone()
                return {'balance': int(bal['balance']) if bal else 0, 'repeated': False,
                        'awarded': 0, 'capped': True, 'daily_left': 0}
            allowed = amount if not daily_cap else min(amount, max(0, daily_cap - already))
            c.execute('INSERT INTO game_receipts(ref,user_id,game_id,amount,created_at) '
                      'VALUES(?,?,?,?,?)', (ref, int(user_id), game, allowed, iso()))
            c.execute('INSERT INTO game_limits(user_id,game_id,day,amount) VALUES(?,?,?,?) '
                      'ON CONFLICT (user_id,game_id,day) DO UPDATE SET '
                      'amount=game_limits.amount+EXCLUDED.amount',
                      (int(user_id), game, day, allowed))
            chosen = self._apply_delta(c, int(user_id), allowed, 'game', reason,
                                       f'game:{ref}') if allowed else self._wallet_for_update(c, user_id)
            c.execute('UPDATE game_statistics SET coins=COALESCE(coins,0)+? '
                      'WHERE user_id=? AND game_id=?', (allowed, int(user_id), game))
            left = (daily_cap - already - allowed) if daily_cap else None
        return {'balance': chosen, 'repeated': False, 'awarded': allowed, 'daily_left': left}

    def game_stats(self, user_id: int):
        with self.driver.transaction(isolation='read committed') as c:
            return c.execute('SELECT game,plays,score,coins,last_play FROM game_stats '
                             'WHERE user_id=? ORDER BY last_play DESC', (int(user_id),)).fetchall()

    def plays_total(self, user_id: int) -> int:
        with self.driver.transaction(isolation='read committed') as c:
            row = c.execute('SELECT COALESCE(SUM(plays),0) AS n FROM game_statistics '
                            'WHERE user_id=?', (int(user_id),)).fetchone()
        return int(row['n']) if row else 0

    def game_leaderboard(self, game: str, limit: int = 10):
        with self.driver.transaction(isolation='read committed') as c:
            return c.execute('SELECT u.username, s.score, s.plays FROM game_statistics s '
                             'JOIN users u ON u.id=s.user_id WHERE s.game_id=? AND u.banned=FALSE '
                             'ORDER BY s.score DESC LIMIT ?',
                             (game, max(1, min(50, int(limit))))).fetchall()

    # ---------------------------------------------------------------- магазин
    def shop_items(self):
        with self.driver.transaction(isolation='read committed') as c:
            rows = c.execute('SELECT * FROM shop_items WHERE on_sale=1 '
                             'ORDER BY item_order, price').fetchall()
        return rows

    def all_items(self):
        """Полный каталог предметов для админ-панели."""
        with self.driver.transaction(isolation='read committed') as c:
            return c.execute('SELECT id,item_type AS kind,name AS name_ru,name_en,price,'
                             'image AS icon,payload,item_order,p.is_active FROM items p '
                             'ORDER BY item_type, item_order').fetchall()

    def upsert_item(self, item: dict) -> dict:
        item_id = str(item['id']).strip()
        if not re.fullmatch(r'[a-z0-9:_\-]{2,48}', item_id):
            raise StoreError('Некорректный id предмета')
        with self.driver.transaction() as c:
            c.execute('INSERT INTO items(id,item_type,name,name_en,price,image,payload,item_order,'
                      'is_active,created_at) VALUES(?,?,?,?,?,?,?,?,?,?) '
                      'ON CONFLICT (id) DO UPDATE SET item_type=EXCLUDED.item_type, '
                      'name=EXCLUDED.name, name_en=EXCLUDED.name_en, price=EXCLUDED.price, '
                      'image=EXCLUDED.image, payload=EXCLUDED.payload, item_order=EXCLUDED.item_order, '
                      'is_active=EXCLUDED.is_active',
                      (item_id, str(item.get('kind') or 'avatar')[:24], str(item['name_ru'])[:80],
                       str(item.get('name_en') or item['name_ru'])[:80],
                       max(0, int(item.get('price') or 0)), str(item.get('icon') or 'user')[:32],
                       str(item.get('payload') or '')[:200], int(item.get('order') or 0),
                       bool(item.get('active', True)), iso()))
        return {'id': item_id}

    def purchases(self, user_id: int):
        with self.driver.transaction(isolation='read committed') as c:
            return c.execute('SELECT p.item_id AS item_id, p.price AS price, p.created AS created, '
                             's.kind AS kind, s.name_ru AS name_ru, s.name_en AS name_en, '
                             's.icon AS icon, s.payload AS payload '
                             'FROM purchases p LEFT JOIN shop_items s ON s.id=p.item_id '
                             'WHERE p.user_id=? ORDER BY p.id DESC', (int(user_id),)).fetchall()

    def owned_ids(self, user_id: int) -> set:
        with self.driver.transaction(isolation='read committed') as c:
            rows = c.execute('SELECT item_id FROM inventory WHERE user_id=?', (int(user_id),)).fetchall()
        return {r['item_id'] for r in rows}

    def buy_item(self, user_id: int, item_id: str) -> dict:
        """Покупка предмета: списание и выдача — одна транзакция, защита от дублей."""
        with self.driver.transaction() as c:
            item = c.execute('SELECT i.*, i.name AS name_ru, i.item_type AS kind, i.image AS icon '
                             'FROM items i WHERE i.id=? AND i.is_active=TRUE',
                             (str(item_id),)).fetchone()
            if not item:
                raise NotFound('Товар не найден')
            if c.execute('SELECT 1 FROM inventory WHERE user_id=? AND item_id=?',
                         (int(user_id), item['id'])).fetchone():
                bal = self._wallet_for_update(c, int(user_id))
                return {'already': True, 'balance': bal, 'item': item}
            price = int(item['price'])
            if price > 0:
                self._apply_delta(c, int(user_id), -price, 'shop',
                                  f'Куплено: {item["name_ru"]}',
                                  f'buy:{int(user_id)}:{item["id"]}')
            c.execute('INSERT INTO inventory(user_id,item_id,quantity,acquired_at) '
                      'VALUES(?,?,1,?) ON CONFLICT (user_id,item_id) DO UPDATE SET '
                      'quantity=inventory.quantity+1', (int(user_id), item['id'], iso()))
            balance = self._wallet_for_update(c, int(user_id))
        return {'already': False, 'balance': balance, 'item': item}

    def buy_item_free(self, user_id: int, item_id: str) -> dict:
        """Выдать предмет без списания (перенос старых покупок при импорте)."""
        with self.driver.transaction() as c:
            row = c.execute('SELECT id FROM items WHERE id=?', (str(item_id),)).fetchone()
            if not row:
                raise NotFound('Товар не найден')
            c.execute('INSERT INTO inventory(user_id,item_id,quantity,acquired_at) '
                      'VALUES(?,?,1,?) ON CONFLICT (user_id,item_id) DO UPDATE SET '
                      'quantity=inventory.quantity+1', (int(user_id), str(item_id), iso()))
            balance = self._wallet_for_update(c, int(user_id))
        return {'balance': balance, 'item_id': str(item_id)}

    # ---------------------------------------------------------------- достижения
    def achievements(self):
        with self.driver.transaction(isolation='read committed') as c:
            return c.execute('SELECT id, name AS name_ru, name_en, description AS desc_ru, '
                             'desc_en, icon, reward AS coins, item_order AS item_order '
                             'FROM achievements WHERE is_active=TRUE ORDER BY item_order').fetchall()

    def upsert_achievement(self, ach: dict) -> dict:
        ach_id = str(ach['id']).strip()
        if not re.fullmatch(r'[a-z0-9:_\-]{2,48}', ach_id):
            raise StoreError('Некорректный id достижения')
        with self.driver.transaction() as c:
            c.execute('INSERT INTO achievements(id,name,description,icon,reward,name_en,desc_en,'
                      'item_order,is_active,created_at) VALUES(?,?,?,?,?,?,?,?,?,?) '
                      'ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, '
                      'description=EXCLUDED.description, icon=EXCLUDED.icon, reward=EXCLUDED.reward, '
                      'name_en=EXCLUDED.name_en, desc_en=EXCLUDED.desc_en, '
                      'item_order=EXCLUDED.item_order, is_active=EXCLUDED.is_active',
                      (ach_id, str(ach['name_ru'])[:80], str(ach.get('desc_ru') or '')[:200],
                       str(ach.get('icon') or 'trophy')[:32], max(0, int(ach.get('coins') or 0)),
                       str(ach.get('name_en') or ach['name_ru'])[:80],
                       str(ach.get('desc_en') or '')[:200], int(ach.get('order') or 0),
                       bool(ach.get('active', True)), iso()))
        return {'id': ach_id}

    def user_achievements(self, user_id: int):
        with self.driver.transaction(isolation='read committed') as c:
            rows = c.execute(
                'SELECT a.id, a.name AS name_ru, a.name_en, a.description AS desc_ru, a.desc_en, '
                'a.icon, a.reward AS coins, a.item_order AS item_order, '
                'ua.unlocked_at AS unlocked FROM user_achievements ua '
                'JOIN achievements a ON a.id=ua.achievement_id WHERE ua.user_id=? '
                'ORDER BY ua.unlocked_at DESC', (int(user_id),)).fetchall()
        for row in rows:
            row['unlocked'] = _epoch(row.pop('unlocked_at', None))
        return rows

    def unlock_achievement(self, user_id: int, ach_id: str) -> dict | None:
        with self.driver.transaction() as c:
            ach = c.execute('SELECT id, name AS name_ru, name_en, description AS desc_ru, desc_en, '
                            'icon, reward AS coins FROM achievements WHERE id=?',
                            (ach_id,)).fetchone()
            if not ach:
                return None
            if c.execute('SELECT 1 FROM user_achievements WHERE user_id=? AND achievement_id=?',
                         (int(user_id), ach_id)).fetchone():
                return None
            c.execute('INSERT INTO user_achievements(user_id,achievement_id,unlocked_at) '
                      'VALUES(?,?,?) ON CONFLICT (user_id,achievement_id) DO NOTHING',
                      (int(user_id), ach_id, iso()))
            if int(ach['coins']) > 0:
                self._apply_delta(c, int(user_id), int(ach['coins']), 'achievement',
                                  f'Достижение: {ach["name_ru"]}', f'ach:{int(user_id)}:{ach_id}')
            balance = self._wallet_for_update(c, int(user_id))
        return {'achievement': ach, 'balance': balance}

    def recent_achievements(self, limit: int = 10):
        with self.driver.transaction(isolation='read committed') as c:
            rows = c.execute(
                'SELECT a.name AS name_ru, a.name_en, a.icon, a.reward AS coins, '
                'ua.unlocked_at AS unlocked, u.username FROM user_achievements ua '
                'JOIN achievements a ON a.id=ua.achievement_id '
                'JOIN users u ON u.id=ua.user_id ORDER BY ua.unlocked_at DESC LIMIT ?',
                (max(1, min(50, int(limit))),)).fetchall()
        for row in rows:
            row['unlocked'] = _epoch(row.pop('unlocked_at', None))
        return rows

    # ---------------------------------------------------------------- казино
    def casino_bet(self, user_id: int, game: str, stake: int, outcome: str, ref: str,
                   payout: int, detail: str | None = None, charge: int | None = None,
                   free_key: str | None = None) -> dict:
        """Ставка: списание, выигрыш, история — одна транзакция с блокировкой кошелька."""
        stake, payout = int(stake), int(payout)
        charge = stake if charge is None else max(0, int(charge))
        with self.driver.transaction() as c:
            existing = c.execute('SELECT * FROM casino_history WHERE reference_id=?',
                                 (ref,)).fetchone()
            if existing:
                bal = self._wallet_for_update(c, int(user_id))
                return {'repeated': True, 'balance': bal, 'bet': existing}
            cfg = {r['key']: r['value'] for r in
                   c.execute('SELECT key,value FROM platform_settings').fetchall()}
            if cfg.get('casino_enabled', '1') != '1':
                raise LimitExceeded('Казино временно отключено')
            if cfg.get(f'{game}_enabled', '1') != '1':
                raise LimitExceeded('Этот автомат временно отключён')
            if game == 'wheel':
                paid_limit = int(cfg.get('wheel_paid_daily', '5') or 5)
                paid = c.execute("SELECT COUNT(*) AS n FROM casino_history "
                                 "WHERE user_id=? AND game_type='wheel' AND created_at>=?",
                                 (int(user_id), iso(day_start()))).fetchone()
                if int(paid['n'] if paid else 0) >= paid_limit:
                    raise LimitExceeded(f'Лимит {paid_limit} платных вращений в сутки исчерпан')
            min_stake = int(cfg.get('min_stake', '5') or 5)
            max_stake = int(cfg.get('max_stake', '100') or 100)
            if stake < min_stake or stake > max_stake:
                raise LimitExceeded(f'Ставка должна быть от {min_stake} до {max_stake} V')
            user = c.execute('SELECT cl.exclude_until AS exclude_until, '
                             'COALESCE(cl.daily_limit,0) AS daily_limit FROM users u '
                             'LEFT JOIN casino_limits cl ON cl.user_id=u.id WHERE u.id=?',
                             (int(user_id),)).fetchone()
            if user and _epoch(user['exclude_until']) > now():
                raise LimitExceeded('Вы добровольно ограничили игру в казино')
            if free_key:
                if c.execute('SELECT 1 FROM platform_settings WHERE key=?', (free_key,)).fetchone():
                    raise LimitExceeded('Бесплатный спин уже использован сегодня')
                c.execute('INSERT INTO platform_settings(key,value) VALUES(?,?)',
                          (free_key, str(now())))
            daily = int(user['daily_limit'] or 0) if user else 0
            if daily > 0 and charge > 0:
                spent = c.execute('SELECT COALESCE(SUM(bet),0) AS s FROM casino_history '
                                  'WHERE user_id=? AND created_at>=?',
                                  (int(user_id), iso(now() - 86400))).fetchone()
                if int(spent['s']) + charge > daily:
                    raise LimitExceeded(f'Дневной лимит ставок {daily} V исчерпан')
            if charge > 0:
                self._apply_delta(c, int(user_id), -charge, 'casino', f'Ставка: {game}', f'bet:{ref}')
            if payout > 0:
                self._apply_delta(c, int(user_id), payout, 'casino-win', f'Выигрыш: {game}',
                                  f'win:{ref}')
            c.execute('INSERT INTO casino_history(user_id,game_type,bet,reward,result,detail,'
                      'reference_id,created_at) VALUES(?,?,?,?,?,?,?,?)',
                      (int(user_id), game, stake, payout, str(outcome)[:120],
                       str(detail or ref)[:200], ref, iso()))
            balance = self._wallet_for_update(c, int(user_id))
        return {'repeated': False, 'balance': balance, 'stake': stake, 'charge': charge,
                'payout': payout}

    def import_casino_history(self, user_id: int, game: str, bet: int, reward: int,
                              outcome: str, detail: str, created: int = 0) -> bool:
        """Перенести историческую ставку **без** движения монет (импорт старых баз)."""
        ref = f'legacy:{detail or created}:{int(user_id)}'[:180]
        try:
            with self.driver.transaction() as c:
                if c.execute('SELECT 1 FROM casino_history WHERE reference_id=?',
                             (ref,)).fetchone():
                    return False
                c.execute('INSERT INTO casino_history(user_id,game_type,bet,reward,result,'
                          'detail,reference_id,created_at) VALUES(?,?,?,?,?,?,?,?)',
                          (int(user_id), str(game)[:32], max(0, int(bet)), max(0, int(reward)),
                           str(outcome)[:120], str(detail)[:200], ref,
                           iso(created) if created else iso()))
            return True
        except Exception:  # noqa: BLE001 — история не должна валить импорт
            return False

    def casino_history(self, user_id: int, limit: int = 25, game: str | None = None):
        with self.driver.transaction(isolation='read committed') as c:
            if game:
                rows = c.execute('SELECT * FROM casino_bets WHERE user_id=? AND game=? '
                                 'ORDER BY id DESC LIMIT ?',
                                 (int(user_id), game, max(1, min(200, int(limit))))).fetchall()
            else:
                rows = c.execute('SELECT * FROM casino_bets WHERE user_id=? ORDER BY id DESC LIMIT ?',
                                 (int(user_id), max(1, min(200, int(limit))))).fetchall()
        return rows

    def casino_history_admin(self, limit: int = 50, username: str = ''):
        sql = ('SELECT h.id, h.game_type AS game, h.bet AS stake, h.reward AS payout, '
               'h.result AS outcome, h.created_at, u.username FROM casino_history h '
               'JOIN users u ON u.id=h.user_id')
        params: list = []
        if username:
            sql += ' WHERE u.username_key=?'
            params.append(username.strip().casefold())
        sql += ' ORDER BY h.id DESC LIMIT ?'
        params.append(max(1, min(500, int(limit))))
        with self.driver.transaction(isolation='read committed') as c:
            rows = c.execute(sql, params).fetchall()
        for row in rows:
            row['created'] = _epoch(row.pop('created_at', None))
        return rows

    def casino_stats(self, user_id: int):
        with self.driver.transaction(isolation='read committed') as c:
            row = c.execute("SELECT COUNT(*) AS bets, "
                            "COALESCE(SUM(CASE WHEN game_type='wheel_free' THEN 0 ELSE bet END),0) AS staked, "
                            "COALESCE(SUM(reward),0) AS won, COALESCE(MAX(reward),0) AS best "
                            "FROM casino_history WHERE user_id=?", (int(user_id),)).fetchone()
            today_row = c.execute(
                "SELECT COALESCE(SUM(CASE WHEN game_type='wheel_free' THEN 0 ELSE bet END),0) AS s "
                "FROM casino_history WHERE user_id=? AND created_at>=?",
                (int(user_id), iso(now() - 86400))).fetchone()
        stats = dict(row or {})
        stats['today_staked'] = int(today_row['s']) if today_row else 0
        return stats

    def casino_wheel_limits(self, user_id: int, free_limit: int = 1, paid_limit: int = 5) -> dict:
        """Сколько вращений «Рулетки Vert» осталось сегодня (сброс в 00:00 UTC)."""
        start = iso(day_start())
        uid = int(user_id)
        with self.driver.transaction(isolation='read committed') as c:
            free_used = c.execute("SELECT COUNT(*) AS n FROM casino_history "
                                  "WHERE user_id=? AND game_type=? AND created_at>=?",
                                  (uid, 'wheel_free', start)).fetchone()
            paid_used = c.execute("SELECT COUNT(*) AS n FROM casino_history "
                                  "WHERE user_id=? AND game_type IN ('wheel') AND created_at>=?",
                                  (uid, start)).fetchone()
        used_free = int(free_used['n'] if free_used else 0)
        used_paid = int(paid_used['n'] if paid_used else 0)
        return {'free_limit': int(free_limit), 'free_used': used_free,
                'free_left': max(0, int(free_limit) - used_free),
                'paid_limit': int(paid_limit), 'paid_used': used_paid,
                'paid_left': max(0, int(paid_limit) - used_paid),
                'reset_at': next_reset(), 'server_now': now()}

    def casino_limits(self, user_id: int):
        with self.driver.transaction(isolation='read committed') as c:
            row = c.execute('SELECT cl.daily_limit, cl.exclude_until FROM users u '
                            'LEFT JOIN casino_limits cl ON cl.user_id=u.id WHERE u.id=?',
                            (int(user_id),)).fetchone()
        return {'daily_limit': int(row['daily_limit'] or 0) if row else 0,
                'exclude_until': _epoch(row['exclude_until']) if row else 0,
                'next_free_spin': 0}

    def set_casino_limits(self, user_id: int, daily_limit=None, exclude_until=None):
        """Сохранить дневной лимит и/или самоисключение (0 снимает ограничение)."""
        with self.driver.transaction() as c:
            row = c.execute('SELECT daily_limit, exclude_until FROM casino_limits '
                            'WHERE user_id=?', (int(user_id),)).fetchone()
            limit = int(row['daily_limit'] or 0) if row else 0
            until = row['exclude_until'] if row else None
            if daily_limit is not None:
                limit = max(0, int(daily_limit))
            if exclude_until is not None:
                until = iso(int(exclude_until)) if int(exclude_until) > 0 else None
            c.execute('INSERT INTO casino_limits(user_id,daily_limit,exclude_until,updated_at) '
                      'VALUES(?,?,?,?) ON CONFLICT (user_id) DO UPDATE SET '
                      'daily_limit=EXCLUDED.daily_limit, exclude_until=EXCLUDED.exclude_until, '
                      'updated_at=EXCLUDED.updated_at',
                      (int(user_id), limit, until, iso()))

    # ---------------------------------------------------------------- задания
    def daily_tasks(self):
        with self.driver.transaction(isolation='read committed') as c:
            return c.execute('SELECT id,title,description,reward,task_type,target_value,'
                             'title_en,desc_en,is_active FROM daily_tasks WHERE is_active=TRUE '
                             'ORDER BY id').fetchall()

    def upsert_daily_task(self, task: dict) -> dict:
        with self.driver.transaction() as c:
            if task.get('id'):
                c.execute('UPDATE daily_tasks SET title=?,description=?,reward=?,task_type=?,'
                          'target_value=?,title_en=?,desc_en=?,is_active=? WHERE id=?',
                          (str(task['title'])[:120], str(task.get('description') or '')[:300],
                           max(0, int(task.get('reward') or 0)),
                           str(task.get('task_type') or 'play')[:32],
                           max(1, int(task.get('target_value') or 1)),
                           str(task.get('title_en') or task['title'])[:120],
                           str(task.get('desc_en') or '')[:300],
                           bool(task.get('active', True)), int(task['id'])))
                return {'id': int(task['id'])}
            cur = c.execute('INSERT INTO daily_tasks(title,description,reward,task_type,target_value,'
                            'title_en,desc_en,is_active,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
                            (str(task['title'])[:120], str(task.get('description') or '')[:300],
                             max(0, int(task.get('reward') or 0)),
                             str(task.get('task_type') or 'play')[:32],
                             max(1, int(task.get('target_value') or 1)),
                             str(task.get('title_en') or task['title'])[:120],
                             str(task.get('desc_en') or '')[:300],
                             bool(task.get('active', True)), iso()))
            new_id = cur.lastrowid
            if new_id is None:
                new_id = c.execute('SELECT MAX(id) AS id FROM daily_tasks').fetchone()['id']
        return {'id': int(new_id)}

    def user_daily_tasks(self, user_id: int):
        with self.driver.transaction(isolation='read committed') as c:
            return c.execute(
                'SELECT t.id, t.title, t.description, t.reward, t.task_type, t.target_value, '
                'COALESCE(ud.progress,0) AS progress, COALESCE(ud.completed,FALSE) AS completed, '
                'COALESCE(ud.claimed,FALSE) AS claimed FROM daily_tasks t '
                'LEFT JOIN user_daily_tasks ud ON ud.task_id=t.id AND ud.user_id=? '
                'AND ud.task_date=? WHERE t.is_active=TRUE ORDER BY t.id',
                (int(user_id), _today_iso())).fetchall()

    def progress_task(self, user_id: int, task_type: str, amount: int = 1) -> list[dict]:
        """Продвинуть ежедневные задания нужного типа (вызывается игровыми событиями)."""
        amount = max(0, int(amount))
        if not amount:
            return []
        day = datetime.now(timezone.utc).date()
        done: list[dict] = []
        with self.driver.transaction() as c:
            tasks = c.execute('SELECT id,target_value,reward FROM daily_tasks '
                              'WHERE is_active=TRUE AND task_type=?', (task_type,)).fetchall()
            for task in tasks:
                c.execute('INSERT INTO user_daily_tasks(user_id,task_id,progress,completed,'
                          'claimed,task_date,updated_at) VALUES(?,?,?,?,FALSE,?,?) '
                          'ON CONFLICT (user_id,task_id,task_date) DO UPDATE SET '
                          'progress=user_daily_tasks.progress+EXCLUDED.progress, '
                          'completed=(user_daily_tasks.progress+EXCLUDED.progress)>=? , '
                          'updated_at=EXCLUDED.updated_at',
                          (int(user_id), task['id'], amount,
                           amount >= int(task['target_value']), day.isoformat(), iso(),
                           int(task['target_value'])))
                row = c.execute('SELECT progress,completed FROM user_daily_tasks '
                                'WHERE user_id=? AND task_id=? AND task_date=?',
                                (int(user_id), task['id'], day.isoformat())).fetchone()
                done.append({'task': task['id'], 'progress': int(row['progress']),
                             'completed': bool(row['completed'])})
        return done

    def claim_task(self, user_id: int, task_id: int) -> dict:
        """Забрать награду задания. Повторная попытка награду не дублирует."""
        day = datetime.now(timezone.utc).date()
        with self.driver.transaction() as c:
            row = c.execute('SELECT ud.progress,ud.completed,ud.claimed,t.reward,t.target_value '
                            'FROM user_daily_tasks ud JOIN daily_tasks t ON t.id=ud.task_id '
                            'WHERE ud.user_id=? AND ud.task_id=? AND ud.task_date=? FOR UPDATE',
                            (int(user_id), int(task_id), day.isoformat())).fetchone()
            if not row:
                raise NotFound('Задание не найдено')
            if row['claimed']:
                bal = self._wallet_for_update(c, int(user_id))
                return {'ok': True, 'already': True, 'reward': 0, 'balance': bal}
            if int(row['progress']) < int(row['target_value']):
                raise LimitExceeded('Задание ещё не выполнено')
            c.execute('UPDATE user_daily_tasks SET claimed=TRUE, completed=TRUE '
                      'WHERE user_id=? AND task_id=? AND task_date=?',
                      (int(user_id), int(task_id), day.isoformat()))
            reward = int(row['reward'])
            balance = (self._apply_delta(c, int(user_id), reward, 'task',
                                         f'Задание #{int(task_id)}: награда',
                                         f'task:{int(user_id)}:{int(task_id)}:{day.isoformat()}')
                       if reward else self._wallet_for_update(c, int(user_id)))
        return {'ok': True, 'already': False, 'reward': reward, 'balance': balance}

    # ---------------------------------------------------------------- админка
    def top_users(self, limit: int = 10):
        with self.driver.transaction(isolation='read committed') as c:
            rows = c.execute('SELECT u.username, COALESCE(w.balance,0) AS coins, u.avatar, u.color, '
                             'u.title, u.created_at AS created, u.is_admin, u.level '
                             'FROM users u LEFT JOIN wallets w ON w.user_id=u.id '
                             'WHERE u.banned=FALSE AND u.is_active=TRUE '
                             'ORDER BY COALESCE(w.balance,0) DESC, u.created_at ASC LIMIT ?',
                             (max(1, min(100, int(limit))),)).fetchall()
        for row in rows:
            row['created'] = _epoch(row.get('created'))
            row['coins'] = int(row.get('coins') or 0)
        return rows

    def platform_stats(self):
        day_ago = iso(now() - 86400)
        with self.driver.transaction(isolation='read committed') as c:
            users = c.execute('SELECT COUNT(*) AS n FROM users').fetchone()['n']
            active = c.execute('SELECT COUNT(*) AS n FROM users WHERE last_seen>?',
                               (day_ago,)).fetchone()['n']
            coins = c.execute('SELECT COALESCE(SUM(balance),0) AS n FROM wallets').fetchone()['n']
            bets = c.execute('SELECT COUNT(*) AS n FROM casino_history').fetchone()['n']
            staked = c.execute('SELECT COALESCE(SUM(bet),0) AS n FROM casino_history').fetchone()['n']
            paid = c.execute('SELECT COALESCE(SUM(reward),0) AS n FROM casino_history').fetchone()['n']
            plays = c.execute('SELECT COALESCE(SUM(plays),0) AS n FROM game_statistics').fetchone()['n']
            ledger = c.execute('SELECT COUNT(*) AS n FROM transactions').fetchone()['n']
            banned = c.execute('SELECT COUNT(*) AS n FROM users WHERE banned=TRUE').fetchone()['n']
            new_today = c.execute('SELECT COUNT(*) AS n FROM users WHERE created_at>?',
                                  (day_ago,)).fetchone()['n']
        return {'users': int(users), 'active24': int(active), 'coins': int(coins),
                'bets': int(bets), 'staked': int(staked), 'paid': int(paid),
                'plays': int(plays), 'ledger': int(ledger), 'banned': int(banned),
                'new24': int(new_today), 'backend': self.backend}

    def search_users(self, query: str = '', limit: int = 30, offset: int = 0):
        q = str(query or '').strip()
        limit = max(1, min(100, int(limit)))
        base = ('SELECT u.id, u.username, COALESCE(w.balance,0) AS coins, u.is_admin, u.banned, '
                'u.is_active, u.level, u.role, u.created_at AS created, u.last_seen AS last_seen '
                'FROM users u LEFT JOIN wallets w ON w.user_id=u.id')
        with self.driver.transaction(isolation='read committed') as c:
            if q:
                rows = c.execute(base + ' WHERE u.username_key LIKE ? ORDER BY u.last_seen DESC '
                                 'LIMIT ? OFFSET ?',
                                 (f'%{q.casefold()}%', limit, max(0, int(offset)))).fetchall()
                total = c.execute('SELECT COUNT(*) AS n FROM users WHERE username_key LIKE ?',
                                  (f'%{q.casefold()}%',)).fetchone()['n']
            else:
                rows = c.execute(base + ' ORDER BY u.last_seen DESC LIMIT ? OFFSET ?',
                                 (limit, max(0, int(offset)))).fetchall()
                total = c.execute('SELECT COUNT(*) AS n FROM users').fetchone()['n']
        for row in rows:
            row['created'] = _epoch(row.get('created'))
            row['last_seen'] = _epoch(row.get('last_seen'))
            row['is_admin'] = 1 if row.get('is_admin') else 0
            row['banned'] = 1 if row.get('banned') else 0
            row['is_active'] = 1 if row.get('is_active') else 0
        return rows, int(total)

    def set_admin(self, user_id: int, is_admin: bool):
        with self.driver.transaction(isolation='read committed') as c:
            c.execute("UPDATE users SET is_admin=?, role=? WHERE id=?",
                      (bool(is_admin), 'admin' if is_admin else 'player', int(user_id)))

    def admin_log(self, admin: str, action: str, target: str = '', detail: str = '',
                  ip_hash: str = ''):
        with self.driver.transaction(isolation='read committed') as c:
            c.execute('INSERT INTO admin_log(admin,action,target,detail,ip_hash,created_at) '
                      'VALUES(?,?,?,?,?,?)',
                      (str(admin)[:64], str(action)[:64], str(target)[:64], str(detail)[:400],
                       str(ip_hash)[:64], iso()))

    def admin_log_rows(self, limit: int = 50):
        with self.driver.transaction(isolation='read committed') as c:
            rows = c.execute('SELECT * FROM admin_log ORDER BY id DESC LIMIT ?',
                             (max(1, min(200, int(limit))),)).fetchall()
        for row in rows:
            row['created'] = _epoch(row.pop('created_at', None))
        return rows

    def new_admin_session(self, ip: str = '') -> str:
        token = secrets.token_urlsafe(32)
        with self.driver.transaction(isolation='read committed') as c:
            c.execute('DELETE FROM admin_sessions WHERE expires_at<?', (iso(),))
            c.execute('INSERT INTO admin_sessions(token_hash,created_at,expires_at,ip_hash) '
                      'VALUES(?,?,?,?)',
                      (digest(token), iso(), iso(time.time() + ADMIN_SESSION_TTL),
                       digest(ip) if ip else ''))
        return token

    def admin_session_valid(self, token: str) -> bool:
        if not token:
            return False
        with self.driver.transaction(isolation='read committed') as c:
            row = c.execute('SELECT expires_at FROM admin_sessions WHERE token_hash=?',
                            (digest(token),)).fetchone()
        return bool(row and _epoch(row['expires_at']) > now())

    def delete_admin_session(self, token: str):
        if not token:
            return
        with self.driver.transaction(isolation='read committed') as c:
            c.execute('DELETE FROM admin_sessions WHERE token_hash=?', (digest(token),))

    def stats_for_user(self, user_id: int) -> dict:
        """Полный профиль для админ-панели."""
        user = self.get_user(user_id)
        if not user:
            return {}
        with self.driver.transaction(isolation='read committed') as c:
            plays = c.execute('SELECT COALESCE(SUM(plays),0) AS p, COALESCE(SUM(coins),0) AS c '
                              'FROM game_statistics WHERE user_id=?', (int(user_id),)).fetchone()
            bets = c.execute('SELECT COUNT(*) AS n, COALESCE(SUM(bet),0) AS s, '
                             'COALESCE(SUM(reward),0) AS w FROM casino_history WHERE user_id=?',
                             (int(user_id),)).fetchone()
            since = c.execute('SELECT COUNT(*) AS n FROM game_receipts WHERE user_id=?',
                              (int(user_id),)).fetchone()
        return {'user': user, 'plays': int(plays['p']), 'game_coins': int(plays['c']),
                'casino_bets': int(bets['n']), 'casino_staked': int(bets['s']),
                'casino_won': int(bets['w']), 'receipts': int(since['n'])}

    # ---------------------------------------------------------------- заказы
    def create_order(self, order_id: str, user_id: int, provider: str, pack: str, coins: int,
                     amount_minor: int, currency: str):
        with self.driver.transaction(isolation='read committed') as c:
            c.execute('INSERT INTO shop_orders(id,user_id,provider,pack,coins,amount_minor,currency,'
                      'status,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
                      (order_id, int(user_id), provider, pack, int(coins), int(amount_minor),
                       currency, 'pending', iso()))

    def order(self, order_id: str):
        with self.driver.transaction(isolation='read committed') as c:
            row = c.execute('SELECT * FROM shop_orders WHERE id=?', (order_id,)).fetchone()
        if row:
            row['created'] = _epoch(row.pop('created_at', None))
            row['paid'] = _epoch(row.pop('paid_at', None)) or None
        return row

    def set_order_ref(self, order_id: str, provider_ref: str):  # noqa: D401
        with self.driver.transaction(isolation='read committed') as c:
            c.execute('UPDATE shop_orders SET provider_ref=? WHERE id=?',
                      (str(provider_ref)[:120], order_id))

    def fail_order(self, order_id: str):
        with self.driver.transaction(isolation='read committed') as c:
            c.execute("UPDATE shop_orders SET status='failed' WHERE id=? AND status='pending'",
                      (order_id,))

    def mark_order_paid(self, order_id: str, reference: str = '') -> bool:
        """Отметить заказ оплаченным (по вебхуку провайдера). Повтор не опасен."""
        with self.driver.transaction() as c:
            row = c.execute('SELECT status, user_id, coins FROM shop_orders WHERE id=? FOR UPDATE',
                            (str(order_id),)).fetchone()
            if not row or row['status'] == 'paid':
                return False
            c.execute("UPDATE shop_orders SET status='paid', paid_at=?, provider_ref=? WHERE id=?",
                      (iso(), str(reference)[:120], str(order_id)))
            c.execute('INSERT INTO shop_ledger(order_id,user_id,coins,reason,provider_ref,'
                      'created_at) VALUES(?,?,?,?,?,?)',
                      (str(order_id), int(row['user_id']), int(row['coins']), 'purchase',
                       str(reference)[:120], iso()))
        return True

    def claim_order(self, order_id: str, user_id: int | None = None) -> dict:
        """Начислить оплаченный заказ ровно один раз (защита от двойного начисления)."""
        with self.driver.transaction() as c:
            sql = 'SELECT id,claimed,coins,user_id,status FROM shop_orders WHERE id=?'
            params: list = [str(order_id)]
            if user_id is not None:
                sql += ' AND user_id=?'
                params.append(int(user_id))
            row = c.execute(sql + ' FOR UPDATE', params).fetchone()
            if not row:
                raise NotFound('Заказ не найден')
            owner = int(row['user_id'])
            if row['claimed']:
                return {'already': True, 'coins': int(row['coins']),
                        'balance': self._wallet_for_update(c, owner)}
            if row['status'] != 'paid':
                raise StoreError('Оплата ещё не подтверждена')
            c.execute('UPDATE shop_orders SET claimed=TRUE WHERE id=?', (row['id'],))
            balance = self._apply_delta(c, owner, int(row['coins']), 'purchase',
                                        f'Покупка пакета {order_id}', f'order:{row["id"]}')
        return {'already': False, 'coins': int(row['coins']), 'balance': balance}

    def order_history(self, user_id: int, limit: int = 20):
        with self.driver.transaction(isolation='read committed') as c:
            rows = c.execute('SELECT id,pack,coins,status,created_at FROM shop_orders '
                             'WHERE user_id=? ORDER BY created_at DESC LIMIT ?',
                             (int(user_id), max(1, min(50, int(limit))))).fetchall()
        for row in rows:
            row['created'] = _epoch(row.pop('created_at', None))
        return rows


# --------------------------------------------------------------------------- #
#  Фабрика
# --------------------------------------------------------------------------- #
_STORE = None
_STORE_LOCK = threading.Lock()


def get_store() -> DataStore:
    global _STORE
    if _STORE is None:
        with _STORE_LOCK:
            if _STORE is None:
                _STORE = _build_store()
    return _STORE


def _build_store() -> DataStore:
    url = (os.environ.get('DATABASE_URL') or '').strip()
    if url:
        return DataStore(PgDriver(url))
    # SQLite — только локально/в тестах: PostgreSQL-схема недоступна, поэтому
    # включается упрощённая схема из schema_sqlite.py.
    path = os.environ.get('VERTU_DB') or str(Path(__file__).resolve().parent / 'data' / 'vertu.sqlite3')
    return DataStore(SqliteDriver(path))


def reset_store():
    """Сбросить кэш (используется в тестах)."""
    global _STORE
    with _STORE_LOCK:
        if _STORE is not None:
            try:
                _STORE.driver.close()
            except Exception:  # noqa: BLE001
                pass
        _STORE = None
