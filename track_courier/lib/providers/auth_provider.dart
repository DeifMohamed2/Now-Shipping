import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:jwt_decoder/jwt_decoder.dart';

// Base API URL - make sure this matches the one in location_provider.dart
const String baseApiUrl =
    'https://nowshipping.co'; // Replace with your actual server IP/domain

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
        Uri.parse('$baseApiUrl/api/v1/auth/courier-login'),
        headers: {'Content-Type': 'application/json'},
        body: json.encode({
          'email': email,
          'password': password,
        }),
      );

      print('Login response: ${response.statusCode} - ${response.body}');

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
        print('User data from token: $_userData');

        // Save token to secure storage
        await storage.write(key: 'auth_token', value: _token);

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
      print('Login error: $_error');
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
      _isAuthenticated = false;
      _token = null;
      _userData = null;
    } catch (e) {
      _error = e.toString();
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }
}
