# Shopify — Next steps (operator checklist)

This file is a **standalone action list** for you (the app owner / merchant) after you see **“Connected”** in Now but **order webhooks fail** with **403 protected customer data**, or when you want to go live.

For full developer setup (env vars, Nginx, embedded UI build), see [`SHOPIFY-SETUP.md`](SHOPIFY-SETUP.md).

---

## FAQ: “It connected without showing Shopify login or approve screen”

That is **normal**, not a security bug.

1. You were **already logged in** to Shopify Admin in that browser (same session as your test store, e.g. `your-store.myshopify.com`).
2. You **already approved** this app’s scopes in an earlier install. If scopes did not change, Shopify **skips the grant screen** and sends you straight back with a new `code` (OAuth still runs).
3. Your server still **exchanges the code for a token** and registers webhooks. You can confirm OAuth ran because **`app/uninstalled`** often registers even when **`orders/create`** / **`orders/updated`** are blocked by Protected Customer Data rules.

**To see the full “Install app / Approve permissions” screen again:** use a **private/incognito** window, open your store admin, then connect the app from Now.

---

## Part A — Fix `orders/create` and `orders/updated` (Protected Customer Data)

Shopify blocks webhooks whose payloads include **customer PII** until your **Partner app** declares access. Official docs: [Work with protected customer data](https://shopify.dev/docs/apps/store/data-protection/protected-customer-data).

### A1. Open the right place in Partners

1. Go to **https://partners.shopify.com/**
2. Sign in with your **Partner** account (the one that owns the app).
3. Click **Apps** in the left menu.
4. Click your app (e.g. **Now** / **Now Shipping**).
5. In the app’s left sidebar, click **API access** (sometimes labeled **API access requests**).

### A2. Start “Protected customer data access”

1. Find the section **Protected customer data access**.
2. Click **Request access** (or **Manage** if you already started).

### A3. Step 1 — General protected customer data

1. Enable / select **Protected customer data** (wording may vary).
2. In the **reason / how you use this data** field, you can paste:

   ```text
   Now Shipping is a courier and last-mile delivery platform for Egypt. We subscribe to orders/create and orders/updated webhooks to create and update matching delivery jobs in the merchant’s Now dashboard, assign couriers, and notify the merchant of shipment status. Customer data is used only for fulfillment and operational delivery. We do not sell or share customer data with third parties for marketing.
   ```

3. Click **Save**.

### A4. Step 2 — Protected customer fields (do all four)

Shopify asks for **each** of: **Name**, **Address**, **Phone**, **Email**. Complete **one at a time** and **Save** after each (if the UI asks that way).

**Name — paste as justification:**

```text
Recipient name is printed on the airway bill and shown to the courier so they can verify identity at the door during delivery.
```

**Address — paste as justification:**

```text
Full shipping address is required to route the parcel and complete physical delivery within Egypt (governorate/zone mapping in our system).
```

**Phone — paste as justification:**

```text
Courier calls or messages the customer before arrival and for failed delivery attempts; phone is required for Egypt last-mile operations.
```

**Email — paste as justification:**

```text
Used only for operational notifications related to the shipment (e.g. status updates or proof of delivery) when the merchant enables such notifications; not used for unrelated marketing.
```

### A5. Step 3 — Data protection details

Fill every required field honestly. Typical answers:

| Question / topic | What to put |
|------------------|-------------|
| Privacy policy URL | A **public** HTTPS URL to your privacy policy (use your marketing site or `now.com.eg` legal page if you have one). |
| Data retention | Example: “Order and customer data tied to active shipments are kept for the duration of the merchant contract plus a limited period for disputes and accounting (e.g. 12–24 months), then deleted or anonymized per policy.” |
| Encryption in transit | **Yes** — HTTPS for all app and webhook traffic. |
| Encryption at rest | **Yes** — tokens are encrypted in our database; follow your real practices for backups. |
| Access controls | **Yes** — staff access limited by role; production vs test separation where applicable. |

**Development stores:** After you complete the form, Shopify usually allows access **without** full App Store review for stores used only for development. **Public App Store** apps may need additional review later.

### A6. Confirm distribution method (if Partners asks)

If the dashboard says you must **select a distribution method** before requesting protected data:

1. In the app settings, set distribution to **Public** or **Custom** as appropriate for your rollout.
2. Return to **API access → Protected customer data access** and finish the steps above.

---

## Part B — Reinstall the app on the store (required after Part A)

Webhook permission is re-evaluated when the app is installed. **Always uninstall then reconnect** after changing Protected Customer Data settings.

### B1. Uninstall in Shopify Admin

1. Open **Shopify Admin** for your test store (e.g. `https://qimoratesting.myshopify.com/admin`).
2. Go to **Settings** (bottom left gear).
3. Click **Apps and sales channels**.
4. Find your app (**Now** / the name shown in the list).
5. Click it → **Uninstall** (or **Remove app**). Confirm.

### B2. Disconnect in Now (optional but clean)

1. Log in to **Now** as the business user.
2. Go to **Business → Settings → Integrations** (Shopify section).
3. If it still shows **Connected**, click **Disconnect**.

### B3. Connect again from Now

1. On the same **Integrations** tab, enter your store domain exactly as **`your-store.myshopify.com`** (no `https://`).
2. Click **Connect Shopify**.
3. If Shopify shows the install screen, approve. If it skips (already approved), that is OK.
4. Wait until you are redirected back to Now settings.

---

## Part C — Verify everything worked

### C1. Server terminal (Node / nodemon)

You should see lines like:

```text
[Shopify] Webhook registered: orders/create
[Shopify] Webhook registered: orders/updated
[Shopify] Webhook registered: app/uninstalled
```

When Shopify sends an order webhook, you should also see **one line per order**, for example:

```text
[Shopify sync] orders/create shop=your-store.myshopify.com shopify=#1001 CREATED nowOrder=123456
```

or:

```text
[Shopify sync] orders/create shop=... shopify=#1002 SKIPPED reason=no_shipping_address
```

**Bad:** lines like:

```text
Shopify webhook register failed orders/create: 403 ... protected customer data
```

If 403 persists, repeat **Part A** (every sub-step and field), wait a minute, then repeat **Part B**.

### C2. Partner Dashboard — Webhooks

1. **Partners** → **Apps** → your app.
2. Open **Configuration** or **Webhooks** (where Shopify lists subscriptions / deliveries for the app).
3. Confirm subscriptions exist for **`orders/create`**, **`orders/updated`**, and **`app/uninstalled`** pointing to:

   `https://<YOUR_APP_HOST>/api/shopify/webhooks`

   where `<YOUR_APP_HOST>` matches your **`APP_URL`** in `.env` (e.g. ngrok host or `now.com.eg`).

### C3. Now dashboard — yellow banner

- If you still see **“Shopify Partner action required”** after reconnect, Protected Customer Data is **not** fully approved or the store was not reinstalled after approval. Go back to **Part A** and **Part B**.

---

## Part D — Configure Shopify so orders actually sync

If Shopify shows **“Shipping not required”** on the order, you may get **no** `shipping_address` or a payload Now will skip until there is a real **Egypt street** on the order. Configure the store like this:

### D0. Product (must ship)

1. **Products** → open your product → **Shipping**.
2. Enable **“This is a physical product”**.
3. Enter **weight** if Shopify requires it for your theme.

### D1. Shipping zones and rates

1. **Settings** → **Shipping and delivery**.
2. Ensure a **shipping zone** includes **Egypt** and has at least **one rate** (Standard, Flat, Free shipping, etc.).
3. Place a test checkout and confirm the order has a **shipping address** in Egypt. Prefer seeing a real **shipping method** on the order (not “Shipping not required”) for the most realistic test.

### D2. How Shopify address fields map to Now **government** and **zone**

Shopify checkout uses **Province** (governorate) and **City** (often district / area). Now maps them in `utils/shopifyAddressMap.js`:

- **Government** is inferred from `province` / `city` against Egypt governorate names.
- **Cairo**: **Zone** is resolved from **City** + address text against internal Cairo area names (Bosta list). For tests, type a recognizable district in **City** when possible.
- **Outside Cairo**: **Zone** is the **City** line (or street fallback), with **government** for fee calculation.

---

## Part E — End-to-end test (one order)

Now imports **Deliver** orders when:

- Country is **Egypt** (`EG`),
- There is a **shipping address** with a meaningful **street** (`address1`, at least ~3 characters),
- Either line items **require shipping**, or the Egypt street address still qualifies (covers mis-flagged products and some free-shipping cases),
- **Empty `shipping_lines`** is allowed when the Egypt street address qualifies (see `shouldImportDeliverOrder` in `utils/shopifyOrderMapper.js`).

**Express** (`isExpressShipping`) affects **fees** in Now, not whether the order is imported. Put `express`, `سريع`, or `fast` in the **shipping rate title** or **order tags** if you want express pricing.

1. Create a **test order** as in **Part D**.
2. Watch the **server terminal** for:  
   `[Shopify sync] orders/create shop=... CREATED nowOrder=...`  
   or `SKIPPED reason=...` (explains every non-import).
3. Confirm the order in **Now** (embedded **Orders** or main portal).
4. Optionally inspect **`ShopifySyncLog`** in MongoDB.

---

## Part F — Production checklist (when leaving ngrok)

Do these in order:

1. Set **`APP_URL`** in production `.env` to your real origin, **no trailing slash**, e.g. `https://now.com.eg`.
2. In **Shopify Partners**, set:
   - **App URL** → `https://now.com.eg/shopify-app/`
   - **Allowed redirection URL(s)** → `https://now.com.eg/api/shopify/auth/callback`
3. Rebuild and deploy the embedded UI: `npm run build:shopify-ui` so `public/shopify-app/` matches production and `VITE_SHOPIFY_API_KEY` matches **`SHOPIFY_API_KEY`**.
4. **Uninstall** the app from any test store that used the old ngrok URL, then **reconnect** so webhooks point to production.
5. Confirm TLS (HTTPS) end-to-end and that Nginx forwards `X-Forwarded-Proto` correctly (see `deploy/nginx-now-shipping.example.conf` in the repo).

---

## Quick reference links

| Topic | URL |
|-------|-----|
| Protected customer data | https://shopify.dev/docs/apps/store/data-protection/protected-customer-data |
| OAuth (authorization code) | https://shopify.dev/docs/apps/auth/get-access-tokens/authorization-code-grant |
| Full Now dev doc | [`SHOPIFY-SETUP.md`](SHOPIFY-SETUP.md) |

---

## Ignore: `[shopify-api/INFO] Future flag … is disabled`

Messages like `customerAddressDefaultFix` and `unstable_managedPricingSupport` are **informational** logs from `@shopify/shopify-api`. They are **not errors** and do **not** block webhooks or OAuth. You can ignore them unless you adopt those specific SDK features later.
