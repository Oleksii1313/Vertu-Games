#!/usr/bin/env node
/* =============================================================================
   Vert Games · магазин: окно смены ника в браузерном окружении (jsdom)
   -----------------------------------------------------------------------------
   Загружается настоящая страница shop.html со скриптами платформы и магазина,
   сеть подменена (`fetch`), поэтому проверяется именно клиентское поведение:

     1. карточка услуги существует и её кнопка активна (это услуга, не предмет);
     2. клик открывает окно, все подписи на русском;
     3. переключение языка обновляет окно и кнопку карточки сразу, без перезагрузки;
     4. пустое/короткое имя — ошибка на выбранном языке, запроса на сервер нет;
     5. подтверждение отправляет ровно один POST /api/shop/rename с именем;
     6. повторный клик во время запроса не отправляет второй запрос;
     7. отказ сервера (402 NO_FUNDS) показывается понятным текстом, кнопка снова активна;
     8. Esc и клик по фону закрывают окно;
     9. после успеха магазин перерисовывается и показывает новый баланс.

   Запуск:  NODE_PATH=/tmp/dom/node_modules node tools/test_shop_rename_client.js
   ========================================================================== */
'use strict';
let JSDOM;
try {
  ({ JSDOM } = require('jsdom'));
} catch (error) {
  console.log('SKIP: jsdom не установлен (npm install jsdom) — тест пропущен');
  process.exit(0);
}
const fs = require('fs');
const path = require('path');

