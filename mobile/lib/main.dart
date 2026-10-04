import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'services/api_service.dart';
import 'state/netops_state.dart';
import 'ui/theme.dart';
import 'ui/responsive_scaffold.dart';
import 'ui/screens/dashboard_screen.dart';
import 'ui/screens/topology_screen.dart';
import 'ui/screens/devices_screen.dart';
import 'ui/screens/diff_screen.dart';
import 'ui/screens/drift_screen.dart';
import 'ui/screens/jobs_screen.dart';
import 'ui/screens/telemetry_screen.dart';
import 'ui/screens/chaos_lab_screen.dart';
import 'ui/screens/copilot_screen.dart';
import 'ui/screens/slides_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  final apiService = ApiService(baseUrl: 'http://127.0.0.1:8000');

  runApp(
    ChangeNotifierProvider(
      create: (_) => NetOpsState(api: apiService),
      child: const CrocNetOpsApp(),
    ),
  );
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

class MainCockpit extends StatelessWidget {
  const MainCockpit({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final state = context.watch<NetOpsState>();

    Widget activeScreen;
    switch (state.activeTab) {
      case 0:
        activeScreen = const DashboardScreen();
        break;
      case 1:
        activeScreen = const TopologyScreen();
        break;
      case 2:
        activeScreen = const DevicesScreen();
        break;
      case 3:
        activeScreen = const DiffScreen();
        break;
      case 4:
        activeScreen = const DriftScreen();
        break;
      case 5:
        activeScreen = const JobsScreen();
        break;
      case 6:
        activeScreen = const TelemetryScreen();
        break;
      case 7:
        activeScreen = const ChaosLabScreen();
        break;
      case 8:
        activeScreen = const CopilotScreen();
        break;
      case 9:
        activeScreen = const SlidesScreen();
        break;
      default:
        activeScreen = const DashboardScreen();
        break;
    }

    return ResponsiveScaffold(
      body: activeScreen,
    );
  }
}
