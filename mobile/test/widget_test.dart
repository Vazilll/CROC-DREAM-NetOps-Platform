import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:croc_netops_mobile/services/api_service.dart';
import 'package:croc_netops_mobile/state/netops_state.dart';
import 'package:croc_netops_mobile/ui/theme.dart';
import 'package:croc_netops_mobile/ui/responsive_scaffold.dart';
import 'package:croc_netops_mobile/ui/screens/dashboard_screen.dart';

void main() {
  testWidgets('CrocNetOps Cockpit initializes and renders Dashboard correctly', (WidgetTester tester) async {
    final api = ApiService(baseUrl: 'http://127.0.0.1:8000');
    final state = NetOpsState(api: api);

    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: state,
        child: MaterialApp(
          theme: NetOpsTheme.darkTheme,
          home: const ResponsiveScaffold(
            body: DashboardScreen(),
          ),
        ),
      ),
    );

    // Initial pump
    await tester.pumpAndSettle();

    // Verify Brand title is rendered
    expect(find.text('CROC DREAM'), findsOneWidget);

    // Verify KPI sections
    expect(find.text('ВСЕГО УСТРОЙСТВ'), findsOneWidget);
    expect(find.text('КОМПЛАЕНС (IN SYNC)'), findsOneWidget);
    expect(find.text('АКТИВНЫЙ ДРЕЙФ'), findsOneWidget);

    // Verify CLOS topology header is present
    expect(find.text('СТЕНД CLOS: 2 ARISTA + 2 CISCO + 2 HUAWEI (BARE METAL)'), findsOneWidget);
  });
}
