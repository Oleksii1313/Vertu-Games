#!/usr/bin/env node
/* =============================================================================
   Vert Games · игровое поле занимает весь кадр
   -----------------------------------------------------------------------------
   Баг на устройстве: в платформере синее поле висело прямоугольником по центру
   окна, слева и справа — тёмные полосы. Причина не в цветах и не в CSS-«краске»:
   игра измеряла размер у самого холста, а браузер подгоняет собственный размер
   холста под соотношение его буфера (ширина буфера / высота буфера). Круг
   замыкался, поле «залипало» на первом измерении, и никакие правки CSS его не
   растягивали.

   Тест воспроизводит именно это поведение браузера (не layout, а правило
   «холст без явной рамки получает размер буфера») и проверяет, что после старта
   поле занимает всю свободную площадь: ширину окна и высоту за вычетом панелей.
   Прогоняются реальные размеры: ПК-окно, телефон в портрете и ландшафте,
   планшет и встроенный браузер Telegram.

   Запуск:  NODE_PATH=/tmp/dom/node_modules node tools/test_frame_fill.js
   ========================================================================== */
'use strict';

let JSDOM, VirtualConsole;
try {
  ({ JSDOM, VirtualConsole } = require('jsdom'));
} catch (error) {
  console.log('SKIP: jsdom не установлен (npm install jsdom) — тест пропущен');
  process.exit(0);
}
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const results = [];
function check(name, ok, extra) {
  results.push((ok ? 'PASS' : 'FAIL') + ' · ' + name + (extra === undefined ? '' : ' → ' + JSON.stringify(extra)));
}

/* Панели платформера: статистика сверху, док кнопок снизу, подсказка. */
const CHROME = { info: 62, controls: 78, help: 26 };
const CHROME_SUM = CHROME.info + CHROME.controls + CHROME.help;

const SCREENS = [
  { name: 'ПК-окно 1280×588 (как на скриншоте)', w: 1280, h: 588, dpr: 1 },
  { name: 'телефон в портрете 390×844', w: 390, h: 844, dpr: 3 },
  { name: 'телефон в ландшафте 844×390', w: 844, h: 390, dpr: 3 },
  { name: 'планшет 1024×768', w: 1024, h: 768, dpr: 2 },
  { name: 'встроенный браузер Telegram 430×700', w: 430, h: 700, dpr: 2.6 }
];

/*
 * Запуск игры с моделью браузера:
 *   body         — ровно видимая область (страница зафиксирована inset:0);
 *   .info/.controls/.help — свои высоты панелей;
 *   canvas       — БЕЗ явной рамки получает размер своего буфера, делённый на
 *                  dpr (то самое поведение, из-за которого поле сжималось).
 */
