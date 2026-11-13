/* Звук казино на Web Audio API.
 *
 * Никаких mp3 — все эффекты синтезируются на лету: тики барабанов и колеса,
 * замедляющиеся к остановке, короткая «монетная» трель на выигрыш и мягкий
 * аккорд на крупный приз. Контекст создаётся только после действия
 * пользователя (клик по «Крутить»), поэтому автоплей-политика браузеров
 * не блокирует звук.
 */
(function () {
  'use strict';

  var VG = window.VG || (window.VG = {});
  var STATE_KEY = 'vg.sfx';
  var ctx = null;
  var master = null;
  var enabled = true;

  try {
    if (localStorage.getItem(STATE_KEY) === 'off') enabled = false;
  } catch (e) {}

  function supported() {
    return !!(window.AudioContext || window.webkitAudioContext);
  }

  /* Контекст создаётся лениво и обязательно из обработчика клика. */
  function ensure() {
    if (!enabled || !supported()) return null;
    if (!ctx) {
      var Ctor = window.AudioContext || window.webkitAudioContext;
      try {
        ctx = new Ctor();
      } catch (e) {
        ctx = null;
        return null;
      }
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended' && ctx.resume) {
      try { ctx.resume(); } catch (e) {}
    }
    return ctx;
  }

  function time() {
    return ctx ? ctx.currentTime : 0;
  }

  /* Базовый тон: осциллятор с огибающей, чтобы не было щелчков. */
  function tone(options) {
    if (!ensure()) return;
    var opt = options || {};
    var start = time() + (opt.delay || 0);
    var duration = opt.duration || 0.08;
    var freq = opt.freq || 440;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = opt.type || 'triangle';
    osc.frequency.setValueAtTime(freq, start);
    if (opt.to) osc.frequency.exponentialRampToValueAtTime(Math.max(30, opt.to), start + duration);
    var peak = opt.gain == null ? 0.22 : opt.gain;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + Math.min(0.012, duration / 3));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  /* Короткий шумовой «клац» — тик барабана или колеса. */
  function click(options) {
    if (!ensure()) return;
    var opt = options || {};
    var start = time() + (opt.delay || 0);
    var length = opt.duration || 0.03;
    var frames = Math.max(1, Math.floor(ctx.sampleRate * length));
    var buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < frames; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / frames, 2.5);
    }
    var source = ctx.createBufferSource();
    source.buffer = buffer;
    var filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = opt.freq || 1800;
    filter.Q.value = 1.2;
    var gain = ctx.createGain();
    gain.gain.value = opt.gain == null ? 0.35 : opt.gain;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(start);
  }

  var api = {
    /* Тик колеса: чем ближе остановка, тем тише и ниже. Вызывается из rAF-цикла. */
    tick: function (progress, kind) {
      var p = Math.max(0, Math.min(1, progress || 0));
      click({
        freq: kind === 'wheel' ? 1200 + 900 * p : 900 + 1400 * p,
        gain: 0.12 + 0.24 * (1 - p),
        duration: 0.028
      });
    },
    /* Тик барабана слотов — для интервала прокрутки. */
    reelTick: function (index) {
      click({ freq: 1100 + ((index || 0) % 3) * 260, gain: 0.18, duration: 0.026 });
    },
    /* Остановка барабана: низкий удар + клац. */
    reelStop: function (index) {
      tone({ freq: 190 - (index || 0) * 22, to: 110, duration: 0.14, type: 'square', gain: 0.16 });
      click({ freq: 700, gain: 0.22, duration: 0.05 });
    },
    /* Монетная трель на выигрыш; на крупный приз добавляется мажорный аккорд. */
    win: function (amount) {
      var big = Number(amount || 0) >= 200;
      var notes = big ? [784, 988, 1175, 1568, 1976] : [784, 1047, 1568];
      notes.forEach(function (freq, index) {
        tone({ freq: freq, duration: 0.16, delay: index * 0.075, type: 'triangle', gain: 0.2 });
        tone({ freq: freq * 2, duration: 0.1, delay: index * 0.075, type: 'sine', gain: 0.08 });
      });
      if (big) {
        [523.25, 659.25, 783.99, 1046.5].forEach(function (freq, index) {
          tone({ freq: freq, duration: 0.9, delay: 0.34 + index * 0.02, type: 'sine', gain: 0.11 });
        });
      }
    },
    /* Проигрыш — короткий нисходящий «вздох», без злорадства. */
    lose: function () {
      tone({ freq: 320, to: 196, duration: 0.32, type: 'sine', gain: 0.12 });
    },
    /* Клик по ставке. */
    press: function () {
      tone({ freq: 620, to: 880, duration: 0.06, type: 'triangle', gain: 0.12 });
    },
    toggle: function (next) {
      enabled = next == null ? !enabled : !!next;
      if (master) master.gain.value = enabled ? 0.5 : 0;
      try { localStorage.setItem(STATE_KEY, enabled ? 'on' : 'off'); } catch (e) {}
      return enabled;
    },
    enabled: function () { return enabled; },
    /* Разблокировка по первому жесту — вызывать из любого обработчика клика. */
    unlock: function () { return !!ensure(); }
  };

  VG.sfx = api;
})();
