#!/usr/bin/env node
/*
 * Камера Cosmo Kitchen (chefs-rover). Проверяем ровно то, что игрок чувствует
 * руками:
 *
 *   - ПКМ зажата, мышь вправо — камера поворачивается вправо, влево — влево,
 *     вверх — взгляд вверх, вниз — вниз;
 *   - отпустил ПКМ — вращение прекращается сразу;
 *   - ЛКМ остаётся игровым кликом (tap), а не «залипшей» камерой;
 *   - колесо приближает и отдаляет в пределах;
 *   - вертикаль ограничена, переворота нет;
 *   - отказ setPointerCapture (InvalidStateError) не ломает камеру и не
 *     всплывает наружу: драг слушается на window;
 *   - колесо/сброс/снапшот/тач-жесты работают как раньше.
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
  const head = HTML.indexOf('/*\n * Camera rig for the rover/kitchen game.');
  if (head === -1) throw new Error('класс камеры не найден в рантайме');
  const start = HTML.indexOf('var ll=class RoverCamera', head);
  if (start === -1) throw new Error('класс RoverCamera не найден в рантайме');
  const tail = HTML.indexOf('};function ', start);
  if (tail === -1) throw new Error('конец класса камеры не найден');
  return HTML.slice(head, tail + 2);
}

function fakeElement(extra = {}) {
  const listeners = {};
  const node = {
    listeners,
    locks: 0,
    connected: true,
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    fire(type, event) { (listeners[type] || []).forEach((fn) => fn(event)); },
    setPointerCapture() {},
    hasPointerCapture() { return true; },
    releasePointerCapture() {},
    requestPointerLock() { this.locks++; return Promise.resolve(); },
    ...extra,
  };
  Object.defineProperty(node, 'isConnected', { get() { return node.connected; } });
  return node;
}

function makeEnv(options = {}) {
  const element = fakeElement(options.element);
  const document = {
    listeners: {},
    hidden: false,
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    fire(type, event) { (this.listeners[type] || []).forEach((fn) => fn(event)); },
  };
  const window = {
    listeners: {},
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    fire(type, event) { (this.listeners[type] || []).forEach((fn) => fn(event)); },
  };
  const code = extractRuntimeClass() + '\nreturn ll;';
  const Camera = new Function('P', '$t', 'window', 'document', code)(
    V3, { clamp: (v, a, b) => Math.min(b, Math.max(a, v)) }, window, document);
  return { Camera, element, document, window };
}

function makeRig(env, options = {}) {
  const { Camera, element, document, window } = env;
  const world = { position: new V3(), lookAt(v) { this.look = v; } };
  const kitchen = { position: new V3(), lookAt(v) { this.look = v; } };
  const focus = options.focus || { context: 'kitchen', heading: 0, position: new V3(0, 1.24, 0) };
  const rig = new Camera({
    element, worldCamera: world, kitchenCamera: kitchen,
    focus: () => focus,
    terrain: () => 0, solids: () => [],
    enabled: options.enabled || (() => true),
    tap: options.tap || (() => {}),
  });
  return { rig, world, kitchen, focus, element, document, window };
}

/* ПКМ/ЛКМ/тач-драг: нажатие на канвасе, движение — на window (так работает
   игра: курсор может уйти за пределы канваса). */
function drag(env, { button = 2, from = [100, 100], to, pointerType = 'mouse', id = 1, moveTarget = 'window' } = {}) {
  const event = (x, y, extra = {}) => ({
    pointerId: id, clientX: x, clientY: y, button, pointerType, preventDefault() {}, cancelable: true, ...extra,
  });
  env.element.fire('pointerdown', event(from[0], from[1]));
  const steps = 4;
  for (let i = 1; i <= steps; i++) {
    const nx = from[0] + (to[0] - from[0]) * i / steps;
    const ny = from[1] + (to[1] - from[1]) * i / steps;
    const ev = event(nx, ny, { movementX: (to[0] - from[0]) / steps, movementY: (to[1] - from[1]) / steps });
    if (moveTarget === 'element') env.element.fire('pointermove', ev);
    else env.window.fire('pointermove', ev);
  }
  env.window.fire('pointerup', event(to[0], to[1]));
}

