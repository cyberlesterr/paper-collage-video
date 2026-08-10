import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import {
  assertSlug,
  projectPaths,
  readJson,
  writeJson,
} from './project-lib.mjs';
import {readGenerationAttemptEvents} from './generation-attempt-lib.mjs';

export const PRODUCTION_METRIC_CATEGORIES = [
  'ai-generation',
  'ai-review',
  'human-review',
  'deterministic-check',
  'evidence-render',
  'video-render',
];

export const PRODUCTION_METRIC_MEASUREMENTS = [
  'command-wall-clock',
  'review-session-window',
  'provider-attempt-window',
];

const METRICS_SCHEMA_VERSION = 1;
const METRICS_SOURCE = 'paper-collage-video';

export const productionMetricsPath = (slug) =>
  projectPaths(slug).productionMetricsFile;

const clone = (value) => JSON.parse(JSON.stringify(value));

const asTimestamp = (value) => {
  const timestamp = Date.parse(value ?? '');
  return Number.isFinite(timestamp) ? timestamp : null;
};

const iso = (value = Date.now()) => new Date(value).toISOString();

const roundPercent = (numerator, denominator) =>
  denominator > 0 ? Math.round((numerator / denominator) * 10_000) / 100 : 0;

const unionDuration = (intervals) => {
  const sorted = intervals
    .filter(({start, end}) => Number.isFinite(start) && Number.isFinite(end) && end >= start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  let total = 0;
  let currentStart = null;
  let currentEnd = null;
  for (const interval of sorted) {
    if (currentStart === null) {
      currentStart = interval.start;
      currentEnd = interval.end;
      continue;
    }
    if (interval.start <= currentEnd) {
      currentEnd = Math.max(currentEnd, interval.end);
      continue;
    }
    total += currentEnd - currentStart;
    currentStart = interval.start;
    currentEnd = interval.end;
  }
  if (currentStart !== null) total += currentEnd - currentStart;
  return Math.max(0, Math.round(total));
};

const emptyCategorySummary = () => ({
  durationMs: 0,
  percentOfObservation: 0,
  segmentCount: 0,
  activeSegmentCount: 0,
});

const initialSummary = (createdAt, collectionStartedAt = createdAt) => ({
  observation: {
    startedAt: createdAt,
    endedAt: createdAt,
    durationMs: 0,
  },
  coverage: {
    status: 'full',
    collectionStartedAt,
  },
  measuredUnionMs: 0,
  measuredPercentOfObservation: 0,
  unattributedMs: 0,
  unattributedPercentOfObservation: 0,
  byCategory: Object.fromEntries(
    PRODUCTION_METRIC_CATEGORIES.map((category) => [category, emptyCategorySummary()]),
  ),
  aiReview: {
    durationMs: 0,
    percentOfObservation: 0,
    segmentCount: 0,
    activeSegmentCount: 0,
  },
});

export const createProductionMetrics = ({slug, createdAt, collectionStartedAt = createdAt}) => ({
  $schema: '../../schemas/production-metrics.schema.json',
  schemaVersion: METRICS_SCHEMA_VERSION,
  projectSlug: slug,
  createdAt,
  collectionStartedAt,
  updatedAt: collectionStartedAt,
  measurementNotes: {
    commandWallClock:
      'Measures the wrapped local command from process start to exit.',
    reviewSessionWindow:
      'Measures from quality scaffold completion to the recorded human decision; it includes evidence presentation and the human wait, not model inference time.',
    providerAttemptWindow:
      'Measures from generation-attempt reservation to closure; it includes provider work and surrounding orchestration.',
    tokenTelemetry:
      'Unavailable unless the host or provider reports it; this file does not estimate token usage.',
    categoryOverlap:
      'Category durations are independently unioned and may overlap; measuredUnionMs de-duplicates all overlaps.',
  },
  segments: [],
  summary: initialSummary(createdAt, collectionStartedAt),
});

const validateMetrics = (metrics, slug) => {
  const issues = [];
  if (metrics?.schemaVersion !== METRICS_SCHEMA_VERSION) {
    issues.push(`schemaVersion 必须为 ${METRICS_SCHEMA_VERSION}`);
  }
  if (metrics?.projectSlug !== slug) issues.push(`projectSlug 必须为 ${slug}`);
  if (!Array.isArray(metrics?.segments)) issues.push('segments 必须为数组');
  for (const [index, segment] of (metrics?.segments ?? []).entries()) {
    if (!segment?.id || typeof segment.id !== 'string') issues.push(`segments[${index}].id 无效`);
    if (!PRODUCTION_METRIC_CATEGORIES.includes(segment?.category)) {
      issues.push(`segments[${index}].category 无效`);
    }
    if (!['in-progress', 'completed', 'failed', 'abandoned'].includes(segment?.status)) {
      issues.push(`segments[${index}].status 无效`);
    }
    if (!PRODUCTION_METRIC_MEASUREMENTS.includes(segment?.measurement)) {
      issues.push(`segments[${index}].measurement 无效`);
    }
    if (asTimestamp(segment?.startedAt) === null) issues.push(`segments[${index}].startedAt 无效`);
    if (segment?.endedAt !== null && asTimestamp(segment.endedAt) === null) {
      issues.push(`segments[${index}].endedAt 无效`);
    }
  }
  if (issues.length > 0) throw new Error(`production-metrics.json 无效：${issues.join('；')}`);
};

const loadProductionTimes = async (slug) => {
  const production = await readJson(projectPaths(slug).productionFile);
  const startedAt = production.createdAt;
  const endedAt = production.updatedAt ?? startedAt;
  if (asTimestamp(startedAt) === null || asTimestamp(endedAt) === null) {
    throw new Error('production.json 缺少有效的 createdAt/updatedAt。');
  }
  return {production, startedAt, endedAt};
};

export const loadProductionMetrics = async (slug, {create = true} = {}) => {
  assertSlug(slug);
  const file = productionMetricsPath(slug);
  let metrics;
  try {
    metrics = await readJson(file);
  } catch (error) {
    if (error?.code !== 'ENOENT' || !create) throw error;
    const {startedAt} = await loadProductionTimes(slug);
    const collectionStartedAt = iso();
    metrics = createProductionMetrics({
      slug,
      createdAt: startedAt,
      collectionStartedAt,
    });
  }
  validateMetrics(metrics, slug);
  return {file, metrics};
};

const generationAttemptSegments = async (slug) => {
  const {events} = await readGenerationAttemptEvents(slug);
  const attempts = new Map();
  for (const event of events) {
    const current = attempts.get(event.attemptId) ?? {reserved: null, closed: null};
    if (event.event === 'reserved') current.reserved = event;
    if (event.event === 'closed') current.closed = event;
    attempts.set(event.attemptId, current);
  }
  return [...attempts.entries()]
    .filter(([, attempt]) => attempt.reserved)
    .map(([attemptId, attempt]) => {
      const startedAt = attempt.reserved.at;
      const endedAt = attempt.closed?.at ?? null;
      const started = asTimestamp(startedAt);
      const ended = asTimestamp(endedAt);
      return {
        id: `generation:${attemptId}`,
        category: 'ai-generation',
        operation: 'provider-image-generation',
        source: 'generation-attempts',
        status: attempt.closed
          ? attempt.closed.status === 'failed-before-generation'
            ? 'failed'
            : 'completed'
          : 'in-progress',
        measurement: 'provider-attempt-window',
        startedAt,
        endedAt,
        durationMs: ended !== null && started !== null ? Math.max(0, ended - started) : null,
        metadata: {
          attemptId,
          assetId: attempt.reserved.assetId,
          provider: attempt.reserved.provider,
          model: attempt.reserved.model ?? null,
          attemptStatus: attempt.closed?.status ?? 'reserved',
          quotaConsumed: attempt.closed?.quotaConsumed ?? false,
        },
      };
    });
};

const synchronizeDerivedSegments = async (slug, metrics) => {
  const retained = metrics.segments.filter(({source}) => source !== 'generation-attempts');
  metrics.segments = [...retained, ...(await generationAttemptSegments(slug))];
};

const summarizeMetrics = async (slug, metrics, now = Date.now()) => {
  const {startedAt, endedAt: productionEndedAt} = await loadProductionTimes(slug);
  const observationStart = asTimestamp(startedAt);
  const candidateEnds = [asTimestamp(productionEndedAt) ?? observationStart];
  for (const segment of metrics.segments) {
    if (segment.status === 'in-progress') candidateEnds.push(now);
    else if (segment.endedAt) candidateEnds.push(asTimestamp(segment.endedAt));
  }
  const observationEnd = Math.max(observationStart, ...candidateEnds.filter(Number.isFinite));
  const observationDuration = Math.max(0, observationEnd - observationStart);
  const intervalsFor = (segments) => segments.map((segment) => ({
    start: Math.max(observationStart, asTimestamp(segment.startedAt) ?? observationStart),
    end: Math.min(
      observationEnd,
      segment.status === 'in-progress'
        ? observationEnd
        : asTimestamp(segment.endedAt) ?? observationEnd,
    ),
  }));
  const allIntervals = intervalsFor(metrics.segments);
  const measuredUnionMs = unionDuration(allIntervals);
  const byCategory = {};
  for (const category of PRODUCTION_METRIC_CATEGORIES) {
    const segments = metrics.segments.filter((segment) => segment.category === category);
    const durationMs = unionDuration(intervalsFor(segments));
    byCategory[category] = {
      durationMs,
      percentOfObservation: roundPercent(durationMs, observationDuration),
      segmentCount: segments.length,
      activeSegmentCount: segments.filter(({status}) => status === 'in-progress').length,
    };
  }
  const collectionStarted = asTimestamp(metrics.collectionStartedAt);
  const fullCoverage = collectionStarted !== null && collectionStarted <= observationStart + 1_000;
  const unattributedMs = Math.max(0, observationDuration - measuredUnionMs);
  metrics.summary = {
    observation: {
      startedAt: iso(observationStart),
      endedAt: iso(observationEnd),
      durationMs: observationDuration,
    },
    coverage: {
      status: fullCoverage ? 'full' : 'partial',
      collectionStartedAt: metrics.collectionStartedAt,
    },
    measuredUnionMs,
    measuredPercentOfObservation: roundPercent(measuredUnionMs, observationDuration),
    unattributedMs,
    unattributedPercentOfObservation: roundPercent(unattributedMs, observationDuration),
    byCategory,
    aiReview: clone(byCategory['ai-review']),
  };
};

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const withMetricsLock = async (slug, operation) => {
  const file = productionMetricsPath(slug);
  const lockDirectory = `${file}.lock`;
  let acquired = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await fs.mkdir(lockDirectory);
      acquired = true;
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const stat = await fs.stat(lockDirectory).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > 30_000) {
        await fs.rm(lockDirectory, {recursive: true, force: true});
        continue;
      }
      await wait(50);
    }
  }
  if (!acquired) throw new Error('production-metrics.json 正被其他进程使用，请稍后重试。');
  try {
    return await operation();
  } finally {
    await fs.rm(lockDirectory, {recursive: true, force: true});
  }
};

