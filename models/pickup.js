const mongoose = require('mongoose');
const Schema = mongoose.Schema;

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

const pickupSchema = new Schema(
  {
    pickupNumber: {
      type: String,
      required: true,
    },
    numberOfOrders: {
      type: Number,
      required: true,
    },
    pickupFees: {
      type: Number,
      required: true,
      default: 70,
    },
    pickupDate: {
      type: Date,
      required: true,
    },
    phoneNumber: {
      type: String,
      required: true,
    },
    isFragileItems: {
      type: Boolean,
      default: false,
    },
    isLargeItems: {
      type: Boolean,
      default: false,
    },
    pickupStages: {
      type: [stageSchema],
      required: true,
    },
    picikupStatus: {
      type: String,
      required: true,
      enum: [
        'new',
        'driverAssigned',
        'pickedUp',
        'inStock',
        'inProgress',
        'completed',
        'canceled',
        'rejected',
        'returned',
        'terminated',
      ],
    },
    driverNotes: {
      type: String,
    },
    driverRating: {
      type: Number,
    },
    driverReview: {
      type: String,
    },
    pickupRating: {
      type: Number,
    },
    pickupReview: {
      type: String,
    },
    pickupNotes: {
      type: String,
    },
    ordersPickedUp: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'order',
      validate: {
        validator: function (value) {
          return value.length === new Set(value.map(String)).size;
        },
        message: 'Duplicate orders are not allowed.',
      },
    },
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      required: true,
    },
    assignedDriver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'courier',
    },
    pickupLocation: {
      type:String

    }

    
  },
  { timestamps: true }
);





const Pickup = mongoose.model('Pickup', pickupSchema);

module.exports = Pickup;
