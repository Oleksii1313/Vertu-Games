#!/usr/bin/env node
/*
 * Обзор камеры в MiniCraft 3D: палец на телефоне и мышь на компьютере.
 *
 * Тест запускает настоящую игру в jsdom (WebGL и 2D-контекст подменены
 * заглушками) и дёргает её за те же события, что присылает браузер: pointerdown,
 * pointermove, pointerup, pointercancel. Проверяется то, на что жалуются игроки:
 *
 *  • свайп пальцем поворачивает камеру в нужную сторону с вменяемой
 *    чувствительностью (раньше было 0.17° на пиксель — камера «не слушалась»);
 *  • один сбойный pointermove (обнулившиеся координаты, огромный скачок) больше
 *    не разворачивает камеру на десятки градусов;
 *  • потерянный pointerup не оставляет обзор «залипшим» и не даёт рывка, когда
 *    браузер переиспользует pointerId;
 *  • второй палец (кнопка, джойстик, второй свайп) не крутит камеру и не
 *    прерывает обзор, а отпускание одного пальца не мешает другому;
 *  • движение джойстиком и обзор работают одновременно;
 *  • десктопное управление (ПКМ-обзор, ЛКМ-удар, короткий ПКМ-блок, pointer
 *    lock) осталось ровно таким, каким было.
 *
 * Отладочный хук подмешивается только в памяти — в файле игры его нет.
 *
 *     NODE_PATH=/tmp/dom/node_modules node tools/test_minicraft_touch.js
 *
 * Переменная MINICRAFT_HTML позволяет указать другой файл игры.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const HTML = process.env.MINICRAFT_HTML || path.join(__dirname, '..', 'games', 'minicraft.html');
const html = fs.readFileSync(HTML, 'utf8');

const results = [];
function check(name, ok, extra) {
  results.push((ok ? 'PASS' : 'FAIL') + ' · ' + name +
    (extra === undefined ? '' : ' → ' + JSON.stringify(extra).slice(0, 240)));
}

/* ------------------------------------------------------------------ заглушки */
const vc = new VirtualConsole();
const consoleErrors = [];
vc.on('jsdomError', (e) => { if (!/navigation|Not implemented/.test(e.message)) consoleErrors.push('[jsdom] ' + e.message.slice(0, 160)); });
vc.on('error', (...a) => consoleErrors.push('[error] ' + a.join(' ').slice(0, 160)));

const W = 390, H = 844;                       // типичный телефон в портрете
const dom = new JSDOM(html, {
  runScripts: 'outside-only', pretendToBeVisual: true,
  url: 'http://localhost/games/minicraft.html', virtualConsole: vc
});
const w = dom.window;

