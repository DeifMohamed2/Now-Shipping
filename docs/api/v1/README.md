# Now Shipping Public API v1

Professional REST API for business integrations with Now Shipping.

> **Full integration guide (send to partners):** [INTEGRATION_GUIDE.md](./INTEGRATION_GUIDE.md) — complete all-in-one documentation with examples, field references, and workflows.

## Base URL

```
https://your-domain.com/api/public/v1
```

## Interactive documentation

- **Redoc UI:** `GET /api/public/v1/docs`
- **OpenAPI spec:** `GET /api/public/v1/openapi.yaml`

## Authentication

All endpoints (except docs) require a business API key issued by a Now Shipping admin.

```http
Authorization: Bearer nsk_live_<your_key>
```

Or:

```http
X-Api-Key: nsk_live_<your_key>
```

API keys are created in **Admin → Business details → API Access**. The full key is shown **once** at creation.

## Multi-tenant integrators (company API keys)

For e-commerce platforms with many merchants:

1. Admin marks the integrator account as **Company account**.
2. Each merchant is a separate Now Shipping business with `parentCompany` set to the integrator.
3. The company uses **one API key** for all merchants.
4. Every order/pickup request must include the target merchant:

```http
X-Merchant-Id: 48291736
```

`X-Merchant-Id` accepts the merchant's `businessAccountCode` (8-digit code), `externalMerchantId` (your shop ID from onboarding), or MongoDB `_id`.

Order and merchant zones must be exact values from `GET /delivery-zones` — not free text like `"Nasr City"`.

List merchants: `GET /api/public/v1/merchants`

Onboard a new merchant: `POST /api/public/v1/merchants` — returns `businessAccountCode` for immediate use as `X-Merchant-Id`. See [Merchants guide](./merchants.md).

Single-business API keys work without `X-Merchant-Id` (backward compatible).

## Response format

Success:

```json
{
  "success": true,
  "data": { }
}
```

Error:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable message"
  }
}
```

## Rate limiting

120 requests per minute per API key (in-memory limiter). HTTP `429` when exceeded.

## Versioning

This is **v1**. Future breaking changes will ship under `/api/public/v2`. v1 remains supported during migration.

## Core workflow

### Single business

1. **Get delivery zones** — `GET /delivery-zones`
2. **Calculate fee** (optional) — `POST /fees/calculate`
3. **Create order** — `POST /orders`
4. **Print AWB** — `GET /orders/{orderNumber}/awb`
5. **Create pickup** — `POST /pickups`

### Company integrator

1. **Onboard merchant** — `POST /merchants` (one call per shop)
2. **List merchants** — `GET /merchants`
3. **Get delivery zones** — `GET /delivery-zones`
4. **Calculate fee** — `POST /fees/calculate` + `X-Merchant-Id`
5. **Create order** — `POST /orders` + `X-Merchant-Id`
6. **Create pickup** — `POST /pickups` + `X-Merchant-Id`

Fees are always computed server-side — never send `orderFees` or `pickupFees` in requests.

## Guides

- **[Integration Guide](./INTEGRATION_GUIDE.md)** — complete all-in-one reference for integrators
- [Merchants](./merchants.md) — onboard merchants, list, get
- [Orders](./orders.md) — create, list, get, update, cancel, delete, AWB
- [Pickups](./pickups.md) — create, list, get, update, cancel, delete, fee preview
- [Fees & zones](./fees-and-zones.md) — zone catalog and fee calculation
- [Errors](./errors.md) — error codes and troubleshooting

## Support

Contact your Now Shipping account manager for API key provisioning and integration support.
