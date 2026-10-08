/* =========================================================
 * 霓虹装甲 · 联机房间（权威服务器模拟）
 * 单房间 20Hz tick：玩家坦克物理 / 炮弹飞行与命中 / AI 敌军 /
 * 拾取道具 / 重生与保护 / 连杀播报 / 聊天 / 排行榜持久化。
 * 物理公式与客户端 public/js/game.js 保持一致。
 * ========================================================= */
'use strict';

var GameMap = require('./map.js');
var Leaderboard = require('./leaderboard.js');
var Daily = require('./daily.js');
var Datalog = require('./datalog.js');

/* ================= 数值（与 game.js 一致） ================= */

var SHELL_G = 4.5;

var PL = {
  maxHp: 120, speed: 9.5, reverse: 5.5, turn: 2.3,
  turretSpeed: 3.4, reload: 0.95, dmg: 30,
  splashR: 3.4, splashDmg: 12, shellSpeed: 60
};

/* 玩家可选载具（与 game.js VEHICLE_TYPES 一致） */
var PLAYER_VEHS = {
  grunt: {
    maxHp: 120, speed: 9.5, reverse: 5.5, turn: 2.3,
    turretSpeed: 3.4, reload: 0.95, dmg: 30,
    splashR: 3.4, splashDmg: 12, shellSpeed: 60,
    muzzle: 2.3, muzzleY: 1.42, radius: 1.6, height: 2.15
  },
  scout: {
    maxHp: 80, speed: 16.8, reverse: 9.6, turn: 3.8,
    turretSpeed: 4.4, reload: 0.72, dmg: 22,
    splashR: 2.6, splashDmg: 8, shellSpeed: 68,
    muzzle: 1.44, muzzleY: 1.16, radius: 1.31, height: 1.76
  },
  heavy: {
    maxHp: 200, speed: 6.0, reverse: 3.5, turn: 1.5,
    turretSpeed: 2.2, reload: 1.45, dmg: 48,
    splashR: 4.6, splashDmg: 20, shellSpeed: 48,
    muzzle: 3.38, muzzleY: 1.85, radius: 2.08, height: 2.8
  }
};
function stOf(p) { return PLAYER_VEHS[p.veh] || PLAYER_VEHS.grunt; }
function applyVeh(p, type) {
  if (!PLAYER_VEHS[type]) type = 'grunt';
  var st = PLAYER_VEHS[type];
  p.veh = type;
  p.maxHp = st.maxHp;
  p.radius = st.radius;
  p.height = st.height;
}

var ENEMY_TYPES = {
  grunt: { name: '猎手坦克', hp: 55, speed: 5.4, turn: 1.7, turretSpeed: 1.7, reload: 2.9, dmg: 12, shellSpeed: 40, aimErr: 0.05, detect: 52, near: 16, far: 30, fireRange: 48, score: 100, drop: 0.18, radius: 1.6, height: 2.15, scale: 1.0 },
  scout: { name: '疾袭坦克', hp: 38, speed: 8.6, turn: 2.7, turretSpeed: 2.3, reload: 2.2, dmg: 9, shellSpeed: 44, aimErr: 0.062, detect: 60, near: 11, far: 19, fireRange: 40, score: 130, drop: 0.22, radius: 1.31, height: 1.76, scale: 0.82 },
  heavy: { name: '重装坦克', hp: 175, speed: 3.4, turn: 1.15, turretSpeed: 1.05, reload: 3.9, dmg: 26, shellSpeed: 36, aimErr: 0.035, detect: 60, near: 18, far: 34, fireRange: 52, score: 280, drop: 0.6, radius: 2.08, height: 2.8, scale: 1.3 }
};

var MAX_PLAYERS = 8;
var RESPAWN_T = 3.0;        // 重生倒计时
var PROTECT_T = 2.5;        // 重生保护
var IDLE_KICK = 60000;      // 无操作自动退出（ms）
var STREAK_MSG = { 3: '三连破！', 5: '五连歼！', 8: '八连无双！', 12: '十二连·战场主宰！' };

/* 拾取道具定义 */
var PICK_KINDS = {
  repair: { name: '修理包', color: 0x2eff8e },
  shield: { name: '能量护盾', color: 0x29e6ff, dur: 8 },
  boost: { name: '过载引擎', color: 0xffb02e, dur: 8 },
  ap: { name: '穿甲弹', color: 0xff3ec8, dur: 10 }
};

/* 固定拾取点位（开阔位置，地图四象限 + 中环） */
var PICK_SPOTS = [
  { x: 0, z: 0, kind: 'repair' },
  { x: 28, z: 28, kind: 'ap' }, { x: -28, z: 28, kind: 'shield' },
  { x: 28, z: -28, kind: 'boost' }, { x: -28, z: -28, kind: 'ap' },
  { x: 48, z: 20, kind: 'repair' }, { x: -48, z: -20, kind: 'repair' },
  { x: 20, z: -48, kind: 'shield' }, { x: -20, z: 48, kind: 'boost' },
  { x: 44, z: -44, kind: 'repair' }, { x: -44, z: 44, kind: 'repair' }
];

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
function r2(v) { return Math.round(v * 100) / 100; }

/* ================= 房间 ================= */

function Room() {
  this.players = new Map();        // id -> player
  this.nextId = 1;
  this.mode = 'pvp';               // pvp | pve
  this.tickN = 0;

  this.shells = [];                // 服务器炮弹
  this.nextShellId = 1;
  this.enemies = [];               // PvE AI
  this.nextEnemyId = 1;

  // PvE 波次
  this.wave = 0;
  this.waveQueue = [];
  this.wavePending = [];
  this.waveMaxAlive = 3;
  this.inPrep = false;
  this.prepT = 0;
  this.spawnTick = 0;

  // 拾取
  this.pickups = PICK_SPOTS.map(function (s, i) {
    return { idx: i, x: s.x, z: s.z, kind: s.kind, active: true, respawnT: 0 };
  });
  this.tempPickups = [];           // AI 掉落的临时修理包

  this.last = Date.now();
  this.acc = 0;
  this.TICK = 1 / 20;
  this.serverTime = 0;

  var self = this;
  this.timer = setInterval(function () { self.step(); }, 50);
}

