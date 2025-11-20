const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Admin = require('../../models/admin.js');
const Notification = require('../../models/notification.js');

const adminController = require('../../controllers/adminController.js');
const notificationController = require('../../controllers/notificationController.js');

const jwtSecret = process.env.JWT_SECRET;

async function authenticateAdmin(req, res, next) {
  const token = req.cookies.token;
  if (!token) {
    console.log('Token not found');
    return res.status(401).redirect('/admin-login');
  }

  try {
    const decode = jwt.verify(token, jwtSecret);
    req.adminId = decode.adminId;
    const admin = await Admin.findOne({ _id: decode.adminId });
    if (!admin) {
      res.clearCookie('token');
      return res.status(401).redirect('/admin-login');
    }
    req.adminData = admin; // Attach admin data to request object

    // Make adminData available to all views
    res.locals.adminData = admin;

    next(); // Move to the next middleware
  } catch (error) {
    res.clearCookie('token');
    return res.status(401).redirect('/admin-login');
  }
}

router.use(authenticateAdmin);

router.get('/dashboard', adminController.getDashboardPage);
router.get('/dashboard-data', adminController.getAdminDashboardData);
router.get('/get-delivery-men', adminController.get_deliveryMenByZone);
router.post('/assign-delivery-man', adminController.assignCourierToStock);

router.get('/orders', adminController.get_ordersPage);
router.get('/get-orders', adminController.get_orders);
router.get('/order-details/:orderNumber', adminController.get_orderDetailsPage);

// couriers

router.get('/couriers', adminController.get_couriersPage);

router.get('/get-couriers', adminController.get_couriers);

router.post('/couriers/create-courier', adminController.createCourier);

router.put('/couriers/update-zones', adminController.updateCourierZones);

// couriers-follow-up

router.get('/couriers-follow-up', adminController.get_couriersFollowUp);

// router.get('/get-couriers-follow-up', adminController.get_couriersFollowUp);

router.get(
  '/courier-details/:courierId',
  adminController.get_courierDetailsPage
);

// pickups
router.get('/pickups', adminController.get_pickupsPage);

router.get('/get-pickups', adminController.get_pickups);

router.get(
  '/pickup-details/:pickupNumber',
  adminController.get_pickupDetailsPage
);

router.get(
  '/pickup-details/:pickupNumber/get-pickedup-orders',
  adminController.get_pickedupOrders
);

router.put('/cancel-pickup/:pickupId', adminController.cancelPickup);

router.delete('/delete-pickup/:pickupId', adminController.deletePickup);

router.get('/get-pickup-men', adminController.get_pickupMenByZone);

router.post('/assign-pickup-man', adminController.assignPickupMan);

//======= stock management ==========//

// stock Managment Pickup

router.get(
  '/stock-management/pickups',
  adminController.get_stockManagementPage
);

router.get('/get-stock-orders', adminController.get_stock_orders);

router.post('/add-to-stock', adminController.add_to_stock);

router.get('/get-couriers-by-zone', adminController.get_couriers_by_zone);

router.post(
  '/stock-managment/assign-courier',
  adminController.assignCourierToStock
);

router.post(
  '/stock-managment/courier-received',
  adminController.courier_received
);

// stock Managment Returns

router.get('/stock-management/returns', adminController.get_stockReturnsPage);

router.get('/get-return-orders', adminController.getReturnedOrders);

router.post('/add-return-to-stock', adminController.add_return_to_stock);

router.post('/return-assign-courier', adminController.assignCourierToReturn);

router.post(
  '/return-courier-received',
  adminController.return_courier_received
);

// return management
router.post(
  '/assign-courier-to-return-to-business',
  adminController.assignCourierToReturnToBusiness
);

// Enhanced Return Flow routes
router.post(
  '/orders/:orderId/convert-to-return/:reason',
  adminController.convertFailedDeliveryToReturn
);
router.get('/return-orders', adminController.getAllReturnOrders);
router.get(
  '/return-orders/:orderId',
  adminController.getReturnOrderDetailsAdmin
);
router.put(
  '/return-orders/:orderId/inspection',
  adminController.updateReturnInspection
);
router.put(
  '/return-orders/:orderId/processing',
  adminController.updateReturnProcessing
);

// router.get('/get-stock-managment', adminController.get_stockManagment);

// wallet overview

router.get('/release-amounts', adminController.get_releaseAmountsPage);

router.get('/get-release-all-data', adminController.get_releasesAllData);

router.post('/reschedule-release', adminController.rescheduleRelease);

router.post('/release-funds', adminController.releaseFunds);

// Export routes
router.get('/export-releases-excel', adminController.exportReleasesToExcel);
router.get('/export-releases-pdf', adminController.exportReleasesToPDF);
router.get(
  '/get-release-details/:releaseId',
  adminController.getReleaseDetails
);