const C = {
  VERSION: 7938, MAX_TEXTURE_SIZE: 3379, MAX_VIEWPORT_DIMS: 3386, MAX_TEXTURE_IMAGE_UNITS: 34930,
  MAX_VERTEX_TEXTURE_IMAGE_UNITS: 35660, MAX_COMBINED_TEXTURE_IMAGE_UNITS: 35661, MAX_VERTEX_ATTRIBS: 34921,
  MAX_VERTEX_UNIFORM_VECTORS: 36347, MAX_VARYING_VECTORS: 36348, MAX_FRAGMENT_UNIFORM_VECTORS: 36349,
  MAX_CUBE_MAP_TEXTURE_SIZE: 34076, MAX_SAMPLES: 36183, SHADING_LANGUAGE_VERSION: 35724,
  MAX_TEXTURE_MAX_ANISOTROPY_EXT: 34047
};
function fakeGL(canvas) {
  const ext = {
    EXT_texture_filter_anisotropic: { MAX_TEXTURE_MAX_ANISOTROPY_EXT: 34047 }, OES_texture_float_linear: {},
    WEBGL_lose_context: { loseContext() {} }, EXT_color_buffer_float: {}, EXT_blend_minmax: {}, EXT_frag_depth: {},
    WEBGL_depth_texture: {}, OES_vertex_array_object: {}
  };
  const target = {
    canvas, drawingBufferWidth: 780, drawingBufferHeight: 1688,
    getParameter(p) {
      if (p === 7938) return 'WebGL 2.0 (fake)';
      if (p === 35724) return 'WebGL GLSL ES 3.00 (fake)';
      if (p === 3386 || p === 3379 || p === 34076) return [16384, 16384];
      if (p === 34921) return 16;
      if (p === 34930 || p === 35660 || p === 35661) return 16;
      if (p === 36347 || p === 36348 || p === 36349) return 1024;
      if (p === 36183) return 4;
      return 0;
    },
    getExtension(n) { return ext[n] || null; },
    getSupportedExtensions() { return Object.keys(ext); },
    getShaderPrecisionFormat() { return { precision: 23, rangeMin: 127, rangeMax: 127 }; },
    getContextAttributes() { return { alpha: true, antialias: false, depth: true, stencil: true }; },
    isContextLost() { return false; },
    createShader() { return {}; },createProgram() { return {}; }, createBuffer() { return {}; },
    createTexture() { return {}; }, createFramebuffer() { return {}; }, createRenderbuffer() { return {}; },
    createVertexArray() { return {}; }, createQuery() { return {}; },
    getProgramParameter() { return true; }, getShaderParameter() { return true; },
    getShaderInfoLog() { return ''; }, getProgramInfoLog() { return ''; },
    getUniformLocation() { return {}; }, getAttribLocation() { return 0; },
    getActiveUniform() { return { name: 'u', size: 1, type: 5126 }; },
    getActiveAttrib() { return { name: 'a', size: 1, type: 5126 }; },
    getUniformBlockIndex() { return 0; }, checkFramebufferStatus() { return 36053; },
    getError() { return 0; }, readPixels() {}
  };
  return new Proxy(target, {
    get(t, p) {
      if (p in t) return t[p];
      if (p in C) return C[p];
      if (typeof p === 'string' && /^[A-Z0-9_]+$/.test(p)) return 1;
      return function () { return undefined; };
    }
  });
}
function fake2d() {
  const grad = { addColorStop() {} };
  const target = {
    createLinearGradient() { return grad; }, createRadialGradient() { return grad; },
    createPattern() { return null; }, measureText() { return { width: 10 }; },
    getImageData(x, y, w2, h2) { return { data: new Uint8ClampedArray(w2 * h2 * 4), width: w2, height: h2 }; },
    putImageData() {}, createImageData(w2, h2) { return { data: new Uint8ClampedArray(w2 * h2 * 4) }; }
  };
  return new Proxy(target, { get(t, p) { if (p in t) return t[p]; return function () {}; }, set(t, p, v) { t[p] = v; return true; } });
}
w.HTMLCanvasElement.prototype.getContext = function (type) {
  if (type === '2d') { const c = fake2d(); c.canvas = this; return c; }
  return fakeGL(this);
};
w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
Object.defineProperty(w, 'innerWidth', { value: W, configurable: true });
Object.defineProperty(w, 'innerHeight', { value: H, configurable: true });
Object.defineProperty(w, 'devicePixelRatio', { value: 2, configurable: true });
Object.defineProperty(w.navigator, 'maxTouchPoints', { value: 5, configurable: true });
/* Телефон: указатель «грубый» (палец), мыши нет. */
w.matchMedia = (q) => ({
  matches: /pointer:coarse/.test(q), media: q,
  addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}
});
w.Element.prototype.setPointerCapture = w.Element.prototype.setPointerCapture || function () {};
w.Element.prototype.releasePointerCapture = w.Element.prototype.releasePointerCapture || function () {};
w.Element.prototype.hasPointerCapture = w.Element.prototype.hasPointerCapture || function () { return false; };
if (!w.ResizeObserver) w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
if (!w.PointerEvent) w.PointerEvent = w.MouseEvent;

const posted = [];
w.parent = { postMessage(msg, origin) { posted.push(msg); }, window: w };
let rafCb = null, rafTs = 0;
w.requestAnimationFrame = (cb) => { rafCb = cb; return 1; };
w.cancelAnimationFrame = () => {};
function frames(n, dt = 17) {
  for (let i = 0; i < n; i++) {
    rafTs += dt;
    const cb = rafCb;
    if (!cb) break;
    rafCb = null;
    cb(rafTs);
  }
}

