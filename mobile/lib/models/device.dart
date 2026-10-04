class Device {
  final int id;
  final String hostname;
  final String managementIp;
  final int managementPort;
  final String platform;
  final String role;
  final String status;
  final String? lastCheckedAt;

  Device({
    required this.id,
    required this.hostname,
    required this.managementIp,
    required this.managementPort,
    required this.platform,
    required this.role,
    required this.status,
    this.lastCheckedAt,
  });

  factory Device.fromJson(Map<String, dynamic> json) {
    return Device(
      id: json['id'] as int,
      hostname: json['hostname'] as String,
      managementIp: json['management_ip'] as String,
      managementPort: (json['management_port'] as num?)?.toInt() ?? 22,
      platform: json['platform'] as String,
      role: json['role'] as String,
      status: json['status'] as String,
      lastCheckedAt: json['last_checked_at'] as String?,
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'hostname': hostname,
    'management_ip': managementIp,
    'management_port': managementPort,
    'platform': platform,
    'role': role,
    'status': status,
    'last_checked_at': lastCheckedAt,
  };
}
