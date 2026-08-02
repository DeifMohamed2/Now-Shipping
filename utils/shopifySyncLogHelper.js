const ShopifySyncLog = require('../models/shopifySyncLog');

/**
 * Persist a webhook processing outcome for the embedded app sync log and retry worker.
 * Never logs access tokens or raw secrets.
 *
 * @param {object} opts
 * @param {import('mongoose').Types.ObjectId} [opts.business]
 * @param {string} opts.shopDomain
 * @param {string} [opts.shopifyOrderId]
 * @param {string} [opts.shopifyOrderName]
 * @param {'orders/create'|'orders/updated'|'app/uninstalled'|'manual/import'|'fulfillment/create'|'customers/data_request'|'customers/redact'|'shop/redact'} opts.topic
 * @param {'success'|'skipped'|'failed'} opts.status
 * @param {string} [opts.reason]
 * @param {string} [opts.nowOrderNumber]
 * @param {object} [opts.payload] - stored when failed (retry) or when opts.storePayload is true
 * @param {boolean} [opts.storePayload]
 */
async function writeShopifySyncLog(opts) {
  const storePayload =
    opts.storePayload === true ||
    (opts.status === 'failed' &&
      (opts.topic === 'orders/create' || opts.topic === 'orders/updated'));

  let payload;
  if (storePayload && opts.payload != null && typeof ShopifySyncLog.capPayloadForStorage === 'function') {
    payload = ShopifySyncLog.capPayloadForStorage(opts.payload);
  } else if (storePayload && opts.payload != null) {
    payload = opts.payload;
  }

  try {
    const doc = {
      business: opts.business || undefined,
      shopDomain: String(opts.shopDomain || '').toLowerCase().trim(),
      shopifyOrderId: opts.shopifyOrderId != null ? String(opts.shopifyOrderId) : '',
      shopifyOrderName: opts.shopifyOrderName != null ? String(opts.shopifyOrderName) : '',
      topic: opts.topic,
      status: opts.status,
      reason: String(opts.reason || '').slice(0, 2000),
      nowOrderNumber: opts.nowOrderNumber != null ? String(opts.nowOrderNumber) : '',
      retryCount: typeof opts.retryCount === 'number' ? opts.retryCount : 0,
      lastRetryAt: opts.lastRetryAt || null,
    };
    if (payload !== undefined) doc.payload = payload;
    await ShopifySyncLog.create(doc);
  } catch (err) {
    console.error('[ShopifySyncLog] write failed:', err.message || err);
  }
}

/**
 * Update an existing log row (used by retry worker).
 * @param {import('mongoose').Types.ObjectId|string} id
 * @param {{ set?: object, unset?: object }} patch
 */
async function updateShopifySyncLog(id, patch = {}) {
  const update = {};
  const rawSet = patch.set && typeof patch.set === 'object' ? patch.set : {};
  const set = Object.fromEntries(
    Object.entries(rawSet).filter(([, v]) => v !== undefined)
  );
  if (Object.keys(set).length) update.$set = set;
  if (patch.unset && Object.keys(patch.unset).length) update.$unset = patch.unset;
  if (!Object.keys(update).length) return;
  try {
    await ShopifySyncLog.findByIdAndUpdate(id, update);
  } catch (err) {
    console.error('[ShopifySyncLog] update failed:', err.message || err);
  }
}

/** Count a retry attempt on an existing failed log. */
async function bumpShopifySyncRetry(id) {
  try {
    await ShopifySyncLog.findByIdAndUpdate(id, {
      $inc: { retryCount: 1 },
      $set: { lastRetryAt: new Date() },
    });
  } catch (err) {
    console.error('[ShopifySyncLog] bump retry failed:', err.message || err);
  }
}

module.exports = { writeShopifySyncLog, updateShopifySyncLog, bumpShopifySyncRetry };
