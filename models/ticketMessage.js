const mongoose = require('mongoose');

const ticketMessageSchema = new mongoose.Schema(
  {
    ticket: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Ticket',
      required: true,
      index: true,
    },
    // Sender information
    senderType: {
      type: String,
      required: true,
      enum: ['business', 'admin', 'system'],
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      required: function () {
        return this.senderType !== 'system';
      },
      refPath: 'senderModel',
    },
    senderModel: {
      type: String,
      required: function () {
        return this.senderType !== 'system';
      },
      enum: ['users', 'admin'],
    },
    senderName: {
      type: String,
      required: true,
    },
    // Message content
    messageType: {
      type: String,
      required: true,
      enum: ['text', 'image', 'file', 'system', 'audio', 'video'],
      default: 'text',
    },
    content: {
      type: String,
      required: function () {
        return this.messageType === 'text' || this.messageType === 'system';
      },
      trim: true,
    },
    // File/Media attachments
    attachments: [
      {
        type: {
          type: String,
          enum: ['image', 'file', 'audio', 'video'],
          required: true,
        },
        url: {
          type: String,
          required: true,
        },
        publicId: {
          type: String,
          required: false, // Cloudinary public ID for deletion
        },
        filename: {
          type: String,
          required: true,
        },
        filesize: {
          type: Number,
          required: false,
        },
        mimetype: {
          type: String,
          required: false,
        },
        thumbnailUrl: {
          type: String,
          required: false, // For video/image previews
        },
      },
    ],
    // Read status
    isRead: {
      type: Boolean,
      default: false,
    },
    readAt: {
      type: Date,
      required: false,
    },
    readBy: [
      {
        userType: {
          type: String,
          enum: ['business', 'admin'],
          required: true,
        },
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          required: true,
        },
        readAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    // Message metadata
    isEdited: {
      type: Boolean,
      default: false,
    },
    editedAt: {
      type: Date,
      required: false,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
      required: false,
    },
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      required: false,
    },
    // Reply/Thread support
    replyTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TicketMessage',
      required: false,
    },
    // System message metadata
    systemMessageType: {
      type: String,
      enum: [
        'ticket_created',
        'ticket_assigned',
        'status_changed',
        'priority_changed',
        'ticket_resolved',
        'ticket_closed',
        'ticket_reopened',
        'auto_response',
      ],
      required: function () {
        return this.senderType === 'system';
      },
    },
    // Internal flag (visible only to admins)
    isInternal: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for better query performance
ticketMessageSchema.index({ ticket: 1, createdAt: 1 });
ticketMessageSchema.index({ senderType: 1, senderId: 1 });
ticketMessageSchema.index({ isRead: 1 });
ticketMessageSchema.index({ createdAt: -1 });

// Update ticket's lastMessageAt when new message is created
ticketMessageSchema.post('save', async function () {
  try {
    const Ticket = mongoose.model('Ticket');
    await Ticket.findByIdAndUpdate(this.ticket, {
      lastMessageAt: this.createdAt,
      lastMessageBy: this.senderType,
    });
  } catch (error) {
    console.error('Error updating ticket lastMessageAt:', error);
  }
});

// Method to mark message as read
ticketMessageSchema.methods.markAsRead = async function (userId, userType) {
  if (!this.isRead) {
    this.isRead = true;
    this.readAt = new Date();
  }

  // Add to readBy array if not already present
  const alreadyRead = this.readBy.some(
    (r) => r.userId.toString() === userId.toString() && r.userType === userType
  );

  if (!alreadyRead) {
    this.readBy.push({
      userId,
      userType,
      readAt: new Date(),
    });
  }

  return this.save();
};

// Static method to get unread count for a ticket
ticketMessageSchema.statics.getUnreadCount = async function (
  ticketId,
  userType,
  userId
) {
  return this.countDocuments({
    ticket: ticketId,
    senderType: { $ne: userType },
    'readBy.userId': { $ne: userId },
  });
};

// Static method to mark all messages in a ticket as read
ticketMessageSchema.statics.markAllAsRead = async function (
  ticketId,
  userId,
  userType
) {
  const messages = await this.find({
    ticket: ticketId,
    senderType: { $ne: userType },
    'readBy.userId': { $ne: userId },
  });

  const updatePromises = messages.map((message) => {
    if (!message.isRead) {
      message.isRead = true;
      message.readAt = new Date();
    }

    const alreadyRead = message.readBy.some(
      (r) =>
        r.userId.toString() === userId.toString() && r.userType === userType
    );

    if (!alreadyRead) {
      message.readBy.push({
        userId,
        userType,
        readAt: new Date(),
      });
    }

    return message.save();
  });

  await Promise.all(updatePromises);
  return messages.length;
};

const TicketMessage = mongoose.model('TicketMessage', ticketMessageSchema);

module.exports = TicketMessage;
