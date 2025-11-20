# Complete Order API Documentation

## Endpoint: Complete Order
**POST** `/api/v1/courier/orders/:orderNumber/complete`

### Description
This endpoint allows a courier to complete an order delivery. It handles different order types including standard deliveries, returns, exchanges, and cash collections. The endpoint requires OTP verification for non-return flows.

---

## Authentication
- **Type**: JWT Bearer Token or Session-based
- **Header**: `Authorization: Bearer <token>` (for API calls)
- **Cookie**: Session cookie (for web requests)

---

## Request Parameters

### Path Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `orderNumber` | String | Yes | The unique order number to complete |

### Headers
| Header | Value | Description |
|--------|-------|-------------|
| `Authorization` | Bearer {token} | JWT token for API authentication |
| `Content-Type` | application/json | Required for JSON requests |
| `Accept` | application/json | Required for JSON responses |

### Body Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `otp` | String | Conditional | Required for all non-return order completions. 6-digit OTP sent to customer |
| `collectionReceipt` | String | Optional | Receipt/proof for cash collection orders |
| `exchangePhotos` | Array[String] | Optional | Array of photo URLs for exchange orders (original/replacement items) |

---

## Order Status Flow

### Standard Delivery
- **Valid Starting Status**: `headingToCustomer`, `inStock`, `rescheduled`, `waitingAction`
- **Final Status**: `completed`
- **OTP Required**: ✅ Yes

### Return Orders
#### Return from Customer to Warehouse
- **Valid Starting Status**: `returnInProgress`
- **Final Status**: `inReturnStock`
- **OTP Required**: ❌ No

#### Return to Business
- **Valid Starting Status**: `headingToYou`
- **Final Status**: `returnCompleted`
- **OTP Required**: ❌ No

### Exchange Orders
#### Step 1: Exchange Pickup
- **Valid Starting Status**: `headingToCustomer`
- **Intermediate Status**: `exchangePickup`
- **OTP Required**: ✅ Yes
- **Optional**: `exchangePhotos` (photos of original item)

#### Step 2: Exchange Delivery
- **Valid Starting Status**: `exchangePickup`
- **Final Status**: `completed`
- **OTP Required**: ✅ Yes
- **Optional**: `exchangePhotos` (photos of replacement item)

### Cash Collection Orders
- **Valid Starting Status**: `headingToCustomer`
- **Intermediate Status**: `collectionComplete`
- **Final Status**: `completed`
- **OTP Required**: ✅ Yes
- **Optional**: `collectionReceipt` (proof of collection)

---

## Response Codes

| Status Code | Description |
|-------------|-------------|
| 200 | Order completed successfully |
| 400 | Bad request (invalid status, invalid/expired OTP, missing OTP) |
| 401 | Unauthorized (missing or invalid authentication) |
| 404 | Order not found or not assigned to this courier |
| 500 | Internal server error |

---

## Request Examples

### Example 1: Standard Delivery Completion
```json
POST /api/v1/courier/orders/ORD-12345/complete
Headers:
  Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
  Content-Type: application/json
  Accept: application/json

Body:
{
  "otp": "123456"
}
```

**Success Response (200)**
```json
{
  "message": "Order completed successfully"
}
```

---

### Example 2: Exchange Order - Step 1 (Pickup Original Item)
```json
POST /api/v1/courier/orders/ORD-12346/complete
Headers:
  Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
  Content-Type: application/json
  Accept: application/json

Body:
{
  "otp": "654321",
  "exchangePhotos": [
    "https://cloudinary.com/image1.jpg",
    "https://cloudinary.com/image2.jpg"
  ]
}
```

**Success Response (200)**
```json
{
  "message": "Order completed successfully"
}
```

**Note**: After this call, order status becomes `exchangePickup`. Call the endpoint again to complete the exchange delivery.

---

### Example 3: Exchange Order - Step 2 (Deliver Replacement Item)
```json
POST /api/v1/courier/orders/ORD-12346/complete
Headers:
  Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
  Content-Type: application/json
  Accept: application/json

Body:
{
  "otp": "654321",
  "exchangePhotos": [
    "https://cloudinary.com/replacement1.jpg",
    "https://cloudinary.com/replacement2.jpg"
  ]
}
```

**Success Response (200)**
```json
{
  "message": "Order completed successfully"
}
```

---

### Example 4: Cash Collection Order
```json
POST /api/v1/courier/orders/ORD-12347/complete
Headers:
  Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
  Content-Type: application/json
  Accept: application/json

Body:
{
  "otp": "789012",
  "collectionReceipt": "https://cloudinary.com/receipt.jpg"
}
```

**Success Response (200)**
```json
{
  "message": "Order completed successfully"
}
```

---

### Example 5: Return Order (No OTP Required)
```json
POST /api/v1/courier/orders/ORD-12348/complete
Headers:
  Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
  Content-Type: application/json
  Accept: application/json

Body: {}
```

**Success Response (200)**
```json
{
  "message": "Order completed successfully"
}
```

