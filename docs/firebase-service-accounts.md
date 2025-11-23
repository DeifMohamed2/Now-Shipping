# Firebase Service Account Keys Usage

## Overview

This application uses **two separate Firebase projects** to handle push notifications:
1. **Business Project** (`now-shipping-9a90f`) - For business users
2. **Courier Project** (`now-courier-a67ad`) - For courier users

## Service Account Key Files

### 1. `serviceAccountKey.json`
- **Project**: `now-shipping-9a90f`
- **Purpose**: Used for sending notifications to **business users**
- **Location**: Root directory
- **Usage**: Initialized as `businessApp` in `config/firebase.js`

### 2. `serviceAccountKey-Courier.json`
- **Project**: `now-courier-a67ad`
- **Purpose**: Used for sending notifications to **courier users**
- **Location**: Root directory
- **Usage**: Initialized as `courierApp` in `config/firebase.js`

## Security

⚠️ **IMPORTANT**: Both service account key files are in `.gitignore` and should **NEVER** be committed to version control.

## How It Works

### Initialization (config/firebase.js)

```javascript
// Business Firebase App
const serviceAccountBusiness = require('../serviceAccountKey.json');
businessApp = admin.initializeApp({
  credential: admin.credential.cert(serviceAccountBusiness),
  projectId: serviceAccountBusiness.project_id
}, 'business');

// Courier Firebase App
const serviceAccountCourier = require('../serviceAccountKey-Courier.json');
courierApp = admin.initializeApp({
  credential: admin.credential.cert(serviceAccountCourier),
  projectId: serviceAccountCourier.project_id
}, 'courier');
```

### Selecting the Right App

The `getMessagingInstance(userType)` function automatically selects the correct Firebase app:

- `userType === 'business'` → Uses `businessApp` (serviceAccountKey.json)
- `userType === 'courier'` → Uses `courierApp` (serviceAccountKey-Courier.json)

## Usage in Controllers

### Notification Controller
- `sendNotificationToBusiness()` → Uses `businessApp`
- `sendNotificationToCourier()` → Uses `courierApp`
- `sendNotificationToAllBusinesses()` → Uses `businessApp`
- `sendNotificationToAllCouriers()` → Uses `courierApp`

### Business Controller
- `sendOrderStatusNotification()` → Uses `businessApp` (for business users)

### Courier Controller
- `sendOrderStatusNotification()` → Uses `businessApp` (notifies business about order status)

### Admin Controller
- `sendPickupAssignmentNotification()` → Uses `courierApp`
- `sendPickupStatusNotification()` → Uses `businessApp`
- `sendCourierAssignmentNotification()` → Uses `courierApp`
- `sendShopOrderStatusNotification()` → Uses `businessApp`
- `sendShopOrderAssignmentNotification()` → Uses `courierApp`

### Background Jobs
- `dailyOrderProcessing.js` → Uses `businessApp` (financial notifications)
- `releasesProccessing.js` → Uses `businessApp` (financial notifications)

## FCM Token Validation

The system includes automatic token validation and cleanup:

1. **validateAndCleanupToken()**: Validates a token by sending a test message
   - If token is invalid → Cleans up from database
   - Handles errors: `invalid-registration-token`, `registration-token-not-registered`, APNS/Web Push auth errors

2. **sendNotificationWithValidation()**: Sends notification with automatic validation
   - Validates token first
   - If invalid → Cleans up and throws error
   - If validation fails temporarily → Still attempts to send

## Common Issues

### Error: "Auth error from APNS or Web Push Service"
- **Cause**: FCM token is invalid or from wrong Firebase project
- **Solution**: Token is automatically cleaned up. User needs to log in via mobile app to get new token

### Error: "FCM token is invalid and has been cleaned up"
- **Cause**: Token validation failed and token was removed from database
- **Solution**: User must log in via mobile app to set a new FCM token

### Token Mismatch
- **Issue**: Business user token registered with courier project (or vice versa)
- **Solution**: Ensure mobile apps are using the correct Firebase project for each user type

## Testing

To test token validation:
```javascript
// Test specific user token
POST /api/notifications/test-token
{
  "userId": "user_id",
  "userType": "business" // or "courier"
}

// Clean up all invalid tokens
POST /api/notifications/cleanup-tokens
```

## File Locations

- **Config**: `config/firebase.js`
- **Service Account Keys**: 
  - `serviceAccountKey.json` (Business)
  - `serviceAccountKey-Courier.json` (Courier)
- **Controllers Using Firebase**:
  - `controllers/notificationController.js`
  - `controllers/businessController.js`
  - `controllers/courierController.js`
  - `controllers/adminController.js`
- **Background Jobs**:
  - `jobs/dailyOrderProcessing.js`
  - `jobs/releasesProccessing.js`

