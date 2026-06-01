/**
 * Shopify Admin integration using @shopify/shopify-api (HMAC + webhook validation).
 * OAuth token exchange stays as fetch — our dashboard-first flow uses signed `state`, not SDK cookies.
 * Adapter must load before shopifyApi(); app.js also requires it early — duplicate require is cached.
 */
require('@shopify/shopify-api/adapters/node');

const { shopifyApi, ApiVersion } = require('@shopify/shopify-api');

let shopifySingleton;

function parseScopes() {
  const raw = process.env.SHOPIFY_SCOPES || 'read_orders,read_customers';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Map SHOPIFY_API_VERSION string to SDK enum (defaults to 2026-04). */
function resolveApiVersionEnum() {
  const env = (process.env.SHOPIFY_API_VERSION || '2026-04').trim();
  const map = {
    '2024-10': ApiVersion.October24,
    '2025-01': ApiVersion.January25,
    '2025-04': ApiVersion.April25,
    '2025-07': ApiVersion.July25,
    '2025-10': ApiVersion.October25,
    '2026-01': ApiVersion.January26,
    '2026-04': ApiVersion.April26,
  };
  return map[env] || ApiVersion.April26;
}

/** Admin API version string for REST URLs (webhook registration). */
function apiVersion() {
  return resolveApiVersionEnum();
}

/** Same version as `apiVersion()` but as a plain string for fetch URLs. */
function adminApiVersionString() {
  return (process.env.SHOPIFY_API_VERSION || '2026-04').trim();
}

/**
 * Parse Shopify `Link` header for cursor pagination (orders.json).
 * @param {string|null|undefined} linkHeader
 * @returns {{ next: string | null, prev: string | null }}
 */
function parseShopifyLinkPageInfo(linkHeader) {
  const h = String(linkHeader || '');
  if (!h) return { next: null, prev: null };
  const out = { next: null, prev: null };
  const segments = h.split(',');
  for (const seg of segments) {
    const m = seg.trim().match(/^<([^>]+)>\s*;\s*rel="(previous|next)"/);
    if (!m) continue;
    try {
      const u = new URL(m[1]);
      const pi = u.searchParams.get('page_info');
      if (m[2] === 'next') out.next = pi;
      if (m[2] === 'previous') out.prev = pi;
    } catch (_) {
      /* ignore */
    }
  }
  return out;
}

/**
 * List orders from Shopify REST Admin API (cursor pagination).
 * @param {string} shopDomain
 * @param {string} accessToken
 * @param {{ status?: string, limit?: number, fields?: string, pageInfo?: string, name?: string }} [opts]
 * @returns {Promise<{ orders: any[], nextCursor: string | null, prevCursor: string | null }>}
 */
async function shopifyRestListOrders(shopDomain, accessToken, opts = {}) {
  const v = adminApiVersionString();
  const limit = Math.min(250, Math.max(1, Number(opts.limit) || 50));
  const fields =
    opts.fields ||
    'id,name,note,created_at,financial_status,fulfillment_status,shipping_address,line_items,shipping_lines,total_price,currency,customer,tags,payment_gateway_names,cancelled_at,total_outstanding';

  const qs = new URLSearchParams();
  qs.set('limit', String(limit));
  qs.set('fields', fields);

  if (opts.pageInfo) {
    qs.set('page_info', String(opts.pageInfo));
  } else {
    qs.set('status', opts.status && String(opts.status).trim() ? String(opts.status).trim() : 'any');
    if (opts.name && String(opts.name).trim()) {
      qs.set('name', String(opts.name).trim());
    }
  }

  const url = `https://${shopDomain}/admin/api/${v}/orders.json?${qs.toString()}`;
  const res = await fetch(url, {
    headers: {
      'X-Shopify-Access-Token': accessToken,
      Accept: 'application/json',
    },
  });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { _parseError: text.slice(0, 300) };
  }
  const link = res.headers.get('link') || res.headers.get('Link') || '';
  const cursors = parseShopifyLinkPageInfo(link);
  if (!res.ok) {
    const err = new Error(`Shopify orders list failed: ${res.status} ${text.slice(0, 500)}`);
    err.status = res.status;
    err.shopifyBody = json;
    throw err;
  }
  return {
    orders: Array.isArray(json.orders) ? json.orders : [],
    nextCursor: cursors.next,
    prevCursor: cursors.prev,
  };
}

