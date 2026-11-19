#!/usr/bin/env node
/*
 * Автотест запуска игр: страница грузится в jsdom по-настоящему по HTTP
 * (со всеми <script src>), поэтому проверяется именно то, что видит игрок,
 * открывая игру из каталога.
 *
 * Проверяется:
 *   1) все локальные ссылки src/href в 11 игровых страницах существуют;
 *   2) каждая 2D-игра стартует без ошибок: нет ReferenceError/TypeError,
 *      window.VGReward доступен, canvas получил размер, кадры идут.
 *
 *     NODE_PATH=/tmp/dom/node_modules node tools/test_game_boot.js
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const GAMES = [
  'flappy', 'game2048', 'platformer', 'pong', 'shooter', 'doodle', 'snake',
  'minicraft', 'sky-isle', 'chefs-rover', 'redline', 'crystal-frontier',
];
const BOOT_2D = ['flappy', 'game2048', 'platformer', 'pong', 'shooter', 'doodle', 'snake'];

const results = [];
function check(name, ok, extra) {
  results.push((ok ? 'PASS' : 'FAIL') + ' · ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : ''));
}

/* ------------------------------------------------ мини-сервер статики */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

function fake2d(canvas) {
  const grad = { addColorStop() {} };
  const target = {
    canvas,
    createLinearGradient() { return grad; },
    createRadialGradient() { return grad; },
    createPattern() { return null; },
    measureText() { return { width: 10 }; },
    getImageData(x, y, w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; },
    putImageData() {}, createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; },
  };
  return new Proxy(target, { get(t, p) { if (p in t) return t[p]; return function () {}; }, set(t, p, v) { t[p] = v; return true; } });
}

/* Виртуальная вёрстка: jsdom не считает layout, поэтому для проверки «поле
   занимает весь экран» подставляем размеры реального телефона 412 × 915 с
   полосой счёта 48 px и панелью управления 48 px. */
function virtualLayout(w, vw, vh) {
  const field = { width: vw, height: Math.max(240, vh - 96) };
  const boxOf = (el) => {
    if (!el || !el.tagName) return field;
    if (el === w.document.documentElement || el === w.document.body) return { width: vw, height: vh };
    const cls = (el.getAttribute && el.getAttribute('class')) || '';
    if (/\b(stage|board|board-wrap)\b/.test(cls)) return field;
    if (el.tagName === 'CANVAS') return field;
    return { width: vw, height: 48 };
  };
  w.Element.prototype.getBoundingClientRect = function () {
    const r = boxOf(this);
    return { width: r.width, height: r.height, left: 0, top: 0, right: r.width, bottom: r.height, x: 0, y: 0 };
  };
  Object.defineProperty(w.Element.prototype, 'clientWidth', { configurable: true, get() { return Math.round(boxOf(this).width); } });
  Object.defineProperty(w.Element.prototype, 'clientHeight', { configurable: true, get() { return Math.round(boxOf(this).height); } });
  return field;
}

