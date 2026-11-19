/* =============================================================================
   MiniCraft 3D · mcxBuild — продвинутая стройка
   -----------------------------------------------------------------------------
   Модуль живёт ВНУТРИ замыкания игры (вставляется tools/build_minicraft_build.py),
   поэтому видит мир и сцену напрямую:
     cs(x,y,z) / ui(x,y,z,id) — чтение и запись блока,  Ai — воздух;
     dn, ct — высота и размер мира;  F — состояние игрока;
     Ht — сцена,  Wt — камера,  is[id] — InstancedMesh с материалом блока;
     Ug(id) — иконка блока (data URL),  $e — getElementById,  tt — RU/EN.

   Что даёт игроку:
     • инвентарь из 14 материалов с количеством, категориями и быстрым хотбаром;
     • прицел по лучу из камеры (без рисованных превью и подсветки);
     • точную постановку/снос с проверкой занятости, запаса и «в себе»;
     • чертежи (дом, башня, мост, стена, лестница, крыша, забор, окно, дверь);
     • отмену последнего действия, сохранение мира в localStorage по нику;
     • настройку чувствительности обзора и раскладки кнопок;
     • защиту от прокрутки/жестов браузера во время игры.
   ========================================================================== */

var MCB_VERSION = 3;
var MCB_STORE = 'mcx.build.v3';
var MCB_STOCK_START = 320;
var MCB_UNDO_LIMIT = 40;

/* ---------------------------------------------------------------- материалы */
var MCB_CATS = [
  { id: 'nature', ru: 'Природа', en: 'Nature' },
  { id: 'stone', ru: 'Камень', en: 'Stone' },
  { id: 'wood', ru: 'Дерево', en: 'Wood' },
  { id: 'decor', ru: 'Отделка', en: 'Finishing' }
];
var MCB_MATS = [
  { id: Vh, cat: 'nature', ru: 'Трава', en: 'Grass' },
  { id: Gh, cat: 'nature', ru: 'Земля', en: 'Dirt' },
  { id: Wh, cat: 'nature', ru: 'Песок', en: 'Sand' },
  { id: Bl, cat: 'nature', ru: 'Листва', en: 'Leaves' },
  { id: Hh, cat: 'stone', ru: 'Камень', en: 'Stone' },
  { id: CB, cat: 'stone', ru: 'Булыжник', en: 'Cobblestone' },
  { id: SB, cat: 'stone', ru: 'Кирпич', en: 'Stone brick' },
  { id: Xh, cat: 'wood', ru: 'Дерево', en: 'Wood' },
  { id: PL, cat: 'wood', ru: 'Доски', en: 'Planks' },
  { id: DW, cat: 'wood', ru: 'Тёмные доски', en: 'Dark planks' },
  { id: RF, cat: 'decor', ru: 'Черепица', en: 'Roof tiles' },
  { id: SL, cat: 'decor', ru: 'Сланец', en: 'Slate' },
  { id: PS, cat: 'decor', ru: 'Штукатурка', en: 'Plaster' },
  { id: GL, cat: 'decor', ru: 'Стекло', en: 'Glass' }
];

/* ------------------------------------------------------------------ состояние */
var mcbState = {
  selected: Vh,
  stock: {},
  edits: {},
  editCount: 0,
  undo: [],
  sensitivity: 1,
  layout: null,
  loaded: false,
  appliedWorld: null,
  aim: null,
  planKey: null,
  planDir: 0,
  planBarKey: '',
  disabled: null,
  page: 0,
  saveTimer: 0,
  open: false,
  tab: 'blocks',
  layoutMode: false
};
var MCB_PER_PAGE = 7;

/* Перевод строк: VGT меняется на лету (язык игры), tt — статический ?lang=en. */
function mcbT(ru, en) {
  return window.VGT ? window.VGT(ru, en) : tt(ru, en);
}

/* Имя игрока: у платформы спрашиваем через её же совместимый хук. */
function mcbUser() {
  try {
    if (window.parent && window.parent !== window && window.parent.getCurrentUser) {
      var user = window.parent.getCurrentUser();
      if (user && user.username) return String(user.username);
    }
  } catch (e) {}
  return 'guest';
}

function mcbStoreKey() {
  return MCB_STORE + ':' + mcbUser().toLowerCase();
}

function mcbMaterial(id) {
  for (var i = 0; i < MCB_MATS.length; i++) if (MCB_MATS[i].id === id) return MCB_MATS[i];
  return null;
}

function mcbName(id) {
  var mat = mcbMaterial(id);
  if (!mat) return mcbT('Блок', 'Block');
  return mcbT(mat.ru, mat.en);
}

/* Доступные блоки приходят с сервера (/api/game/blocks): админ может скрыть
   материал, не трогая код игры. Пока ответа нет — доступно всё. */
function mcbBlockAllowed(id) {
  return !mcbState.disabled || !mcbState.disabled[id];
}

function mcbApplyBlockAccess(disabled) {
  var map = {};
  for (var i = 0; i < (disabled || []).length; i++) {
    var id = Number(disabled[i]);
    if (id) map[id] = true;
  }
  mcbState.disabled = map;
  /* Выбранный блок мог быть скрыт — переключаемся на первый доступный. */
  if (!mcbBlockAllowed(mcbState.selected)) {
    for (var m = 0; m < MCB_MATS.length; m++) {
      if (mcbBlockAllowed(MCB_MATS[m].id)) { mcbState.selected = MCB_MATS[m].id; break; }
    }
  }
  mcbHotbar();
  if (mcbState.open) mcbPaintModal();
}

function mcbLoadBlockAccess() {
  if (typeof fetch !== 'function') return;
  try {
    fetch('/api/game/blocks', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (data) {
        if (!data || !data.ok || !data.blocks) return;
        mcbApplyBlockAccess(data.blocks.disabled || []);
      })
      .catch(function () { /* игра работает и без списка: доступно всё */ });
  } catch (e) { /* старый браузер без fetch — не блокируем стройку */ }
}

function mcbStock(id) {
  if (mcbState.stock[id] == null) mcbState.stock[id] = MCB_STOCK_START;
  return mcbState.stock[id];
}

function mcbKey(x, y, z) {
  return x + ',' + y + ',' + z;
}

/* --------------------------------------------------------------- сохранение */
function mcbSaveNow() {
  clearTimeout(mcbState.saveTimer);
  mcbState.saveTimer = 0;
  var edits = [];
  for (var key in mcbState.edits) {
    if (!Object.prototype.hasOwnProperty.call(mcbState.edits, key)) continue;
    var parts = key.split(',');
    edits.push([Number(parts[0]), Number(parts[1]), Number(parts[2]), mcbState.edits[key]]);
  }
  /* Храним только «ручные» правки: их число ограничено запасом игрока, но на
     всякий случай подрезаем хвост, чтобы не забить localStorage. */
  if (edits.length > 30000) edits = edits.slice(edits.length - 30000);
  var payload = {
    v: MCB_VERSION,
    edits: edits,
    stock: mcbState.stock,
    selected: mcbState.selected,
    sensitivity: mcbState.sensitivity,
    layout: mcbState.layout
  };
  try {
    localStorage.setItem(mcbStoreKey(), JSON.stringify(payload));
  } catch (e) {
    /* Переполнение хранилища не должно ломать игру — просто сообщаем. */
    mcbToast(mcbT('Не удалось сохранить постройку: хранилище заполнено.', 'Could not save the build: storage is full.'), 2600);
  }
}

function mcbSave() {
  if (mcbState.saveTimer) return;
  mcbState.saveTimer = setTimeout(mcbSaveNow, 500);
}

function mcbLoad() {
  mcbState.loaded = true;
  var raw = null;
  try {
    raw = localStorage.getItem(mcbStoreKey());
  } catch (e) {
    raw = null;
  }
  if (!raw) return;
  var data = null;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    data = null;
  }
  if (!data || data.v !== MCB_VERSION) return;
  if (data.stock && typeof data.stock === 'object') mcbState.stock = data.stock;
  if (Array.isArray(data.edits)) {
    for (var i = 0; i < data.edits.length; i++) {
      var row = data.edits[i];
      if (!row || row.length !== 4) continue;
      var x = row[0] | 0, y = row[1] | 0, z = row[2] | 0, id = row[3] | 0;
      if (x < 0 || x >= ct || y < 0 || y >= dn || z < 0 || z >= ct) continue;
      if (!mcbMaterial(id)) continue;
      mcbState.edits[mcbKey(x, y, z)] = id;
      mcbState.editCount++;
    }
  }
  if (data.selected && mcbMaterial(data.selected)) mcbState.selected = data.selected;
  if (typeof data.sensitivity === 'number') mcbState.sensitivity = Math.min(2, Math.max(.4, data.sensitivity));
  if (data.layout && typeof data.layout === 'object') mcbState.layout = data.layout;
}

/* Нанести сохранённые правки на только что сгенерированный мир. */
function mcbRestore() {
  /* Мир — это Uint8Array в Wl: он пересоздаётся на каждый старт, поэтому
     сравниваем ссылку и наносим правки один раз на каждый новый мир. */
  var world = Wl;
  if (!world || !world.length || Mt === 'intro') return;
  if (mcbState.appliedWorld === world) return;
  mcbState.appliedWorld = world;
  var applied = 0;
  for (var key in mcbState.edits) {
    if (!Object.prototype.hasOwnProperty.call(mcbState.edits, key)) continue;
    var parts = key.split(',');
    var x = +parts[0], y = +parts[1], z = +parts[2];
    ui(x, y, z, mcbState.edits[key]);
    applied++;
  }
  if (applied && F) {
    F.dirty = !0;
    mcbToast(mcbT('Постройка восстановлена: ' + applied + ' блок(ов)', 'Build restored: ' + applied + ' block(s)'), 2200);
  }
  mcbHotbar();
}

/* ------------------------------------------------------------------ стройка */
function mcbCanPlace(x, y, z) {
  if (x < 0 || x >= ct || z < 0 || z >= ct || y < 0 || y >= dn) return false;
  /* Воздух или вода: воду можно вытеснить блоком, остальное — только снести. */
  var current = cs(x, y, z);
  if (current !== Ai && current !== qh) return false;
  /* Внутри игрока ставить нельзя: иначе он застревает в собственном блоке. */
  if (typeof F !== 'undefined' && F &&
      Math.abs(x + .5 - F.x) < .8 && Math.abs(z + .5 - F.z) < .8 &&
      y >= Math.floor(F.y) && y <= Math.floor(F.y + 1.8)) return false;
  return true;
}

function mcbPushUndo(x, y, z, prev, next) {
  mcbState.undo.push({ x: x, y: y, z: z, prev: prev, next: next });
  if (mcbState.undo.length > MCB_UNDO_LIMIT) mcbState.undo.shift();
}

/* Постановка блока игроком (вызывается из nr вместо прямой записи в мир). */
function mcxBuildPlace(x, y, z) {
  var id = mcbState.selected;
  if (!mcbMaterial(id)) return false;
  var reason = mcbPlaceReason(x, y, z, id);
  if (reason) {
    if (reason === 'stock') {
      mcbToast(mcbT('Запас исчерпан: разбейте блоки этого типа, чтобы пополнить.',
        'Out of stock: break blocks of this type to refill.'), 2400);
    } else if (reason === 'busy') {
      mcbToast(mcbT('Клетка занята — сначала сломайте блок.', 'That cell is occupied — break the block first.'), 1800);
    }
    return false;
  }
  var prev = cs(x, y, z);
  ui(x, y, z, id);
  mcbState.stock[id] = mcbStock(id) - 1;
  mcbState.edits[mcbKey(x, y, z)] = id;
  mcbPushUndo(x, y, z, prev, id);
  mcbSave();
  mcbHotbar();
  return true;
}

/* Снос блока игроком. */
function mcxBuildBreak(x, y, z) {
  var prev = cs(x, y, z);
  if (prev === Ai || prev === Vl) return false;
  ui(x, y, z, Ai);
  delete mcbState.edits[mcbKey(x, y, z)];
  if (prev !== qh) {
    mcbState.stock[prev] = mcbStock(prev) + 1;
  }
  mcbPushUndo(x, y, z, prev, Ai);
  mcbSave();
  mcbHotbar();
  return true;
}

function mcxBuildUndo() {
  var op = mcbState.undo.pop();
  if (!op) {
    mcbToast(mcbT('Отменять нечего.', 'Nothing to undo.'), 1600);
    return false;
  }
  ui(op.x, op.y, op.z, op.prev);
  if (op.next === Ai) {
    delete mcbState.edits[mcbKey(op.x, op.y, op.z)];
  } else {
    mcbState.edits[mcbKey(op.x, op.y, op.z)] = op.next;
  }
  if (F) F.dirty = !0;
  mcbSave();
  mcbHotbar();
  return true;
}

/* Выбор материала: из хотбара, инвентаря или пипеткой (средняя кнопка). */
function mcxBuildSelect(id, silent) {
  if (!mcbMaterial(id)) return false;
  if (!mcbBlockAllowed(id)) {
    mcbToast(mcbT('Блок отключён администратором.', 'This block is disabled by the administrator.'), 1800);
    return false;
  }
  mcbState.selected = id;
  mcbSave();
  mcbHotbar();
  mcbPaintModal();
  if (!silent) mcbToast(mcbName(id) + ' · ' + mcbStock(id) + ' ' + mcbT('шт.', 'pcs'), 1400);
  return true;
}

function mcxBuildPick() {
  mcbAim();
  var hit = mcbState.aim;
  if (!hit) return false;
  var id = cs(hit.x, hit.y, hit.z);
  if (!mcbMaterial(id)) {
    mcbToast(mcbT('Этот блок нельзя взять в инвентарь.', 'This block cannot be picked.'), 1800);
    return false;
  }
  return mcxBuildSelect(id);
}

/* ------------------------------------------------------- прицел и призрак */
/* Луч прицела строится от ЦЕНТРА камеры: начало — её мировая позиция, а
   направление — та же матрица, которой камера рисует кадр. Координаты игрока в
   расчёте не участвуют: глаз может быть смещён анимацией или наклоном, и тогда
   призрак «уезжал» бы от перекрестия. Дальше — воксельный DDA (zl) и клетка
   постановки = попадание + нормаль грани. Ничего не берём от позиции игрока. */
var MCB_REACH = 7;

/* Мировая позиция камеры. Берём её прямо из matrixWorld: так расчёт не зависит
   ни от координат игрока, ни от того, есть ли под рукой класс Vector3. */
function mcbCameraOrigin() {
  if (Wt) {
    try {
      if (typeof Wt.updateWorldMatrix === 'function') Wt.updateWorldMatrix(true, false);
      var m = Wt.matrixWorld && Wt.matrixWorld.elements;
      if (m && isFinite(m[12]) && isFinite(m[13]) && isFinite(m[14])) {
        return { x: m[12], y: m[13], z: m[14] };
      }
    } catch (e) { /* ниже — резервный путь */ }
    if (Wt.position && isFinite(Wt.position.x)) {
      return { x: Wt.position.x, y: Wt.position.y, z: Wt.position.z };
    }
  }
  /* Резерв, пока камеры нет в сцене: глаз игрока на стандартной высоте. */
  if (F && isFinite(F.x) && isFinite(F.y) && isFinite(F.z)) {
    return { x: F.x, y: F.y + 1.62, z: F.z };
  }
  return null;
}

