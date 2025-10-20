const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../../models/user.js');

const jwtSecret = process.env.JWT_SECRET;

const businessController = require('../../controllers/businessController.js');
const assistantController = require('../../controllers/assistantController.js');

async function authenticateUser(req, res, next) {
  const token = req.cookies.token;
  if (!token) {
    console.log('Token not found');
    // For API requests, return JSON error instead of redirect
    if (req.path.startsWith('/api/') || req.headers['content-type'] === 'application/json') {
      return res.status(401).json({ error: 'Authentication required' });
    }
    return res.status(401).redirect('/login');
  }

  try {
    const decode = jwt.verify(token, jwtSecret);
    req.userId = decode.userId;
    const user = await User.findOne({ _id: decode.userId });
    req.userData = user; // Attach user data to request object
    if (!user) {
      res.clearCookie('token');
      return res.status(401).redirect('/login');
    }

    next(); // Move to the next middleware
  } catch (error) {
    res.clearCookie('token');
    return res.status(401).redirect('/login');
  }
}

router.use(authenticateUser);

// Define routes
//dashboard
router.get('/dashboard', businessController.getDashboardPage);

router.post('/completionConfirm', businessController.completionConfirm);

router.get('/request-verification', businessController.requestVerification);

//orders
router.get('/orders', businessController.get_ordersPage);

router.get('/get-orders', businessController.get_orders);

router.get('/create-order', businessController.get_createOrderPage);

router.post('/submit-order', businessController.submitOrder);

// Add new route for calculating fees
router.post('/calculate-fees', businessController.calculateOrderFees);
// Pickup fee estimation
router.post('/pickup/calculate-fee', businessController.calculatePickupFee);

router.post(
  '/orders/print-policy/:orderNumber/:pageSize',
  businessController.printPolicy
);

router.get(
  '/order-details/:orderNumber',
  businessController.get_orderDetailsPage
);

router.get('/edit-order/:orderNumber', businessController.get_editOrderPage);

router.put('/orders/edit-order/:orderId', businessController.editOrder);

router.post('/orders/cancel-order/:orderId', businessController.cancelOrder);
router.post('/orders/:orderId/recover-courier', businessController.recoverOrderCourier);
router.delete('/orders/delete-order/:orderId', businessController.deleteOrder);

// pickups
router.get('/pickups', businessController.get_pickupPage);

router.get('/get-pickups', businessController.get_pickups);

router.get(
  '/pickup-details/:pickupNumber',
  businessController.get_pickupDetailsPage
);

router.get(
  '/pickup-details/:pickupNumber/get-pickedup-orders',
  businessController.get_pickedupOrders
);

router.post(
  '/pickup-details/:pickupNumber/rate-pickup',
  businessController.ratePickup
);

router.post('/pickup/create-pickup', businessController.createPickup);

// waitingAction actions
router.post('/orders/:orderId/retry-tomorrow', businessController.retryTomorrow);
router.post('/orders/:orderId/retry-scheduled', businessController.retryScheduled);
router.post('/orders/:orderId/return-to-warehouse', businessController.returnToWarehouseFromWaiting);
router.post('/orders/:orderId/cancel', businessController.cancelFromWaiting);

// return actions
router.post('/orders/:orderId/initiate-return', businessController.initiateReturn); // 

// Enhanced Return Flow routes
router.post('/validate-original-order', businessController.validateOriginalOrder);
router.get('/available-return-orders', businessController.getAvailableReturnOrders); // 
router.get('/return-orders', businessController.getReturnOrders); // 
router.get('/return-orders/:orderId', businessController.getReturnOrderDetails); // 
router.get('/return-fees', businessController.calculateReturnFees); //
router.post('/orders/:orderId/mark-returned', businessController.markDeliverOrderAsReturned); // 

router.delete(
  '/pickup/delete-pickup/:pickupId',
  businessController.deletePickup
);

//wallet

// total balance
router.get('/wallet/total-balance', businessController.get_totalBalancePage);

router.get(
  '/wallet/get-all-transactions-by-date',
  businessController.get_allTransactionsByDate
);

router.get(
  '/wallet/get-transaction-details/:transactionId',
  businessController.getTransactionDetails
);

// Balance recalculation API
router.post('/wallet/recalculate-balance', businessController.recalculateBalanceAPI);

// Excel Export routes
router.get('/wallet/export-transactions', businessController.exportTransactionsToExcel);
router.get('/wallet/export-cash-cycles', businessController.exportCashCyclesToExcel);

// cash cycle
router.get('/wallet/cash-cycles', businessController.get_cashCyclesPage);

router.get(
  '/wallet/get-total-cashCycle-by-data',
  businessController.get_totalCashCycleByDate
);

// Test route
// router.get('/test-orders', businessController.testOrders);

router.get('/shop', businessController.get_shopPage);

// tickets
router.get('/tickets', businessController.get_ticketsPage);

// AI Assistant routes
router.get('/assistant', assistantController.getAssistantPage);
router.get('/assistant/preferences', assistantController.getPreferences);
router.post('/assistant/preferences', assistantController.updatePreferences);
router.get('/assistant/conversation', assistantController.getConversation);
router.post('/assistant/send', assistantController.sendMessage);
router.post('/assistant/clear', assistantController.clearConversation);

//logout
router.get('/logout', businessController.logOut);

module.exports = router;
