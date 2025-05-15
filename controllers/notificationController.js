const Courier = require('../models/courier');
const Notification = require('../models/notification');
const firebase = require('../config/firebase');

/**
 * Send a notification to a specific courier
 */
const sendNotificationToCourier = async (req, res) => {
  try {
    const { courierId, title, body, data } = req.body;
    console.log(courierId, title, body, data);
    if (!courierId || !title || !body) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: courierId, title, body'
      });
    }

    // Find the courier
    const courier = await Courier.findById(courierId);
    if (!courier) {
      return res.status(404).json({
        success: false,
        message: 'Courier not found'
      });
    }
    console.log(courier);
    
    // Add courier name to the title for personalization
    const personalizedTitle = `${title} (Hi ${courier.name})`;
    
    // Create notification in database (initially with pending status)
    const notification = new Notification({
      title: personalizedTitle,
      body,
      recipient: courierId,
      type: 'personal',
      data: data || {},
      status: 'pending' // Add status tracking
    });
    
    await notification.save();

    // If courier doesn't have a token, save as failed
    if (!courier.fcmToken) {
      notification.status = 'failed';
      notification.deliveryError = 'Courier does not have a valid FCM token';
      await notification.save();
      
      return res.status(400).json({
        success: false,
        message: 'Courier does not have a valid FCM token',
        notification
      });
    }

    try {
      console.log(courier.fcmToken);
      // Send the notification via FCM
      const fcmResponse = await firebase.sendNotification(
        courier.fcmToken,
        { title: personalizedTitle, body },
        { ...data, notificationId: notification._id.toString() }
      );

      // Update notification status to delivered
      notification.status = 'delivered';
      notification.deliveredAt = new Date();
      notification.fcmResponse = fcmResponse;
      await notification.save();

      return res.status(200).json({
        success: true,
        message: 'Notification sent successfully',
        notification
      });
    } catch (error) {
      // Update notification as failed
      notification.status = 'failed';
      notification.deliveryError = error.message || 'FCM delivery error';
      await notification.save();

      // If token is invalid, update courier
      if (error.code === 'messaging/invalid-registration-token' || 
          error.code === 'messaging/registration-token-not-registered') {
        await Courier.findByIdAndUpdate(courier._id, { fcmToken: null });
      }

      return res.status(200).json({
        success: false,
        message: 'Notification saved but failed to deliver',
        error: error.message,
        notification
      });
    }
  } catch (error) {
    console.error('Error sending notification:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to send notification',
      error: error.message
    });
  }
};

/**
 * Send notification to all couriers
 */