const KIT = fs.readFileSync(path.join(ROOT, 'assets/vg/js/game-kit.js'), 'utf8');
function boot(file, screen) {
  /* jsdom не грузит внешние скрипты — вставляем game-kit инлайном, как в проде. */
  const html = fs.readFileSync(path.join(ROOT, 'games', file), 'utf8')
    .replace('<script src="/assets/vg/js/game-kit.js"></script>', '<script>' + KIT + '</script>');
  const errors = [];
  const fills = [];
  let canvasEl = null;
  let W = screen.w, H = screen.h;
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { if (!/navigation|Not implemented|resource|canvas/i.test(e.message)) errors.push(e.message); });
  vc.on('error', (...a) => errors.push(a.join(' ')));

  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'http://localhost/games/' + file, virtualConsole: vc,
    beforeParse(window) {
      const grad = { addColorStop() {} };
      const ctxStub = new Proxy({
        createLinearGradient: () => grad, createRadialGradient: () => grad,
        measureText: () => ({ width: 10 }),
        setTransform() {},
        fillRect: (x, y, w, h) => { if (x === 0 && y === 0) fills.push([w, h]); }
      }, { get(t, p) { return p in t ? t[p] : function () {}; }, set(t, p, v) { t[p] = v; return true; } });
      window.HTMLCanvasElement.prototype.getContext = function () { ctxStub.canvas = this; return ctxStub; };
      window.HTMLElement.prototype.setPointerCapture = window.HTMLElement.prototype.setPointerCapture || function () {};
      window.HTMLElement.prototype.releasePointerCapture = window.HTMLElement.prototype.releasePointerCapture || function () {};
      if (!window.ResizeObserver) window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
      if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });

      const viewport = () => ({ w: W, h: H });
      Object.defineProperty(window, 'innerWidth', { get: () => W, configurable: true });
      Object.defineProperty(window, 'innerHeight', { get: () => H, configurable: true });
      Object.defineProperty(window, 'devicePixelRatio', { value: screen.dpr, configurable: true });
      Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {
        get() { return Math.round(this.getBoundingClientRect().width) || 0; }, configurable: true
      });
      Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', {
        get() { return Math.round(this.getBoundingClientRect().height) || 0; }, configurable: true
      });

      window.Element.prototype.getBoundingClientRect = function () {
        const v = viewport();
        const el = this;
        const cls = (el.className && String(el.className)) || '';
        if (el.tagName === 'BODY') return rect(v.w, v.h);
        if (/\binfo\b/.test(cls)) return rect(v.w, CHROME.info);
        if (/\bcontrols\b/.test(cls)) return rect(v.w, CHROME.controls);
        if (/\bhelp\b/.test(cls) || /\bhint\b/.test(cls)) return rect(v.w, CHROME.help);
        if (el.tagName === 'CANVAS') {
          canvasEl = el;
          /* Ключевая строка: браузер подстраивает размер холста под буфер. */
          const explicitW = el.style.width && el.style.width.indexOf('px') > 0;
          const explicitH = el.style.height && el.style.height.indexOf('px') > 0;
          if (!explicitW || !explicitH) {
            /* Холст, растянутый CSS-ом (width/height:100%), занимает свой
               контейнер: .stage/.board — остаток кадра после панелей игры,
               прямой ребёнок body — весь кадр. */
            const stage = el.closest && el.closest('.stage,.board,.board-wrap');
            const hostH = stage ? Math.max(120, v.h - (CHROME.info + CHROME.controls + CHROME.help)) : v.h;
            return rect(explicitW ? parseFloat(el.style.width) : v.w,
              explicitH ? parseFloat(el.style.height) : hostH);
          }
          const cssW = parseFloat(el.style.width);
          const cssH = parseFloat(el.style.height);
          return rect(cssW || v.w, cssH || v.h);
        }
        return rect(v.w, v.h);
      };

      const realGetComputedStyle = window.getComputedStyle.bind(window);
      window.getComputedStyle = function (el, pseudo) {
        const cs = realGetComputedStyle(el, pseudo);
        if (el && el.tagName === 'BODY') {
          /* Страница зафиксирована и разложена колонкой (flex column). */
          return { ...cs, getPropertyValue: (p) => (p === 'display' ? 'flex' : p === 'flex-direction' ? 'column' : cs.getPropertyValue(p)), display: 'flex', flexDirection: 'column' };
        }
        if (el && /\bcontrols\b/.test(String(el.className || ''))) {
          return { ...cs, getPropertyValue: (p) => (p === 'position' ? 'relative' : cs.getPropertyValue(p)), position: 'relative', display: 'flex' };
        }
        if (el && /\b(info|help|hint)\b/.test(String(el.className || ''))) {
          return { ...cs, display: 'block' };
        }
        return cs;
      };
      function rect(w, h) { return { width: Math.round(w), height: Math.round(h), top: 0, left: 0, right: Math.round(w), bottom: Math.round(h), x: 0, y: 0 }; }
      window.__resizeTo = (w, h) => { W = w; H = h; window.dispatchEvent(new window.Event('resize')); };
    }
  });

  /* Первый расчёт поля: часть игр вешает resize на DOMContentLoaded. */
  const w = dom.window;
  w.dispatchEvent(new w.Event('resize'));
  return { dom, window: w, errors, fills };
}

/* Высота панелей, которые реально есть в разметке конкретной игры. */
function chromeOf(doc) {
  let sum = 0;
  if (doc.querySelector('body>.info')) sum += CHROME.info;
  const dock = doc.querySelector('body>.controls');
  if (dock) {
    const cs = doc.defaultView.getComputedStyle(dock);
    if (!cs || cs.position !== 'fixed') sum += CHROME.controls;
  }
  if (doc.querySelector('body>.help') || doc.querySelector('body>.hint')) sum += CHROME.help;
  return sum;
}

