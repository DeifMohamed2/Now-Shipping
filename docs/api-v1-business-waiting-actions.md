# Business API — Waiting-action order endpoints (mobile)

This document describes the **POST** routes used when a delivery order is in **waiting for business action** (e.g. customer unavailable, rescheduled, etc.). They are protected by the same JWT auth as the rest of ` /api/v1/business `.

**Source:** [routes/api/v1/business.js](../routes/api/v1/business.js) (lines near “WAITING ACTION APIs”)  
**Logic:** [controllers/businessController.js](../controllers/businessController.js) (`retryTomorrow`, `retryScheduled`, `returnToWarehouseFromWaiting`, `cancelFromWaiting`)  
**Eligibility rules:** [utils/orderWaitingActionPolicy.js](../utils/orderWaitingActionPolicy.js)

---

## Base URL and authentication

| Item | Value |
|------|--------|
| **Base path** | `{origin}/api/v1/business` |
| **Example (local)** | `http://localhost:3000/api/v1/business` |
| **Auth** | `Authorization: Bearer <JWT>` |
| **JWT** | Obtained from your existing login/sign-in flow for **business** users (`userId` in payload). |
| **Body parsing** | `Content-Type: application/json` (recommended). `application/x-www-form-urlencoded` works for `retry-scheduled` if `date` is present. |
| **401** | Missing/invalid `Authorization` header, invalid/expired token, or user not found. Response shape: `{ "message": "Unauthorized" }`. |

**Important:** The path parameter **`orderId`** can be either:

- the order’s **MongoDB `_id`** (24 hex characters), or  
- the order’s **human-readable `orderNumber`** (e.g. `9997334573`).

The server resolves the order the same way for all four endpoints.

---

## When to show which button (for mobile UI)

Call **GET** ` /api/v1/business/order-details/:orderNumber ` (existing endpoint) and read the nested object on the order:

`response.order.waitingAction` (boolean flags):

| Key | Meaning |
|-----|--------|
| `canRetryTomorrow` | Show “Retry tomorrow” (only if `orderStatus === 'waitingAction'`). |
| `canRetryScheduled` | Show “Schedule retry” (if status is `waitingAction` or `rescheduled`). |
| `canReturnToWarehouseFromWaiting` | Show “Return to warehouse” (only `waitingAction`). |
| `canCancelFromWaiting` | Show “Return from waiting” / cancel-from-waiting (only `waitingAction`). |

**Do not** offer an action if the corresponding flag is `false` — the POST will return **400** with `code: "INVALID_STATUS"`.

---

## 1. Retry tomorrow

Schedules a retry **24 hours from now** and sets status to `rescheduled`.

| | |
|---|---|
| **Method** | `POST` |
| **Path** | `/api/v1/business/orders/:orderId/retry-tomorrow` |
| **Body** | None |

### Eligibility

- Order must belong to the authenticated business.
- `order.orderStatus` must be **`waitingAction`**.

### Success — `200 OK`

```json
{
  "message": "Retry scheduled for tomorrow"
}
```

**Side effect (conceptual):** `scheduledRetryAt` is set to now + 24h, `orderStatus` becomes `rescheduled`, in-progress stage notes updated.

### Errors

| HTTP | `code` (if present) | When |
|------|----------------------|------|
| 404 | — | Order not found (bad id/number) |
| 403 | — | Order belongs to another business |
| 400 | `INVALID_STATUS` | Not in `waitingAction` |
| 500 | — | Server error (`error` string) |

**Example 400**

```json
{
  "error": "This action is only available when the order is waiting for your action.",
  "code": "INVALID_STATUS",
  "currentStatus": "headingToCustomer"
}
```

---

## 2. Schedule retry (specific date)

Sets `scheduledRetryAt` to the given datetime and sets status to `rescheduled`.

| | |
|---|---|
| **Method** | `POST` |
| **Path** | `/api/v1/business/orders/:orderId/retry-scheduled` |
| **Content-Type** | `application/json` |

### Body (JSON)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `date` | string (ISO-8601) | **Yes** | When to retry, e.g. `2026-04-25T14:30:00.000Z` or local offset string parseable by `new Date()`. |

### Eligibility