const sendNotificationToAllCouriers = async (req, res) => {
  try {
    const { title, body, data } = req.body;

    if (!title || !body) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: title, body'
      });
    }

    // Find all couriers with FCM tokens
    const couriers = await Courier.find({ fcmToken: { $ne: null } });
    
    if (couriers.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No couriers with FCM tokens found'
      });
    }

    // Extract the tokens
    const tokens = couriers.map(courier => courier.fcmToken).filter(Boolean);
    
    console.log(`Found ${tokens.length} valid FCM tokens for sending notifications`);

    // Create notification in database (broadcast type)
    const notification = new Notification({
      title,
      body,
      type: 'broadcast',
      data: data || {},
      status: 'pending' // Add status tracking
    });

    await notification.save();

    // Try to send to all tokens, but if we get SenderId mismatch errors,
    // we'll try individual sends as a fallback
    let response;
    let individualSuccess = false;
    let successCount = 0;
    let failureCount = 0;
    
    try {
      // Send the notification via FCM multicast
      console.log('Attempting to send multicast notification to all couriers');
      response = await firebase.sendMulticastNotification(
        tokens,
        { title, body },
        { ...data, notificationId: notification._id.toString() }
      );
      
      successCount = response.successCount;
      failureCount = response.failureCount;
      
      // If all failed with SenderId mismatch, we'll try individual sends
      if (response.failureCount === tokens.length) {
        throw new Error('All multicast notifications failed, trying individual sends');
      }
    } catch (error) {
      console.error('Multicast notification failed:', error.message);
      
      // Try sending to each token individually as a fallback
      console.log('Attempting to send individual notifications to each courier');
      
      const individualResponses = [];
      successCount = 0;
      failureCount = couriers.length;
      
      // Send to each courier individually
      for (let i = 0; i < couriers.length; i++) {
        const courier = couriers[i];
        if (!courier.fcmToken) continue;
        
        try {
          console.log(`Sending individual notification to courier: ${courier.name} (${courier._id})`);
          const individualResponse = await firebase.sendNotification(
            courier.fcmToken,
            { title, body },
            { ...data, notificationId: notification._id.toString() }
          );
          
          individualResponses.push({ success: true, response: individualResponse });
          successCount++;
          failureCount--;
          individualSuccess = true;
        } catch (individualError) {
          console.error(`Failed to send notification to courier ${courier.name}:`, individualError.message);
          individualResponses.push({ 
            success: false, 
            error: individualError.message,
            courierId: courier._id,
            courierName: courier.name
          });
          
          // If the token is invalid, mark it for removal
          if (individualError.code === 'messaging/invalid-registration-token' || 
              individualError.code === 'messaging/registration-token-not-registered') {
            console.log(`Invalid FCM token for courier ${courier.name}, updating to null`);
            await Courier.findByIdAndUpdate(courier._id, { fcmToken: null });
          }
        }
      }
      
      // Create a response object similar to multicast
      response = {
        successCount,
        failureCount,
        responses: individualResponses
      };
    }

    // Update the broadcast notification status
    if (successCount > 0) {
      if (failureCount > 0) {
        notification.status = 'partial';
        notification.deliveryStats = {
          sent: successCount,
          failed: failureCount,
          total: successCount + failureCount
        };
      } else {
        notification.status = 'delivered';
      }
    } else {
      notification.status = 'failed';
    }
    
    notification.deliveredAt = new Date();
    notification.fcmResponse = response;
    await notification.save();

    // Create individual notifications for each courier for tracking
    const courierNotifications = [];
    for (let i = 0; i < couriers.length; i++) {
      const courier = couriers[i];
      
      // Determine delivery status for this specific courier
      let status = 'pending';
      let deliveryError = null;
      
      if (response.responses && response.responses[i]) {
        status = response.responses[i].success ? 'delivered' : 'failed';
        if (!response.responses[i].success) {
          deliveryError = response.responses[i].error || 'Unknown error';
        }
      } else if (response.responses && response.responses.length > i) {
        // Handle case where we have a multicast response
        const multicastResponse = response.responses[i];
        status = multicastResponse.success ? 'delivered' : 'failed';
        if (!multicastResponse.success) {
          deliveryError = multicastResponse.error ? multicastResponse.error.message : 'Unknown error';
        }
      }
      
      courierNotifications.push({
        title,
        body,
        recipient: courier._id,
        type: 'personal',
        data: data || {},
        status,
        deliveryError,
        deliveredAt: status === 'delivered' ? new Date() : null
      });
    }

    // Insert all courier notifications
    if (courierNotifications.length > 0) {
      await Notification.insertMany(courierNotifications);
    }

    // If multicast failed but individual sends had some success
    if (response.failureCount === tokens.length && individualSuccess) {
      return res.status(200).json({
        success: true,
        message: 'Broadcast notification sent with fallback to individual sends',
        notification,
        fcmResponse: response
      });
    } 
    // If everything failed
    else if (response.successCount === 0) {
      return res.status(200).json({
        success: false,
        message: 'Failed to send notifications. FCM configuration issue detected.',
        notification,
        fcmResponse: response
      });
    }
    // If at least some succeeded
    else {
      return res.status(200).json({
        success: true,
        message: 'Broadcast notification sent successfully',
        notification,
        fcmResponse: response
      });
    }
  } catch (error) {
    console.error('Error sending broadcast notification:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to send broadcast notification',
      error: error.message
    });
  }
};

/**
 * Get page for sending notifications (admin)
 */
