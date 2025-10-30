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
router.get('/orders/:orderNumber/details', verifyToken, courierController.get_orderDetails);
router.put('/orders/:orderNumber/status', verifyToken, courierController.updateOrderStatus);
router.put('/orders/:orderNumber/complete', verifyToken, courierController.completeOrder);
router.post('/orders/:orderNumber/complete', verifyToken, courierController.completeOrder);

// Fast shipping scan route
router.post('/orders/:orderNumber/scan-fast-shipping', verifyToken, courierController.scanFastShippingOrder);

// Return order handling routes
router.get('/returns', verifyToken, courierController.get_returns);
router.get('/returns/:orderNumber/details', verifyToken, courierController.getReturnOrderDetails);
router.post('/orders/:orderNumber/pickup-return', verifyToken, courierController.pickupReturn);
router.post('/orders/:orderNumber/deliver-to-warehouse', verifyToken, courierController.deliverReturnToWarehouse);
router.post('/orders/:orderNumber/complete-return-to-business', verifyToken, courierController.completeReturnToBusiness);


// Pickup routes
router.get('/pickups', verifyToken, courierController.get_pickups);
router.get('/pickups/:pickupNumber/details', verifyToken, courierController.get_pickupDetails);
router.get('/pickups/:pickupNumber/orders', verifyToken, courierController.get_picked_up_orders);
router.get('/pickups/:pickupNumber/orders/:orderNumber', verifyToken, courierController.getAndSet_order_To_Pickup);
router.delete('/pickups/:pickupNumber/orders/:orderNumber', verifyToken, courierController.removePickedUpOrder);
router.put('/pickups/:pickupNumber/complete', verifyToken, courierController.completePickup);

// Shop order routes
router.get('/shop/orders', verifyToken, courierController.getCourierShopOrders);
router.get('/shop/orders/:id', verifyToken, courierController.getCourierShopOrderDetails);
router.put('/shop/orders/:id/status', verifyToken, courierController.updateCourierShopOrderStatus);

// Logout route
router.post('/logout', verifyToken, courierController.logOut);

module.exports = router; 