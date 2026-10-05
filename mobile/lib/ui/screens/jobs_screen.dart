import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../theme.dart';
import '../../models/job.dart';
import '../../state/netops_state.dart';

class JobsScreen extends StatelessWidget {
  const JobsScreen({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final state = context.watch<NetOpsState>();
    final jobs = state.jobs;

    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: NetOpsTheme.surfaceCard,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: NetOpsTheme.borderHairline),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('ЖУРНАЛ ЗАДАЧ (JOBS & PIPELINES)', style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold)),
                    const SizedBox(height: 4),
                    Text('Всего операций в очереди: ${jobs.length}', style: const TextStyle(fontSize: 12, color: Colors.grey)),
                  ],
                ),
                IconButton(
                  icon: const Icon(Icons.refresh, size: 20),
                  onPressed: () => state.loadAll(),
                  tooltip: 'Обновить',
                ),
              ],
            ),
          ),
          const SizedBox(height: 18),

          // Jobs List
          if (jobs.isEmpty) ...[
            const Center(child: Text('Задачи отсутствуют', style: TextStyle(color: Colors.grey))),
          ] else ...[
            ...jobs.map((job) {
              final statusColor = NetOpsTheme.statusColor(job.status);
              final isDeploy = job.type == 'DEPLOY';

              return Card(
                margin: const EdgeInsets.only(bottom: 12),
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Row(
                            children: [
                              Container(
                                padding: const EdgeInsets.all(6),
                                decoration: BoxDecoration(
                                  color: statusColor.withOpacity(0.15),
                                  borderRadius: BorderRadius.circular(6),
                                ),
                                child: Icon(
                                  isDeploy ? Icons.rocket_launch : Icons.play_arrow,
                                  size: 16,
                                  color: statusColor,
                                ),
                              ),
                              const SizedBox(width: 10),
                              Text(job.type, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                              const SizedBox(width: 8),
                              Text(
                                job.id.substring(0, job.id.length > 8 ? 8 : job.id.length),
                                style: const TextStyle(fontFamily: 'monospace', fontSize: 11, color: Colors.grey),
                              ),
                            ],
                          ),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                            decoration: BoxDecoration(
                              color: statusColor.withOpacity(0.12),
                              borderRadius: BorderRadius.circular(6),
                              border: Border.all(color: statusColor.withOpacity(0.3)),
                            ),
                            child: Text(
                              job.status,
                              style: TextStyle(color: statusColor, fontSize: 10, fontWeight: FontWeight.bold),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 10),
                      // Progress Bar
                      ClipRRect(
                        borderRadius: BorderRadius.circular(4),
                        child: LinearProgressIndicator(
                          value: job.progress / 100.0,
                          backgroundColor: Colors.white.withOpacity(0.06),
                          color: statusColor,
                          minHeight: 4,
                        ),
                      ),
                      const SizedBox(height: 10),
                      // Metadata
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text('Создал: ${job.createdBy} • Прогресс: ${job.progress}%', style: const TextStyle(fontSize: 11, color: Colors.grey)),
                          Text(job.createdAt, style: const TextStyle(fontFamily: 'monospace', fontSize: 10, color: Colors.grey)),
                        ],
                      ),
                      if (job.error != null) ...[
                        const SizedBox(height: 8),
                        Container(
                          padding: const EdgeInsets.all(8),
                          decoration: BoxDecoration(
                            color: NetOpsTheme.roseDanger.withOpacity(0.1),
                            borderRadius: BorderRadius.circular(6),
                            border: Border.all(color: NetOpsTheme.roseDanger.withOpacity(0.3)),
                          ),
                          child: Text(
                            'Ошибка: ${job.error}',
                            style: const TextStyle(fontSize: 11, color: NetOpsTheme.roseDanger),
                          ),
                        ),
                      ],
                      const SizedBox(height: 12),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.end,
                        children: [
                          OutlinedButton.icon(
                            onPressed: () => _showJobLogs(context, job),
                            icon: const Icon(Icons.list_alt, size: 14),
                            label: const Text('Логи выполнения', style: TextStyle(fontSize: 11)),
                          ),
                          const SizedBox(width: 8),
                          ElevatedButton.icon(
                            onPressed: () async {
                              await state.selectJob(job.id);
                              state.setTab(3); // Go to Diff screen
                            },
                            icon: const Icon(Icons.compare_arrows, size: 14),
                            label: const Text('Смотреть дифф', style: TextStyle(fontSize: 11)),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              );
            }),
          ],
        ],
      ),
    );
  }

  void _showJobLogs(BuildContext context, Job job) async {
    final state = Provider.of<NetOpsState>(context, listen: false);
    await state.selectJob(job.id);

    showDialog(
      context: context,
      builder: (ctx) => Dialog(
        backgroundColor: NetOpsTheme.surfaceElevated,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
          side: const BorderSide(color: NetOpsTheme.borderHover),
        ),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 700, maxHeight: 520),
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('Логи задачи: ${job.type} (${job.id.substring(0, 8)})', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                    IconButton(icon: const Icon(Icons.close, size: 18), onPressed: () => Navigator.pop(ctx)),
                  ],
                ),
                const SizedBox(height: 12),
                Expanded(
                  child: Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: Colors.black,
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: NetOpsTheme.borderHairline),
                    ),
                    child: state.selectedJobLogs.isEmpty
                        ? const Center(child: Text('Логи еще не сгенерированы', style: TextStyle(color: Colors.grey, fontSize: 12)))
                        : ListView.builder(
                            itemCount: state.selectedJobLogs.length,
                            itemBuilder: (c, idx) {
                              final log = state.selectedJobLogs[idx];
                              Color levelColor = Colors.white70;
                              if (log.level == 'ERROR') levelColor = NetOpsTheme.roseDanger;
                              if (log.level == 'WARNING') levelColor = NetOpsTheme.amberWarning;
                              if (log.level == 'INFO') levelColor = NetOpsTheme.cyanAction;

                              return Padding(
                                padding: const EdgeInsets.symmetric(vertical: 3),
                                child: Row(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text('[${log.level}] ', style: TextStyle(fontFamily: 'Consolas', fontSize: 11, fontWeight: FontWeight.bold, color: levelColor)),
                                    Expanded(
                                      child: Text(
                                        '${log.hostname != null ? '[${log.hostname}] ' : ''}${log.message}',
                                        style: const TextStyle(fontFamily: 'Consolas', fontSize: 11, color: Colors.white),
                                      ),
                                    ),
                                  ],
                                ),
                              );
                            },
                          ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
