class Job {
  final String id;
  final String type;
  final String status;
  final int progress;
  final String createdAt;
  final String? finishedAt;
  final List<String> logs;

  Job({
    required this.id,
    required this.type,
    required this.status,
    required this.progress,
    required this.createdAt,
    this.finishedAt,
    this.logs = const [],
  });

  factory Job.fromJson(Map<String, dynamic> json) {
    return Job(
      id: json['id'] as String,
      type: json['type'] as String,
      status: json['status'] as String,
      progress: (json['progress'] as num?)?.toInt() ?? 0,
      createdAt: json['created_at'] as String,
      finishedAt: json['finished_at'] as String?,
      logs: (json['logs'] as List<dynamic>?)?.map((e) => e.toString()).toList() ?? [],
    );
  }
}

class TelemetryMetric {
  final String timestamp;
  final double throughputMbps;
  final double latencyMs;
  final double packetLossPct;
  final double cpuPct;
  final double ramPct;

  TelemetryMetric({
    required this.timestamp,
    required this.throughputMbps,
    required this.latencyMs,
    required this.packetLossPct,
    required this.cpuPct,
    required this.ramPct,
  });

  factory TelemetryMetric.fromJson(Map<String, dynamic> json) {
    return TelemetryMetric(
      timestamp: json['timestamp'] as String,
      throughputMbps: (json['throughput_mbps'] as num).toDouble(),
      latencyMs: (json['latency_ms'] as num).toDouble(),
      packetLossPct: (json['packet_loss_pct'] as num).toDouble(),
      cpuPct: (json['cpu_pct'] as num).toDouble(),
      ramPct: (json['ram_pct'] as num).toDouble(),
    );
  }
}
