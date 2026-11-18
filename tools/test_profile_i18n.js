#!/usr/bin/env node
/*
 * Профиль на двух языках (RU/EN).
 *
 * Проверяем не только статическую разметку, но и то, что собирается из ответа
 * API: статистику, историю операций, достижения, казино, задания, инвентарь,
 * бейдж администратора и выбор оформления. Главное требование — при EN в
 * профиле не остаётся русских подписей, а при переключении языка страница
 * перерисовывается без перезагрузки и без повторных запросов к серверу.
 * Ники, названия игр (по каталогу) и заметки администратора — это данные,
 * их не переводим: в фикстуре они латинские, кроме свободного комментария.
 *
 *     NODE_PATH=/tmp/dom/node_modules node tools/test_profile_i18n.js
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const PAGE = 'profile.html';

let passed = 0;
const failures = [];
function check(name, ok, extra) {
  if (ok) passed++;
  else failures.push(name + (extra === undefined ? '' : ' → ' + JSON.stringify(extra).slice(0, 300)));
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* --------------------------------------------------------------- фикстуры API */
const NOW = Math.floor(Date.now() / 1000);
const USER = {
  username: 'PixelFox', coins: 1234, avatar: 'av:fox', color: 'col:teal',
  title: 't:vet', isAdmin: true, created: NOW - 40 * 86400
};
const ME = {
  ok: true,
  user: USER,
  level: { level: 7 },
  stats: { games: 42, casino: { bets: 5, staked: 100, won: 160, best: 120 } },
  achievements: [
    { icon: 'spark', name_ru: 'Добро пожаловать', name_en: 'Welcome', desc_ru: 'Первый вход в аккаунт',
      desc_en: 'First sign-in', coins: 50, unlocked: NOW - 30 * 86400 },
    { icon: 'play', name_ru: 'Первый запуск', name_en: 'First launch', desc_ru: 'Сыграйте в любую игру',
      desc_en: 'Play any game', coins: 25, unlocked: NOW - 20 * 86400 }
  ],
  ledger: [
    { kind: 'welcome', reason: 'Приветственный бонус', delta: 50, balance: 50, created: NOW - 3600 },
    { kind: 'game', reason: 'Игра: Космокухня', delta: 5, balance: 55, created: NOW - 3000 },
    { kind: 'game', reason: 'Snake: 3 обычных и 1 золотых яблок', delta: 9, balance: 64, created: NOW - 2600 },
    { kind: 'game', reason: 'С MiniCraft: 24 монет', delta: 72, balance: 136, created: NOW - 2000 },
    { kind: 'game', reason: 'Космокухня: 12 ед. × 5 V', delta: 60, balance: 196, created: NOW - 1500 },
    { kind: 'casino', reason: 'Ставка: slots', delta: -20, balance: 176, created: NOW - 1200 },
    { kind: 'casino-win', reason: 'Выигрыш: wheel', delta: 40, balance: 216, created: NOW - 1100 },
    { kind: 'achievement', reason: 'Достижение: Добро пожаловать', delta: 50, balance: 266, created: NOW - 900 },
    { kind: 'task', reason: 'Задание #3: награда', delta: 60, balance: 326, created: NOW - 600 },
    { kind: 'shop', reason: 'Бонус: Ракета', delta: 100, balance: 426, created: NOW - 300 },
    { kind: 'admin', reason: 'Изменение администратора', delta: 10, balance: 436, created: NOW - 120 }
  ],
  purchases: [
    { item_id: 'av:fox', name_ru: 'Лис', name_en: 'Fox', icon: 'fox', price: 100, created: NOW - 400 }
  ],
  tasks: [
    { id: 3, title: 'Сыграйте 3 раза', title_en: 'Play 3 times', description: 'Любая игра',
      desc_en: 'Any game', target_value: 3, progress: 3, reward: 60, claimed: false },
    { id: 4, title: 'Сделайте ставку', title_en: 'Place a bet', description: 'В казино',
      desc_en: 'In the casino', target_value: 1, progress: 0, reward: 30, claimed: false }
  ]
};
const CASINO_HISTORY = {
  ok: true,
  items: [
    { game: 'slots', stake: 20, payout: 40, outcome: 'x2', created: NOW - 1200 },
    { game: 'wheel', stake: 15, payout: 0, outcome: 'x0', created: NOW - 1100 }
  ],
  stats: { bets: 2, staked: 35, won: 40, net: 5 }
};
const SHOP = {
  ok: true,
  items: [
    { id: 'av:fox', kind: 'avatar', name_ru: 'Лис', name_en: 'Fox', price: 100, icon: 'fox', owned: true, equipped: true },
    { id: 'av:rocket', kind: 'avatar', name_ru: 'Ракета', name_en: 'Rocket', price: 0, icon: 'rocket', owned: true, equipped: false },
    { id: 'col:teal', kind: 'color', name_ru: 'Бирюзовый', name_en: 'Teal', price: 0, payload: 'col:teal', owned: true, equipped: true },
    { id: 't:vet', kind: 'title', name_ru: 'Ветеран', name_en: 'Veteran', price: 150, owned: true, equipped: true },
    { id: 't:ace', kind: 'title', name_ru: 'Ас', name_en: 'Ace', price: 400, owned: false, equipped: false }
  ]
};
const SESSION = { ok: true, user: USER, csrf: 'test', captcha: { enabled: false }, achievements: 3, games: [] };

