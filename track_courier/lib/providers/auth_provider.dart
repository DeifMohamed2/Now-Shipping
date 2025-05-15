import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:jwt_decoder/jwt_decoder.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../utils/config.dart';
import '../utils/logger.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';

// Base API URL - make sure this matches the one in location_provider.dart
const String baseApiUrl =
    'https://a147-156-196-169-94.ngrok-free.app'; // Replace with your actual server IP/domain

class AuthProvider extends ChangeNotifier {
  final storage = const FlutterSecureStorage();

  bool _isAuthenticated = false;
  bool _isLoading = false;
  String? _token;
  Map<String, dynamic>? _userData;
  String? _error;

  bool get isAuthenticated => _isAuthenticated;
  bool get isLoading => _isLoading;
  String? get token => _token;
  Map<String, dynamic>? get userData => _userData;
  String? get error => _error;

  AuthProvider() {
    checkAuthStatus();
  }

  Future<void> checkAuthStatus() async {
    _isLoading = true;
    notifyListeners();

    try {
      final token = await storage.read(key: 'auth_token');

      if (token != null) {
        // Check if token is expired
        final bool isExpired = JwtDecoder.isExpired(token);

        if (!isExpired) {
          _token = token;
          _userData = JwtDecoder.decode(token);
          _isAuthenticated = true;
        } else {
          // Token expired, logout
          await logout();
        }
      }
    } catch (e) {
      _error = e.toString();
      AppLogger.error('Error checking auth status: $_error');
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<bool> login(String email, String password) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final response = await http.post(
        Uri.parse('${AppConfig.apiBaseUrl}/api/v1/auth/courier-login'),
        headers: {'Content-Type': 'application/json'},
        body: json.encode({
          'email': email,
          'password': password,
        }),
      );

      AppLogger.log(
          'Login response: ${response.statusCode} - ${response.body}');

      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        _token = data['token'];

        if (_token == null) {
          _error = 'No token received from server';
          _isLoading = false;
          notifyListeners();
          return false;
        }

        _userData = JwtDecoder.decode(_token!);
        AppLogger.log('User data from token: $_userData');

        // Save token to secure storage
        await storage.write(key: 'auth_token', value: _token);

        // Also save to shared preferences for easier access
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString('auth_token', _token!);

        // Update FCM token on the server
        await _updateFcmToken();

        _isAuthenticated = true;
        _isLoading = false;
        notifyListeners();
        return true;
      } else {
        final data = json.decode(response.body);
        _error = data['message'] ?? 'Authentication failed';
        _isLoading = false;
        notifyListeners();
        return false;
      }
    } catch (e) {
      _error = e.toString();
      AppLogger.error('Login error: $_error');
      _isLoading = false;
      notifyListeners();
      return false;
    }
  }

  Future<void> logout() async {
    _isLoading = true;
    notifyListeners();

    try {
      await storage.delete(key: 'auth_token');

      // Also clear shared preferences
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove('auth_token');

      _isAuthenticated = false;
      _token = null;
      _userData = null;
    } catch (e) {
      _error = e.toString();
      AppLogger.error('Logout error: $_error');
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  // Send FCM token to server after login
  Future<void> _updateFcmToken() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      var fcmToken = prefs.getString('fcm_token');

      // If no token is available, try to get it directly from Firebase
      if (fcmToken == null) {
        AppLogger.log(
            'No FCM token found in SharedPreferences, requesting new token');

        // Ensure Firebase is initialized
        try {
          await Firebase.initializeApp();
        } catch (e) {
          // Firebase might already be initialized
          AppLogger.log('Firebase initialization note: ${e.toString()}');
        }

        // Get token directly from Firebase
        try {

          // Print the Firebase Messaging sender ID
          final FirebaseMessaging messaging = FirebaseMessaging.instance;
          final settings = await messaging.getNotificationSettings();
          
          // Get the GCM Sender ID from Firebase
          final gcmSenderId = Firebase.app().options.messagingSenderId;
          AppLogger.log('Firebase Messaging Sender ID: $gcmSenderId');
          print('Firebase Messaging Sender ID: $gcmSenderId');

          
          
          fcmToken = await FirebaseMessaging.instance.getToken();
          print('FCM Token: $fcmToken');
          if (fcmToken != null) {
            // Save the newly obtained token
            await prefs.setString('fcm_token', fcmToken);
            AppLogger.log('New FCM token obtained and saved: $fcmToken');
          }
        } catch (e) {
          AppLogger.error('Error obtaining FCM token directly: $e');
        }
      } else {
        AppLogger.log('Found existing FCM token in SharedPreferences');
      }

      if (fcmToken != null && _token != null) {
        AppLogger.log('Sending FCM token to server: $fcmToken');

        final response = await http.post(
          Uri.parse('${AppConfig.apiBaseUrl}/api/v1/courier/update-fcm-token'),
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer $_token',
          },
          body: json.encode({'fcmToken': fcmToken}),
        );

        if (response.statusCode == 200) {
          AppLogger.log('FCM token successfully sent to server after login');
        } else {
          AppLogger.error(
              'Failed to send FCM token to server after login: ${response.statusCode} - ${response.body}');
        }
      } else {
        AppLogger.error(
            'Cannot send FCM token to server. Token available: ${fcmToken != null}, Auth token available: ${_token != null}');
      }
    } catch (e) {
      AppLogger.error('Error sending FCM token to server after login: $e');
    }
  }
}
