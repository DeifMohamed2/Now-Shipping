const mongoose = require('mongoose');
const cron = require('node-cron');
const Transaction = require('./transactions');

const stageSchema = new mongoose.Schema({
    stageName: {
        type: String,
        required: true
    },
    stageDate: {
        type: Date,
        required: true,
        default: Date.now
    },
    stageNotes: [{
        text: {
            type: String,
            required: false
        },
        date: {
            type: Date,
            required: false,
            default: Date.now
        }
    }]
});

const orderSchema = new mongoose.Schema(
  {
    orderNumber: {
      type: String,
      required: true,
      unique: true,
    },
    orderDate: {
      type: Date,
      required: true,
    },
    orderFees: {
      type: Number,
      required: true,
    },
    orderStatus: {
      type: String,
      required: true,
      enum: [
        'new',
        'pickedUp',
        'inStock',
        'inReturnStock',
        'inProgress',
        'headingToCustomer',
        'returnToWarehouse',
        'headingToYou',
        'rescheduled',
        'waitingAction',
        'completed',
        'canceled',
        'rejected',
        'returned',
        'terminated',
      ],
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
        enum: ['Deliver', 'Return', 'Exchange', 'CashCollection'],
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
      type: [stageSchema],
      required: true,
    },
    deliveryMan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'courier',
      required: false,
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
  },
  {
    timestamps: true,
  }
);



// Middleware to check pickup status when order status changes to inStock
orderSchema.post('save', async function() {
    console.log('order status is inStock', this.orderStatus);
    // Only proceed if orderStatus is 'inStock'
    if (this.orderStatus === 'inStock') {
        try {
            console.log('order status is inStock', this.orderStatus);
            // Find pickup that contains this order in ordersPickedUp
            const pickup = await mongoose.model('Pickup').findOne({
                ordersPickedUp: this._id
            });

            console.log('pickup', pickup);

            if (pickup) {
                // Get all orders referenced in this pickup
                const orders = await mongoose.model('order').find({
                    _id: { $in: pickup.ordersPickedUp }
                });

                console.log('orders', orders);

                // Check if all orders are now in stock
                const allOrdersInStock = orders.every(order => order.orderStatus === 'inStock');

                // If all orders are in stock, update pickup status to completed
                if (allOrdersInStock) {
                    pickup.picikupStatus = 'completed';
                    pickup.pickupStages.push({
                        stageName: 'completed',
                        stageDate: new Date(),
                        stageNotes: [{
                            text: 'All orders from this pickup are now in stock',
                            date: new Date()
                        }]
                    });
                    await pickup.save();
                }
            }
        } catch (error) {
            console.error('Error in order post-save middleware:', error);
        }
    }
});

orderSchema.post('save', async function(doc, next) {
  if (this.isModified('orderStatus')) {
    this.orderStatusHistory.push({
      status: this.orderStatus,
      date: new Date()
    });
    await this.save();
  }
  next();
});


// Set money release date to next Wednesday when order is completed
orderSchema.post('save', async function(doc, next) {
  if (this.orderStatus === 'completed' && !this.moneyReleaseDate) {
    const completionDate = new Date();
    const dayOfWeek = completionDate.getDay(); // 0 = Sunday, 3 = Wednesday
    const daysUntilWednesday = (3 - dayOfWeek + 7) % 7; // Calculate days until next Wednesday
    
    const releaseDate = new Date(completionDate);
    if (dayOfWeek === 3) { // If today is Wednesday
      releaseDate.setDate(releaseDate.getDate() + 7); // Set to next Wednesday
    } else if (daysUntilWednesday > 0) {
      releaseDate.setDate(releaseDate.getDate() + daysUntilWednesday);
    }
    
    this.moneyReleaseDate = releaseDate;
    this.completedDate = new Date();
    await this.save();
  }
  next();
});




const Order = mongoose.model('order', orderSchema);

module.exports = Order;
