#!/usr/bin/env node
/*
 * Картинки всех шаблонов построек MiniCraft — для глазной проверки «доделан ли
 * дом»: фундамент, стены, окна, дверь, крыша, труба. Рисуется тем же набором
 * блоков, что игра ставит в мир (tools/minicraft_build_module.js), поэтому
 * картинка совпадает с постройкой.
 *
 * Изометрический рендер без зависимостей: кубики с тремя гранями и PNG на
 * выходе. Файлы кладутся в docs/builds/<ключ>.png и общий лист docs/builds/all.png.
 *
 *     node tools/render_builds.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'builds');

/* ---------------------------------------------------------- модуль шаблонов */
let src = fs.readFileSync(path.join(__dirname, 'minicraft_build_module.js'), 'utf8');
src = src.slice(0, src.indexOf('/* ------------------------------------------------------- горячие клавиши */'));
const ctx = {
  Vh: 1, Gh: 2, Wh: 3, Bl: 4, Hh: 5, CB: 6, SB: 7, Xh: 8, PL: 9, DW: 10, RF: 11, SL: 12, PS: 13, GL: 14,
  Ai: 0, qh: 15, ct: 128, dn: 64,
  tt: (ru) => ru, window: {},
  document: {
    addEventListener() {}, querySelector() { return null; }, getElementById() { return null; },
    createElement() { return { style: {}, classList: { add() {} } }; }, body: { appendChild() {} }
  },
  addEventListener() {}, setTimeout: () => 0, clearTimeout() {},
  localStorage: { getItem: () => null, setItem() {} }, console
};
vm.createContext(ctx);
vm.runInContext(src, ctx);
const { MCB_TEMPLATES, mcbBuildPlan } = ctx;

/* ------------------------------------------------------------- материалы */
const COLORS = {
  1: [0x6f, 0xb0, 0x4a], 2: [0x8a, 0x5a, 0x34], 3: [0xe0, 0xcf, 0x94], 4: [0x3f, 0x8b, 0x3a],
  5: [0x8d, 0x95, 0x9b], 6: [0x6f, 0x76, 0x7c], 7: [0xa8, 0x56, 0x4a], 8: [0x6b, 0x4a, 0x2c],
  9: [0xc3, 0x9a, 0x5e], 10: [0x7a, 0x56, 0x36], 11: [0xb4, 0x50, 0x3f], 12: [0x5b, 0x64, 0x72],
  13: [0xe8, 0xe2, 0xd4], 14: [0x9f, 0xd8, 0xe6]
};

/* ------------------------------------------------------------- рисование */
function makeCanvas(w, h, bg) {
  const px = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    px[i * 3] = bg[0]; px[i * 3 + 1] = bg[1]; px[i * 3 + 2] = bg[2];
  }
  return { w, h, px };
}
function blend(cv, x, y, rgb, a) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= cv.w || y >= cv.h) return;
  const i = (y * cv.w + x) * 3;
  for (let k = 0; k < 3; k++) cv.px[i + k] = Math.round(cv.px[i + k] * (1 - a) + rgb[k] * a);
}
function fillPoly(cv, pts, rgb, a) {
  let minY = Infinity, maxY = -Infinity;
  for (const p of pts) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
  for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const p1 = pts[i], p2 = pts[(i + 1) % pts.length];
      if ((p1[1] <= y && p2[1] > y) || (p2[1] <= y && p1[1] > y)) {
        xs.push(p1[0] + (y - p1[1]) / (p2[1] - p1[1]) * (p2[0] - p1[0]));
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      for (let x = Math.ceil(xs[i]); x <= Math.floor(xs[i + 1]); x++) blend(cv, x, y, rgb, a);
    }
  }
}

/* Изометрия: ось Y вверх, кубик — ромб сверху и две боковые грани. */
function isoPoint(x, z, y, tw, th, ox, oy) {
  return [ox + (x - z) * tw / 2, oy + (x + z) * th / 2 - y * th];
}

