const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Courier = require('../../models/courier.js');
const jwtSecret = process.env.JWT_SECRET;

const courierController = require('../../controllers/courierController.js');

async function authenticateCourier(req, res, next) {
  const token = req.cookies.token;
  if (!token) {
    console.log('Token not found');
    return res.status(401).redirect('/courier-login');
  }

  try {
    const decode = jwt.verify(token, jwtSecret);
    console.log('decode:', decode);
    req.courierId = decode.id;
    const courier = await Courier.findOne({ _id: decode.id });
    if (!courier) {
      res.clearCookie('token');
      return res.status(401).redirect('/courier-login');
    }
    req.courierData = courier; // Attach courier data to request object
    next(); // Move to the next middleware
  } catch (error) {
    res.clearCookie('token');
    return res.status(401).redirect('/courier-login');
  }
}

router.use(authenticateCourier);

// Define routes

//dashboard

router.get('/dashboard', courierController.getDashboardPage);

// orders

router.get('/orders', courierController.get_ordersPage);

router.get('/get-orders', courierController.get_orders);

router.get(
  '/order-details/:orderNumber',
  courierController.get_orderDetailsPage
);

router.put('/update-order-status/:orderNumber', courierController.updateOrderStatus);

router.put('/complete-order/:orderNumber', courierController.completeOrder);

// Pickups

router.get('/pickups', courierController.get_pickupsPage);

router.get('/get-pickups', courierController.get_pickups);

router.get(
  '/pickup-details/:pickupNumber',
  courierController.get_pickupDetailsPage
);

router.get(
  '/getAndSet-order-details/:pickupNumber/:orderNumber',
  courierController.getAndSet_orderDetails
);

router.get(
  '/get-picked-up-orders/:pickupNumber',
  courierController.get_picked_up_orders
);

router.delete(
  '/remove-picked-up-order/:pickupNumber/:orderNumber',
  courierController.removePickedUpOrder
);

router.put('/complete-pickup/:pickupNumber', courierController.completePickup);

//logout

router.get('/logout', courierController.logOut);

module.exports = router;
