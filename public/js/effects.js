/* =========================================================
 * 霓虹装甲 · 特效系统
 * 池化的 GPU 点精灵粒子（火花/烟雾）、冲击波光环、地面弹痕、
 * 炮口闪光、瞬时光源、飞散残骸 —— 全部程序化，零外部资源。
 * ========================================================= */
(function () {
  'use strict';

  var scene = null;
  var density = 1;

  /* ---------------- 粒子池 ---------------- */
  function ParticlePool(N, blending) {
    this.N = N;
    this.pos = new Float32Array(N * 3);
    this.vel = new Float32Array(N * 3);
    this.col = new Float32Array(N * 4);
    this.size = new Float32Array(N);
    this.life = new Float32Array(N);
    this.maxLife = new Float32Array(N);
    this.drag = new Float32Array(N);
    this.grav = new Float32Array(N);
    this.grow = new Float32Array(N);
    this.baseSize = new Float32Array(N);
    this.baseA = new Float32Array(N);
    this.next = 0;

    var geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3);
    this.aCol = new THREE.BufferAttribute(this.col, 4);
    this.aSize = new THREE.BufferAttribute(this.size, 1);
    this.aPos.setUsage(THREE.DynamicDrawUsage);
    this.aCol.setUsage(THREE.DynamicDrawUsage);
    this.aSize.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('pcol', this.aCol);
    geo.setAttribute('psize', this.aSize);

    var mat = new THREE.ShaderMaterial({
      uniforms: { tex: { value: TankModels.getGlowTexture() } },
      vertexShader:
        'attribute vec4 pcol; attribute float psize; varying vec4 vC;' +
        'void main(){ vC = pcol; vec4 mv = modelViewMatrix * vec4(position, 1.0);' +
        ' gl_PointSize = psize * (300.0 / max(1.0, -mv.z));' +
        ' gl_Position = projectionMatrix * mv; }',
      fragmentShader:
        'uniform sampler2D tex; varying vec4 vC;' +
        'void main(){ vec4 t = texture2D(tex, gl_PointCoord);' +
        ' float a = t.a * vC.a; if (a < 0.012) discard;' +
        ' gl_FragColor = vec4(vC.rgb, a); }',
      transparent: true,
      depthWrite: false,
      blending: blending
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }

  ParticlePool.prototype.spawn = function (x, y, z, vx, vy, vz, life, size, r, g, b, a, drag, grav, grow) {
    var i = this.next;
    this.next = (this.next + 1) % this.N;
    var i3 = i * 3, i4 = i * 4;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.col[i4] = r; this.col[i4 + 1] = g; this.col[i4 + 2] = b; this.col[i4 + 3] = a;
    this.life[i] = life; this.maxLife[i] = life;
    this.size[i] = size; this.baseSize[i] = size; this.baseA[i] = a;
    this.drag[i] = drag || 0; this.grav[i] = grav || 0; this.grow[i] = grow || 0;
  };

  ParticlePool.prototype.update = function (dt) {
    var N = this.N;
    for (var i = 0; i < N; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      var i3 = i * 3, i4 = i * 4;
      if (this.life[i] <= 0) {
        this.col[i4 + 3] = 0;
        this.size[i] = 0;
        continue;
      }
      var dr = 1 - this.drag[i] * dt;
      if (dr < 0) dr = 0;
      this.vel[i3] *= dr; this.vel[i3 + 1] *= dr; this.vel[i3 + 2] *= dr;
      this.vel[i3 + 1] -= this.grav[i] * dt;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.pos[i3 + 1] < 0.03) this.pos[i3 + 1] = 0.03;
      var k = this.life[i] / this.maxLife[i];
      this.col[i4 + 3] = this.baseA[i] * k;
      this.size[i] = this.baseSize[i] * (1 + this.grow[i] * (1 - k));
    }
    this.aPos.needsUpdate = true;
    this.aCol.needsUpdate = true;
    this.aSize.needsUpdate = true;
  };

  var sparks = null, smoke = null;

  /* ---------------- 冲击波光环 ---------------- */
  var rings = [];
  function initRings() {
    var geo = new THREE.RingGeometry(0.88, 1.0, 40);
    for (var i = 0; i < 10; i++) {
      var m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
      }));
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      m.userData = { t: 0, dur: 0, maxR: 0 };
      scene.add(m);
      rings.push(m);
    }
  }
  var ringIdx = 0;
  function ringWave(x, y, z, maxR, colorHex, dur) {
    var m = rings[ringIdx];
    ringIdx = (ringIdx + 1) % rings.length;
    m.visible = true;
    m.position.set(x, Math.max(0.06, y), z);
    m.material.color.setHex(colorHex);
    m.userData.t = 0;
    m.userData.dur = dur || 0.55;
    m.userData.maxR = maxR;
  }
  function updateRings(dt) {
    for (var i = 0; i < rings.length; i++) {
      var m = rings[i];
      if (!m.visible) continue;
      var u = m.userData;
      u.t += dt;
      var k = u.t / u.dur;
      if (k >= 1) { m.visible = false; m.material.opacity = 0; continue; }
      var e = 1 - Math.pow(1 - k, 2.4);
      m.scale.setScalar(Math.max(0.05, u.maxR * e));
      m.material.opacity = (1 - k) * 0.85;
    }
  }

  /* ---------------- 地面弹痕 ---------------- */
  var scorches = [], scorchIdx = 0;
  function scorchTexture() {
    var c = document.createElement('canvas');
    c.width = c.height = 64;
    var g = c.getContext('2d');
    var grad = g.createRadialGradient(32, 32, 4, 32, 32, 32);
    grad.addColorStop(0, 'rgba(0,0,0,.9)');
    grad.addColorStop(0.6, 'rgba(0,0,0,.55)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }
  function initScorches() {
    var geo = new THREE.CircleGeometry(1, 20);
    var tex = scorchTexture();
    for (var i = 0; i < 22; i++) {
      var m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        map: tex, transparent: true, opacity: 0, depthWrite: false
      }));
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.02 + i * 0.0011;
      m.visible = false;
      m.userData = { t: 0 };
      scene.add(m);
      scorches.push(m);
    }
  }
  function scorch(x, z, r) {
    var m = scorches[scorchIdx];
    scorchIdx = (scorchIdx + 1) % scorches.length;
    m.visible = true;
    m.position.x = x; m.position.z = z;
    m.scale.setScalar(r);
    m.material.opacity = 0.8;
    m.userData.t = 16;
  }
  function updateScorches(dt) {
    for (var i = 0; i < scorches.length; i++) {
      var m = scorches[i];
      if (!m.visible) continue;
      m.userData.t -= dt;
      if (m.userData.t <= 0) { m.visible = false; continue; }
      if (m.userData.t < 5) m.material.opacity = 0.8 * (m.userData.t / 5);
    }
  }

  /* ---------------- 瞬时光源 ---------------- */
  var flashes = [], flashIdx = 0;
  function initFlashes() {
    for (var i = 0; i < 6; i++) {
      var l = new THREE.PointLight(0xffffff, 0, 30, 2);
      l.visible = false;
      scene.add(l);
      flashes.push(l);
    }
  }
  function flash(x, y, z, colorHex, intensity, range) {
    var l = flashes[flashIdx];
    flashIdx = (flashIdx + 1) % flashes.length;
    l.visible = true;
    l.position.set(x, y, z);
    l.color.setHex(colorHex);
    l.intensity = intensity;
    l.distance = range || 28;
  }
  function updateFlashes(dt) {
    var k = Math.pow(0.0005, dt);   // 快速衰减
    for (var i = 0; i < flashes.length; i++) {
      var l = flashes[i];
      if (!l.visible) continue;
      l.intensity *= k;
      if (l.intensity < 0.03) { l.intensity = 0; l.visible = false; }
    }
  }

  /* ---------------- 炮口闪光 ---------------- */
  var muzzles = [], muzzleIdx = 0;
  function initMuzzles() {
    for (var i = 0; i < 10; i++) {
      var s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: TankModels.getGlowTexture(), color: 0xffffff,
        blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0
      }));
      s.visible = false;
      s.userData = { t: 0 };
      scene.add(s);
      muzzles.push(s);
    }
  }
  function muzzleFlash(pos, dir, colorHex, size) {
    var s = muzzles[muzzleIdx];
    muzzleIdx = (muzzleIdx + 1) % muzzles.length;
    var sc = (size || 1) * (1.3 + Math.random() * 0.5);
    s.visible = true;
    s.position.set(pos.x + dir.x * 0.35, pos.y + dir.y * 0.35, pos.z + dir.z * 0.35);
    s.material.color.setHex(colorHex);
    s.material.opacity = 1;
    s.scale.set(sc, sc, 1);
    s.userData.t = 0.075;
    flash(pos.x, pos.y, pos.z, colorHex, 1.6 * (size || 1), 14);
    // 火花
    var n = Math.round(4 * density);
    for (var i = 0; i < n; i++) {
      var sp = 7 + Math.random() * 7;
      sparks.spawn(
        pos.x, pos.y, pos.z,
        dir.x * sp + (Math.random() - 0.5) * 3, dir.y * sp + (Math.random() - 0.5) * 3 + 1, dir.z * sp + (Math.random() - 0.5) * 3,
        0.1 + Math.random() * 0.12, 0.3 + Math.random() * 0.25,
        1, 0.85, 0.45, 0.9, 3, 4, 0
      );
    }
  }
  function updateMuzzles(dt) {
    for (var i = 0; i < muzzles.length; i++) {
      var s = muzzles[i];
      if (!s.visible) continue;
      s.userData.t -= dt;
      if (s.userData.t <= 0) { s.visible = false; s.material.opacity = 0; continue; }
      s.material.opacity = Math.min(1, s.userData.t / 0.05);
    }
  }

  /* ---------------- 闪电轨迹（特效弹：等离子/曳光/核弹） ---------------- */
  var bolts = [], boltIdx = 0, MAX_BOLTS = 72;
  function initBolts() {
    for (var i = 0; i < MAX_BOLTS; i++) {
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9 * 3), 3));
      geo.setDrawRange(0, 0);
      var mat = new THREE.LineBasicMaterial({
        color: 0xffffff,
        blending: THREE.AdditiveBlending,
        transparent: true, depthWrite: false, opacity: 0
      });
      var line = new THREE.Line(geo, mat);
      line.visible = false;
      line.frustumCulled = false;
      scene.add(line);
      bolts.push(line);
    }
  }
  // 沿 -dir 方向生成一段锯齿闪电尾迹（主闪电 + 两条分支）
  function bolt(x, y, z, dx, dy, dz, col, len, life) {
    var l = bolts[boltIdx];
    boltIdx = (boltIdx + 1) % bolts.length;
    var dl = Math.hypot(dx, dy, dz) || 1;
    var ux = dx / dl, uy = dy / dl, uz = dz / dl;
    // 垂直单位向量（用于横向抖动）
    var rx = -uy, ry = ux, rz = 0;
    var rl = Math.hypot(rx, ry, rz);
    if (rl < 0.001) { rx = 0; ry = -uz; rz = uy; rl = Math.hypot(rx, ry, rz); }
    rx /= rl; ry /= rl; rz /= rl;
    var amp = len * 0.1 + 0.35;
    var pos = l.geometry.attributes.position.array;
    var n = 0;
    var seg = 8;
    for (var i = 0; i <= seg; i++) {
      var t = i / seg;
      var jit = (Math.random() - 0.5) * 2 * amp;
      pos[n++] = x - ux * len * t + rx * jit;
      pos[n++] = y - uy * len * t - rz * jit * 0.4;
      pos[n++] = z - uz * len * t + rz * jit;
    }
    // 两条侧向分支
    var mids = [0.35, 0.62];
    for (var b = 0; b < 2; b++) {
      var mt = mids[b];
      var bx = x - ux * len * mt, by = y - uy * len * mt, bz = z - uz * len * mt;
      var bend = Math.random() > 0.5 ? 1 : -1;
      pos[n++] = bx; pos[n++] = by; pos[n++] = bz;
      pos[n++] = bx + rx * bend * 1.5; pos[n++] = by - rz * bend * 1.5 * 0.4; pos[n++] = bz + rz * bend * 1.5;
    }
    l.geometry.setDrawRange(0, n);
    l.geometry.attributes.position.needsUpdate = true;
    l.material.color.setHex(col);
    l.material.opacity = 1;
    l.visible = true;
    l.userData.t = life || 0.16;
    l.userData.dur = l.userData.t;
  }
  function updateBolts(dt) {
    for (var i = 0; i < bolts.length; i++) {
      var l = bolts[i];
      if (!l.visible) continue;
      l.userData.t -= dt;
      if (l.userData.t <= 0) { l.visible = false; l.material.opacity = 0; continue; }
      // 生命周期内全程平滑渐隐
      l.material.opacity = Math.max(0, Math.min(1, l.userData.t / l.userData.dur));
    }
  }

  /* ---------------- 飞散部件 / 残骸 ---------------- */
  var flying = [];   // {obj, vx, vy, vz, ax, ay, az, t, dur, temp}
  var debrisPool = [], debrisIdx = 0;
  function initDebris() {
    var geo = new THREE.BoxGeometry(0.26, 0.2, 0.3);
    var mat = new THREE.MeshStandardMaterial({ color: 0x222a33, roughness: 0.8, metalness: 0.4 });
    for (var i = 0; i < 14; i++) {
      var m = new THREE.Mesh(geo, mat);
      m.visible = false;
      m.castShadow = false;
      scene.add(m);
      debrisPool.push(m);
    }
  }
  // 抛出任意 Object3D（如被炸飞的炮塔）
  function flyPart(obj, vx, vy, vz, dur, temp) {
    flying.push({
      obj: obj, vx: vx, vy: vy, vz: vz,
      ax: (Math.random() - 0.5) * 9, ay: (Math.random() - 0.5) * 7, az: (Math.random() - 0.5) * 9,
      t: 0, dur: dur || 2.2, temp: !!temp
    });
  }
  function debris(x, y, z, n, power) {
    for (var i = 0; i < n; i++) {
      var m = debrisPool[debrisIdx];
      debrisIdx = (debrisIdx + 1) % debrisPool.length;
      // 若该残骸已在飞行列表中，跳过重复登记
      removeFlying(m);
      m.visible = true;
      m.position.set(x, y, z);
      var a = Math.random() * Math.PI * 2;
      var sp = (3 + Math.random() * 5) * (power || 1);
      flyPart(m, Math.cos(a) * sp, 5 + Math.random() * 5 * (power || 1), Math.sin(a) * sp, 1.6 + Math.random(), true);
    }
  }
  function removeFlying(obj) {
    for (var i = flying.length - 1; i >= 0; i--) {
      if (flying[i].obj === obj) flying.splice(i, 1);
    }
  }
  function updateFlying(dt) {
    for (var i = flying.length - 1; i >= 0; i--) {
      var f = flying[i];
      f.t += dt;
      f.vy -= 16 * dt;
      var o = f.obj;
      o.position.x += f.vx * dt;
      o.position.y += f.vy * dt;
      o.position.z += f.vz * dt;
      o.rotation.x += f.ax * dt;
      o.rotation.y += f.ay * dt;
      o.rotation.z += f.az * dt;
      if (o.position.y < 0.25) {
        o.position.y = 0.25;
        f.vy = Math.abs(f.vy) * 0.3;
        f.vx *= 0.6; f.vz *= 0.6;
        f.ax *= 0.5; f.az *= 0.5;
      }
      if (f.t >= f.dur) {
        flying.splice(i, 1);
        if (f.temp) { o.visible = false; }
        else if (o.parent) { o.parent.remove(o); }
      }
    }
  }

  /* ---------------- 复合特效 ---------------- */

  function explosion(x, y, z, size) {
    var s = size || 1;
    // 核心闪光
    sparks.spawn(x, y, z, 0, 0, 0, 0.13, 3.2 * s, 1, 1, 0.95, 1, 0, 0, 1.5);
    sparks.spawn(x, y, z, 0, 0, 0, 0.2, 2.1 * s, 1, 0.7, 0.3, 1, 0, 0, 1.2);
    // 火花四溅
    var n = Math.round(24 * s * density);
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2;
      var el = Math.random() * Math.PI * 0.6;
      var sp = (4 + Math.random() * 11) * (0.7 + s * 0.4);
      sparks.spawn(
        x, y + 0.15, z,
        Math.cos(a) * Math.cos(el) * sp, Math.sin(el) * sp * 1.1, Math.sin(a) * Math.cos(el) * sp,
        0.25 + Math.random() * 0.5, 0.35 + Math.random() * 0.6 * s,
        1, 0.45 + Math.random() * 0.4, 0.12, 0.95,
        1.6, 9, 0
      );
    }
    // 烟
    var ns = Math.round(8 * s * density);
    for (var j = 0; j < ns; j++) {
      var aa = Math.random() * Math.PI * 2;
      var rr = Math.random() * 0.8 * s;
      var gr = 0.1 + Math.random() * 0.1;
      smoke.spawn(
        x + Math.cos(aa) * rr, y + 0.3 + Math.random() * 0.5, z + Math.sin(aa) * rr,
        (Math.random() - 0.5) * 1.6, 1.2 + Math.random() * 1.6, (Math.random() - 0.5) * 1.6,
        1.0 + Math.random() * 1.2, (1.1 + Math.random() * 0.9) * s,
        gr, gr, gr + 0.02, 0.36,
        0.9, -0.4, 2.6
      );
    }
    ringWave(x, 0.07, z, 3.1 * s, 0xffa25e, 0.5);
    flash(x, y + 0.6, z, 0xffa25e, 2.4 * s, 24 * s);
  }

  function tankExplosion(x, y, z, size) {
    var s = size || 1.5;
    explosion(x, y, z, s);
    ringWave(x, 0.07, z, 5.2 * s, 0x9ff3ff, 0.7);
    scorch(x, z, 2.0 * s);
    debris(x, y + 0.5, z, Math.round(5 * Math.min(1, density) * s), s * 0.8);
    // 火柱
    var n = Math.round(10 * density * s);
    for (var i = 0; i < n; i++) {
      sparks.spawn(
        x + (Math.random() - 0.5) * 1.2, y + Math.random() * 0.5, z + (Math.random() - 0.5) * 1.2,
        (Math.random() - 0.5) * 2, 6 + Math.random() * 8, (Math.random() - 0.5) * 2,
        0.35 + Math.random() * 0.45, 0.6 + Math.random() * 0.7,
        1, 0.6, 0.18, 0.95, 1.2, 7, 0
      );
    }
  }

  function trail(x, y, z, r, g, b) {
    sparks.spawn(x, y, z, 0, 0, 0, 0.16, 0.34, r, g, b, 0.55, 0, 0, 0);
  }

  function smokePuff(x, y, z) {
    var gr = 0.14 + Math.random() * 0.08;
    smoke.spawn(x, y, z, (Math.random() - 0.5) * 0.5, 0.5 + Math.random() * 0.5, (Math.random() - 0.5) * 0.5,
      0.5 + Math.random() * 0.4, 0.5, gr, gr, gr, 0.3, 0.5, -0.2, 2.0);
  }

  function hitSparks(x, y, z, nx, ny, nz) {
    var n = Math.round(8 * density);
    for (var i = 0; i < n; i++) {
      var sp = 3 + Math.random() * 8;
      sparks.spawn(
        x, y, z,
        nx * sp + (Math.random() - 0.5) * 5, ny * sp + Math.random() * 4, nz * sp + (Math.random() - 0.5) * 5,
        0.18 + Math.random() * 0.25, 0.28 + Math.random() * 0.3,
        1, 0.8, 0.35, 0.9, 2, 10, 0
      );
    }
  }

  // 出生传送特效
  function spawnBeacon(x, z, colorHex) {
    ringWave(x, 0.07, z, 4.2, colorHex, 0.9);
    flash(x, 2, z, colorHex, 1.8, 22);
    var col = new THREE.Color(colorHex);
    var n = Math.round(14 * density);
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, rr = 1.2 + Math.random() * 0.8;
      sparks.spawn(
        x + Math.cos(a) * rr, 0.1, z + Math.sin(a) * rr,
        0, 5 + Math.random() * 7, 0,
        0.4 + Math.random() * 0.5, 0.4 + Math.random() * 0.4,
        col.r, col.g, col.b, 0.85, 0.4, 0, 0
      );
    }
  }

  /* ---------------- 初始化 / 主更新 ---------------- */

  function init(sc, quality) {
    scene = sc;
    density = quality.density;
    sparks = new ParticlePool(Math.round(820 * Math.max(0.5, density)), THREE.AdditiveBlending);
    smoke = new ParticlePool(Math.round(360 * Math.max(0.5, density)), THREE.NormalBlending);
    scene.add(sparks.points);
    scene.add(smoke.points);
    initRings();
    initScorches();
    initFlashes();
    initMuzzles();
    initBolts();
    initDebris();
  }

  function update(dt) {
    sparks.update(dt);
    smoke.update(dt);
    updateRings(dt);
    updateScorches(dt);
    updateFlashes(dt);
    updateMuzzles(dt);
    updateBolts(dt);
    updateFlying(dt);
  }

  window.FX = {
    init: init,
    update: update,
    explosion: explosion,
    tankExplosion: tankExplosion,
    muzzleFlash: muzzleFlash,
    trail: trail,
    bolt: bolt,
    smokePuff: smokePuff,
    hitSparks: hitSparks,
    ringWave: ringWave,
    scorch: scorch,
    flash: flash,
    flyPart: flyPart,
    debris: debris,
    spawnBeacon: spawnBeacon,
    setDensity: function (d) { density = d; }
  };
})();
