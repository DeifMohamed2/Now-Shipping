const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const courierSchema = new Schema(
  {
    courierID: {
      type: String,
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    personalPhoto: {
      type: String,
      required: false,
    },
    personalEmail: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    password: {
      type: String,
      required: true,
    },
    phoneNumber: {
      type: String,
      required: true,
    },
    ordersHistory: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'order',
      required: false,
    },
    assignedOrders: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'order',
      required: false,
    },
    pickupsHistory: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'pickup',
      required: false,
    },
    assignedPickups: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'pickup',
      required: false,
    },
    vehicleType: {
      type: String,
      required: true,
    },
    vehiclePlateNumber: {
      type: String,
      required: true,
    },
    nationalId: {
      type: String,
      required: true,
      unique: true,
    },
    dateOfBirth: {
      type: Date,
      required: true,
    },
    address: {
      type: String,
      required: true,
    },
    allPapers: {
      type: [String],
      required: true,
    },
    assignedZones: {
      type: [String],
      required: true,
    },
    isAvailable: {
      type: Boolean,
      default: true,
    },
    currentLocation: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point'
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        default: [0, 0]
      },
      lastUpdated: {
        type: Date,
        default: Date.now
      }
    },
    isLocationTrackingEnabled: {
      type: Boolean,
      default: false,
    },
    deviceToken: {
      type: String,
      default: null
    },
    fcmToken: {
      type: String,
      default: null
    }
  },
  { timestamps: true }
);

// Create a geospatial index for location-based queries
courierSchema.index({ currentLocation: '2dsphere' });

const Courier = mongoose.model('courier', courierSchema);

module.exports = Courier;
