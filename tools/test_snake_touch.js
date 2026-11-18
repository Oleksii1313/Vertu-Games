#!/usr/bin/env node
/* =============================================================================
   Vert Games · Snake: большое поле, свайпы, мышь
   -----------------------------------------------------------------------------
   Игра целиком запускается в jsdom (как tools/test_snake.js), но проверяется
   именно управление и раскладка:

     1. поле — квадрат по меньшей стороне экрана, без потолка 560 px и без
        отступов; буфер холста не меньше CSS-размера (картинка не мыльная);
     2. свайп по площади поля в каждую из четырёх сторон;
     3. короткие и длинные свайпы, порог зависит от размера поля;
     4. команда срабатывает сразу, не дожидаясь отпускания пальца;
     5. одним движением можно сделать несколько поворотов — команды копятся;
     6. разворот на 180° отклоняется, повтор того же направления игнорируется;
     7. мышь: движение над полем поворачивает змейку, мелкое дрожание — нет;
        в режиме «Готов?» мышь забег не запускает;
     8. клавиатура: стрелки и WASD;
     9. стрелки на экране по умолчанию скрыты, включаются кнопкой, не
        перекрывают сетку и запоминаются;
    10. прокрутка страницы во время жеста не запускается;
    11. счёт, рекорд, пауза и перезапуск работают как раньше.

   Запуск:  NODE_PATH=/tmp/dom/node_modules node tools/test_snake_touch.js
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

const HTML = process.env.SNAKE_HTML || path.join(__dirname, '..', 'games', 'snake.html');
const results = [];
function check(name, ok, extra) {
  results.push((ok ? 'PASS' : 'FAIL') + ' · ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : ''));
}

/* ------------------------------------------------------------------ стенд */
function boot(box) {
  const html = fs.readFileSync(HTML, 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'outside-only', pretendToBeVisual: true,
    url: 'http://localhost/games/snake.html'
  });
  const w = dom.window;
  const errors = [];
  w.addEventListener('error', (e) => errors.push(e.message));

  /* Заглушка 2D-контекста. */
  const drawLog = [];
  function fake2d() {
    const grad = { addColorStop() {} };
    const target = {
      createLinearGradient() { return grad; }, createRadialGradient() { return grad; },
      measureText() { return { width: 10 }; },
      getImageData(x, y, w2, h2) { return { data: new Uint8ClampedArray(Math.max(1, w2 * h2 * 4)), width: w2, height: h2 }; }
    };
    return new Proxy(target, {
      get(t, p) {
        if (p in t) return t[p];
        return function () { drawLog.push(p); };
      },
      set(t, p, v) { t[p] = v; return true; }
    });
  }
  w.HTMLCanvasElement.prototype.getContext = function (type) {
    if (type === '2d') return fake2d();
    return null;
  };

  /* Раскладка: jsdom не считает размеры, поэтому поле получает заданный бокс. */
  const size = { w: box.w, h: box.h };
  Object.defineProperty(w.HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() { return this.classList && this.classList.contains('board') ? size.w : 0; }
  });
  Object.defineProperty(w.HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() { return this.classList && this.classList.contains('board') ? size.h : 0; }
  });
  w.Element.prototype.getBoundingClientRect = function () {
    if (this.classList && this.classList.contains('board')) {
      return { width: size.w, height: size.h, top: 0, left: 0, right: size.w, bottom: size.h, x: 0, y: 0 };
    }
    return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0 };
  };
  w.HTMLElement.prototype.setPointerCapture = w.HTMLElement.prototype.setPointerCapture || function () {};
  w.HTMLElement.prototype.releasePointerCapture = w.HTMLElement.prototype.releasePointerCapture || function () {};
  if (!w.ResizeObserver) w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

  /* Управляемые часы: антидребезг жестов зависит от времени. */
  let clock = 1000;
  try { Object.defineProperty(w.performance, 'now', { configurable: true, value: () => clock }); } catch (e) {}

  /* Кадры: как в test_snake — один запланированный колбэк. */
  let rafCb = null, rafTs = 0;
  w.requestAnimationFrame = (cb) => { rafCb = cb; return 1; };
  w.cancelAnimationFrame = () => {};

  const posted = [];
  w.parent = { postMessage(msg) { posted.push(msg); }, window: w };

  const inline = [];
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    if (/\bsrc=/.test(m[1])) continue;                 // внешний game-kit не нужен
    inline.push(m[2]);
  }
  inline.forEach((code) => {
    try { w.eval(code); } catch (e) { errors.push('inline: ' + e.message); }
  });

  function frames(n, dt = 17) {
    for (let i = 0; i < n; i++) {
      rafTs += dt;
      const cb = rafCb;
      if (!cb) break;
      rafCb = null;
      cb(rafTs);
    }
  }
  return { w, doc: w.document, api: () => w.__snake, size, frames, errors, posted, tick: (ms) => { clock += ms; }, drawLog };
}

