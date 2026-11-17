# База данных Vertu Games (PostgreSQL)

Продакшн-база — **PostgreSQL** (Render). SQLite используется только локально и в
тестах, когда `DATABASE_URL` не задан.

Что где описано:

| Файл | Назначение |
|---|---|
| `schema_sql.py` | каноническая схема PostgreSQL: таблицы, индексы, FK, CHECK-ограничения, представления совместимости |
| `schema_sqlite.py` | та же схема для SQLite (типы проще, набор колонок тот же) |
| `db.py` | слой данных: драйверы (`PgDriver` на psycopg 3 + пул, `SqliteDriver`), `DataStore`, экономика |
| `alembic/` | миграции: `alembic upgrade head` |
| `migrate_sqlite_to_postgres.py` | перенос старых SQLite-баз в PostgreSQL |
| `RENDER_DATABASE_SETUP.md` | пошаговая настройка базы на Render |

## Локальный запуск

```bash
pip install -r requirements.txt

# вариант 1: PostgreSQL (как в продакшене)
pip install pgserver
python tools/dev_pg.py                     # печатает DATABASE_URL
export DATABASE_URL='postgresql://postgres:@/postgres?host=/path/from/output'
alembic upgrade head
python server.py

# вариант 2: SQLite (быстро, без сервера)
python server.py                           # создаст data/vertu.sqlite3
```

Сервер сам создаёт схему при первом запуске (`CREATE TABLE IF NOT EXISTS`),
поэтому `alembic upgrade head` нужен только для контролируемых миграций.

## Модель данных

Канонические таблицы:

| Таблица | Ключевое |
|---|---|
| `users` | `username_key` UNIQUE, `password_hash` (Argon2id), `role`, `level`, `experience`, `is_active`, `created_at`, `last_login` |
| `wallets` | 1:1 к `users`, `balance BIGINT CHECK (balance >= 0)`, `updated_at` |
| `transactions` | `amount`, `balance_after`, `transaction_type`, `reference_id` UNIQUE — журнал и идемпотентность |
| `games` / `game_statistics` | каталог игр и статистика (UNIQUE `user_id, game_id`) |
| `achievements` / `user_achievements` | UNIQUE `user_id, achievement_id` |
| `items` / `inventory` | UNIQUE `user_id, item_id` |
| `daily_tasks` / `user_daily_tasks` | UNIQUE `user_id, task_id, task_date` |
| `casino_history` | ставки/выигрыши, `reference_id` UNIQUE |
| `sessions`, `admin_sessions`, `admin_log` | сессии (в базе только sha256 токена) и журнал |
| `game_receipts`, `game_limits`, `casino_limits`, `rate_limits` | антифрод и лимиты |

Представления `coin_ledger`, `casino_bets`, `game_stats`, `purchases`,
`shop_items` — для обратной совместимости со старым кодом (только чтение).

## Экономика: гарантии

1. **Только сервер.** Клиент присылает событие (игра, квитанция), сумму
   определяет сервер по каталогу.
2. **Атомарность.** Изменение баланса и запись в `transactions` — одна транзакция
   PostgreSQL (`SERIALIZABLE`, `SELECT … FOR UPDATE` по строке кошелька).
3. **Нет отрицательного баланса.** `CHECK (balance >= 0)` в базе + проверка в
   `DataStore._apply_delta`.
4. **Идемпотентность.** `transactions.reference_id`, `game_receipts.ref`,
   `casino_history.reference_id` — повторный запрос с тем же ключом не начисляет
   второй раз.
5. **Гонки.** Параллельные списания сериализуются блокировкой строки кошелька
   (тест `tools/test_economy.py` проверяет 20 потоков).

## Команды

```bash
alembic upgrade head                # применить миграции
alembic current                     # текущая ревизия
alembic stamp head                  # пометить существующую базу как актуальную
python migrate_sqlite_to_postgres.py           # проверка переноса
python migrate_sqlite_to_postgres.py --apply   # перенос
python -m unittest tools.test_economy          # тесты экономики (SQLite)
DATABASE_URL=... python -m unittest tools.test_economy   # те же тесты на PostgreSQL
DATABASE_URL=... python tools/check_platform.py          # e2e-проверки
```

## Переменные окружения

```bash
DATABASE_URL=postgresql://user:pass@host:5432/db   # обязательна в продакшене
VERTU_DB=data/vertu.sqlite3                        # только локально, если DATABASE_URL пуст
DB_POOL_SIZE=5                                     # размер пула psycopg (free-план Render)
WELCOME_COINS=100                                  # приветственный бонус
```

Подробная инструкция для Render — в `RENDER_DATABASE_SETUP.md`.
