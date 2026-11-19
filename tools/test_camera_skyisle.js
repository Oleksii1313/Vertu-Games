#!/usr/bin/env node
/*
 * Проверка мышиной камеры Sky-Isle (SCA Logistic).
 *
 * Сцена Babylon по умолчанию левосторонняя, поэтому «обзор вправо» — это не
 * «sin(yaw) растёт», а «взгляд уходит вдоль правого вектора камеры»
 * r = (cos yaw, 0, -sin yaw) — ровно того, вдоль которого летит дрон по D.
 * Именно тут раньше стоял перевёрнутый знак: мышь вправо поворачивала вид влево.
 *
 * Проверяем: направление обзора по горизонтали, наклон по вертикали и его
 * ограничения, ЛКМ/ПКМ/тач, Pointer Lock (обзор за пределами канваса),
 * отпускание и паузу.
 *
 * Обработчики берутся из games/sky-isle.html как есть и запускаются в
 * песочнице с заглушками (сама Babylon-сцена не нужна).
 *
 *     NODE_PATH=/tmp/dom/node_modules node tools/test_camera_skyisle.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'games', 'sky-isle.html'), 'utf8');
const from = html.lastIndexOf('/* Обзор.');
const to = from === -1 ? -1 : html.indexOf("canvas.addEventListener('wheel'", from);
if (from === -1 || to === -1) { console.log('FAIL · не найдены обработчики камеры Sky-Isle'); process.exit(1); }
const code = html.slice(from, to);

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
const w = dom.window;
const canvas = w.document.createElement('canvas');
w.document.body.appendChild(canvas);
canvas.setPointerCapture = function () {};
canvas.hasPointerCapture = function () { return true; };
canvas.releasePointerCapture = function () {};
canvas.lockRequests = 0;
canvas.requestPointerLock = function () { canvas.lockRequests++; return Promise.resolve(); };
let pointerLockElement = null;
Object.defineProperty(w.document, 'pointerLockElement', {get: () => pointerLockElement, configurable: true});
w.document.exitPointerLock = function () { pointerLockElement = null; w.document.dispatchEvent(new w.Event('pointerlockchange')); };
const element = () => ({ addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }), style: {}, classList: { add() {}, remove() {} }, setPointerCapture() {} });

const run = new w.Function(
  'mode', 'cam', 'canvas', '$', 'stick', 'altOwners', 'document',
  'let lookPointer = null;\n' + code + '\n' +
  'return { get look() { return lookPointer; }, set look(v) { lookPointer = v; } };'
);
const cam = { yaw: Math.PI, pitch: 0.38, distance: 16 };
const api = run('playing', cam, canvas, element, { id: null, x: 0, y: 0 }, new Map(), w.document);

function ev(type, opts) {
  const e = new w.Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, opts);
  return e;
}
function down(button, x, y, id, type) { canvas.dispatchEvent(ev('pointerdown', { button, clientX: x, clientY: y, pointerId: id || 1, pointerType: type || 'mouse' })); }
function move(x, y, id, type, extra) { canvas.dispatchEvent(ev('pointermove', Object.assign({ clientX: x, clientY: y, pointerId: id || 1, pointerType: type || 'mouse' }, extra || {}))); }
function up(x, y, id, type) { canvas.dispatchEvent(ev('pointerup', { clientX: x, clientY: y, pointerId: id || 1, pointerType: type || 'mouse' })); }

const results = [];
function check(name, ok, extra) {
  results.push((ok ? 'PASS' : 'FAIL') + ' · ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : ''));
}
/* Взгляд камеры и её «право» в терминах самой игры (левосторонняя Babylon). */
const view = (y) => ({ x: Math.sin(y), z: Math.cos(y) });
const rightOf = (y) => ({ x: Math.cos(y), z: -Math.sin(y) });
const along = (yaw, base) => view(yaw).x * rightOf(base).x + view(yaw).z * rightOf(base).z;
const tidy = (v) => Number(v.toFixed(4));

/* --------------------------------------------------------------- горизонт */
let yawStart = cam.yaw;
down(0, 200, 200);
check('ЛКМ начинает обзор', !!api.look);
move(260, 200);
check('ЛКМ + мышь вправо вращает камеру', cam.yaw !== yawStart, cam.yaw - yawStart);
check('горизонталь не инвертирована: взгляд уходит вправо', along(cam.yaw, yawStart) > 0,
  [tidy(along(cam.yaw, yawStart)), tidy(cam.yaw - yawStart)]);
up(260, 200);
check('после отпускания ЛКМ обзор закрыт', api.look === null);

yawStart = cam.yaw;
down(2, 200, 200);
check('ПКМ тоже начинает обзор', !!api.look);
move(140, 200);
check('ПКМ + мышь влево вращает камеру', cam.yaw !== yawStart, cam.yaw - yawStart);
check('мышь влево уводит взгляд влево', along(cam.yaw, yawStart) < 0, tidy(along(cam.yaw, yawStart)));
up(140, 200);

