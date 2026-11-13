/*
 * Sky-Isle graphics: parallax clouds, particles, soft light and environment props.
 * Attaches lazily to window.skyGame so the main game module stays untouched.
 */
window.__skyGfx = (function () {
  'use strict';
  function attach(game, B) {
    if (!game || !game.scene || !B || window.__skyGfxReady) return false;
/*
 * Графика Sky-Isle: параллакс облаков, частицы, мягкие тени и свечение.
 * Работает поверх готовой сцены через публичный объект window.skyGame.
 */
    var scene = game.scene, drone = game.drone, camera = game.camera;
    var now = 0;

    /* ------------------------------------------------ 1. Свет и мягкие тени */
    var hemi = scene.lights.filter(function (l) { return /Open sky/i.test(l.name); })[0];
    if (hemi) {
      // Тёплый верх и прохладный низ: у сцены появляется объём.
      hemi.intensity = 0.72;
      hemi.diffuse = B.Color3.FromHexString('#fff4dc');
      hemi.groundColor = B.Color3.FromHexString('#6f8a86');
    }
    var sun = scene.lights.filter(function (l) { return /sunlight/i.test(l.name); })[0];
    if (sun) {
      sun.intensity = 0.78;
      sun.diffuse = B.Color3.FromHexString('#ffe9c4');
      // Мягкое золотое «подсвечивание» контрового света.
      sun.specular = B.Color3.FromHexString('#ffd9a0');
    }

    /* ------------------------------------- 2. Параллакс-слой дальних облаков */
    var farClouds = [];
    var cloudMat = new B.StandardMaterial('Far cloud material', scene);
    cloudMat.diffuseColor = B.Color3.FromHexString('#f7fbef');
    cloudMat.emissiveColor = B.Color3.FromHexString('#dfeaf0').scale(0.35);
    cloudMat.specularColor = B.Color3.Black();
    cloudMat.alpha = 0.85;
    cloudMat.backFaceCulling = false;

    for (var i = 0; i < 20; i++) {
      var angle = (i / 20) * Math.PI * 2;
      var radius = 900 + (i % 5) * 240;
      var group = new B.TransformNode('Parallax cloud ' + i, scene);
      group.position.set(Math.sin(angle) * radius, -60 + (i % 7) * 26, Math.cos(angle) * radius);
      for (var j = 0; j < 3; j++) {
        var puff = B.MeshBuilder.CreateSphere('Far puff', { diameter: 2, segments: 8 }, scene);
        puff.scaling.set(70 + (j % 3) * 26, 26 + (j % 2) * 10, 54 + (j % 4) * 12);
        puff.position.set((j - 1) * 72, Math.sin(j) * 8, 0);
        puff.material = cloudMat;
        puff.isPickable = false;
        puff.parent = group;
      }
      farClouds.push({ node: group, baseX: group.position.x, baseZ: group.position.z, speed: 0.0006 + (i % 4) * 0.00025, phase: i });
    }

    /* --------------------------- 2b. Плотные тени: мягче и глубже, чем были */
    if (sun && typeof sun.getShadowGenerator === 'function') {
      var sg = sun.getShadowGenerator();
      if (sg) {
        sg.useBlurExponentialShadowMap = true;
        sg.blurKernel = 32;
        sg.darkness = 0.22;
        sg.depthScale = 60;
      }
    }

    /* -------------------- 2c. Детали окружения: депо, фонари, флажки, птицы */
    function shade(hex, alpha, glow) {
      var m = new B.StandardMaterial('Gfx ' + hex + (alpha || 1), scene);
      m.diffuseColor = B.Color3.FromHexString(hex);
      m.specularColor = B.Color3.FromHexString('#1a1a16');
      m.alpha = alpha === undefined ? 1 : alpha;
      if (glow) m.emissiveColor = m.diffuseColor.scale(glow);
      m.backFaceCulling = false;
      return m;
    }
    var woodMat = shade('#a98b62'), metalMat = shade('#54706b'),
      lampMat = shade('#ffe6a8', 1, 0.85), flagMats = ['#c47b62', '#e2c074', '#7fac9a'];

    function prop(mesh, x, y, z, parent) {
      mesh.position.set(x, y, z);
      mesh.isPickable = false;
      mesh.receiveShadows = true;
      if (parent) mesh.parent = parent;
      return mesh;
    }

    var depot = game.depotPad || { x: 0, z: 0 };
    var decor = new B.TransformNode('Gfx depot details', scene);
    decor.position.set(depot.x, 0, depot.z);
    // Ящики и бочки у почтового депо.
    for (var d = 0; d < 3; d++) {
      var crate = prop(B.MeshBuilder.CreateBox('Depot crate', { size: 1.5 }, scene), -3.4 + d * 1.7, 0.75, 3.9, decor);
      crate.material = woodMat;
      var band = prop(B.MeshBuilder.CreateBox('Crate band', { width: 1.56, height: 0.14, depth: 1.56 }, scene), -3.4 + d * 1.7, 1.28, 3.9, decor);
      band.material = metalMat;
    }
    for (var b = 0; b < 2; b++) {
      var barrel = prop(B.MeshBuilder.CreateCylinder('Depot barrel', { diameter: 1.1, height: 1.5, tessellation: 16 }, scene), 4.6 + b * 1.4, 0.75, 3.4, decor);
      barrel.material = woodMat;
    }
    // Фонари по краям площадки: тёплые точки света в сумерках.
    var lampGlow = null;
    for (var li = 0; li < 6; li++) {
      var a2 = (li / 6) * Math.PI * 2, lx = Math.sin(a2) * 9.5, lz = Math.cos(a2) * 9.5;
      var post = prop(B.MeshBuilder.CreateCylinder('Lamp post', { diameter: 0.22, height: 3.4, tessellation: 10 }, scene), lx, 1.7, lz, decor);
      post.material = metalMat;
      var bulb = prop(B.MeshBuilder.CreateSphere('Lamp bulb', { diameter: 0.52, segments: 8 }, scene), lx, 3.5, lz, decor);
      bulb.material = lampMat;
    }
    // Гирлянда флажков над площадкой.
    for (var fi = 0; fi < 9; fi++) {
      var t2 = fi / 8, fx = -8 + t2 * 16, fz = -7.5, fy = 4.4 - Math.sin(t2 * Math.PI) * 1.05;
      var flag = prop(B.MeshBuilder.CreateBox('Pennant', { width: 0.08, height: 0.62, depth: 0.42 }, scene), fx, fy, fz, decor);
      flag.material = shade(flagMats[fi % 3]);
      flag.rotation.z = Math.sin(t2 * Math.PI) * 0.35;
    }

    // Стая птиц: медленно кружит над архипелагом, крылья машут.
    var birds = [];
    var birdMat = shade('#4b5f63');
    for (var bi = 0; bi < 9; bi++) {
      var bird = new B.TransformNode('Gull ' + bi, scene);
      var left = prop(B.MeshBuilder.CreateBox('Wing', { width: 1.5, height: 0.09, depth: 0.42 }, scene), -0.78, 0, 0, bird);
      var right = prop(B.MeshBuilder.CreateBox('Wing', { width: 1.5, height: 0.09, depth: 0.42 }, scene), 0.78, 0, 0, bird);
      var tail = prop(B.MeshBuilder.CreateBox('Tail', { width: 0.3, height: 0.12, depth: 0.8 }, scene), 0, 0, -0.6, bird);
      left.material = right.material = tail.material = birdMat;
      birds.push({
        node: bird, left: left, right: right,
        radius: 42 + (bi % 4) * 16, height: 24 + (bi % 3) * 7,
        speed: 0.12 + (bi % 5) * 0.018, phase: bi * 0.7
      });
    }

    /* ---------------------------------------- 3. Частицы: пыль, искры, сбор */
    var dust = new B.ParticleSystem('Air dust', 260, scene);
    dust.particleTexture = null;
    dust.emitter = new B.Vector3(0, 8, 0);
    dust.minEmitBox = new B.Vector3(-140, -6, -140);
    dust.maxEmitBox = new B.Vector3(140, 26, 140);
    dust.color1 = new B.Color4(1, 0.98, 0.85, 0.55);
    dust.color2 = new B.Color4(0.85, 0.95, 1, 0.32);
    dust.colorDead = new B.Color4(1, 1, 1, 0);
    dust.minSize = 0.16;
    dust.maxSize = 0.55;
    dust.minLifeTime = 5;
    dust.maxLifeTime = 12;
    dust.emitRate = 44;
    dust.blendMode = B.ParticleSystem.BLENDMODE_ADD;
    dust.gravity = new B.Vector3(0, 0.02, 0);
    dust.direction1 = new B.Vector3(-0.35, 0.15, -0.35);
    dust.direction2 = new B.Vector3(0.35, 0.45, 0.35);
    dust.minAngularSpeed = -0.4;
    dust.maxAngularSpeed = 0.4;
    dust.start();

    // Импульс искр: короткая вспышка там, где дрон подобрал или отдал посылку.
    var burst = new B.ParticleSystem('Spark burst', 90, scene);
    burst.emitter = new B.Vector3(0, 3, 0);
    burst.color1 = new B.Color4(1, 0.92, 0.55, 1);
    burst.color2 = new B.Color4(0.75, 1, 0.85, 0.9);
    burst.colorDead = new B.Color4(1, 1, 1, 0);
    burst.minSize = 0.12;
    burst.maxSize = 0.42;
    burst.minLifeTime = 0.35;
    burst.maxLifeTime = 0.85;
    burst.emitRate = 0;
    burst.blendMode = B.ParticleSystem.BLENDMODE_ADD;
    burst.gravity = new B.Vector3(0, -2.4, 0);
    burst.direction1 = new B.Vector3(-2.2, 1.4, -2.2);
    burst.direction2 = new B.Vector3(2.2, 3.4, 2.2);
    burst.minEmitPower = 1.2;
    burst.maxEmitPower = 3.6;
    burst.start();

    var manualBurst = 0;
    function sparkle(position) {
      burst.emitter = position.clone();
      manualBurst = 0.12;
    }

    /* ---------------------------------- 4. Свечение винтов и посадочных огней */
    var glowLayer = null;
    try {
      glowLayer = new B.GlowLayer('Soft glow', scene, { blurKernelSize: 48 });
      glowLayer.intensity = 0.55;
      var lamps = drone.getChildMeshes().filter(function (m) { return /lamp/i.test(m.name); });
      lamps.forEach(function (lamp) {
        glowLayer.addIncludedOnlyMesh(lamp);
        var flash = new B.Animation('Lamp flash', 'visibility', 30, B.Animation.ANIMATIONTYPE_FLOAT,
          B.Animation.ANIMATIONLOOPMODE_CYCLE);
        flash.setKeys([{ frame: 0, value: 1 }, { frame: 15, value: 0.35 }, { frame: 30, value: 1 }]);
        lamp.animations.push(flash);
        scene.beginAnimation(lamp, 0, 30, true, 0.9);
      });
    } catch (e) {
      glowLayer = null;   // WebGL1 без post-process — играем без свечения
    }

    /* ----------------- 6. События: подбор и доставка ловятся по состоянию игры */
    var state = game.state || {};
    var prevOrder = state.order, prevScore = state.score;

    /* --------------------- 5. Плавная анимация в рендер-цикле Babylon */
    var engine = scene.getEngine ? scene.getEngine() : null;
    scene.onBeforeRenderObservable.add(function () {
      var dt = engine && engine.getDeltaTime ? Math.min(0.06, engine.getDeltaTime() / 1000) : 0.016;
      now += dt;
      // Птицы кружат над островом и машут крыльями.
      for (var bi2 = 0; bi2 < birds.length; bi2++) {
        var bd = birds[bi2], ang = now * bd.speed + bd.phase;
        bd.node.position.set(Math.sin(ang) * bd.radius, bd.height + Math.sin(now * 0.5 + bd.phase) * 1.6, Math.cos(ang) * bd.radius);
        bd.node.rotation.y = Math.atan2(Math.cos(ang), -Math.sin(ang));
        var flap = Math.sin(now * 4.5 + bd.phase) * 0.55;
        bd.left.rotation.z = flap;
        bd.right.rotation.z = -flap;
      }
      // Дальние облака плывут медленно и по-разному: мягкий параллакс.
      for (var k = 0; k < farClouds.length; k++) {
        var c = farClouds[k];
        c.node.position.x = c.baseX + Math.sin(now * c.speed * 12 + c.phase) * 34;
        c.node.position.z = c.baseZ + Math.cos(now * c.speed * 9 + c.phase) * 26;
        c.node.position.y = -60 + Math.sin(now * 0.08 + c.phase) * 3.2;
      }
      if (manualBurst > 0) {
        manualBurst -= dt;
        burst.emitRate = 320;
        if (manualBurst <= 0) burst.emitRate = 0;
      }
      // Лёгкое «дыхание» пыли вокруг сцены.
      dust.emitRate = 40 + Math.sin(now * 0.6) * 10;
      // Взяли посылку или доставили её — вспышка искр у корпуса дрона.
      if (state.order !== prevOrder || state.score !== prevScore) {
        prevOrder = state.order;
        prevScore = state.score;
        sparkle(drone.position);
      }
    });

    window.__skyGfxReady = true;
    return true;
  }
  return { attach: attach };
})();
