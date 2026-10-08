/* =========================================================
 * 霓虹装甲 · 暖服假人（Zard）
 * 通过 WebSocket 连接联机服务器，模拟真人玩家挂机对局，
 * 让空房间始终有在线人数与一个可被挑战的对手。
 *
 * 默认由 server/index.js 随服自启（npm start 即自动带一个 Zard），
 * 也可单独运行：node scripts/bots.js
 *
 * 环境变量：
 *   DECOY_NAME   假人昵称，默认 Zard
 *   BOT_COUNT    假人数量，默认 1
 *   BOT_HOST     服务器地址，默认 ws://127.0.0.1:3099/ws
 *   DECOY_ENABLED 设为 off 可关闭随服自启（仅对 server/index.js 生效）
 * ========================================================= */
'use strict';

const WebSocket = require('ws');

const HOST = process.env.BOT_HOST || 'ws://127.0.0.1:3099/ws';
const COUNT = Math.max(1, parseInt(process.env.BOT_COUNT, 10) || 1);
const BASE_NAME = process.env.DECOY_NAME || 'Zard';
const TICK_MS = 100;

const VIEW_RANGE = 46;      // 索敌距离
const FIRE_RANGE = 40;      // 开火距离
const SHELL_SPEED = 60;     // 与 server/room.js 一致
const GRAVITY = 4.5;        // 与 server/room.js 一致
const AIM_ERR = 0.05;

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function angDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
function r2(v) { return Math.round(v * 100) / 100; }

class Bot {
  constructor(host, name, skin) {
    this.host = host;
    this.name = name;
    this.skin = skin;
    this.id = 0;
    this.ws = null;
    this.x = 0;
    this.z = 0;
    this.hullYaw = 0;
    this.turretYaw = 0;
    this.alive = false;
    this.players = [];
    this.wanderTarget = null;
    this.wanderUntil = 0;
    this.nextFire = 0;
  }

  connect() {
    const ws = new WebSocket(this.host);
    this.ws = ws;
    ws.on('open', () => {
      ws.send(JSON.stringify({ t: 'hello', name: this.name, skin: this.skin, bot: true }));
    });
    ws.on('message', (data) => {
      try { this.handle(JSON.parse(data)); } catch (e) { /* 忽略异常帧 */ }
    });
    ws.on('close', () => {
      this.id = 0;
      this.alive = false;
      setTimeout(() => this.connect(), 3000);
    });
    ws.on('error', () => { /* close 会跟进重连 */ });
  }

  send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  handle(msg) {
    if (msg.t === 'w') {           // 欢迎：记录自身 id
      this.id = msg.id;
      return;
    }
    if (msg.t !== 's') return;     // 仅处理快照
    this.players = msg.ps || [];
    const me = this.players.find((p) => p[0] === this.id);
    if (!me) return;
    this.x = me[1];
    this.z = me[2];
    this.hullYaw = me[3];
    this.turretYaw = me[4];
    this.alive = me[7] === 1;
  }

  nearestEnemy() {
    let best = null, bd = Infinity;
    for (const p of this.players) {
      if (p[0] === this.id || p[7] !== 1) continue;
      const d = Math.hypot(p[1] - this.x, p[2] - this.z);
      if (d < bd) { bd = d; best = p; }
    }
    return { enemy: best, dist: bd };
  }

  pickWander(now) {
    if (this.wanderTarget && now < this.wanderUntil) return this.wanderTarget;
    this.wanderTarget = { x: (Math.random() - 0.5) * 90, z: (Math.random() - 0.5) * 90 };
    this.wanderUntil = now + 4000 + Math.random() * 4000;
    return this.wanderTarget;
  }

  tick() {
    if (!this.id || !this.alive) return;
    const now = Date.now();
    const { enemy, dist } = this.nearestEnemy();

    let tx, tz;
    let wantF = 0;
    let wantFire = false;
    let ay = this.hullYaw;
    let ap = 0;

    if (enemy && dist < VIEW_RANGE) {
      tx = enemy[1];
      tz = enemy[2];

      // 炮塔预瞄（带少量散布，提升真实感）
      ay = Math.atan2(tx - this.x, tz - this.z) + (Math.random() - 0.5) * AIM_ERR;
      const tof = dist / SHELL_SPEED;
      const drop = 0.5 * GRAVITY * tof * tof;
      ap = clamp(Math.atan2(drop, Math.max(1, dist)), -0.14, 0.32);

      if (dist > 20) wantF = 1;        // 逼近
      else if (dist < 12) wantF = -0.3; // 太近略微拉开
      else wantF = 0;                   // 保持距离输出

      if (dist < FIRE_RANGE && Math.abs(angDiff(this.turretYaw, ay)) < 0.18 && now >= this.nextFire) {
        wantFire = true;
        this.nextFire = now + 950 + Math.random() * 800;
      }
    } else {
      const w = this.pickWander(now);
      tx = w.x;
      tz = w.z;
      wantF = 1;
    }

    // 车体转向目标
    const desiredYaw = Math.atan2(tx - this.x, tz - this.z);
    const diff = angDiff(this.hullYaw, desiredYaw);
    const turn = clamp(diff * 2.5, -1, 1);
    if (wantF > 0 && Math.abs(diff) > 1.1) wantF = 0;   // 未对正先原地转向

    this.send({
      t: 'i',
      f: r2(wantF),
      turn: r2(turn),
      ay: r2(ay),
      ap: r2(ap),
      fire: wantFire ? 1 : 0
    });
  }
}

let bots = [];
let timer = null;

function start(options) {
  if (timer) return;
  options = options || {};
  const host = options.host || HOST;
  const count = Math.max(1, options.count || COUNT);
  const name = options.name || BASE_NAME;

  bots = [];
  for (let i = 0; i < count; i++) {
    const nm = count === 1 ? name : (i === 0 ? name : name + '-' + (i + 1));
    bots.push(new Bot(host, nm, i % 9));
  }
  bots.forEach((b) => b.connect());
  timer = setInterval(() => bots.forEach((b) => b.tick()), TICK_MS);
  console.log('暖服假人已启动：' + count + ' 个 → ' + host);
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
  bots.forEach((b) => {
    if (b.ws) { try { b.ws.close(); } catch (e) { /* 忽略 */ } }
  });
  bots = [];
}

if (require.main === module) {
  start({ host: HOST, count: COUNT, name: BASE_NAME });
}

module.exports = { start, stop };