function renderBlocks(blocks, opts) {
  const o = opts || {};
  const tw = o.tile || 22, th = tw / 2;
  const xs = blocks.map(b => b.x), ys = blocks.map(b => b.y), zs = blocks.map(b => b.z);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs), y1 = Math.max(...ys);
  const pad = 10;
  const width = Math.round((x1 - x0 + z1 - z0 + 2) * tw / 2) + pad * 2;
  const height = Math.round((x1 - x0 + z1 - z0 + 2) * th / 2 + (y1 + 2) * th) + pad * 2;
  const cv = makeCanvas(width, height, [0x0f, 0x18, 0x20]);
  const ox = pad + (z1 - z0) * tw / 2 + tw / 2;
  const oy = pad + th * (y1 + 1.2);
  const sorted = blocks.slice().sort((a, b) => (a.x + a.z) - (b.x + b.z) || a.y - b.y);
  for (const b of sorted) {
    const c = COLORS[b.id] || [0xff, 0x00, 0xff];
    const a = b.id === 14 ? 0.55 : 1;       // стекло чуть прозрачное
    const top = [
      isoPoint(b.x - .5, b.z - .5, b.y + .5, tw, th, ox, oy),
      isoPoint(b.x + .5, b.z - .5, b.y + .5, tw, th, ox, oy),
      isoPoint(b.x + .5, b.z + .5, b.y + .5, tw, th, ox, oy),
      isoPoint(b.x - .5, b.z + .5, b.y + .5, tw, th, ox, oy)
    ];
    /* Передняя левая грань (+z) и передняя правая (+x). */
    const left = [
      isoPoint(b.x - .5, b.z + .5, b.y + .5, tw, th, ox, oy),
      isoPoint(b.x + .5, b.z + .5, b.y + .5, tw, th, ox, oy),
      isoPoint(b.x + .5, b.z + .5, b.y - .5, tw, th, ox, oy),
      isoPoint(b.x - .5, b.z + .5, b.y - .5, tw, th, ox, oy)
    ];
    const right = [
      isoPoint(b.x + .5, b.z + .5, b.y + .5, tw, th, ox, oy),
      isoPoint(b.x + .5, b.z - .5, b.y + .5, tw, th, ox, oy),
      isoPoint(b.x + .5, b.z - .5, b.y - .5, tw, th, ox, oy),
      isoPoint(b.x + .5, b.z + .5, b.y - .5, tw, th, ox, oy)
    ];
    fillPoly(cv, left, c.map(v => Math.round(v * 0.78)), a);
    fillPoly(cv, right, c.map(v => Math.round(v * 0.6)), a);
    fillPoly(cv, top, c.map(v => Math.min(255, Math.round(v * 1.15))), a);
  }
  return cv;
}

/* ------------------------------------------------------------------- PNG */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function writePng(file, cv) {
  const raw = Buffer.alloc((cv.w * 3 + 1) * cv.h);
  for (let y = 0; y < cv.h; y++) {
    raw[y * (cv.w * 3 + 1)] = 0;
    Buffer.from(cv.px.buffer, y * cv.w * 3, cv.w * 3).copy(raw, y * (cv.w * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(cv.w, 0);
  ihdr.writeUInt32BE(cv.h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
  fs.writeFileSync(file, png);
  return png.length;
}

/* --------------------------------------------------------------- отрисовка */
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
let total = 0;
const entries = [];
for (const tpl of MCB_TEMPLATES) {
  const blocks = mcbBuildPlan(tpl.key);
  if (!blocks.length) continue;
  const cv = renderBlocks(blocks, { tile: 22 });
  const file = path.join(OUT, tpl.key + '.png');
  total += writePng(file, cv);
  entries.push({ key: tpl.key, ru: tpl.ru, blocks: blocks.length, w: cv.w, h: cv.h, file });
}

/* Общий лист: все постройки в сетке 6 × 4. */
const cols = 6, tileW = 260, tileH = 240;
const rows = Math.ceil(entries.length / cols);
const sheet = makeCanvas(cols * tileW, rows * tileH, [0x0f, 0x18, 0x20]);
entries.forEach((e, i) => {
  const cx = (i % cols) * tileW, cy = Math.floor(i / cols) * tileH;
  const cv = renderBlocks(mcbBuildPlan(e.key), { tile: 12 });
  for (let y = 0; y < Math.min(cv.h, tileH - 4); y++) {
    for (let x = 0; x < Math.min(cv.w, tileW - 4); x++) {
      const si = (y * cv.w + x) * 3, di = ((cy + y) * sheet.w + cx + x) * 3;
      sheet.px[di] = cv.px[si]; sheet.px[di + 1] = cv.px[si + 1]; sheet.px[di + 2] = cv.px[si + 2];
    }
  }
});
total += writePng(path.join(OUT, 'all.png'), sheet);

console.log('построек: ' + entries.length + ', картинок: ' + (entries.length + 1) +
  ', всего ' + Math.round(total / 1024) + ' КБ');
for (const e of entries) console.log('  ' + e.key.padEnd(14) + e.ru.padEnd(28) + e.blocks + ' блоков');