/* Направление взгляда — ось -Z камеры (та же, что у матрицы кадра). */
function mcbRayDir() {
  if (Wt) {
    try {
      if (typeof Wt.updateWorldMatrix === 'function') Wt.updateWorldMatrix(true, false);
      var m = Wt.matrixWorld && Wt.matrixWorld.elements;
      if (m) {
        var dx = -m[8], dy = -m[9], dz = -m[10];
        var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (isFinite(len) && len > 1e-6) {
          return { x: dx / len, y: dy / len, z: dz / len };
        }
      }
    } catch (e) { /* ниже — по углам игрока */ }
  }
  if (!F || !isFinite(F.yaw) || !isFinite(F.pitch)) return null;
  var cp = Math.cos(F.pitch);
  return { x: -Math.sin(F.yaw) * cp, y: Math.sin(F.pitch), z: -Math.cos(F.yaw) * cp };
}

/* Прицел: попадание блока и клетка постановки рядом с его гранью. */
function mcbAim() {
  mcbState.aim = null;
  var origin = mcbCameraOrigin();
  var dir = mcbRayDir();
  if (!origin || !dir) return null;
  var hit = null;
  try {
    hit = zl(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, MCB_REACH);
  } catch (e) {
    hit = null;
  }
  if (hit) {
    /* Клетка строго по сетке: соседняя с гранью, в которую попал луч. */
    hit.px = hit.x + hit.nx;
    hit.py = hit.y + hit.ny;
    hit.pz = hit.z + hit.nz;
  }
  mcbState.aim = hit;
  return hit;
}

/* Габарит игрока: ±0.4 по X/Z и рост 1.8 (как в физике игры). */
function mcbInsidePlayer(x, y, z) {
  if (typeof F === 'undefined' || !F || !isFinite(F.x)) return false;
  return Math.abs(x + .5 - F.x) < .8 && Math.abs(z + .5 - F.z) < .8 &&
    y < F.y + 1.8 && y + 1 > F.y;
}

/* Почему в клетку нельзя ставить: '' — можно.
   'bounds' — за границей мира, 'busy' — там уже блок (чужая постройка/рельеф),
   'player' — внутри игрока, 'stock' — не хватает материала. */
function mcbPlaceReason(x, y, z, id) {
  if (x < 0 || x >= ct || z < 0 || z >= ct || y < 0 || y >= dn) return 'bounds';
  if (id != null && mcbMaterial(id) && !mcbBlockAllowed(id)) return 'locked';
  var current = cs(x, y, z);
  /* Воздух и вода: воду блок вытесняет. Всё остальное — занято. */
  if (current !== Ai && current !== qh) return 'busy';
  if (mcbInsidePlayer(x, y, z)) return 'player';
  if (id != null && mcbMaterial(id) && mcbStock(id) <= 0) return 'stock';
  return '';
}

function mcbReasonText(reason, detail) {
  if (reason === 'bounds') return mcbT('Здесь граница мира — постройка не влезает.',
    'This is the world border — the build does not fit.');
  if (reason === 'player') return mcbT('Вы стоите в этой клетке — отойдите на шаг.',
    'You are standing in that cell — step aside.');
  if (reason === 'busy') return mcbT('Клетка уже занята: постройка не ломает существующие блоки.',
    'That cell is occupied: a build never overwrites existing blocks.');
  if (reason === 'stock') return detail || mcbT('Не хватает материала.',
    'Not enough material.');
  if (reason === 'ground') return mcbT('Стройте с земли: наведитесь на поверхность, а не на стену.',
    'Build from the ground: aim at a surface, not at a wall.');
  if (reason === 'locked') return mcbT('Этот блок отключён администратором.',
    'This block is disabled by the administrator.');
  if (reason === 'notarget') return mcbT('Наведитесь на поверхность: нужна клетка под постройку.',
    'Aim at a surface to pick the building spot.');
  return mcbT('Постройку здесь поставить нельзя.', 'The build cannot be placed here.');
}

function mcbCanPlace(x, y, z) {
  return mcbPlaceReason(x, y, z) === '';
}

/* Покадровая часть: восстановление постройки и луч прицела. Ничего не
   рисуем: у игрока нет ни призрака блока, ни подсветки — только перекрестие,
   а расчёт клетки постановки идёт тем же лучом, что и раньше. */
function mcbTick() {
  if (Mt !== 'playing' || !F) {
    if (mcbState.open && !mcbState.layoutMode) mcbClose();
    return;
  }
  if (!mcbState.loaded) mcbLoad();
  mcbRestore();
  mcbAim();
  if (mcbState.planKey) mcbPlanBarRefresh();
}

/* Полоска чертежа пересчитывается только при смене клетки или поворота:
   каждый кадр пересчитывать проверку всей постройки незачем. */
function mcbPlanBarRefresh() {
  var base = mcbPlanBase();
  var sig = mcbState.planKey + '|' + mcbState.planDir + '|' +
    (base ? (base.x + ',' + base.y + ',' + base.z) : '-');
  if (sig === mcbState.planBarKey) return;
  mcbState.planBarKey = sig;
  mcbPlanBar(mcbPlanCheck(mcbState.planKey, mcbState.planDir));
}

/* -------------------------------------------------------------- шаблоны */
/* Шаблон — это данные: список блоков относительно опорной клетки. Правила у
   всех шаблонов одинаковые: пол на y=0 (стоит на земле), стены от y=1, крыша
   сверху. Клетки не дублируются, «плавающих» блоков нет — каждая часть
   опирается на предыдущую. */
function mcbPlanBuilder() {
  var map = {}, list = [];
  function key(x, y, z) { return x + ',' + y + ',' + z; }
  function put(x, y, z, id) {
    x = Math.round(x); y = Math.round(y); z = Math.round(z);
    var k = key(x, y, z);
    if (map[k]) {
      map[k].id = id;             /* верхний слой важнее: окно поверх стены */
      return map[k];
    }
    var block = { x: x, y: y, z: z, id: id };
    map[k] = block;
    list.push(block);
    return block;
  }
  function erase(x, y, z) {
    var k = key(Math.round(x), Math.round(y), Math.round(z));
    if (map[k]) map[k].id = 0;     /* проём: дверь, ворота, окно */
  }
  function fill(x0, y0, z0, x1, y1, z1, id) {
    for (var y = y0; y <= y1; y++)
      for (var x = x0; x <= x1; x++)
        for (var z = z0; z <= z1; z++) put(x, y, z, id);
  }
  function shell(x0, y0, z0, x1, y1, z1, id) {
    for (var y = y0; y <= y1; y++)
      for (var x = x0; x <= x1; x++)
        for (var z = z0; z <= z1; z++)
          if (x === x0 || x === x1 || z === z0 || z === z1) put(x, y, z, id);
  }
  function done() {
    var out = [];
    for (var i = 0; i < list.length; i++) if (list[i].id) out.push(list[i]);
    return out;
  }
  return { put: put, erase: erase, fill: fill, shell: shell, done: done };
}

/* Шатровая крыша: каждый уровень уже на клетку с каждой стороны. Крыша всегда
   накрывает стены целиком — ни щелей, ни свисающих блоков без опоры. */
function mcbTplRoof(b, x0, z0, x1, z1, y, id) {
  var level = 0;
  while (x0 + level <= x1 - level && z0 + level <= z1 - level) {
    b.fill(x0 + level, y + level, z0 + level, x1 - level, y + level, z1 - level, id);
    if (x1 - x0 - 2 * level < 2 && z1 - z0 - 2 * level < 2) break;
    level++;
    if (level > 24) break;
  }
  return y + level;
}

/* Обрешётка стены: углы отдельным материалом, чтобы силуэт читался. */
function mcbTplFrame(b, x0, z0, x1, z1, y0, y1, cornerId) {
  for (var y = y0; y <= y1; y++) {
    b.put(x0, y, z0, cornerId);
    b.put(x1, y, z0, cornerId);
    b.put(x0, y, z1, cornerId);
    b.put(x1, y, z1, cornerId);
  }
}

/* ======================= строительные помощники =======================
   Каждый шаблон собирается из одних и тех же деталей: фундамент, стены с
   угловыми стойками, полы, двери с рамой и крыльцом, окна с подоконником и
   перемычкой, крыша без щелей. Поэтому «недоделанных» построек нет: всё, что
   игрок выбирает в чертежах, проверено тестами на целостность.
   ==================================================================== */

/* Фундамент: сплошная плита на клетку шире стен. Она же цоколь и основание
   пола — постройка никогда не повисает на одной клетке. */
function mcbTplPlinth(b, x0, z0, x1, z1, id) {
  b.fill(x0 - 1, 0, z0 - 1, x1 + 1, 0, z1 + 1, id);
}

/* Пол: сплошная плита внутри стен (перекрывает цоколь). */
function mcbTplPlate(b, x0, z0, x1, z1, y, id) {
  b.fill(x0, y, z0, x1, y, z1, id);
}

/* Стены по периметру + угловые стойки другим материалом. */
function mcbTplWalls(b, x0, z0, x1, z1, y0, y1, id, cornerId) {
  b.shell(x0, y0, z0, x1, y1, z1, id);
  if (cornerId != null) mcbTplFrame(b, x0, z0, x1, z1, y0, y1, cornerId);
}

/* Фахверк: стойки через каждые две клетки по всему периметру. */
function mcbTplTimber(b, x0, z0, x1, z1, y0, y1, id, step) {
  var s = step || 2, x, z, y;
  for (y = y0; y <= y1; y++) {
    for (x = x0; x <= x1; x += s) { b.put(x, y, z0, id); b.put(x, y, z1, id); }
    for (z = z0; z <= z1; z += s) { b.put(x0, y, z, id); b.put(x1, y, z, id); }
  }
}

/* Окно: стекло в клетке стены, подоконник и перемычка из отделки. Стена
   остаётся сплошной — это окно, а не дыра. */
function mcbTplWindow(b, x, z, y, frameId, noLintel) {
  b.put(x, y, z, GL);
  b.put(x, y - 1, z, frameId);
  if (!noLintel) b.put(x, y + 1, z, frameId);
}

/* Ряд окон по стене: axis 'x' — стена идёт вдоль X (z фиксирован). */
function mcbTplWindowRow(b, axis, fixed, from, to, step, y, frameId, noLintel) {
  for (var i = from; i <= to; i += (step || 2)) {
    if (axis === 'x') mcbTplWindow(b, i, fixed, y, frameId, noLintel);
    else mcbTplWindow(b, fixed, i, y, frameId, noLintel);
  }
}

/* Дверь: проём в две клетки, рама по бокам, перемычка сверху и ступень снаружи.
   out — наружное направление: {dx,dz}. */
function mcbTplDoor(b, x, z, y0, out, frameId, stepId) {
  b.erase(x, y0, z);
  b.erase(x, y0 + 1, z);
  b.put(x, y0 + 2, z, frameId);
  if (out.dx !== 0) {
    b.put(x, y0, z - 1, frameId); b.put(x, y0 + 1, z - 1, frameId);
    b.put(x, y0, z + 1, frameId); b.put(x, y0 + 1, z + 1, frameId);
  } else {
    b.put(x - 1, y0, z, frameId); b.put(x - 1, y0 + 1, z, frameId);
    b.put(x + 1, y0, z, frameId); b.put(x + 1, y0 + 1, z, frameId);
  }
  b.put(x + out.dx, 0, z + out.dz, stepId);
}

/* Ворота: проём шириной 3 и высотой 2 с перемычкой и пятой. */
function mcbTplGate(b, xa, xb, z, y0, frameId) {
  for (var x = xa; x <= xb; x++) {
    b.erase(x, y0, z);
    b.erase(x, y0 + 1, z);
    b.put(x, y0 + 2, z, frameId);
  }
  b.put(xa - 1, y0, z, frameId); b.put(xa - 1, y0 + 1, z, frameId);
  b.put(xb + 1, y0, z, frameId); b.put(xb + 1, y0 + 1, z, frameId);
}

/* Двускатная крыша. Первый ярус накрывает всю коробку, каждый следующий уже
   на клетку с двух сторон, сверху — конёк. Щелей в такой крыше не бывает. */
function mcbTplGable(b, x0, z0, x1, z1, y, id, ridgeId) {
  var level = 0, top = 0;
  while (z0 + level <= z1 - level) {
    top = level;
    for (var z = z0 + level; z <= z1 - level; z++)
      for (var x = x0; x <= x1; x++) b.put(x, y + level, z, id);
    level++;
    if (level > 20) break;
  }
  if (ridgeId != null) {
    for (var x2 = x0; x2 <= x1; x2++)
      for (var z2 = z0 + top; z2 <= z1 - top; z2++) b.put(x2, y + top, z2, ridgeId);
  }
  return y + level;
}

/* Шатровая крыша: ярус уменьшается и по X, и по Z. */
function mcbTplHip(b, x0, z0, x1, z1, y, id, ridgeId) {
  var level = 0, top = 0;
  while (x0 + level <= x1 - level && z0 + level <= z1 - level) {
    top = level;
    for (var x = x0 + level; x <= x1 - level; x++)
      for (var z = z0 + level; z <= z1 - level; z++) b.put(x, y + level, z, id);
    level++;
    if (level > 24) break;
  }
  if (ridgeId != null) b.put(x0 + top, y + top, z0 + top, ridgeId);
  return y + level;
}

/* Зубцы по периметру: каждый второй блок сверху. */
function mcbTplCrenels(b, x0, z0, x1, z1, y, id) {
  for (var x = x0; x <= x1; x++) {
    for (var z = z0; z <= z1; z++) {
      if (x !== x0 && x !== x1 && z !== z0 && z !== z1) continue;
      if ((x + z) % 2 === 0) b.put(x, y, z, id);
    }
  }
}

/* Лестница внутри дома: у каждой ступени сплошная опора до пола, поэтому
   висящих клеток нет, а подъём идёт по одной клетке за шаг. */
function mcbTplStairs(b, x, zStart, y0, steps, id) {
  for (var i = 0; i < steps; i++)
    for (var y = y0; y <= y0 + i; y++) b.put(x, y, zStart + i, id);
  return y0 + steps;
}

/* Труба: сплошной столб от основания до крыши и выше. */
function mcbTplChimney(b, x, z, y0, y1, id, capId) {
  for (var y = y0; y <= y1; y++) b.put(x, y, z, id);
  if (capId != null) b.put(x, y1 + 1, z, capId);
}

/* Колонна: база, ствол и капитель. */
function mcbTplColumn(b, x, z, y0, y1, shaftId, capId) {
  for (var y = y0; y <= y1; y++) b.put(x, y, z, shaftId);
  b.put(x, y1 + 1, z, capId);
}

