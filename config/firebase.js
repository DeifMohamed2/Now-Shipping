const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin SDK for Business (default app)
let businessApp;
try {
  const serviceAccountBusiness = require('../serviceAccountKey.json');
  
  businessApp = admin.initializeApp({
    credential: admin.credential.cert(serviceAccountBusiness),
    projectId: serviceAccountBusiness.project_id
  }, 'business');
  
  console.log('✅ Firebase Admin SDK initialized successfully for Business project:', serviceAccountBusiness.project_id);
} catch (error) {
  console.error('❌ Error initializing Firebase Admin SDK for Business:', error);
}

// Initialize Firebase Admin SDK for Courier (separate app)
let courierApp;
try {
  const serviceAccountCourier = require('../serviceAccountKey-Courier.json');
  
  courierApp = admin.initializeApp({
    credential: admin.credential.cert(serviceAccountCourier),
    projectId: serviceAccountCourier.project_id
  }, 'courier');
  
  console.log('✅ Firebase Admin SDK initialized successfully for Courier project:', serviceAccountCourier.project_id);
} catch (error) {
  console.error('❌ Error initializing Firebase Admin SDK for Courier:', error);
}

/**
 * Get the appropriate Firebase messaging instance based on user type
 * @param {string} userType - 'business' or 'courier'
 * @returns {object} - Firebase messaging instance
 */
function getMessagingInstance(userType = 'business') {
  if (userType === 'courier') {
    if (!courierApp) {
      throw new Error('Courier Firebase app is not initialized');
    }
    return courierApp.messaging();
  } else {
    if (!businessApp) {
      throw new Error('Business Firebase app is not initialized');
    }
    return businessApp.messaging();
  }
}

/**
 * Safely convert data values to strings for FCM payload
 * @param {object} data - Data object to convert
 * @returns {object} - Data object with all values as strings
 */
function sanitizeFCMData(data) {
  if (!data || typeof data !== 'object') {
    return {};
  }
  
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key, 
      typeof value === 'string' ? value : JSON.stringify(value)
    ])
  );
}

/**
 * Send a notification to a specific device using FCM token
 * @param {string} token - The FCM token of the device
 * @param {object} notification - The notification object { title, body }
 * @param {object} data - Additional data to send with the notification
 * @param {string} userType - 'business' or 'courier' (default: 'business')
 * @returns {Promise} - FCM response
 */
async function sendNotification(token, notification, data = {}, userType = 'business') {
  try {
    if (!token) {
      throw new Error('FCM token is required');
    }
    
    // Use different sound for courier notifications
    const notificationSound = userType === 'courier' ? 'notification' : 'default';
    
    const message = {
      token,
      notification,
      data: sanitizeFCMData(data),
      android: {
        priority: 'high',
        notification: {
          sound: notificationSound
        }
      },
      apns: {
        payload: {
          aps: {
            sound: notificationSound
          }
        }
      }
    };
    
    const messaging = getMessagingInstance(userType);
    const response = await messaging.send(message);
    console.log(`Notification sent successfully to ${userType}:`, response);
    return response;
  } catch (error) {
    console.error('❌ Error sending notification:', error.message);
    console.error('🔍 Error details:', {
      code: error.code || 'N/A',
      message: error.message,
      errorInfo: error.errorInfo || 'N/A',
      tokenPreview: token ? `${token.substring(0, 20)}...` : 'N/A',
      notificationTitle: notification?.title || 'N/A',
      notificationBody: notification?.body || 'N/A',
      dataKeys: Object.keys(data || {}),
      timestamp: new Date().toISOString()
    });
    
    // Check if token is invalid and should be cleaned up
    if (error.code === 'messaging/invalid-registration-token' || 
        error.code === 'messaging/registration-token-not-registered') {
      console.warn('⚠️ Invalid FCM token detected, should be cleaned up from database');
      console.warn('💡 Token may be expired or the app was uninstalled');
      console.warn('🔧 Use cleanupInvalidTokens() function to clean up invalid tokens');
    }
    
    // Handle data payload errors
    if (error.code === 'messaging/invalid-payload') {
      console.error('❌ FCM data payload contains invalid values. All data values must be strings.');
      console.error('🔧 Data payload:', JSON.stringify(data, null, 2));
      console.error('💡 Use sanitizeFCMData() function to convert all values to strings');
    }
    
    // Handle quota exceeded
    if (error.code === 'messaging/quota-exceeded') {
      console.error('❌ FCM quota exceeded. Too many messages sent.');
      console.error('💡 Wait before sending more notifications or check your FCM quota');
    }
    
    // Handle server errors
    if (error.code === 'messaging/internal-error') {
      console.error('❌ FCM internal server error. This is usually temporary.');
      console.error('💡 Retry the request after a short delay');
    }
    
    throw error;
  }
}

