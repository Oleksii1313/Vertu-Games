#!/usr/bin/env node
/*
 * Литовский каталог игр: карточки, чипы жанров и модальное окно должны
 * показывать литовский текст (длинное описание, правила, управление), а не
 * русские абзацы. Проверяется настоящий top.html по HTTP.
 *
 *     NODE_PATH=/tmp/dom/node_modules node tools/test_catalog_lt.js
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const CYRILLIC = /[А-Яа-яЁё]/;

let passed = 0;
const failures = [];
function check(name, ok, extra) {
  if (ok) passed++;
  else failures.push(name + (extra === undefined ? '' : ' → ' + JSON.stringify(extra)));
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'top.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('404'); return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;

  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', (e) => {
    if (!/Not implemented|navigation|resource|Could not parse CSS|Could not load (link|script)/i.test(e.message)) errors.push(e.message);
  });
  vc.on('error', (...a) => errors.push(a.join(' ')));

  const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'top.html'), 'utf8'), {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    url: base + '/top.html', virtualConsole: vc,
    /* jsdom не умеет fetch, а платформе он нужен для профиля. */
    beforeParse(window) { window.fetch = () => Promise.reject(new Error('offline')); },
  });
  const w = dom.window;
  const doc = w.document;
  await wait(500);

  check('каталог загрузился без ошибок JS', errors.length === 0, errors.slice(0, 2));
  check('данные каталога с литовскими полями', !!(w.VG_DATA && w.VG_DATA.games[0].long_lt),
    w.VG_DATA && Object.keys(w.VG_DATA.games[0]).filter((k) => k.endsWith('_lt')));

  /* Переключаем язык так же, как это делает кнопка LT в шапке. */
  w.VG.setLang('lt');
  await wait(200);
  check('язык страницы переключился на lt', doc.documentElement.getAttribute('lang') === 'lt',
    doc.documentElement.getAttribute('lang'));

  const card = [...doc.querySelectorAll('.game-card')].find((node) => /Klasikinė|Flappy/i.test(node.textContent));
  check('карточка игры показывает литовское описание',
    !!card && /Klasikinė arkada su keliaujančiu paukščiu/.test(card.textContent),
    card ? card.textContent.replace(/\s+/g, ' ').slice(0, 120) : null);

  const leftover = [...doc.querySelectorAll('.game-card')].filter((node) => CYRILLIC.test(node.textContent));
  check('на карточках нет русского текста', leftover.length === 0,
    leftover.slice(0, 2).map((node) => node.textContent.replace(/\s+/g, ' ').slice(0, 80)));

  const chips = [...doc.querySelectorAll('#catChips .chip')];
  check('чип «все жанры» переведён', chips.some((chip) => chip.textContent.trim() === 'Visi'),
    chips.slice(0, 4).map((chip) => chip.textContent.trim()));
  const artChip = chips.find((chip) => chip.getAttribute('data-cat') === 'Аркады');
  check('чип жанра переведён, но фильтрует по русскому значению',
    !!artChip && artChip.textContent.trim() === 'Arkos',
    artChip && { label: artChip.textContent.trim(), value: artChip.getAttribute('data-cat') });
  check('среди чипов нет русских подписей', chips.every((chip) => !CYRILLIC.test(chip.textContent)),
    chips.filter((chip) => CYRILLIC.test(chip.textContent)).map((chip) => chip.textContent.trim()));

  /* Открываем карточку игры — модалка рисуется из catalog-data.js. */
  const detailsButton = [...doc.querySelectorAll('[data-details], .game-card .card-btn, .game-card button')]
    .find((node) => !/roulette/i.test(node.getAttribute('data-game') || ''));
  if (detailsButton) {
    detailsButton.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  } else if (card) {
    card.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  }
  await wait(200);

  const modal = doc.getElementById('gameModal');
  const body = modal && modal.querySelector('.detail-body');
  const head = modal && modal.querySelector('.detail-head');
  check('модальное окно игры открылось', !!body, !!modal);
  if (body && head) {
    const text = body.textContent.replace(/\s+/g, ' ');
    check('длинное описание игры на литовском', /Klasikinė arkada/.test(head.textContent) || /Klasikinė arkada/.test(text),
      (head.textContent + ' | ' + text).slice(0, 120));
    check('подписи «Atlygis», «Valdymas» и «Paros limitas»',
      /Atlygis/.test(text) && /Valdymas/.test(text) && /Paros limitas/.test(text), text.slice(0, 160));
    check('правила награды на литовском', /paros limitas/i.test(text) && !CYRILLIC.test(text),
      text.slice(0, 200));
  }

  try { w.close(); } catch (e) {}
  server.close();

  if (failures.length) console.log('ПРОВАЛЫ:\n  ' + failures.join('\n  '));
  console.log('ИТОГО: ' + passed + '/' + (passed + failures.length) + ' проверок пройдено');
  process.exit(failures.length ? 1 : 0);
})();