/* События указателя: jsdom не умеет PointerEvent, поэтому поля задаём руками. */
function pointer(w, el, type, x, y, opts) {
  const o = opts || {};
  const ev = new w.Event(type, { bubbles: true, cancelable: true });
  const props = {
    pointerId: o.id == null ? 1 : o.id,
    pointerType: o.type || 'touch',
    clientX: x, clientY: y,
    button: o.button == null ? 0 : o.button,
    buttons: o.buttons == null ? 1 : o.buttons,
    isPrimary: true
  };
  Object.keys(props).forEach((k) => Object.defineProperty(ev, k, { value: props[k], configurable: true }));
  el.dispatchEvent(ev);
  return ev;
}
/* Свайп: касание, движение к точке, отпускание. */
function swipe(w, el, dx, dy, opts) {
  const o = opts || {};
  const x = 100, y = 100;
  pointer(w, el, 'pointerdown', x, y, o);
  if (o.move !== false) pointer(w, el, 'pointermove', x + dx, y + dy, o);
  pointer(w, el, 'pointerup', x + dx, y + dy, o);
}

/* ------------------------------------------------ 1. поле и раскладка */
const phone = boot({ w: 390, h: 844 });
const P = phone;
const field = P.doc.querySelector('.board');
const canvas = P.doc.getElementById('c');

check('игра запускается без ошибок', P.errors.length === 0, P.errors.slice(0, 3));
check('на телефоне поле 390 px — вся ширина экрана',
  parseFloat(canvas.style.width) === 390 && parseFloat(canvas.style.height) === 390,
  [canvas.style.width, canvas.style.height]);
check('поле остаётся квадратным (пропорции не сломаны)',
  parseFloat(canvas.style.width) === parseFloat(canvas.style.height));
check('буфер холста не меньше CSS-размера (картинка не мыльная)',
  canvas.width >= parseFloat(canvas.style.width), [canvas.width, canvas.style.width]);
check('буфер не раздут: кратность масштабу в пределах 3×',
  canvas.width <= parseFloat(canvas.style.width) * 3 + 1, canvas.width);

const desktop = boot({ w: 1440, h: 900 });
const dCanvas = desktop.doc.getElementById('c');
check('на компьютере поле больше прежнего потолка 560 px',
  parseFloat(dCanvas.style.width) === 900, dCanvas.style.width);
const shortPhone = boot({ w: 320, h: 480 });
check('на маленьком телефоне поле занимает всю ширину',
  parseFloat(shortPhone.doc.getElementById('c').style.width) === 320,
  shortPhone.doc.getElementById('c').style.width);
const landscape = boot({ w: 844, h: 390 });
check('в ландшафте поле во всю высоту экрана',
  parseFloat(landscape.doc.getElementById('c').style.width) === 390,
  landscape.doc.getElementById('c').style.width);
