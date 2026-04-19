# Return Pickup OTP — API Documentation

## Overview

When an admin assigns a courier to a **Return** order, the system now automatically generates a 6-digit OTP and sends it to the **customer** via SMS (referencing the original order number). The courier must supply this OTP when calling the _pickup-return_ endpoint — the same pattern as delivery OTP on standard orders.

---

## Flow Summary

```
Admin assigns courier to Return order
  ├─ returnOtp generated & stored on order (hashed)
  ├─ SMS sent to customer: "Return pickup OTP for order #XXXXXX is 123456. Valid 24h."
  └─ Firebase push sent to Business: courier assigned + OTP sent

Courier mobile app (API only; `/courier` web UI is discontinued — 410)
  ├─ GET /api/v1/courier/returns/:orderNumber/details
  │    └─ Response includes returnOtpInfo: { otpRequired, otpIssuedAt, otpExpiresAt }
  └─ POST /api/v1/courier/orders/:orderNumber/pickup-return  { otp, notes }
       ├─ 400 if OTP missing, expired, or invalid
       └─ 200 on success → status: returnPickedUp
```

---

## Endpoints

### 1. GET `/api/v1/courier/returns/:orderNumber/details`

Fetch return order details. When `orderStatus === 'returnAssigned'`, the response includes OTP metadata.

**Auth:** Bearer JWT (courier)

**Response 200 – returnAssigned example:**
```json
{
  "order": { "...": "..." },
  "progressPercentage": 25,
  "stageTimeline": ["..."],
  "currentStage": "returnAssigned",
  "nextAction": "Pick up from customer",
  "feeBreakdown": {},
  "returnOtpInfo": {
    "otpRequired": true,
    "otpIssuedAt": "2024-06-01T10:00:00.000Z",
    "otpExpiresAt": "2024-06-02T10:00:00.000Z",
    "otpVerified": false,
    "isLegacy": false
  }
}
```

`returnOtpInfo.isLegacy: true` means no OTP was issued for this order (pre-feature or manual assignment edge case). The pickup endpoint will still accept the request but log a warning.

---

### 2. POST `/api/v1/courier/orders/:orderNumber/pickup-return`

Confirm return pickup from the customer. **Requires OTP** when the order has `returnOtp.issuedAt` set.

**Auth:** Bearer JWT (courier)

**Path params:**
| Param | Type | Description |
|-------|------|-------------|
| `orderNumber` | string | Return order number, original order number, or barcode |

**Request body:**
```json
{
  "otp": "123456",
  "notes": "Picked up in good condition",
  "pickupLocation": "Customer address (optional)",
  "returnCondition": "good (optional)",
  "returnValue": 150 
}
```

**Responses:**

| Status | Meaning |
|--------|---------|
| 200 | Pickup confirmed, status → `returnPickedUp` |
| 400 | OTP required but not provided |
| 400 | Invalid OTP (attempts incremented) |
| 400 | OTP expired — ask admin to resend |
| 400 | Order not in `returnAssigned` status |
| 401 | Unauthorized |
| 404 | Order not found or not assigned to this courier |
| 500 | Server error |

**Success 200:**
```json
{
  "success": true,
  "message": "Return picked up successfully",
  "orderNumber": "RET-123456",
  "nextAction": "Deliver to warehouse"
}
```

**Error 400 – OTP required:**
```json
{
  "message": "Return OTP is required to confirm pickup from customer."
}
```

**Error 400 – Invalid OTP:**
```json
{
  "message": "Invalid OTP. Please ask the customer to check their SMS and try again."
}
```

**Error 400 – OTP expired:**
```json
{
  "message": "Return OTP has expired. Ask the admin to resend it."
}
```

---

### 3. POST `/admin/orders/:orderNumber/resend-return-otp`

Admin-only endpoint to regenerate and resend the return pickup OTP to the customer. Use this when:
- The customer deleted the original SMS
- The OTP expired (24 hours passed)
- The courier or customer reports not receiving it

**Auth:** Admin session cookie

**Path params:**
| Param | Type | Description |
|-------|------|-------------|
| `orderNumber` | string | Return order number |

**Requirements:** Order must be in `returnAssigned` status and be a Return order type.

**Response 200:**
```json
{
  "success": true,
  "message": "Return OTP regenerated and SMS sent to customer.",
  "otpIssuedAt": "2024-06-01T14:00:00.000Z",
  "otpExpiresAt": "2024-06-02T14:00:00.000Z"
}
```

**Response 404:**
```json
{
  "error": "Return order not found or not in returnAssigned status."
}
```

---

## Order Schema Changes

The `Order` model now has a `returnOtp` subdocument alongside `deliveryOtp`:

```js
returnOtp: {
  otpHash:    String,   // bcrypt hash — never expose
  expiresAt:  Date,
  verifiedAt: Date,     // set on successful OTP match
  issuedAt:   Date,
  attempts:   Number,   // incremented on each wrong attempt
}
```

---

## Backfill / Legacy Orders

Orders that were in `returnAssigned` before this feature was deployed will have `returnOtp.otpHash === null`. The `pickup-return` endpoint detects this and allows the courier to proceed **without OTP** (one-time bypass). An audit log entry `legacy_pickup` is written to the console. 

To give legacy orders proper OTP protection, admin should use the **Resend Return OTP** button on the order details page (visible whenever `orderStatus === 'returnAssigned'`).

---

## SMS Template

Sent to customer when courier is assigned:

```
NowShipping - {BrandName}: Return pickup OTP for order {originalOrderNumber} is {CODE}. 
Share this code ONLY with the courier at pickup. Valid for 24 hours.
```

Resend uses the same template.
