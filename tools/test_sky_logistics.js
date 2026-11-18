#!/usr/bin/env node
/*
 * Автотест новой логистики Sky-Isle: топливо, сбор ресурсов, миссии,
 * пассажиры, улучшения станций и компактная панель доставки.
 *
 * Фабрика skyLogistics() вынимается из games/sky-isle.js и запускается с
 * заглушками сцены Babylon.js, поэтому проверяется настоящая логика игры без
 * WebGL и без сети.
 *
 *     NODE_PATH=/tmp/dom/node_modules node tools/test_sky_logistics.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, '..', 'games', 'sky-isle.js'), 'utf8');

/* --- вырезаем фабрику целиком по балансу скобок ---------------------------- */
function extractFunction(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('не найдена функция ' + name);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}
const factorySource = extractFunction(source, 'skyLogistics');

const dom = new JSDOM('<!doctype html><html><head></head><body><div class="hud">' +
  '<section class="mission"><div class="eyebrow"><span id="missionTag">POST</span></div>' +
  '<h2 id="missionTitle">Пора за посылкой</h2><p id="missionHint">Подлетите</p>' +
  '<div class="route-row"><span id="routeName">Депо</span></div><div class="progress"><i></i></div>' +
  '<small id="rewardHint"></small></section></div>' +
  '<button id="lgStationBtn"></button><div id="lgStationBody"></div></body></html>',
{ runScripts: 'outside-only', url: 'http://localhost/games/sky-isle.html' });
const w = dom.window;

