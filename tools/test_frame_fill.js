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
          const cssW = el.style.width ? parseFloat(el.style.width) : (el.width / screen.dpr);
          const cssH = el.style.height ? parseFloat(el.style.height) : (el.height / screen.dpr);
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

/* ------------------------------------------------------------------- итог */
results.forEach((line) => console.log(line));
const failed = results.filter((line) => line.startsWith('FAIL')).length;
console.log('\nИТОГО: ' + (results.length - failed) + '/' + results.length + ' проверок пройдено');
process.exit(failed ? 1 : 0);
