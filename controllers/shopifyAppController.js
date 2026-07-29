const fs = require('fs');
const path = require('path');
const ShopifySyncLog = require('../models/shopifySyncLog');
const Order = require('../models/order');
const Pickup = require('../models/pickup');
const {
  getValidAccessToken,
  shopifyRestListOrders,
  shopifyRestGetOrder,
} = require('../utils/shopifyService');
const { manualImportShopifyOrder } = require('../utils/shopifyOrderSync');
const { syncFulfillmentAfterImport } = require('../utils/shopifyFulfillmentSync');
const { renderMergedDeliveryPolicyPdfBuffers } = require('../utils/deliveryPolicyPdf');

function appPublicBaseUrl() {
  const raw = process.env.APP_URL || process.env.HOST || 'https://now.com.eg';
  return String(raw).replace(/\/$/, '');
}

function portalLinks() {
  const b = appPublicBaseUrl();
  return {
    dashboard: `${b}/business/dashboard`,
    orders: `${b}/business/orders`,
    pickups: `${b}/business/pickups`,
    settings: `${b}/business/settings`,
  };
}

/**
 * GET /api/shopify/app/session — lightweight bootstrap; session token + installation only.
 */
function getSession(req, res) {
  return res.json({
    ok: true,
    shopDomain: req.shopifyShopDomain,
  });
}

/**
 * GET /api/shopify/app/status
 */
async function getStatus(req, res) {
  try {
    const inst = req.shopifyInstallation;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const statsAgg = await ShopifySyncLog.aggregate([
      {
        $match: {
          business: inst.business,
          createdAt: { $gte: since },
        },
      },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);

    const syncStats = { success: 0, skipped: 0, failed: 0 };
    for (const row of statsAgg) {
      if (row._id && syncStats[row._id] !== undefined) {
        syncStats[row._id] = row.count;
      }
    }

    const portals = portalLinks();
    return res.json({
      connected: true,
      shopDomain: inst.shopDomain,
      isActive: inst.isActive !== false,
      lastWebhookAt: inst.lastWebhookAt || null,
      installedAt: inst.installedAt || null,
      syncStats,
      portalDashboardUrl: portals.dashboard,
      portalOrdersUrl: portals.orders,
      portalPickupsUrl: portals.pickups,
      portalSettingsUrl: portals.settings,
    });
  } catch (err) {
    console.error('[shopifyApp] getStatus:', err.message || err);
    return res.status(500).json({ error: 'status_failed' });
  }
}

/**
 * PUT /api/shopify/app/toggle-sync — flip isActive (pause / resume imports)
 */
async function putToggleSync(req, res) {
  try {
    const inst = req.shopifyInstallation;
    const currentlyActive = inst.isActive !== false;
    inst.isActive = !currentlyActive;
    await inst.save();
    return res.json({
      ok: true,
      isActive: inst.isActive,
    });
  } catch (err) {
    console.error('[shopifyApp] putToggleSync:', err.message || err);
    return res.status(500).json({ error: 'toggle_failed' });
  }
}

/**
 * GET /api/shopify/app/sync-logs?page=1&limit=20
 */
async function getSyncLogs(req, res) {
  try {
    const inst = req.shopifyInstallation;
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));
    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      ShopifySyncLog.find({ business: inst.business })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select(
          'shopDomain shopifyOrderId shopifyOrderName topic status reason nowOrderNumber retryCount createdAt'
        )
        .lean(),
      ShopifySyncLog.countDocuments({ business: inst.business }),
    ]);

    return res.json({
      logs,
      page,
      limit,
      total,
    });
  } catch (err) {
    console.error('[shopifyApp] getSyncLogs:', err.message || err);
    return res.status(500).json({ error: 'sync_logs_failed' });
  }
}

/**
 * GET /api/shopify/app/orders — Shopify-imported orders for this installation’s business
 */
