const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../../models/user.js');

const jwtSecret = process.env.JWT_SECRET;

const businessController = require('../../controllers/businessController.js');

async function authenticateUser(req, res, next) {
  const token = req.cookies.token;
  if (!token) {
    console.log('Token not found');
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

// cash cycle
router.get('/wallet/cash-cycles', businessController.get_cashCyclesPage);

router.get(
  '/wallet/get-total-cashCycle-by-data',
  businessController.get_totalCashCycleByDate
);

router.get('/shop', businessController.get_shopPage);

// tickets
router.get('/tickets', businessController.get_ticketsPage);

//logout
router.get('/logout', businessController.logOut);

module.exports = router;
