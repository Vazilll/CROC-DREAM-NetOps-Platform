import 'package:flutter/material.dart';
import 'theme.dart';

class ResponsiveScaffold extends StatelessWidget {
  final int selectedIndex;
  final ValueChanged<int> onDestinationSelected;
  final Widget body;
  final String title;
  final List<Widget>? actions;

  const ResponsiveScaffold({
    Key? key,
    required this.selectedIndex,
    required this.onDestinationSelected,
    required this.body,
    this.title = 'NetOps Platform',
    this.actions,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final isMobile = constraints.maxWidth < 768;

        if (isMobile) {
          // Phone / Mobile Viewport
          return Scaffold(
            appBar: AppBar(
              backgroundColor: NetOpsTheme.surfaceCard,
              title: Text(
                title,
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                  letterSpacing: -0.5,
                ),
              ),
              actions: actions,
              bottom: PreferredSize(
                preferredSize: const Size.fromHeight(1),
                child: Container(color: NetOpsTheme.borderHairline, height: 1),
              ),
            ),
            body: SafeArea(child: body),
            bottomNavigationBar: NavigationBar(
              selectedIndex: selectedIndex,
              onDestinationSelected: onDestinationSelected,
              backgroundColor: NetOpsTheme.surfaceCard,
              indicatorColor: NetOpsTheme.cyanAction.withOpacity(0.2),
              destinations: const [
                NavigationDestination(icon: Icon(Icons.hub_outlined), selectedIcon: Icon(Icons.hub), label: 'Топология'),
                NavigationDestination(icon: Icon(Icons.router_outlined), selectedIcon: Icon(Icons.router), label: 'Устройства'),
                NavigationDestination(icon: Icon(Icons.show_chart_outlined), selectedIcon: Icon(Icons.show_chart), label: 'Телеметрия'),
                NavigationDestination(icon: Icon(Icons.difference_outlined), selectedIcon: Icon(Icons.difference), label: 'Дрейф'),
                NavigationDestination(icon: Icon(Icons.task_alt_outlined), selectedIcon: Icon(Icons.task_alt), label: 'Задачи'),
              ],
            ),
          );
        } else {
          // Laptop / Desktop Viewport
          return Scaffold(
            appBar: AppBar(
              backgroundColor: NetOpsTheme.surfaceCard,
              elevation: 0,
              title: Row(
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: NetOpsTheme.cyanAction.withOpacity(0.15),
                      borderRadius: BorderRadius.circular(6),
                      border: Border.parseBorder(Border.all(color: NetOpsTheme.cyanAction.withOpacity(0.3))),
                    ),
                    child: const Text('CROC DREAM', style: TextStyle(color: NetOpsTheme.cyanAction, fontSize: 11, fontWeight: FontWeight.bold)),
                  ),
                  const SizedBox(width: 12),
                  Text(
                    title,
                    style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, letterSpacing: -0.5),
                  ),
                ],
              ),
              actions: actions,
              bottom: PreferredSize(
                preferredSize: const Size.fromHeight(1),
                child: Container(color: NetOpsTheme.borderHairline, height: 1),
              ),
            ),
            body: Row(
              children: [
                NavigationRail(
                  selectedIndex: selectedIndex,
                  onDestinationSelected: onDestinationSelected,
                  backgroundColor: NetOpsTheme.surfaceCard,
                  extended: constraints.maxWidth > 1024,
                  destinations: const [
                    NavigationRailDestination(icon: Icon(Icons.hub_outlined), selectedIcon: Icon(Icons.hub), label: Text('Топология')),
                    NavigationRailDestination(icon: Icon(Icons.router_outlined), selectedIcon: Icon(Icons.router), label: Text('Устройства')),
                    NavigationRailDestination(icon: Icon(Icons.show_chart_outlined), selectedIcon: Icon(Icons.show_chart), label: Text('Телеметрия')),
                    NavigationRailDestination(icon: Icon(Icons.difference_outlined), selectedIcon: Icon(Icons.difference), label: Text('Дрейф')),
                    NavigationRailDestination(icon: Icon(Icons.task_alt_outlined), selectedIcon: Icon(Icons.task_alt), label: Text('Задачи')),
                  ],
                ),
                const VerticalDivider(width: 1, thickness: 1, color: NetOpsTheme.borderHairline),
                Expanded(child: body),
              ],
            ),
          );
        }
      },
    );
  }
}
