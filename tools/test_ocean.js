#!/usr/bin/env node
/**
 * test_ocean.js — приёмка игры «Ocean Coins» (games/ocean-coins.html).
 *
 *   NODE_PATH=/tmp/dom/node_modules node tools/test_ocean.js
 *
 * Что проверяем:
 *   1. файл игры и платформенная обвязка: локальный three, game-kit, i18n;
 *   2. награда V: VGReward.init('ocean', …) и начисление за монеты;
 *   3. выход в каталог, выбор качества графики, сохранение прогресса;
 *   4. гарпун: модель в руках, копьё с тросом, урон, перезарядка;
 *   5. тач-управление: стик и четыре кнопки, размеры под палец;
 *   6. раскладка: 10 элементов HUD/кнопок на 8 разрешениях без наложений;
 *   7. запуск в jsdom с поддельным WebGL: страница и первые кадры без ошибк.
 */
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const layout = require('./lib/css_layout.js');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'games', 'ocean-coins.html');
const html = fs.readFileSync(FILE, 'utf8');

let passed = 0;
const failures = [];
function check(name, ok, extra) {
  if (ok) passed++;
  else failures.push(name + (extra === undefined ? '' : ' → ' + JSON.stringify(extra)));
}

/* ------------------------------------------------------------- 1. каркас */
check('файл игры существует', fs.existsSync(FILE));
check('файл не раздулся (> 200 КБ)', fs.statSync(FILE).size < 200000, fs.statSync(FILE).size);
check('three.js подключён локально, без CDN', /src="\/assets\/vg\/js\/three\.min\.js"/.test(html) && !/cdnjs|unpkg|jsdelivr/.test(html));
check('game-kit подключён', /src="\/assets\/vg\/js\/game-kit\.js"/.test(html));
check('есть словарь переводов', /<script id="game-i18n-strings">/.test(html));
check('есть рантайм переводов', /<script id="game-i18n-runtime">/.test(html));
check('рантайм не знает литовского', !/data-[a-z-]+-lt=/.test(html) && !/(=== 'lt')/.test((html.match(/<script id="game-i18n-runtime">[\s\S]*?<\/script>/) || [''])[0].replace("saved === 'lt'", '')));
const pairs = [/data-ru="/g, /data-en="/g].map((re) => (html.match(re) || []).length);
check('data-ru и data-en стоят парами', pairs[0] === pairs[1] && pairs[0] > 20, pairs);
check('русские тексты в разметке непустые', !/data-ru=""/.test(html));
check('страница масштабируется на телефоне', /viewport-fit=cover/.test(html));

