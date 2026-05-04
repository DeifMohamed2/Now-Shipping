const crypto = require('crypto');
const User = require('../models/user');
const ShopifyInstallation = require('../models/shopifyInstallation');
const { encryptToken } = require('../utils/shopifyTokenCrypto');
const {
  getAppUrl,
  verifyOAuthQuery,
  exchangeAccessToken,
  authorizeRedirectUrl,
  registerWebhooks,
  getValidAccessToken,
} = require('../utils/shopifyService');

function normalizeShopInput(input) {
  let s = String(input || '').trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/^https?:\/\//, '').split('/')[0];
  if (!s.includes('.')) s = `${s}.myshopify.com`;
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(s)) return '';
  return s;
}

function signShopifyState(userId) {
  const payload = Buffer.from(
    JSON.stringify({
      uid: String(userId),
      ts: Date.now(),
      n: crypto.randomBytes(8).toString('hex'),
    })
  ).toString('base64url');
  const secret = process.env.SHOPIFY_STATE_SECRET || process.env.JWT_SECRET || 'nodedemo';
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyShopifyState(stateStr) {
  const secret = process.env.SHOPIFY_STATE_SECRET || process.env.JWT_SECRET || 'nodedemo';
  const parts = String(stateStr || '').split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!data.uid || !data.ts) return null;
  if (Date.now() - Number(data.ts) > 20 * 60 * 1000) return null;
  return data;
}

/**
 * GET /business/shopify/install?shop=store.myshopify.com
 */
const redirectToShopifyOAuth = async (req, res) => {
  try {
    const clientId = process.env.SHOPIFY_API_KEY;
    const scopes = process.env.SHOPIFY_SCOPES || 'read_orders,read_customers';
    const shop = normalizeShopInput(req.query.shop);
    if (!clientId || !process.env.SHOPIFY_API_SECRET) {
      return res.status(500).send('Shopify app credentials are not configured (SHOPIFY_API_KEY / SHOPIFY_API_SECRET).');
    }
    if (!shop) {
      return res.redirect('/business/settings?shopifyError=' + encodeURIComponent('Enter your store domain (e.g. my-store.myshopify.com).'));
    }

    const state = signShopifyState(req.userData._id);
    const redirectUri = `${getAppUrl()}/api/shopify/auth/callback`;
    const url = authorizeRedirectUrl(shop, clientId, scopes, redirectUri, state);
    res.redirect(url);
  } catch (err) {
    console.error('redirectToShopifyOAuth:', err);
    res.redirect('/business/settings?shopifyError=oauth_start_failed');
  }
};

/**
 * GET /api/shopify/auth/callback — OAuth completion (public).
 */
const oauthCallback = async (req, res) => {
  try {
    const apiSecret = process.env.SHOPIFY_API_SECRET;
    const clientId = process.env.SHOPIFY_API_KEY;
    if (!(await verifyOAuthQuery(req.query))) {
      return res.status(400).send('Invalid OAuth HMAC');
    }

    const { shop, code, state } = req.query;
    if (!shop || !code) {
      return res.status(400).send('Missing shop or code');
    }

    const st = verifyShopifyState(state);
    if (!st) {
      return res.status(400).send('Invalid or expired state');
    }

    const user = await User.findById(st.uid);
    if (!user) {
      return res.redirect('/login');
    }

    const shopDomain = normalizeShopInput(shop) || String(shop).toLowerCase().trim();
    if (!shopDomain || !shopDomain.endsWith('.myshopify.com')) {
      return res.status(400).send('Invalid shop domain');
    }

    const tokenJson = await exchangeAccessToken(shopDomain, code, clientId, apiSecret);
    const accessToken = tokenJson.access_token;
    const scopes = tokenJson.scope || '';

    if (!accessToken) {
      throw new Error('No access_token returned from Shopify. Check your app credentials.');
    }

    const enc = encryptToken(accessToken);

    // Expiring token fields (present when expiring=1 was requested).
    const accessTokenExpiresAt = tokenJson.expires_in
      ? new Date(Date.now() + Number(tokenJson.expires_in) * 1000)
      : null;
    const refreshTokenEncrypted = tokenJson.refresh_token
      ? encryptToken(tokenJson.refresh_token)
      : null;
    const refreshTokenExpiresAt = tokenJson.refresh_token_expires_in
      ? new Date(Date.now() + Number(tokenJson.refresh_token_expires_in) * 1000)
      : null;

    await ShopifyInstallation.updateMany(
      { business: user._id, uninstalledAt: null },
      { $set: { uninstalledAt: new Date() } }
    );

    const installation = await ShopifyInstallation.findOneAndUpdate(
      { shopDomain },
      {
        $set: {
          business: user._id,
          shopDomain,
          accessTokenEncrypted: enc,
          accessTokenExpiresAt,
          ...(refreshTokenEncrypted && { refreshTokenEncrypted }),
          ...(refreshTokenExpiresAt && { refreshTokenExpiresAt }),
          scopes,
          installedAt: new Date(),
          uninstalledAt: null,
          isActive: true,
        },
      },
      { upsert: true, new: true }
    );

    // Use getValidAccessToken so future calls auto-refresh — for webhook registration
    // we just received a fresh token so it will still be valid.
    const validToken = await getValidAccessToken(installation);
    const hookResults = await registerWebhooks(shopDomain, validToken, getAppUrl());
    const protectedDataPending = hookResults.some((r) => r.reason === 'protected_data_pending');

    let redirectUrl = '/business/settings?shopifyConnected=1';
    if (protectedDataPending) {
      redirectUrl += '&shopifyWarning=protected_data_pending';
    }
    res.redirect(redirectUrl);
  } catch (err) {
    console.error('oauthCallback:', err && err.stack ? err.stack : err);
    res.redirect('/business/settings?shopifyError=' + encodeURIComponent(err.message || 'callback_failed'));
  }
};

/**
 * POST /business/shopify/disconnect
 */
const disconnectShopify = async (req, res) => {
  try {
    await ShopifyInstallation.updateMany(
      { business: req.userData._id, uninstalledAt: null },
      { $set: { uninstalledAt: new Date(), accessTokenEncrypted: '' } }
    );
    const wantsJson =
      req.xhr ||
      (req.headers.accept && req.headers.accept.includes('application/json')) ||
      req.headers['content-type'] === 'application/json';
    if (wantsJson) {
      return res.json({ ok: true });
    }
    res.redirect('/business/settings?shopifyDisconnected=1');
  } catch (err) {
    console.error('disconnectShopify:', err);
    res.status(500).json({ ok: false });
  }
};

module.exports = {
  normalizeShopInput,
  redirectToShopifyOAuth,
  oauthCallback,
  disconnectShopify,
};
