#!/usr/bin/env node
/* =============================================================================
   Vert Games · игра на весь экран телефона
   -----------------------------------------------------------------------------
   Классические 2D-игры (snake, 2048, flappy, pong, shooter, platformer) держат
   общую раскладку «статистика — поле — кнопки». На телефоне она съедала высоту
   в портрете и оставляла пустые поля в ландшафте. Проверяем, что game-kit:

     1. подключается во всех шести играх и видит их панели (.info, .controls);
     2. не трогает игры с другой раскладкой (doodle, 3D);
     3. ставит html.vg-classic и два набора правил — базовые и «классические»;
     4. в портрете жмёт панели и убирает отступы поля;
     5. в ландшафте раскладывает экран в строку: поле слева, кнопки справа,
        статистика — полосой поверх нижнего края;
     6. правильно определяет режим экрана (data-vg-view) и пересчитывает поле
        после поворота телефона.

   Запуск:  NODE_PATH=/tmp/dom/node_modules node tools/test_mobile_layout.js
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
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
/* Snake раскладывает себя сам (большое поле + свайпы), поэтому в общий набор
   «статистика — поле — кнопки» она больше не входит. */
const CLASSIC = ['game2048', 'flappy', 'pong', 'shooter', 'platformer'];
const OTHER = ['snake', 'doodle', 'minicraft', 'sky-isle', 'chefs-rover', 'redline'];

const results = [];
function check(name, ok, extra) {
  results.push((ok ? 'PASS' : 'FAIL') + ' · ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : ''));
}
function read(name) {
  return fs.readFileSync(path.join(ROOT, 'games', name + '.html'), 'utf8');
}

/* --------------------------------------------- 1. статическая проверка набора */
const html = {};
CLASSIC.concat(OTHER).forEach((name) => { html[name] = read(name); });

check('все классические игры подключают game-kit.js',
  CLASSIC.every((n) => /game-kit\.js/.test(html[n])), CLASSIC.filter((n) => !/game-kit\.js/.test(html[n])));
check('во всех классических играх есть панель статистики и панель кнопок',
  CLASSIC.every((n) => /class="info"/.test(html[n]) && /class="controls"/.test(html[n])),
  CLASSIC.filter((n) => !/class="info"/.test(html[n]) || !/class="controls"/.test(html[n])));
check('doodle (есть .controls, но нет .info) в набор не попадает',
  !/class="info"/.test(html.doodle));
check('snake вышла из набора: своя раскладка вместо панели стрелок',
  !/class="controls"/.test(html.snake) && /id="snakeBody"/.test(html.snake));
check('у snake поле, стрелки и HUD разведены по отдельным контейнерам',
  /class="board"/.test(html.snake) && /id="padDock"/.test(html.snake) && /class="hud-actions"/.test(html.snake));
check('3D-игры раскладываются сами (canvas на весь экран)',
  ['minicraft', 'sky-isle', 'chefs-rover', 'redline'].every((n) =>
    /position:\s*fixed;inset:0|position:\s*absolute;inset:0/.test(html[n])),
  ['minicraft', 'sky-isle', 'chefs-rover', 'redline'].filter((n) =>
    !/position:\s*fixed;inset:0|position:\s*absolute;inset:0/.test(html[n])));

/* ------------------------------------------------ 2. запуск игры в jsdom */
const KIT = fs.readFileSync(path.join(ROOT, 'assets', 'vg', 'js', 'game-kit.js'), 'utf8');

function grad() { return { addColorStop() {} }; }
function boot(name, width, height) {
  const source = html[name] || read(name);
  const errors = [];
  const dom = new JSDOM(source, {
    runScripts: 'outside-only', pretendToBeVisual: true,
    url: 'http://localhost/games/' + name + '.html',
    virtualConsole: new (require('jsdom').VirtualConsole)().on('jsdomError', (e) => {
      if (!/navigation|Not implemented|resource/i.test(e.message)) errors.push(e.message);
    }).on('error', (...a) => errors.push(a.join(' ')))
  });
  const w = dom.window;
  const ctx = new Proxy({
    createLinearGradient: grad, createRadialGradient: grad,
    measureText: () => ({ width: 10 }),
    getImageData: (x, y, a, b) => ({ data: new Uint8ClampedArray(Math.max(1, a * b * 4)) }),
    createImageData: (a, b) => ({ data: new Uint8ClampedArray(Math.max(1, a * b * 4)) })
  }, { get(t, p) { return p in t ? t[p] : function () {}; }, set(t, p, v) { t[p] = v; return true; } });
  w.HTMLCanvasElement.prototype.getContext = function (type) {
    if (type === '2d') { ctx.canvas = this; return ctx; }
    return null;
  };
  for (const [key, value] of [['innerWidth', width], ['innerHeight', height], ['devicePixelRatio', 2]]) {
    Object.defineProperty(w, key, { value, configurable: true, writable: true });
  }
  w.matchMedia = w.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  if (!w.ResizeObserver) w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  w.HTMLElement.prototype.setPointerCapture = w.HTMLElement.prototype.setPointerCapture || function () {};
  w.HTMLElement.prototype.releasePointerCapture = w.HTMLElement.prototype.releasePointerCapture || function () {};
  w.HTMLElement.prototype.scrollIntoView = w.HTMLElement.prototype.scrollIntoView || function () {};
  w.requestAnimationFrame = () => 1;
  w.cancelAnimationFrame = () => {};

  /* Скрипты в порядке документа: инлайновые игры и внешний game-kit. */
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(source))) {
    if (/\bsrc=/.test(m[1])) {
      const src = (/src="([^"]+)"/.exec(m[1]) || [])[1] || '';
      if (/game-kit\.js$/.test(src)) vm.runInContext(KIT, dom.getInternalVMContext());
      continue;
    }
    try { vm.runInContext(m[2], dom.getInternalVMContext()); } catch (e) { errors.push('[inline] ' + e.message); }
  }
  return { w, dom, errors };
}

