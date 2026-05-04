import React, { useMemo } from 'react';
import { Provider } from '@shopify/app-bridge-react';

/**
 * Shopify Admin passes `host` (and optionally `shop`) in the iframe URL.
 * `VITE_SHOPIFY_API_KEY` must match SHOPIFY_API_KEY at build time (same as Partner Client ID).
 */
export function AppBridgeWrapper({ children }) {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const host = params.get('host') || '';
  const apiKey =
    import.meta.env.VITE_SHOPIFY_API_KEY || '';

  const config = useMemo(
    () => ({
      apiKey,
      host,
      forceRedirect: true,
    }),
    [apiKey, host]
  );

  if (!apiKey || !host) {
    return (
      <div style={{ padding: '1rem', fontFamily: 'system-ui' }}>
        <p>
          Open this app from <strong>Shopify Admin → Apps → Now Shipping</strong>.
        </p>
        <p style={{ color: '#666', fontSize: '0.9rem' }}>
          Missing <code>host</code> query parameter or <code>VITE_SHOPIFY_API_KEY</code> was not set
          when building this UI.
        </p>
      </div>
    );
  }

  return <Provider config={config}>{children}</Provider>;
}