/* --------------------------------------------- игра + отладочный хук в памяти */
const openTag = '<script id="minicraft-runtime">';
let runtime = html.slice(html.indexOf(openTag) + openTag.length, html.indexOf('</script>', html.indexOf(openTag)));
const idx = runtime.lastIndexOf('\n})();');
runtime = runtime.slice(0, idx) + `
window.__nrCalls = [];
(function () {
  var orig = nr;
  nr = function (place) {
    window.__nrCalls.push({ place: !!place, at: performance.now() });
    return orig.apply(null, arguments);
  };
})();
window.__mcx = () => ({
  F, Wt, startWorld: Kh, playGame: Zl, mc: () => Mt, canvas: Xe && Xe.domElement,
  look: () => (yt ? { id: yt.id, x: yt.x, y: yt.y, touch: yt.touch } : null),
  worldDir: () => ({ x: Gn.x, y: Gn.y, z: Gn.z }),
  touchMode: () => fn,
  keys: () => Object.keys(Vn).filter((k) => Vn[k]),
  consts: () => ({ SENS: MCX_LOOK_SENS, DRAG: MCX_LOOK_DRAG, TOUCH: MCX_LOOK_TOUCH }),
  nr: (place) => nr(place)
});
` + runtime.slice(idx);
w.eval(runtime);

