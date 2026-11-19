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
     • прозрачный призрак блока там, куда смотрит игрок, и сетка прицела;
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
  ghost: null,
  ghostFor: 0,
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
  if (!mcbCanPlace(x, y, z)) return false;
  if (mcbStock(id) <= 0) {
    mcbToast(mcbT('Запас исчерпан: разбейте блоки этого типа, чтобы пополнить.', 'Out of stock: break blocks of this type to refill.'), 2400);
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
var mcbAimTmp = null;
function mcbAim() {
  mcbState.aim = null;
  if (!F || !Wt || !Gn) return null;
  try {
    fo();
    Wt.getWorldDirection(Gn);
    mcbState.aim = zl(F.x, F.y + 1.62, F.z, Gn.x, Gn.y, Gn.z);
  } catch (e) {
    mcbState.aim = null;
  }
  return mcbState.aim;
}

function mcbGhostMat(id) {
  if (!is[id] || !is[id].material) return null;
  if (mcbState.ghostFor === id && mcbState.ghost && mcbState.ghost.material) return mcbState.ghost.material;
  var base = is[id].material;
  var mat = base.clone ? base.clone() : base;
  mat.transparent = true;
  mat.opacity = .42;
  mat.depthWrite = false;
  mat.wireframe = false;
  if (mat.color && mat.color.clone) mat.color = mat.color.clone();
  mcbState.ghostFor = id;
  return mat;
}

function mcbEnsureGhost() {
  if (mcbState.ghost || !Ht || typeof wt !== 'function') return mcbState.ghost;
  var mat = new ti({ color: 0x9be36a, transparent: true, opacity: .35, depthWrite: false });
  var mesh = new wt(new cn(1, 1, 1), mat);
  mesh.visible = false;
  mesh.renderOrder = 3;
  mesh.name = 'mcx-build-ghost';
  Ht.add(mesh);
  mcbState.ghost = mesh;
  return mesh;
}

/* Покадровое обновление призрака: только в игре и только при реальной цели. */
function mcbTick() {
  if (Mt !== 'playing' || !F) {
    if (mcbState.ghost) mcbState.ghost.visible = false;
    if (mcbState.open && !mcbState.layoutMode) mcbClose();
    return;
  }
  if (!mcbState.loaded) mcbLoad();
  mcbRestore();
  var ghost = mcbEnsureGhost();
  var hit = mcbAim();
  if (!ghost || !hit) {
    if (ghost) ghost.visible = false;
    return;
  }
  var x = hit.x + hit.nx, y = hit.y + hit.ny, z = hit.z + hit.nz;
  var ok = mcbCanPlace(x, y, z) && mcbStock(mcbState.selected) > 0;
  if (!ok) {
    ghost.visible = false;
    return;
  }
  var id = mcbState.selected;
  var mat = mcbGhostMat(id);
  if (mat && ghost.material !== mat) ghost.material = mat;
  ghost.position.set(x + .5, y + .5, z + .5);
  ghost.visible = true;
}

/* -------------------------------------------------------------- чертежи */
/* Каждый чертёж возвращает список блоков [{x,y,z,id}] относительно опорной
   точки. Материалы берём из палитры, поэтому постройка выглядит цельно. */
var MCB_PLANS = {
  house: function () {
    var out = [], W = 5, D = 4, H = 3, x, y, z;
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        for (z = 0; z < D; z++) {
          var edge = x === 0 || x === W - 1 || z === 0 || z === D - 1;
          if (!edge) continue;
          var id = PL;
          var door = z === D - 1 && x === Math.floor(W / 2) && y < 2;
          var window = y === 1 && ((x === 1 || x === W - 2) && z !== D - 1) || (y === 1 && z === 1 && (x === 1 || x === W - 2));
          if (door) continue;
          if (window && y === 1) id = GL;
          out.push({ x: x, y: y, z: z, id: id });
        }
      }
    }
    /* Пол и двускатная крыша. */
    for (x = 0; x < W; x++) for (z = 0; z < D; z++) out.push({ x: x, y: -1, z: z, id: PL });
    for (var step = 0; step < 3; step++) {
      var from = step, to = W - 1 - step;
      if (from > to) break;
      for (x = from; x <= to; x++) {
        for (z = -1; z <= D; z++) {
          out.push({ x: x, y: H + step, z: z, id: RF });
        }
      }
    }
    return out;
  },
  tower: function () {
    var out = [], S = 4, H = 9, x, y, z;
    for (y = 0; y < H; y++) {
      for (x = 0; x < S; x++) {
        for (z = 0; z < S; z++) {
          var edge = x === 0 || x === S - 1 || z === 0 || z === S - 1;
          if (!edge) continue;
          var id = y < 2 ? CB : SB;
          if (y === 4 && (x === 1 || x === 2) && z === 0) id = GL;
          if (y === 6 && (x === 1 || x === 2) && z === S - 1) id = GL;
          if (y < 2 && z === 0 && (x === 1 || x === 2)) continue;
          out.push({ x: x, y: y, z: z, id: id });
        }
      }
    }
    /* Зубцы наверху. */
    for (x = 0; x < S; x++) {
      for (z = 0; z < S; z++) {
        if ((x + z) % 2 === 0) out.push({ x: x, y: H, z: z, id: SB });
      }
    }
    return out;
  },
  bridge: function () {
    var out = [], len = 9, x, z;
    for (z = 0; z < len; z++) {
      for (x = -1; x <= 1; x++) out.push({ x: x, y: 0, z: z, id: PL });
      if (z % 3 === 0) {
        out.push({ x: -2, y: 0, z: z, id: Xh });
        out.push({ x: 2, y: 0, z: z, id: Xh });
      }
      out.push({ x: -2, y: 1, z: z, id: DW });
      out.push({ x: 2, y: 1, z: z, id: DW });
    }
    return out;
  },
  wall: function () {
    var out = [], len = 10, y;
    for (var z = 0; z < len; z++) {
      for (y = 0; y < 3; y++) {
        out.push({ x: 0, y: y, z: z, id: y === 2 ? SB : CB });
      }
    }
    return out;
  },
  stairs: function () {
    var out = [], steps = 5;
    for (var i = 0; i < steps; i++) {
      for (var w = 0; w < 3; w++) out.push({ x: w - 1, y: i, z: i, id: PL });
    }
    return out;
  },
  roof: function () {
    var out = [], W = 7, D = 3;
    for (var step = 0; step < 4; step++) {
      for (var x = step; x <= W - 1 - step; x++) {
        for (var z = 0; z < D; z++) out.push({ x: x, y: step, z: z, id: RF });
      }
    }
    return out;
  },
  fence: function () {
    var out = [], len = 8;
    for (var z = 0; z < len; z++) {
      if (z % 2 === 0) out.push({ x: 0, y: 0, z: z, id: Xh });
      out.push({ x: 0, y: 1, z: z, id: DW });
    }
    return out;
  },
  window: function () {
    var out = [], S = 3;
    for (var x = 0; x < S; x++) {
      for (var y = 0; y < S; y++) {
        var frame = x === 0 || x === S - 1 || y === 0 || y === S - 1;
        out.push({ x: x, y: y, z: 0, id: frame ? PL : GL });
      }
    }
    return out;
  },
  door: function () {
    var out = [];
    for (var x = 0; x < 3; x++) {
      for (var y = 0; y < 4; y++) {
        var frame = x === 0 || x === 2 || y === 3;
        if (!frame && y < 3) continue;
        out.push({ x: x, y: y, z: 0, id: DW });
      }
    }
    return out;
  },
  floor: function () {
    var out = [], S = 5;
    for (var x = 0; x < S; x++) for (var z = 0; z < S; z++) out.push({ x: x, y: 0, z: z, id: PL });
    return out;
  }
};
var MCB_PLAN_NAMES = [
  { key: 'house', ru: 'Дом', en: 'House' },
  { key: 'tower', ru: 'Башня', en: 'Tower' },
  { key: 'bridge', ru: 'Мост', en: 'Bridge' },
  { key: 'wall', ru: 'Стена', en: 'Wall' },
  { key: 'stairs', ru: 'Лестница', en: 'Stairs' },
  { key: 'roof', ru: 'Крыша', en: 'Roof' },
  { key: 'fence', ru: 'Забор', en: 'Fence' },
  { key: 'window', ru: 'Окно', en: 'Window' },
  { key: 'door', ru: 'Дверь', en: 'Door' },
  { key: 'floor', ru: 'Пол', en: 'Floor' }
];

