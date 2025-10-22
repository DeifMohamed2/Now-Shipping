const mongoose = require('mongoose');

const shopProductSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    nameAr: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
    },
    descriptionAr: {
      type: String,
      required: true,
    },
    category: {
      type: String,
      required: true,
      enum: [
        'Packaging',
        'Labels',
        'Boxes',
        'Bags',
        'Tape',
        'Bubble Wrap',
        'Other',
      ],
    },
    categoryAr: {
      type: String,
      required: true,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    stock: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    minOrderQuantity: {
      type: Number,
      default: 1,
      min: 1,
    },
    maxOrderQuantity: {
      type: Number,
      default: 1000,
    },
    unit: {
      type: String,
      required: true,
      enum: ['piece', 'pack', 'roll', 'box', 'kg', 'meter'],
    },
    unitAr: {
      type: String,
      required: true,
    },
    images: [
      {
        type: String,
      },
    ],
    specifications: {
      type: Map,
      of: String,
    },
    specificationsAr: {
      type: Map,
      of: String,
    },
    isAvailable: {
      type: Boolean,
      default: true,
    },
    isFeatured: {
      type: Boolean,
      default: false,
    },
    discount: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    taxRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    weight: {
      type: Number,
      default: 0,
    },
    dimensions: {
      length: Number,
      width: Number,
      height: Number,
    },
    sku: {
      type: String,
      unique: true,
      sparse: true,
    },
    tags: [
      {
        type: String,
      },
    ],
    tagsAr: [
      {
        type: String,
      },
    ],
    rating: {
      average: {
        type: Number,
        default: 0,
        min: 0,
        max: 5,
      },
      count: {
        type: Number,
        default: 0,
      },
    },
    totalSold: {
      type: Number,
      default: 0,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'admin',
      required: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'admin',
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
shopProductSchema.index({ name: 1 });
shopProductSchema.index({ category: 1 });
shopProductSchema.index({ isAvailable: 1 });
shopProductSchema.index({ price: 1 });
shopProductSchema.index({ createdAt: -1 });

// Virtual for final price after discount
shopProductSchema.virtual('finalPrice').get(function () {
  if (this.discount > 0) {
    return this.price - (this.price * this.discount) / 100;
  }
  return this.price;
});

// Method to check if product is in stock
shopProductSchema.methods.isInStock = function (quantity = 1) {
  return this.isAvailable && this.stock >= quantity;
};

// Method to reduce stock
shopProductSchema.methods.reduceStock = async function (quantity) {
  if (this.stock >= quantity) {
    this.stock -= quantity;
    this.totalSold += quantity;

    // If stock reaches 0, set isAvailable to false
    if (this.stock === 0) {
      this.isAvailable = false;
      console.log(
        `Product ${this.name} (ID: ${this._id}) is now out of stock and marked as unavailable`
      );
    }

    await this.save();
    return true;
  }
  return false;
};

// Method to increase stock
shopProductSchema.methods.increaseStock = async function (quantity) {
  this.stock += quantity;

  // If stock was 0 before and now it's not, set isAvailable to true
  if (this.stock > 0 && !this.isAvailable) {
    this.isAvailable = true;
    console.log(
      `Product ${this.name} (ID: ${this._id}) now has stock (${this.stock}) and is marked as available`
    );
  }

  await this.save();
};

// Ensure virtuals are included in JSON
shopProductSchema.set('toJSON', { virtuals: true });
shopProductSchema.set('toObject', { virtuals: true });

const ShopProduct = mongoose.model('ShopProduct', shopProductSchema);

module.exports = ShopProduct;
