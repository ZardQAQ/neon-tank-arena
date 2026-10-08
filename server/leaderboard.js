/* =========================================================
 * 霓虹装甲 · 联机排行榜持久化
 * 按 Linux DO 账号（ld:{id}）记录击杀/死亡/最高连杀/得分，写盘节流。
 * 暖服假人 Zard 与同名真人登录账号互不影响。
 * ========================================================= */
'use strict';

var fs = require('fs');
var path = require('path');

var DATA_DIR = path.join(__dirname, '..', 'data');
var FILE = path.join(DATA_DIR, 'leaderboard.json');

var board = {};
var botNames = {};   // 机器人昵称集合（不上排行榜）
var DECOY_NAMES = { zard: true };   // 暖服假人昵称（仅拦未登录的同名档）
var BOT_PREFIXES = ['暖服·'];          // 历史暖服假人前缀
var dirty = false;
var timer = null;

function nlKey(id) {
  return 'ld:' + String(id);
}

function isNlEntry(e, key) {
  if (e && e.nodelocId != null && e.nodelocId !== '') return true;
  var k = String(key || '');
  return k.indexOf('ld:') === 0 || k.indexOf('nl:') === 0;
}

function isBotName(name) {
  if (!name) return false;
  if (botNames[name]) return true;
  if (DECOY_NAMES[String(name).toLowerCase()]) return true;
  for (var i = 0; i < BOT_PREFIXES.length; i++) {
    if (String(name).indexOf(BOT_PREFIXES[i]) === 0) return true;
  }
  return false;
}

function load() {
  try {
    if (fs.existsSync(FILE)) {
      board = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    }
  } catch (e) { board = {}; }
  // 只清「按昵称索引」的假人残留；nl:{id} 真人档案一律保留（可与假人同名，如 zard）
  var keys = Object.keys(board);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var e = board[key];
    if (isNlEntry(e, key)) continue;
    var name = (e && e.name) || key;
    if (isBotName(name)) { delete board[key]; dirty = true; }
  }
}

function save() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(board));
  } catch (e) { /* ignore */ }
}

function ensureTimer() {
  if (timer) return;
  timer = setInterval(function () {
    if (dirty) { dirty = false; save(); }
  }, 5000);
  timer.unref();
}

function blank(name, nodelocId) {
  return { name: name || '', nodelocId: nodelocId || null, kills: 0, deaths: 0, bestStreak: 0, score: 0, games: 0 };
}

function ensureEntry(p) {
  var key = nlKey(p.nodelocId);
  var e = board[key];
  if (!e) {
    // 认领同名旧档（游客/旧版按昵称存储）；假人昵称不认领
    var legacy = board[p.name];
    if (legacy && !isNlEntry(legacy, p.name) && !isBotName(p.name)) {
      e = board[key] = legacy;
      delete board[p.name];
    } else {
      e = board[key] = blank(p.name, p.nodelocId);
    }
  }
  e.name = p.name || e.name;
  e.nodelocId = p.nodelocId;
  if (e.kills == null) e.kills = 0;
  if (e.deaths == null) e.deaths = 0;
  if (e.bestStreak == null) e.bestStreak = 0;
  if (e.score == null) e.score = 0;
  if (e.games == null) e.games = 0;
  return e;
}

/* 记录一名玩家当前战绩（增量合并）——实时调用。机器人 / 游客不入榜 */
function bump(p) {
  if (!p || p.bot || !p.nodelocId) return;   // 仅 Linux DO 登录用户计入；不因昵称撞假人而丢档
  var e = ensureEntry(p);
  var dk = (p.kills || 0) - (p._lk || 0);
  var dd = (p.deaths || 0) - (p._ld || 0);
  var ds = (p.score || 0) - (p._ls || 0);
  if (dk > 0) e.kills += dk;
  if (dd > 0) e.deaths += dd;
  if (ds > 0) e.score += ds;
  if (p.bestStreak) e.bestStreak = Math.max(e.bestStreak, p.bestStreak);
  p._lk = p.kills; p._ld = p.deaths; p._ls = p.score;
  dirty = true;
  ensureTimer();
  return e;
}

/* 离开房间时结算一场（场次 +1，剩余增量并入） */
function merge(p) {
  if (!p || p.bot || !p.nodelocId) return;
  var e = bump(p);
  if (!e) e = ensureEntry(p);
  e.games += 1;
  dirty = true;
  ensureTimer();
}

function top(n) {
  var arr = [];
  for (var key in board) {
    var e = board[key];
    if (!e) continue;
    var nl = isNlEntry(e, key);
    var name = e.name || (nl ? '' : key);
    if (!name) continue;
    if (!nl && isBotName(name)) continue;   // 未绑定账号的假人档不展示
    arr.push({ name: name, kills: e.kills || 0, deaths: e.deaths || 0, bestStreak: e.bestStreak || 0, score: e.score || 0 });
  }
  arr.sort(function (a, b) { return b.kills - a.kills || b.score - a.score; });
  return arr.slice(0, n || 20);
}

function addBot(name) {
  if (!name) return;
  botNames[name] = true;
  // 只删按昵称索引的旧档，绝不碰 nl:{id} 真人档案
  if (board[name] && !isNlEntry(board[name], name)) { delete board[name]; dirty = true; }
}

function flush() {
  if (dirty) { dirty = false; save(); }
}

load();

module.exports = { record: bump, bump: bump, merge: merge, top: top, addBot: addBot, flush: flush };
