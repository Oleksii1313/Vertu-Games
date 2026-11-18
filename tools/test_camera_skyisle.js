#!/usr/bin/env node
/*
 * Проверка мышиной камеры Sky-Isle: обзор только по удержанию ПКМ, ЛКМ не
 * вращает камеру, отпускание останавливает вращение, тач-свайп работает,
 * а горизонталь не инвертирована (мышь вправо — камера вправо).
 *
 * Обработчики берутся из games/sky-isle.html как есть и запускаются в
 * песочнице с заглушками (Babylon-сцена для этого не нужна).
 *
 *     NODE_PATH=/tmp/dom/node_modules node tools/test_camera_skyisle.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'games', 'sky-isle.html'), 'utf8');
const line = html.split('\n').find((l) => l.startsWith("canvas.addEventListener('pointerdown'"));
if (!line) { console.log('FAIL · не найдены обработчики камеры Sky-Isle'); process.exit(1); }
const code = line.slice(0, line.indexOf("canvas.addEventListener('wheel'"));

/* Песочница: только те переменные, которые реально нужны обработчикам. */
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
const w = dom.window;
const canvas = w.document.createElement('canvas');
w.document.body.appendChild(canvas);
canvas.setPointerCapture = function () {};
const element = () => ({ addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }), style: {}, classList: { add() {}, remove() {} }, setPointerCapture() {} });

const run = new w.Function(
  'mode', 'cam', 'canvas', '$', 'stick', 'altOwners',
  'let lookPointer = null;\n' + code + '\n' +
  'return { get look() { return lookPointer; }, set look(v) { lookPointer = v; } };'
);
const cam = { yaw: Math.PI, pitch: 0.38, distance: 16 };
const api = run('playing', cam, canvas, element, { id: null, x: 0, y: 0 }, new Map());

function ev(type, opts) {
  const e = new w.Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, opts);
  return e;
}
function down(button, x, y, id, type) {
  canvas.dispatchEvent(ev('pointerdown', { button, clientX: x, clientY: y, pointerId: id || 1, pointerType: type || 'mouse' }));
}
function move(x, y, id, type) {
  canvas.dispatchEvent(ev('pointermove', { clientX: x, clientY: y, pointerId: id || 1, pointerType: type || 'mouse' }));
}
function up(x, y, id, type) {
  canvas.dispatchEvent(ev('pointerup', { clientX: x, clientY: y, pointerId: id || 1, pointerType: type || 'mouse' }));
}

const results = [];
function check(name, ok, extra) {
  results.push((ok ? 'PASS' : 'FAIL') + ' · ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : ''));
}

/* ------------------------------------------------ ЛКМ */
let yaw = cam.yaw;
down(0, 200, 200);
check('ЛКМ не начинает обзор', api.look === null);
move(300, 200);
check('ЛКМ + движение не вращает камеру', cam.yaw === yaw, cam.yaw - yaw);
up(300, 200);
check('после ЛКМ обзор так и не начался', api.look === null);

/* ------------------------------------------------ ПКМ */
down(2, 200, 200);
check('ПКМ начинает обзор', !!api.look);
const yawStart = cam.yaw;
move(260, 200);
check('ПКМ + мышь вправо вращает камеру', cam.yaw !== yawStart, cam.yaw - yawStart);
/* Камера смотрит на цель из точки (-sin(yaw), -cos(yaw)) — уменьшение yaw
   поворачивает взгляд вправо (к +X), как и ожидает игрок. */
const dir = (y) => [Math.sin(y), Math.cos(y)];
const before = dir(yawStart), after = dir(cam.yaw);
check('горизонталь не инвертирована: взгляд уходит вправо (+X)',
  after[0] > before[0], [Number(before[0].toFixed(3)), Number(after[0].toFixed(3))]);
const pitchBefore = cam.pitch;
move(260, 260);
check('мышь вниз увеличивает наклон (взгляд ниже)', cam.pitch > pitchBefore, [pitchBefore, cam.pitch]);
up(260, 260);
const yawAfterUp = cam.yaw;
move(400, 400);
check('после отпускания ПКМ камера стоит', cam.yaw === yawAfterUp && api.look === null, cam.yaw - yawAfterUp);

/* ------------------------------------------------ тач-свайп */
down(0, 100, 100, 9, 'touch');
check('тач-свайп начинает обзор даже без ПКМ', !!api.look);
const yawTouch = cam.yaw;
move(160, 100, 9, 'touch');
check('тач-свайп вращает камеру', cam.yaw !== yawTouch, cam.yaw - yawTouch);
up(160, 100, 9, 'touch');
check('после тач-свайпа обзор закрыт', api.look === null);

/* ------------------------------------------------ пауза */
const api2 = run('paused', { yaw: 1, pitch: 0.3, distance: 16 }, canvas, element, { id: null, x: 0, y: 0 }, new Map());
down(2, 10, 10, 3);
check('в паузе ПКМ не вращает камеру', api2.look === null);

console.log(results.filter((r) => r.startsWith('FAIL')).join('\n'));
console.log('ИТОГО: ' + results.filter((r) => r.startsWith('PASS')).length + '/' + results.length + ' проверок пройдено');
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
