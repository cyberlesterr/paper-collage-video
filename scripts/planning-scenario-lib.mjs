import {createHash} from 'node:crypto';
import {
  PRODUCTION_PROFILE_DEFINITIONS,
  PRODUCTION_PROFILES,
  buildCreativePlan,
  deriveAssetBudget,
  deriveMotionBudget,
} from './creative-plan-lib.mjs';
import {
  assertIntakeConfirmed,
  intakeDecisionFingerprint,
} from './intake-lib.mjs';
import {buildProviderRootPlan} from './provider-root-plan-lib.mjs';

export const STORY_SCOPE_BY_PROFILE = {
  draft: 'concise',
  balanced: 'standard',
  'full-depth': 'expanded',
};

export const STORY_SCOPE_GUIDANCE = {
  concise: {
    label: '精简叙事',
    durationRangeSeconds: [24, 40],
    sceneRange: [4, 6],
    summary: '保留完整起承转合，合并次要事件，优先把故事讲清楚。',
  },
  standard: {
    label: '标准叙事',
    durationRangeSeconds: [40, 70],
    sceneRange: [6, 10],
    summary: '保留主要转折和角色反应，让关键动作有展开空间。',
  },
  expanded: {
    label: '展开叙事',
    durationRangeSeconds: [60, 120],
    sceneRange: [8, 16],
    summary: '展开角色反应、环境变化和关键动作，服务更丰富的空间与动作设计。',
  },
};

const SOURCE_PACKAGE_COSTS = {
  'single-background': {
    providerCalls: 1,
    localDerivatives: 0,
    avoidedCalls: 0,
  },
  'rigid-master': {
    providerCalls: 1,
    localDerivatives: 0,
    avoidedCalls: 0,
  },
  'registered-layer-sheet': {
    providerCalls: 1,
    localDerivatives: 3,
    avoidedCalls: 3,
  },
  'context-preserving-layer-edits': {
    providerCalls: 4,
    localDerivatives: 3,
    avoidedCalls: 0,
  },
};
const CANONICAL_CONTAINER_SOURCE_STRATEGY =
  'canonical-frame-with-content-sheet';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const isPositive = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;
const isPositiveInteger = (value) => Number.isInteger(value) && value > 0;

export const deriveProfilePromise = ({
  productionProfile,
  sceneCount,
  parallaxPreference = 'auto',
}) => {
  const motionBudget = deriveMotionBudget(productionProfile, sceneCount);
  if (productionProfile === 'draft') {
    return {
      minRequiredStateFamilies: 0,
      minEnhancementStateFamilies: 0,
      minTotalStates: 0,
      minLocalMotionTargets: sceneCount,
      minLayeredScenes: 0,
      minParallaxScenes: 0,
      minAmbientScenes: 0,
    };
  }
  if (productionProfile === 'balanced') {
    const required = Math.min(
      motionBudget.maxPoseSheetCalls,
      Math.max(1, Math.ceil(sceneCount / 3)),
    );
    return {
      minRequiredStateFamilies: required,
      minEnhancementStateFamilies: 0,
      minTotalStates: required * 3,
      minLocalMotionTargets: sceneCount * 2,
      minLayeredScenes: Math.ceil(sceneCount / 2),
      minParallaxScenes:
        parallaxPreference === 'minimal'
          ? 0
          : parallaxPreference === 'prefer'
            ? Math.ceil(sceneCount / 2)
            : Math.ceil(sceneCount / 3),
      minAmbientScenes: Math.ceil(sceneCount / 4),
    };
  }
  const required = Math.min(
    motionBudget.maxPoseSheetCalls,
    Math.max(1, Math.ceil(sceneCount / 2)),
  );
  const enhancement = Math.min(
    motionBudget.maxPoseSheetCalls - required,
    Math.max(1, Math.ceil(sceneCount / 3)),
  );
  return {
    minRequiredStateFamilies: required,
    minEnhancementStateFamilies: enhancement,
    minTotalStates: (required + enhancement) * 4,
    minLocalMotionTargets: sceneCount * 3,
    minLayeredScenes: sceneCount,
    minParallaxScenes:
      parallaxPreference === 'minimal'
        ? 0
        : parallaxPreference === 'prefer'
          ? sceneCount
          : Math.ceil((sceneCount * 2) / 3),
    minAmbientScenes: Math.ceil(sceneCount / 2),
  };
};

