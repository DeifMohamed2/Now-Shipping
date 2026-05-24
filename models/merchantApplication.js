const mongoose = require('mongoose');

const PRODUCT_TYPES = ['fashion', 'electronics', 'beauty', 'food', 'home', 'other'];
const MONTHLY_ORDERS = ['1-50', '51-200', '201-500', '501-1000', '1000+'];
const STATUSES = ['new', 'contacted', 'qualified', 'rejected', 'converted'];

const merchantApplicationSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
      maxlength: 20,
      index: true,
    },
    storeName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    productType: {
      type: String,
      required: true,
      enum: PRODUCT_TYPES,
    },
    monthlyOrders: {
      type: String,
      required: true,
      enum: MONTHLY_ORDERS,
    },
    status: {
      type: String,
      enum: STATUSES,
      default: 'new',
      index: true,
    },
    source: {
      type: String,
      default: 'landing',
      trim: true,
      maxlength: 40,
    },
    adminNotes: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: '',
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'admin',
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    meta: {
      ip: { type: String, trim: true, maxlength: 64 },
      userAgent: { type: String, trim: true, maxlength: 512 },
    },
  },
  { timestamps: true }
);

merchantApplicationSchema.index({ createdAt: -1 });

module.exports = mongoose.model('MerchantApplication', merchantApplicationSchema);
module.exports.PRODUCT_TYPES = PRODUCT_TYPES;
module.exports.MONTHLY_ORDERS = MONTHLY_ORDERS;
module.exports.STATUSES = STATUSES;
