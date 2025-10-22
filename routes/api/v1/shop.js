const express = require('express');
const router = express.Router();
const shopController = require('../../../controllers/shopController');
const multer = require('multer');
const path = require('path');
const jwt = require('jsonwebtoken');
const Admin = require('../../../models/admin');
const User = require('../../../models/user');
const Courier = require('../../../models/courier');

const jwtSecret = process.env.JWT_SECRET;

// Middleware to authenticate admin
async function authenticateAdmin(req, res, next) {
  const token = req.cookies.token;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const decode = jwt.verify(token, jwtSecret);
    const admin = await Admin.findById(decode.adminId);
    if (!admin) {
      return res.status(401).json({ error: 'Admin not found' });
    }
    req.admin = admin;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Middleware to authenticate business user
async function authenticateUser(req, res, next) {
  const token = req.cookies.token;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const decode = jwt.verify(token, jwtSecret);
    const user = await User.findById(decode.userId);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Middleware to authenticate courier
async function authenticateCourier(req, res, next) {
  const token = req.cookies.token;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const decode = jwt.verify(token, jwtSecret);
    const courier = await Courier.findById(decode.id);
    if (!courier) {
      return res.status(401).json({ error: 'Courier not found' });
    }
    req.courier = courier;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/uploads/shop/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'product-' + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: function (req, file, cb) {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(
      path.extname(file.originalname).toLowerCase()
    );
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'));
    }
  },
});

// Admin - Shop Products Management
router.get(
  '/admin/shop/products',
  authenticateAdmin,
  shopController.getProducts
);
router.get(
  '/admin/shop/products/:id',
  authenticateAdmin,
  shopController.getProduct
);
router.post(
  '/admin/shop/products',
  authenticateAdmin,
  shopController.createProduct
);
router.put(
  '/admin/shop/products/:id',
  authenticateAdmin,
  shopController.updateProduct
);
router.delete(
  '/admin/shop/products/:id',
  authenticateAdmin,
  shopController.deleteProduct
);
router.post(
  '/admin/shop/products/bulk-update-stock',
  authenticateAdmin,
  shopController.bulkUpdateStock
);

// Admin - Shop Orders Management
router.get(
  '/admin/shop/orders',
  authenticateAdmin,
  shopController.getShopOrders
);
router.get(
  '/admin/shop/orders/:id',
  authenticateAdmin,
  shopController.getShopOrder
);
router.put(
  '/admin/shop/orders/:id/status',
  authenticateAdmin,
  shopController.updateShopOrderStatus
);
router.put(
  '/admin/shop/orders/:id/assign-courier',
  authenticateAdmin,
  shopController.assignCourierToShopOrder
);

// Admin - Get all couriers for assignment
router.get('/admin/couriers', authenticateAdmin, async (req, res) => {
  try {
    const couriers = await Courier.find({ isActive: true }).select(
      'name phone'
    );
    res.status(200).json(couriers);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load couriers' });
  }
});

// Business - Shop
router.get(
  '/business/shop/products',
  authenticateUser,
  shopController.getAvailableProducts
);
router.post(
  '/business/shop/orders',
  authenticateUser,
  shopController.createShopOrder
);
router.get(
  '/business/shop/orders',
  authenticateUser,
  shopController.getBusinessShopOrders
);
router.get(
  '/business/shop/orders/:id',
  authenticateUser,
  shopController.getBusinessShopOrderDetails
);
router.put(
  '/business/shop/orders/:id/cancel',
  authenticateUser,
  shopController.cancelShopOrder
);

// Courier - Shop Deliveries
router.get(
  '/courier/shop/orders',
  authenticateCourier,
  shopController.getCourierShopOrders
);
router.get(
  '/courier/shop/orders/:id',
  authenticateCourier,
  shopController.getCourierShopOrderDetails
);
router.put(
  '/courier/shop/orders/:id/status',
  authenticateCourier,
  shopController.updateCourierShopOrderStatus
);

module.exports = router;
