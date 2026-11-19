#!/usr/bin/env node
/*
 * Кристальный рубеж (games/crystal-frontier.html) — статическая приёмка игры.
 *
 * Игра трёхмерная: WebGL в тестовом окружении нет, поэтому тест держит то, что
 * можно проверить без рендера, — контракт с платформой и то, на чём обычно
 * ломается перенос чужой игры в каталог:
 *
 *   1. страница отдаётся как есть: lang="ru", только локальные скрипты
 *      (three.js копией в assets/vg/js, без CDN), ни одного внешнего запроса;
 *   2. встроенный скрипт синтаксически цел (движок игры не исполняется);
 *   3. двуязычие: у каждого data-ru есть data-en, разметка не содержит чисто
 *      английских текстов, а динамические строки идут через VGT();
 *   4. награда: ставка в игре совпадает с каталогом, итог забега отправляется
 *      серверу через VGReward, локальный счётчик остаётся только вне каталога;
 *   5. карточка: запись в каталоге ссылается на существующий файл и обложку
 *      1200×750 (иначе cover_art() подставит заглушку);
 *   6. телефон: есть тач-кнопки и стик, их размеры, safe-area и --vg-vh.
 *
 *     node tools/test_crystal.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const results = [];
function check(name, ok, extra) {
  results.push((ok ? 'PASS' : 'FAIL') + ' · ' + name +
    (extra === undefined ? '' : ' → ' + JSON.stringify(extra)));
}

const html = fs.readFileSync(path.join(root, 'games', 'crystal-frontier.html'), 'utf8');
const catalogSrc = fs.readFileSync(path.join(root, 'game_catalog.py'), 'utf8');

// --- 1. Страница и внешние зависимости -------------------------------------
check('страница объявлена русской', /<html[^>]*lang="ru"/.test(html));
const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)]
  .map((m) => m[1].replace(/^\//, ''));
check('three.js подключён локальной копией', scripts.includes('assets/vg/js/three.min.js'), scripts);
check('game-kit подключён', scripts.includes('assets/vg/js/game-kit.js'), scripts);
const external = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
check('в игре нет внешних src/href (CSP: только свой origin)', external.length === 0, external);
check('шрифты не тянутся с Google Fonts', !/fonts\.(googleapis|gstatic)\.com/.test(html));
const threePath = path.join(root, 'assets/vg/js/three.min.js');
check('файл three.js на месте и это r128',
  fs.existsSync(threePath) && /e="128"/.test(fs.readFileSync(threePath, 'utf8')) &&
  /\/\*\*\s*\*\s*@license/.test(fs.readFileSync(threePath, 'utf8')));
check('есть предупреждение про отсутствие WebGL', /WebGL/.test(html));

// --- 2. Синтаксис встроенного скрипта --------------------------------------
const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const engine = inline[inline.length - 1];
check('движок собран в один встроенный скрипт', inline.length >= 1 && engine.length > 100000,
  inline.map((s) => s.length));
let syntaxOk = true;
try { new Function(engine); } catch (e) { syntaxOk = false; check('движок компилируется', false, String(e)); }
if (syntaxOk) check('движок компилируется', true);

// --- 3. Двуязычие ----------------------------------------------------------
const ruAttrs = [...html.matchAll(/data-ru="([^"]*)"/g)].map((m) => m[1]);
const enAttrs = [...html.matchAll(/data-en="([^"]*)"/g)].map((m) => m[1]);
check('data-ru и data-en стоят парами', ruAttrs.length > 0 && ruAttrs.length === enAttrs.length,
  [ruAttrs.length, enAttrs.length]);
check('русские тексты в разметке непустые', ruAttrs.every((t) => t.trim().length > 0));
check('есть словарь перевода (game-i18n-strings)',
  /id="game-i18n-strings"/.test(html) && /VG_GAME_STRINGS\s*=/.test(html));
const body = html.slice(0, html.indexOf('<script'));
const bareEnglish = [...body.matchAll(/>([^<>{}]{2,80})</g)]
  .map((m) => m[1].trim())
  .filter((t) => /\b[A-Za-z]{4,}\b/.test(t) && !/[А-Яа-яЁё]/.test(t));
check('в разметке нет чисто английских подписей', bareEnglish.length === 0, bareEnglish.slice(0, 5));
check('динамические строки идут через VGT()', (html.match(/VGT\(/g) || []).length >= 50,
  (html.match(/VGT\(/g) || []).length);

// --- 4. Награда и контракт с сервером -------------------------------------
const catalogEntry = catalogSrc.slice(catalogSrc.indexOf("'id': 'crystal'"),
  catalogSrc.indexOf("'id': 'crystal'") + 2000);
const reward = Number((catalogEntry.match(/'reward':\s*(\d+)/) || [])[1]);
const daily = Number((catalogEntry.match(/'daily':\s*(\d+)/) || [])[1]);
const maxUnits = Number((catalogEntry.match(/'session_max_units':\s*(\d+)/) || [])[1]);
const perSec = Number((catalogEntry.match(/'session_units_per_sec':\s*([\d.]+)/) || [])[1]);
const rateInGame = Number((html.match(/VG_RATE\s*=\s*(\d+)/) || [])[1]);
check('ставка в игре совпадает со ставкой каталога', rateInGame > 0 && rateInGame === reward,
  [rateInGame, reward]);
check('VGReward инициализируется этим же id и ставкой',
  /VGReward\.init\(\s*'crystal'\s*,\s*VG_RATE\s*\)/.test(html));
check('единица события приходит из игры, сумма — с сервера',
  /VGReward\.add\(1\)/.test(html) && !/VGReward\.(?:award|set)\([^)]*VG_RATE/.test(html));
check('итог забега отправляется один раз (finish в endRound)',
  /function endRound\(win\)\{[\s\S]{0,400}VGReward\.finish\(/.test(html));
check('вне каталога остаётся локальный счётчик',
  /window\.VGReward\?\'platform\':\'test\'/.test(html) && /vBalance\+=amt/.test(html));
check('суточный лимит и единицы сессии заданы', daily > 0 && maxUnits > 0 && perSec > 0,
  [daily, maxUnits, perSec]);
check('за забег нельзя набрать больше единиц, чем разрешено', maxUnits <= 12, maxUnits);

// --- 5. Карточка каталога и обложка ---------------------------------------
check('запись каталога ссылается на файл игры',
  /'file':\s*'games\/crystal-frontier\.html'/.test(catalogEntry));
const cover = path.join(root, 'assets/vg/img/games/crystal.jpg');
check('обложка лежит там, где её ищет cover_art()', fs.existsSync(cover));
if (fs.existsSync(cover)) {
  const buf = fs.readFileSync(cover);
  let width = 0; let height = 0;
  for (let i = 2; i < buf.length - 8;) {
    if (buf[i] !== 0xFF) { i += 1; continue; }
    const marker = buf[i + 1];
    if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
      height = buf.readUInt16BE(i + 5); width = buf.readUInt16BE(i + 7); break;
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  check('обложка 1200×750 (16:10, как у остальных игр)', width === 1200 && height === 750,
    [width, height]);
}
const top = fs.readFileSync(path.join(root, 'top.html'), 'utf8');
check('карточка попала на витрину', /data-game="crystal"/.test(top));
check('карточка показывает обложку и награду',
  /img\/games\/crystal\.jpg/.test(top) && /data-game="crystal"[\s\S]{0,600}\+\d+ V/.test(top));

// --- 6. Телефон ------------------------------------------------------------
check('есть детект тач-устройства', /maxTouchPoints/.test(html) && /pointer:coarse/.test(html));
const mob = html.slice(html.indexOf('@media (pointer:coarse)'));
// Кнопки действий (прыжок, кирка, атака, действие) — крупные; служебные
// (пауза, инвентарь) в углу HUD могут быть меньше.
// У прыжка и атаки свои размеры, остальные кнопки — общий класс .mb.
const mbSize = Number((mob.match(/\.mb\{[^}]*width:(\d+)px/) || [])[1] || 0);
const actionSizes = ['bJump', 'bAtk', 'bMine', 'bUse'].map((id) => {
  const m = mob.match(new RegExp('#' + id + '\\{[^}]*width:(\\d+)px'));
  return m ? Number(m[1]) : mbSize;
});
check('кнопки действий не меньше 56 px', actionSizes.every((n) => n >= 56), actionSizes);
const allSizes = [...mob.matchAll(/#b[A-Za-z]+\{[^}]*width:(\d+)px/g)].map((m) => Number(m[1]));
check('ни одна тач-кнопка не мельче 48 px', allSizes.length >= 4 && Math.min(...allSizes) >= 48,
  allSizes);
check('стик движения не меньше 120 px', /#joy\{[^}]*width:134px/.test(html));
check('кнопки учли safe-area', (html.match(/env\(safe-area-inset/g) || []).length >= 8);
check('высота берётся из --vg-vh (Telegram/webview)', /var\(--vg-vh/.test(html));
check('телефон переключает тело в режим is-mobile', /classList\.toggle\('is-mobile'/.test(html));
check('касания обрабатываются (touch/pointer)', /touchstart|pointerdown/.test(html));
check('ландшафтный компактный режим есть',
  /orientation:landscape\) and \(max-height:520px\)/.test(html));
check('нет горизонтальной прокрутки', !/(^|;)\s*width:\s*100vw/.test(html) || /overflow-x:hidden/.test(html));

// --- 7. Стартовый экран: объяснение, графика, выход --------------------------
check('на старте есть кнопка выхода в каталог',
  /id="exitStart"[^>]*>[\s\S]{0,120}?Выйти в каталог/.test(html));
check('в паузе есть кнопка выхода', /id="exitPause"/.test(html));
check('выход говорит родителю закрыть плеер', /function goHome\(\)\{[\s\S]{0,200}postMessage\(\{type:'home'\}/.test(html));
check('без iframe выход ведёт на главную платформы', /location\.href='\.\.\/index\.html'/.test(html));
check('кнопки выхода подключены', /\$\('exitStart'\)\.onclick=goHome/.test(html) &&
  /\$\('exitPause'\)\.onclick=/.test(html));
check('выход есть и на экране итогов', /id="exitOver"[\s\S]{0,80}?Выйти в каталог/.test(html) &&
  /\$\('exitOver'\)\.onclick=goHome/.test(html));

const goal = html.slice(html.indexOf('class="goal"'), html.indexOf('class="gfx"'));
const steps = (goal.match(/<li>/g) || []).length;
check('на старте объяснено, что делать (≥ 4 шага)', steps >= 4, steps);
check('в инструкции есть осколки и алтарь', /алтарь/i.test(goal) && /осколк/i.test(goal));
check('в инструкции есть управление и жители',
  /клавишей E/.test(goal) && /жителями/.test(goal));

check('качество графики выбирается на старте', /id="sQualStart"/.test(html));
check('выбор графики один на старт и паузу',
  /function setQuality\(k\)\{[\s\S]{0,200}syncQuality\(\)/.test(html) &&
  /\$\('sQualStart'\)\.onchange=e=>setQuality/.test(html) &&
  /\$\('sQual'\)\.onchange=e=>setQuality/.test(html));
check('варианты качества подписаны на обоих языках',
  (html.match(/<option value="low" data-ru=/g) || []).length === 2);

// --- 8. Раскладка тач-кнопок: без наложений на любом экране -----------------
/* Позиции кнопок живут только в CSS, поэтому тест сам разрешает каскад для
   тач-устройства (safe-area = 0) и считает прямоугольники. */
