const https = require('https');
const { URL } = require('url');
const { decryptToken, encryptToken } = require('./shopifyTokenCrypto');

function normalizeStoreUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    return u.origin.replace(/\/$/, '').toLowerCase();
  } catch {
    return '';
  }
}

function getRestCreds(inst) {
  if (!inst.restKeyEncrypted || !inst.restSecretEncrypted) return null;
  try {
    return {
      key: decryptToken(inst.restKeyEncrypted),
      secret: decryptToken(inst.restSecretEncrypted),
    };
  } catch {
    return null;
  }
}

/**
 * HTTPS GET JSON (WooCommerce REST v3)
 */
function httpsJson(method, fullUrl) {
  return new Promise((resolve, reject) => {
    const u = new URL(fullUrl);
    const opts = {
      method,
      hostname: u.hostname,
      port: u.port || 443,
      path: `${u.pathname}${u.search}`,
      headers: { Accept: 'application/json', 'User-Agent': 'NowShipping-WooCommerce/1.0' },
      timeout: 30000,
    };
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let data;
        try {
          data = text ? JSON.parse(text) : {};
        } catch {
          data = { _raw: text };
        }
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          const err = new Error(data.message || data.code || `http_${res.statusCode}`);
          err.statusCode = res.statusCode;
          err.body = data;
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    req.end();
  });
}

function buildWcUrl(origin, path, query) {
  const p = path.startsWith('/') ? path : `/${path}`;
  const base = origin.endsWith('/') ? origin.slice(0, -1) : origin;
  const u = new URL(p, `${base}/`);
  const q = new URLSearchParams(query);
  u.search = q.toString();
  return u.toString();
}

async function wcRestGetOrder(inst, orderId) {
  const creds = getRestCreds(inst);
  if (!creds) return null;
  const path = `/wp-json/wc/v3/orders/${encodeURIComponent(String(orderId))}`;
  const url = buildWcUrl(inst.storeUrl, path, {
    consumer_key: creds.key,
    consumer_secret: creds.secret,
  });
  return httpsJson('GET', url);
}

async function wcRestListOrders(inst, { page = 1, perPage = 50, status = 'any' } = {}) {
  const creds = getRestCreds(inst);
  if (!creds) return { orders: [], totalPages: 0 };
  const path = `/wp-json/wc/v3/orders`;
  const url = buildWcUrl(inst.storeUrl, path, {
    page: String(page),
    per_page: String(perPage),
    status: String(status),
    consumer_key: creds.key,
    consumer_secret: creds.secret,
  });
  const data = await httpsJson('GET', url);
  return { orders: Array.isArray(data) ? data : [], totalPages: 1 };
}

async function wcRestPostOrderNote(inst, orderId, note, customerNote = false) {
  const creds = getRestCreds(inst);
  if (!creds) return null;
  const path = `/wp-json/wc/v3/orders/${encodeURIComponent(String(orderId))}/notes`;
  const u = new URL(path.replace(/^\//, ''), inst.storeUrl.endsWith('/') ? inst.storeUrl : `${inst.storeUrl}/`);
  u.search = new URLSearchParams({
    consumer_key: creds.key,
    consumer_secret: creds.secret,
  }).toString();

  const body = JSON.stringify({
    note: String(note || '').slice(0, 5000),
    customer_note: !!customerNote,
  });

  return new Promise((resolve, reject) => {
    const opts = {
      method: 'POST',
      hostname: u.hostname,
      port: u.port || 443,
      path: `${u.pathname}?${u.search}`,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'NowShipping-WooCommerce/1.0',
      },
      timeout: 30000,
    };
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let data;
        try {
          data = text ? JSON.parse(text) : {};
        } catch {
          data = {};
        }
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) resolve(data);
        else reject(new Error(data.message || `http_${res.statusCode}`));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = {
  normalizeStoreUrl,
  getRestCreds,
  encryptToken,
  decryptToken,
  wcRestGetOrder,
  wcRestListOrders,
  wcRestPostOrderNote,
};
