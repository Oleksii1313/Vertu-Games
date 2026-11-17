#!/usr/bin/env node
/* Тест колеса: 20 равных секторов по 18° и остановка на оплаченном секторе.
 *
 * Конфигурация берётся не из копии, а из сгенерированного
 * `assets/vg/js/catalog-data.js` (VG_DATA.casino.wheel), то есть из того же
 * `game_catalog.py`, что отдаёт сервер:
 *
 * 1. множители только x0/x1/x2/x5, вероятности 35/50/10/5 %, RTP 95 %;
 * 2. все секторы одинаковой ширины — 18°;
 * 3. для каждого сектора и любого начального угла `segmentAt(target(...))`
 *    возвращает именно этот сектор — колесо встаёт там, за что заплатил сервер;
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

/* Конфигурация сервера: тот же файл, что читает браузер на страницах. */
const dataSource = fs.readFileSync(
  path.join(__dirname, '..', 'assets', 'vg', 'js', 'catalog-data.js'), 'utf8');
const dataWindow = {};
new Function('window', dataSource)(dataWindow);
const WHEEL = (dataWindow.VG_DATA && dataWindow.VG_DATA.casino
  && dataWindow.VG_DATA.casino.wheel) || null;
if (!WHEEL || !Array.isArray(WHEEL.segments) || !Array.isArray(WHEEL.weights)) {
  console.error('catalog-data.js не содержит wheel.segments/weights');
  process.exit(1);
}

const SEGMENTS = WHEEL.segments;
const WEIGHTS = WHEEL.weights;
const TWO_PI = Math.PI * 2;
const EXPECTED = { 0: 0.35, 1: 0.5, 2: 0.1, 5: 0.05 };
const SECTOR_COUNT = { 0: 7, 1: 10, 2: 2, 5: 1 };

/* 0. Набор множителей: только x0/x1/x2/x5, 20 секторов. */
const sorted = Array.from(new Set(SEGMENTS)).sort((a, b) => a - b);
check('множители ровно x0,x1,x2,x5', sorted.join(',') === '0,1,2,5', sorted.join(','));
check('все множители целые', SEGMENTS.every(Number.isInteger), SEGMENTS.join(','));
check('20 секторов', SEGMENTS.length === 20, String(SEGMENTS.length));
check('20 весов', WEIGHTS.length === 20, String(WEIGHTS.length));
Object.keys(SECTOR_COUNT).forEach((mult) => {
  const count = SEGMENTS.filter((value) => value === Number(mult)).length;
  check(`секторов x${mult} = ${SECTOR_COUNT[mult]}`,
    count === SECTOR_COUNT[mult], String(count));
});
check('соседние секторы разные',
  SEGMENTS.every((value, index) => value !== SEGMENTS[(index + 1) % SEGMENTS.length]), '');

/* 1. Вероятности и RTP. */
const totalWeight = WEIGHTS.reduce((a, b) => a + b, 0);
check('веса равные', new Set(WEIGHTS).size === 1, WEIGHTS.join(','));
check('сумма весов = 20', totalWeight === 20, String(totalWeight));

let rtp = 0;
let sumChance = 0;
const layout = W.layout(WEIGHTS);
sorted.forEach((mult) => {
  const sectors = SEGMENTS.filter((value) => value === mult).length;
  const chance = sectors / SEGMENTS.length;
  sumChance += chance;
  rtp += chance * mult;
  check(`вероятность x${mult} = ${EXPECTED[mult] * 100}%`,
    Math.abs(chance - EXPECTED[mult]) < 1e-12,
    String(chance));
});
check('сумма вероятностей = 100%', Math.abs(sumChance - 1) < 1e-12, String(sumChance));
check('RTP колеса = 95%', Math.abs(rtp - 0.95) < 1e-12, String(rtp));

/* 2. Ширина сектора пропорциональна вероятности. */
SEGMENTS.forEach((mult, index) => {
  const sweepShare = layout[index].sweep / TWO_PI;
  check(`сектор x${mult} занимает свою долю окружности`,
    Math.abs(sweepShare - WEIGHTS[index] / totalWeight) < 1e-12,
    String(sweepShare));
});
check('все секторы по 18°', layout.every((item) => {
  const degrees = item.sweep * 360 / TWO_PI;
  return Math.abs(degrees - 18) < 1e-9;
}), layout.map((item) => (item.sweep * 360 / TWO_PI).toFixed(3)).join(','));
check('все секторы одинаковой ширины',
  new Set(layout.map((item) => item.sweep.toFixed(9))).size === 1, '');

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
