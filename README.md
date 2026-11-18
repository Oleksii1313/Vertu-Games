# Vert Games

Игровая платформа с 11 браузерными играми, единой виртуальной валютой **V**,
магазином, казино (только виртуальные монеты) и админ-панелью.

Всё считается на сервере: баланс, награды за игры, ставки и выплаты казино,
покупки и достижения. Браузер только показывает то, что вернул сервер.

```
index.html      главная: герой, поиск, категории, популярное, новое, топ игроков
top.html        каталог игр с фильтрами
shop.html       магазин (аватары, цвета, титулы, V-паки за код)
casino.html     казино: слоты, колесо, история, лимиты
roulette.html   колесо фортуны
profile.html    профиль: баланс, статистика, достижения, истории, настройки
login.html      вход и регистрация (ник + пароль, Turnstile)
admin.html      админ-панель
about / support / api / privacy — информационные страницы
games/          11 игр (не изменялись)
server.py       Flask-приложение: API + отдача статики
db.py           слой данных (PostgreSQL в проде, SQLite локально)
game_catalog.py единый каталог игр, наград, товаров, достижений, казино
casino_logic.py математика слотов и колеса
shop.py         покупки, экипировка, достижения
captcha.py      серверная проверка Cloudflare Turnstile
tools/          генератор страниц, проверки, миграция, локальный Postgres
```

## Быстрый старт локально

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt

# вариант 1: SQLite (по умолчанию, данные в data/vert.sqlite3)
.venv/bin/python server.py

# вариант 2: PostgreSQL как в проде
.venv/bin/python tools/dev_pg.py          # запустит встроенный Postgres и напечатает URL
export DATABASE_URL="postgres://..."
.venv/bin/python server.py
```

Открыть <http://localhost:8000>. Админка — <http://localhost:8000/admin.html>,
пароль берётся из `ADMIN_PASSWORD` (по умолчанию `219384`).

## Переменные окружения

| Переменная | Обязательна | Назначение |
|---|---|---|
| `DATABASE_URL` | в проде | PostgreSQL, напр. `postgres://user:pass@host:5432/db`. Без неё используется SQLite (`data/vert.sqlite3`, путь можно задать через `VERT_DB`). |
| `ADMIN_PASSWORD` | да | Пароль администратора. Если не задан — используется прежний `219384`. |
| `ADMIN_USERNAME` | нет | Ник администратора для журнала действий (по умолчанию `admin`). |
| `TURNSTILE_SITE_KEY` | нет | Публичный ключ Cloudflare Turnstile. |
| `TURNSTILE_SECRET_KEY` | нет | Секретный ключ Turnstile — проверяется только на сервере. |
| `TURNSTILE_REQUIRED` | нет | `1` — запретить вход/регистрацию без настроенного Turnstile. |
| `PUBLIC_URL` | рекомендуется | `https://ваш-домен`, нужен для https-cookie и ссылок оплаты. |
| `SECURE_COOKIES` | нет | `1` — принудительно ставить cookie только по HTTPS. |
| `WELCOME_COINS` | нет | Приветственный бонус новому аккаунту (по умолчанию 150). |
| `VERT GAMES_DB` | нет | Путь к старой SQLite-базе для миграции (`data/accounts.sqlite3`). |
| `PORT` | нет | Порт dev-сервера (по умолчанию 8000). |

Секретов в репозитории нет: всё, что чувствительно, читается из окружения.
Файл `.env` в `.gitignore`.

## Как устроен баланс

* `users.coins` — текущий баланс; любое изменение идёт через транзакцию
  `coin_ledger` (журнал операций с `ref`-ключом идемпотентности).
* Награда за игру: браузер присылает только `{game, receipt}`. Сумма берётся из
  `game_catalog.py`, суточный лимит проверяется на сервере, повторная квитанция
  не начисляет монеты второй раз.
