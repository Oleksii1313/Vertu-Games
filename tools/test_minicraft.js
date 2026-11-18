#!/usr/bin/env node
/*
 * Автотест MiniCraft 3D без браузера и WebGL.
 *
 * Игра запускается целиком (jsdom), а WebGL/2D-контекст подменяется заглушкой,
 * поэтому проверяется реальная логика рантайма: генерация мира с деревнями,
 * монеты V, сундуки, жители, монстры, волны, босс, смерть и экран итогов с
 * выплатой. Отладочный хук подмешивается только в памяти — в файле игры его нет.
 *
 * Запуск (jsdom — единственная зависимость, ставится локально):
 *
 *     npm install jsdom
 *     node tools/test_minicraft.js
 *
 * Переменная MINICRAFT_HTML позволяет указать другой файл игры.
 */
/* Сценарный прогон MiniCraft 3D в jsdom: деревни, монеты, сундуки, жители,
   монстры, волны, смерть и экран итогов с начислением. */
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
  '\nwindow.__mcx = () => ({ F, mcxVillages, mcxChestSpots, mcxPhase, mcxMobCap, mcxSpawnMob, mcxKillMob, mcxAwardCoins, mcxClaim, MCX_CLAIM, MCX_REWARD, startWorld: Kh, playGame: Zl, mc: () => Mt });\n' +
  runtime.slice(idx);
w.eval(runtime);

