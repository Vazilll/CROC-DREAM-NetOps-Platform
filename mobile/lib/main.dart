import 'package:flutter/material.dart';
import 'models/device.dart';
import 'models/job.dart';
import 'services/api_service.dart';
import 'ui/theme.dart';
import 'ui/responsive_scaffold.dart';
import 'ui/topology_screen.dart';
import 'ui/devices_screen.dart';
import 'ui/telemetry_screen.dart';

void main() {
  runApp(const CrocNetOpsApp());
}

class CrocNetOpsApp extends StatelessWidget {
  const CrocNetOpsApp({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'CROC NetOps Cockpit',
      debugShowCheckedModeBanner: false,
      theme: NetOpsTheme.darkTheme,
      home: const MainCockpit(),
    );
  }
}

class MainCockpit extends StatefulWidget {
  const MainCockpit({Key? key}) : super(key: key);

  @override
  State<MainCockpit> createState() => _MainCockpitState();
}

class _MainCockpitState extends State<MainCockpit> {
  final ApiService _api = ApiService();
  int _currentIndex = 0;
  List<Device> _devices = [];
  List<TelemetryMetric> _metrics = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    setState(() => _loading = true);
    try {
      final devs = await _api.getDevices();
      final metrics = _api.getMockTelemetry();
      setState(() {
        _devices = devs;
        _metrics = metrics;
        _loading = false;
      });
    } catch (e) {
      // Fallback demo data if backend unreachable
      setState(() {
        _devices = [
          Device(id: 1, hostname: 'spine-1.croc.lab', managementIp: '172.20.20.11', managementPort: 2211, platform: 'arista_eos', role: 'spine', status: 'IN_SYNC'),
          Device(id: 2, hostname: 'spine-2.croc.lab', managementIp: '172.20.20.12', managementPort: 2212, platform: 'arista_eos', role: 'spine', status: 'IN_SYNC'),
          Device(id: 3, hostname: 'leaf-1.croc.lab', managementIp: '172.20.20.21', managementPort: 2221, platform: 'cisco_iosxe', role: 'leaf', status: 'IN_SYNC'),
          Device(id: 4, hostname: 'leaf-2.croc.lab', managementIp: '172.20.20.22', managementPort: 2222, platform: 'cisco_iosxe', role: 'leaf', status: 'DRIFT_DETECTED'),
        ];
        _metrics = _api.getMockTelemetry();
        _loading = false;
      });
    }
  }

  void _onDryRun(Device d) async {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Запуск Dry-Run для ${d.hostname}...')),
    );
    try {
      await _api.triggerDryRun([d.id]);
    } catch (_) {}
  }

  void _onRemediate(Device d) async {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Устранение дрейфа для ${d.hostname}...')),
    );
    try {
      await _api.scanDrift(deviceIds: [d.id]);
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    Widget activeScreen;
    switch (_currentIndex) {
      case 0:
        activeScreen = TopologyScreen(
          devices: _devices,
          onDeviceSelected: (d) => _showDeviceSheet(d),
        );
        break;
      case 1:
        activeScreen = DevicesScreen(
          devices: _devices,
          onDryRun: _onDryRun,
          onRemediate: _onRemediate,
        );
        break;
      case 2:
        activeScreen = TelemetryScreen(metrics: _metrics);
        break;
      case 3:
        activeScreen = _buildDriftList();
        break;
      case 4:
      default:
        activeScreen = _buildJobsList();
        break;
    }

    return ResponsiveScaffold(
      selectedIndex: _currentIndex,
      onDestinationSelected: (i) => setState(() => _currentIndex = i),
      title: _screenTitle(_currentIndex),
      actions: [
        IconButton(
          icon: const Icon(Icons.refresh, size: 18),
          onPressed: _loadData,
          tooltip: 'Обновить данные',
        ),
      ],
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: NetOpsTheme.cyanAction))
          : activeScreen,
    );
  }

  String _screenTitle(int idx) {
    switch (idx) {
      case 0: return 'Топология сети';
      case 1: return 'Инвентарь устройств';
      case 2: return 'Метрики и Телеметрия';
      case 3: return 'Контроль дрейфа (Drift)';
      case 4: return 'Журнал задач (Jobs)';
      default: return 'NetOps Platform';
    }
  }

  Widget _buildDriftList() {
    final drifted = _devices.where((d) => d.status == 'DRIFT_DETECTED').toList();
    if (drifted.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: const [
            Icon(Icons.check_circle_outline, color: NetOpsTheme.emeraldSuccess, size: 48),
            SizedBox(height: 12),
            Text('Конфигурация в полном комплаенсе', style: TextStyle(fontWeight: FontWeight.bold)),
            Text('Несанкционированных изменений не обнаружено', style: TextStyle(color: Colors.grey, fontSize: 12)),
          ],
        ),
      );
    }
    return ListView(
      padding: const EdgeInsets.all(16),
      children: drifted.map((d) => Card(
        child: ListTile(
          leading: const Icon(Icons.warning_amber_rounded, color: NetOpsTheme.amberWarning),
          title: Text(d.hostname, style: const TextStyle(fontWeight: FontWeight.bold)),
          subtitle: const Text('Обнаружен дрейф: расхождение с эталоном Git', style: TextStyle(fontSize: 12, color: Colors.grey)),
          trailing: ElevatedButton(
            onPressed: () => _onRemediate(d),
            style: ElevatedButton.styleFrom(backgroundColor: NetOpsTheme.amberWarning, foregroundColor: Colors.black),
            child: const Text('Устранить', style: TextStyle(fontSize: 11)),
          ),
        ),
      )).toList(),
    );
  }

  Widget _buildJobsList() {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Card(
          child: ListTile(
            leading: const Icon(Icons.check_circle, color: NetOpsTheme.emeraldSuccess),
            title: const Text('dry-run: spine-1, spine-2', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
            subtitle: const Text('Статус: SUCCESS • 100% • 1.2s', style: TextStyle(fontSize: 11, color: Colors.grey)),
            trailing: const Text('15:02:14', style: TextStyle(fontFamily: 'monospace', fontSize: 10, color: Colors.grey)),
          ),
        ),
        Card(
          child: ListTile(
            leading: const Icon(Icons.check_circle, color: NetOpsTheme.emeraldSuccess),
            title: const Text('drift-scan: all devices', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
            subtitle: const Text('Статус: SUCCESS • 100% • 0.8s', style: TextStyle(fontSize: 11, color: Colors.grey)),
            trailing: const Text('14:45:00', style: TextStyle(fontFamily: 'monospace', fontSize: 10, color: Colors.grey)),
          ),
        ),
      ],
    );
  }

  void _showDeviceSheet(Device d) {
    showModalBottomSheet(
      context: context,
      backgroundColor: NetOpsTheme.surfaceElevated,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
      builder: (ctx) => Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(d.hostname, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            Text('IP: ${d.managementIp}:${d.managementPort} • Платформа: ${d.platform} • Роль: ${d.role}', style: const TextStyle(color: Colors.grey, fontSize: 12)),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: ElevatedButton.icon(
                    onPressed: () {
                      Navigator.pop(ctx);
                      _onDryRun(d);
                    },
                    icon: const Icon(Icons.play_arrow, size: 16),
                    label: const Text('Запустить Dry-Run'),
                    style: ElevatedButton.styleFrom(backgroundColor: NetOpsTheme.cyanAction, foregroundColor: Colors.black),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