const collectStateFamilies = (scenes) => {
  const families = new Map();
  for (const scene of scenes) {
    for (const family of scene.stateFamilies ?? []) {
      const current = families.get(family.id) ?? {
        necessity: family.necessity,
        states: new Set(),
      };
      if (
        current.necessity !== family.necessity &&
        current.necessity !== 'required'
      ) {
        current.necessity = family.necessity;
      }
      for (const state of family.states ?? []) current.states.add(state);
      families.set(family.id, current);
    }
  }
  return families;
};

const collectProviderStateFamilies = (scenes) => {
  const families = collectStateFamilies(scenes);
  const sourceOwnedFamilyIds = new Set(
    scenes.flatMap((scene) =>
      (scene.sourcePackages ?? [])
        .map(({stateFamilyId}) => stateFamilyId)
        .filter(Boolean),
    ),
  );
  for (const familyId of sourceOwnedFamilyIds) families.delete(familyId);
  return families;
};

export const summarizeScenarioFulfillment = (option) => {
  const scenes = option.scenes ?? [];
  const families = collectStateFamilies(scenes);
  const layered = scenes.filter(({layers}) =>
    ['rear', 'mid', 'front', 'near'].filter(
      (key) => (layers?.[key]?.length ?? 0) > 0,
    ).length >= 2,
  ).length;
  return {
    minRequiredStateFamilies: [...families.values()].filter(
      ({necessity}) => necessity === 'required',
    ).length,
    minEnhancementStateFamilies: [...families.values()].filter(
      ({necessity}) => necessity === 'enhancement',
    ).length,
    minTotalStates: [...families.values()].reduce(
      (sum, {states}) => sum + states.size,
      0,
    ),
    minLocalMotionTargets: new Set(
      scenes.flatMap((scene) =>
        (scene.localMotionTargets ?? []).map(
          ({targetId}) => `${scene.id}::${targetId}`,
        ),
      ),
    ).size,
    minLayeredScenes: layered,
    minParallaxScenes: scenes.filter(({parallax}) => parallax).length,
    minAmbientScenes: scenes.filter(
      ({ambientElements}) => (ambientElements ?? []).length > 0,
    ).length,
  };
};

export const assessProfilePromise = (actual, promise) => {
  const issues = [];
  for (const [key, minimum] of Object.entries(promise)) {
    if ((actual[key] ?? 0) < minimum) {
      issues.push(`${key}: planned ${actual[key] ?? 0}, required ${minimum}`);
    }
  }
  return {...actual, passed: issues.length === 0, issues};
};

const validateCommonStory = (story) => {
  if (!story || typeof story !== 'object' || Array.isArray(story)) {
    throw new Error('commonStory 必须是对象。');
  }
  for (const key of ['logline', 'audience', 'theme', 'ending']) {
    if (typeof story[key] !== 'string' || !story[key].trim()) {
      throw new Error(`commonStory.${key} 必须为非空字符串。`);
    }
  }
  if (!Array.isArray(story.beats) || story.beats.length < 3) {
    throw new Error('commonStory.beats 至少需要三个共同故事节拍。');
  }
  if (!Array.isArray(story.semanticActions) || story.semanticActions.length < 1) {
    throw new Error('commonStory.semanticActions 至少需要一个必须被画面执行的关键动作。');
  }
  const ids = new Set();
  for (const [index, action] of story.semanticActions.entries()) {
    if (
      !action ||
      typeof action !== 'object' ||
      typeof action.id !== 'string' ||
      !action.id.trim() ||
      ids.has(action.id)
    ) {
      throw new Error(`commonStory.semanticActions[${index}].id 缺失或重复。`);
    }
    if (typeof action.summary !== 'string' || !action.summary.trim()) {
      throw new Error(`commonStory.semanticActions[${index}].summary 必须说明可见结果。`);
    }
    if (!['registered-state', 'local-motion', 'layer-package'].includes(action.requiredExecution)) {
      throw new Error(`commonStory.semanticActions[${index}].requiredExecution 无效。`);
    }
    ids.add(action.id);
  }
};

