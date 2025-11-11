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
        'rejected',         // Rejected by driver
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

// Add pre-save hook to update status category
pickupSchema.pre('save', updateStatusCategory);

// Add post-save hook to create transaction when pickup is completed
pickupSchema.post('save', async function(doc) {
  if (doc.picikupStatus === 'completed') {
    try {
      console.log('Pickup completed, checking for existing transaction for pickup:', doc.pickupNumber);
      
      const Transaction = require('./transactions');
      
      // Check if transaction already exists for this pickup
      const existingTransaction = await Transaction.findOne({
        'pickupReferences.pickupId': doc._id,
        transactionType: 'pickupFees'
      });
      
      if (existingTransaction) {
        console.log(`Transaction already exists for pickup ${doc.pickupNumber}`);
        return;
      }
      
      console.log('Creating new transaction for pickup:', doc.pickupNumber);
      
      // Create pickup fee transaction
      const pickupFeeTransaction = new Transaction({
        transactionId: `${Math.floor(100000 + Math.random() * 900000)}`,
        transactionType: 'pickupFees',
        transactionAmount: -doc.pickupFees, // Pickup fees are deducted, so negative
        transactionNotes: `Pickup fees for pickup ${doc.pickupNumber}`,
        ordersDetails: {
          pickupNumber: doc.pickupNumber,
          numberOfOrders: doc.numberOfOrders,
          pickupFees: doc.pickupFees,
          completedDate: new Date(),
          location: doc.pickupLocation || 'Not specified'
        },
        pickupReferences: [{
          pickupId: doc._id,
          pickupNumber: doc.pickupNumber,
          pickupFees: doc.pickupFees,
          completedDate: new Date()
        }],
        business: doc.business,
      });

      await pickupFeeTransaction.save();
      console.log(`Pickup fee transaction created successfully for pickup ${doc.pickupNumber}`);
      
    } catch (error) {
      console.error('Error creating pickup fee transaction in post-save hook:', error);
    }
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
    'rejected': 'Rejected',
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
