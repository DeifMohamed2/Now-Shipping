import 'package:flutter/material.dart';

class CustomAppBar extends StatelessWidget implements PreferredSizeWidget {
  final String title;
  final List<Widget>? actions;
  final bool centerTitle;
  final double elevation;
  final Widget? leading;
  final bool automaticallyImplyLeading;
  final Color? backgroundColor;

  const CustomAppBar({
    Key? key,
    required this.title,
    this.actions,
    this.centerTitle = true,
    this.elevation = 1.0,
    this.leading,
    this.automaticallyImplyLeading = true,
    this.backgroundColor,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return AppBar(
      title: Text(
        title,
        style: const TextStyle(
          fontSize: 18,
          fontWeight: FontWeight.bold,
        ),
      ),
      centerTitle: centerTitle,
      elevation: elevation,
      leading: leading,
      automaticallyImplyLeading: automaticallyImplyLeading,
      backgroundColor:
          backgroundColor ?? Theme.of(context).colorScheme.background,
      foregroundColor: Theme.of(context).colorScheme.primary,
      actions: actions,
    );
  }

  @override
  Size get preferredSize => const Size.fromHeight(kToolbarHeight);
}
