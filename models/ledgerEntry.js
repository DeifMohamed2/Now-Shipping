const mongoose = require('mongoose');

/**
 * LedgerEntry — the single source of truth for every financial event.
 *
 * Rules:
 *  - positive amount  = money owed TO the business  (cod_collected, adjustment credit)
 *  - negative amount  = money owed BY the business  (delivery_fee, pickup_fee, payout, adjustment debit)
 *  - balance          = SUM(amount) for a business  (computed on read, never stored)
 *  - payoutId = null  = unsettled (counts toward next payout)
 *  - payoutId set     = settled (included in that payout)
 */

const ledgerEntrySchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      required: true,
      index: true,
    },

    type: {
      type: String,
      required: true,
      enum: [
        'cod_collected',  // COD cash collected from customer and handed to us
        'delivery_fee',   // Delivery / return / exchange service fee
        'pickup_fee',     // Pickup service fee
        'adjustment',     // Manual admin credit or debit
        'payout',         // Weekly transfer to business bank account
      ],
    },

    amount: {
      type: Number,
      required: true,
      // positive = credit, negative = debit
    },

    description: {
      type: String,
      required: true,
    },

    // References (at most one will be set per entry)
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'order',
      default: null,
    },
    orderNumber: {
      type: String,
      default: null,
    },
    pickupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Pickup',
      default: null,
    },
    pickupNumber: {
      type: String,
      default: null,
    },

    // Set when this entry is included in a Payout (null = unsettled)
    payoutId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payout',
      default: null,
      index: true,
    },

    // Who created this entry
    createdBy: {
      type: String,
      required: true,
      enum: ['system', 'admin'],
      default: 'system',
    },

    // Required when createdBy === 'admin'
    adminNote: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Prevent duplicate entries for the same order + type combination
ledgerEntrySchema.index(
  { orderId: 1, type: 1 },
  {
    unique: true,
    partialFilterExpression: {
      orderId: { $exists: true, $ne: null },
    },
    name: 'unique_order_type',
  }
);

// Prevent duplicate pickup_fee entries for the same pickup
ledgerEntrySchema.index(
  { pickupId: 1, type: 1 },
  {
    unique: true,
    partialFilterExpression: { pickupId: { $exists: true, $ne: null } },
    name: 'unique_pickup_type',
  }
);

// Fast balance queries
ledgerEntrySchema.index({ business: 1, payoutId: 1, createdAt: -1 });
ledgerEntrySchema.index({ business: 1, createdAt: -1 });

const LedgerEntry = mongoose.model('LedgerEntry', ledgerEntrySchema);

module.exports = LedgerEntry;
