const mongoose = require('mongoose');
const cron = require('node-cron');
const Transaction = require('./transactions');


const orderStagesSchema = new mongoose.Schema({
    orderPlaced: {
        isCompleted: { type: Boolean, default: true },
        completedAt: { type: Date, default: Date.now },
        notes: { type: String, default: 'Order has been created.' }
    },
    packed: {
        isCompleted: { type: Boolean, default: false },
        completedAt: { type: Date, default: null },
        notes: { type: String, default: '' }
    },
    shipping: {
        isCompleted: { type: Boolean, default: false },
        completedAt: { type: Date, default: null },
        notes: { type: String, default: '' }
    },
    inProgress: {
        isCompleted: { type: Boolean, default: false },
        completedAt: { type: Date, default: null },
        notes: { type: String, default: '' }
    },
    outForDelivery: {
        isCompleted: { type: Boolean, default: false },
        completedAt: { type: Date, default: null },
        notes: { type: String, default: '' }
    },
    delivered: {
        isCompleted: { type: Boolean, default: false },
        completedAt: { type: Date, default: null },
        notes: { type: String, default: '' }
    },
    // Comprehensive return-specific stages
    returnInitiated: {
        isCompleted: { type: Boolean, default: false },
        completedAt: { type: Date, default: null },
        notes: { type: String, default: '' },
        initiatedBy: { type: String, enum: ['business', 'system'], default: null },
        reason: { type: String, default: null }
    },
    returnAssigned: {
        isCompleted: { type: Boolean, default: false },
        completedAt: { type: Date, default: null },
        notes: { type: String, default: '' },
        assignedCourier: { type: mongoose.Schema.Types.ObjectId, ref: 'courier', default: null },
        assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'admin', default: null }
    },
    returnPickedUp: {
        isCompleted: { type: Boolean, default: false },
        completedAt: { type: Date, default: null },
        notes: { type: String, default: '' },
        pickedUpBy: { type: mongoose.Schema.Types.ObjectId, ref: 'courier', default: null },
        pickupLocation: { type: String, default: null },
        pickupPhotos: [{ type: String, default: [] }]
    },
    returnAtWarehouse: {
        isCompleted: { type: Boolean, default: false },
        completedAt: { type: Date, default: null },
        notes: { type: String, default: '' },
        receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'admin', default: null },
        warehouseLocation: { type: String, default: null },
        conditionNotes: { type: String, default: '' }
    },
    returnInspection: {
        isCompleted: { type: Boolean, default: false },
        completedAt: { type: Date, default: null },
        notes: { type: String, default: '' },
        inspectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'admin', default: null },
        inspectionResult: { type: String, enum: ['approved', 'rejected', 'needs_repair'], default: null },
        inspectionPhotos: [{ type: String, default: [] }]
    },
    returnProcessing: {
        isCompleted: { type: Boolean, default: false },
        completedAt: { type: Date, default: null },
        notes: { type: String, default: '' },
        processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'admin', default: null },
        processingType: { type: String, enum: ['refund', 'exchange', 'repair'], default: null }
    },
    returnToBusiness: {
        isCompleted: { type: Boolean, default: false },
        completedAt: { type: Date, default: null },
        notes: { type: String, default: '' },
        assignedCourier: { type: mongoose.Schema.Types.ObjectId, ref: 'courier', default: null },
        assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'admin', default: null }
    },
    returnCompleted: {
        isCompleted: { type: Boolean, default: false },
        completedAt: { type: Date, default: null },
        notes: { type: String, default: '' },
        completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'courier', default: null },
        deliveryLocation: { type: String, default: null },
        businessSignature: { type: String, default: null }
    },
    returned: {
        isCompleted: { type: Boolean, default: false },
        completedAt: { type: Date, default: null },
        notes: { type: String, default: '' },
        returnOrderCompleted: { type: Boolean, default: false },
        returnOrderCompletedAt: { type: Date, default: null }
    }
});

const courierHistorySchema = new mongoose.Schema({
    courier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'courier',
      required: true
    },
    assignedAt: {
      type: Date,
      required: true,
      default: Date.now
    },
    action: {
      type: String,
      required: true,
      enum: ['assigned', 'pickup_from_customer', 'delivered_to_warehouse', 'pickup_from_warehouse', 'delivered_to_business', 'completed']
    },
    notes: {
      type: String,
      required: false
    }
});

