import {TIMING_CONTINUITY_THRESHOLDS} from './timeline-continuity-lib.mjs';
import {validateProviderRootPlan} from './provider-root-plan-lib.mjs';

export const CREATIVE_PLAN_MODES = [
  'none',
  'duration-only',
  'scenes-only',
  'both',
];

export const PRODUCTION_PROFILES = ['draft', 'balanced', 'full-depth'];

export const PRODUCTION_PROFILE_DEFINITIONS = {
  draft: {
    label: '轻量成片',
    summary: '以零成本本地运动为主；只为无法用变换表达的必要语义动作生成状态。',
    finalImpact: '不是静态幻灯片：角色和镜头仍会移动、呼吸、渐显与转场，但动作细节和景深更克制。',
  },
  balanced: {
    label: '均衡动画',
    summary: '本地运动与关键状态序列结合；主要动作通常使用 2–4 格状态，并选择性分层。',
    finalImpact: '主要动作真正发生变化，关键镜头具备前中后景、视差和适量环境生命。',
  },
  'full-depth': {
    label: '完整纵深',
    summary: '更完整的动作家族、4–6 格关键状态、丰富层次、视差、循环世界和环境生命。',
    finalImpact: '角色动作更细，空间更深，天气与环境元素更丰富；只增加服务叙事的细节。',
  },
};

export const deriveMotionBudget = (productionProfile, sceneCount) => {
  if (!PRODUCTION_PROFILES.includes(productionProfile)) {
    throw new Error(`productionProfile 必须是：${PRODUCTION_PROFILES.join(', ')}。`);
  }
  if (!Number.isInteger(sceneCount) || sceneCount < 1) {
    throw new Error('sceneCount 必须是正整数。');
  }
  return {
    maxPoseSheetCalls: {
      draft: Math.max(1, Math.ceil(sceneCount / 4)),
      balanced: Math.max(1, Math.ceil(sceneCount / 2)),
      // A single continuous shot can still contain two independently animated
      // hero identities. Do not make authors collapse them into one unrelated
      // state sheet merely because the film has one scene.
      'full-depth': Math.max(2, sceneCount),
    }[productionProfile],
    maxStatesPerSheet: {
      draft: 4,
      balanced: 4,
      'full-depth': 6,
    }[productionProfile],
    maxContinuousTargets: {
      draft: sceneCount * 2,
      balanced: sceneCount * 4,
      'full-depth': sceneCount * 6,
    }[productionProfile],
  };
};

export const deriveAssetBudget = (productionProfile, sceneCount) => {
  if (!PRODUCTION_PROFILES.includes(productionProfile)) {
    throw new Error(
      `productionProfile 必须是：${PRODUCTION_PROFILES.join(', ')}。`,
    );
  }
  if (!Number.isInteger(sceneCount) || sceneCount < 1) {
    throw new Error('sceneCount 必须是正整数。');
  }
  const environmentLayers = {
    draft: Math.ceil(sceneCount / 4),
    balanced: Math.min(4, Math.ceil((sceneCount * 2) / 3)),
    'full-depth': sceneCount * 2,
  }[productionProfile];
  const characterSheets = deriveMotionBudget(
    productionProfile,
    sceneCount,
  ).maxPoseSheetCalls;
  const budget = {
    backgrounds: sceneCount,
    environmentLayers,
    characterSheets,
    styleSamples: 1,
  };
  const baseImageAttempts = Object.values(budget).reduce(
    (sum, count) => sum + count,
    0,
  );
  const layerPackageAttemptReserve =
    {
      draft: 2,
      balanced: 4,
      // Full-depth can require one complete reference plus three full-canvas
      // context-preserving layer edits. Keep enough structural reserve for a
      // one-take hero environment without forcing a low-resolution 2x2 sheet.
      'full-depth': 8,
    }[productionProfile] * sceneCount;
  return {
    ...budget,
    baseImageAttempts,
    layerPackageAttemptReserve,
    maxGeneratedImages:
      baseImageAttempts + layerPackageAttemptReserve,
  };
};

