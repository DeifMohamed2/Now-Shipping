/** Parse Shopify admin link query params (ids[]=123&ids[]=456). */
export function parseAdminLinkOrderIds(search = window.location.search) {
  const params = new URLSearchParams(search);
  const ids = new Set();
  for (const [key, value] of params.entries()) {
    if (
      value &&
      (key === 'ids' ||
        key === 'ids[]' ||
        key === 'orderIds' ||
        key === 'orderIds[]' ||
        key.startsWith('ids['))
    ) {
      ids.add(String(value));
    }
  }
  return Array.from(ids);
}

export function needsShopifyFulfillmentSync(row) {
  return !!row?.nowOrderNumber && row.fulfillment_status !== 'fulfilled';
}

export function orderDeliverStatus(row) {
  if (!row) return 'unknown';
  if (!row.hasShippingAddress) return 'no_address';
  if (!row.nowOrderNumber) return 'ready_import';
  if (needsShopifyFulfillmentSync(row)) return 'needs_sync';
  return 'complete';
}
