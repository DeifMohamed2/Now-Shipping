# Create Order API Documentation

## Endpoint
**POST** `/business/create-order`

## Authorization
- **Type**: Bearer Token
- **Required**: ✅ Yes
- **Header**: `Authorization: Bearer <token>`

## Request Body (JSON)

### Common Fields (Required for All Order Types)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `fullName` | string | ✅ | Customer's full name |
| `phoneNumber` | string | ✅ | Customer's phone number |
| `address` | string | ✅ | Detailed delivery address |
| `government` | string | ✅ | Customer's governorate (Cairo, Giza, Alexandria) |
| `zone` | string | ✅ | Customer's delivery zone |
| `orderType` | string | ✅ | One of: `Deliver`, `Return`, `Exchange`, `Cash Collection` |

### Optional Common Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `previewPermission` | string | ❌ | `"on"` to allow package inspection before delivery |
| `referralNumber` | string | ❌ | Optional referral code |
| `Notes` | string | ❌ | Special delivery instructions or notes |
| `isExpressShipping` | boolean/string | ❌ | `true` or `"on"` for express shipping (doubles the fee) |

---

## Order Type Specific Fields

### 1. Deliver Order

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `productDescription` | string | ✅ | Description of products being delivered |
| `numberOfItems` | number | ✅ | Number of items to deliver |
| `COD` | boolean | ❌ | `true` if Cash on Delivery is selected |
| `amountCOD` | number | ❌ | COD amount (required if COD is true) |

### 2. Exchange Order

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `currentPD` | string | ✅ | Current product description (items being returned) |
| `numberOfItemsCurrentPD` | number | ✅ | Number of current items |
| `newPD` | string | ✅ | New product description (replacement items) |
| `numberOfItemsNewPD` | number | ✅ | Number of new items |
| `CashDifference` | boolean | ❌ | `true` if there's a cash difference |
| `amountCashDifference` | number | ❌ | Cash difference amount (required if CashDifference is true) |

### 3. Cash Collection Order

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `amountCashCollection` | number | ✅ | Amount to collect from customer |

### 4. Return Order

#### Full Return Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `productDescription` | string | ✅ | Description of products being returned |
| `numberOfItems` | number | ✅ | Number of items to return |
| `originalOrderNumber` | string | ✅ | Order number of the completed deliver order |
| `returnReason` | string | ✅ | Reason for return (see options below) |
| `returnNotes` | string | ❌ | Additional notes about the return |

#### Partial Return Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `isPartialReturn` | boolean/string | ✅ | `true` or `"true"` for partial return |
| `partialReturnItemCount` | number | ✅ | Number of items to return (for partial returns) |
| `originalOrderItemCount` | number | ❌ | Total items in original order |
| `productDescription` | string | ✅ | Description of products being returned |
| `originalOrderNumber` | string | ✅ | Order number of the completed deliver order |
| `returnReason` | string | ✅ | Reason for return (see options below) |
| `returnNotes` | string | ❌ | Additional notes about the return |

#### Return Reason Options

- `"Customer requested return"`
- `"Damaged product"`
- `"Wrong product"`
- `"Quality issues"`
- `"Size/Color mismatch"`
- `"Other"`

---

## Response Format

### Success Response (201 Created)

