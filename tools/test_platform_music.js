#!/usr/bin/env node
/*
 * Интеграционный тест «платформа + музыка»: загружает настоящий index.html в
 * jsdom, поднимает музыку жестом, открывает игру из каталога через
 * VG.openGame() и проверяет, что фоновая музыка каталога замолкает, а после
 * закрытия игры продолжается с того же места и с прежним преференсом.
 *
 *     NODE_PATH=/tmp/dom/node_modules node tools/test_platform_music.js
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const results = [];
function check(name, ok, extra) {
  results.push((ok ? 'PASS' : 'FAIL') + ' · ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : ''));
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeAudio() {
  const t0 = Date.now();
  const log = { started: 0, gains: [] };
  class Param {
    constructor(v) { this.value = v; }
    setValueAtTime(v) { this.value = v; return this; }
    exponentialRampToValueAtTime(v) { this.value = v; return this; }
    linearRampToValueAtTime(v) { this.value = v; return this; }
    cancelScheduledValues() { return this; }
    setTargetAtTime(v) { this.value = v; return this; }
  }
  class Gain { constructor() { this.gain = new Param(1); log.gains.push(this); } connect() {} disconnect() {} }
  class Osc { constructor() { this.frequency = new Param(440); this.detune = new Param(0); this.type = 'sine'; } connect() {} start() { log.started++; } stop() {} }
  class Src { constructor() { this.buffer = null; } connect() {} start() {} stop() {} }
  class Filter { constructor() { this.type = 'lowpass'; this.frequency = new Param(800); } connect() {} }
  class Ctx {
    constructor() { this.sampleRate = 44100; this.state = 'suspended'; this.destination = {}; }
    get currentTime() { return (Date.now() - t0) / 1000; }
    createGain() { return new Gain(); }
    createOscillator() { return new Osc(); }
    createBufferSource() { return new Src(); }
    createBiquadFilter() { return new Filter(); }
    createBuffer(ch, len) { return { getChannelData() { return new Float32Array(len); } }; }
    resume() { this.state = 'running'; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
  }
  return { log, Ctx };
}

/* Статика по-настоящему по HTTP: platform.js подключает музыку по абсолютному
   пути /assets/vg/js/music.js, поэтому file:// здесь не подходит. */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;

  const vc = new VirtualConsole();
  const errors = [];
  /* jsdom не умеет 2D-контекст: у канваса внутри iframe игры getContext()
     возвращает null, и game-kit падает на первом setTransform. В браузере
     канвас всегда настоящий, а загрузку самих игр проверяет
     tools/test_game_boot.js со своей заглушкой контекста — поэтому эту
     особенность стенда здесь отфильтровываем. */
  const HARNESS_NOISE = /Not implemented|navigation|resource|reading 'setTransform'/i;
  vc.on('jsdomError', (e) => { if (!HARNESS_NOISE.test(e.message)) errors.push(e.message); });
  vc.on('error', (...a) => errors.push(a.join(' ')));

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    url: base + '/index.html',
    virtualConsole: vc,
  });
  const w = dom.window;
  const audio = fakeAudio();
  w.AudioContext = audio.Ctx;
  w.HTMLCanvasElement.prototype.getContext = () => null;
  // Платформа ходит в /api: любой запрос считаем «гостем», чтобы не ждать сеть.
  w.fetch = () => Promise.reject(new Error('offline'));

  await wait(900);

  check('музыка подключена на странице каталога', typeof w.VGMusic === 'object', typeof w.VGMusic);
  check('функция открытия игры доступна', typeof w.VG.openGame === 'function');

  // Пользователь включает звук: жест → музыка играет.
  w.document.dispatchEvent(new w.Event('pointerdown'));
  await wait(260);
  const playingBefore = w.VGMusic.isPlaying();
  const stepBefore = w.VGMusic.debug().step;
  check('в каталоге музыка играет', playingBefore === true, w.VGMusic.debug());

  // Открываем игру из каталога.
  const game = (w.VG.games && w.VG.games[0]) || { id: 'flappy', file: 'games/flappy.html', reward: 2, name: 'Flappy' };
  try { w.VG.openGame(game); } catch (e) { errors.push('openGame: ' + e.message); }
  await wait(220);
  const inGame = w.VGMusic.debug();
  check('вход в игру полностью выключает фоновую музыку', inGame.playing === false && inGame.gameMode === true, inGame);
  const started = audio.log.started;
  await wait(220);
  check('пока игра открыта, новые ноты не планируются', audio.log.started === started, [started, audio.log.started]);
  const overlay = w.document.getElementById('playOverlay');
  check('игра открылась в плеере', !!overlay && overlay.classList.contains('open'));
  check('в iframe загружена именно эта игра', /games\//.test((overlay.querySelector('iframe') || {}).src || ''),
    (overlay.querySelector('iframe') || {}).src);

  // Закрываем игру.
  try { w.VG.closeGame(); } catch (e) { errors.push('closeGame: ' + e.message); }
  /* Шаг читаем сразу после закрытия: дальше музыка честно играет и идёт вперёд. */
  const resumed = w.VGMusic.debug();
  await wait(320);
  const after = w.VGMusic.debug();
  check('после выхода из игры музыка снова играет', after.playing === true && after.gameMode === false, after);
  check('мелодия продолжается, а не начинается с нуля', Math.abs(resumed.step - stepBefore) <= 1, [stepBefore, resumed.step]);
  check('преференс музыки не изменился', w.localStorage.getItem('vg_music') !== '0', w.localStorage.getItem('vg_music'));

  // Явно выключенная музыка не включается ни в игре, ни после неё.
  w.VGMusic.setEnabled(false);
  w.VG.openGame(game);
  await wait(200);
  check('с выключенной музыкой игра тихая', w.VGMusic.isPlaying() === false);
  w.VG.closeGame();
  await wait(250);
  check('после игры выключенная музыка остаётся выключенной', w.VGMusic.isPlaying() === false &&
    w.localStorage.getItem('vg_music') === '0', [w.VGMusic.isPlaying(), w.localStorage.getItem('vg_music')]);

  check('на странице ровно одна кнопка музыки', w.document.querySelectorAll('[data-vg-music]').length === 1,
    w.document.querySelectorAll('[data-vg-music]').length);

  const hard = errors.filter((e) => /TypeError|ReferenceError|Cannot read|is not a function/.test(e));
  check('нет ошибок JS при открытии/закрытии игры', hard.length === 0, hard.slice(0, 3));

  console.log(results.join('\n'));
  const fails = results.filter((r) => r.startsWith('FAIL')).length;
  console.log('\nИТОГО: ' + (results.length - fails) + '/' + results.length + ' проверок пройдено');
  server.close();
  process.exit(fails ? 1 : 0);
})();
