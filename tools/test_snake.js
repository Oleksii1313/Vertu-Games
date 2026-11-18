#!/usr/bin/env node
/*
 * Автотест Snake без браузера.
 *
 * Игра запускается целиком в jsdom, 2D-контекст подменяется заглушкой, поэтому
 * проверяется реальный рантайм: плавное движение по тикам, запрет разворота на
 * 180°, рост от яблока, отдельный учёт обычных и золотых яблок, уровни, смерть,
 * экран итогов и обмен с платформой (snakeSession → snakeSessionResult).
 * Наградные числа берутся из ответа сервера, а не из клиента.
 *
 * Запуск (jsdom — единственная зависимость, ставится локально):
 *
 *     npm install jsdom
 *     node tools/test_snake.js
 *
 * Переменная SNAKE_HTML позволяет указать другой файл игры.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const HTML = process.env.SNAKE_HTML || path.join(__dirname, '..', 'games', 'snake.html');
const html = fs.readFileSync(HTML, 'utf8');

const vc = new VirtualConsole();
const consoleErrors = [];
vc.on('jsdomError', (e) => { if (!/navigation|Not implemented/.test(e.message)) consoleErrors.push('[jsdom] ' + e.message); });
vc.on('error', (...a) => consoleErrors.push('[error] ' + a.join(' ')));

const dom = new JSDOM(html, {
  runScripts: 'outside-only', pretendToBeVisual: true,
  url: 'http://localhost/games/snake.html', virtualConsole: vc
});
const w = dom.window;

/* Заглушка 2D-контекста: запоминает вызовы, чтобы можно было поймать NaN в
   координатах и убедиться, что змейка, яблоки и текст действительно рисуются. */
const drawLog = [];
function fake2d() {
  const grad = { addColorStop() {} };
  const target = {
    createLinearGradient() { drawLog.push({ n: 'createLinearGradient', a: [].slice.call(arguments), style: 'grad' }); return grad; },
    createRadialGradient() { drawLog.push({ n: 'createRadialGradient', a: [].slice.call(arguments), style: 'grad' }); return grad; },
    createPattern() { return null; }, measureText() { return { width: 10 }; },
    getImageData(x, y, w2, h2) { return { data: new Uint8ClampedArray(w2 * h2 * 4), width: w2, height: h2 }; }
  };
  return new Proxy(target, {
    get(t, p) {
      if (p in t) return t[p];
      if (p === 'canvas') return t.canvas;
      return function () {
        drawLog.push({ n: p, a: Array.prototype.slice.call(arguments), style: t.fillStyle });
        return undefined;
      };
    },
    set(t, p, v) { t[p] = v; return true; }
  });
}
w.HTMLCanvasElement.prototype.getContext = function (type) {
  if (type === '2d') { const c = fake2d(); c.canvas = this; return c; }
  return null;
};
Object.defineProperty(w, 'innerWidth', { value: 900, configurable: true });
Object.defineProperty(w, 'innerHeight', { value: 900, configurable: true });
Object.defineProperty(w, 'devicePixelRatio', { value: 1, configurable: true });
w.matchMedia = w.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));

const posted = [];
w.parent = { postMessage(msg) { posted.push(msg); }, window: w };

let rafCb = null, rafTs = 0;
w.requestAnimationFrame = (cb) => { rafCb = cb; return 1; };
w.cancelAnimationFrame = () => {};
function frames(n, dtMs = 17) {
  for (let i = 0; i < n; i++) {
    rafTs += dtMs;
    const cb = rafCb;
    if (!cb) break;
    rafCb = null;
    cb(rafTs);
  }
}

/* Инлайновые скрипты выполняем в порядке документа (внешний game-kit не нужен). */
const inline = [];
const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
let m;
while ((m = re.exec(html))) {
  if (/\bsrc=/.test(m[1])) continue;
  inline.push(m[2]);
}
inline.forEach((code) => w.eval(code));

