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

  /* ============================================================================
     4. Игра на весь экран телефона
     ----------------------------------------------------------------------------
     Плеер платформы отдаёт игре всю площадь экрана, но у классических 2D-игр
     (snake, 2048, flappy, pong, shooter, platformer) поле сидело в жёсткой
     колонке «статистика — поле — кнопки»: в портрете панели ели по 60–90 px
     сверху и снизу, а в ландшафте поле оставалось вертикальной полосой среди
     пустых полей. Здесь мы возвращаем игре её площадь:

       * портрет  — панели компактные, отступы поля убраны;
       * ландшафт — экран раскладывается в строку: поле во всю высоту слева,
                    кнопки колонкой справа, статистика тонкой полосой поверх
                    нижнего края (полоса прозрачна и не перехватывает нажатия).

     Правила ставятся только на страницы с классической раскладкой (.info и
     .controls), поэтому 3D-игры, Doodle и Redline не затрагиваются. Плюс JS
     помечает режим экрана (data-vg-view) и после поворота телефона просит игры
     пересчитать вид: часть браузеров сообщает об orientationchange раньше, чем
     обновляет размеры окна.
     ========================================================================== */

  var BASE_CSS = [
    /* Адресная строка мобильного браузера и «резинка» прокрутки не должны
       сдвигать поле: фон остаётся на месте, страница не тянется. */
    'html{overscroll-behavior:none;-webkit-text-size-adjust:100%}',
    'body{overscroll-behavior:none}'
  ].join('');

  var CLASSIC_CSS = [
    /* Высота по видимой области: в мобильном Safari 100vh больше экрана. */
    '.vg-classic body{height:100vh;height:100dvh}',

    /* ------------------------------------------------ портрет телефона */
    '@media (max-width:820px){',
    '.vg-classic .info{padding:4px 8px;gap:6px}',
    '.vg-classic .info .l,.vg-classic .info small{font-size:9px;letter-spacing:.7px}',
    '.vg-classic .info .v,.vg-classic .info b{font-size:15px}',
    '.vg-classic .board,.vg-classic .board-wrap{padding:0;flex:1 1 auto;min-height:0;min-width:0}',
    /* .stage у части игр без стилей — он должен забирать всю оставшуюся высоту. */
    '.vg-classic .stage{flex:1 1 auto;min-height:0;min-width:0;padding:0;display:flex;',
    '  align-items:center;justify-content:center}',
    '.vg-classic .stage>canvas{flex:0 0 auto}',
    '.vg-classic .controls{padding:6px 8px;gap:8px}',
    '}',

    /* ----------------------------------------------- ландшафт телефона */
    '@media (orientation:landscape) and (max-height:600px){',
    '.vg-classic body{display:flex;flex-direction:row;align-items:stretch}',
    /* Статистика — тонкая полоса поверх нижнего края игрового поля. */
    '.vg-classic .info{position:fixed;left:0;right:0;top:auto;bottom:0;z-index:12;',
    '  background:linear-gradient(0deg,rgba(5,6,10,.78),rgba(5,6,10,0));border:0;',
    '  padding:2px 8px calc(2px + env(safe-area-inset-bottom,0px));pointer-events:none}',
    '.vg-classic .info .l,.vg-classic .info small{font-size:8px}',
    '.vg-classic .info .v,.vg-classic .info b{font-size:13px}',
    /* Поле — во всю высоту слева, кнопки — колонкой справа. */
    '.vg-classic .stage,.vg-classic .board,.vg-classic .board-wrap,.vg-classic body>canvas{',
    '  flex:1 1 0;min-width:0;min-height:0;align-self:stretch;padding:0}',
    '.vg-classic .controls{flex:0 0 auto;flex-direction:column;justify-content:center;',
    '  border:0;padding:6px;gap:10px;width:auto;',
    '  background:linear-gradient(90deg,rgba(5,6,10,0),rgba(5,6,10,.45))}',
    '.vg-classic .muted{top:6px!important;right:6px!important}',
    /* Подсказки «стрелки / свайпы» в ландшафте только отнимают высоту у поля. */
    '.vg-classic body>.hint,.vg-classic body>.help{display:none}',
    '.vg-classic .dpad{grid-template-columns:repeat(3,44px);grid-template-rows:repeat(3,44px)}',
    '}'
  ].join('');

  function style(id, css) {
    var node = document.getElementById(id);
    if (!node) {
      node = document.createElement('style');
      node.id = id;
      (document.head || document.documentElement).appendChild(node);
    }
    node.textContent = css;
    return node;
  }

  function landscape() {
    return window.innerWidth > window.innerHeight && window.innerHeight <= 600;
  }
  function viewMode() {
    if (landscape()) return 'landscape';
    if (window.innerWidth <= 820) return 'portrait';
    return 'desktop';
  }

  /* Игры пересчитывают поле по событию resize. После поворота телефона оно
     приходит раньше, чем браузер обновит innerWidth/innerHeight, поэтому
     повторяем его сами — один раз, когда размеры уже устоялись. */
  function refit() {
    try { window.dispatchEvent(new Event('resize')); } catch (e) {}
  }

  function bindViewport() {
    var root = document.documentElement;
    var lastH = window.innerHeight, lastW = window.innerWidth;
    function mark() {
      var mode = viewMode();
      if (root.getAttribute('data-vg-view') !== mode) root.setAttribute('data-vg-view', mode);
    }
    mark();
    window.addEventListener('resize', function () {
      mark();
      lastH = window.innerHeight; lastW = window.innerWidth;
    });
    window.addEventListener('orientationchange', function () {
      mark();
      setTimeout(function () { mark(); refit(); }, 180);
      setTimeout(refit, 600);
    });
    /* Выезд/уход адресной строки меняет высоту на десятки пикселей: поле
       должно подстроиться, но мелкие дребезги игнорируем. */
    if (window.visualViewport) {
      try {
        window.visualViewport.addEventListener('resize', function () {
          var h = Math.round(window.innerHeight);
          var w = Math.round(window.innerWidth);
          if (Math.abs(h - lastH) < 40 && Math.abs(w - lastW) < 40) return;
          lastH = h; lastW = w;
          mark();
          refit();
        });
      } catch (e) {}
    }
  }

  /* ------------------------------------------------------- 5. Инициализация */
  /* Раскладка экрана — сразу при загрузке скрипта (он стоит в конце body, когда
     панели уже разобраны): иначе первый кадр рисуется в старой колонке, и игрок
     видит рывок при открытии игры. */
  function fitLayout() {
    style('vg-base-fit', BASE_CSS);
    /* Классическая раскладка «статистика — поле — кнопки»: только её и правим. */
    if (document.querySelector('.info') && document.querySelector('.controls')) {
      document.documentElement.classList.add('vg-classic');
      style('vg-classic-fit', CLASSIC_CSS);
    }
    bindViewport();
  }

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
     6. VGReward — единый контракт награды с сервером для всех 2D-игр.
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
  window.VGGame.viewMode = viewMode;   // 'portrait' | 'landscape' | 'desktop'
  window.VGGame.refit = refit;         // попросить игру пересчитать поле

  fitLayout();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  /* Поворот экрана/раскрытие на весь экран: игры сами пересчитывают canvas,
     нам достаточно вернуть фокус, чтобы клавиатура не «отвалилась». */
  window.addEventListener('resize', function () { setTimeout(focusGame, 120); });
})(window, document);