function cssBlocks(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open < 0) break;
    const head = text.slice(i, open).replace(/\/\*[\s\S]*?\*\//g, '').trim();
    let depth = 1;
    let j = open + 1;
    while (j < text.length && depth) { if (text[j] === '{') depth++; else if (text[j] === '}') depth--; j++; }
    out.push({ head, body: text.slice(open + 1, j - 1) });
    i = j;
  }
  return out;
}
function cssDecls(body) {
  const map = {};
  body.split(';').forEach((pair) => {
    const k = pair.indexOf(':');
    if (k < 0) return;
    const prop = pair.slice(0, k).trim().toLowerCase();
    const value = pair.slice(k + 1).trim();
    if (prop) map[prop] = value;
  });
  return map;
}
function mediaMatches(head, w, h) {
  if (!head.startsWith('@media')) return false;
  const q = head.slice(6).trim();
  let ok = true;
  if (/max-width:(\d+)px/.test(q)) ok = ok && w <= Number(RegExp.$1);
  if (/max-height:(\d+)px/.test(q)) ok = ok && h <= Number(RegExp.$1);
  if (/orientation:landscape/.test(q)) ok = ok && w > h;
  if (/orientation:portrait/.test(q)) ok = ok && h >= w;
  return ok;
}
/* Размеры считаем в пикселях: vw/vh берём от текущего экрана, env() считаем нулём. */
let VW = 0;
let VH = 0;
function cssLength(expr) {
  const str = expr.replace(/env\([^)]*\)/g, '0px').replace(/\s+/g, ' ');
  let i = 0;
  const ws = () => { while (i < str.length && /\s/.test(str[i])) i++; };
  function value() {
    ws();
    if (str.startsWith('min(', i) || str.startsWith('max(', i)) {
      const isMax = str[i] === 'm' && str[i + 1] === 'a';
      i += 4;
      const nums = [];
      for (;;) {
        nums.push(sum());
        ws();
        if (str[i] === ',') { i++; continue; }
        if (str[i] === ')') i++;
        break;
      }
      return isMax ? Math.max(...nums) : Math.min(...nums);
    }
    if (str.startsWith('max(', i)) {
      i += 4; const a = sum(); ws(); if (str[i] === ',') i++; const b = sum();
      ws(); if (str[i] === ')') i++;
      return Math.max(a, b);
    }
    if (str.startsWith('calc(', i)) {
      i += 5; const v = sum(); ws(); if (str[i] === ')') i++; return v;
    }
    const px = /^[\d.]+(px|vw|vh)/.exec(str.slice(i));
    if (px) {
      i += px[0].length;
      const n = parseFloat(px[0]);
      if (px[1] === 'vw') return (n * VW) / 100;
      if (px[1] === 'vh') return (n * VH) / 100;
      return n;
    }
    throw new Error('не разобрал длину: ' + str.slice(i, i + 16));
  }
  function sum() {
    let v = value();
    for (;;) {
      ws();
      const c = str[i];
      if (c === '+') { i++; v += value(); }
      else if (c === '-') { i++; v -= value(); }
      else return v;
    }
  }
  const out = sum();
  ws();
  if (i !== str.length) throw new Error('лишний хвост в длине: ' + str.slice(i));
  return out;
}
/* Стилей в файле несколько (база + мобильные медиа), а правила каскада
   действуют на весь документ: склеиваем все <style> по порядку. */
