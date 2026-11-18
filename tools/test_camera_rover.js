#!/usr/bin/env node
/*
 * Камера Cosmo Kitchen (chefs-rover). Проверяем ровно то, что игрок чувствует
 * руками: драг вправо поворачивает вид вправо, влево — влево, вверх — взгляд
 * вверх, вниз — вниз; вращение идёт вокруг персонажа, вертикаль ограничена,
 * указатель захватывается (Pointer Lock) и обзор продолжается за канвасом,
 * ПКМ панорамирует, клик без движения остаётся кликом.
 *
 * Тестируется собранный рантайм из games/chefs-rover.html (именно он уходит
 * игрокам) плюс проверка, что источник games/rover-camera.js содержит ту же
 * логику — иначе после пересборки фикс потеряется.
 *
 *     NODE_PATH=/tmp/dom/node_modules node tools/test_camera_rover.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'games/chefs-rover.html'), 'utf8');
const SOURCE = fs.readFileSync(path.join(ROOT, 'games/rover-camera.js'), 'utf8');

let passed = 0;
const failures = [];
function check(name, ok, extra) {
  if (ok) passed++;
  else failures.push(name + (extra === undefined ? '' : ' → ' + JSON.stringify(extra)));
}
const near = (a, b, eps) => Math.abs(a - b) <= (eps === undefined ? 1e-6 : eps);

/* ------------------------------------------------------------- мини-вектор */
class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new V3(this.x, this.y, this.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  lerp(v, a) { this.x += (v.x - this.x) * a; this.y += (v.y - this.y) * a; this.z += (v.z - this.z) * a; return this; }
  toArray() { return [this.x, this.y, this.z]; }
}

/* ------------------------------------------ извлекаем класс из рантайма игры */
function extractRuntimeClass() {
  const start = HTML.indexOf('var ll=');
  if (start === -1) throw new Error('класс камеры не найден в рантайме');
  const head = HTML.lastIndexOf('const LOCK_THRESHOLD', start);
  const tail = HTML.indexOf('};function ', start);
  if (tail === -1) throw new Error('конец класса камеры не найден');
  return HTML.slice(head === -1 ? start : head, tail + 2);
}

function makeEnv() {
  const element = {
    listeners: {},
    locks: 0,
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    fire(type, event) { (this.listeners[type] || []).forEach((fn) => fn(event)); },
    setPointerCapture() {}, hasPointerCapture() { return true; }, releasePointerCapture() {},
    requestPointerLock() { this.locks++; return Promise.resolve(); },
  };
  const document = {
    listeners: {},
    pointerLockElement: null,
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    fire(type, event) { (this.listeners[type] || []).forEach((fn) => fn(event)); },
    exitPointerLock() { this.pointerLockElement = null; this.fire('pointerlockchange', {}); },
  };
  const code = extractRuntimeClass() + '\nreturn ll;';
  const Camera = new Function('P', '$t', 'document', code)(V3, {clamp: (v, a, b) => Math.min(b, Math.max(a, v))}, document);
  return {Camera, element, document};
}

function makeRig(env, options = {}) {
  const {Camera, element, document} = env;
  const world = {position: new V3(), lookAt(v) { this.look = v; }};
  const kitchen = {position: new V3(), lookAt(v) { this.look = v; }};
  const focus = options.focus || {context: 'kitchen', heading: 0, position: new V3(0, 1.24, 0)};
  const rig = new Camera({
    element, worldCamera: world, kitchenCamera: kitchen,
    focus: () => focus,
    terrain: () => 0, solids: () => [],
    enabled: options.enabled || (() => true),
    tap: options.tap || (() => {}),
  });
  return {rig, world, kitchen, focus, element, document};
}

function drag(element, {button = 0, from = [100, 100], to, pointerType = 'mouse', id = 1} = {}) {
  element.fire('pointerdown', {pointerId: id, clientX: from[0], clientY: from[1], button, pointerType, preventDefault() {}});
  let x = from[0], y = from[1];
  const steps = 4;
  for (let i = 1; i <= steps; i++) {
    const nx = from[0] + (to[0] - from[0]) * i / steps;
    const ny = from[1] + (to[1] - from[1]) * i / steps;
    element.fire('pointermove', {pointerId: id, clientX: nx, clientY: ny, button, pointerType, movementX: nx - x, movementY: ny - y, preventDefault() {}});
    x = nx; y = ny;
  }
}

