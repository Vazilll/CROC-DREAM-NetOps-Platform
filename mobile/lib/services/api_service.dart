import 'dart:convert';
import 'package:http/http.dart' as http;
import '../models/device.dart';
import '../models/job.dart';

class ApiService {
  String baseUrl;
  String token;

  ApiService({
    this.baseUrl = 'http://5.228.243.54:8000',
    this.token = 'dev-token-admin',
  });

  Map<String, String> get _headers => {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer $token',
  };

  Future<List<Device>> getDevices() async {
    final response = await http.get(
      Uri.parse('$baseUrl/api/v1/devices'),
      headers: _headers,
    );
    if (response.statusCode == 200) {
      final List<dynamic> data = jsonDecode(response.body);
      return data.map((json) => Device.fromJson(json)).toList();
    } else {
      throw Exception('Failed to load devices: ${response.statusCode}');
    }
  }

  Future<List<Job>> getJobs() async {
    final response = await http.get(
      Uri.parse('$baseUrl/api/v1/jobs'),
      headers: _headers,
    );
    if (response.statusCode == 200) {
      final List<dynamic> data = jsonDecode(response.body);
      return data.map((json) => Job.fromJson(json)).toList();
    } else {
      throw Exception('Failed to load jobs: ${response.statusCode}');
    }
  }

  Future<String> triggerDryRun(List<int> deviceIds) async {
    final response = await http.post(
      Uri.parse('$baseUrl/api/v1/jobs/dry-run'),
      headers: _headers,
      body: jsonEncode({'device_ids': deviceIds, 'intent_source': 'git_main'}),
    );
    if (response.statusCode == 200 || response.statusCode == 202) {
      final data = jsonDecode(response.body);
      return data['job_id'] ?? data['id'] ?? '';
    } else {
      throw Exception('Failed to trigger dry-run: ${response.statusCode}');
    }
  }

  Future<String> scanDrift({List<int>? deviceIds}) async {
    final body = deviceIds != null && deviceIds.isNotEmpty ? {'device_ids': deviceIds} : <String, dynamic>{};
    final response = await http.post(
      Uri.parse('$baseUrl/api/v1/drift/scan'),
      headers: _headers,
      body: jsonEncode(body),
    );
    if (response.statusCode == 200 || response.statusCode == 202) {
      final data = jsonDecode(response.body);
      return data['job_id'] ?? data['id'] ?? '';
    } else {
      throw Exception('Failed to scan drift: ${response.statusCode}');
    }
  }

  List<TelemetryMetric> getMockTelemetry() {
    final now = DateTime.now();
    return List.generate(12, (i) {
      final t = now.subtract(Duration(minutes: (11 - i) * 5));
      return TelemetryMetric(
        timestamp: '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}',
        throughputMbps: 450.0 + (i * 35.0) % 300,
        latencyMs: 1.2 + (i % 3) * 0.4,
        packetLossPct: i == 8 ? 0.4 : 0.0,
        cpuPct: 18.0 + (i * 5) % 25,
        ramPct: 42.0 + (i * 2) % 15,
      );
    });
  }
}