const compileSemanticActionCoverage = ({option, semanticActions}) => {
  const supplied = option.semanticActionCoverage;
  if (!Array.isArray(supplied) || supplied.length !== semanticActions.length) {
    throw new Error(
      `${option.id}.semanticActionCoverage 必须逐一覆盖全部 ${semanticActions.length} 个共同故事关键动作。`,
    );
  }
  const actionById = new Map(semanticActions.map((action) => [action.id, action]));
  const seen = new Set();
  for (const [index, coverage] of supplied.entries()) {
    const action = actionById.get(coverage?.actionId);
    if (!action || seen.has(coverage.actionId)) {
      throw new Error(`${option.id}.semanticActionCoverage[${index}] 引用了未知或重复的 actionId。`);
    }
    if (coverage.execution !== action.requiredExecution) {
      throw new Error(
        `${option.id}.${coverage.actionId} 必须使用 ${action.requiredExecution}，不得用 ${coverage.execution ?? 'missing'} 替代。`,
      );
    }
    const scene = option.scenes.find(({id}) => id === coverage.sceneId);
    if (!scene) {
      throw new Error(`${option.id}.${coverage.actionId} 必须绑定当前 scenario 的 sceneId。`);
    }
    if (typeof coverage.targetId !== 'string' || !coverage.targetId.trim()) {
      throw new Error(`${option.id}.${coverage.actionId}.targetId 不能为空。`);
    }
    if (typeof coverage.visibleResult !== 'string' || !coverage.visibleResult.trim()) {
      throw new Error(`${option.id}.${coverage.actionId}.visibleResult 必须说明观众实际看见什么。`);
    }
    if (coverage.execution === 'registered-state') {
      const family = scene.stateFamilies?.find(
        ({id}) => id === coverage.stateRef?.poseFamilyId,
      );
      if (!family || !family.states?.includes(coverage.stateRef?.stateId)) {
        throw new Error(
          `${option.id}.${coverage.actionId} 必须绑定 ${coverage.sceneId} 中真实规划的 poseFamilyId/stateId。`,
        );
      }
    } else if (coverage.execution === 'local-motion') {
      if (
        !scene.localMotionTargets?.some(
          ({targetId}) => targetId === coverage.localMotionTargetId,
        )
      ) {
        throw new Error(
          `${option.id}.${coverage.actionId} 必须绑定 ${coverage.sceneId} 中真实规划的 localMotionTargetId。`,
        );
      }
    } else if (
      !scene.sourcePackages?.some(({id}) => id === coverage.sourcePackageId)
    ) {
      throw new Error(
        `${option.id}.${coverage.actionId} 必须绑定 ${coverage.sceneId} 中真实规划的 sourcePackageId。`,
      );
    }
    seen.add(coverage.actionId);
  }
  return supplied.map((coverage) => ({
    ...coverage,
    visibleResult: coverage.visibleResult.trim(),
  }));
};

