/**
 * Verifies Shopify Admin embedded session token (JWT) from App Bridge.
 * Expects: Authorization: Bearer <session_token>
 *
 * @see https://shopify.dev/docs/apps/auth/session-tokens
 */

const jwt = require('jsonwebtoken');
const ShopifyInstallation = require('../models/shopifyInstallation');

function shopDomainFromPayload(payload) {
  const dest = payload.dest != null ? String(payload.dest) : '';
  if (dest) {
    const match = /([a-z0-9][a-z0-9-]*\.myshopify\.com)/i.exec(dest);
    if (match) return match[1].toLowerCase();
  }

  const iss = payload.iss != null ? String(payload.iss) : '';
  if (iss) {
    const match = /([a-z0-9][a-z0-9-]*\.myshopify\.com)/i.exec(iss);
    if (match) return match[1].toLowerCase();
  }

  return '';
}

/**
 * Express middleware — attaches `req.shopifyInstallation` and `req.shopifyShopDomain`.
 * Accepts App Bridge session tokens and Admin UI extension OpenID Connect ID tokens.
 */
async function verifyShopifySessionToken(req, res, next) {
  const apiSecret = process.env.SHOPIFY_API_SECRET;
  const apiKey = process.env.SHOPIFY_API_KEY;
  if (!apiSecret || !apiKey) {
    return res.status(500).json({ error: 'server_misconfigured' });
  }

  const auth = req.get('Authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  if (!m) {
    return res.status(401).json({ error: 'missing_session_token' });
  }
  const token = m[1];

  let payload;
  try {
    payload = jwt.verify(token, apiSecret, {
      algorithms: ['HS256'],
      audience: apiKey,
      clockTolerance: 10,
    });
  } catch {
    try {
      payload = jwt.verify(token, apiSecret, {
        algorithms: ['HS256'],
        clockTolerance: 10,
      });
      const aud = payload.aud;
      const audOk =
        aud === apiKey ||
        (Array.isArray(aud) && aud.includes(apiKey));
      if (!audOk) {
        return res.status(401).json({ error: 'invalid_session_token' });
      }
    } catch {
      return res.status(401).json({ error: 'invalid_session_token' });
    }
  }

  const shopDomain = shopDomainFromPayload(payload);
  if (!shopDomain || !shopDomain.endsWith('.myshopify.com')) {
    return res.status(401).json({ error: 'invalid_shop_in_token' });
  }

  try {
    const installation = await ShopifyInstallation.findOne({
      shopDomain,
      uninstalledAt: null,
    });
    if (!installation || !installation.accessTokenEncrypted) {
      return res.status(403).json({ error: 'shop_not_connected' });
    }

    req.shopifyShopDomain = shopDomain;
    req.shopifySessionPayload = payload;
    req.shopifyInstallation = installation;
    return next();
  } catch (err) {
    console.error('[shopifySessionToken] DB:', err.message || err);
    return res.status(500).json({ error: 'lookup_failed' });
  }
}

module.exports = { verifyShopifySessionToken };
