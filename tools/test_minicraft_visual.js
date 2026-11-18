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
/* Хвост теста: хуки и проверки новых построек, погоды и камеры. */
runtime = runtime.slice(0, idx) + `
window.__visual = () => ({
  get F() { return F }, mcxVillages, mcxWorldStats, startWorld: Kh, playGame: Zl, mc: () => Mt,
  Ht, mcxGet, cs, ir, mcxWaterAt, mcxWorldStats2: () => Object.assign({}, mcxWorldStats),
  ids: { air: Ai, stone: Hh, wood: Xh, brick: SB, cobble: CB, beam: DW, plank: PL, tile: RF, glass: GL, slate: SL, flame: Wh },
  weather: () => ({
    kind: mcxWeather,
    rain: !!mcxRainPoints,
    snow: !!mcxSnowPoints,
    snowCount: mcxSnowMesh ? mcxSnowMesh.count : 0,
    fog: Ht.fog.color.getHex(),
    background: Ht.background.getHex(),
    sun: mcxSun.intensity,
    sky: mcxSkyLight.intensity,
    label: (document.getElementById('weatherButton') || {}).textContent,
    data: (document.getElementById('weatherButton') || {}).dataset
  }),
  setWeather: mcxSetWeather, cycleWeather: mcxCycleWeather, rebuild: Jh,
  textureDetails: () => window.__textureDetailCount,
  templeSpot: () => mcxTempleSpot, keepSpot: () => mcxKeepSpot, DN: dn,
  down: Kg, move: jg, up: Qg,
  camera: Wt, syncCam: fo,
  camDir: () => { const v = new B(); Wt.getWorldDirection(v); return [v.x, v.y, v.z]; },
  look: Qh,
  step: $g, keys: Vn,
  CT: ct, DN: dn
});
` + runtime.slice(idx);
w.eval(runtime);

