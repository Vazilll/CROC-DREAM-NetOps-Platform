import 'package:flutter/foundation.dart';
import '../models/device.dart';
import '../models/job.dart';
import '../models/drift.dart';
import '../models/forecast.dart';
import '../models/copilot.dart';
import '../services/api_service.dart';

class NetOpsState extends ChangeNotifier {
  final ApiService api;

  NetOpsState({required this.api}) {
    loadAll();
  }

  int _activeTab = 0;
  int get activeTab => _activeTab;

  String _userRole = 'admin';
  String get userRole => _userRole;

  bool _isLoading = true;
  bool get isLoading => _isLoading;

  bool _isBackendOnline = true;
  bool get isBackendOnline => _isBackendOnline;

  String? _toastMessage;
  String? get toastMessage => _toastMessage;

  List<Device> _devices = [];
  List<Device> get devices => _devices;

  List<Job> _jobs = [];
  List<Job> get jobs => _jobs;

  Job? _selectedJob;
  Job? get selectedJob => _selectedJob;

  JobDiff? _selectedJobDiff;
  JobDiff? get selectedJobDiff => _selectedJobDiff;

  List<JobLog> _selectedJobLogs = [];
  List<JobLog> get selectedJobLogs => _selectedJobLogs;

  List<DriftReportItem> _driftReport = [];
  List<DriftReportItem> get driftReport => _driftReport;

  List<TelemetryMetric> _telemetry = [];
  List<TelemetryMetric> get telemetry => _telemetry;

  Forecast? _forecast;
  Forecast? get forecast => _forecast;

  final List<CopilotMessage> _copilotMessages = [
    CopilotMessage(
      id: 'init-1',
      text: 'Добро пожаловать в сетевой кокпит CROC DREAM NetOps! Я ваш ИИ-ассистент на базе Google Gemini и TimesFM-3.0. Чем могу помочь: проанализировать дрейф BGP, объяснить дельту HierConfig, сделать прогноз аномалий телеметрии или безопасно раскатить конфигурацию?',
      isUser: false,
      timestamp: DateTime.now().subtract(const Duration(minutes: 5)),
      provider: 'NetOps AI Copilot',
    ),
  ];
  List<CopilotMessage> get copilotMessages => _copilotMessages;

  void setTab(int index) {
    _activeTab = index;
    notifyListeners();
  }

  void setUserRole(String role) {
    _userRole = role;
    api.setRole(role);
    notifyListeners();
  }

  void showToast(String msg) {
    _toastMessage = msg;
    notifyListeners();
  }

  void clearToast() {
    _toastMessage = null;
    notifyListeners();
  }

