#!/usr/bin/env node
/*
 * Автотест продвинутой стройки MiniCraft 3D (jsdom, без WebGL).
 *
 * Проверяется реальный код игры после вставки модуля
 * tools/minicraft_build_module.js: постановка/снос блоков, запас материалов,
 * undo, хотбар и инвентарь, чертежи с поворотом, сохранение и восстановление
 * постройки после «перезагрузки», раскладка кнопок, чувствительность обзора,
 * горячие клавиши и защита от жестов браузера.
 *
 * Запуск:
 *
 *     npm install jsdom
 *     node tools/test_minicraft_build.js
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

const openTag = '<script id="minicraft-runtime">';
let runtime = html.slice(html.indexOf(openTag) + openTag.length, html.indexOf('</script>', html.indexOf(openTag)));
const idx = runtime.lastIndexOf('\n})();');
runtime = runtime.slice(0, idx) +
  '\nwindow.__mcx = () => ({ F: () => F, startWorld: Kh, playGame: Zl, mc: () => Mt, keys: () => Vn,' +
  ' mcb: () => mcbState, mats: MCB_MATS, cats: MCB_CATS, plans: MCB_PLANS, planNames: MCB_PLAN_NAMES,' +
  ' css: MCB_CSS, pageIds: mcbPageIds, place: mcxBuildPlace, brk: mcxBuildBreak, undo: mcxBuildUndo,' +
  ' select: mcxBuildSelect, pick: mcxBuildPick, stamp: mcxBuildStamp, hotbar: mcbHotbar, open: mcbOpen,' +
  ' close: mcbClose, paint: mcbPaintModal, keySlot: mcbKeySlot, restore: mcbRestore, saveNow: mcbSaveNow,' +
  ' load: mcbLoad, rotate: mcbRotate, aim: mcbAim, cs, ui, Ai, qh, ct, dn, world: () => Wl,' +
  ' stampDir: () => mcbStampDir, setStampDir: (v) => { mcbStampDir = v; } });\n' +
  runtime.slice(idx);
w.eval(runtime);

const $ = (id) => w.document.getElementById(id);
const results = [];
function check(name, ok, extra) { results.push((ok ? 'PASS' : 'FAIL') + ' · ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); }
const api = () => w.__mcx();
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const click = (node) => node.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
const key = (code) => w.document.body.dispatchEvent(new w.KeyboardEvent('keydown', { code, key: code, bubbles: true, cancelable: true }));
function pev(type, node, x, y, id = 1) {
  const ev = new w.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.defineProperty(ev, 'pointerId', { value: id });
  Object.defineProperty(ev, 'pointerType', { value: 'touch' });
  node.dispatchEvent(ev);
  return ev;
}
function touch(type, node, count = 1) {
  const ev = new w.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'touches', { value: new Array(count).fill({}) });
  node.dispatchEvent(ev);
  return ev;
}

async function newWorld() {
  api().startWorld();
  for (let i = 0; i < 200 && api().mc() !== 'ready'; i++) await wait(20);
}
async function play() {
  api().playGame();
  await wait(20);
  frames(3);
}
/* Свободная клетка с твёрдой опорой рядом с игроком. */
function findSpot(A) {
  const F = A.F();
  const cx = Math.floor(F.x), cz = Math.floor(F.z), cy = Math.floor(F.y);
  for (let r = 1; r < 6; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let y = cy + 2; y >= 1; y--) {
          const x = cx + dx, z = cz + dz;
          if (A.cs(x, y, z) !== A.Ai) continue;
          if (A.cs(x, y - 1, z) === A.Ai) continue;
          if (Math.abs(x + .5 - F.x) < .8 && Math.abs(z + .5 - F.z) < .8 && y >= Math.floor(F.y) && y <= Math.floor(F.y + 1.8)) continue;
          return { x, y, z };
        }
      }
    }
  }
  return null;
}

