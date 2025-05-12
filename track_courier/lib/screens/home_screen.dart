import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:provider/provider.dart';
import 'package:track_courier/providers/auth_provider.dart';
import 'package:track_courier/providers/location_provider.dart';
import 'package:track_courier/screens/login_screen.dart';
import 'package:track_courier/utils/app_theme.dart';
import 'package:fluttertoast/fluttertoast.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  GoogleMapController? _mapController;
  final Set<Marker> _markers = {};

  @override
  void initState() {
    super.initState();

    // Request location permission if not already granted
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final locationProvider =
          Provider.of<LocationProvider>(context, listen: false);
      if (!locationProvider.isPermissionGranted) {
        locationProvider.checkLocationPermission();
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final authProvider = Provider.of<AuthProvider>(context);
    final locationProvider = Provider.of<LocationProvider>(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Courier Tracking'),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            onPressed: () async {
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
          // Map section
          Expanded(
            flex: 3,
            child: locationProvider.currentPosition != null
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
                      _mapController = controller;

                      // Add marker for current position
                      if (locationProvider.currentPosition != null) {
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
                      }
                    },
                  )
                : const Center(
                    child: CircularProgressIndicator(),
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
                        if (!locationProvider.isPermissionGranted) {
                          await locationProvider.checkLocationPermission();
                          if (!locationProvider.isPermissionGranted) {
                            Fluttertoast.showToast(
                              msg: 'Location permission is required',
                              backgroundColor: Colors.red,
                            );
                            return;
                          }
                        }

                        await locationProvider.toggleLocationTracking(value);

                        if (value && locationProvider.currentPosition != null) {
                          _mapController?.animateCamera(
                            CameraUpdate.newLatLng(
                              LatLng(
                                locationProvider.currentPosition!.latitude,
                                locationProvider.currentPosition!.longitude,
                              ),
                            ),
                          );
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
              ],
            ),
          ),
        ],
      ),
    );
  }
}