const compileProviderEstimate = (option, assetBudget) => {
  const allFamilies = collectStateFamilies(option.scenes);
  const families = collectProviderStateFamilies(option.scenes);
  const sourcePackages = option.scenes.flatMap(
    ({sourcePackages}) => sourcePackages ?? [],
  );
  for (const source of sourcePackages) {
    let expected = SOURCE_PACKAGE_COSTS[source.strategy];
    if (source.strategy === CANONICAL_CONTAINER_SOURCE_STRATEGY) {
      const family = allFamilies.get(source.stateFamilyId);
      if (!family) {
        throw new Error(
          `${option.id}.${source.id}.stateFamilyId 必须绑定当前 scenario 中真实规划的状态家族。`,
        );
      }
      expected = {
        providerCalls: 3,
        localDerivatives: family.states.size + 1,
        avoidedCalls: Math.max(1, family.states.size - 1),
      };
    }
    if (!expected) {
      throw new Error(
        `${option.id}.${source.id}.strategy 必须是 ${[
          ...Object.keys(SOURCE_PACKAGE_COSTS),
          CANONICAL_CONTAINER_SOURCE_STRATEGY,
        ].join('、')}。`,
      );
    }
    for (const key of ['providerCalls', 'localDerivatives', 'avoidedCalls']) {
      if (source[key] !== expected[key]) {
        throw new Error(
          `${option.id}.${source.id}.${key} 必须与 ${source.strategy} 成本合同一致：expected ${expected[key]}, received ${source[key] ?? 'missing'}。`,
        );
      }
    }
  }
  const sourcePackageProviderCalls = sourcePackages.reduce(
    (sum, source) => sum + source.providerCalls,
    0,
  );
  const poseSheetProviderCalls = families.size;
  const styleProofProviderCalls = 1;
  const expectedImageCalls =
    styleProofProviderCalls +
    sourcePackageProviderCalls +
    poseSheetProviderCalls;
  const proposedImageAttemptLimit = option.proposedImageAttemptLimit;
  if (
    !Number.isInteger(proposedImageAttemptLimit) ||
    proposedImageAttemptLimit < expectedImageCalls
  ) {
    throw new Error(
      `${option.id}.proposedImageAttemptLimit 必须覆盖预计 ${expectedImageCalls} 次图片调用。`,
    );
  }
  if (proposedImageAttemptLimit > assetBudget.maxGeneratedImages) {
    throw new Error(
      `${option.id}.proposedImageAttemptLimit ${proposedImageAttemptLimit} 超过 profile hard ceiling ${assetBudget.maxGeneratedImages}。`,
    );
  }
  const recommendation = option.providerRecommendation;
  for (const capability of ['text', 'image', 'voice']) {
    if (typeof recommendation?.[capability] !== 'string' || !recommendation[capability].trim()) {
      throw new Error(`${option.id}.providerRecommendation.${capability} 必须为非空字符串。`);
    }
  }
  if (typeof option.costNote !== 'string' || !option.costNote.trim()) {
    throw new Error(`${option.id}.costNote 必须说明成本依据或待确认报价。`);
  }
  return {
    styleProofProviderCalls,
    sourcePackageProviderCalls,
    poseSheetProviderCalls,
    expectedImageCalls,
    proposedImageAttemptLimit,
    hardCeiling: assetBudget.maxGeneratedImages,
    localDerivatives: sourcePackages.reduce(
      (sum, source) => sum + source.localDerivatives,
      0,
    ),
    avoidedCalls:
      sourcePackages.reduce((sum, source) => sum + source.avoidedCalls, 0) +
      [...families.values()].reduce(
        (sum, family) => sum + Math.max(0, family.states.size - 1),
        0,
      ),
    recommendation,
    costNote: option.costNote.trim(),
  };
};

const compileOption = ({
  option,
  requested,
  intake,
  semanticActions,
}) => {
  if (!PRODUCTION_PROFILES.includes(option.id)) {
    throw new Error(`scenario id 必须是 ${PRODUCTION_PROFILES.join(', ')}。`);
  }
  const expectedScope = STORY_SCOPE_BY_PROFILE[option.id];
  if (option.storyScope !== expectedScope) {
    throw new Error(`${option.id}.storyScope 必须为 ${expectedScope}。`);
  }
  if (!isPositive(option.durationSeconds)) {
    throw new Error(`${option.id}.durationSeconds 必须为正数。`);
  }
  if (!isPositiveInteger(option.sceneCount)) {
    throw new Error(`${option.id}.sceneCount 必须为正整数。`);
  }
  if (
    !Array.isArray(option.scenes) ||
    option.scenes.length !== option.sceneCount
  ) {
    throw new Error(`${option.id}.scenes 数量必须等于 sceneCount。`);
  }
  if (
    !isPositive(option.estimatedNarrationSeconds) ||
    option.estimatedNarrationSeconds > option.durationSeconds
  ) {
    throw new Error(`${option.id}.estimatedNarrationSeconds 必须为正数且不超过成片时长。`);
  }
  if (requested.durationSeconds !== null && option.durationSeconds !== requested.durationSeconds) {
    throw new Error(`${option.id} 不得改写用户指定时长 ${requested.durationSeconds}s。`);
  }
  if (requested.sceneCount !== null && option.sceneCount !== requested.sceneCount) {
    throw new Error(`${option.id} 不得改写用户指定幕数 ${requested.sceneCount}。`);
  }
  const assetBudget = deriveAssetBudget(option.id, option.sceneCount);
  const profilePromise = deriveProfilePromise({
    productionProfile: option.id,
    sceneCount: option.sceneCount,
    parallaxPreference: intake.parallaxPreference,
  });
  const plannedFulfillment = assessProfilePromise(
    summarizeScenarioFulfillment(option),
    profilePromise,
  );
  if (!plannedFulfillment.passed) {
    throw new Error(
      `${option.id} scenario 未履行档位承诺：${plannedFulfillment.issues.join('；')}。`,
    );
  }
  const semanticActionCoverage = compileSemanticActionCoverage({
    option,
    semanticActions,
  });
  const providerEstimate = compileProviderEstimate(option, assetBudget);
  if (
    !Array.isArray(option.factsAndRightsRisks) ||
    option.factsAndRightsRisks.some(
      (risk) => typeof risk !== 'string' || !risk.trim(),
    )
  ) {
    throw new Error(`${option.id}.factsAndRightsRisks 必须是字符串数组。`);
  }
  const compiled = {
    id: option.id,
    label: PRODUCTION_PROFILE_DEFINITIONS[option.id].label,
    storyScope: option.storyScope,
    durationSeconds: option.durationSeconds,
    sceneCount: option.sceneCount,
    estimatedNarrationSeconds: option.estimatedNarrationSeconds,
    rationale: String(option.rationale ?? '').trim(),
    scenes: option.scenes,
    semanticActionCoverage,
    profilePromise,
    plannedFulfillment,
    providerEstimate,
    factsAndRightsRisks: option.factsAndRightsRisks.map((risk) => risk.trim()),
    finalEffect: String(option.finalEffect ?? '').trim(),
  };
  for (const key of ['rationale', 'finalEffect']) {
    if (!compiled[key]) throw new Error(`${option.id}.${key} 必须为非空字符串。`);
  }
  return {...compiled, fingerprint: sha256(JSON.stringify(compiled))};
};

