/* =========================================================
 * 霓虹装甲 · 联机客户端
 * WebSocket 连接 / 快照缓存与插值 / 事件分发
 * game.js 消费：Net.sample() 每帧取插值状态，Net.onEvent 订阅事件
 * ========================================================= */
(function () {
  'use strict';

  var INTERP = 110;            // 插值延迟（ms）
  var SNAP_KEEP = 12;          // 保留快照数

  var ws = null;
  var connected = false;
  var myId = 0;
  var mode = 'pvp';
  var snaps = [];              // [{st, ps, es, pk, tp, mode, wave, left}]
  var offset = null;          // 本地时钟 - 服务器时钟
  var eventCb = null;
  var welcomeCb = null;
  var closeCb = null;
  var name = '';
  var reconnectTimer = null;
  var spots = [];
  var mySkin = 0;
  var myShell = null;
  var room = 'official';
  var roomPass = '';
  var authFailDrained = false;   // 是否已处理过认证失败回调

  function now() { return Date.now(); }

  function connect(nick, skin, shellColor, roomId, password, onWelcome, onClose) {
    name = nick;
    mySkin = skin || 0;
    myShell = shellColor || null;
    room = roomId || 'official';
    roomPass = password || '';
    welcomeCb = onWelcome;
    closeCb = onClose;
    open();
  }

  function open() {
    // 连接根路径（与 legacy 零区冲突一致），兼容反代仅转发根路径 WebSocket 的情况
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    var url = proto + '//' + location.host;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      scheduleReconnect();
      return;
    }
    ws.onopen = function () {
      ws.send(JSON.stringify({ t: 'hello', name: name, skin: mySkin, shell: myShell, roomId: room, password: roomPass }));
    };
    ws.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      handle(msg);
    };
    ws.onclose = function () {
      if (connected) {
        connected = false;
        if (closeCb) closeCb();
      }
      scheduleReconnect();
    };
    ws.onerror = function () { /* onclose 会跟进 */ };
  }

  function scheduleReconnect() {
    if (!closeCb) return;   // 主动断开不重连
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      open();
    }, 2000);
  }

  function disconnect() {
    closeCb = null;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (ws) { try { ws.close(); } catch (e) { } }
    ws = null;
    connected = false;
  }

  function handle(msg) {
    if (msg.t === 'w') {
      // welcome
      myId = msg.id;
      mode = msg.mode;
      spots = msg.spots || [];
      connected = true;
      snaps = [];
      offset = null;
      if (welcomeCb) welcomeCb(msg);
      return;
    }
    if (msg.t === 's') {
      // 快照：估算时钟偏移（取最小延迟）
      var off = now() - msg.st;
      if (offset === null || off < offset) offset = off;
      snaps.push(msg);
      if (snaps.length > SNAP_KEEP) snaps.shift();
      mode = msg.mode;
      return;
    }
    if (msg.t === 'e') {
      // 加入房间被拒（密码错误 / 房间不存在 / 已满）：停止重连并上报
      if (msg.k === 'erauth' || msg.k === 'full') {
        var txt = msg.text || (msg.k === 'full' ? '房间已满' : '无法加入房间');
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        connected = false;
        ws = null;
        if (closeCb) {
          var cb = closeCb;
          closeCb = null;   // 认证失败不自动重连
          cb(txt);
        }
        return;
      }
      // 被服务器踢出（如长时间无操作自动退出）：停止重连并上报
      if (msg.k === 'kicked') {
        var ktxt = msg.text || '已被服务器断开';
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        connected = false;
        ws = null;
        if (closeCb) {
          var cb2 = closeCb;
          closeCb = null;   // 被踢出不自动重连
          cb2(ktxt);
        }
        return;
      }
      if (eventCb) eventCb(msg);
      return;
    }
  }

  function lerp(a, b, k) { return a + (b - a) * k; }
  function lerpAngle(a, b, k) {
    var d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * k;
  }

  /* 采样插值：返回 {ps, es, pk, tp, mode, wave, left}（元素与服务器格式一致） */
  function sample() {
    if (!snaps.length) return null;
    var tServer = now() - (offset || 0) - INTERP;
    var a = null, b = null;
    for (var i = snaps.length - 1; i >= 0; i--) {
      if (snaps[i].st <= tServer) { a = snaps[i]; b = snaps[i + 1] || null; break; }
    }
    if (!a) a = snaps[0], b = snaps[1] || null;
    if (!b) return { ps: a.ps, es: a.es, pk: a.pk, tp: a.tp, mode: a.mode, wave: a.wave, left: a.left };

    var k = (tServer - a.st) / Math.max(1, b.st - a.st);
    k = Math.max(0, Math.min(1, k));

    // 玩家
    var bMap = {};
    for (var j = 0; j < b.ps.length; j++) bMap[b.ps[j][0]] = b.ps[j];
    var ps = [];
    for (var i2 = 0; i2 < a.ps.length; i2++) {
      var pa = a.ps[i2], pb = bMap[pa[0]];
      if (!pb) { ps.push(pa); continue; }
      ps.push([
        pa[0],
        lerp(pa[1], pb[1], k), lerp(pa[2], pb[2], k),
        lerpAngle(pa[3], pb[3], k), lerpAngle(pa[4], pb[4], k), lerp(pa[5], pb[5], k),
        pb[6], pb[7], pb[8], pb[9], pb[10], pb[11], pb[12],
        pb[13], pb[14], pb[15], pb[16], pb[17], pb[18] != null ? pb[18] : 0,
        pb[19] != null ? pb[19] : 0, pb[20] != null ? pb[20] : 0, pb[21] != null ? pb[21] : 0,
        pb[22] || pa[22] || 'grunt'
      ]);
    }
    // AI
    var ebMap = {};
    for (var j2 = 0; j2 < b.es.length; j2++) ebMap[b.es[j2][0]] = b.es[j2];
    var es = [];
    for (var i3 = 0; i3 < a.es.length; i3++) {
      var ea = a.es[i3], eb = ebMap[ea[0]];
      if (!eb) { es.push(ea); continue; }
      es.push([ea[0], ea[1], lerp(ea[2], eb[2], k), lerp(ea[3], eb[3], k), lerpAngle(ea[4], eb[4], k), lerpAngle(ea[5], eb[5], k), eb[6], eb[7], eb[8]]);
    }
    return { ps: ps, es: es, pk: b.pk, tp: b.tp, mode: b.mode, wave: b.wave, left: b.left };
  }

  var inputTimer = null;
  function sendInput(inp) {
    if (!connected || !ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ t: 'i', f: r2(inp.f), turn: r2(inp.turn), ay: r2(inp.ay), ap: r2(inp.ap), fire: inp.fire ? 1 : 0 }));
  }
  function r2(v) { return Math.round(v * 100) / 100; }

  function chat(text) {
    if (!connected || !ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ t: 'chat', text: text }));
  }

  /* 房间大厅：进入战斗 / 观战 */
  function ready(veh) {
    if (!connected || !ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ t: 'ready', veh: veh || 'grunt' }));
  }
  function setVeh(veh) {
    if (!connected || !ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ t: 'veh', veh: veh || 'grunt' }));
  }
  function spectate() {
    if (!connected || !ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ t: 'spectate' }));
  }

  /* 房间列表 / 创建（HTTP） */
  function listRooms() {
    return fetch('/api/rooms').then(function (r) { return r.json(); });
  }
  function createRoom(name, password) {
    return fetch('/api/rooms/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, password: password || '' })
    }).then(function (r) { return r.json(); });
  }

  /* 最新快照原始数据（校正用，非插值） */
  function latest() {
    return snaps.length ? snaps[snaps.length - 1] : null;
  }

  window.Net = {
    connect: connect,
    disconnect: disconnect,
    sendInput: sendInput,
    chat: chat,
    ready: ready,
    setVeh: setVeh,
    spectate: spectate,
    listRooms: listRooms,
    createRoom: createRoom,
    sample: sample,
    latest: latest,
    onEvent: function (cb) { eventCb = cb; },
    get active() { return connected; },
    get myId() { return myId; },
    get mode() { return mode; },
    get playerCount() { return snaps.length ? snaps[snaps.length - 1].ps.length : 0; },
    get spots() { return spots; }
  };
})();