/* --- сами шаблоны ------------------------------------------------------- */
var MCB_TEMPLATES = [
  {
    key: 'smallHouse', cat: 'home', ru: 'Маленький деревянный дом', en: 'Small wooden house',
    build: function (b) {
      var W = 5, D = 5;
      mcbTplPlinth(b, 0, 0, W - 1, D - 1, CB);
      mcbTplPlate(b, 0, 0, W - 1, D - 1, 0, PL);          // деревянный пол
      mcbTplWalls(b, 0, 0, W - 1, D - 1, 1, 3, PL, Xh);   // стены + угловые стойки
      mcbTplDoor(b, 2, 0, 1, { dx: 0, dz: -1 }, DW, CB);
      b.put(2, 3, 0, GL);                                  // фрамуга над дверью
      mcbTplWindowRow(b, 'x', D - 1, 1, 3, 2, 2, DW);      // окна на задней стене
      mcbTplWindow(b, 0, 2, 2, DW);                        // окна по бокам
      mcbTplWindow(b, W - 1, 2, 2, DW);
      mcbTplChimney(b, 1, 1, 1, 6, CB, SL);                // печь и труба
      mcbTplGable(b, 0, 0, W - 1, D - 1, 4, RF, SL);       // крыша с коньком
      b.fill(1, 4, -1, 3, 4, -1, RF);                      // козырёк над крыльцом
      b.put(1, 1, 1, Hh); b.put(2, 1, 1, Hh);              // топка у стены
      b.put(4, 1, 4, DW); b.put(4, 2, 4, DW);              // полка в углу
    },
    meta: {
      foot: [0, 0, 4, 4], wallTop: 3, roof: { rect: [0, 0, 4, 4], y: 4, open: [[1, 1]] },
      walls: [{ rect: [0, 0, 4, 4], y0: 1, y1: 3, open: [[2, 1, 0], [2, 2, 0]] }],
      door: { x: 2, z: 0, y0: 1, h: 2 },
      glass: [[2, 3, 0, 1], [1, 2, 4], [3, 2, 4], [0, 2, 2], [4, 2, 2]]
    }
  },
  {
    key: 'largeHouse', cat: 'home', ru: 'Большой деревянный дом', en: 'Large wooden house',
    build: function (b) {
      var W = 7, D = 7;
      mcbTplPlinth(b, 0, 0, W - 1, D - 1, CB);
      mcbTplPlate(b, 0, 0, W - 1, D - 1, 0, PL);
      mcbTplWalls(b, 0, 0, W - 1, D - 1, 1, 3, PL, Xh);
      mcbTplPlate(b, 0, 0, W - 1, D - 1, 4, DW);           // межэтажный настил
      mcbTplWalls(b, 0, 0, W - 1, D - 1, 5, 6, PL, Xh);
      mcbTplDoor(b, 3, 0, 1, { dx: 0, dz: -1 }, DW, CB);
      mcbTplWindowRow(b, 'x', 0, 1, 5, 4, 2, DW);          // первый этаж
      mcbTplWindowRow(b, 'x', D - 1, 1, 5, 4, 2, DW);
      mcbTplWindow(b, 0, 2, 2, DW); mcbTplWindow(b, 0, 4, 2, DW);
      mcbTplWindow(b, W - 1, 2, 2, DW); mcbTplWindow(b, W - 1, 4, 2, DW);
      mcbTplWindowRow(b, 'x', 0, 1, 5, 4, 6, DW, true);     // второй этаж
      mcbTplWindowRow(b, 'x', D - 1, 1, 5, 4, 6, DW, true);
      mcbTplWindow(b, 0, 2, 6, DW, true); mcbTplWindow(b, W - 1, 4, 6, DW, true);
      mcbTplStairs(b, 1, 1, 1, 3, PL);                     // лестница на второй этаж
      b.erase(1, 4, 1); b.erase(1, 4, 2); b.erase(1, 4, 3); // проём над лестницей
      mcbTplChimney(b, 3, 5, 4, 9, CB, SL);
      mcbTplGable(b, 0, 0, W - 1, D - 1, 7, RF, SL);
      b.fill(2, 7, -1, 4, 7, -1, RF);
    },
    meta: {
      foot: [0, 0, 6, 6], wallTop: 6, roof: { rect: [0, 0, 6, 6], y: 7 },
      walls: [
        { rect: [0, 0, 6, 6], y0: 1, y1: 3, open: [[3, 1, 0], [3, 2, 0]] },
        { rect: [0, 0, 6, 6], y0: 5, y1: 6, open: [] }
      ],
      floors: [{ y: 4, rect: [0, 0, 6, 6], holes: [[1, 1, 1, 3]] }],
      door: { x: 3, z: 0, y0: 1, h: 2 },
      glass: [[1, 2, 0], [5, 2, 0], [1, 2, 6], [5, 2, 6], [0, 2, 2], [0, 2, 4], [6, 2, 2], [6, 2, 4]]
    }
  },
  {
    key: 'stoneHouse', cat: 'home', ru: 'Каменный дом', en: 'Stone house',
    build: function (b) {
      var W = 7, D = 5;
      mcbTplPlinth(b, 0, 0, W - 1, D - 1, SB);
      mcbTplPlate(b, 0, 0, W - 1, D - 1, 0, SL);
      mcbTplWalls(b, 0, 0, W - 1, D - 1, 1, 3, CB, SB);
      mcbTplDoor(b, 3, 0, 1, { dx: 0, dz: -1 }, DW, SB);
      b.put(3, 3, 0, GL);                                  // фрамуга
      mcbTplWindow(b, 1, 0, 2, SB); mcbTplWindow(b, 5, 0, 2, SB);
      mcbTplWindowRow(b, 'x', D - 1, 1, 5, 2, 2, SB);
      mcbTplWindow(b, 0, 2, 2, SB);
      mcbTplWindow(b, W - 1, 2, 2, SB);
      b.put(3, 3, 0, GL);                                  // фрамуга над дверью
      mcbTplChimney(b, 1, 1, 1, 6, SB, SL);
      mcbTplGable(b, 0, 0, W - 1, D - 1, 4, SL, SB);
      b.fill(1, 4, -1, 5, 4, -1, SL);                      // навес у входа
      b.put(1, 1, 3, DW); b.put(2, 1, 3, DW);              // стол внутри
    },
    meta: {
      foot: [0, 0, 6, 4], wallTop: 3, roof: { rect: [0, 0, 6, 4], y: 4 },
      walls: [{ rect: [0, 0, 6, 4], y0: 1, y1: 3, open: [[3, 1, 0], [3, 2, 0]] }],
      door: { x: 3, z: 0, y0: 1, h: 2 },
      glass: [[3, 3, 0, 1], [1, 2, 0], [5, 2, 0], [1, 2, 4], [5, 2, 4], [0, 2, 2], [6, 2, 2]]
    }
  },
  {
    key: 'medievalHouse', cat: 'home', ru: 'Средневековый дом', en: 'Medieval house',
    build: function (b) {
      var W = 7, D = 7;
      mcbTplPlinth(b, 0, 0, W - 1, D - 1, CB);
      mcbTplPlate(b, 0, 0, W - 1, D - 1, 0, PL);
      mcbTplWalls(b, 0, 0, W - 1, D - 1, 1, 3, PS, DW);    // штукатурка + фахверк
      mcbTplTimber(b, 0, 0, W - 1, D - 1, 1, 3, DW, 2);
      mcbTplPlate(b, -1, -1, W, D, 4, PL);                 // настил второго этажа со свесом
      mcbTplWalls(b, -1, -1, W, D, 5, 6, PS, DW);
      mcbTplTimber(b, -1, -1, W, D, 5, 6, DW, 2);
      mcbTplDoor(b, 3, 0, 1, { dx: 0, dz: -1 }, DW, CB);
      mcbTplWindow(b, 1, 0, 2, DW); mcbTplWindow(b, 5, 0, 2, DW);
      mcbTplWindowRow(b, 'x', D - 1, 1, 5, 2, 2, DW);
      mcbTplWindow(b, 0, 2, 2, DW); mcbTplWindow(b, W - 1, 4, 2, DW);
      mcbTplWindowRow(b, 'x', -1, 1, 5, 4, 6, DW, true);   // окна второго этажа
      mcbTplWindowRow(b, 'x', D, 1, 5, 4, 6, DW, true);
      mcbTplWindow(b, -1, 3, 6, DW, true); mcbTplWindow(b, W, 3, 6, DW, true);
      mcbTplStairs(b, 1, 1, 1, 3, PL);
      b.erase(1, 4, 1); b.erase(1, 4, 2); b.erase(1, 4, 3);
      mcbTplChimney(b, 5, 1, 1, 10, SB, SL);
      mcbTplGable(b, -1, -1, W, D, 7, RF, SL);
    },
    meta: {
      foot: [0, 0, 6, 6], wallTop: 6, roof: { rect: [-1, -1, 7, 7], y: 7 },
      walls: [
        { rect: [0, 0, 6, 6], y0: 1, y1: 3, open: [[3, 1, 0], [3, 2, 0]] },
        { rect: [-1, -1, 7, 7], y0: 5, y1: 6, open: [] }
      ],
      floors: [{ y: 4, rect: [0, 0, 6, 6], holes: [[1, 1, 1, 3]] }],
      door: { x: 3, z: 0, y0: 1, h: 2 },
      glass: [[1, 2, 0], [5, 2, 0], [1, 2, 6], [5, 2, 6], [0, 2, 2], [6, 2, 4],
        [1, 6, -1], [5, 6, -1]]
    }
  },
  {
    key: 'modernHouse', cat: 'home', ru: 'Современный дом', en: 'Modern house',
    build: function (b) {
      var W = 7, D = 5;
      mcbTplPlinth(b, 0, 0, W - 1, D - 1, SL);
      mcbTplPlate(b, 0, 0, W - 1, D - 1, 0, PS);
      mcbTplWalls(b, 0, 0, W - 1, D - 1, 1, 3, PS, SL);
      mcbTplDoor(b, 3, 0, 1, { dx: 0, dz: -1 }, DW, SL);
      /* Панорамное остекление вместо мелких окон. */
      b.put(1, 2, 0, GL); b.put(2, 2, 0, GL);
      b.put(4, 2, 0, GL); b.put(5, 2, 0, GL);
      b.put(0, 2, 1, GL); b.put(0, 2, 3, GL);
      b.put(2, 2, D - 1, GL); b.put(4, 2, D - 1, GL);
      mcbTplPlate(b, 0, 0, W - 1, D - 1, 4, SL);           // плоская крыша
      mcbTplFrame(b, 0, 0, W - 1, D - 1, 5, 5, SL);        // парапет
      b.put(3, 4, 2, GL);                                  // зенитное окно
      b.fill(1, 0, -2, 5, 0, -1, PL);                      // терраса перед домом
      b.put(1, 1, -2, Xh); b.put(5, 1, -2, Xh);            // стойки навеса
      b.fill(1, 2, -2, 5, 2, -2, DW);                      // навес
      mcbTplChimney(b, 6, 4, 1, 6, SB, SL);
    },
    meta: {
      foot: [0, 0, 6, 4], wallTop: 3,
      roof: { rect: [0, 0, 6, 4], y: 4, flat: true, open: [[3, 2], [6, 4]] },
      walls: [{ rect: [0, 0, 6, 4], y0: 1, y1: 3, open: [[3, 1, 0], [3, 2, 0]] }],
      door: { x: 3, z: 0, y0: 1, h: 2 },
      glass: [[1, 2, 0], [2, 2, 0], [4, 2, 0], [5, 2, 0], [0, 2, 1], [0, 2, 3], [2, 2, 4], [4, 2, 4], [3, 4, 2, 1]]
    }
  },
  {
    key: 'forestCabin', cat: 'home', ru: 'Лесной сруб', en: 'Forest cabin',
    build: function (b) {
      var W = 5, D = 5;
      mcbTplPlinth(b, 0, 0, W - 1, D - 1, CB);
      mcbTplPlate(b, 0, 0, W - 1, D - 1, 0, DW);
      mcbTplWalls(b, 0, 0, W - 1, D - 1, 1, 3, Xh, DW);    // сплошной сруб
      mcbTplDoor(b, 2, 0, 1, { dx: 0, dz: -1 }, DW, CB);
      mcbTplWindow(b, 0, 2, 2, DW);
      mcbTplWindow(b, W - 1, 2, 2, DW);
      mcbTplWindow(b, 2, D - 1, 2, DW);
      mcbTplGable(b, 0, 0, W - 1, D - 1, 4, RF, SL);
      /* Крыльцо: две стойки и навес над входом. */
      b.put(1, 1, -1, Xh); b.put(1, 2, -1, Xh); b.put(1, 3, -1, Xh);
      b.put(3, 1, -1, Xh); b.put(3, 2, -1, Xh); b.put(3, 3, -1, Xh);
      b.fill(1, 4, -2, 3, 4, -1, RF);
      b.fill(1, 0, -1, 3, 0, -1, PL);                      // настил крыльца
      b.put(4, 1, -1, Xh); b.put(4, 2, -1, Xh);            // поленница
      mcbTplChimney(b, 1, 1, 1, 6, Hh, SL);
    },
    meta: {
      foot: [0, 0, 4, 4], wallTop: 3, roof: { rect: [0, 0, 4, 4], y: 4, open: [[1, 1]] },
      walls: [{ rect: [0, 0, 4, 4], y0: 1, y1: 3, open: [[2, 1, 0], [2, 2, 0]] }],
      door: { x: 2, z: 0, y0: 1, h: 2 },
      glass: [[0, 2, 2], [4, 2, 2], [2, 2, 4]]
    }
  },
  {
    key: 'beachHouse', cat: 'home', ru: 'Дом на пляже', en: 'Beach house',
    build: function (b) {
      var W = 6, D = 5;
      mcbTplPlinth(b, 0, 0, W - 1, D - 1, Wh);
      mcbTplPlate(b, 0, 0, W - 1, D - 1, 0, PL);
      mcbTplWalls(b, 0, 0, W - 1, D - 1, 1, 2, PS, Xh);
      mcbTplWalls(b, 0, 0, W - 1, D - 1, 3, 3, DW, Xh);    // верхняя обвязка
      mcbTplDoor(b, 2, 0, 1, { dx: 0, dz: -1 }, DW, Wh);
      b.put(1, 1, 0, GL); b.put(1, 2, 0, GL);
      b.put(4, 1, 0, GL); b.put(4, 2, 0, GL);
      b.put(0, 2, 2, GL); b.put(W - 1, 2, 2, GL);
      b.put(2, 2, D - 1, GL); b.put(3, 2, D - 1, GL);
      mcbTplGable(b, 0, 0, W - 1, D - 1, 4, RF, SL);
      /* Открытая терраса на песке: настил, перила и стойки навеса. */
      b.fill(0, 0, -4, W - 1, 0, -1, PL);
      b.put(0, 1, -4, DW); b.put(3, 1, -4, DW); b.put(W - 1, 1, -4, DW);
      b.put(0, 2, -4, DW); b.put(3, 2, -4, DW); b.put(W - 1, 2, -4, DW);
      b.put(0, 1, -2, Xh); b.put(W - 1, 1, -2, Xh); b.put(0, 2, -2, Xh); b.put(W - 1, 2, -2, Xh);
      mcbTplChimney(b, 5, 4, 1, 6, SB, SL);
    },
    meta: {
      foot: [0, 0, 5, 4], wallTop: 3, roof: { rect: [0, 0, 5, 4], y: 4, open: [[5, 4]] },
      walls: [{ rect: [0, 0, 5, 4], y0: 1, y1: 2, open: [[2, 1, 0], [2, 2, 0]] }],
      door: { x: 2, z: 0, y0: 1, h: 2 },
      glass: [[1, 1, 0], [1, 2, 0], [4, 1, 0], [4, 2, 0], [0, 2, 2], [5, 2, 2], [2, 2, 4], [3, 2, 4]]
    }
  },
  {
    key: 'castle', cat: 'fort', ru: 'Замок', en: 'Castle',
    build: function (b) {
      var S = 13, x, z;
      b.fill(-1, 0, -1, S, 0, S, CB);                      // цоколь и двор
      b.fill(0, 0, 0, S - 1, 0, S - 1, Hh);                // дворовая площадь
      mcbTplWalls(b, 0, 0, S - 1, S - 1, 1, 4, CB, SB);    // куртины
      mcbTplCrenels(b, 0, 0, S - 1, S - 1, 5, SB);         // зубцы
      mcbTplGate(b, 5, 7, 0, 1, SB);                       // ворота
      /* Четыре угловые башни: свои зубцы и бойницы. */
      var corners = [[0, 0], [S - 3, 0], [0, S - 3], [S - 3, S - 3]], c, cx, cz, y;
      for (c = 0; c < corners.length; c++) {
        cx = corners[c][0];
        cz = corners[c][1];
        b.fill(cx, 0, cz, cx + 2, 0, cz + 2, SB);
        mcbTplWalls(b, cx, cz, cx + 2, cz + 2, 1, 7, SB, CB);
        mcbTplCrenels(b, cx, cz, cx + 2, cz + 2, 8, CB);
        b.put(cx + 1, 4, cz, GL); b.put(cx + 1, 6, cz + 2, GL);
        b.put(cx, 4, cz + 1, GL); b.put(cx + 2, 6, cz + 1, GL);
      }
      /* Лестница на стену, флаг на угловой башне и фонари у ворот. */
      mcbTplStairs(b, 3, 1, 1, 3, SB);
      b.put(0, 9, 0, Xh); b.put(0, 10, 0, Xh); b.put(0, 11, 0, DW);
      b.put(2, 5, 0, GL); b.put(10, 5, 0, GL);             // фонари на стене
    },
    meta: {
      foot: [0, 0, 12, 12],
      walls: [{ rect: [0, 0, 12, 12], y0: 1, y1: 4, open: [[5, 1, 0], [6, 1, 0], [7, 1, 0], [5, 2, 0], [6, 2, 0], [7, 2, 0]] }],
      gate: { x0: 5, x1: 7, z: 0, y0: 1 },
      towers: [[0, 0], [10, 0], [0, 10], [10, 10]]
    }
  },
  {
    key: 'tower', cat: 'fort', ru: 'Замковая башня', en: 'Castle tower',
    build: function (b) {
      var S = 5, H = 9, x, z;
      b.fill(-1, 0, -1, S, 0, S, CB);
      mcbTplWalls(b, 0, 0, S - 1, S - 1, 1, H, CB, SB);
      b.fill(0, 0, 0, S - 1, 0, S - 1, SL);                // пол первого яруса
      b.fill(1, 3, 1, S - 2, 3, S - 2, DW);                // деревянные настилы
      b.fill(1, 6, 1, S - 2, 6, S - 2, DW);
      mcbTplCrenels(b, 0, 0, S - 1, S - 1, H + 1, SB);
      mcbTplDoor(b, 2, 0, 1, { dx: 0, dz: -1 }, DW, CB);
      /* Бойницы на каждом ярусе: узкое окно-щель. */
      b.put(2, 5, 0, GL); b.put(2, 8, 0, GL);
      b.put(2, 2, S - 1, GL); b.put(2, 8, S - 1, GL);
      b.put(0, 5, 2, GL); b.put(S - 1, 5, 2, GL);
      /* Лестница по стене: ступени с опорой до пола. */
      mcbTplStairs(b, 1, 1, 1, 3, PL);
      mcbTplStairs(b, 3, 4, 4, 3, PL);
      b.put(1, 9, 1, Xh); b.put(1, 10, 1, DW);             // флагшток
    },
    meta: {
      foot: [0, 0, 4, 4],
      walls: [{ rect: [0, 0, 4, 4], y0: 1, y1: 9, open: [[2, 1, 0], [2, 2, 0]] }],
      door: { x: 2, z: 0, y0: 1, h: 2 },
      glass: [[2, 5, 0], [2, 8, 0], [2, 2, 4], [2, 8, 4], [0, 5, 2], [4, 5, 2]],
      floors: [{ y: 3, rect: [1, 1, 3, 3] }, { y: 6, rect: [1, 1, 3, 3] }]
    }
  },
  {
    key: 'fantasyTower', cat: 'fort', ru: 'Волшебная башня', en: 'Fantasy tower',
    build: function (b) {
      var W = 7, D = 7, x, z, y;
      b.fill(-1, 0, -1, W, 0, D, SB);                      // цоколь
      mcbTplPlate(b, 0, 0, W - 1, D - 1, 0, SL);
      mcbTplWalls(b, 0, 0, W - 1, D - 1, 1, 4, SB, CB);
      mcbTplPlate(b, 1, 1, W - 2, D - 2, 3, PL);           // межъярусный настил
      /* Пояс стеклянных окон по всему периметру — после настила. */
      for (x = 1; x <= W - 2; x++) { b.put(x, 3, 0, GL); b.put(x, 3, D - 1, GL); }
      for (z = 1; z <= D - 2; z++) { b.put(0, 3, z, GL); b.put(W - 1, 3, z, GL); }
      mcbTplWalls(b, 0, 0, W - 1, D - 1, 5, 8, PS, Xh);    // верхний ярус
      for (x = 1; x <= W - 2; x++) { b.put(x, 7, 0, GL); b.put(x, 7, D - 1, GL); }
      for (z = 1; z <= D - 2; z++) { b.put(0, 7, z, GL); b.put(W - 1, 7, z, GL); }
      /* Балкон-кольцо вокруг верхнего яруса. */
      b.fill(-1, 5, -1, W, 5, D, DW);
      b.erase(-1, 5, -1); b.erase(W, 5, -1); b.erase(-1, 5, D); b.erase(W, 5, D);
      mcbTplDoor(b, 3, 0, 1, { dx: 0, dz: -1 }, DW, SB);
      mcbTplStairs(b, 1, 1, 1, 3, PL);
      b.erase(1, 3, 1); b.erase(1, 3, 2); b.erase(1, 3, 3);
      /* Шатровый шпиль с навершием. */
      var top = mcbTplHip(b, 0, 0, W - 1, D - 1, 9, RF, SL);
      b.put(3, top, 3, SL);
      b.put(3, top + 1, 3, GL);
      b.put(3, top + 2, 3, SL);
      mcbTplChimney(b, 5, 5, 9, 11, SB, SL);
      /* Фонари у входа. */
      b.put(1, 1, -1, Xh); b.put(1, 2, -1, GL);
      b.put(W - 2, 1, -1, Xh); b.put(W - 2, 2, -1, GL);
    },
    meta: {
      foot: [0, 0, 6, 6], wallTop: 8, roof: { rect: [0, 0, 6, 6], y: 9, open: [[5, 5]] },
      walls: [
        { rect: [0, 0, 6, 6], y0: 1, y1: 4, open: [[3, 1, 0], [3, 2, 0]] },
        { rect: [0, 0, 6, 6], y0: 5, y1: 8, open: [] }
      ],
      door: { x: 3, z: 0, y0: 1, h: 2 },
      glass: [[1, 3, 0], [2, 3, 0], [4, 3, 0], [5, 3, 0], [0, 3, 2], [6, 3, 4], [1, 7, 0], [5, 7, 0], [0, 7, 3], [6, 7, 3]],
      floors: [{ y: 3, rect: [1, 1, 5, 5], holes: [[1, 1, 1, 3]] }]
    }
  },
  {
    key: 'wall', cat: 'fort', ru: 'Крепостная стена', en: 'Castle wall',
    build: function (b) {
      var L = 9, x, z;
      b.fill(-1, 0, -1, 2, 0, L, CB);                      // фундамент
      b.fill(0, 0, 0, 1, 3, L - 1, CB);                    // тело стены
      b.fill(0, 3, 0, 1, 3, L - 1, SB);                    // боевой ход
      mcbTplCrenels(b, 0, 0, 1, L - 1, 4, SB);
      /* Проход с перемычкой и бойницы. */
      for (x = 0; x <= 1; x++) { b.erase(x, 1, 4); b.erase(x, 2, 4); b.put(x, 3, 4, SB); }
      b.put(0, 2, 2, GL); b.put(1, 2, 2, GL);
      b.put(0, 2, 7, GL); b.put(1, 2, 7, GL);
      /* Наружная лестница на боевой ход у торца. */
      mcbTplStairs(b, 2, 5, 1, 3, SB);
      b.put(0, 1, 0, GL); b.put(1, 1, 0, GL);              // фонари у прохода
    },
    meta: {
      wall: { rect: [0, 0, 1, 8], y0: 1, y1: 3, open: [[0, 1, 4], [1, 1, 4], [0, 2, 4], [1, 2, 4]] },
      glass: [[0, 2, 2], [1, 2, 2], [0, 2, 7], [1, 2, 7]]
    }
  },
  {
    key: 'watchtower', cat: 'fort', ru: 'Сторожевая вышка', en: 'Watchtower',
    build: function (b) {
      var W = 5, H = 6;
      mcbTplPlinth(b, 0, 0, W - 1, W - 1, CB);
      mcbTplPlate(b, 0, 0, W - 1, W - 1, 0, PL);
      mcbTplWalls(b, 0, 0, W - 1, W - 1, 1, H, DW, Xh);
      mcbTplDoor(b, 2, 0, 1, { dx: 0, dz: -1 }, DW, CB);
      mcbTplWindow(b, 1, 0, 3, Xh); mcbTplWindow(b, 3, 0, 3, Xh);
      mcbTplWindow(b, 0, 2, 3, Xh); mcbTplWindow(b, W - 1, 2, 3, Xh);
      b.fill(0, H + 1, 0, W - 1, H + 1, W - 1, PL);        // площадка
      mcbTplWalls(b, 0, 0, W - 1, W - 1, H + 2, H + 2, DW, Xh); // перила
      b.erase(2, H + 2, 0);                                // выход на площадку
      mcbTplGable(b, 0, 0, W - 1, W - 1, H + 3, RF, SL);   // навес
      mcbTplStairs(b, 1, 1, 1, 4, PL);                     // лестница наверх
      b.erase(1, H + 1, 4);
    },
    meta: {
      foot: [0, 0, 4, 4], wallTop: 6,
      walls: [{ rect: [0, 0, 4, 4], y0: 1, y1: 6, open: [[2, 1, 0], [2, 2, 0]] }],
      door: { x: 2, z: 0, y0: 1, h: 2 },
      glass: [[1, 3, 0], [3, 3, 0], [0, 3, 2], [4, 3, 2]]
    }
  },
  {
    key: 'stoneBridge', cat: 'infra', ru: 'Каменный мост', en: 'Stone bridge',
    build: function (b) {
      var L = 11, z, x, y;
      b.fill(-2, -1, 0, 2, -1, 2, CB);                     // береговые опоры
      b.fill(-2, -1, L - 3, 2, -1, L - 1, CB);
      b.fill(-2, -2, 0, 2, -2, 2, CB);
      b.fill(-2, -2, L - 3, 2, -2, L - 1, CB);
      for (z = 0; z < L; z++) {
        b.fill(-1, 0, z, 1, 0, z, SL);                     // настил в три клетки
        b.put(-1, 1, z, z % 2 ? DW : Xh);                  // перила
        b.put(1, 1, z, z % 2 ? DW : Xh);
      }
      for (z = 1; z < L - 1; z += 3) {                     // столбы опор в воду
        b.put(-1, -1, z, CB); b.put(1, -1, z, CB);
        b.put(0, -1, z, CB);
      }
      b.put(-1, 2, 0, Xh); b.put(1, 2, 0, Xh);             // входные столбы
      b.put(-1, 2, L - 1, Xh); b.put(1, 2, L - 1, Xh);
      b.put(-1, 2, 0, GL);
    },
    meta: {
      bridge: { deck: [-1, 0, 1], z0: 0, z1: 10, railY: 1 }
    }
  },
  {
    key: 'villageHall', cat: 'infra', ru: 'Деревенская таверна', en: 'Village tavern',
    build: function (b) {
      var W = 9, D = 7;
      mcbTplPlinth(b, 0, 0, W - 1, D - 1, CB);
      mcbTplPlate(b, 0, 0, W - 1, D - 1, 0, PL);
      mcbTplWalls(b, 0, 0, W - 1, D - 1, 1, 3, PS, DW);
      mcbTplTimber(b, 0, 0, W - 1, D - 1, 1, 3, DW, 2);
      mcbTplPlate(b, 0, 0, W - 1, D - 1, 4, DW);
      mcbTplWalls(b, 0, 0, W - 1, D - 1, 5, 6, PS, DW);
      mcbTplTimber(b, 0, 0, W - 1, D - 1, 5, 6, DW, 2);
      mcbTplDoor(b, 4, 0, 1, { dx: 0, dz: -1 }, DW, CB);
      mcbTplWindow(b, 1, 0, 2, DW); mcbTplWindow(b, 7, 0, 2, DW);
      mcbTplWindowRow(b, 'x', D - 1, 1, 7, 3, 2, DW);
      mcbTplWindow(b, 0, 2, 2, DW); mcbTplWindow(b, 0, 4, 2, DW);
      mcbTplWindow(b, W - 1, 2, 2, DW); mcbTplWindow(b, W - 1, 4, 2, DW);
      mcbTplWindowRow(b, 'x', 0, 1, 7, 3, 6, DW, true);
      mcbTplWindowRow(b, 'x', D - 1, 1, 7, 3, 6, DW, true);
      mcbTplStairs(b, 1, 1, 1, 3, PL);
      b.erase(1, 4, 1); b.erase(1, 4, 2); b.erase(1, 4, 3);
      mcbTplGable(b, 0, 0, W - 1, D - 1, 7, RF, SL);
      mcbTplChimney(b, 7, 5, 1, 10, SB, SL);
      /* Вывеска над входом и фонарь у двери. */
      b.put(4, 4, -1, DW); b.put(5, 4, -1, DW);
      b.put(6, 1, -1, Xh); b.put(6, 2, -1, GL);
      b.fill(0, 0, -1, 8, 0, -1, PL);                      // площадка перед входом
    },
    meta: {
      foot: [0, 0, 8, 6], wallTop: 6, roof: { rect: [0, 0, 8, 6], y: 7, open: [[7, 5]] },
      walls: [
        { rect: [0, 0, 8, 6], y0: 1, y1: 3, open: [[4, 1, 0], [4, 2, 0]] },
        { rect: [0, 0, 8, 6], y0: 5, y1: 6, open: [] }
      ],
      floors: [{ y: 4, rect: [0, 0, 8, 6], holes: [[1, 1, 1, 3]] }],
      door: { x: 4, z: 0, y0: 1, h: 2 },
      glass: [[1, 2, 0], [7, 2, 0], [1, 2, 6], [4, 2, 6], [7, 2, 6], [0, 2, 2], [8, 2, 4]]
    }
  },
  {
    key: 'marketStall', cat: 'infra', ru: 'Рыночный навес', en: 'Market stall',
    build: function (b) {
      var W = 5, D = 5, x, z;
      b.fill(-1, 0, -1, W, 0, D, PL);                      // настил-фундамент
      mcbTplPlate(b, 0, 0, W - 1, D - 1, 0, DW);
      /* Четыре стойки и решётка прилавка. */
      var corners = [[0, 0], [W - 1, 0], [0, D - 1], [W - 1, D - 1]], c;
      for (c = 0; c < corners.length; c++) {
        for (var y = 1; y <= 3; y++) b.put(corners[c][0], y, corners[c][1], Xh);
      }
      b.fill(0, 1, 0, W - 1, 1, 0, DW);                    // прилавок
      b.fill(0, 1, D - 1, W - 1, 1, D - 1, DW);
      b.put(1, 2, 0, Bl); b.put(2, 2, 0, SB); b.put(3, 2, 0, Wh);   // товар
      b.put(1, 2, D - 1, GL); b.put(2, 2, D - 1, PL); b.put(3, 2, D - 1, Bl);
      b.fill(0, 4, 0, W - 1, 4, D - 1, RF);                // навес
      b.fill(-1, 3, -1, W, 3, D, DW);                      // бахрома навеса
      b.erase(-1, 3, -1); b.erase(W, 3, -1); b.erase(-1, 3, D); b.erase(W, 3, D);
      b.put(2, 5, 2, SL);                                  // конёк навеса
      b.put(2, 2, 2, GL);                                  // фонарь в центре
      b.put(2, 1, 2, Xh);
    },
    meta: {
      foot: [0, 0, 4, 4], wallTop: 3, roof: { rect: [0, 0, 4, 4], y: 4, flat: true }
    }
  },
  {
    key: 'temple', cat: 'decor', ru: 'Древний храм', en: 'Ancient temple',
    build: function (b) {
      var W = 9, D = 7, x, z;
      b.fill(-1, 0, -1, W, 0, D, Hh);                      // первая ступень
      b.fill(0, 1, 0, W - 1, 1, D - 1, Hh);                // вторая ступень
      b.fill(1, 2, 1, W - 2, 2, D - 2, SB);                // пол храма
      /* Колоннада по периметру. */
      var cols = [
        [1, 1], [1, 3], [1, 5], [7, 1], [7, 3], [7, 5],
        [3, 1], [5, 1], [3, 5], [5, 5]
      ];
      for (var c = 0; c < cols.length; c++) mcbTplColumn(b, cols[c][0], cols[c][1], 3, 6, SB, SL);
      b.fill(0, 7, 0, W - 1, 7, D - 1, SL);                // антаблемент
      mcbTplGable(b, 0, 0, W - 1, D - 1, 8, SL, SB);       // фронтон
      /* Святилище внутри: стены, вход и алтарь. */
      mcbTplWalls(b, 3, 2, 5, 4, 3, 5, SB, SL);
      b.erase(4, 3, 2); b.erase(4, 4, 2);
      b.put(4, 3, 4, SL); b.put(4, 3, 3, GL);              // алтарь
      b.fill(4, 0, -1, 4, 1, -1, SB);                     // дорожка к входу
      b.put(4, 2, -1, SB);
      b.put(0, 2, 0, GL); b.put(8, 2, 6, GL);              // чаши с огнём
    },
    meta: {
      foot: [-1, -1, 9, 7],
      temple: { cols: [[1, 1], [7, 5]], altar: [4, 3, 4] }
    }
  },
  {
    key: 'monument', cat: 'decor', ru: 'Монумент', en: 'Monument',
    build: function (b) {
      b.fill(-1, 0, -1, 5, 0, 5, Hh);                      // площадка
      b.fill(0, 1, 0, 4, 1, 4, SB);                        // первая ступень
      b.fill(1, 2, 1, 3, 2, 3, SL);                        // пьедестал
      var y;
      for (y = 3; y <= 7; y++) b.put(2, y, 2, SL);         // обелиск
      b.put(2, 8, 2, SB); b.put(2, 9, 2, GL);              // навершие
      /* Угловые фонари и зелень. */
      var corners = [[0, 0], [4, 0], [0, 4], [4, 4]], c;
      for (c = 0; c < corners.length; c++) {
        b.put(corners[c][0], 2, corners[c][1], Xh);
        b.put(corners[c][0], 3, corners[c][1], GL);
        b.put(corners[c][0], 1, corners[c][1], Bl);
      }
      b.put(2, 1, 0, SB); b.put(2, 1, 4, SB);
    },
    meta: {
      foot: [-1, -1, 5, 5],
      monument: { shaft: [2, 2], top: 9 }
    }
  },
  {
    key: 'fountain', cat: 'decor', ru: 'Фонтан', en: 'Fountain',
    build: function (b) {
      var S = 5;
      b.fill(-1, 0, -1, S, 0, S, SL);                      // площадка
      b.fill(0, 1, 0, S - 1, 1, S - 1, SB);                // бортик чаши
      b.fill(1, 1, 1, S - 2, 1, S - 2, GL);                // вода
      mcbTplColumn(b, 2, 2, 2, 4, SL, SB);                 // колонна
      b.fill(1, 5, 1, 3, 5, 3, SB);                        // верхняя чаша
      b.fill(1, 5, 1, 3, 5, 3, GL);
      b.put(2, 5, 2, SL); b.put(2, 6, 2, GL);
      var corners = [[0, 0], [S - 1, 0], [0, S - 1], [S - 1, S - 1]], c;
      for (c = 0; c < corners.length; c++) {
        b.put(corners[c][0], 2, corners[c][1], Xh);
        b.put(corners[c][0], 3, corners[c][1], GL);
      }
    },
    meta: {
      foot: [-1, -1, 5, 5],
      fountain: { basin: [0, 1], centre: [2, 2] }
    }
  },
  {
    key: 'stairs', cat: 'parts', ru: 'Лестница', en: 'Stairs',
    build: function (b) {
      for (var i = 0; i < 5; i++)
        for (var w = -1; w <= 1; w++)
          for (var y = 0; y <= i; y++) b.put(w, y, i, PL);
    },
    meta: { part: true }
  },
  {
    key: 'roof', cat: 'parts', ru: 'Крыша', en: 'Roof',
    build: function (b) { mcbTplGable(b, -3, 0, 3, 4, 0, RF, SL); },
    meta: { part: true }
  },
  {
    key: 'fence', cat: 'parts', ru: 'Забор', en: 'Fence',
    build: function (b) {
      for (var z = 0; z < 8; z++) {
        if (z % 2 === 0) { b.put(0, 0, z, Xh); b.put(0, 1, z, Xh); }
        b.put(0, 1, z, DW);
        if (z % 2 === 0) b.put(0, 1, z, Xh);
        b.put(0, 2, z, DW);
      }
    },
    meta: { part: true }
  },
  {
    key: 'window', cat: 'parts', ru: 'Окно', en: 'Window',
    build: function (b) {
      for (var x = 0; x < 3; x++) for (var y = 0; y < 3; y++) {
        var frame = x === 0 || x === 2 || y === 0 || y === 2;
        b.put(x, y, 0, frame ? PL : GL);
      }
    },
    meta: { part: true }
  },
  {
    key: 'door', cat: 'parts', ru: 'Дверь', en: 'Door',
    build: function (b) {
      for (var x = 0; x < 3; x++) {
        b.put(x, 0, 0, DW);
        b.put(x, 3, 0, DW);
      }
      b.put(0, 1, 0, DW); b.put(0, 2, 0, DW);
      b.put(2, 1, 0, DW); b.put(2, 2, 0, DW);
      b.put(1, 1, 0, CB); b.put(1, 2, 0, DW);
    },
    meta: { part: true }
  },
  {
    key: 'floor', cat: 'parts', ru: 'Пол', en: 'Floor',
    build: function (b) { b.fill(0, 0, 0, 4, 0, 4, PL); },
    meta: { part: true }
  }
];

