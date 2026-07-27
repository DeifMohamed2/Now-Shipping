# Pickups API

Pickup fees are **always computed by Now Shipping** — do not send `pickupFees` in create/update requests.

For **company API keys**, include `X-Merchant-Id` on every pickup request.

## Calculate pickup fee (preview)

`POST /api/public/v1/pickups/calculate-fee`

```bash
curl -X POST "https://your-domain.com/api/public/v1/pickups/calculate-fee" \
  -H "Authorization: Bearer nsk_live_YOUR_KEY" \
  -H "X-Merchant-Id: 48291736" \
  -H "Content-Type: application/json" \
  -d '{ "numberOfOrders": 10, "pickupAddressId": "addr_..." }'
```

## Create pickup

`POST /api/public/v1/pickups`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `numberOfOrders` | number | yes | Expected order count |
| `pickupDate` | string (ISO date) | yes | Scheduled pickup date |
| `phoneNumber` | string | yes | Contact phone |
| `isFragileItems` | boolean | no | Fragile items flag |
| `isLargeItems` | boolean | no | Large items flag |
| `pickupNotes` | string | no | Notes for courier |
| `pickupLocation` | string | no | Override location text |
| `pickupAddressId` | string | no | Business pickup address ID |

```bash
curl -X POST "https://your-domain.com/api/public/v1/pickups" \
  -H "Authorization: Bearer nsk_live_YOUR_KEY" \
  -H "X-Merchant-Id: 48291736" \
  -H "Content-Type: application/json" \
  -d '{
    "numberOfOrders": 15,
    "pickupDate": "2026-07-28",
    "phoneNumber": "01012345678",
    "isFragileItems": false,
    "isLargeItems": false,
    "pickupNotes": "Call before arrival"
  }'
```

## List pickups

`GET /api/public/v1/pickups`

Query: `page`, `limit`, `status`, `statusCategory`, `dateFrom`, `dateTo`, `search`, `pickupType` (`Upcoming` / `Completed`)

## Get pickup

`GET /api/public/v1/pickups/{pickupNumber}`

## Update pickup

`PUT /api/public/v1/pickups/{pickupNumber}`

Only allowed while status is `new` or `pendingPickup`. Fees are recomputed automatically.

## Cancel pickup

`POST /api/public/v1/pickups/{pickupNumber}/cancel`

## Delete pickup

`DELETE /api/public/v1/pickups/{pickupNumber}`

Only allowed while status is `new` or `pendingPickup`.
