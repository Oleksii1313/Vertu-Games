#!/usr/bin/env node
/*
 * Sky-Isle на телефоне: HUD не закрывает управление, подсказки можно убрать.
 *
 * Жалоба с живого телефона: «слева мешают 2 белых блока с текстом», «нет
 * управления». Причина: панель полёта (#lgPanel) стояла в левом нижнем углу
 * ровно поверх джойстика и была выше него по z-index, а карточка доставки
 * разворачивалась на пол-экрана. Этот тест держит исправление:
 *
 *   1. панель на тач-экране уезжает наверх и стартует свёрнутой;
 *   2. панель можно свернуть/развернуть кнопкой;
 *   3. на телефоне карточка доставки, панель полёта и карта переезжают в одну
 *      шторку, которая открывается одной кнопкой и закрывается ею же;
 *   4. на десктопе это та же кнопка, но она просто прячет подсказки;
 *   5. собираемая в игре CSS и базовая вёрстка содержат нужные правила
 *      (безопасные зоны, 100dvh, z-index джойстика выше панели);
 *   6. сборка games/sky-isle.html совпадает с исходником games/sky-isle.js.
 *
 *     NODE_PATH=/tmp/dom/node_modules node tools/test_sky_mobile_hud.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'games', 'sky-isle.js'), 'utf8');
const built = fs.readFileSync(path.join(root, 'games', 'sky-isle.html'), 'utf8');
const template = fs.readFileSync(path.join(root, 'tools', 'sky-isle.template.html'), 'utf8');

const results = [];
function check(name, ok, extra) {
  results.push((ok ? 'PASS' : 'FAIL') + ' · ' + name + (extra === undefined ? '' : ' → ' + JSON.stringify(extra)));
}
function slice(src, from, to) {
  const i = src.indexOf(from);
  if (i < 0) throw new Error('не найдено начало: ' + from.slice(0, 60));
  const j = src.indexOf(to, i);
  if (j < 0) throw new Error('не найдено конец: ' + to.slice(0, 60));
  return src.slice(i, j + to.length);
}

/* ---------------------------------------------------------------- CSS игры */
const styleBlock = source.slice(source.indexOf('style.textContent = `') + 'style.textContent = `'.length);
const gameCss = styleBlock.slice(0, styleBlock.indexOf('`;'));

