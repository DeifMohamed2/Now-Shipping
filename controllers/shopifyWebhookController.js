const { verifyWebhookRequest } = require('../utils/shopifyService');
const {
  syncOrderUpdated,
  markAppUninstalled,
  markShopDataRedacted,
} = require('../utils/shopifyOrderSync');

/**
 * POST /api/shopify/webhooks — raw body required (mounted before express.json).
 */
async function handleWebhook(req, res) {
  const rawBody = req.body;
  if (!Buffer.isBuffer(rawBody)) {
    return res.status(400).send('Expected raw body');
  }
  if (!(await verifyWebhookRequest(req))) {
    return res.status(401).send('Invalid HMAC');
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).send('Invalid JSON');
  }

  const shopDomain = (req.get('X-Shopify-Shop-Domain') || '').toLowerCase().trim();
  const topic = req.get('X-Shopify-Topic') || '';

  try {
    if (topic === 'orders/create') {
      // Manual import only — embedded app "Deliver with Now". No auto-create in Now.
      console.log(
        `[Shopify webhook] orders/create shop=${shopDomain} order=${payload?.name || payload?.id || ''} skipped (manual import only)`
      );
    } else if (topic === 'orders/updated') {
      await syncOrderUpdated(shopDomain, payload);
    } else if (topic === 'app/uninstalled') {
      await markAppUninstalled(shopDomain);
    } else if (topic === 'customers/data_request') {
      const dr = payload?.data_request?.id;
      const custId = payload?.customer?.id;
      const orderCount = Array.isArray(payload?.orders_requested) ? payload.orders_requested.length : 0;
      console.log(
        `[Shopify webhook] customers/data_request shop=${shopDomain} shop_id=${payload?.shop_id} ` +
          `data_request_id=${dr} customer_id=${custId} orders_requested=${orderCount} (merchant must be given any stored customer-related data within 30 days)`
      );
    } else if (topic === 'customers/redact') {
      const custId = payload?.customer?.id;
      const orderCount = Array.isArray(payload?.orders_to_redact) ? payload.orders_to_redact.length : 0;
      console.log(
        `[Shopify webhook] customers/redact shop=${shopDomain} shop_id=${payload?.shop_id} ` +
          `customer_id=${custId} orders_to_redact_count=${orderCount} (complete redaction within 30 days unless legally required to retain)`
      );
    } else if (topic === 'shop/redact') {
      await markShopDataRedacted(shopDomain, payload?.shop_id);
    }
  } catch (err) {
    console.error('[Shopify webhook]', topic, err);
    return res.status(500).send('Handler error');
  }

  res.status(200).send('OK');
}

module.exports = { handleWebhook };
