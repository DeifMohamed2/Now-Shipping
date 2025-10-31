const mongoose = require('mongoose');

const ticketSchema = new mongoose.Schema(
  {
    ticketNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    ticketType: {
      type: String,
      required: true,
      enum: [
        'order_issue', // Problems with specific order
        'delivery_issue', // Delivery problems
        'payment_issue', // Payment/billing issues
        'return_request', // Return/exchange requests
        'technical_support', // Technical problems
        'account_issue', // Account related issues
        'general_inquiry', // General questions
        'complaint', // Complaints
        'feature_request', // Feature suggestions
        'other', // Other issues
      ],
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'urgent'],
      default: 'medium',
    },
    status: {
      type: String,
      required: true,
      enum: [
        'new',
        'open',
        'pending',
        'in_progress',
        'resolved',
        'closed',
        'reopened',
      ],
      default: 'new',
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    // Business who created the ticket
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      required: true,
      index: true,
    },
    // Optional: Link to specific order if ticket is order-related
    relatedOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'order',
      required: false,
      index: true,
    },
    relatedOrderNumber: {
      type: String,
      required: false,
    },
    // Admin assigned to handle this ticket
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'admin',
      required: false,
      index: true,
    },
    assignedAt: {
      type: Date,
      required: false,
    },
    // Tracking
    lastMessageAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    lastMessageBy: {
      type: String,
      enum: ['business', 'admin', 'system'],
      required: false,
    },
    resolvedAt: {
      type: Date,
      required: false,
    },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'admin',
      required: false,
    },
    closedAt: {
      type: Date,
      required: false,
    },
    closedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'admin',
      required: false,
    },
    // Satisfaction rating (1-5 stars)
    rating: {
      type: Number,
      min: 1,
      max: 5,
      required: false,
    },
    ratingComment: {
      type: String,
      required: false,
    },
    ratedAt: {
      type: Date,
      required: false,
    },
    // Metadata
    tags: [
      {
        type: String,
        trim: true,
      },
    ],
    isUrgent: {
      type: Boolean,
      default: false,
    },
    isFlagged: {
      type: Boolean,
      default: false,
    },
    // Automated response
    hasAutoResponse: {
      type: Boolean,
      default: false,
    },
    // Unread count for business
    unreadCountBusiness: {
      type: Number,
      default: 0,
    },
    // Unread count for admin
    unreadCountAdmin: {
      type: Number,
      default: 0,
    },
    // Status history
    statusHistory: [
      {
        status: {
          type: String,
          required: true,
        },
        changedBy: {
          userType: {
            type: String,
            enum: ['business', 'admin', 'system'],
            required: true,
          },
          userId: {
            type: mongoose.Schema.Types.ObjectId,
            required: false,
          },
        },
        changedAt: {
          type: Date,
          default: Date.now,
        },
        notes: {
          type: String,
          required: false,
        },
      },
    ],
    // Internal notes (visible only to admins)
    internalNotes: [
      {
        note: {
          type: String,
          required: true,
        },
        addedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'admin',
          required: true,
        },
        addedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Indexes for better query performance
ticketSchema.index({ business: 1, status: 1 });
ticketSchema.index({ assignedTo: 1, status: 1 });
ticketSchema.index({ ticketType: 1, status: 1 });
ticketSchema.index({ createdAt: -1 });
ticketSchema.index({ lastMessageAt: -1 });
ticketSchema.index({ priority: 1, status: 1 });

// Generate ticket number before saving
ticketSchema.pre('save', async function (next) {
  if (!this.ticketNumber) {
    const count = await mongoose.model('Ticket').countDocuments();
    const prefix = 'TKT';
    const timestamp = Date.now().toString().slice(-6);
    const randomNum = Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, '0');
    this.ticketNumber = `${prefix}-${timestamp}-${randomNum}`;
  }
  next();
});

// Update lastMessageAt when status changes
ticketSchema.pre('save', function (next) {
  if (this.isModified('status') && !this.isNew) {
    this.statusHistory.push({
      status: this.status,
      changedBy: {
        userType: 'system',
        userId: null,
      },
      changedAt: new Date(),
    });
  }
  next();
});

// Virtual for message count
ticketSchema.virtual('messageCount', {
  ref: 'TicketMessage',
  localField: '_id',
  foreignField: 'ticket',
  count: true,
});

// Method to mark as read
ticketSchema.methods.markAsRead = function (userType) {
  if (userType === 'business') {
    this.unreadCountBusiness = 0;
  } else if (userType === 'admin') {
    this.unreadCountAdmin = 0;
  }
  return this.save();
};

// Method to increment unread count
ticketSchema.methods.incrementUnread = function (userType) {
  if (userType === 'business') {
    this.unreadCountBusiness += 1;
  } else if (userType === 'admin') {
    this.unreadCountAdmin += 1;
  }
  return this.save();
};

// Static method to get ticket statistics
ticketSchema.statics.getStatistics = async function (businessId = null) {
  const match = businessId ? { business: businessId } : {};

  const stats = await this.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
      },
    },
  ]);

  const result = {
    total: 0,
    new: 0,
    open: 0,
    pending: 0,
    in_progress: 0,
    resolved: 0,
    closed: 0,
    reopened: 0,
  };

  stats.forEach((stat) => {
    result[stat._id] = stat.count;
    result.total += stat.count;
  });

  return result;
};

const Ticket = mongoose.model('Ticket', ticketSchema);

module.exports = Ticket;
