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

// Pre-save middleware to update status category based on pickup status
const updateStatusCategory = function(next) {
  if (this.isModified('picikupStatus')) {
    const status = this.picikupStatus;
    
    // NEW category
    if (['new', 'pendingPickup', 'driverAssigned'].includes(status)) {
      this.statusCategory = 'NEW';
    }
    // PROCESSING category
    else if (['pickedUp', 'inStock', 'inProgress'].includes(status)) {
      this.statusCategory = 'PROCESSING';
    }
    // SUCCESSFUL category
    else if (['completed'].includes(status)) {
      this.statusCategory = 'SUCCESSFUL';
    }
    // UNSUCCESSFUL category
    else if (['canceled', 'rejected', 'returned', 'terminated'].includes(status)) {
      this.statusCategory = 'UNSUCCESSFUL';
    }
  }
  
  if (next) next();
};

const pickupSchema = new Schema(
  {
    pickupNumber: {
      type: String,
      required: true,
      unique: true,
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
        // NEW category
        'new',              // Initial state
        'pendingPickup',    // Waiting for pickup
        'driverAssigned',   // Driver assigned but not yet picked up
        
        // PROCESSING category
        'pickedUp',         // Picked up from business
        'inStock',          // In warehouse
        'inProgress',       // Being processed
        
        // SUCCESSFUL category
        'completed',        // Successfully completed
        
        // UNSUCCESSFUL category
        'canceled',         // Canceled
        'rejected',         // Driver declined pickup (distinct from order customer-refused)
        'returned',         // Returned to business
        'terminated',       // Terminated
      ],
    },
    
    // New field for status category
    statusCategory: {
      type: String,
      enum: ['NEW', 'PROCESSING', 'PAUSED', 'SUCCESSFUL', 'UNSUCCESSFUL'],
      required: true,
      default: 'NEW'
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
    },
    // Selected pickup address ID
    pickupAddressId: {
      type: String,
      required: false,
    }

    
  },
  { timestamps: true }
);

/** Strips duplicate ids (must run before the ordersPickedUp custom validator on save). */
function dedupeOrdersPickedUpArray(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return arr;
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const id = item && item._id ? item._id : item;
    if (!id) continue;
    const s = id.toString();
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(id);
  }
  return out;
}

pickupSchema.pre('validate', function (next) {
  if (Array.isArray(this.ordersPickedUp) && this.ordersPickedUp.length > 0) {
    this.ordersPickedUp = dedupeOrdersPickedUpArray(this.ordersPickedUp);
  }
  if (next) next();
});

// Add pre-save hook to update status category
pickupSchema.pre('save', updateStatusCategory);

// Charge pickup fee in the wallet when the courier finishes collecting from the business (pickedUp),
// not when the pickup run is later marked completed at the warehouse.
pickupSchema.post('save', async function (doc) {
  if (doc.picikupStatus === 'pickedUp' && doc.pickupFees > 0) {
    const { createPickupEntry } = require('../utils/ledgerService');
    await createPickupEntry(doc);
  }
});

// Add pickup status history tracking
pickupSchema.add({
  statusHistory: [
    {
      status: { type: String, required: true },
      category: { 
        type: String,
        enum: ['NEW', 'PROCESSING', 'PAUSED', 'SUCCESSFUL', 'UNSUCCESSFUL']
      },
      date: { type: Date, default: Date.now, required: true },
      notes: { type: String }
    }
  ]
});

// Update status history when status changes
pickupSchema.pre('save', function(next) {
  if (this.isModified('picikupStatus')) {
    this.statusHistory = this.statusHistory || [];
    this.statusHistory.push({
      status: this.picikupStatus,
      category: this.statusCategory,
      date: new Date(),
      notes: `Status changed to ${this.getStatusDescription()}`
    });
  }
  next();
});

// Add a method to get human-readable status description
pickupSchema.methods.getStatusDescription = function() {
  const statusMap = {
    'new': 'New Pickup Request',
    'pendingPickup': 'Pending Pickup',
    'driverAssigned': 'Driver Assigned',
    'pickedUp': 'Picked Up',
    'inStock': 'In Warehouse',
    'inProgress': 'In Progress',
    'completed': 'Completed',
    'canceled': 'Canceled',
    'rejected': 'Declined by driver',
    'returned': 'Returned',
    'terminated': 'Terminated'
  };
  
  return statusMap[this.picikupStatus] || this.picikupStatus;
};

// Add a method to get status category description
pickupSchema.methods.getCategoryDescription = function() {
  const categoryMap = {
    'NEW': 'New',
    'PROCESSING': 'Processing',
    'PAUSED': 'Paused',
    'SUCCESSFUL': 'Successful',
    'UNSUCCESSFUL': 'Unsuccessful'
  };
  
  return categoryMap[this.statusCategory] || this.statusCategory;
};





const Pickup = mongoose.model('Pickup', pickupSchema);

module.exports = Pickup;