/**
 * Send notifications to multiple devices
 * @param {array} tokens - Array of FCM tokens
 * @param {object} notification - The notification object { title, body }
 * @param {object} data - Additional data to send with the notification
 * @param {string} userType - 'business' or 'courier' (default: 'business')
 * @returns {Promise} - FCM response
 */
async function sendMulticastNotification(tokens, notification, data = {}, userType = 'business') {
  try {
    if (!tokens || !tokens.length) {
      throw new Error('FCM tokens are required');
    }

    // Filter out null/undefined tokens
    const validTokens = tokens.filter(token => token);

    if (validTokens.length === 0) {
      throw new Error('No valid FCM tokens provided');
    }

    // Use different sound for courier notifications
    const notificationSound = userType === 'courier' ? 'notification' : 'default';

    // Create a multicast message
    const multicastMessage = {
      notification: notification,
      data: sanitizeFCMData(data),
      tokens: validTokens,
      android: {
        priority: 'high',
        notification: {
          sound: notificationSound
        }
      },
      apns: {
        payload: {
          aps: {
            sound: notificationSound
          }
        }
      }
    };

    console.log(`Sending multicast notification to ${validTokens.length} ${userType} devices`);
    
    // Send the multicast message using the updated method
    const messaging = getMessagingInstance(userType);
    const response = await messaging.sendEachForMulticast(multicastMessage);
    console.log(`Multicast notification sent successfully to ${userType}:`, response);

    // It's good practice to check the response for failures in a batch send
    if (response.failureCount > 0) {
        console.log('Failed to send to some tokens:', response.failureCount);
        // Log failed tokens for debugging
        response.responses.forEach((resp, idx) => {
            if (!resp.success) {
                console.log(`Token at index ${idx} failed:`, resp.error);
            }
        });
    }

    return response;
  } catch (error) {
    console.error('Error sending multicast notification:', error);
    console.error('Error code:', error.code, 'Error message:', error.message);
    if (error.errorInfo) {
      console.error('Error info:', error.errorInfo);
    }
    throw error;
  }
}


/**
 * Send notification to a specific user (business or courier)
 * @param {string} userId - The user ID
 * @param {string} userType - 'business' or 'courier'
 * @param {object} notification - The notification object { title, body }
 * @param {object} data - Additional data to send with the notification
 * @returns {Promise} - FCM response
 */
async function sendNotificationToUser(userId, userType, notification, data = {}) {
  try {
    const User = require('../models/user');
    const Courier = require('../models/courier');
    
    let user;
    if (userType === 'business') {
      user = await User.findById(userId);
    } else if (userType === 'courier') {
      user = await Courier.findById(userId);
    } else {
      const errorMsg = `❌ Invalid user type: "${userType}". Must be "business" or "courier"`;
      console.error(errorMsg);
      throw new Error(errorMsg);
    }
    
    if (!user) {
      const errorMsg = `❌ ${userType} not found with ID: ${userId}`;
      console.error(errorMsg);
      console.error(`💡 Check if the ${userType} exists in the database`);
      throw new Error(errorMsg);
    }
    
    if (!user.fcmToken) {
      const userName = user.name || user.email || 'Unknown';
      const errorMsg = `❌ ${userType} "${userName}" does not have a valid FCM token. User ID: ${userId}`;
      console.error(errorMsg);
      console.error(`💡 Solution: User needs to log in via mobile app to set FCM token`);
      console.error(`📱 User details: Name: ${user.name || 'N/A'}, Email: ${user.email || 'N/A'}`);
      throw new Error(errorMsg);
    }
    
    console.log(`📱 Sending notification to ${userType}: ${user.name || user.email || 'Unknown'} (ID: ${userId})`);
    console.log(`🔑 FCM Token: ${user.fcmToken.substring(0, 20)}...`);
    console.log(`📋 Notification: ${notification.title} - ${notification.body}`);
    
    return await sendNotification(user.fcmToken, notification, data, userType);
  } catch (error) {
    console.error(`❌ Error sending notification to ${userType} (ID: ${userId}):`, error.message);
    console.error(`📊 Error context:`, {
      userType,
      userId,
      notificationTitle: notification?.title || 'N/A',
      notificationBody: notification?.body || 'N/A',
      errorCode: error.code || 'N/A',
      errorType: error.constructor.name
    });
    throw error;
  }
}

/**
 * Send notification to multiple users by type
 * @param {string} userType - 'business' or 'courier'
 * @param {object} notification - The notification object { title, body }
 * @param {object} data - Additional data to send with the notification
 * @param {array} userIds - Optional array of specific user IDs to target
 * @returns {Promise} - FCM response
 */