export const buildPlanningScenarios = ({
  slug,
  intake,
  input,
  at = new Date().toISOString(),
}) => {
  assertIntakeConfirmed(intake);
  validateCommonStory(input.commonStory);
  const requested = {
    durationSeconds: input.requested?.durationSeconds ?? null,
    sceneCount: input.requested?.sceneCount ?? null,
  };
  if (
    requested.durationSeconds !== null &&
    !isPositive(requested.durationSeconds)
  ) {
    throw new Error('requested.durationSeconds 必须为正数或 null。');
  }
  if (
    requested.sceneCount !== null &&
    !isPositiveInteger(requested.sceneCount)
  ) {
    throw new Error('requested.sceneCount 必须为正整数或 null。');
  }
  if (!Array.isArray(input.options) || input.options.length !== 3) {
    throw new Error('必须提供 draft、balanced、full-depth 三个 scenario。');
  }
  const suppliedIds = input.options.map(({id}) => id).sort();
  if (JSON.stringify(suppliedIds) !== JSON.stringify([...PRODUCTION_PROFILES].sort())) {
    throw new Error('三个 scenario 必须分别对应 draft、balanced、full-depth。');
  }
  const options = PRODUCTION_PROFILES.map((id) =>
    compileOption({
      option: input.options.find((candidate) => candidate.id === id),
      requested,
      intake,
      semanticActions: input.commonStory.semanticActions,
    }),
  );
  const stable = {
    schemaVersion: 1,
    slug,
    status: 'ready',
    intakeFingerprint: intakeDecisionFingerprint(intake),
    styleProfileBinding: {
      id: intake.visualStylePreset,
      catalogVersion: intake.styleCatalogVersion,
      profileFingerprint: intake.styleProfileFingerprint,
    },
    requested,
    commonStory: input.commonStory,
    options,
  };
  return {
    $schema: '../../schemas/planning-scenarios.schema.json',
    ...stable,
    fingerprint: sha256(JSON.stringify(stable)),
    updatedAt: at,
  };
};

