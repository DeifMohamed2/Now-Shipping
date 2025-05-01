const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Admin = require('../../models/admin.js');

const adminController = require('../../controllers/adminController.js');

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
    next(); // Move to the next middleware
  } catch (error) {
    res.clearCookie('token');
    return res.status(401).redirect('/admin-login');
  }
}

router.use(authenticateAdmin);

router.get('/dashboard', adminController.getDashboardPage);
router.get('/get-delivery-men', adminController.get_deliveryMenByZone);

router.get('/orders', adminController.get_ordersPage);
router.get('/get-orders', adminController.get_orders);
router.get('/order-details/:orderNumber', adminController.get_orderDetailsPage);

// couriers

router.get('/couriers', adminController.get_couriersPage);

router.get('/get-couriers', adminController.get_couriers);

router.post('/couriers/create-courier', adminController.createCourier);

// couriers-follow-up

router.get('/couriers-follow-up', adminController.get_couriersFollowUp);

// router.get('/get-couriers-follow-up', adminController.get_couriersFollowUp);

router.get('/courier-details/:courierId', adminController.get_courierDetailsPage);


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

router.get('/stock-management/pickups', adminController.get_stockManagementPage);

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

router.post('/return-courier-received', adminController.return_courier_received);

// router.get('/get-stock-managment', adminController.get_stockManagment);

// wallet overview

router.get('/release-amounts', adminController.get_releaseAmountsPage);

router.get('/get-release-all-data', adminController.get_releasesAllData);

router.post('/reschedule-release', adminController.rescheduleRelease);

router.post('/release-funds', adminController.releaseFunds);

// businesses

router.get('/businesses', adminController.get_businessesPage);

// tickets
router.get('/tickets', adminController.get_ticketsPage);

//logout
router.get('/logout', adminController.logOut);

module.exports = router;
