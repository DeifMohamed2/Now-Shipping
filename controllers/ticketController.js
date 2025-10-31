const Ticket = require('../models/ticket');
const TicketMessage = require('../models/ticketMessage');
const Order = require('../models/order');
const User = require('../models/user');
const Admin = require('../models/admin');
const cloudinary = require('../utils/cloudinary');

// Create a new ticket
exports.createTicket = async (req, res) => {
  try {
    const {
      subject,
      ticketType,
      priority,
      description,
      relatedOrderNumber,
      tags,
    } = req.body;

    const businessId = req.userId;
    const userType = req.userType;

    // Only businesses can create tickets
    if (userType !== 'user' && userType !== 'business') {
      return res.status(403).json({
        success: false,
        message: 'Only business users can create tickets',
      });
    }

    // Validate required fields
    if (!subject || !ticketType || !description) {
      return res.status(400).json({
        success: false,
        message: 'Subject, ticket type, and description are required',
      });
    }

    // Check if order exists (if provided)
    let relatedOrder = null;
    if (relatedOrderNumber) {
      relatedOrder = await Order.findOne({
        orderNumber: relatedOrderNumber,
        business: businessId,
      });

      if (!relatedOrder) {
        return res.status(404).json({
          success: false,
          message: 'Order not found or does not belong to your business',
        });
      }
    }

    // Generate unique ticket number
    const lastTicket = await Ticket.findOne().sort({ createdAt: -1 });
    let ticketNumber;
    if (lastTicket && lastTicket.ticketNumber) {
      const lastNumber = parseInt(lastTicket.ticketNumber.replace('TKT', ''));
      ticketNumber = `TKT${String(lastNumber + 1).padStart(6, '0')}`;
    } else {
      ticketNumber = 'TKT000001';
    }

    // Create ticket
    const ticket = new Ticket({
      ticketNumber,
      subject,
      ticketType,
      priority: priority || 'medium',
      description,
      business: businessId,
      relatedOrder: relatedOrder ? relatedOrder._id : null,
      relatedOrderNumber: relatedOrderNumber || null,
      tags: tags || [],
      status: 'new',
    });

    await ticket.save();

    // Create initial system message
    const systemMessage = new TicketMessage({
      ticket: ticket._id,
      senderType: 'system',
      senderName: 'System',
      messageType: 'system',
      content: `Ticket ${ticket.ticketNumber} has been created`,
      systemMessageType: 'ticket_created',
    });

    await systemMessage.save();

    // Populate ticket details
    await ticket.populate('business', 'businessInfo name email');
    if (relatedOrder) {
      await ticket.populate('relatedOrder', 'orderNumber orderStatus');
    }

    // Emit socket event to admins
    const io = req.app.get('io');
    if (io) {
      io.to('admins').emit('new_ticket', {
        ticket,
        message: 'New support ticket created',
      });
    }

    res.status(201).json({
      success: true,
      message: 'Ticket created successfully',
      ticket,
    });
  } catch (error) {
    console.error('Error creating ticket:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating ticket',
      error: error.message,
    });
  }
};

// Get all tickets (with filters)
exports.getTickets = async (req, res) => {
  try {
    const {
      status,
      ticketType,
      priority,
      search,
      page = 1,
      limit = 20,
      sortBy = 'lastMessageAt',
      sortOrder = 'desc',
    } = req.query;

    const userType = req.userType;
    const userId = req.userId;

    // Build query
    const query = {};

    // If business user, only show their tickets
    if (userType === 'business') {
      query.business = userId;
    }

    // Filters
    if (status) {
      query.status = status;
    }

    if (ticketType) {
      query.ticketType = ticketType;
    }

    if (priority) {
      query.priority = priority;
    }

    // Search
    if (search) {
      query.$or = [
        { ticketNumber: { $regex: search, $options: 'i' } },
        { subject: { $regex: search, $options: 'i' } },
        { relatedOrderNumber: { $regex: search, $options: 'i' } },
      ];
    }

    // Pagination
    const skip = (page - 1) * limit;
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    // Execute query
    const tickets = await Ticket.find(query)
      .populate('business', 'businessInfo name email phoneNumber')
      .populate('assignedTo', 'name email')
      .populate('relatedOrder', 'orderNumber orderStatus')
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Ticket.countDocuments(query);

    res.status(200).json({
      success: true,
      tickets,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalTickets: total,
        limit: parseInt(limit),
      },
    });
  } catch (error) {
    console.error('Error fetching tickets:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching tickets',
      error: error.message,
    });
  }
};