async function getOrders(req, res) {
  try {
    const inst = req.shopifyInstallation;
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));
    const skip = (page - 1) * limit;

    const filter = { business: inst.business, externalSource: 'shopify' };

    const [orders, total] = await Promise.all([
      Order.find(filter)
        .sort({ orderDate: -1 })
        .skip(skip)
        .limit(limit)
        .select(
          'orderNumber orderDate orderStatus orderCustomer.fullName orderCustomer.government orderCustomer.zone orderCustomer.address orderShipping.amountType orderShipping.amount externalOrderNumber externalOrderId orderShipping.isExpressShipping'
        )
        .lean(),
      Order.countDocuments(filter),
    ]);

    const rows = orders.map((o) => ({
      id: String(o._id),
      orderNumber: o.orderNumber,
      orderDate: o.orderDate,
      orderStatus: o.orderStatus,
      customerName: (o.orderCustomer && o.orderCustomer.fullName) || '',
      government: (o.orderCustomer && o.orderCustomer.government) || '',
      zone: (o.orderCustomer && o.orderCustomer.zone) || '',
      address: (o.orderCustomer && o.orderCustomer.address) || '',
      amountType: (o.orderShipping && o.orderShipping.amountType) || '',
      amount: o.orderShipping && o.orderShipping.amount != null ? o.orderShipping.amount : null,
      isExpressShipping: !!(o.orderShipping && o.orderShipping.isExpressShipping),
      shopifyRef: o.externalOrderNumber || o.externalOrderId || '',
    }));

    return res.json({
      orders: rows,
      page,
      limit,
      total,
      portals: portalLinks(),
    });
  } catch (err) {
    console.error('[shopifyApp] getOrders:', err.message || err);
    return res.status(500).json({ error: 'orders_failed' });
  }
}

/**
 * GET /api/shopify/app/pickups — pickups for this installation’s business
 */
async function getPickups(req, res) {
  try {
    const inst = req.shopifyInstallation;
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));
    const skip = (page - 1) * limit;

    const filter = { business: inst.business };

    const [pickups, total] = await Promise.all([
      Pickup.find(filter)
        .sort({ pickupDate: -1 })
        .skip(skip)
        .limit(limit)
        .select('pickupNumber pickupDate picikupStatus pickupLocation phoneNumber numberOfOrders')
        .lean(),
      Pickup.countDocuments(filter),
    ]);

    const rows = pickups.map((p) => ({
      id: String(p._id),
      pickupNumber: p.pickupNumber,
      pickupDate: p.pickupDate,
      status: p.picikupStatus,
      pickupLocation: p.pickupLocation || '',
      phoneNumber: p.phoneNumber,
      numberOfOrders: p.numberOfOrders,
    }));

    return res.json({
      pickups: rows,
      page,
      limit,
      total,
      portals: portalLinks(),
    });
  } catch (err) {
    console.error('[shopifyApp] getPickups:', err.message || err);
    return res.status(500).json({ error: 'pickups_failed' });
  }
}

let bostaRegionsCache;

function loadBostaRegionsJson() {
  if (!bostaRegionsCache) {
    const fp = path.join(__dirname, '..', 'public', 'assets', 'js', 'bosta-regions-data-processed.json');
    bostaRegionsCache = JSON.parse(fs.readFileSync(fp, 'utf8'));
  }
  return bostaRegionsCache;
}

function formatGovernoratesForApp() {
  const data = loadBostaRegionsJson();
  return Object.keys(data)
    .sort((a, b) => {
      const la = (data[a].label && data[a].label.en) || a;
      const lb = (data[b].label && data[b].label.en) || b;
      return la.localeCompare(lb);
    })
    .map((key) => {
      const g = data[key];
      return {
        key,
        label: (g.label && g.label.en) || key,
        areas: (g.areas || []).map((ar) => ({
          value: ar.value,
          labelEn: (ar.label && ar.label.en) || ar.value,
          labelAr: (ar.label && ar.label.ar) || '',
        })),
      };
    });
}

