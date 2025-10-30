const jwt = require('jsonwebtoken');

/**
 * Middleware to verify JWT token for API requests
 */
const verifyToken = (req, res, next) => {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'No token provided or invalid token format'
      });
    }
    
    // Extract the token
    const token = authHeader.split(' ')[1];
    
    // Verify the token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    
    // Add user ID to request object - handle different fields in the token
    if (decoded.id) {
      req.userId = decoded.id;
      // If this is a courier token, also set courierId for compatibility
      if (decoded.userType === 'courier') {
        req.courierId = decoded.id;
      }
    } else if (decoded.courierId) {
      req.userId = decoded.courierId;
      req.courierId = decoded.courierId;
    } else if (decoded.adminId) {
      req.userId = decoded.adminId;
    } else if (decoded.userId) {
      req.userId = decoded.userId;
    } else {
      console.error('Token does not contain a valid user ID field:', decoded);
      return res.status(401).json({
        success: false,
        message: 'Invalid token: no user ID found'
      });
    }
    
    // Set user type
    req.userType = decoded.userType || 
                  (decoded.courierId ? 'courier' : 
                  (decoded.adminId ? 'admin' : 
                  (decoded.id && decoded.userType === 'courier' ? 'courier' : 'user')));
    
    
    next();
  } catch (error) {
    console.error('Token verification error:', error);
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired'
      });
    }
    
    return res.status(401).json({
      success: false,
      message: 'Invalid token'
    });
  }
};

module.exports = {
  verifyToken
}; 