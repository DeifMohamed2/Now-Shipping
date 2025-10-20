const Order = require('../models/order');
const Transaction = require('../models/transactions');
const User = require('../models/user');
const JobLog = require('../models/JobLog');

/**
 * Financial Reconciliation Utilities
 * 
 * Provides comprehensive reconciliation and recovery mechanisms
 * for the financial processing system
 */

class FinancialReconciliation {
  
  /**
   * Comprehensive reconciliation report
   */
  static async generateReconciliationReport(startDate, endDate) {
    try {
      console.log(`Generating reconciliation report from ${startDate} to ${endDate}`);
      
      const report = {
        period: { startDate, endDate },
        generatedAt: new Date(),
        summary: {},
        discrepancies: [],
        recommendations: []
      };
      
      // Get all orders in the period
      const orders = await Order.find({
        completedDate: { $gte: startDate, $lte: endDate },
        orderStatus: { $in: ['completed', 'returned', 'canceled', 'returnCompleted'] }
      });
      
      // Get all transactions in the period
      const transactions = await Transaction.find({
        createdAt: { $gte: startDate, $lte: endDate }
      });
      
      // Summary statistics
      report.summary = {
        totalOrders: orders.length,
        processedOrders: orders.filter(o => o.financialProcessing?.isProcessed).length,
        unprocessedOrders: orders.filter(o => !o.financialProcessing?.isProcessed).length,
        totalTransactions: transactions.length,
        totalTransactionAmount: transactions.reduce((sum, t) => sum + (t.transactionAmount || 0), 0),
        totalOrderValue: orders
          .filter(o => o.orderStatus === 'completed')
          .reduce((sum, o) => sum + (o.orderShipping?.amount || 0), 0)
      };
      
      // Find discrepancies
      await this.findDiscrepancies(orders, transactions, report);
      
      // Generate recommendations
      this.generateRecommendations(report);
      
      return report;
      
    } catch (error) {
      console.error('Error generating reconciliation report:', error);
      throw error;
    }
  }
  
  /**
   * Find discrepancies between orders and transactions
   */
  static async findDiscrepancies(orders, transactions, report) {
    const discrepancies = [];
    
    // 1. Orders marked as processed but no transactions found
    for (const order of orders) {
      if (order.financialProcessing?.isProcessed) {
        const orderTransactions = transactions.filter(t => 
          t.sourceOrderIds?.includes(order._id) || 
          t.orderReferences?.some(ref => ref.orderId?.toString() === order._id.toString())
        );
        
        if (orderTransactions.length === 0) {
          discrepancies.push({
            type: 'MISSING_TRANSACTION',
            orderId: order._id,
            orderNumber: order.orderNumber,
            businessId: order.business,
            status: order.orderStatus,
            processedAt: order.financialProcessing.processedAt,
            batchId: order.financialProcessing.processingBatchId,
            severity: 'HIGH'
          });
        }
      }
    }
    
    // 2. Orders not marked as processed but should be
    for (const order of orders) {
      if (!order.financialProcessing?.isProcessed && 
          ['completed', 'returned', 'canceled', 'returnCompleted'].includes(order.orderStatus)) {
        discrepancies.push({
          type: 'UNPROCESSED_ORDER',
          orderId: order._id,
          orderNumber: order.orderNumber,
          businessId: order.business,
          status: order.orderStatus,
          completedDate: order.completedDate,
          severity: 'MEDIUM'
        });
      }
    }
    
    // 3. Duplicate transactions
    const transactionGroups = {};
    for (const transaction of transactions) {
      const key = `${transaction.business}-${transaction.transactionType}-${transaction.transactionAmount}`;
      if (!transactionGroups[key]) {
        transactionGroups[key] = [];
      }
      transactionGroups[key].push(transaction);
    }
    
    for (const [key, group] of Object.entries(transactionGroups)) {
      if (group.length > 1) {
        discrepancies.push({
          type: 'DUPLICATE_TRANSACTION',
          transactions: group.map(t => ({
            transactionId: t.transactionId,
            id: t._id,
            createdAt: t.createdAt,
            batchId: t.processingBatchId
          })),
          severity: 'HIGH'
        });
      }
    }
    
    report.discrepancies = discrepancies;
  }
  
  /**
   * Generate recommendations based on discrepancies
   */
  static generateRecommendations(report) {
    const recommendations = [];
    
    const missingTransactions = report.discrepancies.filter(d => d.type === 'MISSING_TRANSACTION');
    const unprocessedOrders = report.discrepancies.filter(d => d.type === 'UNPROCESSED_ORDER');
    const duplicateTransactions = report.discrepancies.filter(d => d.type === 'DUPLICATE_TRANSACTION');
    
    if (missingTransactions.length > 0) {
      recommendations.push({
        type: 'RECOVERY_NEEDED',
        description: `${missingTransactions.length} orders marked as processed but missing transactions`,
        action: 'Run recovery process to reset processing flags',
        priority: 'HIGH'
      });
    }
    
    if (unprocessedOrders.length > 0) {
      recommendations.push({
        type: 'PROCESSING_NEEDED',
        description: `${unprocessedOrders.length} orders need financial processing`,
        action: 'Run daily processing job or manual processing',
        priority: 'MEDIUM'
      });
    }
    
    if (duplicateTransactions.length > 0) {
      recommendations.push({
        type: 'CLEANUP_NEEDED',
        description: `${duplicateTransactions.length} sets of duplicate transactions found`,
        action: 'Review and remove duplicate transactions',
        priority: 'HIGH'
      });
    }
    
    report.recommendations = recommendations;
  }
  
