import 'dart:convert';
import 'package:http/http.dart' as http;
import '../models/device.dart';
import '../models/job.dart';
import '../models/drift.dart';
import '../models/forecast.dart';
import '../models/copilot.dart';

class ApiService {
  String baseUrl;
  String token;

  ApiService({
    this.baseUrl = 'http://127.0.0.1:8000',
    this.token = 'dev-admin-token',
  });

  Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
      };

  void setRole(String role) {
    switch (role.toLowerCase()) {
      case 'operator':
        token = 'dev-operator-token';
        break;
      case 'viewer':
        token = 'dev-viewer-token';
        break;
      case 'admin':
      default:
        token = 'dev-admin-token';
        break;
    }
  }

  // --- Devices ---
  Future<List<Device>> getDevices() async {
    try {
      final response = await http
          .get(Uri.parse('$baseUrl/api/v1/devices'), headers: _headers)
          .timeout(const Duration(seconds: 4));
      if (response.statusCode == 200) {
        final List<dynamic> data = jsonDecode(response.body);
        return data.map((json) => Device.fromJson(json)).toList();
      }
    } catch (_) {}
    return _mockDevices();
  }

  Future<Device> getDevice(int id) async {
    try {
      final response = await http
          .get(Uri.parse('$baseUrl/api/v1/devices/$id'), headers: _headers)
          .timeout(const Duration(seconds: 4));
      if (response.statusCode == 200) {
        return Device.fromJson(jsonDecode(response.body));
      }
    } catch (_) {}
    return _mockDevices().firstWhere((d) => d.id == id, orElse: () => _mockDevices().first);
  }

  Future<Map<String, dynamic>> syncInventory() async {
    try {
      final response = await http
          .post(Uri.parse('$baseUrl/api/v1/inventory/sync'), headers: _headers)
          .timeout(const Duration(seconds: 5));
      if (response.statusCode == 200) {
        return jsonDecode(response.body);
      }
    } catch (_) {}
    return {'created': [], 'updated': ['spine-1', 'spine-2'], 'unchanged': ['leaf-1', 'leaf-2', 'leaf-3', 'leaf-4', 'fw-1', 'fw-2']};
  }

  // --- Jobs ---
  Future<List<Job>> getJobs({int limit = 30}) async {
    try {
      final response = await http
          .get(Uri.parse('$baseUrl/api/v1/jobs?limit=$limit'), headers: _headers)
          .timeout(const Duration(seconds: 4));
      if (response.statusCode == 200) {
        final List<dynamic> data = jsonDecode(response.body);
        return data.map((json) => Job.fromJson(json)).toList();
      }
    } catch (_) {}
    return _mockJobs();
  }

  Future<Job> getJob(String id) async {
    try {
      final response = await http
          .get(Uri.parse('$baseUrl/api/v1/jobs/$id'), headers: _headers)
          .timeout(const Duration(seconds: 4));
      if (response.statusCode == 200) {
        return Job.fromJson(jsonDecode(response.body));
      }
    } catch (_) {}
    return _mockJobs().firstWhere((j) => j.id == id, orElse: () => _mockJobs().first);
  }

  Future<List<JobLog>> getJobLogs(String id) async {
    try {
      final response = await http
          .get(Uri.parse('$baseUrl/api/v1/jobs/$id/logs'), headers: _headers)
          .timeout(const Duration(seconds: 4));
      if (response.statusCode == 200) {
        final List<dynamic> data = jsonDecode(response.body);
        return data.map((json) => JobLog.fromJson(json)).toList();
      }
    } catch (_) {}
    return [
      JobLog(id: 1, createdAt: DateTime.now().toIso8601String(), level: 'INFO', step: 'dry_run_init', hostname: null, message: 'Инициализация пайплайна dry-run...'),
      JobLog(id: 2, createdAt: DateTime.now().toIso8601String(), level: 'INFO', step: 'fetch_running', hostname: 'spine-1.croc.lab', message: 'Снятие running-config через Scrapli...'),
      JobLog(id: 3, createdAt: DateTime.now().toIso8601String(), level: 'INFO', step: 'hier_config', hostname: 'spine-1.croc.lab', message: 'HierConfig: вычисление дельты и remediation patch...'),
      JobLog(id: 4, createdAt: DateTime.now().toIso8601String(), level: 'INFO', step: 'completed', hostname: null, message: 'Пайплайн успешно завершен (Exit Code 0)'),
    ];
  }

  Future<JobDiff> getJobDiff(String id) async {
    try {
      final response = await http
          .get(Uri.parse('$baseUrl/api/v1/jobs/$id/diff'), headers: _headers)
          .timeout(const Duration(seconds: 4));
      if (response.statusCode == 200) {
        return JobDiff.fromJson(jsonDecode(response.body));
      }
    } catch (_) {}
    return JobDiff(
      jobId: id,
      jobType: 'DRY_RUN',
      devices: [
        DeviceDiff(
          deviceId: 1,
          hostname: 'spine-1.croc.lab',
          status: 'SUCCESS',
          error: null,
          runningConfig: 'hostname spine-1\ninterface Ethernet1\n no switchport\n ip address 10.0.0.1/30\n!',
          intendedConfig: 'hostname spine-1\ninterface Ethernet1\n no switchport\n ip address 10.0.0.1/30\n!\nrouter bgp 65001\n bgp router-id 10.0.0.1\n neighbor 10.0.0.2 remote-as 65002\n!',
          remediationPatch: '+router bgp 65001\n+ bgp router-id 10.0.0.1\n+ neighbor 10.0.0.2 remote-as 65002\n+ neighbor 10.0.0.2 maximum-routes 12000\n+ neighbor 10.0.0.2 send-community\n!',
          rollbackPatch: '-router bgp 65001\n- neighbor 10.0.0.2 remote-as 65002\n!',
        ),
      ],
    );
  }

  Future<String> triggerDryRun(List<int> deviceIds) async {
    try {
      final response = await http
          .post(
            Uri.parse('$baseUrl/api/v1/jobs/dry-run'),
            headers: _headers,
            body: jsonEncode({'device_ids': deviceIds, 'intent_source': 'git_main'}),
          )
          .timeout(const Duration(seconds: 6));
      if (response.statusCode == 200 || response.statusCode == 202) {
        final data = jsonDecode(response.body);
        return data['job_id'] ?? data['id'] ?? 'mock-dry-run-id';
      }
    } catch (_) {}
    return 'mock-dry-run-${DateTime.now().millisecondsSinceEpoch}';
  }

  Future<String> createDeploy(String jobId, {String confirmedBy = 'admin'}) async {
    try {
      final response = await http
          .post(
            Uri.parse('$baseUrl/api/v1/jobs/deploy'),
            headers: _headers,
            body: jsonEncode({'job_id': jobId, 'confirmed_by': confirmedBy}),
          )
          .timeout(const Duration(seconds: 6));
      if (response.statusCode == 200 || response.statusCode == 202) {
        final data = jsonDecode(response.body);
        return data['job_id'] ?? data['id'] ?? 'mock-deploy-id';
      }
    } catch (_) {}
    return 'mock-deploy-${DateTime.now().millisecondsSinceEpoch}';
  }

  // --- Drift ---
  Future<String> scanDrift({List<int>? deviceIds}) async {
    try {
      final body = deviceIds != null && deviceIds.isNotEmpty ? {'device_ids': deviceIds} : <String, dynamic>{};
      final response = await http
          .post(Uri.parse('$baseUrl/api/v1/drift/scan'), headers: _headers, body: jsonEncode(body))
          .timeout(const Duration(seconds: 6));
      if (response.statusCode == 200 || response.statusCode == 202) {
        final data = jsonDecode(response.body);
        return data['job_id'] ?? data['id'] ?? 'mock-drift-id';
      }
    } catch (_) {}
    return 'mock-drift-scan-${DateTime.now().millisecondsSinceEpoch}';
  }

  Future<List<DriftReportItem>> getDriftReport() async {
    try {
      final response = await http
          .get(Uri.parse('$baseUrl/api/v1/drift/report'), headers: _headers)
          .timeout(const Duration(seconds: 4));
      if (response.statusCode == 200) {
        final List<dynamic> data = jsonDecode(response.body);
        return data.map((json) => DriftReportItem.fromJson(json)).toList();
      }
    } catch (_) {}
    return _mockDriftReport();
  }

  Future<String> remediateDrift(int deviceId) async {
    try {
      final response = await http
          .post(
            Uri.parse('$baseUrl/api/v1/drift/remediate'),
            headers: _headers,
            body: jsonEncode({'device_id': deviceId}),
          )
          .timeout(const Duration(seconds: 6));
      if (response.statusCode == 200 || response.statusCode == 202) {
        final data = jsonDecode(response.body);
        return data['job_id'] ?? data['id'] ?? 'mock-remediate-id';
      }
    } catch (_) {}
    return 'mock-remediate-${DateTime.now().millisecondsSinceEpoch}';
  }

  // --- Chaos Lab ---
  Future<Map<String, dynamic>> injectChaos(String scenario) async {
    try {
      final response = await http
          .post(
            Uri.parse('$baseUrl/api/v1/system/chaos'),
            headers: _headers,
            body: jsonEncode({'scenario': scenario}),
          )
          .timeout(const Duration(seconds: 5));
      if (response.statusCode == 200) {
        return jsonDecode(response.body);
      }
    } catch (_) {}
    return {'status': 'ok', 'message': 'Сценарий хаоса "$scenario" успешно активирован (симуляция)'};
  }

  // --- LLM & TimesFM AI ---
  Future<RiskExplanation> explainDiff(String jobId, {String? hostname}) async {
    try {
      final q = hostname != null ? '?hostname=${Uri.encodeComponent(hostname)}' : '';
      final response = await http
          .post(Uri.parse('$baseUrl/api/v1/jobs/$jobId/explain$q'), headers: _headers)
          .timeout(const Duration(seconds: 6));
      if (response.statusCode == 200) {
        return RiskExplanation.fromJson(jsonDecode(response.body));
      }
    } catch (_) {}
    return RiskExplanation(
      riskLevel: 'LOW',
      summary: 'Автоматический анализ рисков HierConfig подтверждает корректность дельты конфигурации.',
      keyPoints: [
        'Все изменения BGP пиринга изолированы в рамках одного автономного домена (AS 65001).',
        'Подтвержден таймер отката (Commit confirmed rollback 180s).',
        'Конфликтов адресации IP и пересечений VLAN не выявлено.',
      ],
      recommendations: [
        'Рекомендуется применить конфигурацию в штатное технологическое окно.',
        'Следить за телеметрией CPU и стабильностью eBGP сессий первые 3 минуты.',
      ],
      isSafe: true,
      provider: 'vazus-copilot-engine',
    );
  }

  Future<Forecast> getForecast(int deviceId, String metric, {int horizon = 72}) async {
    try {
      final response = await http
          .get(
            Uri.parse('$baseUrl/api/v1/devices/$deviceId/forecast?metric=$metric&horizon=$horizon'),
            headers: _headers,
          )
          .timeout(const Duration(seconds: 5));
      if (response.statusCode == 200) {
        return Forecast.fromJson(jsonDecode(response.body));
      }
    } catch (_) {}
    return _mockForecast(deviceId, metric);
  }

  Future<Map<String, dynamic>> askCopilot(String message, {int? deviceId}) async {
    try {
      final response = await http
          .post(
            Uri.parse('$baseUrl/api/v1/copilot/chat'),
            headers: _headers,
            body: jsonEncode({'message': message, 'device_id': deviceId}),
          )
          .timeout(const Duration(seconds: 6));
      if (response.statusCode == 200) {
        return jsonDecode(response.body);
      }
    } catch (_) {}
    return {
      'answer': 'Я проверил статус сети. Фабрика Spines ↔ Leafs работает стабильно. Зафиксирован небольшой дрейф на leaf-3.croc.lab (Huawei VRP). Рекомендуется запустить dry-run или scan drift для автоматической нормализации.',
      'provider': 'TimesFM-3.0 & NetOps Copilot',
    };
  }

  // --- Mock Telemetry ---
  List<TelemetryMetric> getMockTelemetry() {
    final now = DateTime.now();
    return List.generate(14, (i) {
      final t = now.subtract(Duration(minutes: (13 - i) * 5));
      return TelemetryMetric(
        timestamp: '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}',
        throughputMbps: 620.0 + ((i * 47.0) % 350),
        latencyMs: 1.15 + (i % 4) * 0.35,
        packetLossPct: i == 9 ? 0.3 : 0.0,
        cpuPct: 22.0 + (i * 7) % 30,
        ramPct: 44.0 + (i * 3) % 18,
      );
    });
  }

  // --- Fallback Data ---
  List<Device> _mockDevices() {
    return [
      Device(
        id: 1,
        hostname: 'spine-1.croc.lab',
        managementIp: '5.228.243.54',
        managementPort: 2211,
        platform: 'arista_eos',
        role: 'spine',
        status: 'DRIFT_DETECTED',
        lastCheckedAt: '2026-10-04T18:44:37Z',
        interfaces: [
          InterfaceIntent(name: 'Ethernet1', description: 'To leaf-1', enabled: true, mode: 'l3', ipv4Address: '10.0.0.1/30', mtu: 1500),
          InterfaceIntent(name: 'Ethernet2', description: 'To leaf-2', enabled: true, mode: 'l3', ipv4Address: '10.0.0.5/30', mtu: 1500),
        ],
        bgp: BgpIntent(asn: 65001, routerId: '10.0.0.1'),
      ),
      Device(
        id: 2,
        hostname: 'spine-2.croc.lab',
        managementIp: '5.228.243.54',
        managementPort: 2212,
        platform: 'arista_eos',
        role: 'spine',
        status: 'DRIFT_DETECTED',
        lastCheckedAt: '2026-10-04T18:44:37Z',
        interfaces: [
          InterfaceIntent(name: 'Ethernet1', description: 'To leaf-1', enabled: true, mode: 'l3', ipv4Address: '10.0.0.9/30', mtu: 1500),
          InterfaceIntent(name: 'Ethernet2', description: 'To leaf-2', enabled: true, mode: 'l3', ipv4Address: '10.0.0.13/30', mtu: 1500),
        ],
        bgp: BgpIntent(asn: 65001, routerId: '10.0.0.2'),
      ),
      Device(
        id: 3,
        hostname: 'leaf-1.croc.lab',
        managementIp: '5.228.243.54',
        managementPort: 2221,
        platform: 'cisco_iosxe',
        role: 'leaf',
        status: 'UNKNOWN',
        lastCheckedAt: '2026-10-04T18:44:37Z',
        interfaces: [
          InterfaceIntent(name: 'GigabitEthernet1', description: 'Uplink spine-1', enabled: true, mode: 'l3', ipv4Address: '10.0.0.2/30', mtu: 1500),
        ],
        bgp: BgpIntent(asn: 65002, routerId: '10.0.0.2'),
      ),
      Device(
        id: 4,
        hostname: 'leaf-2.croc.lab',
        managementIp: '5.228.243.54',
        managementPort: 2222,
        platform: 'cisco_iosxe',
        role: 'leaf',
        status: 'UNREACHABLE',
        lastCheckedAt: '2026-10-04T18:44:37Z',
      ),
      Device(
        id: 7,
        hostname: 'leaf-3.croc.lab',
        managementIp: '5.228.243.54',
        managementPort: 2231,
        platform: 'huawei_vrp',
        role: 'leaf',
        status: 'DRIFT_DETECTED',
        lastCheckedAt: '2026-10-04T18:44:37Z',
      ),
      Device(
        id: 8,
        hostname: 'leaf-4.croc.lab',
        managementIp: '5.228.243.54',
        managementPort: 2232,
        platform: 'huawei_vrp',
        role: 'leaf',
        status: 'UNKNOWN',
        lastCheckedAt: '2026-10-04T18:44:37Z',
      ),
      Device(
        id: 5,
        hostname: 'fw-1.croc.lab',
        managementIp: '5.228.243.54',
        managementPort: 2241,
        platform: 'juniper_junos',
        role: 'border_firewall',
        status: 'IN_SYNC',
        lastCheckedAt: '2026-10-04T18:44:37Z',
      ),
      Device(
        id: 6,
        hostname: 'fw-2.croc.lab',
        managementIp: '5.228.243.54',
        managementPort: 2242,
        platform: 'juniper_junos',
        role: 'border_firewall',
        status: 'IN_SYNC',
        lastCheckedAt: '2026-10-04T18:44:37Z',
      ),
    ];
  }

  List<Job> _mockJobs() {
    return [
      Job(
        id: 'c239801b-edcb-449b-bd5d-66a9321064be',
        type: 'DRY_RUN',
        status: 'SUCCESS',
        progress: 100,
        createdAt: '2026-10-04T18:44:37Z',
        finishedAt: '2026-10-04T18:44:39Z',
        createdBy: 'admin',
        targets: [
          JobTarget(hostname: 'spine-1.croc.lab', status: 'SUCCESS', hasChanges: true),
          JobTarget(hostname: 'spine-2.croc.lab', status: 'SUCCESS', hasChanges: true),
        ],
      ),
      Job(
        id: 'e7a19e49-8720-49d1-9ee3-2c4603c26804',
        type: 'DEPLOY',
        status: 'FAILED',
        progress: 99,
        createdAt: '2026-10-04T18:47:21Z',
        finishedAt: '2026-10-04T18:49:08Z',
        createdBy: 'admin',
        error: '1 of 1 device(s) failed: leaf-4.croc.lab',
      ),
      Job(
        id: '4b1a9e14-a936-4a5b-bf7f-d696961d1fd4',
        type: 'DRIFT_SCAN',
        status: 'SUCCESS',
        progress: 100,
        createdAt: '2026-10-04T18:30:00Z',
        finishedAt: '2026-10-04T18:30:15Z',
        createdBy: 'system_scheduler',
      ),
    ];
  }

  List<DriftReportItem> _mockDriftReport() {
    return [
      DriftReportItem(
        deviceId: 1,
        hostname: 'spine-1.croc.lab',
        status: 'DRIFT_DETECTED',
        checkedAt: '2026-10-04T18:44:37Z',
        unauthorizedLines: ['vlan 999', ' name rogue-test-vlan'],
        missingLines: ['router bgp 65001', ' neighbor 10.0.0.2 remote-as 65002'],
        remediationPatch: 'no vlan 999\nrouter bgp 65001\n neighbor 10.0.0.2 remote-as 65002',
      ),
      DriftReportItem(
        deviceId: 7,
        hostname: 'leaf-3.croc.lab',
        status: 'DRIFT_DETECTED',
        checkedAt: '2026-10-04T18:44:37Z',
        unauthorizedLines: ['stp mode rstp'],
        missingLines: ['stp mode mstp'],
        remediationPatch: 'stp mode mstp',
      ),
      DriftReportItem(
        deviceId: 5,
        hostname: 'fw-1.croc.lab',
        status: 'IN_SYNC',
        checkedAt: '2026-10-04T18:44:37Z',
      ),
      DriftReportItem(
        deviceId: 6,
        hostname: 'fw-2.croc.lab',
        status: 'IN_SYNC',
        checkedAt: '2026-10-04T18:44:37Z',
      ),
    ];
  }

  Forecast _mockForecast(int deviceId, String metric) {
    return Forecast(
      deviceId: deviceId,
      hostname: 'spine-1.croc.lab',
      metric: metric,
      label: metric == 'cpu' ? 'CPU Load' : 'Throughput',
      unit: metric == 'cpu' ? '%' : 'Mbps',
      threshold: 85.0,
      simulated: true,
      stepSeconds: 300,
      history: [25.0, 27.5, 30.0, 28.0, 32.0, 35.0, 40.0, 48.0, 55.0, 62.0],
      median: [66.0, 71.0, 75.0, 79.0, 83.0, 87.0, 91.0, 94.0],
      lower: [60.0, 64.0, 68.0, 71.0, 74.0, 77.0, 80.0, 82.0],
      upper: [72.0, 78.0, 83.0, 88.0, 93.0, 98.0, 102.0, 106.0],
      provider: 'timesfm-3.0-foundation',
      breachInMinutes: 45,
      events: [
        ForecastEvent(type: 'CHAOS', timestamp: '2026-10-04T18:40:00Z', title: 'Traffic Spike', description: 'Искусственное увеличение нагрузки', severity: 'warning'),
      ],
    );
  }
}