/* ------------------------------------------------------------------- тесты */
{
  // ПКМ вправо: взгляд поворачивается вправо, камера обходит игрока.
  const env = makeEnv();
  const rig = makeRig(env);
  drag(env, { to: [160, 100] });
  const yaw = rig.rig.states.kitchen.yaw;
  check('ПКМ вправо увеличивает yaw', yaw > 0, yaw);
  check('после отпускания ПКМ указатели отпущены', rig.rig.pointers.size === 0, rig.rig.pointers.size);
  rig.rig.update(0.5);
  const s = rig.rig.states.kitchen;
  check('после плавного сведения yaw положительный', s.cyaw > 0, s.cyaw);
  const target = rig.focus.position;
  const dx = rig.kitchen.position.x - target.x;
  check('камера стоит позади-сбоку: смещение по X отрицательное', dx < -0.01, dx);
  const dir = rig.rig.snapshot().direction;
  check('взгляд направлен вправо (+X)', dir[0] > 0.01, dir);
  check('камера смотрит на игрока (lookAt = позиция + взгляд)',
    near(rig.kitchen.position.x + dir[0], rig.kitchen.look.x, 1e-6) &&
    near(rig.kitchen.position.z + dir[2], rig.kitchen.look.z, 1e-6),
    { look: rig.kitchen.look, dir });
}

{
  // ПКМ влево — обратное направление.
  const env = makeEnv();
  const rig = makeRig(env);
  drag(env, { to: [40, 100] });
  rig.rig.update(0.4);
  check('ПКМ влево уменьшает yaw', rig.rig.states.kitchen.cyaw < 0, rig.rig.states.kitchen.cyaw);
  check('взгляд направлен влево (-X)', rig.rig.snapshot().direction[0] < -0.01, rig.rig.snapshot().direction);
}

{
  // ПКМ вверх — взгляд вверх; вниз — вниз.
  const env = makeEnv();
  const rig = makeRig(env);
  drag(env, { to: [100, 60] });
  rig.rig.update(0.4);
  check('ПКМ вверх поднимает взгляд', rig.rig.states.kitchen.pitch > -0.46 + 0.05 &&
    rig.rig.snapshot().direction[1] > Math.sin(-0.46), rig.rig.states.kitchen.pitch);
  check('вертикальный драг не меняет горизонтальный угол', near(rig.rig.states.kitchen.cyaw, 0, 1e-9), rig.rig.states.kitchen.cyaw);

  const env2 = makeEnv();
  const rig2 = makeRig(env2);
  drag(env2, { to: [100, 160] });
  rig2.rig.update(0.4);
  check('ПКМ вниз опускает взгляд', rig2.rig.snapshot().direction[1] < 0, rig2.rig.snapshot().direction[1]);
  check('при взгляде вниз камера остаётся выше игрока',
    rig2.kitchen.position.y > rig2.focus.position.y - 0.05,
    [rig2.kitchen.position.y, rig2.focus.position.y]);
}

{
  // Отпустил ПКМ — вращение сразу прекращается.
  const env = makeEnv();
  const rig = makeRig(env);
  drag(env, { to: [160, 100] });
  const yaw = rig.rig.states.kitchen.yaw;
  env.window.fire('pointermove', { pointerId: 1, clientX: 400, clientY: 100, button: 2, pointerType: 'mouse', preventDefault() {} });
  env.window.fire('pointermove', { pointerId: 1, clientX: 600, clientY: 300, button: 2, pointerType: 'mouse', preventDefault() {} });
  check('после отпускания ПКМ движение мыши не крутит камеру', near(rig.rig.states.kitchen.yaw, yaw), [rig.rig.states.kitchen.yaw, yaw]);
  check('после отпускания ПКМ указателей нет', rig.rig.snapshot().pointers === 0, rig.rig.snapshot().pointers);
}