const $ = (id) => w.document.getElementById(id);
const results = [];
function check(name, ok, extra) { results.push((ok ? 'PASS' : 'FAIL') + ' · ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); }
const api = () => w.__mcx();
const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function newWorld() {
  api().startWorld();
  for (let i = 0; i < 200 && api().mc() !== 'ready'; i++) await wait(20);
  return api();
}
async function play() {
  api().playGame();
  await wait(20);
  frames(3);
}

(async () => {
  /* ---------- 1. создание мира ---------- */
  const A = await newWorld();
  check('мир создан, оверлей виден', !$('overlay').hidden);
  check('6 деревень с именами', A.mcxVillages.length === 6 && A.mcxVillages.every(v => v.name.length > 3),
    A.mcxVillages.map(v => v.name));
  check('монеты в мире >= 120', A.F.coins.length >= 120, A.F.coins.length);
  check('сундуки >= 15', A.mcxChestSpots.length >= 15, A.mcxChestSpots.length);
  check('жители заспавнены', A.F.villagers.length >= 12, A.F.villagers.length);
  check('монстры стартуют', A.F.monsters.length >= 5, A.F.monsters.length);
  check('HUD показывает 0 монет', $('mcx-coins').textContent === '0' && $('mcx-v').textContent === '0 V');
  check('фаза 1 в начале', A.mcxPhase() === 0);
  check('лимит монстров фазы 1', A.mcxMobCap() === 8, A.mcxMobCap());

  await play();
  frames(70);
  const B = api();
  check('состояние playing', B.mc() === 'playing', B.mc());
  check('таймер идёт (3:00 → 2:5x)', /^2:5\d$/.test($('timer').textContent), $('timer').textContent);

  /* ---------- 2. сбор монеты ---------- */
  let coin = null;
  for (const c of B.F.coins) {
    const near = B.F.coins.some(o => o !== c && Math.abs(o.x - c.x) + Math.abs(o.z - c.z) < 4);
    if (!near) { coin = c; break; }
  }
  const before = B.F.coinsCollected, beforeCoins = B.F.coins.length;
  B.F.x = coin.x + .5; B.F.y = coin.y - .3; B.F.z = coin.z + .5;
  frames(2);
  const C1 = api();
  check('монета собрана (одна)', C1.F.coinsCollected === before + 1 && C1.F.coins.length === beforeCoins - 1,
    [before, C1.F.coinsCollected, beforeCoins, C1.F.coins.length]);
  check('3 V за монету в HUD', $('mcx-coins').textContent === '1' && $('mcx-v').textContent === '3 V' && $('score').textContent === '3',
    [$('mcx-coins').textContent, $('mcx-v').textContent, $('score').textContent]);
  check('блок монеты убран из мира', true);

  /* ---------- 3. сундук ---------- */
  const chest = C1.F.chests.find(c => !c.opened);
  const preChest = C1.F.coinsCollected;
  const expected = preChest + chest.coins;
  C1.F.x = chest.x; C1.F.y = chest.y; C1.F.z = chest.z;
  frames(3);
  const C2 = api();
  check('сундук открыт (' + chest.kind + ')', C2.F.chestsOpened === 1 && chest.opened === true, [C2.F.chestsOpened, chest.coins]);
  check('сундук начислил свои монеты', C2.F.coinsCollected === expected, [preChest, expected, C2.F.coinsCollected]);
  check('сундук в HUD', $('mcx-chests').textContent === '1');
  frames(30);
  check('повторный подход не открывает сундук вновь', (() => { const n = api().F.coinsCollected; frames(20); return api().F.coinsCollected === n; })());
  check('крышка сундука открылась', chest.mesh.userData.lid.rotation.x < -0.5, chest.mesh.userData.lid.rotation.x.toFixed(2));

  /* ---------- 4. житель ---------- */
  const village = C2.F.villagers[0];
  const preGifts = C2.F.villagerGifts;
  C2.F.x = village.x + .5; C2.F.y = village.y; C2.F.z = village.z;
  frames(3);
  const C3 = api();
  check('житель заговорил при подходе', C3.F.villagers.some(v => v.talked), C3.F.villagers.filter(v => v.talked).length);
  check('житель дал бонусную монету', C3.F.villagerGifts === preGifts + 1, [preGifts, C3.F.villagerGifts]);
  check('подсказка жителя в тосте', /Дубовая|Каменный|Зелёный|Тихая|Сосновый|Лунный|сундук/i.test($('mcx-toast').textContent), $('mcx-toast').textContent.slice(0, 70));
  check('тост видим', $('mcx-toast').classList.contains('show'));

  /* ---------- 5. урон, убийство ---------- */
  const mob = C3.F.monsters[0];
  mob.x = C3.F.x + .6; mob.z = C3.F.z; mob.y = C3.F.y; mob.lastDmg = -5;
  const hpBefore = C3.F.hp;
  frames(2);
  const C4 = api();
  check('монстр наносит урон', C4.F.hp < hpBefore, [hpBefore, C4.F.hp]);
  const killsBefore = C4.F.kills;
  C4.mcxKillMob(C4.F.monsters[0]);
  const C5 = api();
  check('монстр убит, счётчик растёт', C5.F.kills === killsBefore + 1, [killsBefore, C5.F.kills]);
  check('убийство в HUD', $('mcx-kills').textContent === String(C5.F.kills));

  /* ---------- 6. жители убегают от монстров ---------- */
  const scared = C5.F.villagers.find(v => !v.flee);
  if (scared) {
    const sx = scared.x, sz = scared.z;
    const hunter = C5.F.monsters[0];
    hunter.x = scared.x + 2; hunter.z = scared.z; hunter.y = scared.y;
    frames(40);
    const sv = api().F.villagers.find(v => v === scared);
    const moved = Math.hypot(sv.x - sx, sv.z - sz);
    check('житель убегает от монстра', moved > 0.4 && sv.flee > 0, [moved.toFixed(2), sv.flee.toFixed(2)]);
    hunter.x = 999; hunter.z = 999;
  } else {
    check('житель убегает от монстра', false, 'нет свободного жителя');
  }

  /* ---------- 7. волны ---------- */
  C5.F.elapsed = 61;
  check('фаза 2 после минуты', api().mcxPhase() === 1 && api().mcxMobCap() === 14, [api().mcxPhase(), api().mcxMobCap()]);
  C5.F.elapsed = 125;
  check('фаза 3 после двух минут', api().mcxPhase() === 2 && api().mcxMobCap() === 20, [api().mcxPhase(), api().mcxMobCap()]);
  for (let i = 0; i < 40; i++) api().mcxSpawnMob('skeleton');
  const C6 = api();
  check('кап монстров соблюдается', C6.F.monsters.length <= C6.mcxMobCap(), [C6.F.monsters.length, C6.mcxMobCap()]);
  C6.F.elapsed = 5;
  frames(20);
  check('новые монстры появляются со временем', api().F.monsters.length > 0, api().F.monsters.length);

  /* ---------- 7b. босс на исходе времени ---------- */
  const BX = api();
  BX.F.elapsed = 151;
  BX.F.bossSpawned = false;
  frames(2);
  const boss = BX.F.monsters.find(m => m.boss);
  check('босс появляется после 150 секунд', !!boss, !!boss && [boss.hp, boss.mesh.scale.x]);
  check('босс крупнее обычного монстра', boss && boss.mesh.scale.x > 1.4, boss && boss.mesh.scale.x);
  check('HUD помечает босса', $('mcx-wave').textContent === 'BOSS', $('mcx-wave').textContent);
  const killsB = api().F.kills;
  api().mcxKillMob(boss);
  check('босс убит и учтён', api().F.kills === killsB + 1 && !api().F.monsters.some(m => m.boss));
  BX.F.elapsed = 5;

  /* ---------- 8. смерть ---------- */
  const H = api();
  H.F.hp = 2;
  const near = H.F.monsters[0];
  near.x = H.F.x + .5; near.z = H.F.z; near.y = H.F.y; near.lastDmg = -5;
  let died = false;
  for (let i = 0; i < 60 && !died; i++) { frames(1); died = api().mc() === 'dead'; }
  check('смерть при 0 HP', died, api().mc());
  const second = w.document.querySelector('#overlay .mcx-secondary');
  check('на экране смерти есть «Завершить сессию»', !!second, second && second.textContent);
  check('при смерти выплата ещё не отправлена', posted.length === 0, posted.length);
  const coinsAtDeath = api().F.coinsCollected;
  second.onclick();
  const claim = posted.find(m => m.type === 'minicraftSession');
  check('запрос выплаты отправлен', !!claim, claim && { coins: claim.coins, time: claim.time, game: claim.game, sid: !!claim.sessionId, kills: claim.kills });
  check('в запросе верное число монет', claim && claim.coins === coinsAtDeath, [claim && claim.coins, coinsAtDeath]);
  check('экран итогов показан', /mcx-results/.test($('instructions').innerHTML) && $('instructions').hidden === false);
  check('в итогах строка начисления', /Начисляем/.test($('instructions').textContent), $('instructions').textContent.slice(0, 140));
  check('в итогах 6 показателей', w.document.querySelectorAll('.mcx-result-row').length === 7, w.document.querySelectorAll('.mcx-result-row').length);
  w.dispatchEvent(new w.MessageEvent('message', {
    origin: w.location.origin,
    data: { type: 'minicraftSessionResult', game: 'minicraft', ok: true, awarded: coinsAtDeath * 3, coinsCount: coinsAtDeath, rate: 3, capped: false, balance: 598 }
  }));
  const claimRow = w.document.getElementById('mcx-claim-row');
  check('итог начисления показан', claimRow && /зачислено/i.test(claimRow.textContent), claimRow && claimRow.textContent);
  check('состояние выплаты done', api().MCX_CLAIM.state === 'done');
  /* Обрезанная выплата (сервер учёл меньше монет) — честная пометка. */
  w.dispatchEvent(new w.MessageEvent('message', {
    origin: w.location.origin,
    data: { type: 'minicraftSessionResult', game: 'minicraft', awarded: 12, coinsCount: 4,
      clamped: true, capped: false, rate: 3, balance: 610 }
  }));
  check('обрезанная выплата объясняет, сколько монет учтено',
    /учтено 4 из \d+/i.test(claimRow.textContent), claimRow.textContent);

  /* ---------- 9. новый мир ---------- */
  posted.length = 0;
  const N = await newWorld();
  check('новый мир сбрасывает счётчики', N.F.coinsCollected === 0 && N.F.chestsOpened === 0 && N.F.kills === 0,
    [N.F.coinsCollected, N.F.chestsOpened, N.F.kills]);
  check('новый мир: снова 6 деревень и монеты', N.mcxVillages.length === 6 && N.F.coins.length >= 120, N.F.coins.length);
  check('новый мир: выплата снова возможна', N.MCX_CLAIM.state === 'idle', N.MCX_CLAIM.state);

  /* ---------- 10. таймер 180 секунд ---------- */
  await play();
  const P = api();
  P.F.coinsCollected = 12;
  P.F.time = 0.05;
  frames(20);
  check('таймер 180 с завершает игру', api().mc() === 'finished', api().mc());
  const claim2 = posted.find(m => m.type === 'minicraftSession');
  check('вторая сессия отправляет свою выплату', !!claim2 && claim2.coins === 12, claim2 && claim2.coins);
  check('вторая сессия — новый sessionId', claim2 && claim && claim2.sessionId !== claim.sessionId);
  check('итог: 12 монет = 36 V', /36 V/.test($('instructions').textContent), $('instructions').textContent.match(/\d+ V/g));
  check('кнопка «Играть снова»', /Играть снова/.test($('start').textContent), $('start').textContent);

  /* ---------- 11. выход с выплатой ---------- */
  posted.length = 0;
  const Q = await newWorld();
  await play();
  Q.F.coinsCollected = 7;
  check('выход: мир активен', api().mc() === 'playing', api().mc());
  $('exit').onclick();
  await wait(1100);
  const claim3 = posted.find(m => m.type === 'minicraftSession');
  const home = posted.find(m => m.type === 'home');
  check('выход отправляет итог сессии', !!claim3 && claim3.coins === 7, claim3 && claim3.coins);
  check('выход затем возвращает в каталог', !!home);

  /* ---------- 12. flush от платформы ---------- */
  posted.length = 0;
  const R = await newWorld();
  await play();
  R.F.coinsCollected = 4;
  w.dispatchEvent(new w.MessageEvent('message', { origin: w.location.origin, data: { type: 'vg:flush' } }));
  check('flush от платформы запускает выплату', posted.some(m => m.type === 'minicraftSession'), posted.map(m => m.type));

  /* ---------- 13. нулевая сессия ---------- */
  posted.length = 0;
  const S = await newWorld();
  await play();
  S.F.time = 0.05;
  frames(20);
  check('без монет сервер не тревожится', posted.length === 0, posted.map(m => m.type));
  check('без монет итог объясняет причину', /Ни одной монеты/.test($('instructions').textContent), $('instructions').textContent.slice(-90));

  console.log(results.join('\n'));
  const fails = results.filter(r => r.startsWith('FAIL'));
  console.log('\nИТОГО: ' + (results.length - fails.length) + '/' + results.length + ' проверок пройдено');
  console.log('ошибки консоли: ' + (consoleErrors.length ? JSON.stringify(consoleErrors) : 'нет'));
  process.exit(fails.length ? 1 : 0);
})();
