const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/user');

const jwtSecret = process.env.JWT_SECRET;

const businessController = require('../controllers/businessController.js');

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
    if(!user){
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
router.post('/completionConfirm' , businessController.completionConfirm);


//orders
router.get('/orders', businessController.get_ordersPage);

router.get('/get-orders', businessController.get_orders);

router.get('/create-order'  ,businessController.get_createOrderPage);

router.post('/submit-order', businessController.submitOrder);

router.post('/orders/print-policy/:orderNumber/:pageSize', businessController.printPolicy);

router.get('/order-details/:orderNumber', businessController.get_orderDetailsPage);

router.get('/edit-order/:orderNumber', businessController.get_editOrderPage);

router.put('/orders/edit-order/:orderId', businessController.editOrder);

router.delete('/orders/delete-order/:orderId', businessController.deleteOrder);


// pickups
router.get('/pickups', businessController.get_pickupPage);

router.get('/get-pickups', businessController.get_pickups);

router.get('/pickup-details/:pickupNumber', businessController.get_pickupDetailsPage);

router.get('/pickup-details/:pickupNumber/get-pickedup-orders', businessController.get_pickedupOrders);

router.post('/pickup-details/:pickupNumber/rate-pickup', businessController.ratePickup);

router.post('/pickup/create-pickup', businessController.createPickup);

router.delete('/pickup/delete-pickup/:pickupId', businessController.deletePickup);


//wallet
router.get('/wallet/overview', businessController.get_walletOverviewPage);

router.get('/wallet/get-wallet-Overview-data', businessController.get_walletOverviewData);

router.get('/wallet/transactions', businessController.get_walletTransactionsPage);




router.get('/shop', businessController.get_shopPage);





//logout
router.get('/logout', businessController.logOut);

module.exports = router;