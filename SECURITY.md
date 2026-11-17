# Безопасность Vertu Games: архитектура и внедрение

Документ для команды, которая развивает платформу. Он описывает **что уже
работает в этом репозитории**, чего не хватает до продакшена и в каком порядке
это закрывать. Всё, что помечено «✅ реализовано», можно проверить командами из
раздела «Проверки»; всё, помеченное «⬜ план», — задача с оценкой и местом в коде.

Главный принцип: **браузер — враждебная среда**. Любой запрос можно
отредактировать в DevTools или Burp Suite, `postMessage` из iframe — подделать
скриптом, `localStorage` — переписать руками. Сервер верит только тому, что
может перепроверить сам: сессии в БД, подписи HMAC, лимиты и инварианты схемы.

---

## 1. Античит и защита экономики

### 1.1. Почему клиентская валидация не работает

Клиентская проверка («нельзя начислить больше, чем положено») защищает только
честного пользователя от опечатки. Она бесполезна против атаки, потому что
исполняется **в чужом процессе**:

| Что пытается клиент | Как обходится |
| --- | --- |
| `if (score <= max)` | Свой скрипт вообще без проверки |
| Скрытая сумма в JS (`reward: 2`) | Меняется в DevTools или в запросе |
| Квитанция в `localStorage` | Удаляется/клонируется, лимит не работает |
| Баланс в localStorage | `localStorage.setItem('coins', '999999')` |
| Подпись, посчитанная в JS | Ключ лежит в бандле — читается из вкладки Sources |

Вывод: **клиент может сообщать только о намерении** («я открыл игру», «я закончил
событие»). Всё, что влияет на баланс — сумма, лимиты, результат казино,
владение предметом — считается на сервере.

### 1.2. Что реализовано ✅

**Сумма награды берётся из каталога, не из запроса.** `game_catalog.GAMES`
содержит `reward` и `daily`; эндпоинт `/api/games/reward` игнорирует поле
`amount`, приходящее от клиента.

**Подписанный билет на игровую сессию** (`anticheat.py`, `/api/games/session`):

```python
ticket = anticheat.issue(user['id'], game, spec['reward'], kind='game')
# → {sid, game, kind, amount, issuedAt, expiresAt, sig, version}
```

Тело подписи: `v1|kind|user_id|game|amount|issuedAt|expiresAt|sid|extra`,
подпись — `HMAC-SHA256(GAME_SIGNING_KEY, body)` в base64url. Сервер проверяет:

1. подпись (`hmac.compare_digest`, постоянное время);
2. привязку к пользователю (чужой билет не пройдёт — `user_id` входит в тело);
3. привязку к игре;
4. срок (`GAME_SIGNING_TTL`, по умолчанию 1800 с) и «не из будущего»;
5. диапазон суммы (`0 ≤ amount ≤ 100 000`).

Выплата идемпотентна: `receipt_for()` даёт стабильный ключ
`ticket:<game>:<sid>`, а `game_receipts.ref` в БД — `UNIQUE`. Один билет = одна
выплата, даже если клиент пришлёт его десять раз параллельно.

```bash
# подделать сумму в билете нельзя:
$ curl -X POST /api/games/reward -d '{"game":"flappy","receipt":"x-1","ticket":{...,"amount":1000}}'
{"ok": false, "code": "TICKET"}          # 403
```

**Квитанции с естественными ключами.** Даже без билета повтор события не
платит второй раз: `game:<ref>`, `bet:<ref>`/`win:<ref>`,
`buy:<uid>:<item>`, `ach:<uid>:<ach>`, `task:<uid>:<task>:<дата>` — все идут в
`transactions.reference_id UNIQUE`.

**Казино целиком серверное** (`casino_logic.py`): клиент присылает ставку, но
сектор/барабаны, RTP и выплата считаются на сервере внутри одной транзакции со
списанием ставки. Ответ клиенту — уже свершившийся факт, клиент лишь проигрывает
анимацию.

### 1.3. Что осталось ⬜

| Задача | Почему важно | Как делать |
| --- | --- | --- |
| Серверные «оценки» для игр с очками | Билет фиксирует сумму, но не то, что игрок действительно играл | Пост-сид: сервер генерирует seed, клиент возвращает `{seed, inputs[]}`, сервер реплеит и проверяет достижимость счёта. Для аркад — серверная проверка физики на ключевых кадрах |
| Ограничение «одна игровая сессия на пользователя» | Мультитаб/мультиаккаунт качают лимиты | Таблица `active_sessions(user_id, sid, started_at, last_seen)` + закрытие предыдущей сессии |
| Журнал доказуемости | Разбор спорных начислений | `game_events(id, user_id, game, sid, receipt, amount, verdict, meta jsonb, created_at)` — append-only, без UPDATE |
| Публикация RTP/вероятностей | Доверие игроков и требования регуляторов | Уже отдаётся `/api/casino/rules`; добавить хеш версии в HTML |

### 1.4. Транзакции: ACID, блокировки, идемпотентность

Экономика держится на трёх инвариантах, записанных в схеме (`schema_sql.py`), а
не в коде:

```sql
CREATE TABLE wallets (
    id       BIGSERIAL PRIMARY KEY,
    user_id  BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    balance  BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0)   -- минус невозможен
);
CREATE TABLE transactions (
    id               BIGSERIAL PRIMARY KEY,
    user_id          BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wallet_id        BIGINT REFERENCES wallets(id) ON DELETE SET NULL,
    amount           BIGINT NOT NULL,
    balance_after    BIGINT NOT NULL CHECK (balance_after >= 0),
    transaction_type TEXT   NOT NULL,
    description      TEXT   NOT NULL DEFAULT '',
    reference_id     TEXT   UNIQUE,        -- ключ идемпотентности
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Порядок операций в `DataStore._apply_delta` (реальный код, упрощённо):

```python
def _apply_delta(self, c, user_id, delta, kind, reason, ref):
    before = self._wallet_for_update(c, user_id)      # SELECT … FOR UPDATE
    after = before + int(delta)
    if after < 0:
        raise InsufficientFunds('Недостаточно V-монет')   # откат всей транзакции
    if after > MAX_BALANCE:
        raise LimitExceeded('Баланс превышает допустимый максимум')
    c.execute('UPDATE wallets SET balance=?, updated_at=? WHERE user_id=?', (after, iso(), user_id))
    c.execute('INSERT INTO transactions(user_id,wallet_id,amount,balance_after,'
              'transaction_type,description,reference_id,created_at) VALUES(?,?,?,?,?,?,?,?)',
              (user_id, wallet_id, int(delta), after, kind, reason, ref, iso()))
    return after
