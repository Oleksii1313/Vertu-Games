#!/usr/bin/env node
/*
 * Автотест музыки VERT: синтез, автоплей-политика, кнопка, преференс,
 * приглушение и «один плеер на вкладку».
 *
 * jsdom не умеет Web Audio, поэтому подставляется управляемый FakeAudioContext:
 * он считает запланированные ноты и позволяет проверить, что звук реально
 * планируется (а не просто «кнопка нажата»).
 *
 *     node tools/test_music.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const FILE = process.env.MUSIC_JS || path.join(__dirname, '..', 'assets', 'vg', 'js', 'music.js');
const source = fs.readFileSync(FILE, 'utf8');

function makeFakeAudio() {
  const log = { osc: 0, started: 0, buffers: 0, resumes: 0, gains: [] };
  const t0 = Date.now();
  class Param {
    constructor(value) { this.value = value; }
    setValueAtTime(v) { this.value = v; return this; }
    exponentialRampToValueAtTime(v) { this.value = v; return this; }
    linearRampToValueAtTime(v) { this.value = v; return this; }
    cancelScheduledValues() { return this; }
    setTargetAtTime(v) { this.value = v; return this; }
  }
  class Gain {
    constructor() { this.gain = new Param(1); log.gains.push(this); }
    connect() {} disconnect() {}
  }
  class Osc {
    constructor() {
      log.osc++;
      this.type = 'sine';
      this.frequency = new Param(440);
      this.detune = new Param(0);
    }
    connect() {}
    start() { log.started++; }
    stop() {}
  }
  class Src { constructor() { log.buffers++; this.buffer = null; } connect() {} start() {} stop() {} }
  class Filter { constructor() { this.type = 'lowpass'; this.frequency = new Param(1000); } connect() {} }
  class Ctx {
    constructor() { this.sampleRate = 44100; this.state = 'suspended'; this.destination = {}; }
    get currentTime() { return (Date.now() - t0) / 1000; }
    createGain() { return new Gain(); }
    createOscillator() { return new Osc(); }
    createBufferSource() { return new Src(); }
    createBiquadFilter() { return new Filter(); }
    createBuffer(ch, len) {
      return { getChannelData() { return new Float32Array(len); } };
    }
    resume() { log.resumes++; this.state = 'running'; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
  }
  return { log, Ctx };
}

function bootstrap(opts = {}) {
  const fake = makeFakeAudio();
  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', (e) => { if (!/navigation|Not implemented/.test(e.message)) errors.push(e.message); });
  vc.on('error', (...a) => errors.push(a.join(' ')));
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/index.html', virtualConsole: vc
  });
  const w = dom.window;
  w.AudioContext = fake.Ctx;
  w.__VG = { lang: () => 'ru' };
  if (opts.storage) {
    for (const [k, v] of Object.entries(opts.storage)) w.localStorage.setItem(k, v);
    for (const [k, v] of Object.entries(opts.session || {})) w.sessionStorage.setItem(k, v);
  }
  w.eval(source);
  if (opts.reload) w.eval(source);   // повторное подключение скрипта
  return { w, dom, log: fake.log, errors };
}

const results = [];
function check(name, ok, extra) {
  results.push((ok ? 'PASS' : 'FAIL') + ' · ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : ''));
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  /* ------------------------------------------------ 1. кнопка и разметка */
  const A = bootstrap();
  const btn = () => A.w.document.querySelector('[data-vg-music]');
  check('кнопка музыки создана', !!btn());
  check('по умолчанию музыка включена в интерфейсе', btn().getAttribute('aria-pressed') === 'true',
    btn().getAttribute('aria-pressed'));
  check('на кнопке есть иконка, эквалайзер и состояние',
    !!btn().querySelector('svg') && !!btn().querySelector('.vgm-bars') && /ON/.test(btn().textContent),
    btn().textContent.trim());
  check('петля 8 тактов по 16 шагов, темп 132', A.w.VGMusic.debug().loop === 128 && A.w.VGMusic.debug().tempo === 132,
    A.w.VGMusic.debug());

  /* --------------------------------------------- 2. автоплей без жеста */
  await wait(220);
  check('без действия пользователя звук не стартует (autoplay-политика)',
    A.w.VGMusic.isPlaying() === false, A.w.VGMusic.debug());

  /* --------------------------------------------- 3. после жеста играет */
  A.w.document.dispatchEvent(new A.w.Event('pointerdown'));
  await wait(260);
  check('после первого действия музыка зазвучала', A.w.VGMusic.isPlaying() === true, A.w.VGMusic.debug());
  check('ноты реально планируются в синтезаторе', A.log.started > 4, A.log.started);
  check('бас, мелодия и перкуссия используют разные источники', A.log.osc > 2 && A.log.buffers > 0,
    [A.log.osc, A.log.buffers]);

  /* --------------------------------------------------- 4. выключение */
  btn().dispatchEvent(new A.w.Event('click'));
  const startedBefore = A.log.started;
  check('выключение мгновенное', A.w.VGMusic.isPlaying() === false && btn().getAttribute('aria-pressed') === 'false',
    A.w.VGMusic.debug());
  check('состояние OFF на кнопке', /OFF/.test(btn().textContent), btn().textContent.trim());
  await wait(160);
  check('после выключения новые ноты не планируются', A.log.started === startedBefore,
    [startedBefore, A.log.started]);
  check('преференс сохранён в localStorage', A.w.localStorage.getItem('vg_music') === '0',
    A.w.localStorage.getItem('vg_music'));

  /* ------------------------------------- 5. «перезагрузка» страницы */
  const stored = { vg_music: A.w.localStorage.getItem('vg_music') };
  const B = bootstrap({ storage: stored });
  const btnB = () => B.w.document.querySelector('[data-vg-music]');
  await wait(200);
  check('после refresh музыка не включается сама', B.w.VGMusic.isPlaying() === false);
  check('кнопка после refresh показывает OFF', btnB().getAttribute('aria-pressed') === 'false',
    btnB().getAttribute('aria-pressed'));
  B.w.document.dispatchEvent(new B.w.Event('pointerdown'));
  await wait(200);
  check('жест не включает музыку, которую выключили', B.w.VGMusic.isPlaying() === false && B.log.started === 0,
    B.log.started);

  /* --------------------------------- 6. включение обратно и один плеер */
  btnB().dispatchEvent(new B.w.Event('click'));
  await wait(200);
  check('включение возвращает звук', B.w.VGMusic.isPlaying() === true && B.log.started > 0,
    [B.w.VGMusic.debug(), B.log.started]);
  check('в localStorage снова 1', B.w.localStorage.getItem('vg_music') === '1');
  check('второй экземпляр скрипта не создаёт вторую кнопку',
    B.w.document.querySelectorAll('[data-vg-music]').length === 1,
    B.w.document.querySelectorAll('[data-vg-music]').length);

  /* ------------------------------------------------- 7. приглушение */
  const gainsBefore = B.log.gains.map((g) => g.gain.value);
  B.w.VGMusic.duck(true);
  const ducked = B.log.gains[0].gain.value;
  B.w.VGMusic.duck(false);
  const restored = B.log.gains[0].gain.value;
  check('во время игры громкость приглушается', ducked < restored && ducked > 0, [ducked, restored]);
  check('громкость умеренная', restored <= 0.12 && restored > 0.02, [restored, gainsBefore[0]]);

  /* ------------------------------- 7b. игровой режим: полная остановка */
  const D = bootstrap();
  D.w.document.dispatchEvent(new D.w.Event('pointerdown'));
  await wait(240);
  const stepBeforeGame = D.w.VGMusic.debug().step;
  check('до входа в игру музыка играет', D.w.VGMusic.isPlaying() === true, D.w.VGMusic.debug());
  D.w.VGMusic.setGameMode(true);
  check('вход в игру полностью останавливает музыку', D.w.VGMusic.isPlaying() === false && D.w.VGMusic.inGame() === true,
    D.w.VGMusic.debug());
  const startedInGame = D.log.started;
  await wait(220);
  check('пока открыта игра новые ноты не планируются', D.log.started === startedInGame,
    [startedInGame, D.log.started]);
  check('в игре мастер-гейн равен нулю (тишина, а не «потише»)', D.log.gains[0].gain.value === 0,
    D.log.gains[0].gain.value);
  D.w.VGMusic.setGameMode(false);
  check('выход из игры возвращает музыку', D.w.VGMusic.isPlaying() === true, D.w.VGMusic.debug());
  check('после игры петля продолжается с того же места, а не с нуля',
    Math.abs(D.w.VGMusic.debug().step - stepBeforeGame) <= 2,
    [stepBeforeGame, D.w.VGMusic.debug().step]);
  check('повторный вход/выход не создаёт второй плеер',
    D.w.document.querySelectorAll('[data-vg-music]').length === 1);
  D.w.VGMusic.setGameMode(false);
  check('повторный вызов gameMode(false) безопасен', D.w.VGMusic.isPlaying() === true);

  /* выключенная музыка не включается после выхода из игры */
  const E = bootstrap({ storage: { vg_music: '0' } });
  E.w.VGMusic.setGameMode(true);
  E.w.VGMusic.setGameMode(false);
  check('если музыку выключили вручную, игра её не включает', E.w.VGMusic.isPlaying() === false,
    E.w.VGMusic.debug());
  check('преференс OFF сохраняется после игры', E.w.localStorage.getItem('vg_music') === '0',
    E.w.localStorage.getItem('vg_music'));

  /* ------------------------------------- 8. непрерывность между страницами */
  const phase = B.w.sessionStorage.getItem('vg_music_phase');
  check('позиция петли запоминается для перехода между страницами', !!Number(phase), phase);
  const C = bootstrap({ storage: { vg_music: '1' }, session: { vg_music_phase: phase } });
  C.w.document.dispatchEvent(new C.w.Event('pointerdown'));
  await wait(220);
  check('на новой странице петля продолжается, а не начинается с нуля',
    C.w.VGMusic.debug().step > 0, C.w.VGMusic.debug());

  /* --------------------------------------------- 9. консоль и устойчивость */
  const noAudio = (() => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>',
      { runScripts: 'outside-only', url: 'http://localhost/index.html' });
    const errs = [];
    dom.window.addEventListener('error', (e) => errs.push(e.message));
    dom.window.eval(source);
    dom.window.document.dispatchEvent(new dom.window.Event('pointerdown'));
    dom.window.VGMusic.toggle();
    return { errs, hasButton: !!dom.window.document.querySelector('[data-vg-music]') };
  })();
  check('без Web Audio скрипт не падает и кнопка остаётся', noAudio.hasButton && noAudio.errs.length === 0, noAudio.errs);

  const allErrors = [...A.errors, ...B.errors, ...C.errors, ...D.errors, ...E.errors];
  check('нет ошибок в консоли', allErrors.length === 0, allErrors.slice(0, 3));

  console.log(results.join('\n'));
  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log('\nИТОГО: ' + (results.length - failed.length) + '/' + results.length + ' проверок пройдено');
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