function mapShopifyOrderRow(o, nowMatch) {
  const addr = o.shipping_address;
  const addrSummary = addr
    ? [addr.city, addr.province || addr.country].filter(Boolean).join(', ')
    : '';
  const customer =
    o.customer && `${o.customer.first_name || ''} ${o.customer.last_name || ''}`.trim();
  const nameFromAddr =
    addr && [addr.first_name, addr.last_name].filter(Boolean).join(' ').trim();
  return {
    id: String(o.id),
    name: o.name,
    created_at: o.created_at,
    financial_status: o.financial_status,
    fulfillment_status: o.fulfillment_status || null,
    cancelled_at: o.cancelled_at || null,
    total_price: o.total_price,
    currency: o.currency,
    customerName: customer || nameFromAddr || '',
    addressSummary: addrSummary,
    hasShippingAddress: !!(addr && typeof addr === 'object' && Object.keys(addr).length),
    shipping_address: addr || null,
    line_items_count: Array.isArray(o.line_items) ? o.line_items.length : 0,
    nowOrderNumber: nowMatch ? nowMatch.orderNumber : null,
    nowStatus: nowMatch ? nowMatch.orderStatus : null,
    nowZone: nowMatch && nowMatch.orderCustomer ? nowMatch.orderCustomer.zone : null,
  };
}

/**
 * GET /api/shopify/app/shopify-orders
 */
async function getShopifyOrders(req, res) {
  try {
    const inst = req.shopifyInstallation;
    const token = await getValidAccessToken(inst);
    const cursor = req.query.cursor ? String(req.query.cursor) : '';
    const status = req.query.status ? String(req.query.status) : 'any';
    const q = req.query.q ? String(req.query.q).trim() : '';

    const { orders, nextCursor, prevCursor } = await shopifyRestListOrders(inst.shopDomain, token, {
      status,
      pageInfo: cursor || undefined,
      limit: 50,
      name: cursor ? undefined : q || undefined,
    });

    const withAddr = orders.filter(
      (o) => o.shipping_address && typeof o.shipping_address === 'object' && Object.keys(o.shipping_address).length
    );

    const ids = withAddr.map((o) => String(o.id));
    let byExt = new Map();
    if (ids.length) {
      const matches = await Order.find({
        business: inst.business,
        externalSource: 'shopify',
        externalOrderId: { $in: ids },
      })
        .select('externalOrderId orderNumber orderStatus orderCustomer.zone')
        .lean();
      byExt = new Map(matches.map((m) => [String(m.externalOrderId), m]));
    }

    const rows = withAddr.map((o) => mapShopifyOrderRow(o, byExt.get(String(o.id))));

    return res.json({
      orders: rows,
      nextCursor,
      prevCursor,
    });
  } catch (err) {
    console.error('[shopifyApp] getShopifyOrders:', err.message || err);
    return res.status(500).json({ error: 'shopify_orders_failed', detail: err.message });
  }
}

/**
 * GET /api/shopify/app/shopify-orders/by-ids?ids=1,2,3
 * Fetch specific Shopify orders (used by admin link deep links from native Orders page).
 */
async function getShopifyOrdersByIds(req, res) {
  try {
    const inst = req.shopifyInstallation;
    const rawIds = req.query.ids ? String(req.query.ids) : '';
    const idList = rawIds
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 30);

    if (!idList.length) {
      return res.status(400).json({ error: 'ids_required' });
    }

    const token = await getValidAccessToken(inst);
    const fetched = await Promise.all(
      idList.map(async (id) => {
        try {
          return await shopifyRestGetOrder(inst.shopDomain, token, id);
        } catch (e) {
          console.warn('[shopifyApp] getShopifyOrdersByIds fetch failed:', id, e.message || e);
          return null;
        }
      })
    );

    const orders = fetched.filter(Boolean);
    const withAddr = orders.filter(
      (o) => o.shipping_address && typeof o.shipping_address === 'object' && Object.keys(o.shipping_address).length
    );

    const extIds = withAddr.map((o) => String(o.id));
    let byExt = new Map();
    if (extIds.length) {
      const matches = await Order.find({
        business: inst.business,
        externalSource: 'shopify',
        externalOrderId: { $in: extIds },
      })
        .select('externalOrderId orderNumber orderStatus orderCustomer.zone')
        .lean();
      byExt = new Map(matches.map((m) => [String(m.externalOrderId), m]));
    }

    const rows = withAddr.map((o) => mapShopifyOrderRow(o, byExt.get(String(o.id))));
    const missingIds = idList.filter((id) => !orders.some((o) => String(o.id) === String(id)));

    return res.json({
      orders: rows,
      requestedIds: idList,
      missingIds,
    });
  } catch (err) {
    console.error('[shopifyApp] getShopifyOrdersByIds:', err.message || err);
    return res.status(500).json({ error: 'shopify_orders_by_ids_failed', detail: err.message });
  }
}

