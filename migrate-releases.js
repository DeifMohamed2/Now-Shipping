const mongoose = require('mongoose');
require('dotenv').config();

// Import models
const Release = require('./models/releases');
const Transaction = require('./models/transactions');

async function migrateReleases() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/your-database-name');
    console.log('Connected to MongoDB');

    // Find releases without transaction references
    const releasesWithoutTransactions = await Release.find({
      $or: [
        { transactionReferences: { $exists: false } },
        { transactionReferences: { $size: 0 } }
      ]
    });

    console.log(`Found ${releasesWithoutTransactions.length} releases without transaction references`);

    for (const release of releasesWithoutTransactions) {
      console.log(`Processing release ${release.releaseId}...`);

      // Find transactions for this business that match the release criteria
      // For releases that are already "released", we need to find the transactions that were settled
      let transactions = [];

      if (release.releaseStatus === 'released') {
        // For released releases, find settled transactions around the release date
        const releaseDate = new Date(release.updatedAt || release.createdAt);
        const weekStart = new Date(releaseDate);
        weekStart.setDate(releaseDate.getDate() - 7);
        
        const weekEnd = new Date(releaseDate);
        weekEnd.setDate(releaseDate.getDate() + 1);

        transactions = await Transaction.find({
          business: release.business,
          transactionType: 'cashCycle',
          settled: true,
          createdAt: { $gte: weekStart, $lte: weekEnd }
        });

        // If no settled transactions found, try to find any cash cycle transactions
        if (transactions.length === 0) {
          transactions = await Transaction.find({
            business: release.business,
            transactionType: 'cashCycle',
            createdAt: { $gte: weekStart, $lte: weekEnd }
          });
        }
      } else {
        // For pending/scheduled releases, find unsettled transactions
        transactions = await Transaction.find({
          business: release.business,
          transactionType: 'cashCycle',
          settled: false
        });
      }

      console.log(`Found ${transactions.length} transactions for release ${release.releaseId}`);

      // Create transaction references
      const transactionReferences = transactions.map(transaction => ({
        transactionId: transaction._id
      }));

      // Update the release with transaction references
      await Release.findByIdAndUpdate(release._id, {
        transactionReferences: transactionReferences
      });

      console.log(`Updated release ${release.releaseId} with ${transactionReferences.length} transaction references`);
    }

    console.log('Migration completed successfully!');
    
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

// Run migration if this file is executed directly
if (require.main === module) {
  migrateReleases();
}

module.exports = migrateReleases;
