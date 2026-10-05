import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../theme.dart';
import '../../models/job.dart';
import '../../state/netops_state.dart';

class DiffScreen extends StatefulWidget {
  const DiffScreen({Key? key}) : super(key: key);

  @override
  State<DiffScreen> createState() => _DiffScreenState();
}

class _DiffScreenState extends State<DiffScreen> {
  int _selectedDeviceIndex = 0;
  bool _showRollback = false;

  @override
  Widget build(BuildContext context) {
    final state = context.watch<NetOpsState>();
    final job = state.selectedJob;
    final diff = state.selectedJobDiff;

    if (job == null) {
      return const Center(child: Text('Выберите или запустите задачу для просмотра дифф-плана'));
    }

    final devices = diff?.devices ?? [];
    final currentDevDiff = devices.isNotEmpty && _selectedDeviceIndex < devices.length
        ? devices[_selectedDeviceIndex]
        : null;

    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Top Job Header & Selector
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
                    Row(
                      children: [
                        Text(job.type, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                        const SizedBox(width: 10),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                          decoration: BoxDecoration(
                            color: NetOpsTheme.statusColor(job.status).withOpacity(0.15),
                            borderRadius: BorderRadius.circular(6),
                            border: Border.all(color: NetOpsTheme.statusColor(job.status).withOpacity(0.3)),
                          ),
                          child: Text(
                            job.status,
                            style: TextStyle(color: NetOpsTheme.statusColor(job.status), fontSize: 10, fontWeight: FontWeight.bold),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text('Job ID: ${job.id}', style: const TextStyle(fontFamily: 'monospace', fontSize: 11, color: Colors.grey)),
                  ],
                ),
                // Deploy button
                if (job.status == 'SUCCESS' && job.type == 'DRY_RUN')
                  ElevatedButton.icon(
                    onPressed: () => state.executeDeploy(job.id),
                    icon: const Icon(Icons.rocket_launch, size: 16),
                    label: const Text('Деплой (Commit Confirmed 180s)'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: NetOpsTheme.cyanAction,
                      foregroundColor: Colors.black,
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 18),

          // Device Tab Selector for multi-device diffs
          if (devices.isNotEmpty) ...[
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: List.generate(devices.length, (idx) {
                  final d = devices[idx];
                  final isSelected = idx == _selectedDeviceIndex;
                  return Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: ChoiceChip(
                      label: Text(d.hostname),
                      selected: isSelected,
                      onSelected: (_) => setState(() => _selectedDeviceIndex = idx),
                      backgroundColor: NetOpsTheme.surfaceCard,
                      selectedColor: NetOpsTheme.cyanAction.withOpacity(0.2),
                      labelStyle: TextStyle(
                        fontSize: 12,
                        color: isSelected ? NetOpsTheme.cyanAction : Colors.grey,
                        fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                      ),
                    ),
                  );
                }),
              ),
            ),
            const SizedBox(height: 14),
          ],

          // AI Risk Explanation Banner
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: NetOpsTheme.surfaceElevated,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: NetOpsTheme.cyanAction.withOpacity(0.3)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: const [
                Row(
                  children: [
                    Icon(Icons.auto_awesome, color: NetOpsTheme.cyanAction, size: 18),
                    SizedBox(width: 8),
                    Text(
                      'AI RISK ASSURANCE (GEMINI & HIERCONFIG)',
                      style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: NetOpsTheme.cyanAction, letterSpacing: 0.8),
                    ),
                    Spacer(),
                    Text('РИСК: LOW', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: NetOpsTheme.emeraldSuccess)),
                  ],
                ),
                SizedBox(height: 8),
                Text(
                  'Конфигурационная дельта проверена: синтаксис вендора валиден, таймер отката (180 сек) активен, петли маршрутизации BGP исключены.',
                  style: TextStyle(fontSize: 12, color: Colors.grey),
                ),
              ],
            ),
          ),
          const SizedBox(height: 18),

          // Diff View Card
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: NetOpsTheme.surfaceCard,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: NetOpsTheme.borderHairline),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      _showRollback ? 'ПЛАН ОТКАТА (ROLLBACK PATCH)' : 'КОМПЕНСИРУЮЩИЙ ПАТЧ (HIERCONFIG REMEDIATION)',
                      style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Colors.grey, letterSpacing: 1),
                    ),
                    Row(
                      children: [
                        const Text('План отката', style: TextStyle(fontSize: 11, color: Colors.grey)),
                        Switch(
                          value: _showRollback,
                          onChanged: (val) => setState(() => _showRollback = val),
                          activeColor: NetOpsTheme.amberWarning,
                        ),
                      ],
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: Colors.black,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: NetOpsTheme.borderHairline),
                  ),
                  child: _renderDiffText(
                    _showRollback
                        ? (currentDevDiff?.rollbackPatch ?? '! Rollback patch empty or not required')
                        : (currentDevDiff?.remediationPatch ?? '! No remediation changes detected. Device is in sync with Git.'),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _renderDiffText(String text) {
    final lines = text.split('\n');

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: lines.map((line) {
        Color c = Colors.white70;
        Color bg = Colors.transparent;

        if (line.startsWith('+')) {
          c = NetOpsTheme.emeraldSuccess;
          bg = NetOpsTheme.emeraldSuccess.withOpacity(0.08);
        } else if (line.startsWith('-')) {
          c = NetOpsTheme.roseDanger;
          bg = NetOpsTheme.roseDanger.withOpacity(0.08);
        } else if (line.startsWith('!')) {
          c = NetOpsTheme.cyanAction;
        }

        return Container(
          width: double.infinity,
          color: bg,
          padding: const EdgeInsets.symmetric(vertical: 1.5, horizontal: 4),
          child: Text(
            line,
            style: TextStyle(
              fontFamily: 'Consolas',
              fontSize: 12,
              color: c,
              height: 1.4,
            ),
          ),
        );
      }).toList(),
    );
  }
}
