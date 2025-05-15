# How to Download the Correct Firebase Service Account Key

Follow these steps to download a service account key from the correct Firebase project for the Now Shipping application.

## Step 1: Access the Firebase Console

1. Go to the [Firebase Console](https://console.firebase.google.com/)
2. Sign in with the Google account that has access to the Firebase project

## Step 2: Select the Correct Project

1. From the Firebase console homepage, find and select the project named "now-shipping"
2. Verify the project number is "216492662889" (this can be found in the project settings)

## Step 3: Access Project Settings

1. Click on the gear icon (⚙️) next to "Project Overview" in the left sidebar
2. Select "Project settings" from the menu

## Step 4: Navigate to Service Accounts

1. In the Project settings page, click on the "Service accounts" tab
2. You should see "Firebase Admin SDK" section

## Step 5: Generate a New Private Key

1. Scroll down to the "Firebase Admin SDK" section
2. Click the "Generate new private key" button
3. A confirmation dialog will appear - click "Generate key"
4. The JSON file will be automatically downloaded to your computer

## Step 6: Rename and Move the File

1. Rename the downloaded file to `serviceAccountKey.json`
2. Move this file to the root directory of your Now Shipping backend project
3. This will replace the existing `serviceAccountKey.json` file

## Step 7: Update Your .gitignore File

Make sure the service account key is not committed to version control:

1. Open your `.gitignore` file
2. Add the following line if it's not already there:
   ```
   serviceAccountKey.json
   ```

## Step 8: Restart Your Server

After replacing the service account key:

1. Stop your Node.js server if it's running
2. Start it again:
   ```
   npm start
   ```
3. Check the console logs for: "Firebase Admin SDK initialized successfully for project: now-shipping"

## Verification

To verify that the configuration is working:

1. Run the Flutter app on a real device
2. Log in to register the FCM token
3. Send a test notification from the admin panel
4. The notification should be received on the device without any "SenderId mismatch" errors

## Important Security Note

The service account key grants administrative access to your Firebase project. Always keep it secure and never commit it to public repositories. 