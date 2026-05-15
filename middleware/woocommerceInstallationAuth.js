const WoocommerceInstallation = require('../models/woocommerceInstallation');
const { installationTokenDigest } = require('../utils/woocommerceAuth');
const { decryptToken } = require('../utils/shopifyTokenCrypto');

/**
 * Validates `Authorization: Bearer <installationToken>` and loads active installation.
 */
async function verifyWoocommerceInstallation(req, res, next) {
  const auth = req.get('Authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  if (!m) {
    return res.status(401).json({ error: 'missing_bearer_token' });
  }
  const token = m[1];
  const digest = installationTokenDigest(token);
  try {
    const inst = await WoocommerceInstallation.findOne({
      installationTokenDigest: digest,
      uninstalledAt: null,
    });
    if (!inst) {
      return res.status(401).json({ error: 'invalid_installation' });
    }
    let sharedSecret = '';
    try {
      sharedSecret = decryptToken(inst.sharedSecretEncrypted);
    } catch {
      return res.status(500).json({ error: 'server_misconfigured' });
    }
    if (!sharedSecret) {
      return res.status(401).json({ error: 'invalid_installation' });
    }
    req.wcInstallation = inst;
    req.wcSharedSecret = sharedSecret;
    return next();
  } catch (err) {
    console.error('[verifyWoocommerceInstallation]', err.message || err);
    return res.status(500).json({ error: 'lookup_failed' });
  }
}

module.exports = { verifyWoocommerceInstallation };