---

## Error Response Examples

### Error 1: Missing OTP
```json
{
  "message": "OTP is required to complete this order"
}
```

### Error 2: Invalid OTP
```json
{
  "message": "Invalid OTP"
}
```

### Error 3: Expired OTP
```json
{
  "message": "OTP expired. Ask admin to resend."
}
```

### Error 4: Invalid Order Status
```json
{
  "message": "Order status 'completed' does not allow completion"
}
```

### Error 5: Order Not Found
```json
{
  "message": "Order not found"
}
```

### Error 6: Unauthorized
```json
{
  "message": "Courier ID not found in request"
}
```

### Error 7: OTP Not Generated
```json
{
  "message": "Delivery OTP not generated. Please contact support."
}
```

---

## Business Logic Notes

### OTP Verification
- OTP is **required** for all non-return order completions
- OTP must be valid and not expired
- Failed OTP attempts are tracked in the system
- OTP is verified using bcrypt comparison
- After successful verification, `deliveryOtp.verifiedAt` is set

### Return Flow Detection
An order is considered a return flow if:
- `orderShipping.orderType === 'Return'`, OR
- `orderStatus === 'returnInProgress'`, OR
- `orderStatus === 'headingToYou'`

### Order Stages Updated
Different order types update different stages:

**Standard Delivery:**
- `delivered.isCompleted = true`
- All previous stages marked as completed

**Return to Warehouse:**
- `inProgress.isCompleted = true`

**Return to Business:**
- `delivered.isCompleted = true`

**Exchange Pickup:**
- `exchangePickup.isCompleted = true`
- `outForDelivery.isCompleted = true`

**Exchange Delivery:**
- `exchangeDelivery.isCompleted = true`

**Cash Collection:**
- `collectionComplete.isCompleted = true`

### Notifications Sent
Upon successful completion:
1. **SMS to Customer** (for completed orders)
   - Message: "NowShipping - {Brand}: Your order {orderNumber} has been delivered by {courierName}. Thank you!"

2. **Email to Business**
   - Professional order delivery notification with order details

3. **Push Notification to Business**
   - Firebase push notification about order completion

### Courier History
Each completion action adds an entry to `order.courierHistory` with:
- `courier`: Courier ID
- `assignedAt`: Timestamp
- `action`: Type of action (completed, delivered_to_warehouse, delivered_to_business, exchange_pickup, exchange_delivery, cash_collected)
- `notes`: Descriptive notes about the action

---

## Invalid Order Statuses for Completion

The following order statuses **cannot** be completed:
- `completed`
- `canceled`
- `rejected`
- `returned`
- `terminated`
- `returnCompleted`
- `new`
- `pickedUp`
- `inStock` (unless it's a valid starting status for the order type)
- `inReturnStock`
- `returnAssigned`
- `returnPickedUp`
- `returnAtWarehouse`
- `returnToBusiness`

---

## Testing Checklist

- [ ] Test standard delivery with valid OTP
- [ ] Test standard delivery with invalid OTP
- [ ] Test standard delivery with expired OTP
- [ ] Test standard delivery without OTP
- [ ] Test return order (no OTP required)
- [ ] Test exchange order - pickup step
- [ ] Test exchange order - delivery step
- [ ] Test cash collection order
- [ ] Test with invalid order status
- [ ] Test with order not assigned to courier
- [ ] Test with non-existent order
- [ ] Test without authentication
- [ ] Test with invalid authentication
- [ ] Verify SMS sent to customer
- [ ] Verify email sent to business
- [ ] Verify push notification sent to business

---

## Postman Collection Setup

### Environment Variables
```json
{
  "baseUrl": "http://localhost:3000",
  "courierToken": "your_jwt_token_here",
  "orderNumber": "ORD-12345",
  "validOtp": "123456"
}
```

### Pre-request Script (for OTP testing)
```javascript
// If testing, you may need to fetch the OTP from your test database
// or use a fixed test OTP for development environment
```

### Tests Script
```javascript
pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});

pm.test("Response has success message", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData.message).to.include("successfully");
});

pm.test("Response time is less than 2000ms", function () {
    pm.expect(pm.response.responseTime).to.be.below(2000);
});
```

---

## Rate Limiting
- No specific rate limiting mentioned in the code
- Consider implementing rate limiting for OTP verification attempts

## Security Considerations
1. OTP is hashed using bcrypt
2. OTP attempts are tracked
3. OTP expiration is enforced
4. Courier must be authenticated
5. Order must be assigned to the courier making the request
6. Failed OTP attempts are logged

---

## Related Endpoints
- `POST /api/v1/courier/orders/:orderNumber/assign` - Assign order to courier
- `GET /api/v1/courier/orders/:orderNumber` - Get order details
- `POST /api/v1/admin/orders/:orderNumber/resend-otp` - Resend OTP to customer

---

**Last Updated**: November 20, 2025
**API Version**: v1
**Maintained By**: Development Team

