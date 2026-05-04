/**
 * Previously retried failed `orders/create` webhook processing.
 * Auto-import from webhooks is disabled — merchants import via the embedded app only.
 * This job clears stale failed `orders/create` rows so they are not retried as auto-imports.
 */

const cron = require('node-cron');
const ShopifySyncLog = require('../models/shopifySyncLog');
const { updateShopifySyncLog } = require('../utils/shopifySyncLogHelper');

let running = false;

async function runShopifySyncRetry() {
  if (running) {
    console.log('[shopifySyncRetry] Already running — skip.');
    return { skipped: true };
  }
  running = true;
  let processed = 0;
  try {
    const batch = await ShopifySyncLog.find({
      status: 'failed',
      topic: 'orders/create',
      retryCount: { $lt: 5 },
      payload: { $exists: true, $ne: null },
    })
      .sort({ createdAt: 1 })
      .limit(50)
      .select('_id')
      .lean();

    for (const row of batch) {
      await updateShopifySyncLog(row._id, {
        set: {
          status: 'skipped',
          reason: 'orders_create_auto_import_disabled_use_embedded_app',
        },
        unset: { payload: 1 },
      });
      processed += 1;
    }
    if (processed) {
      console.log(`[shopifySyncRetry] Closed ${processed} stale orders/create failure row(s) (no auto-import).`);
    }
    return { processed };
  } catch (err) {
    console.error('[shopifySyncRetry] Fatal:', err.message || err);
    throw err;
  } finally {
    running = false;
  }
}

function initShopifySyncRetry() {
  cron.schedule('*/15 * * * *', async () => {
    try {
      await runShopifySyncRetry();
    } catch (e) {
      /* logged in run */
    }
  });
  console.log('[shopifySyncRetry] Cron scheduled (every 15 minutes).');
}

module.exports = { initShopifySyncRetry, runShopifySyncRetry };
