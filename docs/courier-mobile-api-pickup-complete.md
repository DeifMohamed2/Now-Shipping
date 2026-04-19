# Courier mobile API — business pickup complete and return pickup

## Authentication (JWT)

Courier web login (`GET /courier-login`) is removed. Obtain a token from:

| Method | URL | Body |
|--------|-----|------|
| `POST` | `/api/v1/auth/courier-login` | `{ "email": "...", "password": "..." }` |

Success returns JSON with `token` (and optional `user`). Use that value as **`Authorization: Bearer <token>`** for all `/api/v1/courier/*` calls.

The legacy **`POST /courier-login`** (same host, web route) still accepts the same JSON and sets a cookie; new apps should use **`/api/v1/auth/courier-login`** only.

---

Base URL (example): `https://your-host.com/api/v1/courier`

All courier operation endpoints require **`Authorization: Bearer <JWT>`**.

Recommended headers on every request:

| Header | Value |
|--------|--------|
| `Authorization` | `Bearer <token>` |
| `Accept` | `application/json` |
| `Content-Type` | `application/json` (for POST/PUT with body) |

---

## 1. Complete business pickup (mark pickup run finished)

After the courier has scanned/added all orders to a pickup run, they finalize it so orders move to `pickedUp` and the business is notified.

| Item | Value |
|------|--------|
| **Method** | `PUT` |
| **Path** | `/pickups/:pickupNumber/complete` |
| **Full URL** | `{{baseUrl}}/pickups/{{pickupNumber}}/complete` |

**Path parameters**

| Name | Description |
|------|-------------|
| `pickupNumber` | Pickup identifier (e.g. from `GET /pickups` or `GET /pickups/:pickupNumber/details`) |

**Body**

Empty JSON object `{}` is fine (controller does not require fields).

**Success — `200 OK`**

```json
{
  "message": "Pickup completed successfully"
}
```

**Typical errors**

| Status | Body / meaning |
|--------|----------------|
| `401` | Missing or invalid JWT |
| `404` | Pickup not found or not assigned to this courier |
| `400` | Pickup canceled, rejected, already completed, already in stock, already in `pickedUp`, or **no orders** in `ordersPickedUp` |
| `500` | Server error |

**Mobile handling**

1. Call `GET /pickups/:pickupNumber/details` to show orders and status.
2. When the courier confirms all orders are loaded, call **`PUT .../complete`**.
3. On `200`, refresh pickup list and show success; on `400`, show `message` from JSON to the user.

---

## 2. Return pickup from customer (with OTP)

When `orderStatus` is `returnAssigned`, the customer should have received a **6-digit OTP** by SMS (issued when admin assigned the courier). The courier must send that OTP in the body.

| Item | Value |
|------|--------|
| **Method** | `POST` |
| **Path** | `/orders/:orderNumber/pickup-return` |
| **Full URL** | `{{baseUrl}}/orders/{{orderNumber}}/pickup-return` |

**Path parameters**

| Name | Description |
|------|-------------|
| `orderNumber` | Return order number, **or** original deliver order number, **or** smart flyer barcode (controller resolves the return order) |

**Body (JSON)**

```json
{
  "otp": "123456",
  "notes": "Optional notes",
  "pickupLocation": "Optional",
  "returnCondition": "Optional",
  "returnValue": 0
}
```

- **`otp`**: Required when the order has an issued `returnOtp` (normal flow). Six digits from the customer’s SMS.
- **`notes`**, etc.: Optional.

**Discover OTP requirement**

`GET /returns/:orderNumber/details` → check `returnOtpInfo`:

```json
{
  "returnOtpInfo": {
    "otpRequired": true,
    "otpIssuedAt": "2026-04-18T10:00:00.000Z",
    "otpExpiresAt": "2026-04-19T10:00:00.000Z",
    "otpVerified": false,
    "isLegacy": false
  }
}
```

- If `otpRequired` is `true`, show an OTP field before calling `POST pickup-return`.
- If `isLegacy` is `true` and there is no OTP on file, the server may allow pickup without OTP (legacy orders); still send other fields as needed.

**Success — `200 OK`**

```json
{
  "success": true,
  "message": "Return picked up successfully",
  "orderNumber": "<return order number>",
  "orderStatus": "returnPickedUp",
  "currentStage": "Picked Up from Customer",
  "nextAction": "Deliver to warehouse",
  "progressPercentage": 38,
  "order": { "...": "updated return document (list shape; otpHash removed)" }
}
```

Use **`order`** + **`orderStatus`** / **`nextAction`** on the client to **immediately** show the warehouse step (no second request). The server also sends an FCM **`return_deliver_warehouse`** assignment push and optional Socket.IO **`return-order-updated`** (see [postman-courier-return-process-api.md](./postman-courier-return-process-api.md)).

**Typical errors (`400`)**

| Message (examples) |
|----------------------|
| `Return OTP is required to confirm pickup from customer.` |
| `Invalid OTP. Please ask the customer to check their SMS and try again.` |
| `Return OTP has expired. Ask the admin to resend it.` |
| Wrong `orderStatus` (not `returnAssigned`) |

**Mobile handling**

1. From returns list, open details: `GET /returns/:orderNumber/details`.
2. If `returnOtpInfo.otpRequired`, prompt for OTP (numeric keypad, 6 digits).
3. `POST /orders/:orderNumber/pickup-return` with `{ "otp": "..." }`.
4. On success, **merge `order` into local state** and show the primary action **Deliver to warehouse** (same screen is fine). Do **not** require pull-to-refresh before showing that step. When the courier is at the warehouse, call `POST /orders/:orderNumber/deliver-to-warehouse`.

---

## 3. Related return endpoints (same base + auth)

| Method | Path | Purpose |
|--------|------|--------|
| `GET` | `/returns` | List return orders (query `status`, `page`, `limit`) |
| `GET` | `/returns/:orderNumber/details` | Return detail + `returnOtpInfo` |
| `POST` | `/orders/:orderNumber/deliver-to-warehouse` | After pickup, deliver return to warehouse |
| `POST` | `/orders/:orderNumber/complete-return-to-business` | Final leg to business when status allows |

---

## 4. Courier web (`/courier/*`) — discontinued

Browser routes under **`/courier`** (cookie session) now respond with **`410 Gone`** and JSON code `COURIER_WEB_DEPRECATED` (or a short HTML page without JSON `Accept`).

The mobile app must use **`/api/v1/courier`** only.

---

## Postman collection hints

1. Create environment variables: `baseUrl` = `https://host/api/v1/courier`, `token` = JWT string.
2. Collection auth: Type **Bearer Token**, token `{{token}}`.
3. Folder **Pickups**: save `PUT {{baseUrl}}/pickups/{{pickupNumber}}/complete`.
4. Folder **Returns**: save `GET {{baseUrl}}/returns/{{orderNumber}}/details` and `POST {{baseUrl}}/orders/{{orderNumber}}/pickup-return` with raw JSON body.

See also: [return-pickup-otp-api.md](./return-pickup-otp-api.md) for OTP + admin resend. Full return flow + Postman layout: [postman-courier-return-process-api.md](./postman-courier-return-process-api.md).