/**
 * @param {string} shopDomain
 * @param {string} accessToken
 * @param {string|number} orderId
 */
async function shopifyRestGetOrder(shopDomain, accessToken, orderId) {
  const v = adminApiVersionString();
  const url = `https://${shopDomain}/admin/api/${v}/orders/${encodeURIComponent(String(orderId))}.json`;
  const res = await fetch(url, {
    headers: {
      'X-Shopify-Access-Token': accessToken,
      Accept: 'application/json',
    },
  });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }
  if (!res.ok) {
    const err = new Error(`Shopify order fetch failed: ${res.status} ${text.slice(0, 500)}`);
    err.status = res.status;
    throw err;
  }
  return json.order || null;
}

/** Matches production host in [shopify.app.toml]; used only when APP_URL/HOST are unset in production. */
const DEFAULT_PRODUCTION_APP_ORIGIN = 'https://now.com.eg';

function resolveAppUrlString() {
  const fromEnv = process.env.APP_URL || process.env.HOST;
  if (fromEnv) {
    return String(fromEnv).trim().replace(/\/$/, '');
  }
  if (process.env.NODE_ENV === 'production') {
    console.warn(
      '[Shopify] APP_URL is unset; using',
      DEFAULT_PRODUCTION_APP_ORIGIN,
      '(set APP_URL in .env to your public origin, no trailing slash)'
    );
    return DEFAULT_PRODUCTION_APP_ORIGIN;
  }
  const port = process.env.PORT || 3000;
  return `http://localhost:${port}`.replace(/\/$/, '');
}

function getAppHostnameAndScheme() {
  const normalized = resolveAppUrlString();
  try {
    const parsed = new URL(normalized.includes('://') ? normalized : `https://${normalized}`);
    return {
      hostName: parsed.hostname,
      hostScheme: parsed.protocol === 'http:' ? 'http' : 'https',
    };
  } catch {
    return { hostName: 'localhost', hostScheme: 'http' };
  }
}

/**
 * Public origin (no path, no trailing slash) for OAuth redirect_base, webhook registration, and SDK host.
 * Must match [shopify.app.toml] application_url host and Partner Dashboard.
 * Set APP_URL in .env (e.g. https://now.com.eg). In production, falls back to now.com.eg if unset.
 */
function getAppUrl() {
  return resolveAppUrlString();
}

/**
 * Lazily configured shopifyApi instance (matches APP_URL host + env scopes/version).
 */
function getShopify() {
  if (!shopifySingleton) {
    const apiSecretKey = process.env.SHOPIFY_API_SECRET;
    if (!apiSecretKey) {
      throw new Error('SHOPIFY_API_SECRET is required');
    }
    const { hostName, hostScheme } = getAppHostnameAndScheme();
    const scopes = parseScopes();
    shopifySingleton = shopifyApi({
      apiKey: process.env.SHOPIFY_API_KEY,
      apiSecretKey,
      scopes,
      hostName,
      hostScheme,
      apiVersion: resolveApiVersionEnum(),
      isEmbeddedApp: process.env.SHOPIFY_EMBEDDED_APP !== 'false',
    });
  }
  return shopifySingleton;
}

/**
 * Verify OAuth callback query (Shopify redirects after merchant approves scopes).
 * @param {Record<string, unknown>} query - req.query
 */
async function verifyOAuthQuery(query) {
  try {
    if (!query || !query.hmac) return false;
    const shopify = getShopify();
    return shopify.utils.validateHmac(query, { signator: 'admin' });
  } catch (err) {
    console.error('[Shopify] OAuth HMAC validation:', err.message || err);
    return false;
  }
}

