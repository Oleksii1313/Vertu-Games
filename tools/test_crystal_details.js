#!/usr/bin/env node
/*
 * Кристальный рубеж — детализация мира: мех монстров, объёмные люди, двор
 * деревни, LOD и цена этого всего по вызовам отрисовки.
 *
 * Игра трёхмерная, WebGL в тестовом окружении нет, поэтому тест берёт из
 * встроенного скрипта только чистые «сборочные» функции (геометрию и
 * материалы) и выполняет их на настоящем three.js — без рендера. Так ловятся
 * опечатки, NaN в вершинах и «взорвавшийся» бюджет мешей, которые иначе
 * всплыли бы только в браузере.
 *
 *     node tools/test_crystal_details.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'games', 'crystal-frontier.html'), 'utf8');
const three = fs.readFileSync(path.join(ROOT, 'assets/vg/js/three.min.js'), 'utf8');

const results = [];
function check(name, ok, extra) {
  results.push((ok ? 'PASS' : 'FAIL') + ' · ' + name +
    (extra === undefined ? '' : ' → ' + JSON.stringify(extra)));
}

const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const engine = inline[inline.length - 1];

/* ---------------- статические требования к коду --------------------------- */
check('есть система меха (слои-оболочки)', /function furShells\(/.test(engine));
check('мех режется текстурой прядей (alphaTest)', /map:furTex,alphaTest/.test(engine));
check('мех шевелится от ветра (windU в шейдере)', /uniforms\.uT=windU/.test(engine));
check('у меха считается LOD по дистанции', /q=Q\.fur\|\|3/.test(engine) && /e\.g\.visible=lodFar/.test(engine));
check('качество задаёт число слоёв меха', /fur:1\},?med/.test(engine.replace(/\s+/g, '')) ||
  /fur:1,/.test(engine) && /fur:5/.test(engine));
check('у монстров есть глаза, зрачки и блик', /function eyesMesh\(/.test(engine));
check('у монстров есть зубы', /Math\.PI,0,0\),bone/.test(engine));
check('у монстров есть когти', /clawC/.test(engine) && /CONE\(rad\*\.3,rad\*1\.05/.test(engine));
check('мех есть у нескольких типов (не только у одного)',
  (engine.match(/furShells\(/g) || []).length >= 5);
check('у людей объёмное тело с поясом и воротником', /воротник/.test(engine) && /пряжка/.test(engine));
check('у людей складки одежды', /складки подола/.test(engine));
check('у людей обувь', /ботинок/.test(engine));
check('лицо натянуто на изогнутую маску', /PlaneGeometry\(\.36,\.36,8,8\)/.test(engine));
check('у людей объёмные волосы', /волосы: шапка, пряди/.test(engine));
check('плавные повороты и покачивание при ходьбе', /n\.yawS=/.test(engine) && /n\.bob=/.test(engine));
check('голова поворачивается к собеседнику',
  /n\.a\.head\.rotation\.y=/.test(engine));
check('деревня: изгороди, колодец, бельё, дым', /function villageProps\(/.test(engine) &&
  /изгороди вдоль дворов/.test(engine) && /колодец на площади/.test(engine) &&
  /бельевая верёвка/.test(engine) && /дым из труб/.test(engine));
check('villageProps действительно вызывается при сборке деревни', /villageProps\(VC\);/.test(engine));

/* ---------------- живая сборка моделей на three.js ------------------------ */
const window = new JSDOM('<!doctype html><html><body><canvas id="c"></canvas></body></html>',
  { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/x.html',
    virtualConsole: (() => { const vc = new VirtualConsole(); vc.on('jsdomError', () => {}); return vc; })() }).window;

window.HTMLCanvasElement.prototype.getContext = function () {
  return new Proxy({}, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
      if (k === 'createImageData' || k === 'getImageData') return (x, y) => ({ data: new Uint8ClampedArray(Math.max(1, (x | 0) * (y | 0) * 4)) });
      if (k === 'measureText') return () => ({ width: 8 });
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; }
  });
};

function slice(from, to) {
  const i = engine.indexOf(from);
  const j = engine.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error('не найден фрагмент ' + from);
  return engine.slice(i, j);
}

const prelude = slice('const $=id=>document.getElementById(id);', 'try{renderer=new THREE.WebGLRenderer') +
  slice('const _q=new THREE.Quaternion(),_e=new THREE.Euler();', 'function segD(');
const models = slice('function ball(', 'function spawnEnemy(');
const humans = slice('function faceMesh(hair,face){', 'function addNPC(');

window.eval(three);
let built = null;
try {
  window.eval(`
    ${prelude}
    Q=QS.high;var windU={value:0};
    const EM=(c,o)=>new THREE.MeshStandardMaterial(Object.assign({color:c,roughness:.85},o));
    const hpBg=new THREE.SpriteMaterial(),hpMat=new THREE.SpriteMaterial();
    let faceCache={};
    ${models}
    ${humans}
    window.__CD={mkEnemy,ET,mkHuman,furTex,QS};
  `);
  built = window.window.__CD;
} catch (e) {
  check('сборочные функции исполняются', false, String(e.message));
}
check('сборочные функции исполняются', !!built && typeof built.mkEnemy === 'function');

const THREE = window.THREE;
function stats(group) {
  let meshes = 0, shells = 0, verts = 0, tris = 0, nan = 0, textured = 0;
  group.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    if (o.material && o.material.alphaTest > 0) { shells++; if (o.material.map) textured++; }
    const p = o.geometry && o.geometry.attributes && o.geometry.attributes.position;
    if (!p) return;
    verts += p.count;
    tris += (o.geometry.index ? o.geometry.index.count : p.count) / 3;
    for (let i = 0; i < p.array.length; i++) if (!Number.isFinite(p.array[i])) { nan++; break; }
  });
  const box = new THREE.Box3().setFromObject(group);
  return { meshes, shells, textured, verts, tris: Math.round(tris), nan, h: box.max.y - box.min.y };
}

