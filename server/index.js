/* =========================================================
 * 霓虹装甲 · 联机服务器入口（多房间）
 * HTTP 静态资源 + WebSocket 联机 + 排行榜/房间 HTTP 接口
 * 包含固定「官方服务器」房间，玩家可自建带密码房间。
 * npm start → http://localhost:3099
 * ========================================================= */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const Room = require('./room.js');
const Leaderboard = require('./leaderboard.js');
const Daily = require('./daily.js');
const Datalog = require('./datalog.js');
const NodelocPay = require('./nodeloc-pay.js');
const bots = require('../scripts/bots.js');
const OAuth = require('./oauth-linuxdo.js');

const PORT = process.env.PORT || 3099;
const DECOY_ENABLED = process.env.DECOY_ENABLED !== 'off';   // 默认随服自启暖服假人 Zard
const ROOT = path.join(__dirname, '..', 'public');
const MAX_PLAYERS = Room.MAX_PLAYERS || 8;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon'
};

/* ---------- 多房间管理 ---------- */

const rooms = new Map();   // roomId -> Room

function makeRoomId() {
  return 'r' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

function createRoom(name, password, official) {
  const room = new Room();
  room.meta = {
    id: official ? 'official' : makeRoomId(),
    name: String(name || '').slice(0, 20) || (official ? '官方服务器' : '未命名房间'),
    password: password ? String(password).slice(0, 16) : null,
    official: !!official,
    max: MAX_PLAYERS,
    createdAt: Date.now()
  };
  rooms.set(room.meta.id, room);
  return room;
}

function roomListView() {
  const arr = [];
  rooms.forEach((room) => {
    arr.push({
      id: room.meta.id,
      name: room.meta.name,
      mode: room.mode,
      count: room.players.size,
      max: room.meta.max,
      locked: !!room.meta.password,
      official: room.meta.official,
      createdAt: room.meta.createdAt
    });
  });
  // 官方优先，其余按创建时间
  arr.sort((a, b) => (b.official - a.official) || (a.createdAt - b.createdAt));
  return arr;
}

// 固定官方服务器房间
createRoom('官方服务器', null, true);

/* ---------- HTTP ---------- */

function readJson(req, cb) {
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 1e5) req.destroy(); });
  req.on('end', () => {
    try { cb(JSON.parse(body || '{}')); } catch (e) { cb(null); }
  });
}

const server = http.createServer((req, res) => {
  let p;
  try {
    p = decodeURIComponent((req.url || '/').split('?')[0]);
  } catch (e) {
    res.writeHead(400); res.end('Bad Request'); return;
  }
  if (p === '/') p = '/index.html';

  // Linux DO OAuth 路由（需在静态文件之前处理，回调带 query）
  if (p === '/oauth/linuxdo' || p === '/oauth/nodeloc' || p === '/auth/callback') { OAuth.route(req, res); return; }
  if (p === '/api/oauth/me') { OAuth.me(req, res); return; }
  if (p === '/api/oauth/logout') { OAuth.logout(req, res); return; }

  // 房间列表
  if (p === '/api/rooms') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify({ ok: true, rooms: roomListView() }));
    return;
  }
  // 创建房间（仅 Linux DO 登录用户）
  if (p === '/api/rooms/create' && req.method === 'POST') {
    if (!OAuth.userFromReq(req)) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, text: '游客不能创建房间，请先登录' }));
      return;
    }
    readJson(req, (data) => {
      if (!data) { res.writeHead(400); res.end(JSON.stringify({ ok: false, text: '参数错误' })); return; }
      const room = createRoom(data.name, data.password, false);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, id: room.meta.id, name: room.meta.name }));
    });
    return;
  }

  // 排行榜接口
  if (p === '/api/leaderboard') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify({ ok: true, online: rooms.get('official') ? rooms.get('official').players.size : 0, mode: 'pvp', top: Leaderboard.top(20) }));
    return;
  }

  function sendJson(status, obj) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify(obj));
  }

  // 每日排行榜
  if (p === '/api/daily') {
    const user = OAuth.userFromReq(req);
    sendJson(200, { ok: true, date: Daily.today(), top: Daily.top(20), me: Daily.me(user), slots: Daily.slots() });
    return;
  }
  if (p === '/api/daily/solo-wave' && req.method === 'POST') {
    const user = OAuth.userFromReq(req);
    if (!user) { sendJson(403, { ok: false, text: '请先 Linux DO 登录' }); return; }
    sendJson(200, Daily.markSoloWave5(user));
    return;
  }
  if (p === '/api/daily/claim' && req.method === 'POST') {
    const user = OAuth.userFromReq(req);
    if (!user) { sendJson(403, { ok: false, text: '请先 Linux DO 登录' }); return; }
    const started = Daily.beginClaim(user);
    if (!started.ok) { sendJson(200, { ok: false, text: started.text, me: Daily.me(user), slots: Daily.slots() }); return; }
    NodelocPay.transfer(user.id, user.username, started.orderId, NodelocPay.CLAIM_AMOUNT).then((r) => {
      if (r.ok) {
        Daily.finishClaim(started.entry, r.transaction_id, { orderId: started.orderId });
        sendJson(200, { ok: true, text: '已发放 ' + NodelocPay.CLAIM_AMOUNT + ' NL', transaction_id: r.transaction_id, me: Daily.me(user), slots: Daily.slots() });
      } else {
        Daily.abortClaim(started.entry);
        console.error('[daily-claim]', r.error);
        sendJson(200, { ok: false, text: r.error || '转账失败', me: Daily.me(user), slots: Daily.slots() });
      }
    }).catch((err) => {
      Daily.abortClaim(started.entry);
      console.error('[daily-claim]', err);
      sendJson(200, { ok: false, text: '转账请求失败', me: Daily.me(user), slots: Daily.slots() });
    });
    return;
  }
  if (p === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, online: (rooms.get('official') ? rooms.get('official').players.size : 0), uptime: Math.floor(process.uptime()) }));
    return;
  }

  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(buf);
  });
});

