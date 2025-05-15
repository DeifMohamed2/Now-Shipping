const express = require('express');
const router = express.Router();
const { verifyToken } = require('../../../middleware/authMiddleware');
const courierLocationController = require('../../../controllers/courierLocationController');
const notificationController = require('../../../controllers/notificationController');

// Update courier location
router.post('/location', verifyToken, courierLocationController.updateLocation);

// Update courier location tracking preferences
router.post('/location/preferences', verifyToken, courierLocationController.updateLocationPreferences);

// Get courier location status
router.get('/location/status', verifyToken, courierLocationController.getLocationStatus);

// Add FCM notification routes
router.post('/update-fcm-token', verifyToken, notificationController.updateFcmToken);
router.get('/notifications', verifyToken, notificationController.getCourierNotifications);
router.put('/notifications/:notificationId/read', verifyToken, notificationController.markNotificationAsRead);

module.exports = router; 