/* ---------- 加入 / 离开 ---------- */

Room.prototype.join = function (ws, name, skin, shell, isBot, nodelocId) {
  var cap = (this.meta && this.meta.max) || MAX_PLAYERS;
  if (this.players.size >= cap) return null;
  var id = this.nextId++;
  var p = {
    id: id, ws: ws, name: name, skin: skin || 0, shell: shell || null, bot: !!isBot,
    nodelocId: nodelocId || null,
    x: 0, z: 38, hullYaw: Math.PI, vel: 0,
    turretYaw: Math.PI, elev: 0,
    hp: PL.maxHp, maxHp: PL.maxHp, alive: true, veh: 'grunt',
    reload: 0, recoil: 0,
    protect: PROTECT_T, respawnT: 1e9,   // 大厅等待：超大重生倒计时防止自动复活，进场后由 spawnPlayer 接管
    kills: 0, deaths: 0, score: 0, streak: 0, bestStreak: 0,
    shield: 0, boost: 0, ap: 0,
    radius: 1.6, height: 2.15,
    input: { f: 0, turn: 0, ay: Math.PI, ap: 0, fire: false },
    ready: false,       // 是否已点击“进入战斗”（进场）
    spectate: false,    // 是否观战者
    lastSeen: Date.now(),
    lastActive: { f: 0, turn: 0, ay: 0, ap: 0, fire: false }   // 上次有效操作快照（用于判定是否活跃）
  };
  this.players.set(id, p);
  if (p.bot) {
    applyVeh(p, ['grunt', 'scout', 'heavy'][(id - 1) % 3]);
    // 机器人直接进入战斗
    this.spawnPlayer(p);
  } else {
    // 真人玩家先停留在房间大厅，等待“进入战斗”或“观战”
    p.alive = false;
  }
  // 机器人不上排行榜
  if (p.bot) Leaderboard.addBot(p.name);
  this.broadcast({ t: 'e', k: 'join', name: name });
  this.broadcast({ t: 'e', k: 'chat', name: '系统', text: name + ' 加入了房间（当前 ' + this.players.size + ' 人 · ' + (this.mode === 'pvp' ? '混战' : '合作') + '模式）' });
  return p;
};

Room.prototype.leave = function (id) {
  var p = this.players.get(id);
  if (!p) return;
  this.players.delete(id);
  this.broadcast({ t: 'e', k: 'leave', name: p.name });
  Leaderboard.merge(p);
};

/* ---------- 大厅 → 进场 / 观战 ---------- */

Room.prototype.readyPlayer = function (id, veh) {
  var p = this.players.get(id);
  if (!p || p.bot || p.ready) return;
  applyVeh(p, veh);
  p.ready = true;
  if (!p.alive) this.spawnPlayer(p);
  // PvE：有真人进场后才开始第一波
  if (this.mode === 'pve' && this.wave === 0) {
    var hasReady = false;
    this.players.forEach(function (q) { if (!q.bot && q.ready) hasReady = true; });
    if (hasReady) this.beginWave(1);
  }
};

Room.prototype.spectatePlayer = function (id) {
  var p = this.players.get(id);
  if (!p || p.bot || p.spectate) return;
  p.ready = true;
  p.spectate = true;
  p.alive = false;
  this.broadcast({ t: 'e', k: 'chat', name: '系统', text: p.name + ' 进入观战' });
};

/* 仅大厅可选载具；进场后（含阵亡重生）不可换车，需重新进入 */
Room.prototype.handleSetVeh = function (id, type) {
  var p = this.players.get(id);
  if (!p || p.bot) return;
  if (p.ready) return;
  applyVeh(p, type);
};

/* ---------- 出生点 ---------- */

Room.prototype.spawnPlayer = function (p) {
  // 选离所有敌方单位最远的出生点
  var pts = GameMap.spawnPoints;
  var best = pts[0], bestD = -1;
  for (var i = 0; i < pts.length; i++) {
    var d = 0;
    this.players.forEach(function (q) {
      if (q === p || !q.alive) return;
      d += Math.hypot(q.x - pts[i].x, q.z - pts[i].z);
    });
    for (var j = 0; j < this.enemies.length; j++) {
      d += Math.hypot(this.enemies[j].x - pts[i].x, this.enemies[j].z - pts[i].z) * 0.5;
    }
    if (this.players.size <= 1) d = Math.random() * 10;   // 单人随机
    if (d > bestD) { bestD = d; best = pts[i]; }
  }
  p.x = best.x; p.z = best.z;
  p.hullYaw = Math.atan2(-best.x, -best.z);   // 朝向场地中心
  p.turretYaw = p.hullYaw;
  p.vel = 0;
  p.hp = p.maxHp;
  p.alive = true;
  p.protect = PROTECT_T;
  p.reload = 0;
  p.shield = 0; p.boost = 0; p.ap = 0;
  this.broadcast({ t: 'e', k: 'respawn', id: p.id, x: r2(p.x), z: r2(p.z) });
};

/* ---------- 玩家模拟 ---------- */

