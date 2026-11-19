#!/usr/bin/env node
/* =============================================================================
   Vert Games · Flappy Bird: звуки и кнопка «звук»
   -----------------------------------------------------------------------------
   Игра запускается целиком (jsdom + заглушки canvas), а AudioContext заменяется
   счётчиком узлов. Проверяется именно поведение, а не наличие строк:

     1. взмах — короткий сигнал на каждый тап;
     2. очко за пройденную трубу;
     3. удар при столкновении и отдельный сигнал конца игры;
     4. старт новой партии по кнопке «Играть снова»;
     5. кнопка «звук» выключает и включает звук, состояние уходит в localStorage;
     6. при выключенном звуке новые узлы не создаются;
     7. предпочтение переживает перезагрузку страницы;
     8. геймплей не изменился: трубы идут, счёт растёт, птица падает без взмахов.

   Запуск:  NODE_PATH=/tmp/dom/node_modules node tools/test_flappy_sound.js
   ========================================================================== */
'use strict';
let JSDOM;
try {
  ({ JSDOM } = require('jsdom'));
} catch (error) {
  console.log('SKIP: jsdom не установлен (npm install jsdom) — тест пропущен');
  process.exit(0);
}
const fs = require('fs');
const path = require('path');
const sfxSource = fs.readFileSync(path.join(__dirname, '..', 'assets', 'vg', 'js', 'sfx.js'), 'utf8');
/* jsdom не загружает внешние скрипты: подставляем реальный код модуля на место
   тега — порядок (модуль до игрового скрипта) тот же, что в браузере. */
const html = fs.readFileSync(path.join(__dirname, '..', 'games', 'flappy.html'), 'utf8')
  // Замена через функцию: в коде модуля есть «$$», а String.replace
  // трактует это как спец-шаблон и съедает символ.
  .replace('<script src="/assets/vg/js/sfx.js"></script>', () => '<script>\n' + sfxSource + '\n</script>');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log((ok ? 'PASS ' : 'FAIL ') + ' · ' + name + (detail === undefined ? '' : ' → ' + JSON.stringify(detail)));
}

/* --------------------------------------------------------------- заглушки */
function makeCtx2d(rec) {
  const grad = { addColorStop() {} };
  return new Proxy({}, {
    get(t, k) {
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => grad;
      if (k === 'translate') return (x, y) => { if (rec) { rec.x = x; rec.y = y; } };
      if (k in t) return t[k];
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; }
  });
}

function makeAudio(audio) {
  class Param {
    constructor() { this.value = 0; this.events = []; }
    setValueAtTime(v, t) { this.events.push(['set', v, t]); this.value = v; return this; }
    exponentialRampToValueAtTime(v, t) { this.events.push(['ramp', v, t]); return this; }
    linearRampToValueAtTime(v, t) { this.events.push(['lin', v, t]); return this; }
    setTargetAtTime(v) { this.value = v; return this; }
  }
  class Node {
    constructor(kind) { this.kind = kind; this.gain = new Param(); this.frequency = new Param(); this.Q = new Param(); this.type = 'sine'; this.buffer = null; }
    connect() { return this; }
    start() {}
    stop() {}
  }
  return class AudioContextStub {
    constructor() {
      audio.contexts += 1;
      this.state = 'running';
      this.sampleRate = 44100;
      this.currentTime = 0;
      this.destination = new Node('dest');
    }
    createGain() { audio.nodes += 1; return new Node('gain'); }
    createOscillator() { const n = new Node('osc'); audio.nodes += 1; audio.osc.push(n); return n; }
    createBiquadFilter() { audio.nodes += 1; return new Node('filter'); }
    createBufferSource() { audio.nodes += 1; return new Node('src'); }
    createBuffer(channels, frames) { return { numberOfChannels: channels, getChannelData: () => new Float32Array(frames) }; }
    resume() { this.state = 'running'; return Promise.resolve(); }
  };
}

function boot(options) {
  const opts = options || {};
  const audio = { contexts: 0, nodes: 0, osc: [] };
  const bird = { x: 0, y: 0 };
  const rafs = [];
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'http://localhost/games/flappy.html',
    beforeParse(win) {
      win.HTMLCanvasElement.prototype.getContext = () => makeCtx2d(bird);
      win.devicePixelRatio = 1;
      win.AudioContext = makeAudio(audio);
      win.Element.prototype.getBoundingClientRect = function () {
        const pad = 16;
        const stage = this.classList && this.classList.contains('stage');
        const w = stage ? 390 - pad : 390;
        const h = stage ? 844 - pad : 844;
        return { width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0 };
      };
      win.requestAnimationFrame = (cb) => { rafs.push(cb); return rafs.length; };
      win.cancelAnimationFrame = () => {};
      Object.defineProperty(win, 'innerWidth', { get: () => 390, configurable: true });
      Object.defineProperty(win, 'innerHeight', { get: () => 844, configurable: true });
      if (opts.soundOff) { try { win.localStorage.setItem('vg.sfx', 'off'); } catch (e) {} }
      // Стабильные трубы: один и тот же просвет на каждом кадре.
      win.Math.random = () => 0.5;
    }
  });
  const win = dom.window;
  return { dom, win, audio, rafs, bird };
}

function step(ctx, n, dt) {
  for (let i = 0; i < (n || 1); i++) {
    const cb = ctx.rafs.pop();
    ctx.rafs.length = 0;
    if (!cb) return false;
    ctx.t = (ctx.t || 1000) + (dt || 16.667);
    cb(ctx.t);
  }
  return true;
}

