import 'package:flutter/material.dart';
import 'theme.dart';
import '../models/device.dart';

class DevicesScreen extends StatelessWidget {
  final List<Device> devices;
  final Function(Device) onDryRun;
  final Function(Device) onRemediate;

  const DevicesScreen({
    Key? key,
    required this.devices,
    required this.onDryRun,
    required this.onRemediate,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    if (devices.isEmpty) {
      return const Center(child: Text('Устройства не обнаружены'));
    }

    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: devices.length,
      itemBuilder: (context, index) {
        final d = devices[index];
        Color statusColor = NetOpsTheme.emeraldSuccess;
        if (d.status == 'DRIFT_DETECTED') statusColor = NetOpsTheme.amberWarning;
        if (d.status == 'UNREACHABLE') statusColor = NetOpsTheme.roseDanger;

        return Card(
          margin: const EdgeInsets.only(bottom: 12),
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
                        Container(
                          width: 8,
                          height: 8,
                          decoration: BoxDecoration(color: statusColor, shape: BoxShape.circle),
                        ),
                        const SizedBox(width: 8),
                        Text(d.hostname, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                      ],
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: statusColor.withOpacity(0.15),
                        borderRadius: BorderRadius.circular(6),
                        border: Border.all(color: statusColor.withOpacity(0.3)),
                      ),
                      child: Text(d.status, style: TextStyle(color: statusColor, fontSize: 10, fontWeight: FontWeight.bold)),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    _metaBadge('IP', d.managementIp),
                    const SizedBox(width: 8),
                    _metaBadge('Платформа', d.platform),
                    const SizedBox(width: 8),
                    _metaBadge('Роль', d.role),
                  ],
                ),
                const SizedBox(height: 12),
                Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    OutlinedButton.icon(
                      onPressed: () => onDryRun(d),
                      icon: const Icon(Icons.play_arrow, size: 14),
                      label: const Text('Dry-Run', style: TextStyle(fontSize: 12)),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: Colors.white,
                        side: const BorderSide(color: NetOpsTheme.borderHairline),
                      ),
                    ),
                    if (d.status == 'DRIFT_DETECTED') ...[
                      const SizedBox(width: 8),
                      ElevatedButton.icon(
                        onPressed: () => onRemediate(d),
                        icon: const Icon(Icons.build, size: 14),
                        label: const Text('Устранить дрейф', style: TextStyle(fontSize: 12)),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: NetOpsTheme.amberWarning,
                          foregroundColor: Colors.black,
                        ),
                      ),
                    ],
                  ],
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _metaBadge(String label, String value) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.04),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(
        '$label: $value',
        style: const TextStyle(fontFamily: 'monospace', fontSize: 10, color: Colors.grey),
      ),
    );
  }
}
