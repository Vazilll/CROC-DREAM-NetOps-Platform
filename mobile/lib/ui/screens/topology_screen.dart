import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../theme.dart';
import '../../models/device.dart';
import '../../state/netops_state.dart';

class TopologyScreen extends StatefulWidget {
  const TopologyScreen({Key? key}) : super(key: key);

  @override
  State<TopologyScreen> createState() => _TopologyScreenState();
}

class _TopologyScreenState extends State<TopologyScreen> {
  bool _isEnterpriseView = false;

  @override
  Widget build(BuildContext context) {
    final state = context.watch<NetOpsState>();

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
              const Text('Схема сети: ', style: TextStyle(fontSize: 12, color: Colors.grey)),
              const SizedBox(width: 8),
              ChoiceChip(
                label: const Text('CLOS Дата-центр (2 Arista + 2 Cisco + 2 Huawei)'),
                selected: !_isEnterpriseView,
                onSelected: (val) => setState(() => _isEnterpriseView = !val),
                backgroundColor: NetOpsTheme.surfaceCard,
                selectedColor: NetOpsTheme.cyanAction.withOpacity(0.2),
                labelStyle: TextStyle(
                  fontSize: 12,
                  color: !_isEnterpriseView ? NetOpsTheme.cyanAction : Colors.grey,
                  fontWeight: !_isEnterpriseView ? FontWeight.bold : FontWeight.normal,
                ),
              ),
              const SizedBox(width: 8),
              ChoiceChip(
                label: const Text('Иерархия КРОК (Enterprise Multi-Tier)'),
                selected: _isEnterpriseView,
                onSelected: (val) => setState(() => _isEnterpriseView = val),
                backgroundColor: NetOpsTheme.surfaceCard,
                selectedColor: NetOpsTheme.cyanAction.withOpacity(0.2),
                labelStyle: TextStyle(
                  fontSize: 12,
                  color: _isEnterpriseView ? NetOpsTheme.cyanAction : Colors.grey,
                  fontWeight: _isEnterpriseView ? FontWeight.bold : FontWeight.normal,
                ),
              ),
            ],
          ),
        ),

        // Interactive Topology Diagram
        Expanded(
          child: _isEnterpriseView ? _buildEnterpriseDiagram() : _buildClosDiagram(state.devices),
        ),
      ],
    );
  }

  Widget _buildClosDiagram(List<Device> devices) {
    final spines = devices.where((d) => d.role == 'spine').toList();
    final ciscoLeafs = devices.where((d) => d.role == 'leaf' && d.platform.contains('cisco')).toList();
    final huaweiLeafs = devices.where((d) => d.role == 'leaf' && d.platform.contains('huawei')).toList();
    final firewalls = devices.where((d) => d.role == 'border_firewall' || d.role == 'border').toList();

    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        children: [
          // Firewalls Tier
          if (firewalls.isNotEmpty) ...[
            const Text('BORDER FIREWALLS (Juniper Junos vSRX)', style: TextStyle(fontSize: 11, color: Colors.grey, letterSpacing: 1)),
            const SizedBox(height: 10),
            Wrap(
              spacing: 12,
              runSpacing: 12,
              alignment: WrapAlignment.center,
              children: firewalls.map((d) => _nodeCard(d, Icons.shield_outlined)).toList(),
            ),
            const SizedBox(height: 20),
            const Icon(Icons.arrow_downward, color: NetOpsTheme.cyanAction, size: 20),
            const SizedBox(height: 20),
          ],

          // Spines Tier
          const Text('УРОВЕНЬ SPINES (Arista EOS 4.32.0F - BGP EVPN / VXLAN)', style: TextStyle(fontSize: 11, color: Colors.grey, letterSpacing: 1)),
          const SizedBox(height: 12),
          Wrap(
            spacing: 16,
            runSpacing: 16,
            alignment: WrapAlignment.center,
            children: spines.map((d) => _nodeCard(d, Icons.share)).toList(),
          ),
          const SizedBox(height: 28),

          // Interconnect visual lines
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: const [
              Icon(Icons.swap_vert, color: NetOpsTheme.cyanAction, size: 28),
              SizedBox(width: 8),
              Text('eBGP Fabric Meshing (Unnumbered IPv6 / IPv4)', style: TextStyle(fontSize: 11, color: Colors.grey, fontFamily: 'monospace')),
            ],
          ),
          const SizedBox(height: 28),

          // Leafs Tier
          const Text('УРОВЕНЬ LEAFS: CISCO IOS-XE & HUAWEI VRP (HETEROGENEOUS)', style: TextStyle(fontSize: 11, color: Colors.grey, letterSpacing: 1)),
          const SizedBox(height: 12),
          Wrap(
            spacing: 14,
            runSpacing: 14,
            alignment: WrapAlignment.center,
            children: [
              ...ciscoLeafs.map((d) => _nodeCard(d, Icons.router)),
              ...huaweiLeafs.map((d) => _nodeCard(d, Icons.hub)),
            ],
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
          _tierHeader('ВНЕШНИЙ ПЕРИМЕТР (WAN & INTERNET BGP PEERING)'),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: [
              _virtualNode('WAN-GW-1', 'AS 65100 Gateway', Icons.public, '198.51.100.1'),
              _virtualNode('WAN-GW-2', 'AS 65100 Backup', Icons.public, '198.51.100.2'),
            ],
          ),
          const SizedBox(height: 18),

          _tierHeader('МЕЖСЕТЕВЫЕ ЭКРАНЫ & ДЕМzone (DMZ HIGH AVAILABILITY)'),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: [
              _virtualNode('FW-Active', 'DMZ Primary', Icons.shield, '192.168.50.1'),
              _virtualNode('DMZ Core', 'DNS / API / Auth', Icons.dns, '192.168.90.0/24'),
              _virtualNode('FW-Standby', 'DMZ Backup', Icons.shield, '192.168.50.2'),
            ],
          ),
          const SizedBox(height: 18),

          _tierHeader('ЯДРО СЕТИ (CORE SWITCH CHASSIS)'),
          Center(
            child: _virtualNode('Core-Aggregation', 'Multi-Chassis LACP & BGP', Icons.alt_route, '10.255.0.1'),
          ),
          const SizedBox(height: 18),

          _tierHeader('УРОВЕНЬ РАСПРЕДЕЛЕНИЯ (DISTRIBUTION SWITCHES)'),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: [
              _virtualNode('Dist-SW-1', 'HSRP Active (VLAN 10/20)', Icons.hub, '10.0.10.1'),
              _virtualNode('Dist-SW-2', 'HSRP Standby', Icons.hub, '10.0.10.2'),
            ],
          ),
          const SizedBox(height: 18),

          _tierHeader('УРОВЕНЬ ДОСТУПА & СЕГМЕНТЫ (ACCESS VLANS & USERS)'),
          Wrap(
            spacing: 12,
            runSpacing: 12,
            alignment: WrapAlignment.center,
            children: [
              _virtualNode('Access-1', 'VLAN 10 Corporate', Icons.devices, 'Port 1-24'),
              _virtualNode('Access-2', 'VLAN 20 IP Telephony', Icons.phone, 'Port 1-24'),
              _virtualNode('Access-3', 'VLAN 30 IoT & Sensors', Icons.sensors, 'Port 1-24'),
              _virtualNode('Clients', 'DHCP Dynamic Pool', Icons.computer, '10.0.10.100-200'),
            ],
          ),
        ],
      ),
    );
  }

  Widget _tierHeader(String title) {
    return Padding(
      padding: const EdgeInsets.only(top: 14, bottom: 8),
      child: Text(
        title,
        textAlign: TextAlign.center,
        style: const TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: NetOpsTheme.cyanAction, letterSpacing: 1.2),
      ),
    );
  }

  Widget _virtualNode(String name, String role, IconData icon, String ip) {
    return Container(
      width: 175,
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
            padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
            decoration: BoxDecoration(color: Colors.white.withOpacity(0.04), borderRadius: BorderRadius.circular(4)),
            child: Text(ip, style: const TextStyle(fontFamily: 'monospace', fontSize: 9, color: Colors.grey)),
          ),
        ],
      ),
    );
  }

  Widget _nodeCard(Device d, IconData icon) {
    final statusColor = NetOpsTheme.statusColor(d.status);

    return InkWell(
      onTap: () => _showDeviceSheet(context, d),
      borderRadius: BorderRadius.circular(12),
      child: Container(
        width: 165,
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: NetOpsTheme.surfaceCard,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: statusColor.withOpacity(0.35)),
        ),
        child: Column(
          children: [
            Icon(icon, size: 26, color: statusColor),
            const SizedBox(height: 8),
            Text(d.hostname, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13), overflow: TextOverflow.ellipsis),
            const SizedBox(height: 4),
            Text('${d.managementIp}:${d.managementPort}', style: const TextStyle(fontFamily: 'monospace', fontSize: 10, color: Colors.grey)),
            const SizedBox(height: 6),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: statusColor.withOpacity(0.15),
                borderRadius: BorderRadius.circular(4),
              ),
              child: Text(
                '${d.platform.split('_').first.toUpperCase()} • ${d.status}',
                style: TextStyle(color: statusColor, fontSize: 9, fontWeight: FontWeight.bold),
              ),
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
            if (d.bgp != null) ...[
              const SizedBox(height: 10),
              Text(
                'BGP AS: ${d.bgp!.asn} • Router-ID: ${d.bgp!.routerId}',
                style: const TextStyle(fontFamily: 'monospace', fontSize: 11, color: NetOpsTheme.cyanAction),
              ),
            ],
            const SizedBox(height: 18),
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
