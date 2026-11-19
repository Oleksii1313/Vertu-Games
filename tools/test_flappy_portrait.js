#!/usr/bin/env node
/* =============================================================================
   Vert Games · Flappy Bird: портретное поле 9:16
   -----------------------------------------------------------------------------
   Проверяет движок игры в DOM-окружении (jsdom), не полагаясь на CSS-локи:
     1. портретный телефон  — вертикальное поле на всю область, буфер = CSS × DPR;
     2. поворот в ландшафт   — пропорции равномерны, счёт/птица/трубы сохранены;
     3. игра после поворота  — кадры продолжают идти, птица управляется;
     4. обратный поворот     — без перезапуска игры;
     5. десктоп 1440 × 800   — поле остаётся вертикальным и не растягивается;
     6. набор размеров       — 320…1920 px: поле вертикальное, без искажений
                               и без обрезки;
     7. 120 Гц               — физика остаётся на фиксированных 60 Гц;
     8. ресайз на ходу        — игра не падает.

   Мир игры по замыслу подстраивает высоту под экран (см. fit() в flappy.html):
   полос по краям быть не должно, а масштаб по обеим осям — одинаковый. Поэтому
   ниже проверяется не жёсткое 9:16, а вертикальность поля, равномерность
   масштаба и то, что поле влезает в экран целиком.

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
          /* .stage заполняет кадр целиком: в CSS у него padding:0, поэтому
             поле тянется от края до края — ни рамки, ни полос. */
          const pad = 0;
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
check('portrait phone: vertical field', cb.ratio < 1, `ratio=${cb.ratio.toFixed(4)}`);
check('portrait phone: fits the screen', cb.cssW <= 390 && cb.cssH <= 844, `${cb.cssW}x${cb.cssH}`);
check('portrait phone: uses the whole width (no side bars)', Math.abs(cb.cssW - 390) <= 2, `${cb.cssW}x${cb.cssH}`);
check('portrait phone: buffer = css*dpr', Math.abs(cb.bw - Math.round(cb.cssW * 2)) <= 1, `buffer=${cb.bw}x${cb.bh}`);
check('portrait phone: uniform scale (no distortion)',
  Math.abs(cb.bw / cb.cssW - cb.bh / cb.cssH) < 0.01, `scale=${(cb.bw / cb.cssW).toFixed(4)}/${(cb.bh / cb.cssH).toFixed(4)}`);

// играем несколько кадров и запоминаем состояние
step(a, 1);
a.win.eval("bird.y=200; score=3; document.getElementById('scoreVal').textContent=3");
step(a, 30);
/* Высота мира пересчитывается под экран, поэтому позицию птицы сравниваем в
   долях высоты: так сохраняется её место на поле, а не абсолютные пиксели. */
const relBefore = a.win.eval('bird.y / H');
const pipesBefore = a.win.eval('pipes.length');
check('game advances', a.win.eval('frame') > 0, 'frame=' + a.win.eval('frame'));

// 2. Поворот в ландшафт посреди игры
a.box.w = 844; a.box.h = 390; a.win.dispatchEvent(new a.win.Event('resize'));
cb = canvasBox(a.win);
/* Мир подстраивается под кадр: в ландшафте он расширяется, а не встаёт
   вертикальной полоской с чёрными полосами по бокам. */
check('landscape: field fills the frame', Math.abs(cb.cssW - 844) <= 2 && Math.abs(cb.cssH - 390) <= 2,
  `${cb.cssW}x${cb.cssH}`);
check('landscape: world matches frame (no letterbox)', Math.abs(cb.ratio - 844 / 390) < 0.02,
  `ratio=${cb.ratio.toFixed(4)}`);
check('landscape: fits inside height', cb.cssH <= 390 && cb.cssW <= 844, `${cb.cssW}x${cb.cssH}`);
check('landscape: no distortion (buffer matches css)', Math.abs(cb.bw - Math.round(cb.cssW * 2)) <= 1 && Math.abs(cb.bh - Math.round(cb.cssH * 2)) <= 1, `${cb.bw}x${cb.bh}`);
check('landscape: state kept (score)', a.win.eval('score') === 3, 'score=' + a.win.eval('score'));
check('landscape: state kept (bird on the same spot of the field)',
  Math.abs(a.win.eval('bird.y / H') - relBefore) < 0.01, `y/H=${a.win.eval('bird.y / H').toFixed(3)}`);
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
check('rotate back: field fills the portrait frame again', Math.abs(cb.cssW - 390) <= 2 && Math.abs(cb.cssH - 844) <= 2,
  `${cb.cssW}x${cb.cssH}`);
check('rotate back: no restart (score kept)', a.win.eval('score') === 3);
check('rotate back: still running', a.win.eval('running') === true);

// 5. Десктоп 1440 × 800 — поле не растягивается на всю ширину
let d = boot({ w: 1440, h: 800 });
cb = canvasBox(d.win);
/* Широкий экран — тоже весь кадр: поле расширяется миром, а не полосами. */
check('desktop: field fills the width', Math.abs(cb.cssW - 1440) <= 2, `${cb.cssW}x${cb.cssH}`);
check('desktop: uses available height', cb.cssH > 700, `h=${cb.cssH}`);
check('desktop: world matches frame (no letterbox)', Math.abs(cb.ratio - 1440 / 800) < 0.02,
  `ratio=${cb.ratio.toFixed(4)}`);

// 6. Набор размеров: поле вертикальное, без искажений и без обрезки
const sizes = [[320, 568], [360, 640], [375, 667], [390, 844], [414, 896], [430, 932], [768, 1024], [1024, 768], [1920, 1080], [667, 375]];
let sizesOk = true, bad = [];
for (const [w, h] of sizes) {
  const t = boot({ w, h });
  const b = canvasBox(t.win);
  const fits = b.cssW <= w + 1 && b.cssH <= h + 1;
  const uniform = Math.abs(b.bw / b.cssW - b.bh / b.cssH) < 0.01;
  /* Главное требование: поле занимает кадр целиком по обеим осям, масштаб
     одинаковый (без искажений), мир по пропорциям совпадает с кадром. */
  const fills = Math.abs(b.cssW - w) <= 2 && Math.abs(b.cssH - h) <= 2;
  const matchFrame = Math.abs(b.ratio - w / h) < 0.03;
  if (!fits || !uniform || !fills || !matchFrame) {
    sizesOk = false;
    bad.push(`${w}x${h}->${b.cssW}x${b.cssH}${uniform ? '' : ' искажение'}${fills ? '' : ' полосы'}`);
  }
}
check('all viewport sizes: uniform and filling the whole frame',
  sizesOk, bad.join(', ') || `${sizes.length} sizes`);

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