function inline(file) {
  return fs.readFileSync(path.join(__dirname, '..', 'assets', 'vg', 'js', file), 'utf8');
}
function page() {
  let html = fs.readFileSync(path.join(__dirname, '..', 'shop.html'), 'utf8');
  ['catalog-data.js', 'platform.js', 'sfx.js', 'shop.js'].forEach((file) => {
    const tag = '<script src="assets/vg/js/' + file + '"></script>';
    if (html.indexOf(tag) === -1) throw new Error('нет тега скрипта: ' + file);
    // Замена через функцию: в строках скриптов есть «$$», а String.replace
    // трактует это как спец-шаблон и съедает символ.
    html = html.replace(tag, () => '<script>\n' + inline(file) + '\n</script>');
  });
  // Внешний виджет капчи в тесте не нужен.
  html = html.replace(/<script src="https:\/\/challenges\.cloudflare\.com[^>]*><\/script>/, '');
  return html;
}

let calls = [];
function makeResponse(payload, status) {
  const code = status || 200;
  return {
    ok: code < 400,
    status: code,
    headers: { get: () => 'application/json' },
    json: () => Promise.resolve(payload)
  };
}

function boot(plan) {
  calls = [];
  const dom = new JSDOM(page(), {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'http://localhost/shop.html',
    beforeParse(win) {
      win.fetch = function (url, config) {
        const body = config && config.body ? JSON.parse(config.body) : null;
        calls.push({ url: String(url), method: (config && config.method) || 'GET', body });
        const handler = plan(String(url), (config && config.method) || 'GET', body);
        return Promise.resolve(handler);
      };
      win.__errs = [];
      win.addEventListener('error', (e) => win.__errs.push(String(e.message)));
      win.requestAnimationFrame = (cb) => win.setTimeout(cb, 0);
      win.Element.prototype.scrollIntoView = function () {};
      win.Element.prototype.getBoundingClientRect = function () {
        return { width: 390, height: 844, top: 0, left: 0, right: 390, bottom: 844, x: 0, y: 0 };
      };
    }
  });
  return dom;
}

const SESSION = { ok: true, user: { id: 1, username: 'Tester', coins: 1500, avatar: null, color: null, title: null }, csrf: 'token' };
const SHOP = {
  ok: true,
  payments: { configured: false },
  items: [
    { id: 'av:rocket', kind: 'avatar', name_ru: 'Ракета', name_en: 'Rocket', price: 0, owned: true, equipped: true },
    { id: 'username_change', kind: 'service', name_ru: 'Смена ника', name_en: 'Change username', price: 1000, owned: false }
  ]
};
function me(coins, username) {
  return { ok: true, user: { username: username || 'Tester', coins }, stats: { games: 3 }, achievements: [], purchases: [] };
}
function defaultPlan(state) {
  return (url) => {
    if (url.indexOf('/api/session') === 0) return makeResponse(SESSION);
    if (url.indexOf('/api/shop/rename') === 0) {
      // Ветка смены ника проверяется раньше общего /api/shop.
      if (state.renameReply) return state.renameReply;
      return state.reply || makeResponse({ ok: true, price: 1000, balance: 500, name: state.nextName || 'Tester',
        user: { username: state.nextName || 'Tester', coins: 500 }, achievements: [] });
    }
    if (url.indexOf('/api/shop') === 0) return makeResponse(SHOP);
    if (url.indexOf('/api/me') === 0) return makeResponse(me(state.coins, state.username));
    return makeResponse({ ok: true });
  };
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log((ok ? 'PASS ' : 'FAIL ') + ' · ' + name + (detail === undefined ? '' : ' → ' + JSON.stringify(detail)));
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  /* ------------------------------------------------------- ленивый сценарий */
  const state = { coins: 1500 };
  const dom = boot(defaultPlan(state));
  const win = dom.window;
  const $ = (sel) => win.document.querySelector(sel);
  await wait(120);

  const card = $('[data-item="username_change"]');
  const button = card && card.querySelector('[data-rename]');
  check('карточка услуги найдена', !!card);
  check('кнопка услуги активна и подписана', !!button && !button.disabled && button.textContent.trim() === 'Сменить ник',
    button && button.textContent.trim());

  button.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(20);
  let overlay = $('#vgRenameOverlay');
  check('клик открывает окно смены ника', !!overlay);
  check('в окне русский заголовок', overlay && overlay.querySelector('#vgRenameTitle').textContent === 'Смена ника');
  check('поле ввода в фокусе-ready', !!overlay.querySelector('#vgRenameInput'));

  /* --------------------------------------- переключение языка без перезагрузки */
  win.VG.setLang('en');
  await wait(20);
  overlay = $('#vgRenameOverlay');
  const en = (sel) => (overlay.querySelector(sel) || {}).textContent || '';
  check('язык EN: заголовок окна', en('#vgRenameTitle') === 'Change username', en('#vgRenameTitle'));
  check('язык EN: подпись поля', en('#vgRenameLabel') === 'New username', en('#vgRenameLabel'));
  check('язык EN: кнопка отмены', en('#vgRenameCancel') === 'Cancel', en('#vgRenameCancel'));
  check('язык EN: кнопка подтверждения', /^Change for\s*1[\s\u00a0]?000 V$/.test(en('#vgRenameOk')), en('#vgRenameOk'));
  check('язык EN: подсказка переведена', /Latin letters/.test(en('#vgRenameHint')), en('#vgRenameHint').slice(0, 40));
  check('язык EN: кнопка карточки переведена', button.textContent.trim() === 'Change username', button.textContent.trim());

  /* --------------------------------------------------- локальная валидация */
  const input = overlay.querySelector('#vgRenameInput');
  const okButton = overlay.querySelector('#vgRenameOk');
  const errorBox = overlay.querySelector('#vgRenameError');
  input.value = 'ab';
  okButton.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(20);
  check('короткий ник не отправляется', calls.filter((c) => c.url.indexOf('/api/shop/rename') === 0).length === 0);
  check('ошибка показана на английском', /3–24 characters/.test(errorBox.textContent), errorBox.textContent);

  win.VG.setLang('ru');
  await wait(20);
  check('язык RU возвращается сразу', $('#vgRenameTitle').textContent === 'Смена ника',
    $('#vgRenameTitle').textContent);
  check('ошибка на русском после возврата', /от 3 до 24/.test($('#vgRenameError').textContent),
    $('#vgRenameError').textContent);

  /* ------------------------------------------------- отправка и двойной клик */
  state.nextName = 'TesterNeo';
  input.value = 'TesterNeo';
  input.dispatchEvent(new win.Event('input', { bubbles: true }));
  check('ввод очищает ошибку', errorBox.textContent === '');
  okButton.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  okButton.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(60);
  const posts = calls.filter((c) => c.url.indexOf('/api/shop/rename') === 0);
  check('отправлен ровно один запрос на сервер (двойной клик)', posts.length === 1, posts.length);
  check('в запросе ровно одно поле name', posts.length === 1 && posts[0].method === 'POST'
    && posts[0].body && posts[0].body.name === 'TesterNeo', posts[0] && posts[0].body);
  check('после успеха окно закрыто', !$('#vgRenameOverlay'));
  check('баланс в шапке обновлён', /500/.test(win.document.body.textContent), 'нет 500');

  /* ------------------------------------------------------ отказ по балансу */
  /* Сервер отвечает 402: показываем понятную фразу, окно не закрываем,
     кнопка снова активна — повтор возможен. */
  state.renameReply = makeResponse({ ok: false, code: 'NO_FUNDS', msg: 'no funds' }, 402);
  const reopen = () => {
    const cardNow = $('[data-item="username_change"]');
    cardNow.querySelector('[data-rename]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  };
  reopen();
  await wait(40);
  const input2 = $('#vgRenameInput');
  const ok2 = $('#vgRenameOk');
  check('окно открывается повторно', !!input2 && !!ok2);
  input2.value = 'NoMoneyNick';
  ok2.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(60);
  const error2 = $('#vgRenameError');
  check('402 показывается понятной фразой про 1000 V',
    !!error2 && /Недостаточно V-монет/.test(error2.textContent), error2 && error2.textContent);
  check('после отказа кнопка снова активна',
    ok2.disabled === false && /Сменить за/.test(ok2.textContent), ok2.textContent);
  check('окно не закрылось при ошибке', !!$('#vgRenameOverlay'));
  win.VG.setLang('en');
  await wait(20);
  check('серверная ошибка переводится вместе с окном',
    /Not enough V coins/.test($('#vgRenameError').textContent), $('#vgRenameError').textContent);
  win.VG.setLang('ru');
  await wait(20);

  /* ------------------------------------------------------------ закрытие окна */
  win.document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await wait(20);
  check('Esc закрывает окно', !$('#vgRenameOverlay'));

  reopen();
  await wait(40);
  const overlay3 = $('#vgRenameOverlay');
  check('окно открылось для проверки фона', !!overlay3);
  overlay3.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(20);
  check('клик по фону закрывает окно', !$('#vgRenameOverlay'));

  const passed = results.filter((r) => r.ok).length;
  console.log('ИТОГО: ' + passed + '/' + results.length + ' проверок пройдено');
  process.exit(passed === results.length ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
