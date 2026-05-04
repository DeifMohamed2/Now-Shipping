const Order = require('../models/order');
const User = require('../models/user');
const ShopifyInstallation = require('../models/shopifyInstallation');
const {
  shouldImportDeliverOrder,
  shopifyOrderToNormalizedFields,
  normalizeEgPhone,
} = require('./shopifyOrderMapper');
const {
  applyPickupDefaults,
  validateOrderFieldsStructural,
  validatePickupForOrderCreation,
  generateUniqueOrderNumber,
  buildOrderDocumentFromFields,
} = require('./orderCreationHelper');
const {
  writeShopifySyncLog,
  updateShopifySyncLog,
} = require('./shopifySyncLogHelper');

function stripShopifyMetaFields(fields) {
  const { _shopifyNote, _shopifyOrderNumber, ...rest } = fields;
  return { clean: rest, note: _shopifyNote, orderName: _shopifyOrderNumber };
}

/**
 * @param {string} shopDomain
 * @param {object} orderPayload
 * @param {object} [options]
 * @param {string} [options.retryFromLogId] - Mongo id of ShopifySyncLog to update instead of inserting
 */
async function syncOrderCreate(shopDomain, orderPayload, options = {}) {
  const { retryFromLogId } = options;
  const shopifyOrderId = orderPayload?.id != null ? String(orderPayload.id) : '';
  const shopifyOrderName = orderPayload?.name ? String(orderPayload.name) : '';
  const domain = String(shopDomain || '').toLowerCase().trim();

  let installation;

  const finalizeCreateLog = async (result, business) => {
    const status = result.created ? 'success' : result.skipped ? 'skipped' : 'failed';
    const reason = result.reason != null ? String(result.reason) : '';
    const nowOrderNumber = result.orderNumber != null ? String(result.orderNumber) : '';

    const label = result.created ? 'CREATED' : result.skipped ? 'SKIPPED' : 'FAILED';
    const extra = nowOrderNumber ? ` nowOrder=${nowOrderNumber}` : '';
    console.log(
      `[Shopify sync] orders/create shop=${domain} shopify=${shopifyOrderName || shopifyOrderId} ${label}` +
        (reason ? ` reason=${reason}` : '') +
        extra
    );

    if (retryFromLogId) {
      const unset = result.created || result.skipped ? { payload: 1 } : {};
      await updateShopifySyncLog(retryFromLogId, {
        set: {
          status,
          reason: reason.slice(0, 2000),
          nowOrderNumber,
          topic: 'orders/create',
          shopDomain: domain,
          shopifyOrderId,
          shopifyOrderName,
          business: business || undefined,
        },
        unset,
      });
    } else {
      await writeShopifySyncLog({
        business,
        shopDomain: domain,
        shopifyOrderId,
        shopifyOrderName,
        topic: 'orders/create',
        status,
        reason,
        nowOrderNumber,
        payload: status === 'failed' ? orderPayload : undefined,
      });
    }
    return result;
  };

  try {
    installation = await ShopifyInstallation.findOne({
      shopDomain: domain,
      uninstalledAt: null,
    });
    if (!installation) {
      return await finalizeCreateLog({ skipped: true, reason: 'no_installation' }, null);
    }

    if (installation.isActive === false) {
      return await finalizeCreateLog({ skipped: true, reason: 'sync_paused' }, installation.business);
    }

    const decide = shouldImportDeliverOrder(orderPayload);
    if (!decide.ok) {
      return await finalizeCreateLog({ skipped: true, reason: decide.reason }, installation.business);
    }

    const rawFields = shopifyOrderToNormalizedFields(orderPayload, installation);
    const { clean: fields, note: shopifyNote } = stripShopifyMetaFields(rawFields);

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
      console.warn('[Shopify sync] validation:', structural.errors[0], 'order', orderPayload.id);
      return await finalizeCreateLog({ skipped: true, reason: structural.errors[0] }, installation.business);
    }

    const pickupVal = validatePickupForOrderCreation(userData, fields);
    if (pickupVal.errors.length) {
      return await finalizeCreateLog({ skipped: true, reason: pickupVal.errors[0] }, installation.business);
    }

    const exists = await Order.findOne({
      business: installation.business,
      externalSource: 'shopify',
      externalOrderId: String(orderPayload.id),
    }).select('_id');

    if (exists) {
      return await finalizeCreateLog({ skipped: true, reason: 'duplicate' }, installation.business);
    }

    const orderNumber = await generateUniqueOrderNumber();
    const doc = buildOrderDocumentFromFields(userData, fields, orderNumber);
    doc.externalSource = 'shopify';
    doc.externalOrderId = String(orderPayload.id);
    doc.externalOrderNumber = orderPayload.name || '';
    if (shopifyNote) {
      doc.orderNotes = [shopifyNote, doc.orderNotes].filter(Boolean).join('\n').slice(0, 5000);
    }

    try {
      await doc.save();
      installation.lastWebhookAt = new Date();
      await ShopifyInstallation.updateOne(
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
    console.error(`[Shopify sync] orders/create shop=${domain} shopify=${shopifyOrderName || shopifyOrderId} ERROR`, msg);
    if (retryFromLogId) {
      await updateShopifySyncLog(retryFromLogId, {
        set: {
          status: 'failed',
          reason: msg.slice(0, 2000),
          shopDomain: domain,
          shopifyOrderId,
          shopifyOrderName,
          topic: 'orders/create',
          business: installation?.business,
        },
      });
    } else {
      await writeShopifySyncLog({
        business: installation?.business,
        shopDomain: domain,
        shopifyOrderId,
        shopifyOrderName,
        topic: 'orders/create',
        status: 'failed',
        reason: msg,
        payload: orderPayload,
      });
    }
    throw err;
  }
}

/**
 * Apply optional customer overrides from the embedded app (edited name/phone/address before import).
 * @param {object} fields - normalized fields from shopifyOrderToNormalizedFields
 * @param {object} [overrides]
 */
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
 * Manual import from embedded app — merchant supplies government + zone (required).
 * Ignores `isActive` pause (explicit merchant action).
 * @param {string} shopDomain
 * @param {object} orderPayload - Shopify REST order JSON
 * @param {{ government: string, zone: string, customerOverrides?: object }} zonePick
 * @returns {Promise<{ ok: true, orderNumber: string, orderId: string } | { ok: false, error: string }>}
 */
async function manualImportShopifyOrder(shopDomain, orderPayload, zonePick = {}) {
  const { government, zone, customerOverrides } = zonePick;
  const domain = String(shopDomain || '').toLowerCase().trim();
  const shopifyOrderId = orderPayload?.id != null ? String(orderPayload.id) : '';
  const shopifyOrderName = orderPayload?.name ? String(orderPayload.name) : '';

  try {
    if (!orderPayload || typeof orderPayload !== 'object') {
      return { ok: false, error: 'invalid_payload' };
    }
    if (orderPayload.cancelled_at) {
      return { ok: false, error: 'cancelled' };
    }
    if (!orderPayload.shipping_address || typeof orderPayload.shipping_address !== 'object') {
      return { ok: false, error: 'no_shipping_address' };
    }
    const addr = orderPayload.shipping_address;
    const country = String(addr.country_code || addr.country || '').toUpperCase();
    if (country && country !== 'EG' && country !== 'EGY') {
      return { ok: false, error: 'non_egypt_shipping' };
    }
    if (!government || !String(government).trim() || !zone || !String(zone).trim()) {
      return { ok: false, error: 'missing_government_or_zone' };
    }

    const installation = await ShopifyInstallation.findOne({
      shopDomain: domain,
      uninstalledAt: null,
    });
    if (!installation) {
      return { ok: false, error: 'no_installation' };
    }

    const rawFields = shopifyOrderToNormalizedFields(orderPayload, installation);
    const { clean: fields, note: shopifyNote } = stripShopifyMetaFields(rawFields);
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
      externalSource: 'shopify',
      externalOrderId: String(orderPayload.id),
    }).select('_id');

    if (exists) {
      return { ok: false, error: 'duplicate' };
    }

    const orderNumber = await generateUniqueOrderNumber();
    const doc = buildOrderDocumentFromFields(userData, fields, orderNumber);
    doc.externalSource = 'shopify';
    doc.externalOrderId = String(orderPayload.id);
    doc.externalOrderNumber = orderPayload.name || '';
    const metaNote = `Shopify manual import ${orderPayload.name || ''} — financial_status: ${
      orderPayload.financial_status || ''
    }. Zone: ${fields.government} / ${fields.zone}.`;
    if (shopifyNote) {
      doc.orderNotes = [metaNote, shopifyNote, doc.orderNotes].filter(Boolean).join('\n').slice(0, 5000);
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
    await ShopifyInstallation.updateOne(
      { _id: installation._id },
      { $set: { lastWebhookAt: installation.lastWebhookAt } }
    );

    await writeShopifySyncLog({
      business: installation.business,
      shopDomain: domain,
      shopifyOrderId,
      shopifyOrderName,
      topic: 'manual/import',
      status: 'success',
      reason: '',
      nowOrderNumber: String(doc.orderNumber),
    });

    return { ok: true, orderNumber: doc.orderNumber, orderId: String(doc._id) };
  } catch (err) {
    const msg = err && err.message ? String(err.message) : 'unknown_error';
    console.error(
      `[Shopify manual import] shop=${domain} shopify=${shopifyOrderName || shopifyOrderId} ERROR`,
      msg
    );
    return { ok: false, error: msg };
  }
}

