class DriftReportItem {
  final int deviceId;
  final String hostname;
  final String status;
  final String checkedAt;
  final String? jobId;
  final List<String> unauthorizedLines;
  final List<String> missingLines;
  final String? remediationPatch;
  final String? error;

  DriftReportItem({
    required this.deviceId,
    required this.hostname,
    required this.status,
    required this.checkedAt,
    this.jobId,
    this.unauthorizedLines = const [],
    this.missingLines = const [],
    this.remediationPatch,
    this.error,
  });

  factory DriftReportItem.fromJson(Map<String, dynamic> json) {
    return DriftReportItem(
      deviceId: (json['device_id'] as num?)?.toInt() ?? 0,
      hostname: json['hostname'] as String? ?? 'unknown',
      status: json['status'] as String? ?? 'IN_SYNC',
      checkedAt: json['checked_at'] as String? ?? '',
      jobId: json['job_id'] as String?,
      unauthorizedLines: (json['unauthorized_lines'] as List<dynamic>?)?.map((e) => e.toString()).toList() ?? [],
      missingLines: (json['missing_lines'] as List<dynamic>?)?.map((e) => e.toString()).toList() ?? [],
      remediationPatch: json['remediation_patch'] as String?,
      error: json['error'] as String?,
    );
  }
}
