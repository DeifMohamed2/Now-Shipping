/**
 * Preserve Shopify iframe params (host, shop) when navigating inside the embedded app.
 */
export function buildShopifyAppNavigateUrl(path, extraParams = {}) {
  const params = new URLSearchParams(window.location.search);
  params.delete('from');

  for (const [key, value] of Object.entries(extraParams)) {
    if (value == null || value === '') {
      params.delete(key);
    } else {
      params.set(key, String(value));
    }
  }

  const qs = params.toString();
  const base = path.startsWith('/') ? path : `/${path}`;
  return qs ? `${base}?${qs}` : base;
}
