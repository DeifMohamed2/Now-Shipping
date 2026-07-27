# Orders API

All endpoints require authentication. Fees are **always computed by Now Shipping** — do not send `orderFees`, `fee`, or similar fields.

For **company API keys** (multi-tenant integrators), include the merchant on every order request:

```http
X-Merchant-Id: 48291736
```

Use the merchant's `businessAccountCode`, `externalMerchantId`, or MongoDB `_id`. List merchants via `GET /api/public/v1/merchants`.

Zones must be exact values from `GET /api/public/v1/delivery-zones` — not free text.

## Create order

`POST /api/public/v1/orders`

### Request body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `fullName` | string | yes | Customer name |
| `phoneNumber` | string | yes | Customer phone |
| `otherPhoneNumber` | string | no | Secondary phone |
| `address` | string | yes | Street address |
| `buildingNo` | string | no | Building number |
| `apartmentNo` | string | no | Apartment number |
| `government` | string | yes | `Cairo`, `Giza`, or `Qalyubia` |
| `zone` | string | yes | Zone from delivery-zones catalog |
| `deliverToWorkAddress` | boolean | no | Deliver to work address |
| `orderType` | string | yes | `Deliver`, `Return`, or `Exchange` |
| `productDescription` | string | yes* | Product description |
| `numberOfItems` | number | yes* | Item count |
| `isExpressShipping` | boolean | no | Fast delivery (Deliver only) |
| `COD` | boolean | no | Cash on delivery |
| `amountCOD` | number | no | COD amount (EGP) |
| `CashDifference` | boolean | no | Cash difference (Exchange) |
| `amountCashDifference` | number | no | CD amount (EGP) |
| `previewPermission` | boolean | no | Allow customer preview |
| `referralNumber` | string | no | External reference |
| `Notes` | string | no | Order notes |
| `originalOrderNumber` | string | Return only | Completed deliver order to return |
| `selectedPickupAddressId` | string | Return only | Business pickup address ID |

\* Required for Deliver/Exchange; Return has additional rules.

### Example — Deliver order

```bash
curl -X POST "https://your-domain.com/api/public/v1/orders" \
  -H "Authorization: Bearer nsk_live_YOUR_KEY" \
  -H "X-Merchant-Id: 48291736" \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "Ahmed Hassan",
    "phoneNumber": "01012345678",
    "address": "15 Nile Street",
    "government": "Cairo",
    "zone": "Nasr City - ElHay 06 (Nasr City)",
    "orderType": "Deliver",
    "productDescription": "T-shirt x2",
    "numberOfItems": 2,
    "isExpressShipping": false,
    "COD": true,
    "amountCOD": 500
  }'
```

### Response `201`

```json
{
  "success": true,
  "data": {
    "message": "Order created successfully.",
    "order": {
      "orderId": "...",
      "orderNumber": "482917",
      "orderStatus": "new",
      "orderFees": 120,
      "orderType": "Deliver",
      "isExpressShipping": false
    }
  }
}
```

## List orders

`GET /api/public/v1/orders`

Query parameters: `page`, `limit`, `orderType`, `status`, `statusCategory`, `paymentType`, `dateFrom`, `dateTo`, `search`

```bash
curl "https://your-domain.com/api/public/v1/orders?page=1&limit=20&status=new" \
  -H "Authorization: Bearer nsk_live_YOUR_KEY"
```

## Get order

`GET /api/public/v1/orders/{orderNumber}`

```bash
curl "https://your-domain.com/api/public/v1/orders/482917" \
  -H "Authorization: Bearer nsk_live_YOUR_KEY"
```

## Update order

`PUT /api/public/v1/orders/{orderId}`

`orderId` may be MongoDB `_id` or `orderNumber`. Only allowed while order is in an editable status (typically before courier assignment).

```bash
curl -X PUT "https://your-domain.com/api/public/v1/orders/482917" \
  -H "Authorization: Bearer nsk_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "Ahmed Hassan",
    "phoneNumber": "01012345678",
    "address": "20 Nile Street",
    "government": "Cairo",
    "zone": "Nasr City - ElHay 06 (Nasr City)",
    "orderType": "Deliver",
    "productDescription": "T-shirt x2",
    "numberOfItems": 2,
    "isExpressShipping": false
  }'
```

Fees are recalculated automatically from zone + type + express flag.

## Cancel order

`POST /api/public/v1/orders/{orderId}/cancel`

```bash
curl -X POST "https://your-domain.com/api/public/v1/orders/482917/cancel" \
  -H "Authorization: Bearer nsk_live_YOUR_KEY"
```

## Delete order

`DELETE /api/public/v1/orders/{orderId}`

Only orders with status `new` can be deleted.

```bash
curl -X DELETE "https://your-domain.com/api/public/v1/orders/482917" \
  -H "Authorization: Bearer nsk_live_YOUR_KEY"
```

## Download AWB (shipping label PDF)

`GET /api/public/v1/orders/{orderNumber}/awb?size=A4`

`size` may be `A4` or `A5` (default `A4`). Returns `application/pdf`.

```bash
curl "https://your-domain.com/api/public/v1/orders/482917/awb?size=A4" \
  -H "Authorization: Bearer nsk_live_YOUR_KEY" \
  -o awb-482917.pdf
```

## Health check

`GET /api/public/v1/ping`

```bash
curl "https://your-domain.com/api/public/v1/ping" \
  -H "Authorization: Bearer nsk_live_YOUR_KEY"
```