/* ------------------------------------------------------------------- тесты */
{
  // Драг вправо: взгляд поворачивается вправо, камера обходит игрока.
  const env = makeEnv();
  const rig = makeRig(env);
  drag(env.element, {to: [160, 100]});
  const before = rig.rig.states.kitchen.yaw;
  check('драг вправо увеличивает yaw', before > 0, before);
  rig.rig.update(0.5);
  const s = rig.rig.states.kitchen;
  check('после плавного сведения yaw положительный', s.cyaw > 0, s.cyaw);
  const target = rig.focus.position;
  const dx = rig.kitchen.position.x - target.x, dz = rig.kitchen.position.z - target.z;
  check('камера стоит позади-сбоку: смещение по X отрицательное', dx < -0.01, [dx, dz]);
  const dir = rig.rig.snapshot().direction;
  check('взгляд направлен вправо (+X)', dir[0] > 0.01, dir);
  check('камера смотрит на игрока (lookAt = позиция + взгляд)',
    near(rig.kitchen.position.x + dir[0], rig.kitchen.look.x, 1e-6) && near(rig.kitchen.position.z + dir[2], rig.kitchen.look.z, 1e-6),
    {look: rig.kitchen.look, dir});
}

{
  // Драг влево — обратное направление.
  const env = makeEnv();
  const rig = makeRig(env);
  drag(env.element, {to: [40, 100]});
  rig.rig.update(0.4);
  check('драг влево уменьшает yaw', rig.rig.states.kitchen.cyaw < 0, rig.rig.states.kitchen.cyaw);
  check('взгляд направлен влево (-X)', rig.rig.snapshot().direction[0] < -0.01, rig.rig.snapshot().direction);
}

{
  // Драг вверх — взгляд вверх; вниз — вниз.
  const env = makeEnv();
  const rig = makeRig(env);
  drag(env.element, {to: [100, 60]});
  rig.rig.update(0.4);
  check('драг вверх поднимает взгляд', rig.rig.states.kitchen.pitch > -0.46 + 0.05 &&
    rig.rig.snapshot().direction[1] > Math.sin(-0.46), rig.rig.states.kitchen.pitch);
  const up = rig.rig.states.kitchen.cyaw;
  check('вертикальный драг не меняет горизонтальный угол', near(up, 0, 1e-9), up);

  const env2 = makeEnv();
  const rig2 = makeRig(env2);
  drag(env2.element, {to: [100, 160]});
  rig2.rig.update(0.4);
  check('драг вниз опускает взгляд', rig2.rig.snapshot().direction[1] < 0, rig2.rig.snapshot().direction[1]);
  check('при взгляде вниз камера остаётся выше игрока',
    rig2.kitchen.position.y > rig2.focus.position.y - 0.05,
    [rig2.kitchen.position.y, rig2.focus.position.y]);
}

{
  // Ограничения вертикали: сколько ни тяни, переворота нет.
  const env = makeEnv();
  const rig = makeRig(env);
  for (let i = 0; i < 12; i++) drag(env.element, {to: [100, 40], from: [100, 200], id: 10 + i});
  const s = rig.rig.states.kitchen;
  check('верхний предел наклона ограничен', s.pitch <= 0.83 + 1e-9, s.pitch);
  for (let i = 0; i < 20; i++) drag(env.element, {to: [100, 300], from: [100, 0], id: 40 + i});
  check('нижний предел наклона ограничен', s.pitch >= -1.30 - 1e-9, s.pitch);
  check('наклон не выходит за ±90° (нет переворота)', Math.abs(s.pitch) < Math.PI / 2 - 0.05, s.pitch);
}

{
  // Pointer Lock: запрос только после порога движения, обзор за канвасом.
  const env = makeEnv();
  const rig = makeRig(env);
  env.element.fire('pointerdown', {pointerId: 1, clientX: 100, clientY: 100, button: 0, pointerType: 'mouse', preventDefault() {}});
  check('захват не запрашивается в момент нажатия', env.element.locks === 0, env.element.locks);
  env.element.fire('pointermove', {pointerId: 1, clientX: 103, clientY: 100, button: 0, pointerType: 'mouse', movementX: 3, preventDefault() {}});
  check('мелкое дрожание курсора не включает Pointer Lock', env.element.locks === 0, env.element.locks);
  env.element.fire('pointermove', {pointerId: 1, clientX: 140, clientY: 100, button: 0, pointerType: 'mouse', movementX: 37, preventDefault() {}});
  check('после порога запрошен Pointer Lock', env.element.locks === 1, env.element.locks);

  env.document.pointerLockElement = env.element;
  env.document.fire('pointerlockchange', {});
  check('состояние захвата применено', rig.rig.locked === true, rig.rig.locked);
  const yawBefore = rig.rig.states.kitchen.yaw;
  env.document.fire('mousemove', {movementX: 120, movementY: 0});
  check('при захвате обзор продолжается за канвасом',
    rig.rig.states.kitchen.yaw > yawBefore && near(rig.rig.states.kitchen.yaw - yawBefore, 120 * 0.005, 1e-9),
    rig.rig.states.kitchen.yaw - yawBefore);
  env.document.fire('mousemove', {movementX: 0, movementY: -80});
  check('при захвате работает вертикаль', rig.rig.states.kitchen.pitch > -0.46, rig.rig.states.kitchen.pitch);

  env.element.fire('pointerup', {pointerId: 1, clientX: 140, clientY: 100, button: 0, pointerType: 'mouse'});
  check('отпускание кнопки снимает захват', env.document.pointerLockElement === null, env.document.pointerLockElement);
  check('после отпускания указателей нет', rig.rig.snapshot().pointers === 0, rig.rig.snapshot().pointers);
}