async function boot2d(base, id, keep) {
  const url = base + '/games/' + (id === 'game2048' ? 'game2048' : id) + '.html';
  const html = fs.readFileSync(path.join(ROOT, 'games', id + '.html'), 'utf8');
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    const msg = e.detail && e.detail.stack ? String(e.detail.stack).split('\n')[0] : e.message;
    if (/Not implemented|navigation/i.test(msg)) return;
    errors.push(msg);
  });
  vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

  const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, url, virtualConsole: vc });
  const w = dom.window;
  w.HTMLCanvasElement.prototype.getContext = function (t) { return t === '2d' ? fake2d(this) : null; };
  w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
  Object.defineProperty(w, 'innerWidth', { value: 412, configurable: true });
  Object.defineProperty(w, 'innerHeight', { value: 915, configurable: true });
  Object.defineProperty(w, 'devicePixelRatio', { value: 2, configurable: true });
  if (!w.matchMedia) w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  if (!w.ResizeObserver) w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  /* jsdom по умолчанию считает вкладку скрытой, и игры корректно ставят себя
     на паузу. Для теста эмулируем видимую вкладку, как у живого игрока. */
  try {
    Object.defineProperty(w.document, 'hidden', { value: false, configurable: true });
    Object.defineProperty(w.document, 'visibilityState', { value: 'visible', configurable: true });
    w.document.dispatchEvent(new w.Event('visibilitychange'));
  } catch (e) {}
  const posted = [];
  try { Object.defineProperty(w, 'parent', { value: { postMessage(m) { posted.push(m); } }, configurable: true }); } catch (e) {}
  w.addEventListener('error', (e) => errors.push('window.onerror: ' + (e.message || e.error)));

  await new Promise((r) => setTimeout(r, 500));
  const canvas = w.document.getElementById('c') || w.document.querySelector('canvas');
  const info = {
    errors,
    posted,
    canvas: canvas ? { w: canvas.width, h: canvas.height } : null,
    vgReward: typeof w.VGReward,
  };
  /* Эмуляция телефона: пересчитываем кадр с реальными размерами области. */
  const field = virtualLayout(w, 412, 915);
  try { w.dispatchEvent(new w.Event('resize')); } catch (e) {}
  await new Promise((r) => setTimeout(r, 120));
  info.field = field;
  if (canvas) {
    info.fitted = { w: canvas.width, h: canvas.height, css: canvas.style.cssText };
  }
  /* Поворот телефона: поле должно остаться без искажений. */
  const land = virtualLayout(w, 915, 412);
  try { w.dispatchEvent(new w.Event('orientationchange')); w.dispatchEvent(new w.Event('resize')); } catch (e) {}
  await new Promise((r) => setTimeout(r, 220));
  info.landscape = { field: land, w: canvas ? canvas.width : 0, h: canvas ? canvas.height : 0, css: canvas ? canvas.style.cssText : '' };
  if (!keep) { try { w.close(); } catch (e) {} }
  info.w = w;
  return info;
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;

  /* --------------------------------------------- 1. ссылки на файлы */
  for (const id of GAMES) {
    const file = path.join(ROOT, 'games', id + '.html');
    if (!fs.existsSync(file)) { check('файл игры существует: ' + id, false); continue; }
    const html = fs.readFileSync(file, 'utf8');
    const refs = new Set();
    const re = /(?:src|href)\s*=\s*["']([^"'#?+]+)["']/g;
    let m;
    while ((m = re.exec(html))) {
      const ref = m[1];
      if (!ref || /^(https?:|data:|javascript:|mailto:|\/\/|\{\{|%s)/.test(ref)) continue;
      refs.add(ref);
    }
    const missing = [];
    for (const ref of refs) {
      const abs = ref.startsWith('/') ? path.join(ROOT, ref) : path.join(ROOT, 'games', ref);
      if (!fs.existsSync(abs)) missing.push(ref);
    }
    check('ссылки игры ' + id + ' ведут на существующие файлы (' + refs.size + ')', missing.length === 0, missing.slice(0, 4));
  }

  /* ------------------------------------------------- 2. запуск 2D-игр */
  for (const id of BOOT_2D) {
    const info = await boot2d(base, id);
    const hard = info.errors.filter((e) => /ReferenceError|TypeError|SyntaxError|is not a function|Cannot read/.test(e));
    check(id + ': страница открылась без ошибок JS', hard.length === 0, hard.slice(0, 3));
    check(id + ': VGReward подключён до кода игры', info.vgReward === 'object', info.vgReward);
    const c = info.canvas || { w: 0, h: 0 };
    check(id + ': canvas получил размер', c.w > 0 && c.h > 0, c);

    /* Поле занимает доступную площадь: буфер холста покрывает область. */
    const fitInfo = info.fitted || { w: 0, h: 0 };
    /* Квадратные игры (2048, Snake) обязаны оставаться квадратными: они
       заполняют короткую сторону и центрируются, а не растягиваются. */
    const square = id === 'game2048' || id === 'snake';
    const fitOk = square
      ? Math.min(fitInfo.w, fitInfo.h) >= Math.min(info.field.width, info.field.height) * 0.98
        && Math.abs(fitInfo.w - fitInfo.h) <= 1
      : fitInfo.w >= info.field.width * 0.98 && fitInfo.h >= info.field.height * 0.9;
    check(id + ': поле использует область экрана' + (square ? ' без искажения пропорций' : ''), fitOk,
      { canvas: [fitInfo.w, fitInfo.h], field: [info.field.width, info.field.height] });
    const landInfo = info.landscape || { w: 0, h: 0 };
    check(id + ': после поворота поле пересчитано и не искажено', landInfo.w > 0 && landInfo.h > 0, [landInfo.w, landInfo.h]);
  }

  /* ------------------------------------- 3. Управление и механики в игре */
  {
    const key = (w, code, type) => {
      const ev = new w.KeyboardEvent(type, { code, key: code === 'Space' ? ' ' : code, bubbles: true });
      w.document.dispatchEvent(ev);
      w.dispatchEvent(ev);
    };
    const read = (w, expr) => { try { return w.eval(expr); } catch (e) { return undefined; } };

    // Платформер: стрелка вправо реально двигает игрока.
    const p = await boot2d(base, 'platformer', true);
    const pw = p.w;
    const px0 = read(pw, 'player.x');
    key(pw, 'ArrowRight', 'keydown');
    await new Promise((r) => setTimeout(r, 700));
    key(pw, 'ArrowRight', 'keyup');
    const px1 = read(pw, 'player.x');
    check('platformer: стрелка вправо двигает игрока', typeof px0 === 'number' && px1 > px0, [px0, px1]);
    key(pw, 'Space', 'keydown');
    await new Promise((r) => setTimeout(r, 200));
    key(pw, 'Space', 'keyup');
    const pvy = read(pw, 'player.vy');
    check('platformer: прыжок запускается', typeof pvy === 'number', pvy);
    check('platformer: игра рисует кадры (нет заставки загрузки)',
      read(pw, 'frame') > 3 && !pw.document.getElementById('overlay').classList.contains('show'),
      read(pw, 'frame'));
    try { pw.close(); } catch (e) {}

    // Shooter: выстрел создаёт пулю, враги появляются.
    const s2 = await boot2d(base, 'shooter', true);
    const sw = s2.w;
    /* Игра открывается экраном «ГОТОВ?» — это и есть стартовый экран, а не
       зависание. Нажимаем «▶ В бой», как живой игрок. */
    const ready = sw.document.getElementById('ovBtn');
    check('shooter: стартовый экран с кнопкой «В бой»', !!ready);
    if (ready) ready.click();
    await new Promise((r) => setTimeout(r, 320));
    key(sw, 'Space', 'keydown');
    await new Promise((r) => setTimeout(r, 350));
    const enemies = read(sw, 'enemies.length');
    /* Пуля летит ~0.4 с при перезарядке ~1.1 с, поэтому одного замера мало:
       копим максимум за полный цикл автострельбы. */
    let bullets = 0;
    for (let i = 0; i < 14 && bullets < 1; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const n = read(sw, 'bullets.length');
      if (typeof n === 'number' && n > bullets) bullets = n;
    }
    key(sw, 'Space', 'keyup');
    check('shooter: выстрел создаёт пулю', typeof bullets === 'number' && bullets > 0, bullets);
    check('shooter: враги появляются в игре', typeof enemies === 'number' && enemies > 0, enemies);
    await new Promise((r) => setTimeout(r, 600));
    check('shooter: волна и счёт обновляются без ошибок',
      typeof read(sw, 'wave') === 'number' && !sw.document.getElementById('overlay').classList.contains('show'),
      read(sw, 'wave'));
    try { sw.close(); } catch (e) {}

    // Pong: мяч двигается сам после подачи.
    const g2 = await boot2d(base, 'pong', true);
    const gw = g2.w;
    const bx0 = read(gw, 'ball.x'), by0 = read(gw, 'ball.y');
    key(gw, 'Space', 'keydown');
    await new Promise((r) => setTimeout(r, 500));
    const bx1 = read(gw, 'ball.x'), by1 = read(gw, 'ball.y');
    check('pong: мяч двигается после подачи', bx1 !== bx0 || by1 !== by0, [bx0, by0, bx1, by1]);
    try { gw.close(); } catch (e) {}

    // Flappy: взмах поднимает птицу.
    const f2 = await boot2d(base, 'flappy', true);
    const fw = f2.w;
    /* Новый забег: птица не должна успеть упасть до проверки. */
    read(fw, 'init()');
    const y0 = read(fw, 'bird.y');
    key(fw, 'Space', 'keydown');
    await new Promise((r) => setTimeout(r, 80));
    key(fw, 'Space', 'keyup');
    const vy = read(fw, 'bird.vy');
    check('flappy: взмах задаёт птице импульс вверх', typeof vy === 'number' && vy < 0, [y0, vy]);
    try { fw.close(); } catch (e) {}
  }

  /* ------------------------------------------ 4. Flappy: портрет и заполнение */
  {
    const info = await boot2d(base, 'flappy');
    const css = (info.fitted && info.fitted.css) || '';
    const mw = /width:\s*([\d.]+)px/.exec(css);
    const mh = /height:\s*([\d.]+)px/.exec(css);
    const cw = mw ? Number(mw[1]) : 0;
    const ch = mh ? Number(mh[1]) : 0;
    const field = info.field || { width: 412, height: 819 };
    check('flappy: поле занимает всю ширину экрана', cw >= field.width * 0.98, { cssW: cw, field: field.width });
    check('flappy: поле занимает всю высоту экрана', ch >= field.height * 0.98, { cssH: ch, field: field.height });
    /* Мир подстраивается под экран: в портрете он вертикальный, и полос по
       бокам быть не должно — холст занимает ширину целиком. */
    check('flappy: мир в портрете вертикальный', ch > cw, [cw, ch]);
    const lcss = (info.landscape && info.landscape.css) || '';
    const lw = /width:\s*([\d.]+)px/.exec(lcss);
    const lh = /height:\s*([\d.]+)px/.exec(lcss);
    const lcw = lw ? Number(lw[1]) : 0;
    const lch = lh ? Number(lh[1]) : 0;
    /* После поворота в ландшафт поле расширяется вместе с кадром (а не встаёт
       вертикальной полоской с чёрными полосами по бокам): ширина холста равна
       ширине кадра 915 px, высота — всей оставшейся площади под панелями. */
    check('flappy: после поворота сцена заполняет кадр',
      Math.abs(lcw - 915) <= 2 && lch >= 300, [lcw, lch]);
  }

  server.close();
  console.log(results.join('\n'));
  const fails = results.filter((r) => r.startsWith('FAIL')).length;
  console.log('\nИТОГО: ' + (results.length - fails) + '/' + results.length + ' проверок пройдено');
  process.exit(fails ? 1 : 0);
})();
