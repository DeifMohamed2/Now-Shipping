const {
  adminApiVersionString,
  getAppUrl,
  getValidAccessToken,
  shopifyRestGetOrder,
} = require('./shopifyService');
const { writeShopifySyncLog } = require('./shopifySyncLogHelper');

/**
 * @param {string} shopDomain
 * @param {string} accessToken
 * @param {string} path - e.g. `/orders/123/fulfillment_orders.json`
 * @param {{ method?: string, body?: object }} [opts]
 */
async function shopifyRestRequest(shopDomain, accessToken, path, opts = {}) {
  const v = adminApiVersionString();
  const method = opts.method || 'GET';
  const url = `https://${shopDomain}/admin/api/${v}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'X-Shopify-Access-Token': accessToken,
      Accept: 'application/json',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }
  if (!res.ok) {
    const err = new Error(`Shopify API ${method} ${path} failed: ${res.status} ${text.slice(0, 500)}`);
    err.status = res.status;
    err.shopifyBody = json;
    throw err;
  }
  return json;
}

/**
 * @param {string} shopDomain
 * @param {string} accessToken
 * @param {string|number} shopifyOrderId
 */
async function getFulfillmentOrders(shopDomain, accessToken, shopifyOrderId) {
  const json = await shopifyRestRequest(
    shopDomain,
    accessToken,
    `/orders/${encodeURIComponent(String(shopifyOrderId))}/fulfillment_orders.json`
  );
  return Array.isArray(json.fulfillment_orders) ? json.fulfillment_orders : [];
}

/**
 * @param {import('../models/order')} order
 */
function buildTrackingInfo(order) {
  const appUrl = getAppUrl().replace(/\/$/, '');
  const trackingNumber = String(order.orderNumber || '').trim();
  return {
    number: trackingNumber,
    url: trackingNumber ? `${appUrl}/t/${encodeURIComponent(trackingNumber)}` : '',
    company: 'Now Shipping',
  };
}

const OPEN_FULFILLMENT_ORDER_STATUSES = new Set(['open', 'in_progress', 'scheduled']);

/**
 * Create a Shopify fulfillment with Now tracking for an imported order.
 * Idempotent: skips when externalFulfillmentId is set or Shopify order is already fulfilled.
 *
 * @param {{ installation: import('../models/shopifyInstallation'), order: import('../models/order') }} params
 * @returns {Promise<{ created?: boolean, skipped?: boolean, reason?: string, fulfillmentId?: string, error?: string }>}
 */
async function createFulfillmentWithTracking({ installation, order }) {
  const shopDomain = installation?.shopDomain;
  const shopifyOrderId = order?.externalOrderId != null ? String(order.externalOrderId) : '';
  const shopifyOrderName = order?.externalOrderNumber ? String(order.externalOrderNumber) : '';

  if (!installation || !order) {
    return { skipped: true, reason: 'missing_args' };
  }
  if (order.externalSource !== 'shopify' || !shopifyOrderId) {
    return { skipped: true, reason: 'not_shopify_order' };
  }
  if (order.externalFulfillmentId) {
    return {
      skipped: true,
      reason: 'already_synced',
      fulfillmentId: String(order.externalFulfillmentId),
    };
  }

  const token = await getValidAccessToken(installation);

  const shopifyOrder = await shopifyRestGetOrder(shopDomain, token, shopifyOrderId);
  if (!shopifyOrder) {
    return { skipped: true, reason: 'shopify_order_not_found' };
  }
  if (shopifyOrder.fulfillment_status === 'fulfilled') {
    return { skipped: true, reason: 'already_fulfilled_in_shopify' };
  }

  const fulfillmentOrders = await getFulfillmentOrders(shopDomain, token, shopifyOrderId);
  const openFulfillmentOrders = fulfillmentOrders.filter((fo) =>
    OPEN_FULFILLMENT_ORDER_STATUSES.has(String(fo.status || '').toLowerCase())
  );

  if (!openFulfillmentOrders.length) {
    return { skipped: true, reason: 'no_open_fulfillment_orders' };
  }

  const notifyCustomer = process.env.SHOPIFY_FULFILLMENT_NOTIFY_CUSTOMER === 'true';
  const trackingInfo = buildTrackingInfo(order);

  const json = await shopifyRestRequest(shopDomain, token, '/fulfillments.json', {
    method: 'POST',
    body: {
      fulfillment: {
        line_items_by_fulfillment_order: openFulfillmentOrders.map((fo) => ({
          fulfillment_order_id: fo.id,
        })),
        tracking_info: trackingInfo,
        notify_customer: notifyCustomer,
      },
    },
  });

  const fulfillmentId = json.fulfillment?.id != null ? String(json.fulfillment.id) : '';
  if (fulfillmentId) {
    order.externalFulfillmentId = fulfillmentId;
    await order.save();
  }

  return { created: true, fulfillmentId };
}

/**
 * Push fulfillment + tracking to Shopify after import. Never throws — logs outcome.
 *
 * @param {{ installation: import('../models/shopifyInstallation'), order: import('../models/order') }} params
 */
async function syncFulfillmentAfterImport({ installation, order }) {
  const shopDomain = installation?.shopDomain || '';
  const shopifyOrderId = order?.externalOrderId != null ? String(order.externalOrderId) : '';
  const shopifyOrderName = order?.externalOrderNumber ? String(order.externalOrderNumber) : '';

  try {
    const result = await createFulfillmentWithTracking({ installation, order });
    const status = result.created ? 'success' : result.skipped ? 'skipped' : 'failed';
    const reason = result.reason || result.error || '';

    await writeShopifySyncLog({
      business: installation.business,
      shopDomain,
      shopifyOrderId,
      shopifyOrderName,
      topic: 'fulfillment/create',
      status,
      reason: reason.slice(0, 2000),
      nowOrderNumber: order.orderNumber != null ? String(order.orderNumber) : '',
    });

    const label = result.created ? 'CREATED' : result.skipped ? 'SKIPPED' : 'FAILED';
    console.log(
      `[Shopify fulfillment] shop=${shopDomain} shopify=${shopifyOrderName || shopifyOrderId} ${label}` +
        (reason ? ` reason=${reason}` : '') +
        (result.fulfillmentId ? ` fulfillmentId=${result.fulfillmentId}` : '')
    );

    return result;
  } catch (err) {
    const msg = err && err.message ? String(err.message) : 'unknown_error';
    const needsReconnect = err.status === 403;

    await writeShopifySyncLog({
      business: installation?.business,
      shopDomain,
      shopifyOrderId,
      shopifyOrderName,
      topic: 'fulfillment/create',
      status: 'failed',
      reason: (needsReconnect ? 'reconnect_required: ' : '') + msg.slice(0, 2000),
      nowOrderNumber: order.orderNumber != null ? String(order.orderNumber) : '',
    });

    console.error(
      `[Shopify fulfillment] shop=${shopDomain} shopify=${shopifyOrderName || shopifyOrderId} ERROR`,
      msg
    );

    return { skipped: false, error: msg, needsReconnect };
  }
}

module.exports = {
  getFulfillmentOrders,
  buildTrackingInfo,
  createFulfillmentWithTracking,
  syncFulfillmentAfterImport,
};
