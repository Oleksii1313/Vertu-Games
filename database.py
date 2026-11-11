#!/usr/bin/env python3
"""VertGames — SQLite storage: accounts, sessions, coin balances.

Single source of truth for everything that is persisted on the server:

    users        аккаунты + баланс V-коинов (колонка coins)
    sessions     cookie-сессии (хранится только sha256 от токена)
    pending      регистрации, ожидающие кода из письма
    limits       rate-limit счётчики
    coin_ledger  журнал начислений/списаний монет (аудит, история)

Модуль полностью совместим с прежним кодом server.py: тот же файл базы
(data/accounts.sqlite3, переопределяется через VERTGAMES_DB), тот же
row_factory=sqlite3.Row, те же имена таблиц. Поэтому в server.py достаточно
заменить inline connect()/init_db() на вызовы отсюда — остальные SQL-запросы
работают как раньше.

Запуск из консоли:
    python3 database.py init
    python3 database.py list
    python3 database.py create-user <ник> <email> <пароль>
    python3 database.py coins <ник> [сколько добавить]
    python3 database.py reset-password <ник> <новый пароль>
"""
from __future__ import annotations
import hashlib, hmac, os, secrets, sqlite3, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get('VERTGAMES_DB', str(ROOT / 'data' / 'accounts.sqlite3')))
SESSION_TTL = 30 * 24 * 3600          # 30 дней, как в server.py
PBKDF2_ROUNDS = 310000
DEFAULT_COINS = 0                     # приветственный бонус задаёт вызывающий код


class ClosingConnection(sqlite3.Connection):
    """SQLite context manager commits/rolls back but does not close the file."""

    def __exit__(self, *args):
        try:
            return super().__exit__(*args)
        finally:
            self.close()


class DatabaseError(Exception):
    """Base class for storage errors that map to HTTP 4xx in server.py."""


class DuplicateUser(DatabaseError):
    """Ник или email уже заняты."""


class InvalidCredentials(DatabaseError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


# --------------------------------------------------------------------------- #
#  Подключение и схема
# --------------------------------------------------------------------------- #
def connect(path: Path | str | None = None) -> sqlite3.Connection:
    """Открыть соединение с базой (WAL, Row, внешние ограничения)."""
    target = Path(path or DB_PATH)
    target.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(str(target), timeout=15, factory=ClosingConnection)
    c.row_factory = sqlite3.Row
    c.execute('PRAGMA journal_mode=WAL')
    c.execute('PRAGMA synchronous=NORMAL')
    c.execute('PRAGMA foreign_keys=ON')
    c.execute('PRAGMA busy_timeout=15000')
    return c


SCHEMA = """
CREATE TABLE IF NOT EXISTS users(
    id           INTEGER PRIMARY KEY,
    username     TEXT    NOT NULL,
    username_key TEXT    NOT NULL UNIQUE,
    email        TEXT    NOT NULL,
    email_key    TEXT    NOT NULL UNIQUE,
    password     TEXT    NOT NULL,
    created      INTEGER NOT NULL,
    verified     INTEGER NOT NULL,
    coins        INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS pending(
    id           TEXT PRIMARY KEY,
    username     TEXT NOT NULL,
    username_key TEXT NOT NULL,
    email        TEXT NOT NULL,
    email_key    TEXT NOT NULL,
    password     TEXT NOT NULL,
    code_hash    TEXT NOT NULL,
    expires      INTEGER NOT NULL,
    sent         INTEGER NOT NULL,
    attempts     INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions(
    token_hash TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS limits(
    key   TEXT    PRIMARY KEY,
    count INTEGER NOT NULL,
    until INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS coin_ledger(
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    delta   INTEGER NOT NULL,
    reason  TEXT    NOT NULL DEFAULT '',
    balance INTEGER NOT NULL,
    created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_exp  ON sessions(expires);
CREATE INDEX IF NOT EXISTS idx_ledger_user   ON coin_ledger(user_id, id DESC);
"""


def init_db(conn: sqlite3.Connection | None = None) -> None:
    """Создать схему и домигрировать старые базы (без потери данных)."""
    own = conn is None
    c = conn or connect()
    try:
        c.executescript(SCHEMA)
        cols = {r['name'] for r in c.execute('PRAGMA table_info(users)')}
        if 'coins' not in cols:                      # база, созданная до этой версии
            c.execute('ALTER TABLE users ADD COLUMN coins INTEGER NOT NULL DEFAULT 0')
        pending_cols = {r['name'] for r in c.execute('PRAGMA table_info(pending)')}
        if 'attempts' not in pending_cols:
            c.execute('ALTER TABLE pending ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0')
        c.commit()
    finally:
        if own:
            c.close()


# --------------------------------------------------------------------------- #
#  Пароли
# --------------------------------------------------------------------------- #
def hash_password(password: str) -> str:
    """pbkdf2_sha256$<rounds>$<salt>$<hash> — формат совпадает с server.py."""
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), PBKDF2_ROUNDS).hex()
    return f'pbkdf2_sha256${PBKDF2_ROUNDS}${salt}${digest}'


