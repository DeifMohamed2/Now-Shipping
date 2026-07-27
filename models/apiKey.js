const mongoose = require('mongoose');

/**
 * Business API keys for public integrations (collection: apikeys).
 * Only the SHA-256 hash of the key is stored; the raw key is shown once at creation.
 */
const apiKeySchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    keyPrefix: {
      type: String,
      required: true,
      trim: true,
    },
    keyHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    lastFour: {
      type: String,
      required: true,
      trim: true,
    },
    scopes: {
      type: [String],
      default: ['orders', 'pickups', 'merchants'],
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    revokedAt: {
      type: Date,
      default: null,
    },
    createdByAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'admin',
      default: null,
    },
    lastUsedAt: {
      type: Date,
      default: null,
    },
    requestCount: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

apiKeySchema.index({ business: 1, isActive: 1 });

const ApiKey = mongoose.model('apikeys', apiKeySchema);

module.exports = ApiKey;
