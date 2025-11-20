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
    if (
      req.path.startsWith('/api/') ||
      req.headers['content-type'] === 'application/json'
    ) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    return res.status(401).redirect('/login');
  }

  try {
    const decode = jwt.verify(token, jwtSecret);
    req.userId = decode.userId;
    const user = await User.findOne({ _id: decode.userId });
    req.userData = user; // Attach user data to request object

    // Make userData available to all views
    res.locals.userData = user;
    res.locals.user = user;

    if (!user) {
      res.clearCookie('token');
      // For API requests, return JSON error instead of redirect
      if (
        req.path.startsWith('/api/') ||
        req.headers['content-type'] === 'application/json'
      ) {
        return res.status(401).json({ error: 'User not found' });
      }
      return res.status(401).redirect('/login');
    }

    // If the business account is not completed, restrict access to everything except dashboard pages
    const normalizedRole = (user && user.role ? String(user.role).toLowerCase() : '');
    const isCompleted = Boolean(user && user.isCompleted);
    if (normalizedRole === 'business' && !isCompleted) {
      const allowedWhenIncomplete = new Set(['/dashboard', '/completionConfirm', '/request-verification']);

      if (!allowedWhenIncomplete.has(req.path)) {
        // Expose flag to templates if needed
        res.locals.accountIncomplete = true;

        // For API/JSON requests, respond with 403; otherwise, redirect to dashboard
        if (
          req.path.startsWith('/api/') ||
          req.headers['content-type'] === 'application/json' ||
          req.xhr ||
          (req.headers['accept'] && req.headers['accept'].includes('application/json'))
        ) {
          return res
            .status(403)
            .json({ error: 'Account not completed. Access restricted to dashboard.' });
        }
        return res.redirect('/business/dashboard');
      }
    }

    next(); // Move to the next middleware
  } catch (error) {
    console.error('Authentication error:', error);
    res.clearCookie('token');
    // For API requests, return JSON error instead of redirect
    if (
      req.path.startsWith('/api/') ||
      req.headers['content-type'] === 'application/json'
    ) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    return res.status(401).redirect('/login');
  }
}

router.use(authenticateUser);

// Define routes
//dashboard
router.get('/dashboard', businessController.getDashboardPage);
router.get('/dashboard-data', businessController.getDashboardData);

router.post('/completionConfirm', businessController.completionConfirm);

router.get('/request-verification', businessController.requestVerification);

//orders
router.get('/orders', businessController.get_ordersPage);

router.get('/get-orders', businessController.get_orders);

router.get('/export-orders', businessController.exportOrdersToExcel);

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
  '/print-policy/:orderNumber',
  businessController.printPolicy
);

router.get(
  '/order-details/:orderNumber',
  businessController.get_orderDetailsPage
);

router.get('/edit-order/:orderNumber', businessController.get_editOrderPage);

router.put('/orders/edit-order/:orderId', businessController.editOrder);

router.post('/orders/cancel-order/:orderId', businessController.cancelOrder);
router.post(
  '/orders/:orderId/recover-courier',
  businessController.recoverOrderCourier
);
router.delete('/orders/delete-order/:orderId', businessController.deleteOrder);

// pickups
router.get('/pickups', businessController.get_pickupPage);

router.get('/get-pickups', businessController.get_pickups);

router.get('/export-pickups', businessController.exportPickupsToExcel);

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
router.post(
  '/orders/:orderId/retry-tomorrow',
  businessController.retryTomorrow
);
router.post(
  '/orders/:orderId/retry-scheduled',
  businessController.retryScheduled
);
router.post(
  '/orders/:orderId/return-to-warehouse',
  businessController.returnToWarehouseFromWaiting
);
router.post('/orders/:orderId/cancel', businessController.cancelFromWaiting);

// return actions
router.post(
  '/orders/:orderId/initiate-return',
  businessController.initiateReturn
); //

// Enhanced Return Flow routes
router.post(
  '/validate-original-order',
  businessController.validateOriginalOrder
);
router.get(
  '/available-return-orders',
  businessController.getAvailableReturnOrders
); //
router.get('/return-orders', businessController.getReturnOrders); //
router.get('/return-orders/:orderId', businessController.getReturnOrderDetails); //
router.get('/return-fees', businessController.calculateReturnFees); //
router.post(
  '/orders/:orderId/mark-returned',
  businessController.markDeliverOrderAsReturned
); //

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
router.post(
  '/wallet/recalculate-balance',
  businessController.recalculateBalanceAPI
);

// Excel Export routes
router.get(
  '/wallet/export-transactions',
  businessController.exportTransactionsToExcel
);
router.get(
  '/wallet/export-cash-cycles',
  businessController.exportCashCyclesToExcel
);

// cash cycle
router.get('/wallet/cash-cycles', businessController.get_cashCyclesPage);

router.get(
  '/wallet/get-total-cashCycle-by-data',
  businessController.get_totalCashCycleByDate
);

// Test route
// router.get('/test-orders', businessController.testOrders);

// Shop routes
router.get('/shop', businessController.getBusinessShopPage);
router.get('/shop/orders', businessController.getBusinessShopOrdersPage);
router.get(
  '/shop/orders/:id',
  businessController.getBusinessShopOrderDetailsPage
);

// Shop API routes
router.get('/api/shop/products', businessController.getAvailableProducts);
router.post('/api/shop/orders', businessController.createShopOrder);
router.get('/api/shop/orders', businessController.getBusinessShopOrders);
router.get(
  '/api/shop/orders/:id',
  businessController.getBusinessShopOrderDetails
);
router.put('/api/shop/orders/:id/cancel', businessController.cancelShopOrder);

// tickets
router.get('/tickets', businessController.get_ticketsPage);

// Settings routes
router.get('/settings', businessController.getSettingsPage);
router.put('/settings/update', businessController.updateSettings);
router.post('/settings/update', businessController.updateSettings);
router.post('/settings/send-email-otp', businessController.sendEmailOtp);
router.post('/settings/verify-email-otp', businessController.verifyEmailOtp);
router.post('/settings/send-phone-otp', businessController.sendPhoneOtp);
router.post('/settings/verify-phone-otp', businessController.verifyPhoneOtp);

// Multiple Pickup Addresses routes
router.post('/pickup-addresses/add', businessController.addPickupAddress);
router.put('/pickup-addresses/:addressId', businessController.updatePickupAddress);
router.delete('/pickup-addresses/:addressId', businessController.deletePickupAddress);
router.post('/pickup-addresses/:addressId/set-default', businessController.setDefaultPickupAddress);

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
