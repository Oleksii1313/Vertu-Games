#!/usr/bin/env node
/*
 * Мобильный экран MiniCraft 3D: холст на всю видимую область и полный экран.
 *
 * Проверяется настоящая страница игры в jsdom:
 *   • размер поля берётся из visualViewport, с запасными путями (innerWidth,
 *     clientWidth) — холст не превращается в полоску и не оставляет поля;
 *   • пропорции камеры всегда равны пропорциям холста в портрете, ландшафте,
 *     на разных телефонах и на компьютере;
 *   • поворот экрана, resize и visualViewport пересчитывают размер;
 *   • кнопка полного экрана включает Fullscreen API, а если браузер его не
 *     умеет — режим «погружения» (body.mcx-faux-fs) без поломки игры;
 *   • CSS: 100dvh, сохранение safe-area у джойстика, кнопок, хотбара и HUD.
 *
 *     NODE_PATH=/tmp/dom/node_modules node tools/test_minicraft_fullscreen.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const HTML = process.env.MINICRAFT_HTML
  || path.join(__dirname, '..', 'games', 'minicraft.html');
const html = fs.readFileSync(HTML, 'utf8');

const vc = new VirtualConsole();
const consoleErrors = [];
vc.on('jsdomError', (e) => { if (!/navigation|Not implemented/.test(e.message)) consoleErrors.push('[jsdom] ' + e.message); });
vc.on('error', (...a) => consoleErrors.push('[error] ' + a.join(' ')));

const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/games/minicraft.html', virtualConsole: vc });
const w = dom.window;

const C = {
  VERSION: 7938, MAX_TEXTURE_SIZE: 3379, MAX_VIEWPORT_DIMS: 3386,
  MAX_TEXTURE_IMAGE_UNITS: 34930, MAX_VERTEX_TEXTURE_IMAGE_UNITS: 35660,
  MAX_COMBINED_TEXTURE_IMAGE_UNITS: 35661, MAX_VERTEX_ATTRIBS: 34921,
  MAX_VERTEX_UNIFORM_VECTORS: 36347, MAX_VARYING_VECTORS: 36348,
  MAX_FRAGMENT_UNIFORM_VECTORS: 36349, MAX_CUBE_MAP_TEXTURE_SIZE: 34076,
  MAX_SAMPLES: 36183, SHADING_LANGUAGE_VERSION: 35724, MAX_TEXTURE_MAX_ANISOTROPY_EXT: 34047
};
function fakeGL(canvas) {
  const ext = { EXT_texture_filter_anisotropic: { MAX_TEXTURE_MAX_ANISOTROPY_EXT: 34047 }, OES_texture_float_linear: {},
    WEBGL_lose_context: { loseContext() {} }, EXT_color_buffer_float: {}, EXT_blend_minmax: {}, EXT_frag_depth: {},
    WEBGL_depth_texture: {}, OES_vertex_array_object: {} };
  const target = {
    canvas, drawingBufferWidth: 1280, drawingBufferHeight: 720,
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
    getExtension(name) { return ext[name] || null; },
    getSupportedExtensions() { return Object.keys(ext); },
    getShaderPrecisionFormat() { return { precision: 23, rangeMin: 127, rangeMax: 127 }; },
    getContextAttributes() { return { alpha: true, antialias: false, depth: true, stencil: true }; },
    isContextLost() { return false; },
    createShader() { return {}; }, createProgram() { return {}; }, createBuffer() { return {}; },
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
Object.defineProperty(w, 'innerWidth', { value: 1280, configurable: true });
Object.defineProperty(w, 'innerHeight', { value: 720, configurable: true });
Object.defineProperty(w, 'devicePixelRatio', { value: 1, configurable: true });
w.matchMedia = w.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));

const posted = [];
w.parent = { postMessage(msg, origin) { posted.push(msg); }, window: w };

/* Очередь кадров как в браузере: у игры и у модуля стройки свои колбэки. */
let rafQueue = [], rafTs = 0;
w.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };
w.cancelAnimationFrame = () => {};
function frames(n, dtMs = 17) {
  for (let i = 0; i < n; i++) {
    rafTs += dtMs;
    const queue = rafQueue;
    rafQueue = [];
    if (!queue.length) break;
    for (const cb of queue) cb(rafTs);
  }
}

