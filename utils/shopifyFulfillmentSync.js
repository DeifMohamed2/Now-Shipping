const {
  adminApiVersionString,
  getAppUrl,
  getValidAccessToken,
  shopifyRestGetOrder,
} = require('./shopifyService');
const { writeShopifySyncLog } = require('./shopifySyncLogHelper');

const OPEN_FULFILLMENT_ORDER_STATUSES = new Set(['open', 'in_progress', 'scheduled']);
const FULFILLMENT_RETRY_ATTEMPTS = 3;
const FULFILLMENT_RETRY_DELAY_MS = 400;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableShopifyError(err) {
  const status = err && err.status;
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

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
  const rawUrl = getAppUrl().replace(/\/$/, '');
  const appUrl = rawUrl.startsWith('http://') ? rawUrl.replace(/^http:\/\//, 'https://') : rawUrl;
  const trackingNumber = String(order.orderNumber || '').trim();
  return {
    number: trackingNumber,
    url: trackingNumber ? `${appUrl}/t/${encodeURIComponent(trackingNumber)}` : '',
    company: 'Now Shipping',
  };
}

/**
 * Normalize raw sync result into API-friendly fulfillment payload.
 * @param {object} result
 * @param {string|number} [orderNumber]
 */
function formatFulfillmentApiResult(result, orderNumber) {
  const trackingNumber = orderNumber != null ? String(orderNumber) : '';
  if (result?.created) {
    return {
      synced: true,
      fulfillmentId: result.fulfillmentId || '',
      trackingNumber,
      reason: '',
      needsReconnect: false,
    };
  }
  if (result?.skipped && result.reason === 'already_synced') {
    return {
      synced: true,
      fulfillmentId: result.fulfillmentId || '',
      trackingNumber,
      reason: 'already_synced',
      needsReconnect: false,
    };
  }
  if (result?.skipped && result.reason === 'already_fulfilled_in_shopify') {
    return {
      synced: true,
      fulfillmentId: result.fulfillmentId || '',
      trackingNumber,
      reason: 'already_fulfilled_in_shopify',
      needsReconnect: false,
    };
  }
  const reason = result?.reason || result?.error || 'fulfillment_failed';
  return {
    synced: false,
    fulfillmentId: result?.fulfillmentId || '',
    trackingNumber,
    reason,
    needsReconnect: !!result?.needsReconnect || reason === 'missing_fulfillment_scopes',
  };
}

/**
 * Create a Shopify fulfillment with Now tracking for an imported order.
 * Idempotent: skips when externalFulfillmentId is set or Shopify order is already fulfilled.
 *
 * @param {{ installation: import('../models/shopifyInstallation'), order: import('../models/order') }} params
 * @returns {Promise<{ created?: boolean, skipped?: boolean, reason?: string, fulfillmentId?: string, error?: string, needsReconnect?: boolean, trackingNumber?: string }>}
 */
async function createFulfillmentWithTracking({ installation, order }) {
  const shopDomain = installation?.shopDomain;
  const shopifyOrderId = order?.externalOrderId != null ? String(order.externalOrderId) : '';
  const trackingNumber = order?.orderNumber != null ? String(order.orderNumber) : '';

  if (!installation || !order) {
    return { skipped: true, reason: 'missing_args', trackingNumber };
  }
  if (order.externalSource !== 'shopify' || !shopifyOrderId) {
    return { skipped: true, reason: 'not_shopify_order', trackingNumber };
  }
  if (order.externalFulfillmentId) {
    return {
      skipped: true,
      reason: 'already_synced',
      fulfillmentId: String(order.externalFulfillmentId),
      trackingNumber,
    };
  }

  const token = await getValidAccessToken(installation);

  const shopifyOrder = await shopifyRestGetOrder(shopDomain, token, shopifyOrderId);
  if (!shopifyOrder) {
    return { skipped: true, reason: 'shopify_order_not_found', trackingNumber };
  }
  if (shopifyOrder.fulfillment_status === 'fulfilled') {
    return { skipped: true, reason: 'already_fulfilled_in_shopify', trackingNumber };
  }

  const fulfillmentOrders = await getFulfillmentOrders(shopDomain, token, shopifyOrderId);
  const openFulfillmentOrders = fulfillmentOrders.filter((fo) =>
    OPEN_FULFILLMENT_ORDER_STATUSES.has(String(fo.status || '').toLowerCase())
  );

  if (!openFulfillmentOrders.length) {
    const reason =
      fulfillmentOrders.length === 0 ? 'missing_fulfillment_scopes' : 'no_open_fulfillment_orders';
    return {
      skipped: true,
      reason,
      needsReconnect: reason === 'missing_fulfillment_scopes',
      trackingNumber,
    };
  }

  const notifyCustomer = process.env.SHOPIFY_FULFILLMENT_NOTIFY_CUSTOMER === 'true';
  const trackingInfo = buildTrackingInfo(order);

  let lastErr;
  for (let attempt = 1; attempt <= FULFILLMENT_RETRY_ATTEMPTS; attempt += 1) {
    try {
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

      return { created: true, fulfillmentId, trackingNumber };
    } catch (err) {
      lastErr = err;
      if (attempt < FULFILLMENT_RETRY_ATTEMPTS && isRetryableShopifyError(err)) {
        await sleep(FULFILLMENT_RETRY_DELAY_MS * attempt);
        continue;
      }
      throw err;
    }
  }

  throw lastErr || new Error('fulfillment_create_failed');
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

    if (reason === 'missing_fulfillment_scopes') {
      console.error(
        `[Shopify fulfillment] shop=${shopDomain} shopify=${shopifyOrderName || shopifyOrderId} ` +
          'No fulfillment orders returned — reconnect store to grant fulfillment-order scopes.'
      );
    }

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

    return {
      skipped: false,
      error: msg,
      needsReconnect,
      trackingNumber: order.orderNumber != null ? String(order.orderNumber) : '',
    };
  }
}

module.exports = {
  getFulfillmentOrders,
  buildTrackingInfo,
  createFulfillmentWithTracking,
  syncFulfillmentAfterImport,
  formatFulfillmentApiResult,
};