yawStart = cam.yaw;
down(1, 200, 200);
check('средняя кнопка обзор не начинает', api.look === null);
move(260, 200);
check('средняя кнопка камеру не вращает', cam.yaw === yawStart, cam.yaw - yawStart);
up(260, 200);

/* --------------------------------------------------------------- вертикаль */
const pitchBefore = cam.pitch;
down(0, 200, 200);
move(200, 260);
check('мышь вниз опускает взгляд (наклон растёт)', cam.pitch > pitchBefore, [pitchBefore, cam.pitch]);
move(200, 60);
check('мышь вверх поднимает взгляд (наклон падает)', cam.pitch < 1.25, cam.pitch);
for (let i = 0; i < 6; i++) move(200, 0);
check('верхний предел наклона не даёт перевернуть камеру', cam.pitch >= 0.08 - 1e-9, cam.pitch);
for (let i = 0; i < 12; i++) move(200, 400);
check('нижний предел наклона ограничен', cam.pitch <= 1.25 + 1e-9, cam.pitch);
up(200, 400);

/* ------------------------------------------------------------ Pointer Lock */
canvas.lockRequests = 0;
cam.pitch = 0.38;
down(0, 100, 100);
move(103, 100);
check('мелкое движение не захватывает указатель', canvas.lockRequests === 0, canvas.lockRequests);
move(160, 100);
check('после порога запрошен Pointer Lock', canvas.lockRequests === 1, canvas.lockRequests);
pointerLockElement = canvas;
w.document.dispatchEvent(new w.Event('pointerlockchange'));
yawStart = cam.yaw;
w.document.dispatchEvent(ev('mousemove', { movementX: 100, movementY: 0 }));
check('при захвате обзор продолжается за канвасом', cam.yaw !== yawStart && along(cam.yaw, yawStart) > 0,
  [tidy(cam.yaw - yawStart), tidy(along(cam.yaw, yawStart))]);
const pitchLock = cam.pitch;
w.document.dispatchEvent(ev('mousemove', { movementX: 0, movementY: 60 }));
check('при захвате работает вертикаль', cam.pitch > pitchLock, [pitchLock, cam.pitch]);
up(160, 100);
check('отпускание снимает захват', pointerLockElement === null, pointerLockElement);
check('после отпускания обзор закрыт', api.look === null);
yawStart = cam.yaw;
w.document.dispatchEvent(ev('mousemove', { movementX: 200, movementY: 0 }));
check('после отпускания камера стоит', cam.yaw === yawStart, cam.yaw - yawStart);

/* --------------------------------------------------------------- тач-свайп */
down(0, 100, 100, 9, 'touch');
check('тач-свайп начинает обзор', !!api.look);
yawStart = cam.yaw;
move(160, 100, 9, 'touch');
check('тач-свайп вправо вращает вид вправо', along(cam.yaw, yawStart) > 0, tidy(along(cam.yaw, yawStart)));
check('тач не запрашивает Pointer Lock', canvas.lockRequests === 1, canvas.lockRequests);
up(160, 100, 9, 'touch');
check('после тач-свайпа обзор закрыт', api.look === null);

/* --------------------------------- реальный порядок событий в браузере --- */
/* Жалоба с живого сайта: «камера не поворачивается ни правой кнопкой мыши,
   ни пальцем на телефоне, а движение работает». Причина — Pointer Lock:
   по стандарту (Pointer Events §9.5) при включении захвата браузер САМ снимает
   pointer capture и присылает lostpointercapture. Старый обработчик считал это
   отпусканием кнопки, гасил обзор и тут же выходил из только что полученного
   захвата — камера замирала после первого пикселя. Ниже — точная
   последовательность Chrome, чтобы такое не вернулось. */
pointerLockElement = null;
api.look = null;
canvas.lockRequests = 0;
down(0, 300, 300);
let yawBefore = cam.yaw;
move(320, 300);
check('до захвата обзор идёт', cam.yaw !== yawBefore, tidy(cam.yaw - yawBefore));
check('захват запрошен', canvas.lockRequests === 1, canvas.lockRequests);
for (let i = 0; i < 6; i++) move(340 + i * 10, 300);
check('пока захват не включился, запрос не дублируется', canvas.lockRequests === 1, canvas.lockRequests);

pointerLockElement = canvas;                                 /* захват включился */
w.document.dispatchEvent(new w.Event('pointerlockchange'));
canvas.dispatchEvent(ev('lostpointercapture', { pointerId: 1, pointerType: 'mouse' }));
check('снятие capture при захвате НЕ обрывает обзор', api.look !== null, api.look);
yawStart = cam.yaw;
w.document.dispatchEvent(ev('mousemove', { movementX: 120, movementY: 0 }));
check('после захвата камера продолжает вращаться', along(cam.yaw, yawStart) > 0,
  tidy(along(cam.yaw, yawStart)));
