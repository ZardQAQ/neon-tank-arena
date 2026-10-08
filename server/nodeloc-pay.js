/* =========================================================
 * 霓虹装甲 · NodeLoc 积分转账
 * HMAC-SHA256(token_hash, sorted_params)，token_hash = SHA256(token)
 * https://docs.nodeloc.com/api-reference/payment.md
 * ========================================================= */
'use strict';

const crypto = require('crypto');
const https = require('https');
const http = require('http');

const BASE_URL = (process.env.NodeLoc_URL || process.env.NODELOC_URL || 'https://www.nodeloc.com').replace(/\/$/, '');
const PAYMENT_ID = process.env.NODELOC_PAYMENT_ID || 'pay_d8fa5e53d797795102b8ea790253f540';
const PAYMENT_TOKEN = process.env.NODELOC_PAYMENT_TOKEN
  || 'tk_95ec8f17e585b7a6956cb8eed65f5fe019986d2e3adacd75b75c7cdab0e005b8';
const CLAIM_AMOUNT = 10;

function signParams(params) {
  const keys = Object.keys(params).sort();
  const paramString = keys.map((k) => k + '=' + params[k]).join('&');
  const tokenHash = crypto.createHash('sha256').update(String(PAYMENT_TOKEN), 'utf8').digest('hex');
  return crypto.createHmac('sha256', tokenHash).update(paramString, 'utf8').digest('hex');
}

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

async function transfer(toUserId, toUsername, orderId, amount) {
  const amt = amount == null ? CLAIM_AMOUNT : (amount | 0);
  if (!PAYMENT_ID || !PAYMENT_TOKEN) {
    return { ok: false, error: '未配置支付应用' };
  }
  if (!toUserId || !toUsername) {
    return { ok: false, error: '收款人信息不完整' };
  }
  if (!(amt > 0)) return { ok: false, error: '金额无效' };

  const signFields = {
    amount: String(amt),
    order_id: String(orderId),
    to_user_id: String(toUserId),
    to_username: String(toUsername)
  };
  const signature = signParams(signFields);
  const payload = new URLSearchParams({
    to_user_id: String(toUserId),
    to_username: String(toUsername),
    amount: String(amt),
    order_id: String(orderId),
    signature: signature
  }).toString();

  const url = BASE_URL + '/payment/transfer/' + encodeURIComponent(PAYMENT_ID);
  let res;
  try {
    res = await request('POST', url, {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json'
    }, payload);
  } catch (err) {
    return { ok: false, error: '转账请求失败: ' + (err.message || err) };
  }

  const json = res.json || {};
  if (res.status >= 200 && res.status < 300 && json.success) {
    return {
      ok: true,
      transaction_id: json.transaction_id || null,
      status: json.status || 'completed',
      amount: json.amount,
      fee: json.fee,
      json: json
    };
  }
  const errText = json.error || json.message || res.body.slice(0, 200) || ('HTTP ' + res.status);
  return { ok: false, error: String(errText), status: res.status, json: json };
}

module.exports = { transfer: transfer, CLAIM_AMOUNT: CLAIM_AMOUNT };
