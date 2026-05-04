/**
 * Shopify REST Admin order payload → Now normalized fields (Deliver only).
 */
const { mapShopifyShippingToNowGovernorateZone } = require('./shopifyAddressMap');

function normalizeEgPhone(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.startsWith('0020')) d = d.slice(4);
  else if (d.startsWith('20') && d.length >= 12) d = d.slice(2);
  if (d.length === 9 && /^1/.test(d)) d = `0${d}`;
  if (d.length === 10 && /^1/.test(d)) d = `0${d}`;
  return d.slice(0, 15);
}

function lineItemsRequireShipping(lineItems) {
  if (!Array.isArray(lineItems) || lineItems.length === 0) return false;
  return lineItems.some((li) => li && (li.requires_shipping === undefined || li.requires_shipping === true));
}

/**
 * True when Shopify has a real Egypt street on the order (checkout collected a deliverable address).
 * Used to allow import when items are mis-flagged as "does not require shipping" or when there are
 * no shipping_lines (common for free-shipping / flat-rate setups).
 */
function hasEgyptStreetShipping(addr) {
  if (!addr || typeof addr !== 'object') return false;
  const country = String(addr.country_code || addr.country || '').toUpperCase();
  if (country && country !== 'EG' && country !== 'EGY') return false;
  const street = String(addr.address1 || '').trim();
  return street.length >= 3;
}

/**
 * Heuristic: COD amount from Shopify order.
 */
function derivePayment(fieldsFromShopify) {
  const order = fieldsFromShopify;
  const gateways = Array.isArray(order.payment_gateway_names)
    ? order.payment_gateway_names.map((g) => String(g).toLowerCase())
    : [];
  const codish =
    gateways.some((g) => g.includes('cash') || g.includes('cod') || g.includes('delivery')) ||
    order.financial_status === 'pending';

  const paid =
    order.financial_status === 'paid' ||
    order.financial_status === 'partially_paid' ||
    (Number(order.total_outstanding) === 0 && order.financial_status === 'authorized');

  if (paid && !codish) {
    return { COD: false, amountCOD: null, amountType: 'NA' };
  }
  if (codish) {
    const total = parseFloat(order.total_price) || 0;
    return { COD: true, amountCOD: total, amountType: 'COD' };
  }
  return { COD: true, amountCOD: parseFloat(order.total_price) || 0, amountType: 'COD' };
}

function shippingLinesText(order) {
  const lines = order.shipping_lines;
  if (!Array.isArray(lines) || !lines.length) return '';
  return lines
    .map((l) => [l.title, l.code].filter(Boolean).join(' '))
    .join(' | ');
}

function isExpressShipping(order, patterns) {
  const hay = `${shippingLinesText(order)} ${order.tags || ''}`.toLowerCase();
  const list = Array.isArray(patterns) && patterns.length ? patterns : ['express', 'سريع', 'fast'];
  return list.some((p) => p && hay.includes(String(p).toLowerCase()));
}

/**
 * Whether this order should become a Now Deliver order (excludes pickup-only / non-shipping).
 */
function shouldImportDeliverOrder(orderPayload) {
  if (!orderPayload || typeof orderPayload !== 'object') return { ok: false, reason: 'invalid_payload' };
  if (orderPayload.cancelled_at) return { ok: false, reason: 'cancelled' };
  if (!orderPayload.shipping_address || typeof orderPayload.shipping_address !== 'object') {
    return { ok: false, reason: 'no_shipping_address' };
  }
  const addr = orderPayload.shipping_address;
  const deliverableEg = hasEgyptStreetShipping(addr);

  if (!lineItemsRequireShipping(orderPayload.line_items || [])) {
    if (!deliverableEg) {
      return { ok: false, reason: 'no_shippable_items' };
    }
  }

  const country = String(addr.country_code || addr.country || '').toUpperCase();
  if (country && country !== 'EG' && country !== 'EGY') {
    return { ok: false, reason: 'non_egypt_shipping' };
  }

  const shipLines = orderPayload.shipping_lines;
  if (!Array.isArray(shipLines) || shipLines.length === 0) {
    if (!deliverableEg) {
      return { ok: false, reason: 'no_shipping_lines' };
    }
  }

  return { ok: true };
}

/**
 * Build normalized body compatible with normalizeFieldsFromBody + validateOrderFieldsStructural (Deliver).
 */
function shopifyOrderToNormalizedFields(orderPayload, installation) {
  const addr = orderPayload.shipping_address;
  const name =
    `${addr.first_name || ''} ${addr.last_name || ''}`.trim() ||
    addr.name ||
    'Customer';
  const phoneRaw = addr.phone || orderPayload.phone || orderPayload.customer?.phone || '';
  let phone = normalizeEgPhone(phoneRaw);
  if (phone.length < 10) phone = '01000000000';

  const street = [addr.address1, addr.address2].filter(Boolean).join(', ') || 'Address pending';

  const { government, zone } = mapShopifyShippingToNowGovernorateZone(addr);

  const expressPatterns = installation?.expressShippingPatterns;
  let isExpress = isExpressShipping(orderPayload, expressPatterns);

  const lines = Array.isArray(orderPayload.line_items) ? orderPayload.line_items : [];
  const desc = lines
    .map((l) => `${l.name || 'Item'} × ${l.quantity || 1}`)
    .join('; ')
    .slice(0, 2000);
  const numItems = lines.reduce((sum, l) => sum + (parseInt(l.quantity, 10) || 1), 0) || 1;

  const pay = derivePayment(orderPayload);

  return {
    fullName: name.slice(0, 200),
    phoneNumber: phone,
    otherPhoneNumber: null,
    address: street.slice(0, 500),
    government,
    zone: String(zone).slice(0, 200),
    deliverToWorkAddress: false,
    orderType: 'Deliver',
    productDescription: desc || 'Shopify order',
    numberOfItems: numItems,
    currentPD: null,
    numberOfItemsCurrentPD: null,
    newPD: null,
    numberOfItemsNewPD: null,
    COD: pay.COD,
    amountCOD: pay.amountCOD,
    CashDifference: false,
    amountCashDifference: null,
    previewPermission: false,
    referralNumber: '',
    Notes: '',
    isExpressShipping: isExpress,
    selectedPickupAddressId: null,
    originalOrderNumber: null,
    returnReason: null,
    returnNotes: null,
    isPartialReturn: false,
    originalOrderItemCount: null,
    partialReturnItemCount: null,
    _shopifyOrderNumber: orderPayload.name || '',
    _shopifyNote:
      `Shopify ${orderPayload.name || ''} — financial_status: ${orderPayload.financial_status || ''}. ` +
      `Mapped: government=${government}, zone=${zone} (Shopify city: ${addr.city || '-'}, province: ${addr.province || '-'})`,
  };
}

module.exports = {
  shouldImportDeliverOrder,
  shopifyOrderToNormalizedFields,
  normalizeEgPhone,
  derivePayment,
  isExpressShipping,
  hasEgyptStreetShipping,
};
