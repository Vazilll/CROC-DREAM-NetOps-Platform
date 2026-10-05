import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../theme.dart';
import '../../state/netops_state.dart';
import '../dry_run_modal.dart';

class SlidesScreen extends StatefulWidget {
  const SlidesScreen({Key? key}) : super(key: key);

  @override
  State<SlidesScreen> createState() => _SlidesScreenState();
}

class _SlidesScreenState extends State<SlidesScreen> {
  int _currentSlide = 0;

  final List<Map<String, dynamic>> _slides = [
    {
      'tag': 'АВТОНОМНЫЙ ОРКЕСТРАТОР СЕТИ',
      'title': 'CROC DREAM NetOps Platform',
      'subtitle': 'Кросс-платформенная система управления гетерогенной сетевой инфраструктурой следующего поколения',
      'bullets': [
        'Единый интерфейс управления для Arista EOS, Cisco IOS-XE, Huawei VRP и Juniper Junos.',
        'Декларативное описание целевого состояния (SSOT в Git: inventory.yaml & intent/).',
        'Автономный контроль дрейфа конфигурации и мгновенное самовосстановление (Self-Healing).',
      ],
      'icon': Icons.hub,
    },
    {
      'tag': 'ФАБРИКА СТЕНДА BARE METAL',
      'title': 'Гетерогенная CLOS Топология (6 Узлов)',
      'subtitle': '2x Arista EOS (Spines) ↔ 2x Cisco IOS-XE (Leafs) + 2x Huawei VRP (Leafs)',
      'bullets': [
        'Полносвязная фабрика (Spine-Leaf) с балансировкой трафика по ECMP.',
        'Сквозной eBGP пиринг и сегментация трафика через VXLAN/VLAN.',
        'Два пограничных межсетевых экрана Juniper Junos vSRX для защиты внешнего периметра.',
      ],
      'icon': Icons.device_hub,
    },
    {
      'tag': 'ТЕХНОЛОГИЧЕСКИЙ СТЕК И ДРАЙВЕРЫ',
      'title': 'Scrapli Network Driver + HierConfig',
      'subtitle': 'Иерархическая нормализация и вычисление точечной дельты конфигураций',
      'bullets': [
        'Кастомный асинхронный драйвер Scrapli Huawei VRP Driver для работы со стеком Comware/VRP.',
        'HierConfig: интеллектуальное определение лишних (+), недостающих (-) и неизменных строк.',
        'Отсутствие перезагрузок: атомарное применение только измененных веток конфигурационного дерева.',
      ],
      'icon': Icons.code,
    },
    {
      'tag': 'БЕЗОПАСНОСТЬ И ОТКАТОУСТОЙЧИВОСТЬ',
      'title': 'Двухфазный Деплой & Commit Confirmed',
      'subtitle': 'Транзакционная раскатка с таймером автоматического отката (180 секунд)',
      'bullets': [
        'Обязательный Dry-Run перед деплоем: валидация синтаксиса и проверка связности.',
        'Двухфазный коммит: если связь с узлом потеряна, он автоматически откатывается через 3 минуты.',
        'Ролевая модель доступа (RBAC): Admin, Operator, Viewer с защищенными токенами.',
      ],
      'icon': Icons.security,
    },
    {
      'tag': 'ПРЕДИКТИВНЫЙ ИНТЕЛЛЕКТ',
      'title': 'Нейросетевая Модель TimesFM-3.0',
      'subtitle': 'Предупреждение инцидентов до их наступления за 45 минут',
      'bullets': [
        'Анализ временных рядов пропускной способности, задержки RTT и утилизации CPU фабрики.',
        '90% доверительный интервал прогноза и детекция аномалий поведения трафика.',
        'Встроенный AI Copilot на базе Google Gemini для мгновенного объяснения сетевых рисков.',
      ],
      'icon': Icons.auto_awesome,
    },
  ];

  @override
  Widget build(BuildContext context) {
    final state = context.watch<NetOpsState>();
    final slide = _slides[_currentSlide];

    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        children: [
          // Slide Card
          Expanded(
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.all(32),
              decoration: BoxDecoration(
                color: NetOpsTheme.surfaceCard,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: NetOpsTheme.borderHairline),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                            decoration: BoxDecoration(
                              color: NetOpsTheme.cyanAction.withOpacity(0.15),
                              borderRadius: BorderRadius.circular(6),
                            ),
                            child: Text(
                              slide['tag'] as String,
                              style: const TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: NetOpsTheme.cyanAction, letterSpacing: 1),
                            ),
                          ),
                          Text('Слайд ${_currentSlide + 1} из ${_slides.length}', style: const TextStyle(fontSize: 12, color: Colors.grey)),
                        ],
                      ),
                      const SizedBox(height: 18),
                      Text(slide['title'] as String, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
                      const SizedBox(height: 8),
                      Text(slide['subtitle'] as String, style: const TextStyle(fontSize: 14, color: Colors.grey)),
                      const SizedBox(height: 24),
                      ...((slide['bullets'] as List<String>).map((b) => Padding(
                            padding: const EdgeInsets.only(bottom: 12),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Icon(Icons.check_circle, size: 18, color: NetOpsTheme.cyanAction),
                                const SizedBox(width: 12),
                                Expanded(child: Text(b, style: const TextStyle(fontSize: 14, height: 1.35))),
                              ],
                            ),
                          ))),
                    ],
                  ),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Row(
                        children: List.generate(_slides.length, (idx) {
                          final isCurrent = idx == _currentSlide;
                          return Container(
                            width: isCurrent ? 24 : 8,
                            height: 6,
                            margin: const EdgeInsets.only(right: 6),
                            decoration: BoxDecoration(
                              color: isCurrent ? NetOpsTheme.cyanAction : Colors.grey.withOpacity(0.3),
                              borderRadius: BorderRadius.circular(3),
                            ),
                          );
                        }),
                      ),
                      ElevatedButton.icon(
                        onPressed: () {
                          showDialog(
                            context: context,
                            builder: (ctx) => const DryRunModalDialog(),
                          );
                        },
                        icon: const Icon(Icons.play_arrow, size: 16),
                        label: const Text('Запустить живое демо'),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),

          // Navigation buttons
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              OutlinedButton.icon(
                onPressed: _currentSlide > 0 ? () => setState(() => _currentSlide--) : null,
                icon: const Icon(Icons.arrow_back, size: 16),
                label: const Text('Назад'),
              ),
              OutlinedButton.icon(
                onPressed: _currentSlide < _slides.length - 1 ? () => setState(() => _currentSlide++) : null,
                icon: const Icon(Icons.arrow_forward, size: 16),
                label: const Text('Вперед'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