const booted = boot('game2048', 390, 844);
const w = booted.w;
const doc = w.document;
const styleOf = (id) => doc.getElementById(id);
const css = (id) => (styleOf(id) ? styleOf(id).textContent : '');

check('game2048 запускается без ошибок', booted.errors.length === 0, booted.errors.slice(0, 3));
check('html получает класс vg-classic', doc.documentElement.classList.contains('vg-classic'));
check('базовые правила экрана вставлены (#vg-base-fit)',
  !!styleOf('vg-base-fit') && /overscroll-behavior:none/.test(css('vg-base-fit')));
check('правила классической раскладки вставлены (#vg-classic-fit)',
  !!styleOf('vg-classic-fit') && css('vg-classic-fit').length > 400, css('vg-classic-fit').length);

/* ------------------------------------------ 3. содержимое правил по частям */
const classic = css('vg-classic-fit');
const portrait = (() => {
  const i = classic.indexOf('@media (max-width:820px)');
  if (i < 0) return '';
  return classic.slice(i, classic.indexOf('@media (orientation:landscape)', i));
})();
const landscape = (() => {
  const i = classic.indexOf('@media (orientation:landscape) and (max-height:600px)');
  return i < 0 ? '' : classic.slice(i);
})();

check('есть блок портрета (max-width:820px)', portrait.length > 100);
check('есть блок ландшафта (orientation:landscape, max-height:600px)', landscape.length > 100);
check('высота тела — по видимой области (100dvh, запасной 100vh)',
  /\.vg-classic body\{height:100vh;height:100dvh\}/.test(classic));