var MCB_PLAN_CATS = [
  { id: 'home', ru: 'Дома', en: 'Houses' },
  { id: 'fort', ru: 'Крепости', en: 'Fortresses' },
  { id: 'infra', ru: 'Инфраструктура', en: 'Infrastructure' },
  { id: 'decor', ru: 'Декор', en: 'Decor' },
  { id: 'parts', ru: 'Элементы', en: 'Parts' }
];

var MCB_PLAN_NAMES = [];
var MCB_PLANS = {};
(function () {
  for (var i = 0; i < MCB_TEMPLATES.length; i++) {
    var tpl = MCB_TEMPLATES[i];
    MCB_PLAN_NAMES.push({ key: tpl.key, ru: tpl.ru, en: tpl.en, cat: tpl.cat });
    MCB_PLANS[tpl.key] = (function (key) {
      return function () { return mcbPlanBlocks(key, 0); };
    })(tpl.key);
  }
})();

function mcbTemplate(key) {
  for (var i = 0; i < MCB_TEMPLATES.length; i++) if (MCB_TEMPLATES[i].key === key) return MCB_TEMPLATES[i];
  return null;
}

function mcbBuildPlan(key) {
  var tpl = mcbTemplate(key);
  if (!tpl) return [];
  var b = mcbPlanBuilder();
  tpl.build(b);
  return b.done();
}