- Order belongs to the business.
- `orderStatus` is **`waitingAction`** or **`rescheduled`**.
- `date` must be **in the future** (about **60 seconds** past is allowed for clock skew).
- `date` must not be more than **90 days** in the future.

### Success — `200 OK`

```json
{
  "message": "Retry scheduled"
}
```

### Errors

| HTTP | `code` | Typical `error` text |
|------|--------|----------------------|
| 400 | `INVALID_STATUS` | Not `waitingAction` / `rescheduled` |
| 400 | `MISSING_DATE` | No `date` in body |
| 400 | `INVALID_DATE` | Unparseable date |
| 400 | `DATE_IN_PAST` | `date` is before “now - 1 min” |
| 400 | `DATE_TOO_FAR` | More than 90 days ahead |
| 404 / 403 / 500 | — | Same as above |

**Example 400 (bad date)**

```json
{
  "error": "Retry must be scheduled in the future",
  "code": "DATE_IN_PAST",
  "currentStatus": "waitingAction"
}
```

---

## 3. Return to warehouse (from waiting)

Moves the order toward **return to warehouse** processing (status `returnToWarehouse`).

| | |
|---|---|
| **Method** | `POST` |
| **Path** | `/api/v1/business/orders/:orderId/return-to-warehouse` |
| **Body** | None |

### Eligibility

- Order belongs to the business.
- `orderStatus` must be **`waitingAction`**.

### Success — `200 OK`

```json
{
  "message": "Order moved to return stock"
}
```

### Errors

Same pattern as “Retry tomorrow” (404, 403, 400 `INVALID_STATUS`, 500).

---

## 4. Cancel from waiting (return pipeline)

Intended for the **“action required”** banner: does **not** use the full generic cancel flow; it sets status to `returnToWarehouse` and updates return-related stages (return pipeline).

| | |
|---|---|
| **Method** | `POST` |
| **Path** | `/api/v1/business/orders/:orderId/cancel-from-waiting` |
| **Body** | None |

### Eligibility

- Order belongs to the business.
- `orderStatus` must be **`waitingAction`**.

### Success — `200 OK`

```json
{
  "message": "Order moved to return pipeline"
}
```

**Note:** On the **web** app, the same handler is also mounted as `POST /business/orders/:orderId/cancel` (alias). Mobile should use the API path above.

### Errors

Same as section 1 (400 `INVALID_STATUS` when not `waitingAction`).

---

## Quick reference: HTTP status and `code` values

| `code` | Meaning |
|--------|--------|
| `INVALID_STATUS` | Order is not in the right `orderStatus` for this action. |
| `MISSING_DATE` | `retry-scheduled` without `date`. |
| `INVALID_DATE` | `date` not parseable. |
| `DATE_IN_PAST` | Retry time must be in the future. |
| `DATE_TOO_FAR` | Retry more than 90 days ahead. |

---

## cURL examples

Replace `TOKEN`, `BASE`, and `ORDER` (id or number).

```bash
# 1) Retry tomorrow
curl -X POST "$BASE/api/v1/business/orders/$ORDER/retry-tomorrow" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json"

# 2) Schedule retry
curl -X POST "$BASE/api/v1/business/orders/$ORDER/retry-scheduled" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-04-26T10:00:00.000Z"}'

# 3) Return to warehouse
curl -X POST "$BASE/api/v1/business/orders/$ORDER/return-to-warehouse" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json"

# 4) Cancel from waiting
curl -X POST "$BASE/api/v1/business/orders/$ORDER/cancel-from-waiting" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json"
```

---

## Postman: import the collection

**Import file (recommended):** [postman-waiting-actions.postman_collection.json](postman-waiting-actions.postman_collection.json) in this folder (Postman **Import** → file).

Set collection variables: **`baseUrl`**, **`token`**, **`orderId`** (Mongo `_id` or order number), and **`orderNumber`** for the helper GET (same string you use in `GET /order-details/:orderNumber`).

The collection includes a fifth request: **GET order-details** to read `order.waitingAction` before calling POSTs.

---

## Changelog (for product)

- `orderId` in the path accepts **order number** or **Mongo _id** (no more cast errors from numeric ids).
- `retry-scheduled` validates **future** date and **90-day** max.
- All four return structured **400** with `code` and `currentStatus` when status is wrong.
- **GET** `order-details` exposes **`waitingAction`** on the order object for mobile to mirror the web.
