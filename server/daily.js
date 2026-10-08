/* =========================================================
 * 霓虹装甲 · 每日排行榜
 * 北京时间切日。联机击杀 + 单机第 5 波标记 + 10 NL 领取（每日 20 名额）。
 * ========================================================= */
'use strict';

var fs = require('fs');
var path = require('path');
var Datalog = require('./datalog.js');

var DATA_DIR = path.join(__dirname, '..', 'data');
var FILE = path.join(DATA_DIR, 'daily.json');
var KILL_NEED = 11;   // 击杀必须超过 10
var CLAIM_LIMIT = 20; // 每天最多 20 人领取
var CLAIM_AMOUNT = 10;

var store = { date: '', players: {} };
var dirty = false;
var timer = null;

function todayStr() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function nlKey(id) {
  return 'nl:' + String(id);
}

function blank(p) {
  return {
    name: (p && p.name) || '',
    username: (p && p.username) || '',
    nodelocId: p && (p.nodelocId != null || p.id != null) ? String(p.nodelocId || p.id) : null,
    kills: 0,
    soloWave5: false,
    claimed: false,
    claimedAt: null,
    txnId: null,
    claiming: false
  };
}

function save() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    var out = { date: store.date, players: {} };
    var keys = Object.keys(store.players);
    for (var i = 0; i < keys.length; i++) {
      var e = store.players[keys[i]];
      if (!e) continue;
      out.players[keys[i]] = {
        name: e.name || '',
        username: e.username || '',
        nodelocId: e.nodelocId,
        kills: e.kills || 0,
        soloWave5: !!e.soloWave5,
        claimed: !!e.claimed,
        claimedAt: e.claimedAt || null,
        txnId: e.txnId || null
      };
    }
    fs.writeFileSync(FILE, JSON.stringify(out));
  } catch (err) { /* ignore */ }
}

function load() {
  try {
    if (fs.existsSync(FILE)) {
      var raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      if (raw && typeof raw === 'object') store = raw;
    }
  } catch (err) { store = { date: '', players: {} }; }
  if (!store.players) store.players = {};
  var keys = Object.keys(store.players);
  for (var i = 0; i < keys.length; i++) {
    if (store.players[keys[i]]) store.players[keys[i]].claiming = false;
  }
  ensureDay();
}

function ensureTimer() {
  if (timer) return;
  timer = setInterval(function () {
    if (dirty) { dirty = false; save(); }
  }, 5000);
  if (timer.unref) timer.unref();
}

function ensureDay() {
  var t = todayStr();
  if (store.date !== t) {
    store = { date: t, players: {} };
    dirty = true;
    ensureTimer();
  }
}

function userId(user) {
  if (!user) return '';
  if (user.nodelocId != null && user.nodelocId !== '') return String(user.nodelocId);
  if (user.id != null && user.id !== '') return String(user.id);
  return '';
}

function getEntry(user) {
  ensureDay();
  var id = userId(user);
  if (!id) return null;
  return store.players[nlKey(id)] || null;
}

function ensureEntry(user) {
  ensureDay();
  var id = userId(user);
  if (!id) return null;
  var key = nlKey(id);
  var e = store.players[key];
  if (!e) {
    e = store.players[key] = blank(user);
    e.nodelocId = id;
  }
  if (user.name) e.name = String(user.name);
  if (user.username) e.username = String(user.username);
  return e;
}

function claimedCount() {
  ensureDay();
  var n = 0;
  var keys = Object.keys(store.players);
  for (var i = 0; i < keys.length; i++) {
    var e = store.players[keys[i]];
    if (e && (e.claimed || e.claiming)) n++;
  }
  return n;
}

function slotsView() {
  ensureDay();
  var used = claimedCount();
  return {
    limit: CLAIM_LIMIT,
    claimed: used,
    left: Math.max(0, CLAIM_LIMIT - used),
    amount: CLAIM_AMOUNT
  };
}

function isEligible(e) {
  if (!e || e.claimed) return false;
  return (e.kills > 10) || e.soloWave5 === true;
}

function needKills(e) {
  if (!e) return KILL_NEED;
  if (e.kills > 10 || e.soloWave5) return 0;
  return KILL_NEED - (e.kills || 0);
}

function addKills(p, n) {
  if (!p || p.bot || !p.nodelocId) return null;
  var dk = n == null ? 1 : (n | 0);
  if (dk <= 0) return null;
  var e = ensureEntry(p);
  if (!e) return null;
  e.kills += dk;
  dirty = true;
  ensureTimer();
  return e;
}

