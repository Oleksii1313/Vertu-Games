# Капча (Cloudflare Turnstile): почему её не видно и как включить

## Короткий ответ

Код капчи в порядке — она **выключена настройками сервера**. Проверка живого
сайта прямо сейчас:

```bash
curl -s https://vert-games.onrender.com/api/session | python3 -m json.tool | grep -A3 captcha
```

Ответ:

```json
"captcha": { "enabled": false, "required": false, "siteKey": "" }
```

`enabled: false` и пустой `siteKey` означают, что на сервере нет переменных
окружения `TURNSTILE_SITE_KEY` и `TURNSTILE_SECRET_KEY`. Без site key браузер
физически не может нарисовать виджет Cloudflare: скрипт `api.js?render=explicit`
загружается, но рисовать ему нечего. Поэтому на форме входа и регистрации
капчи нет, а вход защищён только серверными лимитами попыток.

## Как включить (5 минут, без изменения кода)

1. **Cloudflare** → Dashboard → *Turnstile* → **Add site**
   * Site name: `vert-games`
   * Domain: `vert-games.onrender.com` (для локальных тестов добавьте
     `localhost`)
   * Widget mode: **Managed**
   * Скопируйте **Site Key** (публичный) и **Secret Key** (секретный).
2. **Render** → ваш сервис → *Environment* → **Add Environment Variable**:

   | Переменная | Значение | Зачем |
   |---|---|---|
   | `TURNSTILE_SITE_KEY` | site key (`0x4AAA…`) | клиенту, чтобы нарисовать виджет |
   | `TURNSTILE_SECRET_KEY` | secret key (`0x4AAA…`) | серверу, для `siteverify` |
   | `TURNSTILE_REQUIRED` | `1` | жёсткий режим: без валидного токена вход и регистрация невозможны |

3. **Save changes** — Render перезапустит сервис (деплой не нужен).
4. Проверка:
   * `curl -s https://vert-games.onrender.com/api/session | grep -o '"captcha":{[^}]*}'`
     → `"captcha":{"enabled":true,"required":true,"siteKey":"0x…"}`;
   * `python3 tools/smoke_deploy.py https://vert-games.onrender.com`
     → пункт «Cloudflare Turnstile включён на проде» должен стать ✅;
   * откройте `login.html` — под полями появится виджет «Verify you are human».

## Что происходит в каждом режиме

| Ключи | `TURNSTILE_REQUIRED` | Поведение |
|---|---|---|
| нет | `0` (по умолчанию) | капча выключена, вход защищён лимитами попыток (текущее состояние прода) |
| нет | `1` | **ошибка конфигурации**: сервер честно отвечает `CAPTCHA_NOT_CONFIGURED`, а не пропускает без проверки |
| есть | `0` | виджет показывается, токен проверяется; если Cloudflare недоступен — попытка не сгорает, игрок может повторить |
| есть | `1` | то же, но отсутствие ключей считается аварией |

## Как это устроено (для проверки)

* Секрет живёт только в окружении сервера — клиент получает лишь `siteKey`
  (проверяется `tools/test_captcha.py`).
* Токен Cloudflare проверяется **на сервере** запросом к `siteverify` с
  `remoteip`; клиент не может «сказать», что проверка пройдена.
* Токен одноразовый: его хеш пишется в `rate_limits` (Postgres), повторный
  запрос отклоняется `CAPTCHA_REUSED`; это работает и при 4 воркерах gunicorn.
* Если Cloudflare недоступен, бронь снимается и игрок получает
  `CAPTCHA_UNAVAILABLE`, а не «застревает» навсегда.
* Регистрация и вход проверяют капчу **до** создания аккаунта и сессии.
* Дополнительно: honeypot-поле, отказ при отправке формы быстрее 1,2 с,
  лимиты `login` 10/10 мин, `register` 60/час, `login_name` 12/15 мин.

## Тесты

| Что | Как |
|---|---|
| серверная часть | `VERT_DB=/tmp/c.sqlite3 python3 tools/test_captcha.py` — 17 проверок |
| клиентская часть | `NODE_PATH=…/node_modules node tools/test_login_captcha.js` — 11 проверок (виджет монтируется, токен уходит в `/api/auth/login`, без ключей форма работает и подпись нейтральная) |
| прод | `python3 tools/smoke_deploy.py https://vert-games.onrender.com` — падает, если на проде капча выключена |