def verify_password(password: str, stored: str) -> bool:
    try:
        alg, rounds, salt, expected = stored.split('$')
        if alg != 'pbkdf2_sha256':
            return False
        actual = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), int(rounds)).hex()
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError, AttributeError):
        return False


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def now() -> int:
    return int(time.time())


# --------------------------------------------------------------------------- #
#  Пользователи и баланс
# --------------------------------------------------------------------------- #
def create_user(username: str, email: str, password: str,
                verified: bool = True, coins: int = DEFAULT_COINS,
                conn: sqlite3.Connection | None = None) -> sqlite3.Row:
    """Создать аккаунт. Бросает DuplicateUser, если ник/email заняты."""
    own = conn is None
    c = conn or connect()
    try:
        name_key, email_key = username.strip().casefold(), email.strip().casefold()
        if c.execute('SELECT 1 FROM users WHERE username_key=? OR email_key=?',
                     (name_key, email_key)).fetchone():
            raise DuplicateUser('Такой ник или email уже зарегистрирован')
        cur = c.execute(
            'INSERT INTO users(username,username_key,email,email_key,password,created,verified,coins)'
            ' VALUES(?,?,?,?,?,?,?,?)',
            (username.strip(), name_key, email.strip(), email_key,
             hash_password(password), now(), int(bool(verified)), max(0, int(coins))))
        user_id = cur.lastrowid
        if coins:
            c.execute('INSERT INTO coin_ledger(user_id,delta,reason,balance,created) VALUES(?,?,?,?,?)',
                      (user_id, int(coins), 'welcome bonus', int(coins), now()))
        if own:
            c.commit()
        return get_user_by_id(user_id, conn=c)
    finally:
        if own:
            c.close()


def get_user_by_id(user_id: int, conn: sqlite3.Connection | None = None) -> sqlite3.Row | None:
    own = conn is None
    c = conn or connect()
    try:
        return c.execute('SELECT * FROM users WHERE id=?', (int(user_id),)).fetchone()
    finally:
        if own:
            c.close()


def find_user(identifier: str, conn: sqlite3.Connection | None = None) -> sqlite3.Row | None:
    """Найти аккаунт по нику ИЛИ email (регистр не важен)."""
    own = conn is None
    c = conn or connect()
    try:
        key = str(identifier or '').strip().casefold()
        if not key:
            return None
        return c.execute('SELECT * FROM users WHERE username_key=? OR email_key=?',
                         (key, key)).fetchone()
    finally:
        if own:
            c.close()


def username_taken(username: str, conn: sqlite3.Connection | None = None) -> bool:
    own = conn is None
    c = conn or connect()
    try:
        return bool(c.execute('SELECT 1 FROM users WHERE username_key=?',
                              (username.strip().casefold(),)).fetchone())
    finally:
        if own:
            c.close()


def email_taken(email: str, conn: sqlite3.Connection | None = None) -> bool:
    own = conn is None
    c = conn or connect()
    try:
        return bool(c.execute('SELECT 1 FROM users WHERE email_key=?',
                              (email.strip().casefold(),)).fetchone())
    finally:
        if own:
            c.close()


