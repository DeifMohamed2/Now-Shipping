# Now Shipping — Shopify integration (A–Z)

This document covers the **Shopify Partner app**, **environment variables**, **OAuth**, **webhooks**, **embedded admin UI**, **sync logs / retries**, and **production** (Nginx + PM2).  
Code paths: `utils/shopifyService.js`, `controllers/shopifyController.js`, `controllers/shopifyWebhookController.js`, `utils/shopifyOrderSync.js`, `routes/shopifyAppRoutes.js`, `public/shopify-app/` (built from `shopify-admin-ui/`).

---

## 1. Prerequisites

- Node.js 18+ (match your VPS)
- MongoDB (same `DATABASE_URL` as the main app)
- Shopify Partner account + dev store for testing
- Public **HTTPS** URL for the app (`APP_URL`), e.g. `https://now.com.eg` or an ngrok URL for local tests

---

## 2. Shopify Partner Dashboard

Create a **Custom app** (or public app) and configure:

| Field | Value |
|--------|--------|
| **App URL** | `https://<YOUR_HOST>/shopify-app/` (embedded React UI). Must end with **`/shopify-app/`** — if you use `/shopify` or `/` the iframe will hit the wrong route and show the public site **404**. |
| **Allowed redirection URL(s)** | Exactly: `https://<YOUR_HOST>/api/shopify/auth/callback` |
| **Scopes** | Must match `.env` `SHOPIFY_SCOPES` character-for-character (comma-separated). Suggested: `read_customers,read_fulfillments,write_fulfillments,read_orders,write_orders` |
| **Webhooks API version** | Same date style as `SHOPIFY_API_VERSION` (e.g. `2026-04`) |
| **Embedded** | Enabled |
| **Legacy install flow** | Disabled |

Copy **Client ID** → `SHOPIFY_API_KEY`, **Client secret** → `SHOPIFY_API_SECRET`.

### 2.1 Protected customer data (required for `orders/*` webhooks)

`orders/create` and `orders/updated` payloads include customer PII. Shopify returns **403** with *"protected customer data"* until your app is configured in the Partner Dashboard.

