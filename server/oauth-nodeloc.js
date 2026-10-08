/* =========================================================
 * 霓虹装甲 · NodeLoc OAuth2 登录（授权码流程 + 签名会话 Cookie）
 * 适配本项目零依赖原生 http server（不依赖 express / fetch）
 * 路由由 server/index.js 注册 /oauth/nodeloc、/api/oauth/me、/api/oauth/logout
 * ========================================================= */
'use strict';

const crypto = require('crypto');
const https = require('https');
const http = require('http');

const BASE_URL = (process.env.NodeLoc_URL || process.env.NODELOC_URL || 'https://www.nodeloc.com').replace(/\/$/, '');
const CLIENT_ID = process.env.NodeLoc_CLIENT_ID || process.env.NODELOC_CLIENT_ID
  || '58e712bd-61af-47fa-ab73-1b8e3ca0964e';
const CLIENT_SECRET = process.env.NodeLoc_CLIENT_SECRET || process.env.NODELOC_CLIENT_SECRET
  || '5527671c3bc455d77b952b1232559f2c0d292c084bf358afc39804aba811496f';
const REDIRECT_URI = process.env.NodeLoc_REDIRECT_URI || process.env.NODELOC_REDIRECT_URI
  || 'https://tankl.zard.pro/auth/callback';
const SCOPE = process.env.NodeLoc_SCOPE || process.env.NODELOC_SCOPE || 'openid profile';
const COOKIE_SESSION = 'na_nl';
const COOKIE_STATE = 'na_nl_state';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;   // 30 天
const STATE_TTL_MS = 10 * 60 * 1000;
const SIGN_SECRET = process.env.NODELOC_SESSION_SECRET || process.env.SESSION_SECRET
  || CLIENT_SECRET || 'neon-arena-nodeloc';

function enabled() {
  return !!(CLIENT_ID && CLIENT_SECRET && REDIRECT_URI);
}

function loginStartUrl() {
  return '/auth/callback';
}

/* ---------- 低层 HTTP 请求（无 fetch 依赖，兼容 Node 14+） ---------- */

function request(method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.request(url, { method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (_) { /* 非 JSON */ }
        resolve({ status: res.statusCode, body: text, json });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function exchangeCode(code) {
  const payload = new URLSearchParams({
    grant_type: 'authorization_code',
    code: String(code),
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  }).toString();
  const res = await request('POST', BASE_URL + '/oauth-provider/token', {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  }, payload);
  if (!res.json || !res.json.access_token) {
    const msg = (res.json && (res.json.error_description || res.json.error)) || res.body.slice(0, 200) || ('HTTP ' + res.status);
    throw new Error('换取 token 失败: ' + msg);
  }
  return res.json;
}

async function fetchUserInfo(accessToken) {
  const res = await request('GET', BASE_URL + '/oauth-provider/userinfo', {
    Authorization: 'Bearer ' + accessToken,
    Accept: 'application/json',
  });
  if (!res.json || res.json.id == null) {
    const msg = (res.json && (res.json.error_description || res.json.error || res.json.message)) || res.body.slice(0, 200) || ('HTTP ' + res.status);
    throw new Error('获取用户信息失败: ' + msg);
  }
  const j = res.json;
  return {
    id: j.id,
    username: String(j.username || j.name || ('nl' + j.id)),
    name: String(j.name || j.username || ('nl' + j.id)),
    avatar_url: String(j.avatar_url || ''),
    trust_level: j.trust_level | 0,
  };
}

/* ---------- 签名会话 Cookie ---------- */

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}
function sign(payloadObj) {
  const body = b64url(JSON.stringify(payloadObj));
  const sig = crypto.createHmac('sha256', SIGN_SECRET).update(body).digest('base64url');
  return body + '.' + sig;
}
function verify(token) {
  if (!token || typeof token !== 'string') return null;
  const i = token.indexOf('.');
  if (i < 0) return null;
  const body = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expect = crypto.createHmac('sha256', SIGN_SECRET).update(body).digest('base64url');
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expect);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!data || typeof data !== 'object') return null;
    if (data.exp && Date.now() > data.exp) return null;
    return data;
  } catch (_) {
    return null;
  }
}

