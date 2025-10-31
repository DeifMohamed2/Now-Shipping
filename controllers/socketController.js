const socketIO = require('socket.io');
const jwt = require('jsonwebtoken');
const Courier = require('../models/courier');
const Ticket = require('../models/ticket');
const TicketMessage = require('../models/ticketMessage');
const User = require('../models/user');
const Admin = require('../models/admin');
const cookie = require('cookie');

let io;

// Initialize Socket.IO
const initializeSocket = (server) => {
  io = socketIO(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 30000,
    pingInterval: 10000,
    cookie: false,
  });

  // Log socket.io server initialization
  console.log('Socket.IO server initialized');

  // Authentication middleware
  io.use(async (socket, next) => {
    try {
      // Check if this is an admin panel connection
      if (socket.handshake.auth.adminPanel === true) {
        // Get token from cookie
        const cookies = cookie.parse(socket.handshake.headers.cookie || '');
        const token = cookies.token;

        if (token) {
          try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            socket.userId = decoded.adminId || decoded.userId;
            socket.userType = 'admin';
            console.log(`Admin panel connected: ${socket.userId}`);
            return next();
          } catch (err) {
            console.log('Admin panel auth failed: Invalid token');
          }
        }

        // Fallback if token verification fails
        socket.userId = 'admin-panel';
        socket.userType = 'admin';
        console.log(`Admin panel connected (fallback): ${socket.id}`);
        return next();
      }

      // Check if this is a business panel connection (for tickets)
      if (socket.handshake.auth.businessPanel === true) {
        // Get token from cookie
        const cookies = cookie.parse(socket.handshake.headers.cookie || '');
        const token = cookies.token;

        if (token) {
          try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            socket.userId = decoded.userId;
            socket.userType = 'business';
            console.log(`Business panel connected: ${socket.userId}`);
            return next();
          } catch (err) {
            console.log('Business panel auth failed: Invalid token');
            return next(new Error('Authentication error: Invalid token'));
          }
        } else {
          console.log('Business panel auth failed: No token in cookie');
          return next(new Error('Authentication error: No token'));
        }
      }

      // For mobile app connections, verify JWT token
      const token = socket.handshake.auth.token;

      if (!token) {
        console.log('Socket auth failed: No token provided');
        return next(new Error('Authentication error: Token not provided'));
      }

      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.userId = decoded.id;
        socket.userType = decoded.userType;

        console.log(
          `Socket auth successful: ${socket.userType} ${socket.userId}`
        );
        next();
      } catch (jwtError) {
        console.log(`Socket auth failed: Invalid token - ${jwtError.message}`);
        return next(new Error('Authentication error: Invalid token'));
      }
    } catch (error) {
      console.log(`Socket auth error: ${error.message}`);
      return next(new Error(`Authentication error: ${error.message}`));
    }
  });

  // Handle connection events
  io.on('connection', (socket) => {
    console.log(
      `User connected: ${socket.userId}, Type: ${socket.userType}, Transport: ${socket.conn.transport.name}`
    );

    // Join room based on user type
    if (socket.userType === 'courier') {
      socket.join(`courier:${socket.userId}`);
      console.log(`Courier ${socket.userId} joined their room`);

      // When a courier connects, immediately send their current status to admin
      sendCourierStatusToAdmin(socket.userId);
    } else if (socket.userType === 'admin') {
      socket.join('admin');
      socket.join('admins'); // For ticket notifications
      console.log(`Admin ${socket.userId} joined admin room`);

      // Send all active courier locations to the admin when they connect
      sendAllCourierLocationsToAdmin(socket);
    } else if (socket.userType === 'business') {
      socket.join(`business:${socket.userId}`);
      console.log(`Business ${socket.userId} joined their room`);
    }

    // ==================== TICKET SOCKET HANDLERS ====================

    // Join ticket room
    socket.on('join_ticket', async (data) => {
      try {
        const { ticketId } = data;

        if (!ticketId) {
          return socket.emit('error', { message: 'Ticket ID is required' });
        }

        // Verify user has access to this ticket
        const ticket = await Ticket.findById(ticketId);

        if (!ticket) {
          return socket.emit('error', { message: 'Ticket not found' });
        }

        // Check permissions
        const hasAccess =
          socket.userType === 'admin' ||
          (socket.userType === 'business' &&
            ticket.business.toString() === socket.userId);

        if (!hasAccess) {
          return socket.emit('error', {
            message: 'Access denied to this ticket',
          });
        }

        // Join ticket room
        socket.join(`ticket_${ticketId}`);
        console.log(
          `${socket.userType} ${socket.userId} joined ticket ${ticketId}`
        );

        // Notify others in the room
        socket.to(`ticket_${ticketId}`).emit('user_joined_ticket', {
          userId: socket.userId,
          userType: socket.userType,
          timestamp: new Date(),
        });
      } catch (error) {
        console.error('Error joining ticket room:', error);
        socket.emit('error', { message: 'Error joining ticket room' });
      }
    });

    // Leave ticket room
    socket.on('leave_ticket', (data) => {
      try {
        const { ticketId } = data;

        if (ticketId) {
          socket.leave(`ticket_${ticketId}`);
          console.log(
            `${socket.userType} ${socket.userId} left ticket ${ticketId}`
          );

          // Notify others in the room
          socket.to(`ticket_${ticketId}`).emit('user_left_ticket', {
            userId: socket.userId,
            userType: socket.userType,
            timestamp: new Date(),
          });
        }
      } catch (error) {
        console.error('Error leaving ticket room:', error);
      }
    });

    // Typing indicator
    socket.on('ticket_typing', (data) => {
      try {
        const { ticketId, isTyping } = data;

        if (!ticketId) return;

        // Broadcast to others in the room (not to self)
        socket.to(`ticket_${ticketId}`).emit('user_typing', {
          userId: socket.userId,
          userType: socket.userType,
          isTyping,
          timestamp: new Date(),
        });
      } catch (error) {
        console.error('Error handling typing indicator:', error);
      }
    });

    // Send message via socket (alternative to REST API)
    socket.on('send_ticket_message', async (data) => {
      try {
        const {
          ticketId,
          content,
          messageType = 'text',
          replyTo,
          isInternal = false,
          attachmentUrl,
        } = data;

        if (!ticketId || (!content && !attachmentUrl)) {
          return socket.emit('error', {
            message: 'Ticket ID and content or attachment are required',
          });
        }

        // Verify ticket access
        const ticket = await Ticket.findById(ticketId);

        if (!ticket) {
          return socket.emit('error', { message: 'Ticket not found' });
        }

        const hasAccess =
          socket.userType === 'admin' ||
          (socket.userType === 'business' &&
            ticket.business.toString() === socket.userId);

        if (!hasAccess) {
          return socket.emit('error', { message: 'Access denied' });
        }

        // Get sender name
        const senderName = socket.userName || 'Unknown';

        // Business users cannot send internal messages
        const actualIsInternal =
          socket.userType === 'business' ? false : isInternal;

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
          senderType: socket.userType === 'business' ? 'business' : 'admin',
          senderId: socket.userId,
          senderModel: socket.userType === 'business' ? 'users' : 'admin',
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
        ticket.lastMessageBy =
          socket.userType === 'business' ? 'business' : 'admin';

        // Increment unread count
        if (socket.userType === 'business') {
          ticket.unreadCountAdmin += 1;
        } else {
          ticket.unreadCountBusiness += 1;
        }

        // Reopen if closed/resolved
        if (ticket.status === 'closed' || ticket.status === 'resolved') {
          ticket.status = 'reopened';
          ticket.statusHistory.push({
            status: 'reopened',
            changedBy: {
              userType: socket.userType === 'business' ? 'business' : 'admin',
              userId: socket.userId,
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

        // Broadcast to ticket room
        io.to(`ticket_${ticketId}`).emit('new_message', {
          message,
          ticket,
        });

        // Notify the other party
        if (socket.userType === 'business') {
          io.to('admins').emit('new_ticket_message', {
            ticketId,
            ticketNumber: ticket.ticketNumber,
            message,
          });
        } else {
          io.to(`business:${ticket.business}`).emit('new_ticket_message', {
            ticketId,
            ticketNumber: ticket.ticketNumber,
            message,
          });
        }

        console.log(
          `Message sent to ticket ${ticketId} by ${socket.userType} ${socket.userId}`
        );
      } catch (error) {
        console.error('Error sending ticket message:', error);
        socket.emit('error', { message: 'Error sending message' });
      }
    });

    // Mark messages as read
    socket.on('mark_messages_read', async (data) => {
      try {
        const { ticketId } = data;

        if (!ticketId) return;

        // Verify access
        const ticket = await Ticket.findById(ticketId);

        if (!ticket) return;

        const hasAccess =
          socket.userType === 'admin' ||
          (socket.userType === 'business' &&
            ticket.business.toString() === socket.userId);

        if (!hasAccess) return;

        // Mark all messages as read
        await TicketMessage.markAllAsRead(
          ticketId,
          socket.userId,
          socket.userType
        );

        // Update ticket unread count
        if (socket.userType === 'business') {
          ticket.unreadCountBusiness = 0;
        } else {
          ticket.unreadCountAdmin = 0;
        }
        await ticket.save();

        // Notify others in the room
        socket.to(`ticket_${ticketId}`).emit('messages_read', {
          userId: socket.userId,
          userType: socket.userType,
          timestamp: new Date(),
        });
      } catch (error) {
        console.error('Error marking messages as read:', error);
      }
    });

    // Update ticket status
    socket.on('update_ticket_status', async (data) => {
      try {
        const { ticketId, status } = data;

        if (!ticketId || !status) return;

        // Only admins can update ticket status
        if (socket.userType !== 'admin') {
          return socket.emit('error', {
            message: 'Only admins can update ticket status',
          });
        }

        const ticket = await Ticket.findById(ticketId);

        if (!ticket) {
          return socket.emit('error', { message: 'Ticket not found' });
        }

        const oldStatus = ticket.status;
        ticket.status = status;

        // Update status-specific fields
        if (status === 'resolved') {
          ticket.resolvedAt = new Date();
          ticket.resolvedBy = socket.userId;
        } else if (status === 'closed') {
          ticket.closedAt = new Date();
          ticket.closedBy = socket.userId;
        }

        // Add to status history
        ticket.statusHistory.push({
          status,
          changedBy: {
            userType: 'admin',
            userId: socket.userId,
          },
          changedAt: new Date(),
        });

        await ticket.save();

        // Create system message
        const systemMessage = new TicketMessage({
          ticket: ticketId,
          senderType: 'system',
          senderName: 'System',
          messageType: 'system',
          content: `Status changed from ${oldStatus} to ${status}`,
          systemMessageType:
            status === 'resolved'
              ? 'ticket_resolved'
              : status === 'closed'
              ? 'ticket_closed'
              : 'status_changed',
        });
        await systemMessage.save();

        // Broadcast update
        io.to(`ticket_${ticketId}`).emit('ticket_status_updated', {
          ticket,
          oldStatus,
          newStatus: status,
          systemMessage,
        });

        // Notify business
        io.to(`business:${ticket.business}`).emit('ticket_updated', {
          ticketId,
          ticketNumber: ticket.ticketNumber,
          status,
        });
      } catch (error) {
        console.error('Error updating ticket status:', error);
        socket.emit('error', { message: 'Error updating ticket status' });
      }
    });

    // ==================== END TICKET SOCKET HANDLERS ====================

    // Handle location updates from couriers
    socket.on('location_update', async (data) => {
      try {
        const { latitude, longitude } = data;

        if (!latitude || !longitude) {
          console.log('Invalid location data received');
          return;
        }

        if (socket.userType !== 'courier') {
          console.log('Location update from non-courier user rejected');
          return;
        }

        console.log(
          `Courier ${socket.userId} location update: ${latitude}, ${longitude}`
        );

        // Update courier location in database
        const updatedCourier = await Courier.findByIdAndUpdate(
          socket.userId,
          {
            currentLocation: {
              type: 'Point',
              coordinates: [longitude, latitude],
              lastUpdated: new Date(),
            },
          },
          { new: true } // Return updated document
        );

        if (!updatedCourier) {
          console.log(`Courier ${socket.userId} not found in database`);
          return;
        }

        // Prepare photo URL if available
        let photoUrl = null;
        if (updatedCourier.personalPhoto) {
          photoUrl = `/uploads/couriers/${updatedCourier.personalPhoto}`;
        }

        // Broadcast to admin room
        io.to('admin').emit('courier-location-update', {
          courierId: socket.userId,
          location: {
            latitude,
            longitude,
            timestamp: new Date(),
          },
          isAvailable: updatedCourier.isAvailable,
          name: updatedCourier.name,
          courierID: updatedCourier.courierID,
          vehicleType: updatedCourier.vehicleType,
          phoneNumber: updatedCourier.phoneNumber,
          email: updatedCourier.user?.email || updatedCourier.email,
          photoUrl: photoUrl,
        });

        console.log(
          `Location update for courier ${socket.userId} broadcast to admin room`
        );
      } catch (error) {
        console.error('Error handling location update:', error);
      }
    });

    // Handle courier status change
    socket.on('status_update', async (data) => {
      try {
        const { isAvailable } = data;

        if (isAvailable === undefined) {
          return;
        }

        if (socket.userType !== 'courier') {
          return;
        }

        // Update courier status in database
        const updatedCourier = await Courier.findByIdAndUpdate(
          socket.userId,
          { isAvailable },
          { new: true }
        ).populate('user', 'email');

        if (!updatedCourier) {
          console.log(`Courier ${socket.userId} not found in database`);
          return;
        }

        // Broadcast to admin room
        io.to('admin').emit('courier-status-update', {
          courierId: socket.userId,
          isAvailable,
          name: updatedCourier.name,
          courierID: updatedCourier.courierID,
          vehicleType: updatedCourier.vehicleType,
          phoneNumber: updatedCourier.phoneNumber,
          email: updatedCourier.user?.email || updatedCourier.email,
          currentLocation: updatedCourier.currentLocation,
        });
      } catch (error) {
        console.error('Error handling status update:', error);
      }
    });

    // Handle error events
    socket.on('error', (error) => {
      console.error(
        `Socket error for ${socket.userType} ${socket.userId}: ${error}`
      );
    });

    socket.on('disconnect', (reason) => {
      console.log(`User disconnected: ${socket.userId}, Reason: ${reason}`);
    });
  });

  // Log global Socket.IO errors
  io.engine.on('connection_error', (err) => {
    console.error('Connection error:', err);
  });

  return io;
};

// Helper function to send courier status to admin
async function sendCourierStatusToAdmin(courierId) {
  try {
    const courier = await Courier.findById(courierId).populate('user', 'email');

    if (!courier) {
      console.log(`Courier ${courierId} not found in database`);
      return;
    }

    // Prepare photo URL if available
    let photoUrl = null;
    if (courier.personalPhoto) {
      photoUrl = `/uploads/couriers/${courier.personalPhoto}`;
    }

    io.to('admin').emit('courier-status-update', {
      courierId: courier._id,
      isAvailable: courier.isAvailable,
      name: courier.name,
      courierID: courier.courierID,
      vehicleType: courier.vehicleType,
      phoneNumber: courier.phoneNumber,
      email: courier.user?.email || courier.email,
      currentLocation: courier.currentLocation,
      photoUrl: photoUrl,
    });

    console.log(`Courier ${courierId} status sent to admin room`);
  } catch (error) {
    console.error('Error sending courier status to admin:', error);
  }
}

// Helper function to send all courier locations to admin
async function sendAllCourierLocationsToAdmin(socket) {
  try {
    const couriers = await Courier.find({
      isLocationTrackingEnabled: true,
      currentLocation: { $exists: true },
    });

    couriers.forEach((courier) => {
      if (courier.currentLocation && courier.currentLocation.coordinates) {
        const [longitude, latitude] = courier.currentLocation.coordinates;

        // Prepare photo URL if available
        let photoUrl = null;
        if (courier.personalPhoto) {
          photoUrl = `/uploads/couriers/${courier.personalPhoto}`;
        }

        socket.emit('courier-location-update', {
          courierId: courier._id,
          location: {
            latitude,
            longitude,
            timestamp: courier.currentLocation.lastUpdated,
          },
          isAvailable: courier.isAvailable,
          name: courier.name,
          courierID: courier.courierID,
          vehicleType: courier.vehicleType,
          phoneNumber: courier.phoneNumber,
          email: courier.email,
          photoUrl: photoUrl,
        });
      }
    });

    console.log(`All courier locations sent to admin ${socket.userId}`);
  } catch (error) {
    console.error('Error sending all courier locations to admin:', error);
  }
}

// Get Socket.IO instance
const getIO = () => {
  if (!io) {
    throw new Error('Socket.IO not initialized');
  }
  return io;
};

module.exports = {
  initializeSocket,
  getIO,
};
