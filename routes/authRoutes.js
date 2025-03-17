const express = require('express');
const router = express.Router();

const authController = require('../controllers/authController2.js');

router.get('/login', authController.loginPage);
router.get('/register', authController.registerPage);

router.post('/signup', authController.signup);
router.post('/login', authController.login);

router.get('/verify-email', authController.verifyEmailBytoken);

module.exports = router; 