const writeRefreshedMetrics = async (slug, file, metrics, now = Date.now()) => {
  await synchronizeDerivedSegments(slug, metrics);
  await summarizeMetrics(slug, metrics, now);
  metrics.updatedAt = iso(now);
  await writeJson(file, metrics);
  return metrics;
};

export const refreshProductionMetrics = async (slug) =>
  withMetricsLock(slug, async () => {
    const {file, metrics} = await loadProductionMetrics(slug);
    return writeRefreshedMetrics(slug, file, metrics);
  });

export const startMetricSegment = async ({
  slug,
  category,
  operation,
  measurement,
  source = METRICS_SOURCE,
  metadata = {},
  at = iso(),
}) => {
  if (!PRODUCTION_METRIC_CATEGORIES.includes(category)) {
    throw new Error(`未知 production metric category：${category}`);
  }
  if (!operation?.trim()) throw new Error('production metric operation 不能为空。');
  if (!PRODUCTION_METRIC_MEASUREMENTS.includes(measurement)) {
    throw new Error(`未知 production metric measurement：${measurement}`);
  }
  return withMetricsLock(slug, async () => {
    const {file, metrics} = await loadProductionMetrics(slug);
    const startedAt = asTimestamp(at);
    if (startedAt === null) throw new Error('production metric startedAt 无效。');
    const supersededAt = iso(startedAt);
    for (const segment of metrics.segments) {
      if (
        segment.status === 'in-progress' &&
        segment.category === category &&
        segment.operation === operation &&
        segment.source === source
      ) {
        segment.status = 'abandoned';
        segment.endedAt = supersededAt;
        segment.durationMs = Math.max(0, startedAt - asTimestamp(segment.startedAt));
        segment.metadata = {...segment.metadata, closeReason: 'superseded'};
      }
    }
    const segment = {
      id: `metric-${randomUUID()}`,
      category,
      operation: operation.trim(),
      source,
      status: 'in-progress',
      measurement,
      startedAt: iso(startedAt),
      endedAt: null,
      durationMs: null,
      metadata,
    };
    metrics.segments.push(segment);
    await writeRefreshedMetrics(slug, file, metrics, startedAt);
    return clone(segment);
  });
};