def authenticate(identifier: str, password: str,
                 conn: sqlite3.Connection | None = None) -> sqlite3.Row:
    """Проверить логин/пароль. Возвращает строку users или бросает InvalidCredentials."""
    user = find_user(identifier, conn=conn)
    if not user:
        raise InvalidCredentials('ACCOUNT_NOT_FOUND', 'Аккаунт не найден')
    if user['password'] == '!google-only':
        raise InvalidCredentials('GOOGLE_LOGIN_REQUIRED', 'Этот аккаунт создан через Google')
    if not isinstance(password, str) or not verify_password(password, user['password']):
        raise InvalidCredentials('WRONG_PASSWORD', 'Неверный пароль')
    return user


def get_balance(user_id: int, conn: sqlite3.Connection | None = None) -> int:
    own = conn is None
    c = conn or connect()
    try:
        row = c.execute('SELECT coins FROM users WHERE id=?', (int(user_id),)).fetchone()
        return int(row['coins']) if row else 0
    finally:
        if own:
            c.close()


def add_coins(user_id: int, delta: int, reason: str = '',
              conn: sqlite3.Connection | None = None) -> int:
    """Атомарно изменить баланс (никогда не уходит в минус). Возвращает новый баланс."""
    own = conn is None
    c = conn or connect()
    try:
        delta = int(delta)
        if not c.in_transaction:
            c.execute('BEGIN IMMEDIATE')      # атомарное чтение-изменение-запись
        c.execute('UPDATE users SET coins=MAX(0, coins + ?) WHERE id=?', (delta, int(user_id)))
        row = c.execute('SELECT coins FROM users WHERE id=?', (int(user_id),)).fetchone()
        if row is None:
            raise DatabaseError('Пользователь не найден')
        balance = int(row['coins'])
        c.execute('INSERT INTO coin_ledger(user_id,delta,reason,balance,created) VALUES(?,?,?,?,?)',
                  (int(user_id), delta, str(reason)[:120], balance, now()))
        if own:
            c.commit()
        return balance
    except Exception:
        if own:
            c.rollback()
        raise
    finally:
        if own:
            c.close()


def set_balance(user_id: int, value: int, reason: str = 'admin set',
                conn: sqlite3.Connection | None = None) -> int:
    """Жёстко выставить баланс (для админки/миграций)."""
    value = max(0, int(value))
    return add_coins(user_id, value - get_balance(user_id, conn=conn), reason, conn=conn)


def ledger(user_id: int, limit: int = 20, conn: sqlite3.Connection | None = None) -> list[dict]:
    own = conn is None
    c = conn or connect()
    try:
        rows = c.execute('SELECT delta,reason,balance,created FROM coin_ledger'
                         ' WHERE user_id=? ORDER BY id DESC LIMIT ?',
                         (int(user_id), max(1, min(200, int(limit))))).fetchall()
        return [dict(r) for r in rows]
    finally:
        if own:
            c.close()


def top_users(limit: int = 10, conn: sqlite3.Connection | None = None) -> list[dict]:
    """Топ игроков по балансу — тот же формат, что ждёт top.html."""
    own = conn is None
    c = conn or connect()
    try:
        rows = c.execute('SELECT username,coins,created FROM users'
                         ' ORDER BY coins DESC, created ASC LIMIT ?',
                         (max(1, min(100, int(limit))),)).fetchall()
        return [{'username': r['username'], 'balance': int(r['coins'])} for r in rows]
    finally:
        if own:
            c.close()


# --------------------------------------------------------------------------- #
#  Сессии
# --------------------------------------------------------------------------- #
def new_session(user_id: int, ttl: int = SESSION_TTL,
                conn: sqlite3.Connection | None = None) -> str:
    """Создать сессию и вернуть токен для cookie (в базе лежит только хеш)."""
    own = conn is None
    c = conn or connect()
    try:
        c.execute('DELETE FROM sessions WHERE expires<?', (now(),))
        token = secrets.token_urlsafe(32)
        c.execute('INSERT INTO sessions(token_hash,user_id,expires) VALUES(?,?,?)',
                  (_digest(token), int(user_id), now() + int(ttl)))
        if own:
            c.commit()
        return token
    finally:
        if own:
            c.close()


