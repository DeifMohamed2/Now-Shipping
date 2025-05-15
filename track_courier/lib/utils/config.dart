class AppConfig {
  // API Base URL
  static const String apiBaseUrl =
      'https://a147-156-196-169-94.ngrok-free.app'; // Using ngrok URL

  // App settings
  static const String appName = 'Now Shipping Courier';
  static const int connectTimeout = 30000; // 30 seconds
  static const int receiveTimeout = 30000; // 30 seconds

  // FCM and Notification settings
  static const String fcmSenderId ='216492662889'; // Keep the original value as the client_id was not the correct sender ID
  static const String notificationChannelId = 'high_importance_channel';
  static const String notificationChannelName = 'High Importance Notifications';
  static const String notificationChannelDescription =
      'This channel is used for important notifications.';
}
