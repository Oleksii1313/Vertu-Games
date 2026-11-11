# База данных аккаунтов и баланса (SQLite)

`database.py` — единственное место, где описан доступ к SQLite. `server.py` использует его
вместо прежних inline-запросов, поэтому остальные модули (`google_oauth.py`,
`casino_payments.py`) продолжают работать без изменений.

## Что хранится

| таблица | назначение |
|---|---|
| `users` | аккаунты: ник, email, `pbkdf2_sha256`-хеш пароля, `coins` (баланс V), `verified` |
| `sessions` | cookie-сессии; в базе только `sha256` от токена |
| `pending` | регистрации, ожидающие код из письма (TTL 10 минут) |
| `limits` | счётчики rate-limit (логин, регистрация, письма) |
| `coin_ledger` | журнал начислений/списаний: `delta`, `reason`, баланс после операции |

Файл базы: `data/accounts.sqlite3` (в `.gitignore`), путь переопределяется `VERTGAMES_DB`.
Режим WAL, `busy_timeout` 15 с — несколько потоков `ThreadingHTTPServer` работают безопасно.

## Запуск

```bash
python3 database.py init          # создать схему / домигрировать старую базу
python3 server.py                 # сервер сам вызовет init_db()
```

Без настроенного SMTP регистрация возвращает 503. Для локальной разработки:

```bash
VERTGAMES_LOCAL_SIGNUP=1 python3 server.py    # аккаунт создаётся сразу, emailVerified=false
```

## CLI

```bash
python3 database.py list
python3 database.py create-user Alisa alisa@example.com secret123
python3 database.py coins alisa 250          # начислить 250 V (пишется в coin_ledger)
python3 database.py coins alisa              # показать баланс
python3 database.py reset-password alisa newpass456   # и сбросить её сессии
```

## API баланса

| метод | тело | ответ |
|---|---|---|
| `GET /api/auth/session` | — | `user.coins` из базы |
| `GET /api/auth/balance` | — | `{ok, coins, user}` |
| `POST /api/auth/balance` | `{"delta": 150, "reason": "slots win"}` | `{ok, coins, user}`; `delta` в пределах ±100000, баланс не уходит ниже 0 |
| `GET /api/leaderboard` | — | топ-20 по балансу |
| `POST /api/auth/migrate` | `{"username","email","password","coins"}` | переносит аккаунт из `localStorage` в SQLite |

## Миграция существующей базы

`init_db()` вызывает `ALTER TABLE users ADD COLUMN coins INTEGER NOT NULL DEFAULT 0`,
если колонки нет, и добавляет `pending.attempts`. Данные и пароли не пересоздаются —
старые хеши `pbkdf2_sha256` продолжают проверяться.

## Безопасность

- пароли: PBKDF2-SHA256, 310 000 итераций, соль на пользователя, сравнение через
  `hmac.compare_digest`;
- токены сессий: 32 байта `secrets.token_urlsafe`, в базе только хеш;
- лимиты попыток: логин 20/15 мин, регистрация 10/час, миграция 6/час (на IP);
- SQL только с параметрами (`?`), без конкатенации пользовательских данных;
- файл базы не отдаётся веб-сервером (белый список статики в `server.py`).