{
  // Ограничения вертикали: сколько ни тяни, переворота нет.
  const env = makeEnv();
  const rig = makeRig(env);
  for (let i = 0; i < 12; i++) drag(env, { to: [100, 40], from: [100, 200], id: 10 + i });
  const s = rig.rig.states.kitchen;
  check('верхний предел наклона ограничен', s.pitch <= 0.83 + 1e-9, s.pitch);
  for (let i = 0; i < 20; i++) drag(env, { to: [100, 300], from: [100, 0], id: 40 + i });
  check('нижний предел наклона ограничен', s.pitch >= -1.30 - 1e-9, s.pitch);
  check('наклон не выходит за ±90° (нет переворота)', Math.abs(s.pitch) < Math.PI / 2 - 0.05, s.pitch);
}

{
  // ЛКМ — игровой клик: camera не крутится, tap срабатывает один раз.
  let taps = 0;
  const env = makeEnv();
  const rig = makeRig(env, { tap: () => taps++ });
  env.element.fire('pointerdown', { pointerId: 1, clientX: 100, clientY: 100, button: 0, pointerType: 'mouse', preventDefault() {} });
  env.window.fire('pointerup', { pointerId: 1, clientX: 100, clientY: 100, button: 0, pointerType: 'mouse' });
  check('ЛКМ-клик вызывает игровое действие (tap)', taps === 1, taps);
  check('ЛКМ-клик не вращает камеру', near(rig.rig.states.kitchen.yaw, 0), rig.rig.states.kitchen.yaw);
  check('ЛКМ-клик не запрашивает Pointer Lock', env.element.locks === 0, env.element.locks);

  // Заметный драг ЛКМ тоже вращает вид — но tap при этом не срабатывает.
  drag(env, { button: 0, to: [170, 100] });
  check('драг ЛКМ тоже поворачивает камеру', rig.rig.states.kitchen.yaw > 0, rig.rig.states.kitchen.yaw);
  check('драг ЛКМ не считается кликом', taps === 1, taps);
}

{
  // Отказ setPointerCapture (InvalidStateError) не должен ничего ломать.
  let captureCalls = 0;
  const env = makeEnv({
    element: {
      setPointerCapture() {
        captureCalls++;
        const err = new Error("Failed to execute 'setPointerCapture' on 'Element': InvalidStateError");
        err.name = 'InvalidStateError';
        throw err;
      },
      hasPointerCapture() { return false; },
      releasePointerCapture() {},
    },
  });
  const rig = makeRig(env);
  let threw = null;
  try { drag(env, { to: [160, 100] }); } catch (e) { threw = e; }
  check('ошибка захвата указателя не вылетает наружу', threw === null, threw && String(threw));
  check('захват всё равно был запрошен один раз', captureCalls === 1, captureCalls);
  check('обзор работает и без захвата указателя', rig.rig.states.kitchen.yaw > 0, rig.rig.states.kitchen.yaw);
  rig.rig.update(0.3);
  check('камера обновляется после отказа захвата', rig.rig.states.kitchen.cyaw > 0, rig.rig.states.kitchen.cyaw);
}

{
  // Канвас уже вне документа: захват не запрашивается, но обзор живёт.
  let captureCalls = 0;
  const env = makeEnv({ element: { setPointerCapture() { captureCalls++; }, hasPointerCapture() { return false; }, releasePointerCapture() {} } });
  env.element.connected = false;
  const rig = makeRig(env);
  let threw = null;
  try { drag(env, { to: [160, 100] }); } catch (e) { threw = e; }
  check('отсоединённый канвас не бросает исключений', threw === null, threw && String(threw));
  check('на отсоединённом канвасе захват не запрашивается', captureCalls === 0, captureCalls);
  check('обзор работает на отсоединённом канвасе', rig.rig.states.kitchen.yaw > 0, rig.rig.states.kitchen.yaw);
}

{
  // Колесо: приближение/отдаление в пределах и без «прыжков».
  const env = makeEnv();
  const rig = makeRig(env);
  const before = rig.rig.states.kitchen.distance;
  env.element.fire('wheel', { deltaY: -120, deltaMode: 0, cancelable: true, preventDefault() {} });
  check('колесо приближает', rig.rig.states.kitchen.distance < before, [rig.rig.states.kitchen.distance, before]);
  for (let i = 0; i < 40; i++) env.element.fire('wheel', { deltaY: 120, deltaMode: 0, cancelable: true, preventDefault() {} });
  check('колесо ограничено сверху', rig.rig.states.kitchen.distance <= 5.2 + 1e-9, rig.rig.states.kitchen.distance);
  for (let i = 0; i < 40; i++) env.element.fire('wheel', { deltaY: -120, deltaMode: 0, cancelable: true, preventDefault() {} });
  check('колесо ограничено снизу', rig.rig.states.kitchen.distance >= 1.15 - 1e-9, rig.rig.states.kitchen.distance);
  check('колесо не меняет углы', near(rig.rig.states.kitchen.yaw, 0) && near(rig.rig.states.kitchen.pitch, -0.46),
    rig.rig.snapshot());
}

