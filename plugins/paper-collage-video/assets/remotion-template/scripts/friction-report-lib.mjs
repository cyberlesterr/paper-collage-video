import {
  readGenerationAttemptEvents,
  summarizeGenerationAttempts,
} from './generation-attempt-lib.mjs';
import {
  readFailureCircuitEvents,
  summarizeFailureCircuits,
} from './failure-circuit-lib.mjs';
import {loadProductionMetrics} from './production-metrics-lib.mjs';

const seconds = (milliseconds) => Math.round((milliseconds ?? 0) / 1000);

const collectWastedPaidAttempts = (attempts) =>
  attempts
    .filter(
      (attempt) =>
        attempt.quotaConsumed === true &&
        ['rejected', 'abandoned'].includes(attempt.status),
    )
    .map(({attemptId, assetId, status, provider, model, note, at}) => ({
      attemptId,
      assetId,
      status,
      provider: provider ?? null,
      model: model ?? null,
      note: note ?? '',
      at: at ?? null,
    }));

const collectSlowestOperations = (segments, limit = 5) => {
  const grouped = new Map();
  for (const segment of segments ?? []) {
    const key = `${segment.category}/${segment.operation}`;
    const current = grouped.get(key) ?? {
      category: segment.category,
      operation: segment.operation,
      totalMs: 0,
      count: 0,
    };
    current.totalMs += segment.durationMs ?? 0;
    current.count += 1;
    grouped.set(key, current);
  }
  return [...grouped.values()]
    .sort((left, right) => right.totalMs - left.totalMs)
    .slice(0, limit)
    .map((entry) => ({...entry, totalSeconds: seconds(entry.totalMs)}));
};

export const buildFrictionReport = async ({slug}) => {
  const [{events: attemptEvents}, {events: circuitEvents}] = await Promise.all([
    readGenerationAttemptEvents(slug),
    readFailureCircuitEvents(slug),
  ]);
  const attemptSummary = summarizeGenerationAttempts(attemptEvents);
  const wastedPaid = collectWastedPaidAttempts(attemptSummary.attempts);
  const circuitSummary = summarizeFailureCircuits(circuitEvents);
  const resolvedCount = circuitEvents.filter(
    ({event}) => event === 'resolved',
  ).length;

  let metrics = null;
  try {
    const loaded = await loadProductionMetrics(slug, {create: false});
    const summary = loaded.metrics.summary ?? null;
    metrics = {
      available: true,
      observation: summary?.observation ?? null,
      measuredPercentOfObservation:
        summary?.measuredPercentOfObservation ?? null,
      unattributedPercentOfObservation:
        summary?.unattributedPercentOfObservation ?? null,
      byCategory: Object.entries(summary?.byCategory ?? {}).map(
        ([category, entry]) => ({
          category,
          totalSeconds: seconds(entry.durationMs),
          percentOfObservation: entry.percentOfObservation ?? null,
          segmentCount: entry.segmentCount ?? 0,
        }),
      ),
      slowestOperations: collectSlowestOperations(loaded.metrics.segments),
    };
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    metrics = {available: false};
  }

  return {
    slug,
    generatedAt: new Date().toISOString(),
    attempts: {
      total: attemptSummary.attempts.length,
      quotaConsumed: attemptSummary.used,
      reserved: attemptSummary.reserved,
      byStatus: attemptSummary.byStatus,
      wastedPaid,
    },
    circuits: {
      openCount: circuitSummary.open.length,
      resolvedCount,
      clusters: circuitSummary.circuits.map(
        ({circuitId, operation, count, open, evidence, lastAt}) => ({
          circuitId,
          operation,
          count,
          open,
          evidence,
          lastAt,
        }),
      ),
    },
    metrics,
  };
};

export const renderFrictionMarkdown = (report) => {
  const lines = [
    `# Friction report — ${report.slug}`,
    '',
    `生成时间：${report.generatedAt}（只读汇总，不改变任何生产状态）`,
    '',
    '## 付费额度使用',
    '',
    `- 总尝试 ${report.attempts.total} · 已计费 ${report.attempts.quotaConsumed} · 预留中 ${report.attempts.reserved}`,
    `- 按状态：${Object.entries(report.attempts.byStatus)
      .filter(([, count]) => count > 0)
      .map(([status, count]) => `${status}=${count}`)
      .join(' · ') || '无记录'}`,
    '',
  ];
  if (report.attempts.wastedPaid.length > 0) {
    lines.push('### 已计费但未成为正式资产的调用', '');
    for (const attempt of report.attempts.wastedPaid) {
      lines.push(
        `- \`${attempt.assetId}\` · ${attempt.status} · ${attempt.provider ?? '?'}` +
          `${attempt.note ? ` · ${attempt.note}` : ''}`,
      );
    }
    lines.push('');
  } else {
    lines.push('### 已计费但未成为正式资产的调用', '', '- 无 ✓', '');
  }
  lines.push('## 命令失败与熔断', '');
  if (report.circuits.clusters.length === 0) {
    lines.push(`- 无未解除的失败记录（历史解除 ${report.circuits.resolvedCount} 次）`, '');
  } else {
    for (const cluster of report.circuits.clusters) {
      lines.push(
        `- ${cluster.open ? '⛔ OPEN' : '⚠'} ${cluster.operation} · ${cluster.count} 次 · ${cluster.lastAt}`,
        `  - ${cluster.evidence || '(无证据摘要)'}`,
      );
    }
    lines.push('');
  }
  lines.push('## 时间分布', '');
  if (!report.metrics?.available) {
    lines.push('- 无 production-metrics 记录', '');
  } else {
    if (report.metrics.unattributedPercentOfObservation !== null) {
      lines.push(
        `- 已归因 ${report.metrics.measuredPercentOfObservation}% · 未归因（agent 阅读/编写/纠错）${report.metrics.unattributedPercentOfObservation}%`,
      );
    }
    for (const entry of report.metrics.byCategory) {
      if (entry.segmentCount === 0) continue;
      lines.push(
        `- ${entry.category}: ${entry.totalSeconds}s · ${entry.percentOfObservation}% · ${entry.segmentCount} 段`,
      );
    }
    if (report.metrics.slowestOperations.length > 0) {
      lines.push('', '### 最耗时操作 Top 5', '');
      for (const op of report.metrics.slowestOperations) {
        lines.push(
          `- ${op.category}/${op.operation}: ${op.totalSeconds}s · ${op.count} 次`,
        );
      }
    }
    lines.push('');
  }
  lines.push(
    '## 候选改进（人工补写）',
    '',
    '- 现象：',
    '- 根因：',
    '- Skill 候选改进：',
    '',
  );
  return lines.join('\n');
};
