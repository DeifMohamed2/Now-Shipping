const express = require('express');
const router = express.Router();


// Load controller

const businessController = require('../controllers/businessController.js');

// Define routes

router.get('/dashboard', businessController.getDashboardPage);
router.get('/orders', businessController.get_ordersPage);
router.get('/create-order'  , businessController.get_createOrderPage);
router.get('/pickup', businessController.get_pickupPage);
router.get('/wallet/overview', businessController.get_walletOverviewPage);
router.get('/wallet/transactions', businessController.get_walletTransactionsPage);
router.get('/shop', businessController.get_shopPage);
router.get('/order-details', businessController.get_orderDetailsPage);
router.get('/pickup-details', businessController.get_pickupDetailsPage);

module.exports = router;