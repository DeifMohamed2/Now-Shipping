const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin SDK
// You will need to download the service account key from the Firebase console
// and place it in the config directory
try {
  const serviceAccount = require('../serviceAccountKey.json');
  
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id
  });
  
  console.log('Firebase Admin SDK initialized successfully for project:', serviceAccount.project_id);
} catch (error) {
  console.error('Error initializing Firebase Admin SDK:', error);
}

/**
 * Send a notification to a specific device using FCM token
 * @param {string} token - The FCM token of the device
 * @param {object} notification - The notification object { title, body }
 * @param {object} data - Additional data to send with the notification
 * @returns {Promise} - FCM response
 */
async function sendNotification(token, notification, data = {}) {
  try {
    if (!token) {
      throw new Error('FCM token is required');
    }
    
    const message = {
      token,
      notification,
      data: data,
      android: {
        priority: 'high',
        notification: {
          sound: 'default'
        }
      },
      apns: {
        payload: {
          aps: {
            sound: 'default'
          }
        }
      }
    };
    
    const response = await admin.messaging().send(message);
    console.log('Notification sent successfully:', response);
    return response;
  } catch (error) {
    console.error('Error sending notification:', error);
    console.error('Error code:', error.code, 'Error message:', error.message);
    if (error.errorInfo) {
      console.error('Error info:', error.errorInfo);
    }
    throw error;
  }
}

/**
 * Send notifications to multiple devices
 * @param {array} tokens - Array of FCM tokens
 * @param {object} notification - The notification object { title, body }
 * @param {object} data - Additional data to send with the notification
 * @returns {Promise} - FCM response
 */
async function sendMulticastNotification(tokens, notification, data = {}) {
  try {
    if (!tokens || !tokens.length) {
      throw new Error('FCM tokens are required');
    }

    // Filter out null/undefined tokens
    const validTokens = tokens.filter(token => token);

    if (validTokens.length === 0) {
      throw new Error('No valid FCM tokens provided');
    }

    // Create a multicast message
    const multicastMessage = {
      notification: notification,
      data: data,
      tokens: validTokens,
      android: {
        priority: 'high',
        notification: {
          sound: 'default'
        }
      },
      apns: {
        payload: {
          aps: {
            sound: 'default'
          }
        }
      }
    };

    console.log(`Sending multicast notification to ${validTokens.length} devices`);
    
    // Send the multicast message using the updated method
    const response = await admin.messaging().sendEachForMulticast(multicastMessage);
    console.log('Multicast notification sent successfully:', response);

    // It's good practice to check the response for failures in a batch send
    if (response.failureCount > 0) {
        console.log('Failed to send to some tokens:', response.failureCount);
        // You might want to inspect response.responses to see which tokens failed
        response.responses.forEach((resp, idx) => {
            if (!resp.success) {
                console.log(`Token at index ${idx} failed:`, resp.error);
                
                // If the token is invalid, we should remove it from the database
                if (resp.error && resp.error.code === 'messaging/invalid-registration-token' || 
                    resp.error && resp.error.code === 'messaging/registration-token-not-registered') {
                    console.log(`Token at index ${idx} is invalid and should be removed from the database`);
                    // Here you would typically remove the token from your database
                    // This requires knowing which courier the token belongs to
                }
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


module.exports = {
  admin,
  sendNotification,
  sendMulticastNotification
}; 