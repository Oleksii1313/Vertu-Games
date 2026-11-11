# Казино V: слоты, бонусы и магазин монет

Готовая социальная надстройка над VertGames: слоты на внутренние монеты, rewarded-реклама, ежедневный бонус, билеты розыгрыша и продажа пакетов V. **Без реальных ставок и без вывода денег** — только развлечение.

## Что добавлено

| Файл | Назначение |
| --- | --- |
| `casino.html` | Новая страница «Казино» в стиле сайта: слоты «Тройка V», ад-бонус, ежедневный бонус, билеты, витрина наград, лента операций, магазин монет |
| `casino-app.js` | Вся клиентская логика: барабаны, выплаты, начисления через `VA`, rewarded-реклама, магазин, i18n RU/EN |
| `casino_payments.py` | Серверные заказы и вебхуки ЮKassa / Stripe / CryptoBot, защита от двойного начисления |
| `tools/test_casino_payments.py` | Офлайн-тесты подписей и вебхуков (9 тестов) |
| `server.py` | Новые роуты `/api/shop/*`, вебхуки, whitelist статики |
| `index.html`, `top.html`, `roulette.html`, `admin.html` | Пункт меню «Казино», кнопка на главной, блок на рулетке, баннер в топе |
| `tools/build_info_pages.py` → `privacy.html` | Новый раздел о казино, рекламе и покупках |

Монетка везде — **тот же `coin.svg` / V-иконка**, что уже была в проекте (в шапке, в ставках, в магазине).

## Быстрый старт

```bash
python3 server.py
# http://localhost:8000/casino.html
```

Ничего дополнительно ставить не нужно: страница работает от `database.js` (localStorage), реклама и оплата по умолчанию в демо-режиме. Без сервера `casino.html` тоже открывается как обычный файл — демо-оплата и слоты работают локально.

Проверка тестов:

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install requests
python3 -m unittest discover -s tools -p test_casino_payments.py -v
```

## Экономика (что подкрутить)

Всё в одном месте — объект `CONFIG` в начале `casino-app.js`:

```js
const CONFIG = {
  adProvider: 'demo',        // 'demo' | 'yandex' | 'h5games'
  adReward: 100,             // V за ролик
  adDailyLimit: 5,           // роликов в день
  yandexBlocks: { desktop: 'R-A-000000-01', touch: 'R-A-000000-02' },
  adsenseClient: 'ca-pub-0000000000000000',
  provider: 'demo',          // 'demo' | 'yookassa' | 'stripe' | 'cryptobot'
  packs: [ /* Старт / Мажор / Кит: coins, price, usd, bonus */ ],
  promos: { VERT100: 100, START500: 500, CASINO250: 250 },
  ticketsPer: 100,           // 1 билет за 100 V ставки
  dailyRewards: [100, 150, 200, 300, 500]
};
```

Таблица слотов (`SYMBOLS`): `V ×6`, `Gem ×12`, `Crown ×20`, `Star ×10`, `Spark ×5`, `Dice ×4`, `Wheel ×8`, пара символов — возврат 40 % ставки (фактически ×2 от множителя). При текущих весах математическое ожидание ≈ **0,40 ставки**, то есть 60 % ставок уходит «в казино». Хотите мягче — увеличьте `m3` у частых символов; хотите жёстче — уменьшите. RTP на бейдже считается из весов автоматически (`computeRtp()`), менять вручную не нужно.

## 1. Rewarded-реклама

Кнопка «Смотреть рекламу · +100 V» → `showRewardedAd()`. Награда начисляется **только** в колбэке успешного просмотра.

**Рекламная сеть Яндекса (РСЯ).** Создайте два блока типа *Rewarded* (десктоп и мобайл) и подставьте их id:

```js
CONFIG.adProvider = 'yandex';
CONFIG.yandexBlocks = { desktop: 'R-A-123456-01', touch: 'R-A-123456-02' };
```

`casino-app.js` сам подгрузит `context.js` и вызовет:

```js
window.yaContextCb.push(() => {
  Ya.Context.AdvManager.render({
    blockId: 'R-A-123456-01', type: 'rewarded', platform: 'desktop',
    onRewarded(isRewarded) { isRewarded ? onReward() : onSkip(); }
  });
});
```

**Google H5 Games Ads (AdSense for games).** Укажите `CONFIG.adsenseClient` и:

```js
CONFIG.adProvider = 'h5games';
```

Используется `adBreak({ type: 'reward', adViewed, adDismissed, beforeReward })` — награда только в `adViewed`.

**Важно про правила.** Рекламные сети не любят казино-контент: в правилах РСЯ площадки «имитирующие азартные игры» прямо перечислены как недопустимые, а у Google социальное казино требует отдельной сертификации. Поэтому:

- держите на странице явную формулировку «развлечение, без реальных ставок и вывода» (она уже есть в герое и футере);
- не показывайте на одной странице рекламу настоящих казино;
- перед запуском согласуйте площадку с сетью; если откажут — рекламный блок легко отключить (`adProvider: 'demo'`), весь остальной функционал продолжит работать.

## 2. Магазин монет и приём платежей

Пакеты и цены хранятся **на сервере** (`casino_payments.PACKS`) — браузер присылает только `pack: 'major'`. Локальный демо-режим включается сам, когда `SHOP_PROVIDER` не задан.

```bash
export PUBLIC_URL="https://games.example.com"

