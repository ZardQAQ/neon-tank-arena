/* =========================================================
 * 霓虹装甲 · 数据落盘
 * 局内发言 → data/chatlog.jsonl
 * NL 领取 → data/claims.jsonl
 * 一行一条 JSON，按北京时间带 date 字段，便于后期统计。
 * ========================================================= */
'use strict';

var fs = require('fs');
var path = require('path');

var DATA_DIR = path.join(__dirname, '..', 'data');
var queues = {};
var timers = {};

function todayStr() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function shanghaiTime() {
  return new Date().toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' });
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function flushFile(fileName) {
  if (timers[fileName]) {
    clearTimeout(timers[fileName]);
    timers[fileName] = null;
  }
  var q = queues[fileName];
  if (!q || !q.length) return;
  queues[fileName] = [];
  try {
    ensureDir();
    fs.appendFileSync(path.join(DATA_DIR, fileName), q.join(''));
  } catch (err) {
    console.error('[datalog]', fileName, err.message || err);
  }
}

function append(fileName, obj) {
  var line = JSON.stringify(obj) + '\n';
  if (!queues[fileName]) queues[fileName] = [];
  queues[fileName].push(line);
  if (queues[fileName].length >= 20) {
    flushFile(fileName);
    return;
  }
  if (!timers[fileName]) {
    timers[fileName] = setTimeout(function () { flushFile(fileName); }, 800);
    if (timers[fileName].unref) timers[fileName].unref();
  }
}

function logChat(entry) {
  if (!entry || !entry.text) return;
  append('chatlog.jsonl', {
    t: new Date().toISOString(),
    date: todayStr(),
    time: shanghaiTime(),
    nodelocId: entry.nodelocId ? String(entry.nodelocId) : '',
    name: String(entry.name || '').slice(0, 32),
    text: String(entry.text).slice(0, 200),
    roomId: entry.roomId ? String(entry.roomId) : '',
    mode: entry.mode ? String(entry.mode) : ''
  });
}

function logClaim(entry) {
  if (!entry) return;
  append('claims.jsonl', {
    t: new Date().toISOString(),
    date: todayStr(),
    time: shanghaiTime(),
    nodelocId: entry.nodelocId ? String(entry.nodelocId) : '',
    username: String(entry.username || ''),
    name: String(entry.name || ''),
    amount: entry.amount | 0,
    orderId: String(entry.orderId || ''),
    txnId: String(entry.txnId || ''),
    kills: entry.kills | 0,
    soloWave5: !!entry.soloWave5
  });
}

function saveNow() {
  var keys = Object.keys(queues);
  for (var i = 0; i < keys.length; i++) flushFile(keys[i]);
}

module.exports = { logChat: logChat, logClaim: logClaim, saveNow: saveNow };
