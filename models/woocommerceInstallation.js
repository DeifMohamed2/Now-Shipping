const mongoose = require('mongoose');

/**
 * One WooCommerce store linked to one Now business (pairing + plugin install).
 */
const woocommerceInstallationSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      required: true,
      index: true,
    },
    /** Normalized site origin, e.g. https://shop.example.com (no trailing slash) */
    storeUrl: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
      lowercase: true,
    },
    /** SHA-256 HMAC digest of installation bearer token (see utils/woocommerceAuth.js) */
    installationTokenDigest: {
      type: String,
      required: true,
      index: true,
    },
    /** AES-GCM ciphertext for shared HMAC secret (plugin ↔ Now) */
    sharedSecretEncrypted: {
      type: String,
      required: true,
    },
    /** WooCommerce REST consumer key (Read) — optional until plugin registers keys */
    restKeyEncrypted: {
      type: String,
      default: null,
    },
    /** WooCommerce REST consumer secret */
    restSecretEncrypted: {
      type: String,
      default: null,
    },
    installedAt: {
      type: Date,
      default: Date.now,
    },
    uninstalledAt: {
      type: Date,
      default: null,
    },
    lastWebhookAt: {
      type: Date,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    expressShippingPatterns: {
      type: [String],
      default: () => ['express', 'سريع', 'fast'],
    },
    wcVersion: { type: String, default: '' },
    phpVersion: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('WoocommerceInstallation', woocommerceInstallationSchema);
