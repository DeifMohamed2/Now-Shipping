const socketIO = require('socket.io');
const jwt = require('jsonwebtoken');
const Courier = require('../models/courier');

let io;

// Initialize Socket.IO
const initializeSocket = (server) => {
    io = socketIO(server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        },
        transports: ['websocket', 'polling'],
        pingTimeout: 30000,
        pingInterval: 25000,
        allowEIO3: true
    });

    // Authentication middleware for authenticated routes
    const authenticatedNamespace = io.of('/authenticated');
    
    authenticatedNamespace.use(async (socket, next) => {
        try {
            const token = socket.handshake.auth.token;
            
            if (!token) {
                return next(new Error('Authentication error: Token not provided'));
            }
            
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            socket.userId = decoded.id;
            socket.userType = decoded.userType;
            
            next();
        } catch (error) {
            return next(new Error('Authentication error: Invalid token'));
        }
    });
    
    // Set up the authenticated connections
    authenticatedNamespace.on('connection', (socket) => {
        console.log(`Authenticated user connected: ${socket.userId}, Type: ${socket.userType}`);
        
        // Join room based on user type
        if (socket.userType === 'courier') {
            socket.join(`courier:${socket.userId}`);
            console.log(`Courier ${socket.userId} joined their room`);
            
            // When a courier connects, immediately send their current status to admin
            sendCourierStatusToAdmin(socket.userId);
            
            // Handle location updates from couriers
            socket.on('location_update', async (data) => {
                try {
                    const { latitude, longitude } = data;
                    
                    if (!latitude || !longitude) {
                        console.log('Invalid location data received');
                        return;
                    }
                    
                    console.log(`Courier ${socket.userId} location update: ${latitude}, ${longitude}`);
                    
                    // Update courier location in database
                    const updatedCourier = await Courier.findByIdAndUpdate(
                        socket.userId, 
                        {
                            currentLocation: {
                                type: 'Point',
                                coordinates: [longitude, latitude],
                                lastUpdated: new Date()
                            }
                        },
                        { new: true } // Return updated document
                    );
                    
                    if (!updatedCourier) {
                        console.log(`Courier ${socket.userId} not found in database`);
                        return;
                    }

                    // Prepare photo URL if available
                    let photoUrl = null;
                    if (updatedCourier.personalPhoto) {
                        photoUrl = `/uploads/couriers/${updatedCourier.personalPhoto}`;
                    }
                    
                    // Broadcast to admin room
                    io.emit('courier-location-update', {
                        courierId: socket.userId,
                        location: {
                            latitude,
                            longitude,
                            timestamp: new Date()
                        },
                        isAvailable: updatedCourier.isAvailable,
                        name: updatedCourier.name,
                        courierID: updatedCourier.courierID,
                        vehicleType: updatedCourier.vehicleType,
                        phoneNumber: updatedCourier.phoneNumber,
                        email: updatedCourier.email,
                        photoUrl: photoUrl
                    });
                    
                    console.log(`Location update for courier ${socket.userId} broadcast to all users`);
                    
                } catch (error) {
                    console.error('Error handling location update:', error);
                }
            });
            
            // Handle courier status change
            socket.on('status_update', async (data) => {
                try {
                    const { isAvailable } = data;
                    
                    if (isAvailable === undefined) {
                        return;
                    }
                    
                    // Update courier status in database
                    const updatedCourier = await Courier.findByIdAndUpdate(
                        socket.userId, 
                        { isAvailable },
                        { new: true }
                    );
                    
                    if (!updatedCourier) {
                        console.log(`Courier ${socket.userId} not found in database`);
                        return;
                    }
                    
                    // Broadcast to all users
                    io.emit('courier-status-update', {
                        courierId: socket.userId,
                        isAvailable,
                        name: updatedCourier.name,
                        courierID: updatedCourier.courierID,
                        vehicleType: updatedCourier.vehicleType,
                        phoneNumber: updatedCourier.phoneNumber,
                        email: updatedCourier.email,
                        currentLocation: updatedCourier.currentLocation
                    });
                    
                } catch (error) {
                    console.error('Error handling status update:', error);
                }
            });
        }
        
        socket.on('disconnect', () => {
            console.log(`Authenticated user disconnected: ${socket.userId}`);
        });
    });
    
    // Set up unauthenticated connections for admin panel
    io.on('connection', (socket) => {
        console.log('Client connected to main namespace');
        
        socket.on('disconnect', (reason) => {
            console.log(`Client disconnected from main namespace: ${reason}`);
        });
        
        socket.on('error', (error) => {
            console.error('Socket error:', error);
        });
        
        // Admin can request courier locations directly
        socket.on('request_courier_locations', async () => {
            try {
                sendAllCourierLocationsToSocket(socket);
            } catch (error) {
                console.error('Error sending courier locations to admin:', error);
            }
        });
    });
    
    // Handle connection errors
    io.engine.on("connection_error", (err) => {
        console.log('Connection error:', err.req);
        console.log('Error code:', err.code);
        console.log('Error message:', err.message);
        console.log('Error context:', err.context);
    });
    
    return io;
};

// Helper function to send courier status to admin
async function sendCourierStatusToAdmin(courierId) {
    try {
        const courier = await Courier.findById(courierId);
        
        if (!courier) {
            console.log(`Courier ${courierId} not found in database`);
            return;
        }
        
        // Prepare photo URL if available
        let photoUrl = null;
        if (courier.personalPhoto) {
            photoUrl = `/uploads/couriers/${courier.personalPhoto}`;
        }
        
        io.emit('courier-status-update', {
            courierId: courier._id,
            isAvailable: courier.isAvailable,
            name: courier.name,
            courierID: courier.courierID,
            vehicleType: courier.vehicleType,
            phoneNumber: courier.phoneNumber,
            email: courier.email,
            currentLocation: courier.currentLocation,
            photoUrl: photoUrl
        });
        
        console.log(`Courier ${courierId} status sent to all connected clients`);
    } catch (error) {
        console.error('Error sending courier status to admin:', error);
    }
}

// Helper function to send all courier locations to a specific socket
async function sendAllCourierLocationsToSocket(socket) {
    try {
        const couriers = await Courier.find({
            isLocationTrackingEnabled: true,
            currentLocation: { $exists: true }
        });
        
        console.log(`Sending ${couriers.length} courier locations to socket`);
        
        couriers.forEach(courier => {
            if (courier.currentLocation && courier.currentLocation.coordinates) {
                const [longitude, latitude] = courier.currentLocation.coordinates;
                
                // Prepare photo URL if available
                let photoUrl = null;
                if (courier.personalPhoto) {
                    photoUrl = `/uploads/couriers/${courier.personalPhoto}`;
                }
                
                socket.emit('courier-location-update', {
                    courierId: courier._id,
                    location: {
                        latitude,
                        longitude,
                        timestamp: courier.currentLocation.lastUpdated
                    },
                    isAvailable: courier.isAvailable,
                    name: courier.name,
                    courierID: courier.courierID,
                    vehicleType: courier.vehicleType,
                    phoneNumber: courier.phoneNumber,
                    email: courier.email,
                    photoUrl: photoUrl
                });
            }
        });
    } catch (error) {
        console.error('Error sending all courier locations to socket:', error);
    }
}

// Helper function used for admin panel connection
async function sendAllCourierLocationsToAdmin(socket) {
    return sendAllCourierLocationsToSocket(socket);
}

// Get Socket.IO instance
const getIO = () => {
    if (!io) {
        throw new Error('Socket.IO not initialized');
    }
    return io;
};

module.exports = {
    initializeSocket,
    getIO
}; 