/* --------------------------------------------------- платформер: полный кадр */
SCREENS.forEach((screen) => {
  const env = boot('platformer.html', screen);
  const w = env.window;
  const c = w.document.getElementById('c');
  const cssW = parseFloat(c.style.width) || 0;
  const cssH = parseFloat(c.style.height) || 0;
  const bufW = c.width, bufH = c.height;
  const dpr = Math.min(2.5, Math.max(1, screen.dpr));
  const viewScale = 1.28;
  const world = env.fills.length ? env.fills[env.fills.length - 1] : [0, 0];
  const label = screen.name;
  const chrome = chromeOf(w.document);
  const chromeCapped = Math.min(chrome, Math.round(screen.h * 0.45));

  check(label + ': поле занимает всю ширину окна', Math.abs(cssW - screen.w) <= 2, { cssW, window: screen.w });
  check(label + ': поле занимает всю высоту, кроме панелей',
    Math.abs(cssH - (screen.h - chromeCapped)) <= 2,
    { cssH, expected: screen.h - chromeCapped, chrome });
  check(label + ': поле и панели вместе — ровно кадр',
    Math.abs(cssH + chromeCapped - screen.h) <= 2,
    { cssH, chrome: chromeCapped, window: screen.h });
  /* Мир не может стать уже 320×240 логических пикселей — иначе правый край
     поля уходил бы за кадр на узком экране. */
  const scale = Math.min(viewScale, cssW / 320, cssH / 240);
  check(label + ': буфер холста в физических пикселях',
    bufW === Math.round(cssW * dpr) && Math.abs(bufH - Math.round(cssH * dpr)) <= 1, { bufW, bufH, cssW, cssH, dpr });
  check(label + ': мир крупнее кадра на VIEW_SCALE',
    Math.abs(world[0] - Math.ceil(cssW / scale)) <= 1 && Math.abs(world[1] - Math.ceil(cssH / scale)) <= 1,
    { world, expected: [Math.ceil(cssW / scale), Math.ceil(cssH / scale)], scale: +scale.toFixed(3) });
  check(label + ': мир не уходит за кадр', world[0] * scale >= cssW - 1 && world[1] * scale >= cssH - 1,
    { world, scale: +scale.toFixed(3), cssW, cssH });
  check(label + ': ошибок JavaScript нет', env.errors.length === 0, env.errors.slice(0, 2));

  /* Поворот телефона: поле пересчитывается под новый кадр, а не залипает. */
  if (screen.w !== screen.h) {
    const before = parseFloat(c.style.width);
    w.__resizeTo(screen.h, screen.w);
    check(label + ': после поворота поле пересчитано',
      Math.abs(parseFloat(c.style.width) - screen.h) <= 2 && parseFloat(c.style.width) !== before,
      { before, after: parseFloat(c.style.width) });
  }
  w.close();
});

/* --------------------------------------------- остальные игры с холстом в кадре */
[['pong.html', 'pong'], ['shooter.html', 'shooter']].forEach(([file, name]) => {
  const screen = { w: 1024, h: 640, dpr: 2 };
  const env = boot(file, screen);
  const w = env.window;
  const c = w.document.getElementById('c');
  const cssW = parseFloat(c.style.width) || 0;
  const cssH = parseFloat(c.style.height) || 0;
  const chrome = chromeOf(w.document);
  check(name + ': поле растянуто на ширину окна', Math.abs(cssW - screen.w) <= 2, { cssW });
  check(name + ': поле занимает высоту за вычетом панелей',
    Math.abs(cssH - (screen.h - chrome)) <= 2, { cssH, expected: screen.h - chrome, chrome });
  check(name + ': буфер в физических пикселях', c.width === Math.round(cssW * 2), { buf: c.width, cssW });
  check(name + ': ошибок JavaScript нет', env.errors.length === 0, env.errors.slice(0, 2));
  w.close();
});

