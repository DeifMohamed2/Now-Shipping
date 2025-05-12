import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:socket_io_client/socket_io_client.dart' as IO;
import 'package:fluttertoast/fluttertoast.dart';

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
    print("LocationProvider initialized");
    checkLocationPermission();
    checkLocationTrackingStatus();
  }

  Future<void> checkLocationPermission() async {
    _isLoading = true;
    notifyListeners();

    try {
      print("Checking location permission");
      final permission = await Geolocator.checkPermission();
      print("Current permission status: $permission");

      if (permission == LocationPermission.denied) {
        print("Permission denied, requesting permission");
        final requestPermission = await Geolocator.requestPermission();
        print("Request permission result: $requestPermission");
        _isPermissionGranted = requestPermission != LocationPermission.denied &&
            requestPermission != LocationPermission.deniedForever;
      } else {
        _isPermissionGranted = permission != LocationPermission.denied &&
            permission != LocationPermission.deniedForever;
      }

      print("Is permission granted: $_isPermissionGranted");

      // Get position immediately if permission is granted
      if (_isPermissionGranted) {
        _getCurrentPosition();
      }
    } catch (e) {
      _error = e.toString();
      print("Error checking location permission: $_error");
      Fluttertoast.showToast(
        msg: "Location permission error: $_error",
        backgroundColor: Colors.red,
      );
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> checkLocationTrackingStatus() async {
    _isLoading = true;
    notifyListeners();

    try {
      print("Checking location tracking status");
      final token = await storage.read(key: 'auth_token');
      print("Token available: ${token != null}");

      if (token != null) {
        print("Making API request to check tracking status");
        final response = await http.get(
          Uri.parse('$baseApiUrl/api/v1/courier/location/status'),
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer $token',
          },
        );

        print("API response status code: ${response.statusCode}");
        print("API response body: ${response.body}");

        if (response.statusCode == 200) {
          final data = json.decode(response.body);
          _isLocationTrackingEnabled =
              data['isLocationTrackingEnabled'] ?? false;

          print("Location tracking enabled: $_isLocationTrackingEnabled");

          if (_isLocationTrackingEnabled && _isPermissionGranted) {
            print("Starting location tracking");
            startLocationTracking();
          }
        } else {
          print("Error response: ${response.body}");
          Fluttertoast.showToast(
            msg: "Error checking tracking status: ${response.statusCode}",
            backgroundColor: Colors.red,
          );
        }
      }
    } catch (e) {
      _error = e.toString();
      print("Error checking location tracking status: $_error");
      Fluttertoast.showToast(
        msg: "Error checking tracking status: $_error",
        backgroundColor: Colors.red,
      );
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> toggleLocationTracking(bool enabled) async {
    _isLoading = true;
    notifyListeners();

    try {
      print("Toggling location tracking to: $enabled");
      final token = await storage.read(key: 'auth_token');
      print("Token available: ${token != null}");

      if (token != null) {
        print("Making API request to toggle tracking");
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

        print("API response status code: ${response.statusCode}");
        print("API response body: ${response.body}");

        if (response.statusCode == 200) {
          _isLocationTrackingEnabled = enabled;
          print("Successfully toggled location tracking to: $enabled");

          Fluttertoast.showToast(
            msg: enabled
                ? "Location tracking enabled"
                : "Location tracking disabled",
            backgroundColor: enabled ? Colors.green : Colors.orange,
          );

          if (enabled && _isPermissionGranted) {
            print("Starting location tracking");
            startLocationTracking();
          } else {
            print("Stopping location tracking");
            stopLocationTracking();
          }
        } else if (response.statusCode == 404) {
          // Handle "Courier not found" error
          _error =
              "Your courier account needs to be set up. Please contact support.";
          print("Error: $_error");

          // Still toggle the UI state for better UX
          _isLocationTrackingEnabled = enabled;

          // Show a more helpful message
          Fluttertoast.showToast(
            msg: "Account setup required. Please contact support.",
            backgroundColor: Colors.red,
            toastLength: Toast.LENGTH_LONG,
          );

          // Get position anyway for map display
          if (enabled && _isPermissionGranted) {
            _getCurrentPosition();
          }
        } else {
          print("Error response: ${response.body}");
          _error = "Error toggling tracking: ${response.statusCode}";

          Fluttertoast.showToast(
            msg: _error ?? "Unknown error occurred",
            backgroundColor: Colors.red,
          );
        }
      } else {
        // Force toggle UI state for testing if needed
        print("No token available, forcing UI state for testing");
        _isLocationTrackingEnabled = enabled;

        if (enabled && _isPermissionGranted) {
          _getCurrentPosition();
        }

        Fluttertoast.showToast(
          msg: "No authentication token available",
          backgroundColor: Colors.red,
        );
      }
    } catch (e) {
      _error = e.toString();
      print("Error toggling location tracking: $_error");
      Fluttertoast.showToast(
        msg: "Error toggling tracking: $_error",
        backgroundColor: Colors.red,
      );
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  void startLocationTracking() {
    print("Starting location tracking");
    if (_locationUpdateTimer != null) {
      _locationUpdateTimer!.cancel();
    }

    // Initialize Socket.IO connection
    _initializeSocket();

    // Get current position immediately
    _getCurrentPosition();

    // Set up timer for regular updates every 10 seconds
    _locationUpdateTimer = Timer.periodic(const Duration(seconds: 10), (timer) {
      print("Timer triggered, getting current position");
      _getCurrentPosition();
    });
  }

  void stopLocationTracking() {
    print("Stopping location tracking");
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
      print("Getting current position");
      final position = await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.high,
      );

      print("Position received: ${position.latitude}, ${position.longitude}");
      _currentPosition = position;
      notifyListeners();

      if (_isLocationTrackingEnabled) {
        _sendLocationUpdate(position);
      }
    } catch (e) {
      _error = e.toString();
      print("Error getting current position: $_error");
      notifyListeners();
    }
  }

  Future<void> _sendLocationUpdate(Position position) async {
    try {
      print("Sending location update");
      final token = await storage.read(key: 'auth_token');
      print("Token available: ${token != null}");

      if (token != null) {
        // Send via HTTP
        print("Sending HTTP location update");
        final response = await http.post(
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

        print("HTTP update response: ${response.statusCode}");

        // Send via Socket.IO if connected
        if (_socket != null && _socket!.connected) {
          print("Sending Socket.IO location update");
          _socket!.emit('location_update', {
            'latitude': position.latitude,
            'longitude': position.longitude,
          });
        } else {
          print("Socket not connected, can't send update via Socket.IO");
        }
      }
    } catch (e) {
      _error = e.toString();
      print("Error sending location update: $_error");
      notifyListeners();
    }
  }

  void _initializeSocket() async {
    try {
      print("Initializing Socket.IO connection");
      final token = await storage.read(key: 'auth_token');
      print(
          "Token for socket: ${token != null ? 'available' : 'not available'}");

      _socket = IO.io(baseApiUrl, <String, dynamic>{
        'transports': ['websocket'],
        'autoConnect': true,
        'auth': {
          'token': token,
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
      print("Error initializing Socket.IO: $_error");
      notifyListeners();
    }
  }

  @override
  void dispose() {
    stopLocationTracking();
    super.dispose();
  }
}
