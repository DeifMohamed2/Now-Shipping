const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../../models/user.js');

const jwtSecret = process.env.JWT_SECRET;

const multer = require('multer');
const businessController = require('../../controllers/businessController.js');
const assistantController = require('../../controllers/assistantController.js');

const orderImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const name = file.originalname || '';
    const nameOk = /\.xlsx$/i.test(name);
    const mimeOk =
      file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      (file.mimetype === 'application/octet-stream' && nameOk);
    if (nameOk || mimeOk) cb(null, true);
    else cb(new Error('Only Excel files (.xlsx) are allowed.'));
  },
});

function orderImportUploadSingle(req, res, next) {
  orderImportUpload.single('file')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Upload failed.' });
    }
    next();
  });
}

async function authenticateUser(req, res, next) {
  const token = req.cookies.token;
  
  // Check if this is a JSON API request
  const isApiRequest = 
    req.path.startsWith('/api/') ||
    req.path.includes('-data') ||  // Includes dashboard-data, order-data, etc.
    req.path.includes('orders-import') ||
    req.headers['content-type'] === 'application/json' ||
    req.xhr ||
    (req.headers['accept'] && req.headers['accept'].includes('application/json'));
  
  if (!token) {
    console.log('Token not found');
    if (isApiRequest) {
      return res.status(401).json({ error: 'Authentication required', message: 'No token provided' });
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
      if (isApiRequest) {
        return res.status(401).json({ error: 'User not found', message: 'Invalid user credentials' });
      }
      return res.status(401).redirect('/login');
    }

    // If the business account is not completed, restrict access to everything except dashboard pages
    const normalizedRole = (user && user.role ? String(user.role).toLowerCase() : '');
    const isCompleted = Boolean(user && user.isCompleted);
    if (normalizedRole === 'business' && !isCompleted) {
      const allowedWhenIncomplete = new Set(['/dashboard', '/dashboard-data', '/completionConfirm', '/request-verification']);

      if (!allowedWhenIncomplete.has(req.path)) {
        // Expose flag to templates if needed
        res.locals.accountIncomplete = true;

        if (isApiRequest) {
          return res
            .status(403)
            .json({ error: 'Account not completed', message: 'Access restricted to dashboard.' });
        }
        return res.redirect('/business/dashboard');
      }
    }

    next(); // Move to the next middleware
  } catch (error) {
    console.error('Authentication error:', error);
    res.clearCookie('token');
    if (isApiRequest) {
      return res.status(401).json({ error: 'Invalid token', message: error.message });
    }
    return res.status(401).redirect('/login');
  }
}

/** Public: must run before authenticateUser so logout always clears the session cookie. */
router.get('/logout', businessController.logOut);

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

router.get('/orders-import-template', businessController.getOrdersImportTemplate);

router.post('/orders-import-validate', orderImportUploadSingle, businessController.postOrdersImportValidate);

router.post('/orders-import-commit', orderImportUploadSingle, businessController.postOrdersImportCommit);

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

// Redirect legacy / mis-typed URL patterns to the canonical order details route
router.get('/orders/:orderNumber/details', function (req, res) {
  res.redirect(301, '/business/order-details/' + req.params.orderNumber);
});

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
// Same handler as /cancel — alias for parity with /api/v1/business/.../cancel-from-waiting
router.post('/orders/:orderId/cancel', businessController.cancelFromWaiting);
router.post(
  '/orders/:orderId/cancel-from-waiting',
  businessController.cancelFromWaiting
);

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

router.put(
  '/pickup/update-pickup/:pickupId',
  businessController.updatePickup
);

router.put(
  '/pickup/cancel-pickup/:pickupId',
  businessController.cancelPickup
);

router.delete(
  '/pickup/delete-pickup/:pickupId',
  businessController.deletePickup
);

// Wallet
router.get('/wallet', businessController.get_walletPage);
router.get('/wallet/entries', businessController.get_walletEntries);
router.get('/wallet/export', businessController.exportWalletToExcel);

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

module.exports = router;
