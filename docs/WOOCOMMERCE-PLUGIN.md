# WooCommerce plugin — developer notes

## Local smoke test

1. Run the Now API (`npm start`) with `DATABASE_URL`, `JWT_SECRET`, `SHOPIFY_TOKEN_ENCRYPTION_KEY` (or rely on dev fallback).
2. Create a business user, open **Business → Settings → Integrations → WooCommerce**, click **Generate pairing code**.
3. Run WordPress + WooCommerce (e.g. `wp-env`, Local WP, or Docker). Install the ZIP from `public/downloads/now-shipping-for-woocommerce-1.0.0.zip` (build with `npm run build:woo-plugin`).
4. In WP: **WooCommerce → Now Shipping**, set **Now API base** to your public Now origin (production: `https://now.com.eg`; local dev: your tunnel URL with `APP_URL` matching), paste public code + secret, **Connect to Now**.
5. Save **REST consumer key/secret** (Read), click **Register REST keys on Now**, then use **Orders → (order) → Import to Now Shipping** after setting default governorate/zone in the plugin settings.
6. Place a test order with Egypt shipping; confirm `POST /api/woocommerce/webhooks` and a `WoocommerceSyncLog` row in MongoDB.

## Update manifest

Edit [public/woocommerce-plugin-latest.json](public/woocommerce-plugin-latest.json) (or set env `WOOCOMMERCE_PLUGIN_LATEST_JSON`). Production downloads use the WordPress.org ZIP URL (e.g. `https://downloads.wordpress.org/plugin/now-shipping-for-woocommerce.1.0.1.zip`). For local dev you can still build with `npm run build:woo-plugin` and install from `public/downloads/`.

## REST tracking endpoint

`POST /wp-json/now-shipping/v1/tracking` — JSON body `{"wc_order_id":123,"tracking_number":"..."}` with headers `X-Now-Signature` (hex HMAC-SHA256 of raw body) and `X-Now-Timestamp` (ms). The shared secret is the same as in plugin settings.
