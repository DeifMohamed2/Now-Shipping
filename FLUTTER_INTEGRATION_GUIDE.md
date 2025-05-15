# Flutter Firebase Cloud Messaging (FCM) Integration Guide

This guide provides step-by-step instructions for integrating Firebase Cloud Messaging (FCM) into your Flutter courier app to receive push notifications from the Now Shipping backend.

## 1. Create a Firebase Project

1. Go to the [Firebase Console](https://console.firebase.google.com/)
2. Click "Add project" and follow the setup wizard
3. Enter a project name (e.g., "Now Shipping Notifications")
4. Enable Google Analytics if needed
5. Click "Create project"

## 2. Add Flutter App to Firebase Project

1. In the Firebase Console, click on your project
2. Click the Flutter icon (</>) to add a Flutter app
3. Register your app with your package name (e.g., `com.nowshipping.courier`)
4. Download the `google-services.json` file (for Android)
5. Follow the instructions to add it to your project
6. For iOS, download the `GoogleService-Info.plist` file and add it to your iOS project

## 3. Install Required Flutter Packages

Add the following dependencies to your `pubspec.yaml`:

```yaml
dependencies:
  firebase_core: ^2.15.0
  firebase_messaging: ^14.6.5
  flutter_local_notifications: ^15.1.0+1
```

Run:
```bash
flutter pub get
```

## 4. Configure Android

Update your `android/app/build.gradle`:

```gradle
dependencies {
    // ... other dependencies
    implementation platform('com.google.firebase:firebase-bom:32.2.0')
    implementation 'com.google.firebase:firebase-messaging'
}
```

Update your `android/app/src/main/AndroidManifest.xml` to add permissions:

```xml
<manifest>
    <!-- ... other entries -->
    <uses-permission android:name="android.permission.INTERNET"/>
    <uses-permission android:name="android.permission.VIBRATE" />
    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED"/>
    
    <application>
        <!-- ... other entries -->
        
        <!-- Add this for FCM notifications when app is in background -->
        <meta-data
            android:name="com.google.firebase.messaging.default_notification_channel_id"
            android:value="high_importance_channel" />
            
        <!-- Add this for FCM background message handling -->
        <meta-data
            android:name="firebase_messaging_auto_init_enabled"
            android:value="true" />
            
        <meta-data
            android:name="firebase_analytics_collection_enabled"
            android:value="true" />
    </application>
</manifest>
```

## 5. Configure iOS

Update your `ios/Runner/AppDelegate.swift`:

```swift
import UIKit
import Flutter
import FirebaseCore
import FirebaseMessaging

@UIApplicationMain
@objc class AppDelegate: FlutterAppDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    FirebaseApp.configure()
    
    if #available(iOS 10.0, *) {
      UNUserNotificationCenter.current().delegate = self
      let authOptions: UNAuthorizationOptions = [.alert, .badge, .sound]
      UNUserNotificationCenter.current().requestAuthorization(
        options: authOptions,
        completionHandler: {_, _ in })
    } else {
      let settings: UIUserNotificationSettings =
      UIUserNotificationSettings(types: [.alert, .badge, .sound], categories: nil)
      application.registerUserNotificationSettings(settings)
    }
    
    application.registerForRemoteNotifications()
    Messaging.messaging().delegate = self
    
    GeneratedPluginRegistrant.register(with: self)
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}

extension AppDelegate: MessagingDelegate {
  func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
    let dataDict: [String: String] = ["token": fcmToken ?? ""]
    NotificationCenter.default.post(
      name: Notification.Name("FCMToken"),
      object: nil,
      userInfo: dataDict
    )
  }
}
```

## 6. Implement FCM in Your Flutter App

Create a file called `firebase_messaging_service.dart`:

```dart
import 'dart:convert';
import 'dart:io';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

// Background message handler - must be a top-level function
@pragma('vm:entry-point')
Future<void> _firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp();
  print('Background message received: ${message.notification?.title}');
}

class FirebaseMessagingService {
  final FirebaseMessaging _firebaseMessaging = FirebaseMessaging.instance;
  final FlutterLocalNotificationsPlugin _flutterLocalNotificationsPlugin = 
      FlutterLocalNotificationsPlugin();
  
  final String _baseUrl = 'https://your-api-url.com'; // Replace with your API URL
  String? _token;
  
  // Initialize the Firebase service
  Future<void> initialize() async {
    // Initialize Firebase
    await Firebase.initializeApp();
    
    // Set up background message handler
    FirebaseMessaging.onBackgroundMessage(_firebaseMessagingBackgroundHandler);
    
    // Request permissions
    await _requestPermissions();
    
    // Initialize local notifications
    await _initializeLocalNotifications();
    
    // Get and save token
    await getAndSaveToken();
    
    // Set up foreground message handlers
    _setupForegroundMessageHandlers();
  }
  
  // Request notification permissions
  Future<void> _requestPermissions() async {
    NotificationSettings settings = await _firebaseMessaging.requestPermission(
      alert: true,
      badge: true,
      sound: true,
      provisional: false,
    );
    
    print('User notification permission status: ${settings.authorizationStatus}');
  }
  
  // Initialize local notifications plugin
  Future<void> _initializeLocalNotifications() async {
    const AndroidInitializationSettings androidInitializationSettings = 
        AndroidInitializationSettings('@mipmap/ic_launcher');
        
    final DarwinInitializationSettings iosInitializationSettings = 
        DarwinInitializationSettings(
          requestAlertPermission: false,
          requestBadgePermission: false,
          requestSoundPermission: false,
        );
    
    final InitializationSettings initializationSettings = InitializationSettings(
      android: androidInitializationSettings,
      iOS: iosInitializationSettings,
    );
    
    await _flutterLocalNotificationsPlugin.initialize(
      initializationSettings,
      onDidReceiveNotificationResponse: (NotificationResponse response) {
        // Handle notification tap
        final payload = response.payload;
        if (payload != null) {
          final data = json.decode(payload);
          // Navigate to appropriate screen based on payload data
          print('Notification tapped with payload: $data');
        }
      },
    );
    
    // Create notification channel for Android
    await _createNotificationChannel();
  }
  
  // Create high importance notification channel for Android
  Future<void> _createNotificationChannel() async {
    if (Platform.isAndroid) {
      const AndroidNotificationChannel channel = AndroidNotificationChannel(
        'high_importance_channel',
        'High Importance Notifications',
        description: 'This channel is used for important notifications.',
        importance: Importance.high,
      );
      
      await _flutterLocalNotificationsPlugin
          .resolvePlatformSpecificImplementation<
              AndroidFlutterLocalNotificationsPlugin>()
          ?.createNotificationChannel(channel);
    }
  }
  
  // Get FCM token and save it to shared preferences and server
  Future<String?> getAndSaveToken() async {
    _token = await _firebaseMessaging.getToken();
    print('FCM Token: $_token');
    
    if (_token != null) {
      // Save to shared preferences
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('fcm_token', _token!);
      
      // Send to server if user is logged in (has auth token)
      final authToken = prefs.getString('auth_token');
      if (authToken != null) {
        await _sendTokenToServer(_token!, authToken);
      }
    }
    
    // Set up token refresh listener
    _firebaseMessaging.onTokenRefresh.listen((newToken) async {
      _token = newToken;
      
      // Save to shared preferences
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('fcm_token', newToken);
      
      // Send to server if user is logged in
      final authToken = prefs.getString('auth_token');
      if (authToken != null) {
        await _sendTokenToServer(newToken, authToken);
      }
    });
    
    return _token;
  }
  
  // Send FCM token to server
  Future<void> _sendTokenToServer(String fcmToken, String authToken) async {
    try {
      final response = await http.post(
        Uri.parse('$_baseUrl/api/v1/courier/update-fcm-token'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $authToken',
        },
        body: json.encode({'fcmToken': fcmToken}),
      );
      
      if (response.statusCode == 200) {
        print('FCM token successfully sent to server');
      } else {
        print('Failed to send FCM token to server: ${response.body}');
      }
    } catch (e) {
      print('Error sending FCM token to server: $e');
    }
  }
  
  // Set up handlers for foreground messages
  void _setupForegroundMessageHandlers() {
    // Handle messages when the app is in the foreground
    FirebaseMessaging.onMessage.listen((RemoteMessage message) {
      print('Got a message whilst in the foreground!');
      print('Message data: ${message.data}');
      
      if (message.notification != null) {
        print('Message also contained a notification: ${message.notification}');
        _showLocalNotification(message);
      }
    });
    
    // Handle when the app is opened from a terminated state
    FirebaseMessaging.instance.getInitialMessage().then((RemoteMessage? message) {
      if (message != null) {
        print('App opened from terminated state via notification');
        // Navigate to appropriate screen based on message data
      }
    });
    
    // Handle when the app is opened from the background
    FirebaseMessaging.onMessageOpenedApp.listen((RemoteMessage message) {
      print('App opened from background state via notification');
      // Navigate to appropriate screen based on message data
    });
  }
  
  // Show a local notification when a message is received in the foreground
  Future<void> _showLocalNotification(RemoteMessage message) async {
    RemoteNotification? notification = message.notification;
    AndroidNotification? android = message.notification?.android;
    
    if (notification != null && android != null && Platform.isAndroid) {
      await _flutterLocalNotificationsPlugin.show(
        notification.hashCode,
        notification.title,
        notification.body,
        NotificationDetails(
          android: AndroidNotificationDetails(
            'high_importance_channel',
            'High Importance Notifications',
            channelDescription: 'This channel is used for important notifications.',
            icon: '@mipmap/ic_launcher',
            importance: Importance.high,
            priority: Priority.high,
          ),
          iOS: const DarwinNotificationDetails(
            presentAlert: true,
            presentBadge: true,
            presentSound: true,
          ),
        ),
        payload: json.encode(message.data),
      );
    } else if (notification != null && Platform.isIOS) {
      await _flutterLocalNotificationsPlugin.show(
        notification.hashCode,
        notification.title,
        notification.body,
        const NotificationDetails(
          iOS: DarwinNotificationDetails(
            presentAlert: true,
            presentBadge: true,
            presentSound: true,
          ),
        ),
        payload: json.encode(message.data),
      );
    }
  }
}
```

## 7. Create a Notifications Screen

Create a screen to display notifications history:

```dart
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:timeago/timeago.dart' as timeago;

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({Key? key}) : super(key: key);

  @override
  _NotificationsScreenState createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  List<Map<String, dynamic>> _notifications = [];
  bool _isLoading = true;
  String? _error;
  
  @override
  void initState() {
    super.initState();
    _fetchNotifications();
  }
  
  Future<void> _fetchNotifications() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    
    try {
      final prefs = await SharedPreferences.getInstance();
      final authToken = prefs.getString('auth_token');
      
      if (authToken == null) {
        setState(() {
          _isLoading = false;
          _error = 'You are not logged in';
        });
        return;
      }
      
      final response = await http.get(
        Uri.parse('https://your-api-url.com/api/v1/courier/notifications'),
        headers: {
          'Authorization': 'Bearer $authToken',
        },
      );
      
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        if (data['success']) {
          setState(() {
            _notifications = List<Map<String, dynamic>>.from(data['notifications']);
            _isLoading = false;
          });
        } else {
          setState(() {
            _isLoading = false;
            _error = data['message'] ?? 'Failed to load notifications';
          });
        }
      } else {
        setState(() {
          _isLoading = false;
          _error = 'Failed to load notifications. Status code: ${response.statusCode}';
        });
      }
    } catch (e) {
      setState(() {
        _isLoading = false;
        _error = 'Error: $e';
      });
    }
  }
  
  Future<void> _markAsRead(String notificationId) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final authToken = prefs.getString('auth_token');
      
      if (authToken == null) {
        return;
      }
      
      final response = await http.put(
        Uri.parse('https://your-api-url.com/api/v1/courier/notifications/$notificationId/read'),
        headers: {
          'Authorization': 'Bearer $authToken',
        },
      );
      
      if (response.statusCode == 200) {
        setState(() {
          _notifications = _notifications.map((notification) {
            if (notification['_id'] == notificationId) {
              notification['isRead'] = true;
            }
            return notification;
          }).toList();
        });
      }
    } catch (e) {
      print('Error marking notification as read: $e');
    }
  }
  
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('Notifications'),
        actions: [
          IconButton(
            icon: Icon(Icons.refresh),
            onPressed: _fetchNotifications,
          ),
        ],
      ),
      body: _isLoading
          ? Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        _error!,
                        style: TextStyle(color: Colors.red),
                        textAlign: TextAlign.center,
                      ),
                      SizedBox(height: 16),
                      ElevatedButton(
                        onPressed: _fetchNotifications,
                        child: Text('Retry'),
                      ),
                    ],
                  ),
                )
              : _notifications.isEmpty
                  ? Center(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(
                            Icons.notifications_none,
                            size: 80,
                            color: Colors.grey[400],
                          ),
                          SizedBox(height: 16),
                          Text(
                            'No notifications yet',
                            style: TextStyle(
                              fontSize: 18,
                              color: Colors.grey[600],
                            ),
                          ),
                        ],
                      ),
                    )
                  : RefreshIndicator(
                      onRefresh: _fetchNotifications,
                      child: ListView.builder(
                        itemCount: _notifications.length,
                        itemBuilder: (context, index) {
                          final notification = _notifications[index];
                          final isRead = notification['isRead'] ?? false;
                          final createdAt = DateTime.parse(notification['createdAt']);
                          
                          return Dismissible(
                            key: Key(notification['_id']),
                            direction: DismissDirection.endToStart,
                            background: Container(
                              color: Colors.blue,
                              alignment: Alignment.centerRight,
                              padding: EdgeInsets.symmetric(horizontal: 20),
                              child: Icon(
                                Icons.done,
                                color: Colors.white,
                              ),
                            ),
                            onDismissed: (direction) {
                              _markAsRead(notification['_id']);
                            },
                            child: ListTile(
                              leading: CircleAvatar(
                                backgroundColor: isRead ? Colors.grey[300] : Theme.of(context).primaryColor,
                                child: Icon(
                                  Icons.notifications,
                                  color: isRead ? Colors.grey[600] : Colors.white,
                                ),
                              ),
                              title: Text(
                                notification['title'] ?? 'No title',
                                style: TextStyle(
                                  fontWeight: isRead ? FontWeight.normal : FontWeight.bold,
                                ),
                              ),
                              subtitle: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(notification['body'] ?? 'No message'),
                                  SizedBox(height: 4),
                                  Text(
                                    timeago.format(createdAt),
                                    style: TextStyle(
                                      fontSize: 12,
                                      color: Colors.grey[600],
                                    ),
                                  ),
                                ],
                              ),
                              isThreeLine: true,
                              contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                              tileColor: isRead ? null : Colors.blue.withOpacity(0.05),
                              onTap: () {
                                if (!isRead) {
                                  _markAsRead(notification['_id']);
                                }
                                // Handle notification tap - navigate to relevant screen
                              },
                            ),
                          );
                        },
                      ),
                    ),
    );
  }
}
```

## 8. Initialize Firebase in your Main App

Update your `main.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:firebase_core/firebase_core.dart';
import 'firebase_messaging_service.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  
  // Initialize Firebase
  await Firebase.initializeApp();
  
  // Initialize Firebase Messaging Service
  final firebaseMessagingService = FirebaseMessagingService();
  await firebaseMessagingService.initialize();
  
  runApp(MyApp());
}

class MyApp extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Now Shipping Courier',
      theme: ThemeData(
        primarySwatch: Colors.blue,
      ),
      home: HomePage(),
    );
  }
}
```

## 9. Save FCM Token on Login

Update your login function to save the FCM token to the server after successful login:

```dart
Future<void> login(String email, String password) async {
  // Your existing login code...
  
  // After successful login, save FCM token to server
  final prefs = await SharedPreferences.getInstance();
  final fcmToken = prefs.getString('fcm_token');
  final authToken = prefs.getString('auth_token');
  
  if (fcmToken != null && authToken != null) {
    try {
      final response = await http.post(
        Uri.parse('https://your-api-url.com/api/v1/courier/update-fcm-token'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $authToken',
        },
        body: json.encode({'fcmToken': fcmToken}),
      );
      
      if (response.statusCode == 200) {
        print('FCM token successfully sent to server');
      } else {
        print('Failed to send FCM token to server: ${response.body}');
      }
    } catch (e) {
      print('Error sending FCM token to server: $e');
    }
  }
}
```

## 10. Obtain Firebase Service Account Key for Backend

1. In the Firebase Console, go to Project Settings
2. Navigate to the "Service accounts" tab
3. Click "Generate new private key" button
4. Download the JSON file
5. Rename it to `serviceAccountKey.json`
6. Place this file in the root of your Node.js project
7. Make sure to add it to .gitignore to keep it secure

## 11. Troubleshooting

If you encounter issues with notifications:

1. Check Firebase console logs for errors
2. Verify that your FCM token is being saved correctly in your database
3. Ensure your service account key is valid and has the correct permissions
4. Test notifications with the Firebase console before testing from your app
5. On Android, check that your notification channel is created correctly
6. On iOS, ensure that you have proper provisioning profiles with push notification capability 