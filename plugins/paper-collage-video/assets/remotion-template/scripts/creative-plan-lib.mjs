export const CREATIVE_PLAN_MODES = [
  'none',
  'duration-only',
  'scenes-only',
  'both',
];

const isPositiveNumber = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const isPositiveInteger = (value) => Number.isInteger(value) && value > 0;

const isDateTime = (value) =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));

export const deriveCreativePlanMode = ({durationSeconds, sceneCount}) => {
  const hasDuration = durationSeconds !== null && durationSeconds !== undefined;
  const hasScenes = sceneCount !== null && sceneCount !== undefined;
  if (hasDuration && hasScenes) return 'both';
  if (hasDuration) return 'duration-only';
  if (hasScenes) return 'scenes-only';
  return 'none';
};

export const validateCreativePlan = (plan, {slug = null} = {}) => {
  const issues = [];
  const add = (code, message, location) => issues.push({code, message, location});
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    return [{code: 'plan-missing', message: '缺少创作规格计划。', location: 'plan'}];
  }
  if (plan.schemaVersion !== 1) {
    add('plan-schema-version', 'plan.schemaVersion 必须为 1。', 'plan.schemaVersion');
  }
  if (slug && plan.slug !== slug) {
    add('plan-slug', `plan.slug 必须为 ${slug}。`, 'plan.slug');
  }
  if (!['pending', 'resolved'].includes(plan.status)) {
    add('plan-status', 'plan.status 必须为 pending 或 resolved。', 'plan.status');
  }
  const requestedDuration = plan.requested?.durationSeconds;
  const requestedScenes = plan.requested?.sceneCount;
  if (requestedDuration !== null && !isPositiveNumber(requestedDuration)) {
    add(
      'plan-requested-duration',
      '用户指定时长必须是正数或 null。',
      'plan.requested.durationSeconds',
    );
  }
  if (requestedScenes !== null && !isPositiveInteger(requestedScenes)) {
    add(
      'plan-requested-scenes',
      '用户指定幕数必须是正整数或 null。',
      'plan.requested.sceneCount',
    );
  }
  const expectedMode = deriveCreativePlanMode({
    durationSeconds: requestedDuration,
    sceneCount: requestedScenes,
  });
  if (!CREATIVE_PLAN_MODES.includes(plan.inputMode) || plan.inputMode !== expectedMode) {
    add(
      'plan-input-mode',
      `plan.inputMode 应为 ${expectedMode}。`,
      'plan.inputMode',
    );
  }
  if (!isDateTime(plan.updatedAt)) {
    add('plan-updated-at', 'plan.updatedAt 必须是有效时间。', 'plan.updatedAt');
  }

  if (plan.status === 'pending') {
    if (plan.resolved !== null) {
      add('plan-pending-resolution', 'pending 计划的 resolved 必须为 null。', 'plan.resolved');
    }
    return issues;
  }

  const resolved = plan.resolved;
  if (!resolved || typeof resolved !== 'object' || Array.isArray(resolved)) {
    add('plan-resolution-missing', 'resolved 计划必须包含补全后的时长和幕数。', 'plan.resolved');
    return issues;
  }
  if (!isPositiveNumber(resolved.durationSeconds)) {
    add('plan-duration', '补全后的时长必须是正数。', 'plan.resolved.durationSeconds');
  }
  if (!isPositiveInteger(resolved.sceneCount)) {
    add('plan-scenes', '补全后的幕数必须是正整数。', 'plan.resolved.sceneCount');
  }
  if (
    resolved.estimatedNarrationSeconds !== null &&
    !isPositiveNumber(resolved.estimatedNarrationSeconds)
  ) {
    add(
      'plan-narration-estimate',
      '预计旁白时长必须是正数或 null。',
      'plan.resolved.estimatedNarrationSeconds',
    );
  }
  if (
    isPositiveNumber(resolved.estimatedNarrationSeconds) &&
    isPositiveNumber(resolved.durationSeconds) &&
    resolved.estimatedNarrationSeconds > resolved.durationSeconds
  ) {
    add(
      'plan-narration-overflow',
      '预计旁白时长不能超过目标成片时长；请压缩文案或增加目标时长。',
      'plan.resolved.estimatedNarrationSeconds',
    );
  }
  if (typeof resolved.rationale !== 'string' || !resolved.rationale.trim()) {
    add('plan-rationale', '补全计划必须记录计算依据。', 'plan.resolved.rationale');
  }
  if (!isDateTime(resolved.resolvedAt)) {
    add('plan-resolved-at', 'plan.resolved.resolvedAt 必须是有效时间。', 'plan.resolved.resolvedAt');
  }
  if (
    isPositiveNumber(requestedDuration) &&
    resolved.durationSeconds !== requestedDuration
  ) {
    add(
      'plan-duration-override',
      '用户已指定时长时，补全计划不得改写该目标。',
      'plan.resolved.durationSeconds',
    );
  }
  if (isPositiveInteger(requestedScenes) && resolved.sceneCount !== requestedScenes) {
    add(
      'plan-scenes-override',
      '用户已指定幕数时，补全计划不得改写该目标。',
      'plan.resolved.sceneCount',
    );
  }
  return issues;
};

