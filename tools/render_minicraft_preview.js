#!/usr/bin/env node
/*
 * Превью MiniCraft без браузера: карта мира сверху и портрет жителя.
 *
 * Мир генерируется настоящим кодом игры (jsdom + заглушка WebGL), после чего
 * верхний блок каждой колонки рисуется цветом материала, вода — полупрозрачным
 * синим, а постройки и монеты — отдельными отметками. Житель рисуется как
 * плоская ортопроекция всех его кубов, поэтому на картинке видно руки, нос по
 * центру лица и симметрию.
 *
 *     NODE_PATH=/tmp/dom/node_modules node tools/render_minicraft_preview.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { createCanvas } = require('@napi-rs/canvas');

const HTML = process.env.MINICRAFT_HTML || path.join(__dirname, '..', 'games', 'minicraft.html');
const OUT = process.env.OUT_DIR || path.join(__dirname, '..', 'backups', 'preview');
const html = fs.readFileSync(HTML, 'utf8');

const vc = new VirtualConsole();
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true,
  url: 'http://localhost/games/minicraft.html', virtualConsole: vc });
const w = dom.window;
const C = { VERSION: 7938, MAX_TEXTURE_SIZE: 3379, MAX_VIEWPORT_DIMS: 3386, MAX_TEXTURE_IMAGE_UNITS: 34930,
  MAX_VERTEX_TEXTURE_IMAGE_UNITS: 35660, MAX_COMBINED_TEXTURE_IMAGE_UNITS: 35661, MAX_VERTEX_ATTRIBS: 34921,
  MAX_VERTEX_UNIFORM_VECTORS: 36347, MAX_VARYING_VECTORS: 36348, MAX_FRAGMENT_UNIFORM_VECTORS: 36349,
  MAX_CUBE_MAP_TEXTURE_SIZE: 34076, MAX_SAMPLES: 36183, SHADING_LANGUAGE_VERSION: 35724, MAX_TEXTURE_MAX_ANISOTROPY_EXT: 34047 };
function fakeGL(canvas) {
  const ext = { EXT_texture_filter_anisotropic: { MAX_TEXTURE_MAX_ANISOTROPY_EXT: 34047 }, OES_texture_float_linear: {},
    WEBGL_lose_context: { loseContext() {} }, EXT_color_buffer_float: {}, EXT_blend_minmax: {}, EXT_frag_depth: {},
    WEBGL_depth_texture: {}, OES_vertex_array_object: {} };
  const target = { canvas, drawingBufferWidth: 1280, drawingBufferHeight: 720,
    getParameter(p) {
      if (p === 7938) return 'WebGL 2.0 (fake)';
      if (p === 35724) return 'WebGL GLSL ES 3.00 (fake)';
      if (p === 3386 || p === 3379 || p === 34076) return [16384, 16384];
      if (p === 34921 || p === 34930 || p === 35660 || p === 35661) return 16;
      if (p === 36347 || p === 36348 || p === 36349) return 1024;
      if (p === 36183) return 4;
      return 0;
    },
    getExtension(name) { return ext[name] || null; },
    getSupportedExtensions() { return Object.keys(ext); },
    getShaderPrecisionFormat() { return { precision: 23, rangeMin: 127, rangeMax: 127 }; },
    getContextAttributes() { return { alpha: true, antialias: false, depth: true, stencil: true }; },
    isContextLost() { return false; },
    createShader() { return {}; }, createProgram() { return {}; }, createBuffer() { return {}; },
    createTexture() { return {}; }, createFramebuffer() { return {}; }, createRenderbuffer() { return {}; },
    createVertexArray() { return {}; }, createQuery() { return {}; },
    getProgramParameter() { return true; }, getShaderParameter() { return true; },
    getShaderInfoLog() { return ''; }, getProgramInfoLog() { return ''; },
    getUniformLocation() { return {}; }, getAttribLocation() { return 0; },
    getActiveUniform() { return { name: 'u', size: 1, type: 5126 }; },
    getActiveAttrib() { return { name: 'a', size: 1, type: 5126 }; },
    getUniformBlockIndex() { return 0; }, checkFramebufferStatus() { return 36053; },
    getError() { return 0; }, readPixels() {} };
  return new Proxy(target, { get(t, p) {
    if (p in t) return t[p];
    if (p in C) return C[p];
    if (typeof p === 'string' && /^[A-Z0-9_]+$/.test(p)) return 1;
    return function () { return undefined; };
  } });
}
function fake2d() {
  const grad = { addColorStop() {} };
  const target = { createLinearGradient() { return grad; }, createRadialGradient() { return grad; },
    createPattern() { return null; }, measureText() { return { width: 10 }; },
    getImageData(x, y, w2, h2) { return { data: new Uint8ClampedArray(w2 * h2 * 4), width: w2, height: h2 }; },
    putImageData() {}, createImageData(w2, h2) { return { data: new Uint8ClampedArray(w2 * h2 * 4) }; } };
  return new Proxy(target, { get(t, p) { if (p in t) return t[p]; return function () {}; }, set(t, p, v) { t[p] = v; return true; } });
}
w.HTMLCanvasElement.prototype.getContext = function (type) {
  if (type === '2d') { const c = fake2d(); c.canvas = this; return c; }
  return fakeGL(this);
};
w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
Object.defineProperty(w, 'innerWidth', { value: 1280, configurable: true });
Object.defineProperty(w, 'innerHeight', { value: 720, configurable: true });
Object.defineProperty(w, 'devicePixelRatio', { value: 1, configurable: true });
w.matchMedia = w.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
w.parent = { postMessage() {}, window: w };
w.requestAnimationFrame = () => 1;

const openTag = '<script id="minicraft-runtime">';
let runtime = html.slice(html.indexOf(openTag) + openTag.length, html.indexOf('</script>', html.indexOf(openTag)));
const idx = runtime.lastIndexOf('\n})();');
runtime = runtime.slice(0, idx) + `
window.__map = () => ({ F, cs, ir, mcxWaterAt, mcxVillages, mcxWaterList, mcxChestSpots,
  startWorld: Kh, mc: () => Mt, CT: ct, DN: dn, mcxMakeVillager, mcxWorldStats,
  ids: { air: Ai, grass: Vh, ground: Gh, stone: Hh, sand: Wh, wood: Xh, leaf: Bl } });
` + runtime.slice(idx);
w.eval(runtime);

const api = () => w.__map();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const COLORS = {
  1: '#6aa84f', // трава
  2: '#8a6a45', // земля/дорога
  3: '#9aa0a6', // камень
  4: '#d9cba4', // песок
  5: '#8b5a2b', // дерево
  6: '#315f31'  // листва
};

function drawMap(W) {
  const ids = W.ids;
  const size = W.CT;
  const scale = 3;
  const canvas = createCanvas(size * scale, size * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0b0e14';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const colors = { [ids.grass]: COLORS[1], [ids.ground]: COLORS[2], [ids.stone]: COLORS[3],
    [ids.sand]: COLORS[4], [ids.wood]: COLORS[5], [ids.leaf]: COLORS[6] };
  for (let x = 0; x < size; x++) {
    for (let z = 0; z < size; z++) {
      const y = W.ir(x, z);
      const top = W.cs(x, y - 1, z);
      let color = colors[top] || '#4a4a4a';
      const water = W.mcxWaterAt(x, z);
      if (water) {
        const depth = Math.max(0, water - (y - 1));
        ctx.fillStyle = depth > 1 ? '#1f6fb0' : '#3f97d6';
      } else {
        ctx.fillStyle = color;
      }
      ctx.fillRect(x * scale, z * scale, scale, scale);
      // мягкая тень от высоты: чем выше колонка, тем светлее
      const shade = Math.min(0.28, Math.max(0, (y - 8) * 0.02));
      if (shade > 0.01) {
        ctx.fillStyle = 'rgba(255,255,255,' + shade.toFixed(3) + ')';
        ctx.fillRect(x * scale, z * scale, scale, scale);
      }
    }
  }
  // деревни
  ctx.font = 'bold 11px sans-serif';
  for (const v of W.mcxVillages) {
    ctx.strokeStyle = 'rgba(198,255,61,.85)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(v.x * scale, v.z * scale, v.r * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(198,255,61,.9)';
    ctx.fillText(v.name, v.x * scale - 18, v.z * scale - 4);
  }
  // сундуки
  for (const c of W.mcxChestSpots) {
    ctx.fillStyle = c.kind === 'treasure' ? '#ffd166' : '#ff9f43';
    ctx.fillRect(c.x * scale - 1.5, c.z * scale - 1.5, 3, 3);
  }
  return canvas;
}


/* ---------------------------------------------------------------------------
   Изометрия деревни: настоящая проверка архитектуры глазами. Каждый блок
   рисуется ромбом сверху и двумя гранями сбоку, порядок отрисовки — от дальних
   к ближним, поэтому крыши, трубы и балконы читаются как в игре.
   --------------------------------------------------------------------------- */
