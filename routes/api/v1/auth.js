const express = require('express');
const router = express.Router();

const authController = require('../../../controllers/authController.js');

// Business routes
router.post('/login', authController.login);

router.post('/signup', authController.signup);

router.post('/send-otp', authController.sendOTP);

router.post('/forgot-password/send-otp', authController.forgotPasswordSendOtp);
router.post('/forgot-password/verify-otp', authController.forgotPasswordVerifyOtp);
router.post('/forgot-password/reset', authController.forgotPasswordReset);

// ADMIN LOGIN
router.post('/admin-login', authController.loginAsAdmin);

// COURIER LOGIN
router.post('/courier-login', authController.loginAsCourier);

module.exports = router;
