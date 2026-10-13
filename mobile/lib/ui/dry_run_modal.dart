import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'theme.dart';
import '../state/netops_state.dart';

class DryRunModalDialog extends StatefulWidget {
  final List<int>? initialDeviceIds;

  const DryRunModalDialog({Key? key, this.initialDeviceIds}) : super(key: key);

  @override
  State<DryRunModalDialog> createState() => _DryRunModalDialogState();
}

class _DryRunModalDialogState extends State<DryRunModalDialog> {
  final Set<int> _selected = {};

  @override
  void initState() {
    super.initState();
    final state = Provider.of<NetOpsState>(context, listen: false);
    if (widget.initialDeviceIds != null && widget.initialDeviceIds!.isNotEmpty) {
      _selected.addAll(widget.initialDeviceIds!);
    } else {
      _selected.addAll(state.devices.map((d) => d.id));
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = context.watch<NetOpsState>();

    return Dialog(
      backgroundColor: NetOpsTheme.surfaceElevated,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: const BorderSide(color: NetOpsTheme.borderHover),
      ),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 520, maxHeight: 600),
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    children: const [
                      Icon(Icons.play_circle_fill, color: NetOpsTheme.cyanAction, size: 22),
                      SizedBox(width: 10),
                      Text(
                        'Запуск холостого прогона (Dry-Run)',
                        style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                      ),
                    ],
                  ),
                  IconButton(
                    icon: const Icon(Icons.close, size: 18, color: Colors.grey),
                    onPressed: () => Navigator.pop(context),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              const Text(
                'Сформировать и верифицировать план изменений через HierConfig без применения на реальное сетевое оборудование.',
                style: TextStyle(fontSize: 12, color: Colors.grey),
              ),
              const SizedBox(height: 16),
              // Source info
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: NetOpsTheme.surfaceCard,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: NetOpsTheme.borderHairline),
                ),
                child: Row(
                  children: const [
                    Icon(Icons.commit, size: 16, color: NetOpsTheme.cyanAction),
                    SizedBox(width: 8),
                    Text('Источник целевого состояния (SSOT): ', style: TextStyle(fontSize: 11, color: Colors.grey)),
                    Text('Git (ветка main)', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Colors.white)),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              // Select all / none bar
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    'ЦЕЛЕВЫЕ УСТРОЙСТВА (${_selected.length}/${state.devices.length})',
                    style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Colors.grey, letterSpacing: 0.8),
                  ),
                  Row(
                    children: [
                      TextButton(
                        onPressed: () {
                          setState(() {
                            if (_selected.length == state.devices.length) {
                              _selected.clear();
                            } else {
                              _selected.addAll(state.devices.map((d) => d.id));
                            }
                          });
                        },
                        child: Text(
                          _selected.length == state.devices.length ? 'Снять все' : 'Выбрать все',
                          style: const TextStyle(fontSize: 11, color: NetOpsTheme.cyanAction),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
              const SizedBox(height: 8),
              // Devices list
              Expanded(
                child: Container(
                  decoration: BoxDecoration(
                    color: NetOpsTheme.surfaceCard,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: NetOpsTheme.borderHairline),
                  ),
                  child: ListView.separated(
                    padding: const EdgeInsets.all(6),
                    itemCount: state.devices.length,
                    separatorBuilder: (_, __) => const Divider(height: 1),
                    itemBuilder: (context, index) {
                      final d = state.devices[index];
                      final isChecked = _selected.contains(d.id);

                      return CheckboxListTile(
                        value: isChecked,
                        dense: true,
                        activeColor: NetOpsTheme.cyanAction,
                        checkColor: Colors.black,
                        title: Row(
                          children: [
                            Text(d.hostname, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                            const SizedBox(width: 8),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1.5),
                              decoration: BoxDecoration(
                                color: Colors.white.withOpacity(0.05),
                                borderRadius: BorderRadius.circular(4),
                              ),
                              child: Text(d.platform, style: const TextStyle(fontFamily: 'monospace', fontSize: 9, color: Colors.grey)),
                            ),
                          ],
                        ),
                        subtitle: Text('${d.managementIp}:${d.managementPort} • ${d.role}', style: const TextStyle(fontSize: 10, color: Colors.grey)),
                        secondary: Container(
                          width: 8,
                          height: 8,
                          decoration: BoxDecoration(
                            color: NetOpsTheme.statusColor(d.status),
                            shape: BoxShape.circle,
                          ),
                        ),
                        onChanged: (val) {
                          setState(() {
                            if (val == true) {
                              _selected.add(d.id);
                            } else {
                              _selected.remove(d.id);
                            }
                          });
                        },
                      );
                    },
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  OutlinedButton(
                    onPressed: () => Navigator.pop(context),
                    child: const Text('Отмена'),
                  ),
                  const SizedBox(width: 12),
                  ElevatedButton.icon(
                    onPressed: _selected.isEmpty
                        ? null
                        : () {
                            Navigator.pop(context);
                            state.executeDryRun(_selected.toList());
                          },
                    icon: const Icon(Icons.play_arrow, size: 16),
                    label: Text('Запустить Dry-Run (${_selected.length})'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