export const summarizeProductionProfiles = (sceneCount) =>
  PRODUCTION_PROFILES.map((id) => ({
    id,
    ...PRODUCTION_PROFILE_DEFINITIONS[id],
    assetBudget: deriveAssetBudget(id, sceneCount),
    motionBudget: deriveMotionBudget(id, sceneCount),
  }));

export const deriveDurationAuthority = (plan) =>
  plan?.requested?.durationSeconds == null ? 'content-derived' : 'human-target';

export const summarizeConceptDecision = (plan) => {
  assertCreativePlanReady(plan, {slug: plan?.slug ?? null});
  return {
    productionProfile: plan.productionProfile,
    durationSeconds: plan.resolved.durationSeconds,
    sceneCount: plan.resolved.sceneCount,
    durationAuthority: deriveDurationAuthority(plan),
    assetBudget: plan.assetBudget,
    motionBudget: plan.motionBudget,
    approvedImageBudget: plan.approvedImageBudget,
    storyScope: plan.storyScope ?? null,
    scenarioBinding: plan.scenarioBinding ?? null,
    profilePromise: plan.profilePromise ?? null,
    profileOptions: summarizeProductionProfiles(plan.resolved.sceneCount),
  };
};

export const assertConfirmedPlanDecision = (decision, plan) => {
  if (!decision || typeof decision !== 'object' || Array.isArray(decision)) {
    throw new Error(
      '确认文件必须包含 planDecision，记录批准的 productionProfile、durationSeconds、sceneCount 和 durationAuthority。',
    );
  }
  const expected = summarizeConceptDecision(plan);
  for (const key of [
    'productionProfile',
    'durationSeconds',
    'sceneCount',
    'durationAuthority',
  ]) {
    if (decision[key] !== expected[key]) {
      throw new Error(
        `planDecision.${key} 必须与当前计划一致：expected ${expected[key]}, received ${decision[key] ?? 'missing'}。`,
      );
    }
  }
  return expected;
};

export const assertApprovedImageBudgetDecision = (
  decision,
  plan,
  directingSummary,
  {at = new Date().toISOString()} = {},
) => {
  if (!decision || typeof decision !== 'object' || Array.isArray(decision)) {
    throw new Error(
      '确认文件必须包含 budgetDecision，记录人批准的 imageAttemptLimit。',
    );
  }
  const imageAttemptLimit = decision.imageAttemptLimit;
  if (!Number.isInteger(imageAttemptLimit) || imageAttemptLimit < 0) {
    throw new Error('budgetDecision.imageAttemptLimit 必须是非负整数。');
  }
  const storyboardProviderImageCalls =
    directingSummary?.generationBudget?.expectedProviderImageCalls ?? 0;
  const expectedProviderImageCalls =
    plan?.scenarioBinding?.expectedProviderImageCalls ??
    storyboardProviderImageCalls;
  if (storyboardProviderImageCalls > expectedProviderImageCalls) {
    throw new Error(
      `当前 storyboard 的结构化素材预计 ${storyboardProviderImageCalls} 次图片调用，超过所选 scenario 的全片预计 ${expectedProviderImageCalls} 次；请重新规划并审批。`,
    );
  }
  const profileHardCeiling = plan?.assetBudget?.maxGeneratedImages;
  if (!Number.isInteger(profileHardCeiling) || profileHardCeiling < 0) {
    throw new Error('当前 Creative Plan 缺少有效的图片 profile hard ceiling。');
  }
  if (imageAttemptLimit < expectedProviderImageCalls) {
    throw new Error(
      `批准的图片尝试上限 ${imageAttemptLimit} 低于当前 storyboard 预计需要的 ${expectedProviderImageCalls} 次；请缩小范围或提高上限。`,
    );
  }
  if (imageAttemptLimit > profileHardCeiling) {
    throw new Error(
      `批准的图片尝试上限 ${imageAttemptLimit} 超过 ${plan.productionProfile} profile hard ceiling ${profileHardCeiling}；请提高档位或降低上限。`,
    );
  }
  return {
    imageAttemptLimit,
    expectedProviderImageCalls,
    profileHardCeiling,
    approvedAt: at,
  };
};

