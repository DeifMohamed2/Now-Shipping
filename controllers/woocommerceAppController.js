const fs = require('fs');
const path = require('path');
const WoocommerceSyncLog = require('../models/woocommerceSyncLog');
const Order = require('../models/order');
const Pickup = require('../models/pickup');
const { wcRestGetOrder, wcRestListOrders, normalizeStoreUrl } = require('../utils/woocommerceService');
const { encryptToken } = require('../utils/shopifyTokenCrypto');
const { manualImportWcOrder } = require('../utils/woocommerceOrderSync');
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

function getSession(req, res) {
  return res.json({
    ok: true,
    storeUrl: req.wcInstallation.storeUrl,
  });
}

async function getStatus(req, res) {
  try {
    const inst = req.wcInstallation;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const statsAgg = await WoocommerceSyncLog.aggregate([
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
    const needsRestKeys = !inst.restKeyEncrypted || !inst.restSecretEncrypted;

    return res.json({
      connected: true,
      storeUrl: inst.storeUrl,
      isActive: inst.isActive !== false,
      lastWebhookAt: inst.lastWebhookAt || null,
      installedAt: inst.installedAt || null,
      needsRestKeys,
      syncStats,
      portalDashboardUrl: portals.dashboard,
      portalOrdersUrl: portals.orders,
      portalPickupsUrl: portals.pickups,
      portalSettingsUrl: portals.settings,
    });
  } catch (err) {
    console.error('[woocommerceApp] getStatus:', err.message || err);
    return res.status(500).json({ error: 'status_failed' });
  }
}

async function putToggleSync(req, res) {
  try {
    const inst = req.wcInstallation;
    const currentlyActive = inst.isActive !== false;
    inst.isActive = !currentlyActive;
    await inst.save();
    return res.json({
      ok: true,
      isActive: inst.isActive,
    });
  } catch (err) {
    console.error('[woocommerceApp] putToggleSync:', err.message || err);
    return res.status(500).json({ error: 'toggle_failed' });
  }
}

async function getSyncLogs(req, res) {
  try {
    const inst = req.wcInstallation;
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));
    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      WoocommerceSyncLog.find({ business: inst.business })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select(
          'storeUrl wcOrderId wcOrderNumber topic status reason nowOrderNumber retryCount createdAt'
        )
        .lean(),
      WoocommerceSyncLog.countDocuments({ business: inst.business }),
    ]);

    return res.json({
      logs,
      page,
      limit,
      total,
    });
  } catch (err) {
    console.error('[woocommerceApp] getSyncLogs:', err.message || err);
    return res.status(500).json({ error: 'sync_logs_failed' });
  }
}

async function getOrders(req, res) {
  try {
    const inst = req.wcInstallation;
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));
    const skip = (page - 1) * limit;

    const filter = { business: inst.business, externalSource: 'woocommerce' };

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
      wcRef: o.externalOrderNumber || o.externalOrderId || '',
    }));

    return res.json({
      orders: rows,
      page,
      limit,
      total,
      portals: portalLinks(),
    });
  } catch (err) {
    console.error('[woocommerceApp] getOrders:', err.message || err);
    return res.status(500).json({ error: 'orders_failed' });
  }
}

async function getPickups(req, res) {
  try {
    const inst = req.wcInstallation;
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
    console.error('[woocommerceApp] getPickups:', err.message || err);
    return res.status(500).json({ error: 'pickups_failed' });
  }
}

function mapWcOrderRow(o, nowMatch) {
  const ship = o.shipping && typeof o.shipping === 'object' ? o.shipping : {};
  const addrSummary = [ship.city, ship.state, ship.country].filter(Boolean).join(', ');
  const name = [ship.first_name, ship.last_name].filter(Boolean).join(' ').trim();
  return {
    id: String(o.id),
    name: `#${o.number != null ? o.number : o.id}`,
    created_at: o.date_created,
    financial_status: o.date_paid ? 'paid' : 'pending',
    fulfillment_status: o.status,
    cancelled_at: o.status === 'cancelled' ? o.date_modified : null,
    total_price: o.total,
    currency: o.currency,
    customerName: name,
    addressSummary: addrSummary,
    hasShippingAddress: !!(ship.address_1 && String(ship.address_1).trim()),
    shipping_address: {
      first_name: ship.first_name,
      last_name: ship.last_name,
      address1: ship.address_1,
      address2: ship.address_2,
      city: ship.city,
      province: ship.state,
      country: ship.country,
      country_code: ship.country,
      phone: ship.phone,
    },
    line_items_count: Array.isArray(o.line_items) ? o.line_items.length : 0,
    nowOrderNumber: nowMatch ? nowMatch.orderNumber : null,
    nowStatus: nowMatch ? nowMatch.orderStatus : null,
    nowZone: nowMatch && nowMatch.orderCustomer ? nowMatch.orderCustomer.zone : null,
  };
}

