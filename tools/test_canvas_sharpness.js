#!/usr/bin/env node
/*
 * Резкость canvas на телефонах с высокой плотностью экрана.
 *
 * Проверяем не «есть ли слово devicePixelRatio», а настоящий буфер после
 * запуска игры в jsdom: размеры буфера должны быть в физических пикселях
 * (CSS × DPR), трансформация контекста — совпадать с этим коэффициентом, а
 * пропорции поля — не искажаться. Игры запускаются целиком, с заглушкой
 * 2D-контекста, поэтому заодно ловятся ошибки инициализации.
 *
 *     NODE_PATH=/tmp/dom/node_modules node tools/test_canvas_sharpness.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.join(__dirname, '..');
const results = [];
function check(name, ok, extra) {
  results.push((ok ? 'PASS' : 'FAIL') + ' · ' + name + (extra === undefined ? '' : ' → ' + JSON.stringify(extra)));
}

/* Экран телефона: 390 × 760 CSS-пикселей, DPR 3 (типичный Android/iPhone). */
const CSS_W = 390, CSS_H = 620;

function boot(file) {
  const html = fs.readFileSync(path.join(root, 'games', file), 'utf8');
  const errors = [];
  const calls = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { if (!/navigation|Not implemented|resource|canvas/i.test(e.message)) errors.push(e.message); });
  vc.on('error', (...a) => errors.push(a.join(' ')));
  const grad = { addColorStop() {} };
  let ctxStub;
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'http://localhost/games/' + file, virtualConsole: vc,
    /* Заглушки ставим ДО исполнения скриптов страницы: игра берёт контекст
       canvas сразу при загрузке, и позже подменять уже поздно. */
    beforeParse(window) {
      ctxStub = new Proxy({
        createLinearGradient: () => grad, createRadialGradient: () => grad,
        measureText: () => ({ width: 10 }),
        setTransform: (a, b, c, d, e, f) => { calls.push([a, b, c, d, e, f]); }
      }, { get(t, p) { return p in t ? t[p] : function () {}; }, set(t, p, v) { t[p] = v; return true; } });
      window.HTMLCanvasElement.prototype.getContext = function () { ctxStub.canvas = this; return ctxStub; };
      window.HTMLElement.prototype.setPointerCapture = window.HTMLElement.prototype.setPointerCapture || function () {};
      window.HTMLElement.prototype.releasePointerCapture = window.HTMLElement.prototype.releasePointerCapture || function () {};
      if (!window.ResizeObserver) window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
      if (!window.matchMedia) window.matchMedia = function () { return { matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }; };
      Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get() { return CSS_W; }, configurable: true });
      Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { get() { return CSS_H; }, configurable: true });
      Object.defineProperty(window, 'innerWidth', { value: CSS_W, configurable: true });
      Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true });
      Object.defineProperty(window, 'devicePixelRatio', { value: 3, configurable: true });
      // jsdom не считает layout: подставляем настоящий CSS-размер поля.
      window.Element.prototype.getBoundingClientRect = function () {
        return { width: CSS_W, height: CSS_H, top: 0, left: 0, right: CSS_W, bottom: CSS_H, x: 0, y: 0 };
      };
    }
  });
  const w = dom.window;
  return { w, dom, calls, errors, ctx: ctxStub };
}

const GAMES = [
  { file: 'pong.html', canvas: 'c', exact: true },
  { file: 'platformer.html', canvas: 'c', exact: true },
  { file: 'shooter.html', canvas: 'c', exact: true },
  { file: 'game2048.html', canvas: 'c', exact: false, board: 560 },
  { file: 'doodle.html', canvas: null, exact: true },
  { file: 'snake.html', canvas: 'c', exact: false, board: 400, square: true }
];

