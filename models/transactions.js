const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const User = require('./user');

const transactionSchema = new Schema(
  {
    transactionId: {
      type: String,
      required: true,
    },
    transactionType: {
      type: String,
      required: true,
      enum: [
        'cashCycle',
        'fees',
        'flyersFees',
        'refund',
        'deposit',
        'withdrawal',
      ],
    },
    ordersDetails: {
      type: Object,
      required: true,
    },
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
  },
  { timestamps: true }
);

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
