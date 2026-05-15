/**
 * Retries failed WooCommerce `orders/create` sync rows (max 5 attempts).
 */

const cron = require('node-cron');
const WoocommerceSyncLog = require('../models/woocommerceSyncLog');
const { bumpWoocommerceSyncRetry, updateWoocommerceSyncLog } = require('../utils/woocommerceSyncLogHelper');
const { syncWcOrderCreate } = require('../utils/woocommerceOrderSync');

let running = false;

async function runWoocommerceSyncRetry() {
  if (running) {
    console.log('[woocommerceSyncRetry] Already running — skip.');
    return { skipped: true };
  }
  running = true;
  let processed = 0;
  try {
    const batch = await WoocommerceSyncLog.find({
      status: 'failed',
      topic: 'orders/create',
      retryCount: { $lt: 5 },
      payload: { $exists: true, $ne: null },
    })
      .sort({ createdAt: 1 })
      .limit(25)
      .select('_id storeUrl payload')
      .lean();

    for (const row of batch) {
      await bumpWoocommerceSyncRetry(row._id);
      try {
        const payload = row.payload;
        const storeUrl = row.storeUrl;
        await syncWcOrderCreate(storeUrl, payload, { retryFromLogId: row._id });
        processed += 1;
      } catch (err) {
        const msg = err && err.message ? String(err.message) : 'retry_error';
        await updateWoocommerceSyncLog(row._id, {
          set: {
            status: 'failed',
            reason: msg.slice(0, 2000),
          },
        });
      }
    }
    if (processed) {
      console.log(`[woocommerceSyncRetry] Retried ${processed} row(s).`);
    }
    return { processed };
  } catch (err) {
    console.error('[woocommerceSyncRetry] Fatal:', err.message || err);
    throw err;
  } finally {
    running = false;
  }
}

function initWoocommerceSyncRetry() {
  cron.schedule('*/15 * * * *', async () => {
    try {
      await runWoocommerceSyncRetry();
    } catch (e) {
      /* logged in run */
    }
  });
  console.log('[woocommerceSyncRetry] Cron scheduled (every 15 minutes).');
}

module.exports = { initWoocommerceSyncRetry, runWoocommerceSyncRetry };
