# WooCommerce plugin — developer notes

## Automated E2E test (no WordPress required)

Run the full integration regression against real server modules:

```bash
node scripts/test-woocommerce-e2e.js
```

Requires `DATABASE_URL` (or `MONGODB_URI`) and `JWT_SECRET` in `.env`. The script seeds a test business, then verifies:

1. Pairing code generation (`nsw_…` public code, 24h expiry)
2. Plugin connect (`POST /api/woocommerce/connect`)
3. Bearer + HMAC auth (valid / tampered / stale timestamp)
4. Order create webhook → Now `Order` + `WoocommerceSyncLog`
5. Duplicate and non-Egypt orders skipped safely
6. Cancel webhook (only early-stage orders)
7. Uninstall webhook revokes installation

Exits with code `1` on any failure. Cleans up all test data it creates.

## Manual end-to-end test checklist

### A. Generate pairing code (Now dashboard)

1. Log in as a **business** user.
2. Go to **Business → Settings**.
3. Click the **Integrations** tab (chain-link icon in the left tab bar — not Profile, not Preferences).
4. Scroll to the **WooCommerce** card (below Shopify).
5. Click **Generate pairing code**.
6. Copy the **public code** (`nsw_…`) and **secret** immediately — the secret is shown only once and expires in 24 hours.
7. Optional: click **Download plugin** to get the ZIP (or install from [WordPress.org](https://wordpress.org/plugins/now-shipping-for-woocommerce/)).

> If you do not see the Integrations tab or WooCommerce card, the server may be running an older build — deploy the latest code that includes the WooCommerce integration.

### B. Install and connect (WordPress)

1. Install **WooCommerce** and activate it.
2. Install **Now Shipping for WooCommerce** (ZIP from `npm run build:woo-plugin` → `public/downloads/now-shipping-for-woocommerce-1.0.1.zip`, or WordPress.org).
3. In WP admin: **WooCommerce → Now Shipping**.
4. Set **Now API base** to `https://now.com.eg` (or your dev/tunnel URL; must match `APP_URL` on the Node app).
5. Paste **public code**, **pairing secret**, and confirm **store URL**.
6. Click **Connect to Now** — you should see “Connected to Now Shipping.”

### C. REST keys (optional, for listing WC orders in plugin)

1. In WooCommerce: **Settings → Advanced → REST API** → Add key (Read permission).
2. In **WooCommerce → Now Shipping → Manual credentials**, paste consumer key + secret → **Save settings**.
3. Click **Register REST keys on Now**.

### D. Test order sync

**Automatic sync (webhook):**

1. Place a test order on the store with **Egypt shipping** (street address, phone, shippable product).
2. In WP plugin settings, check **Sync logs** — expect `orders/create` with status `success` and a Now order number.
3. In Now dashboard: **Business → Orders** — confirm the order appears with source WooCommerce.

**Manual import:**

1. Set **default governorate** and **zone** in plugin settings (e.g. `cairo` / Bosta area value).
2. In WP: **Orders → (order) → Actions → Import to Now Shipping**.

### E. Test cancel

1. Cancel the WooCommerce order in WP admin.
2. Sync log should show `orders/updated`.
3. If the Now order was still `new` or `pendingPickup`, it becomes `canceled` in Now.

### F. Disconnect

- **From Now:** Settings → Integrations → WooCommerce → **Disconnect WooCommerce**
- **From WP:** Deactivating/deleting the plugin notifies Now via `app/uninstalled` webhook

## Local smoke test (developer)

1. Run the Now API (`npm start`) with `DATABASE_URL`, `JWT_SECRET`, `SHOPIFY_TOKEN_ENCRYPTION_KEY` (or rely on dev fallback).
2. Create a business user, open **Business → Settings → Integrations**, click **Generate pairing code** in the WooCommerce card.
3. Run WordPress + WooCommerce (e.g. `wp-env`, Local WP, or Docker). Install the ZIP from `public/downloads/now-shipping-for-woocommerce-1.0.1.zip` (build with `npm run build:woo-plugin`).
4. In WP: **WooCommerce → Now Shipping**, set **Now API base** to your public Now origin (production: `https://now.com.eg`; local dev: your tunnel URL with `APP_URL` matching), paste public code + secret, **Connect to Now**.
5. Save **REST consumer key/secret** (Read), click **Register REST keys on Now**, then use **Orders → (order) → Import to Now Shipping** after setting default governorate/zone in the plugin settings.
6. Place a test order with Egypt shipping; confirm `POST /api/woocommerce/webhooks` and a `WoocommerceSyncLog` row in MongoDB.
7. Run `node scripts/test-woocommerce-e2e.js` for automated regression.

## Update manifest

Edit [public/woocommerce-plugin-latest.json](public/woocommerce-plugin-latest.json) (or set env `WOOCOMMERCE_PLUGIN_LATEST_JSON`). Production downloads use the WordPress.org ZIP URL (e.g. `https://downloads.wordpress.org/plugin/now-shipping-for-woocommerce.1.0.1.zip`). For local dev you can still build with `npm run build:woo-plugin` and install from `public/downloads/`.

## REST tracking endpoint

`POST /wp-json/now-shipping/v1/tracking` — JSON body `{"wc_order_id":123,"tracking_number":"..."}` with headers `X-Now-Signature` (hex HMAC-SHA256 of raw body) and `X-Now-Timestamp` (ms). The shared secret is the same as in plugin settings.