const getNotificationsPage = async (req, res) => {
  try {
    // Get all couriers for the dropdown
    const couriers = await Courier.find().select('name courierID email');
    
    res.render('admin/send-notifications', {
      title: 'Send Courier Notifications',
      page_title: 'Send Courier Notifications',
      folder: 'Pages',
      couriers
    });
  } catch (error) {
    console.error('Error loading notifications page:', error);
    res.status(500).render('error', {
      message: 'Failed to load notifications page',
      error
    });
  }
};

/**
 * Get all notifications for a courier (mobile API)
 */
const getCourierNotifications = async (req, res) => {
  try {
    const courierId = req.userId; // From auth middleware

    const notifications = await Notification.find({
      recipient: courierId
    }).sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      notifications
    });
  } catch (error) {
    console.error('Error getting courier notifications:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get notifications',
      error: error.message
    });
  }
};

/**
 * Mark notification as read
 */
const markNotificationAsRead = async (req, res) => {
  try {
    const { notificationId } = req.params;
    const courierId = req.userId; // From auth middleware

    const notification = await Notification.findOneAndUpdate(
      { _id: notificationId, recipient: courierId },
      { isRead: true },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found or not authorized'
      });
    }

    return res.status(200).json({
      success: true,
      notification
    });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to mark notification as read',
      error: error.message
    });
  }
};

/**
 * Update FCM token for a courier
 */
const updateFcmToken = async (req, res) => {
  try {
    const { fcmToken } = req.body;
    const courierId = req.userId; // From auth middleware

    console.log(`Updating FCM token for courier ID: ${courierId}`);

    if (!fcmToken) {
      console.error('FCM token update failed: Token is missing in request body');
      return res.status(400).json({
        success: false,
        message: 'FCM token is required'
      });
    }

    if (!courierId) {
      console.error('FCM token update failed: No courier ID in request');
      return res.status(400).json({
        success: false,
        message: 'Cannot identify courier from authentication token'
      });
    }

    console.log(`Updating FCM token for courier ${courierId} with token: ${fcmToken.substring(0, 10)}...`);

    const courier = await Courier.findByIdAndUpdate(
      courierId,
      { fcmToken },
      { new: true }
    );

    if (!courier) {
      console.error(`FCM token update failed: Courier with ID ${courierId} not found`);
      return res.status(404).json({
        success: false,
        message: 'Courier not found'
      });
    }

    console.log(`FCM token successfully updated for courier: ${courier.name} (${courier._id})`);
    return res.status(200).json({
      success: true,
      message: 'FCM token updated successfully'
    });
  } catch (error) {
    console.error('Error updating FCM token:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update FCM token',
      error: error.message
    });
  }
};

const getRecentNotifications = async (req, res) => {
  try {
    // Get pagination parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;
    
    // Get filter parameters
    const type = req.query.type;
    const courierId = req.query.courierId;
    const startDate = req.query.startDate ? new Date(req.query.startDate) : null;
    const endDate = req.query.endDate ? new Date(req.query.endDate) : null;
    
    // Build query
    const query = {};
    
    if (type) {
      query.type = type;
    }
    
    if (courierId) {
      query.recipient = courierId;
    }
    
    if (startDate && endDate) {
      query.createdAt = {
        $gte: startDate,
        $lte: endDate
      };
    }
    
    // Get total count for pagination
    const totalCount = await Notification.countDocuments(query);
    
    // Get notifications with pagination and filters
    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('recipient', 'name courierID');
    
    // Format notifications for the table
    const formattedNotifications = notifications.map(notification => {
      const formatted = notification.toObject();
      if (notification.recipient) {
        formatted.recipientName = `${notification.recipient.name} (${notification.recipient.courierID})`;
      }
      return formatted;
    });
    
    res.json({
      success: true,
      notifications: formattedNotifications,
      pagination: {
        total: totalCount,
        page,
        limit,
        totalPages: Math.ceil(totalCount / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching recent notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch recent notifications'
    });
  }
}
module.exports = {
  sendNotificationToCourier,
  sendNotificationToAllCouriers,
  getNotificationsPage,
  getCourierNotifications,
  markNotificationAsRead,
  updateFcmToken,
  getRecentNotifications
}; 