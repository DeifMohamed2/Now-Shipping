const Order = require('../models/order');
const User = require('../models/user');
const WoocommerceInstallation = require('../models/woocommerceInstallation');
const {
  shouldImportDeliverOrder,
  shopifyOrderToNormalizedFields,
  normalizeEgPhone,
} = require('./shopifyOrderMapper');
const { wcOrderToShopifyLike } = require('./wcOrderPayload');
const {
  applyPickupDefaults,
  validateOrderFieldsStructural,
  validatePickupForOrderCreation,
  generateUniqueOrderNumber,
  buildOrderDocumentFromFields,
} = require('./orderCreationHelper');
const {
  writeWoocommerceSyncLog,
  updateWoocommerceSyncLog,
} = require('./woocommerceSyncLogHelper');
const { normalizeStoreUrl } = require('./woocommerceService');

function stripMetaFields(fields) {
  const { _shopifyNote, _shopifyOrderNumber, ...rest } = fields;
  return { clean: rest, note: _shopifyNote, orderName: _shopifyOrderNumber };
}

function shopifyLikeName(wcOrder) {
  return `#${wcOrder.number != null ? wcOrder.number : wcOrder.id}`;
}

/**
 * @param {string} storeUrl
 * @param {object} wcOrder - WooCommerce REST order JSON
 * @param {{ retryFromLogId?: import('mongoose').Types.ObjectId }} [options]
 */
async function syncWcOrderCreate(storeUrl, wcOrder, options = {}) {
  const { retryFromLogId } = options;
  const urlNorm = normalizeStoreUrl(storeUrl);
  const wcOrderId = wcOrder?.id != null ? String(wcOrder.id) : '';
  const wcOrderNumber = shopifyLikeName(wcOrder || {});

  const finalizeCreateLog = async (result, business) => {
    const status = result.created ? 'success' : result.skipped ? 'skipped' : 'failed';
    const reason = result.reason != null ? String(result.reason) : '';
    const nowOrderNumber = result.orderNumber != null ? String(result.orderNumber) : '';

    if (retryFromLogId) {
      const unset = result.created || result.skipped ? { payload: 1 } : {};
      await updateWoocommerceSyncLog(retryFromLogId, {
        set: {
          status,
          reason: reason.slice(0, 2000),
          nowOrderNumber,
          topic: 'orders/create',
          storeUrl: urlNorm,
          wcOrderId,
          wcOrderNumber,
          business: business || undefined,
        },
        unset,
      });
    } else {
      await writeWoocommerceSyncLog({
        business,
        storeUrl: urlNorm,
        wcOrderId,
        wcOrderNumber,
        topic: 'orders/create',
        status,
        reason,
        nowOrderNumber,
        payload: status === 'failed' ? wcOrder : undefined,
      });
    }
    return result;
  };

  let installation;
  try {
    installation = await WoocommerceInstallation.findOne({
      storeUrl: urlNorm,
      uninstalledAt: null,
    });
    if (!installation) {
      return await finalizeCreateLog({ skipped: true, reason: 'no_installation' }, null);
    }

    if (installation.isActive === false) {
      return await finalizeCreateLog({ skipped: true, reason: 'sync_paused' }, installation.business);
    }

    const shopifyLike = wcOrderToShopifyLike(wcOrder);
    const decide = shouldImportDeliverOrder(shopifyLike);
    if (!decide.ok) {
      return await finalizeCreateLog({ skipped: true, reason: decide.reason }, installation.business);
    }

    const rawFields = shopifyOrderToNormalizedFields(shopifyLike, installation);
    const { clean: fields, note: syncNote } = stripMetaFields(rawFields);

    const userData = await User.findById(installation.business);
    if (!userData) {
      return await finalizeCreateLog({ skipped: true, reason: 'no_user' }, installation.business);
    }

    applyPickupDefaults(userData, fields);

    if (fields.isExpressShipping && (!userData.pickUpAddresses || !userData.pickUpAddresses.length)) {
      fields.isExpressShipping = false;
    }

    const structural = validateOrderFieldsStructural(fields);
    if (structural.errors.length) {
      return await finalizeCreateLog({ skipped: true, reason: structural.errors[0] }, installation.business);
    }

    const pickupVal = validatePickupForOrderCreation(userData, fields);
    if (pickupVal.errors.length) {
      return await finalizeCreateLog({ skipped: true, reason: pickupVal.errors[0] }, installation.business);
    }

    const exists = await Order.findOne({
      business: installation.business,
      externalSource: 'woocommerce',
      externalOrderId: String(wcOrder.id),
    }).select('_id');

    if (exists) {
      return await finalizeCreateLog({ skipped: true, reason: 'duplicate' }, installation.business);
    }

    const orderNumber = await generateUniqueOrderNumber();
    const doc = buildOrderDocumentFromFields(userData, fields, orderNumber);
    doc.externalSource = 'woocommerce';
    doc.externalOrderId = String(wcOrder.id);
    doc.externalOrderNumber = wcOrderNumber;
    const metaNote = `WooCommerce ${wcOrderNumber} — status: ${wcOrder.status || ''}.`;
    if (syncNote) {
      doc.orderNotes = [metaNote, syncNote, doc.orderNotes].filter(Boolean).join('\n').slice(0, 5000);
    } else {
      doc.orderNotes = [metaNote, doc.orderNotes].filter(Boolean).join('\n').slice(0, 5000);
    }

    try {
      await doc.save();
      installation.lastWebhookAt = new Date();
      await WoocommerceInstallation.updateOne(
        { _id: installation._id },
        { $set: { lastWebhookAt: installation.lastWebhookAt } }
      );
      return await finalizeCreateLog({ created: true, orderNumber: doc.orderNumber }, installation.business);
    } catch (err) {
      if (err && err.code === 11000) {
        return await finalizeCreateLog({ skipped: true, reason: 'duplicate_race' }, installation.business);
      }
      throw err;
    }
  } catch (err) {
    const msg = err && err.message ? String(err.message) : 'unknown_error';
    if (retryFromLogId) {
      await updateWoocommerceSyncLog(retryFromLogId, {
        set: {
          status: 'failed',
          reason: msg.slice(0, 2000),
          storeUrl: urlNorm,
          wcOrderId,
          wcOrderNumber,
          topic: 'orders/create',
          business: installation?.business,
        },
      });
    } else {
      await writeWoocommerceSyncLog({
        business: installation?.business,
        storeUrl: urlNorm,
        wcOrderId,
        wcOrderNumber,
        topic: 'orders/create',
        status: 'failed',
        reason: msg,
        payload: wcOrder,
      });
    }
    throw err;
  }
}

