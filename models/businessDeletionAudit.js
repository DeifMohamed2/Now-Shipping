const mongoose = require('mongoose');

/**
 * Immutable audit record when a business is soft-deleted or cascade-deleted.
 * Used to display business name on ledger/orders when the user document no longer exists.
 */
const businessDeletionAuditSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    originalName: { type: String, default: null },
    originalBrandName: { type: String, default: null },
    originalEmail: { type: String, default: null },
    businessAccountCode: { type: String, default: null },
    mode: {
      type: String,
      enum: ['soft', 'cascade'],
      required: true,
    },
    reason: { type: String, required: true },
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'admin',
      required: true,
    },
    deletedAt: {
      type: Date,
      default: Date.now,
    },
    countsDeleted: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model(
  'BusinessDeletionAudit',
  businessDeletionAuditSchema
);
