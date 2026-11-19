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

// --- Итог -----------------------------------------------------------------
console.log(results.join('\n'));
const failed = results.filter((line) => line.startsWith('FAIL'));
console.log('\nИТОГО: ' + (results.length - failed.length) + '/' + results.length + ' проверок пройдено');
process.exit(failed.length ? 1 : 0);
