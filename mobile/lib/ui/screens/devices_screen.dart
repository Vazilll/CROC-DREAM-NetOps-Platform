import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../theme.dart';
import '../../models/device.dart';
import '../../state/netops_state.dart';

class DevicesScreen extends StatefulWidget {
  const DevicesScreen({Key? key}) : super(key: key);

  @override
  State<DevicesScreen> createState() => _DevicesScreenState();
}

class _DevicesScreenState extends State<DevicesScreen> {
  String _selectedPlatform = 'ALL';
  String _selectedStatus = 'ALL';
  String _searchQuery = '';

  @override
  Widget build(BuildContext context) {
    final state = context.watch<NetOpsState>();

    final filtered = state.devices.where((d) {
      if (_selectedPlatform != 'ALL' && !d.platform.toLowerCase().contains(_selectedPlatform.toLowerCase())) {
        return false;
      }
      if (_selectedStatus != 'ALL' && d.status != _selectedStatus) {
        return false;
      }
      if (_searchQuery.isNotEmpty) {
        final q = _searchQuery.toLowerCase();
        return d.hostname.toLowerCase().contains(q) || d.managementIp.contains(q);
      }
      return true;
    }).toList();

    return Column(
      children: [
        // Filter bar
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          decoration: const BoxDecoration(
            color: NetOpsTheme.surfaceElevated,
            border: Border(bottom: BorderSide(color: NetOpsTheme.borderHairline)),
          ),
          child: Column(
            children: [
              // Search input
              TextField(
                onChanged: (val) => setState(() => _searchQuery = val),
                decoration: InputDecoration(
                  prefixIcon: const Icon(Icons.search, size: 16, color: NetOpsTheme.cyanAction),
                  hintText: 'Поиск по имени хоста или IP...',
                  hintStyle: const TextStyle(fontSize: 12, color: Colors.grey),
                  isDense: true,
                ),
              ),
              const SizedBox(height: 10),
              // Filter chips
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(
                  children: [
                    _filterChip('ВСЕ ПЛАТФОРМЫ', 'ALL', _selectedPlatform, (v) => setState(() => _selectedPlatform = v)),
                    const SizedBox(width: 6),
                    _filterChip('Arista EOS', 'arista', _selectedPlatform, (v) => setState(() => _selectedPlatform = v)),
                    const SizedBox(width: 6),
                    _filterChip('Cisco IOS-XE', 'cisco', _selectedPlatform, (v) => setState(() => _selectedPlatform = v)),
                    const SizedBox(width: 6),
                    _filterChip('Huawei VRP', 'huawei', _selectedPlatform, (v) => setState(() => _selectedPlatform = v)),
                    const SizedBox(width: 6),
                    _filterChip('Juniper Junos', 'juniper', _selectedPlatform, (v) => setState(() => _selectedPlatform = v)),
                    const VerticalDivider(width: 16, color: NetOpsTheme.borderHairline),
                    _filterChip('Все статусы', 'ALL', _selectedStatus, (v) => setState(() => _selectedStatus = v)),
                    const SizedBox(width: 6),
                    _filterChip('In Sync', 'IN_SYNC', _selectedStatus, (v) => setState(() => _selectedStatus = v)),
                    const SizedBox(width: 6),
                    _filterChip('Drift', 'DRIFT_DETECTED', _selectedStatus, (v) => setState(() => _selectedStatus = v)),
                  ],
                ),
              ),
            ],
          ),
        ),

        // Device List
        Expanded(
          child: filtered.isEmpty
              ? const Center(child: Text('Устройства не найдены по заданным фильтрам', style: TextStyle(color: Colors.grey)))
              : ListView.builder(
                  padding: const EdgeInsets.all(16),
                  itemCount: filtered.length,
                  itemBuilder: (context, index) {
                    final d = filtered[index];
                    final statusColor = NetOpsTheme.statusColor(d.status);

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
                                    const SizedBox(width: 10),
                                    Text(d.hostname, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                                    const SizedBox(width: 8),
                                    Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                      decoration: BoxDecoration(
                                        color: Colors.white.withOpacity(0.05),
                                        borderRadius: BorderRadius.circular(4),
                                      ),
                                      child: Text(d.platform, style: const TextStyle(fontFamily: 'monospace', fontSize: 10, color: Colors.grey)),
                                    ),
                                  ],
                                ),
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                  decoration: BoxDecoration(
                                    color: statusColor.withOpacity(0.12),
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
                                _metaBadge('IP:Port', '${d.managementIp}:${d.managementPort}'),
                                const SizedBox(width: 8),
                                _metaBadge('Роль', d.role),
                                if (d.bgp != null) ...[
                                  const SizedBox(width: 8),
                                  _metaBadge('BGP ASN', '${d.bgp!.asn}'),
                                ],
                              ],
                            ),
                            const SizedBox(height: 14),
                            Row(
                              mainAxisAlignment: MainAxisAlignment.end,
                              children: [
                                OutlinedButton.icon(
                                  onPressed: () => _showDeviceDetails(context, d),
                                  icon: const Icon(Icons.info_outline, size: 14),
                                  label: const Text('Интерфейсы & BGP', style: TextStyle(fontSize: 11)),
                                ),
                                const SizedBox(width: 8),
                                OutlinedButton.icon(
                                  onPressed: () => state.executeDryRun([d.id]),
                                  icon: const Icon(Icons.play_arrow, size: 14),
                                  label: const Text('Dry-Run', style: TextStyle(fontSize: 11)),
                                ),
                                if (d.status == 'DRIFT_DETECTED') ...[
                                  const SizedBox(width: 8),
                                  ElevatedButton.icon(
                                    onPressed: () => state.remediateDrift(d.id),
                                    icon: const Icon(Icons.build, size: 14),
                                    label: const Text('Устранить дрейф', style: TextStyle(fontSize: 11)),
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
                ),
        ),
      ],
    );
  }

