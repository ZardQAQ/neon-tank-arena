/* =========================================================
 * 霓虹装甲 · 服务器端战场碰撞
 * 与 public/js/world.js 完全一致的碰撞体与判定函数（去 THREE 化），
 * 保证服务器权威模拟与客户端表现物理一致。
 * ========================================================= */
'use strict';

var HALF = 64;      // 围墙内侧半宽
var WALL_H = 3.5;

var colliders = [];
var spawnPoints = [
  { x: 52, z: 52 }, { x: -52, z: 52 }, { x: 52, z: -52 }, { x: -52, z: -52 },
  { x: 0, z: 56 }, { x: 0, z: -56 }, { x: 56, z: 0 }, { x: -56, z: 0 }
];

function addRect(x, z, hw, hd, h) { colliders.push({ type: 'r', x: x, z: z, hw: hw, hd: hd, h: h }); }
function addCircle(x, z, r, h) { colliders.push({ type: 'c', x: x, z: z, r: r, h: h }); }

/* ---- 与 world.js build() 中登记的碰撞体一一对应 ---- */
// 角塔
[[HALF, HALF], [-HALF, HALF], [HALF, -HALF], [-HALF, -HALF]].forEach(function (p) {
  addCircle(p[0], p[1], 2.6, 7.5);
});
// 霓虹灯柱
[{ x: 44, z: 0 }, { x: -44, z: 0 }, { x: 0, z: 44 }, { x: 0, z: -44 }].forEach(function (p) {
  addRect(p.x, p.z, 0.78, 0.78, 8);
});
// 碉堡
[[20, 20], [-20, 20], [20, -20], [-20, -20]].forEach(function (p) {
  addRect(p[0], p[1], 3.05, 3.05, 2.6);
});
// 集装箱
[
  { x: 36, z: -12, ry: 0 }, { x: -36, z: 12, ry: 0 },
  { x: 12, z: 36, ry: 1 }, { x: -12, z: -36, ry: 1 }
].forEach(function (d) {
  var w = d.ry ? 7 : 3, dd = d.ry ? 3 : 7;
  addRect(d.x, d.z, w / 2 + 0.1, dd / 2 + 0.1, 2.3);
});
// 路障
[
  { x: 0, z: 14, ry: 0 }, { x: 0, z: -14, ry: 0 },
  { x: 14, z: 0, ry: 1 }, { x: -14, z: 0, ry: 1 },
  { x: 38, z: 38, ry: 0 }, { x: -38, z: 38, ry: 1 },
  { x: 38, z: -38, ry: 1 }, { x: -38, z: -38, ry: 0 }
].forEach(function (d) {
  var w = d.ry ? 1.1 : 4.6, dd = d.ry ? 4.6 : 1.1;
  addRect(d.x, d.z, w / 2 + 0.05, dd / 2 + 0.05, 1.25);
});
// 岩石
[
  [32, 4, 2.1], [-32, -4, 2.1], [4, -32, 2.3], [-6, 30, 1.8],
  [46, -26, 2.5], [-46, 26, 2.5], [24, -46, 2.1], [-24, 46, 2.1]
].forEach(function (d) {
  addCircle(d[0], d[1], d[2] * 0.95, d[2] * 1.05);
});
// 立柱
[[26, -40], [-26, 40], [40, 26], [-40, -26]].forEach(function (p) {
  addCircle(p[0], p[1], 1.0, 4.4);
});

/* ================= 碰撞 / 视线（与客户端逐行一致） ================= */