up(400, 300);
check('отпускание кнопки под захватом завершает обзор и снимает захват',
  api.look === null && pointerLockElement === null, [api.look, pointerLockElement]);

/* Отказ браузера (например, политика iframe) не должен ломать обзор. */
canvas.lockRequests = 0;
yawStart = cam.yaw;
down(2, 100, 100);
move(160, 100);
check('отказ не мешает: камера поворачивается правой кнопкой', along(cam.yaw, yawStart) > 0,
  tidy(along(cam.yaw, yawStart)));
w.document.dispatchEvent(new w.Event('pointerlockerror'));
yawStart = cam.yaw;
move(260, 100);
check('после отказа браузера обзор продолжается', along(cam.yaw, yawStart) > 0,
  tidy(along(cam.yaw, yawStart)));
check('после отказа запросы не спамятся', canvas.lockRequests === 1, canvas.lockRequests);
up(260, 100);
check('после отказа отпускание закрывает обзор', api.look === null);

/* Жест по панели HUD (она может оказаться над сценой) тоже вращает камеру. */
const panel = w.document.createElement('div');
w.document.body.appendChild(panel);
panel.dispatchEvent(ev('pointerdown', { button: 0, clientX: 10, clientY: 10, pointerId: 7, pointerType: 'mouse' }));
check('жест по панели над сценой вращает камеру', api.look !== null && api.look.id === 7, api.look);
yawStart = cam.yaw;
w.document.dispatchEvent(ev('pointermove', { clientX: 90, clientY: 10, pointerId: 7, pointerType: 'mouse' }));
check('движение по документу продолжает обзор', along(cam.yaw, yawStart) > 0, tidy(along(cam.yaw, yawStart)));
w.document.dispatchEvent(ev('pointerup', { clientX: 90, clientY: 10, pointerId: 7, pointerType: 'mouse' }));
check('отпускание по документу закрывает обзор', api.look === null);

/* А вот кнопки и джойстик обзор не перехватывают. */
const hudBtn = w.document.createElement('button');
w.document.body.appendChild(hudBtn);
const stickBox = w.document.createElement('div');
stickBox.className = 'stick';
w.document.body.appendChild(stickBox);
hudBtn.dispatchEvent(ev('pointerdown', { button: 0, clientX: 5, clientY: 5, pointerId: 11, pointerType: 'mouse' }));
check('кнопка HUD обзор не начинает', api.look === null);
stickBox.dispatchEvent(ev('pointerdown', { button: 0, clientX: 5, clientY: 5, pointerId: 12, pointerType: 'touch' }));
check('джойстик обзор не начинает', api.look === null);

/* На тач-экране Pointer Lock не запрашивается вообще. */
canvas.lockRequests = 0;
down(0, 100, 100, 21, 'touch');
move(200, 100, 21, 'touch');
up(200, 100, 21, 'touch');
check('тач не просит Pointer Lock и после правок', canvas.lockRequests === 0, canvas.lockRequests);

/* ------------------------------------------------------------------- пауза */
const api2 = run('paused', { yaw: 1, pitch: 0.3, distance: 16 }, canvas, element, { id: null, x: 0, y: 0 }, new Map(), w.document);
down(2, 10, 10, 3);
check('в паузе обзор не начинается', api2.look === null);
down(0, 10, 10, 4, 'touch');
check('в паузе тач не начинает обзор', api2.look === null);

/* ------------------------------------------ сборка и защита от «прокрутки» */
const source = fs.readFileSync(path.join(__dirname, '..', 'games', 'sky-isle.js'), 'utf8');
check('во время полёта протягивание не превращается в прокрутку/жест браузера',
  /body\[data-mode=playing\]\{touch-action:none;overscroll-behavior:none\}/.test(html), null);
check('в сборке есть защита обзора от lostpointercapture при Pointer Lock',
  html.includes("lostpointercapture") && /if\(document\.pointerLockElement===canvas\)return/.test(html), null);
check('исходник и сборка совпадают по обработчикам обзора',
  source.includes("document.addEventListener('lostpointercapture'") ===
  html.includes("document.addEventListener('lostpointercapture'"), null);

/* --------------------------------------------------- движение не сломано */
check('движение дрона по-прежнему считается от cam.cyaw',
  /forward=new B\.Vector3\(Math\.sin\(cam\.cyaw\),0,Math\.cos\(cam\.cyaw\)\)/.test(html));
check('правый вектор камеры согласован с обзором',
  /right=new B\.Vector3\(Math\.cos\(cam\.cyaw\),0,-Math\.sin\(cam\.cyaw\)\)/.test(html));
check('камера обновляется вокруг позиции дрона',
  /wanted=S\.position\.add\(new B\.Vector3\(-Math\.sin\(cam\.cyaw\)\*horizontal,/.test(html));

console.log(results.filter((r) => r.startsWith('FAIL')).join('\n'));
console.log('ИТОГО: ' + results.filter((r) => r.startsWith('PASS')).length + '/' + results.length + ' проверок пройдено');
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
