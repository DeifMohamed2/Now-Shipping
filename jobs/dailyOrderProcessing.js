const cron = require('node-cron');
const Transaction = require('../models/transactions');
const Order = require('../models/order');
const Pickup = require('../models/pickup');
const User = require('../models/user');
const JobLog = require('../models/JobLog');
const mongoose = require('mongoose');
const { emailService } = require('../utils/email');
const firebase = require('../config/firebase');

/**
 * Enhanced Daily Order Processing with Robust Duplicate Prevention
 * 
 * Key Improvements:
 * 1. Order-level processing flags prevent duplicate processing
 * 2. Atomic operations with proper error handling
 * 3. Batch processing with unique batch IDs
 * 4. Comprehensive logging and recovery mechanisms
 * 5. Transaction deduplication at multiple levels
 */

// Global lock to prevent multiple concurrent runs
let isProcessing = false;

// Generate unique batch ID for this processing run
function generateBatchId() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const random = Math.floor(Math.random() * 10000);
  return `BATCH-${timestamp}-${random}`;
}

// Check if job should run (basic rate limiting)
async function shouldRunJob() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  // Check if job already completed today
  const existingJob = await JobLog.findOne({ 
    jobName: 'dailyOrderProcessing', 
    date: today,
    status: 'completed'
  });
  
  if (existingJob) {
    console.log('Daily order processing job already completed today. Skipping.');
    return false;
  }
  
  // Check if job is currently running
  const runningJob = await JobLog.findOne({ 
    jobName: 'dailyOrderProcessing', 
    date: today,
    status: 'running'
  });
  
  if (runningJob) {
    console.log('Daily order processing job is already running. Skipping.');
    return false;
  }
  
  return true;
}

// Create or update job log
async function updateJobLog(status, batchId, details = {}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  try {
    await JobLog.findOneAndUpdate(
      { jobName: 'dailyOrderProcessing', date: today },
      {
        jobName: 'dailyOrderProcessing',
        date: today,
        status: status,
        batchId: batchId,
        details: details,
        lastRun: new Date()
      },
      { upsert: true, new: true }
    );
  } catch (error) {
    console.error('Error updating job log:', error);
  }
}

// Get orders that need financial processing
async function getOrdersForProcessing() {
  const financialProcessingStatuses = ['completed', 'returned', 'canceled', 'returnCompleted'];
  
  // Find orders that need processing (not already processed)
  // This handles both old orders (without financialProcessing field) and new orders
  const orders = await Order.find({
    orderStatus: { $in: financialProcessingStatuses },
    $or: [
      { 'financialProcessing.isProcessed': false },
      { 'financialProcessing.isProcessed': { $exists: false } }
    ],
    // Only process orders that have completion dates
    completedDate: { $exists: true, $ne: null }
  }).populate('business');
  
  console.log(`Found ${orders.length} orders requiring financial processing`);
  return orders;
}

// Create transaction with duplicate prevention
async function createTransactionSafely(transactionData, batchId, session = null) {
  // If no session provided, create one
  const shouldEndSession = !session;
  if (!session) {
    session = await mongoose.startSession();
  }
  
  try {
    let result = null;
    
    // If we have a session, use it directly; otherwise use withTransaction
    if (shouldEndSession) {
      await session.withTransaction(async () => {
        result = await createTransactionInSession(transactionData, batchId, session);
      });
    } else {
      result = await createTransactionInSession(transactionData, batchId, session);
    }
    
    return result;
  } catch (error) {
    console.error('Error creating transaction:', error);
    throw error;
  } finally {
    if (shouldEndSession) {
      await session.endSession();
    }
  }
}

// Helper function to create transaction within a session
async function createTransactionInSession(transactionData, batchId, session) {
  // Check for existing transaction with same characteristics
  // This should check for ANY existing transaction with same business, type, and order IDs
  const existingTransaction = await Transaction.findOne({
    business: transactionData.business,
    transactionType: transactionData.transactionType,
    $or: [
      { 'orderReferences.orderId': { $in: transactionData.sourceOrderIds } },
      { sourceOrderIds: { $in: transactionData.sourceOrderIds } }
    ]
  }).session(session);
  
  if (existingTransaction) {
    console.log(`Duplicate transaction detected for business ${transactionData.business}, type ${transactionData.transactionType}, skipping`);
    return null;
  }
  
  // Create new transaction
  const transaction = new Transaction({
    ...transactionData,
    processingBatchId: batchId,
    sourceOrderIds: transactionData.sourceOrderIds
  });
  
  await transaction.save({ session });
  console.log(`Transaction created: ${transaction.transactionId} for business ${transactionData.business}`);
  return transaction;
}

