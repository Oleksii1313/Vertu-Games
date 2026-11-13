# PostgreSQL на Render — пошаговая настройка Vertu Games

Инструкция для деплоя платформы на **Render** с базой **PostgreSQL**. Всё, что
нужно сделать руками, — создать базу, скопировать две строки подключения и
заполнить переменные окружения. Секреты в репозиторий не попадают.

---

## 1. Что понадобится

| Что | Где взять |
|---|---|
| Аккаунт Render | https://dashboard.render.com |
| Репозиторий `Oleksii1313/Vertu-Games` | GitHub (уже подключён к Render) |
| Ключи Cloudflare Turnstile | https://dash.cloudflare.com → Turnstile |

Локально для миграций нужен Python 3.11+ и пакеты из `requirements.txt`.

---

## 2. Создать PostgreSQL в Render

1. Dashboard → **New +** → **Postgres**.
2. Заполнить:
   * **Name**: `vertu-games-db`
   * **Database**: `vertu`
   * **User**: `vertu`
   * **Region**: тот же, где будет web-сервис (например, Frankfurt)
   * **Plan**: Free
3. **Create Database** и дождаться статуса *Available* (1–2 минуты).
4. На странице базы открыть блок **Connections** и скопировать:
   * **Internal Database URL** — для web-сервиса Render (быстро, без внешнего трафика);
   * **External Database URL** — для миграций с ноутбука.

Строка выглядит так:

```
postgresql://vertu:пароль@dpg-xxxxxxxx-a.frankfurt-postgres.render.com/vertu
```

> Free-план Render удаляет бесплатную базу через 90 дней без активности и не
> делает бэкапы. Для боевого проекта включите платный план или регулярный
> `pg_dump` (раздел 7).

---

## 3. Создать web-сервис

Проще всего — через Blueprint: в репозитории лежит `render.yaml`.

1. Dashboard → **New +** → **Blueprint** → выбрать репозиторий.
2. Render прочитает `render.yaml` и создаст:
   * web-сервис `vertu-games` (`pip install -r requirements.txt`,
     запуск `gunicorn ... server:app`, healthcheck `/api/health`);
   * базу `vertu-games-db` и **сам** подставит `DATABASE_URL` из неё.
3. Либо вручную: **New +** → **Web Service** → Runtime *Python 3*, Build Command
   `pip install -r requirements.txt`, Start Command
   `gunicorn --bind 0.0.0.0:$PORT --workers 2 --threads 4 --timeout 60 server:app`.

Требования Render к старту уже выполнены:

* `server.py` читает порт из `PORT`;
* статика и API на одном процессе, healthcheck `/api/health` отвечает без БД-записи;
* база берётся из `DATABASE_URL` (см. `db._build_store`).

---

## 4. Переменные окружения

Dashboard → web-сервис → **Environment**:

| Переменная | Обязательна | Значение / как получить |
|---|---|---|
| `DATABASE_URL` | **да** | Internal Database URL из раздела 2 (Blueprint подставит сам) |
| `SECRET_KEY` | **да** | `python -c "import secrets;print(secrets.token_urlsafe(48))"` |
| `TURNSTILE_SITE_KEY` | **да** | Cloudflare Turnstile → Site Key (публичный) |
| `TURNSTILE_SECRET_KEY` | **да** | Cloudflare Turnstile → Secret Key (только на сервере!) |
| `TURNSTILE_REQUIRED` | да | `1` — без капчи вход/регистрация запрещены |
| `ADMIN_USERNAME` | да | ник администратора, например `admin` |
| `ADMIN_PASSWORD` | да | пароль 12+ символов для входа в админку |
| `PUBLIC_URL` | да | `https://vertu-games.onrender.com` (для Secure-cookie и платёжных return-URL) |
| `PORT` | авто | Render подставляет сам |
| `WELCOME_COINS` | нет | приветственный бонус, по умолчанию `100` |
| `DB_POOL_SIZE` | нет | размер пула соединений, по умолчанию `5` (free-план: не больше 5) |

**Никогда не коммитьте** эти значения: `.env` в `.gitignore`, в клиентский JS
попадает только публичный `TURNSTILE_SITE_KEY` (он и должен быть публичным).

Free-план Render держит соединения жёстко: пул ограничен 5 соединениями,
`gunicorn` запускается с 2 воркерами × 4 потока. Если увидите
`too many connections` — уменьшите `DB_POOL_SIZE` до `2`.

---

## 5. Первый деплой и схема

Схему создаёт сам сервер при первом запросе (`db.DataStore` → `schema_sql.py`:
`CREATE TABLE IF NOT EXISTS` + представления совместимости). Alembic нужен для
контролируемых изменений схемы в дальнейшем.

```bash
# локально, с External Database URL
export DATABASE_URL='postgresql://vertu:...@dpg-xxxx.frankfurt-postgres.render.com/vertu'

pip install -r requirements.txt

alembic upgrade head        # создать/обновить схему (0001_initial)
alembic current             # -> 0001_initial (head)
```

Если база уже наполнена и схема создана сервером, пометьте миграцию применённой
(данные не тронутся):

```bash
alembic stamp head
```

### Проверка

```bash
python -c "import db; s=db.get_store(); print(s.backend, s.platform_stats())"
# postgresql {'users': 0, 'active24': 0, 'coins': 0, ..., 'backend': 'postgresql'}
```

На сайте: `GET /api/health` должен вернуть `"backend": "postgresql"`.

---

## 6. Перенос данных из SQLite

Скрипт `migrate_sqlite_to_postgres.py` переносит аккаунты, хеши паролей,
балансы, достижения, статистику и историю казино.

