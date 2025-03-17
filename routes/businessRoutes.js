const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/user');

const jwtSecret = process.env.JWT_SECRET;
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
    // if(!user.role){
    //   res.clearCookie('token');
    //   return res.status(401).redirect('../login');
    // }

    next(); // Move to the next middleware
  } catch (error) {
    res.clearCookie('token');
    return res.status(401).redirect('/login');
  }
}


// Load controller

const businessController = require('../controllers/businessController.js');

// Define routes
//dashboard
router.get('/dashboard',authenticateUser, businessController.getDashboardPage);
router.post('/completionConfirm', authenticateUser , businessController.completionConfirm);



router.get('/orders',authenticateUser, businessController.get_ordersPage);
router.get('/get-orders', authenticateUser, businessController.get_orders);
router.get('/create-order'  , authenticateUser ,businessController.get_createOrderPage);
router.post('/submit-order', authenticateUser, businessController.submitOrder);
router.post('/orders/print-policy/:orderNumber/:pageSize', authenticateUser, businessController.printPolicy);
router.get('/order-details/:orderNumber', businessController.get_orderDetailsPage);
router.get('/edit-order/:orderNumber', authenticateUser, businessController.get_editOrderPage);
router.put('/orders/edit-order/:orderId', authenticateUser, businessController.editOrder);
router.delete('/orders/delete-order/:orderId', authenticateUser, businessController.deleteOrder);


router.get('/pickup', authenticateUser, businessController.get_pickupPage);
router.get('/wallet/overview',authenticateUser, businessController.get_walletOverviewPage);
router.get('/wallet/transactions', businessController.get_walletTransactionsPage);
router.get('/shop', businessController.get_shopPage);
router.get('/pickup-details', businessController.get_pickupDetailsPage);

module.exports = router;