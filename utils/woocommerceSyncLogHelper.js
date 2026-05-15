const WoocommerceSyncLog = require('../models/woocommerceSyncLog');

async function writeWoocommerceSyncLog(opts) {
  const storePayload =
    opts.storePayload === true ||
    (opts.status === 'failed' &&
      (opts.topic === 'orders/create' || opts.topic === 'orders/updated'));

  let payload;
  if (storePayload && opts.payload != null && typeof WoocommerceSyncLog.capPayloadForStorage === 'function') {
    payload = WoocommerceSyncLog.capPayloadForStorage(opts.payload);
  } else if (storePayload && opts.payload != null) {
    payload = opts.payload;
  }

  try {
    const doc = {
      business: opts.business || undefined,
      storeUrl: String(opts.storeUrl || '').toLowerCase().trim(),
      wcOrderId: opts.wcOrderId != null ? String(opts.wcOrderId) : '',
      wcOrderNumber: opts.wcOrderNumber != null ? String(opts.wcOrderNumber) : '',
      topic: opts.topic,
      status: opts.status,
      reason: String(opts.reason || '').slice(0, 2000),
      nowOrderNumber: opts.nowOrderNumber != null ? String(opts.nowOrderNumber) : '',
      retryCount: typeof opts.retryCount === 'number' ? opts.retryCount : 0,
      lastRetryAt: opts.lastRetryAt || null,
    };
    if (payload !== undefined) doc.payload = payload;
    await WoocommerceSyncLog.create(doc);
  } catch (err) {
    console.error('[WoocommerceSyncLog] write failed:', err.message || err);
  }
}

async function updateWoocommerceSyncLog(id, patch = {}) {
  const update = {};
  const rawSet = patch.set && typeof patch.set === 'object' ? patch.set : {};
  const set = Object.fromEntries(Object.entries(rawSet).filter(([, v]) => v !== undefined));
  if (Object.keys(set).length) update.$set = set;
  if (patch.unset && Object.keys(patch.unset).length) update.$unset = patch.unset;
  if (!Object.keys(update).length) return;
  try {
    await WoocommerceSyncLog.findByIdAndUpdate(id, update);
  } catch (err) {
    console.error('[WoocommerceSyncLog] update failed:', err.message || err);
  }
}

async function bumpWoocommerceSyncRetry(id) {
  try {
    await WoocommerceSyncLog.findByIdAndUpdate(id, {
      $inc: { retryCount: 1 },
      $set: { lastRetryAt: new Date() },
    });
  } catch (err) {
    console.error('[WoocommerceSyncLog] bump retry failed:', err.message || err);
  }
}

module.exports = { writeWoocommerceSyncLog, updateWoocommerceSyncLog, bumpWoocommerceSyncRetry };
