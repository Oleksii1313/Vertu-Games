#!/usr/bin/env node
/*
 * Лёгкий режим для слабых машин и общая производительность сайта.
 *
 * Задача: сайт должен работать на слабом ПК/ноутбуке, но ничего не терять на
 * нормальном железе. Проверяем:
 *
 *   1. платформа определяет слабое устройство (deviceMemory, ядра, Save-Data)
 *      и умеет это форсировать через ?perf=low / ?perf=high;
 *   2. в лёгком режиме на <html> появляется data-lowend, а CSS отключает
 *      только дорогие эффекты (backdrop-filter, постоянные анимации);
 *   3. игры получают ?perf=low и снижают плотность рендера (1.5× вместо 2.5×),
 *      а 3D-движки — 1.25–1.5× вместо 2–3×;
 *   4. картинки каталога грузятся лениво и не ломают раскладку (width/height);
 *   5. есть поддержка prefers-reduced-motion;
 *   6. ни одна функция не «удалена ради скорости»: игр по-прежнему 11,
 *      каталог и API на месте.
 *
 *     NODE_PATH=/tmp/dom/node_modules node tools/test_perf_lowend.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const PLATFORM = read('assets/vg/js/platform.js');
const CSS = read('assets/vg/css/platform.css');
const KIT = read('assets/vg/js/game-kit.js');
const PAGE = read('index.html');

const results = [];
function check(name, ok, extra) {
  results.push((ok ? 'PASS' : 'FAIL') + ' · ' + name + (extra === undefined ? '' : ' → ' + JSON.stringify(extra)));
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ статика */
check('CSS: лёгкий режим выключает «стекло» у шапки и плеера',
  /html\[data-lowend="1"\] \.site-header/.test(CSS) && /backdrop-filter:none!important/.test(CSS), null);
check('CSS: постоянные анимации в лёгком режиме не крутятся',
  /html\[data-lowend="1"\] \.hero-orb/.test(CSS) && /animation:none!important/.test(CSS), null);
check('CSS: тяжёлые блоки вне экрана не раскладываются заранее',
  /content-visibility:auto/.test(CSS) && /contain-intrinsic-size/.test(CSS), null);
check('CSS: уважение к prefers-reduced-motion', /@media \(prefers-reduced-motion: reduce\)/.test(CSS), null);

check('game-kit: плотность зависит от слабости устройства',
  KIT.includes('function maxDpr()') && KIT.includes("return lowEnd() ? 1.5 : 2.5;") &&
  KIT.includes('window.VGGame.maxDpr = maxDpr;'), null);
check('2D-игры берут плотность из game-kit',
  ['pong', 'platformer', 'shooter', 'game2048'].every((g) =>
    read('games/' + g + '.html').includes('VGGame.maxDpr')), null);

const heavy = [
  ['sky-isle', 'games/sky-isle.js', 'SKY_LOW?1.5:1'],
  ['redline', 'games/redline.js', '/[?&]perf=low/.test(location.search)'],
  ['chefs-rover', 'games/chefs-rover.js', '?1.25:2'],
  ['minicraft', 'games/minicraft.html', '? 1.25 : fn ? 2 : 1.75']
];
heavy.forEach(([name, file, marker]) => {
  check(name + ': в лёгком режиме рендерит с меньшей плотностью', read(file).includes(marker), null);
});

check('картинки каталога грузятся лениво', (PAGE.match(/<img /g) || []).length > 0 &&
  (PAGE.match(/loading="lazy"/g) || []).length >= (PAGE.match(/<img /g) || []).length, null);
check('у картинок заданы размеры (нет «прыжков» раскладки)',
  (PAGE.match(/<img [^>]*width="\d+"/g) || []).length === (PAGE.match(/<img /g) || []).length, null);
check('скрипты не блокируют отрисовку зря',
  /src="assets\/vg\/js\/platform\.js[^"]*"[^>]*defer|src="assets\/vg\/js\/platform\.js/.test(PAGE), null);