const ISO = {
  1: ['#74a94d', '#5d8c3d'], 2: ['#8a6a45', '#6f5436'], 3: ['#93989c', '#767b7f'],
  4: ['#e2d2a4', '#c8b98d'], 5: ['#8b5a2b', '#6f4721'], 6: ['#3f7a35', '#2f5c28'],
  7: ['#ffd166', '#e0b34a'], 8: ['#4b4f55', '#3a3d42'],
  9: ['#8f9498', '#73787c'], 10: ['#7d8286', '#63686c'], 11: ['#5a4229', '#463320'],
  12: ['#b08a54', '#8d6c3f'], 13: ['#a04a38', '#7d3628'], 14: ['#e7dcc2', '#c9bfa6'],
  15: ['#a9ccd8', '#7f9ea9'], 16: ['#49525c', '#363d45']
};

function drawVillage(W, index, out) {
  const v = W.mcxVillages[index];
  const R = 16;
  const top = v.base + 16;
  const blocks = [];
  for (let x = v.x - R; x <= v.x + R; x++) {
    for (let z = v.z - R; z <= v.z + R; z++) {
      for (let y = v.base - 1; y <= top; y++) {
        const id = W.cs(x, y, z);
        if (!id || id === 8) continue;
        if (y > v.base && id === 2) continue;      // подземную землю не рисуем
        blocks.push({ x, y, z, id });
      }
    }
  }
  blocks.sort((a, b) => (a.x + a.z) - (b.x + b.z) || a.y - b.y);
  const tw = 9, th = 5, bh = 7;
  const w = (R * 2 + 10) * tw, h = (R * 2 + 3) * th + 18 * bh + 90;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0b0e14';
  ctx.fillRect(0, 0, w, h);
  const ox = w / 2, oy = 40 + R * 2 * th + 16 * bh;
  const proj = (x, y, z) => [ox + (x - z) * tw / 2, oy + (x + z) * th / 2 - y * bh];
  for (const b of blocks) {
    const [sx, sy] = proj(b.x - v.x, b.y, b.z - v.z);
    const [cTop, cSide] = ISO[b.id] || ['#555', '#444'];
    // верхняя грань
    ctx.fillStyle = cTop;
    ctx.beginPath();
    ctx.moveTo(sx, sy - th / 2);
    ctx.lineTo(sx + tw / 2, sy);
    ctx.lineTo(sx, sy + th / 2);
    ctx.lineTo(sx - tw / 2, sy);
    ctx.closePath();
    ctx.fill();
    // левая грань (темнее)
    ctx.fillStyle = cSide;
    ctx.beginPath();
    ctx.moveTo(sx - tw / 2, sy);
    ctx.lineTo(sx, sy + th / 2);
    ctx.lineTo(sx, sy + th / 2 + bh);
    ctx.lineTo(sx - tw / 2, sy + bh);
    ctx.closePath();
    ctx.fill();
    // правая грань (средняя)
    ctx.fillStyle = cSide;
    ctx.beginPath();
    ctx.moveTo(sx + tw / 2, sy);
    ctx.lineTo(sx, sy + th / 2);
    ctx.lineTo(sx, sy + th / 2 + bh);
    ctx.lineTo(sx + tw / 2, sy + bh);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = '#c6ff3d';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText('MiniCraft · ' + v.name + ' · стиль ' + v.style, 18, 28);
  ctx.strokeStyle = 'rgba(255,255,255,.12)';
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  fs.writeFileSync(out, canvas.toBuffer('image/png'));
  return out;
}

function drawVillager(W) {
  const group = W.mcxMakeVillager(0x3f7f52, 0xc9b26a);
  const parts = [];
  group.traverse((obj) => {
    if (!obj.geometry || !obj.geometry.parameters) return;
    const p = obj.geometry.parameters;
    let x = 0, y = 0, z = 0;
    let node = obj;
    while (node && node !== group) {
      x += node.position.x; y += node.position.y; z += node.position.z;
      node = node.parent;
    }
    parts.push({ x, y, z, w: p.width, h: p.height, d: p.depth,
      color: '#' + (obj.material && obj.material.color ? obj.material.color.getHexString() : '999999') });
  });
  const scale = 150;
  const canvas = createCanvas(560, 660);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#101622';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // ортопроекция: вид спереди (x — вправо, y — вверх), сортировка по z
  parts.sort((a, b) => a.z - b.z);
  const cx = canvas.width / 2, floorY = canvas.height - 80;
  for (const part of parts) {
    const pw = part.w * scale, ph = part.h * scale;
    const px = cx + part.x * scale - pw / 2;
    const py = floorY - (part.y + part.h / 2) * scale - ph / 2 + ph / 2;
    ctx.fillStyle = part.color;
    ctx.fillRect(px, floorY - (part.y + part.h) * scale, pw, ph);
    ctx.strokeStyle = 'rgba(0,0,0,.28)';
    ctx.lineWidth = 1;
    ctx.strokeRect(px + .5, floorY - (part.y + part.h) * scale + .5, pw - 1, ph - 1);
  }
  ctx.fillStyle = '#C6FF3D';
  ctx.font = 'bold 13px sans-serif';
  ctx.fillText('MiniCraft · житель: руки на плечах, нос по центру', 18, 26);
  ctx.fillStyle = '#9AA6B8';
  ctx.font = '11px sans-serif';
  ctx.fillText('вид спереди, все кубы модели', 18, 44);
  return canvas;
}

(async () => {
  api().startWorld();
  for (let i = 0; i < 300 && api().mc() !== 'ready'; i++) await wait(20);
  const W = api();
  console.log('фаза мира:', W.mc(), 'F:', typeof W.F, 'координаты:', W.CT, W.DN);
  fs.mkdirSync(OUT, { recursive: true });
  const map = drawMap(W);
  fs.writeFileSync(path.join(OUT, 'minicraft-world-map.png'), map.toBuffer('image/png'));
  const villager = drawVillager(W);
  fs.writeFileSync(path.join(OUT, 'minicraft-villager-arms.png'), villager.toBuffer('image/png'));
  /* Три деревни трёх стилей: сруб, камень и фахверк. */
  const seen = {};
  for (const v of W.mcxVillages) {
    if (seen[v.style]) continue;
    seen[v.style] = true;
    const file = path.join(OUT, 'minicraft-village-' + v.style + '.png');
    drawVillage(W, v.index, file);
    console.log('деревня ' + v.style + ': ' + file);
  }
  console.log('наполнение:', JSON.stringify(W.mcxWorldStats));
  console.log('карта:', path.join(OUT, 'minicraft-world-map.png'));
  console.log('житель:', path.join(OUT, 'minicraft-villager-arms.png'));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
