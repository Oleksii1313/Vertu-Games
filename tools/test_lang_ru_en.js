#!/usr/bin/env node
/*
 * Языков платформы два — русский и английский. Этот тест пришёл на смену
 * трём литовским (test_platform_lt, test_games_i18n_lt, test_catalog_lt) и
 * проверяет, что литовского не осталось нигде:
 *
 *  1. в коде платформы: LANGS = ['ru','en'], нет name_lt / data-lt / ACH_LT,
 *     третьего аргумента у T() и литовских форм множественного числа;
 *  2. в собранных страницах: нет атрибутов data-*-lt, нет кнопки LT,
 *     переключатель языка содержит ровно RU и EN;
 *  3. в поведении: setLang('en') сохраняется в localStorage и переживает
 *     перезагрузку, setLang('lt') отклоняется, а сохранённый lt мигрирует в ru;
 *  4. в каталоге (catalog-data.js) нет полей *_lt;
 *  5. в играх: рантайм переводов не принимает ?lang=lt и не ищет data-*-lt.
 *
 *     NODE_PATH=/tmp/dom/node_modules node tools/test_lang_ru_en.js
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const PAGES = ['index.html', 'top.html', 'shop.html', 'casino.html', 'roulette.html',
  'profile.html', 'login.html', 'about.html', 'support.html', 'privacy.html', 'api.html', 'admin.html'];

let passed = 0;
const failures = [];
function check(name, ok, extra) {
  if (ok) passed++;
  else failures.push(name + (extra === undefined ? '' : ' → ' + JSON.stringify(extra)));
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('404'); return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

/* ------------------------------------------------------------ 1. исходники */
const platformFile = fs.readFileSync(path.join(ROOT, 'assets/vg/js/platform.js'), 'utf8');
check('platform.js: два языка в LANGS', /var LANGS = \['ru', 'en'\];/.test(platformFile));
check('platform.js: нет литовской локали', !/lt-LT/.test(platformFile));
check('platform.js: нет ACH_LT', !/ACH_LT/.test(platformFile));
check('platform.js: нет name_lt', !/name_lt/.test(platformFile));
check('platform.js: нет data-lt', !/data-lt/.test(platformFile));
check('platform.js: нет кнопки LT', !/data-lang="lt"/.test(platformFile));
check('platform.js: нет литовского плюрализатора', !/pluralLt|agoLt/.test(platformFile));
check('platform.js: нет литовских подписей навигации', !/Pradžia|Žaidimai|Kazino|Parduotuvė|Profilis/.test(platformFile));
const ltRefs = platformFile.split('\n').filter((line) => /'lt'/.test(line));
check('platform.js: упоминание lt только в миграции', ltRefs.length === 1 && /vg_lang|saved === 'lt'/.test(ltRefs[0] || ''),
  ltRefs);

const otherScripts = fs.readdirSync(path.join(ROOT, 'assets/vg/js'))
  .filter((name) => name.endsWith('.js') && name !== 'catalog-data.js' && name !== 'platform.js');
const ltInScripts = [];
otherScripts.forEach((name) => {
  const src = fs.readFileSync(path.join(ROOT, 'assets/vg/js', name), 'utf8');
  src.split('\n').forEach((line, index) => {
    if (/=== 'lt'|name_lt|long_lt|cat_lt|how_lt|controls_lt|desc_lt|lt-LT|data-[a-z-]+-lt=/.test(line)) {
      ltInScripts.push(name + ':' + (index + 1));
    }
  });
});
check('остальные скрипты платформы без LT', ltInScripts.length === 0, ltInScripts.slice(0, 6));

