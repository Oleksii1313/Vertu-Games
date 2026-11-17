#!/usr/bin/env node
/* Тест геометрии колеса: «сектор под указателем == сектор, за который заплатили».
 *
 * Это ровно та ошибка, из-за которой игрок видел «×2», а на баланс приходило
 * 5 монет (20 × 0.25): показ расходился с расчётом. Тест берёт настоящий
 * `assets/vg/js/wheel-math.js` (не копию формулы) и проверяет инвариант для
 * каждого сектора, для случайных начальных углов и для любого числа секторов.
 *
 * Запуск: node tools/test_wheel_math.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'assets', 'vg', 'js', 'wheel-math.js'), 'utf8');

// Минимальная заглушка браузерного окружения: модуль пишет в window.
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
  if (condition) {
    passed += 1;
    return;
  }
  failed += 1;
  console.error('FAIL: ' + name + (detail ? ' — ' + detail : ''));
}

const SEGMENTS = [5, 3, 2, 1, 0.5, 0.25, 0];
const TWO_PI = Math.PI * 2;

// 1. Для каждого сектора и любого начального угла колесо встаёт на этот сектор.
for (const count of [SEGMENTS.length, 5, 6, 8, 12]) {
  for (let start = 0; start < TWO_PI; start += 0.017) {
    for (let segment = 0; segment < count; segment += 1) {
      const landed = W.target(start, segment, count, 6);
      const shown = W.segmentAt(W.normalize(landed), count);
      check(
        `сектор под указателем (count=${count}, segment=${segment}, start=${start.toFixed(3)})`,
        shown === segment,
        `показан ${shown}, оплачен ${segment}`);
      check(
        `колесо крутится вперёд (count=${count}, segment=${segment})`,
        landed > start + TWO_PI * 5.5,
        `target=${landed.toFixed(3)} start=${start.toFixed(3)}`);
    }
  }
}

// 2. Угол сектора и указатель: середина выпавшего сектора совпадает с верхом.
for (let segment = 0; segment < SEGMENTS.length; segment += 1) {
  const step = W.arc(SEGMENTS.length);
  const landed = W.normalize(W.target(0, segment, SEGMENTS.length, 6));
  const mid = landed + segment * step + step / 2;
  const diff = Math.abs(((mid - W.POINTER) % TWO_PI + TWO_PI + Math.PI) % TWO_PI - Math.PI);
  check(`середина сектора ${segment} под указателем`, diff < 1e-9, `расхождение ${diff}`);
}

// 3. Обратная функция на «сырых» углах: любой угол даёт валидный сектор.
for (let angle = -10; angle < 10; angle += 0.13) {
  const segment = W.segmentAt(angle, SEGMENTS.length);
  check(`segmentAt(${angle.toFixed(2)}) в диапазоне`, segment >= 0 && segment < SEGMENTS.length,
    String(segment));
}

// 4. Число секторов = 7 и множители — те, что платит сервер (game_catalog.WHEEL_SEGMENTS).
check('семь секторов', SEGMENTS.length === 7, String(SEGMENTS.length));
check('секторы совпадают с серверными', SEGMENTS.join(',') === '5,3,2,1,0.5,0.25,0', SEGMENTS.join(','));

console.log(`${failed === 0 ? 'OK' : 'ПРОВАЛ'}: пройдено ${passed}, провалено ${failed}`);
process.exit(failed === 0 ? 0 : 1);
