/**
 * Map WooCommerce REST API order JSON to a Shopify-shaped payload so we can reuse
 * shopifyOrderMapper (EG rules, payment heuristics, address mapping).
 */

function wcCountryToCode(country) {
  const c = String(country || '').trim().toUpperCase();
  if (c === 'EG' || c === 'EGY' || c === 'EGYPT') return 'EG';
  return c.slice(0, 2);
}

/**
 * @param {object} wc - WooCommerce REST order object
 * @returns {object} shopify-like order payload
 */
function wcOrderToShopifyLike(wc) {
  if (!wc || typeof wc !== 'object') return {};
  const ship = wc.shipping && typeof wc.shipping === 'object' ? wc.shipping : {};
  const bill = wc.billing && typeof wc.billing === 'object' ? wc.billing : {};
  const phone = String(ship.phone || bill.phone || '').trim();
  const lineItems = Array.isArray(wc.line_items)
    ? wc.line_items.map((li) => ({
        name: li.name || 'Item',
        quantity: parseInt(li.quantity, 10) || 1,
        requires_shipping: li.virtual === true ? false : true,
      }))
    : [];

  const shippingLines = Array.isArray(wc.shipping_lines)
    ? wc.shipping_lines.map((sl) => ({
        title: sl.method_title || sl.method_id || '',
        code: sl.method_id || '',
      }))
    : [];

  const paymentGateways = [];
  if (wc.payment_method) paymentGateways.push(String(wc.payment_method).toLowerCase());
  if (wc.payment_method_title) paymentGateways.push(String(wc.payment_method_title).toLowerCase());

  const datePaid = wc.date_paid;
  const financialStatus = datePaid ? 'paid' : 'pending';

  const country = wcCountryToCode(ship.country);
  const province = String(ship.state || '').trim();

  return {
    id: wc.id,
    name: `#${wc.number != null ? wc.number : wc.id}`,
    cancelled_at: wc.status === 'cancelled' ? wc.date_modified || new Date().toISOString() : null,
    financial_status: financialStatus,
    total_price: wc.total != null ? String(wc.total) : '0',
    total_outstanding: financialStatus === 'paid' ? '0' : String(wc.total != null ? wc.total : '0'),
    payment_gateway_names: paymentGateways,
    phone,
    tags: (Array.isArray(wc.meta_data) && wc.meta_data.find((m) => m && m.key === '_order_tags')) || '',
    line_items: lineItems,
    shipping_lines: shippingLines,
    shipping_address: {
      first_name: ship.first_name || bill.first_name || '',
      last_name: ship.last_name || bill.last_name || '',
      address1: ship.address_1 || '',
      address2: ship.address_2 || '',
      city: ship.city || '',
      province,
      country,
      country_code: country,
      phone,
    },
    customer: {
      first_name: bill.first_name || '',
      last_name: bill.last_name || '',
      phone: bill.phone || '',
    },
  };
}

module.exports = { wcOrderToShopifyLike, wcCountryToCode };
