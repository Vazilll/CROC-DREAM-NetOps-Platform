import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'theme.dart';
import '../state/netops_state.dart';

class CommandPaletteDialog extends StatefulWidget {
  const CommandPaletteDialog({Key? key}) : super(key: key);

  @override
  State<CommandPaletteDialog> createState() => _CommandPaletteDialogState();
}

class _CommandPaletteDialogState extends State<CommandPaletteDialog> {
  final TextEditingController _controller = TextEditingController();
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final state = context.watch<NetOpsState>();

    final screens = [
      {'title': 'Дашборд сети', 'desc': 'Общая сводка и ключевые метрики', 'tab': 0, 'icon': Icons.dashboard},
      {'title': 'Топология сети', 'desc': 'CLOS стенд (6 узлов) и Enterprise иерархия', 'tab': 1, 'icon': Icons.hub},
      {'title': 'Инвентарь устройств', 'desc': 'Список Arista, Cisco, Huawei, Juniper', 'tab': 2, 'icon': Icons.router},
      {'title': 'HierConfig Дифф & Деплой', 'desc': 'Просмотр дельт и раскатка конфигурации', 'tab': 3, 'icon': Icons.compare_arrows},
      {'title': 'Контроль дрейфа', 'desc': 'Поиск расхождений с Git и авто-устранение', 'tab': 4, 'icon': Icons.difference},
      {'title': 'Журнал задач', 'desc': 'История выполнения dry-run, deploy, scan', 'tab': 5, 'icon': Icons.task_alt},
      {'title': 'Телеметрия & TimesFM AI', 'desc': 'Графики нагрузки и прогноз аномалий', 'tab': 6, 'icon': Icons.show_chart},
      {'title': 'Chaos Lab', 'desc': 'Внедрение сетевых сбоев и проверка надежности', 'tab': 7, 'icon': Icons.science},
      {'title': 'AI Copilot', 'desc': 'Диалог с сетевым ассистентом Gemini & TimesFM', 'tab': 8, 'icon': Icons.auto_awesome},
      {'title': 'Презентация проекта', 'desc': 'Слайды архитектуры платформы КРОК', 'tab': 9, 'icon': Icons.slideshow},
    ];

    final filteredScreens = screens.where((s) {
      final t = (s['title'] as String).toLowerCase();
      final d = (s['desc'] as String).toLowerCase();
      return t.contains(_query.toLowerCase()) || d.contains(_query.toLowerCase());
    }).toList();

    final filteredDevices = state.devices.where((d) {
      final h = d.hostname.toLowerCase();
      final p = d.platform.toLowerCase();
      final ip = d.managementIp.toLowerCase();
      return h.contains(_query.toLowerCase()) || p.contains(_query.toLowerCase()) || ip.contains(_query.toLowerCase());
    }).toList();

    return Dialog(
      backgroundColor: NetOpsTheme.surfaceElevated,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14), side: const BorderSide(color: NetOpsTheme.borderHover)),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 550, maxHeight: 480),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            children: [
              // Search Input
              TextField(
                controller: _controller,
                autofocus: true,
                onChanged: (val) => setState(() => _query = val),
                decoration: InputDecoration(
                  prefixIcon: const Icon(Icons.search, size: 18, color: NetOpsTheme.cyanAction),
                  hintText: 'Поиск разделов, узлов, команд (Ctrl+K)...',
                  hintStyle: const TextStyle(fontSize: 13, color: Colors.grey),
                  suffixIcon: _query.isNotEmpty
                      ? IconButton(
                          icon: const Icon(Icons.clear, size: 16),
                          onPressed: () {
                            _controller.clear();
                            setState(() => _query = '');
                          },
                        )
                      : null,
                ),
              ),
              const SizedBox(height: 12),
              // Results List
              Expanded(
                child: ListView(
                  children: [
                    if (filteredScreens.isNotEmpty) ...[
                      const Padding(
                        padding: EdgeInsets.symmetric(vertical: 6, horizontal: 8),
                        child: Text('РАЗДЕЛЫ СИСТЕМЫ', style: TextStyle(fontSize: 10, color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1)),
                      ),
                      ...filteredScreens.map((s) => ListTile(
                            dense: true,
                            leading: Icon(s['icon'] as IconData, size: 18, color: NetOpsTheme.cyanAction),
                            title: Text(s['title'] as String, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                            subtitle: Text(s['desc'] as String, style: const TextStyle(fontSize: 11, color: Colors.grey)),
                            onTap: () {
                              state.setTab(s['tab'] as int);
                              Navigator.pop(context);
                            },
                          )),
                    ],
                    if (filteredDevices.isNotEmpty) ...[
                      const Padding(
                        padding: EdgeInsets.symmetric(vertical: 6, horizontal: 8),
                        child: Text('СЕТЕВЫЕ УЗЛЫ (ИНВЕНТАРЬ)', style: TextStyle(fontSize: 10, color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1)),
                      ),
                      ...filteredDevices.map((d) => ListTile(
                            dense: true,
                            leading: Icon(Icons.router, size: 18, color: NetOpsTheme.statusColor(d.status)),
                            title: Text(d.hostname, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                            subtitle: Text('${d.platform} • ${d.managementIp}:${d.managementPort} • ${d.status}', style: const TextStyle(fontSize: 11, color: Colors.grey)),
                            onTap: () {
                              state.setTab(2); // Go to devices
                              Navigator.pop(context);
                            },
                          )),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
