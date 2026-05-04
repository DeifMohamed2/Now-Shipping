# Production deploy checklist

## Runtime

- Use **Node.js 18+** (see `engines` in root `package.json`).
- Install dependencies with **`npm ci`** using the committed **`package-lock.json`** (same revision as `package.json`). Avoid `npm install` on the server unless you intend to change the lockfile.

## Environment

- Set **`APP_URL=https://now.com.eg`** (no trailing slash) on the public server. This must match **`shopify.app.toml`** webhook and OAuth URLs; [`utils/shopifyService.js`](../utils/shopifyService.js) uses it to register REST webhooks after install. If unset in production, the app falls back to `https://now.com.eg` and logs a warning.
- Copy **`.env`** from `.env.example` / your secrets manager; never commit real secrets.
- For Shopify token encryption at rest, prefer **`SHOPIFY_TOKEN_ENCRYPTION_KEY`** (64 hex chars).

## Shopify webhooks (404 / ngrok in Partner logs)

- Partner **Versions** should show webhook URIs like **`https://now.com.eg/api/shopify/webhooks`** (same path as `shopify.app.toml`).
- Old deliveries to **ngrok** happen when a tunnel URL was deployed earlier or duplicate subscriptions exist. Fix: ensure **`APP_URL`** is correct, run **`shopify app deploy`**, then **disconnect/reconnect** the app on the dev store so registrations refresh. Remove stale webhook subscriptions in **Settings → Notifications → Webhooks** on the shop only if you maintain legacy REST duplicates (prefer fixing app config + reinstall).

## Dependency overrides

- **`uuid`** is pinned via **`overrides`** in `package.json` so **ExcelJS** can use `require('uuid')` (CommonJS). Changing `uuid` without testing can restore **`ERR_REQUIRE_ESM`**. After changes run:

  ```bash
  npm run smoke:deps
  ```

## Shopify embedded UI (`shopify-admin-ui`)

- Build with **`VITE_SHOPIFY_API_KEY`** matching **`SHOPIFY_API_KEY`** (Partner app Client ID):

  ```bash
  export VITE_SHOPIFY_API_KEY="your-key"
  npm run build:shopify-ui
  ```

## OAuth troubleshooting

- On Shopify connect failures, server logs now print **full stack traces** for `/api/shopify/auth/callback` errors (`oauthCallback:`). Check PM2 or process logs — do not paste secrets publicly.