/* ------------------------------------------------- проверка постройки */
/* Перед постройкой шаблон проверяется на целостность: фундамент, полы, стены
   без лишних щелей, дверь с перемычкой, окна со стеклом и подоконником, крыша,
   закрытая в каждом столбце, и отсутствие висящих блоков. Возвращает список
   замечаний: пустой список — постройка закончена. */
function mcbPlanValidate(key) {
  var tpl = mcbTemplate(key);
  var out = [];
  if (!tpl) return ['unknown template'];
  var blocks = mcbBuildPlan(key);
  if (!blocks.length) return ['empty template'];
  var map = {}, i, b, k;
  for (i = 0; i < blocks.length; i++) {
    b = blocks[i];
    if (b.x !== Math.round(b.x) || b.y !== Math.round(b.y) || b.z !== Math.round(b.z)) {
      out.push('unaligned block');
      continue;
    }
    k = b.x + ',' + b.y + ',' + b.z;
    if (map[k]) out.push('duplicate cell ' + k);
    map[k] = b;
  }
  function solid(x, y, z) { return !!map[x + ',' + y + ',' + z]; }
  function idAt(x, y, z) {
    var c = map[x + ',' + y + ',' + z];
    return c ? c.id : 0;
  }
  function eachCell(rect, fn) {
    for (var x = rect[0]; x <= rect[2]; x++)
      for (var z = rect[1]; z <= rect[3]; z++) fn(x, z);
  }

  /* Связность: всё сооружение — одна деталь, соединённая с нижним слоем. */
  var minY = Infinity;
  for (i = 0; i < blocks.length; i++) if (blocks[i].y < minY) minY = blocks[i].y;
  var seen = {}, queue = [];
  for (i = 0; i < blocks.length; i++) {
    b = blocks[i];
    if (b.y !== minY) continue;
    k = b.x + ',' + b.y + ',' + b.z;
    if (seen[k]) continue;
    seen[k] = 1;
    queue.push(b);
  }
  var dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  var reached = 0;
  while (queue.length) {
    var cur = queue.pop();
    reached++;
    for (i = 0; i < dirs.length; i++) {
      var nk = (cur.x + dirs[i][0]) + ',' + (cur.y + dirs[i][1]) + ',' + (cur.z + dirs[i][2]);
      if (!map[nk] || seen[nk]) continue;
      seen[nk] = 1;
      queue.push(map[nk]);
    }
  }
  if (reached !== blocks.length) out.push('floating blocks: ' + (blocks.length - reached));

  var m = tpl.meta || {};

  if (m.foot) {
    var footGaps = 0;
    eachCell(m.foot, function (x, z) { if (!solid(x, 0, z)) footGaps++; });
    if (footGaps) out.push('foundation gaps: ' + footGaps);
  }

  if (m.floors) {
    for (var f = 0; f < m.floors.length; f++) {
      var fl = m.floors[f], holes = fl.holes || [], flGaps = 0;
      eachCell(fl.rect, function (x, z) {
        if (solid(x, fl.y, z)) return;
        for (var h = 0; h < holes.length; h++) {
          var hr = holes[h];
          if (x >= hr[0] && x <= hr[2] && z >= hr[1] && z <= hr[3]) return;
        }
        flGaps++;
      });
      if (flGaps) out.push('floor gaps at y=' + fl.y + ': ' + flGaps);
    }
  }

  if (m.walls) {
    for (var w = 0; w < m.walls.length; w++) {
      var band = m.walls[w], open = {}, miss = [];
      for (var o = 0; o < (band.open || []).length; o++) open[band.open[o].join(',')] = 1;
      for (var by = band.y0; by <= band.y1; by++) {
        eachCell(band.rect, function (x, z) {
          var r = band.rect;
          if (x !== r[0] && x !== r[2] && z !== r[1] && z !== r[3]) return;
          if (solid(x, by, z)) return;
          if (open[x + ',' + by + ',' + z]) return;
          miss.push(x + ',' + by + ',' + z);
        });
      }
      /* Ярусы стены объявляются по одному, поэтому повторы по y проверяем
         отдельно: у каждого яруса свой диапазон. */
      if (miss.length) out.push('wall gaps y' + band.y0 + '-y' + band.y1 + ': ' + miss.length + ' [' + miss.slice(0, 3).join(' ') + ']');
    }
  }

  if (m.door) {
    for (var dy = m.door.y0; dy < m.door.y0 + m.door.h; dy++) {
      if (solid(m.door.x, dy, m.door.z)) out.push('door cell blocked at y=' + dy);
    }
    if (!solid(m.door.x, m.door.y0 + m.door.h, m.door.z)) out.push('door lintel missing');
  }

  if (m.gate) {
    var gateOpen = m.gate;
    for (var gx = gateOpen.x0; gx <= gateOpen.x1; gx++) {
      for (var gy = gateOpen.y0; gy < gateOpen.y0 + 2; gy++) {
        if (solid(gx, gy, gateOpen.z)) out.push('gate cell blocked at ' + gx + ',' + gy);
      }
      if (!solid(gx, gateOpen.y0 + 2, gateOpen.z)) out.push('gate lintel missing');
    }
  }

  if (m.glass) {
    for (var g = 0; g < m.glass.length; g++) {
      var gc = m.glass[g];
      if (idAt(gc[0], gc[1], gc[2]) !== GL) out.push('window is not glass at ' + gc.join(','));
      /* Фрамуга над дверью ставится без подоконника — это помечено в мете. */
      if (gc[3] !== 1 && !solid(gc[0], gc[1] - 1, gc[2])) {
        out.push('window sill missing at ' + gc.join(','));
      }
    }
  }

  if (m.roof) {
    var roofOpen = {}, gaps = 0;
    for (var ro = 0; ro < (m.roof.open || []).length; ro++) roofOpen[m.roof.open[ro].join(',')] = 1;
    eachCell(m.roof.rect, function (x, z) {
      if (roofOpen[x + ',' + z]) return;      // труба или зенитное окно
      var id = idAt(x, m.roof.y, z);
      if (id !== RF && id !== SL) gaps++;
    });
    if (gaps) out.push('roof layer gaps: ' + gaps);
    var openTop = 0;
    eachCell(m.roof.rect, function (x, z) {
      if (roofOpen[x + ',' + z]) return;
      var top = 0;
      for (var y = m.roof.y; y <= m.roof.y + 24; y++) if (solid(x, y, z)) top = idAt(x, y, z);
      if (top !== RF && top !== SL && top !== SB) openTop++;
    });
    if (openTop) out.push('roof not closed: ' + openTop);
  }

  if (m.wall) {
    var band2 = m.wall, open2 = {}, miss2 = 0;
    for (var o2 = 0; o2 < (band2.open || []).length; o2++) open2[band2.open[o2].join(',')] = 1;
    for (var by2 = band2.y0; by2 <= band2.y1; by2++) {
      eachCell(band2.rect, function (x, z) {
        if (solid(x, by2, z)) return;
        if (open2[x + ',' + by2 + ',' + z]) return;
        miss2++;
      });
    }
    if (miss2) out.push('wall body gaps: ' + miss2);
  }

  return out;
}