async function finalizeUpdatedLog(domain, shopifyOrderId, shopifyOrderName, business, result) {
  const status = result.updated ? 'success' : result.skipped ? 'skipped' : 'failed';
  const reason = result.reason != null ? String(result.reason) : '';
  const label = result.updated ? 'UPDATED' : result.skipped ? 'SKIPPED' : 'FAILED';
  console.log(
    `[Shopify sync] orders/updated shop=${domain} shopify=${shopifyOrderName || shopifyOrderId} ${label}` +
      (reason ? ` reason=${reason}` : '')
  );
  await writeShopifySyncLog({
    business,
    shopDomain: domain,
    shopifyOrderId,
    shopifyOrderName,
    topic: 'orders/updated',
    status,
    reason: reason.slice(0, 2000),
  });
}

/**
 * Reflect Shopify cancellation on early-stage Now orders.
 */
async function syncOrderUpdated(shopDomain, orderPayload) {
  const domain = String(shopDomain || '').toLowerCase().trim();
  const shopifyOrderId = orderPayload?.id != null ? String(orderPayload.id) : '';
  const shopifyOrderName = orderPayload?.name ? String(orderPayload.name) : '';

  if (!orderPayload.cancelled_at) {
    return { skipped: true, reason: 'not_cancelled' };
  }

  let installation;
  try {
    installation = await ShopifyInstallation.findOne({
      shopDomain: domain,
      uninstalledAt: null,
    });
    if (!installation) {
      await finalizeUpdatedLog(domain, shopifyOrderId, shopifyOrderName, null, {
        skipped: true,
        reason: 'no_installation',
      });
      return { skipped: true, reason: 'no_installation' };
    }

    const order = await Order.findOne({
      business: installation.business,
      externalSource: 'shopify',
      externalOrderId: String(orderPayload.id),
    });

    if (!order) {
      await finalizeUpdatedLog(domain, shopifyOrderId, shopifyOrderName, installation.business, {
        skipped: true,
        reason: 'not_found',
      });
      return { skipped: true, reason: 'not_found' };
    }

    const cancellable = new Set(['new', 'pendingPickup']);
    if (!cancellable.has(order.orderStatus)) {
      await finalizeUpdatedLog(domain, shopifyOrderId, shopifyOrderName, installation.business, {
        skipped: true,
        reason: 'status_locked',
      });
      return { skipped: true, reason: 'status_locked' };
    }

    order.orderStatus = 'canceled';
    order.set('orderStages.canceled.isCompleted', true);
    order.set('orderStages.canceled.completedAt', new Date());
    order.set('orderStages.canceled.notes', 'Canceled in Shopify');
    order.set('orderStages.canceled.canceledBy', 'system');
    order.set('orderStages.canceled.reason', 'Canceled in Shopify');

    await order.save();
    installation.lastWebhookAt = new Date();
    await ShopifyInstallation.updateOne(
      { _id: installation._id },
      { $set: { lastWebhookAt: installation.lastWebhookAt } }
    );
    await finalizeUpdatedLog(domain, shopifyOrderId, shopifyOrderName, installation.business, {
      updated: true,
    });
    return { updated: true };
  } catch (err) {
    const msg = err && err.message ? String(err.message) : 'unknown_error';
    await writeShopifySyncLog({
      business: installation?.business,
      shopDomain: domain,
      shopifyOrderId,
      shopifyOrderName,
      topic: 'orders/updated',
      status: 'failed',
      reason: msg.slice(0, 2000),
    });
    console.error(`[Shopify sync] orders/updated shop=${domain} shopify=${shopifyOrderName || shopifyOrderId} ERROR`, msg);
    throw err;
  }
}

