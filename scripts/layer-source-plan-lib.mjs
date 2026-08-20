import {stableStringify} from './contract-utils.mjs';
import {
  LAYER_SOURCE_STRATEGIES,
  STRATEGY_COSTS,
} from './production-vocabulary.mjs';

const sameValue = (left, right) =>
  stableStringify(left ?? null) === stableStringify(right ?? null);

export {LAYER_SOURCE_STRATEGIES};

export const LAYER_ROLES = [
  'support-rear',
  'subject',
  'support-front',
];

export const LAYER_COMPLETENESS = {
  'support-rear': 'clean-plate',
  subject: 'full-silhouette',
  'support-front': 'full-overlay',
};

export const LAYER_MOTION_CAPABILITIES = [
  'rigid-locked',
  'bounded-relative',
];

export const RESPONSIVE_LAYER_PROFILES = ['16:9', '9:16', '1:1'];

const finite = (value) =>
  typeof value === 'number' && Number.isFinite(value);

const nonEmpty = (value) =>
  typeof value === 'string' && value.trim().length > 0;

const addIssue = (issues, code, message, location) =>
  issues.push({code, message, location});

const validateRevealEnvelope = (envelope, {issues, location}) => {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    addIssue(
      issues,
      'layer-reveal-envelope-required',
      'bounded-relative 分层必须声明 16:9、9:16、1:1 revealEnvelope。',
      location,
    );
    return;
  }
  for (const profile of RESPONSIVE_LAYER_PROFILES) {
    const value = envelope[profile];
    const valueLocation = `${location}.${profile}`;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      addIssue(
        issues,
        'layer-reveal-profile-required',
        `revealEnvelope 缺少 ${profile}。`,
        valueLocation,
      );
      continue;
    }
    for (const key of ['x', 'y', 'scale', 'rotationDegrees']) {
      if (!finite(value[key]) || value[key] < 0) {
        addIssue(
          issues,
          'layer-reveal-value',
          `${profile}.${key} 必须是非负有限数。`,
          `${valueLocation}.${key}`,
        );
      }
    }
    if (finite(value.x) && value.x > 0.25) {
      addIssue(
        issues,
        'layer-reveal-x',
        `${profile}.x 不得超过画布宽度的 0.25。`,
        `${valueLocation}.x`,
      );
    }
    if (finite(value.y) && value.y > 0.25) {
      addIssue(
        issues,
        'layer-reveal-y',
        `${profile}.y 不得超过画布高度的 0.25。`,
        `${valueLocation}.y`,
      );
    }
    if (finite(value.scale) && value.scale > 0.25) {
      addIssue(
        issues,
        'layer-reveal-scale',
        `${profile}.scale 不得超过 0.25。`,
        `${valueLocation}.scale`,
      );
    }
    if (
      finite(value.rotationDegrees) &&
      value.rotationDegrees > 15
    ) {
      addIssue(
        issues,
        'layer-reveal-rotation',
        `${profile}.rotationDegrees 不得超过 15。`,
        `${valueLocation}.rotationDegrees`,
      );
    }
  }
  for (const key of Object.keys(envelope)) {
    if (!RESPONSIVE_LAYER_PROFILES.includes(key)) {
      addIssue(
        issues,
        'layer-reveal-profile-unknown',
        `未知 revealEnvelope 画幅：${key}。`,
        `${location}.${key}`,
      );
    }
  }
};