const results = [];
function check(name, ok, extra) {
  results.push((ok ? 'PASS' : 'FAIL') + ' · ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : ''));
}

/* --- заглушки сцены -------------------------------------------------------- */
function transformNode() {
  const kids = [];
  return {
    position: { set(x, y, z) { this.x = x; this.y = y; this.z = z; }, x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scaling: { set() {} },
    parent: null,
    getChildMeshes: () => kids.slice(),
    _kids: kids,
    setEnabled() {}, dispose() {}
  };
}
function meshStub(kind) {
  const m = transformNode();
  m.kind = kind;
  m.enabled = true;
  m.setEnabled = function (on) { m.enabled = !!on; };
  if (kind === 'torus') { m.isPickable = false; }
  return m;
}
let meshCount = 0;
const ctxStub = {
  B: { TransformNode: function () { return transformNode(); } },
  scene: {},
  box: function () { const m = meshStub('box'); meshCount++; return m; },
  cyl: function () { const m = meshStub('cyl'); meshCount++; return m; },
  sphere: function () { const m = meshStub('sphere'); meshCount++; return m; },
  torus: function () { const m = meshStub('torus'); meshCount++; return m; },
  mat: () => ({}),
};

const destinations = [];
for (let i = 0; i < 7; i++) {
  const a = i / 7 * Math.PI * 2;
  destinations.push({ id: i, name: 'Island ' + i, x: Math.cos(a) * 40, z: Math.sin(a) * 40,
    pad: { x: Math.cos(a) * 32, z: Math.sin(a) * 32 } });
}
const depotPad = { x: 0, z: 11 };
const S = { position: { x: 0, y: 4, z: 22, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
  velocity: { x: 0, y: 0, z: 0, set() {} }, order: null };
const messages = [];
let climbLimited = 0, teleports = 0;
const tr = (ru) => ru;

w.eval(factorySource);
const LOG = w.skyLogistics(Object.assign({}, ctxStub, {
  destinations, depotPad, S, tr,
  message: (t) => messages.push(t),
  $: (id) => w.document.getElementById(id),
  position: () => S.position,
  limitClimb: () => { climbLimited++; },
  teleport: (x, y, z) => { teleports++; S.position.set(x, y, z); }
}));

const X = LOG.state;
let clock = 1000;
function fly(seconds, speed, climb) {
  const steps = Math.round(seconds / 0.05);
  for (let i = 0; i < steps; i++) { clock += 0.05; LOG.tick(0.05, clock, speed, !!climb); }
}

/* ------------------------------------------------------------- 1. топливо */
check('стартовое топливо полное', X.fuel === LOG.fuelCap(), X.fuel);
S.position.set(0, 4, 22);           // в стороне от депо
fly(10, 14, false);
const afterFlight = X.fuel;
check('в полёте топливо расходуется', afterFlight < LOG.fuelCap() && afterFlight > 0, afterFlight);
S.position.set(depotPad.x, 3.4, depotPad.z);
fly(6, 0, false);
check('у депо дрон заправляется', X.fuel > afterFlight, [afterFlight, X.fuel]);
X.fuel = 0.01;
S.position.set(0, 10, 40);
fly(6, 10, true);
check('без топлива подъём блокируется', climbLimited > 0, climbLimited);
check('появляется кнопка буксира', w.document.getElementById('lgTow').classList.contains('on'));
w.document.getElementById('lgTow').dispatchEvent(new w.Event('click'));
fly(2, 0, false);
check('буксир возвращает дрон в депо с топливом', teleports > 0 && X.fuel > 20, [teleports, X.fuel]);

/* ------------------------------------------------------------ 2. ресурсы */
const node = LOG.nodes.find((n) => n.type === 'wood');
S.position.set(node.x, 2, node.z);
const before = X.res.wood;
fly(1, 0, false);
check('сбор ресурса рядом с узлом', X.res.wood > before, [before, X.res.wood]);
check('собранный узел исчезает', node.readyAt > 0, node.readyAt);
S.position.set(node.x, 2, node.z);
fly(2, 0, false);
check('повторно узел не собирается до восстановления', X.res.wood === before + 2, X.res.wood);
const fuelNode = LOG.nodes.find((n) => n.type === 'fuel');
X.fuel = 40;
S.position.set(fuelNode.x, 2, fuelNode.z);
fly(1, 0, false);
check('канистра заправляет дрон', X.fuel > 40, X.fuel);
const capWood = LOG.resCap();
X.res.wood = capWood;
S.position.set(node.x, 2, node.z);
node.readyAt = 0;
fly(1, 0, false);
check('склад не переполняется сверх лимита', X.res.wood === capWood, [capWood, X.res.wood]);

/* ------------------------------------------------------------ 3. миссии */
check('в списке три миссии', X.missions.length === 3, X.missions.map((m) => m.kind));
const deliverMission = X.missions.find((m) => m.kind === 'deliver');
if (deliverMission) {
  const need = deliverMission.need;
  for (let i = 0; i < need; i++) LOG.onDeliver();
  check('доставки закрывают миссию', !X.missions.some((m) => m.id === deliverMission.id), X.missions.map((m) => m.kind));
  check('после выполнения появляется новая миссия', X.missions.length === 3, X.missions.length);
} else {
  check('миссия на доставку присутствует', false, X.missions.map((m) => m.kind));
}

const collectMission = X.missions.find((m) => m.kind === 'collect');
if (collectMission) {
  const wasDone = collectMission.have;
  LOG.onCollect(collectMission.res, 2);
  check('сбор ресурса продвигает миссию', X.missions.some((m) => m.id === collectMission.id) ? collectMission.have > wasDone : true,
    [wasDone, collectMission.have]);
} else {
  check('миссия на сбор присутствует', false, X.missions.map((m) => m.kind));
}

/* --------------------------------------------------------- 4. пассажиры */
/* Пассажирская миссия ставится вручную: набор миссий генерируется случайно,
   а тест должен проверять именно посадку и высадку, а не удачу с сидом. */
X.missions = [LOG.makeMission('deliver'), LOG.makeMission('collect'), LOG.makeMission('passenger')];
const passMission = X.missions.find((m) => m.kind === 'passenger');
if (passMission) {
  const from = destinations[passMission.from], to = destinations[passMission.to];
  S.position.set(from.pad.x, 2, from.pad.z);
  fly(1.5, 0, false);
  check('пассажир садится на площадке', X.passenger && X.passenger.taken === true, X.passenger);
  S.position.set(to.pad.x, 2, to.pad.z);
  fly(1.5, 0, false);
  check('пассажир доставлен и миссия закрыта', X.passenger === null &&
    !X.missions.some((m) => m.id === passMission.id), X.passenger);
  check('счётчик пассажиров вырос', X.stats.passengers > 0, X.stats.passengers);
} else {
  check('миссия с пассажиром присутствует', false, X.missions.map((m) => m.kind));
}

/* --------------------------------------------------------- 5. улучшения */
X.res = { wood: 200, stone: 200, metal: 200 };
const capBefore = LOG.fuelCap();
check('улучшение станции повышает запас топлива', LOG.upgrade('station') && LOG.fuelCap() > capBefore,
  [capBefore, LOG.fuelCap()]);
check('уровень улучшения сохраняется', X.up.station === 2, X.up.station);
X.res = { wood: 0, stone: 0, metal: 0 };
check('без материалов улучшение невозможно', LOG.upgrade('storage') === false && X.up.storage === 1, X.up.storage);
X.res = { wood: 999, stone: 999, metal: 999 };
LOG.upgrade('storage'); LOG.upgrade('storage');
check('уровень улучшения не превышает максимум', (LOG.upgrade('storage'), X.up.storage <= 3), X.up.storage);
check('склад расширяется вместе с уровнем', LOG.resCap() === 80, LOG.resCap());

/* ------------------------------------------------------------- 6. панель */
const panel = w.document.getElementById('lgPanel');
check('панель логистики добавлена в HUD', !!panel, !!panel);
check('в панели есть шкала топлива и ресурсы', !!w.document.getElementById('lgFuelFill') &&
  w.document.getElementById('lgRes').children.length === 3,
  [!!w.document.getElementById('lgFuelFill'), w.document.getElementById('lgRes').children.length]);
check('миссии видны в панели', w.document.getElementById('lgMissions').children.length === 3,
  w.document.getElementById('lgMissions').children.length);
check('у карточки доставки есть кнопка сворачивания',
  !!w.document.querySelector('.hud .mission .collapse'));
const collapse = w.document.querySelector('.hud .mission .collapse');
collapse.dispatchEvent(new w.Event('click'));
check('окно доставки сворачивается', w.document.querySelector('.hud .mission').classList.contains('collapsed'));
collapse.dispatchEvent(new w.Event('click'));
check('окно доставки разворачивается обратно',
  !w.document.querySelector('.hud .mission').classList.contains('collapsed'));
w.document.getElementById('lgStationBtn').dispatchEvent(new w.Event('click'));
check('окно станции открывается с улучшениями',
  w.document.getElementById('lgStation').classList.contains('on') &&
  w.document.querySelectorAll('#lgStationBody .lgRow').length === 4,
  w.document.querySelectorAll('#lgStationBody .lgRow').length);
w.document.getElementById('lgClose').dispatchEvent(new w.Event('click'));
check('окно станции закрывается', !w.document.getElementById('lgStation').classList.contains('on'));

/* --------------------------------------------------------- 7. сохранение */
const saved = JSON.parse(JSON.stringify({ version: 3, score: 4, earned: 20, pending: [], legLength: 11, order: null, next: 3, position: [0, 4, 22], ext: X }));
check('состояние логистики сериализуется', !!saved.ext && saved.ext.up.station === X.up.station,
  saved.ext && saved.ext.up);
const restored = JSON.parse(JSON.stringify(saved.ext));
const LOG2 = w.skyLogistics(Object.assign({}, ctxStub, {
  destinations, depotPad, S: { position: { x: 0, y: 4, z: 22, set() {} }, velocity: { set() {} }, order: null, ext: restored },
  tr, message: () => {}, $: (id) => w.document.getElementById(id),
  position: () => ({ x: 0, y: 4, z: 22 }), limitClimb: () => {}, teleport: () => {}
}));
check('после загрузки уровни и ресурсы на месте',
  LOG2.state.up.station === X.up.station && LOG2.state.res.metal === X.res.metal,
  [LOG2.state.up.station, LOG2.state.res.metal]);

console.log(results.join('\n'));
const fails = results.filter((r) => r.startsWith('FAIL')).length;
console.log('\nИТОГО: ' + (results.length - fails) + '/' + results.length + ' проверок пройдено');
process.exit(fails ? 1 : 0);
