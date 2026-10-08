/* =========================================================
 * 霓虹装甲 · NEON TANK ARENA
 * 3D 坦克射击对战 —— 主逻辑
 * 纯前端本地运行：第三人称、AI 敌军、多波次、计分与本地最高分。
 * ========================================================= */
(function () {
  'use strict';

  /* ================= 工具 ================= */

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function angDiff(a, b) {
    var d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  }
  function approachAngle(cur, target, maxStep) {
    var d = angDiff(cur, target);
    if (Math.abs(d) <= maxStep) return target;
    return cur + (d > 0 ? maxStep : -maxStep);
  }
  function approach(cur, target, maxStep) {
    if (cur < target) return Math.min(target, cur + maxStep);
    return Math.max(target, cur - maxStep);
  }
  function $(id) { return document.getElementById(id); }
  function show(el) { if (el) el.classList.remove('hidden'); }
  function hide(el) { if (el) el.classList.add('hidden'); }

  /* ================= 常量 / 配置 ================= */

  var SHELL_G = 4.5;          // 炮弹重力
  var RADAR_RANGE = 70;

  var PL = {
    maxHp: 120, speed: 9.5, reverse: 5.5, turn: 2.3,
    turretSpeed: 3.4, reload: 0.95, dmg: 30,
    splashR: 3.4, splashDmg: 12, shellSpeed: 60
  };

  /* 玩家可选载具：猎手 / 疾袭 / 重装（与敌军同款车体，数值按玩家平衡） */
  var VEHICLE_TYPES = {
    grunt: {
      id: 'grunt', name: '猎手坦克', short: '猎手', tag: '均衡',
      maxHp: 120, speed: 9.5, reverse: 5.5, turn: 2.3,
      turretSpeed: 3.4, reload: 0.95, dmg: 30,
      splashR: 3.4, splashDmg: 12, shellSpeed: 60
    },
    scout: {
      id: 'scout', name: '疾袭坦克', short: '疾袭', tag: '机动',
      maxHp: 80, speed: 16.8, reverse: 9.6, turn: 3.8,
      turretSpeed: 4.4, reload: 0.72, dmg: 22,
      splashR: 2.6, splashDmg: 8, shellSpeed: 68
    },
    heavy: {
      id: 'heavy', name: '重装坦克', short: '重装', tag: '重甲',
      maxHp: 200, speed: 6.0, reverse: 3.5, turn: 1.5,
      turretSpeed: 2.2, reload: 1.45, dmg: 48,
      splashR: 4.6, splashDmg: 20, shellSpeed: 48
    }
  };

  var ENEMY_TYPES = {
    grunt: { name: '猎手坦克', hp: 55, speed: 5.4, turn: 1.7, turretSpeed: 1.7, reload: 2.9, dmg: 12, shellSpeed: 40, aimErr: 0.05, detect: 52, near: 16, far: 30, fireRange: 48, score: 100, drop: 0.18 },
    scout: { name: '疾袭坦克', hp: 38, speed: 8.6, turn: 2.7, turretSpeed: 2.3, reload: 2.2, dmg: 9, shellSpeed: 44, aimErr: 0.062, detect: 60, near: 11, far: 19, fireRange: 40, score: 130, drop: 0.22 },
    heavy: { name: '重装坦克', hp: 175, speed: 3.4, turn: 1.15, turretSpeed: 1.05, reload: 3.9, dmg: 26, shellSpeed: 36, aimErr: 0.035, detect: 60, near: 18, far: 34, fireRange: 52, score: 280, drop: 0.6 }
  };

  function waveComp(n) {
    var list = [];
    var g = Math.min(2 + n, 8);
    for (var i = 0; i < g; i++) list.push('grunt');
    if (n >= 3) { var s = Math.min(1 + ((n - 3) >> 1), 4); for (var j = 0; j < s; j++) list.push('scout'); }
    if (n >= 5) { var h = Math.min(1 + Math.floor((n - 5) / 3), 3); for (var k = 0; k < h; k++) list.push('heavy'); }
    return list;
  }
  function hpMult() { return 1 + (wave - 1) * 0.07; }
  function dmgMult() { return 1 + (wave - 1) * 0.045; }
  function scoreMult() { return 1 + (wave - 1) * 0.08; }

  /* ================= 设备 / 品质 ================= */

  var IS_TOUCH = (function () {
    var m = /[?&]touch=([01])/.exec(location.search);
    if (m) return m[1] === '1';
    if (window.matchMedia && matchMedia('(pointer: coarse)').matches) return true;
    if (navigator.maxTouchPoints > 0 && window.matchMedia && matchMedia('(hover: none)').matches) return true;
    return false;
  })();
  document.body.classList.toggle('mobile', IS_TOUCH);

  var QUALITY = (function () {
    if (!IS_TOUCH) return { maxPR: 2.0, shadow: 2048, density: 1.0, aa: true };
    var hwc = navigator.hardwareConcurrency || 4;
    var mem = navigator.deviceMemory || 4;
    if (hwc <= 4 || mem <= 3) return { maxPR: 1.15, shadow: 512, density: 0.55, aa: false };
    return { maxPR: 1.5, shadow: 1024, density: 0.7, aa: true };
  })();

  /* ================= 舞台：canvas 直接填满窗口（参考 legacy 零区冲突） ================= */

  var Stage = {
    el: null, s: 1, LW: 1280, LH: 720, portrait: false,
    resize: function () {
      var w = window.innerWidth, h = window.innerHeight;
      if (w <= 0 || h <= 0) return;
      this.portrait = h > w;
      this.LW = w; this.LH = h;
      this.s = 1;
      var el = this.el;
      if (el) {
        el.style.width = w + 'px';
        el.style.height = h + 'px';
        el.classList.toggle('portrait', this.portrait);
      }
      document.body.classList.toggle('portrait', this.portrait);
      if (renderer && camera) {
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY.maxPR));
        renderer.setSize(w, h, false);
        var cv = renderer.domElement;
        cv.style.width = w + 'px';
        cv.style.height = h + 'px';
        camera.aspect = w / h;
        if (!aimFirstPerson()) {
          camera.fov = baseFov;
          camera.updateProjectionMatrix();
        } else {
          camera.updateProjectionMatrix();
        }
      }
    },
    toLocal: function (cx, cy) {
      return { x: cx, y: cy };
    }
  };

  /* ================= 三维基础 ================= */

  var renderer = null, scene = null, camera = null;
  var tmpA = null, tmpB = null, tmpC = null, aimPoint = null;
  var baseFov = 62, inputZoom = 0, aimHeld = false;   // 右键开镜

  function initThree() {
    var canvas = $('game-canvas');
    renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: QUALITY.aa,
      powerPreference: IS_TOUCH ? 'default' : 'high-performance',
      alpha: false
    });
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY.maxPR));
    if (QUALITY.shadow > 0) {
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = QUALITY.aa ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    }
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(62, Math.max(0.1, window.innerWidth / Math.max(1, window.innerHeight)), 0.1, 700);
    tmpA = new THREE.Vector3();
    tmpB = new THREE.Vector3();
    tmpC = new THREE.Vector3();
    aimPoint = new THREE.Vector3();
    canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); });
    canvas.addEventListener('webglcontextrestored', function () { Stage.resize(); });
  }

  /* ================= 状态 ================= */

  var phase = 'menu';        // menu | playing | paused | dying | over | mpdead
  var score = 0, kills = 0, wave = 0, playTime = 0;
  var timeScale = 1, dieT = 0, elapsed = 0;
  var trauma = 0, dmgVig = 0, healVig = 0;
  var best = { score: 0, wave: 0, kills: 0 };
  var BEST_KEY = 'neonTankArena.best.v1';
  var NICK_KEY = 'neonTankArena.nick.v1';
  var SKIN_KEY = 'neonTankArena.skin.v1';
  var EQUIP_KEY = 'neonTankArena.equip.v1';
  var VEH_KEY = 'neonTankArena.veh.v1';
  var mySkin = 0;                 // 当前选中皮肤索引（车身涂装）
  var myVeh = 'grunt';            // 当前载具：grunt | scout | heavy
  var pendingEnter = null;        // 进场选车：'sp' | 'mp'
  var tempSkin = 0;               // 弹窗中临时选中的皮肤
  var skinModalOpen = false;
  var skinPage = 0;
  var skinCat = 'all';            // 当前分类：all/body/turret/barrel/effect
  var SKINS_PER_PAGE = 6;         // 每页6个（3x2布局，参考零区冲突）
  var equippedSkins = { body: 0, turret: -1, barrel: 0, effect: 0 };  // 各部位已装备
  var previewRenderer = null, previewScene = null, previewCamera = null, previewTank = null;
  var previewAnimY = 0;

  var player = null;
  var enemies = [];
  var shells = [];
  var pickups = [];
  var floats = [];

  // 波次
  var waveQueue = [], wavePending = [], waveMaxAlive = 3;
  var inPrep = false, prepT = 0, spawnTick = 0;

  // 相机
  var camYaw = Math.PI, camPitch = 0.12, camDist = 11, camDistSmooth = 11;
  var wantCamYaw = camYaw, wantCamPitch = camPitch;
  function aimFirstPerson() { return inputZoom > 0.5 && phase === 'playing' && !IS_TOUCH; }

  // 输入
  var keys = {};
  var fireHeld = false, fireBuffer = 0;
  var lockExitIgnore = false;
  var lookArmedAt = 0;            // 刚锁定指针后短暂忽略，避免首帧尖峰
  var playerVelX = 0, playerVelZ = 0;

  // 触屏
  var stickId = null, stickBaseX = 0, stickBaseY = 0, stickX = 0, stickY = 0, stickLen = 0;
  var aimId = null, aimLastX = 0, aimLastY = 0;

  /* ================= 联机状态 ================= */

  var mp = false;                 // 联机模式标志
  var mpWantMode = 'pvp';         // 想进入的模式
  var mpRoomId = 'official';      // 当前房间
  var mpRoomPass = '';
  var mpLobby = false;            // 是否处于房间大厅（已连接但未进入战斗）
  var mpSpectate = false;         // 是否观战模式
  var mpWantSpectate = false;     // 是否希望连接成功后直接观战
  var mpWantBattle = false;       // 是否希望连接成功后直接进入战斗
  var mpRoomName = '官方房';       // 当前房间名（大厅显示）
  var mpLobbyT = 0;               // 大厅快照刷新节流
  var others = [];                // 其他玩家渲染对象
  var mpTempPickups = [];         // 服务器临时掉落（AI 掉修理包）
  var mpPickMeshes = {};          // 固定点位道具 idx -> {mesh, kind, active}
  var mpInputT = 0;               // 输入发送节流
  var mpCorr = { x: 0, z: 0, yaw: 0, init: false };   // 服务器权威位置（软校正）
  var mpSpawned = false;      // 本局是否已在服务器出生过（避免大厅 alive=0 被误判阵亡）
  var mpSnapCount = 0;
  var mpRespawnMax = 3;
  var mpRespawnLeft = 0;
  var mpWaveLeft = 0;
  var mpBoardRows = [];           // 计分板缓存
  var chatOpen = false;
  var CHAT_DISABLED = true;   // 未登录用户不能发言
  var scoreboardOpen = false;

  // Linux DO 登录态
  var auth = { loggedIn: false, user: null, loginUrl: '' };

  /* ================= DOM 引用 ================= */

  var ui = {};
  function grabDom() {
    ['hud', 'touch-ui', 'stick-base', 'stick-knob', 'hp-fill', 'hp-num', 'hp-label', 'wave-chip', 'wave-num', 'enemy-left',
     'score-num', 'best-num', 'crosshair', 'scope-overlay', 'reload-bar', 'reload-fill', 'barrel-dot', 'radar',
     'killfeed', 'float-layer', 'banner', 'banner-main', 'banner-sub', 'dmg-vignette', 'heal-vignette',
     'screen-start', 'screen-pause', 'screen-over', 'screen-veh', 'start-best-score', 'start-best-wave',
     'start-panel',
     'over-score', 'over-kills', 'over-wave', 'over-time', 'over-best', 'new-record',
     'help-pc', 'help-touch',
     'chat-box', 'chat-list', 'chat-input', 'chat-input-row', 'chat-send', 'score-board', 'sb-table', 'sb-mode',
     'mp-chip', 'respawn-tip', 'nick-input', 'mp-status', 'menu-board',
     'skin-modal', 'skin-grid', 'skin-page-info', 'skin-prev', 'skin-next',
     'skin-cats', 'preview-name', 'coin-num', 'skin-preview-canvas',
     'btn-skin', 'btn-daily', 'btn-watch', 'btn-about', 'btn-more',
     'about-modal', 'more-modal',
     'oauth-status', 'oauth-session', 'oauth-tip', 'btn-nl-login', 'btn-nl-logout',
     'room-list', 'btn-refresh-rooms', 'btn-create-room',
     'room-modal', 'room-modal-title', 'room-name-input', 'room-pass-input', 'room-modal-err', 'room-modal-ok',
     'mb-list', 'online-num', 'tg-music-start', 'tg-sfx-start',
     'lobby-info', 'lobby-room-name', 'lobby-mode-name', 'lobby-player-count',
     'lobby-players', 'lobby-player-list',
     'btn-board-all', 'mb-all-panel', 'mb-daily-panel', 'mb-daily-list',
     'btn-daily-claim', 'daily-kills', 'daily-wave5', 'daily-claim-tip', 'daily-bar-fill',
     'player-info', 'oauth-avatar',
     'home-claim', 'btn-home-claim', 'nl-slots-left', 'nl-slots-limit', 'home-claim-tip',
     'claim-progress-num', 'claim-progress-label', 'claim-bar-fill', 'claim-alt',
     't-fire', 't-chat', 't-board'].forEach(function (id) {
      ui[id] = $(id);
    });
    ui.radarCtx = ui.radar ? ui.radar.getContext('2d') : null;
  }

  /* ================= 玩家 ================= */

  // 各部位装备索引（供 createTank 挂载炮塔装饰/炮管光效/弹色）
  function equipExtras() {
    return { turret: equippedSkins.turret, barrel: equippedSkins.barrel, effect: equippedSkins.effect, chassis: myVeh };
  }

  function copyVehToPL(cfg) {
    PL.maxHp = cfg.maxHp;
    PL.speed = cfg.speed;
    PL.reverse = cfg.reverse;
    PL.turn = cfg.turn;
    PL.turretSpeed = cfg.turretSpeed;
    PL.reload = cfg.reload;
    PL.dmg = cfg.dmg;
    PL.splashR = cfg.splashR;
    PL.splashDmg = cfg.splashDmg;
    PL.shellSpeed = cfg.shellSpeed;
  }

  function battleCamForVeh() {
    var d = myVeh === 'heavy' ? 13 : myVeh === 'scout' ? 9.5 : 11;
    camDist = d; camDistSmooth = d;
  }

  function menuCamForVeh() {
    var d = myVeh === 'heavy' ? 8.4 : myVeh === 'scout' ? 6.4 : 7;
    camDist = d; camDistSmooth = d;
  }

  function syncVehPickerUI() {
    var cards = document.querySelectorAll('.veh-card');
    for (var i = 0; i < cards.length; i++) {
      cards[i].classList.toggle('on', cards[i].getAttribute('data-veh') === myVeh);
    }
    if (ui['hp-label']) ui['hp-label'].textContent = (VEHICLE_TYPES[myVeh] || VEHICLE_TYPES.grunt).short;
  }

  function rebuildPlayerTank() {
    if (!player || !scene) return;
    var vis = player.model.group.visible;
    scene.remove(player.model.group);
    var t = TankModels.createTank('player', mySkin, equipExtras());
    scene.add(t.group);
    player.model = t;
    player.radius = t.radius;
    player.height = t.height;
    player.model.group.visible = vis;
    syncPlayerModel();
  }

  function applyVehicle(type, opts) {
    opts = opts || {};
    if (!VEHICLE_TYPES[type]) type = 'grunt';
    var changed = myVeh !== type;
    myVeh = type;
    var cfg = VEHICLE_TYPES[type];
    copyVehToPL(cfg);
    try { localStorage.setItem(VEH_KEY, type); } catch (e) { }
    if (player) {
      if (changed || opts.rebuild) rebuildPlayerTank();
      player.maxHp = cfg.maxHp;
      if (phase === 'menu' || phase === 'mpdead' || phase === 'over' || !player.alive) {
        player.hp = cfg.maxHp;
      } else {
        player.hp = Math.min(player.hp, cfg.maxHp);
      }
    }
    if (phase === 'menu') menuCamForVeh();
    else if (phase === 'playing' || phase === 'mpdead') battleCamForVeh();
    syncVehPickerUI();
    if (cache) cache.hp = -1;
    if (player) updateHpUI();
  }

  function openVehSelect(kind) {
    pendingEnter = kind;
    syncVehPickerUI();
    if (ui['screen-veh']) show(ui['screen-veh']);
  }

  function closeVehSelect() {
    pendingEnter = null;
    if (ui['screen-veh']) hide(ui['screen-veh']);
  }

  function commitEnter() {
    var kind = pendingEnter;
    closeVehSelect();
    if (kind === 'mp') enterBattleFromLobby();
    else if (kind === 'sp') startGame('sp');
  }

  function selectVehicle(type) {
    if (!VEHICLE_TYPES[type]) return;
    if (!pendingEnter) return;
    applyVehicle(type);
    if (Net.active && mpLobby) Net.setVeh(type);
    commitEnter();
  }

  function createPlayer() {
    var t = TankModels.createTank('player', mySkin, equipExtras());
    scene.add(t.group);
    player = {
      model: t, pos: new THREE.Vector3(0, 0, 0),
      hullYaw: 0, vel: 0, hp: PL.maxHp, maxHp: PL.maxHp,
      reload: 0, prevReload: 0, alive: true,
      turretYawW: 0, elev: 0, recoil: 0,
      radius: t.radius, height: t.height
    };
  }

  function syncPlayerModel() {
    var g = player.model.group;
    g.position.set(player.pos.x, 0, player.pos.z);
    g.rotation.y = player.hullYaw;
    player.model.turret.rotation.y = player.turretYawW - player.hullYaw;
    player.model.barrelPivot.rotation.x = -player.elev;
    player.model.barrelPivot.position.z = 0.62 - player.recoil;
  }

  function updatePlayer(dt) {
    var driveTarget = 0, turning = 0;

    if (IS_TOUCH) {
      if (stickLen > 0.12) {
        var turn = clamp(-stickX * 1.7, -1, 1);
        player.hullYaw += turn * PL.turn * dt;
        turning = Math.abs(turn);
        driveTarget = stickY > 0 ? PL.speed * stickLen : -PL.reverse * stickLen;
      }
    } else {
      var turn = (keys.KeyA ? 1 : 0) - (keys.KeyD ? 1 : 0);
      player.hullYaw += turn * PL.turn * dt;
      turning = Math.abs(turn);
      driveTarget = (keys.KeyW ? PL.speed : 0) + (keys.KeyS ? -PL.reverse : 0);
    }

    player.vel = approach(player.vel, driveTarget, (driveTarget !== 0 ? 15 : 22) * dt);
    var nx = player.pos.x + Math.sin(player.hullYaw) * player.vel * dt;
    var nz = player.pos.z + Math.cos(player.hullYaw) * player.vel * dt;
    var rc = World.resolveCircle(nx, nz, player.radius * 0.88);
    player.pos.x = rc.x;
    player.pos.z = rc.z;
    playerVelX = Math.sin(player.hullYaw) * player.vel;
    playerVelZ = Math.cos(player.hullYaw) * player.vel;

    AudioSys.setEngine(Math.abs(player.vel) / PL.speed * 0.85 + turning * 0.15);
  }

  /* ---- 瞄准与开火 ---- */

  function computeAim() {
    camera.getWorldDirection(tmpB);
    var o = camera.position;
    var range = 160, bestD = range;

    if (tmpB.y < -0.0001) {
      var tg = (o.y - 0.4) / (-tmpB.y);
      if (tg > 2 && tg < bestD) bestD = tg;
    }
    var hit = World.segmentHit(o.x, o.y, o.z, o.x + tmpB.x * range, o.y + tmpB.y * range, o.z + tmpB.z * range);
    if (hit && hit.t * range < bestD) bestD = hit.t * range;

    function rayUnits(list) {
      for (var i = 0; i < list.length; i++) {
        var e = list[i];
        var er = e.radius || 1.9, eh = e.height || 2.3;
        var dx = o.x - e.pos.x, dz = o.z - e.pos.z;
        var A = tmpB.x * tmpB.x + tmpB.z * tmpB.z;
        if (A < 1e-8) continue;
        var Bq = 2 * (dx * tmpB.x + dz * tmpB.z);
        var C = dx * dx + dz * dz - er * er;
        var disc = Bq * Bq - 4 * A * C;
        if (disc < 0) continue;
        var t = (-Bq - Math.sqrt(disc)) / (2 * A);
        if (t > 0.5 && t < bestD) {
          var y = o.y + tmpB.y * t;
          if (y > 0 && y < eh + 0.4) bestD = t;
        }
      }
    }
    rayUnits(enemies);
    if (mp) rayUnits(others);
    aimPoint.set(o.x + tmpB.x * bestD, o.y + tmpB.y * bestD, o.z + tmpB.z * bestD);
    return bestD;
  }

  function updateTurret(dt) {
    var tdx = aimPoint.x - player.pos.x, tdz = aimPoint.z - player.pos.z;
    var wantYaw = Math.atan2(tdx, tdz);
    player.turretYawW = approachAngle(player.turretYawW, wantYaw, PL.turretSpeed * dt);
    player.wantYaw = wantYaw;

    var elev;
    if (aimFirstPerson()) {
      // 开镜：炮管与准星同轴，炮弹从画面正中飞出（不再为弹道落差额外抬炮）
      elev = -wantCamPitch;
    } else {
      var dH = Math.max(2, Math.sqrt(tdx * tdx + tdz * tdz));
      var drop = 0.5 * SHELL_G * Math.pow(dH / PL.shellSpeed, 2);
      var muzzleY = (player.model && player.model.scale) ? 1.42 * player.model.scale : 1.42;
      elev = Math.atan2(aimPoint.y + drop - muzzleY, dH);
    }
    player.elev = clamp(player.elev + clamp(elev - player.elev, -3 * dt, 3 * dt), -0.14, 0.32);

    player.recoil = approach(player.recoil, 0, 1.4 * dt);
  }

  function assistAim(muzzle, md) {
    var bestAng = 0.085, target = null;
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      tmpC.set(e.pos.x - muzzle.x, 1.1 - muzzle.y, e.pos.z - muzzle.z);
      var d = tmpC.length();
      if (d > 75) continue;
      tmpC.multiplyScalar(1 / d);
      var ang = Math.acos(clamp(md.dot(tmpC), -1, 1));
      if (ang < bestAng && !World.blocksLOS(mp.x, mp.z, e.pos.x, e.pos.z)) {
        bestAng = ang;
        target = { x: tmpC.x, y: tmpC.y, z: tmpC.z };
      }
    }
    if (target) {
      md.x += (target.x - md.x) * 0.4;
      md.y += (target.y - md.y) * 0.4;
      md.z += (target.z - md.z) * 0.4;
      md.normalize();
    }
  }

  function updateFire(dt) {
    player.prevReload = player.reload;
    player.reload -= dt;
    if (player.prevReload > 0 && player.reload <= 0 && phase === 'playing') AudioSys.reloadClick();
    fireBuffer -= dt;

    if ((fireHeld || fireBuffer > 0) && player.reload <= 0 && phase === 'playing' && !chatOpen) {
      fireBuffer = 0;
      player.reload = PL.reload;
      if (mp) {
        // 联机：弹丸由服务器事件广播回来，本地按同样装填冷却做手感反馈
        player.recoil = 0.26;
        AudioSys.shot();
        trauma = Math.min(1, trauma + 0.13);
        return;
      }
      player.model.group.updateMatrixWorld(true);
      var mp2 = player.model.muzzle.getWorldPosition(tmpA);
      var md = player.model.muzzle.getWorldDirection(tmpB);
      if (IS_TOUCH) assistAim(mp2, md);
      spawnShell('p', mp2, md, PL.shellSpeed, PL.dmg, player.model.shellColor);
      player.recoil = 0.26;
      FX.muzzleFlash(mp2, md, 0x9ff3ff, 1.15);
      AudioSys.shot();
      trauma = Math.min(1, trauma + 0.13);
    }
  }

  function damagePlayer(dmg) {
    if (!player.alive || dmg <= 0 || phase !== 'playing') return;
    player.hp -= dmg;
    dmgVig = 1;
    trauma = Math.min(1, trauma + 0.32);
    AudioSys.playerHit();
    if (player.hp <= 0) {
      player.hp = 0;
      playerDie();
    }
    updateHpUI();
  }

  function playerDie() {
    player.alive = false;
    FX.tankExplosion(player.pos.x, 1.0, player.pos.z, 1.7);
    AudioSys.explosion(2, 1);
    AudioSys.gameOver();
    AudioSys.setEngine(-1);
    player.model.group.visible = false;
    trauma = 1;
    phase = 'dying';
    dieT = 2.3;
    timeScale = 0.42;
    fireHeld = false;
    aimHeld = false;
    exitLockSilent();
  }

  /* ================= 敌人 ================= */

  function spawnEnemy(type, x, z) {
    var cfg = ENEMY_TYPES[type];
    var t = TankModels.createTank(type);
    t.group.position.set(x, -1.6, z);
    scene.add(t.group);
    var yaw = Math.atan2(player.pos.x - x, player.pos.z - z);
    var e = {
      type: type, cfg: cfg, model: t,
      pos: new THREE.Vector3(x, 0, z),
      hullYaw: yaw, vel: 0,
      hp: Math.round(cfg.hp * hpMult()), maxHp: Math.round(cfg.hp * hpMult()),
      turretYawW: yaw, elev: 0,
      state: 'patrol', wpX: x, wpZ: z, repathT: 0,
      strafeDir: Math.random() < 0.5 ? 1 : -1, strafeT: rand(2, 4),
      think: Math.random() * 0.15, losOK: false, distP: 999,
      fireCd: rand(1.6, 2.6), alertT: 0, flashT: 0,
      bornT: 0.7, recoil: 0, alive: true,
      radius: t.radius, height: t.height,
      hpBar: TankModels.createHPBar()
    };
    e.hpBar.sprite.position.y = 2.85;
    t.group.add(e.hpBar.sprite);
    enemies.push(e);
  }

  function updateEnemy(e, dt) {
    var g = e.model.group;

    // 出生上升动画
    if (e.bornT > 0) {
      e.bornT -= dt;
      g.position.y = -1.6 * Math.max(0, e.bornT / 0.7);
      g.position.x = e.pos.x;
      g.position.z = e.pos.z;
      g.rotation.y = e.hullYaw;
      return;
    }

    var px = player.pos.x, pz = player.pos.z;

    // 感知（分帧）
    e.think -= dt;
    if (e.think <= 0) {
      e.think = 0.12 + Math.random() * 0.08;
      var ddx = px - e.pos.x, ddz = pz - e.pos.z;
      e.distP = Math.sqrt(ddx * ddx + ddz * ddz);
      e.losOK = player.alive && !World.blocksLOS(e.pos.x, e.pos.z, px, pz);
      e.state = (player.alive && ((e.losOK && e.distP < e.cfg.detect) || e.alertT > 0)) ? 'engage' : 'patrol';
    }
    e.alertT -= dt;

    // 移动目标
    var goalX, goalZ, wantSpeed = e.cfg.speed;
    if (e.state === 'patrol') {
      e.repathT -= dt;
      var wdx = e.wpX - e.pos.x, wdz = e.wpZ - e.pos.z;
      if (e.repathT <= 0 || wdx * wdx + wdz * wdz < 9) {
        var p = World.randomOpenPoint(6, 2.4);
        e.wpX = p.x; e.wpZ = p.z;
        e.repathT = 7 + Math.random() * 5;
      }
      goalX = e.wpX; goalZ = e.wpZ;
      wantSpeed *= 0.55;
    } else {
      e.strafeT -= dt;
      if (e.strafeT <= 0) { e.strafeT = 2 + Math.random() * 2.5; e.strafeDir *= -1; }
      var ndx = e.pos.x - px, ndz = e.pos.z - pz;
      var d = Math.max(0.001, Math.sqrt(ndx * ndx + ndz * ndz));
      ndx /= d; ndz /= d;
      if (!e.losOK) {
        goalX = px; goalZ = pz;                       // 绕出掩体接近
      } else if (d > e.cfg.far) {
        goalX = px + ndx * e.cfg.far * 0.75;
        goalZ = pz + ndz * e.cfg.far * 0.75;
      } else if (d < e.cfg.near) {
        goalX = e.pos.x + ndx * 10;
        goalZ = e.pos.z + ndz * 10;
      } else {
        goalX = e.pos.x - ndz * e.strafeDir * 7;
        goalZ = e.pos.z + ndx * e.strafeDir * 7;
        wantSpeed *= 0.7;
      }
    }

    // 转向 + 简单避障
    var gdx = goalX - e.pos.x, gdz = goalZ - e.pos.z;
    var gLen = Math.sqrt(gdx * gdx + gdz * gdz);
    if (gLen > 0.6) {
      gdx /= gLen; gdz /= gLen;
      var fx = Math.sin(e.hullYaw), fz = Math.cos(e.hullYaw);
      if (!World.circleFree(e.pos.x + fx * 4.5, e.pos.z + fz * 4.5, 1.7)) {
        var la = e.hullYaw + 0.75, ra = e.hullYaw - 0.75;
        var lFree = World.circleFree(e.pos.x + Math.sin(la) * 4.5, e.pos.z + Math.cos(la) * 4.5, 1.6);
        var rFree = World.circleFree(e.pos.x + Math.sin(ra) * 4.5, e.pos.z + Math.cos(ra) * 4.5, 1.6);
        var side = (lFree && !rFree) ? 1 : (rFree && !lFree) ? -1 : e.strafeDir;
        var ay = e.hullYaw + side * 1.15;
        gdx = gdx * 0.3 + Math.sin(ay) * 0.7;
        gdz = gdz * 0.3 + Math.cos(ay) * 0.7;
      }
      var desiredYaw = Math.atan2(gdx, gdz);
      e.hullYaw = approachAngle(e.hullYaw, desiredYaw, e.cfg.turn * dt);
      var align = Math.cos(angDiff(e.hullYaw, desiredYaw));
      e.vel = approach(e.vel, wantSpeed * Math.max(0, align), 10 * dt);
    } else {
      e.vel = approach(e.vel, 0, 14 * dt);
    }
    e.pos.x += Math.sin(e.hullYaw) * e.vel * dt;
    e.pos.z += Math.cos(e.hullYaw) * e.vel * dt;
    var rc = World.resolveCircle(e.pos.x, e.pos.z, e.radius * 0.88);
    e.pos.x = rc.x; e.pos.z = rc.z;

    // 炮塔跟踪（带预判）
    var wantYaw;
    if (e.state === 'engage' && player.alive) {
      var tof = e.distP / e.cfg.shellSpeed;
      var tx = px + playerVelX * tof * 0.75 - e.pos.x;
      var tz = pz + playerVelZ * tof * 0.75 - e.pos.z;
      wantYaw = Math.atan2(tx, tz);
    } else {
      wantYaw = e.hullYaw;
    }
    e.turretYawW = approachAngle(e.turretYawW, wantYaw, e.cfg.turretSpeed * dt);

    // 俯仰（含重力补偿）
    var dH = Math.max(2, e.distP);
    var drop = 0.5 * SHELL_G * Math.pow(dH / e.cfg.shellSpeed, 2);
    var muzzleY = 1.42 * e.model.scale;
    e.elev = clamp(Math.atan2(1.0 + drop - muzzleY, dH), -0.12, 0.4);

    // 开火
    e.fireCd -= dt;
    if (e.fireCd <= 0 && e.state === 'engage' && player.alive && e.losOK &&
        e.distP < e.cfg.fireRange && Math.abs(angDiff(e.turretYawW, wantYaw)) < 0.1) {
      e.fireCd = e.cfg.reload * (0.85 + Math.random() * 0.3);
      enemyFire(e);
    }

    // 受击闪烁 / 后坐力
    if (e.flashT > 0) {
      e.flashT -= dt;
      if (e.flashT <= 0) e.model.mats.body.emissive.setHex(0x000000);
    }
    e.recoil = approach(e.recoil, 0, 1.2 * dt);

    // 同步模型
    g.position.set(e.pos.x, 0, e.pos.z);
    g.rotation.y = e.hullYaw;
    e.model.turret.rotation.y = e.turretYawW - e.hullYaw;
    e.model.barrelPivot.rotation.x = -e.elev;
    e.model.barrelPivot.position.z = 0.62 - e.recoil;
  }

  function enemyFire(e) {
    e.model.group.updateMatrixWorld(true);
    var mp = e.model.muzzle.getWorldPosition(tmpA);
    var md = e.model.muzzle.getWorldDirection(tmpB);
    var errY = (Math.random() - 0.5) * 2 * e.cfg.aimErr;
    var cosE = Math.cos(errY), sinE = Math.sin(errY);
    var nx = md.x * cosE + md.z * sinE;
    var nz = -md.x * sinE + md.z * cosE;
    md.x = nx; md.z = nz;
    md.y += (Math.random() - 0.5) * e.cfg.aimErr * 0.8;
    md.normalize();
    spawnShell('e', mp, md, e.cfg.shellSpeed, Math.round(e.cfg.dmg * dmgMult()), e.model.shellColor);
    e.recoil = 0.22;
    FX.muzzleFlash(mp, md, e.model.accentColor, 0.9);
    AudioSys.enemyShot(volByDist(e.pos.x, e.pos.z));
  }

  function damageEnemy(e, dmg, showNum) {
    if (!e.alive || dmg <= 0) return;
    e.hp -= dmg;
    e.alertT = 7;
    e.state = 'engage';
    e.flashT = 0.12;
    e.model.mats.body.emissive.setHex(0x7a2a1a);
    e.hpBar.set(e.hp / e.maxHp);
    hitMarker();
    AudioSys.armorHit(0.5 + 0.5 * volByDist(e.pos.x, e.pos.z));
    if (showNum) floatText(e.pos.x, 2.4 * e.model.scale, e.pos.z, '-' + dmg, '#9ff3ff', 16);
    if (e.hp <= 0) killEnemy(e);
  }

  function killEnemy(e) {
    e.alive = false;
    kills++;
    var pts = Math.round(e.cfg.score * scoreMult() / 10) * 10;
    score += pts;
    updateScoreUI();
    killfeed('击毁 ' + e.cfg.name + '　+' + pts, e.type === 'heavy' ? 'gold' : '');
    floatText(e.pos.x, 2.6 * e.model.scale, e.pos.z, '+' + pts, '#ffd75e', 22);

    // 炮塔抛飞
    e.model.group.updateMatrixWorld(true);
    var tw = e.model.turret;
    var wp = tw.getWorldPosition(new THREE.Vector3());
    var wq = tw.getWorldQuaternion(new THREE.Quaternion());
    e.model.group.remove(tw);
    tw.position.copy(wp);
    tw.quaternion.copy(wq);
    tw.scale.setScalar(e.model.scale);
    scene.add(tw);
    FX.flyPart(tw, rand(-3.5, 3.5), rand(7, 11), rand(-3.5, 3.5), 2.1, false);

    FX.tankExplosion(e.pos.x, 0.9, e.pos.z, 1.05 * e.model.scale);
    AudioSys.explosion(1.5, volByDist(e.pos.x, e.pos.z));
    trauma = Math.min(1, trauma + clamp(0.45 - e.distP * 0.008, 0.1, 0.45));

    if (Math.random() < e.cfg.drop) spawnPickup(e.pos.x, e.pos.z);

    scene.remove(e.model.group);
    e.hpBar.dispose();
    var idx = enemies.indexOf(e);
    if (idx !== -1) enemies.splice(idx, 1);
    updateWaveChip();
  }

  /* ================= 炮弹 ================= */

  function spawnShell(team, pos, dir, speed, dmg, colorHex) {
    var mesh = TankModels.createShell(colorHex);
    mesh.position.copy(pos);
    scene.add(mesh);
    var c = new THREE.Color(colorHex);
    shells.push({
      team: team,
      pos: pos.clone(),
      prev: pos.clone(),
      vx: dir.x * speed, vy: dir.y * speed, vz: dir.z * speed,
      dmg: dmg, mesh: mesh, life: 3.5, trailT: 0,
      cr: c.r, cg: c.g, cb: c.b,
      boltCol: shellBoltColor(colorHex)
    });
  }

  // 特效弹（曳光/等离子/核弹头）→ 附加闪电轨迹
  function shellBoltColor(colorHex) {
    if (colorHex === 0xffff88) return 0xffffc8;   // 曳光弹
    if (colorHex === 0x88ccff) return 0x7df0ff;   // 等离子弹
    if (colorHex === 0xff8866) return 0xff6a3a;   // 核弹头
    return null;
  }

  function removeShell(i) {
    scene.remove(shells[i].mesh);
    shells.splice(i, 1);
  }

  function updateShells(dt) {
    for (var i = shells.length - 1; i >= 0; i--) {
      var s = shells[i];
      s.life -= dt;
      if (s.life <= 0) { removeShell(i); continue; }

      s.prev.copy(s.pos);
      s.vy -= SHELL_G * dt;
      s.pos.x += s.vx * dt;
      s.pos.y += s.vy * dt;
      s.pos.z += s.vz * dt;
      s.mesh.position.copy(s.pos);
      tmpC.set(s.pos.x + s.vx, s.pos.y + s.vy, s.pos.z + s.vz);
      s.mesh.lookAt(tmpC);

      s.trailT -= dt;
      if (s.trailT <= 0) {
        s.trailT = 0.018;
        if (s.boltCol) {
          // 特效弹：附带折线闪电轨迹
          FX.bolt(s.pos.x, s.pos.y, s.pos.z, s.vx, s.vy, s.vz, s.boltCol, 8 + Math.random() * 3, 0.4);
        } else {
          FX.trail(s.pos.x, s.pos.y, s.pos.z, s.cr, s.cg, s.cb);
        }
      }

      // 联机视觉炮弹：命中由服务器判定（boom 事件删除），本地只飞行
      if (s.ghost) continue;

      // 世界命中
      var wHit = World.segmentHit(s.prev.x, s.prev.y, s.prev.z, s.pos.x, s.pos.y, s.pos.z);
      var wT = wHit ? wHit.t : 2;
      var wx = wHit ? wHit.x : 0, wy = wHit ? wHit.y : 0, wz = wHit ? wHit.z : 0, wKind = wHit ? wHit.kind : '';

      // 坦克命中（中点与终点两次采样）
      var hitUnit = null, hitT = 2, hx = 0, hy = 0, hz = 0;
      var samples = [0.5, 1];
      for (var k = 0; k < samples.length && !hitUnit; k++) {
        var tK = samples[k];
        var sx = s.prev.x + (s.pos.x - s.prev.x) * tK;
        var sy = s.prev.y + (s.pos.y - s.prev.y) * tK;
        var sz = s.prev.z + (s.pos.z - s.prev.z) * tK;
        if (s.team === 'p') {
          for (var j = 0; j < enemies.length; j++) {
            var e = enemies[j];
            var dx = sx - e.pos.x, dz = sz - e.pos.z;
            if (dx * dx + dz * dz < e.radius * e.radius && sy < e.height + 0.3) {
              hitUnit = e; hitT = tK; hx = sx; hy = sy; hz = sz;
              break;
            }
          }
        } else if (player.alive) {
          var pdx = sx - player.pos.x, pdz = sz - player.pos.z;
          if (pdx * pdx + pdz * pdz < player.radius * player.radius && sy < player.height + 0.3) {
            hitUnit = player; hitT = tK; hx = sx; hy = sy; hz = sz;
          }
        }
      }

      if (hitUnit && hitT <= wT) {
        explodeShell(s, hx, hy, hz, hitUnit, '');
        removeShell(i);
      } else if (wHit) {
        explodeShell(s, wx, wy, wz, null, wKind);
        removeShell(i);
      }
    }
  }

  function explodeShell(s, x, y, z, directUnit, kind) {
    FX.explosion(x, y, z, s.team === 'p' ? 0.85 : 0.8);
    AudioSys.explosion(0.7, volByDist(x, z));
    if (kind === 'ground') FX.scorch(x, z, rand(0.8, 1.1));

    if (s.team === 'p') {
      if (directUnit) damageEnemy(directUnit, s.dmg, true);
      for (var i = enemies.length - 1; i >= 0; i--) {
        var e = enemies[i];
        if (e === directUnit) continue;
        var dx = e.pos.x - x, dz = e.pos.z - z;
        var d = Math.sqrt(dx * dx + dz * dz);
        if (d < PL.splashR) damageEnemy(e, Math.round(PL.splashDmg * (1 - d / PL.splashR)), true);
      }
    } else {
      if (directUnit) {
        damagePlayer(s.dmg);
      } else if (player.alive) {
        var pdx = player.pos.x - x, pdz = player.pos.z - z;
        var pd = Math.sqrt(pdx * pdx + pdz * pdz);
        if (pd < 3.2) damagePlayer(Math.round(s.dmg * 0.55 * (1 - pd / 3.2)));
      }
      trauma = Math.min(1, trauma + clamp(0.25 - distToPlayer(x, z) * 0.01, 0, 0.25));
    }
  }

  function distToPlayer(x, z) {
    var dx = player.pos.x - x, dz = player.pos.z - z;
    return Math.sqrt(dx * dx + dz * dz);
  }
  function volByDist(x, z) {
    return 1 / (1 + distToPlayer(x, z) * 0.035);
  }

  /* ================= 坦克间推挤 ================= */

  function separateTanks() {
    var units = [];
    if (player.alive) units.push(player);
    for (var i = 0; i < enemies.length; i++) if (enemies[i].bornT <= 0) units.push(enemies[i]);
    for (var a = 0; a < units.length; a++) {
      for (var b = a + 1; b < units.length; b++) {
        var u = units[a], v = units[b];
        var dx = v.pos.x - u.pos.x, dz = v.pos.z - u.pos.z;
        var rr = (u.radius + v.radius) * 0.82;
        var d2 = dx * dx + dz * dz;
        if (d2 < rr * rr && d2 > 1e-6) {
          var d = Math.sqrt(d2);
          var push = (rr - d) / d * 0.5;
          var uw = (u === player) ? 0.25 : 0.5;
          var vw = (v === player) ? 0.25 : 0.5;
          u.pos.x -= dx * push * uw * 2;
          u.pos.z -= dz * push * uw * 2;
          v.pos.x += dx * push * vw * 2;
          v.pos.z += dz * push * vw * 2;
        }
      }
    }
  }

  /* ================= 补给 ================= */

  function spawnPickup(x, z) {
    var m = TankModels.createCrate();
    m.position.set(x, 0.8, z);
    scene.add(m);
    pickups.push({ mesh: m, x: x, z: z, t: Math.random() * 6, life: 20 });
  }

  function updatePickups(dt) {
    for (var i = pickups.length - 1; i >= 0; i--) {
      var p = pickups[i];
      p.t += dt;
      p.life -= dt;
      p.mesh.position.y = 0.8 + Math.sin(p.t * 2.6) * 0.14;
      p.mesh.rotation.y += dt * 1.3;
      if (p.life < 4) p.mesh.visible = Math.sin(p.t * 12) > -0.4;
      if (p.life <= 0) {
        scene.remove(p.mesh);
        pickups.splice(i, 1);
        continue;
      }
      if (player.alive && phase === 'playing') {
        var dx = player.pos.x - p.x, dz = player.pos.z - p.z;
        if (dx * dx + dz * dz < 2.6 * 2.6) {
          player.hp = Math.min(player.maxHp, player.hp + 30);
          healVig = 1;
          AudioSys.pickup();
          floatText(player.pos.x, 2.6, player.pos.z, '+30', '#2eff8e', 20);
          updateHpUI();
          scene.remove(p.mesh);
          pickups.splice(i, 1);
        }
      }
    }
  }

  /* ================= 波次 ================= */

  function beginWave(n) {
    wave = n;
    waveQueue = waveComp(n);
    waveMaxAlive = Math.min(2 + n, 6);
    inPrep = true;
    prepT = n === 1 ? 2.6 : 4.0;
    spawnTick = 0;
    banner('第 ' + n + ' 波', '敌军 ' + waveQueue.length + ' 辆 · 准备迎战', 2.4);
    AudioSys.waveHorn();
    updateWaveChip();
  }

  function pickSpawnPoint() {
    var pts = World.spawnPoints;
    var far = [];
    for (var i = 0; i < pts.length; i++) {
      var dx = pts[i].x - player.pos.x, dz = pts[i].z - player.pos.z;
      if (dx * dx + dz * dz > 38 * 38) far.push(pts[i]);
    }
    if (!far.length) far = pts;
    return far[Math.floor(Math.random() * far.length)];
  }

  function updateWaveLogic(dt) {
    if (inPrep) {
      prepT -= dt;
      if (prepT <= 0) inPrep = false;
      return;
    }
    // 逐个投放
    spawnTick -= dt;
    if (waveQueue.length && enemies.length + wavePending.length < waveMaxAlive && spawnTick <= 0) {
      spawnTick = 0.9;
      var type = waveQueue.shift();
      var pt = pickSpawnPoint();
      wavePending.push({ t: 0.8, type: type, x: pt.x, z: pt.z });
      FX.spawnBeacon(pt.x, pt.z, TankModels.PALETTES[type].accent);
      updateWaveChip();
    }
    for (var i = wavePending.length - 1; i >= 0; i--) {
      wavePending[i].t -= dt;
      if (wavePending[i].t <= 0) {
        var w = wavePending[i];
        wavePending.splice(i, 1);
        spawnEnemy(w.type, w.x, w.z);
      }
    }
    // 波次清空（wave > 0 防止开局误触发）
    if (wave > 0 && !waveQueue.length && !wavePending.length && !enemies.length && player.alive) {
      var bonus = 150 + wave * 50;
      score += bonus;
      updateScoreUI();
      player.hp = Math.min(player.maxHp, player.hp + 35);
      updateHpUI();
      killfeed('第 ' + wave + ' 波清除　奖励 +' + bonus + '　装甲 +35', 'gold');
      var clearedWave = wave;
      beginWave(wave + 1);
      if (clearedWave === 5) reportSoloWave5();
    }
  }

  /* ================= 相机 ================= */

  function updateCamera(dt) {
    if (mpSpectate) {
      // 观战：高空俯瞰，缓慢环绕战场
      var spAng = elapsed * 0.12;
      camera.position.set(Math.cos(spAng) * 52, 46, Math.sin(spAng) * 52);
      camera.lookAt(0, 0, 0);
      player.model.group.visible = false;
      return;
    }
    if (phase === 'menu') {
      camYaw += dt * 0.25;
      camPitch = 0.2;
      camDist = 7;
      camDistSmooth = 7;
    } else if (phase === 'dying' || phase === 'over' || phase === 'mpdead') {
      camYaw += dt * 0.3;
    }

    var tx = player.pos.x, ty = (phase === 'menu') ? 1.0 : 2.2, tz = player.pos.z;

    // 右键开镜：平滑缩小 FOV 放大视野中央（战地5风格坦克镜，明显放大）
    inputZoom = approach(inputZoom, (aimHeld && phase === 'playing' && !IS_TOUCH) ? 1 : 0, dt * 6);
    var targetFov = baseFov * (1 - 0.58 * inputZoom);
    if (Math.abs(camera.fov - targetFov) > 0.01) {
      camera.fov = targetFov;
      camera.updateProjectionMatrix();
    }

    var aiming = aimFirstPerson();

    if (aiming) {
      camYaw = wantCamYaw;
      // 俯仰限制在炮管可达范围（elev ∈ [-0.14, 0.32] → pitch ∈ [-0.32, 0.14]）
      wantCamPitch = clamp(wantCamPitch, -0.32, 0.14);
      camPitch = wantCamPitch;

      var cpA = camPitch;
      var fxA = Math.sin(camYaw) * Math.cos(cpA);
      var fyA = -Math.sin(cpA);
      var fzA = Math.cos(camYaw) * Math.cos(cpA);
      // 开镜相机放到炮口高度、沿炮管轴线，炮弹从准星正中飞出
      player.model.group.updateMatrixWorld(true);
      var muzzleY = player.model.muzzle.getWorldPosition(tmpA).y;
      camera.position.set(tx + fxA * 0.45, muzzleY, tz + fzA * 0.45);
      camera.lookAt(tx + fxA * 80, muzzleY + fyA * 80, tz + fzA * 80);
      camDistSmooth = camDist;
      player.model.group.visible = false;
    } else {
      var cp = clamp(camPitch, -0.1, 1.05);
      var fx = Math.sin(camYaw) * Math.cos(cp);
      var fy = -Math.sin(cp);
      var fz = Math.cos(camYaw) * Math.cos(cp);

      // 平视时只抬高机位，让车体落到准星下方；视线仍用同一套 yaw/pitch，开镜才不会跳。
      // 往下看时取消抬高，按俯仰低头。
      var extraH = 0;
      if (phase === 'playing' || phase === 'paused') {
        var downK = clamp((cp - 0.2) / 0.5, 0, 1);
        extraH = ((player.height || 2.2) * 0.45 + 1.0) * (1 - downK);
      }

      var dist = camDist;
      var cx = tx - fx * dist, cy = ty - fy * dist + extraH, cz = tz - fz * dist;
      var hit = World.segmentHit(tx, ty, tz, cx, cy, cz);
      if (hit) dist = Math.max(2.4, dist * hit.t - 0.5);

      if (dist < camDistSmooth) camDistSmooth = dist;                     // 遮挡立即拉近
      else camDistSmooth = Math.min(dist, camDistSmooth + 10 * dt);       // 缓慢恢复

      cx = tx - fx * camDistSmooth;
      cy = ty - fy * camDistSmooth + extraH;
      cz = tz - fz * camDistSmooth;
      if (cy < 0.6) cy = 0.6;
      camera.position.set(cx, cy, cz);
      camera.lookAt(cx + fx * 80, cy + fy * 80, cz + fz * 80);
      if (player.alive) player.model.group.visible = true;
    }

    if (trauma > 0) {
      trauma = Math.max(0, trauma - dt * 1.5);
      var sh = trauma * trauma;
      camera.position.x += Math.sin(elapsed * 83.0) * sh * 0.32;
      camera.position.y += Math.sin(elapsed * 97.0 + 1.7) * sh * 0.28;
      camera.rotation.z += Math.sin(elapsed * 71.0 + 0.6) * sh * 0.028;
    }

    camera.updateMatrixWorld(true);
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  }

  /* ================= HUD ================= */

  var cache = { hp: -1, score: -1, best: -1, waveN: -1, left: -1, reloadPct: -1 };

  function updateHpUI() {
    var pct = clamp(player.hp / player.maxHp, 0, 1);
    ui['hp-fill'].style.width = (pct * 100).toFixed(1) + '%';
    ui['hp-fill'].classList.toggle('low', pct < 0.3);
    var v = Math.ceil(player.hp);
    if (v !== cache.hp) { cache.hp = v; ui['hp-num'].textContent = v; }
  }

  function updateScoreUI() {
    if (score !== cache.score) { cache.score = score; ui['score-num'].textContent = score; }
    var b = Math.max(best.score, score);
    if (b !== cache.best) { cache.best = b; ui['best-num'].textContent = b; }
  }

  function updateWaveChip() {
    if (mp) {
      if (Net.mode === 'pvp') {
        var n = others.length + 1;
        if (cache.left !== n) {
          cache.left = n;
          ui['wave-chip'].innerHTML = '混战 · 敌军 <b>' + n + '</b>';
        }
      } else {
        if (wave !== cache.waveN || mpWaveLeft !== cache.left) {
          cache.waveN = wave; cache.left = mpWaveLeft;
          ui['wave-chip'].innerHTML = '第 <b>' + wave + '</b> 波 · 残敌 <b>' + mpWaveLeft + '</b>';
        }
      }
      return;
    }
    // 单机：统一 innerHTML（结构可能被联机模式覆盖过，不依赖子元素引用）
    var left = enemies.length + waveQueue.length + wavePending.length;
    if (wave !== cache.waveN || left !== cache.left) {
      cache.waveN = wave; cache.left = left;
      ui['wave-chip'].innerHTML = '第 <b>' + wave + '</b> 波 · 残敌 <b>' + left + '</b>';
    }
  }

  var hitT = 0;
  function hitMarker() {
    ui.crosshair.classList.add('hit');
    hitT = 0.1;
  }

  function killfeed(text, cls) {
    var el = document.createElement('div');
    el.className = 'kf' + (cls ? ' ' + cls : '');
    el.textContent = text;
    ui.killfeed.appendChild(el);
    while (ui.killfeed.children.length > 5) ui.killfeed.removeChild(ui.killfeed.firstChild);
    setTimeout(function () { el.style.opacity = '0'; }, 2300);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 2900);
  }

  function floatText(x, y, z, str, color, sizePx) {
    if (floats.length > 26) {
      var old = floats.shift();
      if (old.el.parentNode) old.el.parentNode.removeChild(old.el);
    }
    var el = document.createElement('div');
    el.className = 'float-txt';
    el.textContent = str;
    el.style.color = color;
    el.style.fontSize = (sizePx || 18) + 'px';
    ui['float-layer'].appendChild(el);
    floats.push({ el: el, x: x, y: y, z: z, t: 0, dur: 0.95 });
  }

  function updateFloats(dt) {
    for (var i = floats.length - 1; i >= 0; i--) {
      var f = floats[i];
      f.t += dt;
      f.y += dt * 1.7;
      if (f.t >= f.dur) {
        if (f.el.parentNode) f.el.parentNode.removeChild(f.el);
        floats.splice(i, 1);
        continue;
      }
      tmpC.set(f.x, f.y, f.z).project(camera);
      if (tmpC.z > 1 || tmpC.z < -1) { f.el.style.opacity = '0'; continue; }
      f.el.style.left = ((tmpC.x * 0.5 + 0.5) * Stage.LW).toFixed(1) + 'px';
      f.el.style.top = ((-tmpC.y * 0.5 + 0.5) * Stage.LH).toFixed(1) + 'px';
      var k = f.t / f.dur;
      f.el.style.opacity = (1 - k * k).toFixed(2);
    }
  }

  var bannerT = 0;
  function banner(main, sub, dur) {
    ui['banner-main'].textContent = main;
    ui['banner-sub'].textContent = sub || '';
    show(ui.banner);
    ui['banner-main'].style.animation = 'none';
    void ui['banner-main'].offsetWidth;
    ui['banner-main'].style.animation = '';
    bannerT = dur || 2.2;
  }

  function updateHUD(dt) {
    // 装填条
    var pct = clamp(1 - player.reload / PL.reload, 0, 1);
    if (pct !== cache.reloadPct) {
      cache.reloadPct = pct;
      ui['reload-fill'].style.width = (pct * 100).toFixed(0) + '%';
      ui['reload-bar'].classList.toggle('ready', pct >= 1);
    }

    // 准星/瞄准镜切换：第一人称开镜 vs 第三人称
    var aiming = aimFirstPerson();
    if (aiming) {
      ui.crosshair.classList.add('ch-fpp');
      ui['scope-overlay'].classList.add('active');
      ui['barrel-dot'].style.display = 'none';
    } else {
      ui.crosshair.classList.remove('ch-fpp');
      ui['scope-overlay'].classList.remove('active');
    }

    // 准星命中反馈
    if (hitT > 0) {
      hitT -= dt;
      if (hitT <= 0) ui.crosshair.classList.remove('hit');
    }

    // 炮口实际指向点（第三人称时显示）
    if (player.alive && !aiming) {
      var mp = player.model.muzzle.getWorldPosition(tmpA);
      var md = player.model.muzzle.getWorldDirection(tmpB);
      var dd = Math.min(60, Math.max(8, aimPoint.distanceTo(mp)));
      tmpC.set(mp.x + md.x * dd, mp.y + md.y * dd, mp.z + md.z * dd).project(camera);
      if (tmpC.z < 1 && tmpC.z > -1) {
        ui['barrel-dot'].style.display = 'block';
        ui['barrel-dot'].style.left = ((tmpC.x * 0.5 + 0.5) * Stage.LW).toFixed(1) + 'px';
        ui['barrel-dot'].style.top = ((-tmpC.y * 0.5 + 0.5) * Stage.LH).toFixed(1) + 'px';
      } else {
        ui['barrel-dot'].style.display = 'none';
      }
    } else {
      ui['barrel-dot'].style.display = 'none';
    }

    // 提示横幅
    if (bannerT > 0) {
      bannerT -= dt;
      if (bannerT <= 0) hide(ui.banner);
    }

    // 屏幕边缘光
    if (dmgVig > 0) {
      dmgVig = Math.max(0, dmgVig - dt * 1.7);
      ui['dmg-vignette'].style.opacity = (dmgVig * 0.9).toFixed(2);
    }
    if (healVig > 0) {
      healVig = Math.max(0, healVig - dt * 1.6);
      ui['heal-vignette'].style.opacity = (healVig * 0.8).toFixed(2);
    }

    updateFloats(dt);
    drawRadar();
  }

  /* ---- 雷达 ---- */

  function radarXY(wx, wz, clampEdge) {
    var dx = wx - player.pos.x, dz = wz - player.pos.z;
    var bearing = Math.atan2(dx, dz) - camYaw;
    var d = Math.sqrt(dx * dx + dz * dz) * (72 / RADAR_RANGE);
    if (clampEdge && d > 72) d = 72;
    return { x: 78 + Math.sin(bearing) * d, y: 78 - Math.cos(bearing) * d };
  }

  function drawRadar() {
    var g = ui.radarCtx;
    if (!g) return;
    g.clearRect(0, 0, 156, 156);
    g.save();
    g.beginPath();
    g.arc(78, 78, 74, 0, Math.PI * 2);
    g.clip();

    // 距离环
    g.strokeStyle = 'rgba(41,230,255,.14)';
    g.lineWidth = 1;
    [25, 50, 73].forEach(function (r) {
      g.beginPath(); g.arc(78, 78, r, 0, Math.PI * 2); g.stroke();
    });

    // 场地边界
    g.strokeStyle = 'rgba(41,230,255,.3)';
    g.beginPath();
    var H = World.HALF;
    var corners = [[-H, -H], [H, -H], [H, H], [-H, H]];
    for (var i = 0; i < 4; i++) {
      var p = radarXY(corners[i][0], corners[i][1], false);
      if (i === 0) g.moveTo(p.x, p.y); else g.lineTo(p.x, p.y);
    }
    g.closePath();
    g.stroke();

    // 补给
    g.fillStyle = '#2eff8e';
    for (var pi = 0; pi < pickups.length; pi++) {
      var pp = radarXY(pickups[pi].x, pickups[pi].z, true);
      g.fillRect(pp.x - 2, pp.y - 2, 4, 4);
    }
    if (mp) {
      for (var mpk in mpPickMeshes) {
        if (!mpPickMeshes[mpk].mesh.visible) continue;
        var mpp = radarXY(mpPickMeshes[mpk].x, mpPickMeshes[mpk].z, true);
        g.fillRect(mpp.x - 2, mpp.y - 2, 4, 4);
      }
      for (var mti = 0; mti < mpTempPickups.length; mti++) {
        var mtp = radarXY(mpTempPickups[mti].x, mpTempPickups[mti].z, true);
        g.fillRect(mtp.x - 2, mtp.y - 2, 4, 4);
      }
    }

    // 待出生（闪烁）
    if (Math.sin(elapsed * 10) > 0) {
      g.fillStyle = 'rgba(255,255,255,.85)';
      for (var wi = 0; wi < wavePending.length; wi++) {
        var wp = radarXY(wavePending[wi].x, wavePending[wi].z, true);
        g.beginPath(); g.arc(wp.x, wp.y, 3, 0, Math.PI * 2); g.fill();
      }
    }

    // 敌人
    var colors = { grunt: '#ff4b3a', scout: '#ffb02e', heavy: '#c44bff' };
    for (var ei = 0; ei < enemies.length; ei++) {
      var e = enemies[ei];
      var ep = radarXY(e.pos.x, e.pos.z, true);
      g.fillStyle = colors[e.type];
      g.beginPath();
      g.arc(ep.x, ep.y, e.type === 'heavy' ? 4.5 : 3.2, 0, Math.PI * 2);
      g.fill();
    }

    // 联机：其他玩家（金色三角箭头）
    if (mp) {
      g.fillStyle = '#ffe08a';
      for (var oi = 0; oi < others.length; oi++) {
        var o = others[oi];
        if (!o.alive) continue;
        var op = radarXY(o.pos.x, o.pos.z, true);
        g.save();
        g.translate(op.x, op.y);
        g.rotate(-(o.hullYaw - camYaw) + Math.PI);
        g.beginPath();
        g.moveTo(0, -5);
        g.lineTo(3.6, 4);
        g.lineTo(-3.6, 4);
        g.closePath();
        g.fill();
        g.restore();
      }
    }

    // 玩家（朝向 = 车体方向相对相机）
    var hb = player.hullYaw - camYaw;
    g.save();
    g.translate(78, 78);
    g.rotate(-hb + Math.PI);
    g.fillStyle = '#4df0ff';
    g.beginPath();
    g.moveTo(0, -6.5);
    g.lineTo(4.6, 5);
    g.lineTo(-4.6, 5);
    g.closePath();
    g.fill();
    g.restore();

    g.restore();
  }

  /* ================= 最高分 ================= */

  function loadBest() {
    try {
      var b = JSON.parse(localStorage.getItem(BEST_KEY) || 'null');
      if (b && typeof b.score === 'number') best = b;
    } catch (e) { /* ignore */ }
  }
  function saveBest() {
    try { localStorage.setItem(BEST_KEY, JSON.stringify(best)); } catch (e) { /* ignore */ }
  }
  function updateStartBest() {
    if (ui['start-best-score']) ui['start-best-score'].textContent = best.score;
    if (ui['start-best-wave']) ui['start-best-wave'].textContent = best.wave;
    cache.best = -1;
    updateScoreUI();
  }

  /* ================= 联机模块 ================= */

  var MP_PICK_NAMES = { repair: '修理包', shield: '能量护盾', boost: '过载引擎', ap: '穿甲弹' };

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function cssHex(n) { return '#' + n.toString(16).padStart(6, '0'); }

  /* ---- 其他玩家 ---- */

  function mpMakeOther(id, name, skinIdx, veh) {
    var role = 'mp' + ((id - 1) % 5 + 1);
    var skin = (skinIdx != null && TankModels.SKINS[skinIdx]) ? skinIdx : 0;
    var chassis = VEHICLE_TYPES[veh] ? veh : 'grunt';
    var t = TankModels.createTank(role, skin, { chassis: chassis });
    scene.add(t.group);
    var sk = TankModels.SKINS[skin];
    var plate = TankModels.createNamePlate(name, cssHex(sk.accent));
    plate.sprite.position.y = t.height + 0.95;
    t.group.add(plate.sprite);
    var vmax = VEHICLE_TYPES[chassis].maxHp;
    return {
      id: id, name: name, model: t, plate: plate, veh: chassis,
      pos: new THREE.Vector3(), hullYaw: 0, turretYawW: 0, elev: 0,
      hp: vmax, maxHp: vmax, alive: true, protect: 0, kills: 0, deaths: 0, score: 0, streak: 0,
      radius: t.radius, height: t.height
    };
  }

  function mpRemoveOther(o) {
    scene.remove(o.model.group);
    o.plate.dispose();
  }

  function mpClearOthers() {
    for (var i = 0; i < others.length; i++) mpRemoveOther(others[i]);
    others = [];
  }

  function mpSyncOthers(s) {
    var seen = {};
    for (var i = 0; i < s.ps.length; i++) {
      var p = s.ps[i];
      if (p[0] === Net.myId) continue;
      seen[p[0]] = true;
      var o = null;
      for (var j = 0; j < others.length; j++) if (others[j].id === p[0]) { o = others[j]; break; }
      var veh = p[22] || 'grunt';
      if (!o) { o = mpMakeOther(p[0], p[17], p[18], veh); others.push(o); }
      else if (o.veh !== veh) {
        mpRemoveOther(o);
        o = mpMakeOther(p[0], p[17], p[18], veh);
        others[j] = o;
      }
      o.pos.set(p[1], 0, p[2]);
      o.hullYaw = p[3]; o.turretYawW = p[4]; o.elev = p[5];
      o.hp = p[6]; o.alive = !!p[7]; o.protect = p[11];
      o.kills = p[13]; o.deaths = p[14]; o.score = p[15]; o.streak = p[16];
      var g = o.model.group;
      g.position.set(o.pos.x, 0, o.pos.z);
      g.rotation.y = o.hullYaw;
      o.model.turret.rotation.y = o.turretYawW - o.hullYaw;
      o.model.barrelPivot.rotation.x = -o.elev;
      // 重生保护闪烁
      g.visible = o.alive && (o.protect <= 0 || Math.sin(elapsed * 12) > -0.3);
      o.plate.set(o.hp / (o.maxHp || PL.maxHp));
      o.plate.sprite.visible = o.alive;
    }
    for (var k = others.length - 1; k >= 0; k--) {
      if (!seen[others[k].id]) { mpRemoveOther(others[k]); others.splice(k, 1); }
    }
  }

  /* ---- 联机 AI 敌军（服务器驱动） ---- */

  function mpMakeEnemy(id, type) {
    var t = TankModels.createTank(type);
    scene.add(t.group);
    var e = {
      id: id, type: type, model: t,
      pos: new THREE.Vector3(), hullYaw: 0, turretYawW: 0, elev: 0,
      hp: 1, maxHp: 1, alive: true, bornT: 0,
      radius: t.radius, height: t.height,
      hpBar: TankModels.createHPBar()
    };
    e.hpBar.sprite.position.y = 2.85;
    t.group.add(e.hpBar.sprite);
    return e;
  }

  function mpRemoveEnemy(e, silent) {
    if (!silent) { /* 视觉由事件处理 */ }
    scene.remove(e.model.group);
    e.hpBar.dispose();
    var i = enemies.indexOf(e);
    if (i !== -1) enemies.splice(i, 1);
  }

  function mpSyncEnemies(s) {
    var seen = {};
    for (var i = 0; i < s.es.length; i++) {
      var d = s.es[i];
      seen[d[0]] = true;
      var e = null;
      for (var j = 0; j < enemies.length; j++) if (enemies[j].id === d[0]) { e = enemies[j]; break; }
      if (!e) {
        e = mpMakeEnemy(d[0], d[1]);
        e.bornT = 0.7;
        enemies.push(e);
      }
      var g = e.model.group;
      if (e.bornT > 0) {
        e.bornT -= 0.05;
        g.position.set(d[2], -1.6 * Math.max(0, e.bornT / 0.7), d[3]);
      } else {
        g.position.set(d[2], 0, d[3]);
      }
      e.pos.set(d[2], 0, d[3]);
      e.hullYaw = d[4]; e.turretYawW = d[5];
      e.hp = d[6]; e.maxHp = d[7] || e.maxHp;
      g.rotation.y = e.hullYaw;
      e.model.turret.rotation.y = e.turretYawW - e.hullYaw;
      e.hpBar.set(Math.max(0, e.hp / e.maxHp));
    }
    for (var k = enemies.length - 1; k >= 0; k--) {
      if (!seen[enemies[k].id]) mpRemoveEnemy(enemies[k], true);
    }
  }

  function mpEnemyDeathFX(e, byName, pts, type) {
    // 炮塔抛飞
    e.model.group.updateMatrixWorld(true);
    var tw = e.model.turret;
    var wp = tw.getWorldPosition(new THREE.Vector3());
    var wq = tw.getWorldQuaternion(new THREE.Quaternion());
    e.model.group.remove(tw);
    tw.position.copy(wp);
    tw.quaternion.copy(wq);
    tw.scale.setScalar(e.model.scale);
    scene.add(tw);
    FX.flyPart(tw, rand(-3.5, 3.5), rand(7, 11), rand(-3.5, 3.5), 2.1, false);
    FX.tankExplosion(e.pos.x, 0.9, e.pos.z, 1.05 * e.model.scale);
    AudioSys.explosion(1.5, volByDist(e.pos.x, e.pos.z));
    trauma = Math.min(1, trauma + clamp(0.45 - distToPlayer(e.pos.x, e.pos.z) * 0.008, 0.1, 0.45));
    if (byName) killfeed(byName + ' 击毁 ' + (ENEMY_TYPES[type] ? ENEMY_TYPES[type].name : '敌军') + '　+' + pts, type === 'heavy' ? 'gold' : '');
  }

  /* ---- 拾取 ---- */

  function mpMakePickMesh(idx, kind) {
    var m = TankModels.createCrate();
    var sp = Net.spots[idx] || { x: 0, z: 0 };
    m.position.set(sp.x, 0.8, sp.z);
    scene.add(m);
    return { idx: idx, kind: kind, mesh: m, x: sp.x, z: sp.z, t: Math.random() * 6 };
  }

  function mpClearPicks() {
    for (var k in mpPickMeshes) {
      scene.remove(mpPickMeshes[k].mesh);
      delete mpPickMeshes[k];
    }
    for (var i = 0; i < mpTempPickups.length; i++) scene.remove(mpTempPickups[i].mesh);
    mpTempPickups = [];
  }

  function mpSyncPickups(s, dt) {
    // 固定点位
    for (var i = 0; i < s.pk.length; i++) {
      var pk = s.pk[i];
      var m = mpPickMeshes[pk[0]];
      if (!m) m = mpPickMeshes[pk[0]] = mpMakePickMesh(pk[0], pk[2]);
      m.mesh.visible = !!pk[1];
      if (pk[1]) {
        m.t += dt;
        m.mesh.position.y = 0.8 + Math.sin(m.t * 2.6) * 0.14;
        m.mesh.rotation.y += dt * 1.3;
      }
    }
    // 临时掉落对账
    var keep = [];
    for (var j = 0; j < mpTempPickups.length; j++) {
      var tp = mpTempPickups[j];
      var found = false;
      for (var n = 0; n < s.tp.length; n++) {
        if (Math.abs(s.tp[n][0] - tp.x) < 0.5 && Math.abs(s.tp[n][1] - tp.z) < 0.5) { found = true; break; }
      }
      if (found) {
        tp.t += dt;
        tp.mesh.position.y = 0.8 + Math.sin(tp.t * 2.6) * 0.14;
        tp.mesh.rotation.y += dt * 1.3;
        keep.push(tp);
      } else {
        scene.remove(tp.mesh);
      }
    }
    for (var q = 0; q < s.tp.length; q++) {
      var exists = false;
      for (var r = 0; r < mpTempPickups.length; r++) {
        if (Math.abs(mpTempPickups[r].x - s.tp[q][0]) < 0.5 && Math.abs(mpTempPickups[r].z - s.tp[q][1]) < 0.5) { exists = true; break; }
      }
      if (!exists) {
        var mesh = TankModels.createCrate();
        mesh.position.set(s.tp[q][0], 0.8, s.tp[q][1]);
        scene.add(mesh);
        keep.push({ mesh: mesh, x: s.tp[q][0], z: s.tp[q][1], t: 0 });
      }
    }
    mpTempPickups = keep;
  }

  /* ---- 事件处理 ---- */

  function mpOnEvent(ev) {
    if (!mp) return;
    switch (ev.k) {
      case 'shell':
        spawnGhostShell(ev);
        break;
      case 'boom':
        mpBoom(ev);
        break;
      case 'kill':
        killfeed(ev.by + ' 击毁了 ' + ev.victim, ev.vid === Net.myId ? 'gold' : '');
        if (ev.vid === Net.myId) mpDie(ev.by);
        else {
          FX.tankExplosion(ev.x, 1.0, ev.z, 1.7);
          AudioSys.explosion(2, volByDist(ev.x, ev.z));
        }
        break;
      case 'streak':
        banner(ev.name + ' ' + ev.msg, ev.n + ' 连杀', 2.2);
        break;
      case 'wave':
        wave = ev.n; mpWaveLeft = ev.count;
        banner('第 ' + ev.n + ' 波', '敌军 ' + ev.count + ' 辆 · 全队迎战', 2.4);
        AudioSys.waveHorn();
        break;
      case 'waveclear':
        killfeed('第 ' + ev.n + ' 波清除　全队奖励 +' + ev.bonus, 'gold');
        AudioSys.record();
        break;
      case 'ekill':
        for (var i = 0; i < enemies.length; i++) {
          if (enemies[i].id === ev.id) {
            var e = enemies[i];
            e.pos.set(ev.x, 0, ev.z);
            mpEnemyDeathFX(e, ev.by, ev.pts, ev.type);
            mpRemoveEnemy(e, true);
            break;
          }
        }
        break;
      case 'edespawn':
        for (var j = 0; j < enemies.length; j++) {
          if (enemies[j].id === ev.id) { mpRemoveEnemy(enemies[j], true); break; }
        }
        break;
      case 'spawnbeacon':
        FX.spawnBeacon(ev.x, ev.z, TankModels.PALETTES[ev.type] ? TankModels.PALETTES[ev.type].accent : 0xff4b3a);
        break;
      case 'chat':
        chatPush(ev.name, ev.text, ev.name === '系统');
        break;
      case 'join':
        killfeed(ev.name + ' 加入房间', '');
        break;
      case 'leave':
        killfeed(ev.name + ' 离开房间', '');
        break;
      case 'respawn':
        // 首次从大厅进场也会广播 respawn，此时并没有死过，不能当重生处理
        if (ev.id === Net.myId && phase === 'mpdead') mpRespawnLocal();
        break;
      case 'pkoff':
        AudioSys.pickup();
        if (ev.by) {
          var mine = false;
          var L = Net.latest();
          if (L) for (var q = 0; q < L.ps.length; q++) if (L.ps[q][0] === Net.myId && L.ps[q][17] === ev.by) mine = true;
          if (mine) {
            floatText(player.pos.x, 2.6, player.pos.z, MP_PICK_NAMES[ev.kind] || '补给', '#9ff3ff', 20);
            healVig = ev.kind === 'repair' ? 1 : healVig;
          }
        }
        break;
      case 'pkheal':
        healVig = 1;
        AudioSys.pickup();
        break;
      case 'modechg':
        updateMpChip(true);
        break;
      case 'hit':
        if (ev.to === Net.myId) hitMarker();
        break;
    }
  }

  function spawnGhostShell(ev) {
    var mesh = TankModels.createShell(ev.c);
    mesh.position.set(ev.x, ev.y, ev.z);
    scene.add(mesh);
    var c = new THREE.Color(ev.c);
    shells.push({
      ghost: true, sid: ev.id,
      pos: new THREE.Vector3(ev.x, ev.y, ev.z),
      prev: new THREE.Vector3(ev.x, ev.y, ev.z),
      vx: ev.vx, vy: ev.vy, vz: ev.vz,
      dmg: 0, mesh: mesh, life: 4.5, trailT: 0,
      cr: c.r, cg: c.g, cb: c.b,
      boltCol: shellBoltColor(ev.c)
    });
    if (ev.own === Net.myId) {
      FX.muzzleFlash(new THREE.Vector3(ev.x, ev.y, ev.z), new THREE.Vector3(ev.vx, ev.vy, ev.vz).normalize(), ev.c === 0xff3ec8 ? 0xff3ec8 : 0x9ff3ff, 1.15);
    }
  }

  function mpBoom(ev) {
    for (var i = shells.length - 1; i >= 0; i--) {
      if (shells[i].ghost && shells[i].sid === ev.id) {
        var s = shells[i];
        if (ev.team !== 'x') {
          FX.explosion(ev.x, ev.y, ev.z, ev.team === 'p' ? 0.85 : (ev.big ? 1.0 : 0.8));
          AudioSys.explosion(0.7, volByDist(ev.x, ev.z));
          if (ev.team === 'e') trauma = Math.min(1, trauma + clamp(0.25 - distToPlayer(ev.x, ev.z) * 0.01, 0, 0.25));
        }
        scene.remove(s.mesh);
        shells.splice(i, 1);
        return;
      }
    }
    // 未匹配到（中途加入等）：直接播放爆炸
    if (ev.team !== 'x') {
      FX.explosion(ev.x, ev.y, ev.z, 0.8);
      AudioSys.explosion(0.7, volByDist(ev.x, ev.z));
    }
  }

  /* ---- 死亡 / 重生 ---- */

  function mpDie(byName) {
    if (phase !== 'playing') return;
    player.alive = false;
    FX.tankExplosion(player.pos.x, 1.0, player.pos.z, 1.7);
    AudioSys.explosion(2, 1);
    AudioSys.setEngine(-1);
    player.model.group.visible = false;
    trauma = 1;
    phase = 'mpdead';
    mpRespawnLeft = mpRespawnMax;
    fireHeld = false;
    aimHeld = false;
    banner('已 阵 亡', '被 ' + byName + ' 击毁', 2.5);
    show(ui['respawn-tip']);
    ui['respawn-tip'].querySelector('.rt-sub').textContent = mpRespawnMax + ' 秒后重生';
  }

  function mpFindMe(ps) {
    if (!ps) return null;
    for (var i = 0; i < ps.length; i++) if (ps[i][0] === Net.myId) return ps[i];
    return null;
  }

  function mpRespawnLocal() {
    phase = 'playing';
    player.alive = true;
    mpCorr.init = false;
    hide(ui['respawn-tip']);
    battleCamForVeh();
    player.model.group.visible = true;
  }

  /* ---- 输入发送 ---- */

  function mpSendInput(dt, playing) {
    mpInputT -= dt;
    if (mpInputT > 0) return;
    mpInputT = 0.05;
    var f = 0, turn = 0;
    if (playing && player.alive && !chatOpen) {
      if (IS_TOUCH) {
        if (stickLen > 0.12) {
          f = stickY > 0 ? stickLen : -stickLen;   // 屏幕向上 = 前进
          turn = clamp(-stickX * 1.7, -1, 1);
        }
      } else {
        turn = (keys.KeyA ? 1 : 0) - (keys.KeyD ? 1 : 0);
        f = keys.KeyW ? 1 : (keys.KeyS ? -1 : 0);
      }
    }
    Net.sendInput({
      f: f, turn: turn,
      ay: player.wantYaw != null ? player.wantYaw : player.turretYawW,
      ap: player.elev || 0,
      fire: !!(playing && fireHeld && player.alive && !chatOpen)
    });
  }

  /* ---- 服务器校正 ---- */

  function mpCorrect(dt) {
    var L = Net.latest();
    if (!L) return;
    var me = null;
    for (var i = 0; i < L.ps.length; i++) if (L.ps[i][0] === Net.myId) { me = L.ps[i]; break; }
    if (!me || !me[7]) return;
    if (!mpCorr.init) {
      mpCorr.init = true;
      player.pos.set(me[1], 0, me[2]);
      player.hullYaw = me[3];
      player.turretYawW = me[4];
      return;
    }
    var dx = me[1] - player.pos.x, dz = me[2] - player.pos.z;
    var d = Math.sqrt(dx * dx + dz * dz);
    if (d > 3) {
      player.pos.x = me[1]; player.pos.z = me[2];
      player.vel = 0;
    } else if (d > 0.04) {
      var k = Math.min(1, dt * 6);
      player.pos.x += dx * k;
      player.pos.z += dz * k;
    }
    var dy = angDiff(player.hullYaw, me[3]);
    if (Math.abs(dy) > 1.2) player.hullYaw = me[3];
    else player.hullYaw += dy * Math.min(1, dt * 5);
  }

  /* ---- 自身状态来自快照 ---- */

  function mpApplySelf() {
    var L = Net.latest();
    var me = mpFindMe(L && L.ps);
    if (!me) return;
    var srvAlive = !!me[7];
    var newHp = me[6];
    if (srvAlive) {
      mpSpawned = true;
      // 只在服务器确认活着时拉回本地；大厅/重连未进场都是 alive=0，绝不能据此自杀
      if (!mpSpectate && (phase === 'mpdead' || !player.alive)) mpRespawnLocal();
      if (newHp < player.hp && player.alive) {
        dmgVig = 1;
        trauma = Math.min(1, trauma + 0.32);
        AudioSys.playerHit();
      }
      if (newHp > player.hp) healVig = 1;
    }
    player.hp = newHp;
    kills = me[13];
    score = me[15];
    player.reload = Math.min(player.reload, me[12] / 100);
    player.mpBuffs = { shield: me[8], boost: me[9], ap: me[10], protect: srvAlive ? me[11] : 0 };
  }

  /* ---- 联机 HUD ---- */

  /* ================= 菜单预览展示台 ================= */
  var menuStage = null;

  function createMenuStage() {
    var grp = new THREE.Group();
    grp.visible = false;

    // 圆形霓虹展示台
    var podiumGeo = new THREE.CylinderGeometry(3.2, 3.5, 0.3, 32);
    var podiumMat = new THREE.MeshStandardMaterial({
      color: 0x0c1828, roughness: 0.3, metalness: 0.6
    });
    var podium = new THREE.Mesh(podiumGeo, podiumMat);
    podium.position.y = -0.15;
    podium.receiveShadow = true;
    grp.add(podium);

    // 霓虹光环
    var ringGeo = new THREE.TorusGeometry(3.0, 0.06, 8, 48);
    var ringMat = new THREE.MeshStandardMaterial({
      color: 0x0a0d12, roughness: 0.3, metalness: 0.2,
      emissive: 0x29e6ff, emissiveIntensity: 1.8
    });
    var ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.02;
    grp.add(ring);

    // 内圈装饰
    var ring2Geo = new THREE.TorusGeometry(2.2, 0.03, 8, 40);
    var ring2 = new THREE.Mesh(ring2Geo, ringMat);
    ring2.rotation.x = Math.PI / 2;
    ring2.position.y = 0.04;
    grp.add(ring2);

    // 地光
    var glowMat = new THREE.MeshBasicMaterial({
      color: 0x29e6ff, transparent: true, opacity: 0.12,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    var glowDisc = new THREE.Mesh(new THREE.CircleGeometry(4.0, 32), glowMat);
    glowDisc.rotation.x = -Math.PI / 2;
    glowDisc.position.y = 0.01;
    grp.add(glowDisc);

    // 几个悬浮装饰柱
    var pillarMat = new THREE.MeshStandardMaterial({
      color: 0x1a2d42, roughness: 0.4, metalness: 0.5,
      emissive: 0x29e6ff, emissiveIntensity: 0.4
    });
    for (var i = 0; i < 6; i++) {
      var ang = (i / 6) * Math.PI * 2;
      var pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 1.8, 8), pillarMat);
      pillar.position.set(Math.cos(ang) * 3.8, 0.9, Math.sin(ang) * 3.8);
      grp.add(pillar);

      var topGlow = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), new THREE.MeshStandardMaterial({
        color: 0x0a0d12, emissive: 0x4df0ff, emissiveIntensity: 2.0
      }));
      topGlow.position.set(Math.cos(ang) * 3.8, 1.9, Math.sin(ang) * 3.8);
      grp.add(topGlow);
    }

    scene.add(grp);
    menuStage = grp;
  }

  var mpChipT = 0;
  function updateMpChip(force) {
    mpChipT -= 0.2;
    if (!force && mpChipT > 0) return;
    mpChipT = 1;
    var m = Net.mode;
    var b = player.mpBuffs || {};
    var buffs = [];
    if (b.shield > 0) buffs.push('🛡' + b.shield + 's');
    if (b.boost > 0) buffs.push('⚡' + b.boost + 's');
    if (b.ap > 0) buffs.push('🔥' + b.ap + 's');
    ui['mp-chip'].innerHTML = '联机 · ' + (m === 'pvp' ? '混战' : '合作') +
      ' · <b>' + Net.playerCount + '</b> 人在线' +
      (buffs.length ? ' · ' + buffs.join(' ') : '') +
      (b.protect > 0 ? ' · 重生保护' : '');
  }

  function renderBoard(s) {
    var rows = [];
    for (var i = 0; i < s.ps.length; i++) {
      var p = s.ps[i];
      if (p[19]) continue;   // 机器人不出现在排行榜
      rows.push({ id: p[0], name: p[17], k: p[13], d: p[14], sc: p[15], st: p[16] });
    }
    rows.sort(function (a, b) { return b.k - a.k || b.sc - a.sc; });
    var html = '<tr><th>车长</th><th class="num">击毁</th><th class="num">阵亡</th><th class="num">连杀</th><th class="num">得分</th></tr>';
    for (var j = 0; j < rows.length; j++) {
      var r = rows[j];
      html += '<tr' + (r.id === Net.myId ? ' class="me"' : '') + '><td>' + esc(r.name) + (r.id === Net.myId ? '（我）' : '') + '</td><td class="num">' + r.k + '</td><td class="num">' + r.d + '</td><td class="num">' + r.st + '</td><td class="num">' + r.sc + '</td></tr>';
    }
    ui['sb-table'].innerHTML = html;
    ui['sb-mode'].textContent = Net.mode === 'pvp' ? '· 混战模式' : '· 合作模式 第' + wave + '波';
    var hint = ui['score-board'] && ui['score-board'].querySelector('.sb-hint');
    if (hint) hint.textContent = IS_TOUCH ? '再点 🏆 关闭 · 联机中实时更新' : '按住 Tab 查看 · 联机中实时更新';
  }

  /* ---- 聊天 ---- */

  function chatPush(name, text, sys) {
    var el = document.createElement('div');
    el.className = 'chat-line' + (sys ? ' sys' : '');
    if (sys) el.textContent = text;
    else el.innerHTML = '<b>' + esc(name) + '</b>：' + esc(text);
    ui['chat-list'].appendChild(el);
    while (ui['chat-list'].children.length > 6) ui['chat-list'].removeChild(ui['chat-list'].firstChild);
    setTimeout(function () { el.style.opacity = '0'; }, 8000);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 8600);
  }

  function chatSendCurrent() {
    var txt = (ui['chat-input'].value || '').trim();
    if (CHAT_DISABLED) {
      killfeed('请先 Linux DO 登录后再发言');
    } else if (txt) {
      Net.chat(txt);
    }
    chatToggle(false);
  }

  function chatToggle(open) {
    chatOpen = open;
    document.body.classList.toggle('chat-focus', !!open);
    var row = ui['chat-input-row'] || ui['chat-input'];
    if (open) {
      show(row);
      show(ui['chat-input']);
      ui['chat-input'].focus();
      fireHeld = false;
      if (ui['t-fire']) ui['t-fire'].classList.remove('on');
      exitLockSilent();
    } else {
      hide(row);
      hide(ui['chat-input']);
      ui['chat-input'].blur();
      ui['chat-input'].value = '';
      if (phase === 'playing' && !IS_TOUCH) requestLock();
    }
  }

  /* ---- 联机帧 ---- */

  function mpFrame(dt, rawDt) {
    var s = Net.sample();
    if (!s) return;
    var playing = (phase === 'playing');

    mpSendInput(rawDt, playing);
    mpApplySelf();

    if (playing && player.alive && mpSpawned) {
      updatePlayer(dt);          // 本地预测
      computeAim();
      updateTurret(dt);
      updateFire(dt);
      mpCorrect(dt);
      syncPlayerModel();
    }

    mpSyncOthers(s);
    if (s.mode === 'pve') {
      wave = s.wave;
      mpWaveLeft = s.left;
      mpSyncEnemies(s);
    } else if (enemies.length) {
      for (var i = enemies.length - 1; i >= 0; i--) mpRemoveEnemy(enemies[i], true);
    }
    mpSyncPickups(s, rawDt);

    if (phase === 'mpdead') {
      mpRespawnLeft -= rawDt;
      var sub = ui['respawn-tip'].querySelector('.rt-sub');
      if (sub) sub.textContent = Math.max(0, Math.ceil(mpRespawnLeft)) + ' 秒后重生';
      // 必须等服务器真正出生，禁止本地假活（否则会和大厅 alive=0 互撞成死亡循环）
      if (mpRespawnLeft <= -0.5) {
        var meLive = mpFindMe(Net.latest() && Net.latest().ps);
        if (meLive && meLive[7]) mpRespawnLocal();
      }
    }

    updateHpUI();
    updateScoreUI();
    updateWaveChip();
    updateMpChip(false);
    if (scoreboardOpen) renderBoard(s);
  }

  /* ================= 界面流转 ================= */

  function isLocked() { return document.pointerLockElement === $('game-canvas'); }
  function requestLock() {
    if (IS_TOUCH || isLocked()) return;
    var el = $('game-canvas');
    if (!el.requestPointerLock) return;
    try {
      var p = el.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) {
        p.catch(function () {
          try {
            var p2 = el.requestPointerLock();
            if (p2 && p2.catch) p2.catch(function () { /* 冷却期拒绝，点击画面可重试 */ });
          } catch (e2) { /* ignore */ }
        });
      }
    } catch (e) {
      try {
        var p3 = el.requestPointerLock();
        if (p3 && p3.catch) p3.catch(function () { /* 冷却期拒绝，点击画面可重试 */ });
      } catch (e3) { /* ignore */ }
    }
  }
  // Windows/Chromium 指针锁定后，系统光标仍会在屏幕边缘回绕，movementX 会突然变成
  // 接近 ±屏幕宽度的值，表现为水平视角瞬移。俯仰有角度钳制，同样尖峰几乎看不出来。
  function pointerLookDelta(v, screenSize) {
    var a = Math.abs(v || 0);
    if (!a) return 0;
    var limit = Math.max(420, (screenSize || 1920) * 0.35);
    return a > limit ? 0 : v;
  }
  function armPointerLook() {
    lookArmedAt = performance.now() + 80;
  }
  function syncAdsLookFromCamera() {
    if (!camera || !tmpB) return;
    camera.getWorldDirection(tmpB);
    wantCamYaw = Math.atan2(tmpB.x, tmpB.z);
    wantCamPitch = clamp(-Math.asin(clamp(tmpB.y, -1, 1)), -0.32, 0.14);
    camYaw = wantCamYaw;
    camPitch = wantCamPitch;
  }
  function exitLockSilent() {
    if (isLocked()) {
      lockExitIgnore = true;
      document.exitPointerLock();
      setTimeout(function () { lockExitIgnore = false; }, 400);
    }
  }

  function resetTouchState() {
    stickId = null; aimId = null;
    stickX = 0; stickY = 0; stickLen = 0;
    fireHeld = false;
    hide(ui['stick-base']);
    if (ui['t-fire']) ui['t-fire'].classList.remove('on');
  }

  function updateTouchChrome() {
    if (!IS_TOUCH) return;
    var play = phase === 'playing' || phase === 'mpdead';
    if (ui['touch-ui']) ui['touch-ui'].classList.toggle('hidden', !play);
    if (ui['t-fire']) ui['t-fire'].classList.toggle('hidden', !play || mpSpectate);
    if (ui['t-chat']) ui['t-chat'].classList.toggle('hidden', !play || !mp);
    if (ui['t-board']) ui['t-board'].classList.toggle('hidden', !play || !mp);
  }

  function toggleScoreboard() {
    if (!mp || (phase !== 'playing' && phase !== 'mpdead' && phase !== 'paused')) return;
    scoreboardOpen = !scoreboardOpen;
    if (scoreboardOpen) {
      show(ui['score-board']);
      var s = Net.sample() || Net.latest();
      if (s) renderBoard(s);
    } else {
      hide(ui['score-board']);
    }
  }

  function touchPlayAllowed() {
    return (phase === 'playing' || phase === 'mpdead') && !chatOpen && !skinModalOpen;
  }

  function resetMatch() {
    for (var i = 0; i < enemies.length; i++) {
      scene.remove(enemies[i].model.group);
      if (enemies[i].hpBar) enemies[i].hpBar.dispose();
    }
    enemies = [];
    for (var j = 0; j < shells.length; j++) scene.remove(shells[j].mesh);
    shells = [];
    for (var k = 0; k < pickups.length; k++) scene.remove(pickups[k].mesh);
    pickups = [];
    wavePending = [];
    waveQueue = [];
    for (var f = 0; f < floats.length; f++) {
      if (floats[f].el.parentNode) floats[f].el.parentNode.removeChild(floats[f].el);
    }
    floats = [];
    ui.killfeed.innerHTML = '';
    hide(ui.banner);
    bannerT = 0;

    score = 0; kills = 0; wave = 0; playTime = 0;
    timeScale = 1; trauma = 0; dmgVig = 0; healVig = 0;
    ui['dmg-vignette'].style.opacity = '0';
    ui['heal-vignette'].style.opacity = '0';

    if (mp) {
      // 联机：清联机对象，位置等首帧快照校正
      mpClearOthers();
      mpClearPicks();
      mpCorr.init = false;
      mpSpawned = false;
      mpWaveLeft = 0;
      player.mpBuffs = null;
      hide(ui['respawn-tip']);
      hide(ui['score-board']);
      scoreboardOpen = false;
      if (chatOpen) chatToggle(false);
      player.hp = player.maxHp;
      player.alive = true;
      player.vel = 0;
      player.reload = 0;
      player.recoil = 0;
      player.model.group.visible = true;
      camYaw = wantCamYaw = Math.PI; camPitch = wantCamPitch = 0.12;
      battleCamForVeh();
      cache.hp = -1; cache.score = -1; cache.waveN = -1; cache.left = -1; cache.reloadPct = -1;
      updateHpUI(); updateScoreUI(); updateWaveChip();
      return;
    }

    player.hp = player.maxHp;
    player.alive = true;
    player.vel = 0;
    player.reload = 0;
    player.recoil = 0;
    player.pos.set(0, 0, 38);
    player.hullYaw = Math.PI;
    player.turretYawW = Math.PI;
    player.elev = 0;
    player.model.group.visible = true;
    syncPlayerModel();

    camYaw = wantCamYaw = Math.PI; camPitch = wantCamPitch = 0.12;
    battleCamForVeh();

    cache.hp = -1; cache.score = -1; cache.waveN = -1; cache.left = -1; cache.reloadPct = -1;
    updateHpUI(); updateScoreUI(); updateWaveChip();
  }

  function startGame(mode) {
    var isMP = mode === 'mp';
    if (isMP && !Net.active) return;
    mp = isMP;
    resetMatch();
    phase = 'playing';
    if (menuStage) menuStage.visible = false;
    hide(ui['screen-start']); hide(ui['screen-pause']); hide(ui['screen-over']);
    closeVehSelect();
    show(ui.hud);
    if (IS_TOUCH) {
      resetTouchState();
      updateTouchChrome();
    } else if (!mpSpectate) requestLock();
    if (mp) {
      show(ui['chat-box']);
      show(ui['mp-chip']);
      killfeed(mpSpectate ? '👁️ 观战中' : (IS_TOUCH ? '联机中 · 💬聊天 · 🏆排行' : '联机中 · 回车聊天 · Tab 战场排行'), '');
    } else {
      hide(ui['chat-box']);
      hide(ui['mp-chip']);
      beginWave(1);
    }
  }

  function pauseGame() {
    if (phase !== 'playing') return;
    phase = 'paused';
    aimHeld = false;
    show(ui['screen-pause']);
    AudioSys.setEngine(-1);
    resetTouchState();
    keys = {};
    fireHeld = false;
    exitLockSilent();
  }

  function resumeGame() {
    if (phase !== 'paused') return;
    phase = 'playing';
    hide(ui['screen-pause']);
    if (IS_TOUCH) updateTouchChrome();
    else requestLock();
  }

  function showOver() {
    phase = 'over';
    timeScale = 1;
    var isRecord = score > best.score;
    if (isRecord) {
      best = { score: score, wave: wave, kills: kills };
      saveBest();
      AudioSys.record();
      show(ui['new-record']);
    } else {
      hide(ui['new-record']);
    }
    ui['over-score'].textContent = score;
    ui['over-kills'].textContent = kills;
    ui['over-wave'].textContent = wave;
    var mm = Math.floor(playTime / 60), ss = Math.floor(playTime % 60);
    ui['over-time'].textContent = mm + ':' + (ss < 10 ? '0' : '') + ss;
    ui['over-best'].textContent = best.score;
    hide(ui.hud);
    hide(ui['touch-ui']);
    updateTouchChrome();
    show(ui['screen-over']);
  }

  function toMenu() {
    exitLockSilent();
    mpLobby = false;
    mpSpectate = false;
    mpWantSpectate = false;
    hide(ui['lobby-info']);
    hide(ui['lobby-players']);
    ui['start-panel'].classList.remove('lobby-mode');
    show(ui['menu-board']);
    refreshRooms();                  // 返回菜单刷新房间列表（按钮恢复为“进入”）
    if (mp) {
      mp = false;
      Net.disconnect();
      hide(ui['chat-box']); hide(ui['chat-input']); hide(ui['chat-input-row']);
      hide(ui['mp-chip']); hide(ui['score-board']); hide(ui['respawn-tip']);
      scoreboardOpen = false;
      if (chatOpen) { chatOpen = false; }
    }
    resetMatch();
    phase = 'menu';
    hide(ui.hud); hide(ui['touch-ui']);
    updateTouchChrome();
    document.body.classList.remove('chat-focus');
    hide(ui['screen-pause']); hide(ui['screen-over']);
    closeVehSelect();
    show(ui['screen-start']);
    loadDailyBoard();
    if (menuStage) {
      menuStage.visible = true;
      menuStage.position.set(0, -0.3, 0);
    }
    player.pos.set(0, 0.3, 0);
    player.hullYaw = -0.4;
    player.turretYawW = -0.4;
    player.elev = 0.08;
    syncPlayerModel();
    // 相机调整到合适角度展示坦克
    camYaw = wantCamYaw = Math.PI * 0.7;
    camPitch = wantCamPitch = 0.2;
    menuCamForVeh();
    updateStartBest();
    AudioSys.setEngine(-1);
    if (!IS_TOUCH) {
      setTimeout(function () {
        if (phase === 'menu' && ui['nick-input']) ui['nick-input'].focus();
      }, 60);
    }
  }

  /* ================= 输入 ================= */

  function bindInput() {
    var canvas = $('game-canvas');

    window.addEventListener('keydown', function (e) {
      AudioSys.unlock();

      // 菜单页回车 = 直接开始联机（仅当焦点不在输入框时；输入框内由自身处理）
      if (e.code === 'Enter' && phase === 'menu' && !e.isComposing) {
        var tgt = e.target;
        if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'BUTTON')) return;
        e.preventDefault();
        joinMP('pvp');
        return;
      }

      // 联机热键
      if (mp) {
        if (e.code === 'Enter') {
          if (chatOpen) return;   // 输入框自身处理
          chatToggle(true);
          e.preventDefault();
          return;
        }
        if (e.code === 'Tab') {
          if (!scoreboardOpen) { scoreboardOpen = true; show(ui['score-board']); }
          e.preventDefault();
          return;
        }
        if (chatOpen) { e.preventDefault(); return; }
      }

      if (e.code === 'Escape') {
        if (pendingEnter) { closeVehSelect(); return; }
        if (closeInfoModals()) return;
        if (phase === 'playing' && !isLocked()) pauseGame();
        return;
      }
      keys[e.code] = true;
      if (e.code === 'Space' || e.code.indexOf('Arrow') === 0) e.preventDefault();
    });
    window.addEventListener('keyup', function (e) {
      if (mp && e.code === 'Tab') {
        scoreboardOpen = false;
        hide(ui['score-board']);
        return;
      }
      keys[e.code] = false;
    });
    window.addEventListener('blur', function () { keys = {}; fireHeld = false; });

    // 聊天输入框：Enter 发送 / Esc 关闭，其余按键放行（不能 preventDefault，否则无法打字）
    ui['chat-input'].addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.isComposing) return;
      if (e.code === 'Enter') {
        e.preventDefault();
        chatSendCurrent();
      } else if (e.code === 'Escape') {
        e.preventDefault();
        chatToggle(false);
      }
    });
    if (ui['chat-send']) {
      ui['chat-send'].addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        chatSendCurrent();
      });
    }

    // 鼠标
    canvas.addEventListener('mousedown', function (e) {
      AudioSys.unlock();
      if (IS_TOUCH) return;
      if (phase === 'playing') {
        if (!isLocked()) requestLock();
        if (e.button === 0) { fireHeld = true; fireBuffer = 0.25; }
        else if (e.button === 2) { aimHeld = true; syncAdsLookFromCamera(); }
      }
    });
    window.addEventListener('mouseup', function (e) {
      if (e.button === 0) fireHeld = false;
      else if (e.button === 2) aimHeld = false;
    });
    window.addEventListener('mousemove', function (e) {
      if (!IS_TOUCH && isLocked() && (phase === 'playing' || phase === 'paused')) {
        if (performance.now() < lookArmedAt) return;
        var mx = pointerLookDelta(e.movementX, screen.width || window.innerWidth);
        var my = pointerLookDelta(e.movementY, screen.height || window.innerHeight);
        if (!mx && !my) return;
        wantCamYaw -= mx * 0.0022;
        var pMin = aimFirstPerson() ? -0.32 : -0.1;
        var pMax = aimFirstPerson() ? 0.14 : 1.05;
        wantCamPitch = clamp(wantCamPitch + my * 0.0022, pMin, pMax);
        camYaw = wantCamYaw;
        camPitch = wantCamPitch;
      }
    });
    canvas.addEventListener('wheel', function (e) {
      if (phase === 'playing') {
        camDist = clamp(camDist + e.deltaY * 0.006, 6.5, 16);
        e.preventDefault();
      }
    }, { passive: false });

    document.addEventListener('pointerlockchange', function () {
      if (isLocked()) {
        armPointerLook();
        return;
      }
      if (phase === 'playing' && !IS_TOUCH) {
        if (lockExitIgnore) { lockExitIgnore = false; return; }
        pauseGame();
      }
    });

    Stage.el.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    // ---- 触屏（摇杆移动 / 右侧瞄准 / 独立开火，参考零区冲突） ----
    var stickZone = $('stick-zone'), aimZone = $('aim-zone');

    function onStickStart(e) {
      AudioSys.unlock();
      if (!touchPlayAllowed()) return;
      e.preventDefault();
      if (stickId !== null) return;
      var t = e.changedTouches[0];
      stickId = t.identifier;
      var l = Stage.toLocal(t.clientX, t.clientY);
      stickBaseX = l.x; stickBaseY = l.y;
      stickX = 0; stickY = 0; stickLen = 0;
      var base = ui['stick-base'];
      base.style.left = l.x + 'px';
      base.style.top = l.y + 'px';
      show(base);
      ui['stick-knob'].style.transform = 'translate(0px, 0px)';
    }
    function onStickMove(e) {
      if (stickId === null) return;
      e.preventDefault();
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        if (t.identifier !== stickId) continue;
        var l = Stage.toLocal(t.clientX, t.clientY);
        var dx = l.x - stickBaseX, dy = l.y - stickBaseY;
        var len = Math.sqrt(dx * dx + dy * dy);
        var max = 56;
        if (len > max) { dx = dx / len * max; dy = dy / len * max; len = max; }
        stickX = dx / max;
        stickY = -dy / max;
        stickLen = len / max;
        ui['stick-knob'].style.transform = 'translate(' + dx.toFixed(1) + 'px, ' + dy.toFixed(1) + 'px)';
      }
    }
    function onStickEnd(e) {
      for (var i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === stickId) {
          stickId = null;
          stickX = 0; stickY = 0; stickLen = 0;
          hide(ui['stick-base']);
        }
      }
    }
    if (stickZone) {
      stickZone.addEventListener('touchstart', onStickStart, { passive: false });
      stickZone.addEventListener('touchmove', onStickMove, { passive: false });
      stickZone.addEventListener('touchend', onStickEnd);
      stickZone.addEventListener('touchcancel', onStickEnd);
    }

    function onAimStart(e) {
      AudioSys.unlock();
      if (!touchPlayAllowed() || mpSpectate) return;
      e.preventDefault();
      if (aimId !== null) return;
      var t = e.changedTouches[0];
      aimId = t.identifier;
      var l = Stage.toLocal(t.clientX, t.clientY);
      aimLastX = l.x; aimLastY = l.y;
    }
    function onAimMove(e) {
      if (aimId === null) return;
      e.preventDefault();
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        if (t.identifier !== aimId) continue;
        var l = Stage.toLocal(t.clientX, t.clientY);
        var dx = l.x - aimLastX, dy = l.y - aimLastY;
        aimLastX = l.x; aimLastY = l.y;
        camYaw -= dx * 0.0042;
        camPitch = clamp(camPitch + dy * 0.0042, -0.1, 1.05);
        wantCamYaw = camYaw;
        wantCamPitch = camPitch;
      }
    }
    function onAimEnd(e) {
      for (var i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === aimId) aimId = null;
      }
    }
    if (aimZone) {
      aimZone.addEventListener('touchstart', onAimStart, { passive: false });
      aimZone.addEventListener('touchmove', onAimMove, { passive: false });
      aimZone.addEventListener('touchend', onAimEnd);
      aimZone.addEventListener('touchcancel', onAimEnd);
    }

    function bindHold(el, on, off) {
      if (!el) return;
      el.addEventListener('pointerdown', function (e) {
        e.preventDefault(); e.stopPropagation();
        if (!touchPlayAllowed()) return;
        try { el.setPointerCapture(e.pointerId); } catch (err) {}
        on();
      });
      el.addEventListener('pointerup', function (e) { e.preventDefault(); e.stopPropagation(); off(); });
      el.addEventListener('pointercancel', off);
    }
    bindHold(ui['t-fire'], function () {
      fireHeld = true; fireBuffer = 0.25;
      ui['t-fire'].classList.add('on');
    }, function () {
      fireHeld = false;
      if (ui['t-fire']) ui['t-fire'].classList.remove('on');
    });
    if (ui['t-chat']) {
      ui['t-chat'].addEventListener('pointerdown', function (e) {
        e.preventDefault(); e.stopPropagation();
        if (!mp || (phase !== 'playing' && phase !== 'mpdead')) return;
        chatToggle(!chatOpen);
      });
    }
    if (ui['t-board']) {
      ui['t-board'].addEventListener('pointerdown', function (e) {
        e.preventDefault(); e.stopPropagation();
        if (!mp) return;
        toggleScoreboard();
      });
    }
  }

  /* ================= 联机加入 ================= */

  function enterLobby(w) {
    if (phase !== 'menu') return;
    mpLobby = true;
    mpSpectate = false;
    ui['lobby-room-name'].textContent = mpRoomName;
    ui['lobby-mode-name'].textContent = (w.mode === 'pvp' ? '混战' : '合作');
    var others = lobbyOthers(w.ps);
    ui['lobby-player-count'].textContent = others.length + 1;
    updateLobbyPlayers(others);
    show(ui['lobby-info']);
    hide(ui['menu-board']);          // 进入房间后隐藏战绩排行，只保留当前玩家
    show(ui['lobby-players']);
    ui['start-panel'].classList.add('lobby-mode');   // 中间面板切换为房间内操作
    refreshRooms();                  // 刷新房间列表：当前房间按钮变为“退出”
    ui['mp-status'].className = 'mp-status ok';
    ui['mp-status'].textContent = '已在 ' + mpRoomName + ' · 点击「进入战斗」开始作战';
    // 若本次目标是观战/直接战斗，连接成功后自动进入
    if (mpWantSpectate) {
      mpWantSpectate = false;
      enterSpectateFromLobby();
    } else if (mpWantBattle) {
      mpWantBattle = false;
      openVehSelect('mp');
    }
  }

  function refreshLobby() {
    if (!mpLobby) return;
    var snap = Net.latest();
    var ps = snap ? snap.ps : null;
    if (ps) {
      var others = lobbyOthers(ps);
      ui['lobby-player-count'].textContent = others.length + 1;
      updateLobbyPlayers(others);
    }
    ui['lobby-mode-name'].textContent = (Net.mode === 'pvp' ? '混战' : '合作');
  }

  function joinMP(wantMode, roomId, roomPass, roomName) {
    mpWantMode = wantMode || 'pvp';
    roomId = roomId || 'official';
    roomPass = roomPass || '';
    var prevRoomId = mpRoomId;
    mpRoomId = roomId;
    mpRoomPass = roomPass;
    mpRoomName = roomName || ((roomId === 'official') ? '官方房' : '玩家房');
    // 登录用户昵称固定为 Linux DO 站点用户名；游客用本地昵称或随机名
    var nick;
    if (auth.loggedIn && auth.user) {
      nick = String(auth.user.username || auth.user.name || '').slice(0, 12);
      ui['nick-input'].value = nick;
    } else {
      nick = (ui['nick-input'].value || '').trim();
      if (!nick) {
        nick = '车长' + Math.floor(Math.random() * 900 + 100);
        ui['nick-input'].value = nick;
      }
    }
    try { localStorage.setItem(NICK_KEY, nick); } catch (e) { }

    if (Net.active) {
      // 已连接：同房间则刷新大厅；不同房间则断开重连；已在战斗中则忽略
      // 必须用写入前的 prevRoomId 比较，否则刚赋的 mpRoomId 会让“换房”永远走刷新、卡住
      if (mpLobby && prevRoomId === roomId) { refreshLobby(); return; }
      if (mpLobby) {
        Net.disconnect();
        mpLobby = false;
      } else {
        return;
      }
    }

    // 武器光效对应的弹色（联机时让服务器按它上色）
    var effIdx = equippedSkins.effect;
    var effSk = (effIdx != null && effIdx >= 0 && TankModels.SKINS[effIdx] && TankModels.SKINS[effIdx].cat === 'effect') ? TankModels.SKINS[effIdx] : null;
    var shellColor = effSk ? effSk.shell : (player.model ? player.model.shellColor : null);

    ui['mp-status'].className = 'mp-status';
    ui['mp-status'].textContent = '连接服务器中…';
    Net.connect(nick, mySkin, shellColor, roomId, roomPass, function (w) {
      ui['mp-status'].className = 'mp-status ok';
      ui['mp-status'].textContent = '已连接 · ' + (w.mode === 'pvp' ? '混战' : '合作') + '模式 · ' + (w.ps.length + 1) + ' 人在线';
      if (w.mode !== wantMode) {
        if (w.ps.length === 0) {
          Net.chat('/mode ' + wantMode);   // 空房间自动切换
        } else {
          ui['mp-status'].textContent += ' · 房间为' + (w.mode === 'pvp' ? '混战' : '合作') + '，游戏中发 /mode ' + wantMode + ' 可切换';
        }
      }
      // 战斗中重连：服务器会把新连接当成大厅玩家（alive=0）。必须重新 ready，
      // 否则本地 3 秒假复活 + 快照未出生 = 死亡循环。
      if (mp && !mpLobby && (phase === 'playing' || phase === 'mpdead' || phase === 'paused')) {
        mpSpawned = false;
        mpCorr.init = false;
        if (mpSpectate) Net.spectate();
        else Net.ready(myVeh);
        return;
      }
      enterLobby(w);
    }, function (errText) {
      if (errText) {
        // 加入被拒 / 被服务器踢出（如长时间无操作自动退出）
        ui['mp-status'].className = 'mp-status err';
        ui['mp-status'].textContent = errText;
        if (phase === 'playing' || phase === 'mpdead' || phase === 'paused') {
          // 战斗中/阵亡/暂停被踢出：自动退出并返回菜单
          toMenu();
          ui['mp-status'].textContent = errText;
        }
        return;
      }
      ui['mp-status'].className = 'mp-status err';
      ui['mp-status'].textContent = '连接断开 · 自动重连中…（或点下方"单机闯关"离线游玩）';
      if (phase === 'playing' || phase === 'mpdead' || phase === 'paused') banner('连接中断', '正在自动重连…', 3);
    });
  }

  /* 房间大厅：进入战斗 / 观战 */
  function enterBattleFromLobby() {
    if (!mpLobby) return;
    Net.ready(myVeh);
    mpLobby = false;
    hide(ui['lobby-info']);
    hide(ui['lobby-players']);
    ui['start-panel'].classList.remove('lobby-mode');
    startGame('mp');
  }
  function enterSpectateFromLobby() {
    if (!mpLobby) return;
    Net.spectate();
    mpLobby = false;
    mpSpectate = true;
    hide(ui['lobby-info']);
    hide(ui['lobby-players']);
    ui['start-panel'].classList.remove('lobby-mode');
    startGame('mp');
    // 观战：本地不参与战斗，隐藏自身坦克，使用俯瞰视角
    player.alive = false;
    player.model.group.visible = false;
    ui['mp-status'].className = 'mp-status ok';
    ui['mp-status'].textContent = '观战中 · 按 ESC 可退出观战';
    killfeed('👁️ 观战模式 · 俯瞰全场', '');
  }

  function leaveLobby() {
    if (!mpLobby) return;
    closeVehSelect();
    mpLobby = false;
    mpWantSpectate = false;
    mpWantBattle = false;
    Net.disconnect();
    hide(ui['lobby-info']);
    hide(ui['lobby-players']);
    ui['start-panel'].classList.remove('lobby-mode');
    show(ui['menu-board']);
    refreshRooms();                  // 刷新房间列表：按钮恢复为“进入”
    ui['mp-status'].className = 'mp-status';
    ui['mp-status'].textContent = '';
  }

  // welcome 不含自己，后续快照含自己：统一去掉本机 id，避免大厅把「我」画两遍
  function lobbyOthers(ps) {
    var others = [];
    var myId = Net.myId;
    if (ps) {
      for (var i = 0; i < ps.length; i++) {
        if (ps[i][0] === myId) continue;
        others.push(ps[i]);
      }
    }
    return others;
  }

  function updateLobbyPlayers(ps) {
    var list = ui['lobby-player-list'];
    if (!list) return;
    var all = lobbyOthers(ps);
    var html = '<div class="lp-row me"><span class="lp-name">' + esc(ui['nick-input'].value || '我') + '（我）</span>' +
      '<span class="lp-tag lobby">大厅等待</span></div>';
    for (var j = 0; j < all.length; j++) {
      var p = all[j];
      var name = p[17];
      var alive = !!p[7];
      var spec = !!p[20];   // 索引：17 name, 18 skin, 19 bot, 20 spectate, 21 ready
      var tag = spec ? '<span class="lp-tag watch">观战中</span>'
        : alive ? '<span class="lp-tag battle">战斗中</span>'
        : '<span class="lp-tag lobby">大厅等待</span>';
      // 不暴露机器人身份
      html += '<div class="lp-row"><span class="lp-name">' + esc(name) + '</span>' + tag + '</div>';
    }
    list.innerHTML = html;
  }

  /* ================= 皮肤选择弹窗 ================= */

  function hexToCss(hex) { return '#' + ('000000' + hex.toString(16)).slice(-6); }

  /* ================= 联机房间列表 ================= */

  var roomModalMode = null;   // 'create' | 'join'
  var roomModalTarget = null; // join 时的目标房间 id
  var roomModalName = '';     // join 时的目标房间名

  function openRoomModal(mode, roomId, roomName) {
    roomModalMode = mode;
    roomModalTarget = roomId || null;
    roomModalName = roomName || '';
    var nameInput = ui['room-name-input'], passInput = ui['room-pass-input'];
    nameInput.value = (mode === 'join' && roomName) ? roomName : '';
    passInput.value = '';
    // join 模式：房间名只读
    nameInput.disabled = mode === 'join';
    ui['room-modal-title'].textContent = mode === 'create' ? '创建房间' : '加入房间';
    ui['room-modal-err'].classList.add('hidden');
    show(ui['room-modal']);
    if (!IS_TOUCH) passInput.focus();
  }
  function closeRoomModal() {
    roomModalMode = null;
    roomModalTarget = null;
    roomModalName = '';
    hide(ui['room-modal']);
  }
  function doRoomModalOk() {
    var name = (ui['room-name-input'].value || '').trim();
    var pass = ui['room-pass-input'].value || '';
    if (roomModalMode === 'create') {
      if (!name) { ui['room-modal-err'].textContent = '请输入房间名称'; ui['room-modal-err'].classList.remove('hidden'); return; }
      Net.createRoom(name, pass).then(function (d) {
        if (d && d.ok) { closeRoomModal(); joinMP('pvp', d.id, pass, name); }
        else { ui['room-modal-err'].textContent = '创建房间失败'; ui['room-modal-err'].classList.remove('hidden'); }
      }).catch(function () {
        ui['room-modal-err'].textContent = '创建房间失败'; ui['room-modal-err'].classList.remove('hidden');
      });
    } else if (roomModalMode === 'join' && roomModalTarget) {
      closeRoomModal();
      joinMP('pvp', roomModalTarget, pass, roomModalName);
    }
  }

  function refreshRooms() {
    var list = ui['room-list'];
    if (!list) return;
    Net.listRooms().then(function (d) {
      var rooms = (d && d.rooms) || [];
      if (!rooms.length) { list.innerHTML = '<div class="room-empty">暂无房间，可点击上方「＋ 建房」创建</div>'; return; }
      var html = '';
      for (var i = 0; i < rooms.length; i++) {
        var r = rooms[i];
        var tag = r.official ? '官方' : '玩家';
        var lock = r.locked ? '🔒' : '';
        // 当前所在房间：按钮显示“退出”
        var isCur = mpLobby && r.id === mpRoomId;
        var isFull = !isCur && r.count >= r.max;
        var btnCls = isCur ? 'rr-join leave' : (isFull ? 'rr-join full' : 'rr-join');
        var btnLabel = isCur ? '退出' : (isFull ? '已满' : '进入');
        html += '<div class="room-row' + (r.official ? ' official' : '') + (isCur ? ' current' : '') + (isFull ? ' full' : '') + '">' +
          '<div class="rr-top">' +
            '<span class="rr-name">' + esc(r.name) + '</span>' +
            '<span class="rr-lock">' + lock + '</span>' +
          '</div>' +
          '<div class="rr-bottom">' +
            '<span class="rr-tag">' + tag + ' · ' + (r.mode === 'pve' ? '合作' : '混战') + '</span>' +
            '<span class="rr-count">' + r.count + '/' + r.max + '</span>' +
            '<button class="' + btnCls + '" data-id="' + r.id + '" data-name="' + esc(r.name) + '" data-locked="' + (r.locked ? 1 : 0) + '" data-leave="' + (isCur ? 1 : 0) + '" data-full="' + (isFull ? 1 : 0) + '" data-max="' + (r.max || 8) + '" type="button"' + (isFull ? ' disabled' : '') + '>' + btnLabel + '</button>' +
          '</div>' +
          '</div>';
      }
      list.innerHTML = html;
      var btns = list.querySelectorAll('.rr-join');
      for (var i2 = 0; i2 < btns.length; i2++) {
        (function (b) {
          b.addEventListener('click', function () {
            var rid = b.getAttribute('data-id');
            var rname = b.getAttribute('data-name') || '';
            // 当前房间：点击为退出
            if (b.getAttribute('data-leave') === '1') {
              leaveLobby();
              return;
            }
            if (b.getAttribute('data-full') === '1') {
              ui['mp-status'].className = 'mp-status err';
              ui['mp-status'].textContent = '房间已满（最多 ' + (b.getAttribute('data-max') || '8') + ' 人）';
              return;
            }
            if (b.getAttribute('data-locked') === '1') {
              openRoomModal('join', rid, rname);
            } else {
              joinMP('pvp', rid, '', rname);
            }
          });
        })(btns[i2]);
      }
    }).catch(function () {
      list.innerHTML = '<div class="room-empty">房间列表加载失败</div>';
    });
  }

  function initPreviewScene() {
    if (previewRenderer) return;
    var canvas = ui['skin-preview-canvas'];
    if (!canvas) return;
    var w = canvas.clientWidth || 480, h = canvas.clientHeight || 200;
    canvas.width = w * (window.devicePixelRatio || 1);
    canvas.height = h * (window.devicePixelRatio || 1);
    previewRenderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: !IS_TOUCH, alpha: true });
    previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, IS_TOUCH ? 1.15 : 2));
    previewRenderer.setSize(w, h, false);
    previewScene = new THREE.Scene();
    previewCamera = new THREE.PerspectiveCamera(35, w / h, 0.1, 50);
    previewCamera.position.set(4, 2.8, 5);
    previewCamera.lookAt(0, 0.6, 0);
    // 灯光
    var amb = new THREE.AmbientLight(0x406080, 0.7);
    previewScene.add(amb);
    var key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(4, 6, 3);
    previewScene.add(key);
    var rim = new THREE.DirectionalLight(0x4080ff, 0.6);
    rim.position.set(-3, 3, -4);
    previewScene.add(rim);
    // 地面光圈
    var ringGeo = new THREE.RingGeometry(1.5, 2, 32);
    var ringMat = new THREE.MeshBasicMaterial({ color: 0x29e6ff, transparent: true, opacity: 0.2, side: THREE.DoubleSide });
    var ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.01;
    previewScene.add(ring);
  }

  function setPreviewSkin(idx) {
    tempSkin = idx;
    var s = TankModels.SKINS[idx];
    if (!s) { renderSkinGrid(); return; }
    // 更新预览名称（不依赖 3D 场景是否就绪）
    if (ui['preview-name']) {
      ui['preview-name'].textContent = s.name;
    }
    if (!previewScene) { renderSkinGrid(); return; }
    if (previewTank && previewTank.group) { previewScene.remove(previewTank.group); }
    // 预览组合：选中项应用到对应部位，其他部位保持已装备状态
    var bodySkinIdx = s.cat === 'body' ? idx : equippedSkins.body;
    var extras = {
      turret: s.cat === 'turret' ? (s.name === '卸下' ? -1 : idx) : equippedSkins.turret,
      barrel: s.cat === 'barrel' ? idx : equippedSkins.barrel,
      effect: s.cat === 'effect' ? idx : equippedSkins.effect,
      chassis: myVeh
    };
    previewTank = TankModels.createTank('player', bodySkinIdx, extras);
    if (previewTank && previewTank.group) {
      previewTank.group.scale.setScalar(0.74 * (previewTank.scale || 1));
      previewTank.group.position.y = 0;
      previewScene.add(previewTank.group);
    }
    renderSkinGrid();
  }

  function switchCat(cat) {
    skinCat = cat;
    skinPage = 0;
    // 更新标签样式
    if (ui['skin-cats']) {
      var btns = ui['skin-cats'].querySelectorAll('.cat-btn');
      for (var b = 0; b < btns.length; b++) {
        btns[b].classList.toggle('active', btns[b].getAttribute('data-cat') === cat);
      }
    }
    // 如果当前选中不在这个分类，选中第一个该分类的物品
    var filtered = getFilteredSkins();
    if (filtered.length > 0) {
      var found = false;
      for (var f = 0; f < filtered.length; f++) {
        if (filtered[f].idx === tempSkin) { found = true; break; }
      }
      if (!found) setPreviewSkin(filtered[0].idx);
      else renderSkinGrid();
    }
  }

  function getFilteredSkins() {
    var list = [];
    for (var i = 0; i < TankModels.SKINS.length; i++) {
      var s = TankModels.SKINS[i];
      if (skinCat === 'all' || s.cat === skinCat) {
        list.push({ idx: i, skin: s });
      }
    }
    return list;
  }

  function equipSkin(idx) {
    var s = TankModels.SKINS[idx];
    if (!s || !s.owned) return; // 未拥有不能装备
    if (s.cat === 'turret' && s.name === '卸下') {
      equippedSkins.turret = -1;
    } else {
      equippedSkins[s.cat] = idx;
    }
    if (s.cat === 'body') {
      mySkin = idx;
      try { localStorage.setItem(SKIN_KEY, String(idx)); } catch (e) { }
    }
    // 持久化全部部位装备
    try { localStorage.setItem(EQUIP_KEY, JSON.stringify(equippedSkins)); } catch (e) { }
    // 任意部位变更都重建玩家坦克模型（主菜单展示 + 战斗中同步生效）
    if (player) {
      scene.remove(player.model.group);
      var t = TankModels.createTank('player', mySkin, equipExtras());
      scene.add(t.group);
      player.model = t;
      player.radius = t.radius;
      player.height = t.height;
      syncPlayerModel();
    }
    renderSkinGrid();
    AudioSys.uiClick();
  }

  function openSkinModal() {
    skinModalOpen = true;
    tempSkin = mySkin;
    skinPage = 0;
    skinCat = 'all';
    show(ui['skin-modal']);
    initPreviewScene();
    setTimeout(function () {
      setPreviewSkin(tempSkin);
      // 重置分类标签
      if (ui['skin-cats']) {
        var btns = ui['skin-cats'].querySelectorAll('.cat-btn');
        for (var b = 0; b < btns.length; b++) {
          btns[b].classList.toggle('active', btns[b].getAttribute('data-cat') === 'all');
        }
      }
      if (previewRenderer) previewRenderer.setSize(
        ui['skin-preview-canvas'].clientWidth, ui['skin-preview-canvas'].clientHeight, false
      );
    }, 50);
    AudioSys.uiClick();
  }

  function closeSkinModal() {
    skinModalOpen = false;
    hide(ui['skin-modal']);
    AudioSys.uiClick();
  }

  function openInfoModal(id) {
    if (id !== 'about-modal' && ui['about-modal']) hide(ui['about-modal']);
    if (id !== 'more-modal' && ui['more-modal']) hide(ui['more-modal']);
    if (ui[id]) show(ui[id]);
  }

  function closeInfoModals() {
    var closed = false;
    ['about-modal', 'more-modal'].forEach(function (id) {
      if (ui[id] && !ui[id].classList.contains('hidden')) {
        hide(ui[id]);
        closed = true;
      }
    });
    return closed;
  }

  function renderSkinGrid() {
    var grid = ui['skin-grid'];
    if (!grid) return;
    var filtered = getFilteredSkins();
    var total = filtered.length;
    var totalPages = Math.ceil(total / SKINS_PER_PAGE);
    skinPage = Math.max(0, Math.min(skinPage, Math.max(0, totalPages - 1)));
    var start = skinPage * SKINS_PER_PAGE;
    var end = Math.min(start + SKINS_PER_PAGE, total);
    var html = '';
    for (var i = start; i < end; i++) {
      var item = filtered[i];
      var idx = item.idx;
      var s = item.skin;
      var rarity = s.rarity || 'common';
      var rarityLabel = rarity === 'epic' ? '史诗' : rarity === 'rare' ? '稀有' : '普通';
      var isSel = idx === tempSkin;
      var isEquipped = equippedSkins[s.cat] === idx || (s.name === '卸下' && equippedSkins.turret === -1);
      var equippedClass = isEquipped ? ' equipped' : '';
      var ownedClass = s.owned ? ' owned' : '';
      var iconHtml = s.icon ? '<span class="sc-icon-emoji">' + s.icon + '</span>' : '';
      html += '<div class="skin-card ' + rarity + ownedClass + (isSel ? ' sel' : '') + '" data-i="' + idx + '" style="' +
        '--sc-body:' + hexToCss(s.body) + ';--sc-dark:' + hexToCss(s.dark) + ';--sc-accent:' + hexToCss(s.accent) + ';--sc-track:' + hexToCss(s.track) + '">' +
        (s.owned ? '<span class="skin-owned-tag">限免</span>' : '') +
        '<span class="skin-rarity ' + rarity + '">' + rarityLabel + '</span>' +
        '<div class="sc-icon">' + iconHtml + '</div>' +
        '<div class="skin-name">' + s.name + '</div>' +
        '<div class="skin-source">' + s.source + '</div>' +
        '<button class="skin-equip-btn' + equippedClass + '" data-equip="' + idx + '">' +
          (isEquipped ? '已装备' : (s.owned ? '装备' : '未拥有')) +
        '</button>' +
        '</div>';
    }
    grid.innerHTML = html;
    ui['skin-page-info'].textContent = (skinPage + 1) + ' / ' + Math.max(1, totalPages);
    ui['skin-prev'].disabled = skinPage <= 0;
    ui['skin-next'].disabled = skinPage >= totalPages - 1;
  }

  function applySkin(idx) {
    equipSkin(idx);
  }

  /* ================= 历史排行榜 ================= */

  function loadHistoryBoard() {
    fetch('/api/leaderboard').then(function (r) { return r.json(); }).then(function (d) {
      var listEl = ui['mb-list'];
      if (!listEl) return;
      if (!d.top || !d.top.length) {
        listEl.innerHTML = '<div class="mb-empty">虚位以待 · 打出你的战绩</div>';
        if (ui['online-num']) ui['online-num'].textContent = d.online != null ? d.online : '0';
        return;
      }
      if (ui['online-num']) ui['online-num'].textContent = d.online != null ? d.online : '0';
      var html = '';
      var showCount = Math.min(20, d.top.length);
      for (var i = 0; i < showCount; i++) {
        var t = d.top[i];
        var rankClass = i < 3 ? ' rank-' + (i + 1) : '';
        var rankDisplay;
        if (i === 0) {
          rankDisplay = '🥇';
        } else if (i === 1) {
          rankDisplay = '🥈';
        } else if (i === 2) {
          rankDisplay = '🥉';
        } else {
          rankDisplay = i + 1;
        }
        var deaths = t.deaths || 0;
        var bossKills = t.bossKills || t.boss || Math.floor(Math.random() * 5); // 模拟BOSS数据
        var streak = t.bestStreak || t.streak || 0;
        html += '<div class="mb-row' + rankClass + '">' +
          '<span class="mb-rank">' + rankDisplay + '</span>' +
          '<span class="mb-name">' + esc(t.name) + '</span>' +
          '<span class="mb-kills">' + t.kills + '</span>' +
          '<span class="mb-deaths">' + deaths + '</span>' +
          '<span class="mb-boss">' + bossKills + '</span>' +
          '<span class="mb-streak">' + (streak > 0 ? '🔥' + streak : '-') + '</span>' +
          '</div>';
      }
      listEl.innerHTML = html;
    }).catch(function () { /* 离线时静默 */ });
  }

  var dailyBoardTab = 'all';
  var dailyClaimBusy = false;
  var soloWave5Sent = false;

  function reportSoloWave5() {
    if (soloWave5Sent || !auth.loggedIn) return;
    soloWave5Sent = true;
    fetch('/api/daily/solo-wave', { method: 'POST', credentials: 'same-origin' }).then(function (r) {
      return r.json();
    }).then(function (d) {
      if (d && d.ok) loadDailyBoard();
      else soloWave5Sent = false;
    }).catch(function () { soloWave5Sent = false; });
  }

  function applyDailyMe(me, slots) {
    var killsEl = ui['daily-kills'];
    var waveEl = ui['daily-wave5'];
    var dailyFill = ui['daily-bar-fill'];
    me = me || {};
    slots = slots || {};
    var need = 11;
    var kills = me.kills || 0;
    if (killsEl) killsEl.textContent = kills;
    if (waveEl) {
      waveEl.textContent = me.soloWave5 ? '已通' : '未通';
      waveEl.style.color = me.soloWave5 ? '#5effa8' : '#8a9aac';
    }
    var pct = 0;
    if (me.claimed || me.eligible || me.soloWave5) pct = 100;
    else pct = Math.min(100, Math.round((kills / need) * 100));
    if (dailyFill) dailyFill.style.width = pct + '%';
    // 发 NL 入口暂隐藏，保留今日击杀/通关展示
  }

  function loadDailyBoard() {
    fetch('/api/daily', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (d) {
      var listEl = ui['mb-daily-list'];
      applyDailyMe(d.me, d.slots);
      if (!listEl) return;
      if (!d.top || !d.top.length) {
        listEl.innerHTML = '<div class="mb-empty">今日虚位以待 · 打出你的击杀</div>';
        return;
      }
      var html = '';
      var showCount = Math.min(20, d.top.length);
      for (var i = 0; i < showCount; i++) {
        var t = d.top[i];
        var rankClass = i < 3 ? ' rank-' + (i + 1) : '';
        var rankDisplay = i === 0 ? '🥇' : (i === 1 ? '🥈' : (i === 2 ? '🥉' : (i + 1)));
        var waveMark = t.soloWave5 ? '✓' : '-';
        html += '<div class="mb-row' + rankClass + '">' +
          '<span class="mb-rank">' + rankDisplay + '</span>' +
          '<span class="mb-name">' + esc(t.name) + '</span>' +
          '<span class="mb-kills">' + (t.kills || 0) + '</span>' +
          '<span class="mb-wave' + (t.soloWave5 ? ' ok' : '') + '">' + waveMark + '</span>' +
          '</div>';
      }
      listEl.innerHTML = html;
    }).catch(function () { /* 离线时静默 */ });
  }

  function showBoardTab(tab) {
    dailyBoardTab = tab === 'daily' ? 'daily' : 'all';
    if (ui['btn-board-all']) ui['btn-board-all'].classList.toggle('on', dailyBoardTab === 'all');
    if (ui['btn-daily']) ui['btn-daily'].classList.toggle('on', dailyBoardTab === 'daily');
    if (dailyBoardTab === 'daily') {
      if (ui['mb-all-panel']) hide(ui['mb-all-panel']);
      if (ui['mb-daily-panel']) show(ui['mb-daily-panel']);
      loadDailyBoard();
    } else {
      if (ui['mb-daily-panel']) hide(ui['mb-daily-panel']);
      if (ui['mb-all-panel']) show(ui['mb-all-panel']);
      loadHistoryBoard();
    }
  }

  function claimDailyNl() {
    if (!auth.loggedIn) {
      location.href = auth.loginUrl || '/oauth/linuxdo';
      return;
    }
    if (dailyClaimBusy) return;
    dailyClaimBusy = true;
    var btn = ui['btn-daily-claim'];
    var homeBtn = ui['btn-home-claim'];
    if (ui['home-claim']) ui['home-claim'].className = 'claim-card is-busy';
    if (btn) { btn.disabled = true; btn.textContent = '发放中…'; btn.className = 'daily-claim-btn is-busy'; }
    if (homeBtn) { homeBtn.disabled = true; homeBtn.textContent = '发放中…'; }
    var tip = ui['daily-claim-tip'];
    var homeTip = ui['home-claim-tip'];
    function setTip(text, cls) {
      if (tip) { tip.textContent = text; tip.className = 'daily-claim-tip' + (cls ? ' ' + cls : ''); }
      if (homeTip) { homeTip.textContent = text; homeTip.className = 'home-claim-tip' + (cls ? ' ' + cls : ''); }
    }
    setTip('正在发放…', '');
    fetch('/api/daily/claim', { method: 'POST', credentials: 'same-origin' }).then(function (r) {
      return r.json();
    }).then(function (d) {
      dailyClaimBusy = false;
      if (d && d.ok) {
        setTip(d.text || '已发放 10 NL', 'ok');
        applyDailyMe(d.me, d.slots);
        loadDailyBoard();
      } else {
        setTip((d && d.text) || '领取失败', 'err');
        applyDailyMe(d && d.me, d && d.slots);
        loadDailyBoard();
      }
    }).catch(function () {
      dailyClaimBusy = false;
      setTip('网络错误', 'err');
      loadDailyBoard();
    });
  }

  /* ================= UI 绑定 ================= */

  function bindUI() {
    function click(id, fn) {
      var el = $(id);
      if (!el) return;
      el.addEventListener('click', function (e) {
        AudioSys.unlock();
        AudioSys.uiClick();
        fn(e);
      });
    }
    click('btn-start', function () {
      if (skinModalOpen) return;
      if (mpLobby) { openVehSelect('mp'); return; }
      mpWantBattle = true;
      joinMP('pvp');
    });   // 主按钮默认联机混战；已进房间大厅则先选车再进战斗
    click('btn-mp-pvp', function () { joinMP('pvp'); });
    click('btn-mp-pve', function () { joinMP('pve'); });
    click('btn-sp', function () { if (mpLobby) leaveLobby(); openVehSelect('sp'); });    // 单机为次级入口
    // 房间：刷新 / 创建
    click('btn-refresh-rooms', function () { refreshRooms(); });
    click('btn-create-room', function () {
      if (!auth.loggedIn) {
        ui['mp-status'].className = 'mp-status err';
        ui['mp-status'].textContent = '游客不能创建房间，请先使用 Linux DO 登录';
        return;
      }
      openRoomModal('create');
    });
    // 房间弹窗
    ui['room-modal'].addEventListener('click', function (e) {
      if (e.target.hasAttribute('data-close')) closeRoomModal();
    });
    click('room-modal-ok', function () { doRoomModalOk(); });
    ui['room-pass-input'].addEventListener('keydown', function (e) {
      if (e.code === 'Enter') { e.preventDefault(); doRoomModalOk(); }
    });
    refreshRooms();   // 首次加载房间列表
    document.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.veh-card') : null;
      if (!btn) return;
      var type = btn.getAttribute('data-veh');
      if (!type) return;
      AudioSys.unlock();
      AudioSys.uiClick();
      selectVehicle(type);
    });
    click('btn-veh-cancel', closeVehSelect);
    click('btn-resume', resumeGame);
    click('btn-restart-pause', function () {
      if (mp) { toMenu(); mpWantBattle = true; joinMP(mpWantMode, mpRoomId, mpRoomPass, mpRoomName); return; }   // 联机重开 = 重进房间并直接进入战斗
      openVehSelect('sp');
    });
    click('btn-restart-over', function () { openVehSelect('sp'); });
    click('btn-menu-pause', toMenu);
    click('btn-menu-over', toMenu);
    click('btn-pause', pauseGame);

    // 换装按钮
    click('btn-skin', openSkinModal);
    click('skin-prev', function () { if (skinPage > 0) { skinPage--; renderSkinGrid(); } });
    click('skin-next', function () {
      var filtered = getFilteredSkins();
      var totalPages = Math.ceil(filtered.length / SKINS_PER_PAGE);
      if (skinPage < totalPages - 1) { skinPage++; renderSkinGrid(); }
    });

    // 其他按钮
    click('btn-watch', function () {
      if (skinModalOpen) return;
      if (mpLobby) { enterSpectateFromLobby(); return; }
      // 未进房间：先加入官方房大厅，连接成功后再进入观战
      mpWantSpectate = true;
      joinMP('pvp');
    });
    click('btn-about', function () { openInfoModal('about-modal'); });
    click('btn-more', function () { openInfoModal('more-modal'); });
    click('btn-board-all', function () { showBoardTab('all'); });
    click('btn-daily', function () { showBoardTab('daily'); });
    // 发 NL 入口暂隐藏：不绑定领取按钮
    // click('btn-daily-claim', function () { claimDailyNl(); });
    // click('btn-home-claim', function () { claimDailyNl(); });

    // 关闭弹窗（遮罩和X按钮）
    ui['skin-modal'].addEventListener('click', function (e) {
      if (e.target.hasAttribute('data-close')) closeSkinModal();
    });
    ['about-modal', 'more-modal'].forEach(function (id) {
      if (!ui[id]) return;
      ui[id].addEventListener('click', function (e) {
        if (e.target.hasAttribute('data-close')) hide(ui[id]);
      });
    });

    // 分类标签点击
    if (ui['skin-cats']) {
      ui['skin-cats'].addEventListener('click', function (e) {
        var btn = e.target.closest ? e.target.closest('.cat-btn') : null;
        if (!btn) return;
        var cat = btn.getAttribute('data-cat');
        if (cat) switchCat(cat);
        AudioSys.uiClick();
      });
    }

    // 皮肤网格点击（选择+装备）
    ui['skin-grid'].addEventListener('click', function (e) {
      // 装备按钮
      var equipBtn = e.target.closest ? e.target.closest('.skin-equip-btn') : null;
      if (equipBtn) {
        e.stopPropagation();
        var eIdx = parseInt(equipBtn.getAttribute('data-equip'), 10) || 0;
        equipSkin(eIdx);
        setPreviewSkin(eIdx);   // 装备后同步刷新左侧实时预览
        return;
      }
      // 卡片点击选择
      var card = e.target.closest ? e.target.closest('.skin-card') : null;
      if (!card) return;
      var idx = parseInt(card.getAttribute('data-i'), 10) || 0;
      setPreviewSkin(idx);
      AudioSys.uiClick();
    });

    // 昵称：恢复 + 回车直接联机 + 阻止按键漏进游戏
    try { ui['nick-input'].value = localStorage.getItem(NICK_KEY) || ''; } catch (e) { }
    ui['nick-input'].addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (skinModalOpen) return;
      if (e.isComposing) return;   // 中文输入法选词回车不触发
      if (e.code === 'Enter' && phase === 'menu') {
        e.preventDefault();
        joinMP('pvp');
      }
      if (e.code === 'Escape' && skinModalOpen) closeSkinModal();
    });
    ui['nick-input'].addEventListener('keyup', function (e) { e.stopPropagation(); });

    function bindToggle(id, isMusic) {
      var el = $(id);
      if (!el) return;
      el.addEventListener('click', function () {
        AudioSys.unlock();
        if (isMusic) AudioSys.setMusic(!AudioSys.musicOn);
        else AudioSys.setSfx(!AudioSys.sfxOn);
        AudioSys.uiClick();
        refreshToggles();
      });
    }
    bindToggle('tg-music-start', true);
    bindToggle('tg-music-pause', true);
    bindToggle('tg-sfx-start', false);
    bindToggle('tg-sfx-pause', false);
    refreshToggles();

    if (IS_TOUCH) {
      hide(ui['help-pc']);
      show(ui['help-touch']);
    } else {
      show(ui['help-pc']);
      hide(ui['help-touch']);
    }
  }

  function refreshToggles() {
    // 开始页的音乐/音效按钮
    var musicStart = ui['tg-music-start'], sfxStart = ui['tg-sfx-start'];
    if (musicStart) {
      var onMusic = AudioSys.musicOn;
      musicStart.textContent = onMusic ? '音乐 开' : '音乐 关';
      musicStart.classList.toggle('on', onMusic);
      musicStart.classList.toggle('off', !onMusic);
    }
    if (sfxStart) {
      var onSfx = AudioSys.sfxOn;
      sfxStart.textContent = onSfx ? '音效 开' : '音效 关';
      sfxStart.classList.toggle('on', onSfx);
      sfxStart.classList.toggle('off', !onSfx);
    }
    // 暂停页
    [['tg-music-pause', true], ['tg-sfx-pause', false]].forEach(function (it) {
      var el = $(it[0]);
      if (!el) return;
      var on = it[1] ? AudioSys.musicOn : AudioSys.sfxOn;
      el.textContent = (it[1] ? '背景音乐：' : '音效：') + (on ? '开' : '关');
      el.classList.toggle('off', !on);
    });
  }

  /* ================= 自动画质 ================= */

  var fpsEMA = 60, qTimer = 0, degradeLevel = 0;
  function autoQuality(rawDt) {
    fpsEMA = fpsEMA * 0.96 + (1 / Math.max(0.001, rawDt)) * 0.04;
    qTimer += rawDt;
    if (qTimer < 3) return;
    qTimer = 0;
    if (fpsEMA >= 42 || degradeLevel >= 3) return;
    degradeLevel++;
    if (degradeLevel === 1 && World.sun && World.sun.castShadow) {
      World.sun.shadow.mapSize.set(1024, 1024);
      if (World.sun.shadow.map) { World.sun.shadow.map.dispose(); World.sun.shadow.map = null; }
    } else if (degradeLevel === 2 && World.sun) {
      World.sun.castShadow = false;
    } else if (degradeLevel === 3) {
      QUALITY.maxPR = Math.max(1.1, QUALITY.maxPR * 0.72);
      FX.setDensity(0.5);
      Stage.resize();
    }
  }

  /* ================= 主循环 ================= */

  var lastT = 0;
  function loop(tNow) {
    requestAnimationFrame(loop);
    if (!lastT) lastT = tNow;
    var rawDt = Math.min(0.05, (tNow - lastT) / 1000) || 0.016;
    lastT = tNow;
    elapsed += rawDt;
    autoQuality(rawDt);

    // 皮肤动效：玩家坦克与换装预览（每帧驱动能量环/炮口光效）
    if (player && player.model && player.model.updateSkin) player.model.updateSkin(elapsed);
    if (previewTank && previewTank.updateSkin) previewTank.updateSkin(elapsed);

    var dt = rawDt * timeScale;

    // 房间大厅：定时从快照刷新玩家列表
    if (mpLobby) {
      mpLobbyT -= rawDt;
      if (mpLobbyT <= 0) { mpLobbyT = 1; refreshLobby(); }
    }

    if (mp && (phase === 'playing' || phase === 'mpdead' || phase === 'paused')) {
      // 联机：服务器权威，本地帧做输入/预测/渲染同步（暂停时也保持同步）
      if (phase === 'playing') playTime += rawDt;
      mpFrame(dt, rawDt);
      updateShells(dt);
    } else if (phase === 'playing' || phase === 'dying') {
      if (phase === 'playing') playTime += rawDt;
      updateWaveLogic(dt);
      if (player.alive && phase === 'playing') {
        updatePlayer(dt);
        computeAim();
        updateTurret(dt);
        updateFire(dt);
        syncPlayerModel();
      }
      for (var i = 0; i < enemies.length; i++) updateEnemy(enemies[i], dt);
      separateTanks();
      updateShells(dt);
      updatePickups(dt);
      if (phase === 'dying') {
        dieT -= rawDt;
        if (dieT <= 0) showOver();
      }
    } else if (phase === 'menu') {
      // 菜单展示：坦克整体缓慢旋转 + 炮塔反向微动
      player.hullYaw += rawDt * 0.35;
      player.turretYawW = player.hullYaw + Math.sin(elapsed * 0.8) * 0.3;
      player.elev = 0.06 + Math.sin(elapsed * 0.5) * 0.04;
      syncPlayerModel();
    }

    if (phase !== 'paused') {
      updateCamera(phase === 'playing' || phase === 'dying' || phase === 'mpdead' ? dt : rawDt);
      FX.update(dt);
    }

    if (phase === 'playing' || phase === 'dying' || phase === 'mpdead') updateHUD(rawDt);

    if (renderer) renderer.render(scene, camera);

    // 换装弹窗3D预览渲染
    if (skinModalOpen && previewRenderer && previewScene && previewCamera && previewTank) {
      previewAnimY += rawDt * 0.8;
      previewTank.group.rotation.y = previewAnimY;
      previewTank.turret.rotation.y = Math.sin(previewAnimY * 0.5) * 0.3;
      previewRenderer.render(previewScene, previewCamera);
    }
  }

  /* ================= 启动 ================= */

  // 移动端横屏提示：竖屏时全屏提示旋转，支持一键进入全屏（系统锁横屏）
  function isPortrait() { return window.innerHeight > window.innerWidth; }
  function setRotateStatus(text) {
    var el = document.getElementById('rotateStatus');
    if (el) el.textContent = text || '';
  }
  function updateRotateHint() {
    if (!IS_TOUCH) return;
    var portrait = isPortrait();
    document.body.classList.toggle('portrait', portrait);
    var hint = document.getElementById('rotateHint');
    if (hint) hint.classList.toggle('hidden', !portrait);
  }
  function requestLandscape() {
    if (!IS_TOUCH) return;
    setRotateStatus('正在进入全屏…');
    var root = document.documentElement;
    function goFull() {
      if (root.requestFullscreen) return root.requestFullscreen();
      if (root.webkitRequestFullscreen) return root.webkitRequestFullscreen();
      if (root.webkitEnterFullscreen) return root.webkitEnterFullscreen();
      return Promise.reject();
    }
    goFull().then(function () {
      setTimeout(function () {
        updateRotateHint();
        Stage.resize();
        setRotateStatus(isPortrait() ? '已进入全屏，请现在旋转手机至横屏' : '已进入全屏');
      }, 120);
    }).catch(function () {
      setRotateStatus('无法进入全屏，请手动旋转屏幕');
      updateRotateHint();
    });
  }
  function initMobileLandscape() {
    if (!IS_TOUCH) return;
    updateRotateHint();
    window.addEventListener('orientationchange', function () {
      setTimeout(function () { updateRotateHint(); Stage.resize(); }, 120);
    });
    var btn = document.getElementById('btnRotateLandscape');
    if (btn) btn.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); requestLandscape(); });
    var pauseBtn = document.getElementById('btn-pause-landscape');
    if (pauseBtn) pauseBtn.addEventListener('click', function (e) { e.preventDefault(); requestLandscape(); });
  }

  // Linux DO 登录：查询登录态并刷新界面（未登录时游客不可发言、不上榜）
  function updateOAuthUI() {
    var ni = ui['nick-input'];
    var pi = ui['player-info'];
    var av = ui['oauth-avatar'];
    if (auth.loggedIn && auth.user) {
      CHAT_DISABLED = false;
      ui['oauth-tip'].textContent = '';
      ui['oauth-status'].textContent = auth.user.username || auth.user.name;
      if (av) {
        var n = String(auth.user.username || auth.user.name || '?');
        av.textContent = n.charAt(0).toUpperCase();
      }
      if (pi) pi.classList.add('authed');
      show(ui['oauth-session']);
      hide(ui['btn-nl-login']);
      ni.value = String(auth.user.username || auth.user.name || '').slice(0, 12);
    } else {
      CHAT_DISABLED = true;
      ui['oauth-tip'].textContent = '登录后可发言并计入排行榜';
      if (pi) pi.classList.remove('authed');
      hide(ui['oauth-session']);
      show(ui['btn-nl-login']);
    }
    // Linux DO 登录后昵称固定为站点用户名，不可改
    ni.disabled = true;
  }
  function initOAuth() {
    fetch('/api/oauth/me').then(function (r) { return r.json(); }).then(function (d) {
      auth.loggedIn = !!d.loggedIn;
      auth.user = d.user || null;
      auth.loginUrl = d.loginUrl || '/oauth/linuxdo';
    }).catch(function () {
      auth.loggedIn = false; auth.user = null; auth.loginUrl = '/oauth/linuxdo';
    }).then(function () {
      updateOAuthUI();
      loadDailyBoard();
    });
    // 登录按钮：跳转 Linux DO 授权
    var lb = ui['btn-nl-login'];
    if (lb) lb.addEventListener('click', function () { location.href = auth.loginUrl; });
    // 退出登录
    var lo = ui['btn-nl-logout'];
    if (lo) lo.addEventListener('click', function () {
      fetch('/api/oauth/logout', { method: 'POST' }).then(function () { location.reload(); });
    });
  }

  function boot() {
    Stage.el = $('stage');
    grabDom();
    try {
      initThree();
    } catch (err) {
      var msg = document.createElement('div');
      msg.setAttribute('style', 'position:fixed;inset:0;z-index:999;display:flex;align-items:center;justify-content:center;background:#04060b;color:#9fd8ea;padding:28px;text-align:center;font-size:16px;line-height:1.6');
      msg.textContent = '当前设备无法启动 3D 画面，请换浏览器或关闭省电模式后重试';
      document.body.appendChild(msg);
      return;
    }
    Stage.resize();
    window.addEventListener('resize', function () { Stage.resize(); if (IS_TOUCH) updateRotateHint(); });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', function () { Stage.resize(); });
    }
    initMobileLandscape();
    initOAuth();

    World.build(scene, QUALITY);
    FX.init(scene, QUALITY);
    createMenuStage();
    // 皮肤恢复需在创建玩家坦克之前
    try { mySkin = parseInt(localStorage.getItem(SKIN_KEY), 10) || 0; } catch (e) { }
    if (mySkin < 0 || mySkin >= TankModels.SKINS.length) mySkin = 0;
    // 恢复全部部位装备（炮塔/炮管/光效）
    try {
      var eqSaved = JSON.parse(localStorage.getItem(EQUIP_KEY) || 'null');
      if (eqSaved) {
        ['turret', 'barrel', 'effect'].forEach(function (k) {
          var v = eqSaved[k];
          if (typeof v === 'number' && v >= 0 && v < TankModels.SKINS.length &&
              TankModels.SKINS[v].cat === k) equippedSkins[k] = v;
          else if (typeof v === 'number' && v === -1) equippedSkins[k] = -1;
        });
      }
    } catch (e) { }
    equippedSkins.body = mySkin;
    try { myVeh = localStorage.getItem(VEH_KEY) || 'grunt'; } catch (e) { myVeh = 'grunt'; }
    if (!VEHICLE_TYPES[myVeh]) myVeh = 'grunt';
    copyVehToPL(VEHICLE_TYPES[myVeh]);
    createPlayer();
    loadBest();
    Net.onEvent(mpOnEvent);

    try {
      bindUI();
      bindInput();
    } catch (err) {
      if (window.console && console.error) console.error(err);
    }
    syncVehPickerUI();
    loadHistoryBoard();
    loadDailyBoard();
    setInterval(function () {
      loadHistoryBoard();
      loadDailyBoard();
    }, 15000);
    toMenu();

    ['pointerdown', 'touchstart', 'keydown'].forEach(function (ev) {
      window.addEventListener(ev, function once() {
        AudioSys.unlock();
      }, { once: true, passive: true });
    });

    requestAnimationFrame(loop);
  }

  boot();
})();
