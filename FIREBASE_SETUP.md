# Firebase Configuration Guide for Now Shipping

This guide explains how to properly configure Firebase Cloud Messaging (FCM) for the Now Shipping platform, ensuring that both the backend server and the Flutter app use the same Firebase project.

## Current Configuration Issue

The "SenderId mismatch" error occurs when the Firebase project used by the Flutter app is different from the one used by the backend server. This needs to be fixed by ensuring both components use the same Firebase project.

## Solution: Update the Backend to Match the Flutter App

Since the Flutter app is already configured with a specific Firebase project (Sender ID: 216492662889), we need to update the backend to use the same project:

1. **Access the Flutter app's Firebase project:**
   - Go to the [Firebase Console](https://console.firebase.google.com/)
   - Sign in with the Google account that has access to the Flutter app's Firebase project
   - Select the project with the Sender ID: 216492662889

2. **Generate a new Service Account Key for the backend:**
   - In the Firebase Console, click the gear icon (⚙️) next to "Project Overview" to open Project settings
   - Navigate to the "Service accounts" tab
   - Click "Generate new private key" button
   - Save the downloaded JSON file as `serviceAccountKey.json`
   - Replace the existing `serviceAccountKey.json` in the project root with this new file

3. **Restart the backend server:**
   - After replacing the service account key, restart your Node.js server
   - The Firebase Admin SDK will initialize with the new credentials

## Verification Steps

After making these changes, follow these steps to verify the fix:

1. **Restart the backend server**
   ```
   npm start
   ```

2. **Check server logs:**
   - Look for the message "Firebase Admin SDK initialized successfully for project: [project-id]"
   - The project ID should match the one from the Flutter app's Firebase project

3. **Test FCM functionality:**
   - Run the Flutter app on a real device
   - Log in to register the FCM token with the server
   - Send a test notification from the admin panel
   - Verify that the notification is received on the device

## How to Find the Correct Firebase Project

If you're not sure which Firebase project the Flutter app is using:

1. **Check the google-services.json file:**
   - Look in `track_courier/android/app/google-services.json`
   - Find the "project_number" field - this is the Sender ID (216492662889)
   - Find the "project_id" field - this is the Firebase project ID

2. **Check the GoogleService-Info.plist file (for iOS):**
   - Look in `track_courier/ios/Runner/GoogleService-Info.plist`
   - Find the "GCM_SENDER_ID" key - this is the Sender ID

## Troubleshooting

### Still Getting SenderId Mismatch

If you still get the SenderId mismatch error after updating the serviceAccountKey.json:

1. **Verify the Firebase project:**
   - Make sure you've selected the correct Firebase project in the console
   - Confirm the project number (Sender ID) matches the one in the Flutter app (216492662889)

2. **Check for multiple Firebase initializations:**
   - Ensure you're not initializing Firebase Admin SDK multiple times with different credentials
   - Look for any other serviceAccountKey files that might be loaded elsewhere

3. **Clear cached tokens:**
   - Have users log out and log back in to refresh their FCM tokens
   - Or manually clear the FCM tokens in the database and have users log in again

### Invalid FCM Token

If a courier's FCM token becomes invalid, the system will now automatically set it to null in the database. The courier will need to log in again to register a new token.

## Security Considerations

- Never commit the `serviceAccountKey.json` file to version control
- Add it to your `.gitignore` file
- Consider using environment variables for sensitive Firebase configuration in production 