**You (app owner) must do this in Shopify Partners** — it cannot be fixed in code alone. See [Work with protected customer data](https://shopify.dev/docs/apps/store/data-protection/protected-customer-data).

1. [Partners](https://partners.shopify.com/) → **Apps** → your app → **API access** (or **API access requests**).
2. Under **Protected customer data access**, click **Request access**.
3. **Step 1** — Enable protected customer data; describe that the app syncs orders for courier delivery in Egypt and does not resell data. **Save**.
4. **Step 2** — Request each field you need (**Name**, **Address**, **Phone**, **Email**) with a one-line business justification each. **Save** after each.
5. **Step 3** — Complete **Data protection details** (privacy policy URL, retention, encryption, etc.). For **development stores only**, Shopify allows access after you finish the form — you do **not** need App Store review for dev testing.
6. **Reinstall the app on the store:** In Shopify Admin → **Settings → Apps and sales channels** → uninstall **Now**, then in Now go to **Business → Settings → Integrations** and click **Connect Shopify** again so webhook registration runs with the new permissions.

Until this is done, the app may show as “connected” in Now but order webhooks will not register; after OAuth you may see a yellow banner with these instructions.

---

## 3. Environment variables (main app `.env`)

See [`.env.example`](.env.example). Critical vars:

| Variable | Purpose |
|----------|---------|
| `APP_URL` | Public origin **without** trailing slash. Used for OAuth `redirect_uri` and webhook registration. |
| `DATABASE_URL` | MongoDB connection string |
| `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` | Partner app credentials |
| `SHOPIFY_SCOPES` | OAuth scopes (must match Partner app) |
| `SHOPIFY_API_VERSION` | Admin API version date string (e.g. `2026-04`), **not** semver |
| `SHOPIFY_TOKEN_ENCRYPTION_KEY` | 64 hex chars (`openssl rand -hex 32`) for AES-256-GCM token storage |
| `SHOPIFY_STATE_SECRET` | Optional; signs OAuth `state` (defaults to `JWT_SECRET`) |
| `SESSION_SECRET` | Express session signing |
| `JWT_SECRET` | Existing app auth |

After changing `APP_URL`, **reinstall or reconnect** Shopify so webhooks re-register to the new host.

---

## 4. Embedded admin UI build (`shopify-admin-ui`)

The SPA is built into `public/shopify-app/` and served at `/shopify-app/`.

1. Create `shopify-admin-ui/.env` (not committed) with:
   ```bash
   VITE_SHOPIFY_API_KEY=<same value as SHOPIFY_API_KEY>
   ```
2. From repo root:
   ```bash
   npm run build:shopify-ui
   ```
3. Deploy the updated `public/shopify-app/` assets with your release.

**Partner App URL** must point to `https://<APP_URL host>/shopify-app/` so Shopify loads the iframe with `host` query params for App Bridge. The embedded UI includes **Orders**, **Pickups**, and **Settings** (Shopify sidebar nav via App Bridge). If you mistakenly set `/shopify`, the server redirects to `/shopify-app/` (query string preserved).

---

## 5. Merchant linking (OAuth, dashboard-first)

1. Merchant logs into **Now** → **Business → Settings → Integrations**.
2. Enters `store.myshopify.com` → **Connect Shopify** → redirected to Shopify to approve scopes.
3. Shopify redirects to `GET /api/shopify/auth/callback` with `code`, `shop`, `hmac`, `state`.
4. Server verifies HMAC (`@shopify/shopify-api`), validates signed `state` → resolves **Now** user, exchanges code for **offline** access token, encrypts it (`utils/shopifyTokenCrypto.js`), upserts `ShopifyInstallation`, registers webhooks (including `orders/create`, `orders/updated`, `app/uninstalled`, and mandatory compliance topics), sets `isActive: true`.

**Redirect URL mismatch** is the #1 install failure — it must match **exactly** `{APP_URL}/api/shopify/auth/callback`.

---

## 6. Webhooks

- **Endpoint:** `POST {APP_URL}/api/shopify/webhooks`
- **Raw body:** Required for HMAC; mounted in `app.js` with `express.raw` **before** `express.json()`.
- **Verification:** `shopify.webhooks.validate` in `utils/shopifyService.js`. Invalid HMAC → **401**.

### 6.1 Mandatory compliance webhooks (App Store / automated checks)

Shopify requires three **compliance** topics. This app handles them on the **same** URL as other Admin webhooks; Shopify sends `X-Shopify-Topic` to distinguish them.

**Partner Dashboard (required for App Store review):** in your app configuration, set all three compliance webhook URLs to the same endpoint:

- **Customer data request:** `{APP_URL}/api/shopify/webhooks`
- **Customer data erasure:** `{APP_URL}/api/shopify/webhooks`
- **Shop data erasure:** `{APP_URL}/api/shopify/webhooks`

Then click **Run** (or re-save) on Shopify’s automated checks. After changing `APP_URL`, update these URLs to match.

Topics:

| Topic | Behaviour |
|-------|------------|
| `orders/create` | Maps eligible Egypt **Deliver** orders → creates `Order` with `externalSource: 'shopify'`. Writes `ShopifySyncLog`. Respects installation `isActive` (pause). |
| `orders/updated` | If Shopify order cancelled, cancels matching early-stage Now order. Logs to `ShopifySyncLog`. |
| `app/uninstalled` | Clears token, sets `uninstalledAt`, logs uninstall. |
| `customers/data_request` | Logged (shop, `data_request.id`, customer id, order count). Respond **200**; fulfill merchant obligations within 30 days. |
| `customers/redact` | Logged (shop, customer id, `orders_to_redact` count). Respond **200**; complete redaction within policy. |
| `shop/redact` | Clears access/refresh tokens, scopes, expiry fields; sets `uninstalledAt`, `isActive: false`; logs `ShopifySyncLog`. |

### 6.2 `shopify.app.toml` + `shopify app deploy` (Dev platform / automated checks)

If the Partner Dashboard no longer shows three separate compliance URL fields, register them via the app config file at the repo root: [`shopify.app.toml`](shopify.app.toml).

1. Ensure **`client_id`** matches **Client ID** in the Partner Dashboard (same as `SHOPIFY_API_KEY` in `.env`).
2. Set **`application_url`**, **`[auth].redirect_urls`**, and the webhook **`uri`** to your real **`APP_URL`** origin (production example uses `https://now.com.eg`). They must match where this Node app is reachable over HTTPS.
3. Install CLI: `npm install -g @shopify/cli@latest`
4. From the repo root, either:
   - **Interactive:** `shopify auth login` (once), then `npm run shopify:deploy` (runs `shopify app deploy --allow-updates`), **or**
   - **CI / headless:** create a **CLI token** in Partner Dashboard → Settings → CLI token, then  
     `SHOPIFY_CLI_PARTNERS_TOKEN=… shopify app deploy --allow-updates --source-control-url "<your-repo-commit-url>"`  
     (see [Shopify CI/CD deploy](https://shopify.dev/docs/apps/launch/deployment/deploy-in-ci-cd-pipeline).)

   This pushes webhook + compliance subscription URLs to Shopify so automated checks can POST and verify **HMAC** (your server returns **401** on bad signatures, **200** on valid ones).  
   The repo [`shopify.app.toml`](shopify.app.toml) uses **two** `[[webhooks.subscriptions]]` blocks (standard + compliance) pointing at the same `uri`.

After deploy, re-run **Automated checks** in the Partner / submission UI. Keep the app running on the same host as in the TOML when checks run.

---

## 7. Sync logs and retries

- Model: `ShopifySyncLog` (`models/shopifySyncLog.js`).
- Embedded app reads logs via `GET /api/shopify/app/sync-logs` (session token).
- **Retries:** `jobs/shopifySyncRetry.js` runs every **15 minutes**, re-processes up to **5** retries per failed `orders/create` row that still has a stored `payload`.

---

## 8. Embedded app API (session tokens)

Routes under `/api/shopify/app/*` require header:

```http
Authorization: Bearer <session_token>
```

The session token is a JWT from **App Bridge**, verified in `middleware/shopifySessionToken.js` with `SHOPIFY_API_SECRET` and audience `SHOPIFY_API_KEY`.

**Partner “Embedded app checks”:** Shopify auto-scans the **App URL** HTML for the official loader ([App Bridge migration](https://shopify.dev/docs/api/app-bridge/migration-guide)): `<meta name="shopify-api-key" …>` plus `https://cdn.shopify.com/shopifycloud/app-bridge.js` — this is injected in [`shopify-admin-ui/index.html`](shopify-admin-ui/index.html) at build time (`npm run build:shopify-ui`). The **session token** check turns green after you **open the embedded app on a dev store** and use pages that call your API (checks run about every 2 hours).

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/shopify/app/status` | Connection, `isActive`, last webhook, 24h stats, portal URL |
| PUT | `/api/shopify/app/toggle-sync` | Flip `isActive` (pause/resume imports) |
| GET | `/api/shopify/app/orders` | Paginated orders with `externalSource: shopify` for this business |
| GET | `/api/shopify/app/pickups` | Paginated pickups for this business |

## 9. Production (Nginx + PM2)

Examples (adapt, do not copy blindly):

- Nginx: [`deploy/nginx-now-shipping.example.conf`](deploy/nginx-now-shipping.example.conf)
- PM2: [`deploy/pm2.ecosystem.example.cjs`](deploy/pm2.ecosystem.example.cjs)

Checklist:

- [ ] TLS certificates installed and auto-renewed
- [ ] `proxy_set_header X-Forwarded-Proto https` (or correct scheme) so redirects stay HTTPS
- [ ] `client_max_body_size` sufficient for uploads
- [ ] Webhook location uses `proxy_request_buffering off` (recommended)
- [ ] `pm2 save` + systemd (or similar) for restarts

Release steps:

1. `npm ci` (or `npm install --production`)
2. `npm run build:shopify-ui`
3. `npm run build` (if you use webpack for main assets)
4. `pm2 reload now-shipping`

---

## 10. Local testing with ngrok

1. Run app: `PORT=6098 npm start` (or your process manager).
2. Run ngrok: `ngrok http 6098`
3. Set `APP_URL=https://<subdomain>.ngrok-free.app` (no trailing slash).
4. Update Partner app **App URL** and **Redirect URL** to use the same host.
5. In Now, disconnect/reconnect Shopify so webhooks point at ngrok.

---

## 11. Test checklist

- [ ] OAuth completes; `ShopifyInstallation` has `shopDomain`, encrypted token, `uninstalledAt: null`
- [ ] Partner Dashboard **mandatory compliance webhooks** (§6.1) **or** `shopify.app.toml` + `shopify app deploy` (§6.2): automated checks pass
- [ ] Webhooks appear in Partner app → Webhooks (recent deliveries)
- [ ] Eligible test order creates a Now order (`externalSource: 'shopify'`)
- [ ] Ineligible order (non-EG ship, no shipping lines, etc.) → skipped with reason in `ShopifySyncLog`
- [ ] Embedded app loads inside Shopify Admin; **Status** and **Sync logs** match DB
- [ ] **Pause** toggle: new eligible orders skip with reason `sync_paused`
- [ ] **Resume** toggle: imports work again
- [ ] Uninstall app in Shopify → `uninstalledAt` set, token cleared
- [ ] `orders/updated` cancel reflects on early `new` / `pendingPickup` orders

---

## 12. Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| OAuth `Invalid OAuth HMAC` | Wrong `SHOPIFY_API_SECRET`, or query altered by proxy |
| Redirect loop / blank iframe | `host` missing; App URL must be `/shopify-app/`; rebuild UI with `VITE_SHOPIFY_API_KEY` |
| “Page not found” inside the Shopify app iframe | Partner **App URL** is wrong (e.g. `/shopify` instead of `/shopify-app/`). Fix in Partner Dashboard, or rely on server redirect `/shopify` → `/shopify-app/` (query string preserved). |
| `401 Invalid HMAC` on webhooks | Body parsed as JSON instead of raw; check Nginx buffering; route must use raw parser |
| Webhooks 404 | `APP_URL` / tunnel URL mismatch; reinstall app |
| `403` webhook *protected customer data* | Complete Partner Dashboard **Protected customer data access** (see §2.1), then uninstall + reconnect the app |
| Orders never import | Filters: Egypt shipping, shippable items, shipping lines, `isActive`, business pickup rules |
| `invalid_session_token` on app API | Clock skew, wrong secret, or `aud` not matching Client ID |

---

## 13. Security reminders

- Never log raw access tokens or `Authorization` headers.
- Rotate `SHOPIFY_API_SECRET` if exposed.
- Use a dedicated `SHOPIFY_TOKEN_ENCRYPTION_KEY` in production (64 hex chars).

---

## 14. What we need from you (operator)

1. **Production domain** and whether TLS terminates at Nginx or a load balancer.  
2. **MongoDB URI** and backup policy.  
3. **Shopify app type**: custom (single merchant) vs public (App Store review).  
4. **Confirm** Partner **Redirect URL** and **App URL** after any domain change.  
5. **CI/CD**: whether `build:shopify-ui` runs in pipeline before deploy.

If any of the above differ on your server, send the sanitized Nginx `server` block and PM2 process name so instructions can be aligned to your setup.