Room.prototype.updatePlayer = function (p, dt) {
  if (!p.alive) return;
  var inp = p.input;
  var st = stOf(p);

  // 转向与驱动（与客户端 updatePlayer 公式一致）
  p.hullYaw += inp.turn * st.turn * dt;
  var speedMul = p.boost > 0 ? 1.4 : 1;
  var driveTarget = inp.f > 0 ? inp.f * st.speed * speedMul
    : inp.f < 0 ? inp.f * st.speed * (st.reverse / st.speed) * speedMul : 0;
  // 归一：键盘 f=±1；触屏 f∈[0,1]
  p.vel = approach(p.vel, driveTarget, (driveTarget !== 0 ? 15 : 22) * dt);
  var nx = p.x + Math.sin(p.hullYaw) * p.vel * dt;
  var nz = p.z + Math.cos(p.hullYaw) * p.vel * dt;
  var rc = GameMap.resolveCircle(nx, nz, p.radius * 0.88);
  p.x = rc.x; p.z = rc.z;

  // 炮塔
  p.turretYaw = approachAngle(p.turretYaw, inp.ay, st.turretSpeed * dt);
  p.elev = clamp(p.elev + clamp(inp.ap - p.elev, -3 * dt, 3 * dt), -0.14, 0.32);

  // 计时器
  p.reload -= dt;
  if (p.protect > 0) p.protect -= dt;
  if (p.shield > 0) p.shield -= dt;
  if (p.boost > 0) p.boost -= dt;
  if (p.ap > 0) p.ap -= dt;

  // 开火
  if (inp.fire && p.reload <= 0) {
    p.reload = st.reload;
    if (p.protect > 0) p.protect = 0;   // 开火解除保护
    this.playerFire(p);
  }
};

Room.prototype.playerFire = function (p) {
  var st = stOf(p);
  var cp = Math.cos(p.elev), sp = Math.sin(p.elev);
  var dir = { x: Math.sin(p.turretYaw) * cp, y: sp, z: Math.cos(p.turretYaw) * cp };
  // 开火瞬间快速对齐炮塔（视觉一致）
  p.turretYaw = approachAngle(p.turretYaw, p.input.ay, 0.3);
  var ox = p.x + Math.sin(p.turretYaw) * cp * st.muzzle;
  var oy = st.muzzleY + sp * st.muzzle;
  var oz = p.z + Math.cos(p.turretYaw) * cp * st.muzzle;
  var dmg = Math.round(st.dmg * (p.ap > 0 ? 1.5 : 1));
  var color = p.ap > 0 ? 0xff3ec8 : (p.shell || 0x9ff3ff);
  this.spawnShell('p' + p.id, p.id, ox, oy, oz, dir, st.shellSpeed, dmg, color, st.splashR, st.splashDmg);
};

Room.prototype.spawnShell = function (team, owner, x, y, z, dir, speed, dmg, color, splashR, splashDmg) {
  var id = this.nextShellId++;
  this.shells.push({
    id: id, team: team, owner: owner,
    px: x, py: y, pz: z,
    vx: dir.x * speed, vy: dir.y * speed, vz: dir.z * speed,
    dmg: dmg, color: color, life: 3.5,
    splashR: splashR || 0, splashDmg: splashDmg || 0
  });
  this.broadcast({ t: 'e', k: 'shell', id: id, x: r2(x), y: r2(y), z: r2(z), vx: r2(dir.x * speed), vy: r2(dir.y * speed), vz: r2(dir.z * speed), c: color, own: owner });
};

/* ---------- 炮弹模拟（与客户端 updateShells 一致） ---------- */

Room.prototype.updateShells = function (dt) {
  for (var i = this.shells.length - 1; i >= 0; i--) {
    var s = this.shells[i];
    s.life -= dt;
    if (s.life <= 0) { this.endShell(s, s.px, s.py, s.pz, false); this.shells.splice(i, 1); continue; }

    var prevX = s.px, prevY = s.py, prevZ = s.pz;
    s.vy -= SHELL_G * dt;
    s.px += s.vx * dt; s.py += s.vy * dt; s.pz += s.vz * dt;

    // 世界命中
    var wHit = GameMap.segmentHit(prevX, prevY, prevZ, s.px, s.py, s.pz);
    var wT = wHit ? wHit.t : 2;

    // 单位命中（两采样点）
    var hitP = null, hitE = null, hitT = 2;
    var samples = [0.5, 1];
    for (var k = 0; k < samples.length && !hitP && !hitE; k++) {
      var tk = samples[k];
      var sx = prevX + (s.px - prevX) * tk;
      var sy = prevY + (s.py - prevY) * tk;
      var sz = prevZ + (s.pz - prevZ) * tk;

      if (s.team[0] === 'p') {
        // 玩家炮弹：PvP 打其他玩家，PvE 打 AI
        var self = this;
        if (this.mode === 'pvp') {
          this.players.forEach(function (q) {
            if (hitP || q.id === s.owner || !q.alive || q.protect > 0) return;
            var dx = sx - q.x, dz = sz - q.z;
            if (dx * dx + dz * dz < q.radius * q.radius && sy < q.height + 0.3) {
              hitP = q; hitT = tk;
            }
          });
        }
        for (var j = 0; j < this.enemies.length && !hitE; j++) {
          var e = this.enemies[j];
          if (e.bornT > 0) continue;
          var edx = sx - e.x, edz = sz - e.z;
          if (edx * edx + edz * edz < e.radius * e.radius && sy < e.height + 0.3) { hitE = e; hitT = tk; }
        }
      } else {
        // AI 炮弹：打最近判定命中的玩家
        this.players.forEach(function (q) {
          if (hitP || !q.alive || q.protect > 0) return;
          var dx = sx - q.x, dz = sz - q.z;
          if (dx * dx + dz * dz < q.radius * q.radius && sy < q.height + 0.3) { hitP = q; hitT = tk; }
        });
      }
    }

    if (hitP && hitT <= wT) {
      this.endShell(s, sx0(prevX, s.px, hitT), prevY + (s.py - prevY) * hitT, prevZ + (s.pz - prevZ) * hitT, true);
      this.notifyHit(s.owner);
      this.shellHitPlayer(s, hitP);
      this.shells.splice(i, 1);
    } else if (hitE && hitT <= wT) {
      this.endShell(s, sx0(prevX, s.px, hitT), prevY + (s.py - prevY) * hitT, prevZ + (s.pz - prevZ) * hitT, true);
      this.notifyHit(s.owner);
      this.shellHitEnemy(s, hitE);
      this.shells.splice(i, 1);
    } else if (wHit) {
      this.endShell(s, wHit.x, wHit.y, wHit.z, true);
      // AI 炮弹落点溅射
      if (s.team[0] === 'e') this.splashPlayers(s, wHit.x, wHit.z);
      this.shells.splice(i, 1);
    }
  }
};