check('страница не прокручивается: поле с touch-action:none',
  /#snakeBody \.board\{[^}]*touch-action:none/.test(fs.readFileSync(HTML, 'utf8')));

/* ----------------------------------------------------- 2. свайпы */
const A = boot({ w: 390, h: 844 });
const api = A.api;
api().turn(1, 0);                       // старт: движение вправо
check('забег начался', api().state() === 'playing', api().state());

const aField = A.doc.querySelector('.board');
swipe(A.w, aField, 0, -60);              // ход был вправо → вверх законно
api().step();
check('свайп вверх поворачивает змейку',
  api().dir().dir.y === -1 && api().dir().dir.x === 0, api().dir().dir);

A.tick(100);
swipe(A.w, aField, 40, 0);
api().step();
check('свайп вправо поворачивает змейку',
  api().dir().dir.x === 1 && api().dir().dir.y === 0, api().dir().dir);

A.tick(100);
swipe(A.w, aField, 0, 60);
api().step();
check('свайп вниз поворачивает змейку',
  api().dir().dir.y === 1 && api().dir().dir.x === 0, api().dir().dir);

A.tick(100);
swipe(A.w, aField, -60, 0);
api().step();
check('свайп влево поворачивает змейку',
  api().dir().dir.x === -1 && api().dir().dir.y === 0, api().dir().dir);

/* короткий свайп: порог считается от поля (5 % от 390 ≈ 20 px) */
A.tick(100);
const threshold = api().layout().threshold;
check('порог свайпа короткий (не больше 26 px)', threshold <= 26, threshold);
const beforeShort = api().dir().dir;
swipe(A.w, aField, 0, -(threshold + 2));
api().step();
check('короткий свайп тоже распознан', api().dir().dir.y === -1 && beforeShort.y !== -1,
  [beforeShort, api().dir().dir]);

/* слишком мелкое движение — не команда */
const tinyState = api().dir();
swipe(A.w, aField, 0, threshold - 6);
check('движение меньше порога игнорируется',
  api().dir().queue.length === tinyState.queue.length, [tinyState.queue.length, api().dir().queue.length]);

/* команда срабатывает до отпускания пальца */
A.tick(100);
const fresh = boot({ w: 390, h: 844 });
const fApi = fresh.api;
fApi().turn(1, 0);
fresh.tick(100);
pointer(fresh.w, fresh.doc.querySelector('.board'), 'pointerdown', 100, 100);
pointer(fresh.w, fresh.doc.querySelector('.board'), 'pointermove', 100, 20);
check('поворот срабатывает сразу, не дожидаясь отпускания',
  fApi().dir().dir.y === -1 || fApi().dir().queue.length > 0,
  [fApi().dir().dir, fApi().dir().queue]);
pointer(fresh.w, fresh.doc.querySelector('.board'), 'pointerup', 100, 20);

/* ---------------------------------------- 3. быстрые повороты подряд */
const Q = boot({ w: 390, h: 844 });
const qApi = Q.api;
qApi().turn(1, 0);                       // вправо
Q.tick(100);
const qField = Q.doc.querySelector('.board');
pointer(Q.w, qField, 'pointerdown', 100, 200);
pointer(Q.w, qField, 'pointermove', 100, 130);      // вверх
Q.tick(60);
pointer(Q.w, qField, 'pointermove', 170, 130);      // затем вправо
Q.tick(60);
pointer(Q.w, qField, 'pointermove', 170, 200);      // затем вниз
pointer(Q.w, qField, 'pointerup', 170, 200);
const queued = qApi().dir().queue;
check('одним движением можно задать несколько поворотов', queued.length >= 2, queued);
check('команды идут по порядку: верх, вправо, вниз',
  queued.every((d, i) => (i === 0 ? d.y === -1 : true)) && queued[queued.length - 1].y === 1,
  queued);
qApi().step();
check('первая команда применена к первому тику', qApi().dir().dir.y === -1, qApi().dir().dir);
qApi().step();
check('вторая команда не потерялась', qApi().dir().dir.x === 1, qApi().dir().dir);

/* разворот на 180° и повтор не принимаются */
const R = boot({ w: 390, h: 844 });
const rApi = R.api;
rApi().turn(1, 0);                       // вправо
R.tick(100);
swipe(R.w, R.doc.querySelector('.board'), -80, 0);
check('разворот на 180° свайпом отклонён', rApi().dir().queue.length === 0, rApi().dir().queue);
swipe(R.w, R.doc.querySelector('.board'), 80, 0);
check('повтор текущего направления не копится в очереди', rApi().dir().queue.length === 0, rApi().dir().queue);

/* --------------------------------------------------------- 4. мышь */
const M = boot({ w: 1440, h: 900 });
const mApi = M.api;
const mField = M.doc.querySelector('.board');
pointer(M.w, mField, 'pointermove', 700, 400, { type: 'mouse', id: 9, buttons: 0 });
check('в режиме «Готов?» мышь не запускает забег', mApi().state() === 'ready', mApi().state());
mApi().turn(1, 0);
M.tick(200);
pointer(M.w, mField, 'pointermove', 700, 400, { type: 'mouse', id: 9, buttons: 0 });
pointer(M.w, mField, 'pointermove', 704, 404, { type: 'mouse', id: 9, buttons: 0 });
check('мелкое дрожание мыши не поворачивает', mApi().dir().queue.length === 0, mApi().dir().queue);
pointer(M.w, mField, 'pointermove', 700, 340, { type: 'mouse', id: 9, buttons: 0 });
M.tick(200);
check('движение мыши вверх поворачивает змейку',
  mApi().dir().dir.y === -1 || mApi().dir().queue.some((d) => d.y === -1),
  [mApi().dir().dir, mApi().dir().queue]);
mApi().step();
M.tick(200);
pointer(M.w, mField, 'pointermove', 760, 340, { type: 'mouse', id: 9, buttons: 0 });
mApi().step();
check('движение мыши вправо поворачивает змейку',
  mApi().dir().dir.x === 1 || mApi().dir().queue.some((d) => d.x === 1),
  [mApi().dir().dir, mApi().dir().queue]);

/* мышь с зажатой кнопкой (перетаскивание) тоже задаёт направление */
const MD = boot({ w: 1440, h: 900 });
const mdApi = MD.api;
const mdField = MD.doc.querySelector('.board');
mdApi().turn(1, 0);
MD.tick(200);
pointer(MD.w, mdField, 'pointerdown', 700, 420, { type: 'mouse', id: 3, buttons: 1 });
pointer(MD.w, mdField, 'pointermove', 700, 340, { type: 'mouse', id: 3, buttons: 1 });
pointer(MD.w, mdField, 'pointerup', 700, 340, { type: 'mouse', id: 3, buttons: 0 });
mdApi().step();
check('перетаскивание мышью поворачивает змейку', mdApi().dir().dir.y === -1, mdApi().dir().dir);

/* -------------------------------------------- 5. клавиатура */
const K = boot({ w: 1440, h: 900 });
const kApi = K.api;
function key(w, k) {
  const ev = new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  w.dispatchEvent(ev);
}
key(K.w, 'ArrowUp');
check('стрелка вверх запускает забег', kApi().state() === 'playing', kApi().state());
kApi().step();
check('стрелка вверх задаёт направление', kApi().dir().dir.y === -1, kApi().dir().dir);
K.tick(100);
key(K.w, 'd');
kApi().step();
check('клавиша D поворачивает вправо', kApi().dir().dir.x === 1, kApi().dir().dir);
K.tick(100);
key(K.w, 's');
kApi().step();
check('клавиша S поворачивает вниз', kApi().dir().dir.y === 1, kApi().dir().dir);
K.tick(100);
key(K.w, 'a');
kApi().step();
check('клавиша A поворачивает влево', kApi().dir().dir.x === -1, kApi().dir().dir);
key(K.w, ' ');
check('пробел ставит паузу', kApi().state() === 'paused', kApi().state());
key(K.w, ' ');
check('пробел снимает паузу', kApi().state() === 'playing', kApi().state());

/* ------------------------------------------- 6. стрелки на экране */
const D = boot({ w: 390, h: 844 });
const dock = D.doc.getElementById('padDock');
check('панель стрелок по умолчанию скрыта', dock.hidden === true && D.api().pad() === false);
check('стрелки не перекрывают сетку: панель вне .board',
  !!dock && !D.doc.querySelector('.board #padDock') && !dock.closest('.board'),
  !!dock.closest('.board'));
check('свайпы работают и без стрелок', (() => {
  D.api().turn(1, 0);
  D.tick(100);
  swipe(D.w, D.doc.querySelector('.board'), 0, -50);
  D.api().step();
  return D.api().dir().dir.y === -1;
})(), D.api().dir().dir);

D.doc.getElementById('padToggle').dispatchEvent(new D.w.MouseEvent('click', { bubbles: true }));
check('кнопка включает панель стрелок', D.api().pad() === true && dock.hidden === false);
check('выбор панели запоминается', D.w.localStorage.getItem('vg_snake_pad') === '1',
  D.w.localStorage.getItem('vg_snake_pad'));
check('панель не отнимает нажатия у поля: кнопки внутри неё',
  !!dock.querySelector('#btnUp') && !!dock.querySelector('#btnDown'));
D.doc.getElementById('padToggle').dispatchEvent(new D.w.MouseEvent('click', { bubbles: true }));
check('кнопка снова скрывает панель', D.api().pad() === false && dock.hidden === true);
/* Многократное переключение: обработчик навешен один раз, двойных нажатий нет. */
for (let i = 0; i < 4; i++) {
  D.doc.getElementById('padToggle').dispatchEvent(new D.w.MouseEvent('click', { bubbles: true }));
  D.doc.getElementById('padToggle').dispatchEvent(new D.w.MouseEvent('click', { bubbles: true }));
}
check('десять переключений подряд не дублируют обработчик', D.api().pad() === false, D.api().pad());

/* Свайп по панели стрелок не должен считаться жестом по полю. */
const N = boot({ w: 390, h: 844 });
N.api().turn(1, 0);
N.tick(100);
N.api().pad(true);
const dockEl = N.doc.getElementById('padDock');
swipe(N.w, dockEl, 0, -70);
check('панель стрелок не перехватывает свайпы поля', N.api().dir().queue.length === 0, N.api().dir().queue);

const again = boot({ w: 390, h: 844 });
check('после перезапуска панель остаётся скрытой по умолчанию', again.api().pad() === false);

/* стрелка на панели работает как кнопка */
const B = boot({ w: 390, h: 844 });
B.api().turn(1, 0);
B.tick(100);
B.api().pad(true);
const upBtn = B.doc.getElementById('btnUp');
pointer(B.w, upBtn, 'pointerdown', 10, 10);
B.api().step();
check('кнопка панели поворачивает змейку', B.api().dir().dir.y === -1, B.api().dir().dir);

/* --------------------------------- 7. прокрутка и двойная обработка */
const S = boot({ w: 390, h: 844 });
S.api().turn(1, 0);
S.tick(100);
const sField = S.doc.querySelector('.board');
const before = S.api().dir().queue.length;
pointer(S.w, sField, 'pointerdown', 100, 200, { id: 5 });
const tm = new S.w.Event('touchmove', { bubbles: true, cancelable: true });
sField.dispatchEvent(tm);
check('во время жеста прокрутка страницы отменяется', tm.defaultPrevented === true);
pointer(S.w, sField, 'pointermove', 100, 140, { id: 5 });
const afterFirst = S.api().dir().queue.length;
pointer(S.w, sField, 'pointermove', 160, 140, { id: 7 });   // второе касание
check('второе касание не добавляет команду',
  S.api().dir().queue.length === afterFirst, [before, afterFirst, S.api().dir().queue.length]);
pointer(S.w, sField, 'pointerup', 160, 140, { id: 7 });
check('жест одного касания не дублируется после отпускания второго',
  S.api().dir().queue.length === afterFirst, S.api().dir().queue.length);

/* ---------------------------------- 8. счёт, рекорд, пауза, перезапуск */
const W = boot({ w: 390, h: 844 });
const wApi = W.api;
wApi().turn(1, 0);
const head = wApi().board().snake[0];
wApi().placeAppleAt((head.x + 1) % 20, head.y);
wApi().step();
check('очки начисляются как раньше', wApi().board().score >= 1, wApi().board().score);
check('рекорд догоняет счёт', wApi().best() === wApi().board().score, [wApi().best(), wApi().board().score]);
check('рекорд показан в HUD', W.doc.getElementById('bestVal').textContent === String(wApi().best()),
  W.doc.getElementById('bestVal').textContent);
check('рекорд сохранён на устройстве', Number(W.w.localStorage.getItem('vg_snake_best')) === wApi().best(),
  W.w.localStorage.getItem('vg_snake_best'));
pointer(W.w, W.doc.getElementById('btnPause'), 'pointerdown', 5, 5);
check('кнопка паузы ставит игру на паузу', wApi().state() === 'paused', wApi().state());
W.doc.getElementById('ovBtn').dispatchEvent(new W.w.MouseEvent('click', { bubbles: true }));
check('кнопка в окне паузы продолжает игру', wApi().state() === 'playing', wApi().state());
wApi().finish('self');
check('итоги показываются как раньше', W.doc.getElementById('overlay').classList.contains('show'));
W.doc.getElementById('ovBtn').dispatchEvent(new W.w.MouseEvent('click', { bubbles: true }));
check('перезапуск начинает новый забег', wApi().state() === 'playing' && wApi().board().score === 0,
  [wApi().state(), wApi().board().score]);
check('рекорд после перезапуска не сбросился', wApi().best() > 0, wApi().best());

/* ----------------------------------------------------------- итог */
results.forEach((line) => console.log(line));
const failed = results.filter((line) => line.startsWith('FAIL')).length;
console.log('\nИТОГО: ' + (results.length - failed) + '/' + results.length + ' проверок пройдено');
process.exit(failed ? 1 : 0);
