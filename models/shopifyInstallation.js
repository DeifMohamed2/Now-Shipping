const mongoose = require('mongoose');

/**
 * One Shopify store linked to one Now business account (dashboard-first install).
 */
const shopifyInstallationSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      required: true,
      index: true,
    },
    shopDomain: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
    },
    shopifyShopId: {
      type: String,
      required: false,
    },
    /** AES-GCM ciphertext (see utils/shopifyTokenCrypto.js) */
    accessTokenEncrypted: {
      type: String,
      required: true,
    },
    /** AES-GCM ciphertext for the refresh token (expiring offline tokens only) */
    refreshTokenEncrypted: {
      type: String,
      default: null,
    },
    /** UTC timestamp when the access_token expires (null = non-expiring / unknown) */
    accessTokenExpiresAt: {
      type: Date,
      default: null,
    },
    /** UTC timestamp when the refresh_token expires (null = non-expiring / unknown) */
    refreshTokenExpiresAt: {
      type: Date,
      default: null,
    },
    scopes: {
      type: String,
      required: false,
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
    /** When false, webhooks are acknowledged but orders are not imported (embedded app toggle). */
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    /** Substrings matched case-insensitively against shipping_lines[].title (and code) for express */
    expressShippingPatterns: {
      type: [String],
      default: () => ['express', 'سريع', 'fast'],
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ShopifyInstallation', shopifyInstallationSchema);
