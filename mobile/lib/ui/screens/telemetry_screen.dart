import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../theme.dart';
import '../../models/job.dart';
import '../../models/forecast.dart';
import '../../state/netops_state.dart';

class TelemetryScreen extends StatefulWidget {
  const TelemetryScreen({Key? key}) : super(key: key);

  @override
  State<TelemetryScreen> createState() => _TelemetryScreenState();
}

class _TelemetryScreenState extends State<TelemetryScreen> {
  String _selectedMetric = 'cpu';

  @override
  Widget build(BuildContext context) {
    final state = context.watch<NetOpsState>();
    final metrics = state.telemetry;
    final forecast = state.forecast;

    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Section 1: Real-time Telemetry
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: const [
              Text(
                'РЕАЛЬНАЯ ТЕЛЕМЕТРИЯ ФАБРИКИ (REAL-TIME METRICS)',
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Colors.grey, letterSpacing: 1),
              ),
              Text('Период: 5 мин • eBGP RTT', style: TextStyle(fontSize: 11, color: Colors.grey)),
            ],
          ),
          const SizedBox(height: 12),

          LayoutBuilder(
            builder: (context, constraints) {
              final isWide = constraints.maxWidth > 800;
              final cards = [
                _metricCard(
                  title: 'Пропускная способность (Throughput)',
                  subtitle: 'Агрегированный трафик фабрики Spines / Leafs',
                  value: '${metrics.isNotEmpty ? metrics.last.throughputMbps.toStringAsFixed(0) : 620} Mbps',
                  color: NetOpsTheme.cyanAction,
                  dataPoints: metrics.map((m) => m.throughputMbps).toList(),
                ),
                _metricCard(
                  title: 'Задержка Fabric RTT (Latency)',
                  subtitle: 'Время отклика eBGP Spine ↔ Leaf',
                  value: '${metrics.isNotEmpty ? metrics.last.latencyMs.toStringAsFixed(2) : 1.15} ms',
                  color: NetOpsTheme.emeraldSuccess,
                  dataPoints: metrics.map((m) => m.latencyMs * 100).toList(),
                ),
                _metricCard(
                  title: 'Утилизация процессора (CPU)',
                  subtitle: 'Нагрузка управляющей плоскости (Control Plane)',
                  value: '${metrics.isNotEmpty ? metrics.last.cpuPct.toStringAsFixed(1) : 24.5} %',
                  color: NetOpsTheme.amberWarning,
                  dataPoints: metrics.map((m) => m.cpuPct).toList(),
                ),
                _metricCard(
                  title: 'Утилизация памяти (RAM)',
                  subtitle: 'Буферы маршрутизации и BGP RIB/FIB',
                  value: '${metrics.isNotEmpty ? metrics.last.ramPct.toStringAsFixed(1) : 46.2} %',
                  color: NetOpsTheme.violetAi,
                  dataPoints: metrics.map((m) => m.ramPct).toList(),
                ),
              ];

              if (isWide) {
                return GridView.count(
                  crossAxisCount: 2,
                  crossAxisSpacing: 12,
                  mainAxisSpacing: 12,
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollException(),
                  childAspectRatio: 2.2,
                  children: cards,
                );
              } else {
                return Column(
                  children: cards.map((c) => Padding(padding: const EdgeInsets.only(bottom: 12), child: c)).toList(),
                );
              }
            },
          ),
          const SizedBox(height: 28),

          // Section 2: TimesFM-3.0 AI Forecast
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: NetOpsTheme.surfaceCard,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: NetOpsTheme.violetAi.withOpacity(0.35)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Row(
                      children: const [
                        Icon(Icons.auto_awesome, color: NetOpsTheme.violetAi, size: 20),
                        SizedBox(width: 8),
                        Text(
                          'TIMESFM-3.0 FOUNDATION MODEL (ПРЕДИКТИВНАЯ АНАЛИТИКА)',
                          style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: NetOpsTheme.violetAi, letterSpacing: 0.8),
                        ),
                      ],
                    ),
                    Row(
                      children: [
                        ChoiceChip(
                          label: const Text('CPU Load (%)'),
                          selected: _selectedMetric == 'cpu',
                          onSelected: (_) {
                            setState(() => _selectedMetric = 'cpu');
                            if (state.devices.isNotEmpty) {
                              state.loadForecast(state.devices.first.id, 'cpu');
                            }
                          },
                          backgroundColor: NetOpsTheme.surfaceElevated,
                          selectedColor: NetOpsTheme.violetAi.withOpacity(0.2),
                          labelStyle: TextStyle(
                            fontSize: 11,
                            color: _selectedMetric == 'cpu' ? NetOpsTheme.violetAi : Colors.grey,
                            fontWeight: _selectedMetric == 'cpu' ? FontWeight.bold : FontWeight.normal,
                          ),
                        ),
                        const SizedBox(width: 8),
                        ChoiceChip(
                          label: const Text('Throughput (Mbps)'),
                          selected: _selectedMetric == 'throughput',
                          onSelected: (_) {
                            setState(() => _selectedMetric = 'throughput');
                            if (state.devices.isNotEmpty) {
                              state.loadForecast(state.devices.first.id, 'throughput');
                            }
                          },
                          backgroundColor: NetOpsTheme.surfaceElevated,
                          selectedColor: NetOpsTheme.violetAi.withOpacity(0.2),
                          labelStyle: TextStyle(
                            fontSize: 11,
                            color: _selectedMetric == 'throughput' ? NetOpsTheme.violetAi : Colors.grey,
                            fontWeight: _selectedMetric == 'throughput' ? FontWeight.bold : FontWeight.normal,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                const Text(
                  'Нейросетевая модель временных рядов TimesFM-3.0 анализирует тренд загрузки и предупреждает о вероятных инцидентах за 45 минут до срабатывания статических порогов Zabbix/Prometheus.',
                  style: TextStyle(fontSize: 12, color: Colors.grey),
                ),
                const SizedBox(height: 16),

                if (forecast != null) ...[
                  // Breach Warning Pill
                  if (forecast.breachInMinutes != null)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                      margin: const EdgeInsets.only(bottom: 16),
                      decoration: BoxDecoration(
                        color: NetOpsTheme.amberWarning.withOpacity(0.12),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(color: NetOpsTheme.amberWarning.withOpacity(0.4)),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.warning_amber_rounded, color: NetOpsTheme.amberWarning, size: 20),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              'Внимание: Прогнозируется превышение порога ${forecast.threshold.toStringAsFixed(0)}${forecast.unit} через ${forecast.breachInMinutes} минут!',
                              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: NetOpsTheme.amberWarning),
                            ),
                          ),
                        ],
                      ),
                    ),

                  // Forecast Chart Area
                  SizedBox(
                    height: 160,
                    child: CustomPaint(
                      painter: _ForecastChartPainter(forecast: forecast),
                      child: Container(),
                    ),
                  ),
                  const SizedBox(height: 12),

                  // Legend
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      _legendItem('История (Факт)', Colors.grey),
                      const SizedBox(width: 16),
                      _legendItem('Медиана TimesFM', NetOpsTheme.violetAi),
                      const SizedBox(width: 16),
                      _legendItem('90% Доверительный интервал', NetOpsTheme.violetAi.withOpacity(0.3)),
                      const SizedBox(width: 16),
                      _legendItem('Порог (${forecast.threshold.toStringAsFixed(0)})', NetOpsTheme.roseDanger),
                    ],
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _legendItem(String label, Color color) {
    return Row(
      children: [
        Container(width: 12, height: 3, color: color),
        const SizedBox(width: 6),
        Text(label, style: const TextStyle(fontSize: 10, color: Colors.grey)),
      ],
    );
  }

  Widget _metricCard({
    required String title,
    required String subtitle,
    required String value,
    required Color color,
    required List<double> dataPoints,
  }) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(title, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                      const SizedBox(height: 2),
                      Text(subtitle, style: const TextStyle(fontSize: 10, color: Colors.grey), overflow: TextOverflow.ellipsis),
                    ],
                  ),
                ),
                Text(
                  value,
                  style: TextStyle(fontFamily: 'monospace', fontWeight: FontWeight.bold, fontSize: 16, color: color),
                ),
              ],
            ),
            const SizedBox(height: 16),
            SizedBox(
              height: 44,
              child: CustomPaint(
                painter: _SparklinePainter(dataPoints, color),
                child: Container(),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SparklinePainter extends CustomPainter {
  final List<double> points;
  final Color color;

  _SparklinePainter(this.points, this.color);

  @override
  void paint(Canvas canvas, Size size) {
    if (points.isEmpty) return;

    final paint = Paint()
      ..color = color
      ..strokeWidth = 2
      ..style = PaintingStyle.stroke;

    final minVal = points.reduce((a, b) => a < b ? a : b);
    final maxVal = points.reduce((a, b) => a > b ? a : b);
    final range = maxVal - minVal > 0 ? maxVal - minVal : 1.0;

    final path = Path();
    for (int i = 0; i < points.length; i++) {
      final x = (i / (points.length - 1)) * size.width;
      final y = size.height - ((points[i] - minVal) / range) * (size.height - 8) - 4;
      if (i == 0) {
        path.moveTo(x, y);
      } else {
        path.lineTo(x, y);
      }
    }
    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => true;
}

class _ForecastChartPainter extends CustomPainter {
  final Forecast forecast;

  _ForecastChartPainter({required this.forecast});

  @override
  void paint(Canvas canvas, Size size) {
    final allVals = [...forecast.history, ...forecast.upper, forecast.threshold];
    final minVal = allVals.reduce((a, b) => a < b ? a : b);
    final maxVal = allVals.reduce((a, b) => a > b ? a : b);
    final range = maxVal - minVal > 0 ? maxVal - minVal : 1.0;

    final totalPoints = forecast.history.length + forecast.median.length;
    if (totalPoints < 2) return;

    double toX(int idx) => (idx / (totalPoints - 1)) * size.width;
    double toY(double val) => size.height - ((val - minVal) / range) * (size.height - 16) - 8;

    // 1. Draw Confidence Band Area
    if (forecast.lower.isNotEmpty && forecast.upper.isNotEmpty) {
      final bandPaint = Paint()
        ..color = NetOpsTheme.violetAi.withOpacity(0.15)
        ..style = PaintingStyle.fill;

      final bandPath = Path();
      final startIdx = forecast.history.length;
      for (int i = 0; i < forecast.upper.length; i++) {
        final x = toX(startIdx + i);
        final y = toY(forecast.upper[i]);
        if (i == 0) bandPath.moveTo(x, y); else bandPath.lineTo(x, y);
      }
      for (int i = forecast.lower.length - 1; i >= 0; i--) {
        final x = toX(startIdx + i);
        final y = toY(forecast.lower[i]);
        bandPath.lineTo(x, y);
      }
      bandPath.close();
      canvas.drawPath(bandPath, bandPaint);
    }

    // 2. Draw Threshold Line
    final threshPaint = Paint()
      ..color = NetOpsTheme.roseDanger
      ..strokeWidth = 1
      ..style = PaintingStyle.stroke;
    final threshY = toY(forecast.threshold);
    canvas.drawLine(Offset(0, threshY), Offset(size.width, threshY), threshPaint);

    // 3. Draw History Line
    final histPaint = Paint()
      ..color = Colors.grey
      ..strokeWidth = 2
      ..style = PaintingStyle.stroke;
    final histPath = Path();
    for (int i = 0; i < forecast.history.length; i++) {
      final x = toX(i);
      final y = toY(forecast.history[i]);
      if (i == 0) histPath.moveTo(x, y); else histPath.lineTo(x, y);
    }
    canvas.drawPath(histPath, histPaint);

    // 4. Draw Median Forecast Line (dashed style)
    final medPaint = Paint()
      ..color = NetOpsTheme.violetAi
      ..strokeWidth = 2.5
      ..style = PaintingStyle.stroke;
    final medPath = Path();
    final hLen = forecast.history.length;
    if (hLen > 0 && forecast.median.isNotEmpty) {
      medPath.moveTo(toX(hLen - 1), toY(forecast.history.last));
      for (int i = 0; i < forecast.median.length; i++) {
        medPath.lineTo(toX(hLen + i), toY(forecast.median[i]));
      }
      canvas.drawPath(medPath, medPaint);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => true;
}
