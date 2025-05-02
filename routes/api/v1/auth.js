const express = require('express');
const router = express.Router();

const authController = require('../../../controllers/authController2.js');

// Business routes
router.post('/login', authController.login);

router.post('/signup', authController.signup);

router.post('/send-otp', authController.sendOTP);

// ADMIN LOGIN
router.post('/admin-login', authController.loginAsAdmin);


// COURIER LOGIN
router.post('/courier-login', authController.loginAsCourier);


// OTP
router.post('/send-otp', authController.sendOTP);



module.exports = router;
