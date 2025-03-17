const e = require('connect-flash');
const mongoose = require('mongoose');

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
            required: true
        },
        date: {
            type: Date,
            required: true,
            default: Date.now
        }
    }]
});

const orderSchema = new mongoose.Schema({
  orderNumber: {
    type: String,
    required: true,
    unique: true,
  },
  orderDate: {
    type: Date,
    required: true,
  },
  orderStatus: {
    type: String,
    required: true,
  },
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
    },
    amountType: {
      type: String,
      required: true,
      enum: ['COD', 'CD', 'CC',"NA"], // COD for Cash On Delvirt and CD for Cash Differnce and CC for Cash Collection
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
  business: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'users',
    required: true,
  },
});

const Order = mongoose.model('Order', orderSchema);

module.exports = Order;