// Process orders for a specific business
async function processBusinessOrders(businessId, businessOrders, batchId) {
  const session = await mongoose.startSession();
  
  try {
    await session.withTransaction(async () => {
      const allBusinessOrders = businessOrders;
      const completedOrders = businessOrders.filter(o => o.orderStatus === 'completed');
      const returnedOrders = businessOrders.filter(o => o.orderStatus === 'returned');
      const canceledOrders = businessOrders.filter(o => o.orderStatus === 'canceled');
      const returnCompletedOrders = businessOrders.filter(o => o.orderStatus === 'returnCompleted');
      
      if (allBusinessOrders.length === 0) return;
      
      // Calculate business net value (only from completed orders)
      const businessNetValue = completedOrders.reduce(
        (total, order) => total + (order.orderShipping.amount || 0),
        0
      );
      
      // Calculate all fees
      const allFees = allBusinessOrders.reduce((total, order) => {
        let orderTotalFees = order.orderFees || 0;
        
        if (order.orderStatus === 'returned' && order.returnFees) {
          orderTotalFees += order.returnFees;
        }
        
        if (order.orderStatus === 'canceled' && order.totalFees) {
          orderTotalFees += order.totalFees;
        }
        
        return total + orderTotalFees;
      }, 0);
      
      const orderReferences = allBusinessOrders.map(order => ({
        orderId: order._id,
        orderNumber: order.orderNumber,
        orderAmount: order.orderStatus === 'completed' ? (order.orderShipping.amount || 0) : 0,
        orderFees: order.orderFees || 0,
        orderStatus: order.orderStatus,
        completedDate: order.completedDate,
        moneyReleaseDate: order.moneyReleaseDate
      }));
      
      const transactionDetails = {
        orderCount: allBusinessOrders.length,
        completedCount: completedOrders.length,
        returnedCount: returnedOrders.length,
        canceledCount: canceledOrders.length,
        returnCompletedCount: returnCompletedOrders.length,
        totalAmount: businessNetValue,
        totalOrderFees: allFees,
        dateRange: {
          from: new Date(Math.min(...allBusinessOrders.map(o => o.completedDate))),
          to: new Date(Math.max(...allBusinessOrders.map(o => o.completedDate)))
        }
      };
      
      const sourceOrderIds = allBusinessOrders.map(o => o._id);
      
      // Create fees transaction
      if (allFees > 0) {
        const feesTransaction = await createTransactionSafely({
          transactionId: `${Math.floor(100000 + Math.random() * 900000)}`,
          transactionType: 'fees',
          transactionAmount: -allFees,
          transactionNotes: `Comprehensive order fees for ${allBusinessOrders.length} processed orders (${completedOrders.length} completed, ${returnedOrders.length} returned, ${canceledOrders.length} canceled, ${returnCompletedOrders.length} return completed).`,
          ordersDetails: transactionDetails,
          orderReferences: orderReferences,
          business: businessId,
        }, batchId, session);
      }
      
      // Create cash cycle transaction (only for completed orders)
      if (businessNetValue > 0) {
        const cashCycleTransaction = await createTransactionSafely({
          transactionId: `${Math.floor(100000 + Math.random() * 900000)}`,
          transactionType: 'cashCycle',
          transactionAmount: businessNetValue,
          transactionNotes: `Daily settlement for ${completedOrders.length} completed orders. Total processed orders: ${allBusinessOrders.length}`,
          ordersDetails: {
            ...transactionDetails,
            orderCount: completedOrders.length,
            totalProcessedOrders: allBusinessOrders.length
          },
          orderReferences: orderReferences,
          business: businessId,
          totalCashCycleOrders: {
            orderCount: completedOrders.length,
            dateOfCashCycle: new Date(),
          },
        }, batchId, session);
      }
      
      // Mark all orders as processed
      const orderUpdatePromises = allBusinessOrders.map(order => {
        order.financialProcessing = {
          isProcessed: true,
          processedAt: new Date(),
          processedBy: 'dailyJob',
          processingBatchId: batchId,
          processingNotes: `Processed in batch ${batchId} with ${allBusinessOrders.length} orders`
        };
        return order.save({ session });
      });
      
      await Promise.all(orderUpdatePromises);
      
      // Send daily cash cycle email to business
      try {
        const business = await User.findById(businessId).select('email brandInfo name');
        if (business && business.email) {
          const ordersForEmail = allBusinessOrders.map(order => ({
            orderNumber: order.orderNumber,
            customerName: order.orderCustomer?.fullName || 'N/A',
            orderType: order.orderShipping?.orderType || 'Standard',
            amount: order.orderShipping?.amount || 0,
            fees: order.orderFees || 0,
            status: order.orderStatus,
            completedDate: order.completedDate
          }));

          const businessData = {
            email: business.email,
            businessName: business.brandInfo?.brandName || business.name || 'Business',
            businessId: businessId
          };

          await emailService.sendDailyCashCycleSummary(businessData, ordersForEmail);
          console.log(`📧 Daily cash cycle email sent to business ${businessId}`);
        }
      } catch (emailError) {
        console.error(`❌ Failed to send email to business ${businessId}:`, emailError);
        // Don't fail the entire process if email fails
      }
      
      console.log(`Successfully processed ${allBusinessOrders.length} orders for business ${businessId}`);
    });
  } catch (error) {
    console.error(`Error processing business ${businessId}:`, error);
    throw error;
  } finally {
    await session.endSession();
  }
}