```json
{
  "message": "Order created successfully.",
  "order": {
    "_id": "orderId123",
    "orderNumber": "123456",
    "orderDate": "2025-01-08T18:08:04.348Z",
    "orderFees": 120,
    "returnFees": 0,
    "totalFees": 120,
    "orderStatus": "new",
    "statusCategory": "NEW",
    "Attemps": 0,
    "UnavailableReason": [],
    "orderCustomer": {
      "fullName": "Sarah Ali",
      "phoneNumber": "01012345678",
      "address": "Apartment 12, Nile Street",
      "government": "Cairo",
      "zone": "Dokki"
    },
    "orderShipping": {
      "productDescription": "Chocolate cake, 1kg",
      "numberOfItems": 1,
      "productDescriptionReplacement": "",
      "numberOfItemsReplacement": 0,
      "orderType": "Deliver",
      "amountType": "COD",
      "amount": 200,
      "isExpressShipping": false,
      "originalOrderNumber": null,
      "returnReason": null,
      "returnNotes": null,
      "isPartialReturn": false,
      "originalOrderItemCount": null,
      "partialReturnItemCount": null
    },
    "referralNumber": "REF123",
    "isOrderAvailableForPreview": true,
    "orderNotes": "Handle with care",
    "orderStages": {
      "orderPlaced": {
        "isCompleted": true,
        "completedAt": "2025-01-08T18:08:04.348Z",
        "notes": "Order has been created."
      },
      "packed": {
        "isCompleted": false,
        "completedAt": null,
        "notes": ""
      },
      "shipping": {
        "isCompleted": false,
        "completedAt": null,
        "notes": ""
      },
      "inProgress": {
        "isCompleted": false,
        "completedAt": null,
        "notes": ""
      },
      "outForDelivery": {
        "isCompleted": false,
        "completedAt": null,
        "notes": ""
      },
      "delivered": {
        "isCompleted": false,
        "completedAt": null,
        "notes": ""
      }
    },
    "business": "67d804fdce71db0999e3aff4",
    "isMoneyRecivedFromCourier": false,
    "orderStatusHistory": [],
    "createdAt": "2025-01-08T18:08:04.359Z",
    "updatedAt": "2025-01-08T18:08:04.359Z",
    "__v": 0
  }
}
```

### Error Responses

#### 400 Bad Request - Missing Required Fields
```json
{
  "error": "All customer info fields are required."
}
```

#### 400 Bad Request - Missing Order Type Specific Fields
```json
{
  "error": "Deliver orders require product description and number of items."
}
```

#### 400 Bad Request - Return Order Validation
```json
{
  "error": "Return orders require product description, number of items, original order number, and return reason."
}
```

#### 400 Bad Request - Partial Return Validation
```json
{
  "error": "Partial return orders require partial return item count, product description, original order number, and return reason."
}
```

#### 400 Bad Request - Original Order Not Found
```json
{
  "error": "Original order not found or not eligible for return. Only completed deliver orders can be returned."
}
```

#### 400 Bad Request - Order Already Has Return
```json
{
  "error": "This order already has an associated return request."
}
```

#### 500 Internal Server Error
```json
{
  "error": "Internal server error. Please try again."
}
```

---

## Sample Request Bodies

### 1. Deliver Order
```json
{
  "fullName": "Sarah Ali",
  "phoneNumber": "01012345678",
  "address": "Apartment 12, Nile Street",
  "government": "Cairo",
  "zone": "Dokki",
  "orderType": "Deliver",
  "productDescription": "Chocolate cake, 1kg",
  "numberOfItems": 1,
  "COD": true,
  "amountCOD": 200,
  "previewPermission": "on",
  "referralNumber": "REF123",
  "Notes": "Handle with care",
  "isExpressShipping": false
}
```

### 2. Exchange Order
```json
{
  "fullName": "Ali Hassan",
  "phoneNumber": "01198765432",
  "address": "Building 8, Garden City",
  "government": "Cairo",
  "zone": "Garden City",
  "orderType": "Exchange",
  "currentPD": "White Sneakers - Size 42",
  "numberOfItemsCurrentPD": 1,
  "newPD": "White Sneakers - Size 43",
  "numberOfItemsNewPD": 1,
  "CashDifference": true,
  "amountCashDifference": 50,
  "previewPermission": "on",
  "Notes": "Please bring the new pair in original box",
  "isExpressShipping": false
}
```

### 3. Cash Collection Order
```json
{
  "fullName": "Mona Nabil",
  "phoneNumber": "01234567890",
  "address": "Flat 3, Zamalek Towers",
  "government": "Cairo",
  "zone": "Zamalek",
  "orderType": "Cash Collection",
  "amountCashCollection": 500,
  "previewPermission": "on",
  "Notes": "Cash to be collected by end of day",
  "isExpressShipping": false
}
```