async function getWcOrders(req, res) {
  try {
    const inst = req.wcInstallation;
    if (!inst.restKeyEncrypted || !inst.restSecretEncrypted) {
      return res.json({
        orders: [],
        needsRestKeys: true,
        page: 1,
        message: 'Register WooCommerce REST API keys in the plugin settings.',
      });
    }

    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const { orders } = await wcRestListOrders(inst, { page, perPage: 50, status: 'any' });

    const withAddr = orders.filter((o) => {
      const s = o.shipping && typeof o.shipping === 'object' ? o.shipping : {};
      return !!(s.address_1 && String(s.address_1).trim());
    });

    const ids = withAddr.map((o) => String(o.id));
    let byExt = new Map();
    if (ids.length) {
      const matches = await Order.find({
        business: inst.business,
        externalSource: 'woocommerce',
        externalOrderId: { $in: ids },
      })
        .select('externalOrderId orderNumber orderStatus orderCustomer.zone')
        .lean();
      byExt = new Map(matches.map((m) => [String(m.externalOrderId), m]));
    }

    const rows = withAddr.map((o) => mapWcOrderRow(o, byExt.get(String(o.id))));

    return res.json({
      orders: rows,
      nextPage: orders.length >= 50 ? page + 1 : null,
      page,
    });
  } catch (err) {
    console.error('[woocommerceApp] getWcOrders:', err.message || err);
    return res.status(500).json({ error: 'wc_orders_failed', detail: err.message });
  }
}

async function getZones(req, res) {
  try {
    return res.json({ governorates: formatGovernoratesForApp() });
  } catch (err) {
    console.error('[woocommerceApp] getZones:', err.message || err);
    return res.status(500).json({ error: 'zones_failed' });
  }
}

async function postRestCredentials(req, res) {
  try {
    const inst = req.wcInstallation;
    const { consumer_key: consumerKey, consumer_secret: consumerSecret } = req.body || {};
    if (!consumerKey || !consumerSecret) {
      return res.status(400).json({ error: 'consumer_key_and_secret_required' });
    }
    inst.restKeyEncrypted = encryptToken(String(consumerKey).trim());
    inst.restSecretEncrypted = encryptToken(String(consumerSecret).trim());
    await inst.save();
    return res.json({ ok: true });
  } catch (err) {
    console.error('[woocommerceApp] postRestCredentials:', err.message || err);
    return res.status(500).json({ error: 'save_failed' });
  }
}

async function postImportOrder(req, res) {
  try {
    const inst = req.wcInstallation;
    const {
      wcOrderId,
      government,
      zone,
      fullName,
      phoneNumber,
      otherPhoneNumber,
      address,
    } = req.body || {};
    if (wcOrderId == null || wcOrderId === '') {
      return res.status(400).json({ error: 'wc_order_id_required' });
    }
    const orderPayload = await wcRestGetOrder(inst, wcOrderId);
    if (!orderPayload || !orderPayload.id) {
      return res.status(404).json({ error: 'wc_order_not_found' });
    }
    const body = req.body || {};
    const hasCustomerOverrideKeys =
      'fullName' in body || 'phoneNumber' in body || 'otherPhoneNumber' in body || 'address' in body;
    const customerOverrides = hasCustomerOverrideKeys
      ? { fullName, phoneNumber, otherPhoneNumber, address }
      : undefined;
    const result = await manualImportWcOrder(inst.storeUrl, orderPayload, {
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
    console.error('[woocommerceApp] postImportOrder:', err.message || err);
    return res.status(500).json({ error: 'import_failed', detail: err.message });
  }
}

async function postBulkImport(req, res) {
  try {
    const inst = req.wcInstallation;
    const { orders: batch } = req.body || {};
    if (!Array.isArray(batch) || !batch.length) {
      return res.status(400).json({ error: 'orders_array_required' });
    }
    const results = [];
    for (const row of batch.slice(0, 30)) {
      const wcOrderId = row && row.wcOrderId;
      const government = row && row.government;
      const zone = row && row.zone;
      if (wcOrderId == null || wcOrderId === '') {
        results.push({ wcOrderId: wcOrderId || '', ok: false, error: 'missing_id' });
        continue;
      }
      try {
        const orderPayload = await wcRestGetOrder(inst, wcOrderId);
        if (!orderPayload || !orderPayload.id) {
          results.push({ wcOrderId: String(wcOrderId), ok: false, error: 'wc_order_not_found' });
          continue;
        }
        const result = await manualImportWcOrder(inst.storeUrl, orderPayload, { government, zone });
        if (!result.ok) {
          results.push({ wcOrderId: String(wcOrderId), ok: false, error: result.error });
        } else {
          results.push({
            wcOrderId: String(wcOrderId),
            ok: true,
            orderNumber: result.orderNumber,
            orderId: result.orderId,
          });
        }
      } catch (e) {
        results.push({
          wcOrderId: String(wcOrderId),
          ok: false,
          error: e && e.message ? String(e.message) : 'import_error',
        });
      }
    }
    return res.json({ results });
  } catch (err) {
    console.error('[woocommerceApp] postBulkImport:', err.message || err);
    return res.status(500).json({ error: 'bulk_import_failed', detail: err.message });
  }
}

async function postPrintAwb(req, res) {
  try {
    const inst = req.wcInstallation;
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
    console.error('[woocommerceApp] postPrintAwb:', err.message || err);
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
  getWcOrders,
  getZones,
  postRestCredentials,
  postImportOrder,
  postBulkImport,
  postPrintAwb,
};
