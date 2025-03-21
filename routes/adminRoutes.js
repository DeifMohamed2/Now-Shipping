const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Admin = require('../models/admin');

const adminController = require('../controllers/adminController.js');

const jwtSecret = process.env.JWT_SECRET;

async function authenticateAdmin(req, res, next) {
    const token = req.cookies.token;
    console.log(token);
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


router.get('/pickups', adminController.get_pickupsPage);

router.get('/get-pickups', adminController.get_pickups);

router.get('/pickup-details/:pickupNumber', adminController.get_pickupDetailsPage);

router.get('/pickup-details/:pickupNumber/get-pickedup-orders', adminController.get_pickedupOrders);

router.put('/cancel-pickup/:pickupId', adminController.cancelPickup);

router.delete('/delete-pickup/:pickupId', adminController.deletePickup);

router.get('/get-pickup-men', adminController.get_pickupMenByZone);

router.post('/assign-pickup-man', adminController.assignPickupMan);


module.exports = router;