// businesses

router.get('/businesses', adminController.get_businessesPage);
router.get('/get-businesses', adminController.get_businesses);
router.get(
  '/business-details/:businessId',
  adminController.get_businessDetailsPage
);
router.get(
  '/get-business-details/:businessId',
  adminController.get_businessDetails
);

// tickets
router.get('/tickets', adminController.get_ticketsPage);

//logout
router.get('/logout', adminController.logOut);

// waitingAction admin overrides
router.post(
  '/orders/:orderId/retry-tomorrow',
  adminController.adminRetryTomorrow
);
router.post(
  '/orders/:orderId/retry-scheduled',
  adminController.adminRetryScheduled
);
router.post(
  '/orders/:orderId/return-to-warehouse',
  adminController.adminReturnToWarehouseFromWaiting
);
router.post('/orders/cancel-order/:orderId', adminController.adminCancelOrder);
router.post('/orders/:orderId/cancel', adminController.adminCancelFromWaiting);
router.post(
  '/orders/:orderId/change-return-courier',
  adminController.changeReturnCourier
);

// Courier Tracking
router.get('/courier-tracking', adminController.courierTracking);
router.get('/courier-locations', adminController.getCourierLocations);
router.get('/courier-location/:id', adminController.getCourierLocation);

// Notification routes - Couriers
router.get('/notifications', notificationController.getNotificationsPage);
router.post(
  '/notifications/courier',
  notificationController.sendNotificationToCourier
);
router.post(
  '/notifications/broadcast',
  notificationController.sendNotificationToAllCouriers
);

// Notification routes - Businesses
router.get('/notifications/businesses', notificationController.getBusinessNotificationsPage);
router.post(
  '/notifications/business',
  notificationController.sendNotificationToBusiness
);
router.post(
  '/notifications/businesses/broadcast',
  notificationController.sendNotificationToAllBusinesses
);

// Shared notification routes
router.get(
  '/notifications/recent',
  notificationController.getRecentNotifications
);

// FCM Token Management routes
router.post(
  '/notifications/cleanup-tokens',
  notificationController.cleanupInvalidTokens
);
router.post('/notifications/test-token', notificationController.testUserToken);

// Financial Processing Management routes
router.get(
  '/financial-processing',
  adminController.get_financialProcessingPage
);

// Financial Processing API routes
router.post('/api/run-daily-processing', adminController.runDailyProcessing);
router.get(
  '/api/processing-statistics',
  adminController.getProcessingStatistics
);
router.get(
  '/api/reconciliation-report',
  adminController.generateReconciliationReport
);
router.get(
  '/api/reset-orphaned-flags',
  adminController.resetOrphanedProcessingFlags
);
router.get(
  '/api/validate-business-balances',
  adminController.validateBusinessBalances
);
router.post(
  '/api/fix-balance-discrepancies',
  adminController.fixBalanceDiscrepancies
);
router.post(
  '/api/process-specific-orders',
  adminController.processSpecificOrdersAdmin
);
router.get(
  '/api/recover-failed-processing',
  adminController.recoverFailedProcessingAdmin
);

// Transaction Details API routes
router.get(
  '/get-transaction-details/:transactionId',
  adminController.getTransactionDetails
);
router.get(
  '/get-detailed-transaction-info/:transactionId',
  adminController.getDetailedTransactionInfo
);

// Admin Shop API routes (must come before page routes to avoid conflicts)
router.get('/api/shop/products', adminController.getProducts);
router.post('/api/shop/products', adminController.createProduct);
router.get('/api/shop/products/:id', adminController.getProduct);
router.put('/api/shop/products/:id', adminController.updateProduct);
router.delete('/api/shop/products/:id', adminController.deleteProduct);

router.get('/api/shop/orders', adminController.getShopOrders);
router.get('/api/shop/orders/:id', adminController.getShopOrder);
router.put(
  '/api/shop/orders/:id/status',
  adminController.updateShopOrderStatus
);
router.put(
  '/api/shop/orders/:id/assign-courier',
  adminController.assignCourierToShopOrder
);
router.post(
  '/api/shop/orders/assign-multiple-couriers',
  adminController.assignMultipleCouriersToShopOrders
);
router.get('/api/shop/couriers-by-zone', adminController.get_deliveryMenByZone);
router.get('/api/couriers', adminController.get_couriers);
router.get('/api/admin/couriers', adminController.getAllCouriers);

// Shop Management page routes
router.get('/shop/products', adminController.getShopProductsPage);
router.get('/shop/orders', adminController.getShopOrdersPage);
router.get('/shop/orders/:id', adminController.getShopOrderDetailsPage);

// Smart Flyers Management
router.get('/print-smart-flyers', adminController.getPrintSmartFlyersPage);
router.post('/generate-smart-flyers', adminController.generateSmartFlyers);

module.exports = router;