const results = [];
function check(name, ok, extra) {
  results.push((ok ? 'PASS' : 'FAIL') + ' · ' + name +
    (extra === undefined ? '' : ' → ' + JSON.stringify(extra).slice(0, 240)));
}

/* visualViewport: jsdom его не реализует, а игра на него опирается. */
const vvHandlers = {};
w.visualViewport = {
  width: 390, height: 844, offsetLeft: 0, offsetTop: 0, scale: 1,
  addEventListener(type, fn) { (vvHandlers[type] = vvHandlers[type] || []).push(fn); },
  removeEventListener() {}
};
const roCallbacks = [];
w.ResizeObserver = function (cb) {
  roCallbacks.push(cb);
  this.observe = function () {};
  this.unobserve = function () {};
  this.disconnect = function () {};
};

const openTag = '<script id="minicraft-runtime">';
let runtime = html.slice(html.indexOf(openTag) + openTag.length, html.indexOf('</script>', html.indexOf(openTag)));
const idx = runtime.lastIndexOf('\n})();');
runtime = runtime.slice(0, idx) + `
window.__mcx = () => ({
  startWorld: Kh, playGame: Zl, mc: () => Mt, canvas: () => Xe && Xe.domElement,
  cam: () => Wt, fit: () => mcxFitViewport(), measure: () => mcxMeasure(),
  stage: () => ({ w: mcxStage.w, h: mcxStage.h, l: mcxStage.l, t: mcxStage.t }),
  toggleFs: () => mcxToggleFullscreen(), faux: () => mcxFauxFs,
  fsActive: () => mcxFsActive(), fsSupported: () => mcxFsSupported(),
  watch: () => mcxWatchSize(), touch: () => fn
});
` + runtime.slice(idx);
w.eval(runtime);

const api = () => w.__mcx();
const $ = (id) => w.document.getElementById(id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const styleText = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));

/* Размер экрана как у настоящего браузера: innerWidth/Height + visualViewport. */
function setScreen(width, height) {
  Object.defineProperty(w, 'innerWidth', { value: width, configurable: true });
  Object.defineProperty(w, 'innerHeight', { value: height, configurable: true });
  Object.defineProperty(w.visualViewport, 'width', { value: width, configurable: true });
  Object.defineProperty(w.visualViewport, 'height', { value: height, configurable: true });
}