export const assertPlanningScenariosReady = (
  scenarios,
  {slug, intake} = {},
) => {
  if (scenarios?.schemaVersion !== 1 || scenarios?.status !== 'ready') {
    throw new Error('planning-scenarios.json 尚未 ready。');
  }
  if (slug && scenarios.slug !== slug) {
    throw new Error(`planning scenarios slug 必须为 ${slug}。`);
  }
  if (
    intake &&
    scenarios.intakeFingerprint !== intakeDecisionFingerprint(assertIntakeConfirmed(intake))
  ) {
    throw new Error('planning scenarios 与当前 intake 不一致；请重新规划。');
  }
  const rebuilt = buildPlanningScenarios({
    slug: scenarios.slug,
    intake,
    input: {
      requested: scenarios.requested,
      commonStory: scenarios.commonStory,
      options: scenarios.options.map((option) => ({
        ...option,
        proposedImageAttemptLimit:
          option.providerEstimate.proposedImageAttemptLimit,
        providerRecommendation: option.providerEstimate.recommendation,
        costNote: option.providerEstimate.costNote,
        profilePromise: undefined,
        plannedFulfillment: undefined,
        providerEstimate: undefined,
        fingerprint: undefined,
      })),
    },
    at: scenarios.updatedAt,
  });
  if (
    scenarios.fingerprint !== rebuilt.fingerprint ||
    JSON.stringify(scenarios.options) !== JSON.stringify(rebuilt.options)
  ) {
    throw new Error('planning scenarios fingerprint 已漂移。');
  }
  return scenarios;
};

export const scenarioDecisionFor = (scenarios, optionId) => {
  const option = scenarios.options.find(({id}) => id === optionId);
  if (!option) throw new Error(`未知 scenario：${optionId}。`);
  const providerRootPlan = buildProviderRootPlan(option);
  return {
    scenarioSetFingerprint: scenarios.fingerprint,
    optionId: option.id,
    optionFingerprint: option.fingerprint,
    storyScope: option.storyScope,
    durationSeconds: option.durationSeconds,
    sceneCount: option.sceneCount,
    expectedProviderImageCalls: option.providerEstimate.expectedImageCalls,
    providerRootPlanFingerprint: providerRootPlan.fingerprint,
    proposedImageAttemptLimit:
      option.providerEstimate.proposedImageAttemptLimit,
    profileHardCeiling: option.providerEstimate.hardCeiling,
  };
};

export const assertScenarioDecision = (decision, scenarios, optionId) => {
  const expected = scenarioDecisionFor(scenarios, optionId);
  if (JSON.stringify(decision) !== JSON.stringify(expected)) {
    throw new Error('scenarioDecision 必须与当前三档规划及所选档位完全一致。');
  }
  return expected;
};

export const assertStoryboardMatchesScenario = (
  option,
  directingSummary,
) => {
  const scenarioFamilies = collectProviderStateFamilies(option.scenes);
  const compiledFamilies = new Map(
    (directingSummary?.poseSheetPlans ?? []).map((family) => [
      family.poseFamilyId,
      family,
    ]),
  );
  const compiledCanonicalFamilies = new Map(
    (directingSummary?.generationBudget?.sourcePackagePlans ?? [])
      .filter(({pattern}) => pattern === 'canonical-container')
      .map((plan) => [
        plan.familyId,
        {stateIds: (plan.states ?? []).map(({id}) => id)},
      ]),
  );
  if (
    scenarioFamilies.size !== compiledFamilies.size ||
    [...scenarioFamilies.entries()].some(([id, family]) => {
      const compiled = compiledFamilies.get(id);
      return (
        !compiled ||
        compiled.necessity !== family.necessity ||
        JSON.stringify([...family.states].sort()) !==
          JSON.stringify([...compiled.stateIds].sort())
      );
    })
  ) {
    throw new Error(
      'storyboard 的姿态母版家族、必要性或状态清单与用户批准的 scenario 卡不一致。',
    );
  }
  for (const coverage of option.semanticActionCoverage ?? []) {
    if (coverage.execution !== 'registered-state') continue;
    const family =
      compiledFamilies.get(coverage.stateRef.poseFamilyId) ??
      compiledCanonicalFamilies.get(coverage.stateRef.poseFamilyId);
    if (!family?.stateIds?.includes(coverage.stateRef.stateId)) {
      throw new Error(
        `storyboard 未执行批准的关键动作 ${coverage.actionId}：缺少 ${coverage.stateRef.poseFamilyId}/${coverage.stateRef.stateId}。`,
      );
    }
  }
  const scenarioSources = new Map(
    option.scenes.flatMap((scene) =>
      scene.sourcePackages.map((source) => [source.id, source]),
    ),
  );
  const compiledSources = new Map(
    (directingSummary?.generationBudget?.sourcePackagePlans ?? []).map(
      (source) => [source.id, source],
    ),
  );
  const requiredScenarioSources = [...scenarioSources.values()].filter(
    ({strategy}) => strategy !== 'single-background',
  );
  if (
    requiredScenarioSources.length !== compiledSources.size ||
    requiredScenarioSources.some((source) => {
      const compiled = compiledSources.get(source.id);
      return (
        !compiled ||
        compiled.sourceStrategy !== source.strategy ||
        compiled.providerImageCalls !== source.providerCalls ||
        compiled.localDerivatives !== source.localDerivatives ||
        compiled.avoidedCalls !== source.avoidedCalls
      );
    })
  ) {
    throw new Error(
      'storyboard 的分层 source packages 与用户批准的 scenario 卡不一致。',
    );
  }
  const structuralCalls =
    (directingSummary?.generationBudget?.expectedProviderImageCalls ?? 0);
  const singleBackgroundCalls = [...scenarioSources.values()]
    .filter(({strategy}) => strategy === 'single-background')
    .reduce((total, source) => total + source.providerCalls, 0);
  const completeExpectedCalls =
    structuralCalls + singleBackgroundCalls + 1;
  if (completeExpectedCalls !== option.providerEstimate.expectedImageCalls) {
    throw new Error(
      `storyboard 结构化素材、single-background 与风格样张合计必须精确为 ` +
        `${option.providerEstimate.expectedImageCalls} 次图片调用，当前为 ${completeExpectedCalls} 次。`,
    );
  }
  return {
    poseFamilyCount: compiledFamilies.size,
    sourcePackageCount: compiledSources.size,
    structuralProviderImageCalls: structuralCalls,
  };
};