const orderSchema = new mongoose.Schema(
  {
    orderNumber: {
      type: String,
      required: true,
      unique: true,
    },
    smartFlyerBarcode: {
      type: String,
      required: false,
      default: null,
    },
    orderDate: {
      type: Date,
      required: true,
    },
    orderFees: {
      type: Number,
      required: true,
    },
    returnFees: {
      type: Number,
      required: false,
      default: 0,
    },
    totalFees: {
      type: Number,
      required: false,
      default: 0,
    },
    feeBreakdown: {
      deliveryFee: { type: Number, default: 0 },
      returnFee: { type: Number, default: 0 },
      expressFee: { type: Number, default: 0 },
      processingFee: { type: Number, default: 0 },
      inspectionFee: { type: Number, default: 0 },
      total: { type: Number, default: 0 }
    },
    orderStatus: {
      type: String,
      required: true,
      enum: [
        // NEW category
        'new',                  // Initial state
        'pendingPickup',        // Waiting for pickup
        
        // PROCESSING category
        'pickedUp',             // Order picked up from business
        'inStock',              // Order in warehouse
        'inReturnStock',        // Return order in warehouse
        'inProgress',           // Order being processed
        'headingToCustomer',    // Order on the way to customer
        'returnToWarehouse',    // Return on the way to warehouse
        'headingToYou',         // Order heading to business (return)
        'rescheduled',          // Delivery rescheduled
        
        // PAUSED category
        'waitingAction',        // Awaiting business action
        'rejected',             // Order rejected by courier
        
        // SUCCESSFUL category
        'completed',            // Order successfully delivered
        'returnCompleted',      // Return successfully completed
        
        // UNSUCCESSFUL category
        'canceled',             // Order canceled
        'returned',             // Order returned to business
        'terminated',           // Order terminated
        
        // Enhanced Return flow statuses
        'returnInitiated',      // Business initiates return
        'returnAssigned',       // Admin assigns courier for pickup
        'returnPickedUp',       // Courier picked up from customer
        'returnAtWarehouse',    // Return delivered to warehouse
        'returnToBusiness',     // Admin assigns courier to deliver to business
        'deliveryFailed',       // Delivery failed/customer rejected
        'autoReturnInitiated',  // System automatically initiated return
        'returnLinked',         // Return order linked to deliver order
      ],
    },
    
    // New field for status category
    statusCategory: {
      type: String,
      enum: ['NEW', 'PROCESSING', 'PAUSED', 'SUCCESSFUL', 'UNSUCCESSFUL'],
      required: true,
      default: 'NEW'
    },
    Attemps: {
      type: Number,
      required: true,
      default: 0,
    },
    UnavailableReason: {
      type: [String],
      required: false,
    },
    orderStatusHistory: [
      {
        status: {
          type: String,
          required: true,
        },
        date: {
          type: Date,
          required: true,
          default: Date.now,
        },
        category: {
          type: String,
          enum: ['NEW', 'PROCESSING', 'PAUSED', 'SUCCESSFUL', 'UNSUCCESSFUL'],
          required: false
        },
      },
    ],
    orderCustomer: {
      fullName: {
        type: String,
        required: true,
      },
      phoneNumber: {
        type: String,
        required: true,
      },
      otherPhoneNumber: {
        type: String,
        required: false,
      },
      address: {
        type: String,
        required: true,
      },
      government: {
        type: String,
        required: true,
      },
      zone: {
        type: String,
        required: true,
      },
      deliverToWorkAddress: {
        type: Boolean,
        required: false,
        default: false,
      },
    },
    
    // orderPayment: {
    //     type: Object,
    //     required: true
    // },
    orderShipping: {
      productDescription: {
        // for the product will be send or product with the client
        type: String,
        required: false,
      },
      numberOfItems: {
        type: Number,
        required: false,
      },
      productDescriptionReplacement: {
        // for the new product will be replaced
        type: String,
        required: false,
      },
      numberOfItemsReplacement: {
        type: Number,
        required: false,
      },
      orderType: {
        type: String,
        required: true,
        enum: ['Deliver', 'Return', 'Exchange', 'Cash Collection'],
      },
      amountType: {
        type: String,
        required: true,
        enum: ['COD', 'CD', 'CC', 'NA'], // COD for Cash On Delvirt and CD for Cash Differnce and CC for Cash Collection
      },
      amount: {
        type: Number,
        required: false,
      },
      isExpressShipping: {
        type: Boolean,
        required: true,
        default: false,
      },
      returnReason: {
        type: String,
        required: false,
      },
      returnNotes: {
        type: String,
        required: false,
      },
      // New fields for enhanced return flow
      linkedReturnOrder: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'order',
        required: false,
      },
      linkedDeliverOrder: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'order',
        required: false,
      },
      returnOrderCode: {
        type: String,
        required: false,
      },
      originalOrderNumber: {
        type: String,
        required: false,
      },
      // Enhanced return fields
      returnCondition: {
        type: String,
        enum: ['excellent', 'good', 'fair', 'poor', 'damaged'],
        required: false,
      },
      returnValue: {
        type: Number,
        required: false,
        default: 0,
      },
      returnPhotos: [{
        type: String,
        required: false,
      }],
      returnInspectionNotes: {
        type: String,
        required: false,
      },
      returnProcessingNotes: {
        type: String,
        required: false,
      },
      refundAmount: {
        type: Number,
        required: false,
        default: 0,
      },
      exchangeOrderNumber: {
        type: String,
        required: false,
      },
      // Partial return fields
      isPartialReturn: {
        type: Boolean,
        required: false,
        default: false,
      },
      originalOrderItemCount: {
        type: Number,
        required: false,
        default: 1,
      },
      partialReturnItemCount: {
        type: Number,
        required: false,
        default: 1,
      },
    },
    referralNumber: {
      type: String,
      required: false,
    },
    isOrderAvailableForPreview: {
      type: Boolean,
      required: true,
    },
    orderNotes: {
      type: String,
      required: false,
    },
    orderStages: {
      type: orderStagesSchema,
      required: true,
      default: () => ({})
    },
    deliveryMan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'courier',
      required: false,
    },
    courierHistory: {
      type: [courierHistorySchema],
      required: false,
      default: []
    },
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      required: true,
    },
    isMoneyRecivedFromCourier: { // this is the status of the money that is recived from the courier
      type: Boolean,
      required: true,
      default: false,
    },
    completedDate: {
      type: Date,
      required: false,
    },
    moneyReleaseDate: {
      type: Date,
      required: false,
    },
    scheduledRetryAt: {
      type: Date,
      required: false,
    },
    // Financial processing tracking
    financialProcessing: {
      isProcessed: {
        type: Boolean,
        default: false,
        required: true
      },
      processedAt: {
        type: Date,
        required: false
      },
      processedBy: {
        type: String,
        enum: ['dailyJob', 'manual', 'system'],
        required: false
      },
      processingBatchId: {
        type: String,
        required: false
      },
      transactionIds: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Transaction',
        required: false
      }],
      processingNotes: {
        type: String,
        required: false
      }
    },

    // Delivery OTP for customer verification (24h validity)
    deliveryOtp: {
      otpHash: { type: String, required: false, default: null },
      expiresAt: { type: Date, required: false, default: null },
      verifiedAt: { type: Date, required: false, default: null },
      attempts: { type: Number, required: true, default: 0 }
    },
  },
  {
    timestamps: true,
});



