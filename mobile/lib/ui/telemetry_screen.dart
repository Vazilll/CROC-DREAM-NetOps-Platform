import 'package:flutter/material.dart';
import 'theme.dart';
import '../models/job.dart';

class TelemetryScreen extends StatelessWidget {
  final List<TelemetryMetric> metrics;

  const TelemetryScreen({
    Key? key,
    required this.metrics,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _metricCard(
            title: 'Сквозная пропускная способность (Throughput)',
            subtitle: 'Агрегированный трафик фабрики Spines / Leafs',
            value: '${metrics.isNotEmpty ? metrics.last.throughputMbps.toStringAsFixed(0) : 520} Mbps',
            unit: 'Мбит/с',
            color: NetOpsTheme.cyanAction,
            dataPoints: metrics.map((m) => m.throughputMbps).toList(),
          ),
          const SizedBox(height: 14),
          _metricCard(
            title: 'Задержка Fabric RTT (Latency)',
            subtitle: 'Время отклика eBGP пиринга Spine ↔ Leaf',
            value: '${metrics.isNotEmpty ? metrics.last.latencyMs.toStringAsFixed(2) : 1.45} ms',
            unit: 'мс',
            color: NetOpsTheme.emeraldSuccess,
            dataPoints: metrics.map((m) => m.latencyMs * 100).toList(),
          ),
          const SizedBox(height: 14),
          _metricCard(
            title: 'Утилизация процессора (CPU Load)',
            subtitle: 'Нагрузка управляющей плоскости (Control Plane)',
            value: '${metrics.isNotEmpty ? metrics.last.cpuPct.toStringAsFixed(1) : 24.5} %',
            unit: '%',
            color: NetOpsTheme.amberWarning,
            dataPoints: metrics.map((m) => m.cpuPct).toList(),
          ),
        ],
      ),
    );
  }

  Widget _metricCard({
    required String title,
    required String subtitle,
    required String value,
    required String unit,
    required Color color,
    required List<double> dataPoints,
  }) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                    const SizedBox(height: 2),
                    Text(subtitle, style: const TextStyle(fontSize: 11, color: Colors.grey)),
                  ],
                ),
                Text(
                  value,
                  style: TextStyle(fontFamily: 'monospace', fontWeight: FontWeight.bold, fontSize: 18, color: color),
                ),
              ],
            ),
            const SizedBox(height: 20),
            // Minimal custom line sparkline
            SizedBox(
              height: 48,
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
