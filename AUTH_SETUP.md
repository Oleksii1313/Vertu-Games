# VertGames: вход, регистрация и безопасность

Только **ник + пароль**, без email и без подтверждений. Аккаунты живут на
сервере (PostgreSQL), баланс и прогресс привязаны к аккаунту, а не к браузеру.

## Что нужно настроить

| Переменная | Зачем |
| --- | --- |
| `GAME_SIGNING_KEY` | отдельный HMAC-ключ билетов игровых сессий (не равен `SECRET_KEY`) |
| `TRUSTED_PROXY` | `1` — доверять `X-Forwarded-For` от Render/Cloudflare |
| `SECRET_KEY` | обязательна на проде (в `render.yaml` генерируется автоматически); используется как резервный пароль админки, если не задан `ADMIN_PASSWORD` |
| `DATABASE_URL` | PostgreSQL; локально можно без неё (SQLite `data/vertu.sqlite3`) |
| `PUBLIC_URL` | точный адрес сайта, включает `Secure`-куки и проверку Origin |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile для регистрации |
| `TURNSTILE_REQUIRED` | `1` — капча обязательна (прод), `0` — выключена (локально/тесты) |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | вход в админку; без них админки нет |
| `WELCOME_COINS` | приветственные монеты (по умолчанию 100 V; ещё +50 V даёт достижение «Добро пожаловать», итого 150 V) |

`ADMIN_PASSWORD`, `TURNSTILE_SECRET_KEY`, `DATABASE_URL` и `SECRET_KEY` не
храните в git — только в переменных окружения Render (шаблон — `render.yaml`,
локальный — `.env.example`).

## Поток регистрации и входа

1. `GET /api/session` отдаёт CSRF-токен в теле (`csrf`) и ставит куку `vg_csrf`.
2. `POST /api/auth/register` — ник (3–24 символа), пароль (8–128), токен Turnstile.
   Пароль хешируется Argon2id, создаётся сессия, выдаётся `WELCOME_COINS`.
3. `POST /api/auth/login` — ник (регистр не важен) + пароль.
4. `POST /api/auth/logout` — удаляет сессию; `/api/me` после выхода отвечает 401.
5. `POST /api/auth/password` — смена пароля закрывает все остальные сессии.

Аккаунты, созданные в старой SQLite-базе, входят по прежнему нику/email и
паролю: при первом успешном входе запись переносится в PostgreSQL, а хеш
перехешируется в Argon2id.

## Защита

- **Пароли:** Argon2id (`argon2-cffi`). Старые `pbkdf2_sha256` и bcrypt-хеши
  проверяются и автоматически перехешируются при входе.
- **Сессии:** случайный токен в HttpOnly + SameSite=Lax cookie (`Secure` на
  HTTPS); в базе хранится только SHA-256 токена, срок 30 дней, продление при
  активности. Смена пароля и выход удаляют сессии.
- **CSRF:** double-submit cookie `vg_csrf` + заголовок `X-CSRF-Token` на всех
  небезопасных запросах. Исключения: `/api/auth/register`, `/api/auth/login`,
  `/api/admin/login` без куки и вебхуки магазина.
- **Turnstile:** проверяется на сервере (`captcha.py`) запросом к Cloudflare,
  токен одноразовый; секрет — только из `TURNSTILE_SECRET_KEY`.
- **Лимиты попыток:** вход 10/10 мин на IP и 12/15 мин на ник, регистрация 60
  в час на IP и 10 в час на ник, смена пароля 6/15 мин, вход в админку 6/15 мин.
- **Прочее:** honeypot и проверка «слишком быстрая форма» при регистрации,
  защита от подмены Origin, административные права проверяются только на
  сервере (отдельная кука `vg_admin`), все действия админа пишутся в журнал.

## Хранение и обслуживание

- База: PostgreSQL (`DATABASE_URL`) — см. `DATABASE_SETUP.md` и
  `RENDER_DATABASE_SETUP.md`. Локальный режим кладёт SQLite в `data/`.
- Резервные копии делает провайдер (Render PostgreSQL backups) либо
  `pg_dump`; каталог `data/` в `.gitignore`.
- Клиент входа и сессии — `assets/vg/js/platform.js` (ник + пароль +
  Turnstile). После правки исходников пересоберите страницы:
  `python tools/build_platform.py`.

## Проверки

```bash
.venv/bin/python tools/check_platform.py      # 180 проверок, включая CSRF и сессии
.venv/bin/python -m unittest tools.test_anticheat    # билеты, лимиты, заголовки
.venv/bin/python tools/smoke_deploy.py https://<адрес> --admin-password '…'
```

`tools/check_platform.py` проверяет первый визит (токен в теле и куке),
стабильность токена, отказ при чужом `X-CSRF-Token`, вход/выход, смену пароля,
блокировку пользователя и закрытие сессии после выхода.
