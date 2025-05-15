# Firebase Cloud Messaging (FCM) Setup Guide for Track Courier App

This guide will help you set up Firebase Cloud Messaging (FCM) for the Track Courier Flutter app to receive push notifications from the Now Shipping backend.

## 1. Create a Firebase Project

1. Go to the [Firebase Console](https://console.firebase.google.com/)
2. Click "Add project" and follow the setup wizard
3. Enter a project name (e.g., "Now Shipping Courier")
4. Enable Google Analytics if needed
5. Click "Create project"

## 2. Register Your Flutter App with Firebase

### For Android:

1. In the Firebase Console, click on your project
2. Click the Android icon (</>) to add an Android app
3. Enter your Android package name (found in `android/app/build.gradle` under `applicationId`)
4. (Optional) Enter a nickname for your app
5. Click "Register app"
6. Download the `google-services.json` file
7. Place it in the `android/app/` directory of your Flutter project
8. Click "Next" to continue with the Firebase setup wizard
9. Follow the steps to add the Firebase SDK to your app (already done in our codebase)

### For iOS:

1. In the Firebase Console, click on your project
2. Click the iOS icon (</>) to add an iOS app
3. Enter your iOS bundle ID (found in Xcode under the "General" tab of your project settings)
4. (Optional) Enter a nickname for your app
5. Click "Register app"
6. Download the `GoogleService-Info.plist` file
7. Place it in the `ios/Runner` directory of your Flutter project using Xcode
8. Click "Next" to continue with the Firebase setup wizard
9. Follow the steps to add the Firebase SDK to your app (already done in our codebase)

## 3. Generate Firebase Service Account Key for Backend

1. In the Firebase Console, go to Project Settings
2. Navigate to the "Service accounts" tab
3. Click "Generate new private key" button
4. Download the JSON file
5. Rename it to `serviceAccountKey.json`
6. Place this file in the root of your Node.js project
7. Make sure to add it to .gitignore to keep it secure

## 4. Update Configuration Files

### Update AppConfig

Open `lib/utils/config.dart` and update the API URL and FCM Sender ID:

```dart
class AppConfig {
  // API Base URL
  static const String apiBaseUrl = 'https://your-api-url.com'; // Replace with your actual API URL
  
  // FCM and Notification settings
  static const String fcmSenderId = '123456789012'; // Replace with your FCM Sender ID
  // ... rest of the config
}
```

### Android Configuration

The Android configuration for FCM is already set up in the codebase. The necessary permissions, dependencies, and metadata have been added to the appropriate files.

### iOS Configuration

For iOS, you need to enable push notifications in your Xcode project:

1. Open your iOS project in Xcode
2. Select your project in the project navigator
3. Select the "Runner" target
4. Go to the "Signing & Capabilities" tab
5. Click "+ Capability" and add "Push Notifications"
6. Also add the "Background Modes" capability
7. Enable "Remote notifications" in the Background Modes section

## 5. Test Push Notifications

1. Start your Flutter app on a real device (FCM doesn't work reliably on emulators)
2. Log in to the app to register the FCM token with the server
3. Go to the Firebase Console
4. Navigate to "Messaging" in the left sidebar
5. Click "Send your first message"
6. Write a test notification
7. Select your app under "Target"
8. Complete the message and click "Review"
9. Click "Publish" to send the test notification

You should receive the notification on your device. If not, check the following:

1. Make sure your device is connected to the internet
2. Check the app logs for any FCM token registration errors
3. Verify that the token was successfully sent to the server
4. Check Firebase Console logs for any delivery errors

## 6. Troubleshooting

If you encounter issues with FCM:

1. **Token not being generated or saved:**
   - Check the app logs for any Firebase initialization errors
   - Ensure your `google-services.json` and `GoogleService-Info.plist` files are correctly placed
   - Verify internet connectivity

2. **Token not being sent to server:**
   - Check network connectivity
   - Verify API URL is correct in `config.dart`
   - Check authentication token is valid

3. **Notifications not being received:**
   - Check device notification settings for the app
   - Ensure background notification handling is properly set up
   - Verify the message payload format is correct

4. **iOS-specific issues:**
   - Ensure you have a valid Apple Push Notification service (APNs) certificate
   - Verify Push Notifications capability is enabled in Xcode
   - Check provisioning profile includes push notification entitlements

For more detailed troubleshooting, refer to the [Firebase documentation](https://firebase.google.com/docs/cloud-messaging/flutter/client). 