```

* `FOR UPDATE` сериализует конкурентные списания **одного** кошелька; разные
  кошельки не мешают друг другу.
* Транзакция PostgreSQL по умолчанию — `SERIALIZABLE` (`_PgTx`): в сочетании с
  `FOR UPDATE` это исключает и lost update, и «фантомное» чтение лимитов.
  ⬜ Повтор на `40001`/`40P01` с джиттером — следующий шаг: сейчас при редком
  конфликте клиент получает 400 и повторяет действие, что для экономики
  безопасно (ничего не начислено), но хуже по UX.
* `UNIQUE(reference_id)` — страховка от дублей на уровне БД: даже если два
  воркера одновременно обработают один запрос, второй получит
  `UniqueViolation` и вернёт «уже начислено».
* `CHECK (balance >= 0)` — последняя линия: любая ошибка в коде не создаст
  отрицательный баланс.
* Проверка «сколько уже начислено сегодня» (`game_limits … FOR UPDATE`) идёт в
  той же транзакции, что и выплата, — иначе два параллельных запроса оба увидят
  «лимит не исчерпан».

Проверка руками:

```bash
# параллельные списания: баланс не уходит в минус, лишние получают отказ
python -m unittest tools.test_economy -k parallel_spending
```

### 1.5. Rate limiting: три уровня

| Уровень | Где | Что закрывает | Цена |
| --- | --- | --- | --- |
| Токен-бакет в памяти (`guard.allow`) | до БД | шквал `postMessage`, флуд наградами | ~1 мкс, без I/O |
| Скользящее окно в БД (`DataStore.rate_limit`) | на эндпоинте | «60 наград в минуту», вход, регистрация | один `UPSERT` |
| Edge-лимиты Cloudflare | до приложения | DDoS, credential stuffing | бесплатно в плане |

Скользящее окно (уже в коде) — атомарный инкремент с блокировкой строки:

```python
def rate_limit(self, key: str, limit: int, seconds: int) -> bool:
    with self.driver.transaction() as c:
        row = c.execute('SELECT count, expires_at FROM rate_limits WHERE key=? FOR UPDATE',
                        (key,)).fetchone()
        if row and row['expires_at'] > now():
            if row['count'] >= limit:
                return False
            c.execute('UPDATE rate_limits SET count=count+1 WHERE key=?', (key,))
        else:
            c.execute('INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) '
                      'ON CONFLICT (key) DO UPDATE SET count=1, expires_at=EXCLUDED.expires_at',
                      (key, expires_at))
    return True
```

Ключ всегда включает то, что нужно разделять: `login:<ip>`,
`login_name:<ник>`, `reward:<uid>`, `admin_login:<ip>`.

**Подделка `X-Forwarded-For` — отдельная ловушка.** Клиент может прислать свой
заголовок, и прокси **дописывает** реальный адрес в конец. Если брать первый
элемент (как делают почти все примеры в интернете), атакующий одним заголовком
получает новый «IP» на каждый запрос и обходит все лимиты. В коде это закрыто
двумя независимыми мерами:

```python
def client_ip() -> str:
    if TRUSTED_PROXY:
        if cf := (request.headers.get('CF-Connecting-IP') or '').strip():
            return cf                      # Cloudflare перезаписывает сам
        hops = [h.strip() for h in (request.headers.get('X-Forwarded-For') or '').split(',') if h.strip()]
        if hops:
            return hops[-1]                # последний дописал ближайший прокси
    return request.remote_addr or ''        # по умолчанию заголовкам не верим

def rate(scope, limit, seconds, extra=''):
    # 1) грубый потолок по адресу сокета — его подделать невозможно;
    #    множитель, чтобы NAT/офис не страдали;
    db.rate_limit(digest(f'{scope}:peer:{request.remote_addr}'), limit * RATE_SOCKET_FACTOR, seconds)
    # 2) точный лимит по IP клиента
    return db.rate_limit(digest(f'{scope}:{client_ip()}:{extra}'), limit, seconds)
