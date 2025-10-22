const mongoose = require('mongoose');

const shopOrderItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ShopProduct',
    required: true,
  },
  productName: String,
  productNameAr: String,
  quantity: {
    type: Number,
    required: true,
    min: 1,
  },
  unitPrice: {
    type: Number,
    required: true,
  },
  discount: {
    type: Number,
    default: 0,
  },
  tax: {
    type: Number,
    default: 0,
  },
  subtotal: {
    type: Number,
    required: true,
  },
});

const shopOrderSchema = new mongoose.Schema(
  {
    orderNumber: {
      type: String,
      unique: true,
      required: true,
    },
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    businessName: String,
    items: [shopOrderItemSchema],
    subtotal: {
      type: Number,
      required: true,
    },
    discount: {
      type: Number,
      default: 0,
    },
    tax: {
      type: Number,
      default: 0,
    },
    deliveryFee: {
      type: Number,
      default: 0,
    },
    totalAmount: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: [
        'pending', // New order
        'confirmed', // Admin confirmed
        'processing', // Being prepared/packaged
        'ready', // Ready for pickup
        'assigned', // Assigned to courier
        'picked_up', // Courier picked up
        'in_transit', // On the way
        'delivered', // Delivered successfully
        'cancelled', // Cancelled
        'returned', // Returned
      ],
      default: 'pending',
    },
    paymentStatus: {
      type: String,
      enum: ['pending', 'paid', 'refunded'],
      default: 'pending',
    },
    paymentMethod: {
      type: String,
      enum: ['cash', 'wallet', 'card', 'bank_transfer'],
      default: 'wallet',
    },
    deliveryAddress: {
      fullAddress: String,
      city: String,
      area: String,
      street: String,
      building: String,
      floor: String,
      apartment: String,
      landmark: String,
      coordinates: {
        lat: Number,
        lng: Number,
      },
    },
    contactInfo: {
      name: String,
      phone: String,
      email: String,
    },
    courier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Courier',
    },
    courierName: String,
    courierPhone: String,
    assignedAt: Date,
    pickedUpAt: Date,
    deliveredAt: Date,
    estimatedDeliveryDate: Date,
    notes: String,
    adminNotes: String,
    packagingDetails: {
      numberOfBoxes: Number,
      weight: Number,
      dimensions: {
        length: Number,
        width: Number,
        height: Number,
      },
    },
    trackingHistory: [
      {
        status: String,
        statusAr: String,
        description: String,
        descriptionAr: String,
        timestamp: {
          type: Date,
          default: Date.now,
        },
        updatedBy: {
          type: mongoose.Schema.Types.ObjectId,
          refPath: 'trackingHistory.updatedByModel',
        },
        updatedByModel: {
          type: String,
          enum: ['Admin', 'User', 'Courier'],
        },
        location: {
          lat: Number,
          lng: Number,
        },
      },
    ],
    cancellationReason: String,
    returnReason: String,
    rating: {
      value: {
        type: Number,
        min: 1,
        max: 5,
      },
      comment: String,
      createdAt: Date,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: 'updatedByModel',
    },
    updatedByModel: {
      type: String,
      enum: ['Admin', 'User', 'Courier'],
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
shopOrderSchema.index({ orderNumber: 1 });
shopOrderSchema.index({ business: 1 });
shopOrderSchema.index({ courier: 1 });
shopOrderSchema.index({ status: 1 });
shopOrderSchema.index({ createdAt: -1 });
shopOrderSchema.index({ paymentStatus: 1 });

// Generate unique order number
shopOrderSchema.pre('validate', async function (next) {
  if (this.isNew && !this.orderNumber) {
    const date = new Date();
    const year = date.getFullYear().toString().slice(-2);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    // Find the last order of the day
    const lastOrder = await mongoose
      .model('ShopOrder')
      .findOne({
        createdAt: {
          $gte: new Date(date.setHours(0, 0, 0, 0)),
          $lt: new Date(date.setHours(23, 59, 59, 999)),
        },
      })
      .sort({ createdAt: -1 });

    let sequence = 1;
    if (lastOrder && lastOrder.orderNumber) {
      const lastSequence = parseInt(lastOrder.orderNumber.slice(-4));
      sequence = lastSequence + 1;
    }

    this.orderNumber = `SH${year}${month}${day}${String(sequence).padStart(
      4,
      '0'
    )}`;
  }
  next();
});

// Add tracking history on status change
shopOrderSchema.pre('save', function (next) {
  if (this.isModified('status') && !this.isNew) {
    const statusDescriptions = {
      pending: {
        en: 'Order placed and pending confirmation',
        ar: 'تم تقديم الطلب وفي انتظار التأكيد',
      },
      confirmed: {
        en: 'Order confirmed by admin',
        ar: 'تم تأكيد الطلب من قبل المسؤول',
      },
      processing: {
        en: 'Order is being prepared and packaged',
        ar: 'يتم تحضير وتعبئة الطلب',
      },
      ready: { en: 'Order is ready for pickup', ar: 'الطلب جاهز للاستلام' },
      assigned: {
        en: 'Order assigned to courier',
        ar: 'تم تعيين الطلب للمندوب',
      },
      picked_up: {
        en: 'Order picked up by courier',
        ar: 'تم استلام الطلب من قبل المندوب',
      },
      in_transit: {
        en: 'Order is on the way to delivery',
        ar: 'الطلب في الطريق للتوصيل',
      },
      delivered: {
        en: 'Order delivered successfully',
        ar: 'تم تسليم الطلب بنجاح',
      },
      cancelled: { en: 'Order has been cancelled', ar: 'تم إلغاء الطلب' },
      returned: { en: 'Order has been returned', ar: 'تم إرجاع الطلب' },
    };

    const statusInfo = statusDescriptions[this.status];
    if (statusInfo) {
      this.trackingHistory.push({
        status: this.status,
        statusAr: statusInfo.ar.split(':')[0],
        description: statusInfo.en,
        descriptionAr: statusInfo.ar,
        timestamp: new Date(),
        updatedBy: this.updatedBy,
        updatedByModel: this.updatedByModel,
      });
    }
  }
  next();
});

// Calculate totals
shopOrderSchema.methods.calculateTotals = function () {
  this.subtotal = this.items.reduce((sum, item) => sum + item.subtotal, 0);
  this.totalAmount =
    this.subtotal - this.discount + this.tax + this.deliveryFee;
};

const ShopOrder = mongoose.model('ShopOrder', shopOrderSchema);

module.exports = ShopOrder;
