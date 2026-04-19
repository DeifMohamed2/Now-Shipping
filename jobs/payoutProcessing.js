/**
 * payoutProcessing.js
 *
 * Runs automatically every Wednesday at 00:01.
 * Can also be triggered manually from the admin panel at any time.
 *
 * Safety guarantees (always on, no overrides):
 *   - A business is never paid out twice in the same week.
 *   - The job cannot run concurrently with itself.
 *   - Each run is logged in JobLog for auditability.
 *
 * For every business with a positive unsettled balance:
 *   1. Creates a Payout document (status = 'scheduled')
 *   2. Links all unsettled LedgerEntries to that payout
 *   3. Writes a balancing 'payout' debit LedgerEntry
 *   4. Sends a push notification to the business
 */

const cron = require('node-cron');
const LedgerEntry = require('../models/ledgerEntry');
const Payout = require('../models/payout');
const User = require('../models/user');
const JobLog = require('../models/JobLog');
const { settleEntriesForPayout, nextWednesday } = require('../utils/ledgerService');

let isRunning = false;

/**
 * @param {object} [options]
 * @param {string} [options.businessId] - Restrict to a single business (MongoDB ObjectId string).
 *                                        When omitted, all businesses with a positive balance are processed.
 */
async function runPayoutProcessing(options = {}) {
  const { businessId = null } = options;

  // Concurrency guard — never run two instances at once
  if (isRunning) {
    console.log('[payoutProcessing] Already running — skipping this trigger.');
    return { skipped: true, reason: 'already_running', message: 'Processing is already in progress. Please wait.' };
  }
  isRunning = true;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Week boundaries used for duplicate-payout detection
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  const batchId = `PAYOUT-${Date.now()}${businessId ? `-${businessId}` : ''}`;
  await JobLog.findOneAndUpdate(
    { jobName: 'payoutProcessing', date: today },
    {
      jobName: 'payoutProcessing',
      date: today,
      status: 'running',
      batchId,
      details: { startTime: new Date(), targetBusiness: businessId || 'all' },
      lastRun: new Date(),
    },
    { upsert: true, new: true }
  );

  let businessesProcessed = 0;
  let businessesSkipped = 0;
  const errors = [];

  try {
    const mongoose = require('mongoose');

    // Find businesses with unsettled balance > 0 (optionally filtered to one business)
    const matchStage = { payoutId: null };
    if (businessId) {
      matchStage.business = new mongoose.Types.ObjectId(businessId);
    }

    const unsettledAgg = await LedgerEntry.aggregate([
      { $match: matchStage },
      { $group: { _id: '$business', total: { $sum: '$amount' } } },
      { $match: { total: { $gt: 0 } } },
    ]);

    console.log(`[payoutProcessing] ${unsettledAgg.length} business(es) eligible${businessId ? ` (filtered to ${businessId})` : ''}.`);

    const scheduledDate = nextWednesday();

    for (const row of unsettledAgg) {
      try {
        const business = await User.findById(row._id).lean();
        if (!business) continue;

        // Duplicate protection: skip if this business already has a payout this week
        const existingPayout = await Payout.findOne({
          business: row._id,
          status: { $in: ['scheduled', 'processing'] },
          createdAt: { $gte: weekStart, $lte: weekEnd },
        });
        if (existingPayout) {
          console.log(`[payoutProcessing] ${business.name} — payout already exists this week (${existingPayout._id}), skipping.`);
          businessesSkipped++;
          continue;
        }

        // Count unsettled entries for this payout
        const entryCount = await LedgerEntry.countDocuments({
          business: row._id,
          payoutId: null,
        });

        // Create the payout record
        const payout = await Payout.create({
          business: row._id,
          amount: row.total,
          status: 'scheduled',
          scheduledDate,
          paymentSnapshot: business.paymentMethod || null,
          entryCount,
        });

        // Settle all unsettled entries and write the balancing payout debit entry
        await settleEntriesForPayout(row._id, payout._id, row.total);

        businessesProcessed++;
        console.log(`[payoutProcessing] Payout created for ${business.name}: ${row.total} EGP (id: ${payout._id})`);

        // Push notification — non-fatal
        try {
          const firebase = require('../config/firebase');
          await firebase.sendFinancialProcessingNotification(row._id, 'release_processing', {
            amount: row.total,
            releaseId: payout._id.toString(),
            transactionsCount: entryCount,
          });
        } catch (notifErr) {
          console.error(`[payoutProcessing] Notification failed for ${business.name}:`, notifErr.message);
        }
      } catch (bizErr) {
        console.error(`[payoutProcessing] Error for business ${row._id}:`, bizErr.message);
        errors.push({ businessId: row._id.toString(), error: bizErr.message });
      }
    }

    const summary = {
      businessesProcessed,
      businessesSkipped,
      errors,
      success: errors.length === 0,
      message: businessesProcessed === 0 && businessesSkipped === 0
        ? 'No businesses had an unsettled positive balance.'
        : `${businessesProcessed} payout(s) created${businessesSkipped ? `, ${businessesSkipped} already paid this week` : ''}${errors.length ? `, ${errors.length} error(s) — check logs` : ''}.`,
    };

    await JobLog.findOneAndUpdate(
      { jobName: 'payoutProcessing', date: today },
      {
        status: errors.length > 0 && businessesProcessed === 0 ? 'failed' : 'completed',
        details: {
          startTime: new Date(today),
          endTime: new Date(),
          targetBusiness: businessId || 'all',
          ...summary,
        },
        lastRun: new Date(),
      }
    );

    console.log(`[payoutProcessing] Done — ${businessesProcessed} created, ${businessesSkipped} skipped, ${errors.length} errors.`);
    return summary;
  } catch (err) {
    console.error('[payoutProcessing] Fatal error:', err);
    await JobLog.findOneAndUpdate(
      { jobName: 'payoutProcessing', date: today },
      {
        status: 'failed',
        details: { endTime: new Date(), success: false, message: err.message, targetBusiness: businessId || 'all' },
        lastRun: new Date(),
      }
    );
    throw err;
  } finally {
    isRunning = false;
  }
}

function initPayoutProcessing() {
  cron.schedule('1 0 * * 3', async () => {
    console.log('[payoutProcessing] Wednesday cron triggered.');
    await runPayoutProcessing();
  });

  console.log('[payoutProcessing] Cron scheduled (every Wednesday 00:01).');
}

module.exports = { initPayoutProcessing, runPayoutProcessing };