function markSoloWave5(user) {
  if (!user || userId(user) === '') return { ok: false, text: '请先 Linux DO 登录' };
  var e = ensureEntry({
    nodelocId: userId(user),
    name: user.name || user.username || '',
    username: user.username || ''
  });
  e.soloWave5 = true;
  dirty = true;
  ensureTimer();
  return { ok: true, me: meView(user) };
}

function meView(user) {
  var slots = slotsView();
  if (!user || userId(user) === '') {
    return {
      loggedIn: false,
      kills: 0,
      soloWave5: false,
      claimed: false,
      claiming: false,
      eligible: false,
      needKills: KILL_NEED,
      slotsFull: slots.left <= 0
    };
  }
  ensureDay();
  var e = store.players[nlKey(userId(user))];
  var kills = e ? (e.kills || 0) : 0;
  var solo = !!(e && e.soloWave5);
  var claimed = !!(e && e.claimed);
  var reached = kills > 10 || solo;
  var slotsFull = !claimed && slots.left <= 0;
  return {
    loggedIn: true,
    name: (e && e.name) || user.username || user.name || '',
    kills: kills,
    soloWave5: solo,
    claimed: claimed,
    claiming: !!(e && e.claiming),
    eligible: !claimed && reached && !slotsFull,
    needKills: needKills(e),
    slotsFull: slotsFull
  };
}

function top(n) {
  ensureDay();
  var arr = [];
  var keys = Object.keys(store.players);
  for (var i = 0; i < keys.length; i++) {
    var e = store.players[keys[i]];
    if (!e) continue;
    arr.push({
      name: e.name || '',
      kills: e.kills || 0,
      soloWave5: !!e.soloWave5,
      claimed: !!e.claimed
    });
  }
  arr.sort(function (a, b) { return b.kills - a.kills; });
  return arr.slice(0, n || 20);
}

function orderId(id) {
  ensureDay();
  return 'daily_nl_' + String(id) + '_' + store.date;
}

function beginClaim(user) {
  if (!user || userId(user) === '') return { ok: false, text: '请先 Linux DO 登录' };
  if (!user.username) return { ok: false, text: '无法确认 Linux DO 用户名，请重新登录' };
  var e = getEntry(user);
  if (!e) return { ok: false, text: '未达标：今日击杀需超过 10，或单机通过第 5 波（还需 ' + KILL_NEED + ' 杀）' };
  e.username = String(user.username);
  if (user.name) e.name = String(user.name);
  if (e.claimed) return { ok: false, text: '今日已领取' };
  if (e.claiming) return { ok: false, text: '领取处理中' };
  if (!isEligible(e)) {
    if (e.soloWave5) return { ok: false, text: '未达标' };
    return { ok: false, text: '未达标：今日击杀需超过 10，或单机通过第 5 波（还需 ' + needKills(e) + ' 杀）' };
  }
  if (claimedCount() >= CLAIM_LIMIT) {
    return { ok: false, text: '今日名额已满（' + CLAIM_LIMIT + '/' + CLAIM_LIMIT + '）' };
  }
  e.claiming = true;
  dirty = true;
  return { ok: true, entry: e, orderId: orderId(userId(user)) };
}

function finishClaim(e, txnId, extra) {
  if (!e) return;
  e.claiming = false;
  e.claimed = true;
  e.claimedAt = new Date().toISOString();
  e.txnId = txnId || null;
  dirty = true;
  save();
  Datalog.logClaim({
    nodelocId: e.nodelocId,
    username: e.username,
    name: e.name,
    amount: CLAIM_AMOUNT,
    orderId: extra && extra.orderId,
    txnId: txnId,
    kills: e.kills,
    soloWave5: e.soloWave5
  });
  Datalog.saveNow();
}

function abortClaim(e) {
  if (!e) return;
  e.claiming = false;
  dirty = true;
}

function flush() {
  if (dirty) { dirty = false; save(); }
}

load();

module.exports = {
  today: todayStr,
  addKills: addKills,
  markSoloWave5: markSoloWave5,
  me: meView,
  top: top,
  slots: slotsView,
  CLAIM_AMOUNT: CLAIM_AMOUNT,
  CLAIM_LIMIT: CLAIM_LIMIT,
  orderId: orderId,
  beginClaim: beginClaim,
  finishClaim: finishClaim,
  abortClaim: abortClaim,
  flush: flush
};
