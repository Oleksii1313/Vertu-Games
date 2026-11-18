#!/usr/bin/env node
/*
 * Литовский интерфейс платформы: открываем каждую страницу, переключаем язык
 * на LT и проверяем, что в видимом тексте (и в подписях aria-label/title/
 * placeholder/alt) не осталось русских строк. Литовский — третий язык сайта,
 * и всё, для чего перевода нет, должно показывать английский вариант.
 *
 *     NODE_PATH=/tmp/dom/node_modules node tools/test_platform_lt.js
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const CYRILLIC = /[А-Яа-яЁё]/;
const PAGES = ['index.html', 'top.html', 'shop.html', 'casino.html', 'roulette.html',
  'profile.html', 'login.html', 'about.html', 'support.html', 'privacy.html', 'api.html', 'admin.html'];

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
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('404'); return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

/* Видимый текст и подписи, которые пользователь читает на странице. */
function russianText(w) {
  const found = [];
  const walk = (node) => {
    if (node.nodeType === 3) {
      const text = node.textContent.trim();
      const parent = node.parentElement;
      if (text && CYRILLIC.test(text) && parent && !/^(SCRIPT|STYLE)$/.test(parent.tagName)) {
        found.push(text.replace(/\s+/g, ' ').slice(0, 70));
      }
      return;
    }
    if (node.nodeType !== 1) return;
    if (/^(SCRIPT|STYLE)$/.test(node.tagName)) return;
    /* Всплывающие сообщения живут пару секунд: они появились ещё на русском
       (страница теста грузится в RU и переключается на LT после загрузки). */
    if (/\btoast\b/.test(node.getAttribute('class') || '')) return;
    ['placeholder', 'aria-label', 'title', 'alt'].forEach((name) => {
      const value = node.getAttribute && node.getAttribute(name);
      if (value && CYRILLIC.test(value)) found.push('[' + name + '] ' + value.slice(0, 60));
    });
    node.childNodes.forEach(walk);
  };
  walk(w.document.body);
  return [...new Set(found)];
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;

  for (const page of PAGES) {
    const vc = new VirtualConsole();
    const errors = [];
    vc.on('jsdomError', (e) => {
      if (!/Not implemented|navigation|resource|Could not parse CSS|Could not load (link|script)/i.test(e.message)) {
        errors.push(e.message.slice(0, 90));
      }
    });
    const dom = new JSDOM(fs.readFileSync(path.join(ROOT, page), 'utf8'), {
      runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
      url: base + '/' + page, virtualConsole: vc,
      beforeParse(window) { window.fetch = () => Promise.reject(new Error('offline')); },
    });
    const w = dom.window;
    await wait(450);
    check(page + ': страница открылась без ошибок JS', errors.length === 0, errors.slice(0, 2));
    try { w.VG.setLang('lt'); } catch (e) {
      check(page + ': переключение языка доступно', false, String(e.message));
    }
    await wait(220);
    check(page + ': <html lang="lt">', w.document.documentElement.getAttribute('lang') === 'lt',
      w.document.documentElement.getAttribute('lang'));
    const leftover = russianText(w);
    check(page + ': нет русского текста в литовском режиме', leftover.length === 0, leftover.slice(0, 5));
    try { w.close(); } catch (e) {}
  }

  server.close();
  if (failures.length) console.log('ПРОВАЛЫ:\n  ' + failures.join('\n  '));
  console.log('ИТОГО: ' + passed + '/' + (passed + failures.length) + ' проверок пройдено');
  process.exit(failures.length ? 1 : 0);
})();
