#!/usr/bin/env node
/*
 * Диагностика запуска 2D-игр в jsdom: страница грузится целиком со всеми
 * скриптами (включая /assets/vg/js/game-kit.js), перехватываются ошибки,
 * затем проигрывается реальный поток сообщений платформы.
 *
 *     NODE_PATH=/tmp/dom/node_modules node tools/diag_game_boot.js games/platformer.html [games/shooter.html ...]
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const files = process.argv.slice(2);
const ROOT = path.join(__dirname, '..');

function fake2d(canvas) {
  const grad = { addColorStop() {} };
  const target = {
    canvas,
    createLinearGradient() { return grad; },
    createRadialGradient() { return grad; },
    createPattern() { return null; },
    measureText() { return { width: 10 }; },
    getImageData(x, y, w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; },
    putImageData() {}, createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; },
  };
  return new Proxy(target, { get(t, p) { if (p in t) return t[p]; return function () {}; }, set(t, p, v) { t[p] = v; return true; } });
}

const BASE = process.env.GAME_BASE || '';

async function boot(file) {
  const abs = path.isAbsolute(file) ? file : path.join(ROOT, file);
  const html = fs.readFileSync(abs, 'utf8');
  const errors = [];
  const logs = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push('[jsdomError] ' + (e.detail && e.detail.stack ? String(e.detail.stack).split('\n')[0] : e.message)));
  vc.on('error', (...a) => errors.push('[console.error] ' + a.join(' ')));
  vc.on('warn', (...a) => logs.push('[warn] ' + a.join(' ')));
  vc.on('log', (...a) => logs.push('[log] ' + a.join(' ')));

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    url: BASE ? BASE.replace(/\/$/, '') + '/games/' + path.basename(abs) : 'file://' + abs,
    virtualConsole: vc,
  });
  const w = dom.window;
  w.HTMLCanvasElement.prototype.getContext = function () { return fake2d(this); };
  w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
  Object.defineProperty(w, 'innerWidth', { value: 412, configurable: true });
  Object.defineProperty(w, 'innerHeight', { value: 915, configurable: true });
  Object.defineProperty(w, 'devicePixelRatio', { value: 2, configurable: true });
  if (!w.matchMedia) w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  if (!w.ResizeObserver) w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  w.addEventListener('error', (e) => errors.push('[window.onerror] ' + (e.message || e.error)));
  w.addEventListener('unhandledrejection', (e) => errors.push('[unhandled] ' + e.reason));
  const posted = [];
  try { Object.defineProperty(w, 'parent', { value: { postMessage(m) { posted.push(m); } }, configurable: true }); } catch (e) {}

  await new Promise((r) => setTimeout(r, 400));
  return { w, errors, logs, posted };
}

(async () => {
  for (const f of files) {
    const name = path.basename(f);
    const { w, errors, posted, logs } = await boot(f);
    const doc = w.document;
    const canvas = doc.getElementById('c') || doc.querySelector('canvas');
    const info = {
      file: name,
      canvas: canvas ? {
        attr: [canvas.width, canvas.height],
        css: canvas.style.cssText.slice(0, 120),
        w: canvas.clientWidth, h: canvas.clientHeight,
      } : null,
      overlays: [...doc.querySelectorAll('[id]')].map((n) => n.id).filter((id) => /over|menu|start|load/i.test(id)),
      vgReward: typeof w.VGReward,
      vgStrings: typeof w.VG_GAME_STRINGS,
      errors: errors.slice(0, 12),
      posted: posted.slice(0, 5).map((m) => (m && m.type) || typeof m),
      logs: logs.slice(-6),
    };
    console.log(JSON.stringify(info, null, 2));
    w.close();
  }
})();
