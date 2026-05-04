# Production deploy checklist

## Runtime

- Use **Node.js 18+** (see `engines` in root `package.json`).
- Install dependencies with **`npm ci`** using the committed **`package-lock.json`** (same revision as `package.json`). Avoid `npm install` on the server unless you intend to change the lockfile.

## Environment

- Copy **`.env`** from `.env.example` / your secrets manager; never commit real secrets.
- For Shopify token encryption at rest, prefer **`SHOPIFY_TOKEN_ENCRYPTION_KEY`** (64 hex chars).

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
