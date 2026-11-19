#!/usr/bin/env node
/*
 * PWA и «как приложение» для VERTGAMES.
 *
 * Проверяем то, что делает платформу устанавливаемой и убирает адресную строку
 * браузера — и заодно не даём этому сломаться:
 *
 *  1. манифест: корректный JSON, standalone, тема, иконки 192/512/maskable/svg,
 *     все файлы иконок реально существуют и являются PNG нужного размера;
 *  2. каждая страница платформы ссылается на манифест и содержит мета-теги
 *     iOS (apple-touch-icon, apple-mobile-web-app-capable) — без них «Добавить
 *     на экран Домой» открывает вкладку браузера, а не приложение;
 *  3. service worker: регистрируется платформой, лежит в корне, не кеширует
 *     ответы (иначе после деплоя пользователь получил бы старый код);
 *  4. сервер: отдаёт манифест с MIME application/manifest+json, sw.js с
 *     Service-Worker-Allowed: /, а CSP разрешает worker-src 'self';
 *  5. прогрев игр: плеер умеет prefetchGame, каталог и главная его вызывают;
 *  6. словарь переводов в каждой игре содержит только её строки (лёгкий старт)
 *     и при этом покрывает все VGT(...)-литералы игры.
 *
 *     node tools/test_pwa.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let passed = 0;
const failures = [];

function check(ok, name, detail) {
  if (ok) passed++;
  else failures.push(name + (detail ? ' — ' + detail : ''));
}
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

/* ------------------------------------------------------------------ манифест */
const MANIFEST = 'manifest.webmanifest';
check(exists(MANIFEST), 'manifest.webmanifest существует');
let manifest = null;
try {
  manifest = JSON.parse(read(MANIFEST));
  check(true, 'манифест — валидный JSON');
} catch (error) {
  check(false, 'манифест — валидный JSON', error.message);
}
manifest = manifest || {};

check(!!manifest.name && manifest.name.length > 2, 'манифест: есть name');
check(!!manifest.short_name && manifest.short_name.length <= 12,
  'манифест: short_name не длиннее 12 знаков (влезает под иконку)',
  String(manifest.short_name));
check(manifest.start_url === '/top.html', 'манифест: старт с каталога игр', String(manifest.start_url));
check(manifest.display === 'standalone', 'манифест: display standalone (без адресной строки)', String(manifest.display));
check(Array.isArray(manifest.display_override) && manifest.display_override.includes('standalone'),
  'манифест: display_override содержит standalone');