const validateSubjectTravelEnvelope = (envelope, {issues, location}) => {
  const maxima = {
    x: 0.75,
    y: 0.5,
    scale: 0.5,
    rotationDegrees: 30,
  };
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    addIssue(
      issues,
      'subject-travel-envelope-required',
      '主体大航迹必须声明 16:9、9:16、1:1 subjectTravelEnvelope。',
      location,
    );
    return;
  }
  for (const profile of RESPONSIVE_LAYER_PROFILES) {
    const value = envelope[profile];
    const valueLocation = `${location}.${profile}`;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      addIssue(
        issues,
        'subject-travel-profile-required',
        `subjectTravelEnvelope 缺少 ${profile}。`,
        valueLocation,
      );
      continue;
    }
    for (const [key, maximum] of Object.entries(maxima)) {
      if (
        !finite(value[key]) ||
        value[key] < 0 ||
        value[key] > maximum
      ) {
        addIssue(
          issues,
          'subject-travel-value',
          `${profile}.${key} 必须位于 0..${maximum}。`,
          `${valueLocation}.${key}`,
        );
      }
    }
  }
  for (const key of Object.keys(envelope)) {
    if (!RESPONSIVE_LAYER_PROFILES.includes(key)) {
      addIssue(
        issues,
        'subject-travel-profile-unknown',
        `未知 subjectTravelEnvelope 画幅：${key}。`,
        `${location}.${key}`,
      );
    }
  }
};

const validateLayers = (layers, {issues, location}) => {
  if (!Array.isArray(layers) || layers.length !== 3) {
    addIssue(
      issues,
      'layer-members-required',
      '分层拓扑必须恰好声明 support-rear、subject、support-front 三个成员。',
      location,
    );
    return;
  }
  const roles = new Set();
  const ids = new Set();
  for (const [index, layer] of layers.entries()) {
    const layerLocation = `${location}[${index}]`;
    if (!nonEmpty(layer?.id) || ids.has(layer.id)) {
      addIssue(
        issues,
        'layer-id',
        'layer.id 必须非空且在家族内唯一。',
        `${layerLocation}.id`,
      );
    }
    ids.add(layer?.id);
    if (!LAYER_ROLES.includes(layer?.role) || roles.has(layer.role)) {
      addIssue(
        issues,
        'layer-role',
        'layer.role 必须是唯一的 support-rear、subject 或 support-front。',
        `${layerLocation}.role`,
      );
    }
    roles.add(layer?.role);
    const expectedCompleteness = LAYER_COMPLETENESS[layer?.role];
    if (layer?.completeness !== expectedCompleteness) {
      addIssue(
        issues,
        'layer-completeness',
        `${layer?.role ?? 'unknown'} 必须声明 completeness=${expectedCompleteness ?? '对应角色完整性'}。`,
        `${layerLocation}.completeness`,
      );
    }
    if (!finite(layer?.depth) || layer.depth < -1 || layer.depth > 1) {
      addIssue(
        issues,
        'layer-depth',
        'layer.depth 必须位于 -1..1。',
        `${layerLocation}.depth`,
      );
    }
  }
  const ordered = LAYER_ROLES.map((role) =>
    layers.find((layer) => layer?.role === role),
  );
  if (
    ordered.every((layer) => finite(layer?.depth)) &&
    !(
      ordered[0].depth < ordered[1].depth &&
      ordered[1].depth < ordered[2].depth
    )
  ) {
    addIssue(
      issues,
      'layer-depth-order',
      'depth 必须严格满足 support-rear < subject < support-front。',
      location,
    );
  }
};