/* ---------- WebSocket 升级 ---------- */

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = (req.url || '').split('?')[0];
  // 兼容根路径与 /ws（客户端现连根路径，与 legacy 一致；bot 仍用 /ws）
  if (url !== '/' && url !== '/ws') {
    socket.destroy();
    return;
  }
  // 从握手请求读取 Linux DO 登录态（浏览器同源会自动携带会话 Cookie）
  const oauthUser = OAuth.userFromReq(req);
  wss.handleUpgrade(req, socket, head, (ws) => {
    let curRoom = null;
    let playerId = 0;

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch (e) { return; }

      if (msg.t === 'hello') {
        if (playerId) return;
        const roomId = String(msg.roomId || 'official');
        const room = rooms.get(roomId);
        if (!room) {
          ws.send(JSON.stringify({ t: 'e', k: 'erauth', text: '房间不存在' }));
          ws.close();
          return;
        }
        if (room.meta.password && room.meta.password !== String(msg.password || '')) {
          ws.send(JSON.stringify({ t: 'e', k: 'erauth', text: '房间密码错误' }));
          ws.close();
          return;
        }
        const skin = Math.max(0, Math.min(9, parseInt(msg.skin, 10) || 0));
        const shell = Number.isFinite(Number(msg.shell)) && Number(msg.shell) > 0 ? Math.floor(Number(msg.shell)) : null;
        const isBot = !!msg.bot;
        const nodelocId = isBot ? null : (oauthUser ? String(oauthUser.id) : null);
        // 已登录：昵称以 Linux DO 站点用户名为准（可与暖服假人同名）；游客才用客户端自报昵称
        let name;
        if (oauthUser && !isBot) {
          name = String(oauthUser.username || oauthUser.name || '').replace(/[<>]/g, '').slice(0, 12).trim();
        } else {
          name = String(msg.name || '').replace(/[<>]/g, '').slice(0, 12).trim();
        }
        if (!name) name = '车长' + Math.floor(Math.random() * 900 + 100);
        const p = room.join(ws, name, skin, shell, isBot, nodelocId);
        if (!p) {
          const cap = (room.meta && room.meta.max) || MAX_PLAYERS;
          ws.send(JSON.stringify({ t: 'e', k: 'full', text: '房间已满（最多 ' + cap + ' 人）' }));
          ws.close();
          return;
        }
        curRoom = room;
        playerId = p.id;
        ws.send(JSON.stringify(room.welcome(p)));
        return;
      }
      if (!playerId || !curRoom) return;

      if (msg.t === 'i') curRoom.handleInput(playerId, msg);
      else if (msg.t === 'chat') curRoom.handleChat(playerId, msg.text);
      else if (msg.t === 'ready') curRoom.readyPlayer(playerId, msg.veh);
      else if (msg.t === 'veh') curRoom.handleSetVeh(playerId, msg.veh);
      else if (msg.t === 'spectate') curRoom.spectatePlayer(playerId);
    });

    ws.on('close', () => {
      if (playerId && curRoom) {
        curRoom.leave(playerId);
        // 玩家房间空无一人时自动删除；官方房间始终保留
        if (curRoom.meta && !curRoom.meta.official && curRoom.players.size === 0) {
          curRoom.close();
          rooms.delete(curRoom.meta.id);
        }
        curRoom = null;
      }
    });
    ws.on('error', () => { /* ignore */ });
  });
});

server.listen(PORT, () => {
  console.log('霓虹装甲 · NEON TANK ARENA（联机版 · 多房间）');
  console.log('本地访问: http://localhost:' + PORT);
  console.log('多开浏览器标签页/局域网朋友访问同地址即可联机对战');
  console.log('官方房间已就绪 · 可创建含密码的玩家房间');
  if (OAuth.enabled()) {
    console.log('[oauth] Linux DO 已启用 → 回调 ' + OAuth.REDIRECT_URI);
  } else {
    console.log('[oauth] Linux DO 未配置（请设置 LINUXDO_CLIENT_ID / LINUXDO_CLIENT_SECRET）');
  }
  if (DECOY_ENABLED) {
    bots.start({ host: 'ws://127.0.0.1:' + PORT + '/ws', count: 1, name: process.env.DECOY_NAME || 'Zard' });
  }
});

process.on('SIGINT', () => {
  bots.stop();
  rooms.forEach((room) => room.close());
  Daily.flush();
  Datalog.saveNow();
  process.exit(0);
});