/* ============================== «плавающий» мир: flappy и doodle ==========
   У этих игр логическая ширина мира была зашита (384 и 420), поэтому на
   широком экране поле вписывалось по высоте и по бокам оставались чёрные
   полосы. Теперь мир строится по соотношению сторон кадра: проверяем, что
   холст занимает кадр целиком, а пропорции мира совпадают с пропорциями
   доступной площади — значит масштаб одинаков по обеим осям и полос нет. */
[['flappy.html', 'flappy'], ['doodle.html', 'doodle']].forEach(([file, name]) => {
  SCREENS.forEach((screen) => {
    const env = boot(file, screen);
    const w = env.window;
    const doc = w.document;
    const c = doc.querySelector('canvas');
    if (!c) { check(name + ': холст найден', false); w.close(); return; }
    const chrome = chromeOf(doc);
    const availH = screen.h - Math.min(chrome, Math.round(screen.h * 0.45));
    const rectBox = c.getBoundingClientRect();
    const cssW = parseFloat(c.style.width) || Math.round(rectBox.width);
    const cssH = parseFloat(c.style.height) || Math.round(rectBox.height);
    const label = name + ' ' + screen.w + '×' + screen.h;
    check(label + ': холст занимает всю ширину кадра', Math.abs(cssW - screen.w) <= 2, { cssW, frame: screen.w });
    /* Панели самой игры (счёт, кнопки) — её собственный интерфейс, а не полосы:
       холст должен забрать всё, что осталось под ними. В модели это кадр минус
       панели (см. CHROME в моке), у flappy холст меряется по .stage напрямую. */
    const MOCK_CHROME_SUM = CHROME.info + CHROME.controls + CHROME.help;
    check(label + ': холст занимает всю высоту, оставшуюся от панелей',
      cssH >= screen.h - MOCK_CHROME_SUM - 2 && cssH <= screen.h + 1,
      { cssH, frame: screen.h, panels: MOCK_CHROME_SUM });
    const world = env.fills.length ? env.fills[env.fills.length - 1] : [0, 0];
    /* Полосы внутри поля исчезают тогда и только тогда, когда пропорции мира
       совпадают с пропорциями холста: масштаб по X и по Y один и тот же. */
    const boxAspect = cssW / cssH;
    const worldAspect = world[0] / (world[1] || 1);
    check(label + ': пропорции мира совпадают с холстом (нет полос)',
      Math.abs(worldAspect - boxAspect) / boxAspect < 0.02,
      { world, worldAspect: +worldAspect.toFixed(3), boxAspect: +boxAspect.toFixed(3) });
    check(label + ': ошибок JavaScript нет', env.errors.length === 0, env.errors.slice(0, 2));
    w.close();
  });
});

/* ====================== квадратные доски: 2048 и змейка ==================
   Поле 4×4 (и сетка змейки) обязано остаться квадратным: растянутые плитки —
   это уже другая игра. Поэтому доска занимает короткую сторону кадра целиком,
   без прежнего потолка 560 px. */
[['game2048.html', '2048'], ['snake.html', 'snake']].forEach(([file, name]) => {
  [{ w: 390, h: 844, dpr: 3, tag: 'портрет' }, { w: 844, h: 390, dpr: 3, tag: 'ландшафт' }].forEach((screen) => {
    const env = boot(file, screen);
    const w = env.window;
    const c = w.document.querySelector('canvas');
    const cssW = parseFloat(c.style.width) || 0;
    const cssH = parseFloat(c.style.height) || 0;
    check(name + ' ' + screen.tag + ': доска квадратная', Math.abs(cssW - cssH) <= 1, { cssW, cssH });
    /* Короткая сторона минус панели/отступы самой игры: доска не должна
       оставлять вокруг себя пустые полосы шире ~80 px. */
    check(name + ' ' + screen.tag + ': доска занимает короткую сторону кадра',
      cssW >= Math.min(screen.w, screen.h) - 80 && cssW <= Math.min(screen.w, screen.h) + 1,
      { cssW, short: Math.min(screen.w, screen.h) });
    w.close();
  });
});

/* Потолок 560 px у доски 2048 мешал полю расти на планшете: проверяем, что
   на большом экране доска действительно больше 560 px. */
