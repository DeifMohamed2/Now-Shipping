import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../utils/config.dart';
import '../utils/logger.dart';
import '../services/firebase_messaging_service.dart';

class NotificationProvider extends ChangeNotifier {
  List<Map<String, dynamic>> _notifications = [];
  bool _isLoading = false;
  String? _error;
  FirebaseMessagingService? _firebaseMessagingService;

  List<Map<String, dynamic>> get notifications => _notifications;
  bool get isLoading => _isLoading;
  String? get error => _error;

  NotificationProvider() {
    _initializeFirebaseMessaging();
  }

  // Initialize Firebase Messaging
  Future<void> _initializeFirebaseMessaging() async {
    _firebaseMessagingService = FirebaseMessagingService();
    await _firebaseMessagingService?.initialize();
  }

  // Send FCM token to server (call this after login)
  Future<void> updateFcmToken() async {
    final prefs = await SharedPreferences.getInstance();
    final fcmToken = prefs.getString('fcm_token');
    final authToken = prefs.getString('auth_token');

    if (fcmToken != null && authToken != null) {
      try {
        final response = await http.post(
          Uri.parse('${AppConfig.apiBaseUrl}/api/v1/courier/update-fcm-token'),
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
              'Failed to send FCM token to server: ${response.body}');
        }
      } catch (e) {
        AppLogger.error('Error sending FCM token to server: $e');
      }
    }
  }

  // Fetch notifications from the server
  Future<void> fetchNotifications() async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final prefs = await SharedPreferences.getInstance();
      final authToken = prefs.getString('auth_token');

      if (authToken == null) {
        _error = 'You are not logged in';
        _isLoading = false;
        notifyListeners();
        return;
      }

      final response = await http.get(
        Uri.parse('${AppConfig.apiBaseUrl}/api/v1/courier/notifications'),
        headers: {
          'Authorization': 'Bearer $authToken',
        },
      );

      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        if (data['success']) {
          _notifications =
              List<Map<String, dynamic>>.from(data['notifications']);
          _isLoading = false;
          notifyListeners();
        } else {
          _error = data['message'] ?? 'Failed to load notifications';
          _isLoading = false;
          notifyListeners();
        }
      } else {
        _error =
            'Failed to load notifications. Status code: ${response.statusCode}';
        _isLoading = false;
        notifyListeners();
      }
    } catch (e) {
      _error = 'Error: $e';
      _isLoading = false;
      notifyListeners();
      AppLogger.error('Error fetching notifications: $e');
    }
  }

  // Mark notification as read
  Future<void> markAsRead(String notificationId) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final authToken = prefs.getString('auth_token');

      if (authToken == null) {
        return;
      }

      final response = await http.put(
        Uri.parse(
            '${AppConfig.apiBaseUrl}/api/v1/courier/notifications/$notificationId/read'),
        headers: {
          'Authorization': 'Bearer $authToken',
        },
      );

      if (response.statusCode == 200) {
        // Update the local state
        _notifications = _notifications.map((notification) {
          if (notification['_id'] == notificationId) {
            notification['isRead'] = true;
          }
          return notification;
        }).toList();
        notifyListeners();
      }
    } catch (e) {
      AppLogger.error('Error marking notification as read: $e');
    }
  }

  // Reset state
  void reset() {
    _notifications = [];
    _isLoading = false;
    _error = null;
    notifyListeners();
  }
}
