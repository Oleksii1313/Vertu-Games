# Отчёт: смена ника за V, звуки Flappy Bird, мобильный обзор MiniCraft

Дата: 2026-11-11 · ветка `arena/3f3c13fc-vertu-games` (от `main` `08014b5`)

Работа сделана без пересборки сайта: дизайн, брендинг, аккаунты, валюта, игры и
прогресс не тронуты. Все суммы, лимиты и цены существующих предметов остались
прежними.

---

## 1. Магазин: услуга «Смена ника» — 1000 V

### Что добавлено

| Слой | Что сделано |
| --- | --- |
| `game_catalog.py` | предмет `username_change` (`kind: 'service'`, 1000 V, `order: 40`), вид `service` в `SHOP_KINDS` |
| `db.py` | `rename_user()` — одна транзакция: блокировка пользователя → проверки (`SameUsername`, `DuplicateUser`, `valid_username`) → списание через `_apply_delta(-1000, 'shop', ref='rename:{uid}:{key}')` → `UPDATE users SET username, username_key`; при нехватке монет откат целиком |
| `shop.py` | `USERNAME_ITEM`, `USERNAME_PRICE`, `username_item()`, `rename()` (цена берётся из каталога, а не из клиента) |
| `server.py` | `POST /api/shop/rename` под `@login_required`, rate-limit `shop_rename` 10/600 с, коды `BAD_NAME` / `SAME_NAME` / `NAME_TAKEN` / `NO_FUNDS` / `RATE_LIMIT` |
| `tools/build_platform.py` | раздел «Услуги», карточка с `data-rename`, пояснение, строка `/api/shop/rename` в таблице API |
| `assets/vg/js/shop.js` | кнопка услуги всегда активна (услуга не «покупается навсегда»), окно ввода, локальная валидация, блокировка кнопки на время запроса, перевод серверных ошибок по коду, перерисовка при смене языка |
| `assets/vg/js/platform.js` | `VG.rename()` → `POST /api/shop/rename`, обновление пользователя и баланса, достижения |
| `assets/vg/css/platform.css` | стили окна `.vg-rename-*` |

### Деньги и атомарность

* Цену задаёт только сервер (`SHOP_ITEMS`), клиент её не присылает.
* Списание и переименование — в одной транзакции с `FOR UPDATE` по пользователю:
  при `InsufficientFunds` не меняется ни ник, ни баланс.
* Повторный клик/повторный запрос с тем же ником → `SAME_NAME` без списания,
  поэтому двойное списание невозможно.
* В журнале ровно одна запись `-1000` с `reference_id`.

### Переводы

Название, описание, кнопка, чип раздела, пояснение и окно (заголовок, подпись
поля, подсказка, «Отмена», «Сменить за 1 000 V», все ошибки) имеют пары RU/EN.
Смена языка обновляет и карточку, и уже открытое окно — без перезагрузки.

---

## 2. Flappy Bird: звуки

* `assets/vg/js/sfx.js` — новые эффекты поверх существующего синтезатора:
  `flap()` (короткий восходящий тон), `score()` (два чистых тона), `hit()`
  (удар), `over()` (нисходящая фраза), `start()` (восходящее арпеджио).
  Никаких mp3, никакого наложения: каждый эффект — одна короткая осцилляция.
* `games/flappy.html` — звук на взмахе, на очке за трубу, на столкновении,
  на конце партии (через 200 мс после удара) и на «Играть снова».
* Кнопка «звук» в панели статистики: `aria-pressed`, иконки вкл/выкл,
  состояние в `localStorage['vg.sfx']`, переживает перезагрузку. Контекст
  аудио создаётся только по жесту игрока (политика браузеров), геймплей,
  сложность и управление не менялись.

---

## 3. MiniCraft 3D: мобильный обзор и полный экран

Правки в `games/minicraft.html` (описаны в
`docs/REPORT-2026-11-11-minicraft-mobile-look.md` и покрыты
`tools/test_minicraft_touch.js`): разделение области обзора и джойстика по
половинам экрана (`mcxLookSplit`), `touch-action`/pointer events с захватом
пальца, полный экран по жесту (`mcxFs*`), подгонка под вьюпорт и DPR
(`mcxStage`, `mcxFitViewport`, `mcxApplyDpr`), защита от back-жеста
(`mcxHistoryGuard`). Поворот камеры не двигает персонажа: движение читается
только с левой половины.

---

## 4. Проверки (фактические прогоны)

| Тест | Результат |
| --- | --- |
| `python -m unittest tools.test_username_change` | **10/10 OK** |
| `python -m unittest tools.test_shop_rename_ui` | **10/10 OK** |
| `node tools/test_shop_rename_client.js` | **28/28** |
| `node tools/test_flappy_sound.js` | **22/22** |
| `node tools/test_flappy_portrait.js` | **22/22** |
| `node tools/test_minicraft_touch.js` | **66/66** |
| `node tools/test_minicraft_world/visual/npc/npc_motion` | 90 / 56 / 43 / 17 — OK |
| `node tools/test_game_boot.js` | **59/59** |
| `node tools/test_mobile_layout.js` | **36/36** |
| `python tools/check_platform.py` | **261/261** (живой сервер, включая полный путь смены ника) |
| `python tools/build_platform.py --check` | «всё актуально» |

Что именно проверяет `check_platform.py` по смене ника (на запущенном сервере,
через HTTP): услуга в каталоге за 1000 V и `owned: false`; отказ на текущий ник;
занятый ник → 409; некорректный ник → 400; без денег → 402 и баланс не меняется;
успешная смена списывает ровно 1000 V; повторный клик не списывает второй раз;
старый ник больше не пускает, новый пускает и баланс сохраняется; в журнале
ровно одно списание `-1000`.

Клиентский тест магазина (`test_shop_rename_client.js`) работает с настоящими
`shop.html`, `platform.js`, `shop.js` в jsdom: открытие окна, переключение языка
на лету (включая текст ошибки), локальная валидация без запроса, ровно один
POST при двойном клике, обработка 402, закрытие по Esc и по фону.

### Как запускать

```bash
/tmp/venv/bin/python -m unittest tools.test_username_change tools.test_shop_rename_ui -v
NODE_PATH=/tmp/dom/node_modules node tools/test_shop_rename_client.js
NODE_PATH=/tmp/dom/node_modules node tools/test_flappy_sound.js
VERT_DB=/tmp/check.sqlite3 /tmp/venv/bin/python tools/check_platform.py
python tools/build_platform.py --check
```

---

## 5. Что осталось за рамками автоматических тестов

Браузер (Chromium/Playwright) в этой среде недоступен, поэтому жесты и звук
проверены автотестами на уровне DOM/движка и требуют финального взгляда на
устройстве:

1. Телефон: обзор правой половиной — персонаж стоит, крутится только вид;
   джойстик слева — камера не прыгает; одновременно движение + обзор.
2. Fullscreen по кнопке: окно заполняет экран, поворот экрана не ломает размеры,
   свайп не закрывает игру.
3. Магазин: покупка «Смена ника» с 1500 V, отказ при 900 V, обновление страницы
   и повторный вход под новым ником.
4. Flappy: пять звуков и кнопка mute на телефоне после первого тапа.