function applyCustomerOverrides(fields, overrides) {
  if (!overrides || typeof overrides !== 'object') return;
  if (overrides.fullName != null && String(overrides.fullName).trim()) {
    fields.fullName = String(overrides.fullName).trim().slice(0, 200);
  }
  if (overrides.phoneNumber != null && String(overrides.phoneNumber).trim()) {
    let phone = normalizeEgPhone(overrides.phoneNumber);
    if (phone.length < 10) phone = '01000000000';
    fields.phoneNumber = phone.slice(0, 15);
  }
  if (overrides.otherPhoneNumber != null) {
    const o = String(overrides.otherPhoneNumber).trim();
    if (!o) {
      fields.otherPhoneNumber = null;
    } else {
      let p = normalizeEgPhone(o);
      fields.otherPhoneNumber = p ? p.slice(0, 15) : null;
    }
  }
  if (overrides.address != null && String(overrides.address).trim()) {
    fields.address = String(overrides.address).trim().slice(0, 500);
  }
}

/**
 * Manual import — merchant supplies government + zone (from Now app or WP admin).
 */
async function manualImportWcOrder(storeUrl, wcOrder, zonePick = {}) {
  const { government, zone, customerOverrides } = zonePick;
  const urlNorm = normalizeStoreUrl(storeUrl);
  const wcOrderId = wcOrder?.id != null ? String(wcOrder.id) : '';
  const wcOrderNumber = shopifyLikeName(wcOrder || {});

  try {
    if (!wcOrder || typeof wcOrder !== 'object') {
      return { ok: false, error: 'invalid_payload' };
    }
    if (wcOrder.status === 'cancelled') {
      return { ok: false, error: 'cancelled' };
    }
    const ship = wcOrder.shipping && typeof wcOrder.shipping === 'object' ? wcOrder.shipping : {};
    const country = String(ship.country || '').trim().toUpperCase();
    if (country && country !== 'EG' && country !== 'EGY' && country !== 'EGYPT') {
      return { ok: false, error: 'non_egypt_shipping' };
    }
    if (!government || !String(government).trim() || !zone || !String(zone).trim()) {
      return { ok: false, error: 'missing_government_or_zone' };
    }

    const installation = await WoocommerceInstallation.findOne({
      storeUrl: urlNorm,
      uninstalledAt: null,
    });
    if (!installation) {
      return { ok: false, error: 'no_installation' };
    }

    const shopifyLike = wcOrderToShopifyLike(wcOrder);
    if (!shopifyLike.shipping_address || !Object.keys(shopifyLike.shipping_address).length) {
      return { ok: false, error: 'no_shipping_address' };
    }

    const rawFields = shopifyOrderToNormalizedFields(shopifyLike, installation);
    const { clean: fields, note: syncNote } = stripMetaFields(rawFields);
    applyCustomerOverrides(fields, customerOverrides);
    fields.government = String(government).trim();
    fields.zone = String(zone).trim();

    const userData = await User.findById(installation.business);
    if (!userData) {
      return { ok: false, error: 'no_user' };
    }

    applyPickupDefaults(userData, fields);

    if (fields.isExpressShipping && (!userData.pickUpAddresses || !userData.pickUpAddresses.length)) {
      fields.isExpressShipping = false;
    }

    const structural = validateOrderFieldsStructural(fields);
    if (structural.errors.length) {
      return { ok: false, error: structural.errors[0] };
    }

    const pickupVal = validatePickupForOrderCreation(userData, fields);
    if (pickupVal.errors.length) {
      return { ok: false, error: pickupVal.errors[0] };
    }

    const exists = await Order.findOne({
      business: installation.business,
      externalSource: 'woocommerce',
      externalOrderId: String(wcOrder.id),
    }).select('_id');

    if (exists) {
      return { ok: false, error: 'duplicate' };
    }

    const orderNumber = await generateUniqueOrderNumber();
    const doc = buildOrderDocumentFromFields(userData, fields, orderNumber);
    doc.externalSource = 'woocommerce';
    doc.externalOrderId = String(wcOrder.id);
    doc.externalOrderNumber = wcOrderNumber;
    const metaNote = `WooCommerce manual import ${wcOrderNumber} — status: ${wcOrder.status || ''}. Zone: ${fields.government} / ${fields.zone}.`;
    if (syncNote) {
      doc.orderNotes = [metaNote, syncNote, doc.orderNotes].filter(Boolean).join('\n').slice(0, 5000);
    } else {
      doc.orderNotes = [metaNote, doc.orderNotes].filter(Boolean).join('\n').slice(0, 5000);
    }

    try {
      await doc.save();
    } catch (err) {
      if (err && err.code === 11000) {
        return { ok: false, error: 'duplicate_race' };
      }
      throw err;
    }

    installation.lastWebhookAt = new Date();
    await WoocommerceInstallation.updateOne(
      { _id: installation._id },
      { $set: { lastWebhookAt: installation.lastWebhookAt } }
    );

    await writeWoocommerceSyncLog({
      business: installation.business,
      storeUrl: urlNorm,
      wcOrderId,
      wcOrderNumber,
      topic: 'manual/import',
      status: 'success',
      reason: '',
      nowOrderNumber: String(doc.orderNumber),
    });

    return { ok: true, orderNumber: doc.orderNumber, orderId: String(doc._id) };
  } catch (err) {
    const msg = err && err.message ? String(err.message) : 'unknown_error';
    console.error(`[WooCommerce manual import] store=${urlNorm} wc=${wcOrderNumber || wcOrderId} ERROR`, msg);
    return { ok: false, error: msg };
  }
}