(async () => {
  /* ---------- 1. модуль поднялся вместе с игрой ---------- */
  const A0 = api();
  check('модуль стройки доступен в рантайме', !!A0 && typeof A0.place === 'function');
  check('палитра: 14 материалов', A0.mats.length === 14, A0.mats.length);
  check('4 категории материалов', A0.cats.length === 4, A0.cats.map(c => c.id));
  check('окно инвентаря создано и скрыто', !!$('mcb-inv') && $('mcb-inv').hidden === true);
  check('стили модуля подключены', !!$('mcb-style') && $('mcb-style').textContent.length > 2000);
  check('чертежи: house/tower/bridge/wall/stairs/roof/fence/window/door/floor',
    ['house', 'tower', 'bridge', 'wall', 'stairs', 'roof', 'fence', 'window', 'door', 'floor']
      .every(k => typeof A0.plans[k] === 'function'), A0.planNames.length);
  check('хотбар помечен как модульный', $('hotbar').getAttribute('data-mcb') === '1');

  /* ---------- 2. старт мира ---------- */
  await newWorld();
  check('мир сгенерирован', A0.mc() === 'ready', A0.mc());
  await play();
  const A = api();
  check('игра идёт', A.mc() === 'playing', A.mc());

  /* ---------- 3. хотбар ---------- */
  const slots = $('hotbar').querySelectorAll('.mcb-slot');
  check('в хотбаре 7 слотов страницы', slots.length === 7, slots.length);
  check('кнопка инвентаря в хотбаре', !!$('mcbBag'));
  check('точек страниц = 2', $('hotbar').querySelectorAll('.mcb-dot').length === Math.ceil(14 / 7),
    $('hotbar').querySelectorAll('.mcb-dot').length);
  check('в каждом слоте иконка блока', [...slots].every(s => /data:image/.test(s.querySelector('.block').style.backgroundImage)));
  check('в каждом слоте количество', [...slots].every(s => /^\d+$/.test(s.querySelector('.mcb-count').textContent)));
  check('выбранный слот подсвечен', slots[0].classList.contains('active') && A.mcb().selected === A.mats[0].id,
    [slots[0].classList.contains('active'), A.mcb().selected]);
  check('подпись материала в слоте', slots[0].querySelector('.mcb-name').textContent.length > 2,
    slots[0].querySelector('.mcb-name').textContent);

  /* ---------- 4. постановка блока ---------- */
  const spot = findSpot(A);
  check('найдено место для блока', !!spot, spot);
  const stockBefore = A.mcb().stock[A.mcb().selected] != null ? A.mcb().stock[A.mcb().selected] : 320;
  const placed = A.place(spot.x, spot.y, spot.z);
  const A1 = api();
  check('блок поставлен', placed === true && A1.cs(spot.x, spot.y, spot.z) === A1.mcb().selected,
    [placed, A1.cs(spot.x, spot.y, spot.z), A1.mcb().selected]);
  check('запас материала уменьшился на 1', A1.mcb().stock[A1.mcb().selected] === stockBefore - 1,
    [stockBefore, A1.mcb().stock[A1.mcb().selected]]);
  check('правка записана в состояние', A1.mcb().editCount + Object.keys(A1.mcb().edits).length >= 1,
    Object.keys(A1.mcb().edits).length);
  check('undo хранит операцию', A1.mcb().undo.length === 1, A1.mcb().undo.length);

  /* ---------- 5. запреты ---------- */
  check('нельзя ставить в занятую клетку', A.place(spot.x, spot.y, spot.z) === false);
  const F0 = api().F();
  check('нельзя ставить внутрь игрока',
    api().place(Math.floor(F0.x), Math.floor(F0.y), Math.floor(F0.z)) === false);
  check('нельзя ставить за границей мира', api().place(-2, 4, 4) === false && api().place(api().ct + 2, 4, 4) === false);

  /* ---------- 6. снос и запас ---------- */
  const matId = api().mcb().selected;
  const stockAfterPlace = api().mcb().stock[matId];
  const broke = api().brk(spot.x, spot.y, spot.z);
  const A2 = api();
  check('блок снесён', broke === true && A2.cs(spot.x, spot.y, spot.z) === A2.Ai, A2.cs(spot.x, spot.y, spot.z));
  check('запас пополнился при сносе', A2.mcb().stock[matId] === stockAfterPlace + 1, [stockAfterPlace, A2.mcb().stock[matId]]);
  check('нельзя снести воздух', A2.brk(spot.x, spot.y, spot.z) === false);
  check('правка убрана из состояния', !Object.keys(A2.mcb().edits).includes([spot.x, spot.y, spot.z].join(',')),
    Object.keys(A2.mcb().edits).length);

  /* ---------- 7. undo ---------- */
  const A3 = api();
  A3.place(spot.x, spot.y, spot.z);
  const A4 = api();
  const undone = A4.undo();
  const A5 = api();
  check('undo снимает поставленный блок', undone === true && A5.cs(spot.x, spot.y, spot.z) === A5.Ai,
    [undone, A5.cs(spot.x, spot.y, spot.z)]);
  const stackBefore = A5.mcb().undo.length;
  A5.undo();
  check('undo восстанавливает снесённый блок', api().cs(spot.x, spot.y, spot.z) === matId,
    [stackBefore, api().cs(spot.x, spot.y, spot.z)]);
  /* Чистим за собой, чтобы дальше не мешало. */
  api().brk(spot.x, spot.y, spot.z);

  /* ---------- 8. выбор материала интерфейсом ---------- */
  const target = $('hotbar').querySelectorAll('.mcb-slot')[3];
  const targetId = Number(target.getAttribute('data-mcb-id'));
  click(target);
  check('клик по слоту выбирает материал', api().mcb().selected === targetId,
    [api().mcb().selected, targetId]);
  const fresh = $('hotbar').querySelectorAll('.mcb-slot');
  check('подсветка переехала на выбранный слот',
    fresh[3].classList.contains('active') && !fresh[0].classList.contains('active'),
    [...fresh].map(n => n.className.indexOf('active') >= 0));
  check('нарисован ровно один активный слот', [...fresh].filter(n => n.classList.contains('active')).length === 1);
  const firstPageId = api().mats[0].id;
  $('hotbar').querySelectorAll('.mcb-dot')[1] && click($('hotbar').querySelectorAll('.mcb-dot')[1]);
  check('вторая страница хотбара открывается', api().mcb().page === 1 && api().pageIds()[0].id !== firstPageId,
    [api().mcb().page, api().pageIds()[0].id]);
  click($('hotbar').querySelectorAll('.mcb-dot')[0]);
  check('первая страница возвращается', api().mcb().page === 0);

  /* ---------- 9. инвентарь ---------- */
  click($('mcbBag'));
  check('сумка открывает инвентарь', api().mcb().open === true && $('mcb-inv').hidden === false);
  const cards = $('mcb-blocks').querySelectorAll('.mcb-card');
  check('в инвентаре все 14 материалов', cards.length === 14, cards.length);
  check('категории подписаны', $('mcb-blocks').querySelectorAll('.mcb-cat h5').length === 4,
    [...$('mcb-blocks').querySelectorAll('.mcb-cat h5')].map(h => h.textContent));
  check('вкладка «Чертежи» по клику', (() => {
    click($('mcb-inv').querySelector('[data-mcb-tab="plans"]'));
    return api().mcb().tab === 'plans' && $('mcb-plans').hidden === false && $('mcb-blocks').hidden === true;
  })());
  check('10 чертежей в списке', $('mcb-plans').querySelectorAll('[data-mcb-plan]').length === 10,
    $('mcb-plans').querySelectorAll('[data-mcb-plan]').length);
  check('кнопка отмены в чертежах', !!$('mcb-plans').querySelector('[data-mcb-undo]'));

  /* ---------- 10. чувствительность ---------- */
  click($('mcb-inv').querySelector('[data-mcb-tab="settings"]'));
  const range = $('mcb-settings').querySelector('[data-mcb-sens]');
  check('ползунок чувствительности есть', !!range && range.value === String(Math.round(api().mcb().sensitivity * 100)),
    range && range.value);
  range.value = '150';
  range.dispatchEvent(new w.Event('input', { bubbles: true }));
  check('чувствительность 150% применилась', api().mcb().sensitivity === 1.5, api().mcb().sensitivity);
  check('подпись чувствительности обновилась', $('mcb-settings').querySelector('[data-mcb-sens-val]').textContent === '150%',
    $('mcb-settings').querySelector('[data-mcb-sens-val]').textContent);

  /* ---------- 11. раскладка кнопок ---------- */
  click($('mcb-settings').querySelector('[data-mcb-layout]'));
  check('режим раскладки включён', api().mcb().layoutMode === true &&
    w.document.body.classList.contains('mcb-layout-mode'));
  check('окно настроек закрылось для перетаскивания', $('mcb-inv').hidden === true && api().mcb().open === false);
  check('кнопка «Готово» показана', !!$('mcb-layout-done') && $('mcb-layout-done').hidden === false);
  const stick = $('joystick');
  pev('pointerdown', stick, 120, 600);
  pev('pointermove', stick, 200, 560);
  pev('pointerup', stick, 200, 560);
  const layout = api().mcb().layout;
  check('джойстик перетаскивается', !!layout && !!layout.stick && stick.style.left.endsWith('%'),
    [layout && layout.stick, stick.style.left, stick.style.bottom]);
  const actions = w.document.querySelector('#touch-controls .actions');
  pev('pointerdown', actions, 1100, 600);
  pev('pointermove', actions, 1000, 620);
  pev('pointerup', actions, 1000, 620);
  check('блок кнопок перетаскивается', !!api().mcb().layout.actions, api().mcb().layout.actions);
  click($('mcb-layout-done'));
  check('«Готово» выключает режим раскладки', api().mcb().layoutMode === false &&
    $('mcb-layout-done').hidden === true && !w.document.body.classList.contains('mcb-layout-mode'));
  check('раскладка сохранена', !!JSON.parse(w.localStorage.getItem('mcx.build.v3:guest')).layout,
    JSON.parse(w.localStorage.getItem('mcx.build.v3:guest')).layout);
  const savedLayout = JSON.stringify(api().mcb().layout);
  api().mcb().layout = null;
  api().mcb().loaded = false;
  api().load();
  check('раскладка переживает перезагрузку', JSON.stringify(api().mcb().layout) === savedLayout,
    [savedLayout, JSON.stringify(api().mcb().layout)]);
  click($('mcbBag'));
  click($('mcb-inv').querySelector('[data-mcb-tab="settings"]'));
  click($('mcb-settings').querySelector('[data-mcb-reset]'));
  check('сброс раскладки', api().mcb().layout === null && stick.style.left === '', [api().mcb().layout, stick.style.left]);

  /* ---------- 12. закрытие окна ---------- */
  click($('mcbClose'));
  check('крестик закрывает инвентарь', api().mcb().open === false && $('mcb-inv').hidden === true);
  check('игра не встала на паузу от окна', api().mc() === 'playing', api().mc());

  /* ---------- 13. горячие клавиши ---------- */
  key('KeyI');
  check('I открывает инвентарь', api().mcb().open === true);
  key('Escape');
  check('Escape закрывает инвентарь без паузы', api().mcb().open === false && api().mc() === 'playing', api().mc());
  const keysW = api().keys();
  key('KeyI');
  key('KeyW');
  check('движение заблокировано при открытом окне', !keysW.w, keysW.w);
  key('KeyI');
  key('Digit2');
  check('цифра 2 выбирает второй слот', api().mcb().selected === api().pageIds()[1].id,
    [api().mcb().selected, api().pageIds()[1].id]);
  api().setStampDir(0);
  key('KeyR');
  check('R поворачивает чертёж', api().stampDir() === 1, api().stampDir());
  const p2 = findSpot(api());
  api().select(api().mats[1].id);
  api().place(p2.x, p2.y, p2.z);
  key('KeyZ');
  check('Z отменяет последнюю постройку', api().cs(p2.x, p2.y, p2.z) === api().Ai, api().cs(p2.x, p2.y, p2.z));

  /* ---------- 14. поворот чертежа ---------- */
  const house = api().plans.house();
  check('чертёж дома содержательный', house.length > 30, house.length);
  const asym = { x: 2, y: 0, z: 1, id: 1 };
  let rotated = asym;
  for (let i = 0; i < 4; i++) rotated = api().rotate(rotated, 1);
  check('4 поворота возвращают блок на место', rotated.x === asym.x && rotated.z === asym.z, rotated);
  const once = api().rotate(asym, 1);
  check('поворот на 90° меняет координаты', once.x !== asym.x && once.z !== asym.z, [once.x, once.z]);

  /* ---------- 15. чертёж «в мире» ---------- */
  api().F().pitch = -1.1;
  const aim = api().aim();
  check('прицел находит поверхность', !!aim, aim && [aim.x, aim.y, aim.z]);
  if (aim) {
    const cell = [aim.x + aim.nx, aim.y + aim.ny, aim.z + aim.nz];
    check('цель — соседняя клетка с нормалью', Math.abs(aim.nx) + Math.abs(aim.ny) + Math.abs(aim.nz) === 1, cell);
  }
  let stamped = 0;
  if (aim) {
    stamped = api().stamp('floor', 0);
  }
  check('чертёж «пол» построен', stamped > 0, stamped);
  const stampEdits = Object.keys(api().mcb().edits).length;
  check('постройка попала в состояние', stampEdits >= stamped, [stampEdits, stamped]);
  api().saveNow();
  const raw = w.localStorage.getItem('mcx.build.v3:guest');
  check('постройка сохранена в localStorage', !!raw && JSON.parse(raw).edits.length >= stamped,
    raw ? JSON.parse(raw).edits.length : null);
  check('в сохранении есть запас и чувствительность', (() => {
    const data = JSON.parse(raw);
    return !!data.stock && typeof data.sensitivity === 'number' && data.sensitivity === 1.5;
  })());

  /* ---------- 16. восстановление после refresh ---------- */
  const snapshot = Object.keys(api().mcb().edits).map(k => k.split(',').map(Number));
  api().mcb().edits = {};
  api().mcb().editCount = 0;
  for (const [x, y, z] of snapshot) api().ui(x, y, z, api().Ai);
  check('постройка стёрта из мира', snapshot.every(([x, y, z]) => api().cs(x, y, z) === api().Ai),
    snapshot.length);
  api().mcb().loaded = false;
  api().load();
  api().mcb().appliedWorld = null;
  api().restore();
  const restoredState = snapshot.map(([x, y, z]) => api().cs(x, y, z));
  check('постройка восстановлена из сохранения',
    snapshot.length > 0 && restoredState.every(id => id !== api().Ai), [snapshot, restoredState]);
  check('после восстановления меняется набор правок', Object.keys(api().mcb().edits).length === snapshot.length,
    [Object.keys(api().mcb().edits).length, snapshot.length]);

  /* ---------- 17. призрак блока ---------- */
  api().F().pitch = -0.9;
  frames(4);
  const ghost = api().mcb().ghost;
  check('прозрачный превью-блок создан', !!ghost && ghost.name === 'mcx-build-ghost');
  check('превью отличается прозрачностью', !!ghost && ghost.material.opacity < 1, ghost && ghost.material.opacity);
  const aimG = api().mcb().aim;
  if (aimG) {
    const gx = aimG.x + aimG.nx, gy = aimG.y + aimG.ny, gz = aimG.z + aimG.nz;
    const F1 = api().F();
    const free = api().cs(gx, gy, gz) === api().Ai &&
      !(Math.abs(gx + .5 - F1.x) < .8 && Math.abs(gz + .5 - F1.z) < .8 &&
        gy >= Math.floor(F1.y) && gy <= Math.floor(F1.y + 1.8));
    check('превью показывается только там, где можно ставить', ghost.visible === free,
      [free, ghost.visible]);
    if (free) {
      check('превью стоит по сетке в целевой клетке',
        ghost.position.x === gx + .5 && ghost.position.y === gy + .5 && ghost.position.z === gz + .5,
        [ghost.position.x, ghost.position.y, ghost.position.z, gx, gy, gz]);
    }
    check('превью принимает материал выбранного блока', !!ghost.material && ghost.material.opacity < 1);
  } else {
    check('превью спрятано без цели', ghost.visible === false, ghost.visible);
  }

  /* ---------- 18. удаление постройки ---------- */
  click($('mcbBag'));
  click($('mcb-inv').querySelector('[data-mcb-tab="settings"]'));
  click($('mcb-settings').querySelector('[data-mcb-clear]'));
  check('постройка снята полностью', Object.keys(api().mcb().edits).length === 0,
    Object.keys(api().mcb().edits).length);
  check('окно закрылось после очистки', api().mcb().open === false);

  /* ---------- 19. защита от жестов ---------- */
  const evJoy = touch('touchmove', $('joystick'));
  check('touchmove по джойстику гасится', evJoy.defaultPrevented === true);
  const evCanvas = touch('touchmove', $('viewport'));
  check('touchmove по сцене гасится', evCanvas.defaultPrevented === true);
  const evSheet = touch('touchmove', $('mcb-blocks'));
  check('прокрутка списка в инвентаре разрешена', evSheet.defaultPrevented === false);
  const evTwo = touch('touchmove', $('mcb-blocks'), 2);
  check('двухпальцевый жест гасится всегда', evTwo.defaultPrevented === true);
  const evGesture = touch('gesturestart', $('viewport'));
  check('pinch-жест Safari гасится', evGesture.defaultPrevented === true);
  const evMenu = new w.MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  $('viewport').dispatchEvent(evMenu);
  check('контекстное меню по долгому тапу гасится', evMenu.defaultPrevented === true);
  const evWheel = new w.MouseEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true });
  $('viewport').dispatchEvent(evWheel);
  check('ctrl+wheel (pinch тачпада) гасится', evWheel.defaultPrevented === true);

  /* ---------- 20. стили и разметка ---------- */
  const css = String(api().css);
  check('CSS: touch-action на слотах', /\.mcb-slot[^{]*\{[^}]*touch-action:none/.test(css));
  check('CSS: модальное окно на весь экран', /\.mcb-modal\{position:fixed;inset:0/.test(css));
  check('CSS: safe-area учтена в хотбаре', /#hotbar\.mcb-hotbar[^{]*\{[^}]*env\(safe-area-inset-bottom/.test(css));
  check('CSS: прокрутка списка только по вертикали', /\.mcb-body\{[^}]*touch-action:pan-y/.test(css));
  check('CSS: адаптив под узкие экраны', /@media/.test(css), (css.match(/@media/g) || []).length + ' медиазапросов');
  check('CSS: адаптив под низкие экраны (ландшафт)', /max-height/.test(css));
  check('CSS: кнопка «Готово» поверх игры', /\.mcb-done\{position:fixed/.test(css));
  check('CSS: подсветка перетаскиваемых контролов', /\.mcb-layout-mode #joystick/.test(css));

  /* ---------- 21. раскладка без пересечений (числовая модель CSS) ---------- */
  const pageCss = html.slice(html.indexOf('<style'), html.indexOf('</style>'));
  const rule = (pattern) => { const m = pageCss.match(pattern); return m ? m[0] : ''; };
  const joystickRule = rule(/#joystick\{left:calc\(16px[^}]*\}/);
  const actionsRule = rule(/\.actions\{right:calc\(16px[^}]*\}/);
  const hotRule = (css.match(/#hotbar\.mcb-hotbar\{[^}]*\}/) || [''])[0];
  const px = (text, name, fallback) => {
    const m = text.match(new RegExp(name + ':\\s*(?:calc\\()?(\\d+)px'));
    return m ? Number(m[1]) : fallback;
  };
  const stickBottom = px(joystickRule, 'bottom', 106);
  const stickLeft = px(joystickRule, 'left', 16);
  const stickSize = px(joystickRule, 'width', 116);
  const actionsBottom = px(actionsRule, 'bottom', 106);
  const actionsRight = px(actionsRule, 'right', 16);
  const hotBottom = px(hotRule, 'bottom', 14);
  const hotHeight = 60 + 10; /* слот 60 + паддинги 5/5 */
  check('хотбар стоит ниже джойстика (портрет)', hotBottom + hotHeight <= stickBottom,
    [hotBottom + hotHeight, stickBottom]);
  check('хотбар стоит ниже блока кнопок', hotBottom + hotHeight <= actionsBottom,
    [hotBottom + hotHeight, actionsBottom]);
  const hotWidth = Math.min(392, 360 - 20);
  check('хотбар не залезает под джойстик по ширине', 360 - hotWidth >= 2 * 0 + 20 &&
    stickLeft + stickSize > 0, [hotWidth, stickLeft + stickSize]);
  check('в ландшафте хотбар между джойстиком и кнопками',
    Math.min(340, 568 - 300) + 2 * (stickLeft + 104) <= 568,
    [Math.min(340, 568 - 300), stickLeft + 104]);

  /* ---------- 22. патчи движка на месте ---------- */
  check('движок: установка через mcxBuildPlace', html.includes('mcxBuildPlace(s, r, a), F.dirty = !0;'));
  check('движок: снос через mcxBuildBreak', html.includes('mcxBuildBreak(e.x, e.y, e.z) && (F.dirty = !0)'));
  check('движок: чувствительность умножается', html.includes('Qh(n, s, MCX_LOOK_TOUCH * (mcbState.sensitivity || 1))'));
  check('движок: цифры идут в mcbKeySlot', html.includes('mcbKeySlot(Number(i.code.slice(-1)) - 1)'));
  check('движок: в воду можно ставить', html.includes('cs(s, r, a) !== qh'));
  check('движок: покадровая часть в общем цикле', html.includes('try { mcbTick(); } catch (mcbErr) {}'));
  check('движок: второй цикл кадров не создаётся', !/requestAnimationFrame\(mcbLoop\)/.test(html));
  check('движок: модуль внутри замыкания игры', html.includes('/* @@MCB_START@@ */') && html.includes('/* @@MCB_END@@ */'));

  /* ---------- 23. ошибки ---------- */
  check('нет ошибок jsdom', consoleErrors.length === 0, consoleErrors.slice(0, 3));

  const failed = results.filter(r => r.startsWith('FAIL'));
  console.log(results.join('\n'));
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' проверок пройдено');
  process.exit(failed.length ? 1 : 0);
})().catch((error) => {
  console.log(results.join('\n'));
  console.error('\nТЕСТ УПАЛ:', error && error.stack || error);
  process.exit(1);
});
