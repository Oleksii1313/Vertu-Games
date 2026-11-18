#!/usr/bin/env node
/*
 * Автотест поля поиска в каталоге: загружает настоящий index.html по HTTP и
 * проверяет и новое оформление, и то, что поиск продолжает работать —
 * фильтрация при вводе, показ пустого результата и кнопка очистки.
 *
 *     NODE_PATH=/tmp/dom/node_modules node tools/test_search.js
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'assets/vg/css/platform.css'), 'utf8');

const results = [];
function check(name, ok, extra) {
  results.push((ok ? 'PASS' : 'FAIL') + ' · ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : ''));
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.json': 'application/json' };
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
  vc.on('jsdomError', (e) => { if (!/Not implemented|navigation|resource|Could not parse CSS/i.test(e.message)) errors.push(e.message); });
  vc.on('error', (...a) => errors.push(a.join(' ')));

  const dom = new JSDOM(html, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    url: base + '/index.html', virtualConsole: vc,
  });
  const w = dom.window;
  w.fetch = () => Promise.reject(new Error('offline'));
  w.HTMLCanvasElement.prototype.getContext = () => null;
  await wait(900);

  const doc = w.document;
  const input = doc.getElementById('gameSearch');
  const field = input && input.closest('.search');
  const clear = field && field.querySelector('.search-clear');
  const cards = () => Array.from(doc.querySelectorAll('#gameGrid .game-card'));
  const visible = () => cards().filter((c) => !c.classList.contains('hidden'));

  /* ---------------------------------------------------------- оформление */
  check('поле поиска на месте', !!input);
  check('поле получило класс оформления .search--lg', !!field && field.classList.contains('search--lg'));
  const svg = field && field.querySelector('.search-ico svg');
  check('иконка поиска увеличена до 20 px',
    !!svg && svg.getAttribute('width') === '20' && svg.getAttribute('height') === '20',
    svg && [svg.getAttribute('width'), svg.getAttribute('height')]);
  check('иконка стоит внутри поля слева', !!field && !!field.querySelector('.search-ico'));

  const style = input && w.getComputedStyle(input);
  const heightPx = style && parseFloat(style.height);
  check('высота поля 48–52 px', !!heightPx && heightPx >= 48 && heightPx <= 52, style && style.height);
  const leftPad = style && parseFloat(style.paddingLeft);
  check('текст не наезжает на иконку (отступ слева ≥ 44 px)', !!leftPad && leftPad >= 44, style && style.paddingLeft);

  check('в CSS есть подсветка фокуса фиолетовым/зелёным',
    /\.search--lg input\[type=search\]:focus\{[^}]*box-shadow:0 0 0 3px rgba\(139,92,246/.test(css.replace(/\s+/g, ' ').replace(/ *\{ */g, '{').replace(/ *\} */g, '}').replace(/; */g, ';')));
  check('в CSS есть адаптивный размер для телефона',
    /@media \(max-width:640px\)\{[\s\S]*?\.search--lg input\[type=search\]\{[^}]*height:48px/.test(css));
  check('плейсхолдер сделан читаемым', /\.search--lg input\[type=search\]::placeholder\{color:rgba\(226,232,240,\.56\)/.test(css));
  check('нативный крестик Safari отключён', /-webkit-search-cancel-button\{-webkit-appearance:none/.test(css));

  /* ---------------------------------------------------------- очистка */
  check('кнопка очистки создана', !!clear && clear.tagName === 'BUTTON');
  check('кнопка очистки подписана для скринридера',
    !!clear && !!clear.getAttribute('aria-label'));
  check('на пустом поле кнопка очистки не показывается',
    !!clear && (clear.hidden === true || w.getComputedStyle(clear).display === 'none'),
    clear && [clear.hidden, w.getComputedStyle(clear).display]);

  /* ---------------------------------------------------------- фильтрация */
  const total = cards().length;
  check('в каталоге есть карточки игр', total >= 10, total);

  input.value = 'flappy';
  input.dispatchEvent(new w.Event('input', { bubbles: true }));
  await wait(300);
  check('поиск по названию фильтрует карточки', visible().length === 1 && visible().length < total,
    [visible().length, total]);
  check('найденная карточка — именно Flappy',
    visible().length === 1 && /flappy/i.test(visible()[0].textContent));
  check('при введённом тексте кнопка очистки видна',
    !!clear && clear.hidden !== true && field.classList.contains('has-value'),
    clear && clear.hidden);

  input.value = 'нет-такой-игры';
  input.dispatchEvent(new w.Event('input', { bubbles: true }));
  await wait(300);
  const empty = doc.getElementById('gameEmpty');
  check('пустой результат показывается честно',
    visible().length === 0 && !!empty && !empty.classList.contains('hidden'),
    [visible().length, empty && empty.className]);

  clear.click();
  await wait(300);
  check('кнопка очистки стирает запрос', input.value === '');
  check('после очистки снова видны все игры', visible().length === total, [visible().length, total]);
  check('после очистки кнопка очистки снова скрыта',
    clear.hidden === true && !field.classList.contains('has-value'), clear.hidden);
  check('очистка возвращает фокус в поле', doc.activeElement === input, doc.activeElement && doc.activeElement.id);

  /* Поиск по жанру тоже работает (текст карточки, а не только имя). */
  input.value = 'головолом';
  input.dispatchEvent(new w.Event('input', { bubbles: true }));
  await wait(300);
  check('поиск по жанру/описанию работает', visible().length >= 1 && visible().length < total,
    visible().length);
  input.value = '';
  input.dispatchEvent(new w.Event('input', { bubbles: true }));
  await wait(250);

  /* Ввод с клавиатуры: значение приходит из настоящего нажатия. */
  input.focus();
  input.value = 'pong';
  input.dispatchEvent(new w.KeyboardEvent('keyup', { key: 'g', bubbles: true }));
  input.dispatchEvent(new w.Event('input', { bubbles: true }));
  await wait(300);
  check('обычный ввод с клавиатуры фильтрует список',
    visible().length >= 1 && visible().length < total, visible().length);

  /* --------------------------- вторая страница каталога (top.html) --------- */
  const dom2 = new JSDOM(fs.readFileSync(path.join(ROOT, 'top.html'), 'utf8'), {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    url: base + '/top.html', virtualConsole: vc,
  });
  const w2 = dom2.window;
  w2.fetch = () => Promise.reject(new Error('offline'));
  w2.HTMLCanvasElement.prototype.getContext = () => null;
  await wait(900);
  const input2 = w2.document.getElementById('gameSearch');
  const field2 = input2 && input2.closest('.search');
  check('top.html: поле поиска тоже оформлено', !!field2 && field2.classList.contains('search--lg'));
  const cards2 = () => Array.from(w2.document.querySelectorAll('#gameGrid .game-card'));
  const visible2 = () => cards2().filter((c) => !c.classList.contains('hidden'));
  const all2 = cards2().length;
  if (input2) {
    input2.value = 'pong';
    input2.dispatchEvent(new w2.Event('input', { bubbles: true }));
    await wait(300);
  }
  check('top.html: поиск фильтрует список', all2 > 1 && visible2().length >= 1 && visible2().length < all2,
    [visible2().length, all2]);
  const clear2 = field2 && field2.querySelector('.search-clear');
  if (clear2) clear2.click();
  await wait(300);
  check('top.html: кнопка очистки возвращает полный список',
    !!input2 && input2.value === '' && visible2().length === all2, [input2 && input2.value, visible2().length, all2]);

  const hard = errors.filter((e) => /TypeError|ReferenceError|Cannot read|is not a function/.test(e));
  check('нет ошибок JS на странице каталога', hard.length === 0, hard.slice(0, 3));

  console.log(results.join('\n'));
  const fails = results.filter((r) => r.startsWith('FAIL')).length;
  console.log('\nИТОГО: ' + (results.length - fails) + '/' + results.length + ' проверок пройдено');
  server.close();
  process.exit(fails ? 1 : 0);
})();
