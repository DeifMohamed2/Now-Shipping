const express = require('express');
const router = express.Router();

const authController = require('../../controllers/authController2.js');

// Timeout middleware for login routes
const loginTimeout = (req, res, next) => {
  const timeout = setTimeout(() => {
    if (!res.headersSent) {
      res.status(408).json({
        status: 'error',
        message: 'Request timeout. Please try again.'
      });
    }
  }, 10000); // 10 second timeout

  res.on('finish', () => {
    clearTimeout(timeout);
  });

  next();
};


// Landing page route
router.get('/', authController.index);

router.get('/mobileApp', authController.mobileAppPage);

router.get('/pricing', authController.pricingPage);

router.get('/aboutus', authController.aboutusPage);

router.get('/faq', authController.faqPage);

router.get('/privacypolicy', authController.privacyPolicyPage);

// Authentication routes

router.get('/login', authController.loginPage);
router.get('/register', authController.registerPage);

router.post('/signup', authController.signup);
router.post('/send-otp', authController.sendOTP);
router.post('/login', loginTimeout, authController.login);

router.get('/verify-email', authController.verifyEmailBytoken);

router.get('/admin-login', authController.adminLogin);
router.post('/admin-login', loginTimeout, authController.loginAsAdmin);
router.post('/create-admin', authController.createAdminAccount);

router.get('/courier-login', authController.courierLogin);

router.post('/courier-login', loginTimeout, authController.loginAsCourier);

module.exports = router;