export const finishMetricSegment = async ({
  slug,
  segmentId,
  status = 'completed',
  metadata = {},
  at = iso(),
}) => {
  if (!['completed', 'failed', 'abandoned'].includes(status)) {
    throw new Error(`无效 production metric 完成状态：${status}`);
  }
  return withMetricsLock(slug, async () => {
    const {file, metrics} = await loadProductionMetrics(slug);
    const segment = metrics.segments.find(({id}) => id === segmentId);
    if (!segment) throw new Error(`production metric segment 不存在：${segmentId}`);
    if (segment.status !== 'in-progress') return clone(segment);
    const endedAt = asTimestamp(at);
    if (endedAt === null) throw new Error('production metric endedAt 无效。');
    segment.status = status;
    segment.endedAt = iso(endedAt);
    segment.durationMs = Math.max(0, endedAt - asTimestamp(segment.startedAt));
    segment.metadata = {...segment.metadata, ...metadata};
    await writeRefreshedMetrics(slug, file, metrics, endedAt);
    return clone(segment);
  });
};

export const finishLatestMetricSegment = async ({
  slug,
  operation,
  source = METRICS_SOURCE,
  status = 'completed',
  metadata = {},
  at = iso(),
}) => withMetricsLock(slug, async () => {
  const {file, metrics} = await loadProductionMetrics(slug);
  const segment = [...metrics.segments]
    .reverse()
    .find((candidate) =>
      candidate.status === 'in-progress' &&
      candidate.operation === operation &&
      candidate.source === source,
    );
  if (!segment) {
    await writeRefreshedMetrics(slug, file, metrics, asTimestamp(at) ?? Date.now());
    return null;
  }
  const endedAt = asTimestamp(at);
  if (endedAt === null) throw new Error('production metric endedAt 无效。');
  segment.status = status;
  segment.endedAt = iso(endedAt);
  segment.durationMs = Math.max(0, endedAt - asTimestamp(segment.startedAt));
  segment.metadata = {...segment.metadata, ...metadata};
  await writeRefreshedMetrics(slug, file, metrics, endedAt);
  return clone(segment);
});

export const classifyQualityReviewer = (reviewer) =>
  /^(host-vision|ai|codex)(?::|$)/i.test(String(reviewer ?? '').trim())
    ? 'ai-review'
    : 'human-review';