(async () => {
  /* --------------------------------------------------- 1. CSS экрана игры */
  check('мета-вьюпорт учитывает вырез (viewport-fit=cover)',
    /name="viewport"[^>]*viewport-fit=cover/.test(html));
  check('страница и холст тянутся на 100dvh',
    /html,body\{[^}]*min-height:100dvh/.test(styleText) && /#viewport\{[^}]*height:100dvh/.test(styleText));
  check('холст занимает всю рамку без полей и фиксированных размеров',
    /#viewport canvas\{[^}]*width:100%!important[^}]*height:100%!important/.test(styleText),
    (styleText.match(/#viewport canvas\{[^}]*\}/) || [''])[0].slice(0, 120));
  check('у сцены нет собственных отступов и рамок',
    /#viewport\{[^}]*left:0[^}]*top:0[^}]*overscroll-behavior:none/.test(styleText));
  check('кнопка полного экрана показывается и на компьютере, и на телефоне',
    /\.playing #fullscreen\{display:grid\}/.test(styleText));
  check('в полном экране лишние элементы страницы скрыты',
    /body\.mcx-fs \.brand\{display:none!important\}/.test(styleText));
  check('джойстик и кнопки учитывают safe-area',
    /#joystick\{[^}]*env\(safe-area-inset-left/.test(styleText) &&
    /\.actions\{[^}]*env\(safe-area-inset-right/.test(styleText) &&
    /\.actions\{[^}]*env\(safe-area-inset-bottom/.test(styleText));
  check('хотбар, HUD и кнопка экрана не залезают под панель браузера',
    /#hotbar[^{]*\{[^}]*env\(safe-area-inset-bottom/.test(styleText) &&
    /#fullscreen\{[^}]*env\(safe-area-inset-right/.test(styleText) &&
    /#fullscreen\{[^}]*env\(safe-area-inset-top/.test(styleText));
  check('перекрестие по центру экрана',
    /#crosshair\{[^}]*top:50%[^}]*left:50%/.test(styleText));

  /* ------------------------------------------------------ 2. запуск игры */
  api().watch();
  api().startWorld();
  for (let i = 0; i < 200 && api().mc() !== 'ready'; i++) await wait(20);
  api().playGame();
  await wait(30);
  frames(2);
  check('игра запустилась', api().mc() === 'playing', api().mc());
  check('наблюдатели размера подписаны один раз', (() => {
    api().watch();
    return roCallbacks.length === 1;
  })(), roCallbacks.length);
  check('visualViewport слушается (адресная строка и поворот)', !!vvHandlers.resize);

  /* ------------------------------------- 3. размеры на разных устройствах */
  const devices = [
    { name: 'iPhone 13 портрет', w: 390, h: 844 },
    { name: 'iPhone 13 ландшафт', w: 844, h: 390 },
    { name: 'Android 360×640', w: 360, h: 640 },
    { name: 'планшет 768×1024', w: 768, h: 1024 },
    { name: 'компьютер 1280×720', w: 1280, h: 720 }
  ];
  for (const dev of devices) {
    setScreen(dev.w, dev.h);
    api().fit();
    const cv = api().canvas();
    const cam = api().cam();
    const vp = $('viewport');
    check(dev.name + ': холст ровно во весь экран',
      cv.style.width === dev.w + 'px' && cv.style.height === dev.h + 'px',
      [cv.style.width, cv.style.height]);
    check(dev.name + ': сцена совпадает с холстом',
      vp.style.width === dev.w + 'px' && vp.style.height === dev.h + 'px',
      [vp.style.width, vp.style.height]);
    check(dev.name + ': пропорции камеры равны пропорциям холста',
      Math.abs(cam.aspect - dev.w / dev.h) < 0.001, +cam.aspect.toFixed(3));
    const st = api().stage();
    check(dev.name + ': поле измерено без нулей',
      st.w === dev.w && st.h === dev.h, st);
  }

  /* ---------------------------------- 4. поворот экрана и resize-события */
  setScreen(390, 844);
  api().fit();
  setScreen(844, 390);
  w.dispatchEvent(new w.Event('resize'));
  await wait(60);
  check('поворот в ландшафт: размер пересчитан по событию resize',
    api().canvas().style.width === '844px' && api().canvas().style.height === '390px',
    [api().canvas().style.width, api().canvas().style.height]);
  setScreen(390, 844);
  w.dispatchEvent(new w.Event('orientationchange'));
  await wait(120);
  check('возврат в портрет: размер снова во весь экран',
    api().canvas().style.width === '390px' && api().canvas().style.height === '844px',
    [api().canvas().style.width, api().canvas().style.height]);
  /* visualViewport: браузерная панель «съела» 90 px снизу. */
  Object.defineProperty(w.visualViewport, 'height', { value: 754, configurable: true });
  vvHandlers.resize.forEach((fn) => fn());
  await wait(60);
  check('visualViewport: холст подстраивается под видимую часть экрана',
    api().canvas().style.height === '754px', api().canvas().style.height);
  Object.defineProperty(w.visualViewport, 'height', { value: 844, configurable: true });
  api().fit();
  check('ResizeObserver пересчитывает размер',
    roCallbacks.length === 1 && typeof roCallbacks[0] === 'function');
  roCallbacks[0]();
  await wait(60);
  check('после вызова наблюдателя размер остался полным',
    api().canvas().style.height === '844px', api().canvas().style.height);

  /* ---------------------------------- 5. настоящий Fullscreen API */
  const vp = $('viewport');
  const btn = $('fullscreen');
  let asked = 0, opts = null;
  Object.defineProperty(w.document, 'fullscreenEnabled', { value: true, configurable: true });
  vp.requestFullscreen = (o) => { asked++; opts = o; return Promise.resolve(); };
  check('кнопка полного экрана видна в игре', !!btn && !btn.hasAttribute('hidden'));
  btn.onclick({ preventDefault() {}, stopPropagation() {} });
  await wait(60);
  check('кнопка просит настоящий полный экран с navigationUI:hide',
    asked === 1 && opts && opts.navigationUI === 'hide', [asked, opts]);
  Object.defineProperty(w.document, 'fullscreenElement', { value: vp, configurable: true });
  w.document.dispatchEvent(new w.Event('fullscreenchange'));
  await wait(160);
  check('режим полного экрана отмечен на странице',
    w.document.body.classList.contains('mcx-fs') && api().fsActive() === true);
  check('кнопка показывает состояние «выход»', btn.getAttribute('aria-pressed') === 'true');
  check('после входа в полный экран холст снова во весь экран',
    api().canvas().style.width === '390px' && api().canvas().style.height === '844px',
    [api().canvas().style.width, api().canvas().style.height]);
  check('игра не сломалась: состояние playing и тач-контролы на месте',
    api().mc() === 'playing' && w.document.body.classList.contains('playing'));
  Object.defineProperty(w.document, 'fullscreenElement', { value: null, configurable: true });
  w.document.dispatchEvent(new w.Event('fullscreenchange'));
  await wait(60);
  check('выход из полного экрана снимает режим',
    !w.document.body.classList.contains('mcx-fs') && api().fsActive() === false);

  /* ------------------------- 6. браузер без Fullscreen API: «погружение» */
  delete vp.requestFullscreen;
  delete vp.webkitRequestFullscreen;
  Object.defineProperty(w.document, 'fullscreenEnabled', { value: false, configurable: true });
  check('без Fullscreen API игра знает, что полный экран недоступен',
    api().fsSupported() === false);
  btn.onclick({ preventDefault() {}, stopPropagation() {} });
  await wait(320);
  check('вместо полного экрана включается режим «погружения»',
    api().faux() === true && w.document.body.classList.contains('mcx-faux-fs'),
    api().faux());
  check('в «погружении» игра всё равно во весь экран',
    api().canvas().style.width === '390px' && api().canvas().style.height === '844px',
    [api().canvas().style.width, api().canvas().style.height]);
  check('кнопка работает как переключатель', btn.getAttribute('aria-pressed') === 'true');
  btn.onclick({ preventDefault() {}, stopPropagation() {} });
  await wait(60);
  check('повторное нажатие выключает «погружение»',
    api().faux() === false && !w.document.body.classList.contains('mcx-faux-fs'));

  /* ------------------------------------ 7. элементы управления на месте */
  const ids = ['joystick', 'jump', 'crosshair', 'hotbar', 'mcx-hud', 'fullscreen'];
  check('джойстик, кнопки, перекрестие, хотбар и HUD есть в разметке',
    ids.every((id) => !!$(id)), ids.filter((id) => !$(id)));
  check('кнопки действий (прыжок/удар) не перекрывают хотбар по CSS',
    /\.actions\{[^}]*bottom:calc\(106px/.test(styleText) &&
    /\.touch #hotbar\{[^}]*bottom:calc\(16px/.test(styleText));

  /* ------------------------------------------------------- 8. без ошибок */
  check('нет ошибок jsdom', consoleErrors.length === 0, consoleErrors.slice(0, 3));

  results.forEach((line) => console.log(line));
  const passed = results.filter((r) => r.startsWith('PASS')).length;
  const failed = results.length - passed;
  console.log('\nИТОГО: ' + passed + '/' + results.length + ' проверок пройдено');
  if (failed) process.exitCode = 1;
})();