(function () {
  const env = boot('game2048.html', { w: 1024, h: 768, dpr: 2 });
  const c = env.window.document.querySelector('canvas');
  const size = parseFloat(c.style.width) || 0;
  check('2048 планшет: доска больше прежнего потолка 560 px', size > 560, { size });
  env.window.close();
})();

/* ============================ плеер: кадр от края до края =================
   Чёрные полосы по бокам, которые видно на скриншотах с телефона, давал сам
   плеер: у оверлея стояли safe-area-отступы, и в ландшафте «челка» вырезала
   по 44 px слева и справа. Проверяем, что оверлей отдаёт игре весь экран. */
const CSS = fs.readFileSync(path.join(ROOT, 'assets/vg/css/platform.css'), 'utf8');
const CSS_NO_COMMENTS = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
const overlayRule = /\.play-overlay\{([^}]*)\}/.exec(CSS_NO_COMMENTS);
check('плеер: правило .play-overlay найдено', !!overlayRule);
if (overlayRule) {
  const body = overlayRule[1];
  check('плеер: у оверлея нет отступов', /(^|;)\s*padding:\s*0\s*(;|$)/.test(body.replace(/\s+/g, ' ')), body.match(/padding:[^;}]*/) ? body.match(/padding:[^;}]*/)[0] : 'нет padding');
  check('плеер: оверлей не режет кадр под «челку»',
    !/safe-area-inset-(left|right)/.test(body), body.includes('safe-area') ? 'есть safe-area' : 'чисто');
  check('плеер: оверлей на весь экран', /inset:\s*0/.test(body) && /height:100dvh/.test(body));
}
const frameRule = /\.play-frame-wrap\{([^}]*)\}/.exec(CSS_NO_COMMENTS);
check('плеер: рамка кадра растягивается (flex)', !!frameRule && /flex:1 1 auto/.test(frameRule[1]));
const iframeRule = /\.play-frame-wrap iframe\{([^}]*)\}/.exec(CSS_NO_COMMENTS);
check('плеер: iframe на весь кадр',
  !!iframeRule && /inset:0/.test(iframeRule[1]) && /width:100%/.test(iframeRule[1]) && /height:100%/.test(iframeRule[1]));

/* ===================== безопасные зоны доходят до игры ===================
   Кадр теперь отдаётся игре целиком, поэтому вырез экрана и «домашнюю» полосу
   компенсируют сами органы управления: платформа измеряет env()-отступы и
   присылает их в iframe сообщением vg:safe, а game-kit раскладывает их по
   CSS-переменным. Проверяем обе половины связки — иначе кнопки на iPhone
   уедут под системную полосу. */
const PLATFORM = fs.readFileSync(path.join(ROOT, 'assets/vg/js/platform.js'), 'utf8');
check('плеер измеряет безопасные зоны (env + пробный элемент)',
  /padding-top:env\(safe-area-inset-top/.test(PLATFORM) && /function safeInsets\(/.test(PLATFORM));
check('плеер отправляет зоны в кадр игры (vg:safe)',
  /type = 'vg:safe'/.test(PLATFORM) && /postMessage\(insets, location\.origin\)/.test(PLATFORM));
check('плеер обновляет зоны после поворота', /orientationchange[\s\S]{0,120}postSafeInsets/.test(PLATFORM));
check('зоны уходят и после загрузки игры', /setTimeout\(postSafeInsets, 60\)/.test(PLATFORM));
check('game-kit принимает vg:safe', /data\.type !== 'vg:safe'/.test(KIT) && /--vg-safe-bottom/.test(KIT));
check('game-kit поднимает кнопки над системной полосой', /html\.vg-safe body>\.controls\{padding-bottom/.test(KIT));
check('game-kit уводит кнопки из-под выреза', /--vg-safe-left,0px/.test(KIT) && /--vg-safe-right,0px/.test(KIT));

/* ------------------------------------------------------------------- итог */
results.forEach((line) => console.log(line));
const failed = results.filter((line) => line.startsWith('FAIL')).length;
console.log('\nИТОГО: ' + (results.length - failed) + '/' + results.length + ' проверок пройдено');
process.exit(failed ? 1 : 0);
