const cron = require('node-cron');
const Transaction = require('../models/transactions');
const Order = require('../models/order');
const User = require('../models/user');
const DailyJobLog = require('../models/JobLog');

async function checkIfJobAlreadyRun(today) {
    // Check if the job has already run today
    const jobExists = await DailyJobLog.findOne({ jobName: 'dailyOrderProcessing', date: today });

    if (jobExists) {
      console.log('Daily order processing job has already run today. Skipping.');
      return true;
    }

}

async function dailyOrderProcessing() {
    try {
  
    const today = new Date();
    today.setHours(0, 0, 0, 0);


    // Check if the job has already run today
    const jobAlreadyRun = await checkIfJobAlreadyRun(today);
    if (jobAlreadyRun) {
        console.log('Job already run today. Exiting.');
        return;
    }

    // Find all orders marked as completed for the day
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const completedOrders = await Order.find({
      orderStatus: 'completed',
      completedDate: { $gte: startOfDay, $lte: endOfDay },
    });

    if (completedOrders.length === 0) {
      console.log('No completed orders for the day.');
      return;
    }

    // Calculate the net value of all completed orders
    const netValue = completedOrders.reduce(
      (total, order) => total + (order.orderShipping.amount || 0),
      0
    );

    // Group orders by business
    const ordersByBusiness = completedOrders.reduce((acc, order) => {
      const businessId = order.business.toString();
      if (!acc[businessId]) {
        acc[businessId] = [];
      }
      acc[businessId].push(order);
      return acc;
    }, {});

    // Create a transaction for each business
    for (const [businessId, orders] of Object.entries(ordersByBusiness)) {
      const businessNetValue = orders.reduce(
        (total, order) => total + (order.orderShipping.amount || 0),
        0
      );
      const fees = orders.reduce(
        (total, order) => total + (order.orderFees || 0),
        0
      );

      // Create and save the fees transaction
      const feesTransaction = new Transaction({
        transactionId: `${Math.floor(100000 + Math.random() * 900000)}`,
        transactionType: 'fees',
        transactionAmount: -fees, // Fees are deducted, so the amount is negative
        transactionNotes: `Fees for ${orders.length} completed orders.`,
        business: businessId,
      });

      await feesTransaction.save();
      console.log(
        `Fees transaction created for business ${businessId}:`,
        feesTransaction
      );

      // Create and save the cash cycle transaction
      const transaction = new Transaction({
        transactionId: `${Math.floor(100000 + Math.random() * 900000)}`,
        transactionType: 'cashCycle',
        transactionAmount: businessNetValue,
        transactionNotes: `Daily settlement for ${orders.length} completed orders.`,
        business: businessId,
        totalCashCycleOrders: {
          orderCount: orders.length,
          dateOfCashCycle: new Date(),
        },
      });

 

      await transaction.save();
      console.log(
        `Transaction created for business ${businessId}:`,
        transaction
      );
    }

    // update the job log
    const jobLog = new DailyJobLog({
      jobName: 'dailyOrderProcessing',
      date: today,
    });
    await jobLog.save().then(() => {
      console.log('Daily job log updated.');    
    }).catch((err) => {
      console.log('Error updating daily job log:', err);
    });

    
  } catch (error) {
    console.error('Error processing daily completed orders:', error);
  }
}




// cron.schedule('59 23 * * *', async () => {
//   await dailyOrderProcessing();
// });

// Uncomment the following line to test the job every 2 minutes
// cron.schedule('*/1 * * * *', async () => {
//     console.log('Running test job every 2 minutes');
//     await dailyOrderProcessing();
// });




// module.exports = {
//   start: () => {
//     console.log('Daily order processing job started');
//   },
// };