// Main daily processing function
async function dailyOrderProcessing() {
  // Check global lock
  if (isProcessing) {
    console.log('Daily order processing is already running. Skipping.');
    return;
  }
  
  isProcessing = true;
  const batchId = generateBatchId();
  console.log(`Starting daily order processing with batch ID: ${batchId}`);
  
  try {
    // Check if job should run
    if (!(await shouldRunJob())) {
      return;
    }
    
    // Update job log to running
    await updateJobLog('running', batchId, { startTime: new Date() });
    
    // Get orders for processing
    const orders = await getOrdersForProcessing();
    
    if (orders.length === 0) {
      console.log('No orders requiring financial processing found.');
      await updateJobLog('completed', batchId, { 
        endTime: new Date(),
        ordersProcessed: 0,
        message: 'No orders to process'
      });
      return;
    }
    
    // Group orders by business
    const ordersByBusiness = orders.reduce((acc, order) => {
      const businessId = order.business._id.toString();
      if (!acc[businessId]) {
        acc[businessId] = [];
      }
      acc[businessId].push(order);
      return acc;
    }, {});
    
    console.log(`Processing orders for ${Object.keys(ordersByBusiness).length} businesses`);
    
    // Process each business
    let totalProcessed = 0;
    let errors = [];
    
    for (const [businessId, businessOrders] of Object.entries(ordersByBusiness)) {
      try {
        await processBusinessOrders(businessId, businessOrders, batchId);
        totalProcessed += businessOrders.length;
      } catch (error) {
        console.error(`Failed to process business ${businessId}:`, error);
        errors.push({
          businessId,
          error: error.message,
          orderCount: businessOrders.length
        });
      }
    }
    
    // Update job log with results
    await updateJobLog('completed', batchId, {
      endTime: new Date(),
      ordersProcessed: totalProcessed,
      businessesProcessed: Object.keys(ordersByBusiness).length,
      errors: errors,
      success: errors.length === 0
    });
    
    console.log(`Daily order processing completed. Processed ${totalProcessed} orders across ${Object.keys(ordersByBusiness).length} businesses.`);
    
    // Send push notifications to all businesses about daily processing completion
    try {
      const businesses = await User.find({ 
        _id: { $in: Object.keys(ordersByBusiness) },
        fcmToken: { $ne: null }
      });
      
      for (const business of businesses) {
        const businessOrders = ordersByBusiness[business._id] || [];
        const totalAmount = businessOrders.reduce((sum, order) => sum + (order.orderShipping?.amount || 0), 0);
        
        await firebase.sendFinancialProcessingNotification(
          business._id,
          'daily_processing',
          {
            ordersProcessed: businessOrders.length,
            totalAmount: totalAmount,
            processedAt: new Date(),
            batchId: batchId
          }
        );
        console.log(`📱 Push notification sent to business ${business._id} about daily processing completion`);
      }
    } catch (notificationError) {
      console.error(`❌ Failed to send push notifications for daily processing:`, notificationError);
      // Don't fail the processing if notifications fail
    }
    
    if (errors.length > 0) {
      console.error(`Errors occurred in ${errors.length} businesses:`, errors);
    }
    
  } catch (error) {
    console.error('Critical error in daily order processing:', error);
    await updateJobLog('failed', batchId, {
      endTime: new Date(),
      error: error.message,
      stack: error.stack
    });
    throw error;
  } finally {
    isProcessing = false;
  }
}