// Middleware to check pickup status when order status changes to inStock
// Post-save: update related pickup when this order reaches inStock (no re-saving order here)
orderSchema.post('save', async function() {
    if (this.orderStatus === 'inStock') {
        try {
            const pickup = await mongoose.model('Pickup').findOne({
                ordersPickedUp: this._id
            });
            if (pickup) {
                const orders = await mongoose.model('order').find({
                    _id: { $in: pickup.ordersPickedUp }
                });
                const allOrdersInStock = orders.every(order => order.orderStatus === 'inStock');
                if (allOrdersInStock) {
                    pickup.picikupStatus = 'completed';
                    const lastStage = pickup.pickupStages[pickup.pickupStages.length - 1];
                    if (!lastStage || lastStage.stageName !== 'completed') {
                        pickup.pickupStages.push({
                            stageName: 'completed',
                            stageDate: new Date(),
                            stageNotes: [{
                                text: 'All orders from this pickup are now in stock',
                                date: new Date()
                            }]
                        });
                    }
                    await pickup.save();
                }
            }
        } catch (error) {
            console.error('Error in order post-save middleware:', error);
        }
    }
});

// Pre-save: push status history when orderStatus changes and update status category
orderSchema.pre('save', function(next) {
  if (this.isModified('orderStatus')) {
    // Determine the category based on status
    const newStatus = this.orderStatus;
    let category;
    
    // NEW category
    if (['new', 'pendingPickup'].includes(newStatus)) {
      category = 'NEW';
    }
    // PROCESSING category
    else if (['pickedUp', 'inStock', 'inReturnStock', 'inProgress', 'headingToCustomer', 
              'returnToWarehouse', 'headingToYou', 'rescheduled', 'returnInitiated',
              'returnAssigned', 'returnPickedUp', 'returnAtWarehouse', 'returnToBusiness'].includes(newStatus)) {
      category = 'PROCESSING';
    }
    // PAUSED category
    else if (['waitingAction', 'rejected'].includes(newStatus)) {
      category = 'PAUSED';
    }
    // SUCCESSFUL category
    else if (['completed', 'returnCompleted'].includes(newStatus)) {
      category = 'SUCCESSFUL';
    }
    // UNSUCCESSFUL category
    else if (['canceled', 'returned', 'terminated', 'deliveryFailed', 'autoReturnInitiated'].includes(newStatus)) {
      category = 'UNSUCCESSFUL';
    }
    
    // Update the model's status category
    this.statusCategory = category;
    
    // Add to status history with category
    this.orderStatusHistory.push({
      status: this.orderStatus,
      date: new Date(),
      category: category
    });
  }

  // Fast shipping logic will be handled when courier scans the order during pickup

  next();
});

