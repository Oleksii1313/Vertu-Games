#!/usr/bin/env node
/* Тест колеса: секторы пропорциональны вероятностям и колесо встаёт на
 * оплаченный сервером сектор.
 *
 * Проверяется настоящий `assets/vg/js/wheel-math.js` (без копий формулы):
 *
 * 1. вероятности из весов совпадают с требованиями (48/27/16/6/1/1.5/0.5 %) и
 *    дают ровно 100 % и RTP 93.5 %;
 * 2. ширина сектора на колесе пропорциональна его вероятности (x0 в 96 раз
 *    шире x10);
 * 3. для каждого сектора и любого начального угла `segmentAt(target(...))`
 *    возвращает именно этот сектор — то есть колесо останавливается там, за что
 *    заплатил сервер;
 * 4. колесо всегда крутится вперёд минимум на 6 оборотов.
 *
 * Запуск: node tools/test_wheel_math.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'assets', 'vg', 'js', 'wheel-math.js'), 'utf8');

const window = {};
new Function('window', source)(window);
const W = window.VGWheel;

if (!W || typeof W.target !== 'function' || typeof W.segmentAt !== 'function') {
  console.error('wheel-math.js не выставил VGWheel.target/segmentAt');
  process.exit(1);
}

let failed = 0;
let passed = 0;

function check(name, condition, detail) {
  if (condition) { passed += 1; return; }
  failed += 1;
  console.error('FAIL: ' + name + (detail ? ' — ' + detail : ''));
}

/* Ровно те значения, что отдаёт сервер (game_catalog.WHEEL_SEGMENTS/WEIGHTS). */
const SEGMENTS = [0, 10, 1, 5, 2, 4, 3];
const WEIGHTS = [480, 5, 270, 15, 160, 10, 60];
const EXPECTED = { 0: 0.48, 1: 0.27, 2: 0.16, 3: 0.06, 4: 0.01, 5: 0.015, 10: 0.005 };
const TWO_PI = Math.PI * 2;

/* 0. Набор множителей: только целые, без старых дробных. */
const sorted = SEGMENTS.slice().sort((a, b) => a - b);
check('множители ровно x0,x1,x2,x3,x4,x5,x10', sorted.join(',') === '0,1,2,3,4,5,10', sorted.join(','));
check('нет дробных множителей', SEGMENTS.every((m) => Number.isInteger(m)), SEGMENTS.join(','));
check('нет дубликатов', new Set(SEGMENTS).size === SEGMENTS.length, SEGMENTS.join(','));

/* 1. Вероятности и RTP. */
const totalWeight = WEIGHTS.reduce((a, b) => a + b, 0);
check('сумма весов = 1000', totalWeight === 1000, String(totalWeight));

let rtp = 0;
let sumChance = 0;
const layout = W.layout(WEIGHTS);
SEGMENTS.forEach((mult, index) => {
  const share = layout[index].share;
  const chance = WEIGHTS[index] / totalWeight;
  sumChance += chance;
  rtp += chance * mult;
  check(`вероятность x${mult} = ${EXPECTED[mult] * 100}%`,
    Math.abs(share - EXPECTED[mult]) < 1e-12,
    String(share));
});
check('сумма вероятностей = 100%', Math.abs(sumChance - 1) < 1e-12, String(sumChance));
check('RTP колеса = 93.5%', Math.abs(rtp - 0.935) < 1e-12, String(rtp));

/* 2. Ширина сектора пропорциональна вероятности. */
SEGMENTS.forEach((mult, index) => {
  const sweepShare = layout[index].sweep / TWO_PI;
  check(`сектор x${mult} занимает свою долю окружности`,
    Math.abs(sweepShare - WEIGHTS[index] / totalWeight) < 1e-12,
    String(sweepShare));
});
const sweepOf = (m) => layout[SEGMENTS.indexOf(m)].sweep;
check('x0 самый широкий', sweepOf(0) > sweepOf(1) && sweepOf(1) > sweepOf(2), '');
check('x10 самый узкий', sweepOf(10) < sweepOf(4) && sweepOf(4) < sweepOf(5), '');
check('x0 ровно в 96 раз шире x10',
  Math.abs(sweepOf(0) / sweepOf(10) - 96) < 1e-9, String(sweepOf(0) / sweepOf(10)));
check('секторы не одинаковые', new Set(layout.map((s) => s.sweep.toFixed(6))).size === 7, '');

/* 3. Остановка ровно на оплаченном секторе при любом начальном угле. */
for (let start = 0; start < TWO_PI; start += 0.013) {
  for (let segment = 0; segment < SEGMENTS.length; segment += 1) {
    const landed = W.target(start, segment, WEIGHTS, 6);
    const shown = W.segmentAt(W.normalize(landed), WEIGHTS);
    check(`сектор под указателем (segment=${segment}, start=${start.toFixed(3)})`,
      shown === segment, `показан ${shown}, оплачен ${segment}`);
  }
}

/* 4. Колесо крутится вперёд и середина сектора попадает в указатель. */
for (let segment = 0; segment < SEGMENTS.length; segment += 1) {
  const landed = W.normalize(W.target(0, segment, WEIGHTS, 6));
  check(`не меньше 6 оборотов (segment=${segment})`,
    W.target(0, segment, WEIGHTS, 6) > TWO_PI * 5.5, '');
  const mid = landed + layout[segment].mid;
  const diff = Math.abs(((mid - W.POINTER) % TWO_PI + TWO_PI + Math.PI) % TWO_PI - Math.PI);
  check(`середина сектора ${segment} точно под указателем`, diff < 1e-9, String(diff));
}

/* 5. Обратная функция на произвольных углах возвращает валидный индекс. */
for (let angle = -12; angle < 12; angle += 0.071) {
  const segment = W.segmentAt(angle, WEIGHTS);
  check(`segmentAt(${angle.toFixed(2)}) в диапазоне`,
    segment >= 0 && segment < SEGMENTS.length, String(segment));
}

console.log(`${failed === 0 ? 'OK' : 'ПРОВАЛ'}: пройдено ${passed}, провалено ${failed}`);
process.exit(failed === 0 ? 0 : 1);