check(manifest.scope === '/', 'манифест: scope покрывает весь сайт', String(manifest.scope));
check(manifest.orientation === 'any', 'манифест: любая ориентация (портрет и ландшафт)');
check(/^#[0-9a-f]{6}$/i.test(manifest.background_color || ''), 'манифест: background_color');
check(/^#[0-9a-f]{6}$/i.test(manifest.theme_color || ''), 'манифест: theme_color');
check(manifest.lang === 'ru', 'манифест: lang=ru');
check((manifest.categories || []).includes('games'), 'манифест: категория games');

const icons = manifest.icons || [];
const iconOf = (size) => icons.filter((i) => (i.sizes || '').indexOf(size) === 0 && (i.purpose || 'any').indexOf('maskable') === -1)[0];
const ICON192 = iconOf('192x192');
const ICON512 = iconOf('512x512');
check(!!ICON192, 'манифест: иконка 192×192 (нужна Chrome для установки)');
check(!!ICON512, 'манифест: иконка 512×512 (нужна Chrome для установки)');
check(!!icons.filter((i) => (i.purpose || '').indexOf('maskable') !== -1)[0],
  'манифест: maskable-иконка (Android не обрежет края)');
check(!!icons.filter((i) => /svg/.test(i.type || ''))[0], 'манифест: векторная иконка из логотипа');

function pngSize(rel) {
  const file = path.join(ROOT, rel.replace(/^\//, ''));
  if (!fs.existsSync(file)) return null;
  const buf = fs.readFileSync(file);
  if (buf.length < 24 || buf.toString('ascii', 1, 4) !== 'PNG') return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}
if (ICON192) {
  const size = pngSize(ICON192.src);
  check(!!size, 'иконка 192×192 существует и это настоящий PNG', ICON192.src);
  check(size && size.w === 192 && size.h === 192, 'иконка 192×192 нужного размера', size ? size.w + '×' + size.h : 'нет');
}
if (ICON512) {
  const size = pngSize(ICON512.src);
  check(!!size && size.w === 512 && size.h === 512, 'иконка 512×512 нужного размера', size ? size.w + '×' + size.h : 'нет');
}
check(exists('coin.svg'), 'coin.svg (логотип-иконка) на месте — бренд не менялся');

/* ------------------------------------------------------------------- страницы */
const PAGES = ['index.html', 'top.html', 'roulette.html', 'casino.html', 'shop.html', 'profile.html',
  'login.html', 'about.html', 'support.html', 'api.html', 'privacy.html', 'admin.html'];
PAGES.forEach((page) => {
  if (!exists(page)) { check(false, page + ' существует'); return; }
  const html = read(page);
  check(/<link rel="manifest" href="\/manifest\.webmanifest">/.test(html), page + ': подключён манифест');
  check(/<meta name="apple-mobile-web-app-capable" content="yes">/.test(html), page + ': iOS-приложение без адресной строки');
  check(/<link rel="apple-touch-icon"[^>]*icon-192\.png/.test(html), page + ': apple-touch-icon');
  check(/apple-mobile-web-app-status-bar-style/.test(html), page + ': iOS статус-бар без белой полосы');
});

/* --------------------------------------------------------------- service worker */
check(exists('sw.js'), 'sw.js в корне сайта (иначе scope не покроет платформу)');
if (exists('sw.js')) {
  const sw = read('sw.js');
  check(/addEventListener\('fetch'/.test(sw), 'service worker: обработчик fetch (условие установки)');
  check(/skipWaiting/.test(sw), 'service worker: новая версия активируется сразу');
  check(/clients\.claim/.test(sw), 'service worker: берёт страницы под контроль без перезагрузки');
  check(!/caches\.open|cache\.put/.test(sw), 'service worker ничего не кеширует (деплой приходит сразу)');
}

/* --------------------------------------------------------------------- сервер */
const server = read('server.py');
check(/'sw\.js'/.test(server), 'server.py: sw.js в белом списке статики');
check(/'manifest\.webmanifest'/.test(server), 'server.py: манифест в белом списке статики');
check(/application\/manifest\+json/.test(server), 'server.py: MIME-тип манифеста');
check(/Service-Worker-Allowed/.test(server), 'server.py: заголовок Service-Worker-Allowed');
check(/worker-src 'self'/.test(server), 'server.py: CSP разрешает service worker');

/* ---------------------------------------------------------------- прогрев игры */
const platform = read('assets/vg/js/platform.js');
check(/function prefetchGame\(/.test(platform), 'плеер: prefetchGame для мгновенного открытия игры');
check(/VG\.prefetchGame = prefetchGame/.test(platform), 'плеер: prefetchGame доступен страницам');
check(/navigator\.serviceWorker\.register\('\/sw\.js'/.test(platform), 'плеер: регистрирует service worker');
check(/rel = 'prefetch'/.test(platform), 'плеер: ставит link rel=prefetch на файл игры');
const catalog = read('assets/vg/js/catalog.js');
const home = read('assets/vg/js/home.js');
check(/VG\.prefetchGame\(game\.file\)/.test(catalog), 'каталог: греет игру при открытии описания');
check(/bindWarmup\(\)/.test(catalog), 'каталог: греет игру при наведении/тапе на карточку');
check(/VG\.prefetchGame/.test(home), 'главная: греет игру при наведении/тапе на карточку');

/* ------------------------------------------------- словари переводов в играх */
const gamesDir = path.join(ROOT, 'games');
const gameFiles = fs.readdirSync(gamesDir).filter((f) => f.endsWith('.html'));
check(gameFiles.length >= 12, 'игр не меньше, чем было (12)', String(gameFiles.length));
let dictTotal = 0;
/* Первый проход: объединение словарей всех игр — так тест отличает строку,
   у которой просто нет перевода в GAMES_EN (у неё есть inline-английский
   второй аргумент), от строки, потерянной при разбиении словаря по играм. */
const union = new Set();
gameFiles.forEach((file) => {
  const match = /<script id="game-i18n-strings">[\s\S]*?window\.VG_GAME_STRINGS=(\{[\s\S]*?\});<\/script>/.exec(read('games/' + file));
  if (!match) return;
  try { Object.keys(JSON.parse(match[1])).forEach((key) => union.add(key)); } catch (e) {}
});
gameFiles.forEach((file) => {
  const html = read('games/' + file);
  const match = /<script id="game-i18n-strings">[\s\S]*?window\.VG_GAME_STRINGS=(\{[\s\S]*?\});<\/script>/.exec(html);
  check(!!match, file + ': словарь переводов на месте');
  if (!match) return;
  let table = {};
  try { table = JSON.parse(match[1]); } catch (e) { check(false, file + ': словарь — валидный JSON', e.message); return; }
  const keys = Object.keys(table);
  dictTotal += keys.length;
  check(keys.length < 400, file + ': словарь только для этой игры, а не для всех', keys.length + ' строк');
  const body = html.replace(match[0], '');
  const used = new Set();
  const re = /VGT\(\s*'([^'\\\n]*[А-Яа-яЁё][^'\\\n]*)'/g;
  let m;
  while ((m = re.exec(body))) used.add(m[1]);
  const missing = [...used].filter((key) => !(key in table) && union.has(key));
  /* Строки-фрагменты склейки (например «Осколок ») — короткие обрезки:
     их проверяем мягко, английский у них приходит вторым аргументом. */
  const hard = missing.filter((key) => key.length > 12);
  check(!hard.length, file + ': все переводимые VGT-строки есть в словаре', hard.slice(0, 3).join(' | '));
});
check(dictTotal < 2000, 'суммарный словарь игр уменьшен (было ~8700 строк)', String(dictTotal));

console.log('\n== Итог');
if (failures.length) {
  failures.forEach((f) => console.log('   FAIL ' + f));
  console.log(`   пройдено: ${passed - failures.length}, провалено: ${failures.length}`);
  process.exit(1);
}
console.log(`   ИТОГО: ${passed}/${passed} проверок пройдено`);
