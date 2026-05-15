const express = require('express');
const router = express.Router();
const { postConnect } = require('../controllers/woocommercePublicController');

router.post('/connect', postConnect);

module.exports = router;
