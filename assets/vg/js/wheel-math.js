/* Колесо «Рулетки Vert» — вся геометрия и отрисовка в одном файле.
 *
 * Колесо состоит из 20 **одинаковых** секторов по 18°. Множителей всего четыре,
 * и вероятность каждого задаётся количеством секторов:
 *
 *   x0 — 7 секторов (35 %), x1 — 10 (50 %), x2 — 2 (10 %), x5 — 1 (5 %).
 *
 * Поэтому геометрия простая: сектор i занимает угол [i·18°, (i+1)·18°), а
 * `layout()` считается из весов (веса равные, но функция остаётся общей).
 *
 * Сервер — единственный источник результата: он присылает `segment` (индекс
 * сектора) и `multiplier`. `target()` считает угол, при котором середина этого
 * сектора встаёт под указатель (он сверху, угол 3π/2), `segmentAt()` —
 * обратная функция: «кто сейчас под указателем». На ней работают тики звука и
 * проверки в `tools/test_wheel_math.js`.
 */
(function () {
  'use strict';

  /* Указатель сверху. В canvas угол 0 — «3 часа», положительные углы идут по
     часовой стрелке, поэтому «вверх» — это 3π/2. */
  var POINTER = Math.PI * 3 / 2;
  var TWO_PI = Math.PI * 2;

  /* Палитра по множителю: [основной, тёмный край]. Второй оттенок нужен для
     градиента сектора, поэтому колесо выглядит объёмным даже на тёмном фоне. */
  var PALETTE = {
    0: ['#7c5cff', '#4c1d95'],   // x0 — фиолетовый (проигрыш)
    1: ['#c6ff3d', '#7fae12'],   // x1 — фирменный лайм (возврат ставки)
    2: ['#2ee6c8', '#0e9488'],   // x2 — бирюза (двойная выплата)
    5: ['#ff2d95', '#b01568']    // x5 — маджента (джекпот)
  };
  /* Запасная палитра для незнакомых множителей (например, старые записи). */
  var COLORS = ['#7c5cff', '#c6ff3d', '#2ee6c8', '#ff2d95', '#e8b64c', '#3b82f6', '#5f6980'];

  function norm(angle) {
    return ((angle % TWO_PI) + TWO_PI) % TWO_PI;
  }

  /* Доли секторов: вес / сумма весов. Для 20 равных секторов — по 18°. */
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

  /* Цвет сектора по множителю. Все секторы одного множителя одного цвета;
     чётные/нечётные вхождения чуть отличаются яркостью, чтобы колесо не
     выглядело плоским, но палитра оставалась единой. */
  function colorFor(multiplier, occurrence) {
    var pair = PALETTE[Number(multiplier)];
    if (!pair) return COLORS[(occurrence || 0) % COLORS.length];
    return (occurrence || 0) % 2 === 0 ? pair[0] : shade(pair[0], 0.9);
  }

  /* Затемнить/осветлить цвет: 'factor' < 1 темнее, > 1 светлее. */
  function shade(hex, factor) {
    var value = String(hex || '').replace('#', '');
    if (value.length !== 6) return hex;
    var out = '#';
    for (var i = 0; i < 3; i += 1) {
      var part = parseInt(value.slice(i * 2, i * 2 + 2), 16);
      part = Math.max(0, Math.min(255, Math.round(part * factor)));
      out += ('0' + part.toString(16)).slice(-2);
    }
    return out;
  }

  /* Скруглённый прямоугольник под подписью: текст читается на любом цвете. */
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  /* Тёмный или светлый текст — по яркости фона сектора. */
  function inkFor(hex) {
    var value = String(hex || '').replace('#', '');
    if (value.length !== 6) return '#0a1208';
    var r = parseInt(value.slice(0, 2), 16);
    var g = parseInt(value.slice(2, 4), 16);
    var b = parseInt(value.slice(4, 6), 16);
    var luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luma > 0.62 ? '#0a1208' : '#f7ffe8';
  }

  /* Отрисовка колеса. ctx уже настроен на CSS-пиксели (dpr применяет страница). */
  function draw(ctx, options) {
    if (!ctx) return;
    var opts = options || {};
    var segments = opts.segments || [];
    var weights = opts.weights || segments.map(function () { return 1; });
    var size = opts.size || 360;
    var rotation = opts.rotation || 0;
    var label = opts.label || labelFor;
    var cx = size / 2;
    var cy = size / 2;
    /* Колесо занимает почти всё полотно — множители должны читаться. */
    var radius = size * 0.44;
    var list = layout(weights);
    var seen = {};
    var i;

    ctx.save();
    ctx.clearRect(0, 0, size, size);

    /* --- внешнее кольцо: обод с насечками --- */
    ctx.beginPath();
    ctx.arc(cx, cy, radius + size * 0.028, 0, TWO_PI);
    var rim = ctx.createLinearGradient(0, cy - radius, 0, cy + radius);
    rim.addColorStop(0, '#1b2130');
    rim.addColorStop(1, '#0a0d14');
    ctx.fillStyle = rim;
    ctx.fill();
    ctx.strokeStyle = 'rgba(198,255,61,.35)';
    ctx.lineWidth = Math.max(1.5, size * 0.004);
    ctx.stroke();

    /* насечки по 20 секторам: короткие штрихи на ободе */
    for (i = 0; i < Math.max(segments.length, 1); i += 1) {
      var tickAngle = rotation + (TWO_PI / Math.max(segments.length, 1)) * i;
      var r0 = radius + size * 0.008;
      var r1 = radius + size * 0.024;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(tickAngle) * r0, cy + Math.sin(tickAngle) * r0);
      ctx.lineTo(cx + Math.cos(tickAngle) * r1, cy + Math.sin(tickAngle) * r1);
      ctx.strokeStyle = 'rgba(198,255,61,.55)';
      ctx.lineWidth = Math.max(1, size * 0.003);
      ctx.stroke();
    }

    /* --- 20 одинаковых секторов по 18° --- */
    for (i = 0; i < segments.length && i < list.length; i += 1) {
      var item = list[i];
      var mult = segments[i];
      var start = rotation + item.start;
      var end = rotation + item.end;
      var occurrence = seen[mult] || 0;
      seen[mult] = occurrence + 1;
      var base = colorFor(mult, occurrence);

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, start, end);
      ctx.closePath();
      var gradient = ctx.createRadialGradient(cx, cy, radius * 0.15, cx, cy, radius);
      gradient.addColorStop(0, shade(base, 1.18));
      gradient.addColorStop(1, shade(base, 0.70));
      ctx.fillStyle = gradient;
      ctx.fill();
      /* Тонкая тёмная линия между секторами: границы читаются всегда. */
      ctx.strokeStyle = 'rgba(6,8,12,.95)';
      ctx.lineWidth = Math.max(1, size * 0.0032);
      ctx.stroke();

      /* --- подпись множителя ---
         Подпись всегда горизонтальная: при 20 секторах повёрнутый текст читается
         то боком, то почти вверх ногами. Горизонтальный текст на тёмной
         «пилюле» читается одинаково хорошо в любой точке колеса. */
      var mid = rotation + item.mid;
      var text = label(mult, i);
      var fontSize = Math.max(12, size * 0.030);
      ctx.font = '900 ' + fontSize + 'px Montserrat, Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      var pillW = ctx.measureText(text).width + fontSize * 0.95;
      var pillH = fontSize * 1.55;
      var px = cx + Math.cos(mid) * radius * 0.70;
      var py = cy + Math.sin(mid) * radius * 0.70;
      ctx.fillStyle = 'rgba(6,9,14,.62)';
      roundRect(ctx, px - pillW / 2, py - pillH / 2, pillW, pillH, pillH / 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(text, px, py + fontSize * 0.02);
    }

    /* --- ступица VERT --- */
    var hub = radius * 0.235;
    ctx.beginPath();
    ctx.arc(cx, cy, hub + size * 0.012, 0, TWO_PI);
    ctx.fillStyle = 'rgba(198,255,61,.10)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, hub, 0, TWO_PI);
    var hubGradient = ctx.createRadialGradient(cx, cy - hub * 0.4, hub * 0.2, cx, cy, hub);
    hubGradient.addColorStop(0, '#151a24');
    hubGradient.addColorStop(1, '#080b11');
    ctx.fillStyle = hubGradient;
    ctx.fill();
    ctx.strokeStyle = '#c6ff3d';
    ctx.lineWidth = Math.max(2, size * 0.006);
    ctx.stroke();

    ctx.fillStyle = '#c6ff3d';
    ctx.font = '900 ' + Math.max(13, size * 0.045) + 'px Montserrat, Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(opts.center || 'VERT', cx, cy);
    ctx.restore();
  }

  window.VGWheel = {
    POINTER: POINTER,
    COLORS: COLORS,
    PALETTE: PALETTE,
    arc: function (count, weights) { return weights ? layout(weights) : layout(new Array(count || 1)); },
    layout: layout,
    target: target,
    segmentAt: segmentAt,
    normalize: normalize,
    labelFor: labelFor,
    colorFor: colorFor,
    inkFor: inkFor,
    draw: draw
  };
})();
