const mongoose = require('mongoose');

const MAX_PAYLOAD_BYTES = 50 * 1024;

const woocommerceSyncLogSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      required: false,
      index: true,
    },
    storeUrl: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    wcOrderId: {
      type: String,
      required: false,
      default: '',
    },
    wcOrderNumber: {
      type: String,
      required: false,
      default: '',
    },
    topic: {
      type: String,
      required: true,
      enum: [
        'orders/create',
        'orders/updated',
        'manual/import',
        'bulk/import',
        'app/uninstalled',
        'data/redact',
      ],
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
    payload: {
      type: mongoose.Schema.Types.Mixed,
      required: false,
      default: undefined,
    },
  },
  { timestamps: true }
);

woocommerceSyncLogSchema.index({ business: 1, createdAt: -1 });
woocommerceSyncLogSchema.index({ status: 1, retryCount: 1, topic: 1 });

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

module.exports = mongoose.model('WoocommerceSyncLog', woocommerceSyncLogSchema);
module.exports.capPayloadForStorage = capPayloadForStorage;
module.exports.MAX_PAYLOAD_BYTES = MAX_PAYLOAD_BYTES;
