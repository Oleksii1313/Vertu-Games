"use strict";
function bootRedline() {
  const B = BABYLON,
    $ = (id) => document.getElementById(id),
    clamp = (n, a, b) => Math.max(a, Math.min(b, n)),
    lerp = (a, b, t) => a + (b - a) * t,
    angle = (a) => Math.atan2(Math.sin(a), Math.cos(a)),
    dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z),
    money = (n) => Math.round(n).toLocaleString("ru-RU"),
    touch =
      matchMedia("(pointer:coarse)").matches || navigator.maxTouchPoints > 0;
  document.body.classList.toggle("touch", touch);
  try {
    document.body.classList.toggle(
      "embedded",
      parent !== window && !!parent.document.getElementById("gameFrame"),
    );
  } catch {}
  if (touch)
    $("introInput").textContent =
      "Аналоговый джойстик · свайп камеры · мультитач";
  const canvas = $("view"),
    engine = new B.Engine(canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
      adaptToDeviceRatio: false,
    });
  engine.setHardwareScalingLevel(
    touch ? Math.max(1, devicePixelRatio / 1.35) : 1,
  );
  const scene = new B.Scene(engine);
  scene.clearColor = new B.Color4(0.7, 0.7, 0.62, 1);
  scene.fogMode = B.Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.00135;
  scene.fogColor = new B.Color3(0.7, 0.7, 0.62);
  scene.ambientColor = new B.Color3(0.28, 0.3, 0.28);
  scene.imageProcessingConfiguration.toneMappingEnabled = true;
  scene.imageProcessingConfiguration.toneMappingType =
    B.ImageProcessingConfiguration.TONEMAPPING_ACES;
  scene.imageProcessingConfiguration.exposure = 1.2;
  scene.imageProcessingConfiguration.contrast = 1.08;
  function environment(sc) {
    const faces = [];
    for (let j = 0; j < 6; j++) {
      const c = document.createElement("canvas");
      c.width = c.height = 128;
      const g = c.getContext("2d"),
        grad = g.createLinearGradient(0, 0, 0, 128);
      grad.addColorStop(0, "#a4c1cf");
      grad.addColorStop(0.45, "#dde1d4");
      grad.addColorStop(0.51, "#b8b7a3");
      grad.addColorStop(1, "#565f62");
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
      g.fillStyle = "#d3d1b2";
      g.fillRect(15, 21, 30, 28);
      for (let i = 0; i < 5; i++) {
        g.fillStyle = i % 2 ? "#525f68" : "#89958f";
        g.fillRect((i * 29 + j * 17) % 128, 55 - (i % 2) * 18, 16, 40);
      }
      faces.push(new Uint8Array(g.getImageData(0, 0, 128, 128).data));
    }
    const tex = new B.RawCubeTexture(
      sc,
      faces,
      128,
      B.Engine.TEXTUREFORMAT_RGBA,
      B.Engine.TEXTURETYPE_UNSIGNED_BYTE,
      true,
      false,
      B.Texture.TRILINEAR_SAMPLINGMODE,
    );
    tex.coordinatesMode = B.Texture.CUBIC_MODE;
    return tex;
  }
  const env = environment(scene),
    ambient = new B.HemisphericLight("Sky", new B.Vector3(0.1, 1, 0), scene);
  ambient.intensity = 0.68;
  ambient.groundColor = new B.Color3(0.37, 0.36, 0.31);
  const sun = new B.DirectionalLight(
    "Afternoon sunlight",
    new B.Vector3(0.5, -1, 0.4),
    scene,
  );
  sun.intensity = 1.35;
  sun.diffuse = new B.Color3(1, 0.91, 0.72);
  sun.position.set(-530, 100, -460);
  sun.autoUpdateExtends = false;
  sun.orthoLeft = -85;
  sun.orthoRight = 85;
  sun.orthoTop = 85;
  sun.orthoBottom = -85;
  sun.shadowMinZ = 1;
  sun.shadowMaxZ = 260;
  const shadow = new B.ShadowGenerator(touch ? 512 : 1024, sun);
  shadow.usePercentageCloserFiltering = true;
  shadow.filteringQuality = B.ShadowGenerator.QUALITY_LOW;
  shadow.bias = 0.002;
  shadow.normalBias = 0.025;
  shadow.setDarkness(0.25);
  scene.skipPointerMovePicking = true;
  const cars = createRedlineCars(B, scene, env, shadow),
    world = buildRedlineWorld({ B, scene, shadow, cars }),
    staticMeshes = scene.meshes.filter(
      (m) => !world.breakers.some((b) => m === b.ring || m.isDescendantOf(b.g)),
    ),
    staticMeshSet = new Set(staticMeshes),
    staticCasters = new Set(shadow.getShadowMap().renderList),
    cam = new B.FreeCamera("Chase camera", new B.Vector3(-470, 5, -433), scene);
  cam.minZ = 0.12;
  cam.maxZ = 820;
  cam.fov = 0.82;
  scene.activeCamera = cam;
  const skyTex = new B.DynamicTexture(
      "Late afternoon sky",
      { width: 1024, height: 512 },
      scene,
      false,
    ),
    skyCtx = skyTex.getContext(),
    skyGrad = skyCtx.createLinearGradient(0, 0, 0, 512);
  skyGrad.addColorStop(0, "#6f8c9c");
  skyGrad.addColorStop(0.45, "#a0b0ad");
  skyGrad.addColorStop(0.62, "#c8c5a7");
  skyGrad.addColorStop(1, "#999b7d");
  skyCtx.fillStyle = skyGrad;
  skyCtx.fillRect(0, 0, 1024, 512);
  for (let j = 0; j < 35; j++) {
    const x = (j * 137) % 1024,
      y = 65 + ((j * 47) % 190),
      g = skyCtx.createRadialGradient(x, y, 3, x, y, 80);
    g.addColorStop(0, "#f5eedb20");
    g.addColorStop(1, "#f5eedb00");
    skyCtx.save();
    skyCtx.translate(0, y * 0.72);
    skyCtx.scale(1, 0.28);
    skyCtx.fillStyle = g;
    skyCtx.fillRect(x - 85, y - 85, 170, 170);
    skyCtx.restore();
  }
  skyTex.update();
  const skyMat = new B.StandardMaterial("Warm cloud dome", scene);
  skyMat.emissiveTexture = skyTex;
  skyMat.diffuseColor = B.Color3.Black();
  skyMat.disableLighting = true;
  skyMat.backFaceCulling = false;
  skyMat.fogEnabled = false;
  const sky = B.MeshBuilder.CreateSphere(
    "Atmospheric sky",
    { diameter: 1450, segments: 20 },
    scene,
  );
  sky.material = skyMat;
  sky.infiniteDistance = true;
  sky.isPickable = false;

  // The independent showroom keeps the garage fast and makes body architecture easy to inspect.
  const showroom = new B.Scene(engine);
  showroom.clearColor = new B.Color4(0.105, 0.137, 0.147, 1);
  showroom.imageProcessingConfiguration.toneMappingEnabled = true;
  showroom.imageProcessingConfiguration.toneMappingType =
    B.ImageProcessingConfiguration.TONEMAPPING_ACES;
  showroom.imageProcessingConfiguration.exposure = 1.1;
  const showEnv = environment(showroom),
    showHem = new B.HemisphericLight(
      "Studio fill",
      new B.Vector3(0, 1, 0),
      showroom,
    );
  showHem.intensity = 0.58;
  showHem.groundColor = new B.Color3(0.32, 0.36, 0.34);
  const showSun = new B.DirectionalLight(
    "Softbox",
    new B.Vector3(-0.7, -1, 0.4),
    showroom,
  );
  showSun.position.set(5, 10, -5);
  showSun.intensity = 2.1;
  showSun.orthoLeft = -8;
  showSun.orthoRight = 8;
  showSun.orthoTop = 8;
  showSun.orthoBottom = -8;
  const showShadow = new B.ShadowGenerator(1024, showSun);
  showShadow.useBlurExponentialShadowMap = true;
  showShadow.blurKernel = 24;
  showShadow.setDarkness(0.45);
  const showCars = createRedlineCars(B, showroom, showEnv, showShadow),
    showCam = new B.ArcRotateCamera(
      "Studio orbit",
      0.9,
      1.31,
      8.2,
      new B.Vector3(0, 0.65, 0),
      showroom,
    );
  showCam.lowerRadiusLimit = 5;
  showCam.upperRadiusLimit = 13;
  showCam.lowerBetaLimit = 0.35;
  showCam.upperBetaLimit = 1.53;
  showCam.minZ = 0.05;
  showroom.activeCamera = showCam;
  const floor = B.MeshBuilder.CreateGround(
    "Showroom floor",
    { width: 200, height: 200 },
    showroom,
  );
  floor.material = showCars.material("#111b20", 0, 0.9);
  floor.receiveShadows = true;
  const platform = B.MeshBuilder.CreateCylinder(
    "Turntable",
    { diameter: 8.2, height: 0.09, tessellation: 96 },
    showroom,
  );
  platform.position.y = -0.02;
  platform.material = showCars.material("#26363b", 0.25, 0.6);
  platform.receiveShadows = true;
  for (let i = 0; i < 36; i++) {
    const m = B.MeshBuilder.CreateBox(
        "Turntable markers",
        { width: 0.028, height: 0.006, depth: 0.16 },
        showroom,
      ),
      a = (i * Math.PI) / 18;
    m.position.set(Math.sin(a) * 3.84, 0.029, Math.cos(a) * 3.84);
    m.rotation.y = a;
    m.material = showCars.material(i % 3 ? "#687575" : "#b3c4a3");
  }
  let account = "solo";
  try {
    const u = JSON.parse(localStorage.getItem("currentUser") || "null");
    if (u?.username) account = u.username;
    else if (typeof u === "string") account = u;
  } catch {}
  try {
    if (parent !== window && parent.getCurrentUser) {
      const u = parent.getCurrentUser();
      if (u?.username) account = u.username;
      else if (typeof u === "string" && u) account = u;
    }
  } catch {}
  const saveKey = "vg_redline_v1:" + account,
    defaults = () => ({
      version: 1,
      cash: 6500,
      owned: [0],
      selected: 0,
      cars: {},
      wins: 0,
      bounty: 0,
      escapes: 0,
      boss: 0,
      totalDistance: 0,
      position: { x: -480, z: -423, yaw: 0 },
      sound: false,
      prologue: { done: false, stage: "opening", line: 0 },
    }),
    state = defaults();
  let stored;
  try {
    stored = JSON.parse(localStorage.getItem(saveKey) || "null");
  } catch {}
  const writerId=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
  let expectedWriter=stored?.writerId||null;
  if (stored?.version === 1) {
    for (const k of [
      "cash",
      "wins",
      "bounty",
      "escapes",
      "boss",
      "totalDistance",
    ])
      if (Number.isFinite(stored[k])) state[k] = Math.max(0, stored[k]);
    state.boss = clamp(Math.floor(state.boss), 0, 15);
    state.owned = Array.isArray(stored.owned)
      ? [
          ...new Set([
            ...stored.owned.filter(
              (x) => Number.isInteger(x) && x >= 0 && x < 10,
            ),
          ]),
        ]
      : [0];
    if(!state.owned.length)state.owned=[0];
    state.selected = state.owned.includes(stored.selected)
      ? stored.selected
      : state.owned[0];
    if (stored.cars && typeof stored.cars === "object")
      state.cars = stored.cars;
    if (
      stored.position &&
      ["x", "z", "yaw"].every((k) => Number.isFinite(stored.position[k]))
    )
      state.position = {
        x: clamp(stored.position.x, world.limits.minX, world.limits.maxX),
        z: clamp(stored.position.z, world.limits.minZ, world.limits.maxZ),
        yaw: stored.position.yaw,
      };
    state.sound = !!stored.sound;
    if (stored.prologue && typeof stored.prologue === "object")
      state.prologue = {
        done: !!stored.prologue.done,
        stage: String(stored.prologue.stage || "opening"),
        line: clamp(Number(stored.prologue.line) || 0, 0, 3),
      };
  }
  state.exchange={};
  const pending=stored?.exchange?.pending;
  if(pending&&typeof pending.id==='string'&&pending.account===account&&pending.credits===1000&&pending.coins===100)state.exchange.pending={...pending};
  let forfeitedOnLoad=null;
  if(stored?.stake&&Number.isInteger(stored.stake.carId)&&stored.stake.ownedCount>=5){state.stake={...stored.stake};forfeitedOnLoad=redlineSettleStake(state,false);}
  if (!world.onRoad(state.position.x,state.position.z) || world.solids.some(o=>world.contact(o,state.position.x,state.position.z,1.5))) {
    const p=world.nearestRoad(state.position.x,state.position.z);
    state.position={x:p.x,z:p.z,yaw:p.yaw};
  }
  function config(id) {
    let c = state.cars[id];
    if (!c || typeof c !== "object") c = state.cars[id] = {};
    for (const k of ["engine", "transmission", "suspension"])
      c[k] = clamp(Math.floor(Number(c[k]) || 0), 0, 3);
    if (typeof c.color !== "string" || !/^#[0-9a-f]{6}$/i.test(c.color))
      c.color = cars.catalog[id].color;
    return c;
  }
  const vehicle = {
      x: state.position.x,
      z: state.position.z,
      yaw: state.position.yaw,
      vx: 0,
      vz: 0,
      speed: 0,
      steer: 0,
      yawRate: 0,
      steer: 0,
      nitro: 100,
      slow: 100,
      health: 100,
      tyres: 0,
      hit: 0,
      odometer: 0,
    },
    input = { x: 0, y: 0, nitro: false, brake: false, slow: false },
    keys = new Set(),
    cameraInput = { yaw: 0, pitch: 0, drag: null, last: 0 },
    traffic = [],
    police = [],
    hazards = [];
  let player = cars.make(state.selected, config(state.selected)),
    preview = null,
    garageId = state.selected,
    mode = "intro",
    returnMode = "drive",
    race = null,
    t = 0,
    uiTime = 0,
    saveTime = 0,
    toastTime = 0,
    shadowTime = 0,
    orbitIdle = 0,
    cameraMode = 0,
    manual = false,
    slowActive = false,
    garageReturn = "drive",
    showroomMode = "intro",
    story = null;
  const pursuit = {
    phase: "none",
    heat: 0,
    time: 0,
    bounty: 0,
    unseen: 0,
    search: 0,
    cooldown: 0,
    bust: 0,
    last: { x: 0, z: 0 },
    spawn: 0,
    hazardTimer: 0,
    heliFuel: 0,
    heliGap: 0,
    escapesThis: 0,
  };
  const roam=createRedlineRoam({world,state,vehicle,stored,toast:showToast,save,showSheet,enterDrive,getRace:()=>race,getStory:()=>story});
  function save() {
    if (!story?.active)
      state.position = { x: vehicle.x, z: vehicle.z, yaw: vehicle.yaw };
    try {
      const latest=JSON.parse(localStorage.getItem(saveKey)||'null');
      if((latest?.writerId||null)!==expectedWriter){$('saveWarn').textContent='Другая вкладка использует это сохранение. Перезагрузи игру.';$('saveWarn').hidden=false;return false}
      state.writerId=writerId;
      localStorage.setItem(saveKey, JSON.stringify(state));
      expectedWriter=writerId;
      return true;
    } catch {
      $("saveWarn").hidden = false;
      return false;
    }
  }
  function resetInput() {
    keys.clear();
    Object.assign(input, {
      x: 0,
      y: 0,
      nitro: false,
      brake: false,
      slow: false,
    });
    stickId = null;
    $("stick").firstElementChild.style.transform = "";
    for (const id of ["nitroBtn", "brakeBtn", "slowBtn"])
      $(id).classList.remove("held");
  }
  function showToast(text, seconds = 3.2) {
    $("toast").textContent = text;
    $("toast").hidden = false;
    toastTime = seconds;
  }
  function hidePanels() {
    document.querySelectorAll(".sheet").forEach((e) => (e.hidden = true));
  }
  function viewMode(m) {
    mode = m;
    resetInput();
    if (m !== "drive") {
      $("toast").hidden = true;
      toastTime = 0;
    }
    $("intro").hidden = m !== "intro";
    $("garage").hidden = m !== "garage";
    $("hud").hidden = !["drive", "pause", "result"].includes(m);
    $("touch").hidden = m !== "drive";
    $("money").textContent = "₵ " + money(state.cash);
    resize();
    story?.refresh();
  }
  function showSheet(id) {
    if (mode === "cinematic") returnMode = "cinematic";
    if (mode === "intro") returnMode = "intro";
    else if (mode === "garage") returnMode = "garage";
    else if (mode === "drive") returnMode = "drive";
    hidePanels();
    viewMode("pause");
    $(id).hidden = false;
    if (
      returnMode === "intro" ||
      returnMode === "garage" ||
      returnMode === "cinematic"
    )
      $("hud").hidden = true;
    if (id === "menu") {
      const next =
        state.boss < 15
          ? "Следующий: № " + (15 - state.boss) + " / " + bossNames[state.boss]
          : "Spectre GTR снова твой";
      $("careerSummary").textContent =
        next +
        " · " +
        state.wins +
        " побед · " +
        money(state.bounty) +
        " BP · " +
        state.escapes +
        " уходов";
      $("abandonBtn").hidden = !race || !!story?.active;
      $("challengeBtn").disabled =
        pursuit.phase !== "none" || !!race || !!story?.active;
      $("eventsBtn").disabled =
        pursuit.phase !== "none" || !!race || !!story?.active;
      $("blacklistBtn").disabled =
        pursuit.phase !== "none" || !!race || !!story?.active;
      $("garageBtn").disabled =
        pursuit.phase !== "none" || !!race || !!story?.active;
      $("storyEndBtn").hidden = !story?.active;
      $("storyReplay").disabled =
        !!race || pursuit.phase !== "none" || !!story?.active;
      $("recoverBtn").disabled =
        returnMode === "intro" ||
        returnMode === "garage" ||
        returnMode === "cinematic";
    }
  }
  function closeSheet() {
    hidePanels();
    viewMode(returnMode);
    if (mode === "garage") refreshGarage();
    if (mode === "drive") canvas.focus();
  }
  function enterDrive() {
    hidePanels();
    viewMode("drive");
    returnMode = "drive";
    updatePlayerMesh();
    snapCamera();
    canvas.focus();
    if (!story?.active && !state.totalDistance && !state.wins)
      showToast(
        touch
          ? "Джойстик вверх — газ. Вниз — тормоз, затем задний ход."
          : "W — газ, S — тормоз. Меню → заезды. G → гараж.",
        6,
      );
  }
  let flames = [];
  const flameMat = new B.StandardMaterial("Nitrous exhaust", scene);
  flameMat.diffuseColor = new B.Color3(0.18, 0.48, 1);
  flameMat.emissiveColor = new B.Color3(0.35, 0.63, 1);
  flameMat.alpha = 0.82;
  function addFlames() {
    flames = [];
    for (const side of [-1, 1]) {
      const m = B.MeshBuilder.CreateSphere(
        "Exhaust flame",
        { diameter: 1, segments: 8 },
        scene,
      );
      m.parent = player.root;
      m.position.set(
        side * player.catalog.W * 0.28,
        player.catalog.r * 0.65 + 0.05,
        -player.catalog.L * 0.505 - 0.22,
      );
      m.scaling.set(0.11, 0.11, 0.5);
      m.material = flameMat;
      m.isPickable = false;
      m.setEnabled(false);
      flames.push(m);
    }
  }
  addFlames();
  const skidMat = new B.StandardMaterial("Tire rubber on asphalt", scene);
  skidMat.diffuseColor = new B.Color3(0.035, 0.045, 0.05);
  skidMat.alpha = 0.48;
  skidMat.specularColor = B.Color3.Black();
  const skidMarks = Array.from({ length: 72 }, () => {
    const m = B.MeshBuilder.CreateGround(
      "Skid mark",
      { width: 0.2, height: 1 },
      scene,
    );
    m.material = skidMat;
    m.isPickable = false;
    m.setEnabled(false);
    return m;
  });
  let skidIndex = 0,
    skidClock = 0;
  function skid(dt, active) {
    skidClock += dt;
    if (!active || skidClock < 0.065) return;
    const length = Math.abs(vehicle.speed) * skidClock;
    skidClock = 0;
    for (const side of [-1, 1]) {
      const m = skidMarks[skidIndex++ % skidMarks.length],
        c = player.catalog;
      m.position.set(
        vehicle.x -
          (Math.sin(vehicle.yaw) * c.wb) / 2 +
          Math.cos(vehicle.yaw) * side * c.W * 0.48,
        world.heightAt(vehicle.x,vehicle.z)+.09,
        vehicle.z -
          (Math.cos(vehicle.yaw) * c.wb) / 2 -
          Math.sin(vehicle.yaw) * side * c.W * 0.48,
      );
      m.rotation.y = Math.atan2(vehicle.vx, vehicle.vz);
      m.scaling.z = clamp(length, 0.35, 1.9);
      m.setEnabled(true);
    }
  }
  function replacePlayer() {
    player.dispose();
    player = cars.make(state.selected, config(state.selected));
    addFlames();
    updatePlayerMesh();
    vehicle.vx = vehicle.vz = vehicle.speed = 0;
    vehicle.health = 100;
    vehicle.tyres = 0;
    vehicle.nitro = vehicle.slow = 100;
    save();
  }
  function previewCar(id) {
    preview?.dispose();
    preview = showCars.make(id, config(id));
    preview.root.position.y = 0.015;
    garageId = id;
    showCam.radius = 9.2;
    showCam.alpha = 1.05;
    showCam.beta = 1.31;
    orbitIdle = 0;
  }
  function enterGarage() {
    if (race || pursuit.phase !== "none" || story?.active) {
      showToast("Сначала закончи заезд и уйди от полиции.");
      return;
    }
    garageReturn =
      mode === "intro" || returnMode === "intro" ? "intro" : "drive";
    hidePanels();
    previewCar(state.selected);
    viewMode("garage");
    returnMode = "garage";
    vehicle.health = 100;
    vehicle.tyres = 0;
    vehicle.nitro = vehicle.slow = 100;
    vehicle.vx = vehicle.vz = vehicle.speed = 0;
    refreshGarage();
    save();
  }
  function refreshGarage() {
    const c = cars.catalog[garageId],
      cfg = config(garageId),
      owned = state.owned.includes(garageId),
      hp = Math.round(c.hp * (1 + cfg.engine * 0.13));
    $("carName").textContent = c.name;
    $("carDesc").textContent =
      c.type +
      " / " +
      c.drive +
      " / " +
      c.L.toFixed(2) +
      " × " +
      c.W.toFixed(2) +
      " м";
    $("carSpecs").innerHTML =
      `<div>МОЩНОСТЬ<b>${hp} л.с.</b></div><div>МАКС. СКОРОСТЬ<b>${c.top + cfg.transmission * 12} км/ч</b></div><div>МАССА<b>${money(c.mass)} кг</b></div><div>СЦЕПЛЕНИЕ<b>${(c.grip + cfg.suspension * 0.6).toFixed(1)}</b></div>`;
    const buy = $("buyCar");
    buy.textContent =
      garageId === 9 && !owned && state.boss<15
        ? "Победи № 01 — Spectre GTR"
        : owned
          ? state.selected === garageId
            ? "ВЫБРАНО / СЕРВИС ВЫПОЛНЕН"
            : "СЕСТЬ ЗА РУЛЬ ↗"
          : "КУПИТЬ / ₵ " + money(c.price);
    buy.disabled =
      (garageId === 9 && !owned && state.boss<15) ||
      (owned && state.selected === garageId) ||
      (!owned && state.cash < c.price);
    $("upgrades").innerHTML = "";
    for (const [key, label, base] of [
      ["engine", "Двигатель", 2500],
      ["transmission", "Трансмиссия", 1800],
      ["suspension", "Подвеска", 1600],
    ]) {
      const level = cfg[key],
        cost = base * (level + 1) ** 2,
        e = document.createElement("div");
      e.className = "upgrade";
      e.innerHTML = `<span>${label}<small>Ступень ${level} / 3 · ${key === "engine" ? "+13% мощности" : key === "transmission" ? "+12 км/ч, быстрее набор" : "+0,6 сцепления"}</small></span><button ${!owned || level >= 3 || state.cash < cost ? "disabled" : ""}>${level >= 3 ? "МАКС." : "₵ " + money(cost)}</button>`;
      e.querySelector("button").onclick = () => {
        if (!owned || cfg[key] >= 3 || state.cash < cost) return;
        state.cash -= cost;
        cfg[key]++;
        save();
        refreshGarage();
        $("money").textContent = "₵ " + money(state.cash);
        showToast(label + ": ступень " + cfg[key]);
      };
      $("upgrades").append(e);
    }
    $("paints").innerHTML = "";
    for (const col of [
      "#d2ba7b",
      "#b84434",
      "#537a9d",
      "#c4cdd0",
      "#3c514c",
      "#303840",
    ]) {
      const b = document.createElement("button");
      b.style.background = col;
      b.title = "Окраска " + col;
      b.setAttribute("aria-label", "Окраска " + col);
      b.className = cfg.color === col ? "selected" : "";
      b.disabled = !owned;
      b.onclick = () => {
        cfg.color = col;
        previewCar(garageId);
        save();
        refreshGarage();
      };
      $("paints").append(b);
    }
    $("parts").innerHTML = "";
    for (const [key, title] of [
      ["kit", "Обвес"],
      ["wing", "Антикрыло"],
      ["rims", "Диски"],
      ["vinyl", "Полосы"],
    ]) {
      const b = document.createElement("button");
      b.textContent = title;
      b.className = cfg[key] ? "selected" : "";
      b.disabled = !owned;
      b.onclick = () => {
        cfg[key] = !cfg[key];
        previewCar(garageId);
        save();
        refreshGarage();
      };
      $("parts").append(b);
    }
    const navScroll = $("carNav").scrollLeft;
    $("carNav").innerHTML = "";
    for (const v of cars.catalog) {
      const b = document.createElement("button");
      b.className = v.id === garageId ? "active" : "";
      b.innerHTML =
        v.name +
        "<small>" +
        v.drive +
        " / " +
        (state.owned.includes(v.id)
          ? "В ГАРАЖЕ"
          : v.hero && state.boss<15
            ? "№ 01"
            : money(v.price)) +
        "</small>";
      b.onclick = () => {
        previewCar(v.id);
        refreshGarage();
        $("carNav")
          .querySelector(".active")
          ?.scrollIntoView({ block: "nearest", inline: "nearest" });
      };
      $("carNav").append(b);
    }
    $("carNav").scrollLeft = navScroll;
    $("money").textContent = "₵ " + money(state.cash);
  }
  $("buyCar").onclick = () => {
    const c = cars.catalog[garageId];
    if (!state.owned.includes(garageId)) {
      if ((c.hero&&state.boss<15) || state.cash < c.price) return;
      state.cash -= c.price;
      state.owned.push(garageId);
    }
    state.selected = garageId;
    replacePlayer();
    refreshGarage();
    showToast(c.name + " — готов к выезду");
  };
  $("garageClose").onclick = () => {
    replacePlayer();
    if (garageReturn === "intro") {
      refreshStart();
      previewCar(9);
      viewMode("intro");
      returnMode = "intro";
    } else enterDrive();
  };
  const bossNames = [
      "Moth",
      "Static",
      "Rivet",
      "Halo",
      "Torque",
      "Switch",
      "Frost",
      "Vandal",
      "Chrome",
      "Karma",
      "Venom",
      "Ghost",
      "Reign",
      "Nyx",
      "Voss",
    ],
    bossCars = [0, 1, 7, 2, 3, 4, 6, 7, 5, 3, 8, 5, 8, 9, 9];
  function requirements(i) {
    return {
      wins: 1 + i,
      bounty: i === 0 ? 150 : (i + 1) * 600,
      escapes: 1 + Math.floor(i / 3),
    };
  }
  function canChallenge(i) {
    const r = requirements(i);
    return (
      i === state.boss &&
      state.wins >= r.wins &&
      state.bounty >= r.bounty &&
      state.escapes >= r.escapes
    );
  }
  function eventMenu() {
    if (pursuit.phase !== "none" || race || story?.active) {
      showToast("Заезд недоступен во время погони или гонки.");
      return;
    }
    $("eventList").innerHTML = "";
    for (const r of world.races) {
      let length = 0;
      for (let j = 1; j < r.points.length; j++)
        length += dist(r.points[j - 1], r.points[j]);
      const e = document.createElement("div");
      e.className = "list-item";
      e.innerHTML = `<div class="row"><div class="number">0${r.id + 1}</div><div class="grow"><h3>${r.ru}</h3><div class="event-info">${r.closed ? "КОЛЬЦО / 1 КРУГ" : "СПРИНТ"} · ${(length / 1000).toFixed(1)} КМ</div><p class="muted">Победа ₵ ${money(6000 + r.id * 1500)} · 3 соперника</p></div><button class="primary event-button">На старт ↗</button></div>`;
      e.querySelector("button").onclick = () => startRace(r.id);
      $("eventList").append(e);
    }
    const stake=document.createElement('div');stake.className='list-item';
    stake.innerHTML='<div class="eyebrow">PINK SLIP / ОТ 5 МАШИН</div><h3>Гонка на машину · Кедровый перевал</h3><p class="muted">Дуэль. Ставишь выбранный автомобиль. Проигрыш или выход после старта — потеря ставки. Обычные гонки выше — без такого риска.</p><button class="primary" id="pinkSlipBtn">'+(state.owned.length>=5?'Посмотреть ставку →':'Закрыто · '+state.owned.length+' / 5 машин')+'</button>';
    stake.querySelector('button').disabled=state.owned.length<5;
    stake.querySelector('button').onclick=()=>{
      const prize=cars.catalog.find(c=>!state.owned.includes(c.id)&&(!c.hero||state.boss===15))?.id??1;
      pendingStake={carId:state.selected,prizeId:prize,ownedCount:state.owned.length};
      $('stakeCar').textContent='На кону: '+cars.catalog[state.selected].name;
      $('stakePrize').textContent='Соперник ставит '+cars.catalog[prize].name+'. Победителю — этот автомобиль (или 7500 ₵, если он уже есть).';
      showSheet('stakeConfirm');
    };
    $('eventList').append(stake);
    showSheet("events");
  }
  function blacklistMenu() {
    if (pursuit.phase !== "none" || race || story?.active) {
      showToast("Сначала заверши заезд и погоню.");
      return;
    }
    $("bossList").innerHTML = "";
    for (let i = 0; i < 15; i++) {
      const r = requirements(i),
        done = i < state.boss,
        current = i === state.boss,
        e = document.createElement("div");
      e.className =
        "list-item boss " + (done ? "done" : current ? "current" : "");
      e.innerHTML = `<div class="row"><div class="number">${String(15 - i).padStart(2, "0")}</div><div class="grow"><h3>${bossNames[i]} <span class="muted">/ ${cars.catalog[bossCars[i]].name}</span></h3><p class="muted">${done ? "Побеждён" : `${Math.min(state.wins, r.wins)}/${r.wins} побед · ${money(Math.min(state.bounty, r.bounty))}/${money(r.bounty)} BP · ${Math.min(state.escapes, r.escapes)}/${r.escapes} уходов`}</p><div class="event-info">${i === 14 ? "SPECTRE GTR + " : ""}₵ ${money(12000 + i * 4000)}</div></div><button class="event-button ${current ? "primary" : ""}" ${!canChallenge(i) ? "disabled" : ""}>${done ? "✓" : current ? "Вызов ↗" : "Закрыто"}</button></div>`;
      e.querySelector("button").onclick = () => {
        if (canChallenge(i)) startRace(i % 3, i);
      };
      $("bossList").append(e);
    }
    showSheet("blacklist");
  }
  // Continuous route-following AI. Each car moves physically between sampled road points.
  function routeLengths(points, closed) {
    const cum = [0];
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      total += dist(points[i - 1], points[i]);
      cum.push(total);
    }
    if (closed) total += dist(points.at(-1), points[0]);
    return { cum, total };
  }
  function routeAt(points, lengths, s, closed = true) {
    s = closed
      ? ((s % lengths.total) + lengths.total) % lengths.total
      : clamp(s, 0, lengths.total - 0.001);
    let i = 0;
    while (i < points.length - 1 && lengths.cum[i + 1] <= s) i++;
    const a = points[i],
      b = points[(i + 1) % points.length],
      seg = dist(a, b),
      f = seg ? (s - lengths.cum[i]) / seg : 0;
    return {
      y: lerp(a.y||0,b.y||0,f),
      pitch: Math.atan2((b.y||0)-(a.y||0),seg),
      x: lerp(a.x, b.x, f),
      z: lerp(a.z, b.z, f),
      yaw: Math.atan2(b.x - a.x, b.z - a.z),
    };
  }
  function disposeRacers() {
    if (race) race.racers.forEach((r) => r.model.dispose());
  }
  const gateRoot = new B.TransformNode("Ordered race gate", scene),
    gateMat = new B.StandardMaterial("Checkpoint light", scene);
  gateMat.diffuseColor = new B.Color3(0.77, 0.96, 0.42);
  gateMat.emissiveColor = new B.Color3(0.52, 0.65, 0.22);
  gateMat.alpha = 0.65;
  for (const side of [-1, 1]) {
    const m = B.MeshBuilder.CreateCylinder(
      "Checkpoint pole",
      { diameter: 0.35, height: 7, tessellation: 8 },
      scene,
    );
    m.parent = gateRoot;
    m.position.set(side * 11, 3.5, 0);
    m.material = gateMat;
  }
  const cross = B.MeshBuilder.CreateBox(
    "Checkpoint lintel",
    { width: 22, height: 0.2, depth: 0.2 },
    scene,
  );
  cross.parent = gateRoot;
  cross.position.y = 7;
  cross.material = gateMat;
  const ribbon = B.MeshBuilder.CreateGround(
    "Checkpoint ribbon",
    { width: 23, height: 2 },
    scene,
  );
  ribbon.parent = gateRoot;
  ribbon.position.y = 0.07;
  ribbon.material = gateMat;
  gateRoot.setEnabled(false);
  function checkpointList(route) {
    const p = route.points,
      ls = routeLengths(p, route.closed),
      list = [];
    for (let s = 75; s < ls.total - 30; s += 85)
      list.push({ ...routeAt(p, ls, s, route.closed), s });
    list.push({
      ...routeAt(
        p,
        ls,
        route.closed ? ls.total - 0.01 : ls.total - 0.001,
        route.closed,
      ),
      s: ls.total,
    });
    return { list, ls };
  }
  let pendingStake=null;
  function startRace(id, boss = null, stake = null) {
    if (pursuit.phase !== "none" || race) return;
    if (boss !== null && !canChallenge(boss)) return;
    if(stake){
      if(story?.active||boss!==null||state.owned.length<5||stake.carId!==state.selected||!state.owned.includes(stake.carId)||!cars.catalog[stake.prizeId])return false;
      state.stake={...stake,ownedCount:state.owned.length,raceId:id,startedAt:Date.now()};
      if(!save()){state.stake=null;showToast('Ставка не сохранена — старт отменён.');return false}
    }
    const r = world.races[id],
      { list, ls } = checkpointList(r),
      start = routeAt(r.points, ls, 0, r.closed);
    disposeRacers();
    Object.assign(vehicle, {
      x: start.x,
      z: start.z,
      yaw: start.yaw,
      vx: 0,
      vz: 0,
      speed: 0,
      yawRate: 0,
      steer: 0,
      nitro: 100,
      slow: 100,
      health: 100,
      tyres: 0,
    });
    // Grid setup only: move nearby traffic out of the new start grid, never during driving.
    for(const a of traffic)if(Math.hypot(a.x-start.x,a.z-start.z)<25){a.s+=70;const q=routeAt(a.points,a.lengths,a.s);a.x=q.x+Math.cos(q.yaw)*a.lane;a.z=q.z-Math.sin(q.yaw)*a.lane;a.yaw=q.yaw;a.vx=Math.sin(q.yaw)*a.speed;a.vz=Math.cos(q.yaw)*a.speed;groundCar(a.model,a.x,a.z,a.yaw)}
    race = {
      route: r,
      lengths: ls,
      checkpoints: list,
      cp: 0,
      time: 0,
      countdown: 3.5,
      penalty: 0,
      boss,
      stake: stake ? {...state.stake} : null,
      racers: [],
      started: false,
      finishers: 0,
      playerS: 0,
      place: 1,
    };
    for (let j = 0; j < (boss === null && !stake ? 3 : 1); j++) {
      const carId = stake ? stake.prizeId : boss === null ? [0, 1, 7][j] : bossCars[boss],
        model = cars.make(carId, {
          color: cars.catalog[carId].color,
          wing: boss !== null,
        }),
        a = {
          model,
          s: -(j + 1) * 6,
          lane: (j % 2 ? 1 : -1) * 3.7,
          speed: 0,
          finished: false,
          finishTime: 0,
          vmax: stake ? 27 : boss === null ? [26, 24, 22][j] : 27 + boss * 0.95,
        };
      race.racers.push(a);
      const v = routeAt(r.points, ls, 0, r.closed);
      model.root.position.set(v.x + Math.cos(v.yaw)*a.lane-Math.sin(v.yaw)*6*(j+1), v.y, v.z - Math.sin(v.yaw)*a.lane-Math.cos(v.yaw)*6*(j+1));
      // The approach can curve at the start junction: stage on its actual road,
      // not on a straight extrapolation that could put the third racer in a wall.
      const grid=world.nearestRoad(model.root.position.x,model.root.position.z),heading=grid.yaw+(Math.cos(v.yaw-grid.yaw)<0?Math.PI:0);
      Object.assign(a,{x:grid.x+Math.cos(heading)*a.lane,z:grid.z-Math.sin(heading)*a.lane,yaw:heading,points:r.points,lengths:ls,closed:r.closed,cp:0,cfg:{engine:boss===null?0:Math.min(3,Math.floor(boss/5)),transmission:0,suspension:0}});
      drivers.init(a,100+j,'racer');
      groundCar(model,a.x,a.z,a.yaw);
    }
    hidePanels();
    enterDrive();
    showToast(boss === null ? r.ru : "Дуэль / " + bossNames[boss], 3);
    updateGate();
    snapCamera();
    save();
  }
  function updateGate() {
    if (!race) {
      gateRoot.setEnabled(false);
      return;
    }
    const p = race.checkpoints[race.cp];
    gateRoot.setEnabled(!!p);
    if (p) {
      gateRoot.position.set(p.x, world.heightAt(p.x,p.z), p.z);
      gateRoot.rotation.y = p.yaw;
      gateRoot.scaling.x=Math.min(1,(world.nearestRoad(p.x,p.z).width-1)/22);
    }
  }
  function segmentDistance(p, a, b) {
    const dx = b.x - a.x,
      dz = b.z - a.z,
      l = dx * dx + dz * dz;
    const f = l ? clamp(((p.x - a.x) * dx + (p.z - a.z) * dz) / l, 0, 1) : 0;
    return Math.hypot(p.x - a.x - dx * f, p.z - a.z - dz * f);
  }
  function updateRace(dt, old) {
    if (!race) return;
    const r = race;
    if (r.countdown > 0) {
      r.countdown -= dt;
      $("countdown").hidden = false;
      $("countdown").textContent =
        r.countdown > 0.5 ? Math.ceil(r.countdown - 0.5) : "GO";
      vehicle.vx = vehicle.vz = vehicle.speed = 0;
      if (r.countdown <= 0) {
        r.started = true;
        $("countdown").hidden = true;
      }
      return;
    }
    r.time += dt;
    const actors=driverActors();
    for(const a of r.racers){
      const previous={x:a.x,z:a.z};drivers.step(a,dt,actors);groundCar(a.model,a.x,a.z,a.yaw);a.model.animate(a.speed,a.steer,dt,a.yawRate*a.speed);
      if(a.finished)continue;
      const gate=r.checkpoints[a.cp];if(gate&&segmentDistance(gate,previous,a)<15)a.cp++;
      if(a.cp>=r.checkpoints.length){a.finished=true;a.finishTime=r.time;r.finishers++;a.s=r.lengths.total;}
    }
    const cp = r.checkpoints[r.cp];
    if (cp && segmentDistance(cp, old, vehicle) < 15) {
      r.cp++;
      updateGate();
      if (r.cp >= r.checkpoints.length) {
        finishRace();
        return;
      }
    }
    const before =
        r.cp === 0 ? { ...r.route.points[0], s: 0 } : r.checkpoints[r.cp - 1],
      next = r.checkpoints[r.cp];
    r.playerS =
      before.s +
      clamp(1 - dist(vehicle, next) / Math.max(1, dist(before, next)), 0, 1) *
        (next.s - before.s);
    r.place = 1 + r.racers.filter((a) => a.finished || a.s > r.playerS).length;
  }
  function result(title, text, rows, eyebrow = "ПОСЛЕ ФИНИША") {
    $("resultEyebrow").textContent = eyebrow;
    $("resultTitle").textContent = title;
    $("resultText").textContent = text;
    $("resultRows").innerHTML = rows
      .map(
        ([a, b]) =>
          `<div class="stat-row"><span class="muted">${a}</span><b>${b}</b></div>`,
      )
      .join("");
    hidePanels();
    viewMode("result");
    $("result").hidden = false;
    returnMode = "drive";
    save();
  }
  function finishRace() {
    if (!race) return;
    const r = race,
      place =
        1 +
        r.racers.filter(
          (a) =>
            (a.finished
              ? a.finishTime
              : r.time + (r.lengths.total - a.s) / Math.max(a.speed, 15)) <=
            r.time + r.penalty,
        ).length,
      total = r.time + r.penalty,
      won = place === 1;
    let reward =
      r.boss === null
        ? Math.round(
            (6000 + r.route.id * 1500) * [0, 1, 0.55, 0.3, 0.15][place],
          )
        : won
          ? 12000 + r.boss * 4000
          : 2000;
    if (won) {
      state.wins++;
      if (r.boss !== null && r.boss === state.boss) {
        state.boss++;
        if (state.boss === 15 && !state.owned.includes(9)) state.owned.push(9);
      }
    }
    if(r.stake)reward=0;
    state.cash += reward;
    const stakeResult=r.stake?redlineSettleStake(state,won):null;
    disposeRacers();
    race = null;
    gateRoot.setEnabled(false);
    $("countdown").hidden = true;
    if(stakeResult?.removed!==null && stakeResult)replacePlayer();
    result(
      won ? "ПОБЕДА/" : place + " МЕСТО",
      stakeResult ? (won ? "Ставка выиграна: "+cars.catalog[stakeResult.bet.prizeId].name+(stakeResult.received===null?" · дубликат заменён на 7500 ₵":" ждёт в гараже.") : "Ставка проиграна: "+cars.catalog[stakeResult.bet.carId].name+" удалён из гаража. Остальные машины сохранены.") :
      won && state.boss === 15 && r.boss === 14
        ? "Spectre GTR снова твой. Он ждёт в гараже."
        : r.boss !== null
          ? won
            ? bossNames[r.boss] + " уступает позицию."
            : "Соперник остался впереди. Настрой машину и попробуй снова."
          : r.route.ru,
      [
        ["Результат", place + " / " + (r.racers.length + 1)],
        ["Время", formatTime(total)],
        ["Заездные кредиты", "+ ₵ " + money(reward)],
        ["Побед в карьере", state.wins],
      ],
    );
  }
  function abandonRace() {
    if (!race) return;
    if(race.stake&&!confirm('Сход означает проигрыш '+cars.catalog[race.stake.carId].name+'. Сойти?'))return;
    const bet=race.stake?redlineSettleStake(state,false):null;
    disposeRacers();
    race = null;
    gateRoot.setEnabled(false);
    $("countdown").hidden = true;
    if(bet)replacePlayer();save();
    closeSheet();
    showToast(bet?"Сход: машина ставки проиграна. В гараже осталось "+state.owned.length:"Заезд завершён без награды.");
  }
  function formatTime(s) {
    const m = Math.floor(s / 60);
    return (
      m +
      ":" +
      String(Math.floor(s % 60)).padStart(2, "0") +
      "." +
      Math.floor((s % 1) * 10)
    );
  }
  const drivers=createRedlineDrivers({world,at:routeAt});
  let nextDriverId=200;
  function driverActors(){vehicle.id=-1;vehicle.priority=0;vehicle.catalog=player.catalog;vehicle.y=world.heightAt(vehicle.x,vehicle.z);return[vehicle,...traffic,...police,...(race?.racers||[])];}
  function resolveCarContacts(){
    const actors=driverActors(),previous=actors.map(a=>({x:a.x,z:a.z}));
    for(let pass=0;pass<2;pass++)for(let i=0;i<actors.length;i++)for(let j=i+1;j<actors.length;j++){
      const a=actors[i],b=actors[j],ca=a.model?.catalog||a.catalog,cb=b.model?.catalog||b.catalog,impact=collideRedlineCars(a,b,ca,cb);
      if(impact>3&&(a===vehicle||b===vehicle)&&vehicle.hit<=0){const other=a===vehicle?b:a;vehicle.health=Math.max(5,vehicle.health-Math.min(20,impact*.45));vehicle.hit=.65;soundImpact();
        if(other.kind==='police'){pursuit.bounty+=40;if(impact>13&&Math.abs(vehicle.speed)>12&&other.ram<=0){other.disabled=10;other.ram=3;pursuit.bounty+=180;showToast('Патруль выведен из строя · +180 BP')}}
        else if(impact>8&&!race&&pursuit.phase==='none')startPursuit(1);
      }
    }
    // Impulses persist in vx/vz. Only height and the rendered pose are updated here.
    for(let i=0;i<actors.length;i++){const a=actors[i],c=a.model?.catalog||a.catalog;world.confine(a,previous[i],c.W*.48);moveRedlineVehicle(a,0,world,c);if(a!==vehicle)groundCar(a.model,a.x,a.z,a.yaw);}
    updatePlayerMesh();
  }
  const serviceTraffic=[];
  for(let z=-675;z<=-255;z+=7)serviceTraffic.push({x:-474.3,z,y:0});
  for(let j=0;j<=18;j++){const a=j/18*Math.PI;serviceTraffic.push({x:-480+Math.cos(a)*5.7,z:-255+Math.sin(a)*5.7,y:0})}
  for(let z=-255;z>=-675;z-=7)serviceTraffic.push({x:-485.7,z,y:0});
  for(let j=0;j<=18;j++){const a=Math.PI+j/18*Math.PI;serviceTraffic.push({x:-480+Math.cos(a)*5.7,z:-675+Math.sin(a)*5.7,y:0})}
  const trafficRoutes=[
    world.network.route(['C','K','L','D','C']),
    world.network.route(['K','J','I','H','M','L','K']),
    world.network.route(['L','M','G','F','E','L']),
    world.network.route(['C','J','I','H','G','F','E','D','C']),
    world.network.route(['J','U','V','W','X','Y','Z','I','J']),serviceTraffic
  ];
  for(let j=0;j<(touch?36:56);j++){
    const ri=j<4?4:j<12?5:j%4,points=ri===5?serviceTraffic:j%2?[...trafficRoutes[ri]].reverse():trafficRoutes[ri],lengths=routeLengths(points,true),carId=[0,2,4,1,3,7][j%6];
    const model=cars.make(carId,{traffic:true,color:['#919b91','#50707a','#8b5344','#ac9e7a','#8b8e93','#39444c'][j%6]});
    const a={id:j,model,points,lengths,s:((j*.61803398875)%1)*lengths.total,speed:8+(j%5),cruise:8+(j%5),lane:ri===5?0:5.7,yaw:0,wait:0};
    const p=routeAt(points,lengths,a.s);a.x=p.x+Math.cos(p.yaw)*a.lane;a.z=p.z-Math.sin(p.yaw)*a.lane;a.yaw=p.yaw;drivers.init(a,j+1,'traffic');groundCar(model,a.x,a.z,p.yaw);model.root.setEnabled(false);traffic.push(a);
  }
  function updateTraffic(dt,resolve=true){
    const actors=driverActors();for(const a of traffic){drivers.step(a,dt,actors);const near=dist(vehicle,a)<360;a.model.root.setEnabled(near);groundCar(a.model,a.x,a.z,a.yaw);if(near)a.model.animate(a.speed,a.steer,dt,a.yawRate*a.speed)}
    if(resolve)resolveCarContacts();
  }
  function spawnCop(type = 0, at = null) {
    const near = world.nearestRoad(
      vehicle.x + (Math.random() - 0.5) * 280,
      vehicle.z + (Math.random() - 0.5) * 280,
    );
    let pos = at || near;
    if (dist(pos, vehicle) < 65)
      pos = world.nearestRoad(
        vehicle.x,
        vehicle.z + (vehicle.z > 600 ? -160 : 160),
      );
    const id = type === 1 ? 4 : type === 2 ? 9 : 2,
      m = cars.make(id, { police: true, color: "#cbd0ce" });
    groundCar(m,pos.x,pos.z,pos.yaw||0);
    const p = {
      model: m,
      x: pos.x,
      z: pos.z,
      yaw: pos.yaw||0,
      speed: 0,
      target: null,
      disabled: 0,
      type,
      ram: 0,
      routeTimer: 0,
    };
    if(pursuit.phase==='chase'){const aim=world.steerTo(p,vehicle,22);p.yaw=Math.atan2(aim.x-p.x,aim.z-p.z);groundCar(m,p.x,p.z,p.yaw);}
    drivers.init(p,nextDriverId++,'police');p.role=['pursue','flank','intercept'][(p.id-200)%3];
    police.push(p);
    return p;
  }
  function clearPolice() {
    police.splice(0).forEach((p) => p.model.dispose());
    hazards.splice(0).forEach((h) => h.root.dispose());
    heli.setEnabled(false);
  }
  function startPursuit(heat = 1) {
    if (pursuit.phase !== "none" || story?.active || race?.stake) return;
    Object.assign(pursuit, {
      phase: "chase",
      heat: clamp(heat, 1, 6),
      time: 0,
      bounty: 0,
      unseen: 0,
      search: 0,
      cooldown: 0,
      bust: 0,
      last: { x: vehicle.x, z: vehicle.z },
      spawn: 0,
      hazardTimer: 0,
      heliFuel: 0,
      heliGap: 0,
    });
    spawnCop(heat >= 3 ? 1 : 0);
    spawnCop(0);
    showToast("Полиция на хвосте. Оторвись и разорви видимость.", 5);
  }
  const heli = new B.TransformNode("Police helicopter", scene);
  const hm = cars.material("#34434a", 0.25, 0.6),
    hbody = B.MeshBuilder.CreateSphere(
      "Helicopter fuselage",
      { diameter: 1, segments: 12 },
      scene,
    );
  hbody.scaling.set(2.2, 2.2, 5.4);
  hbody.parent = heli;
  hbody.material = hm;
  const hglass = B.MeshBuilder.CreateSphere(
    "Cockpit glazing",
    { diameter: 1, segments: 12 },
    scene,
  );
  hglass.scaling.set(1.9, 1.8, 2.6);
  hglass.position.set(0, 0.1, 2);
  hglass.parent = heli;
  hglass.material = cars.material("#597888", 0.4, 0.2);
  const tail = world.box(heli, 0, 0.45, -5, 0.55, 0.55, 6, hm);
  const fin = world.box(heli, 0, 1.15, -7.6, 0.1, 2.4, 1.25, hm);
  const rotor = new B.TransformNode("Main rotor", scene);
  rotor.parent = heli;
  rotor.position.y = 1.8;
  for (const a of [0, Math.PI / 2]) {
    const blade = world.box(rotor, 0, 0, 0, 11, 0.055, 0.17, hm);
    blade.rotation.y = a;
  }
  for (const side of [-1, 1]) {
    world.box(heli, side * 1.25, -1.6, 0, 0.13, 0.13, 4.4, hm);
    world.box(heli, side * 1, -1.1, 1.2, 0.08, 1, 0.1, hm);
  }
  heli.setEnabled(false);
  let heliX = 0,
    heliZ = 0;
  function hazard() {
    const pos=world.ahead(vehicle.x,vehicle.z,vehicle.yaw,150);
    const vertical=Math.abs(Math.cos(pos.yaw))>.7;
    const root = new B.TransformNode("Roadblock", scene);
    root.position.set(pos.x, world.heightAt(pos.x,pos.z), pos.z);
    root.rotation.y = pos.yaw;
    const spike = pursuit.heat >= 4;
    for (const offset of [-9, 0]) {
      world.box(root, offset, 0.75, 0, 5.8, 1.5, 1.3, "#756e54");
      for (let i = 0; i < 4; i++) {
        const b = world.box(
          root,
          offset - 2 + i * 1.4,
          1.5,
          0,
          0.6,
          0.12,
          1.4,
          "#d1b363",
        );
        b.rotation.z = 0.3;
      }
    }
    if (spike) {
      world.box(root, 8, 0.09, 0, 8, 0.14, 0.4, "#232b2c");
      for (let i = 0; i < 16; i++) {
        const sp = B.MeshBuilder.CreateCylinder(
          "Spike",
          {
            diameterTop: 0,
            diameterBottom: 0.19,
            height: 0.3,
            tessellation: 4,
          },
          scene,
        );
        sp.parent = root;
        sp.position.set(4.3 + i * 0.47, 0.26, 0);
        sp.material = cars.material("#a5b4b1", 0.8, 0.3);
      }
    }
    hazards.push({ root, x: pos.x, z: pos.z, yaw:pos.yaw, vertical, spike, age: 0 });
    showToast(
      spike
        ? "Диспетчер: впереди заслон и шипы. Объезжай по обочине!"
        : "Впереди полицейский заслон — справа оставлен проезд.",
      4,
    );
    if (hazards.length > 4) hazards.shift().root.dispose();
  }
  function updatePolice(dt) {
    if (pursuit.phase === "none") {
      {
        pursuit.spawn += dt;
        if (!race && pursuit.spawn > 24 && police.length < 2) {
          pursuit.spawn = 0;
          spawnCop(0);
        }
        for (const p of police) {
          if(!p.patrolGoal||dist(p,p.patrolGoal)<25)p.patrolGoal=world.ahead(p.x,p.z,p.yaw,170);
          moveCop(p,p.patrolGoal,dt,false);
          if (
            !race && dist(p, vehicle) < 75 &&
            Math.abs(vehicle.speed) > 21 &&
            world.sight(p, vehicle)
          ) {
            startPursuit(1);
            break;
          }
        }
      }
      return;
    }
    const q = pursuit;
    q.time += dt;
    if (q.phase === "chase") {
      q.bounty += dt * (5 + q.heat * 3);
      q.heat = clamp(
        Math.max(
          q.heat,
          1 + Math.floor(q.time / 32) + Math.floor(q.bounty / 1800),
        ),
        1,
        6,
      );
    }
    q.spawn += dt;
    const desired = 2 + Math.floor(q.heat * 0.7);
    if (
      q.phase === "chase" &&
      q.spawn > 9 &&
      police.filter((p) => p.disabled <= 0).length < desired
    ) {
      q.spawn = 0;
      spawnCop(q.heat >= 5 ? 2 : q.heat >= 3 ? 1 : 0);
    }
    while (police.length > 9) {
      const i = police.findIndex((p) => p.disabled > 0);
      if (i < 0) break;
      police.splice(i, 1)[0].model.dispose();
    }
    let seen = false,
      close = 0;
    const target = q.phase === "chase" ? vehicle : q.last;
    for (const p of police) {
      if (p.disabled > 0) {
        p.disabled -= dt;
        p.vx*=Math.exp(-dt*3);p.vz*=Math.exp(-dt*3);moveRedlineVehicle(p,dt,world,p.model.catalog);groundCar(p.model,p.x,p.z,p.yaw);
        continue;
      }
      moveCop(p, target, dt, q.phase === "chase");
      const d = dist(p, vehicle);
      if (d < (q.phase === "chase" ? 165 : 115) && world.sight(p, vehicle))
        seen = true;
      if (d < 10) close++;
      p.model.lights.forEach((m, j) =>
        m.setEnabled((Math.floor(t * 8) + j) % 2 === 0),
      );
      p.ram = Math.max(0, p.ram - dt);
    }
    q.heliGap = Math.max(0, q.heliGap - dt);
    if (
      q.heat >= 5 &&
      q.heliFuel <= 0 &&
      q.heliGap <= 0 &&
      q.phase === "chase"
    ) {
      q.heliFuel = 23;
      heliX = vehicle.x - 180;
      heliZ = vehicle.z - 180;
      showToast("В воздухе вертолёт. Ищи укрытие под навесом.", 4);
    }
    if (q.heliFuel > 0) {
      q.heliFuel -= dt;
      heli.setEnabled(true);
      heliX = lerp(heliX, target.x, dt * 0.35);
      heliZ = lerp(heliZ, target.z, dt * 0.35);
      heli.position.set(heliX, world.heightAt(heliX,heliZ)+42 + Math.sin(t) * 2, heliZ);
      heli.rotation.y = Math.atan2(target.x - heliX, target.z - heliZ);
      rotor.rotation.y += dt * 35;
      const sheltered = world.hideouts.some((h) => dist(h, vehicle) < 11);
      if (Math.hypot(heliX - vehicle.x, heliZ - vehicle.z) < 190 && !sheltered)
        seen = true;
      if (q.heliFuel <= 0) {
        q.heliGap = 36;
        heli.setEnabled(false);
        showToast("Вертолёт уходит на дозаправку. Твой шанс.");
      }
    }
    if (seen) {
      q.last = { x: vehicle.x, z: vehicle.z };
      q.unseen = 0;
      if (q.phase !== "chase") {
        q.phase = "chase";
        q.cooldown = 0;
        showToast("Тебя заметили. Погоня возобновлена.");
      }
    } else q.unseen += dt;
    if (q.phase === "chase" && q.unseen > 6) {
      q.phase = "search";
      q.search = 11 + q.heat;
      showToast("Прямой контакт потерян. Уходи от последней точки.", 4);
    } else if (q.phase === "search" && !seen) {
      q.search -= dt;
      if (q.search <= 0) {
        q.phase = "cooldown";
        q.cooldown = 10 + q.heat * 2;
        showToast("Охлаждение. Зелёные укрытия ускоряют ожидание.");
      }
    } else if (q.phase === "cooldown" && !seen) {
      const hidden =
        world.hideouts.some((h) => dist(h, vehicle) < 13) &&
        Math.abs(vehicle.speed) < 3;
      q.cooldown -= dt * (hidden ? 2.8 : 1);
      if (q.cooldown <= 0) {
        escapePursuit();
        return;
      }
    }
    q.bust = clamp(
      q.bust +
        (close > 0 && Math.abs(vehicle.speed) < 3.5
          ? dt * (10 + close * 6)
          : -dt * 19),
      0,
      100,
    );
    if (q.bust >= 100) {
      busted();
      return;
    }
    q.hazardTimer += dt;
    if (q.phase === "chase" && q.heat >= 3 && q.hazardTimer > 21) {
      q.hazardTimer = 0;
      hazard();
    }
    for (const h of hazards) {
      h.age += dt;
      const dx = vehicle.x - h.x,
        dz = vehicle.z - h.z,
        side = dx*Math.cos(h.yaw)-dz*Math.sin(h.yaw),
        forward = dx*Math.sin(h.yaw)+dz*Math.cos(h.yaw);
      if (Math.abs(forward) < 2.3) {
        if (h.spike && side > 3.7 && side < 12.5 && !vehicle.tyres) {
          vehicle.tyres = 1;
          vehicle.health = Math.max(5, vehicle.health - 12);
          showToast(
            "Прокол! Снизилась скорость и устойчивость. Нужен сервис.",
            5,
          );
        }
      }
    }
  }
  function moveCop(p,target,dt,chase){
    p.priority=chase?-2:p.id;p.cruise=(chase?Math.min(43,23+pursuit.heat*3):13)*(p.type===1?.87:1);
    const canSee=dist(p,target)<165&&world.sight(p,target),known=chase&&!canSee?pursuit.last:target;
    let destination=known;
    if(!chase&&pursuit.phase!=='none')destination=world.ahead(known.x,known.z,p.id*2.4,25+(p.id%3)*16);
    if(chase&&canSee){
      const lead=p.role==='intercept'?clamp(Math.abs(vehicle.speed)*1.1+15,18,65):p.role==='flank'?9:0;
      destination=world.ahead(known.x,known.z,vehicle.yaw,lead);
      if(p.role==='flank'){const side=p.id%2?1:-1;destination={...destination,x:destination.x+Math.cos(destination.yaw)*side*3.4,z:destination.z-Math.sin(destination.yaw)*side*3.4};}
      if(dist(p,vehicle)<18)p.cruise=Math.min(p.cruise,Math.abs(vehicle.speed)+5);
    }
    let goal=world.steerTo(p,destination,clamp(9+Math.abs(p.speed)*.55,10,28));
    if(dist(p,destination)<24&&drivers.roadCorridor(p,destination))goal=destination;
    if(chase&&canSee&&p.role!=='pursue'){
      const forward=Math.atan2(goal.x-p.x,goal.z-p.z),off=p.role==='flank'?3.2:-3.2;
      const candidate={...goal,x:goal.x+Math.cos(forward)*off,z:goal.z-Math.sin(forward)*off};
      if(drivers.roadCorridor(p,candidate))goal=candidate;
    }
    if(!chase&&dist(p,destination)<10){goal=world.ahead(p.x,p.z,p.yaw,30)}
    p.target=goal;drivers.step(p,dt,driverActors(),goal);groundCar(p.model,p.x,p.z,p.yaw);p.model.animate(p.speed,p.steer,dt,p.yawRate*p.speed);
  }
  function escapePursuit() {
    const reward = Math.floor(pursuit.bounty),
      cash = Math.max(500, Math.round(reward * 0.35));
    state.bounty += reward;
    state.escapes++;
    state.cash += cash;
    Object.assign(pursuit, { phase: "none", heat: 0, bust: 0, spawn: 0 });
    clearPolice();
    save();
    showToast(
      "УШЁЛ ОТ ПОГОНИ · +" + money(reward) + " BP · +₵ " + money(cash),
      7,
    );
  }
  function busted() {
    const fine = Math.min(state.cash, 750 * pursuit.heat);
    state.cash -= fine;
    if (race) {
      if(race.stake)state.stake=null; // An arrest never confiscates an owned car.
      disposeRacers();
      race = null;
      gateRoot.setEnabled(false);
    }
    Object.assign(pursuit, { phase: "none", heat: 0, bust: 0, spawn: 0 });
    clearPolice();
    Object.assign(vehicle, {
      x: -480,
      z: -423,
      yaw: 0,
      vx: 0,
      vz: 0,
      speed: 0,
      health: 100,
      tyres: 0,
      yawRate: 0,
      steer: 0,
      nitro: 100,
      slow: 100,
    });
    updatePlayerMesh();
    snapCamera();
    result(
      "АРЕСТ/",
      "Заезд окончен. BP этой погони потеряны. Машина возвращена после штрафа.",
      [
        ["Штраф", "− ₵ " + money(fine)],
        ["Сохранённый рейтинг", money(state.bounty) + " BP"],
      ],
      "ПОЛИЦЕЙСКИЙ ПРОТОКОЛ",
    );
  }
  function updateBreakers(dt) {
    for (const b of world.breakers) {
      if (b.used) {
        b.fall = Math.min(1, b.fall + dt * 1.4);
        b.pivot.rotation.z = b.fall * 1.42;
        b.ready -= dt;
        if (b.ready <= 0 && pursuit.phase === "none") {
          b.used = false;
          b.fall = 0;
          b.pivot.rotation.z = 0;
          b.ring.setEnabled(true);
        }
      } else if (dist(vehicle, b) < 6 && Math.abs(vehicle.speed) > 12.5) {
        b.used = true;
        b.ready = 90;
        b.ring.setEnabled(false);
        let stopped = 0;
        for (const p of police)
          if (dist(p, b) < 95) {
            p.disabled = 18;
            p.speed = 0;
            stopped++;
          }
        if (pursuit.phase !== "none") pursuit.bounty += 150 + stopped * 180;
        showToast("Конструкция обрушена · патрулей остановлено: " + stopped, 4);
        soundImpact();
      }
    }
  }
  function recover() {
    if(mode!=='drive'||story?.active)return false;
    const clear=p=>world.barrierClear(p.x,p.z,2.5)&&!world.solids.some(o=>world.contact(o,p.x,p.z,3))&&![...traffic,...police,...(race?.racers||[])].some(a=>{const v=a.model?.root.position;return v&&Math.hypot(v.x-p.x,v.z-p.z)<10});
    const n=world.nearestRoad(Number.isFinite(vehicle.x)?vehicle.x:-480,Number.isFinite(vehicle.z)?vehicle.z:-423);
    const candidates=[];
    if(race){const prev=race.cp?race.checkpoints[race.cp-1].s:0,next=race.checkpoints[race.cp]?.s||race.lengths.total;for(const delta of [12,25,0,-12,-28,-45,-70]){const s=clamp(prev+delta,0,Math.max(0,next-25)),p=routeAt(race.route.points,race.lengths,s,race.route.closed);for(const lane of [0,4,-4,7,-7])candidates.push({...p,x:p.x+Math.cos(p.yaw)*lane,z:p.z-Math.sin(p.yaw)*lane})}}
    else for(const delta of [0,15,-15,30,-30,50,-50,80,-80,120,-120]){const p=world.network.at(n.roadId,n.s+delta);p.yaw+=Math.cos(vehicle.yaw-p.yaw)<0?Math.PI:0;for(const lane of [0,4,-4])candidates.push({...p,x:p.x+Math.cos(p.yaw)*lane,z:p.z-Math.sin(p.yaw)*lane})}
    const p=candidates.find(clear);if(!p){showToast('Рядом плотный трафик. Подожди и повтори эвакуацию.');return false}
    resetInput();Object.assign(cameraInput,{yaw:0,pitch:0,drag:null});Object.assign(vehicle,{x:p.x,z:p.z,yaw:p.yaw,y:p.y||0,vx:0,vz:0,speed:0,steer:0,yawRate:0,hit:2});
    if(race)race.penalty+=5;
    updatePlayerMesh();snapCamera();save();showToast(race?'На трассе перед следующими воротами · +5 секунд':'Машина на свободном участке дороги. Скорость и руль сброшены.');return true;
  }
  function driving(dt) {
    const c = player.catalog,
      cfg = story?.active
        ? { engine: 0, transmission: 0, suspension: 0 }
        : config(state.selected),
      gamepad = navigator.getGamepads?.()?.[0];
    let ix =
        input.x +
        (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) -
        (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0),
      iy =
        input.y +
        (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) -
        (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0),
      nitro = input.nitro || keys.has("ShiftLeft") || keys.has("ShiftRight"),
      brake = input.brake || keys.has("Space");
    if (gamepad) {
      ix += Math.abs(gamepad.axes[0]) > 0.12 ? gamepad.axes[0] : 0;
      iy += (gamepad.buttons[7]?.value || 0) - (gamepad.buttons[6]?.value || 0);
      nitro ||= gamepad.buttons[0]?.pressed;
      brake ||= gamepad.buttons[1]?.pressed;
    }
    ix = clamp(ix, -1, 1);
    iy = clamp(iy, -1, 1);
    const {boost,side,tireTurn}=stepRedlineHandling(vehicle,{x:ix,y:iy,nitro,brake},c,cfg,dt,world.onRoad(vehicle.x,vehicle.z),!!story?.limp);
    const abs=Math.abs(vehicle.speed);
    const old = { x: vehicle.x, z: vehicle.z };
    const collisionImpact=moveRedlineVehicle(vehicle,dt,world,c);
    if(collisionImpact>2&&vehicle.hit<=0){vehicle.health=Math.max(5,vehicle.health-collisionImpact*.25);vehicle.hit=.65;soundImpact()}
    vehicle.speed =
      vehicle.vx * Math.sin(vehicle.yaw) + vehicle.vz * Math.cos(vehicle.yaw);
    vehicle.hit = Math.max(0, vehicle.hit - dt);
    const meters = dist(old, vehicle);
    state.totalDistance += meters;
    vehicle.odometer += meters;
    flames.forEach((m) => {
      m.setEnabled(boost);
      m.scaling.z = 0.48 + Math.sin(t * 53) * 0.12;
    });
    skid(dt, (brake && abs > 4) || Math.abs(side) > 2.7);
    player.animate(vehicle.speed, vehicle.steer, dt, tireTurn * vehicle.speed);
    updatePlayerMesh();
    if (race) updateRace(dt, old);
    return { boost, throttle: iy, side };
  }
  function groundCar(model,x,z,yaw){
    const root=model.root,half=model.catalog.wb/2,wide=model.catalog.W*.38,fx=Math.sin(yaw)*half,fz=Math.cos(yaw)*half,nx=Math.cos(yaw)*wide,nz=-Math.sin(yaw)*wide,y=world.heightAt(x,z);
    root.position.set(x,y+.015,z);root.rotation.set(-Math.atan2(world.heightAt(x+fx,z+fz)-world.heightAt(x-fx,z-fz),half*2),yaw,Math.atan2(world.heightAt(x+nx,z+nz)-world.heightAt(x-nx,z-nz),wide*2));return y;
  }
  function updatePlayerMesh() {
    player.root.position.set(
      vehicle.x,
      world.heightAt(vehicle.x,vehicle.z) + 0.015 +
        Math.sin(t * 18) * Math.min(Math.abs(vehicle.speed) * 0.0003, 0.012),
      vehicle.z,
    );
    vehicle.y=world.heightAt(vehicle.x,vehicle.z);
    player.root.rotation.y = vehicle.yaw;
    const half=player.catalog.wb/2,fx=Math.sin(vehicle.yaw)*half,fz=Math.cos(vehicle.yaw)*half;
    player.root.rotation.x=-Math.atan2(world.heightAt(vehicle.x+fx,vehicle.z+fz)-world.heightAt(vehicle.x-fx,vehicle.z-fz),half*2);
    const nx=Math.cos(vehicle.yaw)*player.catalog.W*.38,nz=-Math.sin(vehicle.yaw)*player.catalog.W*.38;
    player.root.rotation.z=Math.atan2(world.heightAt(vehicle.x+nx,vehicle.z+nz)-world.heightAt(vehicle.x-nx,vehicle.z-nz),player.catalog.W*.76);
  }
  function cameraPosition() {
    const direction = vehicle.yaw + cameraInput.yaw,
      d = cameraMode === 1 ? 5 : cameraMode === 2 ? 12 : 8.5,
      h = cameraMode === 1 ? 2.15 : cameraMode === 2 ? 6.5 : 3.8;
    return new B.Vector3(
      vehicle.x - Math.sin(direction) * d,
      world.heightAt(vehicle.x,vehicle.z)+Math.max(1.1, h + cameraInput.pitch),
      vehicle.z - Math.cos(direction) * d,
    );
  }
  function snapCamera() {
    cam.position.copyFrom(cameraPosition());
    cam.setTarget(new B.Vector3(vehicle.x, world.heightAt(vehicle.x,vehicle.z)+1, vehicle.z));
    updateCityLighting(1);
  }
  function updateCamera(dt) {
    if (!cameraInput.drag && t - cameraInput.last > 2.5) {
      cameraInput.yaw *= Math.exp(-dt * 1.7);
      cameraInput.pitch *= Math.exp(-dt * 0.7);
    }
    let desired = cameraPosition(),
      target = new B.Vector3(
        vehicle.x + Math.sin(vehicle.yaw) * 2,
        world.heightAt(vehicle.x,vehicle.z)+1.0,
        vehicle.z + Math.cos(vehicle.yaw) * 2,
      );
    for (const s of world.solids)
      if (
        Math.abs(desired.x - s.x) < s.w + 0.4 &&
        Math.abs(desired.z - s.z) < s.d + 0.4
      ) {
        desired = B.Vector3.Lerp(target, desired, 0.35);
        desired.y = world.heightAt(vehicle.x,vehicle.z)+3.8;
        break;
      }
    desired.y=Math.max(desired.y,world.heightAt(desired.x,desired.z)+1.1);
    cam.position = B.Vector3.Lerp(cam.position, desired, 1 - Math.exp(-dt * 8));
    cam.setTarget(target);
    cam.fov = lerp(
      cam.fov,
      0.82 + clamp(Math.abs(vehicle.speed) / 80, 0, 1) * 0.1,
      0.05,
    );
  }
  function drawMap() {
    const ctx = $("map").getContext("2d"),
      W = 366,
      H = 360,
      S = 0.2;
    ctx.clearRect(0, 0, W, H);
    const tx = (x) => W / 2 + (x - vehicle.x) * S,
      tz = (z) => H / 2 - (z - vehicle.z) * S;
    ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle='#66766e';
    for(const road of world.roadLines){ctx.beginPath();ctx.lineWidth=road.width*S;road.points.forEach((p,i)=>i?ctx.lineTo(tx(p.x),tz(p.z)):ctx.moveTo(tx(p.x),tz(p.z)));ctx.stroke()}
    for(const p of world.locations){ctx.fillStyle=state.roam.found[p.id]?'#83b5ab':'#d6b778';ctx.fillRect(tx(p.x)-3,tz(p.z)-3,6,6)}
    if(roam.destination){const p=roam.destination;ctx.strokeStyle='#f5c95c';ctx.lineWidth=2;ctx.beginPath();ctx.arc(tx(p.x),tz(p.z),9,0,Math.PI*2);ctx.stroke()}
    ctx.strokeStyle = "#869084";
    ctx.lineWidth = 0.6;
    ctx.strokeRect(
      tx(world.limits.minX),
      tz(world.limits.maxZ),
      (world.limits.maxX-world.limits.minX) * S,
      (world.limits.maxZ-world.limits.minZ) * S,
    );
    if (story?.target) {
      ctx.fillStyle = "#e4bc59";
      ctx.beginPath();
      ctx.arc(tx(story.target.x), tz(story.target.z), 7, 0, Math.PI * 2);
      ctx.fill();
    }
    if (race) {
      ctx.beginPath();
      ctx.strokeStyle = "#d1e983";
      ctx.lineWidth = 2.4;
      race.route.points.forEach((p, i) =>
        i ? ctx.lineTo(tx(p.x), tz(p.z)) : ctx.moveTo(tx(p.x), tz(p.z)),
      );
      if (race.route.closed) ctx.closePath();
      ctx.stroke();
      const cp = race.checkpoints[race.cp];
      if (cp) {
        ctx.fillStyle = "#e5f2b2";
        ctx.beginPath();
        ctx.arc(tx(cp.x), tz(cp.z), 7, 0, Math.PI * 2);
        ctx.fill();
      }
      for (const a of race.racers) {
        ctx.fillStyle = "#deb576";
        ctx.fillRect(
          tx(a.model.root.position.x) - 3,
          tz(a.model.root.position.z) - 3,
          6,
          6,
        );
      }
    }
    for (const p of police) {
      ctx.fillStyle =
        p.disabled > 0
          ? "#8b8580"
          : pursuit.phase === "none"
            ? "#9bb8ce"
            : "#ed8069";
      ctx.beginPath();
      ctx.arc(tx(p.x), tz(p.z), 4, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const h of world.hideouts) {
      ctx.strokeStyle = "#81b39b";
      ctx.lineWidth = 2;
      ctx.strokeRect(tx(h.x) - 4, tz(h.z) - 4, 8, 8);
    }
    for (const b of world.breakers) {
      if (b.used) continue;
      ctx.fillStyle = "#d1ab60";
      ctx.fillRect(tx(b.x) - 3, tz(b.z) - 3, 6, 6);
    }
    for (const h of hazards) {
      ctx.fillStyle = "#f37561";
      ctx.fillRect(tx(h.x) - 6, tz(h.z) - 2, 12, 4);
    }
    ctx.fillStyle = "#c3dd82";
    ctx.font = "bold 13px Arial";
    ctx.fillText("G", tx(world.garage.x) - 5, tz(world.garage.z) + 5);
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(vehicle.yaw);
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(6, 7);
    ctx.lineTo(0, 4);
    ctx.lineTo(-6, 7);
    ctx.closePath();
    ctx.fillStyle = "#e7f9bd";
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = "#94a495";
    ctx.font = "11px Arial";
    ctx.fillText("N ↑", 10, 18);
  }
  function hud() {
    const speed = Math.round(Math.abs(vehicle.speed) * 3.6);
    $("speed").textContent = speed;
    $("gear").textContent =
      vehicle.speed < -1
        ? "R"
        : speed < 3
          ? "N"
          : String(clamp(1 + Math.floor(speed / 47), 1, 6));
    $("nitroBar").style.width = vehicle.nitro + "%";
    $("nitroText").textContent = Math.round(vehicle.nitro) + "%";
    $("slowBar").style.width = vehicle.slow + "%";
    $("healthBar").style.width = vehicle.health + "%";
    $("tyresText").textContent = vehicle.tyres
      ? "ПРОКОЛ"
      : Math.round(vehicle.health) + "%";
    $("money").textContent = "₵ " + money(state.cash);
    $("district").textContent = world.district(vehicle.x,vehicle.z);
    $("policeHUD").hidden = pursuit.phase === "none";
    if (pursuit.phase !== "none") {
      $("heat").textContent =
        "◆".repeat(pursuit.heat) + "◇".repeat(6 - pursuit.heat);
      $("policeStatus").textContent =
        pursuit.phase === "chase"
          ? "ПОГОНЯ · " +
            police.filter((p) => p.disabled <= 0).length +
            " ПАТРУЛЕЙ"
          : pursuit.phase === "search"
            ? "ИЩУТ У ПОСЛЕДНЕЙ ТОЧКИ"
            : "ОХЛАЖДЕНИЕ / " + Math.ceil(pursuit.cooldown) + " С";
      $("pBounty").textContent = money(Math.floor(pursuit.bounty)) + " BP";
      $("pMeterLabel").textContent =
        pursuit.phase === "chase"
          ? "АРЕСТ"
          : pursuit.phase === "search"
            ? "ПОИСК"
            : "ДО СВОБОДЫ";
      $("bustBar").style.width =
        (pursuit.phase === "chase"
          ? pursuit.bust
          : pursuit.phase === "search"
            ? (pursuit.search / (11 + pursuit.heat)) * 100
            : (pursuit.cooldown / (10 + pursuit.heat * 2)) * 100) + "%";
    }
    if (race) {
      $("missionLabel").textContent = race.story
        ? "ПРОЛОГ / ДУЭЛЬ С ВОССОМ"
        : race.boss === null
          ? race.route.ru.toUpperCase()
          : "ДУЭЛЬ / " + bossNames[race.boss];
      $("missionTitle").textContent =
        clamp(race.place, 1, race.racers.length + 1) +
        " / " +
        (race.racers.length + 1) +
        "  ·  " +
        formatTime(race.time + race.penalty);
      $("missionSub").textContent =
        "Ворота " +
        (race.cp + 1) +
        " / " +
        race.checkpoints.length +
        " · " +
        Math.round(dist(vehicle, race.checkpoints[race.cp])) +
        " м";
    } else {
      $("missionLabel").textContent = "NORTHPORT / СВОБОДНЫЙ РЕЖИМ";
      $("missionTitle").textContent = player.catalog.name;
      $("missionSub").textContent =
        pursuit.phase === "none"
          ? "Меню → Заезды / 15 соперников"
          : "Скройся за зданиями, затем пережди поиск";
    }
    if (!race && pursuit.phase === "none" && story?.active) {
      $("missionLabel").textContent = "ПРОЛОГ / ПЕРВАЯ ПОЕЗДКА";
      $("missionSub").textContent = "Езжай к золотым воротам";
    } else if (
      !race &&
      pursuit.phase === "none" &&
      state.prologue?.done &&
      state.boss === 0
    ) {
      $("missionLabel").textContent = "ГЛАВА 01 / ЧИСТЫЙ ЛИСТ";
      $("missionSub").textContent =
        state.wins === 0
          ? "Первая цель: меню → Заезды"
          : "Цель: 150 BP и уход от полиции → Moth";
    }
    if(!race&&!story?.active&&pursuit.phase==='none'){
      if(roam.destination){$("missionLabel").textContent='ГОРОД / ЦЕЛЬ';$("missionTitle").textContent=roam.destination.name;$("missionSub").textContent=Math.round(dist(vehicle,roam.destination))+' м по прямой · жёлтая метка';}
      else $("missionSub").textContent='Меню → Город / радары · Заезды';
    }
    $("near").hidden =
      !!story?.active ||
      race !== null ||
      pursuit.phase !== "none" ||
      dist(vehicle, world.garage) > 33 ||
      mode !== "drive";
    drawMap();
  }
  let audio = null;
  function audioInit() {
    if (audio) return;
    try {
      const C = window.AudioContext || window.webkitAudioContext,
        a = new C(),
        master = a.createGain(),
        osc = a.createOscillator(),
        sub = a.createOscillator(),
        filter = a.createBiquadFilter(),
        gain = a.createGain(),
        siren = a.createOscillator(),
        sg = a.createGain();
      master.gain.value = state.sound ? 0.1 : 0;
      master.connect(a.destination);
      osc.type = "sawtooth";
      sub.type = "triangle";
      osc.connect(filter);
      sub.connect(filter);
      filter.type = "lowpass";
      filter.frequency.value = 700;
      filter.connect(gain);
      gain.gain.value = 0.22;
      gain.connect(master);
      siren.type = "sine";
      siren.connect(sg);
      sg.gain.value = 0;
      sg.connect(master);
      osc.start();
      sub.start();
      siren.start();
      audio = { a, master, osc, sub, filter, gain, siren, sg };
    } catch {}
  }
  function audioUpdate(throttle = 0) {
    if (!audio) return;
    const now = audio.a.currentTime,
      active = mode === "drive";
    audio.master.gain.setTargetAtTime(
      state.sound && active ? 0.12 : 0,
      now,
      0.12,
    );
    const km = Math.abs(vehicle.speed) * 3.6,
      gear = Math.max(1, Math.ceil(km / 48)),
      rpm = 1200 + (km / gear) * 92 + Math.max(0, throttle) * 500;
    audio.osc.frequency.setTargetAtTime(rpm / 24, now, 0.08);
    audio.sub.frequency.setTargetAtTime(rpm / 48, now, 0.08);
    audio.filter.frequency.setTargetAtTime(
      400 + Math.max(0, throttle) * 1200,
      now,
      0.1,
    );
    audio.gain.gain.setTargetAtTime(
      0.15 + Math.abs(throttle) * 0.12,
      now,
      0.08,
    );
    audio.siren.frequency.setTargetAtTime(
      620 + Math.sin(t * 4) * 150,
      now,
      0.05,
    );
    audio.sg.gain.setTargetAtTime(
      pursuit.phase === "chase" ? 0.11 : 0,
      now,
      0.15,
    );
  }
  function soundImpact() {
    if (!audio || !state.sound) return;
    const a = audio.a,
      o = a.createOscillator(),
      g = a.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(90, a.currentTime);
    o.frequency.exponentialRampToValueAtTime(26, a.currentTime + 0.18);
    g.gain.setValueAtTime(0.6, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 0.25);
    o.connect(g);
    g.connect(audio.master);
    o.start();
    o.stop(a.currentTime + 0.26);
  }
  function syncSound() {
    $("soundBtn").textContent = state.sound ? "♪ вкл" : "♪ выкл";
    $("soundBtn").title = state.sound ? "Выключить звук" : "Включить звук";
    $("soundBtn").setAttribute("aria-label", $("soundBtn").title);
  }
  $("soundBtn").onclick = () => {
    state.sound = !state.sound;
    audioInit();
    audio?.a.resume();
    syncSound();
    save();
  };
  $("menuBtn").onclick = () => showSheet("menu");
  $("startBtn").onclick = () => {
    audioInit();
    audio?.a.resume();
    startCareer();
  };
  $("introGarage").onclick = enterGarage;
  $("near").onclick = enterGarage;
  $("garageBtn").onclick = enterGarage;
  $("resumeBtn").onclick = closeSheet;
  $("eventsBtn").onclick = eventMenu;
  $('stakeAccept').onclick=()=>{if(pendingStake){const bet=pendingStake;pendingStake=null;startRace(3,null,bet)}};
  const exchange=createRedlineExchange({state,account,save,toast:showToast,showSheet,canExchange:()=>!race&&!story?.active&&pursuit.phase==='none'});

  $("cityBtn").onclick = roam.menu;
  $("blacklistBtn").onclick = blacklistMenu;
  $("challengeBtn").onclick = () => {
    if (pursuit.phase !== "none" || race) return;
    enterDrive();
    startPursuit(1);
  };
  $("helpBtn").onclick = () => showSheet("help");
  $("recoverBtn").onclick = () => {
    closeSheet();
    recover();
  };
  $("abandonBtn").onclick = abandonRace;
  $("resultClose").onclick = () => {
    hidePanels();
    enterDrive();
  };
  document
    .querySelectorAll("[data-close]")
    .forEach((b) => (b.onclick = closeSheet));
  $("homeBtn").onclick = () => {
    if(race?.stake){if(!confirm('Выход означает проигрыш машины ставки. Выйти?'))return;redlineSettleStake(state,false);disposeRacers();race=null;gateRoot.setEnabled(false);$('countdown').hidden=true;replacePlayer()}
    story?.leave();
    save();
    if (parent !== window)
      parent.postMessage(
        { type: "home" },
        location.origin === "null" ? "*" : location.origin,
      );
    else {
      hidePanels();
      refreshStart();
      previewCar(9);
      viewMode("intro");
      returnMode = "intro";
    }
  };
  document.addEventListener("keydown", (e) => {
    if (
      [
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "Space",
        "Tab",
      ].includes(e.code) &&
      e.code !== "Tab"
    )
      e.preventDefault();
    if (e.repeat) {
      if (mode === "drive") keys.add(e.code);
      return;
    }
    if (e.code === "Escape") {
      if (
        mode === "drive" ||
        mode === "intro" ||
        mode === "garage" ||
        mode === "cinematic"
      )
        showSheet("menu");
      else if (mode === "pause") closeSheet();
      return;
    }
    if (e.code === "Enter" && mode === "cinematic") {
      story?.next();
      return;
    }
    if (mode === "intro" && e.code === "Enter") {
      startCareer();
      return;
    }
    if (mode !== "drive") return;
    if (e.code === "KeyG") {
      enterGarage();
      return;
    }
    if (e.code === "KeyR") {
      recover();
      return;
    }
    if (e.code === "KeyC") {
      cameraMode = (cameraMode + 1) % 3;
      cameraInput.yaw = cameraInput.pitch = 0;
      return;
    }
    keys.add(e.code);
    audioInit();
  });
  document.addEventListener("keyup", (e) => keys.delete(e.code));
  let stickId = null;
  const stick = $("stick");
  function stickMove(e) {
    const r = stick.getBoundingClientRect(),
      max = r.width * 0.34,
      dx = e.clientX - r.left - r.width / 2,
      dy = e.clientY - r.top - r.height / 2,
      len = Math.hypot(dx, dy),
      scale = len > max ? max / len : 1;
    input.x = clamp(dx/max,-1,1);
    input.y = clamp(-dy/max*1.35,-1,1);
    if (Math.abs(input.x) < 0.08) input.x = 0;
    if (Math.abs(input.y) < 0.08) input.y = 0;
    stick.firstElementChild.style.transform = `translate(${dx * scale}px,${dy * scale}px)`;
  }
  stick.onpointerdown = (e) => {
    if (mode !== "drive" || stickId !== null) return;
    e.preventDefault();
    stickId = e.pointerId;
    stick.setPointerCapture(e.pointerId);
    stickMove(e);
    audioInit();
    audio?.a.resume();
  };
  stick.onpointermove = (e) => {
    if (e.pointerId === stickId) {
      e.preventDefault();
      stickMove(e);
    }
  };
  const stopStick = (e) => {
    if (e.pointerId === stickId) {
      stickId = null;
      input.x = input.y = 0;
      stick.firstElementChild.style.transform = "";
    }
  };
  stick.onpointerup = stopStick;
  stick.onpointercancel = stopStick;
  stick.onlostpointercapture = stopStick;
  for (const [id, key] of [
    ["nitroBtn", "nitro"],
    ["brakeBtn", "brake"],
    ["slowBtn", "slow"],
  ]) {
    const b = $(id);
    let pid = null;
    b.onpointerdown = (e) => {
      if (mode !== "drive") return;
      e.preventDefault();
      pid = e.pointerId;
      b.setPointerCapture(pid);
      input[key] = true;
      b.classList.add("held");
    };
    const end = (e) => {
      if (e.pointerId !== pid) return;
      input[key] = false;
      pid = null;
      b.classList.remove("held");
    };
    b.onpointerup = end;
    b.onpointercancel = end;
    b.onlostpointercapture = end;
  }
  const pointers = new Map();
  let pinch = 0;
  canvas.onpointerdown = (e) => {
    if (!["drive", "intro", "garage"].includes(mode)) return;
    if (e.button !== 0 && e.pointerType === "mouse") return;
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    cameraInput.drag = e.pointerId;
    cameraInput.last = t;
    pinch = 0;
  };
  canvas.onpointermove = (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const dx = e.clientX - prev.x,
      dy = e.clientY - prev.y;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (mode === "drive") {
      cameraInput.yaw -= dx * 0.006;
      cameraInput.pitch = clamp(cameraInput.pitch + dy * 0.022, -2.1, 5);
      cameraInput.last = t;
    } else {
      if (pointers.size > 1) {
        const [a, b] = [...pointers.values()],
          d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) showCam.radius = clamp((showCam.radius * pinch) / d, 5, 13);
        pinch = d;
      } else {
        showCam.alpha -= dx * 0.008;
        showCam.beta = clamp(showCam.beta - dy * 0.006, 0.35, 1.53);
      }
      orbitIdle = 0;
    }
  };
  function releaseCamera(e) {
    pointers.delete(e.pointerId);
    cameraInput.drag = pointers.size ? [...pointers.keys()][0] : null;
    pinch = 0;
  }
  canvas.onpointerup = releaseCamera;
  canvas.onpointercancel = releaseCamera;
  canvas.onlostpointercapture = releaseCamera;
  canvas.addEventListener(
    "wheel",
    (e) => {
      if (mode === "intro" || mode === "garage") {
        e.preventDefault();
        showCam.radius = clamp(showCam.radius + e.deltaY * 0.009, 5, 13);
        orbitIdle = 0;
      }
    },
    { passive: false },
  );
  canvas.oncontextmenu = (e) => e.preventDefault();
  function pauseOnHidden() {
    resetInput();
    pointers.clear();
    cameraInput.drag = null;
    if (mode === "drive" || mode === "cinematic") {
      returnMode = mode;
      showSheet("menu");
    }
    save();
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pauseOnHidden();
  });
  window.addEventListener("blur", pauseOnHidden);
  window.addEventListener("pagehide",()=>{save();engine.stopRenderLoop();showroom.dispose();scene.dispose();engine.dispose();});
  window.addEventListener("pageshow",e=>{if(e.persisted)location.reload()});
  function resize() {
    engine.resize();
    const narrow = innerWidth < 761 && innerHeight > 530;
    if (
      mode === "intro" ||
      mode === "garage" ||
      (mode === "pause" && (returnMode === "intro" || returnMode === "garage"))
    ) {
      showCam.viewport = narrow
        ? new B.Viewport(0, 0.43, 1, 0.56)
        : new B.Viewport(0, 0, 1, 1);
      showCam.target.set(narrow ? 0 : 0.96, 0.65, narrow ? 0 : -0.56);
      showCam.fov = narrow ? 0.84 : 0.64;
    } else showCam.viewport = new B.Viewport(0, 0, 1);
  }
  window.addEventListener("resize", resize);
  function updateCityLighting(dt) {
    shadowTime += dt;
    if (shadowTime > 0.7) {
      shadowTime = 0;
      for (const m of staticMeshes) {
        if (m.isDisposed()) continue;
        const b = m.getBoundingInfo().boundingSphere,
          range = 420 + b.radiusWorld;
        m.setEnabled(
          B.Vector3.DistanceSquared(b.centerWorld, player.root.position) <
            range * range,
        );
      }
      sun.position.set(vehicle.x - 50, (vehicle.y||0)+100, vehicle.z - 40);
      shadow.getShadowMap().renderList = scene.meshes.filter(
        (m) =>
          m !== ribbon &&
          m !== cross && m !== sky &&
          (!staticMeshSet.has(m)||staticCasters.has(m)) &&
          m.isEnabled() &&
          m.getTotalVertices() > 0 &&
          m
            .getBoundingInfo()
            .boundingBox.centerWorld.subtract(player.root.position)
            .length() < 125,
      );
    }
  }
  function update(dt){const time=clamp(dt,0,.1),n=Math.max(1,Math.ceil(time*60));for(let i=0;i<n;i++)updateFrame(time/n);}
  function updateFrame(dt) {
    dt = clamp(dt, 0, 0.05);
    t += dt;
    if (toastTime > 0) {
      toastTime -= dt;
      if (toastTime <= 0) $("toast").hidden = true;
    }
    let throttle = 0;
    if (mode === "drive") {
      const gp = navigator.getGamepads?.()?.[0],
        wantsSlow = input.slow || keys.has("KeyE") || gp?.buttons[2]?.pressed;
      slowActive = !!wantsSlow && vehicle.slow > 0;
      vehicle.slow = clamp(vehicle.slow + dt * (slowActive ? -23 : 6), 0, 100);
      const scaled = dt * (slowActive ? 0.38 : 1);
      world.dynamicSolids=hazards.flatMap(h=>[-9,0].map(off=>({x:h.x+Math.cos(h.yaw)*off,z:h.z-Math.sin(h.yaw)*off,hw:2.9,hd:.65,yaw:h.yaw})));
      if (race && race.countdown > 0) {
        updateRace(scaled, { x: vehicle.x, z: vehicle.z });
      } else throttle = driving(scaled).throttle;
      roam.update();
      updateTraffic(scaled,false);
      if (!story?.active) updatePolice(scaled);
      resolveCarContacts();
      updateBreakers(scaled);
      updateCamera(dt);
      updateCityLighting(dt);
      saveTime += dt;
      if (saveTime > 6) {
        saveTime = 0;
        save();
      }
    } else {
      slowActive = false;
      if (mode === "cinematic") updateCityLighting(dt);
      orbitIdle += dt;
      if (
        (mode === "intro" || mode === "garage") &&
        orbitIdle > 3 &&
        !cameraInput.drag
      )
        showCam.alpha += dt * 0.075;
    }
    story?.update(dt);
    uiTime += dt;
    if (uiTime > 0.1) {
      uiTime = 0;
      hud();
    }
    audioUpdate(throttle);
  }
  function render() {
    if (
      mode === "intro" ||
      mode === "garage" ||
      (mode === "pause" && (returnMode === "intro" || returnMode === "garage"))
    )
      showroom.render();
    else scene.render();
  }

  function cancelStoryRace() {
    disposeRacers();
    race = null;
    gateRoot.setEnabled(false);
    $("countdown").hidden = true;
  }
  function setStoryCar(id) {
    player.dispose();
    player = cars.make(id, { color: cars.catalog[id].color });
    addFlames();
    updatePlayerMesh();
  }
  function refreshStart() {
    $("startBtn").textContent = state.prologue?.done
      ? "ПРОДОЛЖИТЬ ↗"
      : state.prologue?.stage !== "opening"
        ? "ПРОДОЛЖИТЬ ПРОЛОГ ↗"
        : "НАЧАТЬ ИСТОРИЮ ↗";
  }
  function startCareer() {
    if (state.prologue?.done) enterDrive();
    else story.start();
  }
  story = createRedlineStory({
    B,
    scene,
    cars,
    world,
    vehicle,
    state,
    cam,
    isTouch: touch,
    save,
    getMode: () => mode,
    setMode: (m) => {
      hidePanels();
      viewMode(m);
      returnMode = m;
      shadowTime = 1;
    },
    getPlayer: () => player,
    getRace: () => race,
    setStoryCar,
    restoreCar: replacePlayer,
    syncCar: updatePlayerMesh,
    enterDrive,
    toast: showToast,
    refreshStart,
    cancelRace: cancelStoryRace,
    clearPursuit: () => {
      clearPolice();
      pursuit.phase = "none";
      pursuit.heat = 0;
    },
    startDuel: () => {
      startRace(0);
      if (race) {
        race.story = true;
        race.racers.slice(1).forEach((a) => a.model.dispose());
        race.racers.length = 1;
        race.racers[0].model.dispose();
        race.racers[0].model = cars.make(8, { color: "#2d3435", wing: true });
        race.racers[0].vmax = 35;
      }
    },
  });
  $("storyEndBtn").onclick = () => story.finish();
  $("storyReplay").onclick = () => {
    hidePanels();
    story.start(true);
  };
  refreshStart();
  previewCar(9);
  viewMode("intro");
  updatePlayerMesh();
  snapCamera();
  syncSound();
  hud();
  $("loadText").textContent = "Подготовка материалов и сцены…";
  scene.render();
  showroom.render();
  Promise.all([scene.whenReadyAsync(), showroom.whenReadyAsync()]).then(() => {
    $("loading").hidden = true;
  });
  window.redline = {
    B,
    story,
    roam,
    engine,
    scene,
    showroom,
    cam,
    showCam,
    cars,
    showCars,
    world,
    state,
    vehicle,
    input,
    pursuit,
    police,
    traffic,
    hazards,
    get player() {
      return player;
    },
    get preview() {
      return preview;
    },
    get race() {
      return race;
    },
    get mode() {
      return mode;
    },
    get saveKey() {
      return saveKey;
    },
    get slowActive() {
      return slowActive;
    },
    get manual() {
      return manual;
    },
    set manual(v) {
      manual = v;
    },
    update,
    render,
    save,
    startRace,
    startPursuit,
    enterDrive,
    enterGarage,
    previewCar,
    refreshGarage,
    replacePlayer,
    canChallenge,
    requirements,
    eventMenu,
    blacklistMenu,
    showSheet,
    closeSheet,
    escapePursuit,
    busted,
    finishRace,
    recover,
    exchange,
    abandonRace,
    updateTraffic,
    updatePolice,
    spawnCop,
    drivers,
    resolveCarContacts,
    updateGate,
    routeAt,
    checkpointList,
    segmentDistance,
    resize,
    stats: {
      cars: cars.catalog.length,
      districts: 6,
      detail: world.detailStats,
      surface: world.surfaceStats,
      guardrails: world.barriers.length,
      mountainTrees: world.trees,
      buildings: world.architecture.stats.buildings,
      collisionVolumes: world.solids.length,
      streets: world.roads.length,
      breakers: world.breakers.length,
      hideouts: world.hideouts.length,
    },
  };
  save();
  if(forfeitedOnLoad){$("startBtn").textContent="ПРОДОЛЖИТЬ · СТАВКА ПРОИГРАНА";}
  engine.runRenderLoop(() => {
    if (manual) return;
    let frame = Math.min(engine.getDeltaTime() / 1000, 0.12);
    while (frame > 0) {
      const step = Math.min(frame, 1 / 60);
      update(step);
      frame -= step;
    }
    render();
  });
}
