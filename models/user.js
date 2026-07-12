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
      unique: true,
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
          const choice = this.paymentMethod?.paymentChoice;
          if (!choice) return false;
          return (
            choice === 'instaPay' ||
            choice === 'mobileWallet' ||
            choice === 'bankTransfer'
          );
        },
        validate: {
          validator: function (value) {
            if (value == null || typeof value !== 'object') return false;
            let choice = this.paymentMethod?.paymentChoice;
            // findByIdAndUpdate + runValidators: parent subdoc may be missing on `this`
            if (!choice) {
              if (Object.prototype.hasOwnProperty.call(value, 'IPAorPhoneNumber')) {
                choice = 'instaPay';
              } else if (Object.prototype.hasOwnProperty.call(value, 'mobileWalletNumber')) {
                choice = 'mobileWallet';
              } else if (Object.prototype.hasOwnProperty.call(value, 'bankName')) {
                choice = 'bankTransfer';
              } else {
                return false;
              }
            }
            if (choice === 'instaPay') {
              return Object.prototype.hasOwnProperty.call(value, 'IPAorPhoneNumber');
            }
            if (choice === 'mobileWallet') {
              return Object.prototype.hasOwnProperty.call(value, 'mobileWalletNumber');
            }
            if (choice === 'bankTransfer') {
              return (
                Object.prototype.hasOwnProperty.call(value, 'bankName') &&
                Object.prototype.hasOwnProperty.call(value, 'accountNumber') &&
                Object.prototype.hasOwnProperty.call(value, 'accountName')
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
            if (value == null || typeof value !== 'object') return false;
            let choice = this.brandType?.brandChoice;
            if (!choice) {
              if (Object.prototype.hasOwnProperty.call(value, 'nationalId')) choice = 'personal';
              else if (Object.prototype.hasOwnProperty.call(value, 'taxNumber')) choice = 'company';
              else return false;
            }
            if (choice === 'personal') {
              return (
                Object.prototype.hasOwnProperty.call(value, 'nationalId') &&
                Array.isArray(value.photos)
              );
            }
            if (choice === 'company') {
              return (
                Object.prototype.hasOwnProperty.call(value, 'taxNumber') &&
                Array.isArray(value.photos)
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
    /** Soft-delete: account removed by admin; operational data may remain for audit. */
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'admin',
      default: null,
    },
    deletionReason: {
      type: String,
      default: null,
    },
    /** Preserved at deletion for ledger/order display when PII is anonymized. */
    originalName: {
      type: String,
      default: null,
    },
    originalBrandName: {
      type: String,
      default: null,
    },
    /**
     * Per-business custom fee overrides (admin-managed).
     * When enabled, unset fields fall back to global rates in utils/fees.js.
     */
    customPricing: {
      enabled: { type: Boolean, default: false },
      order: {
        Cairo: {
          Deliver: { type: Number, default: null },
          Return: { type: Number, default: null },
          Exchange: { type: Number, default: null },
        },
        Giza: {
          Deliver: { type: Number, default: null },
          Return: { type: Number, default: null },
          Exchange: { type: Number, default: null },
        },
        Qalyubia: {
          Deliver: { type: Number, default: null },
          Return: { type: Number, default: null },
          Exchange: { type: Number, default: null },
        },
      },
      expressFee: { type: Number, default: null },
      pickupFee: { type: Number, default: null },
      updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'admin',
        default: null,
      },
      updatedByName: { type: String, default: null },
      updatedAt: { type: Date, default: null },
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