  Future<void> loadAll() async {
    _isLoading = true;
    notifyListeners();

    try {
      final devs = await api.getDevices();
      final jbs = await api.getJobs();
      final drift = await api.getDriftReport();
      final telem = api.getMockTelemetry();

      _devices = devs;
      _jobs = jbs;
      _driftReport = drift;
      _telemetry = telem;
      _isBackendOnline = true;

      if (_jobs.isNotEmpty && _selectedJob == null) {
        await selectJob(_jobs.first.id);
      }

      if (_devices.isNotEmpty && _forecast == null) {
        await loadForecast(_devices.first.id, 'cpu');
      }
    } catch (e) {
      _isBackendOnline = false;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> selectJob(String jobId) async {
    try {
      final job = await api.getJob(jobId);
      final diff = await api.getJobDiff(jobId);
      final logs = await api.getJobLogs(jobId);
      _selectedJob = job;
      _selectedJobDiff = diff;
      _selectedJobLogs = logs;
      notifyListeners();
    } catch (_) {}
  }

  Future<void> loadForecast(int deviceId, String metric) async {
    try {
      final fc = await api.getForecast(deviceId, metric);
      _forecast = fc;
      notifyListeners();
    } catch (_) {}
  }

  Future<void> executeDryRun(List<int> deviceIds) async {
    showToast('Запуск холостого прогона (Dry-Run)...');
    try {
      final jobId = await api.triggerDryRun(deviceIds);
      showToast('Dry-Run поставлен в очередь: ${jobId.substring(0, jobId.length > 8 ? 8 : jobId.length)}');
      await loadAll();
      setTab(3); // Navigate to Diff screen
    } catch (e) {
      showToast('Ошибка запуска Dry-Run: $e');
    }
  }

  Future<void> executeDeploy(String jobId) async {
    showToast('Запуск транзакционного деплоя (commit confirmed 180s)...');
    try {
      final newJobId = await api.createDeploy(jobId, confirmedBy: _userRole);
      showToast('Деплой запущен! ID: ${newJobId.substring(0, newJobId.length > 8 ? 8 : newJobId.length)}');
      await loadAll();
      setTab(5); // Navigate to Jobs screen
    } catch (e) {
      showToast('Ошибка запуска деплоя: $e');
    }
  }

  Future<void> scanDrift({List<int>? deviceIds}) async {
    showToast('Запуск сканирования дрейфа конфигурации...');
    try {
      final jobId = await api.scanDrift(deviceIds: deviceIds);
      showToast('Скан дрейфа запущен! ID: ${jobId.substring(0, jobId.length > 8 ? 8 : jobId.length)}');
      await loadAll();
    } catch (e) {
      showToast('Ошибка скана: $e');
    }
  }

  Future<void> remediateDrift(int deviceId) async {
    showToast('Устранение дрейфа через HierConfig...');
    try {
      final jobId = await api.remediateDrift(deviceId);
      showToast('Компенсирующий патч поставлен в очередь! ID: ${jobId.substring(0, jobId.length > 8 ? 8 : jobId.length)}');
      await loadAll();
    } catch (e) {
      showToast('Ошибка устранения дрейфа: $e');
    }
  }

  Future<void> syncInventory() async {
    showToast('Синхронизация inventory.yaml из Git...');
    try {
      final res = await api.syncInventory();
      final created = (res['created'] as List?)?.length ?? 0;
      final updated = (res['updated'] as List?)?.length ?? 0;
      showToast('Инвентарь синхронизирован! Создано: $created, обновлено: $updated');
      await loadAll();
    } catch (e) {
      showToast('Ошибка синхронизации: $e');
    }
  }

  Future<void> injectChaos(String scenario) async {
    showToast('Активация сценария стресс-тестирования: $scenario...');
    try {
      final res = await api.injectChaos(scenario);
      showToast(res['message'] ?? 'Сценарий хаоса успешно активирован');
      await loadAll();
    } catch (e) {
      showToast('Ошибка инжекции хаоса: $e');
    }
  }

  Future<void> sendCopilotMessage(String prompt, {int? deviceId}) async {
    if (prompt.trim().isEmpty) return;

    final userMsg = CopilotMessage(
      id: 'u-${DateTime.now().millisecondsSinceEpoch}',
      text: prompt,
      isUser: true,
      timestamp: DateTime.now(),
    );
    _copilotMessages.add(userMsg);
    notifyListeners();

    try {
      final res = await api.askCopilot(prompt, deviceId: deviceId);
      final aiMsg = CopilotMessage(
        id: 'ai-${DateTime.now().millisecondsSinceEpoch}',
        text: res['answer'] ?? 'Ответ получен.',
        isUser: false,
        timestamp: DateTime.now(),
        provider: res['provider'] ?? 'NetOps Copilot',
      );
      _copilotMessages.add(aiMsg);
    } catch (e) {
      _copilotMessages.add(CopilotMessage(
        id: 'err-${DateTime.now().millisecondsSinceEpoch}',
        text: 'Не удалось связаться с сервером ИИ: $e',
        isUser: false,
        timestamp: DateTime.now(),
      ));
    } finally {
      notifyListeners();
    }
  }
}