/* --------------------------------------------------------- 2. каталог и сборка */
const catalogData = fs.readFileSync(path.join(ROOT, 'assets/vg/js/catalog-data.js'), 'utf8');
check('catalog-data.js: нет полей *_lt', !/_lt\b/.test(catalogData));
check('catalog-data.js: категории без lt', !/lt:\s*'/.test(catalogData));

const builtLt = [];
PAGES.forEach((page) => {
  const src = fs.readFileSync(path.join(ROOT, page), 'utf8');
  if (/data-[a-z-]+-lt=/.test(src)) builtLt.push(page + ': data-*-lt');
  if (/data-lang="lt"/.test(src)) builtLt.push(page + ': кнопка LT');
  if (/lt-LT/.test(src)) builtLt.push(page + ': lt-LT');
});
check('собранные страницы без LT-разметки', builtLt.length === 0, builtLt);

const gameLt = [];
fs.readdirSync(path.join(ROOT, 'games')).filter((n) => n.endsWith('.html')).forEach((name) => {
  const src = fs.readFileSync(path.join(ROOT, 'games', name), 'utf8');
  const runtime = (src.match(/<script id="game-i18n-runtime">[\s\S]*?<\/script>/) || [''])[0];
  const bad = runtime.split('\n').filter((line) => /'lt'/.test(line) && !/saved === 'lt'/.test(line));
  if (bad.length) gameLt.push(name + ': ' + bad[0].trim().slice(0, 60));
  if (/data-[a-z-]+-lt=/.test(src)) gameLt.push(name + ': data-*-lt');
});
check('игры: рантайм не принимает LT', gameLt.length === 0, gameLt.slice(0, 6));

/* --------------------------------------------------- 3. поведение в браузере */
function open(base, page, stored) {
  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', (e) => {
    if (!/Not implemented|navigation|resource|Could not parse CSS|Could not load (link|script)/i.test(e.message)) {
      errors.push(e.message.slice(0, 90));
    }
  });
  const dom = new JSDOM(fs.readFileSync(path.join(ROOT, page), 'utf8'), {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    url: base + '/' + page, virtualConsole: vc,
    beforeParse(window) {
      window.fetch = () => Promise.reject(new Error('offline'));
      if (stored) { try { window.localStorage.setItem('vg_lang', stored); } catch (e) {} }
    },
  });
  return { dom, errors };
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;

  for (const page of PAGES) {
    const { dom, errors } = open(base, page);
    const w = dom.window;
    await wait(450);
    check(page + ': страница открылась без ошибок JS', errors.length === 0, errors.slice(0, 2));
    check(page + ': VG.LANGS = [ru, en]',
      JSON.stringify(w.VG && w.VG.LANGS) === JSON.stringify(['ru', 'en']), w.VG && w.VG.LANGS);

    const buttons = [...w.document.querySelectorAll('.site-header [data-lang]')]
      .map((node) => node.getAttribute('data-lang'));
    check(page + ': в переключателе только RU и EN',
      buttons.length === 2 && buttons.indexOf('lt') === -1, buttons);
    check(page + ': кнопки подписаны RU и EN',
      [...w.document.querySelectorAll('.site-header [data-lang]')]
        .map((n) => n.textContent.trim()).join('/') === 'RU/EN',
      [...w.document.querySelectorAll('.site-header [data-lang]')].map((n) => n.textContent.trim()));

    // Переключение на английский и сохранение выбора.
    try { w.VG.setLang('en'); } catch (e) { check(page + ': setLang доступен', false, String(e.message)); }
    await wait(160);
    check(page + ': <html lang="en"> после переключения',
      w.document.documentElement.getAttribute('lang') === 'en',
      w.document.documentElement.getAttribute('lang'));
    check(page + ': выбор сохранён в localStorage',
      w.localStorage.getItem('vg_lang') === 'en', w.localStorage.getItem('vg_lang'));

    // Литовский больше не язык платформы: запрос отклоняется в пользу русского.
    w.VG.setLang('lt');
    await wait(120);
    check(page + ': setLang("lt") переключает на русский',
      w.document.documentElement.getAttribute('lang') === 'ru',
      w.document.documentElement.getAttribute('lang'));
    check(page + ': setLang("lt") не пишет lt в localStorage',
      w.localStorage.getItem('vg_lang') !== 'lt', w.localStorage.getItem('vg_lang'));
    try { w.close(); } catch (e) {}
  }

  // Перезагрузка с сохранённым LT: страница должна открыться по-русски.
  for (const page of ['index.html', 'top.html', 'profile.html']) {
    const { dom } = open(base, page, 'lt');
    const w = dom.window;
    await wait(420);
    check(page + ': сохранённый lt мигрирует в ru',
      w.document.documentElement.getAttribute('lang') === 'ru',
      w.document.documentElement.getAttribute('lang'));
    check(page + ': после миграции в localStorage ru',
      w.localStorage.getItem('vg_lang') === 'ru', w.localStorage.getItem('vg_lang'));
    try { w.close(); } catch (e) {}
  }

  // Перезагрузка с сохранённым EN: выбор языка не сбрасывается.
  const en = open(base, 'index.html', 'en');
  await wait(420);
  check('index.html: сохранённый en применяется после открытия',
    en.dom.window.document.documentElement.getAttribute('lang') === 'en',
    en.dom.window.document.documentElement.getAttribute('lang'));
  check('index.html: перевод на английский реально применён',
    /Games/.test(en.dom.window.document.querySelector('.site-header').textContent),
    en.dom.window.document.querySelector('.site-header').textContent.replace(/\s+/g, ' ').slice(0, 80));
  try { en.dom.window.close(); } catch (e) {}

  // Игра в iframe получает LT-параметр — рендерится по-русски.
  {
    const vc = new VirtualConsole();
    const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'games', 'snake.html'), 'utf8'), {
      runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
      url: base + '/games/snake.html?lang=lt', virtualConsole: vc,
      beforeParse(window) { window.fetch = () => Promise.reject(new Error('offline')); },
    });
    await wait(400);
    check('игра: ?lang=lt не включает литовский',
      dom.window.document.documentElement.getAttribute('lang') === 'ru',
      dom.window.document.documentElement.getAttribute('lang'));
    try { dom.window.close(); } catch (e) {}
  }

  server.close();
  if (failures.length) console.log('ПРОВАЛЫ:\n  ' + failures.join('\n  '));
  console.log('ИТОГО: ' + passed + '/' + (passed + failures.length) + ' проверок пройдено');
  process.exit(failures.length ? 1 : 0);
})();
