const mongoose = require('mongoose');
const crypto = require('crypto');

/**
 * Business / admin user account (collection: `users`).
 * Core identity, brand, pickups, verification, and payout-related fields.
 */
const UserSchema = new mongoose.Schema(
  {
    /** Application role, e.g. `business`, `Business`, admin-facing variants */
    role: {
      type: String,
      required: true,
    },
    /** Display / legal name */
    name: {
      type: String,
      required: true,
    },
    profileImage: {
      type: String,
      required: false,
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
    /** Optional preferences for outbound notifications (reserved for future use). */
    notificationPreferences: {
      whatsapp: { type: Boolean, default: true },
      sms: { type: Boolean, default: false },
    },
    isNeedStorage: {
      type: Boolean,
      default: false,
      required: false,
    },
    /** Public-facing brand metadata for businesses */
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
      socialLinks: {
        type: Object,
        required: false,
      },
    },
    /** Primary pickup address (legacy field name `pickUpAdress` kept for backwards compatibility) */
    pickUpAdress: {
      pickUpPointInMaps: {
        type: String,
        required: false,
      },
      coordinates: {
        type: {
          lat: {
            type: Number,
            required: false,
          },
          lng: {
            type: Number,
            required: false,
          }
        },
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
      zone: {
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
      pickupPhone: {
        type: String,
        required: false,
      },
      otherPickupPhone: {
        type: String,
        required: false,
      },
    },
    // Multiple pickup addresses support
    pickUpAddresses: [{
      addressId: {
        type: String,
        required: true,
        default: function() {
          return `addr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        }
      },
      addressName: {
        type: String,
        required: false,
        default: 'Main Address'
      },
      isDefault: {
        type: Boolean,
        default: false
      },
      pickUpPointInMaps: {
        type: String,
        required: false,
      },
      coordinates: {
        lat: {
          type: Number,
          required: false,
        },
        lng: {
          type: Number,
          required: false,
        }
      },
      country: {
        type: String,
        required: false,
      },
      city: {
        type: String,
        required: false,
      },
      zone: {
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
      pickupPhone: {
        type: String,
        required: false,
      },
      otherPickupPhone: {
        type: String,
        required: false,
      },
      createdAt: {
        type: Date,
        default: Date.now
      }
    }],
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
              return value.hasOwnProperty('mobileWalletNumber');
            } else if (this.paymentMethod.paymentChoice === 'bankTransfer') {
              return (
                value.hasOwnProperty('bankName') &&
                value.hasOwnProperty('accountNumber') &&
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
    isCompleted: {
      type: Boolean,
      default: false,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    verificationOTP:{
      type: String,
    },
    verificationOTPExpires:{
      type: String,
    },
    verificationToken: {
      type: String,
    },
    verificationTokenExpires: {
      type: Date,
    },
    fcmToken: {
      type: String,
      default: null
    },
    preferredLanguage: {
      type: String,
      enum: ['en', 'ar'],
      default: 'en',
    },
    /** Unique 8-digit code for admin/support (search payouts, identify account without MongoDB id). */
    businessAccountCode: {
      type: String,
      default: null,
      unique: true,
      sparse: true,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// Assign unique 8-digit businessAccountCode on first save for business roles
UserSchema.pre('save', async function assignBusinessCode() {
  const role = (this.role || '').toString();
  if (role !== 'business' && role !== 'Business') return;
  if (this.businessAccountCode && /^\d{8}$/.test(this.businessAccountCode)) return;

  const UserModel = this.constructor;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const code = String(Math.floor(10000000 + Math.random() * 90000000));
    const clash = await UserModel.exists({
      businessAccountCode: code,
      _id: { $ne: this._id },
    });
    if (!clash) {
      this.businessAccountCode = code;
      return;
    }
  }
  throw new Error('Failed to assign unique businessAccountCode');
});

// Method to generate a verification token
UserSchema.methods.generateVerificationToken = function () {
  console.log('Generating verification token...');
  const token = crypto.randomBytes(20).toString('hex');
  this.verificationToken = token;
  this.verificationTokenExpires = Date.now() + 3600000; // 1 hour
  console.log('Verification token:', this.verificationToken);
  return token; // No save here!
};

// Method to generate a OTP Code
UserSchema.methods.generateOTP = function () {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    this.verificationOTP = otp;
    this.verificationOTPExpires = Date.now() + 300000; // 5 minutes
    return otp; // No save here!
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