{
  // Клик без движения остаётся кликом и не захватывает указатель.
  let taps = 0;
  const env = makeEnv();
  const rig = makeRig(env, {tap: () => taps++});
  env.element.fire('pointerdown', {pointerId: 1, clientX: 100, clientY: 100, button: 0, pointerType: 'mouse', preventDefault() {}});
  env.element.fire('pointerup', {pointerId: 1, clientX: 100, clientY: 100, button: 0, pointerType: 'mouse'});
  check('клик без движения вызывает tap', taps === 1, taps);
  check('клик без движения не захватывает указатель', env.element.locks === 0, env.element.locks);
  check('клик без движения не вращает камеру', near(rig.rig.states.kitchen.yaw, 0), rig.rig.states.kitchen.yaw);
}

{
  // ПКМ панорамирует и не крутит обзор; колесо меняет дистанцию в пределах.
  const env = makeEnv();
  const rig = makeRig(env);
  const yaw = rig.rig.states.kitchen.yaw;
  drag(env.element, {button: 2, to: [160, 120]});
  check('ПКМ не меняет yaw', near(rig.rig.states.kitchen.yaw, yaw), rig.rig.states.kitchen.yaw);
  check('ПКМ сдвигает точку вращения', Math.hypot(rig.rig.states.kitchen.pan.x, rig.rig.states.kitchen.pan.z) > 0.001,
    rig.rig.states.kitchen.pan.toArray());
  for (let i = 0; i < 40; i++) env.element.fire('wheel', {deltaY: 120, deltaMode: 0, preventDefault() {}});
  check('колесо ограничено сверху', rig.rig.states.kitchen.distance <= 5.2 + 1e-9, rig.rig.states.kitchen.distance);
  for (let i = 0; i < 40; i++) env.element.fire('wheel', {deltaY: -120, deltaMode: 0, preventDefault() {}});
  check('колесо ограничено снизу', rig.rig.states.kitchen.distance >= 1.15 - 1e-9, rig.rig.states.kitchen.distance);
}

{
  // Тач-свайп тоже вращает камеру (ветка без Pointer Lock).
  const env = makeEnv();
  const rig = makeRig(env);
  drag(env.element, {pointerType: 'touch', to: [170, 100]});
  check('тач-свайп вправо вращает вид вправо', rig.rig.states.kitchen.yaw > 0, rig.rig.states.kitchen.yaw);
  check('тач не запрашивает Pointer Lock', env.element.locks === 0, env.element.locks);
}

{
  // Открыли меню (enabled() === false) — захват снимается, ввод игнорируется.
  const env = makeEnv();
  let alive = true;
  const rig = makeRig(env, {enabled: () => alive});
  drag(env.element, {to: [160, 100]});
  env.document.pointerLockElement = env.element;
  env.document.fire('pointerlockchange', {});
  alive = false;
  rig.rig.update(0.016);
  check('при открытом меню захват снимается', env.document.pointerLockElement === null, env.document.pointerLockElement);
  check('при открытом меню ввод не копится', rig.rig.snapshot().pointers === 0, rig.rig.snapshot().pointers);
}

{
  // Колёсико/сброс/снапшот остались на месте — старые функции не потеряны.
  const env = makeEnv();
  const rig = makeRig(env);
  drag(env.element, {to: [160, 100]});
  rig.rig.reset();
  check('reset возвращает обзор к стандартному', near(rig.rig.states.kitchen.yaw, 0) && near(rig.rig.states.kitchen.pitch, -0.46),
    rig.rig.snapshot());
  const snap = rig.rig.snapshot();
  check('snapshot отдаёт позицию и взгляд', Array.isArray(snap.position) && snap.position.length === 3 &&
    Array.isArray(snap.direction) && snap.direction.length === 3, snap);
}

{
  // Источник и собранная игра должны совпадать по логике.
  check('источник: обзор со знаком «+» и Pointer Lock',
    /s\.yaw \+= T\.MathUtils\.clamp\(dx/.test(SOURCE) && /requestPointerLock/.test(SOURCE) &&
    /relative\(e\)/.test(SOURCE), null);
  check('источник: левая кнопка не запрещена', !/button !== 2/.test(SOURCE));
  check('рантайм: Pointer Lock подключён', /requestPointerLock/.test(extractRuntimeClass()));
}

if (failures.length) console.log('ПРОВАЛЫ:\n  ' + failures.join('\n  '));
console.log('ИТОГО: ' + passed + '/' + (passed + failures.length) + ' проверок пройдено');
process.exit(failures.length ? 1 : 0);