async function markAppUninstalled(shopDomain) {
  const domain = String(shopDomain || '').toLowerCase().trim();
  const inst = await ShopifyInstallation.findOne({ shopDomain: domain });

  await ShopifyInstallation.updateMany(
    { shopDomain: domain },
    {
      $set: {
        uninstalledAt: new Date(),
        accessTokenEncrypted: '',
      },
    }
  );

  await writeShopifySyncLog({
    business: inst?.business,
    shopDomain: domain,
    topic: 'app/uninstalled',
    status: 'success',
    reason: 'app_uninstalled',
  });
  console.log(`[Shopify sync] app/uninstalled shop=${domain} token cleared`);
  return { ok: true };
}

/**
 * GDPR shop/redact — sent ~48h after uninstall. Erase app-held shop credentials and deactivate install.
 * @param {string} shopDomain
 * @param {number|string} [shopifyShopId] - logged only
 */
async function markShopDataRedacted(shopDomain, shopifyShopId) {
  const domain = String(shopDomain || '').toLowerCase().trim();
  const inst = await ShopifyInstallation.findOne({ shopDomain: domain });

  await ShopifyInstallation.updateMany(
    { shopDomain: domain },
    {
      $set: {
        uninstalledAt: new Date(),
        accessTokenEncrypted: '',
        refreshTokenEncrypted: null,
        accessTokenExpiresAt: null,
        refreshTokenExpiresAt: null,
        scopes: '',
        isActive: false,
      },
    }
  );

  await writeShopifySyncLog({
    business: inst?.business,
    shopDomain: domain,
    topic: 'shop/redact',
    status: 'success',
    reason: 'shop_data_redacted',
  });
  console.log(`[Shopify sync] shop/redact shop=${domain} shopify_shop_id=${shopifyShopId ?? ''} tokens cleared`);
  return { ok: true };
}

module.exports = {
  syncOrderCreate,
  syncOrderUpdated,
  markAppUninstalled,
  markShopDataRedacted,
  manualImportShopifyOrder,
};
