class RiskExplanation {
  final String riskLevel; // LOW, MEDIUM, HIGH, CRITICAL
  final String summary;
  final List<String> keyPoints;
  final List<String> recommendations;
  final bool isSafe;
  final String provider;

  RiskExplanation({
    required this.riskLevel,
    required this.summary,
    required this.keyPoints,
    required this.recommendations,
    required this.isSafe,
    required this.provider,
  });

  factory RiskExplanation.fromJson(Map<String, dynamic> json) {
    return RiskExplanation(
      riskLevel: json['risk_level'] as String? ?? 'LOW',
      summary: json['summary'] as String? ?? '',
      keyPoints: (json['key_points'] as List<dynamic>?)?.map((e) => e.toString()).toList() ?? [],
      recommendations: (json['recommendations'] as List<dynamic>?)?.map((e) => e.toString()).toList() ?? [],
      isSafe: json['is_safe'] as bool? ?? true,
      provider: json['provider'] as String? ?? 'gemini-3.8-flash',
    );
  }
}

class CopilotMessage {
  final String id;
  final String text;
  final bool isUser;
  final DateTime timestamp;
  final String provider;
  final RiskExplanation? risk;

  CopilotMessage({
    required this.id,
    required this.text,
    required this.isUser,
    required this.timestamp,
    this.provider = 'NetOps AI',
    this.risk,
  });
}