if (built) {
  const expectedFur = { moss: true, guardian: true, bat: true, crawler: true, shard: false, boss: true };
  const budgets = { moss: 16, guardian: 18, shard: 12, bat: 14, crawler: 20, boss: 20 };
  for (const type of ['moss', 'guardian', 'shard', 'bat', 'crawler', 'boss']) {
    let s = null, err = null;
    try { s = stats(built.mkEnemy(type).g); } catch (e) { err = e.message; }
    check(`монстр ${type} собирается`, !!s && !err, err || undefined);
    if (!s) continue;
    check(`монстр ${type}: нет NaN в вершинах`, s.nan === 0, s.nan);
    check(`монстр ${type}: мех из текстурных слоёв`, expectedFur[type] ? s.shells >= 1 && s.textured >= 1 : true,
      { shells: s.shells, textured: s.textured });
    check(`монстр ${type}: бюджет мешей (${budgets[type]})`, s.meshes <= budgets[type], s.meshes);
    check(`монстр ${type}: рост в разумных пределах`, s.h > 0.4 && s.h < 12, +s.h.toFixed(2));
  }

  /* слоёв меха на высоком качестве должно быть больше, чем на низком */
  const highFur = built.QS.high.fur, lowFur = built.QS.low.fur;
  check('качество меняет густоту меха', highFur > lowFur && lowFur >= 1, { highFur, lowFur });

  for (const face of [1, 3, 5]) {
    let s = null, err = null;
    try { s = stats(built.mkHuman(0x4a6fa5, 0x3a2418, face % 2 ? 0x6b4a2b : 0, face).g); } catch (e) { err = e.message; }
    check(`житель #${face} собирается`, !!s && !err, err || undefined);
    if (!s) continue;
    check(`житель #${face}: нет NaN в вершинах`, s.nan === 0, s.nan);
    check(`житель #${face}: рост как у человека`, s.h > 1.5 && s.h < 2.9, +s.h.toFixed(2));
    check(`житель #${face}: бюджет мешей`, s.meshes <= 12, s.meshes);
    check(`житель #${face}: детализация (вершин больше 2000)`, s.verts > 2000, s.verts);
  }
}

const failed = results.filter((r) => r.startsWith('FAIL'));
for (const r of results) console.log(r);
console.log('\nИТОГО: ' + (results.length - failed.length) + '/' + results.length + ' проверок пройдено');
process.exit(failed.length ? 1 : 0);
