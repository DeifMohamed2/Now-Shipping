const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../../../models/user.js');

const jwtSecret = process.env.JWT_SECRET;

const businessController = require('../../../controllers/businessController.js');
const notificationController = require('../../../controllers/notificationController.js');


async function authenticateUser(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.log('Authorization header not found or invalid');
        return res.status(401).json({ message: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decode = jwt.verify(token, jwtSecret);
        req.userId = decode.userId;
        const user = await User.findOne({ _id: decode.userId });
        req.userData = user; // Attach user data to request object
        if (!user) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        next(); // Move to the next middleware
    } catch (error) {
        return res.status(401).json({ message: 'Unauthorized' });
    }
}



// Apply the middlewares in the correct order
router.use(authenticateUser); // First authenticate the user to set req.userId


// get user data
router.get('/user-data', async (req, res) => {
    try {
        const user = await User.findById(req.userId, {
            role: 1,
            name: 1,
            email: 1,
            phoneNumber: 1,
            isNeedStorage: 1,
            isCompleted: 1,
            isVerified: 1,
            brandInfo: 1,
            pickUpAdress: 1,
            profileImage: 1,
            createdAt:1,
        });
        res.json(user);
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
});


//dashboard

router.get('/dashboard', businessController.getDashboardData);

router.post('/complete-confirmation-form', businessController.completionConfirm);

router.get('/request-verification-email', businessController.requestVerification);


//orders

router.get('/orders', businessController.get_orders);

router.post('/submit-order', businessController.submitOrder);

router.post('/orders/print-policy/:orderNumber/:pageSize', businessController.printPolicy);

// router.get('/order-details/:orderNumber', businessController.get_orderDetailsPage);

// API route for mobile - returns JSON data
router.get('/order-details/:orderNumber', businessController.get_orderDetailsAPI);

router.put('/orders/edit-order/:orderId', businessController.editOrder);

router.delete('/orders/delete-order/:orderId', businessController.deleteOrder);

router.post('/calculate-fees', businessController.calculateOrderFees);

router.get('/orders/print-policy/:orderNumber/:pageSize', businessController.printPolicy);




//pickups

router.get('/get-pickups', businessController.get_pickups);

router.post('/create-pickup', businessController.createPickup);

router.get('/pickup-details/:pickupNumber', businessController.get_pickupDetailsPage);

router.get('/pickup-details/:pickupNumber/get-pickedup-orders', businessController.get_pickedupOrders);

router.post('/pickup-details/:pickupNumber/rate-pickup', businessController.ratePickup);

router.delete('/pickup-details/:pickupNumber/delete-pickup', businessController.deletePickup);

// Delete pickup by ID (alternative endpoint)
router.delete('/pickups/:pickupId', businessController.deletePickup);


// edit profile
router.put('/edit-profile', businessController.editProfile);

// ==================== RETURN FLOW APIs ==================== //

// Get available return orders for linking
router.get('/return-orders/available', businessController.getAvailableReturnOrders);

// Get comprehensive return order details
router.get('/return-orders/:orderId', businessController.getReturnOrderDetails);

// Get all return orders with filtering and pagination
router.get('/return-orders', businessController.getReturnOrders);

// Calculate return fees
// router.post('/return-orders/calculate-fees', businessController.calculateReturnFeesAPI);

// Mark deliver order as returned when return process is completed
// router.put('/orders/:orderId/mark-returned', businessController.markDeliverOrderAsReturned);

// // Initiate return request
// router.post('/orders/:orderId/initiate-return', businessController.initiateReturn);

// ==================== WAITING ACTION APIs ==================== //

// Retry order tomorrow
router.post('/orders/:orderId/retry-tomorrow', businessController.retryTomorrow);

// Schedule retry for specific date
router.post('/orders/:orderId/retry-scheduled', businessController.retryScheduled);

// Return to warehouse from waiting action
router.post('/orders/:orderId/return-to-warehouse', businessController.returnToWarehouseFromWaiting);

// Cancel from waiting action
router.post('/orders/:orderId/cancel-from-waiting', businessController.cancelFromWaiting);

// ==================== ORDER MANAGEMENT APIs ==================== //

// Cancel order with proper status transition
router.post('/orders/:orderId/cancel', businessController.cancelOrder);

// Validate original order for return
router.post('/orders/validate-original', businessController.validateOriginalOrder);

// Calculate pickup fee
router.post('/pickups/calculate-fee', businessController.calculatePickupFee);

// ==================== RECOVERY APIs ==================== //

// Recover order courier assignment
router.post('/orders/:orderId/recover-courier', businessController.recoverOrderCourier);

// ==================== TRANSACTION APIs ==================== //

// Get all transactions by date
router.get('/transactions', businessController.get_allTransactionsByDate);

// Get single transaction details
router.get('/transactions/:transactionId', businessController.getTransactionDetails);

// Recalculate user balance
router.post('/wallet/recalculate-balance', businessController.recalculateBalanceAPI);

// Export transactions to Excel
router.get('/wallet/export-transactions', businessController.exportTransactionsToExcel);


// ==================== CASH CYCLE APIs ==================== //

// Get total cash cycle by date
router.get('/cash-cycles', businessController.get_totalCashCycleByDate);

// Export cash cycles to Excel
router.get('/wallet/export-cash-cycles', businessController.exportCashCyclesToExcel);

// ==================== NOTIFICATION APIs ==================== //

// Update FCM token for push notifications
router.post('/update-fcm-token', notificationController.updateBusinessFcmToken);

// Get business notifications
router.get('/notifications', notificationController.getBusinessNotifications);

// Mark notification as read
router.put('/notifications/:notificationId/read', notificationController.markNotificationAsRead);

// ==================== SMART FLYER BARCODE APIs ==================== //

// Scan and assign Smart Flyer barcode to an order
router.post('/orders/scan-smart-flyer-barcode', businessController.scanSmartFlyerBarcode);

// Get order details by Smart Flyer barcode or order number
router.get('/orders/search/:searchValue', businessController.getOrderBySmartBarcode);

module.exports = router;
