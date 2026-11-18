/* ============================================================================
   VERT GAMES · фоновая музыка
   ----------------------------------------------------------------------------
   Оригинальная 8-битная петля, синтезированная в браузере через Web Audio:
   ни одного скачанного файла, поэтому загрузка мгновенная, а трек не может
   «догрузиться» дважды. Один плеер на вкладку: guard ниже не даёт создать
   второй экземпляр даже если скрипт подключён дважды.

   Что важно по требованиям:
   • музыка не включается принудительно — если игрок выключил её раньше
     (localStorage vg_music = '0'), она не заиграет ни на одной странице;
   • автоплей не нарушается: звук стартует только после первого действия
     пользователя (клик/тап/клавиша), без ошибок в консоли;
   • преференс и позиция петли переживают refresh и переход между страницами;
   • кнопка с иконкой и подписью ON/OFF, выключение мгновенное;
   • во время игры громкость приглушается (duck), чтобы не мешать звукам игры;
   • игровые звуки живут в своих AudioContext и не отключаются этой музыкой.
   ========================================================================== */
(function (window, document) {
  'use strict';
  if (window.__vgMusicInstalled) return;
  window.__vgMusicInstalled = true;

  var STORAGE_KEY = 'vg_music';          // '1' включено, '0' выключено
  var PHASE_KEY = 'vg_music_phase';      // стартовый «такт» для непрерывности
  var TEMPO = 132;                       // bpm
  var STEP = 60 / TEMPO / 4;             // длительность 16-й ноты, сек
  var LOOP_STEPS = 128;                  // 8 тактов по 16 шагов
  var MASTER = 0.085;                    // умеренная громкость
  var DUCKED = 0.032;                    // приглушение, пока открыта игра

  /* ------------------------------------------------------------- партитура */
  /* Аккорды по тактам: ля минор — фа — до — соль (и вариация во второй части).*/
  var BASS = [45, 41, 48, 43, 45, 41, 43, 40];
  var TRIADS = [
    [57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62],
    [57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 56, 59]
  ];
  /* Мелодия: 8 долей на такт, 0 — пауза. */
  var LEAD = [
    [69, 72, 76, 72, 74, 72, 69, 0],
    [65, 69, 72, 69, 71, 69, 65, 0],
    [67, 72, 76, 72, 74, 72, 67, 0],
    [67, 71, 74, 71, 72, 74, 71, 0],
    [69, 72, 76, 79, 76, 72, 69, 0],
    [65, 69, 72, 77, 72, 69, 65, 0],
    [67, 71, 74, 79, 74, 71, 67, 0],
    [64, 68, 71, 76, 71, 68, 64, 0]
  ];

  function midi(note) { return 440 * Math.pow(2, (note - 69) / 12); }

  /* --------------------------------------------------------------- состояние */
  var ctx = null, master = null, noise = null, timer = null;
  var step = 0, nextTime = 0, playing = false, ducked = false;
  var listeners = [];
  var enabled = readPref();

  function readPref() {
    try {
      var v = localStorage.getItem(STORAGE_KEY);
      return v === null ? true : v === '1';     // по умолчанию музыка включена
    } catch (e) { return true; }
  }
  function writePref(on) {
    try { localStorage.setItem(STORAGE_KEY, on ? '1' : '0'); } catch (e) {}
  }
  function phaseStart() {
    try { return Number(sessionStorage.getItem(PHASE_KEY)) || 0; } catch (e) { return 0; }
  }
  function setPhaseStart(ms) {
    try { sessionStorage.setItem(PHASE_KEY, String(ms)); } catch (e) {}
  }

  /* -------------------------------------------------------------- синтезатор */
  function ensureContext() {
    if (ctx) return ctx;
    var Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = ducked ? DUCKED : MASTER;
      master.connect(ctx.destination);
    } catch (e) { ctx = null; }
    return ctx;
  }

  function tone(freq, time, dur, type, gain, detune) {
    if (!ctx) return;
    var osc = ctx.createOscillator();
    var amp = ctx.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, time);
    if (detune) osc.detune.setValueAtTime(detune, time);
    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), time + 0.006);
    amp.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    osc.connect(amp);
    amp.connect(master);
    osc.start(time);
    osc.stop(time + dur + 0.02);
  }

  function hat(time, gain) {
    if (!ctx) return;
    if (!noise) {
      noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.08), ctx.sampleRate);
      var data = noise.getChannelData(0);
      for (var i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }
    var src = ctx.createBufferSource();
    src.buffer = noise;
    var filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 6000;
    var amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, time);
    amp.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    src.connect(filter);
    filter.connect(amp);
    amp.connect(master);
    src.start(time);
    src.stop(time + 0.06);
  }

  /* Один шаг партитуры: 16-я нота. */
  function scheduleStep(s, time) {
    var bar = Math.floor(s / 16) % 8;
    var pos = s % 16;
    var bassNote = BASS[bar] + (pos === 10 ? 7 : 0);
    if (pos % 2 === 0) tone(midi(bassNote), time, STEP * 1.6, 'triangle', 0.2);
    var triad = TRIADS[bar];
    if (pos % 2 === 1) tone(midi(triad[pos % 3] + 12), time, STEP * 0.9, 'square', 0.05);
    if (pos % 4 === 2) hat(time, 0.05);
    if (pos % 2 === 0) {
      var lead = LEAD[bar][pos / 2];
      if (lead) tone(midi(lead), time, STEP * 1.7, 'square', 0.11);
    }
  }

  function tick() {
    if (!ctx || !playing) return;
    var horizon = ctx.currentTime + 0.14;
    while (nextTime < horizon) {
      scheduleStep(step, nextTime);
      nextTime += STEP;
      step = (step + 1) % LOOP_STEPS;
    }
  }

  /* -------------------------------------------------------------- управление */
  function start() {
    if (playing || !enabled) return;
    if (!ensureContext()) return;
    if (ctx.state === 'suspended' && ctx.resume) {
      ctx.resume().catch(function () {});
    }
    // Продолжаем петлю с того же места, если страница только что сменилась.
    var wall = phaseStart();
    if (wall) {
      var elapsed = Math.max(0, (Date.now() - wall) / 1000);
      var stepsDone = Math.floor(elapsed / STEP);
      step = stepsDone % LOOP_STEPS;
      nextTime = ctx.currentTime + Math.max(0, stepsDone * STEP + STEP - elapsed);
    } else {
      step = 0;
      nextTime = ctx.currentTime + 0.06;
      setPhaseStart(Date.now());
    }
    playing = true;
    clearInterval(timer);
    timer = setInterval(tick, 25);
    tick();
    paint();
  }

  function stop() {
    playing = false;
    clearInterval(timer);
    timer = null;
    setPhaseStart(0);
    paint();
  }

  function setEnabled(on) {
    enabled = !!on;
    writePref(enabled);
    if (enabled) start(); else stop();
    paint();
  }

  /* ------------------------------------------- автоплей: ждём первый жест */
  var gestureBound = false;
  function bindGesture() {
    if (gestureBound) return;
    gestureBound = true;
    var onGesture = function () {
      if (!enabled) return;
      if (!ctx) ensureContext();
      if (ctx && ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(function () {});
      start();
    };
    ['pointerdown', 'touchstart', 'keydown', 'click'].forEach(function (name) {
      document.addEventListener(name, onGesture, { passive: true });
    });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) return;
      if (enabled && ctx && ctx.state === 'suspended') ctx.resume().catch(function () {});
    });
  }

  /* ------------------------------------------------------------------ кнопка */
  var CSS = '' +
    '.vgm-btn{position:fixed;right:calc(14px + env(safe-area-inset-right,0px));' +
    'bottom:calc(14px + env(safe-area-inset-bottom,0px));z-index:60;display:flex;align-items:center;gap:8px;' +
    'padding:9px 14px;border-radius:999px;border:1px solid rgba(46,230,200,.35);cursor:pointer;' +
    'background:linear-gradient(145deg,rgba(23,20,38,.94),rgba(11,14,20,.94));color:#E8FFF9;' +
    'font:600 12px/1 "Inter",system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:.08em;' +
    'text-transform:uppercase;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);' +
    'box-shadow:0 10px 26px rgba(0,0,0,.45),0 0 0 1px rgba(198,255,61,.08);' +
    'transition:transform .15s ease,border-color .2s ease,background .2s ease;}' +
    '.vgm-btn:hover{transform:translateY(-1px);border-color:rgba(198,255,61,.55)}' +
    '.vgm-btn:active{transform:translateY(0)}' +
    '.vgm-btn:focus-visible{outline:2px solid #C6FF3D;outline-offset:2px}' +
    '.vgm-btn svg{width:16px;height:16px;flex:none}' +
    '.vgm-btn .vgm-state{color:#C6FF3D}' +
    '.vgm-btn[aria-pressed="false"]{border-color:rgba(255,255,255,.14);color:#9AA6B8}' +
    '.vgm-btn[aria-pressed="false"] .vgm-state{color:#FF6B8A}' +
    '.vgm-btn .vgm-bars{display:flex;align-items:flex-end;gap:2px;height:12px}' +
    '.vgm-btn .vgm-bars i{width:2px;background:currentColor;opacity:.9;border-radius:1px;' +
    'animation:vgmEq 900ms ease-in-out infinite;height:30%}' +
    '.vgm-btn .vgm-bars i:nth-child(2){animation-delay:140ms;height:65%}' +
    '.vgm-btn .vgm-bars i:nth-child(3){animation-delay:280ms;height:45%}' +
    '.vgm-btn[aria-pressed="false"] .vgm-bars i{animation:none;height:20%}' +
    '@keyframes vgmEq{0%,100%{transform:scaleY(.45)}50%{transform:scaleY(1)}}' +
    '@media (max-width:640px){.vgm-btn{padding:8px 12px;font-size:11px}' +
    '.vgm-btn .vgm-label{display:none}}' +
    '@media (prefers-reduced-motion:reduce){.vgm-btn .vgm-bars i{animation:none}}';

  var button = null;
  function iconNote() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M9 18V6l10-2v11"/><circle cx="6.5" cy="18" r="2.6"/><circle cx="16.5" cy="15" r="2.6"/></svg>';
  }
  function iconMuted() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M9 18V6l10-2v11"/><circle cx="6.5" cy="18" r="2.6"/><circle cx="16.5" cy="15" r="2.6"/>' +
      '<path d="M3 3l18 18"/></svg>';
  }
  function label(on) {
    var ru = window.VG && window.VG.lang && window.VG.lang() === 'en';
    if (on) return ru ? 'MUSIC' : 'МУЗЫКА';
    return ru ? 'MUSIC OFF' : 'МУЗЫКА ВЫКЛ';
  }

  function build() {
    if (button || !document.body) return;
    var style = document.createElement('style');
    style.id = 'vgm-style';
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
    button = document.createElement('button');
    button.type = 'button';
    button.className = 'vgm-btn';
    button.setAttribute('data-vg-music', '1');
    button.addEventListener('click', function () {
      setEnabled(!enabled);
      if (enabled) {
        // Клик по кнопке — тоже жест: гарантированно снимаем блокировку автоплея.
        if (ctx && ctx.state === 'suspended') ctx.resume().catch(function () {});
      }
    });
    document.body.appendChild(button);
    paint();
  }

  function paint() {
    if (!button) return;
    var on = enabled;
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
    button.title = on ? 'Музыка включена — нажмите, чтобы выключить'
                      : 'Музыка выключена — нажмите, чтобы включить';
    button.setAttribute('aria-label', button.title);
    button.innerHTML = (on ? iconNote() : iconMuted()) +
      '<span class="vgm-bars" aria-hidden="true"><i></i><i></i><i></i></span>' +
      '<span class="vgm-label">' + label(on) + '</span>' +
      '<span class="vgm-state">' + (on ? 'ON' : 'OFF') + '</span>';
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i]({ enabled: on, playing: playing, ducked: ducked }); } catch (e) {}
    }
  }

  /* -------------------------------------------------------- публичный API */
  window.VGMusic = {
    isOn: function () { return enabled; },
    isPlaying: function () { return playing; },
    setEnabled: setEnabled,
    toggle: function () { setEnabled(!enabled); },
    /* Приглушение на время игры: музыка остаётся, но не перекрывает геймплей. */
    duck: function (on) {
      ducked = !!on;
      if (master && ctx) {
        var target = ducked ? DUCKED : MASTER;
        try {
          master.gain.cancelScheduledValues(ctx.currentTime);
          master.gain.setTargetAtTime(target, ctx.currentTime, 0.08);
        } catch (e) { master.gain.value = target; }
      }
      paint();
    },
    on: function (cb) { if (typeof cb === 'function') listeners.push(cb); },
    /* Для тестов и отладки: позиция петли и число шагов. */
    debug: function () {
      return { enabled: enabled, playing: playing, step: step, loop: LOOP_STEPS,
               tempo: TEMPO, stepSeconds: STEP, state: ctx ? ctx.state : 'none',
               ducked: ducked, phase: phaseStart() };
    }
  };

  function init() {
    build();
    bindGesture();
    /* Автоплей: контекст создаём только если музыка уже играла в этой вкладке
       (переход между страницами) — тогда браузер обычно разрешает продолжить.
       В остальных случаях ждём первого действия: до жеста никаких AudioContext,
       поэтому в консоли нет предупреждений браузера о заблокированном автоплее. */
    if (enabled && phaseStart()) {
      setTimeout(function () {
        if (!enabled) return;
        if (!ensureContext()) return;
        if (ctx.state === 'running') start();
      }, 120);
    }
    // Смена языка перерисовывает подпись.
    document.addEventListener('vg:lang', paint);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window, document);