const cssSource = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
const WATCH = ['#bAtk', '#bJump', '#bMine', '#bUse', '#bSpr', '#bInv', '#bPause', '#joy', '#mm', '#vbal',
  '#hotbar', '#quest', '#bars'];
function cssLayout(w, h) {
  VW = w; VH = h;
  const style = {};
  const apply = (head, body) => head.split(',').map((s) => s.trim()).forEach((sel) => {
    style[sel] = Object.assign(style[sel] || {}, cssDecls(body));
  });
  for (const block of cssBlocks(cssSource)) {
    if (block.head.startsWith('@media')) {
      if (mediaMatches(block.head, w, h)) cssBlocks(block.body).forEach((inner) => apply(inner.head, inner.body));
    } else apply(block.head, block.body);
  }
  const rects = {};
  for (const sel of WATCH) {
    const own = style[sel] || {};
    if ((own.display || '').trim() === 'none') continue;  /* скрытое на телефоне не мешает */
    const base = sel.startsWith('#b') ? (style['.mb'] || {}) : {};
    const width = cssLength(own.width || base.width || '0px');
    const height = cssLength(own.height || base.height || '0px');
    if (!width) continue;
    const auto = (v) => v && v.trim() !== 'auto';
    let left = null;
    let top = null;
    if (auto(own.left)) left = cssLength(own.left);
    if (auto(own.right)) left = w - cssLength(own.right) - width;
    if (auto(own.top)) top = cssLength(own.top);
    if (auto(own.bottom)) top = h - cssLength(own.bottom) - height;
    if (left === null || top === null) continue;
    rects[sel] = { left, top, right: left + width, bottom: top + height };
  }
  return rects;
}
const viewports = [[320, 568], [360, 640], [390, 844], [414, 896], [360, 780],
  [640, 360], [740, 400], [844, 390]];
