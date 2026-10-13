class InterfaceIntent {
  final String name;
  final String? description;
  final bool enabled;
  final String mode; // l2 or l3
  final String? ipv4Address;
  final int mtu;

  InterfaceIntent({
    required this.name,
    this.description,
    required this.enabled,
    required this.mode,
    this.ipv4Address,
    required this.mtu,
  });

  factory InterfaceIntent.fromJson(Map<String, dynamic> json) {
    return InterfaceIntent(
      name: json['name'] as String? ?? 'eth0',
      description: json['description'] as String?,
      enabled: json['enabled'] as bool? ?? true,
      mode: json['mode'] as String? ?? 'l3',
      ipv4Address: json['ipv4_address'] as String?,
      mtu: (json['mtu'] as num?)?.toInt() ?? 1500,
    );
  }
}

class BgpNeighborIntent {
  final String peerIp;
  final int remoteAsn;
  final String? description;
  final List<String> announcedPrefixes;

  BgpNeighborIntent({
    required this.peerIp,
    required this.remoteAsn,
    this.description,
    this.announcedPrefixes = const [],
  });

  factory BgpNeighborIntent.fromJson(Map<String, dynamic> json) {
    return BgpNeighborIntent(
      peerIp: json['peer_ip'] as String? ?? '',
      remoteAsn: (json['remote_asn'] as num?)?.toInt() ?? 65000,
      description: json['description'] as String?,
      announcedPrefixes: (json['announced_prefixes'] as List<dynamic>?)?.map((e) => e.toString()).toList() ?? [],
    );
  }
}

class BgpIntent {
  final int asn;
  final String routerId;
  final List<BgpNeighborIntent> neighbors;

  BgpIntent({
    required this.asn,
    required this.routerId,
    this.neighbors = const [],
  });

  factory BgpIntent.fromJson(Map<String, dynamic> json) {
    return BgpIntent(
      asn: (json['asn'] as num?)?.toInt() ?? 65000,
      routerId: json['router_id'] as String? ?? '',
      neighbors: (json['neighbors'] as List<dynamic>?)?.map((e) => BgpNeighborIntent.fromJson(e)).toList() ?? [],
    );
  }
}

class Device {
  final int id;
  final String hostname;
  final String managementIp;
  final int managementPort;
  final String platform;
  final String role;
  final String status;
  final String? lastCheckedAt;
  final List<InterfaceIntent> interfaces;
  final BgpIntent? bgp;

  Device({
    required this.id,
    required this.hostname,
    required this.managementIp,
    required this.managementPort,
    required this.platform,
    required this.role,
    required this.status,
    this.lastCheckedAt,
    this.interfaces = const [],
    this.bgp,
  });

  factory Device.fromJson(Map<String, dynamic> json) {
    List<InterfaceIntent> ifaces = [];
    BgpIntent? bgpIntent;
    final intent = json['intent'];
    if (intent is Map<String, dynamic>) {
      if (intent['interfaces'] is List) {
        ifaces = (intent['interfaces'] as List).map((i) => InterfaceIntent.fromJson(i)).toList();
      }
      if (intent['bgp'] is Map<String, dynamic>) {
        bgpIntent = BgpIntent.fromJson(intent['bgp']);
      }
    }

    return Device(
      id: json['id'] as int? ?? 0,
      hostname: json['hostname'] as String? ?? 'unknown',
      managementIp: json['management_ip'] as String? ?? '0.0.0.0',
      managementPort: (json['management_port'] as num?)?.toInt() ?? 22,
      platform: json['platform'] as String? ?? 'arista_eos',
      role: json['role'] as String? ?? 'leaf',
      status: json['status'] as String? ?? 'UNKNOWN',
      lastCheckedAt: json['last_checked_at'] as String?,
      interfaces: ifaces,
      bgp: bgpIntent,
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