function sx0(a, b, t) { return a + (b - a) * t; }

Room.prototype.endShell = function (s, x, y, z, boom) {
  this.broadcast({ t: 'e', k: 'boom', id: s.id, x: r2(x), y: r2(y), z: r2(z), team: s.team[0], big: s.team === 'eheavy' });
};

Room.prototype.splashPlayers = function (s, x, z) {
  var self = this;
  this.players.forEach(function (q) {
    if (!q.alive || q.protect > 0) return;
    var d = Math.hypot(q.x - x, q.z - z);
    if (d < 3.2) self.damagePlayer(q, Math.round(s.dmg * 0.55 * (1 - d / 3.2)), s);
  });
};

Room.prototype.notifyHit = function (ownerPid) {
  if (!ownerPid) return;
  var ws = this.players.get(ownerPid);
  if (!ws || !ws.ws || ws.ws.readyState !== 1) return;
  try { ws.ws.send(JSON.stringify({ t: 'e', k: 'hit', to: ownerPid })); } catch (e) { }
};

Room.prototype.shellHitPlayer = function (s, q) {
  this.damagePlayer(q, s.dmg, s);
  // 溅射：其他玩家（PvP）+ AI
  if (s.team[0] === 'p') this.splashAt(s, q.x, q.z, q);
};

Room.prototype.shellHitEnemy = function (s, e) {
  this.damageEnemy(e, s.dmg, s.owner);
  if (s.team[0] === 'p') this.splashAt(s, e.x, e.z, null);
};

/* 玩家炮弹溅射：对附近敌方单位（其他玩家 + AI） */
Room.prototype.splashAt = function (s, x, z, exclude) {
  var self = this;
  var r = s.splashR || PL.splashR;
  var sd = s.splashDmg || PL.splashDmg;
  if (r <= 0 || sd <= 0) return;
  if (this.mode === 'pvp') {
    this.players.forEach(function (q) {
      if (q === exclude || q.id === s.owner || !q.alive || q.protect > 0) return;
      var d = Math.hypot(q.x - x, q.z - z);
      if (d < r) self.damagePlayer(q, Math.round(sd * (1 - d / r)), s);
    });
  }
  for (var i = this.enemies.length - 1; i >= 0; i--) {
    var e = this.enemies[i];
    if (e === exclude) continue;
    var d2 = Math.hypot(e.x - x, e.z - z);
    if (d2 < r) this.damageEnemy(e, Math.round(sd * (1 - d2 / r)), s.owner);
  }
};

Room.prototype.damagePlayer = function (q, dmg, src) {
  if (!q.alive || q.protect > 0 || dmg <= 0) return;
  if (q.shield > 0) dmg = Math.round(dmg * 0.4);
  q.hp -= dmg;
  if (q.hp <= 0) {
    q.hp = 0;
    this.killPlayer(q, src);
  }
};

Room.prototype.killPlayer = function (q, src) {
  q.alive = false;
  q.deaths++;
  q.respawnT = RESPAWN_T;
  q.streak = 0;
  var byName = '战场';
  var killer = null;
  if (src && src.team && src.team[0] === 'p' && src.owner !== q.id) {
    killer = this.players.get(src.owner);
  }
  if (killer) {
    byName = killer.name;
    killer.kills++;
    killer.score += 100;
    killer.streak++;
    killer.bestStreak = Math.max(killer.bestStreak, killer.streak);
    killer.hp = Math.min(killer.maxHp, killer.hp + 15);   // 击杀回血
    var sm = STREAK_MSG[killer.streak];
    if (sm) this.broadcast({ t: 'e', k: 'streak', name: killer.name, n: killer.streak, msg: sm });
    Leaderboard.record(killer);
    Daily.addKills(killer, 1);
  }
  Leaderboard.record(q);
  this.broadcast({
    t: 'e', k: 'kill', by: byName, victim: q.name, vid: q.id,
    x: r2(q.x), z: r2(q.z), score: killer ? killer.score : 0
  });
  // PvE：全灭则重置当前波
  if (this.mode === 'pve') {
    var anyAlive = false;
    this.players.forEach(function (pp) { if (pp.alive) anyAlive = true; });
    if (!anyAlive && this.players.size > 0) {
      var w = this.wave;
      this.clearEnemies();
      this.wave = 0;
      this.beginWave(Math.max(1, w));
      this.broadcast({ t: 'e', k: 'chat', name: '系统', text: '全队阵亡！第 ' + Math.max(1, w) + ' 波重新集结…' });
    }
  }
};

/* ---------- AI 敌军（PvE，自 game.js 移植） ---------- */

Room.prototype.hpMult = function () { return 1 + (this.wave - 1) * 0.07; };
Room.prototype.dmgMult = function () { return 1 + (this.wave - 1) * 0.045; };
Room.prototype.scoreMult = function () { return 1 + (this.wave - 1) * 0.08; };

Room.prototype.waveComp = function (n) {
  var list = [];
  var g = Math.min(2 + n, 8);
  for (var i = 0; i < g; i++) list.push('grunt');
  if (n >= 3) { var s = Math.min(1 + ((n - 3) >> 1), 4); for (var j = 0; j < s; j++) list.push('scout'); }
  if (n >= 5) { var h = Math.min(1 + Math.floor((n - 5) / 3), 3); for (var k = 0; k < h; k++) list.push('heavy'); }
  return list;
};

Room.prototype.beginWave = function (n) {
  this.wave = n;
  this.waveQueue = this.waveComp(n);
  this.waveMaxAlive = Math.min(2 + n + Math.floor(this.players.size / 2), 8);
  this.inPrep = true;
  this.prepT = n === 1 ? 2.6 : 4.0;
  this.spawnTick = 0;
  this.broadcast({ t: 'e', k: 'wave', n: n, count: this.waveQueue.length });
};

