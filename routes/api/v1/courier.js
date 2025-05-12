const express = require('express');
const router = express.Router();
const { verifyToken } = require('../../../middleware/authMiddleware');
const courierLocationController = require('../../../controllers/courierLocationController');

// Update courier location
router.post('/location', verifyToken, courierLocationController.updateLocation);

// Update courier location tracking preferences
router.post('/location/preferences', verifyToken, courierLocationController.updateLocationPreferences);

// Get courier location status
router.get('/location/status', verifyToken, courierLocationController.getLocationStatus);

module.exports = router; 