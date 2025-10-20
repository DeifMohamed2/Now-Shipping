const cron = require('node-cron');
const User = require('../models/user');
const Release = require('../models/releases');
const JobLog = require('../models/JobLog');


async function checkIfJobAlreadyRun(today) {
    // Check if the job has already run today
    const jobExists = await JobLog.findOne({
      jobName: 'releasesProccessing',
      date: today,
    });

    if (jobExists) {
      console.log('Daily order processing job has already run today. Skipping.');
      return true;
    }

}



// important Note i should delete all pending jobs before create new jobs 

async function processPendingReleases() {
    try {
        const today = new Date();
        const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, ..., 3 = Wednesday

         today.setHours(0, 0, 0, 0);
        // Check if the job has already run today
        const jobAlreadyRun = await checkIfJobAlreadyRun(today);
        if (jobAlreadyRun) {
            console.log('Job already run today. Exiting.');
            return;
        }

        // if (dayOfWeek !== 3) { // Check if today is Wednesday
        //     console.log('Today is not Wednesday. Skipping release processing.');
        //     return;
        // }

        console.log('Processing pending releases for all users...');

        // Fetch all users with a balance greater than 0
        const usersWithBalance = await User.find({ balance: { $gt: 0 } });

        if (usersWithBalance.length === 0) {
            console.log('No users with a positive balance found.');
            return;
        }

        for (const user of usersWithBalance) {
            // Check if user already has a pending release for this week
            const weekStart = new Date();
            weekStart.setDate(weekStart.getDate() - weekStart.getDay());
            weekStart.setHours(0, 0, 0, 0);
            
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekStart.getDate() + 6);
            weekEnd.setHours(23, 59, 59, 999);

            const existingRelease = await Release.findOne({
                business: user._id,
                releaseStatus: { $in: ['pending', 'scheduled'] },
                createdAt: { $gte: weekStart, $lte: weekEnd }
            });

            if (existingRelease) {
                console.log(`User ${user.name} already has a pending/scheduled release for this week. Skipping.`);
                continue;
            }

            // Get transactions for this user to determine release details
            const Transaction = require('../models/transactions');
            const userTransactions = await Transaction.find({
                business: user._id,
                transactionType: { $in: ['cashCycle', 'fees', 'pickupFees', 'flyersFees', 'returnFees', 'cancellationFees', 'returnCompletedFees'] },
                settlementStatus: 'pending',
                createdAt: { $gte: weekStart, $lte: weekEnd }
            }).sort({ createdAt: -1 });

            if (userTransactions.length === 0) {
                console.log(`User ${user.name} has no unsettled transactions this week. Skipping.`);
                continue;
            }

            // Calculate total amount from all transaction types
            const totalAmount = userTransactions.reduce((sum, transaction) => sum + (transaction.transactionAmount || 0), 0);
            
            // Log transaction details for debugging
            console.log(`User ${user.name} - Transactions found:`, userTransactions.map(t => ({
                id: t.transactionId,
                type: t.transactionType,
                amount: t.transactionAmount
            })));
            console.log(`User ${user.name} - Total net amount: ${totalAmount}`);

            if (totalAmount <= 0) {
                console.log(`User ${user.name} has no positive net balance from transactions this week (total: ${totalAmount}). Skipping.`);
                continue;
            }

            // Create transaction references array (just ObjectIds)
            const transactionReferences = userTransactions.map(transaction => transaction._id);

            // Create a pending release for each user
            const pendingRelease = new Release({
                releaseId: Math.floor(100000 + Math.random() * 900000).toString(),
                amount: totalAmount,
                business: user._id,
                releaseType: 'withdrawal',
                releaseStatus: 'pending',
                releaseNotes: `Weekly release for user ${user.name} based on ${userTransactions.length} transactions (net balance: ${totalAmount} EGP).`,
                transactionReferences: transactionReferences
            });

            await pendingRelease.save();

            // Mark all transactions as included in release
            await Transaction.updateMany(
                { _id: { $in: userTransactions.map(t => t._id) } },
                { settlementStatus: 'included_in_release' }
            );

            console.log(`Pending release created for user ${user.name}:`, pendingRelease);
        }

        // Try to save job log, but handle duplicate key errors gracefully
        try {
            const newJobLog = new JobLog({
                jobName: 'releasesProccessing',
                date: today,
            });

            await newJobLog.save();
            console.log('Job log saved successfully');
        } catch (error) {
            if (error.code === 11000) {
                console.log('Job log already exists for this date, continuing...');
            } else {
                console.error('Error saving job log:', error);
            }
        }
    } catch (error) {
        console.error('Error processing pending releases:', error);
    }
}

// Schedule the job to run every Wednesday at 00:00
// cron.schedule('0 0 * * 3', async () => {
//     await processPendingReleases();
// });


// cron.schedule('*/1 * * * *', async () => {
//     console.log('Running test job every 2 minutes');
//     await processPendingReleases();
// });
// 
//  processPendingReleases();

// Uncomment the following line to test the job manually
// dailyjoblogs

module.exports = processPendingReleases;