/* Поворот чертежа на 90° × dir вокруг опорной клетки. */
function mcbRotate(block, dir) {
  var d = ((dir % 4) + 4) % 4;
  var x = block.x, z = block.z;
  if (d === 1) { var t = x; x = -z; z = t; }
  else if (d === 2) { x = -x; z = -z; }
  else if (d === 3) { var t2 = x; x = z; z = -t2; }
  return { x: x, y: block.y, z: z, id: block.id };
}

/* Блоки шаблона в мировых координатах: поворот + опорная клетка прицела. */
function mcbPlanBlocks(key, dir) {
  var raw = mcbBuildPlan(key);
  var d = ((dir || 0) % 4 + 4) % 4;
  var map = {}, out = [];
  for (var i = 0; i < raw.length; i++) {
    var r = mcbRotate(raw[i], d);
    var k = r.x + ',' + r.y + ',' + r.z;
    if (map[k]) continue;
    map[k] = 1;
    out.push(r);
  }
  return out;
}

function mcbPlanBase() {
  var aim = mcbState.aim || mcbAim();
  if (!aim) return null;
  return {
    x: aim.px != null ? aim.px : aim.x + aim.nx,
    y: aim.py != null ? aim.py : aim.y + aim.ny,
    z: aim.pz != null ? aim.pz : aim.z + aim.nz
  };
}

function mcbMissingText(missing) {
  var parts = [];
  for (var i = 0; i < missing.length; i++) {
    parts.push(mcbName(missing[i].id) + ' — ' + missing[i].deficit + ' ' + mcbT('шт.', 'pcs'));
  }
  return parts.join(', ');
}

/* Проверка шаблона до постройки: границы мира, занятые клетки (чужие постройки
   и рельеф), габарит игрока и запас материалов. Ставим только если всё ок. */
function mcbPlanCheck(key, dir) {
  var d = ((dir || 0) % 4 + 4) % 4;
  var rel = mcbPlanBlocks(key, d);
  var result = {
    key: key, dir: d, ok: false, reason: '', message: '', blocks: [],
    base: null, count: rel.length, need: {}, missing: [], blocked: 0
  };
  if (!rel.length) {
    result.reason = 'empty';
    result.message = mcbT('Шаблон пуст.', 'The template is empty.');
    return result;
  }
  var base = mcbPlanBase();
  if (!base) {
    result.reason = 'notarget';
    result.message = mcbReasonText('notarget');
    return result;
  }
  result.base = base;
  /* Фундамент ставится на поверхность: под опорной клеткой должен быть блок.
     Иначе дом повис бы в воздухе, и «фундамент» был бы только на словах. */
  var under = base.y > 0 ? cs(base.x, base.y - 1, base.z) : Ai;
  if (under === Ai || under === qh) {
    result.reason = 'ground';
    result.message = mcbT('Стройте с земли: наведитесь на поверхность, а не на стену.',
      'Build from the ground: aim at a surface, not at a wall.');
    return result;
  }
  var blocks = [], out = 0, busy = 0, player = 0, need = {};
  for (var i = 0; i < rel.length; i++) {
    var r = rel[i];
    var b = { x: base.x + r.x, y: base.y + r.y, z: base.z + r.z, id: r.id };
    blocks.push(b);
    if (!mcbMaterial(b.id)) continue;
    need[b.id] = (need[b.id] || 0) + 1;
    var reason = mcbPlaceReason(b.x, b.y, b.z);
    if (reason === 'bounds') out++;
    else if (reason === 'busy') busy++;
    else if (reason === 'player') player++;
  }
  result.blocks = blocks;
  result.need = need;
  result.blocked = busy;
  var missing = [];
  for (var id in need) {
    if (!Object.prototype.hasOwnProperty.call(need, id)) continue;
    var deficit = need[id] - mcbStock(Number(id));
    if (deficit > 0) {
      missing.push({ id: Number(id), need: need[id], have: mcbStock(Number(id)), deficit: deficit });
    }
  }
  result.missing = missing;
  if (out) {
    result.reason = 'bounds';
    result.message = mcbT('Постройка выходит за границу мира: ' + out + ' блок(ов).',
      'The build goes past the world border: ' + out + ' block(s).');
    return result;
  }
  if (player) {
    result.reason = 'player';
    result.message = mcbT('Вы мешаете постройке (' + player + ' блок(ов) в вашем габарите) — отойдите.',
      'You are in the way (' + player + ' block(s) inside you) — step aside.');
    return result;
  }
  if (busy) {
    result.reason = 'busy';
    result.message = mcbT('Здесь уже стоят блоки (' + busy + '): существующие постройки не сносятся.',
      'Blocks are in the way (' + busy + '): existing builds are never removed.');
    return result;
  }
  var locked = [];
  for (var lid in need) {
    if (!Object.prototype.hasOwnProperty.call(need, lid)) continue;
    if (!mcbBlockAllowed(Number(lid))) locked.push(Number(lid));
  }
  if (locked.length) {
    result.reason = 'locked';
    result.message = mcbT('В шаблоне есть отключённые блоки: ',
      'The template uses disabled blocks: ') +
      locked.map(function (id) { return mcbName(id); }).join(', ');
    return result;
  }
  if (missing.length) {
    result.reason = 'stock';
    result.message = mcbT('Не хватает материала: ', 'Not enough material: ') + mcbMissingText(missing);
    return result;
  }
  /* Последняя проверка — целостность самой постройки (фундамент, стены, крыша,
     окна, двери). Шаблоны, которые её не проходят, ставить нельзя: недоделанных
     построек в игре быть не должно. */
  var issues = mcbPlanValidate(key);
  if (issues.length) {
    result.reason = 'broken';
    result.message = mcbT('Шаблон недоделан: ', 'The template is incomplete: ') + issues.join('; ');
    return result;
  }
  result.ok = true;
  return result;
}

/* Полоска подтверждения: видно, что именно построится и почему нельзя. */
function mcbPlanBar(check) {
  var bar = $e('mcb-planbar');
  if (!bar) return;
  if (!check) {
    bar.hidden = true;
    bar.classList.remove('bad');
    return;
  }
  var tpl = mcbTemplate(check.key);
  var name = tpl ? mcbT(tpl.ru, tpl.en) : check.key;
  bar.hidden = false;
  bar.classList.toggle('bad', !check.ok);
  var title = bar.querySelector('[data-mcb-plan-name]');
  var info = bar.querySelector('[data-mcb-plan-info]');
  var go = bar.querySelector('[data-mcb-plan-go]');
  if (title) title.textContent = name + ' · ' + check.blocks.length + ' ' + mcbT('блок(ов)', 'block(s)');
  if (info) {
    info.textContent = check.ok
      ? mcbT('Можно строить: ' + (check.dir * 90) + '°', 'Ready to build: ' + (check.dir * 90) + '°')
      : check.message;
  }
  if (go) {
    go.disabled = !check.ok;
    go.textContent = check.ok ? mcbT('Построить', 'Build') : mcbT('Нельзя', 'Blocked');
  }
}

/* Выбрать шаблон: место и материалы проверяются сразу, постановка — по подтверждению. */
function mcxBuildPlanStart(key, dir) {
  if (!mcbTemplate(key)) return false;
  mcbState.planKey = key;
  mcbState.planDir = dir == null ? (mcbStampDir || 0) : dir;
  mcbState.planBarKey = '';
  var check = mcbPlanCheck(key, mcbState.planDir);
  mcbPlanBar(check);
  if (!check.ok) mcbToast(check.message, 2800);
  return true;
}

function mcxBuildPlanRotate() {
  if (!mcbState.planKey) {
    mcbStampDir = ((mcbStampDir || 0) + 1) % 4;
    mcbToast(mcbT('Поворот чертежа: ' + (mcbStampDir * 90) + '°',
      'Blueprint rotation: ' + (mcbStampDir * 90) + '°'), 1400);
    return mcbStampDir;
  }
  mcbState.planDir = ((mcbState.planDir || 0) + 1) % 4;
  mcbStampDir = mcbState.planDir;
  mcbState.planBarKey = '';
  mcbPlanBarRefresh();
  return mcbState.planDir;
}

function mcxBuildPlanCancel() {
  mcbState.planKey = null;
  mcbState.planDir = 0;
  mcbState.planBarKey = '';
  mcbPlanBar(null);
}

/* Подтверждение: ставим ВСЁ или НИЧЕГО. Предварительная проверка гарантирует,
   что ни один существующий блок не будет перезаписан. */
function mcxBuildConfirm() {
  var key = mcbState.planKey;
  if (!key) return 0;
  var check = mcbPlanCheck(key, mcbState.planDir);
  if (!check.ok) {
    mcbToast(check.message, 3000);
    mcbPlanBar(check);
    return 0;
  }
  var placed = 0;
  for (var i = 0; i < check.blocks.length; i++) {
    var b = check.blocks[i];
    if (!mcbMaterial(b.id)) continue;
    ui(b.x, b.y, b.z, b.id);
    mcbState.stock[b.id] = mcbStock(b.id) - 1;
    mcbState.edits[mcbKey(b.x, b.y, b.z)] = b.id;
    mcbPushUndo(b.x, b.y, b.z, Ai, b.id);
    placed++;
  }
  mcxBuildPlanCancel();
  if (F) F.dirty = !0;
  mcbSave();
  mcbHotbar();
  mcbToast(mcbT('Построено: ' + placed + ' блок(ов)', 'Built: ' + placed + ' block(s)'), 2400);
  return placed;
}

/* Совместимость: поставить шаблон сразу (без полоски подтверждения), но с той
   же проверкой — постройка либо встаёт целиком, либо не встаёт вовсе. */
function mcxBuildStamp(key, dir) {
  if (!mcbTemplate(key)) return 0;
  var previousKey = mcbState.planKey, previousDir = mcbState.planDir;
  mcbState.planKey = key;
  mcbState.planDir = ((dir || 0) % 4 + 4) % 4;
  var placed = mcxBuildConfirm();
  if (!placed) {
    mcbState.planKey = previousKey;
    mcbState.planDir = previousDir;
  }
  return placed;
}

/* ------------------------------------------------------------- интерфейс */
function mcbToast(text, ms) {
  mcxToast(text, ms || 2000);
}

function mcbIcon(id) {
  try {
    return Ug(id);
  } catch (e) {
    return '';
  }
}

function mcbAvailableMats() {
  var out = [];
  for (var i = 0; i < MCB_MATS.length; i++) {
    if (mcbBlockAllowed(MCB_MATS[i].id)) out.push(MCB_MATS[i]);
  }
  return out;
}

function mcbPageIds() {
  var mats = mcbAvailableMats();
  var start = mcbState.page * MCB_PER_PAGE;
  var page = mats.slice(start, start + MCB_PER_PAGE);
  if (!page.length && mats.length) {
    mcbState.page = 0;
    page = mats.slice(0, MCB_PER_PAGE);
  }
  return page;
}

function mcbHotbar() {
  var bar = $e('hotbar');
  if (!bar) return;
  bar.setAttribute('data-mcb', '1');
  bar.classList.add('mcb-hotbar');
  var ids = mcbPageIds();
  var html = '';
  for (var i = 0; i < ids.length; i++) {
    var mat = ids[i];
    html += '<button type="button" class="slot mcb-slot' + (mat.id === mcbState.selected ? ' active' : '') +
      '" data-mcb-id="' + mat.id + '" aria-pressed="' + (mat.id === mcbState.selected) + '" title="' +
      mcbName(mat.id) + '">' +
      '<span class="block" style="background-image:url(&quot;' + mcbIcon(mat.id) + '&quot;)"></span>' +
      '<span class="mcb-name">' + mcbName(mat.id) + '</span>' +
      '<small class="mcb-count">' + mcbStock(mat.id) + '</small>' +
      '</button>';
  }
  html += '<button type="button" class="mcb-tools" id="mcbBag" aria-label="' + mcbT('Инвентарь', 'Inventory') + '" title="' +
    mcbT('Инвентарь (I)', 'Inventory (I)') + '"><svg viewBox="0 0 24 24"><path d="M4 8h16v11H4zM4 8l2-4h12l2 4M9 12h6"/></svg></button>';
  bar.innerHTML = html;
  var pageCount = Math.ceil(mcbAvailableMats().length / MCB_PER_PAGE);
  var dots = document.createElement('div');
  dots.className = 'mcb-pages';
  for (var p = 0; p < pageCount; p++) {
    var dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'mcb-dot' + (p === mcbState.page ? ' on' : '');
    dot.setAttribute('data-mcb-page', String(p));
    dot.setAttribute('aria-label', mcbT('Страница', 'Page') + ' ' + (p + 1));
    dots.appendChild(dot);
  }
  bar.appendChild(dots);
}

