const express = require('express');
const router = express.Router();
const { verifyWoocommerceInstallation } = require('../middleware/woocommerceInstallationAuth');
const { verifyWoocommerceAppHmac } = require('../middleware/woocommerceAppHmac');
const woocommerceAppController = require('../controllers/woocommerceAppController');

router.get('/session', verifyWoocommerceInstallation, woocommerceAppController.getSession);
router.get('/status', verifyWoocommerceInstallation, woocommerceAppController.getStatus);
router.put(
  '/toggle-sync',
  verifyWoocommerceInstallation,
  verifyWoocommerceAppHmac,
  woocommerceAppController.putToggleSync
);
router.get('/sync-logs', verifyWoocommerceInstallation, woocommerceAppController.getSyncLogs);
router.get('/orders', verifyWoocommerceInstallation, woocommerceAppController.getOrders);
router.get('/pickups', verifyWoocommerceInstallation, woocommerceAppController.getPickups);
router.get('/wc-orders', verifyWoocommerceInstallation, woocommerceAppController.getWcOrders);
router.get('/zones', verifyWoocommerceInstallation, woocommerceAppController.getZones);
router.post(
  '/rest-credentials',
  verifyWoocommerceInstallation,
  verifyWoocommerceAppHmac,
  woocommerceAppController.postRestCredentials
);
router.post(
  '/import-order',
  verifyWoocommerceInstallation,
  verifyWoocommerceAppHmac,
  woocommerceAppController.postImportOrder
);
router.post(
  '/bulk-import',
  verifyWoocommerceInstallation,
  verifyWoocommerceAppHmac,
  woocommerceAppController.postBulkImport
);
router.post(
  '/print-awb',
  verifyWoocommerceInstallation,
  verifyWoocommerceAppHmac,
  woocommerceAppController.postPrintAwb
);

module.exports = router;
