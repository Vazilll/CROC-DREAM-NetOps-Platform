import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../theme.dart';
import '../../state/netops_state.dart';

class ChaosLabScreen extends StatefulWidget {
  const ChaosLabScreen({Key? key}) : super(key: key);

  @override
  State<ChaosLabScreen> createState() => _ChaosLabScreenState();
}

class _ChaosLabScreenState extends State<ChaosLabScreen> {
  String? _activeChaosScenario;

  @override
  Widget build(BuildContext context) {
    final state = context.watch<NetOpsState>();

    final scenarios = [
      {
        'id': 'latency_spike',
        'title': 'Инжекция задержки (+180ms RTT)',
        'desc': 'Имитация перегрузки буфера транзитного линка Spine-1 ↔ Leaf-1',
        'icon': Icons.timer,
        'severity': 'MEDIUM',
        'color': NetOpsTheme.amberWarning,
      },
      {
        'id': 'packet_loss',
        'title': 'Потеря пакетов (15% Drop)',
        'desc': 'Эмуляция деградации оптического модуля SFP+ на интерфейсе Ethernet2',
        'icon': Icons.broken_image,
        'severity': 'HIGH',
        'color': NetOpsTheme.roseDanger,
      },
      {
        'id': 'bgp_flap',
        'title': 'Падение сессии BGP (Peer Drop)',
        'desc': 'Разрыв eBGP пиринга между Arista EOS и Cisco IOS-XE для проверки ECMP failover',
        'icon': Icons.swap_calls,
        'severity': 'CRITICAL',
        'color': NetOpsTheme.roseDanger,
      },
      {
        'id': 'leaf_blackhole',
        'title': 'Отказ узла (Leaf-4 Blackhole)',
        'desc': 'Полная изоляция коммутатора Huawei VRP и проверка перемаршрутизации трафика',
        'icon': Icons.power_off,
        'severity': 'CRITICAL',
        'color': NetOpsTheme.roseDanger,
      },
    ];

    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header
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
                      children: const [
                        Icon(Icons.science, color: NetOpsTheme.cyanAction, size: 20),
                        SizedBox(width: 8),
                        Text('CHAOS TESTING LAB (СТРЕСС-ТЕСТИРОВАНИЕ СЕТИ)', style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold)),
                      ],
                    ),
                    const SizedBox(height: 4),
                    const Text('Проверка отказоустойчивости гетерогенной CLOS-фабрики (BGP Fast Convergence, ECMP, BFD)', style: TextStyle(fontSize: 12, color: Colors.grey)),
                  ],
                ),
                if (_activeChaosScenario != null)
                  ElevatedButton.icon(
                    onPressed: () {
                      setState(() => _activeChaosScenario = null);
                      state.injectChaos('recovery');
                    },
                    icon: const Icon(Icons.restore, size: 16),
                    label: const Text('Сбросить сбои'),
                    style: ElevatedButton.styleFrom(backgroundColor: NetOpsTheme.emeraldSuccess, foregroundColor: Colors.black),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 20),

          // Active status alert
          if (_activeChaosScenario != null) ...[
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: NetOpsTheme.roseDanger.withOpacity(0.12),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: NetOpsTheme.roseDanger.withOpacity(0.4)),
              ),
              child: Row(
                children: [
                  const Icon(Icons.warning, color: NetOpsTheme.roseDanger, size: 22),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('АКТИВНА ИНЖЕКЦИЯ СБОЯ: $_activeChaosScenario', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: NetOpsTheme.roseDanger)),
                        const SizedBox(height: 2),
                        const Text('Автоматика мониторинга Zabbix и TimesFM отслеживает конвергенцию и перестроение маршрутов.', style: TextStyle(fontSize: 11, color: Colors.grey)),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),
          ],

          // Scenarios Grid
          const Text('СЦЕНАРИИ ИНЖЕКЦИИ СЕТЕВЫХ СБОЕВ', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Colors.grey, letterSpacing: 1)),
          const SizedBox(height: 10),

          LayoutBuilder(
            builder: (context, constraints) {
              final isWide = constraints.maxWidth > 700;
              final cards = scenarios.map((sc) {
                final color = sc['color'] as Color;
                final id = sc['id'] as String;
                final isActive = _activeChaosScenario == id;

                return Card(
                  margin: const EdgeInsets.only(bottom: 12),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                    side: BorderSide(color: isActive ? color : NetOpsTheme.borderHairline, width: isActive ? 2 : 1),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Row(
                              children: [
                                Icon(sc['icon'] as IconData, size: 20, color: color),
                                const SizedBox(width: 8),
                                Text(sc['title'] as String, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                              ],
                            ),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                              decoration: BoxDecoration(color: color.withOpacity(0.12), borderRadius: BorderRadius.circular(4)),
                              child: Text(sc['severity'] as String, style: TextStyle(color: color, fontSize: 9, fontWeight: FontWeight.bold)),
                            ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        Text(sc['desc'] as String, style: const TextStyle(fontSize: 11, color: Colors.grey)),
                        const SizedBox(height: 14),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.end,
                          children: [
                            ElevatedButton.icon(
                              onPressed: () {
                                setState(() => _activeChaosScenario = id);
                                state.injectChaos(id);
                              },
                              icon: const Icon(Icons.flash_on, size: 14),
                              label: Text(isActive ? 'Активен' : 'Активировать'),
                              style: ElevatedButton.styleFrom(
                                backgroundColor: isActive ? NetOpsTheme.surfaceElevated : color,
                                foregroundColor: isActive ? color : Colors.black,
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                );
              }).toList();

              if (isWide) {
                return GridView.count(
                  crossAxisCount: 2,
                  crossAxisSpacing: 12,
                  mainAxisSpacing: 12,
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollException(),
                  childAspectRatio: 2.1,
                  children: cards,
                );
              } else {
                return Column(children: cards);
              }
            },
          ),
        ],
      ),
    );
  }
}
