/* Геометрия колеса «Рулетки Vert» — единственная реализация на клиенте.
 *
 * Зачем отдельный файл. Раньше формула остановки была скопирована в
 * `roulette.js` и `casino.js`, и если копии расходились (или из формулы
 * пропадало слагаемое указателя), колесо останавливалось на соседнем секторе:
 * игрок видел «×2», а выплата считалась за «×0.25» — 20 × 0.25 = 5 монет
 * вместо 40. Выплата при этом всегда считается на сервере строго как
 * `bet × multiplier`, поэтому расходиться может только показ.
 *
 * Здесь же — обратная функция `segmentAt`, и `tools/test_wheel_math.js`
 * проверяет на ней инвариант: «сектор под указателем после остановки равен
 * сектору, который оплатил сервер», для всех секторов и любого начального угла.
 */
(function () {
  'use strict';

  /* Указатель висит сверху. В canvas угол 0 — это «3 часа», положительные углы
     идут по часовой стрелке, поэтому «вверх» — это 3π/2. */
  var POINTER = Math.PI * 3 / 2;
  var TWO_PI = Math.PI * 2;

  /* Угол одного сектора: колесо делится на `count` равных частей. */
  function arc(count) {
    return TWO_PI / (count || 1);
  }

  /* Итоговый угол поворота, при котором сектор `segment` окажется под указателем.
     Сектор i занимает [rotation + i*arc; rotation + (i+1)*arc), его середина —
     rotation + i*arc + arc/2, и она должна совпасть с указателем. */
  function target(rotation, segment, count, turns) {
    var step = arc(count);
    var desired = POINTER - (segment * step + step / 2);
    var delta = desired - rotation;
    delta = ((delta % TWO_PI) + TWO_PI) % TWO_PI;
    var extra = (turns == null ? 6 : turns) * TWO_PI;
    return rotation + extra + delta;
  }

  /* Канонический угол после остановки (то, что уходит в следующий `draw`). */
  function normalize(rotation) {
    return rotation % TWO_PI;
  }

  /* Обратная операция: какой сектор сейчас под указателем при данном повороте.
     Нужна тестам и отладке — в интерфейсе не используется. */
  function segmentAt(rotation, count) {
    var step = arc(count);
    var norm = ((rotation % TWO_PI) + TWO_PI) % TWO_PI;
    /* Середина сектора k: norm + k*step + step/2 ≡ POINTER  (mod 2π). */
    var offset = ((POINTER - norm - step / 2) % TWO_PI + TWO_PI) % TWO_PI;
    return Math.round(offset / step) % count;
  }

  window.VGWheel = { POINTER: POINTER, arc: arc, target: target,
                     normalize: normalize, segmentAt: segmentAt };
})();
