const express = require('express');
const path = require('path');
const fs = require('fs');
const {
  apiKeyAuth,
  requireMerchant,
  requireCompanyAccount,
  resolveMerchantForPricing,
  requireApiScope,
} = require('../../../../middleware/apiKeyAuth');
const publicApiController = require('../../../../controllers/publicApiController');

const router = express.Router();

/** Public documentation (no API key required) */
router.get('/openapi.yaml', (req, res) => {
  const specPath = path.join(__dirname, '../../../../docs/api/v1/openapi.yaml');
  if (!fs.existsSync(specPath)) {
    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'OpenAPI spec not found' } });
  }
  res.type('application/yaml');
  return res.sendFile(specPath);
});

router.get('/docs', (req, res) => {
  const html = `<!DOCTYPE html>
<html>
<head>
  <title>Now Shipping API v1</title>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link href="https://fonts.googleapis.com/css?family=Montserrat:300,400,700|Roboto:300,400,700" rel="stylesheet">
  <style>body { margin: 0; padding: 0; }</style>
</head>
<body>
  <redoc spec-url="/api/public/v1/openapi.yaml"></redoc>
  <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
</body>
</html>`;
  res.type('text/html');
  return res.send(html);
});

router.use(apiKeyAuth);

const requireMerchantsScope = requireApiScope('merchants', { merchantBackwardCompat: true });
const requireOrdersScope = requireApiScope('orders');
const requirePickupsScope = requireApiScope('pickups');

// Company-level (no merchant required)
router.get('/ping', publicApiController.ping);
router.get('/delivery-zones', publicApiController.getDeliveryZones);
router.post('/fees/calculate', resolveMerchantForPricing, publicApiController.calculateFees);
router.get('/merchants', requireCompanyAccount, requireMerchantsScope, publicApiController.listMerchants);
router.post('/merchants', requireCompanyAccount, requireMerchantsScope, publicApiController.createMerchant);
router.get('/merchants/:merchantId', requireCompanyAccount, requireMerchantsScope, publicApiController.getMerchant);

// Orders (merchant required for company keys)
router.post('/orders', requireOrdersScope, requireMerchant, publicApiController.createOrder);
router.get('/orders', requireOrdersScope, requireMerchant, publicApiController.listOrders);
router.get('/orders/:orderNumber/awb', requireOrdersScope, requireMerchant, publicApiController.downloadAwb);
router.get('/orders/:orderNumber', requireOrdersScope, requireMerchant, publicApiController.getOrder);
router.put('/orders/:orderId', requireOrdersScope, requireMerchant, publicApiController.updateOrder);
router.post('/orders/:orderId/cancel', requireOrdersScope, requireMerchant, publicApiController.cancelOrder);
router.delete('/orders/:orderId', requireOrdersScope, requireMerchant, publicApiController.deleteOrder);

// Pickups (merchant required for company keys)
router.post('/pickups/calculate-fee', requirePickupsScope, requireMerchant, publicApiController.calculatePickupFee);
router.post('/pickups', requirePickupsScope, requireMerchant, publicApiController.createPickup);
router.get('/pickups', requirePickupsScope, requireMerchant, publicApiController.listPickups);
router.get('/pickups/:pickupNumber', requirePickupsScope, requireMerchant, publicApiController.getPickup);
router.put('/pickups/:pickupNumber', requirePickupsScope, requireMerchant, publicApiController.updatePickup);
router.post('/pickups/:pickupNumber/cancel', requirePickupsScope, requireMerchant, publicApiController.cancelPickup);
router.delete('/pickups/:pickupNumber', requirePickupsScope, requireMerchant, publicApiController.deletePickup);

module.exports = router;