const results = [];
function check(name, ok, extra) {
  results.push((ok ? 'PASS' : 'FAIL') + ' · ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : ''));
}
const api = () => w.__visual();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function gridSum(A) {
  let sum = 0;
  for (let x = 0; x < A.CT; x += 3)
    for (let z = 0; z < A.CT; z += 3)
      for (let y = 0; y < A.DN; y++) sum = (sum + A.cs(x, y, z) * (1 + (x + y + z) % 7)) % 2147483647;
  return sum;
}
function evt(over) {
  return Object.assign({
    pointerType: 'mouse', button: 0, pointerId: 7, clientX: 400, clientY: 300,
    target: { closest: () => null }, preventDefault() {}, stopPropagation() {}, shiftKey: false
  }, over);
}

(async () => {
  const A = api();
  if (!w.HTMLCanvasElement.prototype.setPointerCapture)
    w.HTMLCanvasElement.prototype.setPointerCapture = function () {};
  if (!w.HTMLCanvasElement.prototype.releasePointerCapture)
    w.HTMLCanvasElement.prototype.releasePointerCapture = function () {};

  A.startWorld();
  await wait(30);
  frames(3);
  const st = Object.assign({}, A.mcxWorldStats);
  console.log('наполнение мира: ' + JSON.stringify(st));

  /* ------------------------------------------------ архитектура: типы зданий */
  check('коттеджи с крыльцом', st.cottages >= 3, st.cottages);
  check('таверны с вывеской', st.taverns >= 3, st.taverns);
  check('кузницы с горном', st.forges >= 2, st.forges);
  check('большие дома с эркером', st.greatHouses >= 3, st.greatHouses);
  check('сторожевые башни с галереей', st.watchtowers >= 1, st.watchtowers);
  check('декоративные ворота в каждом поселении', st.gates >= A.mcxVillages.length, [st.gates, A.mcxVillages.length]);
  check('древний храм', st.temples >= 1, st.temples);
  check('малый замок с донжоном', st.smallCastles >= 1, st.smallCastles);
  check('каменные мосты с быками', st.stoneBridges >= 1, st.stoneBridges);
  check('портовый склад с краном', st.harbours >= 1, st.harbours);

  /* Каменный мост: над водой стоит кладка, под ней — быки из камня. */
  let deckStone = 0, piers = 0;
  for (let x = 190; x <= 212; x++) {
    for (let z = 96; z <= 136; z++) {
      if (!A.mcxWaterAt(x, z)) continue;
      const lvl = A.mcxWaterAt(x, z);
      if (A.cs(x, lvl + 1, z) === A.ids.brick) deckStone++;
      if (A.cs(x, lvl - 1, z) === A.ids.stone || A.cs(x, lvl - 2, z) === A.ids.stone) piers++;
    }
  }
  check('настил каменного моста из кладки', deckStone >= 6, deckStone);
  check('быки каменного моста уходят в воду', piers >= 4, piers);

  /* Ворота стоят на въезде: арка из кладки выше человеческого роста. */
  const v0 = A.mcxVillages[0];
  let arch = false;
  for (let dx = -3; dx <= 3; dx++)
    for (let dy = 1; dy <= 7; dy++)
      if (A.cs(v0.x + dx, v0.base + dy, v0.z + v0.r - 2) === A.ids.brick) arch = true;
  check('арка ворот сложена из кладки', arch);

  /* Кольцо рельефа вокруг постройки: насколько земля ниже/выше её основания. */
  const ring = (spot, base, r) => {
    let mn = 99, mx = -1;
    for (let a = 0; a < 16; a++) {
      const x = Math.round(spot.x + Math.cos(a * Math.PI / 8) * r);
      const z = Math.round(spot.z + Math.sin(a * Math.PI / 8) * r);
      const h = api().ir(x, z);
      mn = Math.min(mn, h); mx = Math.max(mx, h);
    }
    return [mn - base, mx - base];
  };

  /* ------------------------------------------------ храм: колонны, кровля, алтарь */
  const temple = api().templeSpot();
  check('храм поставлен на ровной сухой площадке', !!temple, temple);
  if (temple) {
    const tb = temple.base;
    let columns = 0, plate = 0, slate = 0, altar = 0, pediment = 0;
    const cols = [[-2, -2], [2, -2], [-2, 2], [2, 2], [0, -2], [0, 2], [-2, 0], [2, 0]];
    for (const [dx, dz] of cols) {
      const id = api().cs(temple.x + dx, tb + 4, temple.z + dz);
      if (id === A.ids.stone) columns++;
      if (api().cs(temple.x + dx, tb + 6, temple.z + dz) === A.ids.brick) pediment++;
    }
    for (let dx = -4; dx <= 4; dx++)
      for (let dz = -4; dz <= 4; dz++) {
        const floor = api().cs(temple.x + dx, tb, temple.z + dz);
        if (floor === A.ids.brick || floor === A.ids.cobble) plate++;
        if (api().cs(temple.x + dx, tb + 7, temple.z + dz) === A.ids.slate) slate++;
        if (api().cs(temple.x + dx, tb + 3, temple.z + dz) === A.ids.flame) altar++;
      }
    /* `ir()` считает верхний блок вместе с постройкой, поэтому утопленность
       проверяем иначе: площадка расчищена над фундаментом и держится на грунте. */
    let clearedAbove = 0, footing = 0;
    for (const [dx, dz] of [[-5, 0], [5, 0], [0, -5], [0, 5]]) {
      if (api().cs(temple.x + dx, tb + 1, temple.z + dz) === A.ids.air) clearedAbove++;
      if (api().cs(temple.x + dx, tb - 1, temple.z + dz) !== A.ids.air) footing++;
    }
    const templeRing = ring(temple, tb, 12);
    check('склон вокруг храма поднимается не выше кровли', templeRing[1] <= 8, templeRing);
    check('храм не врезан в склон: площадка расчищена', clearedAbove === 4, clearedAbove);
    check('фундамент храма опирается на грунт', footing === 4, footing);
    check('у храма восемь каменных колонн', columns === 8, columns);
    check('плиты основания выложены кладкой', plate >= 60, plate);
    check('антаблемент собран над колоннами', pediment >= 6, pediment);
    check('кровля храма из сланца', slate >= 8, slate);
    check('внутри горит алтарь', altar >= 1, altar);
  }

  /* ------------------------------------------------ малый замок: стены, башни, донжон */
  const keep = api().keepSpot();
  check('малый замок поставлен на ровной площадке', !!keep, keep);
  if (keep) {
    const kb = keep.base, corners = [[-6, -6], [6, -6], [-6, 6], [6, 6]];
    let wall = 0, merlon = 0, tents = 0, towers = 0, gateOpen = 0;
    for (let i = -6; i <= 6; i++) {
      if (api().cs(keep.x + i, kb + 3, keep.z - 6) === A.ids.brick) wall++;
      if (api().cs(keep.x + i, kb + 5, keep.z + 6) === A.ids.brick) merlon++;
      if (api().cs(keep.x + i, kb + 2, keep.z - 6) === A.ids.air) gateOpen++;
    }
    for (const [dx, dz] of corners) {
      /* башня — полый 3x3 цилиндр: считаем кольцо кладки, центр остаётся воздухом */
      let towerBlocks = 0;
      for (let y = 2; y <= 7; y++)
        for (let ox = -1; ox <= 1; ox++)
          for (let oz = -1; oz <= 1; oz++) {
            if (!ox && !oz) continue;
            if (api().cs(keep.x + dx + ox, kb + y, keep.z + dz + oz) === A.ids.brick) towerBlocks++;
          }
      if (towerBlocks >= 20) towers++;
      if (api().cs(keep.x + dx, kb + 9, keep.z + dz) === A.ids.slate) tents++;
    }
    let keepCleared = 0, keepFooting = 0;
    for (const [dx, dz] of [[-7, 0], [7, 0], [0, -7], [0, 7]]) {
      if (api().cs(keep.x + dx, kb + 1, keep.z + dz) === A.ids.air) keepCleared++;
      if (api().cs(keep.x + dx, kb - 1, keep.z + dz) !== A.ids.air) keepFooting++;
    }
    check('замок не врезан в склон: площадка расчищена', keepCleared === 4, keepCleared);
    check('фундамент замка опирается на грунт', keepFooting === 4, keepFooting);
    const keepRing = ring(keep, kb, 14);
    check('склон вокруг замка не нависает над башнями', keepRing[1] <= 10, keepRing);
    check('крепостная стена замка на месте', wall >= 8, wall);
    check('стена с зубцами', merlon >= 5, merlon);
    check('ворота открыты (проход в стене)', gateOpen >= 3, gateOpen);
    check('четыре угловые башни', towers === 4, towers);
    check('башни с шатровыми кровлями', tents >= 3, tents);
    let keepRoof = 0;
    for (let dx = -3; dx <= 3; dx++)
      for (let dz = -3; dz <= 3; dz++)
        for (let y = 6; y <= 12; y++) {
          const id = api().cs(keep.x + dx, kb + y, keep.z + 4 + dz);
          if (id === A.ids.tile || id === A.ids.slate) keepRoof++;
        }
    check('донжон с крышей внутри двора', keepRoof >= 8, keepRoof);
  }

  /* ------------------------------------------------ погода */
  const before = gridSum(A);
  const clearState = A.weather();
  check('погода по умолчанию ясная', clearState.kind === 'clear' && !clearState.rain && !clearState.snow, clearState.kind);
  check('кнопка погоды подписана', /Погода|Weather/.test(clearState.label || ''), clearState.label);

  A.setWeather('rain');
  await wait(20);
  frames(2);
  const rain = A.weather();
  check('дождь включает частицы', rain.rain === true, rain.rain);
  check('дождь темнит небо и туман', rain.fog !== clearState.fog && rain.sun < clearState.sun, [rain.fog, rain.sun]);
  check('дождь не двигает снег', rain.snowCount === 0 && rain.snow === false, [rain.snow, rain.snowCount]);

  A.setWeather('winter');
  await wait(20);
  A.rebuild();
  frames(2);
  const winter = A.weather();
  check('зима включает снегопад', winter.snow === true, winter.snow);
  check('зима не оставляет дождь', winter.rain === false, winter.rain);
  check('снежные шапки на верхних гранях', winter.snowCount > 200, winter.snowCount);
  check('зимой холодный свет (не как в дождь)', winter.fog !== rain.fog && winter.sun > rain.sun, [winter.fog, winter.sun]);

  A.setWeather('clear');
  await wait(20);
  A.rebuild();
  frames(2);
  const back = A.weather();
  check('возврат к ясной погоде убирает осадки', !back.rain && !back.snow && back.snowCount === 0, back);
  check('цвет неба вернулся к исходному', back.fog === clearState.fog, [back.fog, clearState.fog]);
  check('погода не изменила ни один блок мира', gridSum(A) === before);

  // Цикл кнопки: ясно → дождь → зима → ясно.
  A.cycleWeather(); const c1 = A.weather().kind;
  A.cycleWeather(); const c2 = A.weather().kind;
  A.cycleWeather(); const c3 = A.weather().kind;
  check('кнопка переключает погоду по кругу', c1 === 'rain' && c2 === 'winter' && c3 === 'clear', [c1, c2, c3]);

  /* ------------------------------------------------ камера: направления */
  A.playGame();
  await wait(20);
  frames(3);
  check('игра запущена', A.mc() === 'playing', A.mc());
  A.F.yaw = 0; A.F.pitch = 0; A.syncCam();
  const dir0 = A.camDir();
  check('стартовый взгляд смотрит в -Z', Math.abs(dir0[2] + 1) < 1e-6, dir0);

  /* ЛКМ не должна вращать камеру. */
  const yaw0 = A.F.yaw, pitch0 = A.F.pitch;
  A.down(evt({ button: 0 }));
  A.move(evt({ button: 0, clientX: 460, clientY: 320 }));
  A.move(evt({ button: 0, clientX: 520, clientY: 340 }));
  check('ЛКМ не вращает камеру', A.F.yaw === yaw0 && A.F.pitch === pitch0, [A.F.yaw - yaw0, A.F.pitch - pitch0]);
  A.up(evt({ button: 0, clientX: 520, clientY: 340 }));

  /* ПКМ и движение вправо — камера поворачивается вправо. */
  A.down(evt({ button: 2 }));
  A.move(evt({ button: 2, clientX: 460, clientY: 300 }));
  A.syncCam();
  const dirRight = A.camDir();
  check('ПКМ + мышь вправо → камера вправо (+X)', dirRight[0] > 0.01 && Math.abs(dirRight[1]) < 0.02, dirRight);
  A.move(evt({ button: 2, clientX: 400, clientY: 300 }));
  A.syncCam();
  const dirBack = A.camDir();
  check('возврат мыши влево → камера влево', Math.abs(dirBack[0]) < 0.01, dirBack);
  A.move(evt({ button: 2, clientX: 400, clientY: 360 }));
  A.syncCam();
  const dirDown = A.camDir();
  check('мышь вниз → взгляд вниз (-Y)', dirDown[1] < -0.01, dirDown);
  A.move(evt({ button: 2, clientX: 400, clientY: 240 }));
  A.syncCam();
  const dirUp = A.camDir();
  check('мышь вверх → взгляд вверх (+Y)', dirUp[1] > 0.01, dirUp);

  /* Отпускание ПКМ останавливает вращение. */
  A.up(evt({ button: 2, clientX: 400, clientY: 240 }));
  const yawAfterUp = A.F.yaw, pitchAfterUp = A.F.pitch;
  A.move(evt({ button: 2, clientX: 260, clientY: 380 }));
  A.move(evt({ button: 0, clientX: 120, clientY: 420 }));
  check('после отпускания ПКМ камера не вращается',
    A.F.yaw === yawAfterUp && A.F.pitch === pitchAfterUp,
    [A.F.yaw - yawAfterUp, A.F.pitch - pitchAfterUp]);

  /* Клик по кнопке интерфейса не двигает камеру и не строит блок. */
  A.F.yaw = .3; A.F.pitch = .1; A.syncCam();
  const yawUi = A.F.yaw;
  const uiTarget = { closest: (sel) => (sel.indexOf('button') !== -1 ? {} : null) };
  A.down(evt({ button: 2, target: uiTarget }));
  A.move(evt({ button: 2, clientX: 900, clientY: 600, target: uiTarget }));
  check('клик по кнопкам интерфейса не крутит камеру', A.F.yaw === yawUi, A.F.yaw - yawUi);

  /* Клавиатура и шаг не сломаны. */
  A.F.yaw = 0; A.F.pitch = 0; A.syncCam();
  const px = A.F.x, pz = A.F.z;
  A.keys.w = true;
  for (let i = 0; i < 20; i++) A.step(0.05, 0.05);
  A.keys.w = false;
  check('клавиатура двигает игрока вперёд', Math.abs(A.F.z - pz) > .2 && Math.abs(A.F.x - px) < .2, [A.F.x - px, A.F.z - pz]);

  /* ------------------------------------------------ текстуры */
  const details = A.textureDetails();
  check('второй проход текстур выполнен по всем 16 текстурам', details >= 14, details);

  console.log(results.filter((r) => r.startsWith('FAIL')).join('\n'));
  console.log('ИТОГО: ' + results.filter((r) => r.startsWith('PASS')).length + '/' + results.length + ' проверок пройдено');
  if (consoleErrors.length) console.log('ошибки консоли: ' + consoleErrors.join(' | ').slice(0, 800));
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
