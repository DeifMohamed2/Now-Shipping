import { getSessionToken } from '@shopify/app-bridge/utilities';

/**
 * Authenticated fetch using App Bridge session token (same origin as the iframe).
 */
export async function authFetch(app, path, options = {}) {
  const token = await getSessionToken(app);
  const headers = {
    ...options.headers,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  const res = await fetch(path, { ...options, headers });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(body.error || res.statusText || 'request_failed');
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

/**
 * Authenticated fetch returning a Blob (e.g. PDF). Parses JSON only on error.
 */
export async function authFetchBlob(app, path, options = {}) {
  const token = await getSessionToken(app);
  const res = await fetch(path, {
    method: options.method || 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
    body: options.body != null ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text };
    }
    const err = new Error(body.error || body.detail || res.statusText || 'request_failed');
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return res.blob();
}
