import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'theme.dart';
import '../state/netops_state.dart';
import 'command_palette.dart';
import 'dry_run_modal.dart';

class ResponsiveScaffold extends StatelessWidget {
  final Widget body;

  const ResponsiveScaffold({
    Key? key,
    required this.body,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final state = context.watch<NetOpsState>();

    return LayoutBuilder(
      builder: (context, constraints) {
        final isMobile = constraints.maxWidth < 768;

        return Scaffold(
          appBar: AppBar(
            backgroundColor: NetOpsTheme.surfaceCard,
            elevation: 0,
            title: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: NetOpsTheme.cyanAction.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(color: NetOpsTheme.cyanAction.withOpacity(0.3)),
                  ),
                  child: const Text(
                    'CROC DREAM',
                    style: TextStyle(
                      color: NetOpsTheme.cyanAction,
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                      letterSpacing: 0.5,
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Text(
                  _tabTitle(state.activeTab),
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                    letterSpacing: -0.5,
                  ),
                ),
                const SizedBox(width: 8),
                Container(
                  width: 8,
                  height: 8,
                  decoration: BoxDecoration(
                    color: state.isBackendOnline ? NetOpsTheme.emeraldSuccess : NetOpsTheme.amberWarning,
                    shape: BoxShape.circle,
                  ),
                ),
              ],
            ),
            actions: [
              // Search / Command Palette
              IconButton(
                icon: const Icon(Icons.search, size: 20),
                tooltip: 'Поиск и команды (Ctrl+K)',
                onPressed: () {
                  showDialog(
                    context: context,
                    builder: (ctx) => const CommandPaletteDialog(),
                  );
                },
              ),
              // Role selector
              PopupMenuButton<String>(
                tooltip: 'Роль пользователя',
                initialValue: state.userRole,
                onSelected: (role) => state.setUserRole(role),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                  margin: const EdgeInsets.symmetric(vertical: 10, horizontal: 4),
                  decoration: BoxDecoration(
                    color: NetOpsTheme.surfaceElevated,
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(color: NetOpsTheme.borderHairline),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        state.userRole == 'admin' ? Icons.shield : Icons.person_outline,
                        size: 14,
                        color: state.userRole == 'admin' ? NetOpsTheme.cyanAction : Colors.grey,
                      ),
                      const SizedBox(width: 6),
                      Text(
                        state.userRole.toUpperCase(),
                        style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold),
                      ),
                      const Icon(Icons.arrow_drop_down, size: 16, color: Colors.grey),
                    ],
                  ),
                ),
                itemBuilder: (ctx) => const [
                  PopupMenuItem(value: 'admin', child: Text('Admin (dev-admin-token)')),
                  PopupMenuItem(value: 'operator', child: Text('Operator (dev-operator-token)')),
                  PopupMenuItem(value: 'viewer', child: Text('Viewer (dev-viewer-token)')),
                ],
              ),
              // Dry-Run quick launcher
              IconButton(
                icon: const Icon(Icons.play_circle_outline, color: NetOpsTheme.cyanAction, size: 20),
                tooltip: 'Запустить Dry-Run',
                onPressed: () {
                  showDialog(
                    context: context,
                    builder: (ctx) => const DryRunModalDialog(),
                  );
                },
              ),
              // Refresh
              IconButton(
                icon: const Icon(Icons.refresh, size: 20),
                tooltip: 'Обновить данные',
                onPressed: () => state.loadAll(),
              ),
              const SizedBox(width: 8),
            ],
            bottom: PreferredSize(
              preferredSize: const Size.fromHeight(1),
              child: Container(color: NetOpsTheme.borderHairline, height: 1),
            ),
          ),
          body: Stack(
            children: [
              Row(
                children: [
                  if (!isMobile) ...[
                    NavigationRail(
                      selectedIndex: state.activeTab,
                      onDestinationSelected: (i) => state.setTab(i),
                      backgroundColor: NetOpsTheme.surfaceCard,
                      extended: constraints.maxWidth > 1100,
                      minExtendedWidth: 200,
                      leading: Padding(
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        child: Text(
                          constraints.maxWidth > 1100 ? 'НАВИГАЦИЯ' : 'MENU',
                          style: const TextStyle(fontSize: 10, color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1),
                        ),
                      ),
                      destinations: const [
                        NavigationRailDestination(icon: Icon(Icons.dashboard_outlined), selectedIcon: Icon(Icons.dashboard), label: Text('Дашборд')),
                        NavigationRailDestination(icon: Icon(Icons.hub_outlined), selectedIcon: Icon(Icons.hub), label: Text('Топология')),
                        NavigationRailDestination(icon: Icon(Icons.router_outlined), selectedIcon: Icon(Icons.router), label: Text('Устройства')),
                        NavigationRailDestination(icon: Icon(Icons.compare_arrows_outlined), selectedIcon: Icon(Icons.compare_arrows), label: Text('Дифф & Деплой')),
                        NavigationRailDestination(icon: Icon(Icons.difference_outlined), selectedIcon: Icon(Icons.difference), label: Text('Дрейф (Drift)')),
                        NavigationRailDestination(icon: Icon(Icons.task_alt_outlined), selectedIcon: Icon(Icons.task_alt), label: Text('Задачи (Jobs)')),
                        NavigationRailDestination(icon: Icon(Icons.show_chart_outlined), selectedIcon: Icon(Icons.show_chart), label: Text('Телеметрия & AI')),
                        NavigationRailDestination(icon: Icon(Icons.science_outlined), selectedIcon: Icon(Icons.science), label: Text('Chaos Lab')),
                        NavigationRailDestination(icon: Icon(Icons.auto_awesome_outlined), selectedIcon: Icon(Icons.auto_awesome), label: Text('AI Copilot')),
                        NavigationRailDestination(icon: Icon(Icons.slideshow_outlined), selectedIcon: Icon(Icons.slideshow), label: Text('Презентация')),
                      ],
                    ),
                    const VerticalDivider(width: 1, thickness: 1, color: NetOpsTheme.borderHairline),
                  ],
                  Expanded(
                    child: SafeArea(
                      child: state.isLoading
                          ? const Center(child: CircularProgressIndicator(color: NetOpsTheme.cyanAction))
                          : body,
                    ),
                  ),
                ],
              ),
              // Floating Toast Notification
              if (state.toastMessage != null)
                Positioned(
                  bottom: isMobile ? 80 : 24,
                  right: 24,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                    decoration: BoxDecoration(
                      color: NetOpsTheme.surfaceElevated,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: NetOpsTheme.borderHover),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withOpacity(0.5),
                          blurRadius: 16,
                          offset: const Offset(0, 4),
                        ),
                      ],
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.info_outline, size: 16, color: NetOpsTheme.cyanAction),
                        const SizedBox(width: 10),
                        Text(
                          state.toastMessage!,
                          style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w500),
                        ),
                        const SizedBox(width: 12),
                        InkWell(
                          onTap: () => state.clearToast(),
                          child: const Icon(Icons.close, size: 14, color: Colors.grey),
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          ),
          bottomNavigationBar: isMobile
              ? NavigationBar(
                  selectedIndex: state.activeTab > 5 ? 0 : state.activeTab,
                  onDestinationSelected: (i) => state.setTab(i),
                  backgroundColor: NetOpsTheme.surfaceCard,
                  indicatorColor: NetOpsTheme.cyanAction.withOpacity(0.2),
                  destinations: const [
                    NavigationDestination(icon: Icon(Icons.dashboard_outlined), selectedIcon: Icon(Icons.dashboard), label: 'Дашборд'),
                    NavigationDestination(icon: Icon(Icons.hub_outlined), selectedIcon: Icon(Icons.hub), label: 'Топология'),
                    NavigationDestination(icon: Icon(Icons.router_outlined), selectedIcon: Icon(Icons.router), label: 'Устройства'),
                    NavigationDestination(icon: Icon(Icons.compare_arrows_outlined), selectedIcon: Icon(Icons.compare_arrows), label: 'Дифф'),
                    NavigationDestination(icon: Icon(Icons.difference_outlined), selectedIcon: Icon(Icons.difference), label: 'Дрейф'),
                    NavigationDestination(icon: Icon(Icons.task_alt_outlined), selectedIcon: Icon(Icons.task_alt), label: 'Задачи'),
                  ],
                )
              : null,
        );
      },
    );
  }

  String _tabTitle(int idx) {
    switch (idx) {
      case 0: return 'Дашборд сети';
      case 1: return 'Топология сети (CLOS & Enterprise)';
      case 2: return 'Инвентарь устройств';
      case 3: return 'HierConfig Дифф & Деплой';
      case 4: return 'Контроль дрейфа (Drift Compliance)';
      case 5: return 'Журнал задач (Jobs Pipeline)';
      case 6: return 'Телеметрия & TimesFM-3.0 AI';
      case 7: return 'Chaos Lab (Стресс-тестирование)';
      case 8: return 'AI Copilot (Сетевой эксперт)';
      case 9: return 'Архитектура и Презентация';
      default: return 'CROC NetOps Cockpit';
    }
  }
}
