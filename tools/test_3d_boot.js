#!/usr/bin/env node
/**
 * test_3d_boot.js — запуск 3D-игр платформы в jsdom с поддельным WebGL.
 *
 * Зачем: обычные тесты (test_game_boot) запускают только 2D-игры — там WebGL
 * не нужен. Из-за этого инициализация трёхмерных игр не проверялась вообще, и
 * в «Кристальный рубеж» на проде вылезла ошибка уровня языка
 * («Cannot access 'CONE' before initialization»): деревня строила реквизит
 * раньше, чем объявлялись const-хелперы геометрии. Страница показывала
 * «Ошибка: …» вместо кнопки «Начать приключение».
 *
 * Тест поднимает локальный сервер статики, подсовывает jsdom поддельные
 * WebGL/2D контексты и проверяет, что игра грузится без ошибок, кнопка старта
 * жива, холст получил размер, а после нажатия «играть» первые кадры проходят
 * без исключений.
 */
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.mp3': 'audio/mpeg',
};

/* Игры, которые обязаны грузиться в поддельном WebGL. sky-isle требует
   DecompressionStream (его нет в jsdom), redline — потоковый холст, поэтому
   они проверяются ссылками в test_game_boot. */
const GAMES = [
  { id: 'crystal-frontier', start: 'start' },
  { id: 'ocean-coins', start: 'menu', click: 'bPlay' },
  { id: 'minicraft', start: null },
];

const results = [];
function check(name, ok, extra) {
  results.push((ok ? 'PASS' : 'FAIL') + ' · ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : ''));
}

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
    getError: () => 0,
    isContextLost: () => false,
    checkFramebufferStatus: () => 36053,
    getShaderInfoLog: () => '', getProgramInfoLog: () => '', getShaderSource: () => '',
    shaderSource() {}, compileShader() {}, linkProgram() {}, attachShader() {},
    getUniformBlockIndex: () => 0,
  };
  /* Всё остальное (bindBuffer, drawElements, texImage2D…) — пустые методы. */
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
    getContextAttributes: () => ({}),
  };
  return new Proxy(target, { get(t, k) { if (k in t) return t[k]; if (typeof k === 'symbol') return undefined; return () => null; } });
}

const HARD = /ReferenceError|TypeError|SyntaxError|is not a function|Cannot read|before initialization|uninitialized/i;

function boot(id, html, url) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    const msg = e.detail && e.detail.stack ? String(e.detail.stack).split('\n').slice(0, 2).join(' | ') : e.message;
    if (/Not implemented|navigation|Could not parse CSS/i.test(msg)) return;
    errors.push(msg);
  });
  vc.on('error', (...a) => errors.push('console.error: ' + a.map(String).join(' ')));

  const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, url, virtualConsole: vc });
  const w = dom.window;
  w.HTMLCanvasElement.prototype.getContext = function (t) {
    if (t === 'webgl' || t === 'experimental-webgl' || t === 'webgl2') return fakeGL(this);
    if (t === '2d') return fake2d(this);
    return null;
  };
  w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
  Object.defineProperty(w, 'innerWidth', { value: 390, configurable: true });
  Object.defineProperty(w, 'innerHeight', { value: 844, configurable: true });
  Object.defineProperty(w, 'devicePixelRatio', { value: 3, configurable: true });
  if (!w.matchMedia) w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  if (!w.ResizeObserver) w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  try {
    Object.defineProperty(w.document, 'hidden', { value: false, configurable: true });
    Object.defineProperty(w.document, 'visibilityState', { value: 'visible', configurable: true });
  } catch (e) {}
  w.addEventListener('error', (e) => errors.push('window.onerror: ' + (e.message || e.error)));
  return { w, errors, close() { try { w.close(); } catch (e) {} } };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;

  for (const game of GAMES) {
    const file = path.join(ROOT, 'games', game.id + '.html');
    if (!fs.existsSync(file)) { check('3D-игра существует: ' + game.id, false); continue; }
    const html = fs.readFileSync(file, 'utf8');
    const { w, errors, close } = boot(game.id, html, base + '/games/' + game.id + '.html');
    await wait(1400);

    const play = w.document.getElementById('play');
    const playText = play ? String(play.textContent || '').trim() : '';
    const canvas = w.document.querySelector('canvas');
    const hard = errors.filter((e) => HARD.test(e));

    check(game.id + ': грузится без ошибок JS', hard.length === 0, hard.slice(0, 2));
    if (play) {
      check(game.id + ': кнопка старта не превратилась в сообщение об ошибке',
        !/^Ошибка|^Error/.test(playText), playText.slice(0, 60));
    }
    if (canvas) {
      check(game.id + ': холст получил размер', canvas.width > 0 && canvas.height > 0, [canvas.width, canvas.height]);
    }

    if (game.start) {
      /* Жмём именно кнопку «Начать приключение» — она запускает мир и цикл. */
      const starter = game.click ? w.document.getElementById(game.click) : play;
      try { if (starter) starter.click(); } catch (e) { errors.push('click: ' + e.message); }
      await wait(900);
      const after = errors.filter((e) => HARD.test(e));
      check(game.id + ': первые кадры после старта без ошибок', after.length === 0, after.slice(0, 2));
      const st = w.document.getElementById(game.start);
      const switched = st ? (st.style.display === 'none' || !st.classList.contains('show')) : false;
      check(game.id + ': старт действительно переключил экран', switched,
        st ? String(st.style.display) + '/' + st.className : 'нет');
    }
    close();
  }

  server.close();
  console.log(results.join('\n'));
  const failed = results.filter((r) => r.startsWith('FAIL')).length;
  console.log('\nИТОГО: ' + (results.length - failed) + '/' + results.length + ' проверок пройдено');
  process.exit(failed ? 1 : 0);
})();
