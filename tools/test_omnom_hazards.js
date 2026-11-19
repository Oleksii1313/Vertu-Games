/* Проверки новых препятствий Om Nom Паркур: шипы, движущиеся блоки,
   прыжковые площадки, вертикальные и исчезающие платформы.
   Запуск: NODE_PATH=/tmp/dom/node_modules node tools/test_omnom_hazards.js */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(ROOT, 'games/om-nom-parkour.html');
const SRC = fs.readFileSync(FILE, 'utf8');

let ok = 0;
const fails = [];
function check(name, cond, info) {
  if (cond) { ok++; return; }
  fails.push(name + (info === undefined ? '' : ' → ' + JSON.stringify(info)));
}

/* --- статический разбор источника ---------------------------------------- */
check('есть сборка шипов', SRC.includes('t.type==="spikes"'));
check('есть сборка движущихся блоков', SRC.includes('t.type==="block"'));
check('шипы наносят урон с сообщением SPIKES', SRC.includes('this._hurt("SPIKES")'));
check('блок наносит урон с сообщением BLOCK', SRC.includes('this._hurt("BLOCK")'));
check('блоки двигаются в update', SRC.includes('n.type==="block"') && SRC.includes('n.pivot.position.z=r.z+a'));
check('есть гарантия прыжковой площадки', SRC.includes('vgP.kind==="bounce"'));
check('есть гарантия вертикальной платформы', SRC.includes('vgQ.axis="y"'));

/* --- живая генерация уровней -------------------------------------------- */
let html = SRC.replace(/<script src="\/assets\/vg\/js\/game-kit\.js"><\/script>/, '');
const bs = html.indexOf('<script>\n/* VG: награда за забег');
if (bs > 0) html = html.slice(0, bs) + html.slice(html.indexOf('</script>', bs) + 9);
const anchor = html.indexOf('var ei=s=>440*Math.pow');
html = html.slice(0, anchor) + ';window.__VGT={Gl:Gl};' + html.slice(anchor);

const vc = new VirtualConsole();
vc.on('jsdomError', () => {});
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'http://localhost/x.html' });

const timers = [];
setTimeout(run, 1500);

function run() {
  const G = dom.window.__VGT && dom.window.__VGT.Gl;
  check('генератор уровней доступен', typeof G === 'function');
  if (typeof G !== 'function') return finish();

  const stages = [1, 2, 3, 5, 8, 12, 18, 25, 33, 41, 50];
  let noSpikes = [], noBlocks = [], noBounce = [], noVert = [], noWarn = [];
  let maxHazards = 0, maxSpikesW = 0, badSpikePos = [], lowBlocks = [], highBlocks = [];

  for (const n of stages) {
    const L = G(n);
    const haz = L.hazards || [];
    const plats = L.platforms || [];
    maxHazards = Math.max(maxHazards, haz.length);

    const spikes = haz.filter(h => h.type === 'spikes');
    const blocks = haz.filter(h => h.type === 'block');
    if (!spikes.length) noSpikes.push(n);
    if (!blocks.length) noBlocks.push(n);

    const kinds = plats.map(p => p.kind);
    if (!kinds.includes('bounce')) noBounce.push(n);
    if (!plats.some(p => p.kind === 'move' && p.axis === 'y')) noVert.push(n);
    if (n > 7 && !kinds.includes('fade') && !kinds.includes('fall')) noWarn.push(n);

    for (const h of spikes) {
      maxSpikesW = Math.max(maxSpikesW, h.w || 0);
      const host = plats.filter(p => Math.abs(p.x - h.x) <= (p.w || 0) / 2 + 1e-6 &&
        Math.abs(p.z - h.z) <= (p.d || 0) / 2 + 1e-6);
      if (!host.length) { badSpikePos.push(n); continue; }
      const p = host[0];
      // шипы должны либо занимать не всю платформу, либо стоять у края —
      // чтобы их можно было обойти
      const free = (p.w - (h.w || 0)) / p.w;
      if (free < 0.35) badSpikePos.push(n);
    }
    for (const b of blocks) {
      const host = plats.filter(p => Math.abs(p.x - b.x) <= (p.w || 0) / 2 + 1e-6 &&
        Math.abs(p.z - b.z) <= (p.d || 0) / 2 + 1e-6);
      const top = host.length ? (host[0].y + (host[0].top || 0)) : null;
      const lift = top === null ? null : b.y - top;
      if (lift !== null && lift < 1.4) lowBlocks.push(n);
      if (lift !== null && lift > 3.2) highBlocks.push(n);
    }
  }

  check('на всех уровнях есть шипы', noSpikes.length === 0, noSpikes);
  check('на всех уровнях есть движущиеся блоки', noBlocks.length === 0, noBlocks);
  check('на всех уровнях есть прыжковая площадка', noBounce.length === 0, noBounce);
  check('на всех уровнях есть вертикальная платформа', noVert.length === 0, noVert);
  check('исчезающие/падающие платформы есть с 8 уровня', noWarn.length === 0, noWarn);
  check('шипы всегда стоят на платформе и оставляют проход', badSpikePos.length === 0, badSpikePos.slice(0, 4));
  check('шипы не шире 2 единиц (перепрыгиваются)', maxSpikesW <= 2.0001, maxSpikesW);
  check('блоки висят выше роста персонажа (можно пробежать)', lowBlocks.length === 0, lowBlocks.slice(0, 4));
  check('блоки в пределах прыжка (не «навсегда» наверху)', highBlocks.length === 0, highBlocks.slice(0, 4));
  check('плотность ловушек в разумных пределах', maxHazards <= 80, maxHazards);

  /* рост сложности: на поздних уровнях ловушек не меньше, чем на первых */
  const early = G(2).hazards.length, late = G(40).hazards.length;
  check('сложность растёт с уровнем', late >= early, [early, late]);

  /* препятствия видны заранее: у вертикальной платформы и блока есть фаза */
  const L10 = G(10);
  check('у подвижных ловушек задана фаза (видно заранее, без «сюрпризов»)',
    L10.hazards.every(h => typeof h.phase === 'number'), true);

  finish();
}

function finish() {
  if (fails.length) {
    console.log('\nПРОВАЛЫ:');
    for (const f of fails) console.log('  ' + f);
  }
  console.log('\nИТОГО: ' + ok + '/' + (ok + fails.length) + ' проверок пройдено');
  try { dom.window.close(); } catch (e) {}
  process.exit(fails.length ? 1 : 0);
}
