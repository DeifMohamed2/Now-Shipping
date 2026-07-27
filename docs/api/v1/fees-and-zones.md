# Fees & Delivery Zones

Shipping fees are **never accepted from the client**. Now Shipping computes fees from:

- **Government** (`Cairo`, `Giza`, `Qalyubia`)
- **Order type** (`Deliver`, `Return`, `Exchange`)
- **Express shipping** (`true` / `false`, Deliver only)
- **Business custom pricing** (if enabled by admin)

The computed fee is returned in create/update responses as `orderFees`.

## Get delivery zones

`GET /api/public/v1/delivery-zones`

Returns the catalog of governments and zones integrators must use when creating orders.

```bash
curl "https://your-domain.com/api/public/v1/delivery-zones" \
  -H "Authorization: Bearer nsk_live_YOUR_KEY"
```

Response includes governments with nested zones. Use exact zone names from this catalog in order create/update requests.

Supports `ETag` / `If-None-Match` for caching (`304 Not Modified`).

## Calculate fee (preview)

`POST /api/public/v1/fees/calculate`

Preview the shipping fee before creating an order.

### Request body

```json
{
  "government": "Cairo",
  "orderType": "Deliver",
  "isExpressShipping": false
}
```

### Example

```bash
curl -X POST "https://your-domain.com/api/public/v1/fees/calculate" \
  -H "Authorization: Bearer nsk_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "government": "Giza",
    "orderType": "Deliver",
    "isExpressShipping": true
  }'
```

### Response

```json
{
  "success": true,
  "data": {
    "fee": 145,
    "currency": "EGP",
    "note": "Fees are computed by Now Shipping based on zone, order type, and express shipping. Never send fee values when creating orders."
  }
}
```

## Important

- Do **not** send `orderFees`, `fee`, `shippingFee`, or `amountOfFees` in create/update requests — they are ignored.
- The authoritative fee is always the value returned by the API after order creation or update.
- If a business has custom pricing enabled in admin, fees reflect those rates automatically.
