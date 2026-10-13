class JobTarget {
  final int? deviceId;
  final String hostname;
  final String status;
  final String? error;
  final bool hasChanges;

  JobTarget({
    this.deviceId,
    required this.hostname,
    required this.status,
    this.error,
    this.hasChanges = false,
  });

  factory JobTarget.fromJson(Map<String, dynamic> json) {
    return JobTarget(
      deviceId: json['device_id'] as int?,
      hostname: json['hostname'] as String? ?? '',
      status: json['status'] as String? ?? 'PENDING',
      error: json['error'] as String?,
      hasChanges: json['has_changes'] as bool? ?? false,
    );
  }
}

class JobLog {
  final int id;
  final String createdAt;
  final String level;
  final String step;
  final String? hostname;
  final String message;

  JobLog({
    required this.id,
    required this.createdAt,
    required this.level,
    required this.step,
    this.hostname,
    required this.message,
  });

  factory JobLog.fromJson(Map<String, dynamic> json) {
    return JobLog(
      id: (json['id'] as num?)?.toInt() ?? 0,
      createdAt: json['created_at'] as String? ?? '',
      level: json['level'] as String? ?? 'INFO',
      step: json['step'] as String? ?? '',
      hostname: json['hostname'] as String?,
      message: json['message'] as String? ?? '',
    );
  }
}

class DeviceDiff {
  final int? deviceId;
  final String hostname;
  final String status;
  final String? error;
  final String? runningConfig;
  final String? intendedConfig;
  final String? remediationPatch;
  final String? rollbackPatch;

  DeviceDiff({
    this.deviceId,
    required this.hostname,
    required this.status,
    this.error,
    this.runningConfig,
    this.intendedConfig,
    this.remediationPatch,
    this.rollbackPatch,
  });

  factory DeviceDiff.fromJson(Map<String, dynamic> json) {
    return DeviceDiff(
      deviceId: json['device_id'] as int?,
      hostname: json['hostname'] as String? ?? '',
      status: json['status'] as String? ?? 'PENDING',
      error: json['error'] as String?,
      runningConfig: json['running_config'] as String?,
      intendedConfig: json['intended_config'] as String?,
      remediationPatch: json['remediation_patch'] as String?,
      rollbackPatch: json['rollback_patch'] as String?,
    );
  }
}

class JobDiff {
  final String jobId;
  final String jobType;
  final List<DeviceDiff> devices;

  JobDiff({
    required this.jobId,
    required this.jobType,
    required this.devices,
  });

  factory JobDiff.fromJson(Map<String, dynamic> json) {
    return JobDiff(
      jobId: json['job_id'] as String? ?? '',
      jobType: json['job_type'] as String? ?? '',
      devices: (json['devices'] as List<dynamic>?)
              ?.map((e) => DeviceDiff.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
    );
  }
}

class Job {
  final String id;
  final String type;
  final String status;
  final int progress;
  final String? intentSource;
  final String? parentJobId;
  final String createdBy;
  final String? confirmedBy;
  final String? error;
  final String createdAt;
  final String? startedAt;
  final String? finishedAt;
  final List<JobTarget> targets;
  final List<JobLog> logs;

  Job({
    required this.id,
    required this.type,
    required this.status,
    required this.progress,
    this.intentSource,
    this.parentJobId,
    this.createdBy = 'operator',
    this.confirmedBy,
    this.error,
    required this.createdAt,
    this.startedAt,
    this.finishedAt,
    this.targets = const [],
    this.logs = const [],
  });

  factory Job.fromJson(Map<String, dynamic> json) {
    return Job(
      id: json['id'] as String? ?? '',
      type: json['type'] as String? ?? 'DRY_RUN',
      status: json['status'] as String? ?? 'PENDING',
      progress: (json['progress'] as num?)?.toInt() ?? 0,
      intentSource: json['intent_source'] as String?,
      parentJobId: json['parent_job_id'] as String?,
      createdBy: json['created_by'] as String? ?? 'operator',
      confirmedBy: json['confirmed_by'] as String?,
      error: json['error'] as String?,
      createdAt: json['created_at'] as String? ?? '',
      startedAt: json['started_at'] as String?,
      finishedAt: json['finished_at'] as String?,
      targets: (json['targets'] as List<dynamic>?)
              ?.map((e) => JobTarget.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
      logs: (json['logs'] as List<dynamic>?)
              ?.map((e) => JobLog.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
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
      timestamp: json['timestamp'] as String? ?? '',
      throughputMbps: (json['throughput_mbps'] as num?)?.toDouble() ?? 0.0,
      latencyMs: (json['latency_ms'] as num?)?.toDouble() ?? 0.0,
      packetLossPct: (json['packet_loss_pct'] as num?)?.toDouble() ?? 0.0,
      cpuPct: (json['cpu_pct'] as num?)?.toDouble() ?? 0.0,
      ramPct: (json['ram_pct'] as num?)?.toDouble() ?? 0.0,
    );
  }
}