/* ----------------------------------------------------------- локальный сервер */
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.json': 'application/json'
};
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('404'); return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

function response(body, status) {
  return {
    ok: (status || 200) < 400,
    status: status || 200,
    headers: { get: () => 'application/json; charset=utf-8' },
    json: () => Promise.resolve(body)
  };
}

/* Открытие профиля: fetch подменяется фикстурами, запросы считаются. */
function openProfile(opts) {
  const options = opts || {};
  const calls = [];
  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', (e) => {
    if (!/Not implemented|navigation|Could not parse CSS|Could not load (link|script)/i.test(e.message)) {
      errors.push(e.message.slice(0, 120));
    }
  });
  vc.on('error', (...args) => errors.push('[error] ' + args.join(' ').slice(0, 120)));
  const dom = new JSDOM(fs.readFileSync(path.join(ROOT, PAGE), 'utf8'), {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    url: options.base + '/' + PAGE, virtualConsole: vc,
    beforeParse(window) {
      if (options.stored) { try { window.localStorage.setItem('vg_lang', options.stored); } catch (e) {} }
      window.fetch = (url) => {
        const pathname = String(url).split('?')[0];
        calls.push(pathname);
        if (options.offline) return Promise.reject(new Error('offline'));
        if (pathname === '/api/session') return Promise.resolve(response(options.session || SESSION));
        if (pathname === '/api/me') {
          if (options.unauth) return Promise.resolve(response({ ok: false, msg: 'Нужен вход', code: 'AUTH' }, 401));
          return Promise.resolve(response(ME));
        }
        if (pathname === '/api/shop') return Promise.resolve(response(SHOP));
        if (pathname === '/api/casino/history') return Promise.resolve(response(CASINO_HISTORY));
        if (pathname === '/api/music') return Promise.resolve(response({ ok: true, tracks: [] }));
        return Promise.resolve(response({ ok: true }));
      };
    }
  });
  return { dom, calls, errors };
}

