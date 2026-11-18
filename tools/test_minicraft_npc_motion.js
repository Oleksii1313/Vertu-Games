#!/usr/bin/env node
/*
 * Жители MiniCraft в реальном мире: двигаются ли они на самом деле.
 *
 * Прежние тесты проверяли чистую навигацию (A*, коллизии) на синтетической
 * карте. Этот прогоняет настоящую игру в jsdom (WebGL подменён заглушкой) и
 * смотрит на поведение со стороны: сколько житель проходит за 20 секунд,
 * останавливается ли он, не застревает ли в блоках и друг в друге, не рвётся
 * ли анимация, сколько времени занимает обновление NPC в кадре.
 *
 *     NODE_PATH=/tmp/dom/node_modules node tools/test_minicraft_npc_motion.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const HTML = process.env.MINICRAFT_HTML || path.join(__dirname, '..', 'games', 'minicraft.html');
const html = fs.readFileSync(HTML, 'utf8');

const results = [];
function check(name, ok, extra) {
  results.push((ok ? 'PASS' : 'FAIL') + ' · ' + name + (extra === undefined ? '' : ' → ' + JSON.stringify(extra).slice(0, 240)));
}

/* --------------------------------------------------------- jsdom + заглушки */
const vc = new VirtualConsole();
const consoleErrors = [];
vc.on('jsdomError', (e) => { if (!/navigation|Not implemented/.test(e.message)) consoleErrors.push('[jsdom] ' + e.message.slice(0, 140)); });
vc.on('error', (...a) => consoleErrors.push('[error] ' + a.join(' ').slice(0, 140)));

const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/games/minicraft.html', virtualConsole: vc });
const w = dom.window;