const clash = [];
const offscreen = [];
for (const [w, h] of viewports) {
  const rects = cssLayout(w, h);
  const names = Object.keys(rects);
  for (const name of names) {
    const r = rects[name];
    if (r.left < -1 || r.top < -1 || r.right > w + 1 || r.bottom > h + 1) {
      offscreen.push(w + 'x' + h + ' ' + name);
    }
  }
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = rects[names[i]];
      const b = rects[names[j]];
      if (a.left < b.right + 4 && b.left < a.right + 4 && a.top < b.bottom + 4 && b.top < a.bottom + 4) {
        clash.push(w + 'x' + h + ' ' + names[i] + '/' + names[j]);
      }
    }
  }
}
check('тач-кнопки не наезжают друг на друга и на HUD', clash.length === 0, clash.slice(0, 6));
check('все тач-кнопки внутри экрана на 8 разрешениях', offscreen.length === 0, offscreen.slice(0, 6));
check('позиции кнопок заданы в CSS, а не в разметке',
  !/<div class="mb" id="b[A-Za-z]+" style=/.test(html));
check('мини-карта уходит влево в ландшафте',
  /orientation:landscape\) and \(max-height:520px\)\{[\s\S]{0,400}#mm\{[^}]*left:/.test(html));

// --- 9. Звук при появлении в деревне ---------------------------------------
check('фон плавно входит, а не включается сразу',
  /ambT\+=dt;const fade=Math\.min\(1,ambT\/4\)/.test(html) && /ambT=0;/.test(html));
check('птицы молчат, пока фон не вошёл', /soft>=1&&surf&&dayF>\.4/.test(html));

// --- Итог -----------------------------------------------------------------
console.log(results.join('\n'));
const failed = results.filter((line) => line.startsWith('FAIL'));
console.log('\nИТОГО: ' + (results.length - failed.length) + '/' + results.length + ' проверок пройдено');
process.exit(failed.length ? 1 : 0);
