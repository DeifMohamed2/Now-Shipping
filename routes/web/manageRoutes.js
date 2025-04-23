const express = require('express');
const router = express.Router();

const manageController = require('../../controllers/manageController.js');

router.get('/dashboard', manageController.getDashboardPage);
router.get('/orders', manageController.get_ordersPage);
router.get('/pickups', manageController.get_pickupsPage);

module.exports = router;
