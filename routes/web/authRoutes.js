const express = require('express');
const router = express.Router();

const authController = require('../../controllers/authController2.js');

//index
// router.get('/', authController.index);

router.get('/', authController.index);
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