# ЮKassa (рубли, карты и СБП)
export SHOP_PROVIDER=yookassa
export YOOKASSA_SHOP_ID=123456
export YOOKASSA_SECRET_KEY=live_xxx

# или Stripe (USD)
export SHOP_PROVIDER=stripe
export STRIPE_SECRET_KEY=sk_live_xxx
export STRIPE_WEBHOOK_SECRET=whsec_xxx

# или CryptoBot (USDT/TON, fiat-счёт в рублях)
export SHOP_PROVIDER=cryptobot
export CRYPTOBOT_TOKEN=123456:AA...
```

URL вебхуков (укажите их в кабинетах провайдеров):

| Провайдер | Адрес |
| --- | --- |
| ЮKassa | `https://games.example.com/api/shop/webhook/yookassa` (событие `payment.succeeded`) |
| Stripe | `https://games.example.com/api/shop/webhook/stripe` (событие `checkout.session.completed`) |
| CryptoBot | `https://games.example.com/api/shop/webhook/cryptobot` (`invoice_paid`) |

Что уже реализовано в `casino_payments.py`:

- **ЮKassa:** создание платежа `POST /v3/payments` с `Idempotence-Key`, `metadata.order_id`, `return_url`; уведомления не подписаны, поэтому статус всегда перепроверяется через `GET /v3/payments/{id}` и сверяется сумма.
- **Stripe:** Checkout Session с `client_reference_id`; подпись `Stripe-Signature` проверяется вручную (HMAC-SHA256 по `timestamp.body`, допуск 5 минут, сравнение `compare_digest`), плюс сверка `amount_total`.
- **CryptoBot:** `createInvoice` с `payload = order_id`; подпись `crypto-pay-api-signature` = HMAC-SHA256, ключ = `SHA256(token)`; после подписи статус счёта перепроверяется через `getInvoices`.
- **Двойное начисление невозможно:** `shop_orders.status` переводится в `paid` в транзакции один раз, `shop_ledger` имеет уникальный индекс по заказу, а `POST /api/shop/claim` отдаёт монеты только один раз (`already: true` при повторе).
- Секреты читаются только из окружения, в HTML и git их нет. Пока провайдер не настроен, `/api/shop/order` отвечает `503 PAYMENTS_NOT_CONFIGURED`, а UI остаётся в демо-режиме.

Ответ на успешный заказ:

```json
{"ok": true, "orderId": "…", "redirectUrl": "https://yoomoney.ru/…", "coins": 6050, "amount": 449, "currency": "RUB"}
```

После оплаты пользователь возвращается на `casino.html?paid=1&order=…`, страница вызывает `/api/shop/claim` и начисляет монеты в локальный баланс.

## 3. Почему баланс пока локальный

`server.py` хранит только учётные записи (`AUTH_SETUP.md`), балансы живут в `database.js` → `localStorage`. Поэтому сейчас:

- сервер — источник истины по **оплате** (кто, что и за сколько купил);
- браузер — источник истины по **балансу**.

Чтобы перевести баланс на сервер, не переписывая казино, достаточно заменить слой хранения в `database.js`: `VA._store` уже переопределяемый (`load()/save(data)`). Дальше по порядку:

1. добавить в `server.py` таблицу `balances(user_id, balance)` и `POST /api/economy/adjust` с проверкой прав;
2. в `casino-app.js` заменить `VA.adjustUserBalance(...)` на вызов этого API (вся остальная логика не меняется);
3. ставки и результаты слотов считать на сервере (`/api/casino/spin`) — иначе клиент сможет «накрутить» выигрыш через консоль. В `casino_payments.py` уже есть готовая схема журнала, её можно переиспользовать.

Пока этого нет, честно считать казино **развлекательным режимом**: без реальных ставок и вывода это не нарушает правила, но и защитой от накрутки не является.

## 4. Интеграция в существующие страницы

- Меню: пункт «Казино» добавлен в `index.html`, `top.html`, `roulette.html`, `admin.html` (перед «Топ по балансу»).
- Главная: кнопка «Казино V» в hero рядом с «Запустить».
- Рулетка: блок-перелинковка «Казино V: слоты и бонусы».
- Топ: баннер «Хочешь обойти топ по балансу?».
- Магазин косметики не тронут: «Магазин монет» — отдельная секция `#shop` на странице казино.
- Google-вход: `casino.html` добавлен в `PAGES` (`google_oauth.py`) и в whitelist статики (`server.py`).

## 5. Что проверить вручную

1. `casino.html` на телефоне (390 px): шапка, барабаны, ставки, магазин.
2. Ставка списывается, выигрыш приходит после остановки барабанов, лента операций и билеты обновляются.
3. Лимит 5 роликов в день, награда только после полного просмотра.
4. Ежедневный бонус: серия растёт по дням, повторно в тот же день не выдаётся.
5. Демо-оплата: пакет «Кит» + крипта → демо-чек → монеты начислены; промокод `CASINO250` начисляет 250 V.
6. Боевой режим: `SHOP_PROVIDER=yookassa` + тестовый магазин ЮKassa → оплата → возврат → монеты начислены один раз.
