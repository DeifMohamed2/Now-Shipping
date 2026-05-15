const mongoose = require('mongoose');

/**
 * One-time pairing code shown in Now dashboard; consumed when the WP plugin connects.
 */
const woocommercePairingGrantSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      required: true,
      index: true,
    },
    publicCode: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
    },
    /** HMAC digest of the one-time secret (never store plaintext secret). */
    secretDigest: {
      type: String,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    consumedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('WoocommercePairingGrant', woocommercePairingGrantSchema);