check('портрет: панель статистики компактная', /\.vg-classic \.info\{padding:4px 8px/.test(portrait));
check('портрет: у поля нет отступов', /\.vg-classic \.board,\.vg-classic \.board-wrap\{padding:0/.test(portrait));
check('портрет: .stage забирает оставшуюся высоту',
  /\.vg-classic \.stage\{flex:1 1 auto;min-height:0/.test(portrait));
check('портрет: холст внутри .stage не растягивается (пропорции игры целы)',
  /\.vg-classic \.stage>canvas\{flex:0 0 auto\}/.test(portrait));
check('ландшафт: экран раскладывается в строку',
  /\.vg-classic body\{display:flex;flex-direction:row/.test(landscape));
check('ландшафт: статистика — полоса поверх нижнего края без перехвата нажатий',
  /\.vg-classic \.info\{position:fixed;left:0;right:0;top:auto;bottom:0/.test(landscape)
  && /pointer-events:none/.test(landscape.split('\n').slice(-12).join('\n') + landscape));
check('ландшафт: поле растягивается на всю высоту',
  /align-self:stretch/.test(landscape) && /flex:1 1 0/.test(landscape));
check('ландшафт: кнопки становятся колонкой у правого края',
  /\.vg-classic \.controls\{flex:0 0 auto;flex-direction:column/.test(landscape));
check('ландшафт: подсказки под полем не отнимают высоту',
  /\.vg-classic body>\.hint,\.vg-classic body>\.help\{display:none\}/.test(landscape));
check('ландшафт: крестовина уменьшена под низкий экран',
  /\.vg-classic \.dpad\{grid-template-columns:repeat\(3,44px\)/.test(landscape));

/* --------------------------------------------------- 4. режим экрана */
const setSize = (width2, height2) => {
  Object.defineProperty(w, 'innerWidth', { value: width2, configurable: true, writable: true });
  Object.defineProperty(w, 'innerHeight', { value: height2, configurable: true, writable: true });
  w.dispatchEvent(new w.Event('resize'));
};
check('VGGame.viewMode объявлен', w.VGGame && typeof w.VGGame.viewMode === 'function');
check('телефон в портрете → portrait',
  w.VGGame.viewMode() === 'portrait' && doc.documentElement.getAttribute('data-vg-view') === 'portrait',
  w.VGGame.viewMode());
setSize(844, 390);
check('телефон в ландшафте → landscape',
  w.VGGame.viewMode() === 'landscape' && doc.documentElement.getAttribute('data-vg-view') === 'landscape',
  w.VGGame.viewMode());
setSize(1280, 800);
check('широкий, но не низкий экран (1280×800) → desktop',
  w.VGGame.viewMode() === 'desktop', [w.innerWidth, w.innerHeight]);
setSize(1440, 1000);
check('ноутбук → desktop', w.VGGame.viewMode() === 'desktop', [w.innerWidth, w.innerHeight]);

/* ------------------------------------- 5. пересчёт поля после поворота */
let resizes = 0;
w.addEventListener('resize', () => { resizes++; });
w.dispatchEvent(new w.Event('orientationchange'));
check('поворот экрана пересчитывает поле (resize без ожидания)',
  (() => { const before = resizes; w.VGGame.refit(); return resizes === before + 1; })(), resizes);
check('VGGame.refit доступен игре и платформе', typeof w.VGGame.refit === 'function');
check('подсказка о фокусе и запрет выделения не потерялись',
  typeof w.VGGame.focus === 'function' && !!styleOf('vg-no-select'));

/* --------------------------- 6. игры с другой раскладкой не затронуты */
const snake = boot('snake', 390, 844);
const sdoc = snake.w.document;
check('snake не получает vg-classic (у неё своя раскладка)',
  !sdoc.documentElement.classList.contains('vg-classic'));
check('snake не получает правил классической раскладки', !sdoc.getElementById('vg-classic-fit'));

const doodle = boot('doodle', 390, 844);
const ddoc = doodle.w.document;
check('doodle не получает vg-classic', !ddoc.documentElement.classList.contains('vg-classic'));
check('doodle не получает правил классической раскладки', !ddoc.getElementById('vg-classic-fit'));
check('doodle при этом тоже не растягивается и не прокручивается',
  !!ddoc.getElementById('vg-base-fit'));

/* ------------------------------------------------------------- итог */
results.forEach((line) => console.log(line));
const failed = results.filter((line) => line.startsWith('FAIL')).length;
console.log('\nИТОГО: ' + (results.length - failed) + '/' + results.length + ' проверок пройдено');
process.exit(failed ? 1 : 0);
