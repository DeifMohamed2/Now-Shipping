import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:provider/provider.dart';
import 'package:track_courier/providers/auth_provider.dart';
import 'package:track_courier/providers/location_provider.dart';
import 'package:track_courier/screens/login_screen.dart';
import 'package:track_courier/utils/app_theme.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:url_launcher/url_launcher.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  GoogleMapController? _mapController;
  final Set<Marker> _markers = {};
  bool _mapReady = false;
  bool _isFirstLoad = true;
  bool _showErrorBanner = false;
  String _errorMessage = '';

  @override
  void initState() {
    super.initState();
    print("HomeScreen initialized");

    // Request location permission if not already granted
    WidgetsBinding.instance.addPostFrameCallback((_) {
      print("Post frame callback executed");
      final locationProvider =
          Provider.of<LocationProvider>(context, listen: false);

      if (!locationProvider.isPermissionGranted) {
        print("Location permission not granted, requesting");
        locationProvider.checkLocationPermission();
      } else {
        print("Location permission already granted");

        // Force get position if we have permission
        if (locationProvider.currentPosition == null) {
          print("No current position, forcing update");
          _updateCurrentPosition(locationProvider);
        }
      }

      // Check for errors
      if (locationProvider.error != null) {
        setState(() {
          _showErrorBanner = true;
          _errorMessage = locationProvider.error!;
        });
      }
    });
  }

  Future<void> _updateCurrentPosition(LocationProvider locationProvider) async {
    try {
      print("Manually requesting position update");
      await locationProvider.checkLocationPermission();
      if (locationProvider.isPermissionGranted) {
        await locationProvider
            .toggleLocationTracking(locationProvider.isLocationTrackingEnabled);
      }
    } catch (e) {
      print("Error updating position: $e");
    }
  }

  void _updateMapWithCurrentLocation(LocationProvider locationProvider) {
    if (locationProvider.currentPosition != null && _mapController != null) {
      print("Updating map with current location");

      final latLng = LatLng(
        locationProvider.currentPosition!.latitude,
        locationProvider.currentPosition!.longitude,
      );

      _mapController!.animateCamera(CameraUpdate.newLatLngZoom(latLng, 15));

      setState(() {
        _markers.clear();
        _markers.add(
          Marker(
            markerId: const MarkerId('currentLocation'),
            position: latLng,
            infoWindow: const InfoWindow(
              title: 'Your Location',
              snippet: 'You are here',
            ),
          ),
        );
      });

      print(
          "Map updated with marker at: ${latLng.latitude}, ${latLng.longitude}");
    } else {
      print(
          "Cannot update map: controller=${_mapController != null}, position=${locationProvider.currentPosition}");
    }
  }

  Future<void> _contactSupport() async {
    const email = 'support@nowshipping.co';
    final Uri emailUri = Uri(
      scheme: 'mailto',
      path: email,
      query:
          'subject=Courier Account Setup&body=Hello, I need help setting up my courier account for location tracking.',
    );

    try {
      if (await canLaunchUrl(emailUri)) {
        await launchUrl(emailUri);
      } else {
        Fluttertoast.showToast(
          msg: "Could not open email app. Please contact $email directly.",
          backgroundColor: Colors.red,
        );
      }
    } catch (e) {
      print("Error launching email: $e");
      Fluttertoast.showToast(
        msg: "Could not open email app: $e",
        backgroundColor: Colors.red,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final authProvider = Provider.of<AuthProvider>(context);
    final locationProvider = Provider.of<LocationProvider>(context);

    print(
        "Building HomeScreen - position: ${locationProvider.currentPosition}, tracking: ${locationProvider.isLocationTrackingEnabled}");

    // Check for errors
    if (locationProvider.error != null && !_showErrorBanner) {
      setState(() {
        _showErrorBanner = true;
        _errorMessage = locationProvider.error!;
      });
    }

    // Update map when we get a position for the first time
    if (locationProvider.currentPosition != null && _mapReady && _isFirstLoad) {
      print("First load with position available, updating map");
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _updateMapWithCurrentLocation(locationProvider);
      });
      _isFirstLoad = false;
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('Courier Tracking'),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            onPressed: () async {
              print("Logout pressed");
              await authProvider.logout();
              if (!mounted) return;
              Navigator.of(context).pushReplacement(
                MaterialPageRoute(builder: (_) => const LoginScreen()),
              );
            },
          ),
        ],
      ),
      body: Column(
        children: [
          // Error banner
          if (_showErrorBanner)
            Container(
              width: double.infinity,
              color: Colors.red.shade100,
              padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 16),
              child: Row(
                children: [
                  const Icon(Icons.error_outline, color: Colors.red),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      _errorMessage.contains("Courier not found") ||
                              _errorMessage.contains("404")
                          ? "Your courier account needs to be set up for tracking"
                          : _errorMessage,
                      style: const TextStyle(color: Colors.red),
                    ),
                  ),
                  TextButton(
                    onPressed: _contactSupport,
                    child: const Text("Contact Support"),
                  ),
                  IconButton(
                    icon: const Icon(Icons.close, size: 16),
                    onPressed: () {
                      setState(() {
                        _showErrorBanner = false;
                      });
                    },
                  ),
                ],
              ),
            ),

          // Map section
          Expanded(
            flex: 3,
            child: Stack(
              children: [
                // Map
                locationProvider.currentPosition != null
                    ? GoogleMap(
                        initialCameraPosition: CameraPosition(
                          target: LatLng(
                            locationProvider.currentPosition!.latitude,
                            locationProvider.currentPosition!.longitude,
                          ),
                          zoom: 15,
                        ),
                        myLocationEnabled: true,
                        myLocationButtonEnabled: true,
                        compassEnabled: true,
                        markers: _markers,
                        onMapCreated: (controller) {
                          print("Map created");
                          _mapController = controller;
                          _mapReady = true;

                          // Add marker for current position
                          if (locationProvider.currentPosition != null) {
                            print("Setting initial marker");
                            setState(() {
                              _markers.add(
                                Marker(
                                  markerId: const MarkerId('currentLocation'),
                                  position: LatLng(
                                    locationProvider.currentPosition!.latitude,
                                    locationProvider.currentPosition!.longitude,
                                  ),
                                  infoWindow: const InfoWindow(
                                    title: 'Your Location',
                                    snippet: 'You are here',
                                  ),
                                ),
                              );
                            });
                          }
                        },
                      )
                    : const Center(
                        child: CircularProgressIndicator(),
                      ),

                // Debug button to force position update
                Positioned(
                  top: 10,
                  right: 10,
                  child: FloatingActionButton(
                    mini: true,
                    backgroundColor: Colors.white,
                    child: const Icon(Icons.refresh, color: Colors.blue),
                    onPressed: () {
                      print("Manual refresh pressed");
                      _updateCurrentPosition(locationProvider);

                      if (locationProvider.currentPosition != null) {
                        _updateMapWithCurrentLocation(locationProvider);
                      } else {
                        Fluttertoast.showToast(
                          msg: "Waiting for location...",
                          backgroundColor: Colors.orange,
                        );
                      }
                    },
                  ),
                ),
              ],
            ),
          ),

          // Status section
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.white,
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(0.1),
                  blurRadius: 10,
                  offset: const Offset(0, -5),
                ),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // User info
                Row(
                  children: [
                    CircleAvatar(
                      backgroundColor: AppTheme.primaryColor,
                      child: Text(
                        authProvider.userData?['name']
                                ?.substring(0, 1)
                                .toUpperCase() ??
                            'C',
                        style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          authProvider.userData?['name'] ?? 'Courier',
                          style: const TextStyle(
                            fontWeight: FontWeight.bold,
                            fontSize: 16,
                          ),
                        ),
                        Text(
                          authProvider.userData?['email'] ?? '',
                          style: TextStyle(
                            color: Colors.grey[600],
                            fontSize: 14,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),

                const SizedBox(height: 20),

                // Location tracking toggle
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text(
                      'Location Tracking',
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    Switch(
                      value: locationProvider.isLocationTrackingEnabled,
                      onChanged: (value) async {
                        print("Toggle switch changed to: $value");
                        if (!locationProvider.isPermissionGranted) {
                          print("Permission not granted, requesting");
                          await locationProvider.checkLocationPermission();
                          if (!locationProvider.isPermissionGranted) {
                            print("Permission still not granted after request");
                            Fluttertoast.showToast(
                              msg: 'Location permission is required',
                              backgroundColor: Colors.red,
                            );
                            return;
                          }
                        }

                        print("Calling toggleLocationTracking");
                        await locationProvider.toggleLocationTracking(value);
                        print(
                            "Toggle complete, new state: ${locationProvider.isLocationTrackingEnabled}");

                        if (value && locationProvider.currentPosition != null) {
                          print("Animating camera to current position");
                          _updateMapWithCurrentLocation(locationProvider);
                        }

                        // Check for errors after toggle
                        if (locationProvider.error != null) {
                          setState(() {
                            _showErrorBanner = true;
                            _errorMessage = locationProvider.error!;
                          });
                        }
                      },
                      activeColor: AppTheme.successColor,
                    ),
                  ],
                ),

                const SizedBox(height: 8),

                // Status text
                Text(
                  locationProvider.isLocationTrackingEnabled
                      ? 'Your location is being shared with the admin'
                      : 'Location sharing is currently disabled',
                  style: TextStyle(
                    color: locationProvider.isLocationTrackingEnabled
                        ? AppTheme.successColor
                        : Colors.grey[600],
                    fontSize: 14,
                  ),
                ),

                if (locationProvider.currentPosition != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(
                      'Last update: ${DateTime.now().toString().substring(11, 19)}',
                      style: TextStyle(
                        color: Colors.grey[600],
                        fontSize: 12,
                      ),
                    ),
                  ),

                // Add coordinates display for debugging
                if (locationProvider.currentPosition != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(
                      'Coordinates: ${locationProvider.currentPosition!.latitude.toStringAsFixed(6)}, ${locationProvider.currentPosition!.longitude.toStringAsFixed(6)}',
                      style: const TextStyle(
                        fontSize: 12,
                        color: Colors.blue,
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