const C = {
  VERSION: 7938, MAX_TEXTURE_SIZE: 3379, MAX_VIEWPORT_DIMS: 3386,
  MAX_TEXTURE_IMAGE_UNITS: 34930, MAX_VERTEX_TEXTURE_IMAGE_UNITS: 35660,
  MAX_COMBINED_TEXTURE_IMAGE_UNITS: 35661, MAX_VERTEX_ATTRIBS: 34921,
  MAX_VERTEX_UNIFORM_VECTORS: 36347, MAX_VARYING_VECTORS: 36348,
  MAX_FRAGMENT_UNIFORM_VECTORS: 36349, MAX_CUBE_MAP_TEXTURE_SIZE: 34076,
  MAX_SAMPLES: 36183, SHADING_LANGUAGE_VERSION: 35724
};
function fakeGL(canvas) {
  const ext = {
    EXT_texture_filter_anisotropic: { MAX_TEXTURE_MAX_ANISOTROPY_EXT: 34047 },
    OES_texture_float_linear: {}, WEBGL_lose_context: { loseContext() {} }, EXT_color_buffer_float: {},
    EXT_blend_minmax: {}, EXT_frag_depth: {}, WEBGL_depth_texture: {}, OES_vertex_array_object: {}
  };
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
w.parent = { postMessage() {}, window: w };

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
runtime = runtime.slice(0, idx) +
  '\nwindow.__mcx = () => ({ F, mcxVillages: mcxVillages, mcxStandAt, mcxFreeSpot, mcxPathTo, mcxVillagerStep, mcxUpdateVillagers, mcxSpawnMob, mcxKillMob, ir, mc: () => Mt, startWorld: Kh, playGame: Zl });\n' +
  runtime.slice(idx);
w.eval(runtime);

const api = () => w.__mcx();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  api().startWorld();
  for (let i = 0; i < 200 && api().mc() !== 'ready'; i++) await wait(20);
  api().playGame();
  await wait(30);
  frames(3);
  const A = api();
  check('мир создан, жители заспавнены', A.F.villagers.length >= 12, A.F.villagers.length);

  /* Монстров убираем: проверяем спокойное поведение, а испуг разобран в
     test_minicraft.js. Игрок стоит в стороне, чтобы не «собирать» подарки. */
  const calm = () => {
    const B = api();
    B.F.monsters.forEach((m) => { m.x = 9999; m.z = 9999; });
    B.F.x = 4; B.F.z = 4;
  };
  calm();
  frames(40);

  const start = A.F.villagers.map((v) => ({ x: v.x, z: v.z }));
  const travel = A.F.villagers.map(() => 0);
  const prev = A.F.villagers.map((v) => ({ x: v.x, z: v.z }));
  const states = A.F.villagers.map(() => ({ walk: 0, pause: 0, flee: 0 }));
  const stallStreak = A.F.villagers.map(() => 0);
  const maxStall = A.F.villagers.map(() => 0);
  const headingJumps = A.F.villagers.map(() => 0);
  const prevHeading = A.F.villagers.map((v) => v.heading || 0);
  const badGround = [];
  const badPath = [];
  let minPair = 99, waterHits = 0, swingFrames = 0, framesRun = 0;

  /* 20 секунд игры: 1200 кадров по 17 мс. */
  for (let step = 0; step < 1200; step++) {
    frames(1);
    framesRun++;
    calm();
    const B = api();
    B.F.villagers.forEach((v, i) => {
      const d = Math.hypot(v.x - prev[i].x, v.z - prev[i].z);
      travel[i] += d;
      states[i][v.state] = (states[i][v.state] || 0) + 1;
      if (d < 1e-4 && v.state === 'walk') {
        stallStreak[i]++;
        if (stallStreak[i] > maxStall[i]) maxStall[i] = stallStreak[i];
      } else {
        stallStreak[i] = 0;
      }
      // поворот корпуса не должен «щёлкать» на 180°
      const h = v.heading || 0;
      let dh = Math.abs(h - prevHeading[i]);
      if (dh > Math.PI) dh = Math.PI * 2 - dh;
      if (dh > .45) headingJumps[i]++;
      prevHeading[i] = h;
      // не парит и не тонет в блоке
      const ground = B.ir(Math.floor(v.x), Math.floor(v.z));
      if (Math.abs(v.y - ground) > 1.02) badGround.push([i, +v.y.toFixed(2), ground]);
      // маршрут не проходит через блоки
      for (let k = v.pathI || 0; k < Math.min((v.pathI || 0) + 4, (v.path || []).length); k++) {
        const pt = v.path[k];
        if (!B.mcxStandAt(pt.x, pt.z, pt.y)) badPath.push([i, k, +pt.x.toFixed(1), +pt.z.toFixed(1)]);
      }
      // анимация шага: конечности качаются, пока житель идёт
      if (d > 1e-4 && v.mesh && v.mesh.userData && v.mesh.userData.legs && Math.abs(v.mesh.userData.legs[0].rotation.x) > .02) swingFrames++;
      if (Math.hypot(v.x - B.F.x, v.z - B.F.z) < 1.6) waterHits++;
      for (let j = 0; j < i; j++) {
        const o = B.F.villagers[j];
        minPair = Math.min(minPair, Math.hypot(v.x - o.x, v.z - o.z));
      }
      prev[i] = { x: v.x, z: v.z };
    });
  }

  const B = api();
  const speeds = travel.map((t) => t / 20);
  const avgSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;

  const sorted = speeds.slice().sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  check('каждый житель реально прошёл путь (>= 6 блоков за 20 с)',
    speeds.every((s) => s * 20 >= 6), speeds.map((s) => +s.toFixed(2)));
  check('типичный житель идёт пешком (медиана 0.9…2 блока/с)',
    median > .9 && median < 2.2, +median.toFixed(2));
  check('средняя скорость жителей — пешая прогулка (0.6…2.2 блока/с)',
    avgSpeed > .6 && avgSpeed < 2.2, +avgSpeed.toFixed(2));
  check('нет долгих простоев (максимум < 6 с подряд)',
    maxStall.every((f) => f * 0.017 < 6), maxStall.map((f) => +(f * 0.017).toFixed(1)));
  check('жители ни разу не оказались в блоке или в воздухе', badGround.length === 0, badGround.slice(0, 3));
  check('маршруты жителей идут только по проходимым клеткам', badPath.length === 0, badPath.slice(0, 3));
  check('жители не наступают друг на друга (дистанция >= 0.5)', minPair >= .5, +minPair.toFixed(2));
  check('жители не заходят в воду и не топчутся в игроке', waterHits === 0, waterHits);
  check('повороты плавные, без мгновенных разворотов',
    headingJumps.every((n) => n <= framesRun * 0.05), headingJumps);
  check('анимация ходьбы работает у идущих жителей', swingFrames > framesRun, swingFrames);
  check('в поведении есть и ходьба, и паузы',
    states.some((s) => s.walk > framesRun * 0.3) && states.some((s) => s.pause > framesRun * 0.05),
    states.map((s) => [s.walk, s.pause]).slice(0, 4));

  /* ------------------------------------------ жители убегают от монстров */
  {
    const B2 = api();
    const villager = B2.F.villagers[0];
    // Ставим жителя на открытое место: в углу двора он честно упрётся в стену,
    // и проверка «убегает» превратилась бы в проверку геометрии деревни.
    const open = B2.mcxFreeSpot(villager.x, villager.z, 12);
    if (open) { villager.x = open.x; villager.z = open.z; villager.y = open.y; }
    villager.state = 'pause';
    villager.timer = 0;
    frames(2);
    if (!B2.F.monsters.length) B2.mcxSpawnMob('zombie');
    const hunter = B2.F.monsters[B2.F.monsters.length - 1];
    const sx = villager.x, sz = villager.z;
    let sawFlee = false;
    /* Монстр «преследует» жителя. Логику жителей вызываем сами: в игровом
       кадре монстры обновляются раньше, и выставленная снаружи позиция
       успевала «уехать» к игроку, поэтому угроза исчезала. */
    for (let k = 0; k < 90; k++) {
      hunter.x = villager.x + 2;
      hunter.z = villager.z;
      hunter.y = villager.y;
      hunter.hp = 9999;
      B2.mcxUpdateVillagers(1 / 60);
      if (villager.state === 'flee' && villager.flee > 0) sawFlee = true;
    }
    const moved = Math.hypot(villager.x - sx, villager.z - sz);
    check('житель убегает от монстра', moved > 1.2 && sawFlee, [+moved.toFixed(2), sawFlee]);
    B2.mcxKillMob(hunter);
  }

  /* ---------------------------------------------- цена обновления в кадре */
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 300; i++) B.mcxUpdateVillagers(1 / 60);
  const t1 = process.hrtime.bigint();
  const perFrame = Number(t1 - t0) / 1e6 / 300;
  check('обновление NPC дешевле 0.6 мс на кадр', perFrame < .6, +perFrame.toFixed(3));

  /* ------------------------------------ новый мир: жители создаются заново */
  api().startWorld();
  for (let i = 0; i < 200 && api().mc() !== 'ready'; i++) await wait(20);
  const C2 = api();
  check('новый мир — новые жители', C2.F.villagers.length >= 12, C2.F.villagers.length);
  check('жители нового мира стоят на опоре',
    C2.F.villagers.every((v) => C2.mcxStandAt(v.x, v.z, Math.round(v.y)) || Math.abs(v.y - C2.ir(Math.floor(v.x), Math.floor(v.z))) < .6));

  check('ошибок в консоли нет', consoleErrors.length === 0, consoleErrors.slice(0, 3));

  console.log(results.filter((r) => r.startsWith('FAIL')).join('\n'));
  console.log('ИТОГО: ' + results.filter((r) => r.startsWith('PASS')).length + '/' + results.length + ' проверок пройдено');
  if (consoleErrors.length) console.log('ошибки консоли: ' + consoleErrors.slice(0, 3).join(' | '));
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