```

Тест `test_forwarded_header_spoofing_does_not_escape_limits` шлёт 40 попыток
входа с разными поддельными адресами и требует появления 429. Живая проверка на
стенде: раньше 90 попыток проходили все, теперь первая 429 наступает на ~47-й
попытке (потолок по сокету), хотя лимит по «IP» каждый раз новый.

**⬜ Redis вместо БД** — когда запросов станет много: `INCR` + `EXPIRE` в
одном Lua-скрипте, `ZSET` для точного скользящего окна, `CL.THROTTLE` в Redis
Stack. Redis держит лимиты в памяти и не нагружает PostgreSQL, но появляется
второй stateful-сервис: обязательны `maxmemory-policy noeviction`, TLS и
пароль, иначе лимиты можно «выдавить» из памяти.

### 1.6. Поведенческие аномалии (`guard.py`) ✅

Дешёвая эвристика на воркер: `AnomalyTracker` хранит последние события игрока в
окне 60 с и считает три метрики — частоту событий, сумму V/мин и средний
интервал между событиями. Пороги в переменных окружения:

```bash
ANOMALY_EVENTS_PER_MIN=90       # больше — подозрительно
ANOMALY_COINS_PER_MIN=900
ANOMALY_MIN_INTERVAL=0.35       # 350 мс между событиями — предел человека
ANOMALY_STRIKE_LIMIT=3          # третье срабатывание = 429
```

Реакция **эскалирующая**, а не «бан навсегда»:

| Срабатываний | Ответ |
| --- | --- |
| 1–2 | выплата 0, флаг `throttled: true`, запись в `admin_log` |
| ≥ 3 | `429 ANOMALY`, пауза |

Так быстрый браузер с очередью сообщений не теряет игрока, а бот не получает
экономику. Все срабатывания пишутся в журнал администратора с ником и хешем IP —
дежурный видит ложные срабатывания и правит пороги **без релиза**.

⬜ Следующий шаг для игры с большим потоком: те же метрики в Redis
(`INCR` по бакетам `uid:minute`), плюс сигналы «новый аккаунт < 10 минут»,
«один IP → много аккаунтов», «идентичный тайминг событий у разных аккаунтов»
(коррелированный ботнет).

### 1.7. Инвентарь и предметы

Владение — строка в `inventory` с `UNIQUE(user_id, item_id)`, покупка —
транзакция «списать + записать» с ключом `buy:<uid>:<item>`: повторная покупка
возвращает `already: true` и денег не списывает. Цена берётся из `items` в БД,
никогда из запроса. Каталог (`/api/shop`) отдаёт только активные предметы —
скрытые (`redline` и подобные) не видны в публичном списке.

---

### 1.8. Колесо: где реально была ошибка «×3 даёт 30»

Выплата в `casino_logic.spin_wheel` всегда была верной:

```python
payout = int(round(stake * multiplier))     # stake=100, x3 -> 300
```

Ставка списывается до вращения (`charge=stake`), выплата начисляется в той же
транзакции (`db.casino_bet`), поэтому **изменение баланса** за спин равно
`payout - stake`:

| сектор | ставка | списание | выплата | изменение баланса |
| --- | --- | --- | --- | --- |
| ×1 | 20 | −20 | 20 | **0** (ставка возвращается) |
| ×3 | 100 | −100 | 300 | **+200** |
| ×0.25 | 100 | −100 | 25 | −75 |
| ×0 | 20 | −20 | 0 | −20 |

Ошибка была в **анимации**: `target = rotation + 6·2π − (i·arc + arc/2) + 2π`
не учитывала, что указатель висит сверху (угол `3π/2`). Колесо останавливалось
на соседнем секторе, и игрок видел «×0.25» (ставка 100 → 25, то есть ровно
«в 10 раз меньше»), а не «×3». Для ×1 визуально казалось, что монеты «сгорели»,
потому что выплата 20 совпадала со списанием, но под указателем стоял ×0.25.

### 1.8.1. Списание на старте и зачисление в конце — два разных события

Раньше на экране было видно только одно число (выплату), поэтому «×1» выглядел
как сгоревшая ставка, а «×3 при ставке 20» — как «×3 от 10». Теперь сервер
возвращает обе величины раздельно, и клиент показывает именно их:

```python
charge = 0 if use_free else stake   # списывается ДО вращения
payout = int(round(stake * multiplier))  # зачисляется ПОСЛЕ, целиком
net    = payout - charge            # итог для игрока
```

| поле | смысл | ×1, ставка 20 | ×2, ставка 20 | ×0, ставка 20 |
| --- | --- | --- | --- | --- |
| `charge` | списано на старте (видно сразу) | 20 | 20 | 20 |
| `credit` | зачислено в конце (полная выплата) | 20 | 40 | 0 |
| `net` | изменение баланса за спин | 0 | +20 | −20 |

Важно: `credit == payout == stake * multiplier` — это **полная** выплата,
включающая возврат ставки, а не «чистый выигрыш». Поэтому:

* ×1 — возвращается ровно ставка, баланс не меняется (ставка не сгорает);
* ×2 — возвращается двойная ставка: половина — возврат, половина — выигрыш;
* ×0 — не возвращается ничего.

В журнале (`transactions`) это тоже две проводки с общим `reference_id`:
`casino`/`bet:<ref>` на `-stake` и `casino-win`/`win:<ref>` на `+payout`.
Так списание нельзя «потерять» при сверке, а администратор видит обе ноги.

На клиенте ставка списывается **оптимистично** — сразу по нажатию, до ответа
сервера, чтобы игрок видел движение денег:

```js
VG.updateCoins(Math.max(0, VG.coins() - stake));   // старт: ставка ушла
// ... ответ сервера ...
VG.updateCoins(data.balance);                      // финиш: полная выплата
```

Если сервер отклонил спин (лимит, недостаточно монет, сеть), баланс
восстанавливается из источника истины: `VG.refreshCoins()` в `catch` — иначе
оптимистичное списание осталось бы на экране висеть.

Отдельно про кеш: JS/CSS платформы отдаются с `Cache-Control: public, max-age=60,
must-revalidate` (картинки — как раньше, на сутки). Иначе после деплоя игрок
ещё сутки видел бы старый `casino.js` — без списания на старте и без показа
полной выплаты; `stale-while-revalidate` делал это окно ещё шире.

### 1.8.2. «×2 принёс 5 монет»: где на самом деле ломалось

Отчёт игрока: ставка 20, выпал сектор ×2, а на баланс пришло 5 монет. Ни в
`casino_logic.py`, ни в JS нет деления ставки: выплата всегда считалась как
`stake * multiplier`. Ломался **показ**: формула остановки колеса была скопирована
в `roulette.js` и `casino.js`, и в обеих копиях отсутствовало слагаемое
указателя (`3π/2`). Из-за этого колесо вставало на два сектора раньше
оплаченного:

| сервер заплатил за | под указателем оказалось | выплата при ставке 20 |
| --- | --- | --- |
| ×5 | ×1 | 100 → игрок видел «×1» |
| ×2 | ×0.5 | **40 → игрок видел «×2» и получал 10** |
| ×0.25 | ×1 | 5 |

То есть «×2 → 5 монет» — это «×0.5 → 10 монет» на экране, где нарисовано «×2»:
занижение ровно в 4 раза. Проверка «старая формула» против инварианта даёт
7 расхождений из 7 (сдвиг на два сектора).

Исправлено структурно, а не заплаткой:

```python
# casino_logic.py — единственное место, где ставка умножается
def wheel_payout(stake: int, multiplier: float) -> int:
    return int(round(int(stake) * multiplier))