/**
 * GET /api/shopify/app/zones
 */
async function getZones(req, res) {
  try {
    return res.json({ governorates: formatGovernoratesForApp() });
  } catch (err) {
    console.error('[shopifyApp] getZones:', err.message || err);
    return res.status(500).json({ error: 'zones_failed' });
  }
}

/**
 * POST /api/shopify/app/import-order
 */
async function postImportOrder(req, res) {
  try {
    const inst = req.shopifyInstallation;
    const {
      shopifyOrderId,
      government,
      zone,
      fullName,
      phoneNumber,
      otherPhoneNumber,
      address,
    } = req.body || {};
    if (shopifyOrderId == null || shopifyOrderId === '') {
      return res.status(400).json({ error: 'shopify_order_id_required' });
    }
    const token = await getValidAccessToken(inst);
    const orderPayload = await shopifyRestGetOrder(inst.shopDomain, token, shopifyOrderId);
    if (!orderPayload) {
      return res.status(404).json({ error: 'shopify_order_not_found' });
    }
    const body = req.body || {};
    const hasCustomerOverrideKeys =
      'fullName' in body || 'phoneNumber' in body || 'otherPhoneNumber' in body || 'address' in body;
    const customerOverrides = hasCustomerOverrideKeys
      ? { fullName, phoneNumber, otherPhoneNumber, address }
      : undefined;
    const result = await manualImportShopifyOrder(inst.shopDomain, orderPayload, {
      government,
      zone,
      customerOverrides,
    });
    if (!result.ok) {
      const code = result.error === 'duplicate' || result.error === 'duplicate_race' ? 409 : 400;
      return res.status(code).json({ ok: false, error: result.error });
    }
    return res.json({ ok: true, orderNumber: result.orderNumber, orderId: result.orderId });
  } catch (err) {
    console.error('[shopifyApp] postImportOrder:', err.message || err);
    return res.status(500).json({ error: 'import_failed', detail: err.message });
  }
}

/**
 * POST /api/shopify/app/bulk-import
 */
async function postBulkImport(req, res) {
  try {
    const inst = req.shopifyInstallation;
    const { orders: batch } = req.body || {};
    if (!Array.isArray(batch) || !batch.length) {
      return res.status(400).json({ error: 'orders_array_required' });
    }
    const token = await getValidAccessToken(inst);
    const results = [];
    for (const row of batch.slice(0, 30)) {
      const shopifyOrderId = row && row.shopifyOrderId;
      const government = row && row.government;
      const zone = row && row.zone;
      if (shopifyOrderId == null || shopifyOrderId === '') {
        results.push({ shopifyOrderId: shopifyOrderId || '', ok: false, error: 'missing_id' });
        continue;
      }
      try {
        const orderPayload = await shopifyRestGetOrder(inst.shopDomain, token, shopifyOrderId);
        if (!orderPayload) {
          results.push({ shopifyOrderId: String(shopifyOrderId), ok: false, error: 'shopify_order_not_found' });
          continue;
        }
        const result = await manualImportShopifyOrder(inst.shopDomain, orderPayload, { government, zone });
        if (!result.ok) {
          results.push({ shopifyOrderId: String(shopifyOrderId), ok: false, error: result.error });
        } else {
          results.push({
            shopifyOrderId: String(shopifyOrderId),
            ok: true,
            orderNumber: result.orderNumber,
            orderId: result.orderId,
          });
        }
      } catch (e) {
        results.push({
          shopifyOrderId: String(shopifyOrderId),
          ok: false,
          error: e && e.message ? String(e.message) : 'import_error',
        });
      }
    }
    return res.json({ results });
  } catch (err) {
    console.error('[shopifyApp] postBulkImport:', err.message || err);
    return res.status(500).json({ error: 'bulk_import_failed', detail: err.message });
  }
}

/**
 * POST /api/shopify/app/sync-fulfillment
 * Backfill Shopify fulfillment + tracking for an already-imported order.
 */
