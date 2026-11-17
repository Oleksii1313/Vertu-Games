/* Колесо «Рулетки Vert» — вся геометрия и отрисовка в одном файле.
 *
 * Секторы **пропорциональны вероятностям**: x0 занимает 48 % окружности,
 * x1 — 27 %, x2 — 16 %, x3 — 6 %, x4 — 1 %, x5 — 1.5 %, x10 — 0.5 %.
 * Никаких равных секторов: узкая полоска x10 — это честные 0.5 %.
 *
 * Страницы (`roulette.js`, `casino.js`) только крутят анимацию: сервер присылает
 * `segment` и `multiplier`, а `target()` считает угол так, чтобы под указателем
 * (он висит сверху, угол 3π/2) остановился именно этот сектор. Обратная функция
 * `segmentAt()` восстанавливает «кто сейчас под указателем» — на ней
 * `tools/test_wheel_math.js` проверяет инвариант для всех секторов, любых весов
 * и любого начального поворота.
 */
(function () {
  'use strict';

  /* Указатель сверху. В canvas угол 0 — «3 часа», положительные углы идут по
     часовой стрелке, поэтому «вверх» — это 3π/2. */
  var POINTER = Math.PI * 3 / 2;
  var TWO_PI = Math.PI * 2;
  var COLORS = ['#ff2d95', '#c6ff3d', '#8b5cf6', '#2ee6c8', '#3b82f6', '#e8b64c', '#5f6980'];

  function norm(angle) {
    return ((angle % TWO_PI) + TWO_PI) % TWO_PI;
  }

  /* Доли секторов: вес / сумма весов. Вход — веса с сервера (например
     [480, 5, 270, 15, 160, 10, 60] для 48/0.5/27/1.5/16/1/6 процентов). */
  function layout(weights) {
    var list = weights || [];
    var total = 0;
    var i;
    for (i = 0; i < list.length; i += 1) total += Math.max(0, Number(list[i]) || 0);
    if (!(total > 0)) total = 1;
    var out = [];
    var cursor = 0;
    for (i = 0; i < list.length; i += 1) {
      var share = (Math.max(0, Number(list[i]) || 0)) / total;
      var sweep = share * TWO_PI;
      out.push({ index: i, start: cursor, end: cursor + sweep, mid: cursor + sweep / 2,
                 sweep: sweep, share: share });
      cursor += sweep;
    }
    return out;
  }

  /* Итоговый угол поворота, при котором сектор `segment` окажется под указателем.
     Середина сектора (rotation + mid) должна совпасть с POINTER, поэтому
     delta = POINTER - mid - rotation (по модулю 2π), плюс полные обороты. */
  function target(rotation, segment, weights, turns) {
    var list = layout(weights);
    var item = list[segment];
    var extra = (turns == null ? 6 : turns) * TWO_PI;
    if (!item) return rotation + extra;
    return rotation + extra + norm(POINTER - item.mid - rotation);
  }

  /* Обратная операция: какой сектор сейчас под указателем. */
  function segmentAt(rotation, weights) {
    var list = layout(weights);
    if (!list.length) return -1;
    var inside = norm(POINTER - rotation);
    for (var i = 0; i < list.length; i += 1) {
      if (inside >= list[i].start && inside < list[i].end) return i;
    }
    return list.length - 1;
  }

  /* Канонический угол после остановки (уходит в следующий draw). */
  function normalize(rotation) {
    return norm(rotation);
  }

  /* Подпись сектора: целые множители печатаем без дробной части. */
  function labelFor(multiplier) {
    var value = Number(multiplier) || 0;
    return 'x' + (value % 1 === 0 ? value : value.toFixed(2).replace(/0$/, ''));
  }

  function collides(pos, placed) {
    for (var i = 0; i < placed.length; i += 1) {
      var dx = placed[i].x - pos.x;
      var dy = placed[i].y - pos.y;
      if (Math.sqrt(dx * dx + dy * dy) < 22) return true;
    }
    return false;
  }

  /* Отрисовка колеса. ctx уже настроен на CSS-пиксели (dpr применяет страница). */
  function draw(ctx, options) {
    if (!ctx) return;
    var opts = options || {};
    var segments = opts.segments || [];
    var weights = opts.weights || segments.map(function () { return 1; });
    var colors = opts.colors || COLORS;
    var size = opts.size || 360;
    var rotation = opts.rotation || 0;
    var label = opts.label || labelFor;
    var cx = size / 2;
    var cy = size / 2;
    /* 0.36 — под колесо, остальное поле уходит на выноски узких секторов. */
    var radius = size * 0.36;
    var list = layout(weights);
    var callouts = [];
    var i;

    ctx.save();
    ctx.clearRect(0, 0, size, size);

    /* --- секторы: угол каждого = его вероятность --- */
    for (i = 0; i < segments.length && i < list.length; i += 1) {
      var item = list[i];
      var start = rotation + item.start;
      var end = rotation + item.end;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, start, end);
      ctx.closePath();
      var color = colors[i % colors.length];
      var gradient = ctx.createRadialGradient(cx, cy, radius * 0.25, cx, cy, radius);
      gradient.addColorStop(0, color + 'cc');
      gradient.addColorStop(1, color);
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.strokeStyle = 'rgba(7,8,12,.9)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      var mid = rotation + item.mid;
      if (item.sweep >= 0.30) {
        /* Широкий сектор: подпись внутри, поперёк радиуса. */
        ctx.save();
        ctx.translate(cx + Math.cos(mid) * radius * 0.64, cy + Math.sin(mid) * radius * 0.64);
        /* Подпись идёт поперёк радиуса; на левой половине колеса доворачиваем её
           на 180°, чтобы она не читалась «вверх ногами». */
        var textAngle = mid + Math.PI / 2;
        textAngle = ((textAngle + Math.PI / 2) % Math.PI + Math.PI) % Math.PI - Math.PI / 2;
        ctx.rotate(textAngle);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '800 ' + Math.max(12, size * 0.045) + 'px Montserrat, Inter, sans-serif';
        ctx.fillStyle = 'rgba(8,17,10,.92)';
        ctx.fillText(label(segments[i], i), 0, 0);
        ctx.restore();
      } else {
        /* Узкая полоска (x10 = 1.8°, x5 = 5.4°, x4 = 3.6°): подпись снаружи,
           с выноской — иначе текст не помещается в сектор. */
        callouts.push({ text: label(segments[i], i), angle: mid });
      }
    }

    /* --- выноски узких секторов, без наложения подписей --- */
    callouts.sort(function (a, b) { return norm(a.angle) - norm(b.angle); });
    var placed = [];
    callouts.forEach(function (entry) {
      var pos = null;
      for (var level = 0; level < 4; level += 1) {
        var r = radius + 13 + level * 15;
        pos = { x: cx + Math.cos(entry.angle) * r, y: cy + Math.sin(entry.angle) * r, r: r };
        if (!collides(pos, placed)) break;
      }
      placed.push(pos);
      var fromR = radius + 3;
      var toR = Math.max(fromR, pos.r - 10);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(entry.angle) * fromR, cy + Math.sin(entry.angle) * fromR);
      ctx.lineTo(cx + Math.cos(entry.angle) * toR, cy + Math.sin(entry.angle) * toR);
      ctx.strokeStyle = 'rgba(210,226,255,.45)';
      ctx.lineWidth = 1;
      ctx.stroke();

      var cos = Math.cos(entry.angle);
      ctx.font = '800 ' + Math.max(10, size * 0.032) + 'px Montserrat, Inter, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = cos > 0.15 ? 'left' : (cos < -0.15 ? 'right' : 'center');
      var tx = pos.x + (ctx.textAlign === 'left' ? 3 : (ctx.textAlign === 'right' ? -3 : 0));
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(7,8,12,.92)';
      ctx.strokeText(entry.text, tx, pos.y);
      ctx.fillStyle = '#eaffb0';
      ctx.fillText(entry.text, tx, pos.y);
    });

    /* --- ступица --- */
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.22, 0, TWO_PI);
    ctx.fillStyle = '#0b0e15';
    ctx.fill();
    ctx.strokeStyle = 'rgba(198,255,61,.55)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = '#c6ff3d';
    ctx.font = '900 ' + Math.max(11, size * 0.036) + 'px Montserrat, Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(opts.center || 'VERTU', cx, cy);
    ctx.restore();
  }

  window.VGWheel = {
    POINTER: POINTER,
    COLORS: COLORS,
    arc: function (count, weights) { return weights ? layout(weights) : layout(new Array(count || 1)); },
    layout: layout,
    target: target,
    segmentAt: segmentAt,
    normalize: normalize,
    labelFor: labelFor,
    draw: draw
  };
})();
