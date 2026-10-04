import 'package:flutter/material.dart';
import 'theme.dart';
import '../models/device.dart';

class TopologyScreen extends StatefulWidget {
  final List<Device> devices;
  final Function(Device) onDeviceSelected;

  const TopologyScreen({
    Key? key,
    required this.devices,
    required this.onDeviceSelected,
  }) : super(key: key);

  @override
  State<TopologyScreen> createState() => _TopologyScreenState();
}

class _TopologyScreenState extends State<TopologyScreen> {
  bool isEnterpriseView = false;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        // Mode Selector Bar
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          decoration: const BoxDecoration(
            color: NetOpsTheme.surfaceElevated,
            border: Border(bottom: BorderSide(color: NetOpsTheme.borderHairline)),
          ),
          child: Row(
            children: [
              const Text('Схема топологии: ', style: TextStyle(fontSize: 12, color: Colors.grey)),
              const SizedBox(width: 8),
              ChoiceChip(
                label: const Text('CLOS Дата-центр (Стенд)'),
                selected: !isEnterpriseView,
                onSelected: (val) => setState(() => isEnterpriseView = !val),
                backgroundColor: NetOpsTheme.surfaceCard,
                selectedColor: NetOpsTheme.cyanAction.withOpacity(0.2),
                labelStyle: TextStyle(
                  fontSize: 12,
                  color: !isEnterpriseView ? NetOpsTheme.cyanAction : Colors.grey,
                ),
              ),
              const SizedBox(width: 8),
              ChoiceChip(
                label: const Text('Иерархия КРОК (Enterprise)'),
                selected: isEnterpriseView,
                onSelected: (val) => setState(() => isEnterpriseView = val),
                backgroundColor: NetOpsTheme.surfaceCard,
                selectedColor: NetOpsTheme.cyanAction.withOpacity(0.2),
                labelStyle: TextStyle(
                  fontSize: 12,
                  color: isEnterpriseView ? NetOpsTheme.cyanAction : Colors.grey,
                ),
              ),
            ],
          ),
        ),

        // Interactive Topology Diagram
        Expanded(
          child: isEnterpriseView ? _buildEnterpriseDiagram() : _buildClosDiagram(),
        ),
      ],
    );
  }

  Widget _buildClosDiagram() {
    final spines = widget.devices.where((d) => d.role == 'spine').toList();
    final leafs = widget.devices.where((d) => d.role == 'leaf').toList();

    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        children: [
          const Text('УРОВЕНЬ SPINES (Arista EOS - 4.32.0F)', style: TextStyle(fontSize: 11, color: Colors.grey, letterSpacing: 1)),
          const SizedBox(height: 12),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: spines.map((d) => _nodeCard(d, Icons.share)).toList(),
          ),
          const SizedBox(height: 32),
          const Icon(Icons.swap_vert, color: NetOpsTheme.cyanAction, size: 28),
          const SizedBox(height: 32),
          const Text('УРОВЕНЬ LEAFS (Cisco IOS-XE / Arista)', style: TextStyle(fontSize: 11, color: Colors.grey, letterSpacing: 1)),
          const SizedBox(height: 12),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: leafs.map((d) => _nodeCard(d, Icons.router)).toList(),
          ),
        ],
      ),
    );
  }

  Widget _buildEnterpriseDiagram() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _tierHeader('ВНЕШНИЙ ПЕРИМЕТР (WAN & INTERNET)'),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: [
              _virtualNode('Router A', 'WAN Gateway', Icons.public, '198.51.100.1'),
              _virtualNode('Router B', 'WAN Gateway (Backup)', Icons.public, '198.51.100.2'),
            ],
          ),
          const SizedBox(height: 16),

          _tierHeader('МЕЖСЕТЕВЫЕ ЭКРАНЫ & ДЕМzone (DMZ)'),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: [
              _virtualNode('Firewall A', 'DMZ Primary', Icons.shield, '192.168.50.1'),
              _virtualNode('DMZ Servers', 'Web / Mail / DNS', Icons.dns, '192.168.90.0/24'),
              _virtualNode('Firewall B', 'DMZ Secondary', Icons.shield, '192.168.50.2'),
            ],
          ),
          const SizedBox(height: 16),

          _tierHeader('ЯДРО СЕТИ (CORE SWITCH)'),
          Center(
            child: _virtualNode('Core Switch', 'Multi-Chassis Aggregation', Icons.alt_route, '10.255.0.1'),
          ),
          const SizedBox(height: 16),

          _tierHeader('УРОВЕНЬ РАСПРЕДЕЛЕНИЯ (DISTRIBUTION)'),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: [
              _virtualNode('Dist Switch A', 'HSRP Active', Icons.hub, '10.0.10.1'),
              _virtualNode('Dist Switch B', 'HSRP Standby', Icons.hub, '10.0.10.2'),
            ],
          ),
          const SizedBox(height: 16),

          _tierHeader('УРОВЕНЬ ДОСТУПА & СЕГМЕНТЫ (ACCESS & VLANS)'),
          Wrap(
            spacing: 12,
            runSpacing: 12,
            alignment: WrapAlignment.center,
            children: [
              _virtualNode('Access SW 1', 'Data VLAN 10 (10.0.10.0/24)', Icons.devices, 'Port 1-24'),
              _virtualNode('Access SW 2', 'Voice VLAN 20 (10.0.20.0/24)', Icons.phone, 'Port 1-24'),
              _virtualNode('Access SW 3', 'Workstations 1-4', Icons.computer, 'DHCP Pool'),
            ],
          ),
        ],
      ),
    );
  }

  Widget _tierHeader(String title) {
    return Padding(
      padding: const EdgeInsets.only(top: 12, bottom: 8),
      child: Text(
        title,
        textAlign: TextAlign.center,
        style: const TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: NetOpsTheme.cyanAction, letterSpacing: 1.2),
      ),
    );
  }

  Widget _virtualNode(String name, String role, IconData icon, String ip) {
    return Container(
      width: 170,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: NetOpsTheme.surfaceCard,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: NetOpsTheme.borderHairline),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 16, color: NetOpsTheme.cyanAction),
              const SizedBox(width: 6),
              Expanded(child: Text(name, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold))),
            ],
          ),
          const SizedBox(height: 4),
          Text(role, style: const TextStyle(fontSize: 10, color: Colors.grey)),
          const SizedBox(height: 6),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
            decoration: BoxDecoration(color: Colors.white.withOpacity(0.04), borderRadius: BorderRadius.circular(4)),
            child: Text(ip, style: const TextStyle(fontFamily: 'monospace', fontSize: 9, color: Colors.grey)),
          ),
        ],
      ),
    );
  }

  Widget _nodeCard(Device d, IconData icon) {
    Color statusColor = NetOpsTheme.emeraldSuccess;
    if (d.status == 'DRIFT_DETECTED') statusColor = NetOpsTheme.amberWarning;
    if (d.status == 'UNREACHABLE') statusColor = NetOpsTheme.roseDanger;

    return InkWell(
      onTap: () => widget.onDeviceSelected(d),
      borderRadius: BorderRadius.circular(12),
      child: Container(
        width: 160,
        margin: const EdgeInsets.symmetric(horizontal: 8),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: NetOpsTheme.surfaceCard,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: statusColor.withOpacity(0.3)),
        ),
        child: Column(
          children: [
            Icon(icon, size: 24, color: statusColor),
            const SizedBox(height: 8),
            Text(d.hostname, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13), overflow: TextOverflow.ellipsis),
            const SizedBox(height: 4),
            Text(d.managementIp, style: const TextStyle(fontFamily: 'monospace', fontSize: 11, color: Colors.grey)),
            const SizedBox(height: 6),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: statusColor.withOpacity(0.15),
                borderRadius: BorderRadius.circular(4),
              ),
              child: Text(d.status, style: TextStyle(color: statusColor, fontSize: 9, fontWeight: FontWeight.bold)),
            ),
          ],
        ),
      ),
    );
  }
}
