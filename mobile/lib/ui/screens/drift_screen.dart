import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../theme.dart';
import '../../state/netops_state.dart';

class DriftScreen extends StatelessWidget {
  const DriftScreen({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final state = context.watch<NetOpsState>();
    final report = state.driftReport;
    final drifted = report.where((r) => r.status == 'DRIFT_DETECTED').toList();
    final inSync = report.where((r) => r.status == 'IN_SYNC').toList();

    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header & Scan Button
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: NetOpsTheme.surfaceCard,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: NetOpsTheme.borderHairline),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('КОНТРОЛЬ ДРЕЙФА (GIT DRIFT COMPLIANCE)', style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold)),
                    const SizedBox(height: 4),
                    Text(
                      'Проверено: ${report.length} узлов • В комплаенсе: ${inSync.length} • Дрейф: ${drifted.length}',
                      style: const TextStyle(fontSize: 12, color: Colors.grey),
                    ),
                  ],
                ),
                ElevatedButton.icon(
                  onPressed: () => state.scanDrift(),
                  icon: const Icon(Icons.radar, size: 16),
                  label: const Text('Запустить скан дрейфа'),
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),

          // Drift List or All Clear
          if (drifted.isEmpty) ...[
            Container(
              padding: const EdgeInsets.all(36),
              decoration: BoxDecoration(
                color: NetOpsTheme.surfaceCard,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: NetOpsTheme.emeraldSuccess.withOpacity(0.3)),
              ),
              child: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: const [
                    Icon(Icons.check_circle_outline, color: NetOpsTheme.emeraldSuccess, size: 48),
                    SizedBox(height: 14),
                    Text('Вся сеть полностью соответствует эталону Git', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                    SizedBox(height: 6),
                    Text('Несанкционированных изменений конфигураций (Out-of-band) не обнаружено.', style: TextStyle(fontSize: 12, color: Colors.grey)),
                  ],
                ),
              ),
            ),
          ] else ...[
            Text(
              'ОБНАРУЖЕН ДРЕЙФ (${drifted.length} УЗЛА)',
              style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: NetOpsTheme.amberWarning, letterSpacing: 1),
            ),
            const SizedBox(height: 10),
            ...drifted.map((item) => Card(
                  margin: const EdgeInsets.only(bottom: 14),
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Row(
                              children: [
                                const Icon(Icons.warning_amber_rounded, color: NetOpsTheme.amberWarning, size: 20),
                                const SizedBox(width: 8),
                                Text(item.hostname, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
                              ],
                            ),
                            ElevatedButton.icon(
                              onPressed: () => state.remediateDrift(item.deviceId),
                              icon: const Icon(Icons.build, size: 14),
                              label: const Text('Устранить дрейф (Remediate)'),
                              style: ElevatedButton.styleFrom(
                                backgroundColor: NetOpsTheme.amberWarning,
                                foregroundColor: Colors.black,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        Text('Последняя проверка: ${item.checkedAt}', style: const TextStyle(fontSize: 10, color: Colors.grey)),
                        const SizedBox(height: 12),

                        // Unauthorized lines
                        if (item.unauthorizedLines.isNotEmpty) ...[
                          const Text('Несанкционированные строки (удалить):', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: NetOpsTheme.roseDanger)),
                          const SizedBox(height: 4),
                          Container(
                            width: double.infinity,
                            padding: const EdgeInsets.all(10),
                            decoration: BoxDecoration(color: Colors.black, borderRadius: BorderRadius.circular(6)),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: item.unauthorizedLines.map((l) => Text('- $l', style: const TextStyle(fontFamily: 'Consolas', fontSize: 11, color: NetOpsTheme.roseDanger))).toList(),
                            ),
                          ),
                          const SizedBox(height: 10),
                        ],

                        // Missing lines
                        if (item.missingLines.isNotEmpty) ...[
                          const Text('Отсутствующие строки (восстановить из Git):', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: NetOpsTheme.emeraldSuccess)),
                          const SizedBox(height: 4),
                          Container(
                            width: double.infinity,
                            padding: const EdgeInsets.all(10),
                            decoration: BoxDecoration(color: Colors.black, borderRadius: BorderRadius.circular(6)),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: item.missingLines.map((l) => Text('+ $l', style: const TextStyle(fontFamily: 'Consolas', fontSize: 11, color: NetOpsTheme.emeraldSuccess))).toList(),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                )),
          ],

          const SizedBox(height: 24),
          // In sync devices
          if (inSync.isNotEmpty) ...[
            Text(
              'УЗЛЫ В ПОЛНОМ КОМПЛАЕНСЕ (${inSync.length})',
              style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Colors.grey, letterSpacing: 1),
            ),
            const SizedBox(height: 10),
            ...inSync.map((item) => Card(
                  margin: const EdgeInsets.only(bottom: 8),
                  child: ListTile(
                    dense: true,
                    leading: const Icon(Icons.check_circle, color: NetOpsTheme.emeraldSuccess, size: 18),
                    title: Text(item.hostname, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                    subtitle: Text('Проверено: ${item.checkedAt}', style: const TextStyle(fontSize: 10, color: Colors.grey)),
                    trailing: const Text('100% MATCH', style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: NetOpsTheme.emeraldSuccess)),
                  ),
                )),
          ],
        ],
      ),
    );
  }
}