function resolveCircle(x, z, r) {
  var B = HALF - 1.0 - r;
  if (x < -B) x = -B; else if (x > B) x = B;
  if (z < -B) z = -B; else if (z > B) z = B;

  for (var i = 0; i < colliders.length; i++) {
    var c = colliders[i];
    if (c.type === 'r') {
      var nx = Math.max(c.x - c.hw, Math.min(x, c.x + c.hw));
      var nz = Math.max(c.z - c.hd, Math.min(z, c.z + c.hd));
      var dx = x - nx, dz = z - nz;
      var d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        if (d2 > 1e-9) {
          var d = Math.sqrt(d2), push = (r - d) / d;
          x += dx * push; z += dz * push;
        } else {
          var pxr = (c.x + c.hw + r) - x, pxl = x - (c.x - c.hw - r);
          var pzr = (c.z + c.hd + r) - z, pzl = z - (c.z - c.hd - r);
          var m = Math.min(pxr, pxl, pzr, pzl);
          if (m === pxr) x = c.x + c.hw + r;
          else if (m === pxl) x = c.x - c.hw - r;
          else if (m === pzr) z = c.z + c.hd + r;
          else z = c.z - c.hd - r;
        }
      }
    } else {
      var ddx = x - c.x, ddz = z - c.z;
      var rr = r + c.r;
      var dd2 = ddx * ddx + ddz * ddz;
      if (dd2 < rr * rr) {
        if (dd2 < 1e-9) { ddx = 1; ddz = 0; dd2 = 1; }
        var dd = Math.sqrt(dd2);
        x = c.x + ddx / dd * rr;
        z = c.z + ddz / dd * rr;
      }
    }
  }
  return { x: x, z: z };
}

function circleFree(x, z, r) {
  var B = HALF - 1.0 - r;
  if (x < -B || x > B || z < -B || z > B) return false;
  for (var i = 0; i < colliders.length; i++) {
    var c = colliders[i];
    if (c.type === 'r') {
      var nx = Math.max(c.x - c.hw, Math.min(x, c.x + c.hw));
      var nz = Math.max(c.z - c.hd, Math.min(z, c.z + c.hd));
      var dx = x - nx, dz = z - nz;
      if (dx * dx + dz * dz < r * r) return false;
    } else {
      var ddx = x - c.x, ddz = z - c.z, rr = r + c.r;
      if (ddx * ddx + ddz * ddz < rr * rr) return false;
    }
  }
  return true;
}

function segmentHit(ax, ay, az, bx, by, bz) {
  var bestT = Infinity, kind = '';

  if (ay > 0.05 && by <= 0.05) {
    var tg = (ay - 0.05) / (ay - by);
    if (tg >= 0 && tg < bestT) { bestT = tg; kind = 'ground'; }
  }

  var dx = bx - ax, dz = bz - az;
  if (dx !== 0) {
    var t1 = (HALF - ax) / dx, t2 = (-HALF - ax) / dx;
    if (t1 > 0 && t1 <= 1 && t1 < bestT && ay + (by - ay) * t1 < WALL_H + 0.5) { bestT = t1; kind = 'wall'; }
    if (t2 > 0 && t2 <= 1 && t2 < bestT && ay + (by - ay) * t2 < WALL_H + 0.5) { bestT = t2; kind = 'wall'; }
  }
  if (dz !== 0) {
    var t3 = (HALF - az) / dz, t4 = (-HALF - az) / dz;
    if (t3 > 0 && t3 <= 1 && t3 < bestT && ay + (by - ay) * t3 < WALL_H + 0.5) { bestT = t3; kind = 'wall'; }
    if (t4 > 0 && t4 <= 1 && t4 < bestT && ay + (by - ay) * t4 < WALL_H + 0.5) { bestT = t4; kind = 'wall'; }
  }

  for (var i = 0; i < colliders.length; i++) {
    var c = colliders[i], t = -1;
    if (c.type === 'c') {
      var fx = ax - c.x, fz = az - c.z;
      var A = dx * dx + dz * dz;
      if (A < 1e-12) continue;
      var Bq = 2 * (fx * dx + fz * dz);
      var C = fx * fx + fz * fz - c.r * c.r;
      if (C < 0) continue;
      var disc = Bq * Bq - 4 * A * C;
      if (disc < 0) continue;
      t = (-Bq - Math.sqrt(disc)) / (2 * A);
    } else {
      var invx = dx !== 0 ? 1 / dx : Infinity;
      var invz = dz !== 0 ? 1 / dz : Infinity;
      var tx1 = (c.x - c.hw - ax) * invx, tx2 = (c.x + c.hw - ax) * invx;
      var tmin = Math.min(tx1, tx2), tmax = Math.max(tx1, tx2);
      if (dx === 0) { if (ax < c.x - c.hw || ax > c.x + c.hw) continue; tmin = -Infinity; tmax = Infinity; }
      var tz1 = (c.z - c.hd - az) * invz, tz2 = (c.z + c.hd - az) * invz;
      var tzmin = Math.min(tz1, tz2), tzmax = Math.max(tz1, tz2);
      if (dz === 0) { if (az < c.z - c.hd || az > c.z + c.hd) continue; tzmin = -Infinity; tzmax = Infinity; }
      var tEnter = Math.max(tmin, tzmin), tExit = Math.min(tmax, tzmax);
      if (tEnter > tExit || tEnter <= 0) continue;
      t = tEnter;
    }
    if (t > 0 && t <= 1 && t < bestT) {
      var y = ay + (by - ay) * t;
      if (y <= c.h) { bestT = t; kind = 'obstacle'; }
    }
  }

  if (!isFinite(bestT) || bestT > 1) return null;
  return {
    t: bestT,
    x: ax + dx * bestT,
    y: ay + (by - ay) * bestT,
    z: az + dz * bestT,
    kind: kind
  };
}

