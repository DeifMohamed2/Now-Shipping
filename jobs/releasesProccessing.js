const cron = require('node-cron');
const User = require('../models/user');
const Release = require('../models/releases');
const JobLog = require('../models/JobLog');


async function checkIfJobAlreadyRun(today) {
    // Check if the job has already run today
    const jobExists = await JobLog.findOne({
      jobName: 'releasesProccessing',
      releaseJobdate: today,
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
            // Create a pending release for each user
            const pendingRelease = new Release({
                amount: user.balance,
                business: user._id,
                releaseType: 'withdrawal',
                releaseStatus: 'pending',
                releaseNotes: `Scheduled release for user ${user.name} on Wednesday.`,
            });

            await pendingRelease.save();

            console.log(`Pending release created for user ${user.name}:`, pendingRelease);
        }

        const newJobLog = new JobLog({
          jobName: 'releasesProccessing',
          releaseJobdate: today,
        });

        await newJobLog.save().then(() => {
            console.log('Job log saved successfully');
        }
        ).catch((error) => {
            console.error('Error saving job log:', error);
        });
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