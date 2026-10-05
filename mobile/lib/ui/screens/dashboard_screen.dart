import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../theme.dart';
import '../../models/device.dart';
import '../../state/netops_state.dart';
import '../dry_run_modal.dart';

class DashboardScreen extends StatelessWidget {
  const DashboardScreen({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final state = context.watch<NetOpsState>();

    final total = state.devices.length;
    final inSync = state.devices.where((d) => d.status == 'IN_SYNC').length;
    final drifted = state.devices.where((d) => d.status == 'DRIFT_DETECTED').length;
    final syncRate = total > 0 ? ((inSync / total) * 100).toStringAsFixed(0) : '100';

    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // KPI Bento Grid
          LayoutBuilder(
            builder: (context, constraints) {
              final crossAxisCount = constraints.maxWidth < 600 ? 2 : 4;
              return GridView.count(
                crossAxisCount: crossAxisCount,
                crossAxisSpacing: 12,
                mainAxisSpacing: 12,
                shrinkWrap: true,
                physics: const NeverScrollableScrollException(),
                childAspectRatio: 1.6,
                children: [
                  _kpiCard(
                    title: 'ВСЕГО УСТРОЙСТВ',
                    value: '$total',
                    subtitle: '2 Arista • 2 Cisco • 2 Huawei • 2 Juniper',
                    icon: Icons.router,
                    color: NetOpsTheme.cyanAction,
                  ),
                  _kpiCard(
                    title: 'КОМПЛАЕНС (IN SYNC)',
                    value: '$syncRate%',
                    subtitle: '$inSync из $total в полном соответствии',
                    icon: Icons.check_circle_outline,
                    color: NetOpsTheme.emeraldSuccess,
                  ),
                  _kpiCard(
                    title: 'АКТИВНЫЙ ДРЕЙФ',
                    value: '$drifted',
                    subtitle: drifted > 0 ? 'Требуется нормализация' : 'Дрейф отсутствует',
                    icon: Icons.difference_outlined,
                    color: drifted > 0 ? NetOpsTheme.amberWarning : NetOpsTheme.emeraldSuccess,
                    onTap: () => state.setTab(4),
                  ),
                  _kpiCard(
                    title: 'ВЫПОЛНЕНО ЗАДАЧ',
                    value: '${state.jobs.length}',
                    subtitle: 'Dry-Run • Deploy • Scan',
                    icon: Icons.task_alt,
                    color: NetOpsTheme.violetAi,
                    onTap: () => state.setTab(5),
                  ),
                ],
              );
            },
          ),
          const SizedBox(height: 20),

          // Quick Action Bar
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: NetOpsTheme.surfaceCard,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: NetOpsTheme.borderHairline),
            ),
            child: Row(
              children: [
                Expanded(
                  child: ElevatedButton.icon(
                    onPressed: () {
                      showDialog(
                        context: context,
                        builder: (ctx) => const DryRunModalDialog(),
                      );
                    },
                    icon: const Icon(Icons.play_arrow, size: 16),
                    label: const Text('Запустить Dry-Run'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => state.scanDrift(),
                    icon: const Icon(Icons.search, size: 16),
                    label: const Text('Сканировать дрейф'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => state.syncInventory(),
                    icon: const Icon(Icons.sync, size: 16),
                    label: const Text('Синхронизация Git'),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),

          // CLOS 6-Nodes Status Grid
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'СТЕНД CLOS: 2 ARISTA + 2 CISCO + 2 HUAWEI (BARE METAL)',
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Colors.grey, letterSpacing: 1),
              ),
              TextButton(
                onPressed: () => state.setTab(1),
                child: const Text('Интерактивная топология →', style: TextStyle(fontSize: 12, color: NetOpsTheme.cyanAction)),
              ),
            ],
          ),
          const SizedBox(height: 8),

          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: NetOpsTheme.surfaceCard,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: NetOpsTheme.borderHairline),
            ),
            child: Column(
              children: [
                // Spines row
                _roleSectionHeader('SPINES (Arista EOS - 4.32.0F)'),
                const SizedBox(height: 8),
                Row(
                  children: state.devices
                      .where((d) => d.role == 'spine')
                      .map((d) => Expanded(child: _miniDeviceCard(context, d)))
                      .toList(),
                ),
                const SizedBox(height: 16),
                const Icon(Icons.swap_vert, size: 24, color: NetOpsTheme.cyanAction),
                const SizedBox(height: 16),
                // Leafs row
                _roleSectionHeader('LEAFS (2 Cisco IOS-XE + 2 Huawei VRP)'),
                const SizedBox(height: 8),
                Row(
                  children: state.devices
                      .where((d) => d.role == 'leaf')
                      .map((d) => Expanded(child: _miniDeviceCard(context, d)))
                      .toList(),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),

          // Recent Jobs
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'ПОСЛЕДНИЕ ОПЕРАЦИИ (JOBS PIPELINE)',
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Colors.grey, letterSpacing: 1),
              ),
              TextButton(
                onPressed: () => state.setTab(5),
                child: const Text('Все задачи →', style: TextStyle(fontSize: 12, color: NetOpsTheme.cyanAction)),
              ),
            ],
          ),
          const SizedBox(height: 8),

          Container(
            decoration: BoxDecoration(
              color: NetOpsTheme.surfaceCard,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: NetOpsTheme.borderHairline),
            ),
            child: state.jobs.isEmpty
                ? const Padding(
                    padding: EdgeInsets.all(24),
                    child: Center(child: Text('История задач пуста', style: TextStyle(color: Colors.grey))),
                  )
                : ListView.separated(
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollException(),
                    itemCount: state.jobs.length > 5 ? 5 : state.jobs.length,
                    separatorBuilder: (_, __) => const Divider(height: 1),
                    itemBuilder: (context, idx) {
                      final job = state.jobs[idx];
                      final statusColor = NetOpsTheme.statusColor(job.status);

                      return ListTile(
                        dense: true,
                        leading: Container(
                          padding: const EdgeInsets.all(6),
                          decoration: BoxDecoration(
                            color: statusColor.withOpacity(0.12),
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: Icon(
                            job.type == 'DEPLOY' ? Icons.rocket_launch : Icons.play_arrow,
                            size: 16,
                            color: statusColor,
                          ),
                        ),
                        title: Row(
                          children: [
                            Text(
                              job.type,
                              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
                            ),
                            const SizedBox(width: 8),
                            Text(
                              job.id.substring(0, job.id.length > 8 ? 8 : job.id.length),
                              style: const TextStyle(fontFamily: 'monospace', fontSize: 11, color: Colors.grey),
                            ),
                          ],
                        ),
                        subtitle: Text(
                          'Статус: ${job.status} • Прогресс: ${job.progress}% • Создал: ${job.createdBy}',
                          style: const TextStyle(fontSize: 11, color: Colors.grey),
                        ),
                        trailing: OutlinedButton(
                          onPressed: () {
                            state.selectJob(job.id);
                            state.setTab(3); // View diff
                          },
                          style: OutlinedButton.styleFrom(
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                          ),
                          child: const Text('Дифф', style: TextStyle(fontSize: 11)),
                        ),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }

  Widget _kpiCard({
    required String title,
    required String value,
    required String subtitle,
    required IconData icon,
    required Color color,
    VoidCallback? onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: NetOpsTheme.surfaceCard,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: NetOpsTheme.borderHairline),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(title, style: const TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: Colors.grey, letterSpacing: 0.8)),
                Icon(icon, size: 16, color: color),
              ],
            ),
            Text(value, style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: color)),
            Text(subtitle, style: const TextStyle(fontSize: 10, color: Colors.grey), overflow: TextOverflow.ellipsis),
          ],
        ),
      ),
    );
  }

  Widget _roleSectionHeader(String label) {
    return Align(
      alignment: Alignment.centerLeft,
      child: Text(
        label,
        style: const TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: Colors.grey, letterSpacing: 1),
      ),
    );
  }

  Widget _miniDeviceCard(BuildContext context, Device d) {
    final statusColor = NetOpsTheme.statusColor(d.status);

    return InkWell(
      onTap: () => _showDeviceSheet(context, d),
      borderRadius: BorderRadius.circular(8),
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: 4),
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: NetOpsTheme.surfaceElevated,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: statusColor.withOpacity(0.3)),
        ),
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Flexible(
                  child: Text(
                    d.hostname,
                    style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                Container(
                  width: 6,
                  height: 6,
                  decoration: BoxDecoration(color: statusColor, shape: BoxShape.circle),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              '${d.platform} • ${d.managementPort}',
              style: const TextStyle(fontFamily: 'monospace', fontSize: 9, color: Colors.grey),
            ),
          ],
        ),
      ),
    );
  }

  void _showDeviceSheet(BuildContext context, Device d) {
    final state = Provider.of<NetOpsState>(context, listen: false);

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
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(d.hostname, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: NetOpsTheme.statusColor(d.status).withOpacity(0.15),
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(color: NetOpsTheme.statusColor(d.status).withOpacity(0.3)),
                  ),
                  child: Text(d.status, style: TextStyle(color: NetOpsTheme.statusColor(d.status), fontSize: 10, fontWeight: FontWeight.bold)),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              'IP: ${d.managementIp}:${d.managementPort} • Платформа: ${d.platform} • Роль: ${d.role}',
              style: const TextStyle(color: Colors.grey, fontSize: 12),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: ElevatedButton.icon(
                    onPressed: () {
                      Navigator.pop(ctx);
                      state.executeDryRun([d.id]);
                    },
                    icon: const Icon(Icons.play_arrow, size: 16),
                    label: const Text('Запустить Dry-Run'),
                  ),
                ),
                if (d.status == 'DRIFT_DETECTED') ...[
                  const SizedBox(width: 10),
                  Expanded(
                    child: ElevatedButton.icon(
                      onPressed: () {
                        Navigator.pop(ctx);
                        state.remediateDrift(d.id);
                      },
                      icon: const Icon(Icons.build, size: 16),
                      label: const Text('Устранить дрейф'),
                      style: ElevatedButton.styleFrom(backgroundColor: NetOpsTheme.amberWarning, foregroundColor: Colors.black),
                    ),
                  ),
                ],
              ],
            ),
          ],
        ),
      ),
    );
  }
}