// Get single ticket by ID
exports.getTicketById = async (req, res) => {
  try {
    const { id: ticketId } = req.params;
    const userType = req.userType;
    const userId = req.userId;

    const ticket = await Ticket.findById(ticketId)
      .populate('business', 'businessInfo name email phoneNumber')
      .populate('assignedTo', 'name email')
      .populate('relatedOrder', 'orderNumber orderStatus orderCustomer');

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found',
      });
    }

    // Check permissions
    if (
      userType === 'business' &&
      ticket.business._id.toString() !== userId.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    res.status(200).json({
      success: true,
      ticket,
    });
  } catch (error) {
    console.error('Error fetching ticket:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching ticket',
      error: error.message,
    });
  }
};

// Update ticket
exports.updateTicket = async (req, res) => {
  try {
    const { id: ticketId } = req.params;
    const { subject, priority, status, tags, assignedTo, internalNote } =
      req.body;

    const userType = req.userType;
    const userId = req.userId;

    const ticket = await Ticket.findById(ticketId);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found',
      });
    }

    // Check permissions
    if (
      userType === 'business' &&
      ticket.business.toString() !== userId.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    // Track changes for system messages
    const changes = [];

    // Update fields
    if (subject && userType !== 'business') {
      ticket.subject = subject;
    }

    if (priority && userType !== 'business') {
      if (ticket.priority !== priority) {
        changes.push(`Priority changed from ${ticket.priority} to ${priority}`);
      }
      ticket.priority = priority;
    }

    if (status && userType !== 'business') {
      if (ticket.status !== status) {
        changes.push(`Status changed from ${ticket.status} to ${status}`);

        // Update status-specific fields
        if (status === 'resolved') {
          ticket.resolvedAt = new Date();
          ticket.resolvedBy = userId;
        } else if (status === 'closed') {
          ticket.closedAt = new Date();
          ticket.closedBy = userId;
        }
      }
      ticket.status = status;

      // Add to status history
      ticket.statusHistory.push({
        status,
        changedBy: {
          userType: userType === 'business' ? 'business' : 'admin',
          userId,
        },
        changedAt: new Date(),
      });
    }

    if (tags) {
      ticket.tags = tags;
    }

    if (assignedTo !== undefined && userType !== 'business') {
      if (ticket.assignedTo?.toString() !== assignedTo) {
        ticket.assignedTo = assignedTo || null;
        ticket.assignedAt = assignedTo ? new Date() : null;

        if (assignedTo) {
          changes.push(`Ticket assigned to admin`);
        } else {
          changes.push(`Ticket unassigned`);
        }
      }
    }

    // Add internal note (admin only)
    if (internalNote && userType !== 'business') {
      ticket.internalNotes.push({
        note: internalNote,
        addedBy: userId,
        addedAt: new Date(),
      });
    }

    await ticket.save();

    // Create system messages for changes
    if (changes.length > 0) {
      for (const change of changes) {
        const systemMessage = new TicketMessage({
          ticket: ticket._id,
          senderType: 'system',
          senderName: 'System',
          messageType: 'system',
          content: change,
          systemMessageType:
            status === 'resolved'
              ? 'ticket_resolved'
              : status === 'closed'
              ? 'ticket_closed'
              : assignedTo
              ? 'ticket_assigned'
              : priority
              ? 'priority_changed'
              : 'status_changed',
        });
        await systemMessage.save();
      }
    }

    // Populate updated ticket
    await ticket.populate('business', 'businessInfo name email');
    await ticket.populate('assignedTo', 'name email');

    // Emit socket event
    const io = req.app.get('io');
    if (io) {
      io.to(`ticket_${ticket._id}`).emit('ticket_updated', {
        ticketId: ticket._id,
        ticket,
      });
    }

    res.status(200).json({
      success: true,
      message: 'Ticket updated successfully',
      ticket,
    });
  } catch (error) {
    console.error('Error updating ticket:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating ticket',
      error: error.message,
    });
  }
};

