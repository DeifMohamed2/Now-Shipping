const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../../../models/user.js');

const jwtSecret = process.env.JWT_SECRET;

const businessController = require('../../../controllers/businessController.js');


async function authenticateUser(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.log('Authorization header not found or invalid');
        return res.status(401).json({ message: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decode = jwt.verify(token, jwtSecret);
        req.userId = decode.userId;
        const user = await User.findOne({ _id: decode.userId });
        req.userData = user; // Attach user data to request object
        if (!user) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        next(); // Move to the next middleware
    } catch (error) {
        return res.status(401).json({ message: 'Unauthorized' });
    }
}

router.use(authenticateUser);

//dashboard

router.get('/dashboard', businessController.getDashboardData);

router.post('/complete-confirmation-form', businessController.completionConfirm);

router.get('/request-verification-email', businessController.requestVerification);


//orders

router.get('/orders', businessController.get_orders);

router.post('/submit-order', businessController.submitOrder);

router.post('/orders/print-policy/:orderNumber/:pageSize', businessController.printPolicy);

router.get('/order-details/:orderNumber', businessController.get_orderDetailsPage);

router.put('/orders/edit-order/:orderId', businessController.editOrder);

router.delete('/orders/delete-order/:orderId', businessController.deleteOrder);

router.post('/calculate-fees', businessController.calculateOrderFees);





//pickups

router.get('/get-pickups', businessController.get_pickups);

router.post('/create-pickup', businessController.createPickup);

router.get('/pickup-details/:pickupNumber', businessController.get_pickupDetailsPage);

router.get('/pickup-details/:pickupNumber/get-pickedup-orders', businessController.get_pickedupOrders);

router.post('/pickup-details/:pickupNumber/rate-pickup', businessController.ratePickup);

router.delete('/pickup-details/:pickupNumber/delete-pickup', businessController.deletePickup);

module.exports = router;
