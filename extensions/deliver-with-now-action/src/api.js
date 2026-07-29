const API_BASE = 'https://now.com.eg/api/shopify/app';

export function normalizeOrderId(id) {
  const s = String(id || '');
  const m = /(\d+)\s*$/.exec(s);
  return m ? m[1] : s;
}

export function selectedOrderIds(data) {
  const selected = data?.selected || [];
  const ids = [];
  for (const item of selected) {
    const raw = typeof item === 'string' ? item : item?.id;
    if (!raw) continue;
    ids.push(normalizeOrderId(raw));
  }
  return [...new Set(ids.filter(Boolean))];
}

export async function extensionFetch(path, options = {}) {
  const token = await shopify.auth.idToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    body: options.body != null ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(body.error || body.detail || res.statusText || 'request_failed');
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

export function orderStatus(row) {
  if (!row) return 'unknown';
  if (!row.hasShippingAddress) return 'no_address';
  if (!row.nowOrderNumber) return 'ready_import';
  if (row.fulfillment_status !== 'fulfilled') return 'in_now';
  return 'complete';
}
