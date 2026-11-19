#!/usr/bin/env node
/*
 * Автотест управления Sky-Isle Logistics (в задании — «Ska Logistics»).
 *
 * Проверяем не «есть ли обработчик», а что нажатие реально доходит до игры:
 *  - платформа пробрасывает клавиши в iframe синтетическим событием на document
 *    (у него e.target — сам документ, а не элемент), и обработчик не должен на
 *    этом падать;
 *  - обычное нажатие в документе игры тоже ставит клавишу;
 *  - клавиши не «залипают» после keyup;
 *  - изменение размера окна (адресная строка телефона) не сбрасывает ввод;
 *  - джойстик, кнопки высоты и обзор на touch слушают Pointer Events с защитой
 *    от потери указателя.
 *
 *     NODE_PATH=/tmp/dom/node_modules node tools/test_sky_controls.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'games', 'sky-isle.js'), 'utf8');
const built = fs.readFileSync(path.join(root, 'games', 'sky-isle.html'), 'utf8');

const results = [];
function check(name, ok, extra) {
  results.push((ok ? 'PASS' : 'FAIL') + ' · ' + name + (extra === undefined ? '' : ' → ' + JSON.stringify(extra)));
}

/* --- вырезаем настоящий обработчик из игры --------------------------------- */
function extractLine(src, needle) {
  const i = src.indexOf(needle);
  if (i < 0) throw new Error('не найдено: ' + needle);
  const j = src.indexOf('\n', i);
  return src.slice(i, j < 0 ? src.length : j);
}
const keydownLine = extractLine(source, "document.addEventListener('keydown'");
const keyupLine = extractLine(source, "document.addEventListener('keyup'");

const dom = new JSDOM('<!doctype html><html><body><canvas id="flight"></canvas><input id="f"></body></html>',
  { runScripts: 'outside-only', url: 'http://localhost/games/sky-isle.html' });
const w = dom.window;
const doc = w.document;

/* Заглушки того, что обработчик трогает вне ввода. */
const keys = {};
const helpers = {
  keys,
  mode: 'playing',
  $: (id) => doc.getElementById(id),
  closeHelp() {}, pause() {}, start() {}, resetCamera() {}
};
const fn = new Function('keys', 'getMode', '$', 'closeHelp', 'pause', 'start', 'resetCamera',
  `let __mode='playing';
   const modeRef={get v(){return __mode}};
   ${keydownLine.replace('document.addEventListener', 'document.addEventListener')}
   ${keyupLine}
   return { setMode(m){__mode=m}, getMode(){return __mode} };`
);
/* Проще: выполняем строки как есть в контексте окна, подставив имена. */
const sandbox = new Function('window', 'document', 'keys', 'mode', '$', 'closeHelp', 'pause', 'start', 'resetCamera',
  `let mode_ = 'playing';
   const getMode = () => mode_;
   ${keydownLine.replace(/\bmode\b/g, 'getMode()')}
   ${keyupLine}
   return { setMode(m){ mode_ = m; }, keys };`);
const api = sandbox(w, doc, keys, 'playing', helpers.$, helpers.closeHelp, helpers.pause, helpers.start, helpers.resetCamera);

/* 1. Событие, как его присылает платформа: dispatch на document, target=document. */
let crashed = null;
try {
  doc.dispatchEvent(new w.KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true, cancelable: true }));
} catch (e) { crashed = e; }
check('нажатие из платформы не падает', !crashed, crashed && String(crashed));
check('нажатие из платформы доходит до игры', keys.Space === true, { Space: keys.Space });

/* 2. Обычное нажатие с целью-элементом (body) — тоже работает. */
keys.Space = false;
(w.document.body || doc.documentElement).dispatchEvent(
  new w.KeyboardEvent('keydown', { code: 'KeyW', key: 'w', bubbles: true }));
check('обычное нажатие ставит клавишу', keys.KeyW === true, { KeyW: keys.KeyW });

/* 3. keyup снимает клавишу. */
doc.dispatchEvent(new w.KeyboardEvent('keyup', { code: 'KeyW', key: 'w', bubbles: true }));
check('keyup снимает клавишу', keys.KeyW === false, { KeyW: keys.KeyW });

/* 4. Нажатие в поле ввода не считается управлением. */
keys.KeyD = false;
const input = doc.getElementById('f');
input.dispatchEvent(new w.KeyboardEvent('keydown', { code: 'KeyD', key: 'd', bubbles: true }));
check('в поле ввода игра не реагирует', keys.KeyD === false, { KeyD: keys.KeyD });

/* 5. Пауза: в меню клавиши не ставятся. */
api.setMode('paused');
keys.KeyA = false;
doc.dispatchEvent(new w.KeyboardEvent('keydown', { code: 'KeyA', key: 'a', bubbles: true }));
check('в паузе клавиши не ставятся', keys.KeyA === false, { KeyA: keys.KeyA });

/* --- статические проверки настоящего файла -------------------------------- */
check('обработчик проверяет target защищённо',
  /e\.target\.matches\('input/.test(source) === false && /t&&t\.matches&&t\.matches\('input/.test(source));
check('собранная страница содержит ту же защиту',
  built.includes("const t=e.target;if(t&&t.matches&&t.matches('input,textarea,select'))"));
check('resize не сбрасывает ввод', !/addEventListener\('resize',\s*\(\)\s*=>\s*\{engine\.resize\(\);clearInput\(\)\}\)/.test(source));
check('джойстик на Pointer Events с захватом указателя',
  /\$\('stick'\)\.addEventListener\('pointerdown'/.test(source) && /setPointerCapture\(e\.pointerId\)/.test(source));
check('джойстик отпускается на pointerup/cancel/lostpointercapture',
  /for\(const ev of \['pointerup','pointercancel','lostpointercapture'\]\)\$\('stick'\)/.test(source));
check('кнопки высоты держат палец (held) и снимают его',
  /\$\('up'\),\s*\$\('down'\)/.test(source) && /altOwners\.set\(e\.pointerId,btn\)/.test(source));
check('обзор работает по pointerdown/move/up на холсте',
  /canvas\.addEventListener\('pointerdown'/.test(source) && /canvas\.addEventListener\('pointermove'/.test(source));
check('ввод сбрасывается при потере фокуса и уходе вкладки',
  /addEventListener\('blur',\(\)=>\{clearInput\(\)/.test(source) && /visibilitychange/.test(source));
check('поворот экрана пересчитывает сцену',
  /addEventListener\('orientationchange'/.test(source));
check('Escape закрывает справку и ставит паузу', /e\.code==='Escape'/.test(source));
check('R возвращает камеру', /e\.code==='KeyR'/.test(source) && /resetCamera\(\)/.test(source));
check('клавиши высоты: Space/Shift вверх, C/Ctrl вниз',
  /keys\.Space\|\|keys\.ShiftLeft\|\|keys\.ShiftRight/.test(source) && /keys\.KeyC\|\|keys\.ControlLeft/.test(source));

const failed = results.filter((r) => r.startsWith('FAIL'));
results.forEach((r) => console.log(r));
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' проверок пройдено');
if (failed.length) process.exitCode = 1;
