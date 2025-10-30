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
    // Check if this is an API request (fetch request from JavaScript)
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(401).json({ message: 'Authentication required' });
    }
    return res.status(401).redirect('/courier-login');
  }

  try {
    const decode = jwt.verify(token, jwtSecret);
    req.courierId = decode.id;
    const courier = await Courier.findOne({ _id: decode.id });
    if (!courier) {
      res.clearCookie('token');
      // Check if this is an API request (fetch request from JavaScript)
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(401).json({ message: 'Invalid authentication token' });
      }
      return res.status(401).redirect('/courier-login');
    }
    req.courierData = courier; // Attach courier data to request object
    next(); // Move to the next middleware
  } catch (error) {
    res.clearCookie('token');
    // Check if this is an API request (fetch request from JavaScript)
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(401).json({ message: 'Authentication failed' });
    }
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

// Returns page
router.get('/returns', courierController.get_returnsPage);
router.get('/get-returns', courierController.get_returns);

router.get(
  '/order-details/:orderNumber',
  courierController.get_orderDetails
);

router.put(
  '/update-order-status/:orderNumber',
  courierController.updateOrderStatus
);

router.put('/complete-order/:orderNumber', courierController.completeOrder);

// Add new POST endpoint for order completion
router.post('/orders/:orderNumber/complete', courierController.completeOrder);

// Return handling routes
router.post(
  '/orders/:orderNumber/pickup-return',
  courierController.pickupReturn
);
router.post(
  '/orders/:orderNumber/deliver-to-warehouse',
  courierController.deliverReturnToWarehouse
);
router.post(
  '/orders/:orderNumber/complete-return-to-business',
  courierController.completeReturnToBusiness
);
router.get(
  '/return-orders/:orderNumber',
  courierController.getReturnOrderDetails
);

// Fast shipping scan route
router.post(
  '/orders/:orderNumber/scan-fast-shipping',
  courierController.scanFastShippingOrder
);

// Pickups

router.get('/pickups', courierController.get_pickupsPage);

router.get('/get-pickups', courierController.get_pickups);

router.get(
  '/pickup-details/:pickupNumber',
  courierController.get_pickupDetails
);

router.get(
  '/getAndSet-order-details/:pickupNumber/:orderNumber',
  courierController.getAndSet_order_To_Pickup
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

// Shop deliveries routes
router.get('/shop-orders', courierController.getCourierShopOrdersPage);
router.get('/shop-orders/:id', courierController.getCourierShopOrderDetailsPage);

// Shop API routes
router.get('/api/shop/orders', courierController.getCourierShopOrders);
router.get('/api/shop/orders/:id', courierController.getCourierShopOrderDetails);
router.put('/api/shop/orders/:id/status', courierController.updateCourierShopOrderStatus);

//logout

router.get('/logout', courierController.logOut);

module.exports = router;
