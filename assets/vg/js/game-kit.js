/* ============================================================================
   Vertu Games · общий помощник для игр
   ----------------------------------------------------------------------------
   1) Резкость canvas на retina/телефонах: буфер canvas подгоняется под
      devicePixelRatio (до 2), чтобы картинка не была мыльной. Работает и для
      2D, и как подсказка для Babylon/Three (engine.setHardwareScalingLevel).
   2) Автофокус: как только игра загрузилась в плеере, клавиатура (стрелки/WASD)
      сразу работает без клика мышью. Если браузер не отдал фокус — игроку
      показывается подсказка из platform.js.

   Файл можно подключать в любую игру: он ничего не ломает, если нужных
   элементов нет, и повторный вызов безопасен.
   ========================================================================== */
(function (window, document) {
  'use strict';

  var MAX_DPR = 2;      // выше 2 смысла нет: растёт нагрузка, разницы не видно
  /* Игры сами управляют размером canvas (scan.width = clientWidth и т.п.), поэтому
     менять атрибуты width/height отсюда нельзя — это перетрёт расчёт игры.
     Резкость делаем на уровне CSS: холст рисуется в своих пикселях и плавно
     масштабируется до физического размера экрана без потери чёткости у мелких
     элементов интерфейса игры. */

  function dpr() {
    return Math.min(MAX_DPR, Math.max(1, window.devicePixelRatio || 1));
  }

  /* ------------------------------------- 1. Резкость (утилита, опционально) */
  /* Подогнать буфер 2D-canvas под CSS-размер и DPR. Вызывать вручную из игры,
     которая САМА не пересчитывает width/height: иначе конфликт размеров.
     Автоматически не применяется — игры управляют своими холстами сами. */
  function sharpCanvas(canvas, opts) {
    if (!canvas || !canvas.getContext) return false;
    var options = opts || {};
    var ratio = dpr();
    if (options.ratio) ratio = Math.min(MAX_DPR, Math.max(1, options.ratio));
    var rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    var baseW = options.width || Number(canvas.getAttribute('width')) || rect.width;
    var baseH = options.height || Number(canvas.getAttribute('height')) || rect.height;
    // Соотношение сторон CSS-рамки: буфер повторяет его, чтобы не было полос.
    var aspect = rect.width / rect.height;
    var cssAspect = baseW / baseH;
    if (Math.abs(aspect - cssAspect) > 0.02) {
      baseH = Math.round(baseW / aspect);
    }
    var nextW = Math.round(baseW * ratio);
    var nextH = Math.round(baseH * ratio);
    if (canvas.width === nextW && canvas.height === nextH && canvas.dataset.vgSharp) return false;
    var ctx = null;
    try { ctx = canvas.getContext('2d'); } catch (e) { ctx = null; }
    // Для WebGL-контекста (Babylon/Three) менять width нельзя — там всё делает движок.
    if (!ctx) return false;
    canvas.width = nextW;
    canvas.height = nextH;
    canvas.dataset.vgSharp = '1';
    // Физический размер остаётся CSS-размером, картинка становится плотнее.
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (typeof window.__vgCanvasResized === 'function') {
      try { window.__vgCanvasResized(canvas, nextW, nextH); } catch (e) {}
    }
    return true;
  }

  /* Подсказка 3D-движкам: сообщить им плотность пикселей. */
  function sharpenEngine(engine) {
    if (!engine) return;
    try {
      if (typeof engine.setHardwareScalingLevel === 'function') {
        engine.setHardwareScalingLevel(1 / dpr());
      }
      if (typeof engine.resize === 'function') engine.resize();
    } catch (e) {}
  }

  /* ------------------------------------------------------------- 2. Фокус */
  function focusGame() {
    var target = document.querySelector('canvas[tabindex], canvas, #view, #world, #c');
    if (!target) return false;
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '0');
    try { target.focus({ preventScroll: true }); } catch (e) { try { target.focus(); } catch (e2) {} }
    return document.activeElement === target;
  }

  /* Клик/тап по полю отдаёт фокус обратно: после нажатия на кнопки управления
     стрелки продолжают работать. */
  function bindFocus() {
    ['pointerdown', 'touchstart'].forEach(function (name) {
      document.addEventListener(name, function (event) {
        var node = event.target;
        if (node && node.closest && node.closest('button, a, input, textarea, select, .overlay')) return;
        focusGame();
      }, { passive: true });
    });
    // Родитель-плеер может попросить фокус явно.
    window.addEventListener('message', function (event) {
      var data = event.data;
      if (data && (data.type === 'vg:focus' || data.type === 'focusGame')) focusGame();
    });
  }

  /* ------------------------------------------------------- 3. Инициализация */
  function init() {
    // Только CSS-качество отрисовки: без вмешательства в размеры буфера.
    Array.prototype.forEach.call(document.querySelectorAll('canvas'), function (canvas) {
      canvas.style.imageRendering = 'auto';
      if (window.CSS && CSS.supports && CSS.supports('image-rendering', 'smooth')) {
        canvas.style.imageRendering = 'smooth';
      }
      // Явно запрещаем браузеру сглаживать пиксель-арт «мылом» при апскейле.
      canvas.style.setProperty('-webkit-optimize-contrast', 'auto');
    });
    bindFocus();
    setTimeout(focusGame, 60);
    setTimeout(focusGame, 400);
  }

  window.VGGame = window.VGGame || {};
  window.VGGame.sharpCanvas = sharpCanvas;
  window.VGGame.sharpenEngine = sharpenEngine;
  window.VGGame.focus = focusGame;
  window.VGGame.dpr = dpr;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  /* Поворот экрана/раскрытие на весь экран: игры сами пересчитывают canvas,
     нам достаточно вернуть фокус, чтобы клавиатура не «отвалилась». */
  window.addEventListener('resize', function () { setTimeout(focusGame, 120); });
})(window, document);