{
  // Ввод не должен копиться: pointercancel, blur окна и смена вкладки.
  const env = makeEnv();
  const rig = makeRig(env);
  env.element.fire('pointerdown', { pointerId: 1, clientX: 100, clientY: 100, button: 2, pointerType: 'mouse', preventDefault() {} });
  check('нажатие ПКМ зарегистрировано', rig.rig.pointers.size === 1, rig.rig.pointers.size);
  env.window.fire('pointercancel', { pointerId: 1, preventDefault() {} });
  check('pointercancel снимает нажатие', rig.rig.pointers.size === 0, rig.rig.pointers.size);

  env.element.fire('pointerdown', { pointerId: 2, clientX: 100, clientY: 100, button: 2, pointerType: 'mouse', preventDefault() {} });
  env.window.fire('blur', {});
  check('потеря фокуса окна снимает нажатие', rig.rig.pointers.size === 0, rig.rig.pointers.size);

  env.element.fire('pointerdown', { pointerId: 3, clientX: 100, clientY: 100, button: 2, pointerType: 'mouse', preventDefault() {} });
  env.document.hidden = true;
  env.document.fire('visibilitychange', {});
  check('скрытая вкладка снимает нажатие', rig.rig.pointers.size === 0, rig.rig.pointers.size);
  env.document.hidden = false;

  env.element.fire('pointerdown', { pointerId: 4, clientX: 100, clientY: 100, button: 2, pointerType: 'mouse', preventDefault() {} });
  env.document.fire('fullscreenchange', {});
  check('выход из полного экрана снимает нажатие', rig.rig.pointers.size === 0, rig.rig.pointers.size);
}

{
  // Контекстное меню не мешает управлению.
  const env = makeEnv();
  const rig = makeRig(env);
  let elementPrevented = 0;
  let windowPrevented = 0;
  const evt = (map) => ({ preventDefault() { map(); } });
  env.element.fire('contextmenu', evt(() => elementPrevented++));
  env.element.fire('pointerdown', { pointerId: 1, clientX: 10, clientY: 10, button: 2, pointerType: 'mouse', preventDefault() {} });
  env.window.fire('contextmenu', evt(() => windowPrevented++));
  check('контекстное меню на канвасе блокируется', elementPrevented === 1, elementPrevented);
  check('контекстное меню во время управления блокируется', windowPrevented === 1, windowPrevented);
  env.window.fire('pointerup', { pointerId: 1, preventDefault() {} });
  env.window.fire('contextmenu', evt(() => windowPrevented++));
  check('вне управления контекстное меню не трогаем', windowPrevented === 1, windowPrevented);
  void rig;
}

{
  // Тач: свайп вращает, жест двумя пальцами работает, отпускание не «прыгает».
  const env = makeEnv();
  const rig = makeRig(env);
  drag(env, { pointerType: 'touch', to: [170, 100] });
  check('тач-свайп вправо вращает вид вправо', rig.rig.states.kitchen.yaw > 0, rig.rig.states.kitchen.yaw);
  check('тач не запрашивает Pointer Lock', env.element.locks === 0, env.element.locks);

  const env2 = makeEnv();
  const rig2 = makeRig(env2);
  const down = (id, x, y) => env2.element.fire('pointerdown', { pointerId: id, clientX: x, clientY: y, button: 0, pointerType: 'touch', preventDefault() {} });
  const move = (id, x, y) => env2.window.fire('pointermove', { pointerId: id, clientX: x, clientY: y, button: 0, pointerType: 'touch', preventDefault() {} });
  down(1, 100, 100); down(2, 200, 100);
  const distance = rig2.rig.states.kitchen.distance;
  move(2, 260, 100);
  check('сведение/разведение пальцев меняет масштаб', !near(rig2.rig.states.kitchen.distance, distance), rig2.rig.states.kitchen.distance);
  env2.window.fire('pointerup', { pointerId: 2, clientX: 260, clientY: 100, button: 0, pointerType: 'touch' });
  const yawAfterLift = rig2.rig.states.kitchen.yaw;
  move(1, 100, 100);
  check('после жеста оставшийся палец не даёт прыжка', near(rig2.rig.states.kitchen.yaw, yawAfterLift), [rig2.rig.states.kitchen.yaw, yawAfterLift]);
  void rig2;
}

