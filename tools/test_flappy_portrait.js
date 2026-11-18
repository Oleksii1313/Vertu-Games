#!/usr/bin/env node
/* =============================================================================
   Vert Games · Flappy Bird: портретное поле 9:16
   -----------------------------------------------------------------------------
   Проверяет движок игры в DOM-окружении (jsdom), не полагаясь на CSS-локи:
     1. портретный телефон  — поле 9:16, вписано, буфер = CSS × DPR;
     2. поворот в ландшафт   — пропорции целы, счёт/птица/трубы сохранены;
     3. игра после поворота  — кадры продолжают идти, птица управляется;
     4. обратный поворот     — без перезапуска игры;
     5. десктоп 1440 × 800   — поле остаётся вертикальным (letterbox);
     6. набор размеров       — 320…1920 px, всегда 9:16 и без обрезки;
     7. 120 Гц               — физика остаётся на фиксированных 60 Гц;
     8. ресайз на ходу        — игра не падает.

   Запуск:  node tools/test_flappy_portrait.js
   Требуется jsdom:  npm install jsdom   (без него тест честно пропускается)
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
const htmlPath = path.join(__dirname, '..', 'games', 'flappy.html');
const html = fs.readFileSync(htmlPath, 'utf8');
function makeCtx() {
  const grad = { addColorStop() {} };
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => grad;
      if (k in t) return t[k];
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; }
  });
  return ctx;
}

function boot(box) {
  const rafs = [];
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'http://localhost/games/flappy.html',
    beforeParse(win) {
      win.HTMLCanvasElement.prototype.getContext = () => makeCtx();
      win.devicePixelRatio = 2;
      // Заглушка размеров: .stage получает заданный прямоугольник.
      win.Element.prototype.getBoundingClientRect = function () {
        if (this.classList && this.classList.contains('stage')) {
          const pad = 16;
          return { width: box.w - pad, height: box.h - pad, top: 0, left: 0, right: box.w, bottom: box.h, x: 0, y: 0 };
        }
        return { width: box.w, height: box.h, top: 0, left: 0, right: box.w, bottom: box.h, x: 0, y: 0 };
      };
      win.requestAnimationFrame = (cb) => { rafs.push(cb); return rafs.length; };
      win.cancelAnimationFrame = () => {};
      Object.defineProperty(win, 'innerWidth', { get: () => box.w, configurable: true });
      Object.defineProperty(win, 'innerHeight', { get: () => box.h, configurable: true });
    }
  });
  return { dom, win: dom.window, rafs, box };
}

function step(ctx, n = 1, dt = 16.667) {
  for (let i = 0; i < n; i++) {
    const cb = ctx.rafs.pop();
    ctx.rafs.length = 0;
    if (!cb) throw new Error('no rAF scheduled');
    ctx.t = (ctx.t || 1000) + dt;
    cb(ctx.t);
  }
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  [' + detail + ']' : ''));
}

function canvasBox(win) {
  const c = win.document.getElementById('c');
  return {
    cssW: parseFloat(c.style.width),
    cssH: parseFloat(c.style.height),
    bw: c.width,
    bh: c.height,
    ratio: parseFloat(c.style.width) / parseFloat(c.style.height)
  };
}

// 1. Портретный телефон 390 × 844
let a = boot({ w: 390, h: 844 });
let cb = canvasBox(a.win);
check('portrait phone: 9:16 ratio', Math.abs(cb.ratio - 9 / 16) < 0.02, `ratio=${cb.ratio.toFixed(4)}`);
check('portrait phone: fits width', cb.cssW <= 390, `${cb.cssW}x${cb.cssH}`);
check('portrait phone: buffer = css*dpr', Math.abs(cb.bw - Math.round(cb.cssW * 2)) <= 1, `buffer=${cb.bw}x${cb.bh}`);

// играем несколько кадров и запоминаем состояние
step(a, 1);
a.win.eval("bird.y=200; score=3; document.getElementById('scoreVal').textContent=3");
step(a, 30);
const yBefore = a.win.eval('bird.y');
const pipesBefore = a.win.eval('pipes.length');
check('game advances', a.win.eval('frame') > 0, 'frame=' + a.win.eval('frame'));

// 2. Поворот в ландшафт посреди игры
a.box.w = 844; a.box.h = 390; a.win.dispatchEvent(new a.win.Event('resize'));
cb = canvasBox(a.win);
check('landscape: still 9:16', Math.abs(cb.ratio - 9 / 16) < 0.02, `ratio=${cb.ratio.toFixed(4)}`);
check('landscape: fits inside height', cb.cssH <= 390, `${cb.cssW}x${cb.cssH}`);
check('landscape: no distortion (buffer matches css)', Math.abs(cb.bw - Math.round(cb.cssW * 2)) <= 1 && Math.abs(cb.bh - Math.round(cb.cssH * 2)) <= 1, `${cb.bw}x${cb.bh}`);
check('landscape: state kept (score)', a.win.eval('score') === 3, 'score=' + a.win.eval('score'));
check('landscape: state kept (bird)', Math.abs(a.win.eval('bird.y') - yBefore) < 1e-9, `y=${a.win.eval('bird.y')}`);
check('landscape: pipes kept', a.win.eval('pipes.length') === pipesBefore);

// 3. Продолжаем играть после поворота (птицу поддерживаем взмахами)
const f0 = a.win.eval('frame');
step(a, 1);
a.win.eval('jump()');
for (let i = 0; i < 20; i++) { step(a, 1); a.win.eval('bird.y=200; bird.vy=0'); }
check('play continues after rotation', a.win.eval('frame') > f0, `frame ${f0} -> ${a.win.eval('frame')}`);

// 4. Обратный поворот без перезапуска
a.box.w = 390; a.box.h = 844; a.win.dispatchEvent(new a.win.Event('resize'));
cb = canvasBox(a.win);
check('rotate back: ratio 9:16', Math.abs(cb.ratio - 9 / 16) < 0.02, `ratio=${cb.ratio.toFixed(4)}`);
check('rotate back: no restart (score kept)', a.win.eval('score') === 3);
check('rotate back: still running', a.win.eval('running') === true);

// 5. Десктоп 1440 × 800 — поле не растягивается на всю ширину
let d = boot({ w: 1440, h: 800 });
cb = canvasBox(d.win);
check('desktop: 9:16 preserved', Math.abs(cb.ratio - 9 / 16) < 0.02, `ratio=${cb.ratio.toFixed(4)}`);
check('desktop: letterboxed (not full width)', cb.cssW < 500, `${cb.cssW}x${cb.cssH}`);
check('desktop: uses available height', cb.cssH > 700, `h=${cb.cssH}`);

// 6. Набор размеров: соотношение всегда 9:16 и поле влезает
const sizes = [[320, 568], [360, 640], [375, 667], [390, 844], [414, 896], [430, 932], [768, 1024], [1024, 768], [1920, 1080], [667, 375]];
let sizesOk = true, bad = [];
for (const [w, h] of sizes) {
  const t = boot({ w, h });
  const b = canvasBox(t.win);
  const ratioOk = Math.abs(b.ratio - 9 / 16) < 0.02;
  const fitsOk = b.cssW <= w && b.cssH <= h;
  if (!ratioOk || !fitsOk) { sizesOk = false; bad.push(`${w}x${h}->${b.cssW}x${b.cssH}`); }
}
check('all viewport sizes: 9:16 and fitting', sizesOk, bad.join(', ') || `${sizes.length} sizes`);

// 7. Фиксированный шаг физики: 120 Гц не ускоряет игру вдвое
let e = boot({ w: 390, h: 844 });
step(e, 1, 16.667);            // первый кадр — инициализация таймера
const fA = e.win.eval('frame');
step(e, 60, 8.333);            // 60 кадров по 8.3 мс = 0.5 с игры
const fB = e.win.eval('frame');
check('120 Hz: physics stays 60 Hz', fB - fA <= 31, `frames advanced: ${fB - fA} (ждём ~30)`);

// 8. Ресайз во время паузы/скрытой вкладки не ломает игру
e.box.w = 500; e.box.h = 900; e.win.dispatchEvent(new e.win.Event('resize'));
check('resize while running: no crash', e.win.eval('running') === true);

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length} passed / ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