export const validateLayerCompositionIntent = (
  composition,
  {location = 'composition'} = {},
) => {
  const issues = [];
  const pattern = composition?.pattern;
  const capability = composition?.motionCapability;
  const strategy = composition?.sourceStrategy;
  const layerAware =
    pattern === 'registered-depth-stack' ||
    capability !== undefined ||
    strategy !== undefined ||
    composition?.sourcePackageId !== undefined ||
    composition?.layers !== undefined ||
    composition?.revealEnvelope !== undefined ||
    composition?.subjectTravelEnvelope !== undefined;
  if (!layerAware) return issues;

  if (
    !['supported-subject', 'registered-depth-stack'].includes(pattern)
  ) {
    addIssue(
      issues,
      'layer-pattern',
      '分层资产拓扑只能用于 supported-subject 或 registered-depth-stack。',
      `${location}.pattern`,
    );
    return issues;
  }
  if (!LAYER_MOTION_CAPABILITIES.includes(capability)) {
    addIssue(
      issues,
      'layer-motion-capability',
      `motionCapability 必须是 ${LAYER_MOTION_CAPABILITIES.join(' 或 ')}。`,
      `${location}.motionCapability`,
    );
  }
  if (!LAYER_SOURCE_STRATEGIES.includes(strategy)) {
    addIssue(
      issues,
      'layer-source-strategy',
      `sourceStrategy 必须是 ${LAYER_SOURCE_STRATEGIES.join('、')}。`,
      `${location}.sourceStrategy`,
    );
  }
  if (!nonEmpty(composition?.sourcePackageId)) {
    addIssue(
      issues,
      'layer-source-package-id',
      '分层资产拓扑必须声明稳定的 sourcePackageId。',
      `${location}.sourcePackageId`,
    );
  }
  if (
    pattern === 'registered-depth-stack' &&
    capability !== 'bounded-relative'
  ) {
    addIssue(
      issues,
      'layer-depth-stack-capability',
      'registered-depth-stack 必须使用 bounded-relative。',
      `${location}.motionCapability`,
    );
  }
  if (
    capability === 'rigid-locked' &&
    strategy !== 'rigid-master'
  ) {
    addIssue(
      issues,
      'layer-rigid-strategy',
      'rigid-locked 必须使用 rigid-master。',
      `${location}.sourceStrategy`,
    );
  }
  if (
    capability === 'bounded-relative' &&
    strategy === 'rigid-master'
  ) {
    addIssue(
      issues,
      'layer-relative-flat-source',
      'bounded-relative 禁止使用 opaque flat rigid-master。',
      `${location}.sourceStrategy`,
    );
  }
  if (capability === 'bounded-relative') {
    validateLayers(composition?.layers, {
      issues,
      location: `${location}.layers`,
    });
    validateRevealEnvelope(composition?.revealEnvelope, {
      issues,
      location: `${location}.revealEnvelope`,
    });
    if (composition?.subjectTravelEnvelope !== undefined) {
      if (pattern !== 'registered-depth-stack') {
        addIssue(
          issues,
          'subject-travel-pattern',
          'subjectTravelEnvelope 只适用于 registered-depth-stack。',
          `${location}.subjectTravelEnvelope`,
        );
      } else {
        validateSubjectTravelEnvelope(composition.subjectTravelEnvelope, {
          issues,
          location: `${location}.subjectTravelEnvelope`,
        });
      }
    }
  } else {
    for (const key of ['layers', 'revealEnvelope', 'subjectTravelEnvelope']) {
      if (composition?.[key] !== undefined) {
        addIssue(
          issues,
          'layer-rigid-extra',
          `rigid-locked 不得声明 ${key}；它不承诺成员级可揭示内容。`,
          `${location}.${key}`,
        );
      }
    }
  }
  return issues;
};

const normalizedEnvelope = (value) =>
  Object.fromEntries(
    RESPONSIVE_LAYER_PROFILES.map((profile) => [
      profile,
      {
        x: value[profile].x,
        y: value[profile].y,
        scale: value[profile].scale,
        rotationDegrees: value[profile].rotationDegrees,
      },
    ]),
  );

export const compileLayerStackPlan = ({
  sceneId,
  treatment,
}) => {
  const composition = treatment.composition;
  if (composition.motionCapability === undefined) return null;
  const costs = STRATEGY_COSTS[composition.sourceStrategy];
  const layers =
    composition.motionCapability === 'bounded-relative'
      ? LAYER_ROLES.map((role) => {
          const layer = composition.layers.find(
            (candidate) => candidate.role === role,
          );
          return {
            id: layer.id,
            role,
            completeness: layer.completeness,
            depth: layer.depth,
          };
        })
      : [];
  return {
    id: composition.sourcePackageId,
    treatmentId: treatment.id,
    sceneId,
    targetId: treatment.targetId,
    pattern: composition.pattern,
    motionCapability: composition.motionCapability,
    sourceStrategy: composition.sourceStrategy,
    layers,
    revealEnvelope:
      composition.motionCapability === 'bounded-relative'
        ? normalizedEnvelope(composition.revealEnvelope)
        : null,
    subjectTravelEnvelope:
      composition.motionCapability === 'bounded-relative' &&
      composition.subjectTravelEnvelope
        ? normalizedEnvelope(composition.subjectTravelEnvelope)
        : null,
    providerImageCalls: costs.providerCalls,
    localDerivatives: costs.localDerivatives,
    avoidedCalls: costs.avoidedCalls,
    proofTimeId: treatment.proofTimeId ?? null,
  };
};