Room.prototype.clearEnemies = function () {
  for (var i = 0; i < this.enemies.length; i++) {
    this.broadcast({ t: 'e', k: 'edespawn', id: this.enemies[i].id });
  }
  this.enemies = [];
  this.waveQueue = [];
  this.wavePending = [];
};

Room.prototype.nearestPlayer = function (x, z) {
  var best = null, bd = Infinity;
  this.players.forEach(function (q) {
    if (!q.alive) return;
    var d = Math.hypot(q.x - x, q.z - z);
    if (d < bd) { bd = d; best = q; }
  });
  return best ? { p: best, d: bd } : null;
};

Room.prototype.updateWave = function (dt) {
  if (this.wave === 0 || this.players.size === 0) return;
  if (this.inPrep) {
    this.prepT -= dt;
    if (this.prepT <= 0) this.inPrep = false;
    return;
  }
  this.spawnTick -= dt;
  if (this.waveQueue.length && this.enemies.length + this.wavePending.length < this.waveMaxAlive && this.spawnTick <= 0) {
    this.spawnTick = 0.9;
    var type = this.waveQueue.shift();
    // 出生点：远离所有玩家
    var pts = GameMap.spawnPoints, best = pts[0], bd = -1;
    for (var i = 0; i < pts.length; i++) {
      var d = 0, cnt = 0;
      this.players.forEach(function (q) { if (q.alive) { d += Math.hypot(q.x - pts[i].x, q.z - pts[i].z); cnt++; } });
      if (!cnt) d = Math.random() * 10;
      if (d > bd) { bd = d; best = pts[i]; }
    }
    this.wavePending.push({ t: 0.8, type: type, x: best.x, z: best.z });
    this.broadcast({ t: 'e', k: 'spawnbeacon', x: r2(best.x), z: r2(best.z), type: type });
  }
  for (var j = this.wavePending.length - 1; j >= 0; j--) {
    this.wavePending[j].t -= dt;
    if (this.wavePending[j].t <= 0) {
      var w = this.wavePending[j];
      this.wavePending.splice(j, 1);
      this.spawnEnemy(w.type, w.x, w.z);
    }
  }
  if (this.wave > 0 && !this.waveQueue.length && !this.wavePending.length && !this.enemies.length) {
    var bonus = 150 + this.wave * 50;
    var self = this;
    this.players.forEach(function (q) {
      q.score += bonus;
      if (q.alive) q.hp = Math.min(q.maxHp, q.hp + 35);
    });
    this.broadcast({ t: 'e', k: 'waveclear', n: this.wave, bonus: bonus });
    this.beginWave(this.wave + 1);
  }
};

Room.prototype.spawnEnemy = function (type, x, z) {
  var cfg = ENEMY_TYPES[type];
  var tgt = this.nearestPlayer(x, z);
  var yaw = tgt ? Math.atan2(tgt.p.x - x, tgt.p.z - z) : 0;
  var hp = Math.round(cfg.hp * this.hpMult());
  var e = {
    id: this.nextEnemyId++, type: type, cfg: cfg,
    x: x, z: z, hullYaw: yaw, vel: 0,
    hp: hp, maxHp: hp,
    turretYaw: yaw, elev: 0,
    state: 'patrol', wpX: x, wpZ: z, repathT: 0,
    strafeDir: Math.random() < 0.5 ? 1 : -1, strafeT: rand(2, 4),
    think: Math.random() * 0.15, losOK: false, distP: 999, tgtId: 0,
    fireCd: rand(1.6, 2.6), alertT: 0,
    bornT: 0.7, alive: true,
    radius: cfg.radius, height: cfg.height
  };
  this.enemies.push(e);
};

