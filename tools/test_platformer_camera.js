#!/usr/bin/env node
/*
 * Платформер: камера, прыжок и столкновения — «живой» прогон игры.
 *
 * Страница загружается в jsdom, 2D-контекст холста подменяется заглушкой
 * (рисование не проверяем — проверяем физику), после чего игровой цикл
 * прокручивается вручную: персонаж бежит вправо и прыгает, а тест следит за
 * инвариантами.
 *
 *   1. Персонаж НИКОГДА не выходит за кадр сверху — ради этого и сделана
 *      вертикальная камера (раньше прыжок уносил его за верхний край).
 *   2. Камера плавно возвращается на землю (cameraY → 0), когда персонаж
 *      приземлился.
 *   3. Прыжок поднимает персонажа на предсказуемую высоту и не выше неё.
 *   4. Приземление срабатывает (grounded) и запускает анимацию squash.
 *   5. Персонаж не проваливается сквозь платформы и не улетает в бесконечное
 *      падение: падение в бездну возвращает его на последнюю платформу.
 *   6. Камера по горизонтали ведёт персонажа и не даёт уехать влево.
 *
 *     NODE_PATH=/tmp/dom/node_modules node tools/test_platformer_camera.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const PAGE = fs.readFileSync(path.join(ROOT, 'games/platformer.html'), 'utf8');

let passed = 0;
const failures = [];
function check(name, ok, extra) {
  if (ok) passed++;
  else failures.push(name + (extra === undefined ? '' : ' → ' + JSON.stringify(extra)));
}

/* Заглушка 2D-контекста: принимает любые вызовы, градиенты умеют addColorStop. */
function fakeCtx() {
  const grad = { addColorStop() {} };
  return new Proxy({}, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'createLinearGradient' || key === 'createRadialGradient' || key === 'createPattern') return () => grad;
      if (key === 'measureText') return () => ({ width: 10 });
      if (key === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      return () => {};
    },
    set(target, key, value) { target[key] = value; return true; },
  });
}

const vc = new VirtualConsole();
const errors = [];
vc.on('jsdomError', (e) => errors.push(String(e && e.message).slice(0, 200)));

const dom = new JSDOM(PAGE, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc,
  url: 'http://localhost/games/platformer.html',
  beforeParse(window) {
    window.HTMLCanvasElement.prototype.getContext = () => fakeCtx();
    window.AudioContext = function () {
      return {
        createOscillator: () => ({ frequency: { value: 0, linearRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} }),
        createGain: () => ({ gain: { value: 0, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }),
        destination: {}, currentTime: 0,
      };
    };
  },
});

const w = dom.window;
w.eval(`window.__PT = {
  get player(){ return player; },
  get cameraX(){ return cameraX; },
  get cameraY(){ return cameraY; },
  get VH(){ return VH; },
  get VW(){ return VW; },
  get platforms(){ return platforms; },
  get lives(){ return lives; },
  get running(){ return running; },
  get frame(){ return frame; },
  get jumpHeight(){ return jumpHeight(); },
  jump(v){ keys.Jump = v; },
  right(v){ keys.Right = v; },
  left(v){ keys.Left = v; },
  update,
  draw,
  start,
  step(n){ for (let i = 0; i < n; i++) update(); },
}`);

const PT = w.__PT;
check('игра запускается в песочнице без ошибок', !errors.length, errors.slice(0, 2));
let drawErrors = 0;
try { PT.draw(); } catch (e) { drawErrors++; }

const { VH, VW } = PT;
check('кадр игры посчитан (VW × VH)', VW > 200 && VH > 150, [VW, VH]);
check('кадр рисуется без ошибок (камера, squash, бездна)', drawErrors === 0, drawErrors);

/* ---------------------------------------------------------------- прыжок */
PT.start();
PT.right(true);
PT.step(10);
const groundY = PT.player.y;
check('персонаж стоит на первой платформе', PT.player.grounded, PT.player.grounded);