export const buildCreativePlanFromScenario = ({
  slug,
  scenarios,
  optionId,
  at = new Date().toISOString(),
}) => {
  const option = scenarios.options.find(({id}) => id === optionId);
  if (!option) throw new Error(`未知 scenario：${optionId}。`);
  const base = buildCreativePlan({
    slug,
    requestedDurationSeconds: scenarios.requested.durationSeconds,
    requestedSceneCount: scenarios.requested.sceneCount,
    durationSeconds: option.durationSeconds,
    sceneCount: option.sceneCount,
    estimatedNarrationSeconds: option.estimatedNarrationSeconds,
    productionProfile: option.id,
    rationale: option.rationale,
    at,
  });
  const families = collectProviderStateFamilies(option.scenes);
  const fulfillment = summarizeScenarioFulfillment(option);
  const providerRootPlan = buildProviderRootPlan(option);
  if (
    providerRootPlan.roots.length !==
    option.providerEstimate.expectedImageCalls
  ) {
    throw new Error(
      `scenario provider 根资产计划为 ${providerRootPlan.roots.length} 个，` +
        `但预计调用为 ${option.providerEstimate.expectedImageCalls} 次。`,
    );
  }
  const scenarioMotionBudget = {
    maxPoseSheetCalls: Math.max(
      base.motionBudget.maxPoseSheetCalls,
      families.size,
    ),
    maxStatesPerSheet: Math.max(
      base.motionBudget.maxStatesPerSheet,
      ...[...families.values()].map(({states}) => states.size),
    ),
    maxContinuousTargets: Math.max(
      base.motionBudget.maxContinuousTargets,
      fulfillment.minLocalMotionTargets,
    ),
  };
  return {
    ...base,
    // The generic profile budget is a scene-count heuristic. The human-selected
    // scenario is the exact semantic contract and may legitimately contain more
    // independently animated identities or motion targets inside one long shot.
    // Its total provider demand is still bounded by providerEstimate and the
    // profile hard ceiling below.
    motionBudget: scenarioMotionBudget,
    storyScope: option.storyScope,
    scenarioBinding: {
      scenarioSetFingerprint: scenarios.fingerprint,
      optionId: option.id,
      optionFingerprint: option.fingerprint,
      expectedProviderImageCalls: option.providerEstimate.expectedImageCalls,
      proposedImageAttemptLimit:
        option.providerEstimate.proposedImageAttemptLimit,
      providerRootPlan,
      selectedAt: at,
    },
    profilePromise: option.profilePromise,
  };
};