Room.prototype.updateEnemy = function (e, dt) {
  if (e.bornT > 0) { e.bornT -= dt; return; }
  var tgt = this.nearestPlayer(e.x, e.z);
  var px = tgt ? tgt.p.x : e.x, pz = tgt ? tgt.p.z : e.z;

  e.think -= dt;
  if (e.think <= 0) {
    e.think = 0.12 + Math.random() * 0.08;
    e.distP = tgt ? tgt.d : 999;
    e.losOK = !!tgt && !GameMap.blocksLOS(e.x, e.z, px, pz);
    e.state = (tgt && ((e.losOK && e.distP < e.cfg.detect) || e.alertT > 0)) ? 'engage' : 'patrol';
  }
  e.alertT -= dt;

  var goalX, goalZ, wantSpeed = e.cfg.speed;
  if (e.state === 'patrol') {
    e.repathT -= dt;
    var wdx = e.wpX - e.x, wdz = e.wpZ - e.z;
    if (e.repathT <= 0 || wdx * wdx + wdz * wdz < 9) {
      var pt = GameMap.randomOpenPoint(6, 2.4);
      e.wpX = pt.x; e.wpZ = pt.z;
      e.repathT = 7 + Math.random() * 5;
    }
    goalX = e.wpX; goalZ = e.wpZ;
    wantSpeed *= 0.55;
  } else {
    e.strafeT -= dt;
    if (e.strafeT <= 0) { e.strafeT = 2 + Math.random() * 2.5; e.strafeDir *= -1; }
    var ndx = e.x - px, ndz = e.z - pz;
    var d = Math.max(0.001, Math.sqrt(ndx * ndx + ndz * ndz));
    ndx /= d; ndz /= d;
    if (!e.losOK) { goalX = px; goalZ = pz; }
    else if (d > e.cfg.far) { goalX = px + ndx * e.cfg.far * 0.75; goalZ = pz + ndz * e.cfg.far * 0.75; }
    else if (d < e.cfg.near) { goalX = e.x + ndx * 10; goalZ = e.z + ndz * 10; }
    else {
      goalX = e.x - ndz * e.strafeDir * 7;
      goalZ = e.z + ndx * e.strafeDir * 7;
      wantSpeed *= 0.7;
    }
  }

  var gdx = goalX - e.x, gdz = goalZ - e.z;
  var gLen = Math.sqrt(gdx * gdx + gdz * gdz);
  if (gLen > 0.6) {
    gdx /= gLen; gdz /= gLen;
    var fx = Math.sin(e.hullYaw), fz = Math.cos(e.hullYaw);
    if (!GameMap.circleFree(e.x + fx * 4.5, e.z + fz * 4.5, 1.7)) {
      var la = e.hullYaw + 0.75, ra = e.hullYaw - 0.75;
      var lFree = GameMap.circleFree(e.x + Math.sin(la) * 4.5, e.z + Math.cos(la) * 4.5, 1.6);
      var rFree = GameMap.circleFree(e.x + Math.sin(ra) * 4.5, e.z + Math.cos(ra) * 4.5, 1.6);
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
  e.x += Math.sin(e.hullYaw) * e.vel * dt;
  e.z += Math.cos(e.hullYaw) * e.vel * dt;
  var rc = GameMap.resolveCircle(e.x, e.z, e.radius * 0.88);
  e.x = rc.x; e.z = rc.z;

  // 炮塔（预判）
  var wantYaw;
  if (e.state === 'engage' && tgt) {
    var tof = e.distP / e.cfg.shellSpeed;
    var tvx = Math.sin(tgt.p.hullYaw) * tgt.p.vel, tvz = Math.cos(tgt.p.hullYaw) * tgt.p.vel;
    var tx = px + tvx * tof * 0.75 - e.x;
    var tz = pz + tvz * tof * 0.75 - e.z;
    wantYaw = Math.atan2(tx, tz);
  } else {
    wantYaw = e.hullYaw;
  }
  e.turretYaw = approachAngle(e.turretYaw, wantYaw, e.cfg.turretSpeed * dt);

  var dH = Math.max(2, e.distP);
  var drop = 0.5 * SHELL_G * Math.pow(dH / e.cfg.shellSpeed, 2);
  var muzzleY = 1.42 * e.cfg.scale;
  e.elev = clamp(Math.atan2(1.0 + drop - muzzleY, dH), -0.12, 0.4);

  e.fireCd -= dt;
  if (e.fireCd <= 0 && e.state === 'engage' && tgt && e.losOK &&
      e.distP < e.cfg.fireRange && Math.abs(angDiff(e.turretYaw, wantYaw)) < 0.1) {
    e.fireCd = e.cfg.reload * (0.85 + Math.random() * 0.3);
    this.enemyFire(e);
  }
};

Room.prototype.enemyFire = function (e) {
  var cp = Math.cos(e.elev), sp = Math.sin(e.elev);
  var ox = e.x + Math.sin(e.turretYaw) * cp * (1.4 * e.cfg.scale);
  var oy = 1.42 * e.cfg.scale + sp * (1.4 * e.cfg.scale);
  var oz = e.z + Math.cos(e.turretYaw) * cp * (1.4 * e.cfg.scale);
  // 误差
  var dir = { x: Math.sin(e.turretYaw) * cp, y: sp, z: Math.cos(e.turretYaw) * cp };
  var errY = (Math.random() - 0.5) * 2 * e.cfg.aimErr;
  var cosE = Math.cos(errY), sinE = Math.sin(errY);
  var nx = dir.x * cosE + dir.z * sinE;
  var nz = -dir.x * sinE + dir.z * cosE;
  dir.x = nx; dir.z = nz;
  dir.y += (Math.random() - 0.5) * e.cfg.aimErr * 0.8;
  var L = Math.hypot(dir.x, dir.y, dir.z);
  dir.x /= L; dir.y /= L; dir.z /= L;
  var dmg = Math.round(e.cfg.dmg * this.dmgMult());
  this.spawnShell(e.type === 'heavy' ? 'eheavy' : 'e', 0, ox, oy, oz, dir, e.cfg.shellSpeed, dmg, e.type === 'heavy' ? 0xe0aaff : (e.type === 'scout' ? 0xffd79a : 0xffb09a));
};

Room.prototype.damageEnemy = function (e, dmg, ownerPid) {
  if (!e.alive || dmg <= 0) return;
  e.hp -= dmg;
  e.alertT = 7;
  e.state = 'engage';
  if (e.hp <= 0) {
    e.alive = false;
    var pts = Math.round(e.cfg.score * this.scoreMult() / 10) * 10;
    var killer = ownerPid ? this.players.get(ownerPid) : null;
    if (killer) {
      killer.kills++;
      killer.score += pts;
      killer.streak++;
      killer.bestStreak = Math.max(killer.bestStreak, killer.streak);
      var sm = STREAK_MSG[killer.streak];
      if (sm) this.broadcast({ t: 'e', k: 'streak', name: killer.name, n: killer.streak, msg: sm });
      Leaderboard.record(killer);
      Daily.addKills(killer, 1);
    }
    this.broadcast({ t: 'e', k: 'ekill', id: e.id, x: r2(e.x), z: r2(e.z), by: killer ? killer.name : '', pts: pts, type: e.type });
    if (Math.random() < e.cfg.drop) this.dropRepair(e.x, e.z);
    var idx = this.enemies.indexOf(e);
    if (idx !== -1) this.enemies.splice(idx, 1);
  }
};

Room.prototype.dropRepair = function (x, z) {
  this.broadcast({ t: 'e', k: 'drop', x: r2(x), z: r2(z), life: 20 });
  this.tempPickups.push({ x: x, z: z, t: 20, heal: 30 });
};

/* ---------- 坦克推挤 ---------- */

Room.prototype.separate = function () {
  var units = [];
  var self = this;
  this.players.forEach(function (p) { if (p.alive) units.push(p); });
  for (var i = 0; i < this.enemies.length; i++) if (this.enemies[i].bornT <= 0) units.push(this.enemies[i]);
  for (var a = 0; a < units.length; a++) {
    for (var b = a + 1; b < units.length; b++) {
      var u = units[a], v = units[b];
      var dx = v.x - u.x, dz = v.z - u.z;
      var rr = (u.radius + v.radius) * 0.82;
      var d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-6) {
        var d = Math.sqrt(d2);
        var push = (rr - d) / d * 0.5;
        var uw = self.players.has(u.id) ? 0.25 : 0.5;
        var vw = self.players.has(v.id) ? 0.25 : 0.5;
        u.x -= dx * push * uw * 2; u.z -= dz * push * uw * 2;
        v.x += dx * push * vw * 2; v.z += dz * push * vw * 2;
      }
    }
  }
};

/* ---------- 拾取 ---------- */

Room.prototype.updatePickups = function (dt) {
  // 固定点位
  for (var i = 0; i < this.pickups.length; i++) {
    var pk = this.pickups[i];
    if (!pk.active) {
      pk.respawnT -= dt;
      if (pk.respawnT <= 0) {
        pk.active = true;
        this.broadcast({ t: 'e', k: 'pkon', idx: pk.idx });
      }
      continue;
    }
    var self = this;
    this.players.forEach(function (q) {
      if (!q.alive || !pk.active) return;
      var dx = q.x - pk.x, dz = q.z - pk.z;
      if (dx * dx + dz * dz < 2.6 * 2.6) {
        pk.active = false;
        pk.respawnT = 15;
        self.applyPickup(q, pk.kind);
        self.broadcast({ t: 'e', k: 'pkoff', idx: pk.idx, by: q.name, kind: pk.kind });
      }
    });
  }
  // 临时掉落
  for (var j = this.tempPickups.length - 1; j >= 0; j--) {
    var tp = this.tempPickups[j];
    tp.t -= dt;
    var taken = false;
    this.players.forEach(function (q) {
      if (!q.alive || taken) return;
      var dx = q.x - tp.x, dz = q.z - tp.z;
      if (dx * dx + dz * dz < 2.6 * 2.6) {
        taken = true;
        q.hp = Math.min(q.maxHp, q.hp + tp.heal);
        self.broadcast({ t: 'e', k: 'pkheal', by: q.name, v: tp.heal });
      }
    });
    if (taken || tp.t <= 0) this.tempPickups.splice(j, 1);
  }
};

Room.prototype.applyPickup = function (q, kind) {
  var def = PICK_KINDS[kind];
  if (kind === 'repair') q.hp = Math.min(q.maxHp, q.hp + 40);
  else if (kind === 'shield') q.shield = def.dur;
  else if (kind === 'boost') q.boost = def.dur;
  else if (kind === 'ap') q.ap = def.dur;
};

/* ---------- 主循环 ---------- */

Room.prototype.step = function () {
  var now = Date.now();
  var dt = Math.min(0.1, (now - this.last) / 1000);
  this.last = now;
  this.serverTime += dt;
  this.tickN++;

  // 玩家重生
  var self = this;
  this.players.forEach(function (p) {
    if (!p.alive) {
      p.respawnT -= dt;
      if (p.respawnT <= 0) self.spawnPlayer(p);
    }
  });

  // 模拟
  this.timeoutInputs();
  this.players.forEach(function (p) { self.updatePlayer(p, dt); });
  if (this.mode === 'pve') {
    this.updateWave(dt);
    for (var i = 0; i < this.enemies.length; i++) this.updateEnemy(this.enemies[i], dt);
  }
  this.separate();
  this.updateShells(dt);
  this.updatePickups(dt);

  // 每 tick 广播快照
  this.sendSnapshot();
};

Room.prototype.sendSnapshot = function () {
  var self = this;
  var ps = [];
  this.players.forEach(function (p) {
    ps.push([
      p.id, r2(p.x), r2(p.z), r2(p.hullYaw), r2(p.turretYaw), r2(p.elev),
      Math.ceil(p.hp), p.alive ? 1 : 0,
      p.shield > 0 ? Math.ceil(p.shield) : 0,
      p.boost > 0 ? Math.ceil(p.boost) : 0,
      p.ap > 0 ? Math.ceil(p.ap) : 0,
      p.protect > 0 ? Math.ceil(p.protect) : 0,
      Math.max(0, Math.round(p.reload * 100)),
      p.kills, p.deaths, p.score, p.streak, p.name, p.skin || 0, p.bot ? 1 : 0,
      p.spectate ? 1 : 0, p.ready ? 1 : 0, p.veh || 'grunt'
    ]);
  });
  var es = this.enemies.map(function (e) {
    return [e.id, e.type, r2(e.x), r2(e.z), r2(e.hullYaw), r2(e.turretYaw), e.hp, e.maxHp, e.bornT > 0 ? 1 : 0];
  });
  var shIds = this.shells.map(function (s) { return s.id; });
  var pk = this.pickups.map(function (p) { return [p.idx, p.active ? 1 : 0, p.kind]; });
  var tp = this.tempPickups.map(function (p) { return [r2(p.x), r2(p.z)]; });
  var snap = {
    t: 's', st: Math.round(this.serverTime * 1000),
    mode: this.mode,
    wave: this.wave,
    left: this.waveQueue.length + this.wavePending.length + this.enemies.length,
    ps: ps, es: es, sh: shIds, pk: pk, tp: tp
  };
  this.broadcast(snap);
};

/* ---------- 输入 / 聊天 / 模式 ---------- */

Room.prototype.handleInput = function (id, msg) {
  var p = this.players.get(id);
  if (!p) return;
  var inp = p.input;
  inp.f = clamp(+msg.f || 0, -1, 1);
  inp.turn = clamp(+msg.turn || 0, -1, 1);
  inp.ay = +msg.ay || 0;
  inp.ap = clamp(+msg.ap || 0, -0.14, 0.32);
  inp.fire = !!msg.fire;
  // 仅当“有效操作”（移动/转向/瞄准/开火发生变化）时才视为活跃，
  // 避免客户端持续发送空输入帧导致永不超时
  var la = p.lastActive;
  if (Math.abs(inp.f - la.f) > 1e-3 || Math.abs(inp.turn - la.turn) > 1e-3 ||
      Math.abs(inp.ay - la.ay) > 2e-3 || Math.abs(inp.ap - la.ap) > 2e-3 || inp.fire !== la.fire) {
    p.lastSeen = Date.now();
    la.f = inp.f; la.turn = inp.turn; la.ay = inp.ay; la.ap = inp.ap; la.fire = inp.fire;
  }
};

/* 输入超时（后台标签页/断流）：清零输入防止失控；一分钟无操作自动退出 */
Room.prototype.timeoutInputs = function () {
  var now = Date.now();
  var self = this;
  var idle = [];
  this.players.forEach(function (p) {
    if (now - p.lastSeen > 3000 && (p.input.f !== 0 || p.input.turn !== 0 || p.input.fire)) {
      p.input.f = 0;
      p.input.turn = 0;
      p.input.fire = false;
    }
    // 一分钟无任何有效操作 → 自动退出（机器人除外；仅针对已进场战斗的玩家，大厅/观战者不踢）
    if (!p.bot && p.alive && now - p.lastSeen > IDLE_KICK) idle.push(p);
  });
  idle.forEach(function (p) {
    self.broadcast({ t: 'e', k: 'chat', name: '系统', text: p.name + ' 长时间无操作，已自动退出战场' });
    if (p.ws && p.ws.readyState === 1) {
      try {
        // 先通知客户端“被踢出”（客户端收到后停止自动重连），再断开连接
        p.ws.send(JSON.stringify({ t: 'e', k: 'kicked', text: '长时间无操作，已自动退出战场' }));
        p.ws.close(4000, 'idle timeout');
      } catch (e) { }
    } else {
      self.leave(p.id);
    }
  });
};

Room.prototype.handleChat = function (id, text) {
  var p = this.players.get(id);
  if (!p) return;
  p.lastSeen = Date.now();   // 聊天也算活跃操作
  // 仅 Linux DO 登录用户可发言
  if (p.bot || !p.nodelocId) {
    if (p.ws && p.ws.readyState === 1) {
      p.ws.send(JSON.stringify({ t: 'e', k: 'chat', name: '系统', text: '请先使用 Linux DO 登录后再发言' }));
    }
    return;
  }
  text = String(text).slice(0, 80).trim();
  if (!text) return;
  if (text === '/mode pvp' || text === '/mode pve') {
    var m = text.split(' ')[1];
    this.setMode(m);
    return;
  }
  if (text === '/reset') {
    this.players.forEach(function (q) { q.kills = 0; q.deaths = 0; q.score = 0; q.streak = 0; });
    this.broadcast({ t: 'e', k: 'chat', name: '系统', text: '比分已清零' });
    return;
  }
  this.broadcast({ t: 'e', k: 'chat', name: p.name, text: text });
  Datalog.logChat({
    nodelocId: p.nodelocId,
    name: p.name,
    text: text,
    roomId: this.meta && this.meta.id,
    mode: this.mode
  });
};

Room.prototype.setMode = function (m) {
  if (m !== 'pvp' && m !== 'pve') return;
  if (m === this.mode) return;
  this.mode = m;
  this.clearEnemies();
  for (var i = this.shells.length - 1; i >= 0; i--) {
    this.broadcast({ t: 'e', k: 'boom', id: this.shells[i].id, x: 0, y: -5, z: 0, team: 'x' });
  }
  this.shells = [];
  this.wave = 0;
  this.waveQueue = []; this.wavePending = [];
  var self = this;
  this.players.forEach(function (p) {
    p.alive = true;
    self.spawnPlayer(p);
    p.kills = 0; p.deaths = 0; p.score = 0; p.streak = 0;
  });
  this.broadcast({ t: 'e', k: 'chat', name: '系统', text: '已切换为 ' + (m === 'pvp' ? '联机混战（玩家对战）' : '联机合作（共抗 AI 波次）') + '，比分重置' });
  this.broadcast({ t: 'e', k: 'modechg', mode: m });
  if (m === 'pve') this.beginWave(1);
};

Room.prototype.broadcast = function (msg, exceptId) {
  var data = JSON.stringify(msg);
  var self = this;
  try {
    this.players.forEach(function (p) {
      if (p.id === exceptId) return;
      if (p.ws && p.ws.readyState === 1) p.ws.send(data);
    });
  } catch (e) { /* 单连接异常不影响整体 */ }
};

Room.prototype.welcome = function (p) {
  var self = this;
  var others = [];
  this.players.forEach(function (q) {
    if (q !== p) others.push([q.id, r2(q.x), r2(q.z), r2(q.hullYaw), r2(q.turretYaw), r2(q.elev), Math.ceil(q.hp), q.alive ? 1 : 0, 0, 0, 0, 0, 0, q.kills, q.deaths, q.score, q.streak, q.name, q.skin || 0, q.bot ? 1 : 0, q.spectate ? 1 : 0, q.ready ? 1 : 0, q.veh || 'grunt']);
  });
  return {
    t: 'w', id: p.id, mode: this.mode, wave: this.wave,
    ps: others,
    pk: this.pickups.map(function (k) { return [k.idx, k.active ? 1 : 0, k.kind]; }),
    tp: this.tempPickups.map(function (k) { return [r2(k.x), r2(k.z)]; }),
    maxHp: PL.maxHp, reload: PL.reload,
    spots: PICK_SPOTS
  };
};

Room.prototype.close = function () {
  clearInterval(this.timer);
  var arr = [];
  this.players.forEach(function (p) { arr.push(p); });
  for (var i = 0; i < arr.length; i++) Leaderboard.record(arr[i]);
  Leaderboard.flush();
};

module.exports = Room;
module.exports.MAX_PLAYERS = MAX_PLAYERS;
module.exports.PICK_KINDS = PICK_KINDS;


