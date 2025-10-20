const mongoose = require('mongoose');
const Order = require('./models/order');

// Test script to verify moneyReleaseDate is set for returned orders
async function testMoneyReleaseDate() {
  try {
    // Connect to MongoDB (adjust connection string as needed)
    await mongoose.connect('mongodb://localhost:27017/your-database-name');
    
    console.log('Connected to MongoDB');
    
    // Find orders that need moneyReleaseDate but don't have it
    const ordersNeedingMoneyReleaseDate = await Order.find({
      orderStatus: { $in: ['returned', 'canceled', 'returnCompleted'] },
      moneyReleaseDate: { $exists: false }
    });
    
    console.log(`Found ${ordersNeedingMoneyReleaseDate.length} orders that need moneyReleaseDate`);
    
    // Update these orders to set moneyReleaseDate
    for (const order of ordersNeedingMoneyReleaseDate) {
      const completionDate = order.completedDate || new Date();
      const dayOfWeek = completionDate.getDay();
      const daysUntilWednesday = (3 - dayOfWeek + 7) % 7;
      const releaseDate = new Date(completionDate);
      
      if (dayOfWeek === 3) {
        releaseDate.setDate(releaseDate.getDate() + 7);
      } else if (daysUntilWednesday > 0) {
        releaseDate.setDate(releaseDate.getDate() + daysUntilWednesday);
      }
      
      order.moneyReleaseDate = releaseDate;
      await order.save();
      
      console.log(`Updated order ${order.orderNumber} (status: ${order.orderStatus}) with moneyReleaseDate: ${releaseDate.toISOString()}`);
    }
    
    console.log('All orders updated successfully!');
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

// Run the test
testMoneyReleaseDate();
