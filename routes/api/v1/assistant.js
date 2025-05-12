const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../../../models/user');

const jwtSecret = process.env.JWT_SECRET;
const assistantController = require('../../../controllers/assistantController');

// Authentication middleware for API
const authenticateAPI = async (req, res, next) => {
  try {
    // Check for token in headers
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        status: 'error',
        message: 'Authentication required' 
      });
    }

    // Extract and verify token
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, jwtSecret);
    
    // Find user and attach to request
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(401).json({ 
        status: 'error',
        message: 'User not found' 
      });
    }
    
    req.userData = user;
    next();
  } catch (error) {
    console.error('API Authentication Error:', error);
    return res.status(401).json({ 
      status: 'error',
      message: 'Invalid or expired token' 
    });
  }
};

// Apply authentication middleware to all routes
router.use(authenticateAPI);

// Assistant API routes
router.get('/preferences', assistantController.getPreferences);
router.post('/preferences', assistantController.updatePreferences);
router.get('/conversation', assistantController.getConversation);
router.post('/send', assistantController.sendMessage);
router.post('/clear', assistantController.clearConversation);

module.exports = router; 