* Рулетка: **20 одинаковых секторов по 18°** и четыре множителя — x0 (7 секторов,
  35 %), x1 (10, 50 %), x2 (2, 10 %), x5 (1, 5 %); RTP ровно 95 %.
  Старые множители x0.25/x0.5/x3/x4/x10 удалены и из конфига, и из истории
  (миграция `0005_wheel_retired_multipliers`). Выплата — это **полная** сумма
  `ставка × множитель`, считает её одна функция `casino_logic.wheel_payout`,
  а геометрия и отрисовка живут в одном файле `assets/vg/js/wheel-math.js`;
  инвариант «под указателем тот же сектор, за который заплатил сервер»
  проверяют `tools/test_wheel_math.js`, `test_wheel.py` и `test_wheel_api.py`.
  Карточка рулетки в каталоге (`top.html`) ведёт на `/roulette.html`.
* Казино: ставка списывается **до** вращения (`charge`), выплата начисляется
  **после** и целиком — `credit == payout == stake * multiplier` (×1 возвращает
  ставку, ×2 даёт двойную ставку, ×0 не даёт ничего); итог за спин —
  `net = payout - charge`. Результат считает `casino_logic.py`, клиент только
  проигрывает анимацию и показывает списание с зачислением по отдельности.
* Магазин: цена и владение проверяются на сервере, повторная покупка не
  списывает деньги второй раз.
* Ежедневные задания: прогресс (игры, ставки) пишет сервер, награду выдаёт
  `/api/tasks/claim` — один раз в сутки на задание, повод для начисления
  `task:<uid>:<task>:<дата>`, сброс в 00:00 UTC.
* Баланс никогда не уходит в минус и не приходит из localStorage.

## Безопасность

Полная архитектура, модель угроз, чек-лист внедрения и памятка на случай
инцидента — **[SECURITY.md](SECURITY.md)**. Ниже — коротко о том, что уже
включено.

* Награда за игру выдаётся только по **подписанному сервером билету**
  (`GET /api/games/session`, HMAC-SHA256): подделать сумму, переиграть или
  использовать чужой билет нельзя. Повтор билета не платит второй раз.
* Rate limiting в три уровня: токен-бакет в памяти → скользящее окно в БД →
  Cloudflare. Поведенческие аномалии (частота, V/мин, «машинный» интервал)
  сначала занижают выплату, потом блокируют и пишут в журнал админа.
* CSP, HSTS preload, `X-Frame-Options: SAMEORIGIN` + `frame-ancestors 'self'`
  (игры открываются во фрейме каталога, чужой сайт вложить платформу не может;
  админка — `DENY`), COOP/CORP, nosniff, Permissions-Policy — на каждом ответе;
  сторонние хосты (шрифты, Babylon.js для 3D-игр) перечислены явно.
* `TRUSTED_PROXY=1` — обязателен на Render/Cloudflare, иначе IP клиента
  берётся из сокета, а не из подделываемого `X-Forwarded-For`.

## Безопасность входа

* Только ник + пароль. Никаких email и подтверждений.
* Пароли — Argon2id (`argon2-cffi`), соль на пользователя. Старые
  `pbkdf2_sha256$rounds$salt$hash` и bcrypt-хеши продолжают проверяться и
  автоматически перехешируются в Argon2id при успешном входе.
* Ник уникален без учёта регистра, служебные имена зарезервированы.
* Turnstile проверяется запросом к Cloudflare с сервера (`captcha.py`).
* Ограничение попыток входа по IP и по нику, honeypot-поле в форме регистрации.
* CSRF: токен приходит в `GET /api/session` (тело + кука `vg_csrf`), все
  небезопасные запросы обязаны прислать его в `X-CSRF-Token`; исключения —
  вход/регистрация без куки, вебхук магазина и вход администратора.
* Сессии — случайный токен в httpOnly cookie, в базе хранится только SHA-256
  хеш; срок 30 дней, продлевается при активности; выход удаляет сессию, смена
  пароля закрывает все сессии.
* Админ-права проверяются только на сервере (отдельная cookie `vg_admin` с
  ограничением попыток). localStorage к этому отношения не имеет.

## Казино

Только виртуальные V-монеты. Купить монеты за реальные деньги или вывести
выигрыш нельзя. Ставки 5–100 V, RTP и вероятности показаны на странице
(`/api/casino/rules`), есть дневной лимит потерь и добровольное самоисключение
(`/api/casino/limits`). Все результаты и выплаты считает сервер.

## База данных: PostgreSQL

Продакшн-база — PostgreSQL на Render (`DATABASE_URL`). SQLite остаётся только для
локального запуска и тестов. Подробности — `DATABASE_SETUP.md`, настройка Render —
`RENDER_DATABASE_SETUP.md`.

