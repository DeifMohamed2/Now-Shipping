import 'package:flutter/material.dart';
import 'package:flutter_spinkit/flutter_spinkit.dart';

class LoadingIndicator extends StatelessWidget {
  final String? message;
  final Color? color;
  final double size;

  const LoadingIndicator({
    Key? key,
    this.message,
    this.color,
    this.size = 50.0,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final themeColor = color ?? Theme.of(context).primaryColor;

    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          SpinKitDoubleBounce(
            color: themeColor,
            size: size,
          ),
          if (message != null) ...[
            const SizedBox(height: 20),
            Text(
              message!,
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 16,
                color: Colors.grey[600],
              ),
            ),
          ],
        ],
      ),
    );
  }
}