/**
 * Verify webhook using SDK (raw body must match Express raw buffer + headers on req).
 */
async function verifyWebhookRequest(req) {
  try {
    const shopify = getShopify();
    const raw = req.body;
    const rawBodyStr = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || '');
    const result = await shopify.webhooks.validate({
      rawBody: rawBodyStr,
      rawRequest: req,
    });
    return result.valid === true;
  } catch (err) {
    console.error('[Shopify] Webhook validation:', err.message || err);
    return false;
  }
}

/**
 * Exchange the OAuth authorization code for an expiring offline access token.
 * Passing expiring=1 requests the new token format (access_token + refresh_token).
 * Shopify now REQUIRES expiring tokens for public apps as of April 2026.
 */
async function exchangeAccessToken(shopDomain, code, clientId, clientSecret) {
  const url = `https://${shopDomain}/admin/oauth/access_token`;
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    expiring: '1',
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: params.toString(),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Shopify token exchange failed: ${res.status} ${t}`);
  }
  return res.json();
}

/**
 * Refresh an expired offline access token using the refresh_token.
 * Returns the raw token JSON from Shopify (access_token, expires_in, refresh_token, …).
 */
async function refreshAccessToken(shopDomain, refreshToken) {
  const clientId = process.env.SHOPIFY_API_KEY;
  const clientSecret = process.env.SHOPIFY_API_SECRET;
  const url = `https://${shopDomain}/admin/oauth/access_token`;
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: params.toString(),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Shopify token refresh failed: ${res.status} ${t}`);
  }
  return res.json();
}

/**
 * Returns a valid (non-expired) access token for the given ShopifyInstallation document.
 * If the token has expired (or is about to expire within 5 minutes) it will be refreshed
 * automatically using the stored refresh token and the installation record will be updated.
 *
 * @param {import('../models/shopifyInstallation')} installation  Mongoose document
 * @returns {Promise<string>} Plain-text access token ready to use in API headers
 */
async function getValidAccessToken(installation) {
  const { decryptToken, encryptToken } = require('./shopifyTokenCrypto');
  const BUFFER_MS = 5 * 60 * 1000; // refresh 5 minutes before expiry

  const accessToken = decryptToken(installation.accessTokenEncrypted);

  // If no expiry stored (legacy non-expiring token or first run), just return it.
  if (!installation.accessTokenExpiresAt) {
    return accessToken;
  }

  const expiresAt = new Date(installation.accessTokenExpiresAt).getTime();
  if (Date.now() + BUFFER_MS < expiresAt) {
    return accessToken;
  }

  // Token is expired or about to expire – try to refresh.
  const refreshToken = decryptToken(installation.refreshTokenEncrypted || '');
  if (!refreshToken) {
    throw new Error(
      `Shopify access token expired for ${installation.shopDomain} and no refresh token is stored. ` +
        'The merchant must reconnect their Shopify store.'
    );
  }

  console.log(`[Shopify] Refreshing access token for ${installation.shopDomain}…`);
  const tokenJson = await refreshAccessToken(installation.shopDomain, refreshToken);

  const newAccessToken = tokenJson.access_token;
  const newExpiresAt = tokenJson.expires_in
    ? new Date(Date.now() + Number(tokenJson.expires_in) * 1000)
    : null;
  const newRefreshToken = tokenJson.refresh_token || refreshToken;
  const newRefreshExpiresAt = tokenJson.refresh_token_expires_in
    ? new Date(Date.now() + Number(tokenJson.refresh_token_expires_in) * 1000)
    : installation.refreshTokenExpiresAt;

  // Persist the new token pair.
  installation.accessTokenEncrypted = encryptToken(newAccessToken);
  installation.accessTokenExpiresAt = newExpiresAt;
  installation.refreshTokenEncrypted = encryptToken(newRefreshToken);
  installation.refreshTokenExpiresAt = newRefreshExpiresAt;
  await installation.save();

  console.log(`[Shopify] Token refreshed for ${installation.shopDomain}, expires at ${newExpiresAt}.`);
  return newAccessToken;
}

const querystring = require('querystring');

function authorizeRedirectUrl(shopDomain, clientId, scopes, redirectUri, state) {
  const q = querystring.stringify({
    client_id: clientId,
    scope: scopes,
    redirect_uri: redirectUri,
    state,
  });
  return `https://${shopDomain}/admin/oauth/authorize?${q}`;
}