  Widget _filterChip(String label, String value, String current, Function(String) onSelect) {
    final isSelected = current == value;
    return ChoiceChip(
      label: Text(label),
      selected: isSelected,
      onSelected: (_) => onSelect(value),
      backgroundColor: NetOpsTheme.surfaceCard,
      selectedColor: NetOpsTheme.cyanAction.withOpacity(0.2),
      labelStyle: TextStyle(
        fontSize: 11,
        color: isSelected ? NetOpsTheme.cyanAction : Colors.grey,
        fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
      ),
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

  void _showDeviceDetails(BuildContext context, Device d) {
    showDialog(
      context: context,
      builder: (ctx) => Dialog(
        backgroundColor: NetOpsTheme.surfaceElevated,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14), side: const BorderSide(color: NetOpsTheme.borderHover)),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 600, maxHeight: 550),
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(d.hostname, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                    IconButton(icon: const Icon(Icons.close, size: 18), onPressed: () => Navigator.pop(ctx)),
                  ],
                ),
                Text('${d.platform} • ${d.managementIp}:${d.managementPort} • ${d.role}', style: const TextStyle(fontSize: 12, color: Colors.grey)),
                const SizedBox(height: 16),
                const Text('ИНТЕРФЕЙСЫ (INTENT)', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Colors.grey, letterSpacing: 1)),
                const SizedBox(height: 8),
                Expanded(
                  child: d.interfaces.isEmpty
                      ? Container(
                          padding: const EdgeInsets.all(16),
                          decoration: BoxDecoration(color: NetOpsTheme.surfaceCard, borderRadius: BorderRadius.circular(8)),
                          child: const Center(child: Text('Интерфейсы не описаны или сняты динамически', style: TextStyle(fontSize: 11, color: Colors.grey))),
                        )
                      : ListView.separated(
                          itemCount: d.interfaces.length,
                          separatorBuilder: (_, __) => const Divider(height: 1),
                          itemBuilder: (c, i) {
                            final iface = d.interfaces[i];
                            return ListTile(
                              dense: true,
                              title: Text(iface.name, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                              subtitle: Text('${iface.description ?? 'Без описания'} • MTU ${iface.mtu} • ${iface.mode.toUpperCase()}', style: const TextStyle(fontSize: 10, color: Colors.grey)),
                              trailing: Text(iface.ipv4Address ?? 'L2 Access', style: const TextStyle(fontFamily: 'monospace', fontSize: 11, color: NetOpsTheme.cyanAction)),
                            );
                          },
                        ),
                ),
                if (d.bgp != null) ...[
                  const SizedBox(height: 12),
                  const Text('BGP ПИРИНГ (EBGP FABRIC)', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Colors.grey, letterSpacing: 1)),
                  const SizedBox(height: 6),
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(color: NetOpsTheme.surfaceCard, borderRadius: BorderRadius.circular(8)),
                    child: Row(
                      children: [
                        Text('AS ${d.bgp!.asn}', style: const TextStyle(fontFamily: 'monospace', fontWeight: FontWeight.bold, color: NetOpsTheme.cyanAction)),
                        const SizedBox(width: 12),
                        Text('Router-ID: ${d.bgp!.routerId}', style: const TextStyle(fontFamily: 'monospace', fontSize: 11, color: Colors.grey)),
                      ],
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