def user_for_token(token: str, conn: sqlite3.Connection | None = None) -> sqlite3.Row | None:
    if not token:
        return None
    own = conn is None
    c = conn or connect()
    try:
        return c.execute('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id'
                         ' WHERE s.token_hash=? AND s.expires>?',
                         (_digest(token), now())).fetchone()
    finally:
        if own:
            c.close()


def delete_session(token: str, conn: sqlite3.Connection | None = None) -> None:
    if not token:
        return
    own = conn is None
    c = conn or connect()
    try:
        c.execute('DELETE FROM sessions WHERE token_hash=?', (_digest(token),))
        if own:
            c.commit()
    finally:
        if own:
            c.close()


# --------------------------------------------------------------------------- #
#  Rate limit
# --------------------------------------------------------------------------- #
def rate_limit(key: str, limit: int, seconds: int,
               conn: sqlite3.Connection | None = None) -> bool:
    """True — попытка разрешена, False — лимит исчерпан. Ключ уже должен быть хешем."""
    own = conn is None
    c = conn or connect()
    try:
        if not c.in_transaction:
            c.execute('BEGIN IMMEDIATE')
        c.execute('DELETE FROM limits WHERE until<?', (now(),))
        row = c.execute('SELECT * FROM limits WHERE key=?', (key,)).fetchone()
        if row and row['count'] >= limit:
            if own:
                c.commit()
            return False
        if row:
            c.execute('UPDATE limits SET count=count+1 WHERE key=?', (key,))
        else:
            c.execute('INSERT INTO limits(key,count,until) VALUES(?,?,?)',
                      (key, 1, now() + int(seconds)))
        if own:
            c.commit()
        return True
    finally:
        if own:
            c.close()


# --------------------------------------------------------------------------- #
#  Публичное представление
# --------------------------------------------------------------------------- #
def public_user(row: sqlite3.Row, email_verified: bool | None = None) -> dict:
    """Данные аккаунта для JSON-ответа (без хеша пароля)."""
    return {
        'username': row['username'],
        'email': row['email'],
        'coins': int(row['coins']) if 'coins' in row.keys() else 0,
        'emailVerified': bool(row['verified']) if email_verified is None else bool(email_verified),
        'authSource': 'server',
        'created': row['created'],
    }


# --------------------------------------------------------------------------- #
#  CLI: python3 database.py <команда>
# --------------------------------------------------------------------------- #
def _cli(argv: list[str]) -> int:
    cmd = (argv[1] if len(argv) > 1 else 'init').lower()
    if cmd == 'init':
        init_db()
        print(f'database ready: {DB_PATH}')
        return 0
    if cmd == 'list':
        with connect() as c:
            rows = c.execute('SELECT id,username,email,coins,verified,created'
                             ' FROM users ORDER BY id').fetchall()
        if not rows:
            print('no users yet')
        for r in rows:
            print(f"#{r['id']:<3} {r['username']:<20} {r['email']:<28} "
                  f"{r['coins']:>8} V  verified={r['verified']}")
        return 0
    if cmd == 'create-user' and len(argv) >= 5:
        init_db()
        user = create_user(argv[2], argv[3], argv[4])
        print(f"created {user['username']} (id={user['id']}, coins={user['coins']})")
        return 0
    if cmd == 'coins' and len(argv) >= 3:
        init_db()
        user = find_user(argv[2])
        if not user:
            print('user not found')
            return 1
        if len(argv) >= 4:
            print(add_coins(user['id'], int(argv[3]), 'cli'))
        else:
            print(get_balance(user['id']))
        return 0
    if cmd == 'reset-password' and len(argv) >= 4:
        init_db()
        with connect() as c:
            user = find_user(argv[2], conn=c)
            if not user:
                print('user not found')
                return 1
            c.execute('UPDATE users SET password=? WHERE id=?', (hash_password(argv[3]), user['id']))
            c.execute('DELETE FROM sessions WHERE user_id=?', (user['id'],))
            c.commit()
        print(f"password updated for {user['username']}")
        return 0
    print(__doc__)
    return 2


if __name__ == '__main__':
    raise SystemExit(_cli(sys.argv))
