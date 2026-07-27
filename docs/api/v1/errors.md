# Error Reference

## Error response shape

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description",
    "details": { }
  }
}
```

`details` is optional and may contain extra context (e.g. `currentStatus` on cancel failures).

## HTTP status codes

| Status | Meaning |
|--------|---------|
| 400 | Validation error — fix request body or parameters |
| 401 | Missing, invalid, or revoked API key |
| 403 | Forbidden — account removed or action not allowed |
| 404 | Resource not found |
| 409 | Conflict — duplicate merchant (email, phone, or externalMerchantId) |
| 429 | Rate limit exceeded (120 req/min per key) |
| 500 | Internal server error |

## Error codes

| Code | Description |
|------|-------------|
| `MERCHANT_REQUIRED` | Company API key used without `X-Merchant-Id` on order/pickup routes |
| `MERCHANT_NOT_FOUND` | Merchant ID not found or not linked to this company |
| `MERCHANT_NOT_APPLICABLE` | `X-Merchant-Id` sent on a single-business API key |
| `MERCHANT_ALREADY_EXISTS` | Duplicate email, phone, or externalMerchantId on merchant onboarding |
| `SCOPE_DENIED` | API key missing required scope (`orders`, `pickups`, or `merchants`) |
| `UNAUTHORIZED` | No API key or invalid/revoked key |
| `ACCOUNT_REMOVED` | Business account was deleted |
| `FORBIDDEN` | Action not permitted (e.g. edit locked order) |
| `NOT_FOUND` | Order or resource not found |
| `VALIDATION_ERROR` | Invalid or missing fields |
| `RATE_LIMITED` | Too many requests |
| `INTERNAL_ERROR` | Unexpected server error |

## Common validation messages

- **Government and orderType are required** — fee calculation missing required fields
- **All customer info fields are required** — update order missing name/phone/address/government/zone
- **This order can no longer be deleted** — only `new` orders can be deleted
- **This order cannot be canceled from its current status** — cancel rules depend on order status
- **Address and order details cannot be edited** — courier may be assigned or order past editable stage
- **Express shipping option cannot be changed for orders older than 6 hours**

- **phone must be 11 digits** — merchant onboarding phone format
- **pickupAddress.city is required** — merchant onboarding missing pickup address fields
- **Area / zone is not valid** — zone must match `GET /delivery-zones` catalog (`government` on orders, `pickupAddress.city` on merchant onboarding)
- **Government must be one of** — fee preview or order used an invalid governorate
- **externalMerchantId is already registered** — use a different shop ID or fetch existing merchant

## Troubleshooting

1. **401 Unauthorized** — verify `Authorization: Bearer nsk_live_...` header; confirm key is active in admin
2. **400 on create** — call `GET /delivery-zones` and use exact zone names; ensure `orderType` is valid
3. **403 on update** — order may no longer be editable; check `canChangeAddress` on order details
4. **429** — reduce request rate or contact support for higher limits
5. **400 MERCHANT_REQUIRED** — company API key needs `X-Merchant-Id` header; call `GET /merchants` first
6. **403 MERCHANT_NOT_FOUND** — verify merchant is assigned to the company in admin
7. **409 MERCHANT_ALREADY_EXISTS** — email, phone, or externalMerchantId already used; call `GET /merchants` to find existing merchant
8. **403 SCOPE_DENIED** — API key lacks the required scope; create a new token with the needed scopes in admin