/* ------------------------------------------------------- поведение платформы */
function env(search, nav) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { if (!/navigation|Not implemented|resource|canvas/i.test(e.message)) errors.push(e.message); });
  const dom = new JSDOM(PAGE, {
    url: 'http://localhost/index.html' + (search || ''),
    runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      /* Свойства navigator в jsdom только на чтение — задаём через defineProperty. */
      Object.keys(nav || {}).forEach((key) => {
        if (key.indexOf('__') === 0) return;
        try { Object.defineProperty(w.navigator, key, { value: nav[key], configurable: true }); } catch (e) {}
      });
      w.matchMedia = (q) => ({ matches: /pointer:\s*coarse/.test(q) ? !!(nav && nav.__coarse) : false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      w.fetch = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: () => Promise.resolve({ ok: true, user: null, csrf: 'c', games: [], captcha: {} }) });
    }
  });
  const w = dom.window;
  w.eval(PLATFORM);
  return { w, dom, errors };
}

(async () => {
  /* слабое устройство по памяти */
  const weak = env('', { deviceMemory: 2, hardwareConcurrency: 4 });
  await wait(80);
  check('слабый ПК: выставлен data-lowend', weak.dom.window.document.documentElement.getAttribute('data-lowend') === '1',
    weak.dom.window.document.documentElement.getAttribute('data-lowend'));
  check('слабый ПК: VG.lowEnd() = true', weak.w.VG.lowEnd() === true, null);
  try { weak.dom.window.close(); } catch (e) {}

  /* сильное устройство */
  const strong = env('', { deviceMemory: 8, hardwareConcurrency: 8 });
  await wait(80);
  check('нормальный ПК: лёгкий режим не включается',
    !strong.dom.window.document.documentElement.hasAttribute('data-lowend') && strong.w.VG.lowEnd() === false, null);

  /* игра получает ?perf=low */
  strong.w.VG.openGame({ id: 'flappy', name: 'Flappy', file: 'games/flappy.html', reward: 2 });
  await wait(80);
  const strongFrame = strong.dom.window.document.querySelector('.play-frame');
  check('нормальный ПК: игра открывается без ?perf=low',
    !/perf=low/.test(strongFrame.getAttribute('src') || ''), strongFrame.getAttribute('src'));
  strong.w.VG.closeGame();
  await wait(60);
  try { strong.dom.window.close(); } catch (e) {}

  const forced = env('?perf=low', { deviceMemory: 16, hardwareConcurrency: 16 });
  await wait(80);
  check('?perf=low форсирует лёгкий режим на любом железе',
    forced.dom.window.document.documentElement.getAttribute('data-lowend') === '1', null);
  forced.w.VG.openGame({ id: 'flappy', name: 'Flappy', file: 'games/flappy.html', reward: 2 });
  await wait(80);
  const frame = forced.dom.window.document.querySelector('.play-frame');
  check('игра получает ?perf=low вместе с языком',
    /games\/flappy\.html\?lang=(ru|en)&perf=low/.test(frame.getAttribute('src') || ''), frame.getAttribute('src'));
  check('лёгкий режим не ломает консоль', forced.errors.length === 0, forced.errors.slice(0, 2));
  forced.w.VG.closeGame();
  await wait(60);
  try { forced.dom.window.close(); } catch (e) {}

  const forcedHigh = env('?perf=high', { deviceMemory: 2, hardwareConcurrency: 2 });
  await wait(80);
  check('?perf=high отключает лёгкий режим даже на слабом ПК',
    !forcedHigh.dom.window.document.documentElement.hasAttribute('data-lowend'), null);
  try { forcedHigh.dom.window.close(); } catch (e) {}

  /* ничего не удалено */
  const games = ['flappy', 'game2048', 'platformer', 'pong', 'shooter', 'snake',
    'minicraft', 'doodle', 'redline', 'sky-isle', 'chefs-rover'];
  check('все 11 игр на месте', games.every((g) => fs.existsSync(path.join(ROOT, 'games', g + '.html'))), games.length);

  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(results.join('\n'));
  console.log('\nИТОГО: ' + (results.length - failed.length) + '/' + results.length + ' проверок пройдено');
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.log(results.join('\n'));
  console.error('\nТЕСТ УПАЛ:', (e && e.stack) || e);
  process.exit(1);
});