export const approveImageBudgetIncrease = ({
  plan,
  imageAttemptLimit,
  attempts,
  humanNote,
  at = new Date().toISOString(),
}) => {
  if (!plan?.approvedImageBudget) {
    throw new Error('当前 Creative Plan 尚未记录人批准的图片预算。');
  }
  const note = String(humanNote ?? '').trim();
  if (!note) {
    throw new Error('图片预算增额必须记录人的明确决定。');
  }
  if (!Number.isInteger(imageAttemptLimit) || imageAttemptLimit < 0) {
    throw new Error('新的图片尝试上限必须是非负整数。');
  }
  const currentLimit = plan.approvedImageBudget.imageAttemptLimit;
  if (imageAttemptLimit <= currentLimit) {
    throw new Error(
      `图片预算增额必须高于当前上限 ${currentLimit}；收到 ${imageAttemptLimit}。`,
    );
  }
  const profileHardCeiling = plan.assetBudget?.maxGeneratedImages;
  if (
    !Number.isInteger(profileHardCeiling) ||
    imageAttemptLimit > profileHardCeiling
  ) {
    throw new Error(
      `新的图片尝试上限 ${imageAttemptLimit} 超过当前 profile hard ceiling ${profileHardCeiling ?? 'missing'}。`,
    );
  }
  const used = attempts?.used;
  const reserved = attempts?.reserved;
  if (
    !Number.isInteger(used) ||
    used < 0 ||
    !Number.isInteger(reserved) ||
    reserved < 0
  ) {
    throw new Error('预算增额需要有效的 generation attempt used/reserved 审计。');
  }
  if (imageAttemptLimit < used + reserved) {
    throw new Error(
      `新的图片尝试上限 ${imageAttemptLimit} 低于当前 used ${used} + reserved ${reserved}。`,
    );
  }
  const revisions = Array.isArray(plan.imageBudgetRevisions)
    ? plan.imageBudgetRevisions
    : [];
  const latest = revisions.at(-1);
  if (latest && latest.toLimit !== currentLimit) {
    throw new Error(
      `图片预算修订链与当前上限不一致：latest ${latest.toLimit}, current ${currentLimit}。`,
    );
  }
  const revision = {
    schemaVersion: 1,
    fromLimit: currentLimit,
    toLimit: imageAttemptLimit,
    usedAtApproval: used,
    reservedAtApproval: reserved,
    profileHardCeiling,
    authorizedAt: at,
    humanNote: note,
  };
  const updatedPlan = {
    ...plan,
    approvedImageBudget: {
      ...plan.approvedImageBudget,
      imageAttemptLimit,
      approvedAt: at,
    },
    imageBudgetRevisions: [...revisions, revision],
    updatedAt: at,
  };
  const issues = validateCreativePlan(updatedPlan, {slug: plan.slug});
  if (issues.length > 0) {
    throw new Error(
      `图片预算增额后的 Creative Plan 无效：${issues
        .map(({message}) => message)
        .join('；')}`,
    );
  }
  return {plan: updatedPlan, revision};
};

const isPositiveNumber = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const isPositiveInteger = (value) => Number.isInteger(value) && value > 0;