async function postSyncFulfillment(req, res) {
  try {
    const inst = req.shopifyInstallation;
    const { shopifyOrderId, orderNumber } = req.body || {};

    const filter = { business: inst.business, externalSource: 'shopify' };
    if (orderNumber != null && String(orderNumber).trim()) {
      filter.orderNumber = String(orderNumber).trim();
    } else if (shopifyOrderId != null && String(shopifyOrderId).trim()) {
      filter.externalOrderId = String(shopifyOrderId).trim();
    } else {
      return res.status(400).json({ error: 'shopify_order_id_or_order_number_required' });
    }

    const order = await Order.findOne(filter);
    if (!order) {
      return res.status(404).json({ error: 'order_not_found' });
    }

    const result = await syncFulfillmentAfterImport({ installation: inst, order });
    const ok = !!result.created || (result.skipped && result.reason !== 'missing_args');

    return res.json({
      ok,
      orderNumber: order.orderNumber,
      shopifyOrderId: order.externalOrderId,
      result,
    });
  } catch (err) {
    console.error('[shopifyApp] postSyncFulfillment:', err.message || err);
    return res.status(500).json({ error: 'sync_fulfillment_failed', detail: err.message });
  }
}

/**
 * POST /api/shopify/app/bulk-sync-fulfillment
 * Backfill Shopify fulfillment + tracking for multiple already-imported orders.
 */
async function postBulkSyncFulfillment(req, res) {
  try {
    const inst = req.shopifyInstallation;
    const { shopifyOrderIds } = req.body || {};
    if (!Array.isArray(shopifyOrderIds) || !shopifyOrderIds.length) {
      return res.status(400).json({ error: 'shopify_order_ids_required' });
    }

    const ids = shopifyOrderIds.map((id) => String(id).trim()).filter(Boolean).slice(0, 30);
    const results = [];

    for (const shopifyOrderId of ids) {
      try {
        const order = await Order.findOne({
          business: inst.business,
          externalSource: 'shopify',
          externalOrderId: shopifyOrderId,
        });
        if (!order) {
          results.push({ shopifyOrderId, ok: false, error: 'order_not_found' });
          continue;
        }
        const result = await syncFulfillmentAfterImport({ installation: inst, order });
        const ok = !!result.created || (result.skipped && result.reason !== 'missing_args');
        results.push({
          shopifyOrderId,
          ok,
          orderNumber: order.orderNumber,
          result,
        });
      } catch (e) {
        results.push({
          shopifyOrderId,
          ok: false,
          error: e && e.message ? String(e.message) : 'sync_error',
        });
      }
    }

    return res.json({ results });
  } catch (err) {
    console.error('[shopifyApp] postBulkSyncFulfillment:', err.message || err);
    return res.status(500).json({ error: 'bulk_sync_fulfillment_failed', detail: err.message });
  }
}

/**
 * POST /api/shopify/app/print-awb
 */
async function postPrintAwb(req, res) {
  try {
    const inst = req.shopifyInstallation;
    const { orderNumbers, paperSize } = req.body || {};
    if (!Array.isArray(orderNumbers) || !orderNumbers.length) {
      return res.status(400).json({ error: 'order_numbers_required' });
    }
    const nums = orderNumbers.map((n) => String(n).trim()).filter(Boolean).slice(0, 50);
    const found = await Order.find({
      business: inst.business,
      orderNumber: { $in: nums },
    }).populate('business');

    const byNum = new Map(found.map((o) => [o.orderNumber, o]));
    const missing = nums.filter((n) => !byNum.has(n));
    if (missing.length) {
      return res.status(400).json({ error: 'some_orders_not_found', missing });
    }
    const ordered = nums.map((n) => byNum.get(n));

    const buf = await renderMergedDeliveryPolicyPdfBuffers(ordered, paperSize || 'A4');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="now-awb-batch.pdf"');
    res.setHeader('Content-Length', buf.length);
    res.setHeader('Cache-Control', 'no-cache');
    return res.end(buf, 'binary');
  } catch (err) {
    console.error('[shopifyApp] postPrintAwb:', err.message || err);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'print_awb_failed', detail: err.message });
    }
  }
}

module.exports = {
  getSession,
  getStatus,
  putToggleSync,
  getSyncLogs,
  getOrders,
  getPickups,
  getShopifyOrders,
  getShopifyOrdersByIds,
  getZones,
  postImportOrder,
  postBulkImport,
  postSyncFulfillment,
  postBulkSyncFulfillment,
  postPrintAwb,
};
