import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:track_courier/providers/auth_provider.dart';
import 'package:track_courier/providers/location_provider.dart';
import 'package:track_courier/screens/login_screen.dart';
import 'package:track_courier/screens/splash_screen.dart';
import 'package:track_courier/utils/app_theme.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => AuthProvider()),
        ChangeNotifierProvider(create: (_) => LocationProvider()),
      ],
      child: MaterialApp(
        title: 'Courier Tracker',
        debugShowCheckedModeBanner: false,
        theme: AppTheme.lightTheme,
        darkTheme: AppTheme.darkTheme,
        themeMode: ThemeMode.system,
        home: const SplashScreen(),
      ),
    );
  }
}
