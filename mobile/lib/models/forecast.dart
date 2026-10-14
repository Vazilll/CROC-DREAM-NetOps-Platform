class ForecastEvent {
  final String type;
  final String timestamp;
  final String title;
  final String description;
  final String severity;

  ForecastEvent({
    required this.type,
    required this.timestamp,
    required this.title,
    required this.description,
    required this.severity,
  });

  factory ForecastEvent.fromJson(Map<String, dynamic> json) {
    return ForecastEvent(
      type: json['type'] as String? ?? 'CHAOS',
      timestamp: json['timestamp'] as String? ?? '',
      title: json['title'] as String? ?? '',
      description: json['description'] as String? ?? '',
      severity: json['severity'] as String? ?? 'info',
    );
  }
}

class Forecast {
  final int deviceId;
  final String hostname;
  final String metric;
  final String label;
  final String unit;
  final double threshold;
  final bool simulated;
  final int stepSeconds;
  final List<double> history;
  final List<double> median;
  final List<double> lower;
  final List<double> upper;
  final String provider;
  final int? breachInMinutes;
  final List<ForecastEvent> events;

  Forecast({
    required this.deviceId,
    required this.hostname,
    required this.metric,
    required this.label,
    required this.unit,
    required this.threshold,
    required this.simulated,
    required this.stepSeconds,
    this.history = const [],
    this.median = const [],
    this.lower = const [],
    this.upper = const [],
    this.provider = 'timesfm-3.0',
    this.breachInMinutes,
    this.events = const [],
  });

  factory Forecast.fromJson(Map<String, dynamic> json) {
    List<double> parseDoubles(dynamic list) {
      if (list is List) {
        return list.map((e) => (e as num).toDouble()).toList();
      }
      return [];
    }

    return Forecast(
      deviceId: (json['device_id'] as num?)?.toInt() ?? 0,
      hostname: json['hostname'] as String? ?? '',
      metric: json['metric'] as String? ?? '',
      label: json['label'] as String? ?? '',
      unit: json['unit'] as String? ?? '',
      threshold: (json['threshold'] as num?)?.toDouble() ?? 80.0,
      simulated: json['simulated'] as bool? ?? false,
      stepSeconds: (json['step_seconds'] as num?)?.toInt() ?? 300,
      history: parseDoubles(json['history']),
      median: parseDoubles(json['median']),
      lower: parseDoubles(json['lower']),
      upper: parseDoubles(json['upper']),
      provider: json['provider'] as String? ?? 'timesfm-3.0',
      breachInMinutes: (json['breach_in_minutes'] as num?)?.toInt(),
      events: (json['events'] as List<dynamic>?)
              ?.map((e) => ForecastEvent.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
    );
  }
}

class ForecastAlert {
  final int deviceId;
  final String hostname;
  final String metric;
  final String label;
  final double threshold;
  final int breachInMinutes;

  ForecastAlert({
    required this.deviceId,
    required this.hostname,
    required this.metric,
    required this.label,
    required this.threshold,
    required this.breachInMinutes,
  });

  factory ForecastAlert.fromJson(Map<String, dynamic> json) {
    return ForecastAlert(
      deviceId: (json['device_id'] as num?)?.toInt() ?? 0,
      hostname: json['hostname'] as String? ?? '',
      metric: json['metric'] as String? ?? '',
      label: json['label'] as String? ?? '',
      threshold: (json['threshold'] as num?)?.toDouble() ?? 80.0,
      breachInMinutes: (json['breach_in_minutes'] as num?)?.toInt() ?? 0,
    );
  }
}