const $ = (id) => w.document.getElementById(id);
const api = () => w.__snake;
const results = [];
function check(name, ok, extra) {
  results.push((ok ? 'PASS' : 'FAIL') + ' · ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : ''));
}
function say(data) {
  w.dispatchEvent(new w.MessageEvent('message', { data, origin: 'http://localhost' }));
}
function lastSession() {
  const list = posted.filter((msg) => msg && msg.type === 'snakeSession');
  return list[list.length - 1];
}

/* ---------------- 1. стартовое состояние ---------------- */
check('игра стартует в ready', api().state() === 'ready', api().state());
check('оверлей приглашения виден', $('overlay').classList.contains('show'));
check('строки итогов скрыты до забега', $('fRows').hidden === true);
check('HUD обнулён', $('scoreVal').textContent === '0' && $('appleVal').textContent === '0'
  && $('goldVal').textContent === '0' && $('coinsVal').textContent === '0 V',
  [$('scoreVal').textContent, $('appleVal').textContent, $('goldVal').textContent, $('coinsVal').textContent]);
const board0 = api().board();
check('змея из 3 сегментов в центре', board0.snake.length === 3 && board0.snake[0].x === 10 && board0.snake[0].y === 10,
  board0.snake);
check('на поле одно яблоко', board0.items.filter(i => i.type === 'apple').length === 1, board0.items);
check('арена 0 без препятствий', board0.obstacles.length === 0, board0.obstacles.length);

/* ---------------- 2. старт и движение ---------------- */
api().turn(1, 0);                      // вправо: старт
check('первый ввод запускает забег', api().state() === 'playing', api().state());
check('оверлей скрылся', !$('overlay').classList.contains('show'));
frames(20);                            // ~340 мс: несколько тиков
const board1 = api().board();
check('змея уехала вправо', board1.snake[0].x > 10 && board1.snake[0].y === 10, board1.snake[0]);

api().turn(0, -1);
api().step();
const board2 = api().board();
check('поворот вверх применён', board2.snake[0].y === board1.snake[0].y - 1 || board2.snake[0].y === 19,
  [board1.snake[0], board2.snake[0]]);
api().turn(0, 1);                      // разворот на 180° — запрещён
api().step();
const board3 = api().board();
check('разворот на 180° отклонён', board3.snake[0].x === board2.snake[0].x && board3.snake[0].y === board2.snake[0].y - 1,
  [board2.snake[0], board3.snake[0]]);

/* ---------------- 3. обычное яблоко ---------------- */
api().ready();                          // чистый забег
api().turn(1, 0);
let b = api().board();
const head = b.snake[0];
api().placeAppleAt((head.x + 1) % 20, head.y);
api().step();
b = api().board();
check('яблоко съедено (учёт обычных)', b.apples === 1 && b.gold === 0, [b.apples, b.gold]);
check('змея выросла на 1', b.snake.length === 4, b.snake.length);
check('очки начислены', b.score >= 1, b.score);
check('HUD: яблоко 1 и 1 V', $('appleVal').textContent === '1' && $('coinsVal').textContent === '1 V',
  [$('appleVal').textContent, $('coinsVal').textContent]);
check('на поле снова есть яблоко', api().board().items.filter(i => i.type === 'apple').length === 1);

/* ---------------- 4. золотое яблоко ---------------- */
b = api().board();
const h2 = b.snake[0];
api().spawn('gold');
let goldItem = api().board().items.filter(i => i.type === 'gold')[0];
const goldCells = api().board();
// кладём золотое яблоко прямо перед головой (убираем прежнее)
goldItem.x = (h2.x + 1) % 20; goldItem.y = h2.y;
api().placeAppleAt((h2.x + 5) % 20, (h2.y + 5) % 20);   // обычное — подальше
api().step();
b = api().board();
check('золотое яблоко учтено отдельно', b.gold === 1 && b.apples === 1, [b.apples, b.gold]);
check('10 V за золотое яблоко', b.earned === 1 * 1 + 0 + 1 * 10, b.earned);
check('HUD: золотых 1 и 11 V', $('goldVal').textContent === '1' && $('coinsVal').textContent === '11 V',
  [$('goldVal').textContent, $('coinsVal').textContent]);
check('золотое яблоко дало +2 сегмента', b.snake.length === 6, b.snake.length);

/* ---------------- 5. изумруд (множитель) ---------------- */
b = api().board();
const h3 = b.snake[0];
api().spawn('gem');
const gem = api().board().items.filter(i => i.type === 'gem')[0];
gem.x = (h3.x + 1) % 20; gem.y = h3.y;
api().step();
check('изумруд собран и убран с поля', api().board().items.every(i => i.type !== 'gem'));
check('забег продолжается после изумруда', api().state() === 'playing', api().state());

/* ---------------- 6. уровни и скорость ---------------- */
api().ready();
api().turn(1, 0);
api().setApples(4, 0);
b = api().board();
const speedBefore = b.speed;
api().placeAppleAt((b.snake[0].x + 1) % 20, b.snake[0].y);
api().step();
b = api().board();
check('5-е яблоко дало уровень 2', b.level === 2, b.level);
check('скорость выросла (интервал тика меньше)', b.speed < speedBefore, [speedBefore, b.speed]);
check('бонус за уровень в ожидаемых V', b.earned === 5 * 1 + 1 * 5, b.earned);

/* ---------------- 7. арены с препятствиями ---------------- */
api().setApples(14, 0);
b = api().board();
api().placeAppleAt((b.snake[0].x + 1) % 20, b.snake[0].y);
api().step();
check('на 3-м уровне появляются препятствия', api().board().obstacles.length >= 8, api().board().obstacles.length);
check('препятствия не накрыли змейку',
  api().board().snake.every(s => !api().board().obstacles.includes(s.x + ':' + s.y)));
check('еда не лежит на препятствии',
  api().board().items.every(it => !api().board().obstacles.includes(it.x + ':' + it.y)));
const headNow = api().board().snake[0];
const nearHead = api().board().obstacles.filter((k) => {
  const parts = k.split(':').map(Number);
  return Math.abs(parts[0] - headNow.x) <= 2 && Math.abs(parts[1] - headNow.y) <= 2;
});
check('вокруг головы запас без блоков', nearHead.length === 0, nearHead);

/* ---------------- 8. смерть и экран итогов ---------------- */
api().ready();
api().turn(1, 0);
api().setApples(6, 1);
frames(3);
api().finish('obstacle');
b = api().board();
check('забег окончен', api().state() === 'over', api().state());
check('оверлей итогов показан', $('overlay').classList.contains('show'));
check('строки итогов раскрыты', $('fRows').hidden === false);
check('очки в итогах', $('fScore').textContent === String(b.score), [$('fScore').textContent, b.score]);
check('обычные яблоки в итогах', $('fApples').textContent === '6', $('fApples').textContent);
check('золотые яблоки в итогах', $('fGold').textContent === '1', $('fGold').textContent);
check('исход: препятствие', /препятствие/.test($('fOutcome').textContent), $('fOutcome').textContent);
/* 6 обычных: 6 × 1 V + бонус за 5 яблок 5 V; 1 золотое: 10 V → 21 V. */
check('ожидаемые V до ответа сервера', $('fV').textContent === '21 V', $('fV').textContent);
check('строка ожидания начисления', /Начисляем 21 V/.test($('fClaim').textContent), $('fClaim').textContent);
check('лимит до ответа не выдуман', $('fLeft').textContent === '—', $('fLeft').textContent);

const claim = lastSession();
check('запрос выплаты отправлен', !!claim && claim.type === 'snakeSession' && claim.game === 'snake', claim);
check('в запросе отдельно обычные и золотые', claim.apples === 6 && claim.gold === 1, [claim.apples, claim.gold]);
check('в запросе есть sessionId', /^sn-[a-z0-9]+-[a-z0-9]+$/.test(claim.sessionId), claim.sessionId);
check('клиент не присылает сумму V', claim.v === undefined && claim.awarded === undefined && claim.coins === undefined,
  Object.keys(claim));
const sentCount = posted.length;

/* ---------------- 9. ответ сервера задаёт цифры ---------------- */
say({ type: 'snakeSessionResult', game: 'snake', awarded: 26, apples: 6, gold: 1, dailyLeft: 274, clamped: false });
check('итог V взят из ответа сервера', $('fV').textContent === '26 V', $('fV').textContent);
check('крупная сумма тоже из ответа', $('fEarn').textContent === '+26 V', $('fEarn').textContent);
check('остаток дневного лимита показан', $('fLeft').textContent === '274 V', $('fLeft').textContent);
check('текст начисления с серверной суммой', /26 V/.test($('fClaim').textContent) && /зачислено/.test($('fClaim').textContent),
  $('fClaim').textContent);
check('ответ сервера не породил второй запрос', posted.length === sentCount, posted.length);

/* ---------------- 10. обрезка и суточный лимит ---------------- */
say({ type: 'snakeSessionResult', game: 'snake', awarded: 12, apples: 4, gold: 0, dailyLeft: 0, clamped: true, capped: true });
check('при обрезке показаны учтённые яблоки', /учтено 4 обычных и 0 золотых/.test($('fClaim').textContent), $('fClaim').textContent);
check('в итогах серверные числа яблок', $('fApples').textContent === '4' && $('fGold').textContent === '0',
  [$('fApples').textContent, $('fGold').textContent]);
check('нулевой лимит показан как 0 V', $('fLeft').textContent === '0 V', $('fLeft').textContent);

/* ---------------- 11. пустой забег ничего не отправляет ---------------- */
const beforeEmpty = posted.length;
api().ready();
api().turn(1, 0);
api().finish('self');
check('без яблок запрос не отправлен', posted.length === beforeEmpty, posted.length);
check('без яблок объяснение на экране', /Ни одного яблока/.test($('fClaim').textContent), $('fClaim').textContent);
check('итог 0 V без выдуманных чисел', $('fV').textContent === '0 V', $('fV').textContent);

/* ---------------- 12. повтор после сбоя ---------------- */
api().ready();
api().turn(1, 0);
api().setApples(3, 0);
api().finish('self');
const retryClaim = lastSession();
check('запрос на повторной сессии отправлен', !!retryClaim, retryClaim && retryClaim.sessionId);
$('fClaim').className = 'claim pending';
api().retry();                       // имитируем состояние «не подтверждено»
check('кнопка повтора скрыта, пока ответа нет', $('fRetry').hidden === true, $('fRetry').hidden);
const beforeRetry = posted.length;
say({ type: 'snakeSessionResult', game: 'snake', sessionId: retryClaim.sessionId, awarded: 0, repeated: true, apples: 3, gold: 0 });
check('повтор не создаёт второй запрос', posted.length === beforeRetry, posted.length);
check('повтор объясняет, что уже зачислено', /уже зачислена/.test($('fClaim').textContent), $('fClaim').textContent);

/* ---------------- 13. флеш-запрос платформы ---------------- */
api().ready();
api().turn(1, 0);
api().setApples(2, 0);
frames(3);
const beforeFlush = posted.length;
say({ type: 'vg:flush' });
check('закрытие окна фиксирует итог', api().state() === 'over', api().state());
check('закрытие окна отправляет выплату', posted.length === beforeFlush + 1 && lastSession().apples === 2,
  lastSession() && lastSession().apples);

/* ---------------- 14. выход в каталог ---------------- */
const beforeHome = posted.length;
w.goHome();
check('кнопка «Домой» просит каталог', posted.length === beforeHome + 1
  && posted[posted.length - 1].type === 'home', posted[posted.length - 1]);

/* ---------------- 15. отрисовка без NaN и «пустых» стилей ---------------- */
drawLog.length = 0;
api().ready();
api().turn(1, 0);
api().setApples(6, 1);
frames(30);
const ops = {};
let bad = 0, worst = null;
drawLog.forEach((rec) => {
  ops[rec.n] = (ops[rec.n] || 0) + 1;
  rec.a.forEach((v) => {
    if (typeof v === 'number' && !Number.isFinite(v)) { bad++; worst = rec.n + '(' + rec.a.join(',') + ')'; }
  });
});
check('отрисовка вызывает ctx-методы', drawLog.length > 300, drawLog.length);
check('в координатах нет NaN и Infinity', bad === 0, worst);
check('рисуется тело (stroke/fill) и градиенты', (ops.stroke || 0) > 10 && (ops.fill || 0) > 10
  && (ops.createRadialGradient || 0) > 0, [ops.stroke, ops.fill, ops.createRadialGradient]);
check('рисуется голова (arc) и глаза', (ops.arc || 0) > 8, ops.arc);
check('стили заливки заданы', drawLog.filter((r) => r.style === undefined).length < drawLog.length / 2,
  [drawLog.filter((r) => r.style === undefined).length, drawLog.length]);

/* ---------------- итог ---------------- */
console.log(results.join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log('\nИТОГО: ' + (results.length - failed) + '/' + results.length + ' проверок пройдено');
if (consoleErrors.length) console.log('ошибки консоли:\n' + consoleErrors.slice(0, 8).join('\n'));
else console.log('ошибки консоли: нет');
process.exit(failed ? 1 : 0);