GAMES.forEach((game) => {
  const { w, dom, calls, errors } = boot(game.file);
  let canvas = null;
  try { canvas = game.canvas ? w.document.getElementById(game.canvas) : w.document.querySelector('canvas'); } catch (e) {}
  if (!canvas) { check(game.file + ': поле найдено', false); return; }

  w.dispatchEvent(new w.Event('resize'));
  try { w.dispatchEvent(new w.Event('orientationchange')); } catch (e) {}
  const dpr = 3;
  const scale = calls.length ? calls[calls.length - 1][0] : 0;
  const bw = canvas.width, bh = canvas.height;

  if (game.exact) {
    /* Плотность буфера: не меньше 2 физических пикселей на CSS-пиксель (это
       retina-уровень) и не больше 3 — выше смысла нет, только нагрузка. */
    const ratio = bw / CSS_W;
    check(game.file + ': буфер в физических пикселях', ratio >= 1.99 && ratio <= 3.05,
      { buffer: [bw, bh], css: [CSS_W, CSS_H], ratio: +ratio.toFixed(2) });
    check(game.file + ': контекст масштабирован под буфер', Math.abs(scale - bw / CSS_W) < 0.03, { scale, buffer: bw });
    check(game.file + ': пропорции поля не искажены',
      Math.abs((bw / bh) - (CSS_W / CSS_H)) < 0.03, { buffer: [bw, bh], css: [CSS_W, CSS_H] });
  } else {
    check(game.file + ': буфер плотнее логической сетки', bw >= game.board && scale > 1,
      { buffer: [bw, bh], board: game.board, scale });
    check(game.file + ': буфер квадратный', bw === bh, { buffer: [bw, bh] });
    check(game.file + ': масштаб совпадает с буфером',
      Math.abs(bw / game.board - scale) < 0.02, { ratio: bw / game.board, scale });
    check(game.file + ': плотность не меньше 2x', bw / Math.min(CSS_W, CSS_H) >= 1.99,
      { buffer: bw, screen: Math.min(CSS_W, CSS_H) });
  }
  check(game.file + ': нет ошибок JavaScript', errors.length === 0, errors.slice(0, 2));
  /* Цикл кадров держит event loop, поэтому окно закрываем сразу после проверок. */
  try { dom.window.close(); } catch (e) {}
});

/* ---- 3D-игры: WebGL в jsdom не поднять, поэтому проверяем настройки плотности
   рендера в исходниках. Смысл проверок: буфер canvas в физических пикселях и не
   меньше 2× CSS, адаптивное качество не ниже 1.25×. ---- */
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

const sky = read('games/sky-isle.js');
check('sky-isle: движок создаётся с adaptToDeviceRatio', /new B\.Engine\(canvas,true,\{[^}]*\},true\)/.test(sky));
check('sky-isle: рендер в физических пикселях (1:1)',
  sky.includes('engine.setHardwareScalingLevel(SKY_LOW?1.5:1)'));
check('sky-isle: есть адаптивное понижение до 2× CSS', sky.includes('setHardwareScalingLevel(1.5)'));
check('sky-isle: preserveDrawingBuffer не мешает MSAA', !sky.includes('preserveDrawingBuffer:true'));
check('sky-isle: сборка совпадает с исходником',
  read('games/sky-isle.html').includes('engine.setHardwareScalingLevel(SKY_LOW?1.5:1)'));

const red = read('games/redline.js');
check('redline: adaptToDeviceRatio включён', red.includes('adaptToDeviceRatio: true'));
check('redline: плотность рендера не ниже 2× CSS (было dpr/1.35)', red.includes('(devicePixelRatio || 1) / 2'));
check('redline: сборка совпадает с исходником', read('games/redline.html').includes('adaptToDeviceRatio: true'));

const rover = read('games/chefs-rover.js');
check('chefs-rover: pixelRatio не ниже 2 (было 1.65)',
  rover.includes('setPixelRatio(Math.min(devicePixelRatio||1,/[?&]perf=low/.test(location.search)?1.25:2))'));
check('chefs-rover: сборка совпадает с исходником',
  read('games/chefs-rover.html').includes('?1.25:2))'));

const mc = read('games/minicraft.html');
check('minicraft: pixelRatio не ниже 2 (было 1.75)', mc.includes('fn ? 2 : 1.75'));
check('minicraft: адаптивное качество сохраняется', mc.includes('mcxPerfTick') && mc.includes('mcxPerf.step * .25'));

const failed = results.filter((r) => r.startsWith('FAIL'));
results.forEach((r) => console.log(r));
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' проверок пройдено');
if (failed.length) process.exitCode = 1;
setTimeout(() => process.exit(failed.length ? 1 : 0), 50);
