#!/usr/bin/env node
/*
 * Проверка мобильного управления 2048 без настоящего браузера: DOM-кнопки,
 * свайпы по полю, стрелки клавиатуры и кнопка «Новая игра».
 * Игра запускается целиком в jsdom с заглушкой 2D-контекста.
 *
 *     NODE_PATH=/tmp/dom/node_modules node tools/test_game2048_mobile.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const HTML = process.env.G2048_HTML || path.join(__dirname, '..', 'games', 'game2048.html');
const html = fs.readFileSync(HTML, 'utf8');

const vc = new VirtualConsole();
const errors = [];
vc.on('jsdomError', (e) => { if (!/navigation|Not implemented|resource/i.test(e.message)) errors.push(e.message); });
vc.on('error', (...a) => errors.push(a.join(' ')));

/* Заглушка 2D-контекста: игра рисует поле, но пиксели нам не нужны.
   Ставим её в beforeParse — игра берёт контекст canvas сразу при загрузке,
   и подмена после создания окна уже не успевает (resize() падал на null). */
const grad = { addColorStop() {} };
let ctxStub;
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'http://localhost/games/game2048.html',
  virtualConsole: vc,
  beforeParse(window) {
    ctxStub = new Proxy({
      createLinearGradient: () => grad, createRadialGradient: () => grad,
      measureText: () => ({ width: 10 }), getImageData: (x, y, a, b) => ({ data: new Uint8ClampedArray(a * b * 4) }),
      putImageData() {}, createImageData: (a, b) => ({ data: new Uint8ClampedArray(a * b * 4) }),
      setTransform() {}
    }, { get(t, p) { return p in t ? t[p] : function () {}; }, set(t, p, v) { t[p] = v; return true; } });
    window.HTMLCanvasElement.prototype.getContext = function () { ctxStub.canvas = this; return ctxStub; };
    window.HTMLElement.prototype.setPointerCapture = window.HTMLElement.prototype.setPointerCapture || function () {};
    window.HTMLElement.prototype.releasePointerCapture = window.HTMLElement.prototype.releasePointerCapture || function () {};
    if (!window.ResizeObserver) window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true });
    Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
  }
});
const w = dom.window;

const results = [];
function check(name, ok, extra) {
  results.push((ok ? 'PASS' : 'FAIL') + ' · ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : ''));
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function pointer(el, type, x, y, id) {
  const ev = new w.Event(type, { bubbles: true });
  Object.defineProperty(ev, 'pointerId', { value: id == null ? 1 : id });
  Object.defineProperty(ev, 'clientX', { value: x });
  Object.defineProperty(ev, 'clientY', { value: y });
  Object.defineProperty(ev, 'button', { value: 0 });
  el.dispatchEvent(ev);
}
function swipe(el, dx, dy, id) {
  const idv = id == null ? 5 : id;
  pointer(el, 'pointerdown', 200, 300, idv);
  pointer(el, 'pointermove', 200 + dx / 2, 300 + dy / 2, idv);
  pointer(el, 'pointerup', 200 + dx, 300 + dy, idv);
}
function key(name) {
  const ev = new w.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
  w.dispatchEvent(ev);
}
const board = () => w.eval('board');

(async () => {
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  await wait(120);

  /* ------------------------------------------------ кнопки управления */
  const controls = w.document.querySelector('.controls');
  const buttons = controls ? [...controls.querySelectorAll('button')] : [];
  check('док управления на месте', !!controls);
  check('в доке ровно одна кнопка', buttons.length === 1, buttons.map((b) => b.id));
  check('осталась кнопка «Новая игра»', buttons.length === 1 && buttons[0].id === 'btnReset', buttons.map((b) => b.id));
  check('кнопок-направлений больше нет',
    !['btnUp', 'btnDown', 'btnLeft', 'btnRight'].some((id) => w.document.getElementById(id)),
    ['btnUp', 'btnDown', 'btnLeft', 'btnRight'].map((id) => !!w.document.getElementById(id)));

  /* ------------------------------------------------ свайпы */
  const field = w.document.getElementById('c');
  check('поле найдено', !!field);
  const score0 = w.eval('score');
  let moved = 0;
  for (const [dx, dy, dir] of [[120, 0, 'right'], [-120, 0, 'left'], [0, 120, 'down'], [0, -120, 'up']]) {
    const before = JSON.stringify(board());
    swipe(field, dx, dy, 10 + moved);
    await wait(40);
    const after = JSON.stringify(board());
    const changed = before !== after;
    if (changed) moved++;
    check('свайп ' + dir + ' двигает плитки', changed);
  }
  check('все четыре свайпа сработали', moved === 4, moved);

  /* Маленькое движение — не свайп. */
  const beforeTiny = JSON.stringify(board());
  swipe(field, 12, 6, 77);
  await wait(30);
  check('короткое движение (12 px) не двигает плитки', JSON.stringify(board()) === beforeTiny);

  /* ------------------------------------------------ клавиатура (десктоп) */
  let keyboard = 0;
  for (const k of ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown']) {
    const before = JSON.stringify(board());
    key(k);
    await wait(40);
    if (JSON.stringify(board()) !== before) keyboard++;
  }
  check('стрелки клавиатуры двигают плитки', keyboard >= 2, keyboard);

  /* ------------------------------------------------ счёт и правила не тронуты */
  check('счёт считается числом', typeof w.eval('score') === 'number', w.eval('score'));
  check('плитки остаются степенями двойки',
    board().flat().every((v) => v === 0 || (v & (v - 1)) === 0),
    board().flat());
  const filled = board().flat().filter(Boolean).length;
  check('новые плитки появляются после ходов', filled >= 2, filled);

  /* ------------------------------------------------ сброс поля */
  const beforeReset = JSON.stringify(board());
  buttons[0].dispatchEvent(new w.MouseEvent('pointerdown', { button: 0, bubbles: true }));
  buttons[0].dispatchEvent(new w.MouseEvent('pointerup', { button: 0, bubbles: true }));
  buttons[0].click();
  await wait(60);
  const afterReset = board().flat().filter(Boolean).length;
  check('кнопка «Новая игра» перезапускает поле', afterReset === 2, afterReset);
  check('после сброса счёт обнулён', w.eval('score') === 0, w.eval('score'));

  console.log(results.filter((r) => r.startsWith('FAIL')).join('\n'));
  console.log('ИТОГО: ' + results.filter((r) => r.startsWith('PASS')).length + '/' + results.length + ' проверок пройдено');
  if (errors.length) console.log('ошибки консоли: ' + errors.slice(0, 4).join(' | '));
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