export const summarizeLayerSourcePackages = (
  scenes,
  {
    poseSheetCalls = 0,
    hardCeiling = null,
    additionalPlans = [],
  } = {},
) => {
  const plans = [
    ...scenes.flatMap(
      (scene) => scene.compositionPlan?.layerStacks ?? [],
    ),
    ...additionalPlans,
  ]
    .sort(
      (left, right) =>
        left.sceneId.localeCompare(right.sceneId) ||
        left.targetId.localeCompare(right.targetId),
    );
  const sourcePackageCalls = plans.reduce(
    (sum, plan) => sum + plan.providerImageCalls,
    0,
  );
  const requiredProviderImageCalls =
    sourcePackageCalls + poseSheetCalls;
  return {
    requiredProviderImageCalls,
    expectedProviderImageCalls: requiredProviderImageCalls,
    sourcePackageProviderCalls: sourcePackageCalls,
    poseSheetProviderCalls: poseSheetCalls,
    localDerivatives: plans.reduce(
      (sum, plan) => sum + plan.localDerivatives,
      0,
    ),
    avoidedCalls: plans.reduce(
      (sum, plan) => sum + plan.avoidedCalls,
      0,
    ),
    hardCeiling,
    sourcePackagePlans: plans,
  };
};

export const sourcePackageDecisionFor = (directingSummary) => ({
  requiredProviderImageCalls:
    directingSummary?.generationBudget?.requiredProviderImageCalls ?? 0,
  expectedProviderImageCalls:
    directingSummary?.generationBudget?.expectedProviderImageCalls ?? 0,
  hardCeiling:
    directingSummary?.generationBudget?.hardCeiling ?? null,
  sourcePackagePlans:
    directingSummary?.generationBudget?.sourcePackagePlans ?? [],
});

export const assertSourcePackageDecision = (
  decision,
  directingSummary,
) => {
  const expected = sourcePackageDecisionFor(directingSummary);
  // Compared by value, not by serialization: key order in a hand-authored file
  // is arbitrary. When it does differ, the caller needs to see which field,
  // otherwise the only recoverable move is to guess.
  const issues = [];
  if (!decision || typeof decision !== 'object' || Array.isArray(decision)) {
    throw new Error(
      'sourcePackageDecision 必须是对象；可用 project:confirm-concept -- <slug> --scaffold 直接生成。',
    );
  }
  for (const key of Object.keys(expected)) {
    if (!sameValue(decision[key], expected[key])) {
      issues.push(
        `sourcePackageDecision.${key}: expected ${JSON.stringify(expected[key])}, received ${JSON.stringify(decision[key] ?? null)}`,
      );
    }
  }
  for (const key of Object.keys(decision)) {
    if (!Object.hasOwn(expected, key)) {
      issues.push(
        `sourcePackageDecision.${key}: 不属于本决定的字段（只比较 ${Object.keys(expected).join('、')}）`,
      );
    }
  }
  if (issues.length > 0) {
    throw new Error(
      'sourcePackageDecision 必须与当前 storyboard 的分层 source-package 计划和预算一致：\n' +
        issues.map((line) => `- ${line}`).join('\n') +
        '\n可用 project:storyboard -- <slug> --input=<storyboard.json> --json 或 project:confirm-concept -- <slug> --scaffold 取回 canonical 值。',
    );
  }
  return expected;
};