check('CSS игры: панель на тач-экране уходит наверх, а не в угол джойстика',
  /body\[data-input=touch\] #lgPanel\{[^}]*top:calc\(132px/.test(gameCss) &&
  /body\[data-input=touch\] #lgPanel\{[^}]*bottom:auto/.test(gameCss), null);
check('CSS игры: HUD выше панели, поэтому джойстик не перекрыт',
  /\.hud\{z-index:14\}/.test(gameCss), null);
check('CSS игры: у свёрнутой панели одна строка без списка миссий',
  /#lgPanel\.collapsed\{[^}]*flex-direction:row/.test(gameCss) &&
  /#lgPanel\.collapsed #lgRes,#lgPanel\.collapsed #lgMissions\{display:none\}/.test(gameCss), null);
check('CSS игры: одно меню — шторка со всеми блоками и закрытием',
  /#lgSheet\{position:fixed/.test(gameCss) && /#lgSheet\.on\{display:flex\}/.test(gameCss) &&
  /#lgSheetBody\{display:flex/.test(gameCss), null);
check('CSS игры: внутри шторки блоки статичные, без absolute-наложений',
  /#lgSheet \.mission\{position:static/.test(gameCss) &&
  /#lgSheet #lgPanel\{position:static/.test(gameCss) &&
  /#lgSheet \.map-card\{position:static/.test(gameCss), null);
check('CSS игры: телеметрия на телефоне уходит под верхнюю строку',
  /body\[data-input=touch\] \.telemetry\{top:calc\(74px/.test(gameCss), null);
check('CSS игры: режим «без подсказок» прячет панель, карточку, карту и телеметрию',
  /body\.hud-clean \.hud \.mission,body\.hud-clean \.map-card,/.test(gameCss) &&
  /body\.hud-clean #lgPanel,body\.hud-clean \.telemetry\{display:none!important\}/.test(gameCss), null);

/* ------------------------------------------------------- базовая вёрстка */
function baseCss(html) {
  const head = html.indexOf('</head>');
  const end = html.lastIndexOf('</style>', head);
  const start = html.lastIndexOf('<style>', end);
  return html.slice(start, end);
}
const baseSource = baseCss(built);
const baseTemplate = baseCss(template);

check('вёрстка: игра тянется по 100dvh, а не по «высоте на глаз»',
  /html,body\{height:100%;height:100dvh\}/.test(baseSource) && /#flight\{height:100%[^}]*100dvh/.test(baseSource), null);
check('вёрстка: безопасные зоны учтены у верхней строки',
  /\.topbar\{top:calc\(18px \+ env\(safe-area-inset-top/.test(baseSource), null);
check('вёрстка: безопасные зоны у джойстика и кнопок высоты',
  /\.stick\{left:calc\(24px \+ env\(safe-area-inset-left/.test(baseSource) &&
  /\.alt-buttons\{right:calc\(24px \+ env\(safe-area-inset-right/.test(baseSource), null);
check('шаблон сборки совпадает с собранной страницей',
  baseTemplate.replace(/\s+/g, '') === baseSource.replace(/\s+/g, ''), null);
check('безопасные зоны есть и в телефоне (max-width:700px)',
  /@media\(max-width:700px\)\{[\s\S]*?\.topbar\{top:calc\(12px \+ env\(safe-area-inset-top/.test(baseSource), null);

/* ------------------------------------------------- разрешение и картинка */
check('движок: preserveDrawingBuffer больше не мешает MSAA',
  !/preserveDrawingBuffer:true/.test(source), null);
check('движок: рендер в физических пикселях экрана',
  /setHardwareScalingLevel\(1\)/.test(source), null);
check('движок: адаптивное понижение плотности при просадке кадров',
  /setHardwareScalingLevel\(1\.5\)/.test(source) && /slowStreak>90/.test(source), null);

/* ----------------------------------------------------------- поведение HUD */
function makeDom(input) {
  const html = `<!doctype html><html><body data-input="${input}">
    <div class="hud">
      <header class="topbar"><button id="home" class="icon">←</button>
        <div class="brand">SKY-ISLE</div>
        <button id="help" class="icon">?</button>
        <button id="pause" class="icon">Ⅱ</button></header>
      <section class="mission"><h2>Участок</h2><p>Текст</p></section>
    </div>
    <div class="map-card"><canvas id="map"></canvas></div>
    <div id="lgPanel"><div id="lgFuel"><div id="lgFuelFill"></div></div>
      <div id="lgRes"></div><div id="lgMissions"></div>
      <div id="lgButtons"><button id="lgStationBtn">СТАНЦИЯ</button><button id="lgMapBtn">КАРТА</button></div></div>
    <div class="telemetry"><b id="altitude">4.0 м</b></div>
  </body></html>`;
  return new JSDOM(html, { url: 'http://localhost/games/sky-isle.html' });
}

const tr = (ru) => ru;

/* Панель: создание кнопки сворачивания. */
const panelCode = slice(source, '  /* На телефоне панель сразу свёрнута', 'panel.appendChild(toggle);\n  }');

/* Карточка доставки: свёрнута на телефоне по умолчанию. */
const missionCode = slice(source, "    if (document.body.dataset.input === 'touch') {\n      missionCard.classList.add('collapsed');",
  "btn.setAttribute('aria-expanded', 'false');\n    }");

/* Верхняя строка: одна кнопка — меню на телефоне, «скрыть HUD» на десктопе. */
const hudCode = slice(source, "  /* На телефоне весь интерфейс живёт в одном меню", "if (document.hidden) setSheet(false); });\n  }");

function run(input) {
  const dom = makeDom(input);
  const doc = dom.window.document;
  const panel = doc.getElementById('lgPanel');
  const missionCard = doc.querySelector('.hud .mission');
  const btn = doc.createElement('button');
  btn.className = 'collapse';
  btn.textContent = '–';
  missionCard.appendChild(btn);
  new Function('document', 'tr', 'panel', panelCode)(doc, tr, panel);
  new Function('document', 'tr', 'missionCard', 'btn', missionCode)(doc, tr, missionCard, btn);
  new Function('document', 'tr', hudCode)(doc, tr);
  return { dom, doc, panel, missionCard };
}

/* --- телефон: одно меню --- */
const touch = run('touch');
const hudBtn = touch.doc.getElementById('hudToggle');
const sheet = touch.doc.getElementById('lgSheet');
check('телефон: в верхней строке одна кнопка меню', !!hudBtn && hudBtn.textContent === '☰', hudBtn && hudBtn.textContent);
check('телефон: меню собрано и закрыто по умолчанию', !!sheet && !sheet.classList.contains('on'), null);
check('телефон: карточка доставки, панель и карта внутри меню',
  !!sheet.querySelector('.mission') && sheet.contains(touch.doc.getElementById('lgPanel')) &&
  !!sheet.querySelector('.map-card'), null);
check('телефон: карточка доставки больше не висит поверх игры',
  !touch.doc.querySelector('.hud .mission'), null);
check('телефон: в меню панель развёрнута, а не свёрнута',
  !touch.doc.getElementById('lgPanel').classList.contains('collapsed'), null);

hudBtn.dispatchEvent(new touch.dom.window.Event('click'));
check('телефон: кнопка открывает меню', sheet.classList.contains('on') && hudBtn.textContent === '×',
  [sheet.className, hudBtn.textContent]);
hudBtn.dispatchEvent(new touch.dom.window.Event('click'));
check('телефон: повторное нажатие закрывает меню', !sheet.classList.contains('on') && hudBtn.textContent === '☰', null);
hudBtn.dispatchEvent(new touch.dom.window.Event('click'));
touch.doc.getElementById('lgSheetClose').dispatchEvent(new touch.dom.window.Event('click'));
check('телефон: крестик в меню закрывает его', !sheet.classList.contains('on'), sheet.className);
check('телефон: меню не переключает режим «без подсказок»', !touch.doc.body.classList.contains('hud-clean'), null);

/* --- десктоп: панели на месте, кнопка прячет подсказки --- */
const desk = run('desktop');
const deskBtn = desk.doc.getElementById('hudToggle');
check('десктоп: шторки нет', !desk.doc.getElementById('lgSheet'), null);
check('десктоп: панель полёта вне меню и развёрнута',
  !!desk.doc.getElementById('lgPanel') && !desk.panel.classList.contains('collapsed'), null);
check('десктоп: кнопка прячет подсказки', !!deskBtn, null);
deskBtn.dispatchEvent(new desk.dom.window.Event('click'));
check('десктоп: режим «без подсказок» включается и выключается',
  desk.doc.body.classList.contains('hud-clean'), null);
deskBtn.dispatchEvent(new desk.dom.window.Event('click'));
check('десктоп: подсказки возвращаются', !desk.doc.body.classList.contains('hud-clean'), null);

/* --- сборка совпадает с исходником --- */
check('сборка games/sky-isle.html содержит те же правки HUD',
  built.includes('#lgSheet{position:fixed') && built.includes("btn.textContent = open ? '×' : '☰';") &&
  built.includes('engine.setHardwareScalingLevel(1)'), null);

const failed = results.filter((r) => r.startsWith('FAIL'));
console.log(results.join('\n'));
console.log('\nИТОГО: ' + (results.length - failed.length) + '/' + results.length + ' проверок пройдено');
process.exit(failed.length ? 1 : 0);
