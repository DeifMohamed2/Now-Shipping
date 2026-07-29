const express = require('express');
const router = express.Router();
const { verifyShopifySessionToken } = require('../middleware/shopifySessionToken');
const shopifyAppController = require('../controllers/shopifyAppController');

router.get('/session', verifyShopifySessionToken, shopifyAppController.getSession);
router.get('/status', verifyShopifySessionToken, shopifyAppController.getStatus);
router.put('/toggle-sync', verifyShopifySessionToken, shopifyAppController.putToggleSync);
router.get('/sync-logs', verifyShopifySessionToken, shopifyAppController.getSyncLogs);
router.get('/orders', verifyShopifySessionToken, shopifyAppController.getOrders);
router.get('/pickups', verifyShopifySessionToken, shopifyAppController.getPickups);

router.get('/shopify-orders/by-ids', verifyShopifySessionToken, shopifyAppController.getShopifyOrdersByIds);
router.get('/shopify-orders', verifyShopifySessionToken, shopifyAppController.getShopifyOrders);
router.get('/zones', verifyShopifySessionToken, shopifyAppController.getZones);
router.post('/import-order', verifyShopifySessionToken, shopifyAppController.postImportOrder);
router.post('/bulk-import', verifyShopifySessionToken, shopifyAppController.postBulkImport);
router.post('/sync-fulfillment', verifyShopifySessionToken, shopifyAppController.postSyncFulfillment);
router.post('/bulk-sync-fulfillment', verifyShopifySessionToken, shopifyAppController.postBulkSyncFulfillment);
router.post('/print-awb', verifyShopifySessionToken, shopifyAppController.postPrintAwb);

module.exports = router;