const isNonNegativeInteger = (value) =>
  Number.isInteger(value) && value >= 0;

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
  if (plan.schemaVersion !== 4) {
    add('plan-schema-version', 'plan.schemaVersion 必须为 4。', 'plan.schemaVersion');
  }
  if (slug && plan.slug !== slug) {
    add('plan-slug', `plan.slug 必须为 ${slug}。`, 'plan.slug');
  }
  if (!['pending', 'resolved'].includes(plan.status)) {
    add('plan-status', 'plan.status 必须为 pending 或 resolved。', 'plan.status');
  }
  if (!PRODUCTION_PROFILES.includes(plan.productionProfile)) {
    add(
      'plan-production-profile',
      `plan.productionProfile 必须是 ${PRODUCTION_PROFILES.join(', ')}。`,
      'plan.productionProfile',
    );
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
  if (plan.approvedImageBudget !== null) {
    const approval = plan.approvedImageBudget;
    if (!approval || typeof approval !== 'object' || Array.isArray(approval)) {
      add(
        'plan-approved-image-budget',
        'approvedImageBudget 必须是对象或 null。',
        'plan.approvedImageBudget',
      );
    } else {
      if (!isNonNegativeInteger(approval.imageAttemptLimit)) {
        add(
          'plan-approved-image-attempt-limit',
          '批准的图片尝试上限必须是非负整数。',
          'plan.approvedImageBudget.imageAttemptLimit',
        );
      }
      if (!isNonNegativeInteger(approval.expectedProviderImageCalls)) {
        add(
          'plan-approved-image-expected-calls',
          '批准记录中的预计图片调用必须是非负整数。',
          'plan.approvedImageBudget.expectedProviderImageCalls',
        );
      }
      if (!isNonNegativeInteger(approval.profileHardCeiling)) {
        add(
          'plan-approved-image-profile-ceiling',
          '批准记录中的 profile hard ceiling 必须是非负整数。',
          'plan.approvedImageBudget.profileHardCeiling',
        );
      }
      if (!isDateTime(approval.approvedAt)) {
        add(
          'plan-approved-image-at',
          '批准记录必须包含有效 approvedAt。',
          'plan.approvedImageBudget.approvedAt',
        );
      }
      if (
        isNonNegativeInteger(approval.imageAttemptLimit) &&
        isNonNegativeInteger(approval.expectedProviderImageCalls) &&
        approval.imageAttemptLimit < approval.expectedProviderImageCalls
      ) {
        add(
          'plan-approved-image-below-expected',
          '批准的图片尝试上限不能低于审批时的预计 provider 图片调用。',
          'plan.approvedImageBudget',
        );
      }
    }
  }

  if (plan.status === 'pending') {
    if (plan.resolved !== null) {
      add('plan-pending-resolution', 'pending 计划的 resolved 必须为 null。', 'plan.resolved');
    }
    if (plan.assetBudget !== null || plan.motionBudget !== null) {
      add('plan-pending-budgets', 'pending 计划的 assetBudget 与 motionBudget 必须为 null。', 'plan');
    }
    if (plan.approvedImageBudget !== null) {
      add(
        'plan-pending-approved-image-budget',
        'pending 计划不能包含已批准图片预算。',
        'plan.approvedImageBudget',
      );
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
  if (!plan.assetBudget || typeof plan.assetBudget !== 'object') {
    add('plan-asset-budget-required', 'resolved 计划必须包含 assetBudget。', 'plan.assetBudget');
  } else {
    let expectedBudget = null;
    try {
      expectedBudget = deriveAssetBudget(
        plan.productionProfile ?? 'balanced',
        resolved.sceneCount,
      );
    } catch {
      // The profile/scene issue is reported separately.
    }
    if (
      expectedBudget &&
      JSON.stringify(plan.assetBudget) !== JSON.stringify(expectedBudget)
    ) {
      add(
        'plan-asset-budget',
        'plan.assetBudget 必须与 productionProfile 和幕数匹配。',
        'plan.assetBudget',
      );
    }
    if (
      plan.approvedImageBudget &&
      expectedBudget &&
      plan.approvedImageBudget.profileHardCeiling !==
        expectedBudget.maxGeneratedImages
    ) {
      add(
        'plan-approved-image-ceiling-drift',
        '批准记录中的 profile hard ceiling 已与当前制作档位漂移；请重新进行概念与预算审批。',
        'plan.approvedImageBudget.profileHardCeiling',
      );
    }
    const budgetRevisions = Array.isArray(plan.imageBudgetRevisions)
      ? plan.imageBudgetRevisions
      : [];
    const latestBudgetRevision = budgetRevisions.at(-1);
    if (
      plan.approvedImageBudget &&
      plan.scenarioBinding &&
      plan.approvedImageBudget.expectedProviderImageCalls !==
        plan.scenarioBinding.expectedProviderImageCalls
    ) {
      add(
        'plan-approved-scenario-budget-drift',
        '批准预算中的 expected calls 必须与人工选择的 scenario 一致。',
        'plan.approvedImageBudget',
      );
    }
    if (
      plan.approvedImageBudget &&
      plan.scenarioBinding &&
      plan.approvedImageBudget.imageAttemptLimit !==
        plan.scenarioBinding.proposedImageAttemptLimit &&
      latestBudgetRevision?.toLimit !==
        plan.approvedImageBudget.imageAttemptLimit
    ) {
      add(
        'plan-approved-scenario-budget-drift',
        '批准预算若高于 scenario proposed cap，必须由连续、可审计的图片预算增额记录解释。',
        'plan.approvedImageBudget',
      );
    }
    if (
      plan.approvedImageBudget &&
      expectedBudget &&
      plan.approvedImageBudget.imageAttemptLimit >
        expectedBudget.maxGeneratedImages
    ) {
      add(
        'plan-approved-image-over-profile',
        '批准的图片尝试上限不能超过当前制作档位 hard ceiling。',
        'plan.approvedImageBudget.imageAttemptLimit',
      );
    }
  }
  if (!plan.motionBudget || typeof plan.motionBudget !== 'object') {
    add('plan-motion-budget-required', 'resolved 计划必须包含 motionBudget。', 'plan.motionBudget');
  } else {
    let baselineBudget = null;
    try {
      baselineBudget = deriveMotionBudget(
        plan.productionProfile ?? 'balanced',
        resolved.sceneCount,
      );
    } catch {
      // The profile/scene issue is reported separately.
    }
    if (
      baselineBudget &&
      !plan.scenarioBinding &&
      JSON.stringify(plan.motionBudget) !== JSON.stringify(baselineBudget)
    ) {
      add(
        'plan-motion-budget',
        'plan.motionBudget 必须与 productionProfile 和幕数匹配。',
        'plan.motionBudget',
      );
    }
    if (baselineBudget && plan.scenarioBinding) {
      for (const key of [
        'maxPoseSheetCalls',
        'maxStatesPerSheet',
        'maxContinuousTargets',
      ]) {
        if (
          !Number.isInteger(plan.motionBudget[key]) ||
          plan.motionBudget[key] < baselineBudget[key]
        ) {
          add(
            'plan-scenario-motion-budget',
            `scenario-bound plan.motionBudget.${key} 不得低于 ${plan.productionProfile} 档位基线 ${baselineBudget[key]}。`,
            `plan.motionBudget.${key}`,
          );
        }
      }
    }
  }
  if (
    plan.storyScope !== undefined &&
    !['concise', 'standard', 'expanded'].includes(plan.storyScope)
  ) {
    add(
      'plan-story-scope',
      'plan.storyScope 必须是 concise、standard 或 expanded。',
      'plan.storyScope',
    );
  }
  if (plan.scenarioBinding !== undefined) {
    const binding = plan.scenarioBinding;
    const expectedScope = {
      draft: 'concise',
      balanced: 'standard',
      'full-depth': 'expanded',
    }[plan.productionProfile];
    if (plan.storyScope !== expectedScope) {
      add(
        'plan-scenario-story-scope',
        `scenario-bound ${plan.productionProfile} 计划的 storyScope 必须为 ${expectedScope}。`,
        'plan.storyScope',
      );
    }
    if (binding.optionId !== plan.productionProfile) {
      add(
        'plan-scenario-profile',
        'scenarioBinding.optionId 必须与 productionProfile 一致。',
        'plan.scenarioBinding.optionId',
      );
    }
    for (const key of ['scenarioSetFingerprint', 'optionFingerprint']) {
      if (!/^[a-f0-9]{64}$/.test(binding[key] ?? '')) {
        add(
          'plan-scenario-fingerprint',
          `scenarioBinding.${key} 必须是 sha256。`,
          `plan.scenarioBinding.${key}`,
        );
      }
    }
    if (!isPositiveInteger(binding.expectedProviderImageCalls)) {
      add(
        'plan-scenario-expected-calls',
        'scenarioBinding.expectedProviderImageCalls 必须是正整数。',
        'plan.scenarioBinding.expectedProviderImageCalls',
      );
    }
    const rootPlanErrors = validateProviderRootPlan(binding.providerRootPlan);
    for (const message of rootPlanErrors) {
      add(
        'plan-scenario-provider-root-plan',
        `scenarioBinding.providerRootPlan ${message}。`,
        'plan.scenarioBinding.providerRootPlan',
      );
    }
    if (
      Array.isArray(binding.providerRootPlan?.roots) &&
      binding.providerRootPlan.roots.length !==
        binding.expectedProviderImageCalls
    ) {
      add(
        'plan-scenario-provider-root-count',
        'providerRootPlan 根资产数量必须与 expectedProviderImageCalls 精确一致。',
        'plan.scenarioBinding.providerRootPlan.roots',
      );
    }
    if (
      !isPositiveInteger(binding.proposedImageAttemptLimit) ||
      binding.proposedImageAttemptLimit < binding.expectedProviderImageCalls ||
      binding.proposedImageAttemptLimit > plan.assetBudget?.maxGeneratedImages
    ) {
      add(
        'plan-scenario-proposed-cap',
        'scenario proposed cap 必须覆盖预计调用且不超过 profile hard ceiling。',
        'plan.scenarioBinding.proposedImageAttemptLimit',
      );
    }
    if (!isDateTime(binding.selectedAt)) {
      add(
        'plan-scenario-selected-at',
        'scenarioBinding.selectedAt 必须是有效时间。',
        'plan.scenarioBinding.selectedAt',
      );
    }
    const promise = plan.profilePromise;
    const promiseKeys = [
      'minRequiredStateFamilies',
      'minEnhancementStateFamilies',
      'minTotalStates',
      'minLocalMotionTargets',
      'minLayeredScenes',
      'minParallaxScenes',
      'minAmbientScenes',
    ];
    if (
      !promise ||
      promiseKeys.some((key) => !isNonNegativeInteger(promise[key]))
    ) {
      add(
        'plan-profile-promise',
        'scenario-bound 计划必须包含完整的非负 profilePromise。',
        'plan.profilePromise',
      );
    }
    const revision = plan.profilePromiseRevision;
    if (revision !== undefined) {
      const immutableKeys = [
        'minRequiredStateFamilies',
        'minEnhancementStateFamilies',
        'minTotalStates',
        'minLayeredScenes',
      ];
      const reducibleKeys = [
        'minLocalMotionTargets',
        'minParallaxScenes',
        'minAmbientScenes',
      ];
      if (
        !revision ||
        typeof revision !== 'object' ||
        !revision.authorizationId ||
        !/^[a-f0-9]{64}$/.test(revision.authorizationFingerprint ?? '') ||
        !Array.isArray(revision.lockedSceneIds) ||
        revision.lockedSceneIds.length < 1 ||
        new Set(revision.lockedSceneIds).size !== revision.lockedSceneIds.length ||
        !Array.isArray(revision.equivalentQualityEvidence) ||
        revision.equivalentQualityEvidence.length < 1 ||
        !isDateTime(revision.decidedAt) ||
        promiseKeys.some(
          (key) =>
            !isNonNegativeInteger(revision.original?.[key]) ||
            !isNonNegativeInteger(revision.recalculated?.[key]),
        ) ||
        immutableKeys.some(
          (key) => revision.recalculated[key] !== revision.original[key],
        ) ||
        reducibleKeys.some(
          (key) => revision.recalculated[key] > revision.original[key],
        ) ||
        JSON.stringify(promise) !== JSON.stringify(revision.recalculated)
      ) {
        add(
          'plan-profile-promise-revision',
          'profilePromiseRevision 必须绑定人工授权、locked-static 镜头、等价质量说明，并且只能下调局部动效/视差/环境动效下限。',
          'plan.profilePromiseRevision',
        );
      }
    }
  } else if (
    plan.storyScope !== undefined ||
    plan.profilePromise !== undefined ||
    plan.profilePromiseRevision !== undefined
  ) {
    add(
      'plan-scenario-fields-without-binding',
      'storyScope 与 profilePromise 只能随 scenarioBinding 一起出现。',
      'plan',
    );
  }
  if (plan.imageBudgetRevisions !== undefined) {
    if (!Array.isArray(plan.imageBudgetRevisions)) {
      add(
        'plan-image-budget-revisions',
        'imageBudgetRevisions 必须是数组。',
        'plan.imageBudgetRevisions',
      );
    } else {
      let expectedFrom =
        plan.scenarioBinding?.proposedImageAttemptLimit ??
        plan.imageBudgetRevisions[0]?.fromLimit ??
        null;
      for (const [index, revision] of plan.imageBudgetRevisions.entries()) {
        const location = `plan.imageBudgetRevisions[${index}]`;
        if (revision?.schemaVersion !== 1) {
          add(
            'plan-image-budget-revision-schema',
            '预算修订必须使用 schemaVersion 1。',
            `${location}.schemaVersion`,
          );
        }
        for (const key of [
          'fromLimit',
          'toLimit',
          'usedAtApproval',
          'reservedAtApproval',
          'profileHardCeiling',
        ]) {
          if (!isNonNegativeInteger(revision?.[key])) {
            add(
              'plan-image-budget-revision-number',
              `${key} 必须是非负整数。`,
              `${location}.${key}`,
            );
          }
        }
        if (
          isNonNegativeInteger(revision?.fromLimit) &&
          isNonNegativeInteger(revision?.toLimit) &&
          revision.toLimit <= revision.fromLimit
        ) {
          add(
            'plan-image-budget-revision-increase',
            '预算修订只能提高图片尝试上限。',
            location,
          );
        }
        if (expectedFrom !== null && revision?.fromLimit !== expectedFrom) {
          add(
            'plan-image-budget-revision-chain',
            `预算修订 fromLimit 应为 ${expectedFrom}。`,
            `${location}.fromLimit`,
          );
        }
        if (
          isNonNegativeInteger(revision?.usedAtApproval) &&
          isNonNegativeInteger(revision?.reservedAtApproval) &&
          isNonNegativeInteger(revision?.fromLimit) &&
          revision.usedAtApproval + revision.reservedAtApproval >
            revision.fromLimit
        ) {
          add(
            'plan-image-budget-revision-usage',
            '预算修订时 used + reserved 不能超过原批准上限。',
            location,
          );
        }
        if (
          revision?.profileHardCeiling !==
            plan.assetBudget?.maxGeneratedImages ||
          revision?.toLimit > revision?.profileHardCeiling
        ) {
          add(
            'plan-image-budget-revision-ceiling',
            '预算修订必须绑定当前 profile hard ceiling 且不得超限。',
            location,
          );
        }
        if (!isDateTime(revision?.authorizedAt)) {
          add(
            'plan-image-budget-revision-at',
            '预算修订必须包含有效 authorizedAt。',
            `${location}.authorizedAt`,
          );
        }
        if (
          typeof revision?.humanNote !== 'string' ||
          !revision.humanNote.trim()
        ) {
          add(
            'plan-image-budget-revision-note',
            '预算修订必须记录人的明确决定。',
            `${location}.humanNote`,
          );
        }
        expectedFrom = revision?.toLimit ?? expectedFrom;
      }
      const latestBudgetRevision = plan.imageBudgetRevisions.at(-1);
      if (
        latestBudgetRevision &&
        plan.approvedImageBudget &&
        expectedFrom !== plan.approvedImageBudget.imageAttemptLimit
      ) {
        add(
          'plan-image-budget-revision-final',
          '预算修订链终点必须等于当前批准图片上限。',
          'plan.imageBudgetRevisions',
        );
      }
      if (
        latestBudgetRevision &&
        plan.approvedImageBudget?.approvedAt !==
          latestBudgetRevision.authorizedAt
      ) {
        add(
          'plan-image-budget-revision-approved-at',
          '当前批准预算时间必须等于最近一次预算增额授权时间。',
          'plan.approvedImageBudget.approvedAt',
        );
      }
    }
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
  productionProfile = 'balanced',
  rationale,
  at = new Date().toISOString(),
}) => {
  const requested = {
    durationSeconds: requestedDurationSeconds,
    sceneCount: requestedSceneCount,
  };
  const plan = {
    schemaVersion: 4,
    slug,
    status: 'resolved',
    inputMode: deriveCreativePlanMode(requested),
    productionProfile,
    requested,
    resolved: {
      durationSeconds,
      sceneCount,
      estimatedNarrationSeconds,
      rationale: rationale?.trim() ?? '',
      resolvedAt: at,
    },
    assetBudget: deriveAssetBudget(productionProfile, sceneCount),
    motionBudget: deriveMotionBudget(productionProfile, sceneCount),
    approvedImageBudget: null,
    updatedAt: at,
  };
  assertCreativePlanReady(plan, {slug});
  return plan;
};

export const resetUnconfirmedCreativePlan = (
  plan,
  {slug = plan?.slug ?? null, at = new Date().toISOString()} = {},
) => {
  if (
    plan?.schemaVersion !== 4 ||
    plan?.status !== 'resolved' ||
    plan?.slug !== slug ||
    !PRODUCTION_PROFILES.includes(plan?.productionProfile)
  ) {
    throw new Error('只能重置同项目、schema v4 的 resolved Creative Plan。');
  }
  if (plan.approvedImageBudget !== null) {
    throw new Error('已批准图片预算的 Creative Plan 不能重置。');
  }
  const pending = {
    schemaVersion: 4,
    slug,
    status: 'pending',
    inputMode: plan.inputMode,
    productionProfile: plan.productionProfile,
    requested: plan.requested,
    resolved: null,
    assetBudget: null,
    motionBudget: null,
    approvedImageBudget: null,
    updatedAt: at,
  };
  const issues = validateCreativePlan(pending, {slug});
  if (issues.length > 0) {
    throw new Error(
      issues.map(({location, message}) => `${location}: ${message}`).join('\n'),
    );
  }
  return pending;
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
  const durationWasExplicit = plan.requested?.durationSeconds != null;
  if (durationWasExplicit) {
    const tolerance = Math.max(
      TIMING_CONTINUITY_THRESHOLDS.explicitDurationToleranceSeconds,
      target.durationSeconds *
        TIMING_CONTINUITY_THRESHOLDS.explicitDurationToleranceRatio,
    );
    const durationDrift = actualDuration - target.durationSeconds;
    if (durationDrift < -tolerance) {
      issues.push({
        level: 'error',
        code: 'duration-content-deficit',
        message: `用户指定 ${target.durationSeconds}s，但实测内容时间线只有 ${actualDuration.toFixed(3)}s；缺少 ${Math.abs(durationDrift).toFixed(3)}s。请增加旁白或有效动作、缩短目标时长，不要用静止尾帧补足。`,
        location: 'plan.resolved.durationSeconds',
      });
    } else if (durationDrift > tolerance) {
      issues.push({
        level: 'error',
        code: 'plan-duration-drift',
        message: `用户指定 ${target.durationSeconds}s，时间线实际 ${actualDuration.toFixed(3)}s；超出 ${tolerance.toFixed(1)}s 的交付容差。`,
        location: 'plan.resolved.durationSeconds',
      });
    }
  }
  return issues;
};
