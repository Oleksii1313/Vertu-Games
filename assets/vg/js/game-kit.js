/* ============================================================================
   Vert Games · общий помощник для игр
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

  /* ---------------------------------- 3. Запрет выделения текста в игре */
  /* Во время игры выделение мешает: долгий тап по полю подсвечивает текст,
     свайп утаскивает выделение, iOS показывает меню «скопировать». Правило
     ставится только на страницы игр (этот файл подключают только они) и НЕ
     распространяется на поля ввода и contenteditable. */
  var SELECTION_CSS = [
    'html,body,canvas,.stage,.board,.board-wrap,.game{-webkit-user-select:none;user-select:none;',
    '-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}',
    // Ввод текста и редактируемые области остаются полностью рабочими.
    'input,textarea,select,[contenteditable=""],[contenteditable="true"],.allow-select{',
    '-webkit-user-select:text;user-select:text;-webkit-touch-callout:default}'
  ].join('');

  function editable(target) {
    if (!target || target.nodeType !== 1) return false;
    if (target.isContentEditable) return true;
    return !!target.closest('input,textarea,select,[contenteditable=""],[contenteditable="true"],.allow-select');
  }

  function bindSelectionGuard() {
    var style = document.createElement('style');
    style.id = 'vg-no-select';
    style.textContent = SELECTION_CSS;
    (document.head || document.documentElement).appendChild(style);
    // Контекстное меню в игре не нужно, но в полях ввода и на ссылках — нужно.
    document.addEventListener('contextmenu', function (event) {
      if (editable(event.target)) return;
      if (event.target && event.target.closest && event.target.closest('a[href]')) return;
      event.preventDefault();
    });
    // Долгое нажатие на iOS/Android не должно запускать выделение и «лупу».
    document.addEventListener('selectstart', function (event) {
      if (!editable(event.target)) event.preventDefault();
    });
    // Двойной тап по канвасу не выделяет и не зумит страницу.
    document.addEventListener('dblclick', function (event) {
      if (!editable(event.target)) event.preventDefault();
    }, { passive: false });
  }

  /* ------------------------------------------------------- 4. Инициализация */
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
    bindSelectionGuard();
    bindFocus();
    setTimeout(focusGame, 60);
    setTimeout(focusGame, 400);
  }

  /* ============================================================================
     5. VGReward — единый контракт награды с сервером для всех 2D-игр.
     ----------------------------------------------------------------------------
     Игра считает только «единицы» события (труба, волна, 100 очков, заказ) и
     никогда не присылает сумму V. Платформа получает список единиц, сервер сам
     умножает их на ставку каталога, проверяет правдоподобность по времени,
     суточный лимит и одноразовость сессии и присылает подтверждённую сумму.
     Благодаря этому карточка каталога, счётчик в игре и баланс совпадают.
     ========================================================================== */
  var rewardState = {
    game: '', rate: 1, units: 0, state: 'idle', asked: 0, awarded: null,
    clamped: false, capped: false, zero: false, repeated: false, left: null,
    sessionId: '', reason: 'over', startedAt: 0, listeners: []
  };

  function vip() { return window.parent !== window; }
  function emit() {
    for (var i = 0; i < rewardState.listeners.length; i++) {
      try { rewardState.listeners[i](publicState()); } catch (e) {}
    }
  }
  function publicState() {
    return {
      game: rewardState.game, rate: rewardState.rate, units: rewardState.units,
      v: rewardState.units * rewardState.rate, state: rewardState.state,
      asked: rewardState.asked, awarded: rewardState.awarded, clamped: rewardState.clamped,
      capped: rewardState.capped, zero: rewardState.zero, repeated: rewardState.repeated,
      left: rewardState.left, sessionId: rewardState.sessionId
    };
  }
  function newSessionId(game) {
    return 'run-' + game + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }
  function pendingKey() { return 'vg_pending_' + rewardState.game; }
  function savePending(payload) {
    try { localStorage.setItem(pendingKey(), JSON.stringify(payload)); } catch (e) {}
  }
  function clearPending() {
    try { localStorage.removeItem(pendingKey()); } catch (e) {}
  }

  var VGReward = {
    /* Игра сообщает свои параметры: id и ставку за единицу (из каталога). */
    init: function (game, rate) {
      rewardState.game = String(game || '');
      rewardState.rate = Math.max(1, Math.floor(rate || 1));
      rewardState.units = 0;
      rewardState.state = 'idle';
      rewardState.awarded = null;
      rewardState.sessionId = newSessionId(rewardState.game);
      rewardState.startedAt = Date.now();
      return this;
    },
    /* Одна единица события: труба, волна, блок очков, заказ, доставка… */
    add: function (n) {
      rewardState.units += Math.max(0, Math.floor(n == null ? 1 : n));
      emit();
      return rewardState.units;
    },
    units: function () { return rewardState.units; },
    /* Абсолютное число единиц: игра сама выводит его из своего счёта
       (высота, дистанция, волны), поэтому вызовы идемпотентны. */
    set: function (n) {
      var next = Math.max(0, Math.floor(Number(n) || 0));
      if (next === rewardState.units) return rewardState.units;
      rewardState.units = next;
      emit();
      return next;
    },
    /* Сколько V игрок видит в интерфейсе — всегда units × ставка каталога. */
    v: function () { return rewardState.units * rewardState.rate; },
    rate: function () { return rewardState.rate; },
    state: publicState,
    /* Итог забега: отправляем единицы платформе, ждём подтверждение сервера. */
    finish: function (reason) {
      if (rewardState.state === 'pending' || rewardState.state === 'done') return false;
      if (!vip()) {                     // автономный запуск — баланса нет
        rewardState.state = 'local';
        emit();
        return false;
      }
      var payload = {
        type: 'gameSession', game: rewardState.game, units: rewardState.units,
        time: Math.round((Date.now() - rewardState.startedAt) / 1000),
        sessionId: rewardState.sessionId, reason: reason || 'over'
      };
      rewardState.reason = payload.reason;
      if (!rewardState.units) {         // нечего начислять — сервер не тревожим
        rewardState.state = 'done';
        rewardState.awarded = 0;
        emit();
        return false;
      }
      rewardState.state = 'pending';
      rewardState.asked = rewardState.units;
      savePending(payload);
      VGReward.post(payload);
      return true;
    },
    /* Повторная отправка того же итога (иконка повтора / возврат на вкладку). */
    post: function (payload) {
      try { window.parent.postMessage(payload, location.origin); } catch (e) {}
      clearTimeout(VGReward._timer);
      VGReward._timer = setTimeout(function () {
        if (rewardState.state === 'pending') { rewardState.state = 'failed'; emit(); }
      }, 9000);
    },
    retry: function () {
      if (rewardState.state !== 'failed' && rewardState.state !== 'pending') return;
      rewardState.state = 'pending';
      emit();
      VGReward.post({
        type: 'gameSession', game: rewardState.game, units: rewardState.units,
        time: Math.round((Date.now() - rewardState.startedAt) / 1000),
        sessionId: rewardState.sessionId, reason: rewardState.reason
      });
    },
    on: function (cb) {
      if (typeof cb === 'function') rewardState.listeners.push(cb);
    },
    /* Новый забег в той же странице: счётчики сбрасываются, id новый. */
    reset: function () {
      clearTimeout(VGReward._timer);
      rewardState.units = 0;
      rewardState.state = 'idle';
      rewardState.awarded = null;
      rewardState.clamped = rewardState.capped = rewardState.zero = rewardState.repeated = false;
      rewardState.left = null;
      rewardState.sessionId = newSessionId(rewardState.game);
      rewardState.startedAt = Date.now();
      emit();
    }
  };

  window.addEventListener('message', function (event) {
    if (event.origin !== location.origin) return;
    var data = event.data;
    if (!data || data.type !== 'gameSessionResult') return;
    if (data.game !== rewardState.game) return;
    clearTimeout(VGReward._timer);
    rewardState.state = 'done';
    rewardState.awarded = Number(data.awarded) || 0;
    rewardState.clamped = !!data.clamped;
    rewardState.capped = !!data.capped;
    rewardState.zero = !!data.zero;
    rewardState.repeated = !!data.repeated;
    rewardState.left = (data.dailyLeft === 0 || data.dailyLeft) ? Number(data.dailyLeft) : null;
    if (data.units != null) rewardState.asked = Number(data.units) || 0;
    clearPending();
    emit();
  });

  /* Платформа просит зафиксировать итог перед закрытием окна игры. */
  window.addEventListener('message', function (event) {
    if (event.origin !== location.origin) return;
    if (event.data && event.data.type === 'vg:flush' && rewardState.state === 'idle') {
      VGReward.finish('flush');
    }
  });

  /* Итог, не подтверждённый в прошлый раз, безопасно повторяем: сервер
     дедуплицирует по sessionId, двойного начисления не будет. */
  (function retryPending() {
    if (!vip()) return;
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(pendingKey()) || 'null'); } catch (e) {}
    if (!saved || !saved.sessionId || !saved.units || !saved.game) return;
    setTimeout(function () {
      rewardState.sessionId = saved.sessionId;
      rewardState.units = Number(saved.units) || 0;
      rewardState.asked = rewardState.units;
      rewardState.state = 'pending';
      emit();
      VGReward.post(saved);
    }, 1800);
  })();

  window.VGReward = VGReward;

  window.VGGame = window.VGGame || {};
  window.VGGame.sharpCanvas = sharpCanvas;
  window.VGGame.sharpenEngine = sharpenEngine;
  window.VGGame.focus = focusGame;
  window.VGGame.dpr = dpr;
  window.VGGame.noSelect = bindSelectionGuard;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  /* Поворот экрана/раскрытие на весь экран: игры сами пересчитывают canvas,
     нам достаточно вернуть фокус, чтобы клавиатура не «отвалилась». */
  window.addEventListener('resize', function () { setTimeout(focusGame, 120); });
})(window, document);