function blocksLOS(ax, az, bx, bz) {
  var dx = bx - ax, dz = bz - az;
  for (var i = 0; i < colliders.length; i++) {
    var c = colliders[i];
    if (c.h < 1.5) continue;
    if (c.type === 'c') {
      var fx = ax - c.x, fz = az - c.z;
      var A = dx * dx + dz * dz;
      if (A < 1e-12) continue;
      var Bq = 2 * (fx * dx + fz * dz);
      var C = fx * fx + fz * fz - c.r * c.r;
      if (C < 0) return true;
      var disc = Bq * Bq - 4 * A * C;
      if (disc < 0) continue;
      var t = (-Bq - Math.sqrt(disc)) / (2 * A);
      if (t > 0 && t < 1) return true;
    } else {
      var invx = dx !== 0 ? 1 / dx : Infinity;
      var invz = dz !== 0 ? 1 / dz : Infinity;
      var tx1 = (c.x - c.hw - ax) * invx, tx2 = (c.x + c.hw - ax) * invx;
      var tmin = Math.min(tx1, tx2), tmax = Math.max(tx1, tx2);
      if (dx === 0) { if (ax < c.x - c.hw || ax > c.x + c.hw) continue; tmin = -Infinity; tmax = Infinity; }
      var tz1 = (c.z - c.hd - az) * invz, tz2 = (c.z + c.hd - az) * invz;
      var tzmin = Math.min(tz1, tz2), tzmax = Math.max(tz1, tz2);
      if (dz === 0) { if (az < c.z - c.hd || az > c.z + c.hd) continue; tzmin = -Infinity; tzmax = Infinity; }
      var tEnter = Math.max(tmin, tzmin), tExit = Math.min(tmax, tzmax);
      if (tEnter <= tExit && tEnter > 0 && tEnter < 1) return true;
    }
  }
  return false;
}

function randomOpenPoint(margin, r) {
  var B = HALF - margin;
  var x = 0, z = 0;
  for (var i = 0; i < 24; i++) {
    x = -B + Math.random() * B * 2;
    z = -B + Math.random() * B * 2;
    if (circleFree(x, z, r)) return { x: x, z: z };
  }
  return { x: x, z: z };
}

module.exports = {
  HALF: HALF,
  WALL_H: WALL_H,
  spawnPoints: spawnPoints,
  resolveCircle: resolveCircle,
  circleFree: circleFree,
  segmentHit: segmentHit,
  blocksLOS: blocksLOS,
  randomOpenPoint: randomOpenPoint
};