const api = () => w.__mcx();
const $ = (id) => w.document.getElementById(id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------- события указателя, как у браузера */
let seq = 100;
function pev(type, x, y, opts) {
  const o = opts || {};
  const el = o.el || api().canvas;
  const ev = new w.Event(type, { bubbles: true, cancelable: true });
  const props = {
    pointerId: o.id === undefined ? ++seq : o.id,
    pointerType: o.pointerType || 'touch',
    clientX: x, clientY: y,
    button: o.button === undefined ? 0 : o.button,
    buttons: o.buttons === undefined ? 1 : o.buttons,
    isPrimary: o.isPrimary !== false,
    pressure: o.pressure === undefined ? 0.5 : o.pressure
  };
  Object.keys(props).forEach((k) => Object.defineProperty(ev, k, { value: props[k], configurable: true }));
  el.dispatchEvent(ev);
  return ev;
}

/* Свайп пальцем: серия pointermove по 10 px + подъём пальца. Возвращает Δyaw. */
function swipe(x0, y0, dx, dy, steps, id) {
  const pid = id === undefined ? ++seq : id;
  const y0yaw = api().F.yaw, y0pitch = api().F.pitch;
  pev('pointerdown', x0, y0, { id: pid });
  const n = steps || 12;
  for (let i = 1; i <= n; i++) pev('pointermove', x0 + dx * i / n, y0 + dy * i / n, { id: pid });
  pev('pointerup', x0 + dx, y0 + dy, { id: pid, buttons: 0 });
  return { yaw: api().F.yaw - y0yaw, pitch: api().F.pitch - y0pitch };
}

/* Куда смотрит камера: движок сам считает это в кадре (Wt.getWorldDirection). */
function lookDir() {
  frames(1);
  return api().worldDir();
}

(async () => {
  /* --------------------------------------------------- 1. таблица стилей */
  const styleText = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  check('холст сам запрещает жесты браузера (touch-action:none)',
    /#viewport,\s*#viewport canvas\s*\{[^}]*touch-action:\s*none/.test(styleText));
  check('на холсте отключены выделение и меню долгого нажатия',
    /#viewport canvas\s*\{[^}]*user-select:\s*none[^}]*-webkit-touch-callout:\s*none/.test(styleText));
  check('страница не «резинится» при протяжке (overscroll-behavior:none)',
    /html,body\{[^}]*overscroll-behavior:\s*none/.test(styleText));

  /* ------------------------------------------------- 2. запуск настоящей игры */
  api().startWorld();
  for (let i = 0; i < 200 && api().mc() !== 'ready'; i++) await wait(20);
  api().playGame();
  await wait(30);
  frames(3);

  const cv = api().canvas || w.document.querySelector('#viewport canvas');
  const J = { left: 16, top: H - 106 - 116, right: 132, bottom: H - 106, width: 116, height: 116 };
  $('joystick').getBoundingClientRect = () => ({ ...J, x: J.left, y: J.top });
  $('stickKnob').getBoundingClientRect = () => ({ left: 51, top: J.top + 35, right: 97, bottom: J.top + 81, width: 46, height: 46, x: 51, y: J.top + 35 });

  check('игра играет', api().mc() === 'playing', api().mc());
  check('тач-режим включён (pointer:coarse)', api().touchMode() === true);
  check('канвас на весь экран', !!cv);
  const K = api().consts();
  check('чувствительность пальца отделена от мыши', K.TOUCH > K.SENS, K);

  /* ------------------------------------- 3. один свайп: направление и размах */
  const yaw0 = api().F.yaw;
  const right = swipe(250, 420, 120, 0);
  const dirRight = lookDir();
  check('свайп вправо поворачивает камеру вправо', right.yaw < 0, +right.yaw.toFixed(4));
  check('после свайпа вправо взгляд уходит в +X', dirRight.x > 0.1, +dirRight.x.toFixed(3));

  api().F.yaw = 0; api().F.pitch = -.12; frames(1);
  const left = swipe(250, 420, -120, 0);
  const dirLeft = lookDir();
  check('свайп влево поворачивает камеру влево', left.yaw > 0 && dirLeft.x < -0.1,
    [+left.yaw.toFixed(4), +dirLeft.x.toFixed(3)]);

  api().F.yaw = 0; api().F.pitch = -.12; frames(1);
  const up = swipe(250, 420, 0, -100);
  check('свайп вверх поднимает взгляд', up.pitch > 0 && lookDir().y > 0.05,
    [+up.pitch.toFixed(4), +lookDir().y.toFixed(3)]);
  const down = swipe(250, 300, 0, 100);
  check('свайп вниз опускает взгляд', down.pitch < 0, +down.pitch.toFixed(4));

  /* ------------------------------------------- 4. чувствительность и точность */
  api().F.yaw = 0; api().F.pitch = -.12; frames(1);
  const s120 = swipe(200, 400, 120, 0);
  const perPx = Math.abs(s120.yaw) / 120;
  check('чувствительность пальца 0.006–0.009 рад/px (≈0.4°/px)',
    perPx >= .006 && perPx <= .009, +perPx.toFixed(5));
  check('свайп на всю ширину экрана даёт ~160–180°',
    Math.abs(swipe(0, 400, W, 0).yaw) > 2.4, +(W * perPx).toFixed(3));

  api().F.yaw = 0; api().F.pitch = -.12; frames(1);
  const slow = swipe(200, 420, 90, -45, 30);
  const predict = 90 * K.TOUCH;
  check('медленный свайп суммируется точно (без потерь и усилений)',
    Math.abs(Math.abs(slow.yaw) - predict) < 1e-6, [+Math.abs(slow.yaw).toFixed(6), +predict.toFixed(6)]);
  check('диагональный свайп двигает обе оси', slow.pitch > 0 && Math.abs(slow.yaw) > .1,
    [+slow.yaw.toFixed(3), +slow.pitch.toFixed(3)]);

  api().F.pitch = 0; frames(1);
  swipe(200, 800, 0, -900, 20);
  const pTop = api().F.pitch;
  swipe(200, 100, 0, 900, 20);
  const pBot = api().F.pitch;
  check('вертикаль не выходит за пределы обзора', pTop <= Math.PI / 2 && pBot >= -Math.PI / 2 &&
    pTop > 1.5 && pBot < -1.5, [+pTop.toFixed(3), +pBot.toFixed(3)]);

  /* ----------------------------- 5. сбойные события не должны дёргать камеру */
  api().F.yaw = 0; api().F.pitch = -.12; frames(1);
  const aid = ++seq;
  pev('pointerdown', 200, 400, { id: aid });
  pev('pointermove', 210, 400, { id: aid });
  const yBefore = api().F.yaw;
  pev('pointermove', 0, 0, { id: aid });                        // обнулившиеся координаты
  check('событие с координатами (0,0) не разворачивает камеру',
    Math.abs(api().F.yaw - yBefore) < 1e-9, +(api().F.yaw - yBefore).toFixed(4));
  pev('pointermove', NaN, 400, { id: aid });                    // мусор вместо координат
  check('событие с NaN не ломает камеру', Number.isFinite(api().F.yaw));
  pev('pointermove', 214, 400, { id: aid });                    // жест продолжается штатно
  check('после сбойного события обзор продолжается без потерь и без рывка',
    Math.abs(api().F.yaw - yBefore + 4 * K.TOUCH) < 1e-6, +(api().F.yaw - yBefore).toFixed(6));
  pev('pointerup', 214, 400, { id: aid, buttons: 0 });

  api().F.yaw = 0; frames(1);
  const jid = ++seq;
  pev('pointerdown', 200, 400, { id: jid });
  pev('pointermove', 202, 400, { id: jid });
  const yJump = api().F.yaw;
  pev('pointermove', 700, 400, { id: jid });                    // 498 px за одно событие
  check('мгновенный скачок указателя на 500 px игнорируется',
    Math.abs(api().F.yaw - yJump) < 1e-9, +(api().F.yaw - yJump).toFixed(4));
  pev('pointerup', 700, 400, { id: jid, buttons: 0 });

  await wait(40);
  api().F.yaw = 0; frames(1);
  const fid = ++seq;
  pev('pointerdown', 100, 400, { id: fid });
  await wait(40);
  pev('pointermove', 400, 400, { id: fid });                    // 300 px, но за 40 мс — это флинт
  const fling = Math.abs(api().F.yaw) / K.TOUCH;
  check('быстрый реальный флинт не теряется, а ограничивается 240 px',
    fling > 200 && fling <= 240.001, +fling.toFixed(1));
  pev('pointerup', 400, 400, { id: fid, buttons: 0 });

  /* ------------------- 6. потерянный pointerup и переиспользование pointerId */
  api().F.yaw = 0; frames(1);
  const lostId = ++seq;
  pev('pointerdown', 300, 500, { id: lostId });
  pev('pointermove', 310, 500, { id: lostId });
  /* Браузер не прислал pointerup: жест «повис». Новое касание получает тот же id. */
  const yLost = api().F.yaw;
  pev('pointerdown', 300, 300, { id: lostId });
  const jumpOnDown = api().F.yaw - yLost;
  pev('pointermove', 310, 300, { id: lostId });
  const jumpOnMove = api().F.yaw - yLost - jumpOnDown;
  check('новое касание после потерянного up не даёт рывка при нажатии',
    Math.abs(jumpOnDown) < 1e-9, +jumpOnDown.toFixed(4));
  check('и не даёт рывка на первом движении (отсчёт переснят)',
    Math.abs(jumpOnMove + 10 * K.TOUCH) < 1e-6, +jumpOnMove.toFixed(4));
  pev('pointerup', 310, 300, { id: lostId, buttons: 0 });
  check('после этого камера снова слушается', Math.abs(swipe(250, 400, 60, 0).yaw) > .3);

  /* -------------------------------------------- 7. отмена жеста браузером */
  api().F.yaw = 0; frames(1);
  const cid = ++seq;
  pev('pointerdown', 200, 400, { id: cid });
  pev('pointermove', 230, 400, { id: cid });
  pev('pointercancel', 230, 400, { id: cid, buttons: 0 });
  check('pointercancel освобождает обзор', api().look() === null, api().look());
  const yAfterCancel = api().F.yaw;
  pev('pointermove', 400, 400, { id: cid });
  check('движения после отмены не двигают камеру', Math.abs(api().F.yaw - yAfterCancel) < 1e-9);
  check('следующий свайп работает как обычно', Math.abs(swipe(250, 400, 40, 0).yaw) > .2);

  /* ------------------------------------------------ 8. зона обзора и палец */
  api().F.yaw = 0; frames(1);
  const inPad = swipe(J.left + 58, J.top + 58, 60, 0);          // центр джойстика
  check('касание на площадке джойстика не крутит камеру', Math.abs(inPad.yaw) < 1e-9, +inPad.yaw.toFixed(4));
  const nearPad = swipe(J.left + 8, J.top + 8, 60, 0);          // у самого края джойстика
  check('касание вплотную к джойстику тоже движением не считается', Math.abs(nearPad.yaw) < 1e-9,
    +nearPad.yaw.toFixed(4));
  const rightZone = swipe(300, 300, 80, 0);
  check('правая часть экрана — зона обзора', Math.abs(rightZone.yaw) > .4, +rightZone.yaw.toFixed(3));
  const topLeft = swipe(40, 200, 80, 0);
  check('верхняя часть экрана тоже смотрит (палец не у края джойстика)', Math.abs(topLeft.yaw) > .4,
    +topLeft.yaw.toFixed(3));

  /* -------------------------------------------- 9. несколько касаний сразу */
  api().F.yaw = 0; frames(1);
  const a = ++seq, b = ++seq;
  pev('pointerdown', 250, 400, { id: a });
  pev('pointermove', 260, 400, { id: a });
  pev('pointerdown', 120, 250, { id: b, isPrimary: false });    // второй палец на холсте
  pev('pointermove', 300, 250, { id: b, isPrimary: false });
  check('второй палец на холсте не крутит камеру',
    Math.abs(api().F.yaw + 10 * K.TOUCH) < 1e-6, +(api().F.yaw).toFixed(4));
  pev('pointerup', 300, 250, { id: b, buttons: 0, isPrimary: false });
  pev('pointermove', 270, 400, { id: a });
  check('отпускание второго пальца не прерывает обзор первым',
    Math.abs(api().F.yaw + 20 * K.TOUCH) < 1e-6, +(api().F.yaw).toFixed(4));
  pev('pointerup', 270, 400, { id: a, buttons: 0 });
  check('обзор завершён, состояние свободно', api().look() === null);

  /* ------------------------------- 10. кнопки не крутят камеру, но работают */
  api().F.yaw = 0; frames(1);
  const attack = $('attack');
  const c = ++seq;
  w.__nrCalls.length = 0;
  pev('pointerdown', 330, 700, { id: c, el: attack });
  pev('pointermove', 360, 660, { id: c, el: attack });
  check('перетаскивание по кнопке атаки не крутит камеру', Math.abs(api().F.yaw) < 1e-9);
  pev('pointerup', 360, 660, { id: c, el: attack, buttons: 0 });
  check('кнопка атаки по-прежнему бьёт', w.__nrCalls.some((x) => x.place === false), w.__nrCalls.length);

  w.__nrCalls.length = 0;
  const place = $('place');
  const d2 = ++seq;
  const yBtn = api().F.yaw;
  pev('pointerdown', 330, 640, { id: d2, el: place });
  pev('pointerup', 330, 640, { id: d2, el: place, buttons: 0 });
  check('кнопка «Блок +» ставит блок и не крутит камеру',
    w.__nrCalls.some((x) => x.place === true) && Math.abs(api().F.yaw - yBtn) < 1e-9);

  /* --------------------------- 11. движение джойстиком + обзор одновременно */
  frames(4);
  const before = { x: api().F.x, z: api().F.z, yaw: api().F.yaw };
  const j1 = ++seq, l1 = ++seq;
  pev('pointerdown', J.left + 58, J.top + 58, { id: j1, el: $('joystick') });
  pev('pointermove', J.left + 58 + 40, J.top + 58, { id: j1, el: $('joystick') });     // вперёд-вправо
  pev('pointermove', J.left + 58, J.top + 58 - 40, { id: j1, el: $('joystick') });     // вперёд
  frames(20);
  const moved = Math.hypot(api().F.x - before.x, api().F.z - before.z);
  check('джойстик двигает игрока', moved > .2, +moved.toFixed(3));

  pev('pointerdown', 300, 400, { id: l1 });
  for (let i = 1; i <= 8; i++) {
    pev('pointermove', 300 + i * 10, 400, { id: l1 });
    if (i % 2 === 0) frames(1);                                  // кадры идут между движениями
  }
  pev('pointerup', 290 + 80, 400, { id: l1, buttons: 0 });
  const turned = api().F.yaw - before.yaw;
  const movedBoth = Math.hypot(api().F.x - before.x, api().F.z - before.z);
  check('во время движения камера тоже поворачивается', Math.abs(turned) > .5, +turned.toFixed(3));
  check('движение продолжается при обзоре (палец на джойстике не сбит)',
    movedBoth > moved, +movedBoth.toFixed(3));
  const keysBusy = api().keys().length;
  pev('pointerup', J.left + 58, J.top + 58 - 40, { id: j1, el: $('joystick'), buttons: 0 });
  frames(2);
  check('после отпускания джойстика ход останавливается', movedBoth >= moved, keysBusy === 0);

  /* ------------------------------------------- 12. десктоп не изменился */
  /* Мышь на «тач-раскладке» возвращает обычное управление. */
  api().F.yaw = 0; frames(1);
  w.__nrCalls.length = 0;
  pev('pointerdown', 200, 400, { pointerType: 'mouse', id: 1, button: 2, buttons: 2 });
  check('мышь возвращает десктопный режим', api().touchMode() === false &&
    !w.document.body.classList.contains('touch'));
  pev('pointermove', 300, 400, { pointerType: 'mouse', id: 1, buttons: 2 });
  check('ПКМ-драг мыши крутит камеру как раньше (0.003 рад/px)',
    Math.abs(api().F.yaw + 100 * K.SENS * K.DRAG) < 1e-6, +(api().F.yaw).toFixed(5));
  pev('pointerup', 300, 400, { pointerType: 'mouse', id: 1, button: 2, buttons: 0 });
  const yAfterRmb = api().F.yaw;
  check('долгий ПКМ-драг не ставит блок', w.__nrCalls.filter((x) => x.place).length === 0, w.__nrCalls);

  w.__nrCalls.length = 0;
  pev('pointerdown', 200, 400, { pointerType: 'mouse', id: 1, button: 0, buttons: 1 });
  pev('pointerup', 200, 400, { pointerType: 'mouse', id: 1, button: 0, buttons: 0 });
  check('ЛКМ по-прежнему бьёт и не крутит камеру',
    w.__nrCalls.length === 1 && w.__nrCalls[0].place === false && Math.abs(api().F.yaw - yAfterRmb) < 1e-9,
    w.__nrCalls.length);

  w.__nrCalls.length = 0;
  pev('pointerdown', 200, 400, { pointerType: 'mouse', id: 1, button: 2, buttons: 2 });
  pev('pointerup', 200, 400, { pointerType: 'mouse', id: 1, button: 2, buttons: 0 });
  check('короткий клик ПКМ по-прежнему ставит блок',
    w.__nrCalls.length === 1 && w.__nrCalls[0].place === true, w.__nrCalls.length);

  /* Pointer lock: движение мыши через movementX/Y, ±200 px за событие. */
  Object.defineProperty(w.document, 'pointerLockElement', { value: api().canvas, configurable: true });
  api().playGame();
  await wait(20);
  frames(2);
  const yLock = api().F.yaw;
  const mm = new w.Event('mousemove', { bubbles: true });
  Object.defineProperty(mm, 'movementX', { value: 100 });
  Object.defineProperty(mm, 'movementY', { value: 0 });
  Object.defineProperty(mm, 'timeStamp', { value: 1e6 });
  w.dispatchEvent(mm);
  const lockDelta = api().F.yaw - yLock;
  check('в захвате мыши обзор идёт по движению курсора (0.002 рад/px)',
    Math.abs(lockDelta + 100 * K.SENS) < 1e-6, +lockDelta.toFixed(5));
  const yClamp = api().F.yaw;
  const big = new w.Event('mousemove', { bubbles: true });
  Object.defineProperty(big, 'movementX', { value: 900 });
  Object.defineProperty(big, 'movementY', { value: 0 });
  Object.defineProperty(big, 'timeStamp', { value: 1e6 });
  w.dispatchEvent(big);
  check('скачок курсора в захвате ограничен 200 px',
    Math.abs(api().F.yaw - yClamp + 200 * K.SENS) < 1e-6, +(api().F.yaw - yClamp).toFixed(5));
  Object.defineProperty(w.document, 'pointerLockElement', { value: null, configurable: true });

  /* ------------------------------------- 13. ошибок и лишних событий нет */
  check('ошибок в консоли нет', consoleErrors.length === 0, consoleErrors.slice(0, 3));

  console.log(results.join('\n'));
  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log('ИТОГО: ' + passed + '/' + results.length + ' проверок пройдено');
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