### 4. Full Return Order
```json
{
  "fullName": "Ahmed Mohamed",
  "phoneNumber": "01567890123",
  "address": "Villa 5, New Cairo",
  "government": "Cairo",
  "zone": "New Cairo",
  "orderType": "Return",
  "productDescription": "Blue T-shirt, Size L",
  "numberOfItems": 1,
  "originalOrderNumber": "123456",
  "returnReason": "Size/Color mismatch",
  "returnNotes": "Customer wants different size",
  "isPartialReturn": false,
  "previewPermission": "on",
  "Notes": "Handle with care during return",
  "isExpressShipping": false
}
```

### 5. Partial Return Order
```json
{
  "fullName": "Fatma Ibrahim",
  "phoneNumber": "01987654321",
  "address": "Apartment 15, Heliopolis",
  "government": "Cairo",
  "zone": "Heliopolis",
  "orderType": "Return",
  "productDescription": "Mixed clothing items",
  "originalOrderNumber": "789012",
  "returnReason": "Quality issues",
  "returnNotes": "Some items have quality problems",
  "isPartialReturn": true,
  "partialReturnItemCount": 2,
  "originalOrderItemCount": 5,
  "previewPermission": "on",
  "Notes": "Return only the damaged items",
  "isExpressShipping": false
}
```

---

## Validation Rules

### General Validation
1. All customer info fields (`fullName`, `phoneNumber`, `address`, `government`, `zone`, `orderType`) are required for all order types
2. `orderType` must be one of: `Deliver`, `Return`, `Exchange`, `Cash Collection`

### Deliver Order Validation
1. `productDescription` and `numberOfItems` are required
2. If `COD` is true, `amountCOD` must be provided and > 0

### Exchange Order Validation
1. `currentPD`, `numberOfItemsCurrentPD`, `newPD`, `numberOfItemsNewPD` are required
2. If `CashDifference` is true, `amountCashDifference` must be provided and > 0

### Cash Collection Order Validation
1. `amountCashCollection` is required and must be > 0

### Return Order Validation
1. `originalOrderNumber` must reference a completed deliver order from the same business
2. `returnReason` is required and must be one of the predefined options
3. For full returns: `productDescription` and `numberOfItems` are required
4. For partial returns: `productDescription`, `partialReturnItemCount`, and `originalOrderNumber` are required
5. The original order must not already have an associated return request
6. The original order must have status `completed` and type `Deliver`

### Express Shipping
- `isExpressShipping` can be `true`, `"on"`, or `false`
- When enabled, it doubles the delivery fee

---

## Order Status Flow

### Deliver Orders
1. `new` → `pendingPickup` → `pickedUp` → `inStock` → `inProgress` → `headingToCustomer` → `completed`

### Return Orders
1. `new` → `returnInitiated` → `returnAssigned` → `returnPickedUp` → `returnAtWarehouse` → `returnInspection` → `returnProcessing` → `returnToBusiness` → `returnCompleted`

### Exchange Orders
1. `new` → `pendingPickup` → `pickedUp` → `inStock` → `inProgress` → `headingToCustomer` → `completed`

### Cash Collection Orders
1. `new` → `pendingPickup` → `pickedUp` → `inStock` → `inProgress` → `headingToCustomer` → `completed`

---

## Fee Calculation

Fees are calculated server-side based on:
- Government/Zone
- Order type
- Express shipping option
- Return processing (for return orders)

The system automatically calculates and applies the appropriate fees based on the order configuration.

---

## Notes

1. **Order Number**: Automatically generated as a 6-digit random number
2. **Business Association**: Orders are automatically associated with the authenticated business user
3. **Status Tracking**: Each order includes comprehensive status history and stage tracking
4. **Return Linking**: Return orders are automatically linked to their original deliver orders
5. **Partial Returns**: Only available for orders with multiple items
6. **Express Shipping**: Doubles the base delivery fee for faster service
7. **Validation**: All validation is performed server-side for security
8. **Error Handling**: Comprehensive error messages for different validation scenarios
