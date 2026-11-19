#!/usr/bin/env node
/**
 * tools/lib/css_layout.js — мини-движок каскада для проверки раскладки HUD.
 *
 * Без браузера: склеивает все <style> документа, применяет подходящие
 * @media-блоки для заданного размера экрана, считает px-геометрию (понимает
 * calc(), min(), max(), env(), vw/vh) и возвращает прямоугольники элементов.
 * На нём стоит проверка «кнопки не наезжают друг на друга» в тестах игр.
 */
'use strict';

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
let CACHE_HTML = '';
let CACHE_CSS = '';
function cssSource(html) {
  if (html !== CACHE_HTML) { CACHE_HTML = html; CACHE_CSS = stylesOf(html); }
  return CACHE_CSS;
}

function cssLayout(watch, w, h, html) {
  VW = w; VH = h;
  const style = {};
  /* Правила вида `body.mob #joy` описывают телефонный режим: считаем, что
     класс .mob на body есть (тест идёт с pointer:coarse), но применяем такие
     правила вторым проходом — у них выше специфичность. */
  const collect = (head, body, boost) => head.split(',').map((s) => s.trim()).forEach((raw) => {
    let sel = raw;
    let prio = boost;
    if (/^body\.mob\s+/.test(sel)) { sel = sel.replace(/^body\.mob\s+/, ''); prio = 1; }
    (stack[prio] = stack[prio] || []).push([sel, body]);
  });
  const stack = { 0: [], 1: [] };
  for (const block of cssBlocks(cssSource(html))) {
    if (block.head.startsWith('@media')) {
      if (mediaMatches(block.head, w, h)) cssBlocks(block.body).forEach((inner) => collect(inner.head, inner.body, 0));
    } else collect(block.head, block.body, 0);
  }
  for (const prio of [0, 1]) {
    for (const [sel, body] of stack[prio]) style[sel] = Object.assign(style[sel] || {}, cssDecls(body));
  }
  const rects = {};
  for (const sel of watch) {
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

function stylesOf(html) {
  return [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
}

/* Прямоугольники всех наблюдаемых элементов, которые реально видны
   (display:none и элементы без размеров пропускаем). */
function rectsFor(watch, w, h, html) {
  return cssLayout(watch, w, h, html);
}

/* Пары пересекающихся прямоугольников с зазором меньше 4 px. */
function clashes(watch, viewports, html) {
  const out = [];
  for (const [w, h] of viewports) {
    const rects = rectsFor(watch, w, h, html);
    const names = Object.keys(rects);
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const a = rects[names[i]];
        const b = rects[names[j]];
        if (a.left < b.right + 4 && b.left < a.right + 4 && a.top < b.bottom + 4 && b.top < a.bottom + 4) {
          out.push(w + 'x' + h + ' ' + names[i] + '/' + names[j]);
        }
      }
    }
  }
  return out;
}

/* Элементы, которые вылезли за экран. */
function offscreen(watch, viewports, html) {
  const out = [];
  for (const [w, h] of viewports) {
    const rects = rectsFor(watch, w, h, html);
    for (const name of Object.keys(rects)) {
      const r = rects[name];
      if (r.left < -1 || r.top < -1 || r.right > w + 1 || r.bottom > h + 1) out.push(w + 'x' + h + ' ' + name);
    }
  }
  return out;
}

module.exports = { cssLayout: rectsFor, clashes, offscreen, stylesOf };
