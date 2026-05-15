const crypto = require('crypto');
const WoocommerceInstallation = require('../models/woocommerceInstallation');
const { decryptToken } = require('../utils/shopifyTokenCrypto');
const { verifyHmacHex, verifyTimestampHeader } = require('../utils/woocommerceAuth');
const { normalizeStoreUrl } = require('../utils/woocommerceService');
const { syncWcOrderCreate, syncWcOrderUpdated, markPluginUninstalled } = require('../utils/woocommerceOrderSync');

function rawBodyString(req) {
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  if (typeof req.body === 'string') return req.body;
  return '';
}

/**
 * POST /api/woocommerce/webhooks
 * Body: JSON { storeUrl, order } — signed with installation shared secret.
 */
async function handleWebhook(req, res) {
  const raw = rawBodyString(req);
  let payload;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    return res.status(400).json({ error: 'invalid_json' });
  }

  const topic = String(req.get('X-Now-Topic') || '').trim();
  if (!topic) {
    return res.status(400).json({ error: 'missing_topic' });
  }

  if (!verifyTimestampHeader(req.get('X-Now-Timestamp'))) {
    return res.status(401).json({ error: 'invalid_timestamp' });
  }

  const storeUrl = normalizeStoreUrl(payload.storeUrl);
  if (!storeUrl) {
    return res.status(400).json({ error: 'missing_store_url' });
  }

  const inst = await WoocommerceInstallation.findOne({ storeUrl, uninstalledAt: null });
  if (!inst) {
    return res.status(404).json({ error: 'unknown_store' });
  }

  let secret;
  try {
    secret = decryptToken(inst.sharedSecretEncrypted);
  } catch {
    return res.status(500).json({ error: 'server_misconfigured' });
  }

  const sig = req.get('X-Now-Signature') || '';
  if (!verifyHmacHex(secret, raw, sig)) {
    return res.status(401).json({ error: 'invalid_signature' });
  }

  if (topic === 'app/uninstalled') {
    await markPluginUninstalled(storeUrl);
    return res.status(200).json({ ok: true });
  }

  const order = payload.order;
  if (!order || typeof order !== 'object') {
    return res.status(400).json({ error: 'missing_order' });
  }

  try {
    if (topic === 'orders/create') {
      await syncWcOrderCreate(storeUrl, order);
      return res.status(200).json({ ok: true });
    }
    if (topic === 'orders/updated') {
      await syncWcOrderUpdated(storeUrl, order);
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: 'unknown_topic' });
  } catch (err) {
    console.error('[woocommerceWebhook]', err.message || err);
    return res.status(500).json({ error: 'processing_failed' });
  }
}

module.exports = { handleWebhook };