```bash
export DATABASE_URL='postgresql://user:pass@host:5432/db'
alembic upgrade head            # схема
python server.py                # сервер сам создаёт недостающие таблицы
```

### Миграция старых аккаунтов из SQLite

Старые версии хранили аккаунты в SQLite (`data/*.sqlite3`). Перенос безопасный и
не изменяет исходный файл:

```bash
python migrate_sqlite_to_postgres.py                     # проверка, ничего не пишет
python migrate_sqlite_to_postgres.py --apply             # перенести
python migrate_sqlite_to_postgres.py --source /path/to/accounts.sqlite3 --apply
```

Ник, хеш пароля (pbkdf2/bcrypt/argon2) и баланс переносятся как есть; каждая
сумма приходит одной записью `import:<id>` в `transactions`, поэтому повторный
запуск не задваивает монеты. Конфликты ников не перезаписываются, а попадают в
отчёт.

## Проверки

```bash
.venv/bin/python tools/check_platform.py                      # SQLite, 229 проверок
DATABASE_URL=postgresql://... .venv/bin/python tools/check_platform.py   # те же проверки на PostgreSQL
.venv/bin/python -m unittest tools.test_economy               # экономика, идемпотентность, гонки
python -m unittest tools.test_anticheat             # билеты, аномалии, заголовки (25)
python -m unittest tools.test_wheel                 # колесо: 4 множителя × 6 ставок, 20 секторов по 18° (37)
python -m unittest tools.test_wheel_api             # выплата = ставка × множитель сквозь HTTP (4)
node tools/test_wheel_math.js                       # 20 равных секторов, колесо встаёт на оплаченный сектор
python -m unittest tools.test_session_claim         # итог MiniCraft: сервер сам считает V (14)
python -m unittest tools.test_snake_claim           # итог Snake: яблоки, золото, лимиты (17)
python -m unittest tools.test_units_claim           # итог 2D-игр по «единицам» (13)
VERT_BASE=http://127.0.0.1:8000 python tools/test_rewards_e2e.py   # HTTP-E2E по всем играм (27)
node tools/test_minicraft.js                        # MiniCraft: монеты, сундуки, жители (60)
node tools/test_minicraft_world.js                  # вода, мосты, постройки, руки, нос (42)
node tools/test_music.js                            # музыка: петля, кнопка, преференс (24)
DATABASE_URL=postgresql://... .venv/bin/python -m unittest tools.test_economy
.venv/bin/python tools/build_platform.py --check              # страницы соответствуют генератору
```

`check_platform.py` поднимает настоящий сервер на свободном порту и проходит
229 проверок: регистрация, уникальность ника, вход/выход, смена пароля, CAPTCHA,
CSRF и сессия, подписанные билеты и попытки их подделать, ежедневные задания,
магазин, слоты, колесо,
лимиты и самоисключение, админ-панель и каталог, сохранение данных после
перезапуска, защита статики и API, мобильная вёрстка игр, сборка плеера.
С `DATABASE_URL` тот же набор выполняется в отдельной схеме PostgreSQL.

Для живого деплоя (после `RENDER_DATABASE_SETUP.md`) есть дымовая проверка без
браузера: `python tools/smoke_deploy.py https://vert-games.onrender.com --admin-password '…'`.

### Производительность

* Одна общая дизайн-система и один рантайм (`platform.css` 34 КБ,
  `platform.js` 37 КБ) + один скрипт на страницу; тяжёлые данные (каталог,
  иконки) приходят маленьким JSON.
* gzip включён для HTML/CSS/JS/JSON: главная 16.7 КБ → 4.2 КБ, `platform.js`
  37 КБ → 11.9 КБ.
* Картинки `assets/vg/*` кешируются на сутки, а HTML, JS и CSS — `no-cache`:
  браузер каждый раз перепроверяет ETag, поэтому новая страница не может
  отработать со старым скриптом (и наоборот).
* Вкладки казино, история и рейтинг грузятся по требованию, без дублей запросов;
  данные профиля перезапрашиваются только при входе/выходе, баланс обновляется
  точечно.

## Деплой на Render

