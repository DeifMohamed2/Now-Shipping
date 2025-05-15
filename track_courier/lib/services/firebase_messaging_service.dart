import 'dart:convert';
import 'dart:io';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../utils/config.dart';
import '../utils/logger.dart';

// Background message handler - must be a top-level function
@pragma('vm:entry-point')
Future<void> _firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp();
  AppLogger.log('Background message received: ${message.notification?.title}');
}

class FirebaseMessagingService {
  final FirebaseMessaging _firebaseMessaging = FirebaseMessaging.instance;
  final FlutterLocalNotificationsPlugin _flutterLocalNotificationsPlugin =
      FlutterLocalNotificationsPlugin();

  final String _baseUrl = AppConfig.apiBaseUrl;
  String? _token;

  // Initialize the Firebase service
  Future<void> initialize() async {
    try {
      // Initialize Firebase
      await Firebase.initializeApp();

      AppLogger.log(
          'Firebase initialized with sender ID: ${AppConfig.fcmSenderId}');

      // Set up background message handler
      FirebaseMessaging.onBackgroundMessage(
          _firebaseMessagingBackgroundHandler);

      // Request permissions
      await _requestPermissions();

      // Initialize local notifications
      await _initializeLocalNotifications();

      // Get and save token
      await getAndSaveToken();

      // Set up foreground message handlers
      _setupForegroundMessageHandlers();

      AppLogger.log('Firebase Messaging Service initialized successfully');
    } catch (e) {
      AppLogger.error('Failed to initialize Firebase Messaging Service: $e');
    }
  }

  // Request notification permissions
  Future<void> _requestPermissions() async {
    NotificationSettings settings = await _firebaseMessaging.requestPermission(
      alert: true,
      badge: true,
      sound: true,
      provisional: false,
    );

    AppLogger.log(
        'User notification permission status: ${settings.authorizationStatus}');
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

    final InitializationSettings initializationSettings =
        InitializationSettings(
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
          AppLogger.log('Notification tapped with payload: $data');
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
    try {
      AppLogger.log('Requesting FCM token from Firebase...');
      _token = await _firebaseMessaging.getToken();
      AppLogger.log(
          'FCM Token retrieved: ${_token != null ? '${_token!.substring(0, 10)}...' : 'null'}');

      if (_token != null) {
        // Save to shared preferences
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString('fcm_token', _token!);
        AppLogger.log('FCM token saved to SharedPreferences');

        // Send to server if user is logged in (has auth token)
        final authToken = prefs.getString('auth_token');
        if (authToken != null) {
          AppLogger.log('Auth token found, sending FCM token to server');
          await _sendTokenToServer(_token!, authToken);
        } else {
          AppLogger.log(
              'No auth token found, FCM token will be sent after login');
        }
      } else {
        AppLogger.error('Failed to retrieve FCM token from Firebase');
      }

      // Set up token refresh listener
      _firebaseMessaging.onTokenRefresh.listen((newToken) async {
        AppLogger.log('FCM token refreshed: ${newToken.substring(0, 10)}...');
        _token = newToken;

        // Save to shared preferences
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString('fcm_token', newToken);
        AppLogger.log('Refreshed FCM token saved to SharedPreferences');

        // Send to server if user is logged in
        final authToken = prefs.getString('auth_token');
        if (authToken != null) {
          AppLogger.log(
              'Auth token found, sending refreshed FCM token to server');
          await _sendTokenToServer(newToken, authToken);
        } else {
          AppLogger.log(
              'No auth token found, refreshed FCM token will be sent after login');
        }
      });

      return _token;
    } catch (e) {
      AppLogger.error('Error in getAndSaveToken: $e');
      return null;
    }
  }

  // Send FCM token to server
  Future<void> _sendTokenToServer(String fcmToken, String authToken) async {
    try {
      AppLogger.log('Sending FCM token to server...');
      final response = await http.post(
        Uri.parse('$_baseUrl/api/v1/courier/update-fcm-token'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $authToken',
        },
        body: json.encode({'fcmToken': fcmToken}),
      );

      if (response.statusCode == 200) {
        AppLogger.log('FCM token successfully sent to server');
      } else {
        AppLogger.error(
            'Failed to send FCM token to server: ${response.statusCode} - ${response.body}');

        // If we get a 401 (Unauthorized), the auth token might be invalid
        if (response.statusCode == 401) {
          AppLogger.error(
              'Auth token might be invalid, requesting a new login');
          // You could emit an event or notify the app to request re-login here
        }
      }
    } catch (e) {
      AppLogger.error('Error sending FCM token to server: $e');
      // Check if the error is network-related
      if (e is SocketException) {
        AppLogger.error(
            'Network error: Unable to connect to the server. Will retry when connection is available.');
      }
    }
  }

  // Set up handlers for foreground messages
  void _setupForegroundMessageHandlers() {
    // Handle messages when the app is in the foreground
    FirebaseMessaging.onMessage.listen((RemoteMessage message) {
      AppLogger.log('Got a message whilst in the foreground!');
      AppLogger.log('Message data: ${message.data}');

      if (message.notification != null) {
        AppLogger.log(
            'Message also contained a notification: ${message.notification}');
        _showLocalNotification(message);
      }
    });

    // Handle when the app is opened from a terminated state
    FirebaseMessaging.instance
        .getInitialMessage()
        .then((RemoteMessage? message) {
      if (message != null) {
        AppLogger.log('App opened from terminated state via notification');
        // Navigate to appropriate screen based on message data
      }
    });

    // Handle when the app is opened from the background
    FirebaseMessaging.onMessageOpenedApp.listen((RemoteMessage message) {
      AppLogger.log('App opened from background state via notification');
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
            channelDescription:
                'This channel is used for important notifications.',
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