// Recovery function to reprocess failed orders
async function recoverFailedProcessing(batchId = null) {
  console.log(`Starting recovery process${batchId ? ` for batch ${batchId}` : ''}`);
  
  try {
    // Find orders that were marked as processed but might have failed
    const query = {
      'financialProcessing.isProcessed': true,
      'financialProcessing.processedBy': 'dailyJob'
    };
    
    if (batchId) {
      query['financialProcessing.processingBatchId'] = batchId;
    }
    
    const processedOrders = await Order.find(query);
    console.log(`Found ${processedOrders.length} orders to verify`);
    
    // Check if transactions exist for these orders
    const ordersWithoutTransactions = [];
    
    for (const order of processedOrders) {
      const transactions = await Transaction.find({
        sourceOrderIds: order._id
      });
      
      if (transactions.length === 0) {
        ordersWithoutTransactions.push(order);
      }
    }
    
    if (ordersWithoutTransactions.length > 0) {
      console.log(`Found ${ordersWithoutTransactions.length} orders without transactions, resetting processing flag`);
      
      // Reset processing flag for orders without transactions
      await Order.updateMany(
        { _id: { $in: ordersWithoutTransactions.map(o => o._id) } },
        { 
          $unset: { 
            'financialProcessing.isProcessed': 1,
            'financialProcessing.processedAt': 1,
            'financialProcessing.processedBy': 1,
            'financialProcessing.processingBatchId': 1,
            'financialProcessing.processingNotes': 1
          }
        }
      );
      
      console.log('Recovery completed. Orders reset for reprocessing.');
    } else {
      console.log('No recovery needed. All processed orders have corresponding transactions.');
    }
    
  } catch (error) {
    console.error('Error in recovery process:', error);
    throw error;
  }
}

// Manual processing function for specific orders
async function processSpecificOrders(orderIds, batchId = null) {
  const processingBatchId = batchId || generateBatchId();
  console.log(`Manually processing ${orderIds.length} orders with batch ID: ${processingBatchId}`);
  
  try {
    const orders = await Order.find({
      _id: { $in: orderIds },
      'financialProcessing.isProcessed': false
    }).populate('business');
    
    if (orders.length === 0) {
      console.log('No unprocessed orders found with provided IDs');
      return;
    }
    
    // Group by business and process
    const ordersByBusiness = orders.reduce((acc, order) => {
      const businessId = order.business._id.toString();
      if (!acc[businessId]) {
        acc[businessId] = [];
      }
      acc[businessId].push(order);
      return acc;
    }, {});
    
    for (const [businessId, businessOrders] of Object.entries(ordersByBusiness)) {
      await processBusinessOrders(businessId, businessOrders, processingBatchId);
    }
    
    console.log(`Successfully processed ${orders.length} orders manually`);
    
  } catch (error) {
    console.error('Error in manual processing:', error);
    throw error;
  }
}

// Schedule the job (uncomment to enable)
// cron.schedule('59 23 * * *', async () => {
//   await dailyOrderProcessing();
// }, { timezone: 'Africa/Cairo' });

// Test job (uncomment for testing)
// cron.schedule('*/5 * * * *', async () => {
//   console.log('Running test daily processing job');
//   await dailyOrderProcessing();
// });

// Clean up duplicate transactions
async function cleanupDuplicateTransactions() {
  console.log('Starting cleanup of duplicate transactions...');
  
  try {
    // Find all transactions grouped by business, type, and order references
    const transactions = await Transaction.find({
      'orderReferences.orderId': { $exists: true, $ne: null }
    }).sort({ createdAt: 1 });
    
    const duplicates = [];
    const seen = new Map();
    
    for (const transaction of transactions) {
      const key = `${transaction.business}-${transaction.transactionType}-${transaction.orderReferences.map(ref => ref.orderId.toString()).sort().join(',')}`;
      
      if (seen.has(key)) {
        duplicates.push({
          duplicate: transaction,
          original: seen.get(key)
        });
      } else {
        seen.set(key, transaction);
      }
    }
    
    console.log(`Found ${duplicates.length} duplicate transactions`);
    
    if (duplicates.length > 0) {
      // Mark duplicates and remove them
      for (const { duplicate, original } of duplicates) {
        console.log(`Marking transaction ${duplicate.transactionId} as duplicate of ${original.transactionId}`);
        
        // Mark as duplicate
        duplicate.isDuplicate = true;
        duplicate.duplicateOf = original._id;
        await duplicate.save();
        
        // Remove the duplicate transaction
        await Transaction.findByIdAndDelete(duplicate._id);
        console.log(`Removed duplicate transaction ${duplicate.transactionId}`);
      }
    }
    
    console.log('Duplicate cleanup completed');
    return duplicates.length;
    
  } catch (error) {
    console.error('Error cleaning up duplicates:', error);
    throw error;
  }
}

module.exports = {
  dailyOrderProcessing,
  recoverFailedProcessing,
  processSpecificOrders,
  generateBatchId,
  cleanupDuplicateTransactions
};