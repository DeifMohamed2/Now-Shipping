const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const User = require('./user');

const transactionSchema = new Schema(
  {
    transactionId: {
      type: String,
      required: true,
      unique: true,
    },
    transactionType: {
      type: String,
      required: true,
      enum: [
        'cashCycle',
        'fees',
        'pickupFees',
        'flyersFees',
        'refund',
        'deposit',
        'withdrawal',
        'returnFees',
        'cancellationFees',
        'returnCompletedFees',
        'shopOrderDelivery',
      ],
    },
    ordersDetails: {
      type: Object,
      required: true,
    },
    orderReferences: [{
      orderId: {
        type: Schema.Types.ObjectId,
        ref: 'order',
        required: false
      },
      orderNumber: {
        type: String,
        required: false
      },
      orderAmount: {
        type: Number,
        required: false
      },
      orderFees: {
        type: Number,
        required: false
      },
      completedDate: {
        type: Date,
        required: false
      }
    }],
    pickupReferences: [{
      pickupId: {
        type: Schema.Types.ObjectId,
        ref: 'Pickup',
        required: false
      },
      pickupNumber: {
        type: String,
        required: false
      },
      pickupFees: {
        type: Number,
        required: false
      },
      completedDate: {
        type: Date,
        required: false
      }
    }],
    shopOrderReferences: [{
      shopOrderId: {
        type: Schema.Types.ObjectId,
        ref: 'ShopOrder',
        required: false
      },
      orderNumber: {
        type: String,
        required: false
      },
      totalAmount: {
        type: Number,
        required: false
      },
      deliveredDate: {
        type: Date,
        required: false
      }
    }],
    transactionAmount: {
      type: Number,
    },
    totalBalanceAfterTransaction: {
      type: Number,
    },
    totalCashCycleOrders: {
      orderCount: {
        type: Number,
      },
      dateOfCashCycle: {
        type: Date,
      },
    },

    transactionNotes: {
      type: String,
    },

    business: {
      type: Schema.Types.ObjectId,
      ref: 'users',
    },
    settlementStatus: {
      type: String,
      enum: ['pending', 'included_in_release', 'settled'],
      default: 'pending',
      required: true,
    },
    // Keep settled for backward compatibility - will be calculated from settlementStatus
    settled: {
      type: Boolean,
      default: false,
      required: false,
    },
    // Enhanced tracking for better duplicate prevention
    processingBatchId: {
      type: String,
      required: false,
      index: true
    },
    sourceOrderIds: [{
      type: Schema.Types.ObjectId,
      ref: 'order',
      required: false
    }],
    isDuplicate: {
      type: Boolean,
      default: false
    },
    duplicateOf: {
      type: Schema.Types.ObjectId,
      ref: 'Transaction',
      required: false
    },
  },
  { timestamps: true }
);

// Add compound index to prevent duplicate transactions
transactionSchema.index(
  { 
    business: 1, 
    transactionType: 1, 
    'orderReferences.orderId': 1 
  }, 
  { 
    unique: true, 
    partialFilterExpression: { 
      'orderReferences.orderId': { $exists: true, $ne: null } 
    },
    name: 'unique_business_type_orders'
  }
);

// Pre-save hook to sync settled field with settlementStatus
transactionSchema.pre('save', function(next) {
  // Automatically set settled based on settlementStatus
  this.settled = this.settlementStatus === 'settled';
  next();
});

transactionSchema.post('save', async function () {
  if (this.business && this.transactionAmount) {
    try {
      const user = await User.findById(this.business);
      if (user) {
        user.balance = (user.balance || 0) + this.transactionAmount; // Safely add the transaction amount to the user's balance
        await user.save(); // Save the updated user balance
        console.log('User balance updated:', user.balance);
      }
    } catch (error) {
      console.error('Error updating user balance:', error);
    }
  }
});

const Transaction = mongoose.model('Transaction', transactionSchema);

module.exports = Transaction;