// Delete ticket (admin only)
exports.deleteTicket = async (req, res) => {
  try {
    const { id: ticketId } = req.params;
    const userType = req.userType;

    if (userType === 'business') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can delete tickets',
      });
    }

    const ticket = await Ticket.findById(ticketId);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found',
      });
    }

    // Delete all messages associated with this ticket
    await TicketMessage.deleteMany({ ticket: ticketId });

    // Delete ticket
    await ticket.deleteOne();

    // Emit socket event
    const io = req.app.get('io');
    if (io) {
      io.to(`ticket_${ticketId}`).emit('ticket_deleted', {
        ticketId,
      });
    }

    res.status(200).json({
      success: true,
      message: 'Ticket deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting ticket:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting ticket',
      error: error.message,
    });
  }
};

// Get messages for a ticket
exports.getTicketMessages = async (req, res) => {
  try {
    const { id: ticketId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    const userType = req.userType;
    const userId = req.userId;

    // Check ticket exists and permissions
    const ticket = await Ticket.findById(ticketId);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found',
      });
    }

    if (
      userType === 'business' &&
      ticket.business.toString() !== userId.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    // Pagination
    const skip = (page - 1) * limit;

    // Query messages
    const query = {
      ticket: ticketId,
      isDeleted: false,
    };

    // Hide internal messages from business users
    if (userType === 'business') {
      query.isInternal = false;
    }

    const messages = await TicketMessage.find(query)
      .populate('senderId', 'businessInfo name email')
      .populate('replyTo', 'content senderName')
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await TicketMessage.countDocuments(query);

    // Mark messages as read
    await TicketMessage.markAllAsRead(ticketId, userId, userType);

    // Update ticket unread count
    if (userType === 'business') {
      ticket.unreadCountBusiness = 0;
    } else {
      ticket.unreadCountAdmin = 0;
    }
    await ticket.save();

    res.status(200).json({
      success: true,
      messages,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalMessages: total,
        limit: parseInt(limit),
      },
    });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching messages',
      error: error.message,
    });
  }
};

