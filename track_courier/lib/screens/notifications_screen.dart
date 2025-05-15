import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:timeago/timeago.dart' as timeago;
import '../providers/notification_provider.dart';
import '../widgets/custom_app_bar.dart';
import '../widgets/empty_state.dart';
import '../widgets/error_state.dart';
import '../widgets/loading_indicator.dart';

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({Key? key}) : super(key: key);

  @override
  _NotificationsScreenState createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      Provider.of<NotificationProvider>(context, listen: false)
          .fetchNotifications();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: CustomAppBar(
        title: 'Notifications',
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () {
              Provider.of<NotificationProvider>(context, listen: false)
                  .fetchNotifications();
            },
          ),
        ],
      ),
      body: Consumer<NotificationProvider>(
        builder: (context, notificationProvider, _) {
          if (notificationProvider.isLoading) {
            return const LoadingIndicator();
          }

          if (notificationProvider.error != null) {
            return ErrorState(
              message: notificationProvider.error!,
              onRetry: () {
                notificationProvider.fetchNotifications();
              },
            );
          }

          if (notificationProvider.notifications.isEmpty) {
            return const EmptyState(
              icon: Icons.notifications_none,
              title: 'No Notifications',
              message: 'You don\'t have any notifications yet',
            );
          }

          return RefreshIndicator(
            onRefresh: () => notificationProvider.fetchNotifications(),
            child: ListView.builder(
              itemCount: notificationProvider.notifications.length,
              itemBuilder: (context, index) {
                final notification = notificationProvider.notifications[index];
                final isRead = notification['isRead'] ?? false;
                final createdAt = DateTime.parse(notification['createdAt']);

                return Dismissible(
                  key: Key(notification['_id']),
                  direction: DismissDirection.endToStart,
                  background: Container(
                    color: Colors.blue,
                    alignment: Alignment.centerRight,
                    padding: const EdgeInsets.symmetric(horizontal: 20),
                    child: const Icon(
                      Icons.done,
                      color: Colors.white,
                    ),
                  ),
                  onDismissed: (direction) {
                    if (!isRead) {
                      notificationProvider.markAsRead(notification['_id']);
                    }
                  },
                  child: Card(
                    margin:
                        const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    elevation: isRead ? 1 : 3,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(10),
                      side: BorderSide(
                        color: isRead
                            ? Colors.grey.shade300
                            : Theme.of(context).primaryColor.withOpacity(0.5),
                        width: 1,
                      ),
                    ),
                    child: ListTile(
                      leading: CircleAvatar(
                        backgroundColor: isRead
                            ? Colors.grey.shade300
                            : Theme.of(context).primaryColor,
                        child: Icon(
                          Icons.notifications,
                          color: isRead ? Colors.grey.shade600 : Colors.white,
                        ),
                      ),
                      title: Text(
                        notification['title'] ?? 'No title',
                        style: TextStyle(
                          fontWeight:
                              isRead ? FontWeight.normal : FontWeight.bold,
                        ),
                      ),
                      subtitle: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(notification['body'] ?? 'No message'),
                          const SizedBox(height: 4),
                          Row(
                            children: [
                              const Icon(Icons.access_time,
                                  size: 14, color: Colors.grey),
                              const SizedBox(width: 4),
                              Text(
                                timeago.format(createdAt),
                                style: TextStyle(
                                  fontSize: 12,
                                  color: Colors.grey.shade600,
                                ),
                              ),
                              const Spacer(),
                              if (!isRead)
                                Container(
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: 8, vertical: 2),
                                  decoration: BoxDecoration(
                                    color: Theme.of(context).primaryColor,
                                    borderRadius: BorderRadius.circular(10),
                                  ),
                                  child: const Text(
                                    'New',
                                    style: TextStyle(
                                      color: Colors.white,
                                      fontSize: 10,
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                                ),
                            ],
                          ),
                        ],
                      ),
                      isThreeLine: true,
                      contentPadding: const EdgeInsets.symmetric(
                          horizontal: 16, vertical: 8),
                      tileColor: isRead
                          ? null
                          : Theme.of(context).primaryColor.withOpacity(0.05),
                      onTap: () {
                        if (!isRead) {
                          notificationProvider.markAsRead(notification['_id']);
                        }
                        // Handle notification tap if needed
                      },
                    ),
                  ),
                );
              },
            ),
          );
        },
      ),
    );
  }
}
