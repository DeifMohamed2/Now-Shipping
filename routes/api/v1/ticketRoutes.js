const express = require('express');
const router = express.Router();
const ticketController = require('../../../controllers/ticketController');
const jwt = require('jsonwebtoken');
const User = require('../../../models/user');
const Admin = require('../../../models/admin');
const multer = require('multer');
const path = require('path');

const jwtSecret = process.env.JWT_SECRET;

// Web-based authentication middleware (uses cookies like business routes)
async function authenticateUser(req, res, next) {
  const token = req.cookies.token;
  if (!token) {
    console.log('Token not found in cookies');
    return res
      .status(401)
      .json({ success: false, message: 'Authentication required' });
  }

  try {
    const decode = jwt.verify(token, jwtSecret);
    req.userId = decode.userId || decode.adminId;
    req.userType = decode.adminId ? 'admin' : 'business';

    // Fetch full user data
    if (req.userType === 'admin') {
      const admin = await Admin.findById(req.userId);
      req.userData = admin;
      res.locals.userData = admin;
      res.locals.user = admin;
    } else {
      const user = await User.findById(req.userId);
      req.userData = user;
      res.locals.userData = user;
      res.locals.user = user;
    }

    if (!req.userData) {
      res.clearCookie('token');
      return res
        .status(401)
        .json({ success: false, message: 'User not found' });
    }

    next();
  } catch (error) {
    console.error('Token verification error:', error);
    res.clearCookie('token');
    return res
      .status(401)
      .json({ success: false, message: 'Invalid or expired token' });
  }
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/uploads/tickets/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(
      null,
      file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname)
    );
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: function (req, file, cb) {
    // Allowed file types
    const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|txt|mp3|mp4|wav/;
    const extname = allowedTypes.test(
      path.extname(file.originalname).toLowerCase()
    );
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(
        new Error(
          'Invalid file type. Only images, PDFs, documents, and audio/video files are allowed.'
        )
      );
    }
  },
});

// Apply authentication to all routes
router.use(authenticateUser);

// Ticket CRUD routes
router.post('/', ticketController.createTicket);
router.get('/', ticketController.getTickets);
router.get('/statistics', ticketController.getTicketStatistics);
router.get('/:id', ticketController.getTicketById);
router.put('/:id', ticketController.updateTicket);
router.delete('/:id', ticketController.deleteTicket);

// Message routes
router.get('/:id/messages', ticketController.getTicketMessages);
router.post('/:id/messages', ticketController.sendMessage);
router.post(
  '/:id/upload',
  upload.array('files', 5),
  ticketController.uploadMessageAttachment
);

// Rating route
router.post('/:id/rate', ticketController.rateTicket);

// Order search route
router.get('/orders/search', ticketController.searchOrders);

module.exports = router;
