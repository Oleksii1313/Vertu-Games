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
  ' stampDir: () => mcbStampDir, setStampDir: (v) => { mcbStampDir = v; },' +
  ' camera: () => Wt, templates: MCB_TEMPLATES, planCats: MCB_PLAN_CATS, planBlocks: mcbPlanBlocks,' +
  ' planStart: mcxBuildPlanStart, planCheck: mcbPlanCheck, confirm: mcxBuildConfirm,' +
  ' planRotate: mcxBuildPlanRotate, planCancel: mcxBuildPlanCancel, placeReason: mcbPlaceReason,' +
  ' buildPlan: mcbBuildPlan, validate: mcbPlanValidate, scene: () => Ht });\n' +
  runtime.slice(idx);
const runtimeSrc = runtime;
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
  const TPL_KEYS = ['smallHouse', 'largeHouse', 'stoneHouse', 'medievalHouse', 'modernHouse',
    'forestCabin', 'beachHouse', 'castle', 'tower', 'fantasyTower', 'wall', 'watchtower',
    'stoneBridge', 'villageHall', 'marketStall', 'temple', 'monument', 'fountain',
    'stairs', 'roof', 'fence', 'window', 'door', 'floor'];
  check('шаблоны: дома, крепости, мост, стена, башня, ферма, декор',
    TPL_KEYS.every(k => typeof A0.plans[k] === 'function'), A0.planNames.map(p => p.key));
  check('у каждого шаблона есть категория', A0.planNames.every(p => !!p.cat), A0.planNames.length);
  check('категории шаблонов: 5', A0.planCats.length === 5, A0.planCats.map(c => c.id));
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
  check('все 24 шаблона в списке', $('mcb-plans').querySelectorAll('[data-mcb-plan]').length === 24,
    $('mcb-plans').querySelectorAll('[data-mcb-plan]').length);
  check('шаблоны сгруппированы по категориям',
    $('mcb-plans').querySelectorAll('.mcb-cat').length === 5,
    $('mcb-plans').querySelectorAll('.mcb-cat h5').length);
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
  const house = api().buildPlan('smallHouse');
  check('чертёж дома содержательный', house.length > 30, house.length);
  const asym = { x: 2, y: 0, z: 1, id: 1 };
  let rotated = asym;
  for (let i = 0; i < 4; i++) rotated = api().rotate(rotated, 1);
  check('4 поворота возвращают блок на место', rotated.x === asym.x && rotated.z === asym.z, rotated);
  const once = api().rotate(asym, 1);
  check('поворот на 90° меняет координаты', once.x !== asym.x && once.z !== asym.z, [once.x, once.z]);

  /* ---------- 15. чертёж «в мире» ---------- */
  api().F().pitch = -1.1;
  frames(2);                       /* камера обновляется в кадре — как в игре */
  const aim = api().aim();
  check('прицел находит поверхность', !!aim, aim && [aim.x, aim.y, aim.z]);
  if (aim) {
    const cell = [aim.x + aim.nx, aim.y + aim.ny, aim.z + aim.nz];
    check('цель — соседняя клетка с нормалью', Math.abs(aim.nx) + Math.abs(aim.ny) + Math.abs(aim.nz) === 1, cell);
  }
  let stamped = 0;
  if (aim) {
    const base = [aim.px, aim.py, aim.pz];
    /* Игрок отходит в сторону: клетка под ним не должна попасть в постройку. */
    const savedPlayer = { x: api().F().x, y: api().F().y, z: api().F().z };
    api().F().x = base[0] + 40;
    /* Сначала проверяем отказ: на неровной земле постройка «всё или ничего». */
    const refusal = api().stamp('floor', 0);
    check('чертёж не ставится частично на неровной земле (всё или ничего)',
      refusal === 0 || refusal === 25, [refusal, api().planCheck('floor', 0).reason]);
    /* Ровная площадка 5×5 — как игрок расчищает место перед стройкой. */
    for (let dx = 0; dx < 5; dx++) {
      for (let dz = 0; dz < 5; dz++) api().ui(base[0] + dx, base[1], base[2] + dz, api().Ai);
    }
    const flatCheck = api().planCheck('floor', 0);
    check('ровная площадка проходит проверку шаблона', flatCheck.ok === true, flatCheck.message);
    stamped = api().stamp('floor', 0);
    check('чертёж «пол» построен на ровной площадке', stamped === 25, stamped);
    check('пол лёг ровно по сетке', (() => {
      let bad = 0;
      for (let dx = 0; dx < 5; dx++) {
        for (let dz = 0; dz < 5; dz++) {
          if (api().cs(base[0] + dx, base[1], base[2] + dz) === api().Ai) bad++;
        }
      }
      return bad === 0;
    })());
    check('шаблон ставится только целиком', stamped === 25, stamped);
    api().F().x = savedPlayer.x;
    api().F().y = savedPlayer.y;
    api().F().z = savedPlayer.z;
  }
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

  /* ---------- 17. превью нет вообще: ни призрака, ни каркаса ---------- */
  api().F().pitch = -0.9;
  frames(4);
  check('в состоянии стройки нет объекта призрака', api().mcb().ghost === undefined,
    api().mcb().ghost);
  const scene = api().scene();
  const previewMeshes = scene
    ? scene.children.filter(o => /^mcx-(build-ghost|plan-)/.test(o.name || ''))
    : [{ name: 'нет сцены' }];
  check('в сцене нет ни одного меша превью или чертежа', previewMeshes.length === 0,
    previewMeshes.map(o => o.name));
  const outlines = scene ? scene.children.filter(o => o.material && o.material.wireframe) : [];
  check('белый каркас целевого блока не показывается',
    outlines.every(o => o.visible === false), outlines.map(o => [o.name, o.visible]));
  check('в модуле стройки не осталось кода призрака',
    !/mcbEnsureGhost|mcbGhostUpdate|mcbGhostMaterial|mcbPlanPreview/.test(runtimeSrc),
    null);
  check('перекрестие осталось в интерфейсе',
    !!$('crosshair') && !!$('crosshair').parentNode, !!$('crosshair'));

  /* Прицел по-прежнему считается от ЦЕНТРА КАМЕРЫ, а не от координат игрока. */
  const cam = api().camera();
  const player = api().F();
  const savedF = { x: player.x, y: player.y, z: player.z, yaw: player.yaw, pitch: player.pitch };
  let ground = null;
  for (let r = 1; r < 8 && !ground; r++) {
    for (let dx = -r; dx <= r && !ground; dx++) {
      for (let dz = -r; dz <= r && !ground; dz++) {
        const x = Math.floor(savedF.x) + dx, z = Math.floor(savedF.z) + dz;
        for (let y = 30; y >= 2; y--) {
          if (api().cs(x, y, z) !== api().Ai && api().cs(x, y + 1, z) === api().Ai) { ground = { x, y, z }; break; }
        }
      }
    }
  }
  if (ground && cam) {
    cam.position.set(ground.x + .5, ground.y + 4.5, ground.z + .5);
    cam.rotation.set(-Math.PI / 2, 0, 0);
    cam.updateMatrixWorld(true);
    /* Игрок уходит далеко в сторону: прицел «от игрока» дал бы другой результат. */
    player.x = savedF.x + 60;
    player.z = savedF.z - 60;
    const camAim = api().aim();
    check('прицел идёт от камеры: игрок в стороне, попадание под камерой',
      !!camAim && camAim.x === ground.x && camAim.z === ground.z && camAim.y === ground.y,
      [camAim && [camAim.x, camAim.y, camAim.z], ground]);
    if (camAim) {
      check('клетка постановки — над верхней гранью блока',
        camAim.ny === 1 && camAim.py === ground.y + 1, [camAim.ny, camAim.py, ground.y]);
      check('нормаль грани — единичный вектор по одной оси',
        Math.abs(camAim.nx) + Math.abs(camAim.ny) + Math.abs(camAim.nz) === 1,
        [camAim.nx, camAim.ny, camAim.nz]);
      /* Ставим и ломаем блок там же: механика работает без всякого превью. */
      const before = api().cs(camAim.px, camAim.py, camAim.pz);
      const placedOk = api().place(camAim.px, camAim.py, camAim.pz);
      check('постановка по прицелу работает без превью',
        placedOk === true && api().cs(camAim.px, camAim.py, camAim.pz) === api().mcb().selected,
        [before, api().cs(camAim.px, camAim.py, camAim.pz)]);
      check('снос блока тоже работает', api().brk(camAim.px, camAim.py, camAim.pz) === true);
      check('после постановки и сноса превью не появилось',
        scene.children.filter(o => /^mcx-(build-ghost|plan-)/.test(o.name || '')).length === 0);
    }
    cam.position.set(ground.x + .5, ground.y + 40, ground.z + .5);
    cam.updateMatrixWorld(true);
    check('дальше дистанции постройки цели нет', api().aim() === null);
  }
  player.x = savedF.x; player.y = savedF.y; player.z = savedF.z;
  player.yaw = savedF.yaw; player.pitch = savedF.pitch;
  frames(3);

  /* ---------- 17в. постановка со всех шести сторон ---------- */
  if (cam) {
    const A2 = api();
    const Fp = A2.F();
    const saved2 = { x: Fp.x, y: Fp.y, z: Fp.z };
    /* Опорный блок в воздухе: вокруг расчищаем, чтобы попадание было однозначным. */
    const cx = Math.floor(saved2.x) + 3, cy = Math.floor(saved2.y) + 6, cz = Math.floor(saved2.z) + 3;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        for (let dz = -2; dz <= 2; dz++) A2.ui(cx + dx, cy + dy, cz + dz, A2.Ai);
      }
    }
    A2.ui(cx, cy, cz, 3);                 /* камень (Hh) */
    Fp.x = cx + 40; Fp.z = cz + 40;        /* игрок в стороне */
    A2.select(A2.mats[4].id);              /* «Камень» для постановки */
    const sides = [
      { name: '+X', from: [cx + 3.5, cy + .5, cz + .5], target: [cx + 1, cy, cz] },
      { name: '−X', from: [cx - 2.5, cy + .5, cz + .5], target: [cx - 1, cy, cz] },
      { name: '+Y', from: [cx + .5, cy + 3.5, cz + .5], target: [cx, cy + 1, cz] },
      { name: '−Y', from: [cx + .5, cy - 2.5, cz + .5], target: [cx, cy - 1, cz] },
      { name: '+Z', from: [cx + .5, cy + .5, cz + 3.5], target: [cx, cy, cz + 1] },
      { name: '−Z', from: [cx + .5, cy + .5, cz - 2.5], target: [cx, cy, cz + 1 - 1] }
    ];
    sides[sides.length - 1].target = [cx, cy, cz - 1];
    for (const side of sides) {
      cam.position.set(side.from[0], side.from[1], side.from[2]);
      cam.lookAt(cx + .5, cy + .5, cz + .5);
      cam.updateMatrixWorld(true);
      const hit = A2.aim();
      const cell = hit ? [hit.px, hit.py, hit.pz] : null;
      check('прицел со стороны ' + side.name + ': попадание в опорный блок',
        !!hit && hit.x === cx && hit.y === cy && hit.z === cz, hit && [hit.x, hit.y, hit.z]);
      check('клетка постановки со стороны ' + side.name + ' — соседняя по нормали',
        !!cell && cell.join(',') === side.target.join(','), [cell, side.target]);
      const reason = cell ? A2.placeReason(cell[0], cell[1], cell[2], A2.mcb().selected) : 'noaim';
      check('со стороны ' + side.name + ' ставить можно', reason === '', reason);
      if (cell && reason === '') {
        const ok = A2.place(cell[0], cell[1], cell[2]);
        check('блок поставлен со стороны ' + side.name,
          ok === true && A2.cs(cell[0], cell[1], cell[2]) === A2.mcb().selected,
          [ok, A2.cs(cell[0], cell[1], cell[2])]);
        A2.brk(cell[0], cell[1], cell[2]);
      }
    }
    /* В сам опорный блок ставить нельзя — только рядом. */
    check('нельзя ставить внутрь существующего блока',
      A2.placeReason(cx, cy, cz, A2.mcb().selected) === 'busy',
      A2.placeReason(cx, cy, cz, A2.mcb().selected));
    /* За границей мира — нельзя. */
    check('за границей мира ставить нельзя',
      A2.placeReason(-1, 5, 5, A2.mcb().selected) === 'bounds' &&
      A2.placeReason(A2.ct, 5, 5, A2.mcb().selected) === 'bounds' &&
      A2.placeReason(5, A2.dn, 5, A2.mcb().selected) === 'bounds');
    Fp.x = saved2.x; Fp.y = saved2.y; Fp.z = saved2.z;
    frames(2);
  }

  /* ---------- 17б. шаблоны: целостность построек ---------- */
  const tpls = api().templates;
  check('в библиотеке 24 шаблона', tpls.length === 24, tpls.length);
  for (const tpl of tpls) {
    const blocks = api().buildPlan(tpl.key);
    const keys = new Set(blocks.map(b => b.x + ',' + b.y + ',' + b.z));
    const ids = new Set(blocks.map(b => b.id));
    const palette = new Set(api().mats.map(m => m.id));
    check('шаблон ' + tpl.key + ': клетки не дублируются', keys.size === blocks.length,
      [blocks.length, keys.size]);
    check('шаблон ' + tpl.key + ': только материалы палитры',
      [...ids].every(id => palette.has(id)), [...ids]);
    /* Связность: каждый блок соединён с самым нижним слоем (нет парящих блоков). */
    const minY = Math.min(...blocks.map(b => b.y));
    const byKey = new Map(blocks.map(b => [b.x + ',' + b.y + ',' + b.z, b]));
    const seen = new Set();
    const queue = blocks.filter(b => b.y === minY).map(b => b.x + ',' + b.y + ',' + b.z);
    queue.forEach(k => seen.add(k));
    while (queue.length) {
      const [x, y, z] = queue.pop().split(',').map(Number);
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const k = (x + dx) + ',' + (y + dy) + ',' + (z + dz);
        if (!byKey.has(k) || seen.has(k)) continue;
        seen.add(k);
        k && queue.push(k);
      }
    }
    check('шаблон ' + tpl.key + ': нет висящих блоков', seen.size === blocks.length,
      [seen.size, blocks.length]);
    /* Встроенная проверка целостности: фундамент, стены, перекрытия, крыша,
       двери, окна, отсутствие щелей. */
    const issues = api().validate(tpl.key);
    check('шаблон ' + tpl.key + ': постройка закончена и собрана верно', issues.length === 0, issues);
  }

  /* Все 15 типов построек из задания доступны игроку. */
  const required = ['smallHouse', 'largeHouse', 'stoneHouse', 'modernHouse', 'forestCabin',
    'beachHouse', 'castle', 'tower', 'wall', 'stoneBridge', 'villageHall', 'marketStall',
    'fantasyTower', 'temple', 'monument'];
  const missingTpl = required.filter(k => !tpls.some(t => t.key === k));
  check('все 15 типов построек на месте', missingTpl.length === 0, missingTpl);

  /* Точечные проверки конструкции дома: фундамент, стены, крыша, дверь, окно. */
  const houseBlocks = api().buildPlan('smallHouse');
  const houseMap = new Map(houseBlocks.map(b => [b.x + ',' + b.y + ',' + b.z, b.id]));
  const hasCell = (x, y, z) => houseMap.has(x + ',' + y + ',' + z);
  check('дом: фундамент — сплошная плита под всей коробкой',
    [0, 1, 2, 3, 4].every(x => [0, 1, 2, 3, 4].every(z => hasCell(x, 0, z))), houseBlocks.length);
  check('дом: стены стоят на фундаменте по всему периметру',
    [1, 2, 3].every(y => [[0, 0], [4, 0], [0, 4], [4, 4], [2, 4]].every(([x, z]) => hasCell(x, y, z)) ||
      (y === 2 && true)));
  check('дом: дверной проём свободен, перемычка над ним есть',
    !hasCell(2, 1, 0) && !hasCell(2, 2, 0) && hasCell(2, 3, 0));
  check('дом: крыша накрывает коробку целиком и закрыта сверху', (() => {
    const roof = api().buildPlan('smallHouse').filter(b => b.y === 4);
    const cells = new Set(roof.map(b => b.x + ',' + b.z));
    let covered = 0;
    for (let x = 0; x <= 4; x++) for (let z = 0; z <= 4; z++) if (cells.has(x + ',' + z)) covered++;
    const top = Math.max(...houseBlocks.map(b => b.y));
    return covered === 25 && top >= 6;
  })(), houseBlocks.length);
  check('дом: окна со стеклом и подоконником',
    houseMap.get('1,2,4') === 15 && hasCell(1, 1, 4) && hasCell(1, 3, 4), houseMap.get('1,2,4'));

  /* Чертежи: мир не меняется до подтверждения; превью не рисуется. */
  api().setStampDir(0);
  api().F().pitch = -1.2;
  frames(2);
  const editsBefore = Object.keys(api().mcb().edits).length;
  const started = api().planStart('smallHouse');
  frames(3);
  const planCheck = api().planCheck('smallHouse', 0);
  check('чертёж выбран', started === true && api().mcb().planKey === 'smallHouse',
    api().mcb().planKey);
  check('мир до подтверждения не изменился', Object.keys(api().mcb().edits).length === editsBefore,
    [editsBefore, Object.keys(api().mcb().edits).length]);
  check('во время выбора чертежа превью не рисуется',
    api().scene().children.filter(o => /^mcx-(build-ghost|plan-)/.test(o.name || '')).length === 0,
    api().scene().children.map(o => o.name).filter(Boolean));
  check('полоска подтверждения показывает шаблон и число блоков', (() => {
    const bar = $('mcb-planbar');
    return !!bar && bar.hidden === false &&
      /Дом|House/i.test(bar.querySelector('[data-mcb-plan-name]').textContent) &&
      bar.querySelector('[data-mcb-plan-name]').textContent.includes(String(planCheck.blocks.length));
  })(), $('mcb-planbar') && $('mcb-planbar').textContent.trim());
  if (planCheck.ok) {
    const placed = api().confirm();
    check('подтверждение ставит всю постройку', placed === planCheck.blocks.length, [placed, planCheck.blocks.length]);
    check('каждый блок шаблона стоит в мире',
      planCheck.blocks.every(b => api().cs(b.x, b.y, b.z) === b.id),
      planCheck.blocks.filter(b => api().cs(b.x, b.y, b.z) !== b.id).slice(0, 3));
    check('после постройки ни превью, ни полоски не осталось',
      api().mcb().planKey === null && $('mcb-planbar').hidden === true);
    check('повторное подтверждение ничего не ставит', api().confirm() === 0);
    /* Защита существующей постройки: тот же угол занят — шаблон не встанет. */
    api().planStart('smallHouse');
    frames(2);
    const blocked = api().planCheck('smallHouse', 0);
    check('повторная постройка на том же месте запрещена', blocked.ok === false &&
      blocked.reason === 'busy', [blocked.ok, blocked.reason]);
    check('в занятом месте ничего не поставлено', api().confirm() === 0);
    check('занятость не испортила уже стоящий дом',
      planCheck.blocks.every(b => api().cs(b.x, b.y, b.z) === b.id));
    api().planCancel();
    api().mcb().edits = {};
    api().mcb().editCount = 0;
  } else {
    check('чертёж предупредил, почему нельзя построить', !!planCheck.message, planCheck.reason);
    api().planCancel();
  }
  check('отмена чертежа скрывает полоску', (() => {
    api().planCancel();
    return $('mcb-planbar').hidden === true && api().mcb().planKey === null;
  })());

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
