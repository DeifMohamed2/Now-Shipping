const mongoose = require('mongoose');

// Database optimization script
async function optimizeDatabase() {
  try {
    console.log('Starting database optimization...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/ordercompany');
    
    const db = mongoose.connection.db;
    
    // Create indexes for Order collection
    console.log('Creating indexes for Order collection...');
    
    await db.collection('orders').createIndex({ business: 1, orderStatus: 1 });
    await db.collection('orders').createIndex({ business: 1, orderDate: -1 });
    await db.collection('orders').createIndex({ business: 1, completedDate: -1 });
    await db.collection('orders').createIndex({ business: 1, 'orderShipping.amountType': 1, orderStatus: 1 });
    await db.collection('orders').createIndex({ business: 1, orderStatus: 1, completedDate: 1 });
    
    // Create indexes for Pickup collection
    console.log('Creating indexes for Pickup collection...');
    
    await db.collection('pickups').createIndex({ business: 1, pickupDate: -1 });
    await db.collection('pickups').createIndex({ business: 1, picikupStatus: 1 });
    
    // Create indexes for User collection
    console.log('Creating indexes for User collection...');
    
    await db.collection('users').createIndex({ email: 1 }, { unique: true });
    await db.collection('users').createIndex({ isCompleted: 1 });
    await db.collection('users').createIndex({ isVerified: 1 });
    
    // Create indexes for Admin collection
    console.log('Creating indexes for Admin collection...');
    
    await db.collection('admins').createIndex({ email: 1 }, { unique: true });
    await db.collection('admins').createIndex({ role: 1 });
    
    // Create indexes for Courier collection
    console.log('Creating indexes for Courier collection...');
    
    await db.collection('couriers').createIndex({ email: 1 }, { unique: true });
    await db.collection('couriers').createIndex({ isActive: 1 });
    
    console.log('Database optimization completed successfully!');
    
    // Show index information
    console.log('\nIndex information:');
    const orderIndexes = await db.collection('orders').indexes();
    console.log('Order collection indexes:', orderIndexes.length);
    
    const pickupIndexes = await db.collection('pickups').indexes();
    console.log('Pickup collection indexes:', pickupIndexes.length);
    
    const userIndexes = await db.collection('users').indexes();
    console.log('User collection indexes:', userIndexes.length);
    
  } catch (error) {
    console.error('Error optimizing database:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

// Run optimization
optimizeDatabase();