  /**
   * Reset processing flags for orders without transactions
   */
  static async resetOrphanedProcessingFlags(batchId = null) {
    try {
      console.log(`Resetting orphaned processing flags${batchId ? ` for batch ${batchId}` : ''}`);
      
      const query = {
        'financialProcessing.isProcessed': true,
        'financialProcessing.processedBy': 'dailyJob'
      };
      
      if (batchId) {
        query['financialProcessing.processingBatchId'] = batchId;
      }
      
      const processedOrders = await Order.find(query);
      console.log(`Found ${processedOrders.length} orders to verify`);
      
      const orphanedOrders = [];
      
      for (const order of processedOrders) {
        const transactions = await Transaction.find({
          $or: [
            { sourceOrderIds: order._id },
            { 'orderReferences.orderId': order._id }
          ]
        });
        
        if (transactions.length === 0) {
          orphanedOrders.push(order);
        }
      }
      
      if (orphanedOrders.length > 0) {
        console.log(`Found ${orphanedOrders.length} orphaned orders, resetting processing flags`);
        
        await Order.updateMany(
          { _id: { $in: orphanedOrders.map(o => o._id) } },
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
        
        console.log(`Reset processing flags for ${orphanedOrders.length} orders`);
        return {
          success: true,
          resetCount: orphanedOrders.length,
          orders: orphanedOrders.map(o => ({
            orderId: o._id,
            orderNumber: o.orderNumber,
            businessId: o.business
          }))
        };
      } else {
        console.log('No orphaned orders found');
        return {
          success: true,
          resetCount: 0,
          orders: []
        };
      }
      
    } catch (error) {
      console.error('Error resetting orphaned processing flags:', error);
      throw error;
    }
  }
  
  /**
   * Validate business balances against transactions
   */
  static async validateBusinessBalances() {
    try {
      console.log('Validating business balances against transactions');
      
      const businesses = await User.find({ role: 'business' });
      const validationResults = [];
      
      for (const business of businesses) {
        const transactions = await Transaction.find({ business: business._id });
        const calculatedBalance = transactions.reduce((sum, t) => sum + (t.transactionAmount || 0), 0);
        
        const discrepancy = Math.abs((business.balance || 0) - calculatedBalance);
        
        if (discrepancy > 0.01) { // Allow for small floating point differences
          validationResults.push({
            businessId: business._id,
            businessName: business.name || business.brandInfo?.brandName,
            storedBalance: business.balance || 0,
            calculatedBalance: calculatedBalance,
            discrepancy: discrepancy,
            transactionCount: transactions.length
          });
        }
      }
      
      console.log(`Balance validation completed. Found ${validationResults.length} discrepancies`);
      return {
        success: true,
        totalBusinesses: businesses.length,
        discrepancies: validationResults
      };
      
    } catch (error) {
      console.error('Error validating business balances:', error);
      throw error;
    }
  }
  
  /**
   * Fix business balance discrepancies
   */
  static async fixBalanceDiscrepancies(validationResults) {
    try {
      console.log(`Fixing ${validationResults.length} balance discrepancies`);
      
      const fixes = [];
      
      for (const discrepancy of validationResults) {
        const business = await User.findById(discrepancy.businessId);
        if (business) {
          const oldBalance = business.balance || 0;
          business.balance = discrepancy.calculatedBalance;
          await business.save();
          
          fixes.push({
            businessId: discrepancy.businessId,
            businessName: discrepancy.businessName,
            oldBalance: oldBalance,
            newBalance: discrepancy.calculatedBalance,
            fixedAt: new Date()
          });
        }
      }
      
      console.log(`Fixed ${fixes.length} balance discrepancies`);
      return {
        success: true,
        fixedCount: fixes.length,
        fixes: fixes
      };
      
    } catch (error) {
      console.error('Error fixing balance discrepancies:', error);
      throw error;
    }
  }
  
  /**
   * Get processing statistics
   */
  static async getProcessingStatistics(days = 30) {
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      
      const orders = await Order.find({
        completedDate: { $gte: startDate, $lte: endDate },
        orderStatus: { $in: ['completed', 'returned', 'canceled', 'returnCompleted'] }
      });
      
      const transactions = await Transaction.find({
        createdAt: { $gte: startDate, $lte: endDate }
      });
      
      const jobLogs = await JobLog.find({
        jobName: 'dailyOrderProcessing',
        date: { $gte: startDate, $lte: endDate }
      });
      
      return {
        period: { startDate, endDate, days },
        orders: {
          total: orders.length,
          processed: orders.filter(o => o.financialProcessing?.isProcessed).length,
          unprocessed: orders.filter(o => !o.financialProcessing?.isProcessed).length,
          byStatus: orders.reduce((acc, o) => {
            acc[o.orderStatus] = (acc[o.orderStatus] || 0) + 1;
            return acc;
          }, {})
        },
        transactions: {
          total: transactions.length,
          totalAmount: transactions.reduce((sum, t) => sum + (t.transactionAmount || 0), 0),
          byType: transactions.reduce((acc, t) => {
            acc[t.transactionType] = (acc[t.transactionType] || 0) + 1;
            return acc;
          }, {})
        },
        jobs: {
          total: jobLogs.length,
          completed: jobLogs.filter(j => j.status === 'completed').length,
          failed: jobLogs.filter(j => j.status === 'failed').length,
          running: jobLogs.filter(j => j.status === 'running').length
        }
      };
      
    } catch (error) {
      console.error('Error getting processing statistics:', error);
      throw error;
    }
  }
}

module.exports = FinancialReconciliation;
