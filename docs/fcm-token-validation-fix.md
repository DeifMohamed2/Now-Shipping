# FCM Token Validation Error Fix

## Issue Description

The application was experiencing errors when sending notifications to business users:

```
Token validation failed: Auth error from APNS or Web Push Service
Error in sendNotificationWithValidation: Error: FCM token is invalid and has been cleaned up
```

## Root Cause

1. **Token Validation Too Strict**: The `validateAndCleanupToken()` function was only checking for specific error codes (`invalid-registration-token`, `registration-token-not-registered`) but not handling APNS/Web Push authentication errors.

2. **Missing Error Handling**: When FCM returns "Auth error from APNS or Web Push Service", it indicates the token is invalid, but the code wasn't recognizing this as a cleanup-worthy error.

3. **Validation Blocking Sends**: The `sendNotificationWithValidation()` function would throw an error if validation failed, even for temporary failures that might still allow the notification to be sent.

## Solution Implemented

### 1. Enhanced Error Detection (`validateAndCleanupToken`)

**Before:**
- Only checked specific error codes
- Didn't handle APNS/Web Push auth errors

**After:**
- Checks for additional error codes: `messaging/invalid-argument`
- Detects APNS/Web Push auth errors by checking error message content
- Better logging with error context
- Distinguishes between permanent invalid tokens and temporary failures

### 2. Improved Validation Logic (`sendNotificationWithValidation`)

**Before:**
- Would throw error immediately if validation failed
- Didn't verify if token was actually cleaned up

**After:**
- Checks if token was actually cleaned up before throwing error
- Allows sending notification even if validation fails temporarily
- Better error handling with automatic cleanup on send failure
- More resilient to temporary network issues

## Code Changes

### File: `config/firebase.js`

#### `validateAndCleanupToken()` Function
- Added detection for APNS/Web Push auth errors
- Added `messaging/invalid-argument` to invalid token codes
- Improved error logging with context
- Better distinction between permanent and temporary failures

#### `sendNotificationWithValidation()` Function
- Checks if token was actually cleaned up before throwing error
- Attempts to send notification even if validation fails temporarily
- Enhanced error handling with automatic cleanup on send failure

## Testing

To verify the fix works:

1. **Test with Invalid Token**:
   ```bash
   # Should clean up token and return appropriate error
   POST /api/notifications/send-to-business
   {
     "businessId": "67d804fdce71db0999e3aff4",
     "title": "Test",
     "body": "Test message"
   }
   ```

2. **Test Token Validation**:
   ```bash
   POST /api/notifications/test-token
   {
     "userId": "67d804fdce71db0999e3aff4",
     "userType": "business"
   }
   ```

3. **Clean Up All Invalid Tokens**:
   ```bash
   POST /api/notifications/cleanup-tokens
   ```

## Expected Behavior After Fix

1. **Invalid Tokens**: 
   - Detected and cleaned up automatically
   - User receives clear error message
   - Token removed from database

2. **Temporary Failures**:
   - Validation failure doesn't block notification send
   - System attempts to send anyway
   - Only permanent errors trigger cleanup

3. **Better Logging**:
   - More detailed error context
   - Clear indication of what action was taken
   - Easier debugging

## User Impact

- **Business Users**: Will need to log in via mobile app to get new FCM token if their token was invalid
- **System**: Automatically handles token cleanup, reducing manual intervention
- **Notifications**: More resilient to temporary failures while still cleaning up invalid tokens

## Related Files

- `config/firebase.js` - Main Firebase configuration and notification functions
- `controllers/notificationController.js` - Notification endpoints
- `serviceAccountKey.json` - Business Firebase project credentials
- `serviceAccountKey-Courier.json` - Courier Firebase project credentials

## Future Improvements

1. **Token Refresh**: Implement automatic token refresh mechanism
2. **Retry Logic**: Add retry logic for temporary failures
3. **Monitoring**: Add metrics for token validation success/failure rates
4. **User Notification**: Notify users when their FCM token is invalid