function mcbPaintModal() {
  var modal = $e('mcb-inv');
  if (!modal) return;
  var tabs = modal.querySelectorAll('[data-mcb-tab]');
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].classList.toggle('on', tabs[i].getAttribute('data-mcb-tab') === mcbState.tab);
  }
  var blocks = modal.querySelector('#mcb-blocks');
  var plans = modal.querySelector('#mcb-plans');
  var settings = modal.querySelector('#mcb-settings');
  if (blocks) blocks.hidden = mcbState.tab !== 'blocks';
  if (plans) plans.hidden = mcbState.tab !== 'plans';
  if (settings) settings.hidden = mcbState.tab !== 'settings';
  if (mcbState.tab === 'blocks' && blocks) {
    var html = '';
    for (var c = 0; c < MCB_CATS.length; c++) {
      var cat = MCB_CATS[c];
      html += '<div class="mcb-cat"><h5>' + mcbT(cat.ru, cat.en) + '</h5><div class="mcb-grid">';
      for (var m = 0; m < MCB_MATS.length; m++) {
        var mat = MCB_MATS[m];
        if (mat.cat !== cat.id) continue;
        if (!mcbBlockAllowed(mat.id)) continue;
        html += '<button type="button" class="mcb-card' + (mat.id === mcbState.selected ? ' on' : '') +
          '" data-mcb-id="' + mat.id + '">' +
          '<span class="mcb-thumb" style="background-image:url(&quot;' + mcbIcon(mat.id) + '&quot;)"></span>' +
          '<b>' + mcbName(mat.id) + '</b><small>' + mcbStock(mat.id) + ' ' + mcbT('шт.', 'pcs') + '</small></button>';
      }
      html += '</div></div>';
    }
    blocks.innerHTML = html;
  }
  if (mcbState.tab === 'plans' && plans) {
    var out = '<p class="mcb-hint">' + mcbT(
      'Выберите шаблон: игра проверит место и материалы, а постройка встанет целиком после подтверждения. R — повернуть, «Построить» — поставить.',
      'Pick a template: the game checks the spot and the materials, and the whole building is placed after you confirm. R rotates, Build places it.') + '</p>';
    for (var c = 0; c < MCB_PLAN_CATS.length; c++) {
      var cat = MCB_PLAN_CATS[c];
      var items = MCB_PLAN_NAMES.filter(function (plan) { return plan.cat === cat.id; });
      if (!items.length) continue;
      out += '<div class="mcb-cat"><h5>' + mcbT(cat.ru, cat.en) + '</h5><div class="mcb-grid plans">';
      for (var p = 0; p < items.length; p++) {
        var plan = items[p];
        var tpl = mcbTemplate(plan.key);
        var count = tpl ? mcbBuildPlan(plan.key).length : 0;
        out += '<button type="button" class="mcb-card' +
          (mcbState.planKey === plan.key ? ' on' : '') +
          '" data-mcb-plan="' + plan.key + '"><b>' +
          mcbT(plan.ru, plan.en) + '</b><small>' + count + ' ' + mcbT('блок(ов)', 'block(s)') +
          '</small></button>';
      }
      out += '</div></div>';
    }
    out += '<button type="button" class="mcb-wide" data-mcb-undo>' + mcbT('Отменить последнее', 'Undo last') + '</button>';
    plans.innerHTML = out;
  }
  if (mcbState.tab === 'settings' && settings) {
    settings.innerHTML =
      '<label class="mcb-field"><span>' + mcbT('Чувствительность обзора', 'Look sensitivity') + '</span>' +
      '<input type="range" min="40" max="200" step="5" value="' + Math.round(mcbState.sensitivity * 100) + '" data-mcb-sens>' +
      '<b data-mcb-sens-val>' + Math.round(mcbState.sensitivity * 100) + '%</b></label>' +
      '<div class="mcb-row"><button type="button" class="mcb-wide" data-mcb-layout>' +
      mcbT('Раскладка кнопок', 'Button layout') + '</button>' +
      '<button type="button" class="mcb-wide" data-mcb-reset>' + mcbT('Сбросить раскладку', 'Reset layout') + '</button></div>' +
      '<p class="mcb-hint">' + mcbT('Сохранено блоков: ', 'Saved blocks: ') + mcbState.editCount + '</p>' +
      '<button type="button" class="mcb-wide danger" data-mcb-clear>' +
      mcbT('Удалить постройку и вернуть мир', 'Clear the build and restore the world') + '</button>';
  }
}

function mcbOpen(tab) {
  mcbState.open = true;
  mcbState.tab = tab || 'blocks';
  var modal = $e('mcb-inv');
  if (!modal) return;
  modal.hidden = false;
  modal.classList.add('open');
  mcbPaintModal();
  mcbApplyLayout();
}

function mcbClose() {
  mcbState.open = false;
  var modal = $e('mcb-inv');
  if (modal) {
    modal.hidden = true;
    modal.classList.remove('open');
  }
  if (mcbState.layoutMode) mcbEndLayout();
}

/* Раскладка кнопок живёт вне окна: иначе пальцу мешает затемнение и сам лист. */
function mcbBeginLayout() {
  mcbState.layoutMode = true;
  mcbState.open = false;
  document.body.classList.add('mcb-layout-mode');
  var modal = $e('mcb-inv');
  if (modal) {
    modal.hidden = true;
    modal.classList.remove('open');
  }
  var done = $e('mcb-layout-done');
  if (done) done.hidden = false;
  mcbToast(mcbT('Перетащите джойстик и кнопки, затем нажмите «Готово».',
    'Drag the joystick and the buttons, then tap Done.'), 3000);
}

function mcbEndLayout() {
  mcbState.layoutMode = false;
  document.body.classList.remove('mcb-layout-mode');
  var done = $e('mcb-layout-done');
  if (done) done.hidden = true;
  mcbSaveNow();
}

function mcbToggle(tab) {
  if (mcbState.open) mcbClose();
  else mcbOpen(tab);
}

function mcbApplyLayout() {
  var layout = mcbState.layout;
  var stick = $e('joystick'), actions = document.querySelector('#touch-controls .actions');
  if (!stick) return;
  stick.style.removeProperty('left');
  stick.style.removeProperty('bottom');
  if (actions) {
    actions.style.removeProperty('left');
    actions.style.removeProperty('right');
    actions.style.removeProperty('bottom');
  }
  if (!layout) return;
  if (layout.stick) {
    stick.style.left = layout.stick.x + '%';
    stick.style.bottom = layout.stick.y + '%';
  }
  if (layout.actions && actions) {
    actions.style.right = layout.actions.x + '%';
    actions.style.bottom = layout.actions.y + '%';
  }
}

/* Перетаскивание джойстика и блока кнопок: позиции в процентах экрана. */
function mcbLayoutDrag(node, onMove) {
  var id = null;
  function down(event) {
    if (!mcbState.layoutMode) return;
    id = event.pointerId;
    event.preventDefault();
    event.stopPropagation();
    node.classList.add('dragging');
    try { node.setPointerCapture(id); } catch (e) {}
  }
  function move(event) {
    if (!mcbState.layoutMode || event.pointerId !== id) return;
    event.preventDefault();
    event.stopPropagation();
    onMove(event);
  }
  function up(event) {
    if (event.pointerId !== id) return;
    id = null;
    node.classList.remove('dragging');
    mcbSave();
  }
  node.addEventListener('pointerdown', down, { passive: false, capture: true });
  node.addEventListener('pointermove', move, { passive: false, capture: true });
  node.addEventListener('pointerup', up, { capture: true });
  node.addEventListener('pointercancel', up, { capture: true });
}

function mcbSetupLayout() {
  var stick = $e('joystick');
  var actions = document.querySelector('#touch-controls .actions');
  if (stick) {
    mcbLayoutDrag(stick, function (event) {
      var x = Math.max(2, Math.min(70, event.clientX / innerWidth * 100 - 8));
      var y = Math.max(2, Math.min(70, (innerHeight - event.clientY) / innerHeight * 100 - 8));
      mcbState.layout = mcbState.layout || {};
      mcbState.layout.stick = { x: Math.round(x), y: Math.round(y) };
      mcbApplyLayout();
    });
  }
  if (actions) {
    mcbLayoutDrag(actions, function (event) {
      var x = Math.max(2, Math.min(70, (innerWidth - event.clientX) / innerWidth * 100 - 8));
      var y = Math.max(2, Math.min(70, (innerHeight - event.clientY) / innerHeight * 100 - 8));
      mcbState.layout = mcbState.layout || {};
      mcbState.layout.actions = { x: Math.round(x), y: Math.round(y) };
      mcbApplyLayout();
    });
  }
}

/* Построение разметки инвентаря (один раз). */
function mcbBuildUi() {
  if ($e('mcb-inv')) return;
  var modal = document.createElement('div');
  modal.id = 'mcb-inv';
  modal.className = 'mcb-modal';
  modal.hidden = true;
  modal.innerHTML =
    '<div class="mcb-sheet panel" role="dialog" aria-modal="true" aria-label="' +
    mcbT('Инвентарь и постройка', 'Inventory and building') + '">' +
    '<div class="mcb-head"><b>' + mcbT('Постройка', 'Building') + '</b>' +
    '<div class="mcb-tabs">' +
    '<button type="button" data-mcb-tab="blocks" class="on">' + mcbT('Блоки', 'Blocks') + '</button>' +
    '<button type="button" data-mcb-tab="plans">' + mcbT('Чертежи', 'Blueprints') + '</button>' +
    '<button type="button" data-mcb-tab="settings">' + mcbT('Настройки', 'Settings') + '</button>' +
    '</div><button type="button" class="mcb-x" id="mcbClose" aria-label="' + mcbT(((window.VGT&&window.VGT('Закрыть','Close'))||'Закрыть'), 'Close') + '">✕</button></div>' +
    '<div class="mcb-body mcx-scroll" id="mcb-blocks"></div>' +
    '<div class="mcb-body mcx-scroll" id="mcb-plans" hidden></div>' +
    '<div class="mcb-body mcx-scroll" id="mcb-settings" hidden></div>' +
    '<div class="mcb-foot"><button type="button" class="mcb-wide" data-mcb-undo>' +
    mcbT('Отменить последнее', 'Undo last') + '</button></div>' +
    '</div>';
  document.body.appendChild(modal);
  /* Полоска подтверждения: имя шаблона, число блоков, почему нельзя/можно. */
  var bar = document.createElement('div');
  bar.id = 'mcb-planbar';
  bar.className = 'mcb-planbar';
  bar.hidden = true;
  bar.innerHTML =
    '<div class="mcb-planbar-text"><b data-mcb-plan-name></b><small data-mcb-plan-info></small></div>' +
    '<div class="mcb-planbar-actions">' +
    '<button type="button" data-mcb-plan-rot aria-label="' + mcbT('Повернуть', 'Rotate') + '">R</button>' +
    '<button type="button" data-mcb-plan-cancel>' + mcbT('Отмена', 'Cancel') + '</button>' +
    '<button type="button" class="go" data-mcb-plan-go>' + mcbT('Построить', 'Build') + '</button>' +
    '</div>';
  document.body.appendChild(bar);
  var done = document.createElement('button');
  done.type = 'button';
  done.id = 'mcb-layout-done';
  done.className = 'mcb-done';
  done.hidden = true;
  done.textContent = mcbT('Готово', 'Done');
  document.body.appendChild(done);
  mcbHotbar();
  mcbPaintModal();
}

/* Обработчики интерфейса — один делегированный слушатель. */
function mcbBindUi() {
  document.addEventListener('click', function (event) {
    var target = event.target;
    if (!target || !target.closest) return;
    var slot = target.closest('[data-mcb-id]');
    if (slot) {
      event.preventDefault();
      mcxBuildSelect(Number(slot.getAttribute('data-mcb-id')));
      return;
    }
    var page = target.closest('[data-mcb-page]');
    if (page) {
      event.preventDefault();
      mcbState.page = Number(page.getAttribute('data-mcb-page')) || 0;
      mcbHotbar();
      return;
    }
    var tab = target.closest('[data-mcb-tab]');
    if (tab) {
      event.preventDefault();
      mcbState.tab = tab.getAttribute('data-mcb-tab');
      mcbPaintModal();
      return;
    }
    var plan = target.closest('[data-mcb-plan]');
    if (plan) {
      event.preventDefault();
      mcxBuildPlanStart(plan.getAttribute('data-mcb-plan'), mcbStampDir || 0);
      mcbClose();
      mcbPaintModal();
      return;
    }
    if (target.closest('[data-mcb-plan-go]')) {
      event.preventDefault();
      mcxBuildConfirm();
      mcbPaintModal();
      return;
    }
    if (target.closest('[data-mcb-plan-rot]')) {
      event.preventDefault();
      mcxBuildPlanRotate();
      return;
    }
    if (target.closest('[data-mcb-plan-cancel]')) {
      event.preventDefault();
      mcxBuildPlanCancel();
      mcbPaintModal();
      return;
    }
    if (target.closest('[data-mcb-undo]')) {
      event.preventDefault();
      mcxBuildUndo();
      return;
    }
    if (target.closest('#mcbBag')) {
      event.preventDefault();
      mcbToggle('blocks');
      return;
    }
    if (target.closest('#mcbClose') || target === $e('mcb-inv')) {
      event.preventDefault();
      mcbClose();
      return;
    }
    if (target.closest('[data-mcb-layout]')) {
      event.preventDefault();
      mcbBeginLayout();
      return;
    }
    if (target.closest('#mcb-layout-done')) {
      event.preventDefault();
      mcbEndLayout();
      return;
    }
    if (target.closest('[data-mcb-reset]')) {
      event.preventDefault();
      mcbState.layout = null;
      mcbApplyLayout();
      mcbSave();
      mcbToast(mcbT('Раскладка сброшена.', 'Layout reset.'), 1600);
      return;
    }
    if (target.closest('[data-mcb-clear]')) {
      event.preventDefault();
      mcbClearWorld();
      return;
    }
  });
  document.addEventListener('input', function (event) {
    var sens = event.target;
    if (!sens || !sens.hasAttribute || !sens.hasAttribute('data-mcb-sens')) return;
    var value = Math.min(2, Math.max(.4, Number(sens.value) / 100));
    mcbState.sensitivity = value;
    var label = document.querySelector('[data-mcb-sens-val]');
    if (label) label.textContent = Math.round(value * 100) + '%';
    mcbSave();
  });
}

function mcbClearWorld() {
  var count = 0;
  for (var key in mcbState.edits) {
    if (!Object.prototype.hasOwnProperty.call(mcbState.edits, key)) continue;
    var parts = key.split(',');
    var x = +parts[0], y = +parts[1], z = +parts[2];
    var original = mcbOriginalAt(x, y, z);
    if (original != null) ui(x, y, z, original);
    count++;
  }
  mcbState.edits = {};
  mcbState.editCount = 0;
  mcbState.undo = [];
  mcbState.appliedWorld = null;
  if (F) F.dirty = !0;
  mcbSaveNow();
  mcbHotbar();
  mcbToast(mcbT('Постройка удалена: ' + count + ' блок(ов) вернулись к миру.', count + ' blocks restored.'), 2600);
  mcbClose();
}

/* «Исходный» блок в точке: мир без правок игрока неизвестен, поэтому просто
   возвращаем воздух — постройка снимается, ландшафт остаётся как был. */
function mcbOriginalAt(x, y, z) {
  return Ai;
}