async function finalizeUpdatedLog(urlNorm, wcOrderId, wcOrderNumber, business, result) {
  const status = result.updated ? 'success' : result.skipped ? 'skipped' : 'failed';
  const reason = result.reason != null ? String(result.reason) : '';
  await writeWoocommerceSyncLog({
    business,
    storeUrl: urlNorm,
    wcOrderId,
    wcOrderNumber,
    topic: 'orders/updated',
    status,
    reason: reason.slice(0, 2000),
  });
}

/**
 * Cancel early-stage Now orders when WooCommerce order is cancelled.
 */
async function syncWcOrderUpdated(storeUrl, wcOrder) {
  const urlNorm = normalizeStoreUrl(storeUrl);
  const wcOrderId = wcOrder?.id != null ? String(wcOrder.id) : '';
  const wcOrderNumber = shopifyLikeName(wcOrder || {});

  if (wcOrder.status !== 'cancelled') {
    return { skipped: true, reason: 'not_cancelled' };
  }

  let installation;
  try {
    installation = await WoocommerceInstallation.findOne({
      storeUrl: urlNorm,
      uninstalledAt: null,
    });
    if (!installation) {
      await finalizeUpdatedLog(urlNorm, wcOrderId, wcOrderNumber, null, {
        skipped: true,
        reason: 'no_installation',
      });
      return { skipped: true, reason: 'no_installation' };
    }

    const order = await Order.findOne({
      business: installation.business,
      externalSource: 'woocommerce',
      externalOrderId: String(wcOrder.id),
    });

    if (!order) {
      await finalizeUpdatedLog(urlNorm, wcOrderId, wcOrderNumber, installation.business, {
        skipped: true,
        reason: 'not_found',
      });
      return { skipped: true, reason: 'not_found' };
    }

    const cancellable = new Set(['new', 'pendingPickup']);
    if (!cancellable.has(order.orderStatus)) {
      await finalizeUpdatedLog(urlNorm, wcOrderId, wcOrderNumber, installation.business, {
        skipped: true,
        reason: 'status_locked',
      });
      return { skipped: true, reason: 'status_locked' };
    }

    order.orderStatus = 'canceled';
    order.set('orderStages.canceled.isCompleted', true);
    order.set('orderStages.canceled.completedAt', new Date());
    order.set('orderStages.canceled.notes', 'Canceled in WooCommerce');
    order.set('orderStages.canceled.canceledBy', 'system');
    order.set('orderStages.canceled.reason', 'Canceled in WooCommerce');

    await order.save();
    installation.lastWebhookAt = new Date();
    await WoocommerceInstallation.updateOne(
      { _id: installation._id },
      { $set: { lastWebhookAt: installation.lastWebhookAt } }
    );
    await finalizeUpdatedLog(urlNorm, wcOrderId, wcOrderNumber, installation.business, {
      updated: true,
    });
    return { updated: true };
  } catch (err) {
    const msg = err && err.message ? String(err.message) : 'unknown_error';
    await writeWoocommerceSyncLog({
      business: installation?.business,
      storeUrl: urlNorm,
      wcOrderId,
      wcOrderNumber,
      topic: 'orders/updated',
      status: 'failed',
      reason: msg.slice(0, 2000),
    });
    console.error(`[WooCommerce sync] orders/updated store=${urlNorm} wc=${wcOrderNumber || wcOrderId} ERROR`, msg);
    throw err;
  }
}

async function markPluginUninstalled(storeUrl) {
  const urlNorm = normalizeStoreUrl(storeUrl);
  const { encryptToken } = require('./shopifyTokenCrypto');
  await WoocommerceInstallation.updateMany(
    { storeUrl: urlNorm, uninstalledAt: null },
    {
      $set: {
        uninstalledAt: new Date(),
        isActive: false,
        installationTokenDigest: `uninstalled_${urlNorm}_${Date.now()}`,
        sharedSecretEncrypted: encryptToken('revoked'),
        restKeyEncrypted: null,
        restSecretEncrypted: null,
      },
    }
  );
}

module.exports = {
  syncWcOrderCreate,
  manualImportWcOrder,
  syncWcOrderUpdated,
  markPluginUninstalled,
};
