import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:socket_io_client/socket_io_client.dart' as IO;

// Base API URL
const String baseApiUrl =
    'https://nowshipping.co'; // Replace with your actual server IP/domain

class LocationProvider extends ChangeNotifier {
  final storage = const FlutterSecureStorage();

  bool _isLocationTrackingEnabled = false;
  bool _isPermissionGranted = false;
  bool _isLoading = false;
  Position? _currentPosition;
  String? _error;
  Timer? _locationUpdateTimer;
  IO.Socket? _socket;

  bool get isLocationTrackingEnabled => _isLocationTrackingEnabled;
  bool get isPermissionGranted => _isPermissionGranted;
  bool get isLoading => _isLoading;
  Position? get currentPosition => _currentPosition;
  String? get error => _error;

  LocationProvider() {
    checkLocationPermission();
    checkLocationTrackingStatus();
  }

  Future<void> checkLocationPermission() async {
    _isLoading = true;
    notifyListeners();

    try {
      final permission = await Geolocator.checkPermission();

      if (permission == LocationPermission.denied) {
        final requestPermission = await Geolocator.requestPermission();
        _isPermissionGranted = requestPermission != LocationPermission.denied &&
            requestPermission != LocationPermission.deniedForever;
      } else {
        _isPermissionGranted = permission != LocationPermission.denied &&
            permission != LocationPermission.deniedForever;
      }
    } catch (e) {
      _error = e.toString();
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> checkLocationTrackingStatus() async {
    _isLoading = true;
    notifyListeners();

    try {
      final token = await storage.read(key: 'auth_token');

      if (token != null) {
        final response = await http.get(
          Uri.parse('$baseApiUrl/api/v1/courier/location/status'),
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer $token',
          },
        );

        if (response.statusCode == 200) {
          final data = json.decode(response.body);
          _isLocationTrackingEnabled =
              data['isLocationTrackingEnabled'] ?? false;

          if (_isLocationTrackingEnabled && _isPermissionGranted) {
            startLocationTracking();
          }
        }
      }
    } catch (e) {
      _error = e.toString();
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> toggleLocationTracking(bool enabled) async {
    _isLoading = true;
    notifyListeners();

    try {
      final token = await storage.read(key: 'auth_token');

      if (token != null) {
        final response = await http.post(
          Uri.parse('$baseApiUrl/api/v1/courier/location/preferences'),
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer $token',
          },
          body: json.encode({
            'isEnabled': enabled,
          }),
        );

        if (response.statusCode == 200) {
          _isLocationTrackingEnabled = enabled;

          if (enabled && _isPermissionGranted) {
            startLocationTracking();
          } else {
            stopLocationTracking();
          }
        }
      }
    } catch (e) {
      _error = e.toString();
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  void startLocationTracking() {
    if (_locationUpdateTimer != null) {
      _locationUpdateTimer!.cancel();
    }

    // Initialize Socket.IO connection
    _initializeSocket();

    // Get current position immediately
    _getCurrentPosition();

    // Set up timer for regular updates
    _locationUpdateTimer = Timer.periodic(const Duration(seconds: 30), (timer) {
      _getCurrentPosition();
    });
  }

  void stopLocationTracking() {
    if (_locationUpdateTimer != null) {
      _locationUpdateTimer!.cancel();
      _locationUpdateTimer = null;
    }

    if (_socket != null) {
      _socket!.disconnect();
      _socket = null;
    }
  }

  Future<void> _getCurrentPosition() async {
    try {
      final position = await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.high,
      );

      _currentPosition = position;
      notifyListeners();

      _sendLocationUpdate(position);
    } catch (e) {
      _error = e.toString();
      notifyListeners();
    }
  }

  Future<void> _sendLocationUpdate(Position position) async {
    try {
      final token = await storage.read(key: 'auth_token');

      if (token != null) {
        // Send via HTTP
        await http.post(
          Uri.parse('$baseApiUrl/api/v1/courier/location'),
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer $token',
          },
          body: json.encode({
            'latitude': position.latitude,
            'longitude': position.longitude,
          }),
        );

        // Send via Socket.IO if connected
        if (_socket != null && _socket!.connected) {
          _socket!.emit('location_update', {
            'latitude': position.latitude,
            'longitude': position.longitude,
          });
        }
      }
    } catch (e) {
      _error = e.toString();
      notifyListeners();
    }
  }

  void _initializeSocket() {
    try {
      _socket = IO.io(baseApiUrl, <String, dynamic>{
        'transports': ['websocket'],
        'autoConnect': true,
        'auth': {
          'token': storage.read(key: 'auth_token'),
        }
      });

      _socket!.onConnect((_) {
        print('Socket.IO connected');
      });

      _socket!.onDisconnect((_) {
        print('Socket.IO disconnected');
      });

      _socket!.onError((error) {
        print('Socket.IO error: $error');
      });

      _socket!.connect();
    } catch (e) {
      _error = e.toString();
      notifyListeners();
    }
  }

  @override
  void dispose() {
    stopLocationTracking();
    super.dispose();
  }
}
