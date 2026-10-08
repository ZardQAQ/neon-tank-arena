/* =========================================================
 * 霓虹装甲 · 战场
 * 地面 / 围墙 / 掩体 / 灯光 / 天空，以及供游戏逻辑使用的
 * 2D 碰撞体、炮弹线段命中检测与视线（LOS）判定。
 * ========================================================= */
(function () {
  'use strict';

  var HALF = 64;      // 围墙内侧半宽
  var WALL_H = 3.5;

  var colliders = [];   // {type:'r'|'c', x, z, hw/hd 或 r, h}
  var spawnPoints = [
    { x: 52, z: 52 }, { x: -52, z: 52 }, { x: 52, z: -52 }, { x: -52, z: -52 },
    { x: 0, z: 56 }, { x: 0, z: -56 }, { x: 56, z: 0 }, { x: -56, z: 0 }
  ];

  function addRect(x, z, hw, hd, h) { colliders.push({ type: 'r', x: x, z: z, hw: hw, hd: hd, h: h }); }
  function addCircle(x, z, r, h) { colliders.push({ type: 'c', x: x, z: z, r: r, h: h }); }

  var W = {
    HALF: HALF,
    WALL_H: WALL_H,
    colliders: colliders,
    spawnPoints: spawnPoints,
    sun: null,
    build: build,
    resolveCircle: resolveCircle,
    circleFree: circleFree,
    segmentHit: segmentHit,
    blocksLOS: blocksLOS,
    randomOpenPoint: randomOpenPoint
  };

  /* ================= 场景构建 ================= */

  function groundTexture() {
    var c = document.createElement('canvas');
    c.width = c.height = 256;
    var g = c.getContext('2d');
    g.fillStyle = '#0b0f16';
    g.fillRect(0, 0, 256, 256);
    // 噪点
    for (var i = 0; i < 420; i++) {
      var v = Math.random();
      g.fillStyle = v > 0.5 ? 'rgba(255,255,255,' + (Math.random() * 0.03) + ')' : 'rgba(0,0,0,' + (Math.random() * 0.12) + ')';
      g.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
    // 细网格
    g.strokeStyle = 'rgba(41,230,255,0.035)';
    g.lineWidth = 1;
    for (var j = 0; j <= 256; j += 32) {
      g.beginPath(); g.moveTo(j + 0.5, 0); g.lineTo(j + 0.5, 256); g.stroke();
      g.beginPath(); g.moveTo(0, j + 0.5); g.lineTo(256, j + 0.5); g.stroke();
    }
    // 主网格
    g.strokeStyle = 'rgba(41,230,255,0.09)';
    g.lineWidth = 2;
    g.strokeRect(1, 1, 254, 254);
    var tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(18, 18);
    tex.anisotropy = 4;
    return tex;
  }

  function build(scene, quality) {
    var std = function (color, rough, metal) {
      return new THREE.MeshStandardMaterial({ color: color, roughness: rough == null ? 0.8 : rough, metalness: metal == null ? 0.2 : metal });
    };
    var glow = function (color, it) {
      return new THREE.MeshStandardMaterial({ color: 0x0a0d12, roughness: 0.5, metalness: 0.1, emissive: color, emissiveIntensity: it == null ? 1.5 : it });
    };

    // ---- 雾与天空 ----
    scene.fog = new THREE.FogExp2(0x0a0f1a, 0.0075);

    var sky = new THREE.Mesh(
      new THREE.SphereGeometry(380, 24, 12),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        vertexShader:
          'varying vec3 vP;' +
          'void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader:
          'varying vec3 vP;' +
          'void main(){' +
          '  float h = normalize(vP).y;' +
          '  vec3 top = vec3(0.012, 0.02, 0.05);' +
          '  vec3 mid = vec3(0.055, 0.095, 0.17);' +
          '  vec3 c = mix(mid, top, smoothstep(0.0, 0.55, h));' +
          '  float hor = pow(max(0.0, 1.0 - abs(h) * 2.1), 2.0);' +
          '  c += vec3(0.20, 0.06, 0.26) * hor * 0.85;' +           // 地平线品红辉光
          '  c += vec3(0.05, 0.19, 0.23) * pow(max(0.0, 1.0 - abs(h - 0.03) * 7.0), 3.0) * 0.5;' + // 青色光带
          '  gl_FragColor = vec4(c, 1.0);' +
          '}'
      })
    );
    scene.add(sky);

    // 星星
    var starN = 340;
    var starPos = new Float32Array(starN * 3);
    for (var i = 0; i < starN; i++) {
      var a = Math.random() * Math.PI * 2;
      var y = 30 + Math.random() * 300;
      var rr = 330 * Math.sqrt(Math.random() * 0.9 + 0.1);
      starPos[i * 3] = Math.cos(a) * rr;
      starPos[i * 3 + 1] = y;
      starPos[i * 3 + 2] = Math.sin(a) * rr;
    }
    var starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({
      color: 0xbfe0ff, size: 1.5, sizeAttenuation: false,
      transparent: true, opacity: 0.7, depthWrite: false, fog: false,
      blending: THREE.AdditiveBlending
    })));

    // 月亮
    var moon = new THREE.Sprite(new THREE.SpriteMaterial({
      map: TankModels.getGlowTexture(), color: 0xa9c9ff,
      transparent: true, opacity: 0.5, depthWrite: false, fog: false,
      blending: THREE.AdditiveBlending
    }));
    moon.position.set(-180, 150, -240);
    moon.scale.set(70, 70, 1);
    scene.add(moon);

    // ---- 灯光 ----
    scene.add(new THREE.HemisphereLight(0x36486a, 0x0a0d12, 0.85));
    var sun = new THREE.DirectionalLight(0xa9c9ff, 0.95);
    sun.position.set(55, 80, 25);
    if (quality.shadow > 0) {
      sun.castShadow = true;
      sun.shadow.mapSize.set(quality.shadow, quality.shadow);
      sun.shadow.camera.left = -80; sun.shadow.camera.right = 80;
      sun.shadow.camera.top = 80; sun.shadow.camera.bottom = -80;
      sun.shadow.camera.near = 10; sun.shadow.camera.far = 220;
      sun.shadow.bias = -0.0006;
    }
    scene.add(sun);
    W.sun = sun;

    // ---- 地面 ----
    var ground = new THREE.Mesh(
      new THREE.PlaneGeometry(340, 340),
      new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.94, metalness: 0.06 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // ---- 围墙 ----
    var wallMat = std(0x1d2735, 0.85, 0.15);
    var stripMat = glow(0x29e6ff, 1.2);
    [[0, -(HALF + 0.7), 131, 1.4, 0], [0, HALF + 0.7, 131, 1.4, 0],
     [-(HALF + 0.7), 0, 1.4, 131, 0], [HALF + 0.7, 0, 1.4, 131, 0]].forEach(function (w) {
      var m = new THREE.Mesh(new THREE.BoxGeometry(w[2], WALL_H, w[3]), wallMat);
      m.position.set(w[0], WALL_H / 2, w[1]);
      m.castShadow = true; m.receiveShadow = true;
      scene.add(m);
      var s = new THREE.Mesh(new THREE.BoxGeometry(w[2] === 131 ? 131 : 0.25, 0.12, w[3] === 131 ? 131 : 0.25), stripMat);
      s.position.set(w[0], WALL_H + 0.06, w[1]);
      scene.add(s);
    });

    // 角塔
    var towerMat = std(0x232c3a, 0.8, 0.2);
    [[HALF, HALF], [-HALF, HALF], [HALF, -HALF], [-HALF, -HALF]].forEach(function (p) {
      var t = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.6, 7.5, 10), towerMat);
      t.position.set(p[0], 3.75, p[1]);
      t.castShadow = true;
      scene.add(t);
      var r = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.08, 6, 20), stripMat);
      r.rotation.x = Math.PI / 2;
      r.position.set(p[0], 7.1, p[1]);
      scene.add(r);
      addCircle(p[0], p[1], 2.6, 7.5);
    });

    // ---- 霓虹灯柱（地标） ----
    var pylonDefs = [
      { x: 44, z: 0, color: 0x29e6ff }, { x: -44, z: 0, color: 0x29e6ff },
      { x: 0, z: 44, color: 0xff3ec8 }, { x: 0, z: -44, color: 0xff3ec8 }
    ];
    pylonDefs.forEach(function (p) {
      var body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 8, 1.3), std(0x1a2230, 0.7, 0.3));
      body.position.set(p.x, 4, p.z);
      body.castShadow = true;
      scene.add(body);
      var gm = glow(p.color, 1.8);
      [[0.68, 0], [-0.68, 0], [0, 0.68], [0, -0.68]].forEach(function (o) {
        var s = new THREE.Mesh(new THREE.BoxGeometry(0.1, 7.2, 0.1), gm);
        s.position.set(p.x + o[0], 4, p.z + o[1]);
        scene.add(s);
      });
      var l = new THREE.PointLight(p.color, 1.0, 38, 2);
      l.position.set(p.x, 5.5, p.z);
      scene.add(l);
      addRect(p.x, p.z, 0.78, 0.78, 8);
    });

    // ---- 掩体：碉堡 ----
    var bunkerMat = std(0x27303f, 0.85, 0.2);
    [[20, 20], [-20, 20], [20, -20], [-20, -20]].forEach(function (p) {
      var b = new THREE.Mesh(new THREE.BoxGeometry(6, 2.6, 6), bunkerMat);
      b.position.set(p[0], 1.3, p[1]);
      b.castShadow = true; b.receiveShadow = true;
      scene.add(b);
      var lip = new THREE.Mesh(new THREE.BoxGeometry(6.3, 0.18, 6.3), std(0x161d28, 0.8, 0.25));
      lip.position.set(p[0], 2.55, p[1]);
      scene.add(lip);
      addRect(p[0], p[1], 3.05, 3.05, 2.6);
    });

    // ---- 集装箱 ----
    var contDefs = [
      { x: 36, z: -12, ry: 0, c: 0x2c3a4e },
      { x: -36, z: 12, ry: 0, c: 0x3a2c4e },
      { x: 12, z: 36, ry: 1, c: 0x2c4e3a },
      { x: -12, z: -36, ry: 1, c: 0x4e3a2c }
    ];
    contDefs.forEach(function (d) {
      var w = d.ry ? 7 : 3, dd = d.ry ? 3 : 7;
      var m = new THREE.Mesh(new THREE.BoxGeometry(w, 2.3, dd), std(d.c, 0.7, 0.3));
      m.position.set(d.x, 1.15, d.z);
      m.castShadow = true; m.receiveShadow = true;
      scene.add(m);
      var stripe = new THREE.Mesh(new THREE.BoxGeometry(d.ry ? 7.1 : 0.15, 0.18, d.ry ? 0.15 : 7.1), glow(0xffb02e, 1.0));
      stripe.position.set(d.x, 2.0, d.z);
      scene.add(stripe);
      addRect(d.x, d.z, w / 2 + 0.1, dd / 2 + 0.1, 2.3);
    });

    // ---- 路障 ----
    var barMat = std(0x33404f, 0.8, 0.25);
    var barGlow = glow(0x29e6ff, 0.8);
    var barDefs = [
      { x: 0, z: 14, ry: 0 }, { x: 0, z: -14, ry: 0 },
      { x: 14, z: 0, ry: 1 }, { x: -14, z: 0, ry: 1 },
      { x: 38, z: 38, ry: 0 }, { x: -38, z: 38, ry: 1 },
      { x: 38, z: -38, ry: 1 }, { x: -38, z: -38, ry: 0 }
    ];
    barDefs.forEach(function (d) {
      var w = d.ry ? 1.1 : 4.6, dd = d.ry ? 4.6 : 1.1;
      var m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.25, dd), barMat);
      m.position.set(d.x, 0.625, d.z);
      m.castShadow = true; m.receiveShadow = true;
      scene.add(m);
      var s = new THREE.Mesh(new THREE.BoxGeometry(d.ry ? 0.12 : 4.4, 0.08, d.ry ? 4.4 : 0.12), barGlow);
      s.position.set(d.x, 1.3, d.z);
      scene.add(s);
      addRect(d.x, d.z, w / 2 + 0.05, dd / 2 + 0.05, 1.25);
    });

    // ---- 岩石 ----
    var rockMat = std(0x39434f, 0.95, 0.05);
    var rockDefs = [
      [32, 4, 2.1], [-32, -4, 2.1], [4, -32, 2.3], [-6, 30, 1.8],
      [46, -26, 2.5], [-46, 26, 2.5], [24, -46, 2.1], [-24, 46, 2.1]
    ];
    rockDefs.forEach(function (d) {
      var geo = new THREE.IcosahedronGeometry(d[2], 1);
      var pos = geo.attributes.position;
      for (var vi = 0; vi < pos.count; vi++) {
        var k = 0.82 + Math.random() * 0.36;
        pos.setXYZ(vi, pos.getX(vi) * k, pos.getY(vi) * (0.62 + Math.random() * 0.3), pos.getZ(vi) * k);
      }
      geo.computeVertexNormals();
      var m = new THREE.Mesh(geo, rockMat);
      m.position.set(d[0], d[2] * 0.42, d[1]);
      m.rotation.y = Math.random() * Math.PI * 2;
      m.castShadow = true; m.receiveShadow = true;
      scene.add(m);
      addCircle(d[0], d[1], d[2] * 0.95, d[2] * 1.05);
    });

    // ---- 立柱 ----
    var pillarMat = std(0x2a3444, 0.75, 0.3);
    [[26, -40], [-26, 40], [40, 26], [-40, -26]].forEach(function (p) {
      var m = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.95, 4.4, 10), pillarMat);
      m.position.set(p[0], 2.2, p[1]);
      m.castShadow = true;
      scene.add(m);
      var cap = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.12, 10), glow(0xff3ec8, 1.2));
      cap.position.set(p[0], 4.46, p[1]);
      scene.add(cap);
      addCircle(p[0], p[1], 1.0, 4.4);
    });

    // ---- 场边地面光带 ----
    var edgeGlow = new THREE.Mesh(new THREE.BoxGeometry(127, 0.06, 0.35), glow(0x29e6ff, 0.7));
    [[0, -HALF + 0.6, 0], [0, HALF - 0.6, 0], [-HALF + 0.6, 0, 1], [HALF - 0.6, 0, 1]].forEach(function (e) {
      var m = edgeGlow.clone();
      m.position.set(e[0], 0.03, e[1]);
      if (e[2]) m.rotation.y = Math.PI / 2;
      scene.add(m);
    });
  }

  /* ================= 碰撞 / 视线 ================= */

  // 圆形单位推出所有碰撞体与边界，返回修正后的 {x, z}
  function resolveCircle(x, z, r) {
    var B = HALF - 1.0 - r;
    if (x < -B) x = -B; else if (x > B) x = B;
    if (z < -B) z = -B; else if (z > B) z = B;

    for (var i = 0; i < colliders.length; i++) {
      var c = colliders[i];
      if (c.type === 'r') {
        var nx = Math.max(c.x - c.hw, Math.min(x, c.x + c.hw));
        var nz = Math.max(c.z - c.hd, Math.min(z, c.z + c.hd));
        var dx = x - nx, dz = z - nz;
        var d2 = dx * dx + dz * dz;
        if (d2 < r * r) {
          if (d2 > 1e-9) {
            var d = Math.sqrt(d2), push = (r - d) / d;
            x += dx * push; z += dz * push;
          } else {
            // 圆心在矩形内：沿最小穿透轴推出
            var pxr = (c.x + c.hw + r) - x, pxl = x - (c.x - c.hw - r);
            var pzr = (c.z + c.hd + r) - z, pzl = z - (c.z - c.hd - r);
            var m = Math.min(pxr, pxl, pzr, pzl);
            if (m === pxr) x = c.x + c.hw + r;
            else if (m === pxl) x = c.x - c.hw - r;
            else if (m === pzr) z = c.z + c.hd + r;
            else z = c.z - c.hd - r;
          }
        }
      } else {
        var ddx = x - c.x, ddz = z - c.z;
        var rr = r + c.r;
        var dd2 = ddx * ddx + ddz * ddz;
        if (dd2 < rr * rr) {
          if (dd2 < 1e-9) { ddx = 1; ddz = 0; dd2 = 1; }
          var dd = Math.sqrt(dd2);
          x = c.x + ddx / dd * rr;
          z = c.z + ddz / dd * rr;
        }
      }
    }
    return { x: x, z: z };
  }

  function circleFree(x, z, r) {
    var B = HALF - 1.0 - r;
    if (x < -B || x > B || z < -B || z > B) return false;
    for (var i = 0; i < colliders.length; i++) {
      var c = colliders[i];
      if (c.type === 'r') {
        var nx = Math.max(c.x - c.hw, Math.min(x, c.x + c.hw));
        var nz = Math.max(c.z - c.hd, Math.min(z, c.z + c.hd));
        var dx = x - nx, dz = z - nz;
        if (dx * dx + dz * dz < r * r) return false;
      } else {
        var ddx = x - c.x, ddz = z - c.z, rr = r + c.r;
        if (ddx * ddx + ddz * ddz < rr * rr) return false;
      }
    }
    return true;
  }

  var hitResult = { t: 0, x: 0, y: 0, z: 0, kind: '' };

  // 3D 线段命中：地面 / 围墙 / 掩体（考虑高度）。
  // 返回共享对象（调用后立即使用），无命中返回 null。
  function segmentHit(ax, ay, az, bx, by, bz) {
    var bestT = Infinity, kind = '';

    // 地面
    if (ay > 0.05 && by <= 0.05) {
      var tg = (ay - 0.05) / (ay - by);
      if (tg >= 0 && tg < bestT) { bestT = tg; kind = 'ground'; }
    }

    // 围墙（任意高度都算出界拦截）
    var dx = bx - ax, dz = bz - az;
    if (dx !== 0) {
      var t1 = (HALF - ax) / dx, t2 = (-HALF - ax) / dx;
      if (t1 > 0 && t1 <= 1 && t1 < bestT && ay + (by - ay) * t1 < WALL_H + 0.5) { bestT = t1; kind = 'wall'; }
      if (t2 > 0 && t2 <= 1 && t2 < bestT && ay + (by - ay) * t2 < WALL_H + 0.5) { bestT = t2; kind = 'wall'; }
    }
    if (dz !== 0) {
      var t3 = (HALF - az) / dz, t4 = (-HALF - az) / dz;
      if (t3 > 0 && t3 <= 1 && t3 < bestT && ay + (by - ay) * t3 < WALL_H + 0.5) { bestT = t3; kind = 'wall'; }
      if (t4 > 0 && t4 <= 1 && t4 < bestT && ay + (by - ay) * t4 < WALL_H + 0.5) { bestT = t4; kind = 'wall'; }
    }

    // 掩体
    for (var i = 0; i < colliders.length; i++) {
      var c = colliders[i], t = -1;
      if (c.type === 'c') {
        var fx = ax - c.x, fz = az - c.z;
        var A = dx * dx + dz * dz;
        if (A < 1e-12) continue;
        var Bq = 2 * (fx * dx + fz * dz);
        var C = fx * fx + fz * fz - c.r * c.r;
        if (C < 0) continue; // 起点在内部，忽略（避免出生自卡）
        var disc = Bq * Bq - 4 * A * C;
        if (disc < 0) continue;
        t = (-Bq - Math.sqrt(disc)) / (2 * A);
      } else {
        var invx = dx !== 0 ? 1 / dx : Infinity;
        var invz = dz !== 0 ? 1 / dz : Infinity;
        var tx1 = (c.x - c.hw - ax) * invx, tx2 = (c.x + c.hw - ax) * invx;
        var tmin = Math.min(tx1, tx2), tmax = Math.max(tx1, tx2);
        if (dx === 0) { if (ax < c.x - c.hw || ax > c.x + c.hw) continue; tmin = -Infinity; tmax = Infinity; }
        var tz1 = (c.z - c.hd - az) * invz, tz2 = (c.z + c.hd - az) * invz;
        var tzmin = Math.min(tz1, tz2), tzmax = Math.max(tz1, tz2);
        if (dz === 0) { if (az < c.z - c.hd || az > c.z + c.hd) continue; tzmin = -Infinity; tzmax = Infinity; }
        var tEnter = Math.max(tmin, tzmin), tExit = Math.min(tmax, tzmax);
        if (tEnter > tExit || tEnter <= 0) continue;
        t = tEnter;
      }
      if (t > 0 && t <= 1 && t < bestT) {
        var y = ay + (by - ay) * t;
        if (y <= c.h) { bestT = t; kind = 'obstacle'; }
      }
    }

    if (!isFinite(bestT) || bestT > 1) return null;
    hitResult.t = bestT;
    hitResult.x = ax + dx * bestT;
    hitResult.y = ay + (by - ay) * bestT;
    hitResult.z = az + dz * bestT;
    hitResult.kind = kind;
    return hitResult;
  }

  // 2D 视线判定：仅统计高度 >= 1.5 的掩体
  function blocksLOS(ax, az, bx, bz) {
    var dx = bx - ax, dz = bz - az;
    for (var i = 0; i < colliders.length; i++) {
      var c = colliders[i];
      if (c.h < 1.5) continue;
      if (c.type === 'c') {
        var fx = ax - c.x, fz = az - c.z;
        var A = dx * dx + dz * dz;
        if (A < 1e-12) continue;
        var Bq = 2 * (fx * dx + fz * dz);
        var C = fx * fx + fz * fz - c.r * c.r;
        if (C < 0) return true;
        var disc = Bq * Bq - 4 * A * C;
        if (disc < 0) continue;
        var t = (-Bq - Math.sqrt(disc)) / (2 * A);
        if (t > 0 && t < 1) return true;
      } else {
        var invx = dx !== 0 ? 1 / dx : Infinity;
        var invz = dz !== 0 ? 1 / dz : Infinity;
        var tx1 = (c.x - c.hw - ax) * invx, tx2 = (c.x + c.hw - ax) * invx;
        var tmin = Math.min(tx1, tx2), tmax = Math.max(tx1, tx2);
        if (dx === 0) { if (ax < c.x - c.hw || ax > c.x + c.hw) continue; tmin = -Infinity; tmax = Infinity; }
        var tz1 = (c.z - c.hd - az) * invz, tz2 = (c.z + c.hd - az) * invz;
        var tzmin = Math.min(tz1, tz2), tzmax = Math.max(tz1, tz2);
        if (dz === 0) { if (az < c.z - c.hd || az > c.z + c.hd) continue; tzmin = -Infinity; tzmax = Infinity; }
        var tEnter = Math.max(tmin, tzmin), tExit = Math.min(tmax, tzmax);
        if (tEnter <= tExit && tEnter > 0 && tEnter < 1) return true;
      }
    }
    return false;
  }

  function randomOpenPoint(margin, r) {
    var B = HALF - margin;
    var x = 0, z = 0;
    for (var i = 0; i < 24; i++) {
      x = -B + Math.random() * B * 2;
      z = -B + Math.random() * B * 2;
      if (circleFree(x, z, r)) return { x: x, z: z };
    }
    return { x: x, z: z };
  }

  window.World = W;
})();
