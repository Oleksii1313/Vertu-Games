#!/usr/bin/env node
/*
 * Полный прогон «Космокухни» (chefs-rover) в jsdom с заглушкой WebGL.
 *
 * Проверяется именно собранная игра games/chefs-rover.html — тот файл, который
 * уходит игрокам, а не отдельная функция:
 *
 *   1. игра запускается и не показывает «Техническую остановку»;
 *   2. WebGL-сцена действительно создана и отрисована (флаг __roverReady);
 *   3. setPointerCapture не может уронить игру — ни на канвасе, ни на кнопках,
 *      даже если браузер бросает InvalidStateError;
 *   4. камера вращается правой кнопкой мыши, влево/вправо и вверх/вниз;
 *   5. отпускание ПКМ сразу прекращает вращение;
 *   6. ЛКМ остаётся игровым кликом и не крутит камеру;
 *   7. колесо приближает/отдаляет в пределах контекста;
 *   8. клавиатура (WASD) двигает персонажа, потеря фокуса всё сбрасывает;
 *   9. язык RU/EN переключается через ?lang=en и через сообщение плеера;
 *  10. монеты (#balance) отображаются и восстанавливаются после «перезагрузки»;
 *  11. вертикаль ограничена — камера не переворачивается.
 *
 *     NODE_PATH=/tmp/dom/node_modules node tools/test_chefs_rover.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'games/chefs-rover.html');
const HTML = fs.readFileSync(FILE, 'utf8');

let passed = 0;
const failures = [];
function check(name, ok, extra) {
  if (ok) passed++;
  else failures.push(name + (extra === undefined ? '' : ' → ' + JSON.stringify(extra)));
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const near = (a, b, eps) => Math.abs(a - b) <= (eps === undefined ? 1e-6 : eps);

/* --------------------------------------------------- заглушки WebGL и canvas */
const GL_CONSTANTS = {
  VERSION: 7938, MAX_TEXTURE_SIZE: 3379, MAX_VIEWPORT_DIMS: 3386, MAX_TEXTURE_IMAGE_UNITS: 34930,
  MAX_VERTEX_TEXTURE_IMAGE_UNITS: 35660, MAX_COMBINED_TEXTURE_IMAGE_UNITS: 35661, MAX_VERTEX_ATTRIBS: 34921,
  MAX_VERTEX_UNIFORM_VECTORS: 36347, MAX_VARYING_VECTORS: 36348, MAX_FRAGMENT_UNIFORM_VECTORS: 36349,
  MAX_CUBE_MAP_TEXTURE_SIZE: 34076, MAX_SAMPLES: 36183, SHADING_LANGUAGE_VERSION: 35724,
  MAX_TEXTURE_MAX_ANISOTROPY_EXT: 34047,
};
function fakeGL(canvas) {
  const ext = {
    EXT_texture_filter_anisotropic: { MAX_TEXTURE_MAX_ANISOTROPY_EXT: 34047 }, OES_texture_float_linear: {},
    WEBGL_lose_context: { loseContext() {} }, EXT_color_buffer_float: {}, EXT_blend_minmax: {}, EXT_frag_depth: {},
    WEBGL_depth_texture: {}, OES_vertex_array_object: {}, WEBGL_multisampled_render_to_texture: {},
  };
  const target = {
    canvas, drawingBufferWidth: 1280, drawingBufferHeight: 720,
    getParameter(p) {
      if (p === 7938) return 'WebGL 2.0 (fake)';
      if (p === 35724) return 'WebGL GLSL ES 3.00 (fake)';
      if (p === 3386 || p === 3379 || p === 34076 || p === 32883) return [16384, 16384];
      if (p === 34921) return 16;
      if (p === 34930 || p === 35660 || p === 35661) return 16;
      if (p === 36347 || p === 36348 || p === 36349) return 1024;
      if (p === 36183) return 4;
      if (p === 7936 || p === 7937) return 'fake';
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
    getError() { return 0; }, readPixels() {},
  };
  return new Proxy(target, {
    get(t, p) {
      if (p in t) return t[p];
      if (p in GL_CONSTANTS) return GL_CONSTANTS[p];
      if (typeof p === 'string' && /^[A-Z0-9_]+$/.test(p)) return 1;
      return function () { return undefined; };
    },
  });
}
function fake2d(canvas) {
  const grad = { addColorStop() {} };
  const target = {
    canvas,
    createLinearGradient() { return grad; }, createRadialGradient() { return grad; },
    createPattern() { return null; }, measureText() { return { width: 10 }; },
    getImageData(x, y, w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; },
    putImageData() {}, createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; },
  };
  return new Proxy(target, {
    get(t, p) { if (p in t) return t[p]; return function () {}; },
    set(t, p, v) { t[p] = v; return true; },
  });
}