const CYRILLIC = /[\u0400-\u04FF]/;
function textOf(w, selector) {
  const node = w.document.querySelector(selector);
  return node ? node.textContent.replace(/\s+/g, ' ').trim() : '';
}
function hasCyrillic(w, selector) {
  const text = textOf(w, selector);
  const match = text.match(CYRILLIC);
  return match ? text.slice(Math.max(0, match.index - 40), match.index + 40) : '';
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;

  /* ------------------------------------------------ 1. русская страница */
  {
    const { dom, errors, calls } = openProfile({ base });
    const w = dom.window;
    await wait(600);
    check('RU: страница загрузилась без ошибок JS', errors.length === 0, errors.slice(0, 2));
    check('RU: профиль отрисован (виден #profileBody)', !w.document.getElementById('profileBody').classList.contains('hidden'));
    check('RU: заголовки таблицы по-русски',
      /Операция/.test(textOf(w, '#ledgerBody')) && /Сумма/.test(textOf(w, '#ledgerBody')) &&
      /Баланс/.test(textOf(w, '#ledgerBody')) && /Когда/.test(textOf(w, '#ledgerBody')),
      textOf(w, '#ledgerBody').slice(0, 120));
    check('RU: причина операции по-русски', /Приветственный бонус/.test(textOf(w, '#ledgerBody')));
    check('RU: история ставок загружена (а не «войдите»)', /Слоты/.test(textOf(w, '#casinoBody')) &&
      !/Войдите/.test(textOf(w, '#casinoBody')), textOf(w, '#casinoBody').slice(0, 140));
    check('RU: счётчики казино из stats.casino', /Ставок в казино/.test(textOf(w, '#profStats')) &&
      /Лучший выигрыш/.test(textOf(w, '#profStats')), textOf(w, '#profStats').slice(0, 160));
    check('RU: задания по-русски', /Сыграйте 3 раза/.test(textOf(w, '#tasksBody')));
    check('RU: инвентарь по-русски', /Лис/.test(textOf(w, '#itemsBody')));
    check('RU: бейдж администратора', /Администратор/.test(textOf(w, '#profAdminBadge')));
    check('RU: заголовок вкладки с ником', /PixelFox/.test(w.document.title), w.document.title);
    check('RU: ник не переводится', /PixelFox/.test(textOf(w, '#profName')));
    check('RU: титул переведён («Ветеран»)', /Ветеран/.test(textOf(w, '#profName')), textOf(w, '#profName'));

    /* ------------------------------- 2. переключение на английский без перезагрузки */
    const before = calls.length;
    w.VG.setLang('en');
    await wait(200);
    check('EN: язык документа переключён', w.document.documentElement.getAttribute('lang') === 'en');
    check('EN: смена языка не ходит на сервер повторно', calls.length === before, calls.slice(before));
    const ling = hasCyrillic(w, '#profileBody');
    check('EN: в профиле нет кириллицы', !ling, ling);
    check('EN: заголовки таблицы по-английски',
      /Operation/.test(textOf(w, '#ledgerBody')) && /Amount/.test(textOf(w, '#ledgerBody')) &&
      /Balance/.test(textOf(w, '#ledgerBody')) && /When/.test(textOf(w, '#ledgerBody')),
      textOf(w, '#ledgerBody').slice(0, 140));
    const ledger = textOf(w, '#ledgerBody');
    check('EN: «Приветственный бонус» → Welcome bonus', /Welcome bonus/.test(ledger));
    check('EN: «Игра: Космокухня» → Game: Cosmic Kitchen', /Game: Cosmic Kitchen/.test(ledger), ledger.slice(0, 200));
    check('EN: единицы события переведены', /Cosmic Kitchen: 12 units × 5 V/.test(ledger));
    check('EN: Snake переведён', /Snake: 3 apples and 1 golden apple/.test(ledger));
    check('EN: MiniCraft переведён', /From MiniCraft: 24 coins/.test(ledger));
    check('EN: ставка и выигрыш казино переведены', /Bet: Slots/.test(ledger) && /Win: Wheel/.test(ledger));
    check('EN: достижение переведено по каталогу', /Achievement: Welcome/.test(ledger));
    check('EN: задание переведено', /Quest #3: reward/.test(ledger));
    check('EN: бонус магазина переведён', /Bonus: Rocket/.test(ledger));
    check('EN: изменение администратора переведено', /Admin adjustment/.test(ledger));
    check('EN: статистика по-английски', /Balance/.test(textOf(w, '#profStats')) &&
      /Games played/.test(textOf(w, '#profStats')) && /Best win/.test(textOf(w, '#profStats')),
      textOf(w, '#profStats').slice(0, 200));
    check('EN: достижения по-английски', /Welcome/.test(textOf(w, '#achBody')) && /First sign-in/.test(textOf(w, '#achBody')),
      textOf(w, '#achBody').slice(0, 160));
    check('EN: казино по-английски', /Slots/.test(textOf(w, '#casinoBody')) && /stake/.test(textOf(w, '#casinoBody')),
      textOf(w, '#casinoBody').slice(0, 160));
    check('EN: задания по-английски', /Play 3 times/.test(textOf(w, '#tasksBody')));
    check('EN: инвентарь по-английски', /Fox/.test(textOf(w, '#itemsBody')) && !CYRILLIC.test(textOf(w, '#itemsBody')));
    check('EN: бейдж администратора по-английски', /Administrator/.test(textOf(w, '#profAdminBadge')));
    check('EN: титул по-английски', /Veteran/.test(textOf(w, '#profName')), textOf(w, '#profName'));
    check('EN: ник остался как есть', /PixelFox/.test(textOf(w, '#profName')));
    check('EN: заголовок вкладки сохранён', /PixelFox/.test(w.document.title), w.document.title);
    check('EN: шапка сайта на английском', /Games|Catalog|Profile/.test(textOf(w, '.site-header')), textOf(w, '.site-header').slice(0, 120));

    /* ------------------------------------ 3. выбор оформления тоже переводится */
    w.document.getElementById('editProfile').click();
    await wait(250);
    const styleRu = textOf(w, '#stylePicker');
    check('EN: подписи выбора оформления по-английски',
      /Avatar/.test(styleRu) && /Color/.test(styleRu) && /Title/.test(styleRu), styleRu.slice(0, 120));
    check('EN: варианты оформления без кириллицы', !CYRILLIC.test(styleRu), styleRu.slice(0, 160));
    const beforeTitles = calls.length;
    w.VG.setLang('ru');
    await wait(200);
    check('RU: подписи выбора оформления вернулись на русский',
      /Аватар/.test(textOf(w, '#stylePicker')) && /Цвет/.test(textOf(w, '#stylePicker')) &&
      /Титул/.test(textOf(w, '#stylePicker')), textOf(w, '#stylePicker').slice(0, 120));
    check('RU: перерисовка не запрашивает магазин снова', calls.length === beforeTitles, calls.slice(beforeTitles));
    check('RU: варианты оформления по-русски', /Ветеран/.test(textOf(w, '#stylePicker')));
    check('RU: после возврата заголовки таблицы снова русские', /Операция/.test(textOf(w, '#ledgerBody')));
    try { w.close(); } catch (e) {}
  }

  /* ------------------------------------------- 4. сохранённый язык после перезагрузки */
  {
    const { dom, errors } = openProfile({ base, stored: 'en' });
    const w = dom.window;
    await wait(600);
    check('EN после перезагрузки: страница сразу английская',
      w.document.documentElement.getAttribute('lang') === 'en');
    const ling = hasCyrillic(w, '#profileBody');
    check('EN после перезагрузки: кириллицы нет', !ling, ling);
    check('EN после перезагрузки: язык в localStorage', w.localStorage.getItem('vg_lang') === 'en');
    check('EN после перезагрузки: нет ошибок JS', errors.length === 0, errors.slice(0, 2));
    try { w.close(); } catch (e) {}
  }

  /* -------------------------------------------------- 5. гость и ошибка API */
  {
    const { dom } = openProfile({ base, session: { ok: true, user: null, captcha: { enabled: false } }, unauth: true });
    const w = dom.window;
    await wait(500);
    check('гость: показан блок входа', !w.document.getElementById('guestBlock').classList.contains('hidden'));
    w.VG.setLang('en');
    await wait(150);
    check('гость EN: блок входа по-английски', /Sign in to your account/.test(textOf(w, '#guestBlock')),
      textOf(w, '#guestBlock').slice(0, 120));
    check('гость EN: без кириллицы', !hasCyrillic(w, '#guestBlock'), hasCyrillic(w, '#guestBlock'));
    try { w.close(); } catch (e) {}
  }
  {
    const { dom } = openProfile({ base, session: SESSION, unauth: true });
    const w = dom.window;
    await wait(600);
    const text = textOf(w, '#profileRoot');
    check('ошибка профиля: сообщение по-русски', /Профиль недоступен/.test(text) && /В каталог/.test(text), text.slice(0, 140));
    w.VG.setLang('en');
    await wait(200);
    const en = textOf(w, '#profileRoot');
    check('ошибка профиля EN: сообщение по-английски', /Profile unavailable/.test(en) && /Back to the catalog/.test(en), en.slice(0, 160));
    check('ошибка профиля EN: без кириллицы', !hasCyrillic(w, '#profileRoot'), hasCyrillic(w, '#profileRoot'));
    try { w.close(); } catch (e) {}
  }

  server.close();
  if (failures.length) console.log('ПРОВАЛЫ:\n  ' + failures.join('\n  '));
  console.log('\nИТОГО: ' + passed + '/' + (passed + failures.length) + ' проверок пройдено');
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
