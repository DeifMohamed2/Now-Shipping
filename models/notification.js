const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const notificationSchema = new Schema(
  {
    title: {
      type: String,
      required: true,
    },
    body: {
      type: String,
      required: true,
    },
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'courier',
      required: false, // Not required if it's a broadcast notification
    },
    isRead: {
      type: Boolean,
      default: false,
    },
    type: {
      type: String,
      enum: [
        'broadcast', 
        'personal', 
        'order_status', 
        'pickup_status', 
        'shop_order_status', 
        'courier_assignment', 
        'pickup_assignment', 
        'shop_order_assignment', 
        'financial_processing'
      ],
      required: true,
    },
    data: {
      type: Object,
      default: {}
    },
    status: {
      type: String,
      enum: ['pending', 'delivered', 'failed', 'partial'],
      default: 'pending'
    },
    deliveryError: {
      type: String,
      default: null
    },
    deliveredAt: {
      type: Date,
      default: null
    },
    fcmResponse: {
      type: Object,
      default: null
    },
    deliveryStats: {
      type: Object,
      default: null
    }
  },
  { timestamps: true }
);

const Notification = mongoose.model('notification', notificationSchema);

module.exports = Notification;