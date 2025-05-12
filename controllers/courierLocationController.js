const Courier = require('../models/courier');

// Update courier location
const updateLocation = async (req, res) => {
    try {
        const { latitude, longitude } = req.body;
        const courierId = req.userId;

        if (!latitude || !longitude) {
            return res.status(400).json({ 
                success: false, 
                message: 'Latitude and longitude are required' 
            });
        }

        const courier = await Courier.findById(courierId);
        
        if (!courier) {
            return res.status(404).json({ 
                success: false, 
                message: 'Courier not found' 
            });
        }

        if (!courier.isLocationTrackingEnabled) {
            return res.status(403).json({ 
                success: false, 
                message: 'Location tracking is not enabled for this courier' 
            });
        }

        // Update courier location
        courier.currentLocation = {
            type: 'Point',
            coordinates: [longitude, latitude], // GeoJSON format: [longitude, latitude]
            lastUpdated: new Date()
        };

        await courier.save();

        return res.status(200).json({ 
            success: true, 
            message: 'Location updated successfully' 
        });
    } catch (error) {
        console.error('Error updating location:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Failed to update location', 
            error: error.message 
        });
    }
};

// Update courier location tracking preferences
const updateLocationPreferences = async (req, res) => {
    try {
        const { isEnabled } = req.body;
        const courierId = req.userId;

        if (isEnabled === undefined) {
            return res.status(400).json({ 
                success: false, 
                message: 'isEnabled parameter is required' 
            });
        }

        const courier = await Courier.findById(courierId);
        
        if (!courier) {
            return res.status(404).json({ 
                success: false, 
                message: 'Courier not found' 
            });
        }

        courier.isLocationTrackingEnabled = isEnabled;
        await courier.save();

        return res.status(200).json({ 
            success: true, 
            message: `Location tracking ${isEnabled ? 'enabled' : 'disabled'} successfully` 
        });
    } catch (error) {
        console.error('Error updating location preferences:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Failed to update location preferences', 
            error: error.message 
        });
    }
};

// Get courier location status
const getLocationStatus = async (req, res) => {
    try {
        const courierId = req.userId;

        const courier = await Courier.findById(courierId);
        
        if (!courier) {
            return res.status(404).json({ 
                success: false, 
                message: 'Courier not found' 
            });
        }

        return res.status(200).json({ 
            success: true, 
            isLocationTrackingEnabled: courier.isLocationTrackingEnabled,
            currentLocation: courier.currentLocation
        });
    } catch (error) {
        console.error('Error getting location status:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Failed to get location status', 
            error: error.message 
        });
    }
};

module.exports = {
    updateLocation,
    updateLocationPreferences,
    getLocationStatus
}; 