```bash
# 1. Сухой прогон: показывает, что будет перенесено, ничего не пишет
DATABASE_URL='postgresql://...' python migrate_sqlite_to_postgres.py

# 2. Запись + JSON-отчёт
DATABASE_URL='postgresql://...' python migrate_sqlite_to_postgres.py --apply \
    --report migration-report.json

# 3. Свой файл-источник
DATABASE_URL='postgresql://...' python migrate_sqlite_to_postgres.py \
    --source data/accounts.sqlite3 --apply
```

Что важно знать:

* **файла нет — не ошибка**: скрипт печатает отчёт «переносить нечего» и выходит
  с кодом `0`, поэтому его можно безопасно вызывать в деплой-хуке Render;
* **пароли сохраняются**: хеши `pbkdf2_sha256`, `bcrypt` и `argon2` переносятся
  как есть, старые пароли продолжают работать и при входе обновляются до Argon2id;
* **балансы не задваиваются**: каждая сумма идёт одной записью `import:<id>` в
  `transactions`, повторный запуск находит её и пропускает;
* **дубликаты не создаются**: сравнение по `username_key`; если ник занят
  аккаунтом с другим паролем — строка пропускается и попадает в отчёт;
* **история казино** переносится как запись (`import_casino_history`), без
  повторного начисления выигрышей.

---

## 7. Схема данных

Канонические таблицы (`schema_sql.py`, миграция `0001_initial`):

| Таблица | Назначение |
|---|---|
| `users` | аккаунт: ник (`username_key` UNIQUE), `password_hash`, `role`, `avatar`, `experience`, `level`, `is_active`, `created_at`, `last_login` |
| `wallets` | кошелёк 1:1 к `users`, `balance BIGINT CHECK (balance >= 0)`, `updated_at` |
| `transactions` | журнал: `amount`, `balance_after`, `transaction_type`, `reference_id` UNIQUE |
| `games` | каталог игр: награда, суточный лимит, `is_active` |
| `game_statistics` | статистика по игре, UNIQUE `(user_id, game_id)` |
| `achievements` / `user_achievements` | достижения и UNIQUE `(user_id, achievement_id)` |
| `items` / `inventory` | каталог предметов и UNIQUE `(user_id, item_id)` |
| `daily_tasks` / `user_daily_tasks` | задания и UNIQUE `(user_id, task_id, task_date)` |
| `casino_history` | ставки, выигрыши, `result`, `reference_id` UNIQUE |
| `sessions`, `admin_sessions`, `admin_log` | сессии и журнал администратора |
| `game_receipts`, `game_limits`, `casino_limits`, `rate_limits` | антифрод |
| `shop_orders`, `shop_ledger` | заглушки оплаты (пакеты V отключены) |

Представления `coin_ledger`, `casino_bets`, `game_stats`, `purchases`,
`shop_items` сохранены для обратной совместимости со старым кодом — читать можно
как раньше, писать нужно через `db.DataStore`.

### Правила экономики

* баланс меняется только внутри транзакции PostgreSQL
  (`SELECT … FOR UPDATE` по строке кошелька) и всегда вместе с записью в
  `transactions`;
* отрицательный баланс невозможен дважды: `CHECK (balance >= 0)` в базе и
  проверка в `_apply_delta`;
* идемпотентность: `transactions.reference_id`, `game_receipts.ref`,
  `casino_history.reference_id` — повтор запроса не начисляет второй раз.

---

## 8. Бэкапы и эксплуатация

```bash
# дамп базы (External URL) — раз в сутки по cron или вручную
pg_dump "$DATABASE_URL" --no-owner --format=custom --file=vertu-$(date +%F).dump

# восстановление
pg_restore --clean --no-owner --dbname "$DATABASE_URL" vertu-2026-11-11.dump
```

Полезные команды:

```bash
alembic upgrade head                  # применить миграции после деплоя
alembic current                       # какая миграция применена
alembic revision -m "add something"   # новая миграция
python migrate_sqlite_to_postgres.py  # проверка переноса SQLite → PG
python -m unittest tools.test_economy # тесты экономики на текущей базе
```

---

## 9. Частые проблемы

| Симптом | Причина и решение |
|---|---|
| `psycopg.OperationalError: connection refused` | неверный `DATABASE_URL` или база на паузе (free-план засыпает) — откройте Render и разбудите базу |
| `too many connections` | уменьшите `DB_POOL_SIZE` до `2` и `--workers` до `1` |
| `CAPTCHA_NOT_CONFIGURED` | задан `TURNSTILE_REQUIRED=1`, но нет ключей Turnstile — добавьте обе переменные |
| Админка не входит | `ADMIN_PASSWORD` не задан или короче 12 символов |
| `backend: sqlite` в `/api/health` | `DATABASE_URL` не попал в окружение web-сервиса |
| Сайт открывается, но баланс «прыгает» к старому | web-сервис всё ещё смотрит в SQLite — проверьте переменные окружения |
| Free-база исчезла | Render удаляет free Postgres через 90 дней — восстановите из дампа |

---

## 10. Локальный PostgreSQL (без Docker)

В репозитории есть `tools/dev_pg.py` — поднимает встроенный PostgreSQL 16 через
pip-пакет `pgserver`, если системный сервер ставить не хочется:

```bash
pip install pgserver
python tools/dev_pg.py            # печатает строку подключения, данные в .pgdata/
export DATABASE_URL='postgresql://postgres:@/postgres?host=<путь из вывода>'
alembic upgrade head
python server.py
```

Тесты гоняются на обеих СУБД:

```bash
python -m unittest tools.test_economy          # SQLite (быстро)
DATABASE_URL=... python -m unittest tools.test_economy   # PostgreSQL (отдельная схема)
DATABASE_URL=... python tools/check_platform.py          # 100 e2e-проверок
```