let topMost = Infinity;
PT.jump(true);
for (let i = 0; i < 24; i++) { PT.update(); topMost = Math.min(topMost, PT.player.y); }
PT.jump(false);
for (let i = 0; i < 60; i++) { PT.update(); topMost = Math.min(topMost, PT.player.y); }
const jumpH = groundY - topMost;
check('прыжок поднимает персонажа на 80–200 логических пикселей', jumpH > 80 && jumpH < 200, Math.round(jumpH));
check('высота прыжка сходится с формулой v²/2g', Math.abs(jumpH - PT.jumpHeight) < 45,
  [Math.round(jumpH), Math.round(PT.jumpHeight)]);
check('за время прыжка камера поднялась вместе с персонажем', PT.cameraY < 0, Math.round(PT.cameraY));
PT.step(80);
check('после приземления камера вернулась на землю', Math.abs(PT.cameraY) < 0.6, Math.round(PT.cameraY));
check('приземление сработало (grounded)', PT.player.grounded, PT.player.grounded);

/* ------------------------------------------------- главный инвариант: кадр */
PT.start();
let outTop = 0, outBottom = 0, worstTop = 0, deaths = 0, fell = 0, landings = 0;
let prevGrounded = true;
let prevLives = PT.lives;
PT.right(true);
for (let i = 0; i < 2600; i++) {
  /* прыгаем «по-человечески»: удержание 6–14 кадров, пауза 4–18 кадров */
  const phase = i % 26;
  PT.jump(phase > 3 && phase < 16);
  PT.update();
  const p = PT.player, camY = PT.cameraY, camX = PT.cameraX;
  if (p.y < camY - 0.5) { outTop++; worstTop = Math.min(worstTop, p.y - camY); }
  if (p.y + p.h > camY + VH + 0.5) outBottom++;
  if (!prevGrounded && p.grounded) landings++;
  if (PT.lives < prevLives) deaths++;
  prevGrounded = p.grounded;
  prevLives = PT.lives;
  if (p.y > camY + VH + 200) fell++;
  if (!PT.running) break;
  if (i % 30 === 0) PT.draw();   // рисование тоже прогоняем: ошибок быть не должно
}
check('персонаж ни разу не вышел за верхний край кадра', outTop === 0, { кадров: outTop, худшее: Math.round(worstTop) });
check('персонаж не проваливается ниже кадра (кроме падения в бездну, которое лечится возвратом)',
  outBottom <= 3, outBottom);
check('приземления происходят и анимация запускается', landings > 3, landings);
check('падение в бездну возвращает персонажа (жизни/респавн работают)', PT.lives < 3 || fell === 0, { deaths, fell });

/* ---------------------------------------------- горизонталь и левый край */
PT.start();
PT.step(3);
const camStart = PT.cameraX;
PT.right(true);
for (let i = 0; i < 260; i++) { PT.jump(i % 22 > 2 && i % 22 < 14); PT.update(); }
check('камера едет вправо вместе с персонажем', PT.cameraX > camStart + 100, Math.round(PT.cameraX - camStart));
check('персонаж держится в кадре по горизонтали',
  PT.player.x >= PT.cameraX && PT.player.x <= PT.cameraX + VW,
  [Math.round(PT.player.x), Math.round(PT.cameraX), VW]);
PT.right(false);
PT.left(true);
PT.step(300);
check('влево персонаж не выезжает за край кадра', PT.player.x >= PT.cameraX - 0.5,
  Math.round(PT.player.x - PT.cameraX));

/* ------------------------------------------- высокий кадр (телефон 360×640) */
w.eval('window.innerWidth=360;window.innerHeight=640;');
try { w.dispatchEvent(new w.Event('resize')); } catch (e) {}
PT.start();
PT.right(true);
let outTop2 = 0;
for (let i = 0; i < 600; i++) {
  PT.jump(i % 22 > 2 && i % 22 < 14);
  PT.update();
  if (PT.player.y < PT.cameraY - 0.5) outTop2++;
}
check('на узком телефоне персонаж тоже не выходит за кадр', outTop2 === 0, outTop2);

w.close();

console.log(failures.length ? 'ПРОВАЛЫ:\n  ' + failures.join('\n  ') + '\n' : '');
console.log('ИТОГО: ' + passed + '/' + (passed + failures.length) + ' проверок пройдено');
process.exit(failures.length ? 1 : 0);