{
  // Открыли меню (enabled() === false) — ввод игнорируется и очищается.
  const env = makeEnv();
  let alive = true;
  const rig = makeRig(env, { enabled: () => alive });
  drag(env, { to: [160, 100] });
  env.element.fire('pointerdown', { pointerId: 9, clientX: 100, clientY: 100, button: 2, pointerType: 'mouse', preventDefault() {} });
  alive = false;
  rig.rig.update(0.016);
  check('при открытом меню ввод не копится', rig.rig.snapshot().pointers === 0, rig.rig.snapshot().pointers);
  const yaw = rig.rig.states.kitchen.yaw;
  env.element.fire('pointerdown', { pointerId: 10, clientX: 100, clientY: 100, button: 2, pointerType: 'mouse', preventDefault() {} });
  env.window.fire('pointermove', { pointerId: 10, clientX: 300, clientY: 100, button: 2, pointerType: 'mouse', cancelable: true, preventDefault() {} });
  check('при открытом меню камера не крутится', near(rig.rig.states.kitchen.yaw, yaw), [rig.rig.states.kitchen.yaw, yaw]);
}

{
  // Сброс и снапшот остались на месте — старые функции не потеряны.
  const env = makeEnv();
  const rig = makeRig(env);
  drag(env, { to: [160, 100] });
  rig.rig.reset();
  check('reset возвращает обзор к стандартному', near(rig.rig.states.kitchen.yaw, 0) && near(rig.rig.states.kitchen.pitch, -0.46),
    rig.rig.snapshot());
  const snap = rig.rig.snapshot();
  check('snapshot отдаёт позицию и взгляд', Array.isArray(snap.position) && snap.position.length === 3 &&
    Array.isArray(snap.direction) && snap.direction.length === 3, snap);
  check('clear снимает все указатели', (() => {
    env.element.fire('pointerdown', { pointerId: 1, clientX: 0, clientY: 0, button: 2, pointerType: 'mouse', preventDefault() {} });
    rig.rig.clear();
    return rig.rig.pointers.size === 0;
  })(), rig.rig.pointers.size);
}

{
  // Источник и собранная игра должны совпадать по логике.
  const runtime = extractRuntimeClass();
  check('источник: ПКМ — основной режим камеры', /button === 2/.test(SOURCE), null);
  check('источник: драг слушается на window', /(?:window|win)\.addEventListener\('pointermove'/.test(SOURCE), null);
  check('источник: захват указателя в try/catch', /try \{[^}]*setPointerCapture/.test(SOURCE), null);
  check('источник: Pointer Lock больше не используется', !/requestPointerLock/.test(SOURCE), null);
  check('источник: ограничение вертикали на месте', /minPitch: -1\.30, maxPitch: \.83/.test(SOURCE), null);
  check('рантайм: тот же класс камеры, что в источнике',
    /button === 2/.test(runtime) && /(?:window|win)\.addEventListener\('pointermove'/.test(runtime) &&
    /setPointerCapture/.test(runtime) && !/requestPointerLock/.test(runtime), null);
  check('рантайм: значение ORBIT_SPEED совпадает с источником',
    /const ORBIT_SPEED = \.005;/.test(SOURCE) && /const ORBIT_SPEED = \.005;/.test(runtime), null);
}

if (failures.length) console.log('ПРОВАЛЫ:\n  ' + failures.join('\n  '));
console.log('ИТОГО: ' + passed + '/' + (passed + failures.length) + ' проверок пройдено');
process.exit(failures.length ? 1 : 0);