// Send a message
exports.sendMessage = async (req, res) => {
  try {
    const { id: ticketId } = req.params;
    const {
      content,
      messageType = 'text',
      replyTo,
      isInternal = false,
      attachmentUrl,
    } = req.body;

    const userType = req.userType;
    const userId = req.userId;

    // Get sender name based on user type
    let senderName = 'Unknown';
    if (userType === 'admin') {
      const admin = await Admin.findById(userId);
      senderName = admin?.name || 'Admin';
    } else {
      const user = await User.findById(userId);
      senderName =
        user?.businessInfo?.businessName || user?.name || 'Business User';
    }

    // Check ticket exists and permissions
    const ticket = await Ticket.findById(ticketId);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found',
      });
    }

    if (
      userType === 'business' &&
      ticket.business.toString() !== userId.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    // Business users cannot send internal messages
    const actualIsInternal = userType === 'business' ? false : isInternal;

    // Handle attachments if provided
    let attachments = [];
    if (attachmentUrl && messageType === 'image') {
      attachments.push({
        type: 'image',
        url: attachmentUrl,
        filename: attachmentUrl.split('/').pop() || 'image',
        mimetype: 'image/jpeg',
      });
    }

    // Create message
    const message = new TicketMessage({
      ticket: ticketId,
      senderType: userType === 'business' ? 'business' : 'admin',
      senderId: userId,
      senderModel: userType === 'business' ? 'users' : 'admin',
      senderName,
      messageType,
      content,
      attachments,
      replyTo: replyTo || null,
      isInternal: actualIsInternal,
    });

    await message.save();

    // Update ticket
    ticket.lastMessageAt = new Date();
    ticket.lastMessageBy = userType === 'business' ? 'business' : 'admin';

    // Increment unread count for the other party
    if (userType === 'business') {
      ticket.unreadCountAdmin += 1;
    } else {
      ticket.unreadCountBusiness += 1;
    }

    // If ticket is closed/resolved, reopen it
    if (ticket.status === 'closed' || ticket.status === 'resolved') {
      ticket.status = 'reopened';
      ticket.statusHistory.push({
        status: 'reopened',
        changedBy: {
          userType: userType === 'business' ? 'business' : 'admin',
          userId,
        },
        changedAt: new Date(),
      });
    }

    await ticket.save();

    // Populate message
    await message.populate('senderId', 'businessInfo name email');
    if (replyTo) {
      await message.populate('replyTo', 'content senderName');
    }

    // Emit socket event to all users in the ticket room
    const io = req.app.get('io');
    if (io) {
      console.log(`Emitting new_ticket_message to room ticket_${ticketId}`);
      console.log('Message data:', {
        ticketId,
        senderType: message.senderType,
        content: message.content,
      });

      // Emit to everyone in the ticket room
      io.to(`ticket_${ticketId}`).emit('new_ticket_message', {
        ticketId,
        message,
      });

      console.log(`Socket event emitted successfully`);
    } else {
      console.log('Warning: Socket.IO instance not available');
    }

    res.status(201).json({
      success: true,
      message: message,
    });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({
      success: false,
      message: 'Error sending message',
      error: error.message,
    });
  }
};

// Upload file/image to message
exports.uploadMessageAttachment = async (req, res) => {
  try {
    const { id: ticketId } = req.params;
    const { messageId } = req.body;

    const userType = req.userType;
    const userId = req.userId;

    // Check ticket exists and permissions
    const ticket = await Ticket.findById(ticketId);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found',
      });
    }

    if (
      userType === 'business' &&
      ticket.business.toString() !== userId.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files uploaded',
      });
    }

    // Upload files to Cloudinary
    const uploadPromises = req.files.map(async (file) => {
      const result = await cloudinary.uploader.upload(file.path, {
        folder: 'tickets',
        resource_type: 'auto',
      });

      // Determine file type
      let fileType = 'file';
      if (result.resource_type === 'image') {
        fileType = 'image';
      } else if (result.resource_type === 'video') {
        fileType = 'video';
      } else if (result.format === 'mp3' || result.format === 'wav') {
        fileType = 'audio';
      }

      return {
        type: fileType,
        url: result.secure_url,
        publicId: result.public_id,
        filename: file.originalname,
        filesize: file.size,
        mimetype: file.mimetype,
        thumbnailUrl:
          result.resource_type === 'video'
            ? result.secure_url.replace(/\.[^/.]+$/, '.jpg')
            : null,
      };
    });

    const attachments = await Promise.all(uploadPromises);

    // If messageId provided, update existing message
    if (messageId) {
      const message = await TicketMessage.findById(messageId);

      if (!message) {
        return res.status(404).json({
          success: false,
          message: 'Message not found',
        });
      }

      message.attachments.push(...attachments);
      await message.save();

      // Emit socket event
      const io = req.app.get('io');
      if (io) {
        io.to(`ticket_${ticketId}`).emit('message_updated', {
          ticketId,
          message,
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Attachments uploaded successfully',
        attachments,
        messageId: message._id,
      });
    }

    // Otherwise, return attachments to be added to new message
    res.status(200).json({
      success: true,
      attachments,
    });
  } catch (error) {
    console.error('Error uploading attachment:', error);
    res.status(500).json({
      success: false,
      message: 'Error uploading attachment',
      error: error.message,
    });
  }
};

