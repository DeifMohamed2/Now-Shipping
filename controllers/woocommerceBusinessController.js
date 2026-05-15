const crypto = require('crypto');
const WoocommercePairingGrant = require('../models/woocommercePairingGrant');
const WoocommerceInstallation = require('../models/woocommerceInstallation');
const { pairingSecretDigest } = require('../utils/woocommerceAuth');
const { encryptToken } = require('../utils/shopifyTokenCrypto');

function randomSecret() {
  const buf = crypto.randomBytes(24);
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/**
 * POST /business/woocommerce/pairing (JSON)
 */
async function postPairing(req, res) {
  try {
    const business = req.userData._id;
    const publicCode = `nsw_${crypto.randomBytes(16).toString('hex')}`;
    const secret = randomSecret();
    const secretDigest = pairingSecretDigest(secret);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await WoocommercePairingGrant.create({
      business,
      publicCode,
      secretDigest,
      expiresAt,
    });

    return res.json({
      ok: true,
      publicCode,
      secret,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err) {
    console.error('[woocommerceBusiness] pairing:', err.message || err);
    return res.status(500).json({ error: 'pairing_failed' });
  }
}

/**
 * POST /business/woocommerce/disconnect (JSON or form)
 */
async function postDisconnect(req, res) {
  try {
    const business = req.userData._id;
    await WoocommerceInstallation.updateMany(
      { business, uninstalledAt: null },
      {
        $set: {
          uninstalledAt: new Date(),
          isActive: false,
          installationTokenDigest: `uninstalled_${crypto.randomBytes(16).toString('hex')}`,
          sharedSecretEncrypted: encryptToken('revoked'),
          restKeyEncrypted: null,
          restSecretEncrypted: null,
        },
      }
    );
    return res.redirect(302, '/business/settings?wooDisconnected=1');
  } catch (err) {
    console.error('[woocommerceBusiness] disconnect:', err.message || err);
    return res.status(500).json({ error: 'disconnect_failed' });
  }
}

module.exports = { postPairing, postDisconnect };