function parseCookie(req, name) {
  const raw = req.headers && req.headers.cookie;
  if (!raw) return '';
  for (const part of String(raw).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}

function userFromToken(token) {
  const data = verify(token);
  if (!data || data.id == null || data.id === '') return null;
  return { id: data.id, username: String(data.username || ''), name: String(data.name || data.username || '') };
}
function userFromReq(req) {
  return userFromToken(parseCookie(req, COOKIE_SESSION));
}

function makeSessionToken(user) {
  return sign({ id: user.id, username: user.username || '', name: user.name || user.username || '', exp: Date.now() + SESSION_TTL_MS });
}

function cookieSecure(req) {
  if (process.env.COOKIE_SECURE === '1') return true;
  if (process.env.COOKIE_SECURE === '0') return false;
  if (String(REDIRECT_URI).startsWith('https://')) return true;
  return false;
}
function cookieFlags(req, maxAgeSec) {
  const parts = ['Path=/', 'Max-Age=' + maxAgeSec, 'SameSite=Lax', 'HttpOnly'];
  if (cookieSecure(req)) parts.push('Secure');
  return parts.join('; ');
}
function appendCookie(res, line) {
  const prev = res.getHeader('Set-Cookie');
  if (!prev) res.setHeader('Set-Cookie', line);
  else if (Array.isArray(prev)) res.setHeader('Set-Cookie', prev.concat(line));
  else res.setHeader('Set-Cookie', [prev, line]);
}
function setSessionCookie(res, req, user, tokenOpt) {
  const token = tokenOpt || makeSessionToken(user);
  appendCookie(res, COOKIE_SESSION + '=' + encodeURIComponent(token) + '; ' + cookieFlags(req, Math.floor(SESSION_TTL_MS / 1000)));
  return token;
}
function clearSessionCookie(res, req) {
  const secure = cookieSecure(req) ? '; Secure' : '';
  appendCookie(res, COOKIE_SESSION + '=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly' + secure);
}
function setStateCookie(res, req, state) {
  const token = sign({ state, exp: Date.now() + STATE_TTL_MS });
  appendCookie(res, COOKIE_STATE + '=' + encodeURIComponent(token) + '; ' + cookieFlags(req, Math.floor(STATE_TTL_MS / 1000)));
}
function clearStateCookie(res, req) {
  const secure = cookieSecure(req) ? '; Secure' : '';
  appendCookie(res, COOKIE_STATE + '=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly' + secure);
}

/* ---------- 原生 http 响应辅助 ---------- */

function redirect(res, url) {
  res.writeHead(302, { Location: url });
  res.end();
}
function sendHtml(res, status, html) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}
function sendJson(res, obj) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(JSON.stringify(obj));
}
function queryParams(req) {
  const q = String(req.url || '').split('?')[1] || '';
  const params = new URLSearchParams(q);
  const out = {};
  params.forEach((v, k) => { out[k] = v; });
  return out;
}

/* ---------- 业务流程 ---------- */

function authorizeUrl(state) {
  const u = new URL(BASE_URL + '/oauth-provider/authorize');
  u.searchParams.set('client_id', CLIENT_ID);
  u.searchParams.set('redirect_uri', REDIRECT_URI);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', SCOPE);
  u.searchParams.set('state', state);
  return u.toString();
}

function startLogin(req, res) {
  if (!enabled()) {
    sendHtml(res, 503, '<h1>未配置 NodeLoc OAuth</h1><p>缺少 Client ID / Secret / Redirect URI。</p><a href="/">返回游戏</a>');
    return;
  }
  const state = crypto.randomBytes(16).toString('hex');
  setStateCookie(res, req, state);
  redirect(res, authorizeUrl(state));
}

function readState(req) {
  return verify(parseCookie(req, COOKIE_STATE));
}

async function handleCallback(req, res) {
  const q = queryParams(req);
  const { code, state, error, error_description: errDesc } = q;
  const stateData = readState(req);
  clearStateCookie(res, req);
  if (error) {
    redirect(res, '/?oauth_error=' + encodeURIComponent(error === 'access_denied' ? '你取消了 NodeLoc 授权。' : ('授权失败：' + (errDesc || error))));
    return;
  }
  if (!code) { redirect(res, '/?oauth_error=' + encodeURIComponent('缺少授权码')); return; }
  if (!(stateData && stateData.state && state && stateData.state === state)) {
    redirect(res, '/?oauth_error=' + encodeURIComponent('登录状态校验失败，请重试')); return;
  }
  try {
    const token = await exchangeCode(code);
    const user = await fetchUserInfo(token.access_token);
    setSessionCookie(res, req, user);
    const nameHint = String(user.username || user.name || '').slice(0, 12);
    redirect(res, '/?oauth=1&name=' + encodeURIComponent(nameHint));
  } catch (e) {
    console.error('[oauth-nodeloc]', e.message || e);
    redirect(res, '/?oauth_error=' + encodeURIComponent(e.message || '登录失败'));
  }
}

function logout(req, res) {
  clearSessionCookie(res, req);
  sendJson(res, { ok: true });
}

function me(req, res) {
  const user = userFromReq(req);
  sendJson(res, {
    ok: true,
    enabled: enabled(),
    loggedIn: !!user,
    user: user || null,
    loginUrl: loginStartUrl(),
    redirectUri: REDIRECT_URI,
  });
}

function route(req, res) {
  const q = queryParams(req);
  if (q.code || q.error) {
    Promise.resolve(handleCallback(req, res)).catch((e) => {
      console.error('[oauth-nodeloc] callback crash:', e);
      if (!res.headersSent) redirect(res, '/?oauth_error=' + encodeURIComponent('登录回调异常，请重试'));
    });
    return;
  }
  return startLogin(req, res);
}

module.exports = { enabled, userFromReq, userFromToken, route, me, logout, loginStartUrl, makeSessionToken, REDIRECT_URI, CLIENT_ID, BASE_URL };