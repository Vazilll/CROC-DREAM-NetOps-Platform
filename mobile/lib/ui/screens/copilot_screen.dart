import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../theme.dart';
import '../../state/netops_state.dart';

class CopilotScreen extends StatefulWidget {
  const CopilotScreen({Key? key}) : super(key: key);

  @override
  State<CopilotScreen> createState() => _CopilotScreenState();
}

class _CopilotScreenState extends State<CopilotScreen> {
  final TextEditingController _inputController = TextEditingController();
  final ScrollController _scrollController = ScrollController();

  void _sendMessage(String text) {
    if (text.trim().isEmpty) return;
    final state = Provider.of<NetOpsState>(context, listen: false);
    state.sendCopilotMessage(text);
    _inputController.clear();
    Future.delayed(const Duration(milliseconds: 150), () {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 250),
          curve: Curves.easeOut,
        );
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final state = context.watch<NetOpsState>();
    final messages = state.copilotMessages;

    final suggestions = [
      'Проверить дрейф конфигурации в Git',
      'Безопасен ли деплой на spine-1?',
      'Прогноз перегрузки CPU через TimesFM',
      'Как настроена связность Huawei и Arista?',
    ];

    return Column(
      children: [
        // AI Model Banner
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          decoration: const BoxDecoration(
            color: NetOpsTheme.surfaceElevated,
            border: Border(bottom: BorderSide(color: NetOpsTheme.borderHairline)),
          ),
          child: Row(
            children: const [
              Icon(Icons.auto_awesome, color: NetOpsTheme.cyanAction, size: 16),
              SizedBox(width: 8),
              Text(
                'NETOPS AI COPILOT • GOOGLE GEMINI + TIMESFM-3.0',
                style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: NetOpsTheme.cyanAction, letterSpacing: 0.8),
              ),
              Spacer(),
              Text('LLM Engine: Online', style: TextStyle(fontSize: 10, color: NetOpsTheme.emeraldSuccess, fontFamily: 'monospace')),
            ],
          ),
        ),

        // Chat message history
        Expanded(
          child: ListView.builder(
            controller: _scrollController,
            padding: const EdgeInsets.all(16),
            itemCount: messages.length,
            itemBuilder: (context, idx) {
              final msg = messages[idx];
              final isUser = msg.isUser;

              return Align(
                alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
                child: Container(
                  constraints: const BoxConstraints(maxWidth: 650),
                  margin: const EdgeInsets.only(bottom: 12),
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: isUser ? NetOpsTheme.cyanAction.withOpacity(0.15) : NetOpsTheme.surfaceCard,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(
                      color: isUser ? NetOpsTheme.cyanAction.withOpacity(0.3) : NetOpsTheme.borderHairline,
                    ),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            isUser ? Icons.person : Icons.auto_awesome,
                            size: 13,
                            color: isUser ? NetOpsTheme.cyanAction : NetOpsTheme.violetAi,
                          ),
                          const SizedBox(width: 6),
                          Text(
                            isUser ? 'Инженер (Вы)' : msg.provider,
                            style: TextStyle(
                              fontSize: 10,
                              fontWeight: FontWeight.bold,
                              color: isUser ? NetOpsTheme.cyanAction : NetOpsTheme.violetAi,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 6),
                      SelectableText(
                        msg.text,
                        style: const TextStyle(fontSize: 13, height: 1.4, color: Colors.white),
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        ),

        // Quick suggestions
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: suggestions.map((s) => Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: ActionChip(
                      label: Text(s),
                      onPressed: () => _sendMessage(s),
                      backgroundColor: NetOpsTheme.surfaceElevated,
                      labelStyle: const TextStyle(fontSize: 11, color: Colors.grey),
                      side: const BorderSide(color: NetOpsTheme.borderHairline),
                    ),
                  )).toList(),
            ),
          ),
        ),

        // Input row
        Container(
          padding: const EdgeInsets.all(12),
          decoration: const BoxDecoration(
            color: NetOpsTheme.surfaceCard,
            border: Border(top: BorderSide(color: NetOpsTheme.borderHairline)),
          ),
          child: Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _inputController,
                  onSubmitted: _sendMessage,
                  decoration: const InputDecoration(
                    hintText: 'Задайте вопрос по сетевой фабрике, BGP или дрейфу...',
                    hintStyle: TextStyle(fontSize: 12, color: Colors.grey),
                    isDense: true,
                  ),
                ),
              ),
              const SizedBox(width: 10),
              ElevatedButton(
                onPressed: () => _sendMessage(_inputController.text),
                style: ElevatedButton.styleFrom(padding: const EdgeInsets.all(12)),
                child: const Icon(Icons.send, size: 16),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