/* -------------------------------------------------- защита от жестов браузера */
var MCB_SCROLLABLE = '.mcx-scroll, #overlay, .dialog, #instructions, #mcb-inv .mcb-body';
function mcbInsideScrollable(node) {
  try {
    return !!(node && node.closest && node.closest(MCB_SCROLLABLE));
  } catch (e) {
    return false;
  }
}

function mcbTouchGuard() {
  /* Pull-to-refresh, прокрутка страницы и «резинка» на iOS: гасим движение вне
     прокручиваемых окон. Слушатель не пассивный — иначе preventDefault
     игнорируется браузером. */
  document.addEventListener('touchmove', function (event) {
    if (event.touches && event.touches.length > 1) {
      event.preventDefault();
      return;
    }
    if (mcbInsideScrollable(event.target)) return;
    if (event.cancelable) event.preventDefault();
  }, { passive: false });

  /* Масштаб двумя пальцами и системные жесты Safari. */
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (name) {
    document.addEventListener(name, function (event) {
      if (event.cancelable) event.preventDefault();
    }, { passive: false });
  });

  /* Pinch-zoom на тачпаде — только колесо с Ctrl. */
  document.addEventListener('wheel', function (event) {
    if (event.ctrlKey && event.cancelable) event.preventDefault();
  }, { passive: false });

  /* Долгое нажатие не должно открывать меню «Сохранить изображение» и т. п. */
  document.addEventListener('contextmenu', function (event) {
    if (event.cancelable) event.preventDefault();
  });
  document.addEventListener('dragstart', function (event) {
    if (event.cancelable) event.preventDefault();
  });

  /* Фокус: после изменения панели браузера, поворота или выхода из fullscreen
     игра возвращает себе клавиатуру, но не отбирает фокус у полей ввода. */
  function refocus() {
    if (Mt !== 'playing' || !Xe || !Xe.domElement) return;
    var active = document.activeElement;
    if (active && active !== document.body && active !== Xe.domElement &&
        /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return;
    try { Xe.domElement.focus({ preventScroll: true }); } catch (e) {}
  }
  addEventListener('resize', function () { setTimeout(refocus, 60); });
  addEventListener('orientationchange', function () { setTimeout(refocus, 220); });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) setTimeout(refocus, 120);
  });
  window.visualViewport && visualViewport.addEventListener('resize', function () { setTimeout(refocus, 80); });
  document.addEventListener('fullscreenchange', function () { setTimeout(refocus, 120); });
}

/* --------------------------------------------------------------- запуск */
function mcbInit() {
  mcbTouchGuard();
  mcbBindUi();
  mcbBuildUi();
  mcbSetupLayout();
  mcbApplyLayout();
  var style = document.createElement('style');
  style.id = 'mcb-style';
  style.textContent = MCB_CSS;
  document.head.appendChild(style);
  /* Первое сохранение — сразу после загрузки настроек, чтобы у игрока был файл
     состояния даже без единой постройки (тогда хранится только запас). */
  mcbLoad();
  mcbHotbar();
  mcbLoadBlockAccess();
}

/* Стили живут в модуле: правки не задевают огромную таблицу стилей страницы. */
var MCB_CSS = [
  '.mcb-hotbar{display:flex;align-items:center;gap:3px;flex-wrap:nowrap}',
  '.mcb-hotbar .mcb-slot{position:relative;flex:1 1 0;min-width:0;height:60px;display:flex;flex-direction:column;',
  'align-items:center;justify-content:center;gap:2px;border:1px solid #ffffff1f;border-radius:12px;background:#0e1a24cc;',
  'color:#dff3f0;padding:4px 2px;touch-action:none}',
  '.mcb-hotbar .mcb-slot.active{border-color:#a6efdb;background:#255a52e6;box-shadow:0 0 0 1px #a6efdb55 inset}',
  '.mcb-hotbar .mcb-slot .block{width:26px;height:26px;background-size:contain;background-repeat:no-repeat;',
  'background-position:center;image-rendering:pixelated}',
  '.mcb-hotbar .mcb-name{font-size:8px;line-height:1.1;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.mcb-hotbar .mcb-count{font-size:9px;font-weight:800;color:#c6ff3d;line-height:1}',
  '.mcb-hotbar .mcb-tools{flex:0 0 42px;height:60px;display:grid;place-items:center;border:1px solid #ffffff26;',
  'border-radius:12px;background:#15242fe6;color:#dff3f0;touch-action:none}',
  '.mcb-hotbar .mcb-tools svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.8}',
  '.mcb-hotbar .mcb-pages{position:absolute;left:50%;transform:translateX(-50%);bottom:-9px;display:flex;gap:4px}',
  '.mcb-hotbar .mcb-dot{width:14px;height:5px;border-radius:3px;border:0;padding:0;background:#ffffff38}',
  '.mcb-hotbar .mcb-dot.on{background:#a6efdb}',
  '#hotbar.mcb-hotbar{position:absolute;left:50%;right:auto;transform:translateX(-50%);',
  'bottom:calc(14px + env(safe-area-inset-bottom,0px));width:min(392px,calc(100% - 20px));z-index:4;',
  'padding:5px;gap:3px;border-radius:14px}',
  '.mcb-modal{position:fixed;inset:0;z-index:40;display:flex;align-items:flex-end;justify-content:center;',
  'background:rgba(4,8,12,.62);backdrop-filter:blur(4px);touch-action:none}',
  '.mcb-modal[hidden]{display:none}',
  '.mcb-sheet{width:min(560px,100%);max-height:min(78vh,78dvh);display:flex;flex-direction:column;',
  'border-radius:18px 18px 0 0;background:#0d151ccc;border:1px solid #ffffff1f;padding:12px 12px calc(12px + env(safe-area-inset-bottom,0px))}',
  '.mcb-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}',
  '.mcb-head b{font-size:14px;letter-spacing:.4px}',
  '.mcb-tabs{display:flex;gap:4px;margin-left:auto}',
  '.mcb-tabs button{border:1px solid #ffffff1f;background:#ffffff10;color:#cfe9e5;border-radius:9px;padding:5px 9px;font-size:11px}',
  '.mcb-tabs button.on{background:#2c6a60;border-color:#a6efdb;color:#fff}',
  '.mcb-x{border:0;background:#ffffff14;color:#dff3f0;width:32px;height:32px;border-radius:9px;font-size:14px}',
  '.mcb-body{overflow-y:auto;-webkit-overflow-scrolling:touch;touch-action:pan-y;padding:2px 2px 6px}',
  '.mcb-cat h5{margin:10px 0 6px;font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:#8fb9b3}',
  '.mcb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:7px}',
  '.mcb-card{display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 6px;border-radius:12px;',
  'border:1px solid #ffffff1a;background:#12202ae6;color:#e6f6f3;touch-action:manipulation}',
  '.mcb-card.on{border-color:#a6efdb;background:#1f4a44e6}',
  '.mcb-card b{font-size:11px;font-weight:700;text-align:center;line-height:1.2}',
  '.mcb-card small{font-size:9.5px;color:#9fc7c1}',
  '.mcb-thumb{width:40px;height:40px;background-size:contain;background-repeat:no-repeat;background-position:center;image-rendering:pixelated}',
  '.mcb-wide{flex:1;border:1px solid #ffffff26;background:#15242fe6;color:#dff3f0;border-radius:11px;padding:10px;font-size:12px;font-weight:700}',
  '.mcb-wide.danger{border-color:#ff6b6b66;color:#ffb9b9;background:#3a1414cc}',
  '.mcb-row{display:flex;gap:8px;margin-top:8px}',
  '.mcb-field{display:flex;align-items:center;gap:10px;margin:6px 0 8px;font-size:12px}',
  '.mcb-field input[type=range]{flex:1;accent-color:#a6efdb}',
  '.mcb-field b{min-width:44px;text-align:right;color:#c6ff3d}',
  '.mcb-hint{font-size:11px;line-height:1.5;color:#9fc7c1;margin:6px 0}',
  '.mcb-foot{display:flex;gap:8px;margin-top:8px}',
  '.mcb-done{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(14px + env(safe-area-inset-bottom,0px));',
  'z-index:45;padding:11px 26px;border-radius:14px;border:1px solid #a6efdb;background:#2c6a60e6;color:#fff;',
  'font-size:13px;font-weight:800;letter-spacing:.4px;touch-action:manipulation}',
  '.mcb-done[hidden]{display:none}',
  '.mcb-planbar{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(86px + env(safe-area-inset-bottom,0px));',
  'z-index:44;display:flex;align-items:center;gap:10px;width:min(520px,calc(100% - 16px));padding:8px 10px;',
  'border-radius:14px;border:1px solid #a6efdb66;background:#0d1a20f2;color:#e8fbf7;touch-action:manipulation}',
  '.mcb-planbar[hidden]{display:none}',
  '.mcb-planbar.bad{border-color:#ff6b6b88;background:#2a1010f2}',
  '.mcb-planbar-text{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}',
  '.mcb-planbar-text b{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
  '.mcb-planbar-text small{font-size:10.5px;color:#9fc7c1;line-height:1.3}',
  '.mcb-planbar.bad .mcb-planbar-text small{color:#ffbfbf}',
  '.mcb-planbar-actions{display:flex;gap:6px;flex:0 0 auto}',
  '.mcb-planbar-actions button{border:1px solid #ffffff26;background:#15242fe6;color:#dff3f0;border-radius:10px;',
  'padding:8px 10px;font-size:11.5px;font-weight:700;touch-action:manipulation}',
  '.mcb-planbar-actions .go{border-color:#a6efdb;background:#2c6a60e6;color:#fff}',
  '.mcb-planbar-actions .go[disabled]{opacity:.5;border-color:#ffffff26;background:#15242fe6}',
  '@media(max-width:420px){.mcb-planbar{flex-wrap:wrap;bottom:calc(92px + env(safe-area-inset-bottom,0px))}',
  '.mcb-planbar-actions{width:100%;justify-content:flex-end}}',
  '.mcb-layout-mode #joystick,.mcb-layout-mode .actions{outline:2px dashed #c6ff3d;outline-offset:3px}',
  '.mcb-layout-mode .actions button{pointer-events:none}',
  '#joystick.dragging,.actions.dragging{transform:scale(1.04);transition:none}',
  '@media(max-width:520px){.mcb-sheet{max-height:min(84vh,84dvh)}.mcb-hotbar .mcb-slot{height:56px}',
  '.mcb-hotbar .mcb-name{display:none}}',
  '@media(max-width:380px){.mcb-hotbar .mcb-slot{height:50px}.mcb-hotbar .mcb-tools{height:50px;flex-basis:36px}}',
  /* Ландшафт телефона: джойстик и кнопки жмутся к низам, хотбар — в полосу
     между ними, чтобы палец не попадал по чужому контролу. */
  '@media(orientation:landscape) and (max-height:560px){',
  '.mcb-sheet{max-height:94dvh;width:min(680px,96vw)}',
  '#hotbar.mcb-hotbar{left:50%;right:auto;transform:translateX(-50%);width:min(340px,calc(100% - 300px));',
  'min-width:200px;bottom:calc(12px + env(safe-area-inset-bottom,0px))}',
  '.mcb-hotbar .mcb-slot{height:48px}',
  '.mcb-hotbar .mcb-name{display:none}',
  '.mcb-hotbar .mcb-slot .block{width:22px;height:22px}',
  '.mcb-hotbar .mcb-tools{height:48px;flex-basis:38px}',
  '.mcb-hotbar .mcb-pages{bottom:-7px}',
  '}',
  '@media(orientation:landscape) and (max-height:420px){',
  '#hotbar.mcb-hotbar{bottom:calc(8px + env(safe-area-inset-bottom,0px));width:min(300px,calc(100% - 280px))}',
  '.mcb-hotbar .mcb-slot{height:42px}',
  '.mcb-hotbar .mcb-slot .block{width:19px;height:19px}',
  '.mcb-hotbar .mcb-tools{height:42px;flex-basis:34px}',
  '.mcb-hotbar .mcb-count{font-size:8px}',
  '}'
].join('\n');

/* ------------------------------------------------------- горячие клавиши */
/* Направление чертежа: 0/1/2/3 — поворот на 90°. */
var mcbStampDir = 0;

/* Выбор слота по цифре: сначала слоты текущей страницы, затем остальные. */
function mcbKeySlot(index) {
  var ids = mcbPageIds();
  if (index < ids.length) return mcxBuildSelect(ids[index].id);
  var pages = Math.ceil(mcbAvailableMats().length / MCB_PER_PAGE);
  if (index < pages * MCB_PER_PAGE) {
    mcbState.page = Math.floor(index / MCB_PER_PAGE);
    mcbHotbar();
    return true;
  }
  return false;
}

function mcbTyping(event) {
  var node = event.target;
  if (!node || !node.tagName) return false;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName) || node.isContentEditable === true;
}

/* Клавиши стройки. Слушатель в фазе перехвата — открытое окно инвентаря не
   должно двигать персонажа, а I/B/Z/R/G работают в любом состоянии игры. */
addEventListener('keydown', function (event) {
  if (mcbState.open) {
    if (event.code === 'Escape' || event.code === 'KeyI' || event.code === 'KeyB') {
      event.preventDefault();
      event.stopPropagation();
      mcbClose();
      return;
    }
    if (/^(Key[WASD]|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Space)$/.test(event.code)) {
      event.preventDefault();
      event.stopPropagation();
    }
    return;
  }
  if (mcbState.layoutMode && event.code === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    mcbEndLayout();
    return;
  }
  if (event.repeat || mcbTyping(event)) return;
  if (Mt !== 'playing') return;
  if (event.code === 'KeyI' || event.code === 'KeyB') {
    event.preventDefault();
    mcbOpen('blocks');
    return;
  }
  if (event.code === 'KeyZ') {
    event.preventDefault();
    mcxBuildUndo();
    return;
  }
  if (event.code === 'KeyG') {
    event.preventDefault();
    mcxBuildPick();
    return;
  }
  if (event.code === 'KeyR') {
    event.preventDefault();
    mcxBuildPlanRotate();
    return;
  }
  if (event.code === 'Enter' && mcbState.planKey) {
    event.preventDefault();
    mcxBuildConfirm();
    return;
  }
  if (event.code === 'Escape' && mcbState.planKey) {
    event.preventDefault();
    mcxBuildPlanCancel();
    mcbToast(mcbT('Постройка отменена.', 'Build cancelled.'), 1600);
    return;
  }
}, true);

/* Клики по открытому окну не должны попадать в игровое поле. */
document.addEventListener('pointerdown', function (event) {
  if (mcbState.open && event.cancelable) event.stopPropagation();
}, true);

/* Смена языка приходит из платформы: перерисовываем свои подписи. */
addEventListener('message', function (event) {
  var data = event.data;
  if (data && data.type === 'player:lang') {
    mcbHotbar();
    mcbPaintModal();
  }
});

/* Автозапуск: интерфейс и защита жестов ставятся сразу, а покадровая часть
   (прицел, восстановление постройки) вызывается из цикла отрисовки
   самой игры — второй requestAnimationFrame на телефоне не нужен. */
mcbInit();