export const assertCreativePlanReady = (plan, {slug = null} = {}) => {
  const issues = validateCreativePlan(plan, {slug});
  if (plan?.status !== 'resolved') {
    throw new Error('创作规格尚未补全；请先运行 project:plan。');
  }
  if (issues.length) {
    throw new Error(issues.map(({location, message}) => `${location}: ${message}`).join('\n'));
  }
  return plan;
};

export const buildCreativePlan = ({
  slug,
  requestedDurationSeconds = null,
  requestedSceneCount = null,
  durationSeconds,
  sceneCount,
  estimatedNarrationSeconds = null,
  rationale,
  at = new Date().toISOString(),
}) => {
  const requested = {
    durationSeconds: requestedDurationSeconds,
    sceneCount: requestedSceneCount,
  };
  const plan = {
    schemaVersion: 1,
    slug,
    status: 'resolved',
    inputMode: deriveCreativePlanMode(requested),
    requested,
    resolved: {
      durationSeconds,
      sceneCount,
      estimatedNarrationSeconds,
      rationale: rationale?.trim() ?? '',
      resolvedAt: at,
    },
    updatedAt: at,
  };
  assertCreativePlanReady(plan, {slug});
  return plan;
};

export const assessCreativePlanTimeline = (plan, timeline) => {
  if (plan?.status !== 'resolved' || !plan.resolved) return [];
  const issues = [];
  const target = plan.resolved;
  const sceneCount = timeline?.scenes?.length ?? 0;
  if (sceneCount !== target.sceneCount) {
    issues.push({
      level: 'error',
      code: 'plan-scene-count',
      message: `计划为 ${target.sceneCount} 幕，项目实际为 ${sceneCount} 幕。`,
      location: 'scenes',
    });
  }
  const actualDuration = Number(timeline?.durationSeconds ?? 0);
  const durationDrift = Math.abs(actualDuration - target.durationSeconds);
  const tolerance = Math.max(2, target.durationSeconds * 0.1);
  if (durationDrift > tolerance) {
    const durationWasExplicit = plan.requested?.durationSeconds != null;
    issues.push({
      level: durationWasExplicit ? 'error' : 'warning',
      code: 'plan-duration-drift',
      message: `${durationWasExplicit ? '用户指定' : 'Skill 推导'}约 ${target.durationSeconds}s，时间线实际 ${actualDuration.toFixed(3)}s；偏差超过 ${tolerance.toFixed(1)}s。`,
      location: 'plan.resolved.durationSeconds',
    });
  }
  return issues;
};