/* ------------------------------------------------------------ один запуск */
async function boot({ search = '', storage = null, frames = 40, capture = 'ok', gl = 'fake' } = {}) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { if (!/navigation|Not implemented/.test(e.message)) errors.push('[jsdom] ' + e.message); });
  vc.on('error', (...args) => errors.push('[console] ' + args.join(' ')));
  let rendered = 0;
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/games/chefs-rover.html' + search,
    virtualConsole: vc,
    beforeParse(w) {
      w.HTMLCanvasElement.prototype.getContext = function (type) {
        // gl: 'none' имитирует браузер без WebGL — экран ошибки обязан появиться.
        if (String(type).indexOf('webgl') === 0) return gl === 'none' ? null : fakeGL(this);
        return fake2d(this);
      };
      if (capture === 'throw') {
        /* Браузер бросает именно InvalidStateError, если указатель уже отпущен. */
        w.Element.prototype.setPointerCapture = function () {
          const error = new Error("Failed to execute 'setPointerCapture' on 'Element': InvalidStateError");
          error.name = 'InvalidStateError';
          throw error;
        };
        w.Element.prototype.hasPointerCapture = function () { return false; };
        w.Element.prototype.releasePointerCapture = function () {};
      }
      w.matchMedia = w.matchMedia || ((query) => ({
        matches: false, media: query, addEventListener() {}, removeEventListener() {},
        addListener() {}, removeListener() {},
      }));
      w.requestAnimationFrame = (cb) => {
        if (rendered++ > frames) return 0;
        return setTimeout(() => cb(w.performance.now()), 8);
      };
      w.addEventListener('error', (e) => errors.push('[window] ' + (e.message || e.error)));
      if (storage) for (const key of Object.keys(storage)) w.localStorage.setItem(key, storage[key]);
    },
  });
  const w = dom.window;
  for (let i = 0; i < 400 && !w.roverGame; i++) await wait(20);
  // Первый кадр рисуется уже после сборки сцены: дождёмся флага готовности.
  for (let i = 0; i < 100 && !w.__roverReady; i++) await wait(20);
  return { dom, w, errors, doc: w.document, renderedFrames: () => rendered };
}

/* --------------------------------------------------- события мыши и клавиш */
function pointer(w, target, type, { x = 100, y = 100, button = 0, pointerType = 'mouse', id = 1 } = {}) {
  const event = new w.MouseEvent(type, {
    bubbles: true, cancelable: true, clientX: x, clientY: y, button,
    buttons: type === 'pointerup' ? 0 : (button === 2 ? 2 : 1),
  });
  Object.defineProperty(event, 'pointerId', { value: id });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  target.dispatchEvent(event);
  return event;
}
function wheel(w, target, deltaY) {
  target.dispatchEvent(new w.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY, deltaMode: 0 }));
}
function key(w, type, code, keyName) {
  // В браузере клавиша приходит на сфокусированный элемент, поэтому шлём в body,
  // а не в document (у document нет matches()).
  w.document.body.dispatchEvent(new w.KeyboardEvent(type, { code, key: keyName || code.slice(-1).toLowerCase(), bubbles: true }));
}

