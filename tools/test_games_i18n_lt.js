#!/usr/bin/env node
/*
 * Литовский режим в играх: у игр пока нет литовских строк, поэтому при
 * ?lang=lt интерфейс должен показывать английский текст, а не русский.
 *
 *     NODE_PATH=/tmp/dom/node_modules node tools/test_games_i18n_lt.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const GAMES = ['chefs-rover', 'doodle', 'flappy', 'game2048', 'minicraft', 'platformer', 'pong', 'redline', 'shooter', 'sky-isle', 'snake'];

let passed = 0;
const failures = [];
function check(name, ok, extra) {
  if (ok) passed++;
  else failures.push(name + (extra === undefined ? '' : ' → ' + JSON.stringify(extra)));
}

function boot(id, lang) {
  const file = path.join(ROOT, 'games', id + '.html');
  const html = fs.readFileSync(file, 'utf8');
  const vc = new VirtualConsole();
  vc.on('jsdomError', () => {});
  vc.on('error', () => {});
  const url = 'http://localhost/games/' + id + '.html?lang=' + lang;
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url, virtualConsole: vc });
  const w = dom.window;
  w.HTMLCanvasElement.prototype.getContext = () => null;
  if (!w.matchMedia) w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  if (!w.ResizeObserver) w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  return w;
}

/* Всё, что показывает текст из пары data-ru/data-en, должно быть английским. */
function russianLeftovers(w) {
  const bad = [];
  w.document.querySelectorAll('[data-ru]').forEach((node) => {
    const en = node.getAttribute('data-en');
    if (en == null) return;
    const shown = (node.textContent || '').replace(/\s+/g, ' ').trim();
    const expected = en.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    if (shown !== expected) bad.push({ shown: shown.slice(0, 60), expected: expected.slice(0, 60) });
  });
  return bad;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
for (const id of GAMES) {
  let w;
  try {
    w = boot(id, 'lt');
  } catch (e) {
    check(id + ': страница открылась в литовском режиме', false, String(e.message));
    continue;
  }
  /* Рантайм переводит разметку по DOMContentLoaded, даём странице догрузиться. */
  await wait(120);
  const doc = w.document;
  check(id + ': <html lang="lt">', doc.documentElement.getAttribute('lang') === 'lt', doc.documentElement.getAttribute('lang'));
  check(id + ': рантайм знает язык lt', w.VG_I18N && w.VG_I18N.lang() === 'lt', w.VG_I18N && w.VG_I18N.lang());
  check(id + ': VGT для lt отдаёт английский вариант', w.VGT('Привет', 'Hello') === 'Hello', w.VGT && w.VGT('Привет', 'Hello'));

  const leftovers = russianLeftovers(w);
  check(id + ': в литовском режиме нет русского текста', leftovers.length === 0, leftovers.slice(0, 3));

  /* Платформа может переключить язык на лету — проверяем сообщение плеера. */
  w.dispatchEvent(new w.MessageEvent('message', { data: { type: 'player:lang', lang: 'ru' } }));
  const backToRu = doc.querySelector('[data-ru]');
  const ruText = backToRu ? (backToRu.textContent || '').trim() : '';
  const ruExpected = backToRu ? (backToRu.getAttribute('data-ru') || '').replace(/<[^>]*>/g, '').trim() : '';
  check(id + ': переключение на русский возвращает исходный текст', ruText === ruExpected, { ruText: ruText.slice(0, 40), ruExpected: ruExpected.slice(0, 40) });

  w.dispatchEvent(new w.MessageEvent('message', { data: { type: 'player:lang', lang: 'lt' } }));
  check(id + ': возврат в литовский режим снова даёт английский', russianLeftovers(w).length === 0, russianLeftovers(w).slice(0, 2));
  try { w.close(); } catch (e) {}
}

if (failures.length) {
  console.log('ПРОВАЛЫ:\n  ' + failures.join('\n  '));
}
console.log('ИТОГО: ' + passed + '/' + (passed + failures.length) + ' проверок пройдено');
process.exit(failures.length ? 1 : 0);
})();
