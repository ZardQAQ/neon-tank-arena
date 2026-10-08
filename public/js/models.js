/* =========================================================
 * 霓虹装甲 · 程序化模型
 * 坦克（玩家 / 三种敌军）、炮弹、维修包、血条 —— 全部由
 * 基础几何体拼装，零外部资源。
 * ========================================================= */
(function () {
  'use strict';

  var PALETTES = {
    player: { body: 0x2b3a4a, dark: 0x18212c, track: 0x0d1116, accent: 0x29e6ff, shell: 0x9ff3ff },
    grunt:  { body: 0x4a2b2b, dark: 0x271617, track: 0x140f10, accent: 0xff4b3a, shell: 0xffb09a },
    scout:  { body: 0x4a3c22, dark: 0x272012, track: 0x14100a, accent: 0xffb02e, shell: 0xffd79a },
    heavy:  { body: 0x39284a, dark: 0x1e1527, track: 0x120d16, accent: 0xc44bff, shell: 0xe0aaff },
    /* 联机其他玩家配色（id 分配） */
    mp1: { body: 0x4a3a22, dark: 0x271f12, track: 0x14100a, accent: 0xffb02e, shell: 0xffd79a },
    mp2: { body: 0x4a2240, dark: 0x271223, track: 0x140a12, accent: 0xff3ec8, shell: 0xffa8de },
    mp3: { body: 0x224a30, dark: 0x122718, track: 0x0a1410, accent: 0x2eff8e, shell: 0xa8ffd0 },
    mp4: { body: 0x3a224a, dark: 0x1f1227, track: 0x0f0a14, accent: 0x9d5cff, shell: 0xd0b0ff },
    mp5: { body: 0x4a2b2b, dark: 0x271617, track: 0x140f10, accent: 0xff6a4a, shell: 0xffc0aa }
  };

  var SPECS = {
    player: { scale: 1.0,  barrelLen: 2.3, barrelR: 0.085 },
    grunt:  { scale: 1.0,  barrelLen: 2.0, barrelR: 0.08 },
    scout:  { scale: 0.82, barrelLen: 1.75, barrelR: 0.065 },
    heavy:  { scale: 1.3,  barrelLen: 2.6, barrelR: 0.115 }
  };

  /* ---------- 皮肤系统（玩家可选涂装，联机同步展示） ---------- */
  var SKINS = [
    // 默认/普通涂装
    { name: '霓虹青', body: 0x2b3a4a, dark: 0x18212c, track: 0x0d1116, accent: 0x29e6ff, shell: 0x9ff3ff, rarity: 'common', cat: 'body', icon: '🔵', source: '初始', owned: true },
    { name: '烈焰橙', body: 0x4a3322, dark: 0x271a10, track: 0x14100a, accent: 0xff7a2e, shell: 0xffd0a0, rarity: 'common', cat: 'body', icon: '🟠', source: '初始', owned: true },
    { name: '翡翠绿', body: 0x22402c, dark: 0x122518, track: 0x0a140d, accent: 0x2eff8e, shell: 0xa8ffd0, rarity: 'common', cat: 'body', icon: '🟢', source: '初始', owned: true },
    { name: '深海蓝', body: 0x22344c, dark: 0x121e2c, track: 0x0a1018, accent: 0x4d8cff, shell: 0xb0d0ff, rarity: 'common', cat: 'body', icon: '🔷', source: '七日登录', owned: true },
    { name: '丛林迷彩', body: 0x354028, dark: 0x1e2515, track: 0x0c1008, accent: 0x88aa44, shell: 0xbbd477, rarity: 'common', cat: 'body', icon: '🪖', source: '商店', owned: true },
    { name: '沙漠迷彩', body: 0x403828, dark: 0x252015, track: 0x12100a, accent: 0xcc9955, shell: 0xe6c888, rarity: 'common', cat: 'body', icon: '🎖️', source: '商店', owned: true },
    { name: '海军蓝', body: 0x1a2838, dark: 0x0c1520, track: 0x060a10, accent: 0x4477aa, shell: 0x88bbdd, rarity: 'common', cat: 'body', icon: '⚓', source: '商店', owned: true },
    // 稀有涂装
    { name: '皇家紫', body: 0x3a2a52, dark: 0x201530, track: 0x120d18, accent: 0x9d5cff, shell: 0xd0b0ff, rarity: 'rare', cat: 'body', icon: '🟣', source: '成就', owned: true },
    { name: '蔷薇粉', body: 0x4a2440, dark: 0x281222, track: 0x140a12, accent: 0xff3ec8, shell: 0xffa8de, rarity: 'rare', cat: 'body', icon: '💗', source: '活动', owned: true },
    { name: '耀金黄', body: 0x4a3d1e, dark: 0x272010, track: 0x141208, accent: 0xffd75e, shell: 0xfff0b0, rarity: 'rare', cat: 'body', icon: '⭐', source: '排名奖励', owned: true },
    { name: '幽灵白', body: 0x3c434c, dark: 0x20252b, track: 0x111418, accent: 0xe8f4ff, shell: 0xffffff, rarity: 'rare', cat: 'body', icon: '👻', source: '活动', owned: true },
    { name: '战地红', body: 0x472a28, dark: 0x261514, track: 0x130e0d, accent: 0xff4b5e, shell: 0xffb0b8, rarity: 'rare', cat: 'body', icon: '❤️', source: '击杀奖励', owned: true },
    { name: '酸液绿', body: 0x3a4422, dark: 0x20260f, track: 0x12160a, accent: 0xb8ff2e, shell: 0xe8ffa8, rarity: 'rare', cat: 'body', icon: '☢️', source: '商店', owned: true },
    { name: '黑金', body: 0x1a1a1e, dark: 0x0d0d10, track: 0x050507, accent: 0xffd700, shell: 0xfff0a0, rarity: 'rare', cat: 'body', icon: '🖤', source: 'VIP', owned: true },
    { name: '碳纤维', body: 0x252528, dark: 0x141416, track: 0x08080a, accent: 0xc0c0c8, shell: 0xe8e8f0, rarity: 'rare', cat: 'body', icon: '⬛', source: '商店', owned: true },
    // 史诗涂装
    { name: '熔岩', body: 0x2a1510, dark: 0x180a08, track: 0x0d0504, accent: 0xff3300, shell: 0xff8844, rarity: 'epic', cat: 'body', icon: '🔥', source: 'BOSS掉落', owned: true },
    { name: '冰霜', body: 0x1a2a35, dark: 0x0c1820, track: 0x060c12, accent: 0x88ddff, shell: 0xddf4ff, rarity: 'epic', cat: 'body', icon: '❄️', source: 'BOSS掉落', owned: true },
    { name: '紫罗兰', body: 0x301a3d, dark: 0x1c0d25, track: 0x0d0612, accent: 0xcc44ff, shell: 0xeeaaff, rarity: 'epic', cat: 'body', icon: '💜', source: '抽奖', owned: true },
    // 炮塔装饰
    { name: '突击头盔', body: 0x3a2a2a, dark: 0x201515, track: 0x0d0d10, accent: 0xff4444, shell: 0xff9999, rarity: 'common', cat: 'turret', icon: '⛑️', source: '七日登录', owned: true },
    { name: '牛仔帽', body: 0x4a3a28, dark: 0x282018, track: 0x12100a, accent: 0xd4a040, shell: 0xffd888, rarity: 'common', cat: 'turret', icon: '🤠', source: '已拥有', owned: true },
    { name: '贝雷帽', body: 0x2a3a4a, dark: 0x152028, track: 0x0a1014, accent: 0x4488cc, shell: 0x88bbff, rarity: 'common', cat: 'turret', icon: '🧢', source: '已拥有', owned: true },
    { name: '恶魔之角', body: 0x3a1a2a, dark: 0x200d15, track: 0x0d060a, accent: 0xcc44aa, shell: 0xff88dd, rarity: 'epic', cat: 'turret', icon: '😈', source: '已拥有', owned: true },
    { name: '卸下', body: 0x2b3a4a, dark: 0x18212c, track: 0x0d1116, accent: 0x29e6ff, shell: 0x9ff3ff, rarity: 'common', cat: 'turret', icon: '➖', source: '未装备', owned: true },
    // 炮管光效
    { name: '霓虹光束', body: 0x2b3a4a, dark: 0x18212c, track: 0x0d1116, accent: 0x29e6ff, shell: 0x9ff3ff, rarity: 'common', cat: 'barrel', icon: '💫', source: '初始', owned: true },
    { name: '烈焰喷射', body: 0x4a2a1a, dark: 0x28150d, track: 0x120a06, accent: 0xff6622, shell: 0xffaa66, rarity: 'rare', cat: 'barrel', icon: '🔥', source: '商店', owned: true },
    { name: '寒冰射线', body: 0x1a2a3a, dark: 0x0d1822, track: 0x060c14, accent: 0x66ddff, shell: 0xaaf0ff, rarity: 'rare', cat: 'barrel', icon: '🧊', source: '商店', owned: true },
    { name: '紫色电弧', body: 0x2a1a3a, dark: 0x150d22, track: 0x0a0614, accent: 0xaa44ff, shell: 0xcc88ff, rarity: 'epic', cat: 'barrel', icon: '⚡', source: 'BOSS掉落', owned: true },
    // 武器特效
    { name: '标准弹壳', body: 0x2b3a4a, dark: 0x18212c, track: 0x0d1116, accent: 0x29e6ff, shell: 0x9ff3ff, rarity: 'common', cat: 'effect', icon: '🔹', source: '初始', owned: true },
    { name: '曳光弹', body: 0x3a3a2a, dark: 0x202012, track: 0x0d0d06, accent: 0xdddd44, shell: 0xffff88, rarity: 'common', cat: 'effect', icon: '✨', source: '商店', owned: true },
    { name: '等离子弹', body: 0x2a2a4a, dark: 0x121228, track: 0x060614, accent: 0x44aaff, shell: 0x88ccff, rarity: 'rare', cat: 'effect', icon: '🔮', source: '活动', owned: true },
    { name: '核弹头', body: 0x4a1a1a, dark: 0x280d0d, track: 0x140606, accent: 0xff4422, shell: 0xff8866, rarity: 'epic', cat: 'effect', icon: '💥', source: '抽奖', owned: true }
  ];

  // ---------- 共享几何缓存 ----------
  var geoCache = {};
  function G(key, make) {
    if (!geoCache[key]) geoCache[key] = make();
    return geoCache[key];
  }
  function box(w, h, d) {
    var k = 'b' + w + ',' + h + ',' + d;
    return G(k, function () { return new THREE.BoxGeometry(w, h, d); });
  }
  function cyl(rt, rb, h, seg) {
    var k = 'c' + rt + ',' + rb + ',' + h + ',' + seg;
    return G(k, function () { return new THREE.CylinderGeometry(rt, rb, h, seg); });
  }

  function stdMat(color, rough, metal) {
    return new THREE.MeshStandardMaterial({ color: color, roughness: rough == null ? 0.6 : rough, metalness: metal == null ? 0.35 : metal });
  }
  function glowMat(color, intensity) {
    return new THREE.MeshStandardMaterial({
      color: 0x0a0d12, roughness: 0.4, metalness: 0.2,
      emissive: color, emissiveIntensity: intensity == null ? 1.4 : intensity
    });
  }

  // ---------- 光晕贴图（炮弹/粒子共用） ----------
  var glowTex = null;
  function getGlowTexture() {
    if (glowTex) return glowTex;
    var c = document.createElement('canvas');
    c.width = c.height = 64;
    var g = c.getContext('2d');
    var grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,.65)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    glowTex = new THREE.CanvasTexture(c);
    return glowTex;
  }

  /* =========================================================
   * 坦克
   * 返回 { group, turret, barrelPivot, muzzle, mats, radius, height, scale }
   * 前方为 +Z；turret.rotation.y 为炮塔相对车体角；
   * barrelPivot.rotation.x 控制俯仰。
   * ========================================================= */
  function createTank(role, skinIdx, extras) {
    var isMP = typeof role === 'string' && role.indexOf('mp') === 0;   // 联机玩家坦克
    var P = PALETTES[role] || PALETTES.grunt;
    // 皮肤覆盖：玩家坦克（含联机其他玩家）可用皮肤涂装
    if (skinIdx != null && SKINS[skinIdx] && (role === 'player' || isMP)) {
      P = SKINS[skinIdx];
    }
    // 玩家可选三种车体（猎手/疾袭/重装），敌军仍按 role 取规格
    var chassis = (extras && extras.chassis) || role;
    if (chassis === 'grunt') chassis = 'player';
    var S = SPECS[chassis] || (isMP ? SPECS.player : SPECS.grunt);
    var isHeavyHull = chassis === 'heavy' || role === 'heavy';
    var group = new THREE.Group();
    var anims = [];   // 皮肤动效：每帧由 updateSkin(t) 驱动

    var matBody = stdMat(P.body, 0.55, 0.4);
    var matDark = stdMat(P.dark, 0.5, 0.5);
    var matTrack = stdMat(P.track, 0.9, 0.1);
    var matAccent = glowMat(P.accent, 1.5);

    function add(parent, geo, mat, x, y, z, opt) {
      var m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      if (opt) {
        if (opt.rx) m.rotation.x = opt.rx;
        if (opt.ry) m.rotation.y = opt.ry;
        if (opt.rz) m.rotation.z = opt.rz;
        if (opt.sx) m.scale.x = opt.sx;
        if (opt.sy) m.scale.y = opt.sy;
        if (opt.sz) m.scale.z = opt.sz;
      }
      m.castShadow = !(opt && opt.noShadow);
      m.receiveShadow = true;
      parent.add(m);
      return m;
    }

    // ---- 履带 ----
    [-1.02, 1.02].forEach(function (x) {
      add(group, box(0.62, 0.56, 3.5), matTrack, x, 0.33, 0);
      // 路轮
      for (var i = 0; i < 4; i++) {
        add(group, cyl(0.27, 0.27, 0.66, 10), matDark, x, 0.28, -1.2 + i * 0.8, { rz: Math.PI / 2, noShadow: true });
      }
      // 侧裙板 + 霓虹条
      add(group, box(0.08, 0.3, 3.4), matBody, x * 1.32, 0.72, 0);
      add(group, box(0.05, 0.09, 2.9), matAccent, x * 1.37, 0.85, 0, { noShadow: true });
    });

    // ---- 车体 ----
    add(group, box(1.78, 0.56, 3.3), matBody, 0, 0.8, 0);
    add(group, box(1.62, 0.14, 2.3), matDark, 0, 1.13, -0.2);
    add(group, box(1.72, 0.16, 1.2), matBody, 0, 1.02, 1.32, { rx: -0.42 });  // 前倾斜装甲
    add(group, box(1.72, 0.16, 1.0), matBody, 0, 1.0, -1.42, { rx: 0.38 });   // 尾板
    // 车灯
    add(group, box(0.22, 0.08, 0.06), matAccent, 0.58, 0.92, 1.68, { noShadow: true });
    add(group, box(0.22, 0.08, 0.06), matAccent, -0.58, 0.92, 1.68, { noShadow: true });
    // 排气管
    add(group, cyl(0.07, 0.07, 0.5, 8), matDark, 0.62, 1.12, -1.6, { rx: 1.1, noShadow: true });
    if (isHeavyHull) {
      add(group, cyl(0.07, 0.07, 0.5, 8), matDark, -0.62, 1.12, -1.6, { rx: 1.1, noShadow: true });
      add(group, box(0.2, 0.5, 2.6), matDark, 1.0, 0.85, 0);   // 附加装甲
      add(group, box(0.2, 0.5, 2.6), matDark, -1.0, 0.85, 0);
    }

    // ---- 炮塔 ----
    var turret = new THREE.Group();
    turret.position.set(0, 1.24, -0.1);
    group.add(turret);

    add(turret, cyl(0.72, 0.86, 0.36, 14), matBody, 0, 0.12, 0);
    var dome = add(turret, new THREE.SphereGeometry(0.62, 14, 10), matDark, 0, 0.3, 0, { sy: 0.6 });
    dome.castShadow = true;
    add(turret, cyl(0.19, 0.19, 0.1, 10), matDark, 0.26, 0.55, -0.18, { noShadow: true });
    // 炮塔霓虹环
    var ring = new THREE.Mesh(G('torus', function () { return new THREE.TorusGeometry(0.56, 0.028, 8, 28); }), matAccent);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.34;
    turret.add(ring);
    // 防盾
    add(turret, box(0.52, 0.4, 0.4), matBody, 0, 0.16, 0.68);

    // ---- 炮管（俯仰轴） ----
    var barrelPivot = new THREE.Group();
    barrelPivot.position.set(0, 0.18, 0.62);
    turret.add(barrelPivot);

    var bl = S.barrelLen, br = S.barrelR;
    add(barrelPivot, cyl(br, br * 1.15, bl, 10), stdMat(P.dark, 0.45, 0.55), 0, 0, bl / 2, { rx: Math.PI / 2 });
    add(barrelPivot, cyl(br * 1.5, br * 1.5, 0.3, 10), matDark, 0, 0, bl - 0.1, { rx: Math.PI / 2 });
    add(barrelPivot, cyl(br * 1.25, br * 1.25, 0.24, 10), matAccent, 0, 0, bl - 0.42, { rx: Math.PI / 2, noShadow: true });

    var muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0, bl + 0.12);
    barrelPivot.add(muzzle);

    // ---- 装备挂件：炮塔装饰 + 炮管光效（extras = { turret, barrel, effect }） ----
    if (extras) {
      var tSk = (extras.turret != null && extras.turret >= 0) ? SKINS[extras.turret] : null;
      if (tSk && tSk.cat === 'turret') {
        var hatMat = stdMat(tSk.body, 0.5, 0.3);
        var hatGlow = glowMat(tSk.accent, 1.3);
        if (tSk.name === '突击头盔') {
          var helm = add(turret, new THREE.SphereGeometry(0.52, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), hatMat, 0, 0.58, 0, { sy: 0.75 });
          helm.castShadow = true;
          add(turret, cyl(0.55, 0.58, 0.06, 14), hatGlow, 0, 0.6, 0, { noShadow: true });
        } else if (tSk.name === '牛仔帽') {
          add(turret, cyl(0.62, 0.66, 0.05, 14), hatMat, 0, 0.57, 0);
          add(turret, cyl(0.3, 0.34, 0.26, 12), hatMat, 0, 0.7, 0);
          add(turret, cyl(0.34, 0.34, 0.05, 12), hatGlow, 0, 0.58, 0, { noShadow: true });
        } else if (tSk.name === '贝雷帽') {
          add(turret, new THREE.SphereGeometry(0.5, 12, 8), hatMat, 0.04, 0.64, -0.06, { sy: 0.36, rz: 0.18 });
        } else if (tSk.name === '恶魔之角') {
          add(turret, cyl(0.16, 0.2, 0.06, 10), hatMat, 0, 0.62, 0);
          add(turret, new THREE.ConeGeometry(0.09, 0.44, 8), hatGlow, 0.26, 0.88, 0, { rz: -0.5, noShadow: true });
          add(turret, new THREE.ConeGeometry(0.09, 0.44, 8), hatGlow, -0.26, 0.88, 0, { rz: 0.5, noShadow: true });
        }
      }
      var bSk = (extras.barrel != null && extras.barrel >= 0) ? SKINS[extras.barrel] : null;
      if (bSk && bSk.cat === 'barrel') {
        var bGlow = glowMat(bSk.accent, 2.0);
        var bPhase = (bSk.name.length + (bSk.rarity === 'epic' ? 2 : 0)) % 6;
        // 炮管能量环（沿炮管分布，能量流转）
        var rings = [];
        var defR = [0.34, 0.48, 0.66];
        defR.forEach(function (f, i) {
          var r = new THREE.Mesh(new THREE.TorusGeometry(br * 1.62 * f, 0.032, 6, 22), bGlow);
          r.position.set(0, 0, bl * 0.3 + i * bl * 0.28);
          r.userData.phase = i * 2.1;
          barrelPivot.add(r);
          rings.push(r);
        });
        // 炮口聚能球
        var tip = new THREE.Mesh(new THREE.SphereGeometry(br * 1.2, 12, 8), bGlow);
        tip.position.set(0, 0, bl - 0.05);
        tip.scale.z = 1.6;
        barrelPivot.add(tip);
        // 动效：呼吸发光 + 能量环脉冲 + 聚能球搏动（按品质增幅）
        var epic = bSk.rarity === 'epic' ? 1.35 : (bSk.rarity === 'rare' ? 1.15 : 1);
        anims.push(function (t) {
          var w = t * 3.1 + bPhase;
          bGlow.emissiveIntensity = (1.6 + 0.9 * Math.sin(w)) * epic;
          for (var i = 0; i < rings.length; i++) {
            var pr = 0.9 + 0.16 * Math.sin(w + rings[i].userData.phase);
            rings[i].scale.set(pr, pr, 1);
          }
          var pt = 0.82 + 0.18 * Math.sin(w * 1.6 + 1.2);
          tip.scale.set(pt, pt, 1.6 * pt);
        });
      }
    }

    // ---- 天线 ----
    if (role === 'player' || role === 'scout' || isMP || chassis === 'scout') {
      add(turret, cyl(0.015, 0.015, 0.9, 5), matDark, -0.45, 0.8, -0.35, { noShadow: true });
      add(turret, new THREE.SphereGeometry(0.045, 8, 6), matAccent, -0.45, 1.26, -0.35, { noShadow: true });
    }

    group.scale.setScalar(S.scale);

    // 武器光效皮肤覆盖炮弹颜色
    var effSk = (extras && extras.effect != null && extras.effect >= 0) ? SKINS[extras.effect] : null;
    var shellColorFinal = (effSk && effSk.cat === 'effect') ? effSk.shell : P.shell;

    return {
      group: group,
      turret: turret,
      barrelPivot: barrelPivot,
      muzzle: muzzle,
      mats: { body: matBody, dark: matDark, accent: matAccent, track: matTrack },
      accentColor: P.accent,
      shellColor: shellColorFinal,
      radius: 1.6 * S.scale,
      height: 2.15 * S.scale,
      scale: S.scale,
      // 皮肤动效驱动（每帧传入已流逝秒数）
      updateSkin: function (t) {
        for (var i = 0; i < anims.length; i++) anims[i](t);
      }
    };
  }

  /* ---------- 炮弹 ---------- */
  var shellGeo = null;
  var shellMats = {};   // 按颜色缓存
  function createShell(colorHex) {
    if (!shellGeo) shellGeo = new THREE.CylinderGeometry(0.055, 0.075, 0.55, 8);
    if (!shellMats[colorHex]) {
      shellMats[colorHex] = {
        core: new THREE.MeshBasicMaterial({ color: colorHex }),
        sprite: new THREE.SpriteMaterial({
          map: getGlowTexture(), color: colorHex,
          blending: THREE.AdditiveBlending, depthWrite: false, transparent: true
        })
      };
    }
    var m = shellMats[colorHex];
    var grp = new THREE.Group();
    var core = new THREE.Mesh(shellGeo, m.core);
    core.rotation.x = Math.PI / 2;
    grp.add(core);
    var glow = new THREE.Sprite(m.sprite);
    glow.scale.set(0.9, 0.9, 1);
    grp.add(glow);
    return grp;
  }

  /* ---------- 维修包 ---------- */
  var crateMats = null;
  function createCrate() {
    if (!crateMats) {
      crateMats = {
        body: stdMat(0x14261c, 0.5, 0.3),
        glow: glowMat(0x2eff8e, 1.6)
      };
    }
    var grp = new THREE.Group();
    var b = new THREE.Mesh(box(0.8, 0.8, 0.8), crateMats.body);
    b.castShadow = true;
    grp.add(b);
    var c1 = new THREE.Mesh(box(0.86, 0.24, 0.24), crateMats.glow);
    var c2 = new THREE.Mesh(box(0.24, 0.24, 0.86), crateMats.glow);
    grp.add(c1); grp.add(c2);
    var glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getGlowTexture(), color: 0x2eff8e,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.5
    }));
    glow.scale.set(2.4, 2.4, 1);
    grp.add(glow);
    return grp;
  }

  /* ---------- 敌方血条（Sprite） ---------- */
  function createHPBar() {
    var c = document.createElement('canvas');
    c.width = 72; c.height = 10;
    var g = c.getContext('2d');
    var tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
    sp.scale.set(2.1, 0.3, 1);
    function set(pct) {
      pct = Math.max(0, Math.min(1, pct));
      g.clearRect(0, 0, 72, 10);
      g.fillStyle = 'rgba(5,10,16,.75)';
      g.fillRect(0, 0, 72, 10);
      g.strokeStyle = 'rgba(140,200,230,.45)';
      g.strokeRect(0.5, 0.5, 71, 9);
      var col = pct > 0.55 ? '#ff4b3a' : pct > 0.25 ? '#ff7a30' : '#ffb02e';
      g.fillStyle = col;
      g.fillRect(2, 2, 68 * pct, 6);
      tex.needsUpdate = true;
    }
    set(1);
    return { sprite: sp, set: set, dispose: function () { tex.dispose(); sp.material.dispose(); } };
  }

  /* ---------- 联机名牌（昵称 + 血条） ---------- */
  function createNamePlate(name, colorCss) {
    var c = document.createElement('canvas');
    c.width = 160; c.height = 44;
    var g = c.getContext('2d');
    var tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
    sp.scale.set(4.4, 1.21, 1);
    var lastPct = -1;
    function draw(pct) {
      g.clearRect(0, 0, 160, 44);
      g.font = 'bold 17px "Microsoft YaHei", sans-serif';
      g.textAlign = 'center';
      g.fillStyle = 'rgba(0,0,0,.55)';
      g.fillText(name, 81, 19);
      g.fillStyle = colorCss || '#9ff3ff';
      g.fillText(name, 80, 18);
      // 血条
      g.fillStyle = 'rgba(0,0,0,.6)';
      g.fillRect(36, 26, 88, 9);
      g.fillStyle = pct > 0.3 ? '#2eff8e' : '#ff4b3a';
      g.fillRect(38, 28, 84 * Math.max(0, Math.min(1, pct)), 5);
      tex.needsUpdate = true;
    }
    draw(1);
    return {
      sprite: sp,
      set: function (pct) {
        pct = Math.max(0, Math.min(1, pct));
        if (Math.abs(pct - lastPct) < 0.02) return;
        lastPct = pct;
        draw(pct);
      },
      dispose: function () {
        if (sp.parent) sp.parent.remove(sp);
        tex.dispose();
        sp.material.dispose();
      }
    };
  }

  window.TankModels = {
    createTank: createTank,
    createShell: createShell,
    createCrate: createCrate,
    createHPBar: createHPBar,
    createNamePlate: createNamePlate,
    getGlowTexture: getGlowTexture,
    PALETTES: PALETTES,
    SKINS: SKINS
  };
})();