/**
 * Classify webhook registration failure for UX / redirects.
 * @param {number} status
 * @param {string} text Raw response body
 * @returns {'protected_data_pending' | 'other'}
 */
function classifyWebhookRegisterFailure(status, text) {
  const t = String(text || '').toLowerCase();
  if (status === 403 && t.includes('protected customer data')) {
    return 'protected_data_pending';
  }
  return 'other';
}

function normalizeWebhookAddress(u) {
  return String(u || '')
    .trim()
    .replace(/\/$/, '');
}

/** List REST webhooks (used to avoid duplicate POST 422). */
async function listWebhooks(shopDomain, accessToken) {
  const version = apiVersion();
  const url = `https://${shopDomain}/admin/api/${version}/webhooks.json?limit=250`;
  const res = await fetch(url, {
    headers: { 'X-Shopify-Access-Token': accessToken },
  });
  const text = await res.text();
  if (!res.ok) {
    console.error('[Shopify] listWebhooks failed:', res.status, text);
    return [];
  }
  try {
    const data = JSON.parse(text);
    return Array.isArray(data.webhooks) ? data.webhooks : [];
  } catch {
    return [];
  }
}

/** Register REST webhooks after install */
async function registerWebhooks(shopDomain, accessToken, webhookBaseUrl) {
  const version = apiVersion();
  const topics = [
    'orders/create',
    'orders/updated',
    'app/uninstalled',
    'customers/data_request',
    'customers/redact',
    'shop/redact',
  ];
  const address = `${webhookBaseUrl.replace(/\/$/, '')}/api/shopify/webhooks`;
  const addressNorm = normalizeWebhookAddress(address);
  const results = [];

  let existing = [];
  try {
    existing = await listWebhooks(shopDomain, accessToken);
  } catch (err) {
    console.error('[Shopify] listWebhooks:', err.message || err);
  }

  for (const topic of topics) {
    const duplicate = existing.some(
      (w) => w.topic === topic && normalizeWebhookAddress(w.address) === addressNorm
    );
    if (duplicate) {
      console.log(`[Shopify] Webhook already exists: ${topic}`);
      results.push({ topic, ok: true, skipped: 'already_exists' });
      continue;
    }

    const url = `https://${shopDomain}/admin/api/${version}/webhooks.json`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify({
        webhook: {
          topic,
          address,
          format: 'json',
        },
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      const dup422 = res.status === 422 && String(text).includes('already been taken');
      if (dup422) {
        console.log(`[Shopify] Webhook already registered: ${topic} (duplicate)`);
        results.push({ topic, ok: true, skipped: 'duplicate' });
        continue;
      }
      const reason = classifyWebhookRegisterFailure(res.status, text);
      console.error(`Shopify webhook register failed ${topic}:`, res.status, text);
      results.push({ topic, ok: false, status: res.status, reason });
    } else {
      console.log(`[Shopify] Webhook registered: ${topic}`);
      results.push({ topic, ok: true });
    }
  }
  return results;
}

module.exports = {
  apiVersion,
  adminApiVersionString,
  parseShopifyLinkPageInfo,
  shopifyRestListOrders,
  shopifyRestGetOrder,
  getAppUrl,
  getShopify,
  verifyOAuthQuery,
  verifyWebhookRequest,
  exchangeAccessToken,
  refreshAccessToken,
  getValidAccessToken,
  authorizeRedirectUrl,
  registerWebhooks,
};
