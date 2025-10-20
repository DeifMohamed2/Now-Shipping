const express = require('express');
const router = express.Router();
const { verifyToken } = require('../../../middleware/authMiddleware');
const courierLocationController = require('../../../controllers/courierLocationController');
const notificationController = require('../../../controllers/notificationController');
const courierController = require('../../../controllers/courierController');

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

// Order routes
router.get('/orders', verifyToken, courierController.get_orders);
router.post('/orders/:orderNumber/complete', verifyToken, courierController.completeOrder);

// Return order handling routes
router.get('/returns', verifyToken, courierController.get_returns);
router.post('/orders/:orderNumber/pickup-return', verifyToken, courierController.pickupReturn);
router.post('/orders/:orderNumber/deliver-to-warehouse', verifyToken, courierController.deliverReturnToWarehouse);
router.post('/orders/:orderNumber/complete-return-to-business', verifyToken, courierController.completeReturnToBusiness);

// Fast shipping scan route
router.post('/orders/:orderNumber/scan-fast-shipping', verifyToken, courierController.scanFastShippingOrder);

module.exports = router; 