/* ------------------------------------------------------------------- тесты */
(async () => {
  const boot1 = await boot();
  const w = boot1.w;
  const doc = boot1.doc;
  const game = w.roverGame;
  const overlay = doc.getElementById('error');

  /* ------------------------------------------------ 1–2. Запуск и WebGL */
  check('игра запускается: window.roverGame создан', typeof game === 'object' && game !== null, typeof game);
  check('нет ошибок запуска в консоли', boot1.errors.length === 0, boot1.errors.slice(0, 4));
  check('экран «Техническая остановка» скрыт', overlay.hidden === true, overlay.hidden);
  check('нет текста ошибки', doc.getElementById('errorText').textContent === '', doc.getElementById('errorText').textContent);
  check('сцена отрисована: флаг __roverReady', w.__roverReady === true, w.__roverReady);
  check('body помечен как готовый (data-ready)', doc.body.dataset.ready === '1', doc.body.dataset.ready);
  check('WebGL-рендерер создан', !!game.renderer && typeof game.renderer.render === 'function', !!game.renderer);
  check('канвас #world получил WebGL-контекст', !!doc.getElementById('world').getContext('webgl2'), true);
  check('сцена собрана из объектов', game.scene.children.length > 5, game.scene.children.length);
  check('мир и кухня на месте', !!game.cameras.world && !!game.cameras.kitchen && !!game.kitchen, null);
  check('кадры действительно рисуются', boot1.renderedFrames() > 1, boot1.renderedFrames());

  /* ------------------------------- 3. setPointerCapture не роняет игру */
  check('в игровой логике нет «сырых» вызовов setPointerCapture',
    !/(this\.element|\$\('work'\)|btn|stick|Ja)\.setPointerCapture\(/.test(HTML), null);
  check('камера захватывает указатель только внутри try/catch',
    /try \{\s*if \(el\.isConnected === false\) return false;[\s\S]{0,220}?el\.setPointerCapture\(id\);/.test(HTML), null);
  check('захват указателя идёт через безопасную обёртку', (HTML.match(/window\.__vgHold\(/g) || []).length === 3,
    (HTML.match(/window\.__vgHold\(/g) || []).length);

  game.start();
  check('игра переходит в режим playing', game.mode === 'playing', game.mode);

  /* ------------------------------------- 4–7. Камера, ПКМ, ЛКМ и колесо */
  const canvas = doc.getElementById('world');
  const state = () => game.camera.states[game.view === 'kitchen' ? 'kitchen' : (game.state.riding ? 'vehicle' : 'foot')];
  const yawStart = state().yaw;
  pointer(w, canvas, 'pointerdown', { x: 200, y: 200, button: 2 });
  for (let i = 1; i <= 4; i++) pointer(w, w, 'pointermove', { x: 200 + i * 30, y: 200, button: 2 });
  pointer(w, w, 'pointerup', { x: 320, y: 200, button: 2 });
  check('ПКМ вправо поворачивает камеру вправо', state().yaw > yawStart + 0.1, [state().yaw, yawStart]);
  const yawAfterRight = state().yaw;
  pointer(w, w, 'pointermove', { x: 900, y: 500, button: 2 });
  check('после отпускания ПКМ вращение прекращается', near(state().yaw, yawAfterRight), [state().yaw, yawAfterRight]);

  pointer(w, canvas, 'pointerdown', { x: 400, y: 200, button: 2, id: 5 });
  for (let i = 1; i <= 4; i++) pointer(w, w, 'pointermove', { x: 400 - i * 30, y: 200, button: 2, id: 5 });
  pointer(w, w, 'pointerup', { x: 280, y: 200, button: 2, id: 5 });
  check('ПКМ влево поворачивает камеру влево', state().yaw < yawAfterRight, [state().yaw, yawAfterRight]);

  const pitchStart = state().pitch;
  pointer(w, canvas, 'pointerdown', { x: 200, y: 300, button: 2, id: 6 });
  for (let i = 1; i <= 4; i++) pointer(w, w, 'pointermove', { x: 200, y: 300 - i * 20, button: 2, id: 6 });
  pointer(w, w, 'pointerup', { x: 200, y: 220, button: 2, id: 6 });
  check('ПКМ вверх поднимает взгляд', state().pitch > pitchStart, [state().pitch, pitchStart]);
  for (let i = 0; i < 30; i++) {
    pointer(w, canvas, 'pointerdown', { x: 200, y: 400, button: 2, id: 20 + i });
    pointer(w, w, 'pointermove', { x: 200, y: 400 - 60, button: 2, id: 20 + i });
    pointer(w, w, 'pointerup', { x: 200, y: 340, button: 2, id: 20 + i });
  }
  check('вертикаль ограничена сверху (нет переворота)', state().pitch <= 0.84 && state().pitch < Math.PI / 2 - 0.05, state().pitch);

  const yawBeforeClick = state().yaw;
  pointer(w, canvas, 'pointerdown', { x: 300, y: 300, button: 0, id: 40 });
  pointer(w, w, 'pointerup', { x: 300, y: 300, button: 0, id: 40 });
  check('ЛКМ-клик не крутит камеру', near(state().yaw, yawBeforeClick), [state().yaw, yawBeforeClick]);
  check('после клика указатели освобождены', game.camera.pointers.size === 0, game.camera.pointers.size);

  const distanceStart = state().distance;
  wheel(w, canvas, -120);
  check('колесо приближает камеру', state().distance < distanceStart, [state().distance, distanceStart]);
  for (let i = 0; i < 40; i++) wheel(w, canvas, -120);
  check('колесо ограничено снизу', state().distance >= 1.15 - 1e-9, state().distance);
  for (let i = 0; i < 40; i++) wheel(w, canvas, 240);
  check('колесо ограничено сверху', state().distance <= 20 + 1e-9, state().distance);

  /* -------------------------------------------- 8. Клавиатура и фокус */
  const before = { x: game.state.x, z: game.state.z };
  key(w, 'keydown', 'KeyW', 'w');
  for (let i = 0; i < 20; i++) game.update(0.05);
  key(w, 'keyup', 'KeyW', 'w');
  const moved = Math.hypot(game.state.x - before.x, game.state.z - before.z);
  check('WASD двигает персонажа', moved > 0.05, moved);
  const stopped = { x: game.state.x, z: game.state.z };
  for (let i = 0; i < 20; i++) game.update(0.05);
  check('после отпускания клавиши движение останавливается',
    Math.hypot(game.state.x - stopped.x, game.state.z - stopped.z) < 0.5, Math.hypot(game.state.x - stopped.x, game.state.z - stopped.z));

  /* Фокус уходит и при клике по панели плеера — игра не должна вставать на
     паузу, но нажатия обязаны сброситься, иначе управление «залипает». */
  pointer(w, canvas, 'pointerdown', { x: 150, y: 150, button: 2, id: 77 });
  w.dispatchEvent(new w.Event('blur'));
  check('потеря фокуса не ставит игру на паузу', game.mode === 'playing', game.mode);
  check('потеря фокуса сбрасывает нажатия', game.camera.pointers.size === 0, game.camera.pointers.size);
  const yawBlur = state().yaw;
  pointer(w, w, 'pointermove', { x: 600, y: 150, button: 2, id: 77 });
  check('после потери фокуса камера не крутится сама', near(state().yaw, yawBlur), [state().yaw, yawBlur]);
  // Скрытая вкладка — пауза (игра не должна идти в фоне).
  Object.defineProperty(w.document, 'hidden', { configurable: true, get: () => true });
  w.document.dispatchEvent(new w.Event('visibilitychange'));
  check('скрытая вкладка ставит игру на паузу', game.mode === 'paused', game.mode);
  Object.defineProperty(w.document, 'hidden', { configurable: true, get: () => false });
  game.start();
  check('после возврата на вкладку игра продолжается', game.mode === 'playing', game.mode);

  /* --------------------------------------------- 11. Монеты и перезагрузка */
  check('счётчик монет есть в шапке игры', !!doc.getElementById('balance'), null);
  game.state.earned = 42;
  game.update(0.6);
  check('монеты отображаются в игре', doc.getElementById('balance').textContent === '42', doc.getElementById('balance').textContent);
  w.dispatchEvent(new w.Event('pagehide'));
  const saved = w.localStorage.getItem('vg_rover_v1:solo');
  check('прогресс сохраняется в localStorage', !!saved && JSON.parse(saved).earned === 42, saved && saved.slice(0, 80));

  const boot2 = await boot({ storage: { 'vg_rover_v1:solo': saved } });
  const w2 = boot2.w;
  check('после перезагрузки прогресс восстановлен', !!w2.roverGame && w2.roverGame.state.earned === 42,
    w2.roverGame && w2.roverGame.state.earned);
  check('после перезагрузки монеты видны в шапке', w2.document.getElementById('balance').textContent === '42',
    w2.document.getElementById('balance').textContent);
  check('после перезагрузки нет «Технической остановки»', w2.document.getElementById('error').hidden === true,
    w2.document.getElementById('error').hidden);
  check('после перезагрузки игра запускается', w2.__roverReady === true && !!w2.roverGame, w2.__roverReady);

  /* ------------------------------------------------ 9. Язык RU/EN в игре */
  const boot3 = await boot({ search: '?lang=en' });
  const w3 = boot3.w;
  check('?lang=en включает английский', w3.document.documentElement.lang === 'en', w3.document.documentElement.lang);
  check('английский заголовок вступления', /Cosmic/i.test(w3.document.getElementById('introTitle').textContent || ''), 
    w3.document.getElementById('introTitle').textContent);
  check('игра на английском запускается без ошибок', !!w3.roverGame && boot3.errors.length === 0, boot3.errors.slice(0, 3));
  /* Сообщение player:lang от плеера игра принимает (i18n-рантайм меняет язык
     разметки). Полный перевод, включая названия рецептов и продуктов, плеер
     получает, перезапуская кадр с ?lang=ru|en — это проверяет
     tools/test_header_tiles.js. */
  const ruBoot = await boot({ search: '?lang=ru' });
  check('?lang=ru даёт русский язык', ruBoot.w.document.documentElement.lang === 'ru', ruBoot.w.document.documentElement.lang);
  check('русский заголовок вступления', /Космо/i.test(ruBoot.w.document.getElementById('introTitle').textContent || ''),
    ruBoot.w.document.getElementById('introTitle').textContent);
  check('русская разметка на месте (data-ru)', ruBoot.w.document.querySelectorAll('[data-ru]').length > 10,
    ruBoot.w.document.querySelectorAll('[data-ru]').length);
  w3.postMessage({ type: 'player:lang', lang: 'ru' }, '*');
  await wait(200);
  check('сообщение player:lang принимается игрой', !!w3.VG_I18N && w3.VG_I18N.lang() === 'ru',
    w3.VG_I18N && w3.VG_I18N.lang());

  /* ------------------- 3 (динамика). Захват падает — игра продолжается */
  const boot4 = await boot({ capture: 'throw', frames: 12 });
  const w4 = boot4.w;
  const game4 = w4.roverGame;
  check('игра запускается, даже если setPointerCapture всегда бросает', !!game4, typeof game4);
  check('экран остановки при этом не показан', w4.document.getElementById('error').hidden === true, w4.document.getElementById('error').hidden);
  check('ошибка захвата не попала в консоль запуска', boot4.errors.length === 0, boot4.errors.slice(0, 3));
  if (game4) {
    game4.start();
    const canvas4 = w4.document.getElementById('world');
    const state4 = () => game4.camera.states[game4.view === 'kitchen' ? 'kitchen' : (game4.state.riding ? 'vehicle' : 'foot')];
    const yaw4 = state4().yaw;
    let threw = null;
    try {
      pointer(w4, canvas4, 'pointerdown', { x: 200, y: 200, button: 2 });
      for (let i = 1; i <= 4; i++) pointer(w4, w4, 'pointermove', { x: 200 + i * 30, y: 200, button: 2 });
      pointer(w4, w4, 'pointerup', { x: 320, y: 200, button: 2 });
    } catch (e) { threw = String(e); }
    check('исключение захвата не вылетает из обработчиков', threw === null, threw);
    check('камера вращается даже без захвата указателя', state4().yaw > yaw4, [state4().yaw, yaw4]);
    // Кнопки управления: pointerdown + «потерянный» указатель.
    const stick = w4.document.getElementById('stick');
    const drive = w4.document.querySelector('[data-drive]');
    const work = w4.document.getElementById('work');
    let buttonThrew = null;
    try {
      if (stick) pointer(w4, stick, 'pointerdown', { x: 40, y: 40, pointerType: 'touch', id: 2 });
      if (drive) pointer(w4, drive, 'pointerdown', { x: 40, y: 40, pointerType: 'touch', id: 3 });
      if (work) pointer(w4, work, 'pointerdown', { x: 40, y: 40, pointerType: 'touch', id: 4 });
      pointer(w4, w4, 'pointerup', { x: 40, y: 40, pointerType: 'touch', id: 2 });
      pointer(w4, w4, 'pointercancel', { x: 40, y: 40, pointerType: 'touch', id: 3 });
    } catch (e) { buttonThrew = String(e); }
    check('кнопки/джойстик переживают отказ захвата', buttonThrew === null, buttonThrew);
    check('после отпускания вне кнопки состояние сброшено', !w4.document.querySelector('[data-drive].held'), null);
  }

  /* ------------------- Экран ошибки — настоящий сигнал, а не заглушка */
  const noGL = await boot({ gl: 'none', frames: 4 });
  const noGLDoc = noGL.w.document;
  check('без WebGL показывается «Техническая остановка»', noGLDoc.getElementById('error').hidden === false,
    noGLDoc.getElementById('error').hidden);
  check('в экране ошибки есть настоящая причина', /WebGL|context|contexto|Error/i.test(noGLDoc.getElementById('errorText').textContent),
    noGLDoc.getElementById('errorText').textContent.slice(0, 120));
  check('без WebGL сцена не объявляется готовой', !noGL.w.__roverReady, noGL.w.__roverReady);

  if (failures.length) console.log('ПРОВАЛЫ:\n  ' + failures.join('\n  '));
  console.log('ИТОГО: ' + passed + '/' + (passed + failures.length) + ' проверок пройдено');
  process.exit(failures.length ? 1 : 0);
})().catch((error) => {
  console.log('СБОЙ ТЕСТА: ' + (error && error.stack || error));
  process.exit(1);
});