```

```js
// assets/vg/js/wheel-math.js — единственная реализация геометрии
var POINTER = Math.PI * 3 / 2;                       // указатель сверху
function target(rotation, segment, count, turns) {
  var step = arc(count);
  var desired = POINTER - (segment * step + step / 2);
  var delta = ((desired - rotation) % TWO_PI + TWO_PI) % TWO_PI;
  return rotation + turns * TWO_PI + delta;
}
```

Обе страницы (`roulette.html`, `casino.html`) подключают `wheel-math.js` и
вызывают `VGWheel.target(...)`; своих копий формулы в страничных скриптах больше
нет (это проверяет `test_client_does_not_duplicate_the_landing_formula`).

Инварианты, которые теперь ловят регресс автоматически:

* `payout == round(stake * multiplier)` для всех 7 секторов и любой ставки —
  `tools/test_wheel.py` и `tools/test_wheel_api.py`;
* `credit == payout`, `charge == stake`, `net == payout - stake`, баланс после
  запроса = `было − ставка + выплата` — `tools/test_wheel_api.py` (сквозь HTTP,
  через настоящий Flask-роут, по одному игроку на спин из-за лимита 5/сутки);
* «сектор под указателем == сектор, за который заплатили» — `tools/test_wheel_math.js`
  (28 тыс. проверок: все секторы × любой начальный угол × разное число секторов)
  и `WheelAnimationGeometry` в `tools/test_wheel.py`;
* при подмене формулы на `/4` тесты падают с сообщением
  `x2 при ставке 20: выплата 10, ждали 40` — проверено мутационно.

Проверяется в `tools/test_wheel.py`: `test_api_reports_charge_credit_and_net`,
`test_x2_half_is_return_and_half_is_win`,
`test_ledger_has_separate_charge_and_credit_rows`.

Исправлено в `roulette.js` и `casino.js`:

```js
var pointer = Math.PI * 3 / 2;                    // указатель сверху
var desired = pointer - (data.segment * arc + arc / 2);
var delta = ((desired - rotation) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
var target = rotation + Math.PI * 2 * 6 + delta;  // 6 оборотов + доводка
```

Проверки: `tools/test_wheel.py` (payout для каждого сектора, x1 = возврат
ставки, x3 = ×3, раздельные `charge`/`credit`/`net`, две проводки в журнале,
история и «Итог», бесплатный спин, единая точка умножения) и
`WheelAnimationGeometry` — повторяет формулу JS и требует, чтобы при любом
начальном повороте под указателем оказывался именно выпавший сектор.

## 2. Аутентификация и защита от ботов

### 2.1. Регистрация и вход

Только ник + пароль, без email: меньше PII, меньше поверхности атаки (нет
сброса пароля по почте — нет и его уязвимостей).

Поток: `GET /api/session` → CSRF-токен → `POST /api/auth/register`
(`{username, password, turnstileToken, startedAt}`).

**Пароли — Argon2id** (`argon2-cffi`): memory-hard, устойчив к GPU/ASIC в
отличие от PBKDF2 и bcrypt. Старые `pbkdf2_sha256`/bcrypt-хеши продолжают
проверяться и **перехешируются в Argon2id** при первом успешном входе.

```python
# db.py
def _argon2():
    return PasswordHasher(memory_cost=64 * 1024, time_cost=3, parallelism=2)
# → $argon2id$v=19$m=65536,t=3,p=2$…
```

Проверка занимает десятки миллисекунд на одном ядре Render free: достаточно
дорого для офлайн-перебора, достаточно дешево для входа. Если `argon2-cffi` не
установлен, остаётся bcrypt → `pbkdf2_sha256` (совместимость), при первом
успешном входе хеш переписывается в Argon2id.

### 2.2. Turnstile: где именно проверяется ✅

Капча нужна там, где можно **создать ценность из ничего**: регистрация, вход,
вход в админку. Логика — `captcha.verify()`:

```python
def verify(token: str, ip: str = '') -> tuple[bool, str]:
    if required() and not enabled():
        return False, 'CAPTCHA_NOT_CONFIGURED'      # «тихо выключить» нельзя
    if not enabled():
        return True, ''                             # локально/тесты
    token = str(token or '').strip()
    if not token or len(token) > 4096:
        return False, 'CAPTCHA_REQUIRED'
    fingerprint = store.digest('turnstile:' + token)
    if not store.get_store().rate_limit('captcha_used:' + fingerprint, 1, 900):
        return False, 'CAPTCHA_REUSED'               # токен одноразовый
    body = {'secret': secret(), 'response': token}
    if ip:
        body['remoteip'] = ip                        # проверка привязки к IP
    with urlopen(Request(VERIFY_URL, data=urlencode(body).encode(), method='POST'), timeout=8) as r:
        payload = json.loads(r.read().decode() or '{}')
    if payload.get('success') is not True:
        return False, 'CAPTCHA_FAILED'
    return True, ''
```

Почему так, а не «проверка в JS»:

* секрет (`TURNSTILE_SECRET_KEY`) живёт только на сервере — клиент его не видит;
* `remoteip` не даёт перепродать решённый токен другому клиенту;
* предварительная «зажигалка» токена в `rate_limits` закрывает гонку двух
  параллельных запросов с одним токеном; при недоступности Cloudflare бронь
  снимается, чтобы не заблокировать честного пользователя;
* **fail-closed на конфигурацию:** `TURNSTILE_REQUIRED=1` + пустые ключи = отказ,
  а не тихая работа без капчи (самая частая причина «капча включена, но не
  работает» на проде).

Выбор провайдера: **Turnstile** — основной (приватный, без трекинга, бесплатный,
невидимый для большинства людей). reCAPTCHA v3 — если нужна тонкая оценка риска
и уже есть инфраструктура Google (но v3 возвращает score, и **порог всё равно
проверяется на сервере**: `if score < 0.5: reject`). hCaptcha — если важна
независимость от Cloudflare. Не ставить две капчи на одну форму: это ломает UX и
не добавляет защиты.

⬜ Для «высоких» действий внутри сессии (крупная покупка, смена пароля,
вывод) — **невидимая** проверка с отдельным виджетом и порогом: одна капча на
вход + повтор на опасное действие, а не на каждый клик.

### 2.3. Credential stuffing и перебор

| Механизм | Реализация |
| --- | --- |
| Лимит по IP | `rate('login', 10, 600)` + грубый потолок по сокету (`RATE_SOCKET_FACTOR`, ×6) |
| Лимит по нику | `rate('login_name', 12, 900, username.casefold())` |
| Лимит регистрации | 60/час на IP, 10/час на ник |
| Лимит админки | 6/15 мин + журнал неудач |
| Argon2id | офлайн-перебор невыгоден, даже при утечке БД |
| Honeypot + «слишком быстро» | поле `website` и `startedAt` в регистрации отсекают простые формы |
| Одинаковый ответ | «неверный ник или пароль» — без подсказки, существует ли аккаунт |
| Turnstile | отсекает автоматизированный перебор до проверки пароля |

⬜ **Lockout по аккаунту** (осторожно!): жёсткая блокировка — оружие
DoS против конкретного игрока. Правильно: экспоненциальная задержка
(1 с → 2 с → 4 с → … до 30 с) и CAPTCHA-челлендж после 5 неудач, а не «аккаунт
заблокирован на час». Уведомление владельцу аккаунта — при наличии канала
(например, в интерфейсе профиля «была неудачная попытка входа»).

### 2.4. Сессии и hijacking

```python
# server.py
COOKIE = 'vg_session'
response.set_cookie(COOKIE, token, max_age=SESSION_TTL, httponly=True,
                    samesite='Lax', secure=is_https(), path='/')
```

* в БД хранится **только SHA-256 токена** (`sessions.token_hash`) — утечка БД не
  даёт готовых cookie;
* `HttpOnly` — JS не прочитает токен при XSS;
* `SameSite=Lax` — CSRF-запросы со сторонних сайтов не отправят cookie;
* `Secure` на HTTPS (определяется по `PUBLIC_URL`/`X-Forwarded-Proto`);
* ротация при входе (`session fixation`), удаление всех сессий при смене пароля;
* срок 30 дней с продлением по активности; для админки — короткий
  `ADMIN_SESSION_TTL` и отдельная cookie `vg_admin`.

Почему не JWT в localStorage: JWT нельзя отозвать до истечения, а в
`localStorage` его читает любой XSS. Если JWT всё-таки нужен (мобильный клиент,
несколько сервисов):

* access-токен 5–15 минут, в памяти процесса, не в `localStorage`;
* refresh-токен — `HttpOnly; Secure; SameSite=Strict` cookie, **ротация при каждом
  использовании** с детектором повторного использования (старый refresh →
  отзыв всей цепочки, «refresh token reuse detection»);
* `jti` в хранилище, чтобы отзывать отдельные токены;
* подпись `RS256`/`ES256`, `aud`/`iss` проверяются, `alg` — только из белого
  списка (никакого `alg: none`).

### 2.5. CSRF ✅

Double-submit cookie: `vg_csrf` + заголовок `X-CSRF-Token`. Ключевая деталь,
которая ломала прод: токен должен выдаваться **один раз на запрос** и совпадать
в теле ответа и в cookie, иначе браузер сохраняет одну куку, а фронт присылает
другую, и все POST падают с 403.

```python
def ensure_csrf_token() -> str:
    token = getattr(g, 'csrf_token', '')
    if token:
        return token
    token = request.cookies.get(CSRF_COOKIE, '') or secrets.token_urlsafe(24)
    g.csrf_token = token
    return token
```

Исключения: `/api/auth/register`, `/api/auth/login`, `/api/admin/login` без
cookie (первый визит) и вебхуки магазина (подписаны своим секретом).

⬜ Дополнительно: `Origin`/`Sec-Fetch-Site` проверка для всех небезопасных
запросов — дешёвая страховка, если CSRF-токен когда-нибудь утечёт через XSS
(от XSS она не спасает, но ловит сторонние сайты жёстче, чем SameSite).

---

## 3. Инфраструктура и защита от захвата сайта

### 3.1. Заголовки безопасности ✅

`server.py::security_headers` ставит на **каждый** ответ:

| Заголовок | Значение | Зачем |
| --- | --- | --- |
| `Content-Security-Policy` | см. ниже | XSS, инъекции, сторонние скрипты |
| `X-Frame-Options` | `SAMEORIGIN` (`DENY` для админки) | clickjacking: свой origin не может вложить чужой сайт |
| `frame-ancestors` | `'self'` (`'none'` для админки) | то же в CSP |
| `frame-src` | `'self' https://challenges.cloudflare.com` | каталог вкладывает свои игры в `#playOverlay` |
| `X-Content-Type-Options` | `nosniff` | MIME-sniffing |
| `Referrer-Policy` | `same-origin` | утечка URL во внешние ресурсы |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` | только HTTPS |
| `Permissions-Policy` | `geolocation=(), microphone=(), camera=()` | лишние API выключены |
| `Cross-Origin-Opener-Policy` | `same-origin` | изоляция окна (Spectre, name collisions) |
| `Cross-Origin-Resource-Policy` | `same-origin` | чужие сайты не грузят наши ассеты |

CSP для обычных страниц:

```
default-src 'self';
script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com;
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
img-src 'self' data: blob:;
font-src 'self' data: https://fonts.gstatic.com;
connect-src 'self' https://challenges.cloudflare.com;
frame-src https://challenges.cloudflare.com;
frame-src 'self' https://challenges.cloudflare.com;
frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none';
worker-src 'self' blob:
```

3D-игры (`minicraft`, `sky-isle`, `chefs-rover`) дополнительно получают
`https://cdn.babylonjs.com` в `script-src`/`connect-src` — остальные страницы
остаются без него.

⬜ **CSP без `unsafe-inline`** (главный оставшийся шаг): вынести инлайн-скрипты
игр в отдельные файлы или проставить `nonce` per-request:

```python
@app.before_request
def csp_nonce():
    g.csp_nonce = secrets.token_urlsafe(16)

# в шаблоне: <script nonce="{{ g.csp_nonce }}">
# в CSP:    script-src 'self' 'nonce-{nonce}' https://challenges.cloudflare.com
```

После этого `'unsafe-inline'` убирается, и любой инжектированный `<script>`
перестаёт исполняться. Это самая ценная мера против XSS — и самая трудоёмкая
(80+ HTML-файлов, инлайн-обработчики `onclick` надо заменить на `addEventListener`).
Порядок: сначала отчёт-режим (`Content-Security-Policy-Report-Only` +
`report-uri`), неделя наблюдения, потом блокировка.

⬜ `require-trusted-types-for 'script'` — когда браузеры начнут массово
поддерживать, это закроет DOM-XSS целиком. Пока — только в отчёте.

### 3.2. WAF и DDoS (Cloudflare) — настройка по шагам

✅ **Делать:** проксировать домен через Cloudflare (оранжевая туча), закрыть
прямой IP источника (Render: не публиковать `.onrender.com`; доступ к источнику —
только через Cloudflare Tunnel или Allowlist Cloudflare IP на origin).

Рекомендуемые правила (Managed Rules + свои):

| Правило | Действие | Зачем |
| --- | --- | --- |
| Cloudflare Managed Ruleset | Block (постепенно) | SQLi, XSS, RCE, LFI на уровне сигнатур |
| OWASP Core Ruleset | Block, paranoia 2 | инъекции в параметрах и JSON |
| Rate limit: `POST /api/auth/login` | 20/мин на IP → Block 10 мин | credential stuffing |
| Rate limit: `POST /api/auth/register` | 10/мин на IP | массовая регистрация |
| Rate limit: `POST /api/games/reward` | 120/мин на IP → Challenge | флуд наградами |
| Rate limit: всё `/api/admin/*` | 60/мин на IP → Block | перебор админки |
| WAF custom: `?` или `%27` в User-Agent | Block | сканеры |
| Бот-режим | Bot Fight Mode / Super Bot Fight Mode: definitely automated → Block | простые боты |
| Turnstile на регистрации | Managed Challenge | совместимо с серверной проверкой |
| geo/ASN | Challenge для «не наших» регионов (если продукт локальный) | снижение шума |
| Cache Rules | `/*.css|js` — Cache Everything, `/*` — No cache for `/api/*` | производительность без кеша ответов API |

Под капотом Render free важна ещё одна вещь: **приложение обязано само
переживать пик** — Cloudflare отсекает часть, но лимиты в приложении
(`guard.allow`) остаются третьей линией.

⬜ Не делать: `Under Attack Mode` «на всякий случай» (ломает API-клиентов),
WAF-правило «Block всех не-браузерных User-Agent» (убьёт curl/мониторинг),
«Block по странам» без аналитики.

### 3.3. SQLi и инъекции ✅

Весь доступ к БД — параметризованные запросы (`?`-плейсхолдеры, драйвер
экранирует). Никакой конкатенации пользовательских данных в SQL. Динамические
части (имена таблиц в админке, сортировка) — белые списки:

```python
SORT = {'created': 'created_at', 'coins': 'balance'}       # не из запроса напрямую
column = SORT.get(request.args.get('sort'), 'created_at')
```

Дополнительно: у приложения отдельный пользователь БД с минимальными правами
(см. 3.5), а `CREATE/ALTER` в рантайме не выполняются — схема накатывается
Alembic-миграцией в деплое.

### 3.4. XSS ✅ / ⬜

### Фрейминг: почему `SAMEORIGIN`, а не `DENY`

Каталог (`top.html`) открывает игру во фрейме `#playOverlay`
(`<iframe class="play-frame" src="games/*.html">`), поэтому `DENY` и
`frame-ancestors 'none'` ломали запуск игр — браузер показывал серый экран с
перечёркнутым значком. Правильная настройка:

* страницы и игры — `X-Frame-Options: SAMEORIGIN`, `frame-ancestors 'self'`
  (вкладывать платформу может только она сама, чужой сайт — нет);
* `frame-src 'self'` — разрешает iframe на свой же origin;
* **админка — исключение**: `DENY` + `frame-ancestors 'none'`
  (`server.py::_is_admin_response`), чтобы её нельзя было вложить даже с
  собственного домена (защита от UI-redress при XSS на игровых страницах).

Регрессионные проверки: `test_own_games_can_be_framed_by_own_origin`,
`test_admin_cannot_be_framed_at_all`, `test_csp_allows_only_expected_hosts`.

✅ Экранирование HTML на клиенте (`escapeHtml`, `textContent` вместо `innerHTML`
для пользовательских строк), CSP запрещает сторонние скрипты и `object-src`.

⬜ Осталось: `innerHTML` в шаблонах каталога и профиля — заменить на
`document.createElement`/`textContent` там, где подставляются ники и названия
предметов (ники уже проходят строгую валидацию `[A-Za-z0-9 .-]`, но правило
«данные ≠ разметка» проще соблюдать везде). Trusted Types — после этого.

### 3.5. Секреты, права БД, изоляция админки

✅ В репозитории нет секретов: `SECRET_KEY`, `ADMIN_PASSWORD`,
`TURNSTILE_SECRET_KEY`, `DATABASE_URL`, `GAME_SIGNING_KEY` — только переменные
окружения Render (`render.yaml`, `sync: false`). `tools/check_platform.py`
падает, если секретный файл (`.env`, `db.py`, `server.py`, …) отдаётся
HTTP-сервером; в `.gitignore` — `data/`, `*.sqlite3`, `.env`, `*.zip`.

**Ключ подписи билетов — отдельный секрет.** `GAME_SIGNING_KEY` не совпадает с
`SECRET_KEY`: компрометация одного не ломает другой, а ротация ключа
инвалидирует все выданные билеты (это штатная операция при инциденте):

```bash
# ротация: новый ключ → рестарт → игроки получают новые билеты при открытии игры
GAME_SIGNING_KEY=$(openssl rand -base64 48)
```

⬜ **Минимальные права БД.** Приложение работает под ролью без `DDL` и без прав
на чужие схемы:

```sql
CREATE ROLE vertu_app LOGIN PASSWORD '…';
GRANT CONNECT ON DATABASE vertu TO vertu_app;
GRANT USAGE ON SCHEMA public TO vertu_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO vertu_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO vertu_app;
REVOKE CREATE ON SCHEMA public FROM vertu_app;          -- игры не создают таблиц
REVOKE ALL ON SCHEMA public FROM PUBLIC;
-- миграции — отдельная роль vertu_migrator с DDL, используется только в деплое
```

⬜ **Изоляция админки от игрового трафика:**

* отдельный хост `admin.example.com` (или `/admin/*` за Cloudflare Access), своя
  cookie (`__Host-vg_admin`), `SameSite=Strict`, срок жизни 1–2 часа;
* Cloudflare Access (SSO + OTP) перед админкой — пароль админки становится
  вторым фактором, а не единственным;
* никаких админ-эндпоинтов в публичном API-пространстве без
  `ADMIN_COOKIE`/роли; все действия — в `admin_log` с ником и хешем IP;
* для админки — отдельный rate limit и отдельный WAF-правило;
* в идеале — отдельный деплой (второй Render-сервис) с доступом только из
  внутренней сети/по списку IP, чтобы уязвимость в игровом коде не давала
  доступа к админским операциям.

⬜ **Деплой:**

* `gunicorn --workers 2 --threads 4` (free-план) с таймаутом и `--max-requests`
  для утечек; health-check `/api/health` (без секретов — только `enabled/ttl`);
* заголовки безопасности не снимать на прокси (Cloudflare не должен перезаписывать
  CSP; проверять `curl -I` после каждого деплоя);
* отдельные окружения `staging`/`prod` с разными `DATABASE_URL` и `SECRET_KEY`;
* бэкапы PostgreSQL (`pg_dump` по расписанию + проверка восстановления раз в
  месяц), PITR на платном плане;
* логи: не писать токены/пароли/тела запросов; `admin_log` и `anomaly` —
  хранить, остальное — 30 дней;
* `pip-audit`/`npm audit` в CI, `Dependabot` на еженедельные обновления;
* `python tools/smoke_deploy.py https://… --admin-password '…'` после деплоя —
  проверка, что CSRF, вход, награды и админка живы.

### 3.6. CORS

Публичный API — same-origin, CORS **не нужен**: в `server.py` нет
`Access-Control-Allow-Origin`, значит браузер не отдаст ответ чужому сайту.
Если появится внешний клиент — только явный белый список:

```python
ALLOWED = {'https://partner.example'}
origin = request.headers.get('Origin')
if origin in ALLOWED:
    response.headers['Access-Control-Allow-Origin'] = origin
    response.headers['Access-Control-Allow-Credentials'] = 'true'
    response.headers['Vary'] = 'Origin'
```

`*` с credentials запрещён браузером, а `*` без credentials для
аутентифицированного API — это «отдай данные любому сайту».

---

## 4. Приоритетный чек-лист

Порядок — по соотношению «риск × стоимость». Первые 6 пунктов закрывают 90 %
реального ущерба.

### P0 — сделать до публичного запуска ✅ (проверено тестами)

1. ✅ Сумма награды и результаты казино считаются на сервере; клиентские поля
   `amount` игнорируются.
2. ✅ Подписанные билеты игровых сессий (`/api/games/session`) + идемпотентность
   по `sid`; подделка/повтор/просрочка/чужая игра → 403.
3. ✅ `transactions.reference_id UNIQUE`, `wallets.balance CHECK (>=0)`,
   `SELECT … FOR UPDATE` в одной транзакции.
4. ✅ Argon2id + авто-перехеширование старых хешей.
5. ✅ Turnstile на регистрации/входе/админке, одноразовые токены, fail-closed
   при `TURNSTILE_REQUIRED=1`.
6. ✅ Сессии: HttpOnly/SameSite/Secure, в БД только хеш токена, ротация при
   смене пароля; CSRF double-submit на всех небезопасных запросах.
7. ✅ Заголовки: CSP, HSTS (preload), `X-Frame-Options: SAMEORIGIN`
   (`DENY` для админки), `frame-ancestors 'self'`, `frame-src 'self'`, nosniff,
   COOP/CORP, Permissions-Policy.
8. ✅ Секреты только в env; приложение не отдаёт `.env`/`.py`; отдельный
   `GAME_SIGNING_KEY`; удалён 17 МБ zip из git.
9. ✅ Rate limiting в три уровня (память → БД → Cloudflare), лимиты на вход,
   регистрацию, награды, админку.
10. ✅ Аномалии: частота событий, V/мин, «машинный» интервал, эскалация
    throttle → 429, журнал для разбора.

### P1 — первый месяц после запуска

11. ⬜ Cloudflare: Managed Rules + OWASP CRS, rate rules на `/api/auth/*`,
    `/api/games/reward`, `/api/admin/*`, Bot Fight Mode; origin скрыт.
12. ⬜ Роль БД с минимальными правами; миграции отдельной ролью.
13. ⬜ Изоляция админки: отдельный хост/путь + Cloudflare Access + короткая
    `SameSite=Strict` cookie.
14. ⬜ CSP без `unsafe-inline` (nonce), сначала в Report-Only.
15. ⬜ Экспоненциальная задержка входа + CAPTCHA после 5 неудач; уведомление
    владельцу аккаунта.
16. ⬜ Журнал `game_events` (append-only) для разбора спорных начислений.
17. ⬜ `pip-audit`/Dependabot в CI; проверка бэкапов.

### P2 — зрелость

18. ⬜ Redis для лимитов и аномалий (скользящее окно, `INCR`+`EXPIRE`).
19. ⬜ Серверная валидация результатов игр (seed/inputs replay) для
    соревновательных режимов.
20. ⬜ Отдельный деплой игровых серверов и админки, сетевые политики.
21. ⬜ Trusted Types, `Cross-Origin-Embedder-Policy`, отчёты CSP (`report-uri`).
22. ⬜ Внешний пентест / bug bounty перед крупным маркетингом.

---

## 5. Проверки

```bash
# сквозные: 180 проверок, включая подделку билета и отсутствие награды без билета
python tools/check_platform.py
DATABASE_URL=postgresql://… python tools/check_platform.py

# колесо: payout = ставка × множитель, x1 возвращает ставку, остановка колеса
python -m unittest tools.test_wheel -v          # 17 тестов
python -m unittest tools.test_wheel_api -v      # 4 теста: выплата = ставка × множитель сквозь HTTP
node tools/test_wheel_math.js                   # геометрия: сектор под указателем == оплаченный

# античит: подпись, повтор, просрочка, чужой билет, шквал, заголовки
python -m unittest tools.test_anticheat -v      # 25 тестов

# экономика: атомарность, гонки, идемпотентность, лимиты
python -m unittest tools.test_economy -v        # 18 тестов

# живой деплой: health/backend, CSRF, вход, награда, админка, выход
python tools/smoke_deploy.py https://… --admin-password '…'
```

Что именно доказывают тесты античита:

| Тест | Атака | Ожидание |
| --- | --- | --- |
| `test_amount_tampering_rejected` | «хочу 1000 V за событие» | 403 `TICKET` |
| `test_same_ticket_never_pays_twice` | повтор перехваченного запроса | вторая выплата = 0 |
| `test_expired_rejected` | старый билет из истории | 403 |
| `test_foreign_user_rejected` | билет другого аккаунта | 403 |
| `test_other_game_rejected` | билет snake → flappy | 403 |
| `test_burst_is_rate_limited` | 20 запросов подряд | появление 429 |
| `test_reward_requires_ticket` | запрос награды «как раньше» | 403 `TICKET` |
| `test_client_ip_ignores_forwarded_header_without_proxy` | подделка `X-Forwarded-For` | лимит считается по реальному IP |
| `test_anomaly_marks_machine_tempo` | 8 событий за 0.1 с | throttle/429 |
| `test_csp_allows_only_expected_hosts` | инъекция внешнего скрипта | CSP блокирует |
| `test_hsts_only_on_https` | заход по http | HSTS не ломает локальную разработку |
| `test_own_games_can_be_framed_by_own_origin` | игры не открываются в плеере | `SAMEORIGIN` + `frame-ancestors 'self'` |
| `test_admin_cannot_be_framed_at_all` | clickjacking админки | `DENY` + `frame-ancestors 'none'` |

---

## 6. Переменные окружения безопасности

| Переменная | Назначение | Прод |
| --- | --- | --- |
| `SECRET_KEY` | резервный пароль админки, соль для хешей служебных значений | обязательно |
| `GAME_SIGNING_KEY` | HMAC-ключ билетов игровых сессий | обязательно, отдельно от `SECRET_KEY` |
| `GAME_SIGNING_TTL` | срок жизни билета, секунды | `1800` |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | вход в админку | обязательно |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile | обязательно |
| `TURNSTILE_REQUIRED` | `1` — капча обязательна (fail-closed) | `1` |
| `TRUSTED_PROXY` | `1` — доверять `X-Forwarded-For` (Render/Cloudflare) | `1` |
| `REGISTER_RATE` / `REGISTER_NAME_RATE` | лимиты регистрации | по умолчанию |
| `ADMIN_LOGIN_RATE` | попыток входа в админку / 15 мин | `6` |
| `BUCKET_RATE` / `BUCKET_BURST` | токен-бакет наград | `2` / `10` |
| `ANOMALY_EVENTS_PER_MIN` / `ANOMALY_COINS_PER_MIN` | пороги аномалий | `90` / `900` |
| `ANOMALY_MIN_INTERVAL` / `ANOMALY_STRIKE_LIMIT` | человеческий темп / эскалация | `0.35` / `3` |
| `RATE_SOCKET_FACTOR` | во сколько раз потолок по сокету выше лимита по IP | `6` |
| `DATABASE_URL` / `DB_POOL_SIZE` | PostgreSQL | обязательно / `5` |

---

## 7. Что делать при инциденте (короткая памятка)

1. **Ротация:** `GAME_SIGNING_KEY` (инвалидирует все билеты) и
   `SECRET_KEY`/`ADMIN_PASSWORD` → рестарт. Сессии в БД удалить
   (`DELETE FROM sessions`) — это разлогинит всех, включая атакующего.
2. **Остановка утечки:** заблокировать ник/диапазон IP в админке, включить
   Cloudflare «Under Attack» на 15 минут для конкретных путей.
3. **Оценка ущерба:** `SELECT * FROM transactions WHERE created_at > …` +
   `admin_log` (события `anomaly`, `bad_ticket`) + `game_receipts` по подозрительным
   `ref`. Откат — компенсирующие транзакции с `kind='correction'`, не UPDATE
   баланса.
4. **Починка:** воспроизвести атаку тестом в `tools/test_anticheat.py`, только
   потом менять код — иначе она вернётся.
5. **Разбор:** короткий post-mortem в `docs/`, добавить пункт в чек-лист выше.
