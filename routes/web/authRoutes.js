const express = require('express');
const router = express.Router();

const authController = require('../../controllers/authController2.js');


// Landing page route
router.get('/', authController.index);

router.get('/mobileApp', authController.mobileAppPage);

router.get('/pricing', authController.pricingPage);

router.get('/aboutus', authController.aboutusPage);

router.get('/faq', authController.faqPage);

// Authentication routes

router.get('/login', authController.loginPage);
router.get('/register', authController.registerPage);

router.post('/signup', authController.signup);
router.post('/send-otp', authController.sendOTP);
router.post('/login', authController.login);

router.get('/verify-email', authController.verifyEmailBytoken);

router.get('/admin-login', authController.adminLogin);
router.post('/admin-login', authController.loginAsAdmin);
router.post('/create-admin', authController.createAdminAccount);

router.get('/courier-login', authController.courierLogin);

router.post('/courier-login', authController.loginAsCourier);

module.exports = router;