// Rate ticket (business only)
exports.rateTicket = async (req, res) => {
  try {
    const { id: ticketId } = req.params;
    const { rating, comment } = req.body;

    const userType = req.userType;
    const userId = req.userId;

    if (userType !== 'business') {
      return res.status(403).json({
        success: false,
        message: 'Only businesses can rate tickets',
      });
    }

    const ticket = await Ticket.findById(ticketId);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found',
      });
    }

    if (ticket.business.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    if (ticket.status !== 'resolved' && ticket.status !== 'closed') {
      return res.status(400).json({
        success: false,
        message: 'Can only rate resolved or closed tickets',
      });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        message: 'Rating must be between 1 and 5',
      });
    }

    ticket.rating = rating;
    ticket.ratingComment = comment || '';
    ticket.ratedAt = new Date();

    await ticket.save();

    res.status(200).json({
      success: true,
      message: 'Ticket rated successfully',
      ticket,
    });
  } catch (error) {
    console.error('Error rating ticket:', error);
    res.status(500).json({
      success: false,
      message: 'Error rating ticket',
      error: error.message,
    });
  }
};

// Get ticket statistics
exports.getTicketStatistics = async (req, res) => {
  try {
    const userType = req.userType;
    const userId = req.userId;

    const businessId = userType === 'business' ? userId : null;
    const stats = await Ticket.getStatistics(businessId);

    // Additional statistics
    const avgResponseTime = await TicketMessage.aggregate([
      {
        $match: {
          senderType: 'admin',
          createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }, // Last 30 days
        },
      },
      {
        $lookup: {
          from: 'tickets',
          localField: 'ticket',
          foreignField: '_id',
          as: 'ticketData',
        },
      },
      {
        $unwind: '$ticketData',
      },
      {
        $group: {
          _id: null,
          avgTime: {
            $avg: {
              $subtract: ['$createdAt', '$ticketData.createdAt'],
            },
          },
        },
      },
    ]);

    const avgResolutionTime = await Ticket.aggregate([
      {
        $match: {
          status: { $in: ['resolved', 'closed'] },
          resolvedAt: { $exists: true },
        },
      },
      {
        $group: {
          _id: null,
          avgTime: {
            $avg: {
              $subtract: ['$resolvedAt', '$createdAt'],
            },
          },
        },
      },
    ]);

    res.status(200).json({
      success: true,
      statistics: {
        ...stats,
        averageResponseTime:
          avgResponseTime.length > 0
            ? Math.round(avgResponseTime[0].avgTime / (1000 * 60))
            : 0, // in minutes
        averageResolutionTime:
          avgResolutionTime.length > 0
            ? Math.round(avgResolutionTime[0].avgTime / (1000 * 60 * 60))
            : 0, // in hours
      },
    });
  } catch (error) {
    console.error('Error fetching statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching statistics',
      error: error.message,
    });
  }
};

// Search orders for ticket creation
exports.searchOrders = async (req, res) => {
  try {
    const { query } = req.query;
    const userId = req.userId;

    if (!query || query.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Query must be at least 2 characters',
      });
    }

    const orders = await Order.find({
      business: userId,
      $or: [
        { orderNumber: { $regex: query, $options: 'i' } },
        { 'orderCustomer.fullName': { $regex: query, $options: 'i' } },
        { 'orderCustomer.phoneNumber': { $regex: query, $options: 'i' } },
      ],
    })
      .select('orderNumber orderStatus orderCustomer orderDate')
      .limit(10)
      .sort({ orderDate: -1 });

    res.status(200).json({
      success: true,
      orders,
    });
  } catch (error) {
    console.error('Error searching orders:', error);
    res.status(500).json({
      success: false,
      message: 'Error searching orders',
      error: error.message,
    });
  }
};