/* ------------------------------------------------------------------ 1. старт */
const A = boot();
const win = A.win;
const $ = (id) => win.document.getElementById(id);
const soundBtn = $('btnSound');

check('sfx-модуль подключён к игре', !!win.VG && !!win.VG.sfx);
check('кнопка звука есть и нажимается', !!soundBtn && soundBtn.getAttribute('aria-pressed') === 'true');
check('аудио-контекст создаётся только после жеста (политика браузеров)',
  A.audio.contexts === 0, A.audio.contexts);

/* Взмах: клавиша «пробел» — тот же jump(), что и тап по кнопке. */
const beforeFlap = A.audio.nodes;
win.document.dispatchEvent(new win.KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
check('взмах звучит', A.audio.nodes > beforeFlap && A.audio.contexts === 1,
  { nodes: A.audio.nodes - beforeFlap, contexts: A.audio.contexts });
const flapFreq = A.audio.osc[0] ? A.audio.osc[0].frequency.events[0] : null;
check('взмах — короткий восходящий тон', !!flapFreq && flapFreq[1] >= 300 && flapFreq[1] <= 900, flapFreq && flapFreq[1]);

/* --------------------------------------------- 2. очко: пролетаем трубы */
/* Взмах — тот же обработчик «пробела», что и тап по кнопке. */
function flap() {
  win.document.dispatchEvent(new win.KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
}
/* Автопилот: высоту птицы видно по translate() из draw(), поэтому держим
   её в середине экрана — там же просвет трубы (Math.random зафиксирован).
   Это одновременно проверка того, что управление и физика работают. */
function flyUntilScore(maxFrames) {
  for (let frames = 0; frames < maxFrames; frames++) {
    const before = A.audio.nodes;
    step(A, 1);
    if (Number($('scoreVal').textContent) > 0) return { ok: true, sound: A.audio.nodes - before, frames };
    if ($('overlay').classList.contains('show')) return { ok: false, frames };
    if (A.bird.y > 415) flap();
  }
  return { ok: false, frames: maxFrames };
}
const scored = flyUntilScore(1500);
check('птица слушается взмахов (автопилот держит высоту)', A.bird.y > 0 && A.bird.y < 828, Math.round(A.bird.y));
check('очко за трубу начисляется (геймплей не сломан)', scored.ok,
  'кадров: ' + scored.frames);
check('очко звучит', !!scored && scored.sound > 0, scored ? scored.sound : 0);

/* ------------------------------------- 3. столкновение и конец игры */
const beforeCrash = A.audio.nodes;
let crashed = false;
let crashFrames = 0;
while (!crashed && crashFrames < 4000) {
  step(A, 1);                                   // больше не взмахиваем — птица падает
  crashFrames += 1;
  crashed = $('overlay').classList.contains('show');
}
check('столкновение завершает партию', crashed);
check('удар звучит при столкновении', A.audio.nodes > beforeCrash, A.audio.nodes - beforeCrash);
const crashNodes = A.audio.nodes;
// Сигнал конца игры приходит с задержкой 200 мс — прокручиваем таймеры.
win.eval('void 0');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await wait(260);
  check('отдельный сигнал конца игры проигрывается', A.audio.nodes > crashNodes, A.audio.nodes - crashNodes);

  /* --------------------------------------------------- 4. старт новой партии */
  const beforeStart = A.audio.nodes;
  win.restart();
  check('старт новой партии звучит', A.audio.nodes > beforeStart, A.audio.nodes - beforeStart);
  check('после рестарта счёт обнулён', Number($('scoreVal').textContent) === 0);
  check('после рестарта оверлей скрыт', !$('overlay').classList.contains('show'));

  /* ------------------------------------------------------- 5. выключаем звук */
  soundBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  check('кнопка выключает звук', win.VG.sfx.enabled() === false && soundBtn.classList.contains('muted'),
    soundBtn.getAttribute('aria-pressed'));
  check('состояние запомнено в localStorage', win.localStorage.getItem('vg.sfx') === 'off',
    win.localStorage.getItem('vg.sfx'));
  const mutedNodes = A.audio.nodes;
  win.document.dispatchEvent(new win.KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
  step(A, 4);
  check('при выключенном звуке новые звуки не создаются', A.audio.nodes === mutedNodes,
    A.audio.nodes - mutedNodes);

  soundBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  check('кнопка снова включает звук', win.VG.sfx.enabled() === true && !soundBtn.classList.contains('muted'));
  const onNodes = A.audio.nodes;
  win.document.dispatchEvent(new win.KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
  check('после включения звук вернулся', A.audio.nodes > onNodes, A.audio.nodes - onNodes);

  /* ------------------------------------------- 6. предпочтение после перезагрузки */
  const B = boot({ soundOff: true });
  check('после перезагрузки звук остаётся выключенным', B.win.VG.sfx.enabled() === false);
  check('и кнопка показывает выключенный звук',
    B.win.document.getElementById('btnSound').classList.contains('muted'));
  const reloadNodes = B.audio.nodes;
  B.win.document.dispatchEvent(new B.win.KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
  check('и игра при этом работает (птица взмахивает без звука)', B.audio.nodes === reloadNodes);

  /* ------------------------------------------------------------- итог */
  const passed = results.filter((r) => r.ok).length;
  console.log('ИТОГО: ' + passed + '/' + results.length + ' проверок пройдено');
  process.exit(passed === results.length ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