async function sendNotificationToUsersByType(userType, notification, data = {}, userIds = null) {
  try {
    const User = require('../models/user');
    const Courier = require('../models/courier');
    
    let users;
    if (userType === 'business') {
      const query = { fcmToken: { $ne: null } };
      if (userIds) {
        query._id = { $in: userIds };
      }
      users = await User.find(query);
    } else if (userType === 'courier') {
      const query = { fcmToken: { $ne: null } };
      if (userIds) {
        query._id = { $in: userIds };
      }
      users = await Courier.find(query);
    } else {
      throw new Error('Invalid user type. Must be "business" or "courier"');
    }
    
    if (users.length === 0) {
      throw new Error(`No ${userType}s with FCM tokens found`);
    }
    
    const tokens = users.map(user => user.fcmToken);
    return await sendMulticastNotification(tokens, notification, data, userType);
  } catch (error) {
    console.error(`Error sending notification to ${userType}s:`, error);
    throw error;
  }
}

/**
 * Send order status notification to business
 * @param {string} businessId - Business user ID
 * @param {string} orderNumber - Order number
 * @param {string} status - Order status
 * @param {object} additionalData - Additional data
 * @returns {Promise} - FCM response
 */
async function sendOrderStatusNotification(businessId, orderNumber, status, additionalData = {}) {
  try {
    const Notification = require('../models/notification');
    
    const statusMessages = {
      'assigned': {
        title: 'Order Assigned',
        body: `Your order ${orderNumber} has been assigned to a courier.`
      },
      'inProgress': {
        title: 'Order In Progress',
        body: `Your order ${orderNumber} is being processed.`
      },
      'headingToCustomer': {
        title: 'Order Heading to Customer',
        body: `Your order ${orderNumber} is on the way to the customer.`
      },
      'completed': {
        title: 'Order Completed',
        body: `Your order ${orderNumber} has been successfully delivered and completed.`
      },
      'canceled': {
        title: 'Order Canceled',
        body: `Your order ${orderNumber} has been canceled.`
      },
      'rejected': {
        title: 'Order Rejected',
        body: `Your order ${orderNumber} has been rejected.`
      },
      'returned': {
        title: 'Order Returned',
        body: `Your order ${orderNumber} has been returned to you.`
      },
      'pickedUp': {
        title: 'Order Picked Up',
        body: `Your order ${orderNumber} has been picked up by our courier.`
      },
      'outForDelivery': {
        title: 'Order Out for Delivery',
        body: `Your order ${orderNumber} is now out for delivery to the customer.`
      },
      'delivered': {
        title: 'Order Delivered',
        body: `Your order ${orderNumber} has been delivered to the customer.`
      },
      'returnAssigned': {
        title: 'Return Assigned',
        body: `A return has been assigned for order ${orderNumber}.`
      },
      'returnPickedUp': {
        title: 'Return Picked Up',
        body: `The return for order ${orderNumber} has been picked up from the customer.`
      },
      'returnCompleted': {
        title: 'Return Completed',
        body: `The return for order ${orderNumber} has been completed and delivered back to you.`
      }
    };
    
    const message = statusMessages[status];
    if (!message) {
      throw new Error(`Unknown order status: ${status}`);
    }
    
    const data = sanitizeFCMData({
      type: 'order_status',
      orderNumber,
      status,
      ...additionalData
    });
    
    // Create notification in database
    const notification = new Notification({
      title: message.title,
      body: message.body,
      recipient: businessId,
      type: 'order_status',
      data: data,
      status: 'pending'
    });
    
    await notification.save();
    console.log(`📝 Order status notification saved to database for business ${businessId}`);
    
    // Send FCM notification
    const fcmResponse = await sendNotificationToUser(businessId, 'business', message, data);
    
    // Update notification status based on FCM response
    if (fcmResponse) {
      notification.status = 'delivered';
      notification.deliveredAt = new Date();
      notification.fcmResponse = fcmResponse;
      await notification.save();
      console.log(`✅ Order status notification delivered to business ${businessId}`);
    }
    
    return fcmResponse;
  } catch (error) {
    console.error('❌ Error sending order status notification:', error.message);
    console.error('🔍 Error context:', {
      businessId,
      orderNumber,
      status,
      errorCode: error.code || 'N/A',
      errorType: error.constructor.name,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}

/**
 * Send courier assignment notification
 * @param {string} courierId - Courier ID
 * @param {string} orderNumber - Order number
 * @param {string} action - Action type (assigned, pickup, delivery, etc.)
 * @param {object} additionalData - Additional data
 * @returns {Promise} - FCM response
 */
async function sendCourierAssignmentNotification(courierId, orderNumber, action, additionalData = {}) {
  try {
    const Notification = require('../models/notification');
    
    const actionMessages = {
      'assigned': {
        title: 'New Order Assignment',
        body: `You have been assigned to order ${orderNumber}. Please check your orders.`
      },
      'pickup': {
        title: 'Pickup Required',
        body: `Please pickup order ${orderNumber} from the business.`
      },
      'delivery': {
        title: 'Delivery Required',
        body: `Please deliver order ${orderNumber} to the customer.`
      },
      'return_pickup': {
        title: 'Return Pickup Required',
        body: `Please pickup the return for order ${orderNumber} from the customer.`
      },
      'return_delivery': {
        title: 'Return Delivery Required',
        body: `Please deliver the return for order ${orderNumber} back to the business.`
      }
    };
    
    const message = actionMessages[action];
    if (!message) {
      throw new Error(`Unknown action: ${action}`);
    }
    
    const data = sanitizeFCMData({
      type: 'courier_assignment',
      orderNumber,
      action,
      ...additionalData
    });
    
    // Create notification in database
    const notification = new Notification({
      title: message.title,
      body: message.body,
      recipient: courierId,
      type: 'courier_assignment',
      data: data,
      status: 'pending'
    });
    
    await notification.save();
    console.log(`📝 Courier assignment notification saved to database for courier ${courierId}`);
    
    // Send FCM notification
    const fcmResponse = await sendNotificationToUser(courierId, 'courier', message, data);
    
    // Update notification status based on FCM response
    if (fcmResponse) {
      notification.status = 'delivered';
      notification.deliveredAt = new Date();
      notification.fcmResponse = fcmResponse;
      await notification.save();
      console.log(`✅ Courier assignment notification delivered to courier ${courierId}`);
    }
    
    return fcmResponse;
  } catch (error) {
    console.error('❌ Error sending courier assignment notification:', error.message);
    console.error('🔍 Error context:', {
      courierId,
      orderNumber,
      action,
      errorCode: error.code || 'N/A',
      errorType: error.constructor.name,
      timestamp: new Date().toISOString()
    });
    
    // Don't throw error for invalid tokens - just log and continue
    // The notification is already saved to database, so the assignment can proceed
    if (error.code === 'messaging/invalid-registration-token' || 
        error.code === 'messaging/registration-token-not-registered') {
      console.warn('⚠️ Invalid FCM token for courier, notification saved to database but push failed');
      return null; // Return null instead of throwing
    }
    
    // For other errors, also return null to not break the assignment flow
    // The notification is already saved to the database
    return null;
  }
}

/**
 * Send financial processing notification to business
 * @param {string} businessId - Business user ID
 * @param {string} type - Processing type (daily, release, etc.)
 * @param {object} details - Processing details
 * @returns {Promise} - FCM response
 */
async function sendFinancialProcessingNotification(businessId, type, details = {}) {
  try {
    const Notification = require('../models/notification');
    
    const typeMessages = {
      'daily_processing': {
        title: 'Daily Processing Complete',
        body: `Your daily order processing has been completed. Check your balance for updates.`
      },
      'release_processing': {
        title: 'Funds Released',
        body: `Your funds have been released and processed. Amount: ${details.amount || 'N/A'}`
      },
      'balance_update': {
        title: 'Balance Updated',
        body: `Your account balance has been updated. New balance: ${details.balance || 'N/A'}`
      }
    };
    
    const message = typeMessages[type];
    if (!message) {
      throw new Error(`Unknown processing type: ${type}`);
    }
    
    const data = sanitizeFCMData({
      type: 'financial_processing',
      processingType: type,
      ...details
    });
    
    // Create notification in database
    const notification = new Notification({
      title: message.title,
      body: message.body,
      recipient: businessId,
      type: 'financial_processing',
      data: data,
      status: 'pending'
    });
    
    await notification.save();
    console.log(`📝 Financial processing notification saved to database for business ${businessId}`);
    
    // Send FCM notification
    const fcmResponse = await sendNotificationToUser(businessId, 'business', message, data);
    
    // Update notification status based on FCM response
    if (fcmResponse) {
      notification.status = 'delivered';
      notification.deliveredAt = new Date();
      notification.fcmResponse = fcmResponse;
      await notification.save();
      console.log(`✅ Financial processing notification delivered to business ${businessId}`);
    }
    
    return fcmResponse;
  } catch (error) {
    console.error('❌ Error sending financial processing notification:', error.message);
    console.error('🔍 Error context:', {
      businessId,
      type,
      details,
      errorCode: error.code || 'N/A',
      errorType: error.constructor.name,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}

/**
 * Send admin notification to all couriers
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 * @param {object} data - Additional data
 * @returns {Promise} - FCM response
 */
async function sendAdminNotificationToCouriers(title, body, data = {}) {
  try {
    const notification = { title, body };
    const notificationData = {
      type: 'admin_notification',
      ...data
    };
    
    return await sendNotificationToUsersByType('courier', notification, notificationData);
  } catch (error) {
    console.error('Error sending admin notification to couriers:', error);
    throw error;
  }
}

/**
 * Send admin notification to all businesses
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 * @param {object} data - Additional data
 * @returns {Promise} - FCM response
 */
async function sendAdminNotificationToBusinesses(title, body, data = {}) {
  try {
    const notification = { title, body };
    const notificationData = {
      type: 'admin_notification',
      ...data
    };
    
    return await sendNotificationToUsersByType('business', notification, notificationData);
  } catch (error) {
    console.error('Error sending admin notification to businesses:', error);
    throw error;
  }
}

/**
 * Send pickup status notification to business
 * @param {string} businessId - Business user ID
 * @param {string} pickupNumber - Pickup number
 * @param {string} status - Pickup status
 * @param {object} additionalData - Additional data
 * @returns {Promise} - FCM response
 */
async function sendPickupStatusNotification(businessId, pickupNumber, status, additionalData = {}) {
  try {
    const Notification = require('../models/notification');
    
    const statusMessages = {
      'new': {
        title: 'New Pickup Request',
        body: `Your pickup request ${pickupNumber} has been created and is pending assignment.`
      },
      'driverAssigned': {
        title: 'Pickup Driver Assigned',
        body: `A driver has been assigned to your pickup ${pickupNumber}. They will contact you soon.`
      },
      'pickedUp': {
        title: 'Pickup Completed',
        body: `Your pickup ${pickupNumber} has been successfully completed by our courier.`
      },
      'inStock': {
        title: 'Pickup in Warehouse',
        body: `Your pickup ${pickupNumber} has been delivered to our warehouse and is being processed.`
      },
      'completed': {
        title: 'Pickup Processed',
        body: `Your pickup ${pickupNumber} has been fully processed and completed.`
      },
      'canceled': {
        title: 'Pickup Canceled',
        body: `Your pickup ${pickupNumber} has been canceled.`
      },
      'rejected': {
        title: 'Pickup Rejected',
        body: `Your pickup ${pickupNumber} has been rejected by the assigned driver.`
      }
    };
    
    const message = statusMessages[status];
    if (!message) {
      throw new Error(`Unknown pickup status: ${status}`);
    }
    
    const data = sanitizeFCMData({
      type: 'pickup_status',
      pickupNumber,
      status,
      ...additionalData
    });
    
    // Create notification in database
    const notification = new Notification({
      title: message.title,
      body: message.body,
      recipient: businessId,
      type: 'pickup_status',
      data: data,
      status: 'pending'
    });
    
    await notification.save();
    console.log(`📝 Pickup status notification saved to database for business ${businessId}`);
    
    // Send FCM notification
    const fcmResponse = await sendNotificationToUser(businessId, 'business', message, data);
    
    // Update notification status based on FCM response
    if (fcmResponse) {
      notification.status = 'delivered';
      notification.deliveredAt = new Date();
      notification.fcmResponse = fcmResponse;
      await notification.save();
      console.log(`✅ Pickup status notification delivered to business ${businessId}`);
    }
    
    return fcmResponse;
  } catch (error) {
    console.error('❌ Error sending pickup status notification:', error.message);
    console.error('🔍 Error context:', {
      businessId,
      pickupNumber,
      status,
      errorCode: error.code || 'N/A',
      errorType: error.constructor.name,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}

/**
 * Send shop order status notification to business
 * @param {string} businessId - Business user ID
 * @param {string} orderNumber - Shop order number
 * @param {string} status - Shop order status
 * @param {object} additionalData - Additional data
 * @returns {Promise} - FCM response
 */
async function sendShopOrderStatusNotification(businessId, orderNumber, status, additionalData = {}) {
  try {
    const Notification = require('../models/notification');
    
    const statusMessages = {
      'pending': {
        title: 'Shop Order Pending',
        body: `Your shop order ${orderNumber} has been placed and is pending confirmation.`
      },
      'confirmed': {
        title: 'Shop Order Confirmed',
        body: `Your shop order ${orderNumber} has been confirmed and is being prepared.`
      },
      'assigned': {
        title: 'Shop Order Assigned',
        body: `Your shop order ${orderNumber} has been assigned to a courier for delivery.`
      },
      'in_transit': {
        title: 'Shop Order in Transit',
        body: `Your shop order ${orderNumber} is on the way to you.`
      },
      'delivered': {
        title: 'Shop Order Delivered',
        body: `Your shop order ${orderNumber} has been successfully delivered.`
      },
      'cancelled': {
        title: 'Shop Order Cancelled',
        body: `Your shop order ${orderNumber} has been cancelled.`
      },
      'returned': {
        title: 'Shop Order Returned',
        body: `Your shop order ${orderNumber} has been returned.`
      }
    };
    
    const message = statusMessages[status];
    if (!message) {
      throw new Error(`Unknown shop order status: ${status}`);
    }
    
    const data = sanitizeFCMData({
      type: 'shop_order_status',
      orderNumber,
      status,
      ...additionalData
    });
    
    // Create notification in database
    const notification = new Notification({
      title: message.title,
      body: message.body,
      recipient: businessId,
      type: 'shop_order_status',
      data: data,
      status: 'pending'
    });
    
    await notification.save();
    console.log(`📝 Shop order status notification saved to database for business ${businessId}`);
    
    // Send FCM notification
    const fcmResponse = await sendNotificationToUser(businessId, 'business', message, data);
    
    // Update notification status based on FCM response
    if (fcmResponse) {
      notification.status = 'delivered';
      notification.deliveredAt = new Date();
      notification.fcmResponse = fcmResponse;
      await notification.save();
      console.log(`✅ Shop order status notification delivered to business ${businessId}`);
    }
    
    return fcmResponse;
  } catch (error) {
    console.error('❌ Error sending shop order status notification:', error.message);
    console.error('🔍 Error context:', {
      businessId,
      orderNumber,
      status,
      errorCode: error.code || 'N/A',
      errorType: error.constructor.name,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}

/**
 * Send pickup assignment notification to courier
 * @param {string} courierId - Courier ID
 * @param {string} pickupNumber - Pickup number
 * @param {object} additionalData - Additional data
 * @returns {Promise} - FCM response
 */
async function sendPickupAssignmentNotification(courierId, pickupNumber, additionalData = {}) {
  try {
    const Notification = require('../models/notification');
    
    const message = {
      title: 'New Pickup Assignment',
      body: `You have been assigned to pickup ${pickupNumber}. Please check your pickups.`
    };
    
    const data = sanitizeFCMData({
      type: 'pickup_assignment',
      pickupNumber,
      ...additionalData
    });
    
    // Create notification in database
    const notification = new Notification({
      title: message.title,
      body: message.body,
      recipient: courierId,
      type: 'pickup_assignment',
      data: data,
      status: 'pending'
    });
    
    await notification.save();
    console.log(`📝 Pickup assignment notification saved to database for courier ${courierId}`);
    
    // Send FCM notification
    const fcmResponse = await sendNotificationToUser(courierId, 'courier', message, data);
    
    // Update notification status based on FCM response
    if (fcmResponse) {
      notification.status = 'delivered';
      notification.deliveredAt = new Date();
      notification.fcmResponse = fcmResponse;
      await notification.save();
      console.log(`✅ Pickup assignment notification delivered to courier ${courierId}`);
    }
    
    return fcmResponse;
  } catch (error) {
    console.error('❌ Error sending pickup assignment notification:', error.message);
    console.error('🔍 Error context:', {
      courierId,
      pickupNumber,
      errorCode: error.code || 'N/A',
      errorType: error.constructor.name,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}

/**
 * Send shop order assignment notification to courier
 * @param {string} courierId - Courier ID
 * @param {string} orderNumber - Shop order number
 * @param {object} additionalData - Additional data
 * @returns {Promise} - FCM response
 */
async function sendShopOrderAssignmentNotification(courierId, orderNumber, additionalData = {}) {
  try {
    const Notification = require('../models/notification');
    
    const message = {
      title: 'New Shop Order Assignment',
      body: `You have been assigned to shop order ${orderNumber}. Please check your shop orders.`
    };
    
    const data = sanitizeFCMData({
      type: 'shop_order_assignment',
      orderNumber,
      ...additionalData
    });
    
    // Create notification in database
    const notification = new Notification({
      title: message.title,
      body: message.body,
      recipient: courierId,
      type: 'shop_order_assignment',
      data: data,
      status: 'pending'
    });
    
    await notification.save();
    console.log(`📝 Shop order assignment notification saved to database for courier ${courierId}`);
    
    // Send FCM notification
    const fcmResponse = await sendNotificationToUser(courierId, 'courier', message, data);
    
    // Update notification status based on FCM response
    if (fcmResponse) {
      notification.status = 'delivered';
      notification.deliveredAt = new Date();
      notification.fcmResponse = fcmResponse;
      await notification.save();
      console.log(`✅ Shop order assignment notification delivered to courier ${courierId}`);
    }
    
    return fcmResponse;
  } catch (error) {
    console.error('❌ Error sending shop order assignment notification:', error.message);
    console.error('🔍 Error context:', {
      courierId,
      orderNumber,
      errorCode: error.code || 'N/A',
      errorType: error.constructor.name,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}

/**
 * Validate and clean up invalid FCM tokens
 * @param {string} token - FCM token to validate
 * @param {string} userId - User ID (optional, for cleanup)
 * @param {string} userType - 'business' or 'courier' (optional, for cleanup)
 * @returns {Promise<boolean>} - True if token is valid, false if invalid
 */
async function validateAndCleanupToken(token, userId = null, userType = 'business') {
  try {
    if (!token) {
      return {
        isValid: false,
        reason: 'Token is missing or empty',
        errorCode: 'missing-token',
        errorMessage: 'No FCM token provided for validation'
      };
    }

    // Try to send a test message to validate the token
    const testMessage = {
      token,
      data: {
        type: 'token_validation',
        timestamp: Date.now().toString()
      },
      android: {
        priority: 'normal'
      },
      apns: {
        payload: {
          aps: {
            'content-available': 1
          }
        }
      }
    };

    const messaging = getMessagingInstance(userType);
    await messaging.send(testMessage);
    console.log(`✅ Token validation successful for ${userType}`);
    return {
      isValid: true,
      reason: 'Token is valid and can receive notifications',
      errorCode: null,
      errorMessage: null
    };
  } catch (error) {
    const errorCode = error.code || 'unknown-error';
    const errorMessage = error.message || 'Unknown error occurred';
    
    console.error('❌ Token validation failed:', errorMessage);
    console.error('🔍 Validation error details:', {
      code: errorCode,
      errorInfo: error.errorInfo || 'N/A',
      message: errorMessage,
      userType,
      userId: userId || 'N/A',
      tokenPreview: token ? `${token.substring(0, 20)}...` : 'N/A'
    });
    
    // Determine the reason for the validation failure
    let reason = 'Unknown validation error';
    
    // List of error codes that indicate the token is permanently invalid
    const invalidTokenCodes = [
      'messaging/invalid-registration-token',
      'messaging/registration-token-not-registered',
      'messaging/invalid-argument',
      'messaging/third-party-auth-error'
    ];
    
    // Check if error message contains APNS or Web Push auth errors
    const isAuthError = errorMessage && (
      errorMessage.includes('Auth error from APNS') ||
      errorMessage.includes('Auth error from Web Push Service') ||
      errorMessage.includes('APNS') ||
      errorMessage.includes('Web Push')
    );
    
    // Provide detailed reasons based on error type
    if (errorCode === 'messaging/invalid-registration-token') {
      reason = 'Token format is invalid or malformed. The token may have been corrupted or is not a valid FCM registration token.';
    } else if (errorCode === 'messaging/registration-token-not-registered') {
      reason = 'Token is not registered with FCM. The app may have been uninstalled or the token was revoked.';
    } else if (errorCode === 'messaging/invalid-argument') {
      reason = 'Invalid argument provided to FCM. The token may be in an incorrect format or missing required fields.';
    } else if (errorCode === 'messaging/third-party-auth-error' || isAuthError) {
      if (errorMessage.includes('APNS')) {
        reason = 'APNS (Apple Push Notification Service) authentication error. This usually means: (1) The APNS certificate/key is invalid or expired, (2) The token is for iOS but the APNS configuration is incorrect, (3) The app bundle ID doesn\'t match the APNS certificate, or (4) The device is not properly registered with APNS.';
      } else if (errorMessage.includes('Web Push')) {
        reason = 'Web Push Service authentication error. This usually means: (1) The VAPID keys are invalid or not configured correctly, (2) The web push subscription is invalid, or (3) The service worker registration has expired.';
      } else {
        reason = 'Third-party authentication error (APNS or Web Push). The push notification service authentication failed. Check your APNS/Web Push configuration and certificates.';
      }
    } else if (errorCode === 'messaging/unavailable') {
      reason = 'FCM service is temporarily unavailable. This is a temporary error and the token may still be valid.';
    } else if (errorCode === 'messaging/internal-error') {
      reason = 'Internal FCM server error. This is a temporary error and the token may still be valid.';
    } else {
      reason = `Validation failed with error: ${errorMessage}. Error code: ${errorCode}`;
    }
    
    // Log warning but DO NOT clean up the token
    if (invalidTokenCodes.includes(errorCode) || isAuthError) {
      console.warn(`⚠️ Invalid FCM token detected (code: ${errorCode}, auth error: ${isAuthError})`);
      console.warn(`📝 Reason: ${reason}`);
      console.warn(`💾 Token will be kept in database for user: ${userId || 'N/A'}`);
    } else {
      console.warn(`⚠️ Token validation failed but token may still be valid (temporary error): ${errorCode}`);
      console.warn(`📝 Reason: ${reason}`);
    }
    
    return {
      isValid: false,
      reason: reason,
      errorCode: errorCode,
      errorMessage: errorMessage,
      isPermanentError: invalidTokenCodes.includes(errorCode) || isAuthError
    };
  }
}

/**
 * Validate all FCM tokens (tokens are kept in database, not cleaned up)
 * @returns {Promise<object>} - Validation results
 */
async function cleanupInvalidTokens() {
  try {
    const User = require('../models/user');
    const Courier = require('../models/courier');
    
    console.log('Starting FCM token validation (tokens will be kept)...');
    
    // Get all users with FCM tokens
    const businessUsers = await User.find({ 
      fcmToken: { $ne: null },
      role: 'business'
    });
    
    const couriers = await Courier.find({ 
      fcmToken: { $ne: null }
    });
    
    let businessInvalidCount = 0;
    let courierInvalidCount = 0;
    const invalidTokens = [];
    
    // Validate business user tokens
    for (const user of businessUsers) {
      const validationResult = await validateAndCleanupToken(user.fcmToken, user._id, 'business');
      if (!validationResult.isValid) {
        businessInvalidCount++;
        invalidTokens.push({
          userId: user._id,
          userType: 'business',
          reason: validationResult.reason,
          errorCode: validationResult.errorCode,
          errorMessage: validationResult.errorMessage
        });
      }
    }
    
    // Validate courier tokens
    for (const courier of couriers) {
      const validationResult = await validateAndCleanupToken(courier.fcmToken, courier._id, 'courier');
      if (!validationResult.isValid) {
        courierInvalidCount++;
        invalidTokens.push({
          userId: courier._id,
          userType: 'courier',
          reason: validationResult.reason,
          errorCode: validationResult.errorCode,
          errorMessage: validationResult.errorMessage
        });
      }
    }
    
    console.log(`Token validation completed. Invalid tokens found: ${businessInvalidCount} businesses, ${courierInvalidCount} couriers`);
    console.log(`💾 All tokens are kept in database (no cleanup performed)`);
    
    return {
      businessInvalidCount,
      courierInvalidCount,
      totalInvalidCount: businessInvalidCount + courierInvalidCount,
      invalidTokens: invalidTokens
    };
  } catch (error) {
    console.error('Error during token validation:', error);
    throw error;
  }
}

/**
 * Send notification with automatic token validation and cleanup
 * @param {string} token - FCM token
 * @param {object} notification - Notification object
 * @param {object} data - Additional data
 * @param {string} userId - User ID for cleanup
 * @param {string} userType - User type ('business' or 'courier')
 * @returns {Promise} - FCM response
 */
async function sendNotificationWithValidation(token, notification, data = {}, userId = null, userType = 'business') {
  try {
    // First try to validate the token (non-blocking)
    // If validation fails, we'll still try to send the notification
    // because validation might fail for temporary reasons
    const validationResult = await validateAndCleanupToken(token, userId, userType);
    
    if (!validationResult.isValid) {
      // Log the validation failure with detailed reason
      console.warn(`⚠️ Token validation failed for ${userType} user: ${userId || 'N/A'}`);
      console.warn(`📝 Validation reason: ${validationResult.reason}`);
      console.warn(`🔍 Error code: ${validationResult.errorCode}`);
      console.warn(`💾 Token will be kept in database - attempting to send notification anyway`);
      
      // Still try to send the notification - the actual send will handle the error properly
      // This allows for cases where validation fails but the token might still work
    }
    
    // Send the notification (this will handle errors properly)
    return await sendNotification(token, notification, data, userType);
  } catch (error) {
    // Build detailed error message with reason
    let errorMessage = error.message || 'Unknown error occurred';
    const errorCode = error.code || 'unknown-error';
    
    // If error is about invalid token, provide detailed reason
    if (errorCode === 'messaging/invalid-registration-token' || 
        errorCode === 'messaging/registration-token-not-registered' ||
        errorMessage.includes('Auth error from APNS') ||
        errorMessage.includes('Auth error from Web Push Service')) {
      
      let reason = '';
      if (errorMessage.includes('Auth error from APNS')) {
        reason = 'APNS (Apple Push Notification Service) authentication error. Possible causes: (1) APNS certificate/key is invalid or expired, (2) iOS app bundle ID mismatch, (3) Device not properly registered with APNS, (4) APNS configuration issue in Firebase.';
      } else if (errorMessage.includes('Auth error from Web Push Service')) {
        reason = 'Web Push Service authentication error. Possible causes: (1) VAPID keys invalid or misconfigured, (2) Web push subscription expired, (3) Service worker registration issue.';
      } else if (errorCode === 'messaging/invalid-registration-token') {
        reason = 'Token format is invalid or malformed. The token may have been corrupted.';
      } else if (errorCode === 'messaging/registration-token-not-registered') {
        reason = 'Token is not registered with FCM. The app may have been uninstalled or token was revoked.';
      }
      
      // Create enhanced error with reason
      const enhancedError = new Error(`FCM token validation/send failed. ${reason} Error code: ${errorCode}. Token will be kept in database.`);
      enhancedError.code = errorCode;
      enhancedError.reason = reason;
      enhancedError.originalError = error;
      enhancedError.userId = userId;
      enhancedError.userType = userType;
      
      console.error('❌ Error in sendNotificationWithValidation:', enhancedError.message);
      console.error('🔍 Error details:', {
        code: errorCode,
        reason: reason,
        userId: userId || 'N/A',
        userType: userType || 'N/A',
        tokenPreview: token ? `${token.substring(0, 20)}...` : 'N/A'
      });
      
      throw enhancedError;
    }
    
    console.error('❌ Error in sendNotificationWithValidation:', error);
    throw error;
  }
}

module.exports = {
  admin,
  businessApp,
  courierApp,
  getMessagingInstance,
  sendNotification,
  sendMulticastNotification,
  sendNotificationToUser,
  sendNotificationToUsersByType,
  sendOrderStatusNotification,
  sendCourierAssignmentNotification,
  sendFinancialProcessingNotification,
  sendAdminNotificationToCouriers,
  sendAdminNotificationToBusinesses,
  sendPickupStatusNotification,
  sendShopOrderStatusNotification,
  sendPickupAssignmentNotification,
  sendShopOrderAssignmentNotification,
  validateAndCleanupToken,
  cleanupInvalidTokens,
  sendNotificationWithValidation
}; 