const mongoose = require('mongoose');

/**
 * Immutable audit trail for per-business custom pricing changes.
 * One row per changed field so admins can trace who changed what and when.
 */
const pricingAuditSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      required: true,
      index: true,
    },
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'admin',
      required: true,
    },
    changedByName: {
      type: String,
      default: null,
    },
    /** Dot-path field key, e.g. `enabled`, `order.Cairo.Deliver`, `expressFee`, `pickupFee` */
    field: {
      type: String,
      required: true,
    },
    oldValue: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    newValue: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    note: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

pricingAuditSchema.index({ business: 1, createdAt: -1 });

module.exports = mongoose.model('PricingAudit', pricingAuditSchema);
