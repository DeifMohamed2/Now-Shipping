const mongoose = require('mongoose');

/**
 * Payout — represents a single weekly transfer to a business.
 *
 * Lifecycle:  scheduled → processing → paid
 *                                    → failed
 *
 * When a Payout is created by the cron job:
 *   1. All unsettled LedgerEntries for the business get payoutId = this._id
 *   2. A single 'payout' LedgerEntry with amount = -this.amount is written
 *
 * When admin marks it as paid:
 *   status = 'paid', paidDate = now
 */

const payoutSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      required: true,
      index: true,
    },

    amount: {
      type: Number,
      required: true,
    },

    status: {
      type: String,
      required: true,
      enum: ['scheduled', 'processing', 'paid', 'failed'],
      default: 'scheduled',
    },

    scheduledDate: {
      type: Date,
      required: true,
    },

    paidDate: {
      type: Date,
      default: null,
    },

    // Snapshot of payment method at time of payout creation
    paymentSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    adminNote: {
      type: String,
      default: null,
    },

    // How many LedgerEntries were settled in this payout
    entryCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

payoutSchema.index({ business: 1, status: 1 });
payoutSchema.index({ scheduledDate: 1, status: 1 });

const Payout = mongoose.model('Payout', payoutSchema);

module.exports = Payout;
