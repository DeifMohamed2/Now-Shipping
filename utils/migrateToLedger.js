/**
 * migrateToLedger.js
 *
 * ONE-TIME migration: converts all old Transaction + Release documents into
 * LedgerEntry + Payout documents.
 *
 * Usage (trigger from the temp admin route /admin/api/migrate-to-ledger):
 *   POST /admin/api/migrate-to-ledger
 *
 * Safety:
 *   - Idempotent: existing LedgerEntries are not duplicated (unique index on orderId+type)
 *   - Dry-run mode available: pass { dryRun: true } to preview without writing
 *   - Writes a summary log to console on completion
 *
 * After confirming everything is correct, remove the temp route from adminRoutes.js.
 */

const LedgerEntry = require('../models/ledgerEntry');
const Payout = require('../models/payout');

// Map old Transaction types → new LedgerEntry types
const TYPE_MAP = {
  cashCycle:              'cod_collected',
  fees:                   'delivery_fee',
  returnFees:             'delivery_fee',
  cancellationFees:       'delivery_fee',
  returnCompletedFees:    'delivery_fee',
  pickupFees:             'pickup_fee',
  flyersFees:             'pickup_fee',
  shopOrderDelivery:      'cod_collected',
  refund:                 'adjustment',
  deposit:                'adjustment',
  withdrawal:             'payout',
};

function tryRequire(modulePath) {
  try {
    return require(modulePath);
  } catch {
    return null;
  }
}

async function migrateToLedger({ dryRun = false } = {}) {
  const mongoose = require('mongoose');
  const Transaction = tryRequire('../models/transactions');
  const Release = tryRequire('../models/releases');

  if (!Transaction || !Release) {
    return {
      dryRun,
      skipped: true,
      message:
        'Legacy Transaction/Release model files are not in this codebase. If you still have old data in MongoDB, restore models/transactions.js and models/releases.js from git history, run migration once, then remove those files again.',
      transactionsFound: 0,
      ledgerEntriesCreated: 0,
      ledgerEntriesSkipped: 0,
      releasesFound: 0,
      payoutsCreated: 0,
      payoutsSkipped: 0,
      errors: [],
    };
  }

  const summary = {
    dryRun,
    transactionsFound: 0,
    ledgerEntriesCreated: 0,
    ledgerEntriesSkipped: 0,
    releasesFound: 0,
    payoutsCreated: 0,
    payoutsSkipped: 0,
    errors: [],
  };

  console.log(`[migrate] Starting ledger migration (dryRun=${dryRun})…`);

  // ── Step 1: Migrate Releases → Payouts ────────────────────
  const releases = await Release.find({}).populate('business').lean();
  summary.releasesFound = releases.length;
  console.log(`[migrate] Found ${releases.length} Release documents.`);

  const releaseToPayoutMap = new Map(); // releaseId (ObjectId string) → Payout._id

  for (const rel of releases) {
    try {
      // Check if already migrated
      const existing = await Payout.findOne({ _id: rel._id }).lean();
      if (existing) {
        summary.payoutsSkipped++;
        releaseToPayoutMap.set(rel._id.toString(), existing._id);
        continue;
      }

      const statusMap = { released: 'paid', pending: 'scheduled', scheduled: 'scheduled', failed: 'failed' };
      const payoutData = {
        _id: rel._id,                // preserve original ObjectId so LedgerEntry refs still work
        business: rel.business?._id || rel.business,
        amount: rel.amount,
        status: statusMap[rel.releaseStatus] || 'scheduled',
        scheduledDate: rel.scheduledReleaseDate || rel.createdAt || new Date(),
        paidDate: rel.releaseStatus === 'released' ? (rel.updatedAt || new Date()) : null,
        paymentSnapshot: rel.business?.paymentMethod || null,
        adminNote: rel.releaseNotes || null,
        entryCount: rel.transactionReferences?.length || 0,
      };

      if (!dryRun) {
        const payout = new Payout(payoutData);
        await payout.save();
        releaseToPayoutMap.set(rel._id.toString(), payout._id);
      } else {
        releaseToPayoutMap.set(rel._id.toString(), rel._id);
      }
      summary.payoutsCreated++;
    } catch (err) {
      summary.errors.push({ type: 'release', id: rel._id, error: err.message });
    }
  }

  // ── Step 2: Migrate Transactions → LedgerEntries ──────────
  const transactions = await Transaction.find({}).sort({ createdAt: 1 }).lean();
  summary.transactionsFound = transactions.length;
  console.log(`[migrate] Found ${transactions.length} Transaction documents.`);

  for (const tx of transactions) {
    try {
      const entryType = TYPE_MAP[tx.transactionType] || 'adjustment';

      // Determine payoutId: if transaction was settled, link to the release's payout
      let payoutId = null;
      if (tx.settlementStatus === 'settled' || tx.settlementStatus === 'included_in_release') {
        // Find which release included this transaction
        const matchingReleaseId = Array.from(releaseToPayoutMap.keys()).find(rid => {
          const rel = releases.find(r => r._id.toString() === rid);
          return rel?.transactionReferences?.some(ref => ref.toString() === tx._id.toString());
        });
        if (matchingReleaseId) {
          payoutId = releaseToPayoutMap.get(matchingReleaseId);
        }
      }

      // Extract orderId and orderNumber from references
      let orderId     = null;
      let orderNumber = null;
      let pickupId    = null;
      let pickupNumber = null;

      if (tx.orderReferences?.length > 0) {
        orderId     = tx.orderReferences[0].orderId     || null;
        orderNumber = tx.orderReferences[0].orderNumber || null;
      }
      if (tx.pickupReferences?.length > 0) {
        pickupId     = tx.pickupReferences[0].pickupId     || null;
        pickupNumber = tx.pickupReferences[0].pickupNumber || null;
      }

      const description = tx.transactionNotes ||
        `Migrated: ${tx.transactionType} (${tx.transactionId})`;

      const entryData = {
        business:    tx.business,
        type:        entryType,
        amount:      tx.transactionAmount || 0,
        description: description.slice(0, 500),
        orderId,
        orderNumber,
        pickupId,
        pickupNumber,
        payoutId,
        createdBy: 'system',
        createdAt: tx.createdAt,
        updatedAt: tx.updatedAt,
      };

      if (!dryRun) {
        try {
          await LedgerEntry.create(entryData);
          summary.ledgerEntriesCreated++;
        } catch (dupErr) {
          if (dupErr.code === 11000) {
            summary.ledgerEntriesSkipped++;
          } else {
            throw dupErr;
          }
        }
      } else {
        summary.ledgerEntriesCreated++;
      }
    } catch (err) {
      summary.errors.push({ type: 'transaction', id: tx._id, txType: tx.transactionType, error: err.message });
    }
  }

  // ── Step 3: Verification ───────────────────────────────────
  if (!dryRun) {
    const entryCount = await LedgerEntry.countDocuments();
    const payoutCount = await Payout.countDocuments();
    console.log(`[migrate] Verification: ${entryCount} LedgerEntries, ${payoutCount} Payouts in DB.`);
  }

  console.log('[migrate] Migration complete:', JSON.stringify(summary, null, 2));
  return summary;
}

module.exports = { migrateToLedger };