// Pre-save: set money release date and completed date on transition to orders that need financial processing
orderSchema.pre('save', function(next) {
  // Orders that need financial processing and money release dates
  const financialProcessingStatuses = ['completed', 'returned', 'canceled', 'returnCompleted'];
  
  if (this.isModified('orderStatus') && financialProcessingStatuses.includes(this.orderStatus) && !this.moneyReleaseDate) {
    const completionDate = new Date();
    const dayOfWeek = completionDate.getDay();
    const daysUntilWednesday = (3 - dayOfWeek + 7) % 7;
    const releaseDate = new Date(completionDate);
    
    // Calculate next Wednesday for money release
    if (dayOfWeek === 3) {
      releaseDate.setDate(releaseDate.getDate() + 7);
    } else if (daysUntilWednesday > 0) {
      releaseDate.setDate(releaseDate.getDate() + daysUntilWednesday);
    }
    
    this.moneyReleaseDate = releaseDate;
    this.completedDate = new Date();
    
    console.log(`Setting money release date for order ${this.orderNumber} (status: ${this.orderStatus}) to: ${releaseDate.toISOString()}`);
  }
  next();
});

// Pre-save: validate return order linking consistency
orderSchema.pre('save', function(next) {
  // If this is a return order with originalOrderNumber, ensure consistency
  if (this.orderShipping.orderType === 'Return' && this.orderShipping.originalOrderNumber) {
    // If we have a linked deliver order, ensure the original order number matches
    if (this.orderShipping.linkedDeliverOrder && this.orderShipping.originalOrderNumber) {
      // This will be validated in the controller when linking occurs
    }
  }
  
  // If this is a deliver order that's being marked as returned, ensure we have a linked return order
  if (this.orderStatus === 'returned' && this.orderShipping.orderType === 'Deliver') {
    if (!this.orderShipping.linkedReturnOrder) {
      console.warn(`Deliver order ${this.orderNumber} marked as returned but has no linked return order`);
    }
  }
  
  next();
});




const Order = mongoose.model('order', orderSchema);

module.exports = Order;
