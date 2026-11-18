#!/usr/bin/env node
/*
 * Автотест нового ландшафта MiniCraft 3D: вода, мосты, архитектура, зелень,
 * руки жителей и центрированный нос.
 *
 * Игра запускается целиком в jsdom с заглушкой WebGL (как tools/test_minicraft.js),
 * поэтому проверяется настоящий генератор мира, а не отдельная функция.
 *
 *     NODE_PATH=/tmp/dom/node_modules node tools/test_minicraft_world.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const HTML = process.env.MINICRAFT_HTML || path.join(__dirname, '..', 'games', 'minicraft.html');
const html = fs.readFileSync(HTML, 'utf8');

const vc = new VirtualConsole();
const consoleErrors = [];
vc.on('jsdomError', (e) => { if (!/navigation|Not implemented/.test(e.message)) consoleErrors.push('[jsdom] ' + e.message); });
vc.on('error', (...a) => consoleErrors.push('[error] ' + a.join(' ')));

const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/games/minicraft.html', virtualConsole: vc });
const w = dom.window;

const C = { VERSION: 7938, MAX_TEXTURE_SIZE: 3379, MAX_VIEWPORT_DIMS: 3386, MAX_TEXTURE_IMAGE_UNITS: 34930,
  MAX_VERTEX_TEXTURE_IMAGE_UNITS: 35660, MAX_COMBINED_TEXTURE_IMAGE_UNITS: 35661, MAX_VERTEX_ATTRIBS: 34921,
  MAX_VERTEX_UNIFORM_VECTORS: 36347, MAX_VARYING_VECTORS: 36348, MAX_FRAGMENT_UNIFORM_VECTORS: 36349,
  MAX_CUBE_MAP_TEXTURE_SIZE: 34076, MAX_SAMPLES: 36183, SHADING_LANGUAGE_VERSION: 35724, MAX_TEXTURE_MAX_ANISOTROPY_EXT: 34047 };
function fakeGL(canvas) {
  const ext = { EXT_texture_filter_anisotropic: { MAX_TEXTURE_MAX_ANISOTROPY_EXT: 34047 }, OES_texture_float_linear: {},
    WEBGL_lose_context: { loseContext() {} }, EXT_color_buffer_float: {}, EXT_blend_minmax: {}, EXT_frag_depth: {},
    WEBGL_depth_texture: {}, OES_vertex_array_object: {} };
  const target = { canvas, drawingBufferWidth: 1280, drawingBufferHeight: 720,
    getParameter(p) {
      if (p === 7938) return 'WebGL 2.0 (fake)';
      if (p === 35724) return 'WebGL GLSL ES 3.00 (fake)';
      if (p === 3386 || p === 3379 || p === 34076) return [16384, 16384];
      if (p === 34921 || p === 34930 || p === 35660 || p === 35661) return 16;
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
    getError() { return 0; }, readPixels() {} };
  return new Proxy(target, { get(t, p) {
    if (p in t) return t[p];
    if (p in C) return C[p];
    if (typeof p === 'string' && /^[A-Z0-9_]+$/.test(p)) return 1;
    return function () { return undefined; };
  } });
}
function fake2d() {
  const grad = { addColorStop() {} };
  const target = { createLinearGradient() { return grad; }, createRadialGradient() { return grad; },
    createPattern() { return null; }, measureText() { return { width: 10 }; },
    getImageData(x, y, w2, h2) { return { data: new Uint8ClampedArray(w2 * h2 * 4), width: w2, height: h2 }; },
    putImageData() {}, createImageData(w2, h2) { return { data: new Uint8ClampedArray(w2 * h2 * 4) }; } };
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
w.parent = { postMessage(msg) { posted.push(msg); }, window: w };
let rafCb = null, rafTs = 0;
w.requestAnimationFrame = (cb) => { rafCb = cb; return 1; };
w.cancelAnimationFrame = () => {};
function frames(n, dtMs = 17) {
  for (let i = 0; i < n; i++) {
    rafTs += dtMs;
    const cb = rafCb;
    if (!cb) break;
    rafCb = null;
    cb(rafTs);
  }
}

const openTag = '<script id="minicraft-runtime">';
let runtime = html.slice(html.indexOf(openTag) + openTag.length, html.indexOf('</script>', html.indexOf(openTag)));
const idx = runtime.lastIndexOf('\n})();');
runtime = runtime.slice(0, idx) + `
window.__world = () => ({
  F, mcxVillages, mcxChestSpots, mcxCoinSpots, mcxWaterList, mcxWaterCells, mcxWaterMesh,
  mcxWaterAt, mcxGet, cs, ir, mcxMakeVillager, mcxSwingVillager, mcxRestVillager, mcxShade,
  mcxWorldStats, mcxClearEntities,
  startWorld: Kh, playGame: Zl, mc: () => Mt, Ht,
  ids: { air: Ai, grass: Vh, ground: Gh, stone: Hh, sand: Wh, wood: Xh, leaf: Bl, coin: qh, bed: Vl },
  ids2: { brick: SB, cobble: CB, beam: DW, plank: PL, tile: RF, plaster: PS, glass: GL, slate: SL },
  roof: mcxGableRoof, square: mcxSquare,
  CT: ct, DN: dn
});
` + runtime.slice(idx);
w.eval(runtime);

const results = [];
function check(name, ok, extra) {
  results.push((ok ? 'PASS' : 'FAIL') + ' · ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : ''));
}
const api = () => w.__world();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const A0 = api();
  A0.startWorld();
  for (let i = 0; i < 250 && api().mc() !== 'ready'; i++) await wait(20);
  const W = api();
  const ids = W.ids;

  /* ------------------------------------------- архитектура поселений */
  const M = W.ids2;
  const worldCount = (id) => {
    let n = 0;
    for (let x = 1; x < W.CT - 1; x++)
      for (let z = 1; z < W.CT - 1; z++)
        for (let y = 1; y < W.DN - 1; y++) if (W.cs(x, y, z) === id) n++;
    return n;
  };
  const cBrick = worldCount(M.brick), cCobble = worldCount(M.cobble), cBeam = worldCount(M.beam);
  const cPlank = worldCount(M.plank), cTile = worldCount(M.tile), cPlaster = worldCount(M.plaster);
  const cGlass = worldCount(M.glass), cSlate = worldCount(M.slate);
  check('каменная кладка используется в постройках', cBrick > 400, cBrick);
  check('булыжник — фундаменты и цоколи', cCobble > 600, cCobble);
  check('тёмное дерево — балки, рамы, коньки', cBeam > 400, cBeam);
  check('доски — стены и полы срубов', cPlank > 400, cPlank);
  check('черепица — крыши домов', cTile > 400, cTile);
  check('побелка — фахверковые дома', cPlaster > 80, cPlaster);
  check('стекло — окна домов и бойницы башен', cGlass > 60, cGlass);
  check('сланец — крыши башен и каменных домов', cSlate > 150, cSlate);

  /* Каждая деревня: дома с крышей, труба, окна, мостовая площади. */
  const villageReport = [];
  for (const v of W.mcxVillages) {
    let roofs = 0, glass = 0, chimneys = 0, paved = 0, beams = 0;
    for (let dx = -v.r; dx <= v.r; dx++)
      for (let dz = -v.r; dz <= v.r; dz++) {
        const x = v.x + dx, z = v.z + dz;
        for (let y = v.base; y < v.base + 13; y++) {
          const id = W.cs(x, y, z);
          if (id === M.tile || id === M.slate) roofs++;
          else if (id === M.glass) glass++;
          else if (id === M.beam) beams++;
          if (id === M.cobble && y > v.base + 3) chimneys++;
        }
        const floor = W.cs(x, v.base - 1, z);
        if (Math.hypot(dx, dz) <= 4.2 && (floor === M.brick || floor === M.cobble)) paved++;
      }
    villageReport.push({ name: v.name, roofs, glass, chimneys, paved, beams, villagers: v.villagers.length });
  }
  check('в каждой деревне есть крыши', villageReport.every((v) => v.roofs > 60),
    villageReport.map((v) => v.roofs));
  check('в каждой деревне есть окна со стеклом', villageReport.every((v) => v.glass >= 4),
    villageReport.map((v) => v.glass));
  check('в каждой деревне есть трубы над крышами', villageReport.every((v) => v.chimneys >= 4),
    villageReport.map((v) => v.chimneys));
  check('центр каждой деревни — мощёная площадь', villageReport.every((v) => v.paved >= 20),
    villageReport.map((v) => v.paved));
  check('в деревнях есть тёмные балки (переплёты, коньки)', villageReport.every((v) => v.beams > 30),
    villageReport.map((v) => v.beams));
  check('в каждой деревне живут NPC', villageReport.every((v) => v.villagers >= 3),
    villageReport.map((v) => v.villagers));
  check('стили деревень различаются (сруб / камень / фахверк)',
    new Set(W.mcxVillages.map((v) => v.style)).size >= 3,
    W.mcxVillages.map((v) => v.style));

  /* ------------------------------------------------ вода */
  const cells = W.mcxWaterList;
  check('вода есть (озёра + реки)', cells.length > 800, cells.length);
  const mesh = W.mcxWaterMesh;
  check('поверхность воды — один InstancedMesh', !!mesh && mesh.count === cells.length, mesh && mesh.count);
  check('вода полупрозрачная', !!mesh && mesh.material.transparent && mesh.material.opacity < 0.9,
    mesh && [mesh.material.transparent, mesh.material.opacity]);

  // Кластеры воды: считаем крупные связные пятна.
  const key = (x, z) => x + ',' + z;
  const seen = new Set();
  let clusters = 0, big = 0;
  for (const c of cells) {
    if (seen.has(key(c.x, c.z))) continue;
    let size = 0;
    const stack = [[c.x, c.z]];
    while (stack.length) {
      const [x, z] = stack.pop();
      const k = key(x, z);
      if (seen.has(k) || !W.mcxWaterCells[k]) continue;
      seen.add(k); size++;
      stack.push([x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]);
    }
    clusters++;
    if (size > 120) big++;
  }
  check('минимум 4 крупных водоёма', big >= 4, { clusters, big });

  const quadrants = new Set(cells.map((c) => (c.x > 128 ? 'e' : 'w') + (c.z > 128 ? 's' : 'n')));
  check('вода во всех четвертях карты (реки сквозные)', quadrants.size === 4, [...quadrants]);

  const levels = new Set(cells.map((c) => c.level));
  check('уровни воды разные по высоте рельефа', levels.size > 2, levels.size);

  /* ------------------------------------------------ берега */
  let sandShore = 0;
  for (const c of cells.slice(0, 4000)) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (W.mcxWaterAt(c.x + dx, c.z + dz)) continue;
      if (W.cs(c.x + dx, c.level - 1, c.z + dz) === ids.sand) sandShore++;
    }
  }
  check('песчаные берега у воды', sandShore > 100, sandShore);
  const st = Object.assign({}, W.mcxWorldStats);
  console.log('наполнение мира: ' + JSON.stringify(st));

  /* ------------------------------------------------ мосты */
  let bridges = 0;
  for (const c of cells) {
    if (W.cs(c.x, c.level, c.z) === ids.wood) bridges++;
  }
  check('мосты и настилы над водой', bridges >= 8, bridges);

  /* ------------------------------------------------ архитектура */
  let stoneCount = 0, woodCount = 0, leafCount = 0, sandCount = 0;
  for (let x = 0; x < W.CT; x += 2) {
    for (let z = 0; z < W.CT; z += 2) {
      for (let y = 1; y < W.DN; y++) {
        const b = W.cs(x, y, z);
        if (b === ids.stone) stoneCount++;
        else if (b === ids.wood) woodCount++;
        else if (b === ids.leaf) leafCount++;
        else if (b === ids.sand) sandCount++;
      }
    }
  }
  check('замок построен', st.castles >= 1, st.castles);
  check('сторожевые башни', st.towers >= 3, st.towers);
  check('мельница', st.windmills >= 1, st.windmills);
  check('рынок', st.markets >= 1, st.markets);
  check('руины', st.ruins >= 1, st.ruins);
  check('пещеры', st.caves >= 1, st.caves);
  check('остров на озере', st.islands >= 1, st.islands);
  check('причал', st.docks >= 1, st.docks);
  check('озёра и реки', st.lakes >= 4 && st.rivers >= 3, [st.lakes, st.rivers]);
  check('мостовых пролётов много', st.bridges >= 8, st.bridges);
  check('деревянные постройки (дома, мосты, рынок)', woodCount > 300, woodCount);
  check('лес сохранён (листва)', leafCount > 1500, leafCount);
  check('песок у воды, а не по всей карте', sandCount > 200 && sandCount < 30000, sandCount);
  check('сундуков стало больше (руины, пещеры, острова)', W.mcxChestSpots.length >= 18, W.mcxChestSpots.length);
  check('ели и берёзы выросли', st.pines > 20 && st.birches > 10, [st.pines, st.birches]);
  check('цветы, грибы и валуны добавлены', st.details > 20, st.details);

  const coins = W.F.coins;
  check('монет в мире не меньше цели (130)', coins.length >= 130 && coins.length <= 165, coins.length);
  const underWater = coins.filter((c) => W.mcxWaterAt(c.x, c.z) && c.y <= W.mcxWaterAt(c.x, c.z));
  check('ни одна монета не висит под водой', underWater.length === 0, underWater.length);

  /* ------------------------------------------------ жители: руки и нос */
  const v = W.mcxMakeVillager(0x3f7f52, 0xc9b26a);
  const arms = v.userData.arms || [];
  check('у жителя две руки', arms.length === 2, arms.length);
  const armX = arms.map((a) => Number(a.position.x.toFixed(2)));
  check('руки посажены симметрично на плечи',
    Math.abs(armX[0] + armX[1]) < 0.001 && Math.abs(armX[0]) > 0.25 && Math.abs(arms[0].position.y - 1.3) < 0.01,
    armX);
  const sleeve = arms[0].children[0], cuff = arms[0].children[1];
  check('рука — воксельная конечность длиной 0.62 (кисть ниже туловища)',
    sleeve && Math.abs(sleeve.geometry.parameters.height - 0.62) < 0.01 && sleeve.position.y < -0.2,
    sleeve && sleeve.geometry.parameters);
  check('у руки есть кисть на конце', cuff && cuff.position.y < -0.55, cuff && cuff.position.y);

  // Нос должен остаться по центру лица (x = 0), а не на щеке.
  const nose = v.children.filter((m) => m.position && Math.abs(m.position.x) < 0.02 &&
    Math.abs(m.position.y - 1.49) < 0.02 && Math.abs(m.position.z - 0.225) < 0.02);
  check('нос по центру лица', nose.length === 1, nose.length);
  const eyes = v.children.filter((m) => m.position && Math.abs(Math.abs(m.position.x) - 0.1) < 0.02 &&
    Math.abs(m.position.y - 1.56) < 0.02);
  check('глаза на своих местах (по 0.1 от центра)', eyes.length === 2, eyes.length);

  // Качание: руки и ноги в противофазе, после остановки плавно возвращаются.
  W.mcxSwingVillager(v, 0.5);
  const swing = [v.userData.arms[0].rotation.x, v.userData.arms[1].rotation.x];
  check('руки качаются в противофазе', Math.abs(swing[0] + swing[1]) < 1e-6 && Math.abs(swing[0]) > 0.3, swing);
  const legSwing = [v.userData.legs[0].rotation.x, v.userData.legs[1].rotation.x];
  check('ноги качаются в противофазе', Math.abs(legSwing[0] + legSwing[1]) < 1e-6, legSwing);
  check('руки качаются в противофазе с ногами', Math.sign(swing[0]) !== Math.sign(legSwing[0]), [swing[0], legSwing[0]]);
  W.mcxRestVillager(v);
  check('при остановке качание затухает', Math.abs(v.userData.arms[0].rotation.x) < 0.5,
    v.userData.arms[0].rotation.x);

  // Руки не исчезают из группы при повороте тела и остаются видимыми.
  v.rotation.y = Math.PI / 2;
  check('руки остаются в группе и видимы',
    v.children.filter((c) => c === v.userData.arms[0] || c === v.userData.arms[1]).length === 2 &&
    v.userData.arms.every((a) => a.visible && a.children.length >= 2));

  // У всех живых NPC в мире тоже есть руки.
  const live = W.F.villagers.map((x) => x.mesh.userData.arms || []);
  check('у всех заспавненных жителей есть руки', live.length > 0 && live.every((a) => a.length === 2), live.length);

  /* ------------------------------------------------ вода анимируется */
  W.playGame();
  await wait(30);
  frames(3);
  const beforeY = mesh.position.y;
  frames(40);
  check('поверхность воды анимируется', Math.abs(mesh.position.y - beforeY) > 1e-4 || Math.abs(mesh.position.y) > 1e-4,
    [beforeY, mesh.position.y]);

  /* ------------------------------------------------ новая карта = новая вода */
  W.mcxClearEntities();
  const Wc = api();
  check('при сбросе мира вода убрана из сцены', Wc.mcxWaterMesh === null && Wc.mcxWaterList.length === 0,
    [!!Wc.mcxWaterMesh, Wc.mcxWaterList.length]);
  W.startWorld();
  for (let i = 0; i < 250 && api().mc() !== 'ready'; i++) await wait(20);
  const W2 = api();
  check('новый мир заново строит воду', W2.mcxWaterList.length > 800 && !!W2.mcxWaterMesh, W2.mcxWaterList.length);
  check('новая поверхность воды — новый объект', W2.mcxWaterMesh !== mesh);

  console.log(results.join('\n'));
  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log('\nИТОГО: ' + (results.length - failed.length) + '/' + results.length + ' проверок пройдено');
  console.log('ошибки консоли: ' + (consoleErrors.length ? consoleErrors.join(' | ') : 'нет'));
  process.exit(failed.length || consoleErrors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
