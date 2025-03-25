const mongoose = require('mongoose');
const crypto = require('crypto');

const UserSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: [true, 'Please provide your email'],
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
    isNeedStorage: {
      type: Boolean,
      default: false,
    },
    brandInfo: {
      brandName: {
        type: String,
        required: false,
      },
      industry: {
        type: String,
        required: false,
      },
      monthlyOrders: {
        type: String,
        required: false,
      },
      sellingPoints: {
        type: [String],
        required: false,
      },
    },
    pickUpAdress: {
      pickUpPointInMaps: {
        type: String,
        required: false,
      },
      country: {
        type: String,
        required: false,
      },
      city: {
        type: String,
        required: false,
      },
      adressDetails: {
        type: String,
        required: false,
      },
      nearbyLandmark: {
        type: String,
        required: false,
      },
    },
    paymentMethod: {
      paymentChoice: {
        type: String,
        required: false,
        enum: ['instaPay', 'mobileWallet', 'bankTransfer'],
      },
      details: {
        type: mongoose.Schema.Types.Mixed,
        required: function () {
          return (
            this.paymentMethod.paymentChoice === 'instaPay' ||
            this.paymentMethod.paymentChoice === 'mobileWallet' ||
            this.paymentMethod.paymentChoice === 'bankTransfer'
          );
        },
        validate: {
          validator: function (value) {
            if (this.paymentMethod.paymentChoice === 'instaPay') {
              return value.hasOwnProperty('IPAorPhoneNumber');
            } else if (this.paymentMethod.paymentChoice === 'mobileWallet') {
              return value.hasOwnProperty('phoneNumber');
            } else if (this.paymentMethod.paymentChoice === 'bankTransfer') {
              return (
                value.hasOwnProperty('bankName') &&
                value.hasOwnProperty('IBAN') &&
                value.hasOwnProperty('accountName')
              );
            }
            return false;
          },
          message: 'Invalid payment details',
        },
      },
    },
    brandType: {
      brandChoice: {
        type: String,
        required: false,
        enum: ['personal', 'company'],
      },
      brandDetails: {
        type: mongoose.Schema.Types.Mixed,
        required: false,
        validate: {
          validator: function (value) {
            if (this.brandType.brandChoice === 'personal') {
              return (
                value.hasOwnProperty('nationalId') &&
                Array.isArray(value.photos)
              );
            } else if (this.brandType.brandChoice === 'company') {
              return (
                value.hasOwnProperty('taxNumber') && Array.isArray(value.photos)
              );
            }
            return false;
          },
          message: 'Invalid brand details',
        },
      },
    },
    balance: {
      type: Number,
      default: 0,
    },
    balanceHistory: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    balanceTransactions: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    

    isCompleted: {
      type: Boolean,
      default: false,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    verificationToken: {
      type: String,
    },
    verificationTokenExpires: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Method to generate a verification token
UserSchema.methods.generateVerificationToken = function() {
    const token = crypto.randomBytes(20).toString('hex');
    this.verificationToken = token;
    this.verificationTokenExpires = Date.now() + 3600000; // 1 hour
    return token;
};

// Method to verify the user's email
UserSchema.methods.verifyEmail = function(token) {
    if (token === this.verificationToken && Date.now() < this.verificationTokenExpires) {
        this.isVerified = true;
        this.verificationToken = undefined;
        this.verificationTokenExpires = undefined;
        return true;
    }
    return false;
};

const User = mongoose.model('users', UserSchema);

module.exports = User;
