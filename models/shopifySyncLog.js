const mongoose = require('mongoose');

const MAX_PAYLOAD_BYTES = 50 * 1024;

/**
 * Audit trail for Shopify webhook processing (embedded app sync log + retry queue).
 */
const shopifySyncLogSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      required: false,
      index: true,
    },
    shopDomain: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    shopifyOrderId: {
      type: String,
      required: false,
      default: '',
    },
    shopifyOrderName: {
      type: String,
      required: false,
      default: '',
    },
    topic: {
      type: String,
      required: true,
      enum: ['orders/create', 'orders/updated', 'app/uninstalled', 'manual/import', 'customers/data_request', 'customers/redact', 'shop/redact'],
    },
    status: {
      type: String,
      required: true,
      enum: ['success', 'skipped', 'failed'],
      index: true,
    },
    reason: {
      type: String,
      required: false,
      default: '',
    },
    nowOrderNumber: {
      type: String,
      required: false,
      default: '',
    },
    retryCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastRetryAt: {
      type: Date,
      default: null,
    },
    /** Subset of webhook JSON for retries (capped when saved) */
    payload: {
      type: mongoose.Schema.Types.Mixed,
      required: false,
      default: undefined,
    },
  },
  { timestamps: true }
);

shopifySyncLogSchema.index({ business: 1, createdAt: -1 });
shopifySyncLogSchema.index({ status: 1, retryCount: 1, topic: 1 });

/** Cap stored payload for MongoDB + retry use */
function capPayloadForStorage(obj) {
  if (obj == null) return undefined;
  try {
    const s = JSON.stringify(obj);
    if (Buffer.byteLength(s, 'utf8') <= MAX_PAYLOAD_BYTES) return obj;
    const truncated = `${s.slice(0, MAX_PAYLOAD_BYTES - 80)}…[truncated]`;
    return JSON.parse(truncated);
  } catch {
    return undefined;
  }
}

module.exports = mongoose.model('ShopifySyncLog', shopifySyncLogSchema);
module.exports.capPayloadForStorage = capPayloadForStorage;
module.exports.MAX_PAYLOAD_BYTES = MAX_PAYLOAD_BYTES;