/* Поворот чертежа на 90° × dir вокруг опорной точки. */
function mcbRotate(block, dir) {
  var d = ((dir % 4) + 4) % 4;
  var x = block.x, z = block.z;
  if (d === 1) { var t = x; x = -z; z = t; }
  else if (d === 2) { x = -x; z = -z; }
  else if (d === 3) { var t2 = x; x = z; z = -t2; }
  return { x: x, y: block.y, z: z, id: block.id };
}

/* Поставить чертёж у прицела. Возвращает число поставленных блоков. */
function mcxBuildStamp(key, dir) {
  var plan = MCB_PLANS[key];
  if (!plan) return 0;
  var hit = mcbAim();
  if (!hit) {
    mcbToast(mcbT('Наведитесь на поверхность, чтобы поставить чертёж.', 'Aim at a surface to build the blueprint.'), 2200);
    return 0;
  }
  var baseX = hit.x + hit.nx, baseY = hit.y + hit.ny, baseZ = hit.z + hit.nz;
  var blockList = plan();
  var placed = 0, skipped = 0;
  for (var i = 0; i < blockList.length; i++) {
    var b = mcbRotate(blockList[i], dir || 0);
    var x = baseX + b.x, y = baseY + b.y, z = baseZ + b.z;
    if (!mcbCanPlace(x, y, z)) { skipped++; continue; }
    var id = b.id;
    if (!mcbMaterial(id)) continue;
    if (mcbStock(id) <= 0) { skipped++; continue; }
    ui(x, y, z, id);
    mcbState.stock[id] = mcbStock(id) - 1;
    mcbState.edits[mcbKey(x, y, z)] = id;
    mcbPushUndo(x, y, z, Ai, id);
    placed++;
  }
  if (placed) {
    if (F) F.dirty = !0;
    mcbSave();
    mcbHotbar();
    mcbToast(mcbT('Построено блоков: ' + placed, 'Blocks built: ' + placed) +
      (skipped ? ' · ' + mcbT('пропущено ' + skipped, skipped + ' skipped') : ''), 2400);
  } else {
    mcbToast(mcbT('Здесь не хватает места для чертежа.', 'Not enough room for the blueprint here.'), 2400);
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

function mcbPageIds() {
  var start = mcbState.page * MCB_PER_PAGE;
  return MCB_MATS.slice(start, start + MCB_PER_PAGE);
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
  var pageCount = Math.ceil(MCB_MATS.length / MCB_PER_PAGE);
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
      'Чертёж ставится туда, куда вы смотрите. R — повернуть на 90°.',
      'The blueprint is placed where you look. R rotates it by 90°.') + '</p><div class="mcb-grid plans">';
    for (var p = 0; p < MCB_PLAN_NAMES.length; p++) {
      var plan = MCB_PLAN_NAMES[p];
      out += '<button type="button" class="mcb-card" data-mcb-plan="' + plan.key + '"><b>' +
        mcbT(plan.ru, plan.en) + '</b><small>' + mcbT('поставить', 'build') + '</small></button>';
    }
    out += '</div><button type="button" class="mcb-wide" data-mcb-undo>' + mcbT('Отменить последнее', 'Undo last') + '</button>';
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
      mcxBuildStamp(plan.getAttribute('data-mcb-plan'), mcbStampDir || 0);
      mcbClose();
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
  var pages = Math.ceil(MCB_MATS.length / MCB_PER_PAGE);
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
    mcbStampDir = (mcbStampDir + 1) % 4;
    mcbToast(mcbT('Поворот чертежа: ' + (mcbStampDir * 90) + '°', 'Blueprint rotation: ' + (mcbStampDir * 90) + '°'), 1400);
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
   (призрак блока, восстановление постройки) вызывается из цикла отрисовки
   самой игры — второй requestAnimationFrame на телефоне не нужен. */
mcbInit();
