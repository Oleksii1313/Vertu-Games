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
  ghostMats: null,
  ghostFor: 0,
  aim: null,
  targetKey: '',
  planKey: null,
  planDir: 0,
  planSig: '',
  planMats: null,
  planMeshes: [],
  planGeom: null,
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
var MCB_GHOST_GREEN = 0x86ff9c;
var MCB_GHOST_RED = 0xff5f5f;

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
  if (reason === 'locked') return mcbT('Этот блок отключён администратором.',
    'This block is disabled by the administrator.');
  if (reason === 'notarget') return mcbT('Наведитесь на поверхность: нужна клетка под постройку.',
    'Aim at a surface to pick the building spot.');
  return mcbT('Постройку здесь поставить нельзя.', 'The build cannot be placed here.');
}

function mcbCanPlace(x, y, z) {
  return mcbPlaceReason(x, y, z) === '';
}

function mcbEnsureGhost() {
  if (mcbState.ghost) return mcbState.ghost;
  if (!Ht || typeof wt !== 'function' || typeof cn !== 'function' || typeof ti !== 'function') return null;
  var mesh = new wt(new cn(1, 1, 1), mcbGhostMaterial(true));
  mesh.visible = false;
  mesh.renderOrder = 3;
  mesh.name = 'mcx-build-ghost';
  Ht.add(mesh);
  mcbState.ghost = mesh;
  return mesh;
}

function mcbGhostMaterial(ok) {
  if (!mcbState.ghostMats) mcbState.ghostMats = {};
  var key = ok ? 'ok' : 'no';
  if (!mcbState.ghostMats[key]) {
    mcbState.ghostMats[key] = new ti({
      color: ok ? MCB_GHOST_GREEN : MCB_GHOST_RED,
      transparent: true, opacity: ok ? .42 : .5, depthWrite: false
    });
  }
  return mcbState.ghostMats[key];
}

/* Призрак одиночного блока. Обновляем сетку/материал только когда изменилась
   цель: движение камеры внутри той же клетки не трогает mesh — поэтому нет
   дрожания и мерцания, а зелёный/красный цвет говорит, можно ли ставить. */
function mcbGhostUpdate() {
  var ghost = mcbEnsureGhost();
  if (!ghost) return;
  if (mcbState.planKey) {
    /* Во время предпросмотра чертежа одиночный призрак не нужен. */
    ghost.visible = false;
    return;
  }
  var hit = mcbState.aim;
  if (!hit) {
    ghost.visible = false;
    mcbState.targetKey = '';
    return;
  }
  var x = hit.px, y = hit.py, z = hit.pz;
  var reason = mcbPlaceReason(x, y, z, mcbState.selected);
  var ok = reason === '';
  var key = x + ',' + y + ',' + z + '|' + (ok ? 1 : 0) + '|' + (ok ? mcbState.selected : 0);
  if (key === mcbState.targetKey && ghost.visible) return;
  mcbState.targetKey = key;
  ghost.material = mcbGhostMaterial(ok);
  ghost.position.set(x + .5, y + .5, z + .5);
  ghost.visible = true;
}

