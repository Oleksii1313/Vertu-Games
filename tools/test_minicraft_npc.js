#!/usr/bin/env node
/*
 * Навигация деревенских в MiniCraft: коллизии, габариты NPC, поиск пути,
 * обход стен, двери, вода, уступы, скольжение вдоль стены и отказ от
 * недостижимой цели.
 *
 * Логика берётся прямо из games/minicraft.html (блок «навигация NPC») и
 * запускается на синтетической карте — так сценарии детерминированы: мы сами
 * ставим стену, дверь, пруд и уступ и видим, как поведёт себя житель.
 *
 *     NODE_PATH=/tmp/dom/node_modules node tools/test_minicraft_npc.js
 */
const fs = require('fs');
const path = require('path');

const HTML = process.env.MINICRAFT_HTML || path.join(__dirname, '..', 'games', 'minicraft.html');
const html = fs.readFileSync(HTML, 'utf8');

const START = html.indexOf('/* --------------------------------------------------------- навигация NPC */');
const END = html.indexOf('function mcxSpawnVillagers()', START);
if (START === -1 || END === -1) { console.log('FAIL · блок навигации NPC не найден'); process.exit(1); }
const CODE = html.slice(START, END);

const results = [];
function check(name, ok, extra) {
  results.push((ok ? 'PASS' : 'FAIL') + ' · ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : ''));
}

/* ------------------------------------------------------- синтетический мир */
const CT = 48, H = 8;
const AIR = 0, GRASS = 1, STONE = 3, WATER = 7, DOOR = 11;
let grid, ponds;

function build() {
  grid = new Uint8Array(CT * CT * H);
  ponds = new Set();
  for (let x = 0; x < CT; x++) for (let z = 0; z < CT; z++) set(x, 0, z, GRASS);
}
function set(x, y, z, m) {
  if (x < 0 || x >= CT || z < 0 || z >= CT || y < 0 || y >= H) return;
  grid[(x * CT + z) * H + y] = m;
}
function get(x, y, z) {
  if (x < 0 || x >= CT || z < 0 || z >= CT || y < 0 || y >= H) return AIR;
  return grid[(x * CT + z) * H + y];
}
const cs = (x, y, z) => get(x, y, z);
const Rt = (x, y, z) => { const m = get(x, y, z); return m !== AIR && m !== WATER; };
function ir(x, z) {
  for (let y = H - 1; y >= 0; y--) if (Rt(x, y, z)) return y + 1;
  return 1;
}
const mcxWaterAt = (x, z) => (ponds.has(x + ',' + z) ? 1 : 0);

const sandbox = new Function('cs', 'Rt', 'ir', 'mcxWaterAt', 'Ai', 'DW', 'ct', 'Math',
  CODE + '\nreturn { mcxStandAt, mcxFreeSpot, mcxPathTo, mcxVillagerStep, mcxFleeDir,' +
  ' limits: { step: MCX_NPC_STEP, drop: MCX_NPC_DROP, body: MCX_NPC_BODY, reach: MCX_NPC_REACH } };');
const N = sandbox(cs, Rt, ir, mcxWaterAt, AIR, DOOR, CT, Math);

const free = (p) => p.every((pt) => N.mcxStandAt(pt.x, pt.z, pt.y));
const inside = (p, x, z) => p.some((pt) => Math.floor(pt.x) === x && Math.floor(pt.z) === z);

function villager(x, z, y, speed) {
  return { x: x, z: z, y: y == null ? ir(Math.floor(x), Math.floor(z)) : y, speed: speed || 2,
    mesh: { rotation: { y: 0 } } };
}

/* ------------------------------------------------ 1. ровное поле: путь есть */
build();
{
  const p = N.mcxPathTo(3.5, 3.5, ir(3, 3), 10.5, 10.5);
  check('ровное поле: маршрут построен', !!p && p.length > 3, p && p.length);
  check('ровное поле: все точки маршрута проходимы', !!p && free(p));
  check('ровное поле: маршрут приходит к цели',
    !!p && Math.hypot(p[p.length - 1].x - 10.5, p[p.length - 1].z - 10.5) <= 1.45,
    p && [p[p.length - 1].x, p[p.length - 1].z]);
  check('стартовая клетка в маршрут не входит',
    !!p && !p.some((pt) => Math.floor(pt.x) === 3 && Math.floor(pt.z) === 3));
}

/* ------------------------------------------------ 2. стена: обход, не сквозь */
build();
for (let z = 0; z <= 20; z++) for (let y = 1; y <= 3; y++) set(16, y, z, STONE);
{
  const p = N.mcxPathTo(13.5, 10.5, ir(13, 10), 19.5, 10.5);
  check('стена: маршрут найден в обход', !!p && p.length > 4, p && p.length);
  check('стена: ни одна точка не в стене',
    !!p && !p.some((pt) => Math.floor(pt.x) === 16 && Math.floor(pt.z) <= 20));
  check('стена: маршрут длиннее прямой', !!p && p.length > 6, p && p.length);
}

/* ------------------------------------- 3. сплошная стена: цель недостижима */
build();
for (let z = 0; z < CT; z++) for (let y = 1; y <= 3; y++) set(24, y, z, STONE);
{
  const p = N.mcxPathTo(20.5, 10.5, ir(20, 10), 28.5, 10.5);
  check('непреодолимая стена: маршрута нет (житель не идёт сквозь блоки)', p === null, p && p.length);
}

/* --------------------------------------------------------- 4. дверь в стене */
build();
for (let z = 0; z <= 20; z++) for (let y = 1; y <= 3; y++) set(16, y, z, STONE);
set(16, 1, 10, DOOR); set(16, 2, 10, AIR); set(16, 3, 10, AIR);
{
  const p = N.mcxPathTo(13.5, 10.5, ir(13, 10), 19.5, 10.5);
  check('закрытая дверь проходима для жителя: маршрут через дверной проём',
    !!p && inside(p, 16, 10) && free(p));
  check('дверной проём короче обхода', !!p && p.length < 8, p && p.length);
}

/* --------------------------------------------------------------- 5. вода */
build();
for (let x = 8; x <= 12; x++) for (let z = 8; z <= 12; z++) { set(x, 1, z, WATER); ponds.add(x + ',' + z); }
{
  check('в воду житель не встаёт', N.mcxStandAt(10.5, 10.5, 1) === false);
  const p = N.mcxPathTo(6.5, 10.5, ir(6, 10), 14.5, 10.5);
  check('маршрут обходит пруд',
    p !== null && !p.some((pt) => ponds.has(Math.floor(pt.x) + ',' + Math.floor(pt.z))), p && p.length);
}

/* --------------------------------------------------- 6. уступ в один блок */
build();
for (let x = 20; x <= 24; x++) for (let z = 8; z <= 12; z++) set(x, 1, z, GRASS);
{
  check('уступ в один блок: стоять можно', N.mcxStandAt(22.5, 10.5, 2) === true);
  const p = N.mcxPathTo(17.5, 10.5, ir(17, 10), 22.5, 10.5);
  check('уступ в один блок: житель поднимается', !!p && p[p.length - 1].y === 2, p && p.map((pt) => pt.y));
}

/* --------------------------------------------- 7. высокий выступ не берётся */
build();
for (let x = 20; x <= 24; x++) for (let z = 8; z <= 12; z++) { set(x, 1, z, STONE); set(x, 2, z, STONE); }
{
  const p = N.mcxPathTo(17.5, 10.5, ir(17, 10), 22.5, 10.5);
  check('двухблочный выступ непреодолим для маршрута', p === null || !inside(p, 22, 10), p && p.length);
  const v = villager(19.2, 10.5);
  const res = N.mcxVillagerStep(v, 22.5, 10.5, 0.2);
  check('шаг в двухблочную стену отклонён', res !== 'moved' || Math.floor(v.x) < 20, [res, v.x.toFixed(2)]);
}

/* ---------------------------------------------- 8. скольжение вдоль стены */
build();
for (let z = 0; z <= 20; z++) for (let y = 1; y <= 2; y++) set(6, y, z, STONE);
{
  const v = villager(5.4, 5.5);
  const res = N.mcxVillagerStep(v, 9.5, 5.5, 0.25);
  check('упёрся в стену — скользит вдоль неё', res === 'moved' && v.x < 6, [res, v.x.toFixed(2), v.z.toFixed(2)]);
  check('при скольжении не входит в блок', get(Math.floor(v.x), Math.round(v.y), Math.floor(v.z)) === AIR);
}

/* ------------------------------------- 9. тупик: шаг отклонён, позиция цела */
build();
for (let x = 4; x <= 6; x++) { for (let y = 1; y <= 2; y++) { set(x, y, 4, STONE); set(x, y, 6, STONE); } }
for (let z = 4; z <= 6; z++) { for (let y = 1; y <= 2; y++) { set(4, y, z, STONE); set(6, y, z, STONE); } }
{
  const v = villager(5.5, 5.5);
  const res = N.mcxVillagerStep(v, 9.5, 5.5, 0.3);
  check('в замкнутом кармане шаг отклонён', res === 'blocked', res);
  check('при отказе житель остаётся на месте', v.x === 5.5 && v.z === 5.5, [v.x, v.z]);
  const p = N.mcxPathTo(5.5, 5.5, ir(5, 5), 12.5, 5.5);
  check('из замкнутого кармана маршрута нет', p === null, p && p.length);
}

/* ---------------------------------------------- 10. габариты: голова и тело */
build();
set(10, 1, 10, STONE);                     // блок на уровне тела
set(12, 2, 12, STONE);                     // блок только на уровне головы
{
  check('клетка с блоком в теле непроходима', N.mcxStandAt(10.5, 10.5, 1) === false);
  check('клетка с блоком на уровне головы непроходима', N.mcxStandAt(12.5, 12.5, 1) === false);
  check('рост жителя — два блока', N.limits.body === 2, N.limits.body);
  check('свободная клетка проходима', N.mcxStandAt(14.5, 14.5, 1) === true);
}

/* ------------------------------------------- 11. спавн ищет свободное место */
build();
for (let x = 9; x <= 11; x++) for (let z = 9; z <= 11; z++) for (let y = 1; y <= 2; y++) set(x, y, z, STONE);
{
  const spot = N.mcxFreeSpot(10.5, 10.5, 8);
  check('спавн не в объекте: найдена свободная точка рядом',
    !!spot && N.mcxStandAt(spot.x, spot.z, spot.y) && Math.hypot(spot.x - 10.5, spot.z - 10.5) <= 8.5,
    spot);
  const onFree = N.mcxFreeSpot(14.5, 14.5, 4);
  check('спавн на свободной клетке остаётся на месте', !!onFree && onFree.x === 14.5 && onFree.z === 14.5, onFree);
}

/* ------------------------------------- 12. побег от монстра: куда бежать */
build();
for (let z = 4; z <= 8; z++) for (let y = 1; y <= 2; y++) set(2, y, z, STONE);
{
  const v = villager(4.5, 6.5);
  const threat = { x: 6.5, z: 6.5 };
  const dir = N.mcxFleeDir(v, threat);
  check('побег выбирает свободное направление', !!dir && N.mcxStandAt(dir.x, dir.z, ir(Math.floor(dir.x), Math.floor(dir.z))), dir);
  check('побег уводит от монстра', !!dir && Math.hypot(dir.x - threat.x, dir.z - threat.z) > 1, dir);
  const res = dir ? N.mcxVillagerStep(v, dir.x, dir.z, 0.2) : 'blocked';
  check('житель реально сдвигается при испуге', res === 'moved' || res === 'arrived', res);
}

/* --------------------------------- 13. код игры: проверки на месте */
check('в игре спавн жителей ищет свободную точку', /mcxFreeSpot\(spot\.x \+ \.5/.test(html));
check('в игре шаг жителя проверяет опору и тело', /if \(!mcxStandAt\(nx, nz, ny\)\) continue;/.test(html));
check('в игре есть поиск пути и пересчёт при блокировке', /mcxPathTo\(v\.x, v\.z, v\.y, v\.goalX, v\.goalZ\)/.test(html) &&
  /v\.path = \[\];\s*\n\s*v\.repath = 0;/.test(html));
check('в игре есть безопасный idle после застревания', /v\.idle = v\.clock \+ 1\.2/.test(html));
check('испуг отменяет отдых и житель убегает', /v\.idle = 0;\s*\/\/ испуг отменяет/.test(html));
check('в игре жители не телепортируются сквозь блоки', !/v\.x = v\.targetX/.test(html));

console.log(results.filter((r) => r.startsWith('FAIL')).join('\n'));
console.log('ИТОГО: ' + results.filter((r) => r.startsWith('PASS')).length + '/' + results.length + ' проверок пройдено');
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
