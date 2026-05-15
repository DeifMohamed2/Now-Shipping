const crypto = require('crypto');
const WoocommercePairingGrant = require('../models/woocommercePairingGrant');
const WoocommerceInstallation = require('../models/woocommerceInstallation');
const { pairingSecretDigest, installationTokenDigest } = require('../utils/woocommerceAuth');
const { encryptToken } = require('../utils/shopifyTokenCrypto');
const { normalizeStoreUrl } = require('../utils/woocommerceService');

/**
 * POST /api/woocommerce/connect (public — validated via pairing code)
 */
async function postConnect(req, res) {
  try {
    const { publicCode, secret, storeUrl, wcVersion, phpVersion } = req.body || {};
    if (!publicCode || !secret || !storeUrl) {
      return res.status(400).json({ error: 'public_code_secret_and_store_url_required' });
    }
    const urlNorm = normalizeStoreUrl(storeUrl);
    if (!urlNorm) {
      return res.status(400).json({ error: 'invalid_store_url' });
    }

    const digest = pairingSecretDigest(String(secret));
    const grant = await WoocommercePairingGrant.findOne({
      publicCode: String(publicCode).trim(),
      secretDigest: digest,
      consumedAt: null,
    });

    if (!grant || grant.expiresAt < new Date()) {
      return res.status(401).json({ error: 'invalid_or_expired_pairing' });
    }

    const installationToken = crypto.randomBytes(32).toString('hex');
    const sharedSecret = crypto.randomBytes(32).toString('hex');
    const tokenDigest = installationTokenDigest(installationToken);
    const sharedEnc = encryptToken(sharedSecret);

    await WoocommerceInstallation.updateMany(
      { business: grant.business, uninstalledAt: null, storeUrl: { $ne: urlNorm } },
      {
        $set: {
          uninstalledAt: new Date(),
          isActive: false,
        },
      }
    );

    await WoocommerceInstallation.findOneAndUpdate(
      { storeUrl: urlNorm },
      {
        $set: {
          business: grant.business,
          storeUrl: urlNorm,
          installationTokenDigest: tokenDigest,
          sharedSecretEncrypted: sharedEnc,
          uninstalledAt: null,
          isActive: true,
          installedAt: new Date(),
          wcVersion: wcVersion != null ? String(wcVersion).slice(0, 32) : '',
          phpVersion: phpVersion != null ? String(phpVersion).slice(0, 32) : '',
        },
      },
      { upsert: true, new: true }
    );

    grant.consumedAt = new Date();
    await grant.save();

    const rawBase = process.env.APP_URL || process.env.HOST || 'https://now.com.eg';
    const apiBaseUrl = String(rawBase).replace(/\/$/, '');

    return res.json({
      ok: true,
      installationToken,
      sharedSecret,
      apiBaseUrl,
    });
  } catch (err) {
    console.error('[woocommercePublic] connect:', err.message || err);
    return res.status(500).json({ error: 'connect_failed' });
  }
}

module.exports = { postConnect };