/* Покадровая часть: призрак блока и предпросмотр чертежа. */
function mcbTick() {
  if (Mt !== 'playing' || !F) {
    if (mcbState.ghost) mcbState.ghost.visible = false;
    mcbState.targetKey = '';
    mcbPlanPreviewHide();
    if (mcbState.open && !mcbState.layoutMode) mcbClose();
    return;
  }
  if (!mcbState.loaded) mcbLoad();
  mcbRestore();
  mcbAim();
  mcbGhostUpdate();
  if (mcbState.planKey) mcbPlanPreviewUpdate();
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

/* --- сами шаблоны ------------------------------------------------------- */
var MCB_TEMPLATES = [
  {
    key: 'smallHouse', cat: 'home', ru: 'Маленький деревянный дом', en: 'Small wooden house',
    build: function (b) {
      var W = 5, D = 5;
      b.fill(0, 0, 0, W - 1, 0, D - 1, PL);            /* пол */
      b.shell(0, 1, 0, W - 1, 3, D - 1, PL);           /* стены */
      mcbTplFrame(b, 0, 0, W - 1, D - 1, 1, 3, Xh);    /* угловые стойки */
      b.erase(2, 1, 0); b.erase(2, 2, 0);              /* дверь */
      b.put(1, 2, 0, GL); b.put(3, 2, 0, GL);
      b.put(1, 2, D - 1, GL); b.put(3, 2, D - 1, GL);
      b.put(0, 2, 2, GL); b.put(W - 1, 2, 2, GL);
      mcbTplRoof(b, 0, 0, W - 1, D - 1, 4, RF);
    }
  },
  {
    key: 'largeHouse', cat: 'home', ru: 'Большой деревянный дом', en: 'Large wooden house',
    build: function (b) {
      var W = 7, D = 7;
      b.fill(0, 0, 0, W - 1, 0, D - 1, PL);
      b.shell(0, 1, 0, W - 1, 5, D - 1, PL);
      mcbTplFrame(b, 0, 0, W - 1, D - 1, 1, 5, Xh);
      b.fill(1, 3, 1, W - 2, 3, D - 2, DW);            /* межэтажный настил */
      b.erase(3, 1, 0); b.erase(3, 2, 0);              /* дверь */
      var wy = [2, 4], k, x, z;
      for (k = 0; k < wy.length; k++) {
        var y = wy[k];
        b.put(1, y, 0, GL); b.put(5, y, 0, GL);
        b.put(1, y, D - 1, GL); b.put(5, y, D - 1, GL);
        b.put(0, y, 1, GL); b.put(0, y, 5, GL);
        b.put(W - 1, y, 1, GL); b.put(W - 1, y, 5, GL);
      }
      mcbTplRoof(b, 0, 0, W - 1, D - 1, 6, RF);
    }
  },
  {
    key: 'stoneHouse', cat: 'home', ru: 'Каменный дом', en: 'Stone house',
    build: function (b) {
      var W = 7, D = 5;
      b.fill(0, 0, 0, W - 1, 0, D - 1, SB);
      b.shell(0, 1, 0, W - 1, 3, D - 1, CB);
      mcbTplFrame(b, 0, 0, W - 1, D - 1, 1, 3, SB);
      b.erase(3, 1, 0); b.erase(3, 2, 0);
      b.put(1, 2, 0, GL); b.put(5, 2, 0, GL);
      b.put(1, 2, D - 1, GL); b.put(5, 2, D - 1, GL);
      b.put(0, 2, 2, GL); b.put(W - 1, 2, 2, GL);
      mcbTplRoof(b, 0, 0, W - 1, D - 1, 4, SL);
    }
  },
  {
    key: 'medievalHouse', cat: 'home', ru: 'Средневековый дом', en: 'Medieval house',
    build: function (b) {
      var W = 7, D = 7, x, z, y;
      b.fill(0, 0, 0, W - 1, 0, D - 1, PL);
      b.shell(0, 1, 0, W - 1, 3, D - 1, PS);           /* штукатурка */
      /* Фахверк: стойки через каждые две клетки и обвязка по этажам. */
      for (y = 1; y <= 3; y++) {
        for (x = 0; x < W; x += 2) { b.put(x, y, 0, DW); b.put(x, y, D - 1, DW); }
        for (z = 0; z < D; z += 2) { b.put(0, y, z, DW); b.put(W - 1, y, z, DW); }
      }
      /* Второй этаж с напуском на клетку: сначала сплошной настил, поэтому
         свес опирается на него, а не висит в воздухе. */
      b.fill(-1, 4, -1, W, 4, D, PL);
      b.shell(-1, 5, -1, W, 6, D, PS);
      for (y = 5; y <= 6; y++) {
        for (x = -1; x <= W; x += 2) { b.put(x, y, -1, DW); b.put(x, y, D, DW); }
        for (z = -1; z <= D; z += 2) { b.put(-1, y, z, DW); b.put(W, y, z, DW); }
      }
      b.erase(3, 1, 0); b.erase(3, 2, 0);
      b.put(1, 2, 0, GL); b.put(5, 2, 0, GL);
      b.put(1, 2, D - 1, GL); b.put(5, 2, D - 1, GL);
      b.put(0, 2, 2, GL); b.put(W - 1, 2, 4, GL);
      b.put(2, 6, -1, GL); b.put(4, 6, -1, GL);
      b.put(2, 6, D, GL); b.put(4, 6, D, GL);
      mcbTplRoof(b, -1, -1, W, D, 7, RF);
    }
  },
  {
    key: 'tower', cat: 'fort', ru: 'Башня', en: 'Tower',
    build: function (b) {
      var S = 7, H = 10, x, z, y;
      b.shell(0, 0, 0, S - 1, H - 1, S - 1, CB);
      mcbTplFrame(b, 0, 0, S - 1, S - 1, 0, H - 1, SB);
      b.fill(1, 0, 1, S - 2, 0, S - 2, SB);
      b.fill(1, 4, 1, S - 2, 4, S - 2, SB);
      b.fill(1, 8, 1, S - 2, 8, S - 2, SB);
      /* Бойницы: узкие окна на каждом ярусе. */
      b.put(3, 2, 0, GL); b.put(3, 2, S - 1, GL);
      b.put(3, 6, 0, GL); b.put(3, 6, S - 1, GL);
      b.put(0, 2, 3, GL); b.put(S - 1, 6, 3, GL);
      /* Зубцы по периметру. */
      for (x = 0; x < S; x++) {
        for (z = 0; z < S; z++) {
          if (x !== 0 && x !== S - 1 && z !== 0 && z !== S - 1) continue;
          if ((x + z) % 2 === 0) b.put(x, H, z, SB);
        }
      }
      /* Вход на уровне земли. */
      b.erase(3, 0, 0); b.erase(3, 1, 0); b.erase(3, 2, 0);
    }
  },
  {
    key: 'castle', cat: 'fort', ru: 'Замок', en: 'Castle',
    build: function (b) {
      var S = 13, x, z, y;
      b.shell(0, 0, 0, S - 1, 3, S - 1, CB);            /* стены */
      for (x = 0; x < S; x++) {
        for (z = 0; z < S; z++) {
          if (x !== 0 && x !== S - 1 && z !== 0 && z !== S - 1) continue;
          if ((x + z) % 2 === 0) b.put(x, 4, z, CB);    /* зубцы */
        }
      }
      /* Ворота: проём 3 × 2 с перекладиной. */
      for (x = 5; x <= 7; x++) { b.erase(x, 0, 0); b.erase(x, 1, 0); b.erase(x, 2, 0); }
      /* Четыре угловые башни. */
      var corners = [[0, 0], [S - 4, 0], [0, S - 4], [S - 4, S - 4]];
      for (var c = 0; c < corners.length; c++) {
        var cx = corners[c][0], cz = corners[c][1];
        b.shell(cx, 0, cz, cx + 2, 6, cz + 2, SB);
        b.fill(cx, 0, cz, cx + 2, 0, cz + 2, SB);
        for (x = cx; x <= cx + 2; x++) {
          for (z = cz; z <= cz + 2; z++) {
            if (x !== cx && x !== cx + 2 && z !== cz && z !== cz + 2) continue;
            if ((x + z) % 2 === 0) b.put(x, 7, z, SB);
          }
        }
      }
    }
  },
  {
    key: 'watchtower', cat: 'fort', ru: 'Сторожевая башня', en: 'Watchtower',
    build: function (b) {
      var W = 5, H = 6, x, z, y;
      b.fill(0, 0, 0, W - 1, 0, W - 1, PL);
      b.shell(0, 1, 0, W - 1, H, W - 1, DW);
      mcbTplFrame(b, 0, 0, W - 1, W - 1, 1, H, Xh);
      b.put(1, 3, 0, GL); b.put(3, 3, 0, GL);
      b.put(0, 3, 2, GL); b.put(W - 1, 3, 2, GL);
      b.erase(2, 1, 0); b.erase(2, 2, 0);
      b.fill(0, H + 1, 0, W - 1, H + 1, W - 1, PL);     /* площадка */
      b.shell(0, H + 2, 0, W - 1, H + 2, W - 1, DW);    /* перила */
      b.erase(2, H + 2, 0);                            /* выход на площадку */
      mcbTplRoof(b, 0, 0, W - 1, W - 1, H + 3, RF);
    }
  },
  {
    key: 'bridge', cat: 'infra', ru: 'Мост', en: 'Bridge',
    build: function (b) {
      var z, x;
      for (z = 0; z <= 12; z++) {
        b.fill(-1, 0, z, 1, 0, z, SL);                 /* настил 3 в ширину */
        b.put(-1, 1, z, z % 3 === 0 ? Xh : DW);        /* перила */
        b.put(1, 1, z, z % 3 === 0 ? Xh : DW);
      }
      /* Опоры: уходят вниз, к воде/земле под мостом. */
      for (z = 3; z <= 9; z += 6) {
        for (var d = 1; d <= 3; d++) b.fill(-1, -d, z, 1, -d, z, CB);
      }
    }
  },
  {
    key: 'wall', cat: 'fort', ru: 'Крепостная стена', en: 'Castle wall',
    build: function (b) {
      var L = 11, x, z;
      b.fill(0, 0, 0, 1, 3, L - 1, CB);                /* стена в две клетки */
      b.fill(0, 3, 0, 1, 3, L - 1, SB);
      for (z = 0; z < L; z += 2) { b.put(0, 4, z, SB); b.put(1, 4, z, SB); }
      b.erase(0, 1, 5); b.erase(0, 2, 5);             /* проход */
      b.erase(1, 1, 5); b.erase(1, 2, 5);
      b.put(0, 1, 2, GL); b.put(0, 2, 2, GL);
      b.put(0, 1, 8, GL); b.put(0, 2, 8, GL);
    }
  },
  {
    key: 'farm', cat: 'infra', ru: 'Ферма', en: 'Farm',
    build: function (b) {
      var S = 9, x, z;
      /* Грядки: чередование вспаханной земли и воды для полива. */
      b.fill(1, 0, 1, S - 2, 0, S - 2, Gh);
      for (z = 2; z <= 6; z += 4) b.fill(1, 0, z, S - 2, 0, z, Hh);
      /* Забор по периметру: столбы и перекладины. */
      for (x = 0; x < S; x++) {
        for (z = 0; z < S; z++) {
          if (x !== 0 && x !== S - 1 && z !== 0 && z !== S - 1) continue;
          if ((x + z) % 2 === 0) b.put(x, 0, z, Xh);
          b.put(x, 1, z, DW);
        }
      }
      b.erase(S - 1, 1, 4);                            /* вход */
      /* Пугало в центре. */
      b.put(4, 1, 4, DW); b.put(4, 2, 4, DW); b.put(4, 3, 4, Bl);
      b.put(3, 3, 4, Bl); b.put(5, 3, 4, Bl);
    }
  },
  {
    key: 'decor', cat: 'decor', ru: 'Фонтан', en: 'Fountain',
    build: function (b) {
      var S = 5, x, z;
      b.fill(0, 0, 0, S - 1, 0, S - 1, SB);            /* чаша */
      b.fill(1, 0, 1, S - 2, 0, S - 2, GL);            /* вода (стекло) */
      b.put(2, 1, 2, SL); b.put(2, 2, 2, SL);          /* колонна */
      b.fill(1, 3, 1, 3, 3, 3, SB);                    /* верхняя чаша */
      b.put(2, 3, 2, GL);
      /* Фонари по углам. */
      var corners = [[0, 0], [S - 1, 0], [0, S - 1], [S - 1, S - 1]];
      for (var c = 0; c < corners.length; c++) {
        b.put(corners[c][0], 1, corners[c][1], Xh);
        b.put(corners[c][0], 2, corners[c][1], RF);
      }
    }
  },
  {
    key: 'stairs', cat: 'parts', ru: 'Лестница', en: 'Stairs',
    build: function (b) {
      /* Сплошная лестница: под каждой ступенью блок, поэтому нет «парящих»
         клеток, а подъём остаётся на одну клетку за шаг. */
      for (var i = 0; i < 5; i++) {
        for (var w = 0; w < 3; w++) {
          for (var y = 0; y <= i; y++) b.put(w - 1, y, i, PL);
        }
      }
    }
  },
  {
    key: 'roof', cat: 'parts', ru: 'Крыша', en: 'Roof',
    build: function (b) { mcbTplRoof(b, -3, 0, 3, 2, 0, RF); }
  },
  {
    key: 'fence', cat: 'parts', ru: 'Забор', en: 'Fence',
    build: function (b) {
      for (var z = 0; z < 8; z++) {
        if (z % 2 === 0) b.put(0, 0, z, Xh);
        b.put(0, 1, z, DW);
      }
    }
  },
  {
    key: 'window', cat: 'parts', ru: 'Окно', en: 'Window',
    build: function (b) {
      for (var x = 0; x < 3; x++) for (var y = 0; y < 3; y++) {
        var frame = x === 0 || x === 2 || y === 0 || y === 2;
        b.put(x, y, 0, frame ? PL : GL);
      }
    }
  },
  {
    key: 'door', cat: 'parts', ru: 'Дверь', en: 'Door',
    build: function (b) {
      for (var x = 0; x < 3; x++) for (var y = 0; y < 4; y++) {
        var frame = x === 0 || x === 2 || y === 3;
        if (!frame && y < 3) continue;
        b.put(x, y, 0, DW);
      }
    }
  },
  {
    key: 'floor', cat: 'parts', ru: 'Пол', en: 'Floor',
    build: function (b) { b.fill(0, 0, 0, 4, 0, 4, PL); }
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
  result.ok = true;
  return result;
}

/* ------------------------------------------------- предпросмотр чертежа */
function mcbPlanMaterial(ok) {
  if (!mcbState.planMats) mcbState.planMats = {};
  var k = ok ? 'ok' : 'no';
  if (!mcbState.planMats[k]) {
    mcbState.planMats[k] = new ti({
      color: ok ? MCB_GHOST_GREEN : MCB_GHOST_RED,
      transparent: true, opacity: ok ? .36 : .5, depthWrite: false
    });
  }
  return mcbState.planMats[k];
}

function mcbPlanMesh(index, mat) {
  var list = mcbState.planMeshes || (mcbState.planMeshes = []);
  if (!list[index]) {
    if (!Ht || typeof wt !== 'function' || typeof cn !== 'function') return null;
    /* Геометрия одна на все клетки предпросмотра: замок из 400 блоков не
       должен создавать 400 отдельных буферов. */
    if (!mcbState.planGeom) mcbState.planGeom = new cn(1, 1, 1);
    var mesh = new wt(mcbState.planGeom, mat);
    mesh.renderOrder = 4;
    mesh.name = 'mcx-plan-' + index;
    Ht.add(mesh);
    list[index] = mesh;
  }
  return list[index];
}

/* Перерисовываем предпросмотр только при смене цели/поворота/валидности —
   поэтому при движении камеры внутри клетки ничего не мерцает. */
function mcbPlanPreviewUpdate() {
  if (!mcbState.planKey) { mcbPlanPreviewHide(); return; }
  var check = mcbPlanCheck(mcbState.planKey, mcbState.planDir);
  var baseKey = check.base ? (check.base.x + ',' + check.base.y + ',' + check.base.z) : '-';
  var sig = check.key + '|' + check.dir + '|' + baseKey + '|' + (check.ok ? 1 : 0) + '|' +
    check.blocks.length + '|' + check.reason;
  if (sig === mcbState.planSig) return;
  mcbState.planSig = sig;
  var mat = mcbPlanMaterial(check.ok);
  var list = mcbState.planMeshes || [];
  var shown = 0;
  for (var i = 0; i < check.blocks.length; i++) {
    var b = check.blocks[i];
    var mesh = mcbPlanMesh(shown, mat);
    if (!mesh) break;
    mesh.material = mat;
    mesh.position.set(b.x + .5, b.y + .5, b.z + .5);
    mesh.visible = true;
    shown++;
  }
  for (var j = shown; j < list.length; j++) if (list[j]) list[j].visible = false;
  mcbPlanBar(check);
}

function mcbPlanPreviewHide() {
  var list = mcbState.planMeshes || [];
  for (var i = 0; i < list.length; i++) if (list[i]) list[i].visible = false;
  mcbState.planSig = '';
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

/* Начать предпросмотр шаблона (постановка — только после подтверждения). */
function mcxBuildPlanStart(key, dir) {
  if (!mcbTemplate(key)) return false;
  mcbState.planKey = key;
  mcbState.planDir = dir == null ? (mcbStampDir || 0) : dir;
  mcbState.planSig = '';
  mcbPlanPreviewUpdate();
  var check = mcbPlanCheck(key, mcbState.planDir);
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
  mcbState.planSig = '';
  mcbPlanPreviewUpdate();
  return mcbState.planDir;
}

function mcxBuildPlanCancel() {
  mcbState.planKey = null;
  mcbState.planDir = 0;
  mcbPlanPreviewHide();
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

/* Совместимость: поставить шаблон сразу (без предпросмотра), но с той же
   проверкой — постройка либо встаёт целиком, либо не встаёт вовсе. */
function mcxBuildStamp(key, dir) {
  if (!mcbTemplate(key)) return 0;
  var previousKey = mcbState.planKey, previousDir = mcbState.planDir, previousSig = mcbState.planSig;
  mcbState.planKey = key;
  mcbState.planDir = ((dir || 0) % 4 + 4) % 4;
  var placed = mcxBuildConfirm();
  if (!placed) {
    mcbState.planKey = previousKey;
    mcbState.planDir = previousDir;
    mcbState.planSig = previousSig;
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
      'Выберите шаблон — появится предпросмотр всей постройки. Зелёный можно ставить, красный — нельзя. R — повернуть, подтверждение — кнопкой снизу.',
      'Pick a template to preview the whole building. Green can be placed, red cannot. R rotates, confirm with the button below.') + '</p>';
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
    mcbToast(mcbT('Предпросмотр отменён.', 'Preview cancelled.'), 1600);
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
   (призрак блока, восстановление постройки) вызывается из цикла отрисовки
   самой игры — второй requestAnimationFrame на телефоне не нужен. */
mcbInit();