1. New → **Web Service**, репозиторий `Oleksii1313/Vert-Games`, ветка с
   изменениями.
2. Runtime: **Python 3**. Build command:

   ```bash
   pip install -r requirements.txt
   ```

   Start command:

   ```bash
   gunicorn --bind 0.0.0.0:$PORT --workers 2 --threads 4 --timeout 60 server:app
   ```

3. New → **PostgreSQL** (free plan подойдёт). Скопируйте **Internal Database
   URL** и добавьте в Web Service переменную `DATABASE_URL`.
4. Environment Variables сервиса:

   | Ключ | Значение |
   |---|---|
   | `DATABASE_URL` | Internal Database URL из Render PostgreSQL |
   | `ADMIN_PASSWORD` | ваш пароль администратора (не оставляйте пустым) |
   | `ADMIN_USERNAME` | `admin` (или свой ник) |
   | `TURNSTILE_SITE_KEY` | ключ Cloudflare Turnstile |
   | `TURNSTILE_SECRET_KEY` | секрет Cloudflare Turnstile |
   | `TURNSTILE_REQUIRED` | `1` — включить обязательную проверку |
   | `PUBLIC_URL` | `https://<имя-сервиса>.onrender.com` |
   | `PYTHON_VERSION` | `3.11.9` |

5. Deploy. Схема таблиц создаётся автоматически при старте (`db.py`),
   администратор — из `ADMIN_PASSWORD`. Health-check: `/api/health`.
6. Проверьте после деплоя: регистрация, вход, баланс в шапке, магазин, слоты и
   колесо, `admin.html`, мобильная вёрстка. Быстро и без браузера —
   `python tools/smoke_deploy.py https://<адрес> --admin-password '…'`;
   проверки публикации колеса там же (`== Публикация колеса`).

### Как убедиться, что на сайте новая версия

Деплой мог не дойти, а браузер — держать старую страницу. Отличить одно от
другого можно без панели Render: сервер сам рассказывает, что отдаёт.

```bash
curl -s https://<адрес>/api/version | python3 -m json.tool
```

* `version` — версия сборки (`game_catalog.APP_VERSION`); она же в
  `<meta name="vert-build">` и в заголовке `X-Build` каждого ответа;
* `commit` / `branch` / `service` — что реально запущено (Render прокидывает
  `RENDER_GIT_COMMIT`, `RENDER_GIT_BRANCH`, `RENDER_SERVICE_NAME`);
* `wheel.segments` / `wheel.weights` / `wheel.rtp` — конфиг множителей сервера;
* `pages['roulette.html']` — `sha256`, размер и **список множителей из того
  файла, который лежит на диске у инстанса**, плюс `legacy_multipliers`
  (должен быть `false`).

Если `pages['roulette.html'].probabilities` = `x0 35.0% … x5 5.0%`, а в браузере
всё ещё старые проценты — это кеш браузера (жёсткая перезагрузка Ctrl+Shift+R),
а не деплой. Если там старые значения — не переехала сама сборка: нужен
`Manual Deploy → Clear build cache & deploy` в Render.

`GET /api/version` намеренно не отдаёт ни одного секрета: только версию, коммит
и публичную таблицу множителей.

Локальный Postgres для отладки: `tools/dev_pg.py` создаёт `.pgdata/` и печатает
готовый `DATABASE_URL` (каталог в `.gitignore`).

## Структура данных (основное)

`users`, `sessions`, `coin_ledger` (`transactions`), `game_stats`, `game_receipts`,
`game_limits`, `shop_items`, `purchases`, `achievements`, `user_achievements`,
`casino_bets` (`casino_history`), `casino_limits`, `daily_tasks`,
`user_daily_tasks`, `admin_log`, `settings`, `orders`. Канонический DDL —
`schema_sql.py`, совместимые представления — `COMPAT_VIEWS`.

Все изменения баланса проходят через `DataStore.add_coins` /
`DataStore.casino_bet` / `DataStore.buy_item` — с блокировкой строки и записью в
журнал.

## Что изменилось в этой версии

Подробный план и решения — `docs/PLAN.md`. Коротко: новый дизайн всех страниц,
новый серверный API и слой данных, единая экономика V, серверное казино,
профиль, админ-панель, миграция старых аккаунтов. Файлы игр в `games/` не
менялись.