/* --------------------------------------------------------- 2. награда V */
check('награда V объявлена с id ocean', /VGReward\.init\('ocean',VG_RATE\)/.test(html));
check('ставка награды 3 V за единицу', /const VG_RATE=3/.test(html));
check('единица награды — 10 монет', /UNIT_COINS=10/.test(html));
check('монеты начисляют V', /function gain\(v,pos\)\{S\.coins\+=v;qadd\('coins',v\);if\(window\.VGReward\)VGReward\.add/.test(html));
check('сундук и квесты тоже дают V', (html.match(/VGReward\.add\(/g) || []).length >= 4, (html.match(/VGReward\.add\(/g) || []).length);
check('в HUD есть счётчик V', /id="hV"/.test(html) && /function syncV\(\)/.test(html));
check('итог забега отправляется на сервер', /VGReward\.finish\('over'\)/.test(html));

/* ------------------------------------------------- 3. каталог и качество */
check('есть выход в каталог', /function goHome\(\)/.test(html) && /postMessage\(\{type:'home'\}/.test(html));
check('кнопка выхода на старте', /id="exitStart"/.test(html));
check('кнопка выхода в настройках', /id="sHome"/.test(html));
check('выход навешен на кнопки', /\$\('sHome'\)\.onclick/.test(html) && /\$\('exitStart'\)\.onclick=goHome/.test(html));
check('качество выбирается на старте', /id="sQualStart"/.test(html));
check('выбор качества связан с настройкой', /\$\('sQualStart'\)\.onchange/.test(html));
check('прогресс сохраняется в localStorage', /localStorage\.setItem\(KEY/.test(html));

/* ------------------------------------------------------------- 4. гарпун */
check('гарпан собран мешами', /const gun=new THREE\.Group\(\)/.test(html) && /mSpear/.test(html));
check('в гарпуне заряженное копьё', /const loaded=new THREE\.Group\(\)/.test(html));
check('копьё с наконечником и зазубринами', /function mkSpear\(\)/.test(html) && /ConeGeometry\(\.095,\.4,6\)/.test(html));
check('у копья есть трос', /cordMat=new THREE\.LineBasicMaterial/.test(html) && /b\.cord\.visible=true/.test(html));
check('выстрел прячет заряженное копьё', /loaded\.visible=false;rlT=\.42/.test(html));
check('есть перезарядка гарпуна', /if\(rlT>0\)\{rlT-=dt;if\(rlT<=0\)loaded\.visible=true\}/.test(html));
check('копьё наносит урон 2', /e\.hp-=2/.test(html));
check('шаг копья дробится (не проскакивает акулу)', /for\(let s=0;s<2&&!hit;s\+\+\)/.test(html));
check('попадание даёт пузыри и брызги', /burst\(bp,6,0xbfe9ff/.test(html));
check('трое обновляется каждый кадр', /pos\.setXYZ\(1,bp\.x,bp\.y,bp\.z\);pos\.needsUpdate=true/.test(html));
check('кнопка гарпуна есть на телефоне', /id="bFire"/.test(html));
check('акулы и пираты — враги с запасом здоровья', /hp:sk\?5:1/.test(html));

/* ------------------------------------------------- 5–6. тач и раскладка */
const WATCH = ['#joy', '#bFire', '#bSp', '#bUp', '#bDn', '#mm', '#top', '#oxy', '#hp', '#btns'];
const VP = [[320, 568], [360, 640], [390, 844], [414, 896], [360, 780], [640, 360], [740, 400], [844, 390]];
const rects = layout.cssLayout(WATCH, 360, 640, html);
check('на телефоне есть все кнопки управления', ['#joy', '#bFire', '#bSp', '#bUp', '#bDn'].every((id) => rects[id]), Object.keys(rects));
check('кнопка гарпуна крупная (≥ 80 px)', (rects['#bFire'] || {}).right - (rects['#bFire'] || {}).left >= 80,
  [(rects['#bFire'] || {}).left, (rects['#bFire'] || {}).right]);
['#bSp', '#bUp', '#bDn'].forEach((id) => {
  const r = rects[id] || {};
  check('кнопка ' + id + ' не меньше 54 px', r.right - r.left >= 54, [r.left, r.right]);
});
const wide = layout.cssLayout(WATCH, 390, 844, html);
check('стик 134 px на обычном телефоне', (wide['#joy'] || {}).right - (wide['#joy'] || {}).left === 134,
  (wide['#joy'] || {}).right - (wide['#joy'] || {}).left);
check('на узком экране стик чуть меньше, но ≥ 110 px',
  (rects['#joy'] || {}).right - (rects['#joy'] || {}).left >= 110,
  (rects['#joy'] || {}).right - (rects['#joy'] || {}).left);
check('safe-area учтена у кнопок', (html.match(/env\(safe-area-inset-/g) || []).length >= 12,
  (html.match(/env\(safe-area-inset-/g) || []).length);
check('кнопки не наезжают друг на друга и на HUD', layout.clashes(WATCH, VP, html).length === 0, layout.clashes(WATCH, VP, html));
check('все кнопки внутри экрана на 8 разрешениях', layout.offscreen(WATCH, VP, html).length === 0, layout.offscreen(WATCH, VP, html));
check('есть отдельный слой для ландшафта', /@media \(pointer:coarse\) and \(orientation:landscape\) and \(max-height:520px\)/.test(html));

/* ---------------------------------------------- 7. запуск и первые кадры */
function fakeGL(canvas) {
  const base = {
    canvas,
    get drawingBufferWidth() { return canvas.width; },
    get drawingBufferHeight() { return canvas.height; },
    getParameter(p) {
      if (p === 0x1F00 || p === 0x1F01) return 'WebKit';
      if (p === 0x1F02) return 'WebGL 1.0 (stub)';
      if (p === 0x8B8C) return 'WebGL GLSL ES 1.0 (stub)';
      if (p === 0x0D3A || p === 0x0D05) return [1, 4096];
      return 4096;
    },
    getExtension(n) {
      if (/lose_context|debug_renderer_info/i.test(n)) return null;
      if (/vertex_array_object/i.test(n)) return { createVertexArrayOES: () => ({}), bindVertexArrayOES() {}, deleteVertexArrayOES() {} };
      if (/instanced/i.test(n)) return { drawArraysInstancedANGLE() {}, drawElementsInstancedANGLE() {}, vertexAttribDivisorANGLE() {} };
      if (/depth_texture/i.test(n)) return { UNSIGNED_INT_24_8_WEBGL: 0x84FA };
      if (/draw_buffers/i.test(n)) return { MAX_COLOR_ATTACHMENTS_WEBGL: 8, MAX_DRAW_BUFFERS_WEBGL: 8 };
      if (/texture_float|anisotropic|derivatives/i.test(n)) return {};
      return null;
    },
    getShaderPrecisionFormat: () => ({ precision: 23, rangeMin: 127, rangeMax: 127 }),
    getContextAttributes: () => ({ alpha: true, antialias: true, depth: true, stencil: true, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'default' }),
    getSupportedExtensions: () => [],
    getProgramParameter: () => true,
    getShaderParameter: () => true,
    getActiveAttrib: () => ({ name: 'a', size: 1, type: 5126 }),
    getActiveUniform: () => ({ name: 'u', size: 1, type: 5126 }),
    getAttribLocation: () => 0,
    getUniformLocation: () => ({}),
    createShader: () => ({}), createProgram: () => ({}), createBuffer: () => ({}),
    createTexture: () => ({}), createFramebuffer: () => ({}), createRenderbuffer: () => ({}),
    getError: () => 0, isContextLost: () => false, checkFramebufferStatus: () => 36053,
    getShaderInfoLog: () => '', getProgramInfoLog: () => '', getShaderSource: () => '',
    shaderSource() {}, compileShader() {}, linkProgram() {}, attachShader() {},
  };
  return new Proxy(base, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k === 'symbol') return undefined;
      if (/^[A-Z0-9_]+$/.test(k)) return 0;
      return () => null;
    },
    has() { return true; },
  });
}
function fake2d(canvas) {
  const mk = (w, h) => ({ data: new Uint8ClampedArray(Math.max(4, (w | 0) * (h | 0) * 4)), width: w | 0, height: h | 0 });
  const target = {
    canvas,
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => ({}),
    createImageData: (w, h) => mk(w, h),
    getImageData: (x, y, w, h) => mk(w, h),
    measureText: () => ({ width: 10 }),
  };
  return new Proxy(target, { get(t, k) { if (k in t) return t[k]; if (typeof k === 'symbol') return undefined; return () => null; } });
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const HARD = /ReferenceError|TypeError|SyntaxError|is not a function|Cannot read|before initialization|uninitialized/i;

(async () => {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;

  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    const msg = e.detail && e.detail.stack ? String(e.detail.stack).split('\n').slice(0, 2).join(' | ') : e.message;
    if (/Not implemented|navigation|Could not parse CSS/i.test(msg)) return;
    errors.push(msg);
  });
  vc.on('error', (...a) => errors.push('console.error: ' + a.map(String).join(' ')));
  const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, url: base + '/games/ocean-coins.html', virtualConsole: vc });
  const w = dom.window;
  w.HTMLCanvasElement.prototype.getContext = function (t) {
    if (t === 'webgl' || t === 'experimental-webgl' || t === 'webgl2') return fakeGL(this);
    if (t === '2d') return fake2d(this);
    return null;
  };
  Object.defineProperty(w, 'innerWidth', { value: 390, configurable: true });
  Object.defineProperty(w, 'innerHeight', { value: 844, configurable: true });
  Object.defineProperty(w, 'devicePixelRatio', { value: 3, configurable: true });
  if (!w.matchMedia) w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  if (!w.ResizeObserver) w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  w.addEventListener('error', (e) => errors.push('window.onerror: ' + (e.message || e.error)));
  await wait(1200);

  const hard = errors.filter((e) => HARD.test(e));
  check('страница грузится без ошибок JS', hard.length === 0, hard.slice(0, 2));
  check('VGReward подключён до кода игры', typeof w.VGReward === 'object', typeof w.VGReward);
  const canvas = w.document.querySelector('canvas');
  check('холст получил размер', !!canvas && canvas.width > 0 && canvas.height > 0, canvas && [canvas.width, canvas.height]);
  check('меню видно на старте', w.document.getElementById('menu').classList.contains('show'));

  try { w.document.getElementById('bPlay').click(); } catch (e) { errors.push('click: ' + e.message); }
  await wait(900);
  const after = errors.filter((e) => HARD.test(e));
  check('старт игры проходит без ошибок', after.length === 0, after.slice(0, 2));
  check('меню закрылось, HUD показан',
    !w.document.getElementById('menu').classList.contains('show') && !w.document.getElementById('hud').classList.contains('hide'));
  check('счётчик V выводится в HUD', /\d/.test(w.document.getElementById('hV').textContent || ''),
    w.document.getElementById('hV').textContent);
  check('подсказка управления появилась', /гарпун|harpoon/i.test(w.document.getElementById('hint').textContent || ''),
    (w.document.getElementById('hint').textContent || '').slice(0, 60));
  try { dom.window.close(); } catch (e) {}

  /* ------------------------------------------- английская версия (?lang=en) */
  {
    const vcEn = new VirtualConsole();
    const enErrors = [];
    vcEn.on('jsdomError', (e) => { if (!/Not implemented|Could not parse CSS/i.test(e.message)) enErrors.push(e.message); });
    const en = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, url: base + '/games/ocean-coins.html?lang=en', virtualConsole: vcEn });
    const ew = en.window;
    ew.HTMLCanvasElement.prototype.getContext = function (t) {
      if (t === 'webgl' || t === 'experimental-webgl' || t === 'webgl2') return fakeGL(this);
      if (t === '2d') return fake2d(this);
      return null;
    };
    Object.defineProperty(ew, 'innerWidth', { value: 390, configurable: true });
    Object.defineProperty(ew, 'innerHeight', { value: 844, configurable: true });
    Object.defineProperty(ew, 'devicePixelRatio', { value: 3, configurable: true });
    if (!ew.matchMedia) ew.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    if (!ew.ResizeObserver) ew.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    await wait(1100);
    const ed = ew.document;
    check('?lang=en включает английский', ed.documentElement.getAttribute('lang') === 'en', ed.documentElement.getAttribute('lang'));
    check('кнопка старта переведена', String(ed.getElementById('bPlay').textContent).trim() === 'Play',
      String(ed.getElementById('bPlay').textContent));
    check('подзаголовок меню переведён', /Dive/.test(ed.querySelector('#menu p').textContent || ''),
      (ed.querySelector('#menu p').textContent || '').slice(0, 40));
    ed.getElementById('btns').querySelector('[data-m="shop"]').click();
    await wait(120);
    check('магазин переведён', /Diver suit/.test(ed.getElementById('shopBody').textContent || ''),
      (ed.getElementById('shopBody').textContent || '').replace(/\s+/g, ' ').slice(0, 60));
    check('английская версия без ошибок JS', enErrors.filter((e) => HARD.test(e)).length === 0, enErrors.slice(0, 2));
    try { en.window.close(); } catch (e) {}
  }

  server.close();

  if (failures.length) console.log('ПРОВАЛЫ:\n  ' + failures.join('\n  '));
  console.log('ИТОГО: ' + passed + '/' + (passed + failures.length) + ' проверок пройдено');
  process.exit(failures.length ? 1 : 0);
})();
