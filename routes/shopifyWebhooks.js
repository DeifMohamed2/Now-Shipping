const express = require('express');
const router = express.Router();
const shopifyController = require('../controllers/shopifyWebhookController');

router.post('/', shopifyController.handleWebhook);

module.exports = router;
