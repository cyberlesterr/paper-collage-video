import {flattenCompositionNodes, hashCompositionValue} from './composition-lib.mjs';
import {collectParallaxDepths} from '../src/parallax.mjs';
import {
  MAX_MOTIF_INSTANCES_PER_FIELD,
  MAX_MOTIF_INSTANCES_PER_SCENE,
} from '../src/motifField.mjs';
import {compileEditorialSystem} from './editorial-system-lib.mjs';
import {
  compileLayerStackPlan,
  summarizeLayerSourcePackages,
  validateLayerCompositionIntent,
} from './layer-source-plan-lib.mjs';
import {
  collectCanonicalContainerPlans,
  compileCanonicalContainerPlan,
  validateCanonicalContainerIntent,
} from './container-source-plan-lib.mjs';
import {
  compileMotionContract,
  validateCompiledMotionContract,
} from './motion-contract-lib.mjs';
import {validatePathMotion} from '../src/pathMotion.mjs';
import {validateEncounterAuthoring} from './encounter-contract-lib.mjs';
import {
  compileSceneSoundEffects,
  soundEffectPlanFor,
} from './sound-effect-lib.mjs';
import {
  CHANGE_CLASSES,
  CONTINUOUS_PRESETS,
  MOTION_KINDS,
  STATE_FACINGS,
} from './production-vocabulary.mjs';

export const TREATMENT_IMPORTANCE = ['hero', 'supporting', 'ambient'];
export const TREATMENT_NECESSITY = ['required', 'enhancement'];
export {CHANGE_CLASSES, MOTION_KINDS, CONTINUOUS_PRESETS, STATE_FACINGS};
export const MOTIF_FIELD_PRESETS = ['drift', 'fall-drift', 'rise-drift', 'burst', 'orbit'];
export const MOTIF_FIELD_DISTRIBUTIONS = ['scattered', 'grid', 'edge'];
export const COMPOSITION_PATTERNS = [
  'free',
  'supported-subject',
  'registered-environment',
  'registered-depth-stack',
  'looping-environment',
  'canonical-container',
];
export const GRAPHIC_KINDS = ['typography', 'shape', 'annotation', 'data-graphic'];
export const GRAPHIC_ANIMATIONS = ['pulse', 'bounce', 'draw', 'stamp', 'shake', 'drop-impact', 'reveal', 'route', 'data-state'];
export const SEMANTIC_RISKS = ['decorative', 'identity', 'topology', 'mechanism', 'diagram'];
export const RELATIONSHIP_PREDICATES = [
  'inside',
  'on',
  'held-by',
  'worn-by',
  'above-boundary',
  'below-boundary',
];

const RISK_SCORE = {
  decorative: 1,
  identity: 3,
  topology: 4,
  mechanism: 5,
  diagram: 5,
};

const STYLE_SEMANTIC_SEVERITY = {
  decorative: 0,
  identity: 1,
  topology: 2,
  mechanism: 3,
  diagram: 3,
};

const IMPORTANCE_SCORE = {ambient: 0, supporting: 1, hero: 2};
const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;
const normalizedTime = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const normalizedRectangleWithinCanvas = ({x, y, width, height} = {}) =>
  [x, y, width, height].every((value) => Number.isFinite(value)) &&
  x >= 0 &&
  y >= 0 &&
  width > 0 &&
  height > 0 &&
  x + width <= 1 &&
  y + height <= 1;

const STATE_PLAYBACK_FIELDS = [
  'cycles',
  'activeFrom',
  'activeUntil',
  'holdStateId',
  'activeStateIds',
];

const statePlaybackFromMotion = (motion) => {
  const playback = {mode: motion.playback};
  for (const field of STATE_PLAYBACK_FIELDS) {
    if (motion[field] !== undefined) playback[field] = motion[field];
  }
  return playback;
};

const mergeStatePlayback = (current, next, key) => {
  if (current.mode !== next.mode) {
    throw new Error(`状态家族 ${key} 的 playback.mode 必须保持一致。`);
  }
  const merged = {...current};
  for (const field of STATE_PLAYBACK_FIELDS) {
    if (next[field] === undefined) continue;
    if (merged[field] !== undefined && JSON.stringify(merged[field]) !== JSON.stringify(next[field])) {
      throw new Error(`状态家族 ${key} 的 playback.${field} 必须保持一致。`);
    }
    merged[field] = next[field];
  }
  return merged;
};

const finalizeStatePlayback = ({playback, states, key}) => {
  const resolved = {...playback, cycles: playback.cycles ?? 1};
  if (resolved.mode === 'once' && resolved.cycles !== 1) {
    throw new Error(`状态家族 ${key} 的 once playback cycles 必须为 1。`);
  }
  if (resolved.activeFrom !== undefined && resolved.activeUntil !== undefined && resolved.activeFrom >= resolved.activeUntil) {
    throw new Error(`状态家族 ${key} 的 activeFrom 必须早于 activeUntil。`);
  }
  const stateIndex = new Map(states.map(({id}, index) => [id, index]));
  if (resolved.holdStateId !== undefined && !stateIndex.has(resolved.holdStateId)) {
    throw new Error(`状态家族 ${key} 的 holdStateId 必须引用一个已声明状态。`);
  }
  if (resolved.activeStateIds !== undefined) {
    for (const id of resolved.activeStateIds) {
      if (!stateIndex.has(id)) throw new Error(`状态家族 ${key} 的 activeStateIds 包含未知状态 ${id}。`);
    }
    for (let index = 1; index < resolved.activeStateIds.length; index += 1) {
      if (stateIndex.get(resolved.activeStateIds[index - 1]) >= stateIndex.get(resolved.activeStateIds[index])) {
        throw new Error(`状态家族 ${key} 的 activeStateIds 必须与状态顺序一致。`);
      }
    }
    const active = new Set(resolved.activeStateIds);
    const exitStates = [];
    for (const state of states) {
      if (active.has(state.id) || state.id === resolved.holdStateId) continue;
      if (state.at < resolved.activeFrom) continue;
      if (
        resolved.activeUntil !== undefined &&
        state.at >= resolved.activeUntil
      ) {
        exitStates.push(state);
        continue;
      }
      throw new Error(
        `状态家族 ${key} 的非活动状态 ${state.id} 必须早于 activeFrom，或在 activeUntil 后作为结束序列。`,
      );
    }
    if (exitStates.length > 0) {
      const hold = states.find(({id}) => id === resolved.holdStateId);
      if (
        exitStates[0].at !== resolved.activeUntil ||
        !hold ||
        hold.at < exitStates.at(-1).at
      ) {
        throw new Error(
          `状态家族 ${key} 的结束序列必须从 activeUntil 开始，并以 holdStateId 作为最后状态。`,
        );
      }
    }
  }
  return resolved;
};

const requiredPatternForPredicate = (predicate) =>
  ['inside', 'on', 'held-by', 'worn-by'].includes(predicate)
    ? 'supported-subject'
    : 'registered-environment';

const routeForChangeClass = {
  'ambient-motion': {motion: 'continuous-transform'},
  'camera-change': {motion: 'continuous-transform'},
  'pose-change': {motion: 'state-sequence'},
  'prop-state-change': {motion: 'state-sequence'},
  'contact-change': {composition: 'supported-subject'},
  'shared-boundary': {composition: 'registered-environment'},
  'graphic-emphasis': {graphic: true, motion: 'continuous-transform'},
  'mechanism-state': {proof: true},
  'static-hold': {motion: 'static'},
  'visibility-change': {motion: 'visibility-transition'},
  'depth-parallax': {motion: 'continuous-transform', proof: true},
  'depth-layer-separation': {
    motion: 'continuous-transform',
    composition: 'registered-depth-stack',
    proof: true,
  },
  'decorative-field': {motion: 'motif-field', proof: true},
  'world-travel': {
    motion: 'continuous-transform',
    composition: 'looping-environment',
    proof: true,
  },
  'path-travel': {
    motion: 'path-locomotion',
    proof: true,
  },
};

const addIssue = (issues, code, message, location) =>
  issues.push({code, message, location});

export const treatmentRiskScore = (treatment) =>
  (RISK_SCORE[treatment?.semanticRisk] ?? 0) * 10 +
  (treatment?.motion?.kind === 'state-sequence' ? 5 : 0) +
  (treatment?.motion?.kind === 'path-locomotion' ? 6 : 0) +
  (treatment?.composition?.pattern === 'registered-depth-stack' ? 6 : 0) +
  (treatment?.composition?.pattern === 'registered-environment' ? 4 : 0) +
  (treatment?.composition?.pattern === 'looping-environment' ? 5 : 0) +
  (treatment?.composition?.pattern === 'canonical-container' ? 7 : 0) +
  (treatment?.composition?.pattern === 'supported-subject' ? 3 : 0) +
  (IMPORTANCE_SCORE[treatment?.importance] ?? 0) +
  (treatment?.necessity === 'required' ? 1 : 0);

const styleSourceFamilyKey = (treatment) =>
  treatment?.motion?.kind === 'state-sequence'
    ? `pose-family:${treatment.motion.poseFamilyId}`
    : treatment?.motion?.kind === 'motif-field'
      ? `motif-field:${treatment.targetId}`
    : `target:${treatment?.targetId}`;

const styleCoverageForTreatment = (treatment, highestSemanticSeverity) => {
  const coverage = [];
  if ((STYLE_SEMANTIC_SEVERITY[treatment.semanticRisk] ?? 0) === highestSemanticSeverity && highestSemanticSeverity > 0) {
    coverage.push(`semantic:${treatment.semanticRisk}`);
  }
  if (['supported-subject', 'registered-environment', 'registered-depth-stack', 'looping-environment', 'canonical-container'].includes(treatment.composition?.pattern)) {
    coverage.push(`relationship:${treatment.composition.pattern}`);
  }
  if (treatment.composition?.motionCapability === 'bounded-relative') {
    coverage.push('motion:bounded-relative-layers');
  }
  if (treatment.motion?.preset === 'traverse') {
    coverage.push('motion:subject-traverse');
  }
  if (treatment.motion?.preset === 'sway') {
    coverage.push('motion:bottom-pivot-sway');
  }
  if (
    treatment.motion?.kind === 'motif-field' &&
    treatment.motion.preset === 'rise-drift'
  ) {
    coverage.push('motion:physical-rise');
  }
  if (treatment.motion?.kind === 'state-sequence') coverage.push('motion:state-sequence');
  if (treatment.motion?.kind === 'path-locomotion') {
    coverage.push('motion:path-locomotion');
    coverage.push('proof:path-locomotion');
    if (treatment.motion.cameraFollow) coverage.push('camera:path-follow');
  }
  if (treatment.motion?.kind === 'motif-field') coverage.push('motion:motif-field');
  if (treatment.graphic?.role === 'visual-sfx') coverage.push('graphic:visual-sfx');
  if (treatment.motion?.preset === 'scroll-world-x') {
    coverage.push('motion:looping-world');
    coverage.push('proof:world-motion');
  }
  return coverage;
};

export const compileStyleProofPlan = (
  scenes,
  {motionContractFingerprint} = {},
) => {
  const candidates = scenes.flatMap((scene) =>
    scene.beats.flatMap((beat) => beat.treatments.map((treatment) => ({
      sceneId: scene.id,
      treatmentId: treatment.id,
      targetId: treatment.targetId,
      proofTimeId: treatment.proofTimeId ?? null,
      riskScore: treatmentRiskScore(treatment),
      directingFingerprint: scene.directing.fingerprint,
      sourceFamilyKey: styleSourceFamilyKey(treatment),
      semanticRisk: treatment.semanticRisk,
      compositionPattern: treatment.composition.pattern,
      motionKind: treatment.motion.kind,
      treatment,
    }))),
  );
  if (candidates.length === 0) {
    return {
      requiredCoverage: [],
      targets: [],
      sourceFamilyKeys: [],
      motionContractFingerprint,
      fingerprint: hashCompositionValue({
        requiredCoverage: [],
        targets: [],
        motionContractFingerprint,
      }),
    };
  }
  const highestSemanticSeverity = Math.max(
    ...candidates.map(({semanticRisk}) => STYLE_SEMANTIC_SEVERITY[semanticRisk] ?? 0),
  );
  const requiredCoverage = new Set();
  for (const candidate of candidates) {
    for (const coverage of styleCoverageForTreatment(candidate.treatment, highestSemanticSeverity)) {
      requiredCoverage.add(coverage);
    }
  }
  if (candidates.some(({compositionPattern}) => ['supported-subject', 'registered-environment', 'registered-depth-stack', 'looping-environment', 'canonical-container'].includes(compositionPattern))) {
    requiredCoverage.add('relationship:coupled');
  }
  const representative = [...candidates].sort((left, right) =>
    right.riskScore - left.riskScore ||
    left.sceneId.localeCompare(right.sceneId) ||
    left.treatmentId.localeCompare(right.treatmentId),
  )[0];
  if (requiredCoverage.size === 0) {
    requiredCoverage.add('baseline:representative');
  }
  const enriched = candidates.map(({treatment, ...candidate}) => {
    const coverage = styleCoverageForTreatment(treatment, highestSemanticSeverity);
    if (coverage.some((entry) => entry.startsWith('relationship:'))) coverage.push('relationship:coupled');
    if (
      requiredCoverage.has('baseline:representative') &&
      candidate.sceneId === representative.sceneId &&
      candidate.treatmentId === representative.treatmentId
    ) {
      coverage.push('baseline:representative');
    }
    return {...candidate, coverage: [...new Set(coverage)].sort()};
  });
  const uncovered = new Set(requiredCoverage);
  const selected = [];
  const selectedFamilies = new Set();
  while (uncovered.size > 0) {
    const ranked = enriched
      .filter((candidate) => !selected.some(({sceneId, treatmentId}) => sceneId === candidate.sceneId && treatmentId === candidate.treatmentId))
      .map((candidate) => ({
        candidate,
        newlyCovered: candidate.coverage.filter((entry) => uncovered.has(entry)),
        newFamilyCost: selectedFamilies.has(candidate.sourceFamilyKey) ? 0 : 1,
      }))
      .filter(({newlyCovered}) => newlyCovered.length > 0)
      .sort((left, right) =>
        right.newlyCovered.length - left.newlyCovered.length ||
        left.newFamilyCost - right.newFamilyCost ||
        right.candidate.riskScore - left.candidate.riskScore ||
        left.candidate.sceneId.localeCompare(right.candidate.sceneId) ||
        left.candidate.treatmentId.localeCompare(right.candidate.treatmentId),
      );
    const next = ranked[0]?.candidate;
    if (!next) break;
    selected.push(next);
    selectedFamilies.add(next.sourceFamilyKey);
    for (const entry of next.coverage) uncovered.delete(entry);
  }
  const targets = selected.map((candidate) => ({
    sceneId: candidate.sceneId,
    treatmentId: candidate.treatmentId,
    targetId: candidate.targetId,
    proofTimeId: candidate.proofTimeId,
    riskScore: candidate.riskScore,
    directingFingerprint: candidate.directingFingerprint,
    sourceFamilyKey: candidate.sourceFamilyKey,
    coverage: candidate.coverage,
  }));
  const plan = {
    requiredCoverage: [...requiredCoverage].sort(),
    targets,
    sourceFamilyKeys: [...selectedFamilies].sort(),
    motionContractFingerprint,
  };
  return {...plan, fingerprint: hashCompositionValue(plan)};
};

export const validateTreatment = (treatment, {location = 'treatment', beatAt = null} = {}) => {
  const issues = [];
  if (!treatment || typeof treatment !== 'object' || Array.isArray(treatment)) {
    addIssue(issues, 'treatment-object', 'treatment 必须是对象。', location);
    return issues;
  }
  for (const key of ['id', 'targetId', 'changeClass', 'semanticRisk', 'rationale']) {
    if (!nonEmpty(treatment[key])) addIssue(issues, `treatment-${key}`, `${key} 不能为空。`, `${location}.${key}`);
  }
  if (
    /^scene-\d+-camera$/.test(treatment.targetId) &&
    treatment.targetId !== 'scene-camera'
  ) {
    addIssue(
      issues,
      'treatment-camera-target-alias',
      'camera treatment 的唯一目标 id 是 scene-camera；不得写入带场景号的别名。',
      `${location}.targetId`,
    );
  }
  if (!TREATMENT_IMPORTANCE.includes(treatment.importance)) {
    addIssue(issues, 'treatment-importance', 'importance 必须是 hero、supporting 或 ambient。', `${location}.importance`);
  }
  if (!TREATMENT_NECESSITY.includes(treatment.necessity)) {
    addIssue(issues, 'treatment-necessity', 'necessity 必须是 required 或 enhancement。', `${location}.necessity`);
  }
  if (!CHANGE_CLASSES.includes(treatment.changeClass)) {
    addIssue(issues, 'treatment-change-class', `未知 changeClass：${treatment.changeClass}`, `${location}.changeClass`);
  }
  if (!SEMANTIC_RISKS.includes(treatment.semanticRisk)) {
    addIssue(issues, 'treatment-semantic-risk', `未知 semanticRisk：${treatment.semanticRisk}`, `${location}.semanticRisk`);
  }
  if (treatment.proofTimeId !== null && treatment.proofTimeId !== undefined && !nonEmpty(treatment.proofTimeId)) {
    addIssue(issues, 'treatment-proof-id', 'proofTimeId 必须为非空字符串或 null。', `${location}.proofTimeId`);
  }
  if (!Object.hasOwn(treatment, 'proofTimeId')) {
    addIssue(issues, 'treatment-proof-field', 'treatment 必须显式声明 proofTimeId（字符串或 null）。', `${location}.proofTimeId`);
  }
  if (!Object.hasOwn(treatment, 'graphic')) {
    addIssue(issues, 'treatment-graphic-field', 'treatment 必须显式声明 graphic（对象或 null）。', `${location}.graphic`);
  }

  const motion = treatment.motion;
  if (!motion || typeof motion !== 'object' || !MOTION_KINDS.includes(motion.kind)) {
    addIssue(issues, 'treatment-motion-kind', 'motion.kind 必须使用受支持的确定性运动原语。', `${location}.motion.kind`);
  } else if (motion.kind === 'continuous-transform') {
    if (!CONTINUOUS_PRESETS.includes(motion.preset)) {
      addIssue(issues, 'treatment-motion-preset', `未知 continuous preset：${motion.preset}`, `${location}.motion.preset`);
    }
    if (['poseFamilyId', 'stateId', 'facing', 'visualChange', 'playback', 'transition', 'path', 'cameraFollow', ...STATE_PLAYBACK_FIELDS].some((key) => motion[key] !== undefined)) {
      addIssue(issues, 'treatment-motion-mixed', 'continuous-transform 不得夹带 state-sequence 字段。', `${location}.motion`);
    }
  } else if (motion.kind === 'state-sequence') {
    for (const key of ['poseFamilyId', 'stateId', 'visualChange']) {
      if (!nonEmpty(motion[key])) addIssue(issues, `treatment-state-${key}`, `${key} 不能为空。`, `${location}.motion.${key}`);
    }
    if (!STATE_FACINGS.includes(motion.facing)) {
      addIssue(
        issues,
        'treatment-state-facing',
        'state-sequence facing 必须明确声明为 left、right、front、back 或 neutral。',
        `${location}.motion.facing`,
      );
    }
    if (!['once', 'loop', 'ping-pong'].includes(motion.playback)) {
      addIssue(issues, 'treatment-state-playback', 'state-sequence playback 无效。', `${location}.motion.playback`);
    }
    if (!['cut', 'crossfade'].includes(motion.transition)) {
      addIssue(issues, 'treatment-state-transition', 'state-sequence transition 无效。', `${location}.motion.transition`);
    }
    if (motion.cycles !== undefined && !(Number.isInteger(motion.cycles) && motion.cycles > 0)) {
      addIssue(issues, 'treatment-state-cycles', 'state-sequence cycles 必须是正整数。', `${location}.motion.cycles`);
    }
    if (motion.playback === 'once' && motion.cycles !== undefined && motion.cycles !== 1) {
      addIssue(issues, 'treatment-state-once-cycles', 'once playback 的 cycles 必须为 1。', `${location}.motion.cycles`);
    }
    if (motion.activeFrom !== undefined && !(Number.isFinite(motion.activeFrom) && motion.activeFrom > 0 && motion.activeFrom < 1)) {
      addIssue(issues, 'treatment-state-active-from', 'state-sequence activeFrom 必须位于 0..1 之间。', `${location}.motion.activeFrom`);
    }
    if (motion.activeUntil !== undefined && !(Number.isFinite(motion.activeUntil) && motion.activeUntil > 0 && motion.activeUntil < 1)) {
      addIssue(issues, 'treatment-state-active-until', 'state-sequence activeUntil 必须位于 0..1 之间。', `${location}.motion.activeUntil`);
    }
    if ((motion.activeUntil === undefined) !== (motion.holdStateId === undefined)) {
      addIssue(issues, 'treatment-state-hold-window', 'activeUntil 与 holdStateId 必须同时声明。', `${location}.motion`);
    }
    if (motion.activeFrom !== undefined && motion.activeUntil !== undefined && motion.activeFrom >= motion.activeUntil) {
      addIssue(issues, 'treatment-state-active-window', 'activeFrom 必须早于 activeUntil。', `${location}.motion`);
    }
    if (motion.activeStateIds !== undefined && (
      motion.activeFrom === undefined ||
      !Array.isArray(motion.activeStateIds) ||
      motion.activeStateIds.length < 2 ||
      new Set(motion.activeStateIds).size !== motion.activeStateIds.length
    )) {
      addIssue(issues, 'treatment-state-active-states', 'activeStateIds 需要 activeFrom 和至少两个不重复状态。', `${location}.motion.activeStateIds`);
    }
    if (!normalizedTime(beatAt)) {
      addIssue(issues, 'treatment-state-time', '状态 treatment 必须绑定有效 beat.at。', location);
    }
    if (motion.preset !== undefined) {
      addIssue(issues, 'treatment-motion-mixed', 'state-sequence 不得声明 continuous preset。', `${location}.motion.preset`);
    }
    if (motion.path !== undefined || motion.cameraFollow !== undefined) {
      addIssue(issues, 'treatment-motion-mixed', 'state-sequence 的三维路径必须由同目标的独立 path-locomotion treatment 声明。', `${location}.motion`);
    }
    if (motion.pathViewBinding !== undefined) {
      const binding = motion.pathViewBinding;
      const groups = [
        binding?.planarStateIds,
        binding?.towardStateIds,
        binding?.awayStateIds,
      ];
      const allIds = groups.flatMap((ids) => Array.isArray(ids) ? ids : []);
      if (
        !Number.isFinite(binding?.depthVelocityThreshold) ||
        binding.depthVelocityThreshold <= 0 ||
        !Number.isFinite(binding?.transitionWidth) ||
        binding.transitionWidth < 0 ||
        binding.transitionWidth > binding.depthVelocityThreshold
      ) {
        addIssue(issues, 'treatment-path-view-threshold', 'pathViewBinding 必须声明正 depthVelocityThreshold，且 transitionWidth 位于 0..threshold。', `${location}.motion.pathViewBinding`);
      }
      if (groups.some((ids) =>
        !Array.isArray(ids) ||
        ids.length < 2 ||
        new Set(ids).size !== ids.length ||
        ids.some((id) => !nonEmpty(id))
      )) {
        addIssue(issues, 'treatment-path-view-group', 'pathViewBinding 的 planar/toward/away 各组都必须包含至少两个不重复状态。', `${location}.motion.pathViewBinding`);
      }
      if (new Set(allIds).size !== allIds.length) {
        addIssue(issues, 'treatment-path-view-overlap', 'pathViewBinding 的三个状态组不得互相重叠。', `${location}.motion.pathViewBinding`);
      }
    }
  } else if (motion.kind === 'path-locomotion') {
    for (const issue of validatePathMotion(motion.path)) {
      addIssue(
        issues,
        issue.code,
        issue.message,
        `${location}.motion.${issue.location}`,
      );
    }
    if (!Object.hasOwn(motion, 'cameraFollow')) {
      addIssue(
        issues,
        'treatment-path-camera-decision',
        'path-locomotion 必须显式声明 cameraFollow（对象或 null）。',
        `${location}.motion.cameraFollow`,
      );
    }
    if (
      motion.cameraFollow !== null &&
      (
        !nonEmpty(motion.cameraFollow?.targetNodeId) ||
        motion.cameraFollow.targetNodeId !== treatment.targetId ||
        !nonEmpty(motion.cameraFollow?.worldNodeId)
      )
    ) {
      addIssue(
        issues,
        'treatment-path-camera-binding',
        'cameraFollow 必须跟随当前 path-locomotion target，并声明世界节点。',
        `${location}.motion.cameraFollow`,
      );
    }
    if (motion.path?.progress?.[0]?.at !== beatAt) {
      addIssue(
        issues,
        'treatment-path-start-time',
        'path-locomotion 所属 beat.at 必须等于 path.progress 的第一个 at。',
        `${location}.motion.path.progress[0].at`,
      );
    }
    if (
      [
        'preset',
        'poseFamilyId',
        'stateId',
        'facing',
        'visualChange',
        'playback',
        'transition',
        ...STATE_PLAYBACK_FIELDS,
        'action',
        'durationSeconds',
        'distribution',
        'count',
        'cycles',
        'bounds',
        'exclusionZones',
        'worldBinding',
      ].some((key) => motion[key] !== undefined)
    ) {
      addIssue(
        issues,
        'treatment-path-mixed',
        'path-locomotion 不得夹带连续 preset、状态序列、显隐或 motif 字段。',
        `${location}.motion`,
      );
    }
  } else if (motion.kind === 'visibility-transition') {
    if (!['show', 'hide'].includes(motion.action)) {
      addIssue(issues, 'treatment-visibility-action', 'visibility-transition.action 必须是 show 或 hide。', `${location}.motion.action`);
    }
    if (!['cut', 'fade-rise', 'fade-scale'].includes(motion.transition)) {
      addIssue(issues, 'treatment-visibility-transition', 'visibility-transition.transition 无效。', `${location}.motion.transition`);
    }
    if (motion.transition === 'cut' ? motion.durationSeconds !== 0 : !(Number.isFinite(motion.durationSeconds) && motion.durationSeconds > 0)) {
      addIssue(issues, 'treatment-visibility-duration', 'cut 时长必须为 0，其他 visibility-transition 时长必须大于 0。', `${location}.motion.durationSeconds`);
    }
    if (['preset', 'poseFamilyId', 'stateId', 'facing', 'visualChange', 'playback', 'path', 'cameraFollow', ...STATE_PLAYBACK_FIELDS].some((key) => motion[key] !== undefined)) {
      addIssue(issues, 'treatment-motion-mixed', 'visibility-transition 不得夹带连续或状态序列字段。', `${location}.motion`);
    }
  } else if (motion.kind === 'motif-field') {
    if (!MOTIF_FIELD_PRESETS.includes(motion.preset)) {
      addIssue(issues, 'treatment-motif-preset', `未知 motif-field preset：${motion.preset}`, `${location}.motion.preset`);
    }
    if (!MOTIF_FIELD_DISTRIBUTIONS.includes(motion.distribution)) {
      addIssue(issues, 'treatment-motif-distribution', `未知 motif-field distribution：${motion.distribution}`, `${location}.motion.distribution`);
    }
    if (!(Number.isInteger(motion.count) && motion.count >= 1 && motion.count <= MAX_MOTIF_INSTANCES_PER_FIELD)) {
      addIssue(issues, 'treatment-motif-count', `motif-field count 必须是 1..${MAX_MOTIF_INSTANCES_PER_FIELD} 的整数。`, `${location}.motion.count`);
    }
    if (!(Number.isFinite(motion.cycles) && motion.cycles > 0 && motion.cycles <= 12)) {
      addIssue(issues, 'treatment-motif-cycles', 'motif-field cycles 必须位于 0..12。', `${location}.motion.cycles`);
    }
    if (!normalizedRectangleWithinCanvas(motion.bounds)) {
      addIssue(issues, 'treatment-motif-bounds', 'motif-field bounds 必须完整位于 0..1。', `${location}.motion.bounds`);
    }
    if (!Array.isArray(motion.exclusionZones) || motion.exclusionZones.length > 12) {
      addIssue(issues, 'treatment-motif-exclusions', 'motif-field exclusionZones 必须是最多 12 项的数组。', `${location}.motion.exclusionZones`);
    } else {
      const exclusionIds = new Set();
      for (const [index, zone] of motion.exclusionZones.entries()) {
        const zoneLocation = `${location}.motion.exclusionZones[${index}]`;
        if (!nonEmpty(zone?.id) || exclusionIds.has(zone.id)) {
          addIssue(issues, 'treatment-motif-exclusion-id', 'motif 排除区 id 缺失或重复。', `${zoneLocation}.id`);
        }
        exclusionIds.add(zone?.id);
        if (!['rectangle', 'ellipse'].includes(zone?.shape)) {
          addIssue(issues, 'treatment-motif-exclusion-shape', 'motif 排除区 shape 必须是 rectangle 或 ellipse。', `${zoneLocation}.shape`);
        }
        if (!normalizedRectangleWithinCanvas(zone)) {
          addIssue(issues, 'treatment-motif-exclusion-bounds', 'motif 排除区必须完整位于 0..1。', zoneLocation);
        }
        if (zone?.padding !== undefined && !(Number.isFinite(zone.padding) && zone.padding >= 0 && zone.padding <= 0.25)) {
          addIssue(issues, 'treatment-motif-exclusion-padding', 'motif 排除区 padding 必须位于 0..0.25。', `${zoneLocation}.padding`);
        }
      }
    }
    if (motion.worldBinding !== undefined) {
      const binding = motion.worldBinding;
      if (
        !nonEmpty(binding?.worldNodeId) ||
        !['far', 'mid', 'ground', 'near'].includes(binding?.stripRole) ||
        !(
          Number.isFinite(binding?.relativeDriftAmplitude) &&
          binding.relativeDriftAmplitude >= 0 &&
          binding.relativeDriftAmplitude <= 0.05
        )
      ) {
        addIssue(
          issues,
          'treatment-motif-world-binding',
          'motif-field worldBinding 必须声明 worldNodeId、有效 stripRole 与 0..0.05 relativeDriftAmplitude。',
          `${location}.motion.worldBinding`,
        );
      }
    }
    if (['poseFamilyId', 'stateId', 'facing', 'visualChange', 'playback', 'transition', 'action', 'durationSeconds', 'activeFrom', 'activeUntil', 'holdStateId', 'activeStateIds', 'path', 'cameraFollow'].some((key) => motion[key] !== undefined)) {
      addIssue(issues, 'treatment-motion-mixed', 'motif-field 不得夹带状态或显隐字段。', `${location}.motion`);
    }
  } else if (motion && Object.keys(motion).some((key) => key !== 'kind')) {
    addIssue(issues, 'treatment-static-fields', 'static motion 只能声明 kind。', `${location}.motion`);
  }

  const composition = treatment.composition;
  if (!composition || typeof composition !== 'object' || !COMPOSITION_PATTERNS.includes(composition.pattern)) {
    addIssue(issues, 'treatment-composition-pattern', 'composition.pattern 必须使用受支持的组合模式。', `${location}.composition.pattern`);
  } else if (
    composition.pattern !== 'free' &&
    composition.pattern !== 'registered-depth-stack' &&
    composition.pattern !== 'looping-environment' &&
    composition.pattern !== 'canonical-container'
  ) {
    const relationship = composition.relationship;
    if (!relationship || typeof relationship !== 'object') {
      addIssue(issues, 'treatment-relationship', '耦合组合必须声明 relationship。', `${location}.composition.relationship`);
    } else {
      for (const key of ['id', 'object', 'proof']) {
        if (!nonEmpty(relationship[key])) addIssue(issues, `treatment-relationship-${key}`, `relationship.${key} 不能为空。`, `${location}.composition.relationship.${key}`);
      }
      if (!RELATIONSHIP_PREDICATES.includes(relationship.predicate)) {
        addIssue(issues, 'treatment-relationship-predicate', `未知 relationship predicate：${relationship.predicate}`, `${location}.composition.relationship.predicate`);
      } else if (requiredPatternForPredicate(relationship.predicate) !== composition.pattern) {
        addIssue(issues, 'treatment-relationship-pattern', `predicate ${relationship.predicate} 必须使用 ${requiredPatternForPredicate(relationship.predicate)}。`, `${location}.composition.pattern`);
      }
    }
  } else if (composition.relationship !== undefined) {
    if (composition.pattern === 'free') {
      addIssue(issues, 'treatment-free-relationship', 'free 组合不得声明 relationship。', `${location}.composition.relationship`);
    }
  }
  issues.push(
    ...validateLayerCompositionIntent(composition, {
      location: `${location}.composition`,
    }),
    ...validateCanonicalContainerIntent(composition, {
      location: `${location}.composition`,
      treatment,
    }),
  );
  if (composition?.pattern === 'looping-environment') {
    const world = composition.world;
    if (
      world?.axis !== 'x' ||
      !['left', 'right'].includes(world?.direction) ||
      !(Number.isFinite(world?.distanceViewports) && world.distanceViewports > 0) ||
      !(Number.isFinite(world?.speedRange?.far) && world.speedRange.far > 0) ||
      !(Number.isFinite(world?.speedRange?.near) && world.speedRange.near > world.speedRange.far) ||
      typeof world?.closedLoop !== 'boolean' ||
      !(Number.isFinite(world?.startPhase) && world.startPhase >= 0 && world.startPhase < 1) ||
      !(Number.isFinite(world?.activeFrom ?? 0) && (world?.activeFrom ?? 0) >= 0 && (world?.activeFrom ?? 0) < 1) ||
      (world?.activeUntil !== undefined && (!(Number.isFinite(world.activeUntil) && world.activeUntil > 0 && world.activeUntil < 1) || world.activeUntil <= (world.activeFrom ?? 0))) ||
      !['linear', 'ease-out'].includes(world?.easing ?? 'linear') ||
      (world?.frozen !== undefined && typeof world.frozen !== 'boolean') ||
      (world?.frozen === true && (world?.activeFrom !== undefined || world?.activeUntil !== undefined)) ||
      !nonEmpty(world?.groundStripId) ||
      !['before', 'seam', 'after'].every((key) => nonEmpty(world?.seamProofTimeIds?.[key]))
    ) {
      addIssue(issues, 'treatment-looping-world', 'looping-environment 必须声明 horizontal direction、travel、单调 speedRange、groundStripId 与 loop phase。', `${location}.composition.world`);
    }
    if (!Array.isArray(world?.strips) || world.strips.length < 2) {
      addIssue(issues, 'treatment-looping-strips', 'looping-environment 至少需要两个语义 strip intent。', `${location}.composition.world.strips`);
    } else {
      const ids = new Set();
      const roles = new Set();
      const surfaceRoleByRole = {
        far: 'backdrop',
        mid: 'scenery',
        ground: 'walkable-ground',
        near: 'foreground-occluder',
      };
      let previousDepth = -Infinity;
      for (const [index, strip] of world.strips.entries()) {
        const stripLocation = `${location}.composition.world.strips[${index}]`;
        if (!nonEmpty(strip?.id) || ids.has(strip.id)) addIssue(issues, 'treatment-looping-strip-id', 'world strip id 缺失或重复。', `${stripLocation}.id`);
        ids.add(strip?.id);
        if (!['far', 'mid', 'ground', 'near'].includes(strip?.role) || roles.has(strip.role)) addIssue(issues, 'treatment-looping-strip-role', 'world strip role 必须有效且唯一。', `${stripLocation}.role`);
        roles.add(strip?.role);
        if (strip?.surfaceRole !== surfaceRoleByRole[strip?.role]) {
          addIssue(
            issues,
            'treatment-looping-strip-surface',
            `world strip role=${strip?.role ?? 'missing'} 必须声明 surfaceRole=${surfaceRoleByRole[strip?.role] ?? 'valid-role'}。`,
            `${stripLocation}.surfaceRole`,
          );
        }
        if (!(Number.isFinite(strip?.depth) && strip.depth >= -1 && strip.depth <= 1 && strip.depth > previousDepth)) {
          addIssue(issues, 'treatment-looping-strip-depth', 'world strips 必须按严格递增 depth 编排。', `${stripLocation}.depth`);
        }
        previousDepth = strip?.depth ?? previousDepth;
      }
      const ground = world.strips.find(({id}) => id === world.groundStripId);
      if (ground?.role !== 'ground') addIssue(issues, 'treatment-looping-ground', 'groundStripId 必须指向 role=ground 的 strip。', `${location}.composition.world.groundStripId`);
    }
    if (!Array.isArray(world?.subjectBindings) || world.subjectBindings.length < 1) {
      addIssue(
        issues,
        'treatment-looping-subjects',
        'looping-environment 必须声明至少一个 subjectBinding。',
        `${location}.composition.world.subjectBindings`,
      );
    } else {
      const ids = new Set();
      let trackedCount = 0;
      for (const [index, subject] of world.subjectBindings.entries()) {
        if (!nonEmpty(subject?.nodeId) || ids.has(subject.nodeId)) {
          addIssue(
            issues,
            'treatment-looping-subject-id',
            'world subjectBinding.nodeId 必须非空且唯一。',
            `${location}.composition.world.subjectBindings[${index}].nodeId`,
          );
        }
        ids.add(subject?.nodeId);
        if (subject?.role === 'tracked') trackedCount += 1;
        if (!['tracked', 'participant'].includes(subject?.role)) {
          addIssue(issues, 'treatment-looping-subject-role', 'world subject role 无效。', `${location}.composition.world.subjectBindings[${index}].role`);
        }
        if (!['screen', 'world'].includes(subject?.anchorMode)) {
          addIssue(issues, 'treatment-looping-subject-anchor', 'world subject anchorMode 必须为 screen 或 world。', `${location}.composition.world.subjectBindings[${index}].anchorMode`);
        }
        if (!['behind-near', 'above-near'].includes(subject?.nearOcclusion)) {
          addIssue(issues, 'treatment-looping-subject-occlusion', 'world subject nearOcclusion 无效。', `${location}.composition.world.subjectBindings[${index}].nearOcclusion`);
        }
        if (
          subject?.requireNearOverlap !== undefined &&
          typeof subject.requireNearOverlap !== 'boolean'
        ) {
          addIssue(
            issues,
            'treatment-looping-subject-overlap',
            'world subject requireNearOverlap 必须为布尔值。',
            `${location}.composition.world.subjectBindings[${index}].requireNearOverlap`,
          );
        }
        if (
          !Array.isArray(subject?.proofTimeIds) ||
          subject.proofTimeIds.length < 2 ||
          new Set(subject.proofTimeIds).size !== subject.proofTimeIds.length ||
          subject.proofTimeIds.some((id) => !nonEmpty(id))
        ) {
          addIssue(issues, 'treatment-looping-subject-proofs', 'world subject 必须绑定至少两个唯一 proofTimeIds。', `${location}.composition.world.subjectBindings[${index}].proofTimeIds`);
        }
      }
      if (trackedCount !== 1) {
        addIssue(
          issues,
          'treatment-looping-tracked-subject',
          'world subjectBindings 必须且只能包含一个 role=tracked 的可读性主体。',
          `${location}.composition.world.subjectBindings`,
        );
      }
    }
    if (motion?.preset !== 'scroll-world-x') {
      addIssue(issues, 'treatment-looping-preset', 'looping-environment 必须使用 scroll-world-x preset。', `${location}.motion.preset`);
    }
  } else if (composition?.world !== undefined) {
    addIssue(issues, 'treatment-world-pattern', 'composition.world 只适用于 looping-environment。', `${location}.composition.world`);
  }
  if (
    composition?.pattern !== 'canonical-container' &&
    composition?.container !== undefined
  ) {
    addIssue(
      issues,
      'treatment-container-pattern',
      'composition.container 只适用于 canonical-container。',
      `${location}.composition.container`,
    );
  }

  if (treatment.graphic !== null && treatment.graphic !== undefined) {
    if (!GRAPHIC_KINDS.includes(treatment.graphic?.kind)) {
      addIssue(issues, 'treatment-graphic-kind', 'graphic.kind 必须是 typography、shape、annotation 或 data-graphic。', `${location}.graphic.kind`);
    }
    if (!GRAPHIC_ANIMATIONS.includes(treatment.graphic?.animation)) {
      addIssue(issues, 'treatment-graphic-animation', 'graphic.animation 无效。', `${location}.graphic.animation`);
    }
    if (!['generic', 'visual-sfx'].includes(treatment.graphic?.role)) {
      addIssue(issues, 'treatment-graphic-role', 'graphic.role 必须为 generic 或 visual-sfx。', `${location}.graphic.role`);
    }
    if (treatment.graphic?.role === 'visual-sfx') {
      if (treatment.graphic.kind !== 'typography') {
        addIssue(issues, 'treatment-visual-sfx-kind', 'visual-sfx 必须使用 typography。', `${location}.graphic.kind`);
      }
      if (!['impact', 'motion'].includes(treatment.graphic.sfxKind)) {
        addIssue(issues, 'treatment-visual-sfx-type', 'visual-sfx.sfxKind 必须为 impact 或 motion。', `${location}.graphic.sfxKind`);
      }
      if (!nonEmpty(treatment.graphic.text) || [...treatment.graphic.text].length > 8) {
        addIssue(issues, 'treatment-visual-sfx-text', 'visual-sfx.text 必须是 1–8 个字符。', `${location}.graphic.text`);
      }
      if (
        !Number.isFinite(treatment.graphic.durationSeconds) ||
        treatment.graphic.durationSeconds < 0.1 ||
        treatment.graphic.durationSeconds > 1
      ) {
        addIssue(issues, 'treatment-visual-sfx-duration', 'visual-sfx.durationSeconds 必须位于 0.1–1 秒。', `${location}.graphic.durationSeconds`);
      }
      if (treatment.graphic.audioBinding !== 'beat-sound-cue') {
        addIssue(issues, 'treatment-visual-sfx-audio', 'visual-sfx 必须绑定所属 beat.soundCue。', `${location}.graphic.audioBinding`);
      }
      if (!['stamp', 'shake', 'drop-impact'].includes(treatment.graphic.animation)) {
        addIssue(issues, 'treatment-visual-sfx-animation', 'visual-sfx 只使用 stamp、shake 或 drop-impact。', `${location}.graphic.animation`);
      }
    } else if (
      ['sfxKind', 'text', 'durationSeconds', 'audioBinding'].some(
        (key) => treatment.graphic[key] !== undefined,
      )
    ) {
      addIssue(issues, 'treatment-generic-graphic-fields', 'generic graphic 不得声明 visual-sfx 专用字段。', `${location}.graphic`);
    }
  }

  const route = routeForChangeClass[treatment.changeClass];
  if (route?.motion && motion?.kind !== route.motion) {
    addIssue(issues, 'treatment-routing-motion', `${treatment.changeClass} 必须路由为 ${route.motion}。`, `${location}.motion.kind`);
  }
  if (route?.composition && composition?.pattern !== route.composition) {
    addIssue(issues, 'treatment-routing-composition', `${treatment.changeClass} 必须路由为 ${route.composition}。`, `${location}.composition.pattern`);
  }
  if (route?.graphic && !treatment.graphic) {
    addIssue(issues, 'treatment-routing-graphic', `${treatment.changeClass} 必须声明 graphic。`, `${location}.graphic`);
  }
  if (route?.proof && !nonEmpty(treatment.proofTimeId)) {
    addIssue(issues, 'treatment-routing-proof', `${treatment.changeClass} 必须绑定 proofTimeId。`, `${location}.proofTimeId`);
  }
  if (
    treatment.changeClass === 'depth-parallax' &&
    (treatment.targetId !== 'scene-camera' || motion?.preset !== 'parallax-camera')
  ) {
    addIssue(issues, 'treatment-parallax-route', 'depth-parallax 必须以 scene-camera 为目标并使用 parallax-camera preset。', `${location}.motion`);
  }
  if (treatment.changeClass === 'decorative-field' && treatment.semanticRisk !== 'decorative') {
    addIssue(issues, 'treatment-motif-risk', 'decorative-field 的 semanticRisk 必须为 decorative。', `${location}.semanticRisk`);
  }
  if (['identity', 'topology', 'mechanism', 'diagram'].includes(treatment.semanticRisk) && !nonEmpty(treatment.proofTimeId)) {
    addIssue(issues, 'treatment-risk-proof', `semanticRisk=${treatment.semanticRisk} 必须绑定 proofTimeId。`, `${location}.proofTimeId`);
  }
  return issues;
};

const compileScene = (scene, {projectSlug}) => {
  const patterns = new Set();
  const relationships = new Map();
  const stateFamilies = new Map();
  const continuousMotions = [];
  const pathMotions = new Map();
  const visibilityEvents = [];
  const motifFields = [];
  const graphics = [];
  const layerStacks = new Map();
  const loopingEnvironments = new Map();
  const canonicalContainers = new Map();
  const treatments = [];

  for (const beat of scene.beats ?? []) {
    for (const treatment of beat.treatments ?? []) {
      treatments.push({...treatment, beatId: beat.id, at: beat.at});
      patterns.add(treatment.composition.pattern);
      const relationship = treatment.composition.relationship;
      if (relationship) {
        const compiled = {
          id: relationship.id,
          subject: treatment.targetId,
          predicate: relationship.predicate,
          object: relationship.object,
          proof: relationship.proof,
        };
        const prior = relationships.get(compiled.id);
        if (prior && JSON.stringify(prior) !== JSON.stringify(compiled)) {
          throw new Error(`关系 ${compiled.id} 在同一镜头中定义不一致。`);
        }
        relationships.set(compiled.id, compiled);
      }
      if (treatment.motion.kind === 'state-sequence') {
        const key = `${treatment.targetId}::${treatment.motion.poseFamilyId}`;
        const family = stateFamilies.get(key) ?? {
          nodeId: treatment.targetId,
          poseFamilyId: treatment.motion.poseFamilyId,
          states: [],
          playback: statePlaybackFromMotion(treatment.motion),
          pathViewBinding: treatment.motion.pathViewBinding,
          transition: treatment.motion.transition,
          necessity: treatment.necessity,
          importance: treatment.importance,
        };
        if (family.transition !== treatment.motion.transition) throw new Error(`状态家族 ${key} 的 transition 必须保持一致。`);
        if (JSON.stringify(family.pathViewBinding) !== JSON.stringify(treatment.motion.pathViewBinding)) {
          throw new Error(`状态家族 ${key} 的 pathViewBinding 必须保持一致。`);
        }
        family.playback = mergeStatePlayback(family.playback, statePlaybackFromMotion(treatment.motion), key);
        family.states.push({
          id: treatment.motion.stateId,
          at: beat.at,
          facing: treatment.motion.facing,
          visualChange: treatment.motion.visualChange,
        });
        if (treatment.necessity === 'required') family.necessity = 'required';
        if (IMPORTANCE_SCORE[treatment.importance] > IMPORTANCE_SCORE[family.importance]) family.importance = treatment.importance;
        stateFamilies.set(key, family);
      }
      if (treatment.motion.kind === 'continuous-transform') {
        continuousMotions.push({
          id: treatment.id,
          nodeId: treatment.targetId,
          preset: treatment.motion.preset,
          at: beat.at,
          proofTimeId: treatment.proofTimeId ?? null,
        });
      }
      if (treatment.motion.kind === 'path-locomotion') {
        const compiledPath = {
          id: treatment.id,
          nodeId: treatment.targetId,
          path: treatment.motion.path,
          cameraFollow: treatment.motion.cameraFollow,
          at: beat.at,
          proofTimeId: treatment.proofTimeId ?? null,
        };
        const prior = pathMotions.get(treatment.targetId);
        if (
          prior &&
          JSON.stringify(prior) !== JSON.stringify(compiledPath)
        ) {
          throw new Error(
            `二维路径 ${scene.id}::${treatment.targetId} 在同一镜头中定义不一致。`,
          );
        }
        if (prior) {
          throw new Error(
            `二维路径 ${scene.id}::${treatment.targetId} 只能定义一次。`,
          );
        }
        pathMotions.set(treatment.targetId, compiledPath);
      }
      if (treatment.motion.kind === 'visibility-transition') {
        visibilityEvents.push({
          id: treatment.id,
          beatId: beat.id,
          nodeId: treatment.targetId,
          action: treatment.motion.action,
          transition: treatment.motion.transition,
          durationSeconds: treatment.motion.durationSeconds,
          at: beat.at,
          proofTimeId: treatment.proofTimeId ?? null,
        });
      }
      if (treatment.motion.kind === 'motif-field') {
        motifFields.push({
          id: treatment.id,
          nodeId: treatment.targetId,
          preset: treatment.motion.preset,
          distribution: treatment.motion.distribution,
          count: treatment.motion.count,
          cycles: treatment.motion.cycles,
          bounds: treatment.motion.bounds,
          exclusionZones: treatment.motion.exclusionZones,
          ...(treatment.motion.worldBinding
            ? {worldBinding: treatment.motion.worldBinding}
            : {}),
          at: beat.at,
          proofTimeId: treatment.proofTimeId ?? null,
        });
      }
      if (treatment.graphic) {
        graphics.push({
          id: treatment.id,
          beatId: beat.id,
          nodeId: treatment.targetId,
          kind: treatment.graphic.kind,
          animation: treatment.graphic.animation,
          role: treatment.graphic.role,
          ...(treatment.graphic.role === 'visual-sfx'
            ? {
                sfxKind: treatment.graphic.sfxKind,
                text: treatment.graphic.text,
                durationSeconds: treatment.graphic.durationSeconds,
                audioBinding: treatment.graphic.audioBinding,
                soundCue: beat.soundCue,
              }
            : {}),
          at: beat.at,
          proofTimeId: treatment.proofTimeId ?? null,
        });
      }
      if (treatment.composition.pattern === 'looping-environment') {
        const world = treatment.composition.world;
        const compiledWorld = {
          id: treatment.id,
          treatmentId: treatment.id,
          sceneId: scene.id,
          targetId: treatment.targetId,
          axis: world.axis,
          direction: world.direction,
          distanceViewports: world.distanceViewports,
          speedRange: world.speedRange,
          groundStripId: world.groundStripId,
          subjectBindings: world.subjectBindings,
          seamProofTimeIds: world.seamProofTimeIds,
          closedLoop: world.closedLoop,
          startPhase: world.startPhase,
          activeFrom: world.activeFrom ?? 0,
          ...(world.activeUntil === undefined
            ? {}
            : {activeUntil: world.activeUntil}),
          easing: world.easing ?? 'linear',
          frozen: world.frozen === true,
          strips: world.strips,
          proofTimeId: treatment.proofTimeId ?? null,
        };
        const prior = loopingEnvironments.get(treatment.targetId);
        if (prior && JSON.stringify({...prior, id: undefined, treatmentId: undefined, proofTimeId: undefined}) !== JSON.stringify({...compiledWorld, id: undefined, treatmentId: undefined, proofTimeId: undefined})) {
          throw new Error(`循环世界 ${scene.id}::${treatment.targetId} 在同一镜头中定义不一致。`);
        }
        if (!prior) loopingEnvironments.set(treatment.targetId, compiledWorld);
      }
      const layerStack = compileLayerStackPlan({
        sceneId: scene.id,
        treatment,
      });
      if (layerStack) {
        const key = layerStack.targetId;
        const prior = layerStacks.get(key);
        const stable = ({
          id,
          treatmentId,
          proofTimeId,
          ...value
        }) => value;
        if (
          prior &&
          JSON.stringify(stable(prior)) !== JSON.stringify(stable(layerStack))
        ) {
          throw new Error(
            `分层资产拓扑 ${scene.id}::${key} 在同一镜头中定义不一致。`,
          );
        }
        if (!prior) layerStacks.set(key, layerStack);
      }
      const canonicalContainer = compileCanonicalContainerPlan({
        sceneId: scene.id,
        treatment,
      });
      if (canonicalContainer) {
        const key = canonicalContainer.groupId;
        const prior = canonicalContainers.get(key);
        const stable = ({
          treatmentId,
          proofTimeId,
          ...value
        }) => value;
        if (
          prior &&
          JSON.stringify(stable(prior)) !==
            JSON.stringify(stable(canonicalContainer))
        ) {
          throw new Error(
            `canonical container ${scene.id}::${key} 在同一镜头中定义不一致。`,
          );
        }
        if (!prior) canonicalContainers.set(key, canonicalContainer);
      }
    }
  }

  const highestRisk = [...treatments].sort((left, right) =>
    treatmentRiskScore(right) - treatmentRiskScore(left) || left.id.localeCompare(right.id),
  )[0] ?? null;
  for (const pathMotion of pathMotions.values()) {
    if (
      ![...stateFamilies.values()].some(
        ({nodeId}) => nodeId === pathMotion.nodeId,
      )
    ) {
      throw new Error(
        `二维路径 ${scene.id}::${pathMotion.nodeId} 必须与同一目标的 state-sequence 状态家族组合，不能移动冻结单帧。`,
      );
    }
  }
  for (const family of stateFamilies.values()) {
    if (!family.pathViewBinding) continue;
    const pathMotion = pathMotions.get(family.nodeId);
    if (pathMotion?.path?.kind !== 'cubic-bezier-3d') {
      throw new Error(
        `景深视角状态家族 ${scene.id}::${family.nodeId} 必须绑定同目标的 cubic-bezier-3d 路径。`,
      );
    }
    const knownStateIds = new Set(family.states.map(({id}) => id));
    const viewStateIds = [
      ...family.pathViewBinding.planarStateIds,
      ...family.pathViewBinding.towardStateIds,
      ...family.pathViewBinding.awayStateIds,
    ];
    for (const stateId of viewStateIds) {
      if (!knownStateIds.has(stateId)) {
        throw new Error(
          `景深视角状态家族 ${scene.id}::${family.nodeId} 引用了未编排状态 ${stateId}。`,
        );
      }
    }
  }
  const compositionPlan = {
    patterns: [...patterns].sort(),
    relationships: [...relationships.values()].sort((left, right) => left.id.localeCompare(right.id)),
    stateSequences: [...stateFamilies.values()]
      .map(({necessity, importance, ...family}) => {
        const orderedStates = [...family.states].sort(
          (left, right) => left.at - right.at,
        );
        const states =
          ['loop', 'ping-pong'].includes(family.playback.mode) &&
          family.playback.activeFrom === undefined &&
          family.playback.activeStateIds === undefined
            ? orderedStates.map((state, index) => ({
                ...state,
                at: index / orderedStates.length,
              }))
            : orderedStates;
        return {
          ...family,
          states,
          playback: finalizeStatePlayback({
            playback: family.playback,
            states,
            key: `${family.nodeId}::${family.poseFamilyId}`,
          }),
        };
      })
      .sort((left, right) => left.nodeId.localeCompare(right.nodeId)),
    continuousMotions: continuousMotions.sort((left, right) => left.at - right.at || left.id.localeCompare(right.id)),
    pathMotions: [...pathMotions.values()].sort((left, right) =>
      left.nodeId.localeCompare(right.nodeId),
    ),
    visibilityEvents: visibilityEvents.sort((left, right) => left.at - right.at || left.id.localeCompare(right.id)),
    motifFields: motifFields.sort((left, right) => left.at - right.at || left.id.localeCompare(right.id)),
    graphics: graphics.sort((left, right) => left.at - right.at || left.id.localeCompare(right.id)),
    soundEffects: compileSceneSoundEffects({scene, projectSlug}),
    layerStacks: [...layerStacks.values()].sort((left, right) =>
      left.targetId.localeCompare(right.targetId),
    ),
    loopingEnvironments: [...loopingEnvironments.values()].sort((left, right) =>
      left.targetId.localeCompare(right.targetId),
    ),
    canonicalContainers: [...canonicalContainers.values()].sort(
      (left, right) => left.groupId.localeCompare(right.groupId),
    ),
  };
  const directing = {
    fingerprint: hashCompositionValue({sceneId: scene.id, beats: scene.beats, compositionPlan}),
    treatmentCount: treatments.length,
    riskScore: highestRisk ? treatmentRiskScore(highestRisk) : 0,
    highestRiskTreatmentId: highestRisk?.id ?? null,
  };
  return {
    ...scene,
    motionPolicy: scene.motionPolicy ?? 'standard',
    staticRationale:
      scene.motionPolicy === 'locked-static'
        ? scene.staticRationale
        : null,
    compositionPlan,
    directing,
  };
};

export const stateSheetGridForCount = (stateCount) => {
  if (!Number.isInteger(stateCount) || stateCount < 1 || stateCount > 12) {
    throw new Error('状态母版网格只支持 1..12 个状态。');
  }
  if (stateCount <= 4) return {columns: 2, rows: 2};
  if (stateCount <= 6) return {columns: 3, rows: 2};
  if (stateCount <= 8) return {columns: 4, rows: 2};
  if (stateCount <= 9) return {columns: 3, rows: 3};
  return {columns: 4, rows: 3};
};

export const summarizeDirectingDemand = (scenes, motionBudget) => {
  const treatments = scenes.flatMap((scene) =>
    scene.beats.flatMap((beat) => beat.treatments.map((treatment) => ({
      ...treatment,
      sceneId: scene.id,
    }))),
  );
  const stateFamilyMap = new Map();
  for (const treatment of treatments.filter(
    ({motion, composition}) =>
      motion.kind === 'state-sequence' &&
      composition?.pattern !== 'canonical-container',
  )) {
    // A poseFamilyId denotes one registered provider sheet. A continuous scene may
    // intentionally use several temporal instances of that same family (for
    // example, a sleeping hare and the later chase) without creating another
    // provider-family obligation. Count the sheet once while retaining every
    // target that reuses it for reporting.
    const key = treatment.motion.poseFamilyId;
    const family = stateFamilyMap.get(key) ?? {
      targetIds: new Set(),
      poseFamilyId: treatment.motion.poseFamilyId,
      necessity: 'enhancement',
      stateIds: new Set(),
      stateFacings: new Map(),
    };
    family.targetIds.add(treatment.targetId);
    family.stateIds.add(treatment.motion.stateId);
    const priorFacing = family.stateFacings.get(treatment.motion.stateId);
    if (priorFacing && priorFacing !== treatment.motion.facing) {
      throw new Error(
        `状态家族 ${family.poseFamilyId} 的状态 ${treatment.motion.stateId} 跨镜头声明了冲突朝向：${priorFacing} / ${treatment.motion.facing}。请拆分为不同状态，或统一构图方向。`,
      );
    }
    family.stateFacings.set(
      treatment.motion.stateId,
      treatment.motion.facing,
    );
    if (treatment.necessity === 'required') family.necessity = 'required';
    stateFamilyMap.set(key, family);
  }
  const families = [...stateFamilyMap.values()];
  const poseSheetPlans = families
    .map((family) => ({
      targetId: [...family.targetIds].sort()[0],
      targetIds: [...family.targetIds].sort(),
      poseFamilyId: family.poseFamilyId,
      necessity: family.necessity,
      stateIds: [...family.stateIds].sort(),
      stateFacings: [...family.stateFacings.entries()]
        .map(([stateId, facing]) => ({stateId, facing}))
        .sort((left, right) => left.stateId.localeCompare(right.stateId)),
      grid: stateSheetGridForCount(family.stateIds.size),
      providerCalls: 1,
      repairPolicy: 'masked-edit-complete-sheet',
    }))
    .sort((left, right) => left.poseFamilyId.localeCompare(right.poseFamilyId));
  const uniqueContinuousTargets = new Set(
    treatments.filter(({motion}) =>
      ['continuous-transform', 'path-locomotion'].includes(motion.kind),
    ).map(({sceneId, targetId}) => `${sceneId}::${targetId}`),
  );
  const uniqueLocalMotionTargets = new Set(
    treatments
      .filter(
        ({motion, graphic}) =>
          ['continuous-transform', 'path-locomotion', 'visibility-transition', 'motif-field'].includes(
            motion.kind,
          ) || Boolean(graphic),
      )
      .map(({sceneId, targetId}) => `${sceneId}::${targetId}`),
  );
  return {
    requiredStateFamilies: families.filter(({necessity}) => necessity === 'required').length,
    enhancementStateFamilies: families.filter(({necessity}) => necessity === 'enhancement').length,
    totalStateFamilies: families.length,
    totalStates: families.reduce((sum, family) => sum + family.stateIds.size, 0),
    estimatedPoseSheetCalls: families.length,
    maxStatesInFamily: Math.max(0, ...families.map(({stateIds}) => stateIds.size)),
    continuousTargets: uniqueContinuousTargets.size,
    localMotionTargets: uniqueLocalMotionTargets.size,
    visibilityTargets: new Set(
      treatments.filter(({motion}) => motion.kind === 'visibility-transition').map(({sceneId, targetId}) => `${sceneId}::${targetId}`),
    ).size,
    motifFieldTargets: new Set(
      treatments.filter(({motion}) => motion.kind === 'motif-field').map(({sceneId, targetId}) => `${sceneId}::${targetId}`),
    ).size,
    graphicTreatments: treatments.filter(({graphic}) => Boolean(graphic)).length,
    coupledRelationships: scenes.reduce((sum, scene) => sum + scene.compositionPlan.relationships.length, 0),
    avoidedIsolatedStateCalls: families.reduce((sum, family) => sum + Math.max(0, family.stateIds.size - 1), 0),
    poseSheetPlans,
    budget: motionBudget,
  };
};

export const summarizeProfileFulfillment = (scenes, demand, promise = null) => {
  if (!promise) return null;
  const actual = {
    requiredStateFamilies: demand.requiredStateFamilies,
    enhancementStateFamilies: demand.enhancementStateFamilies,
    totalStates: demand.totalStates,
    localMotionTargets: demand.localMotionTargets,
    layeredScenes: scenes.filter(
      (scene) =>
        (scene.compositionPlan?.layerStacks?.length ?? 0) > 0 ||
        (scene.compositionPlan?.patterns ?? []).some((pattern) =>
          [
            'registered-environment',
            'registered-depth-stack',
            'looping-environment',
            'canonical-container',
          ].includes(pattern),
        ),
    ).length,
    parallaxScenes: scenes.filter((scene) =>
      scene.beats.some((beat) =>
        beat.treatments.some(
          (treatment) =>
            treatment.changeClass === 'depth-parallax' ||
            treatment.motion?.preset === 'parallax-camera',
        ),
      ),
    ).length,
    ambientScenes: scenes.filter((scene) =>
      scene.beats.some((beat) =>
        beat.treatments.some(
          (treatment) =>
            treatment.motion?.kind === 'motif-field' ||
            (
              treatment.importance === 'ambient' &&
              treatment.motion?.kind !== 'static'
            ),
        ),
      ),
    ).length,
  };
  const mapping = {
    minRequiredStateFamilies: 'requiredStateFamilies',
    minEnhancementStateFamilies: 'enhancementStateFamilies',
    minTotalStates: 'totalStates',
    minLocalMotionTargets: 'localMotionTargets',
    minLayeredScenes: 'layeredScenes',
    minParallaxScenes: 'parallaxScenes',
    minAmbientScenes: 'ambientScenes',
  };
  const issues = Object.entries(mapping)
    .filter(([promiseKey, actualKey]) => actual[actualKey] < promise[promiseKey])
    .map(
      ([promiseKey, actualKey]) =>
        `${actualKey}: actual ${actual[actualKey]}, promised minimum ${promise[promiseKey]}`,
    );
  return {
    promise,
    actual,
    passed: issues.length === 0,
    issues,
  };
};

export const recalculateProfilePromiseForLockedStaticScenes = ({
  promise,
  scenes,
}) => {
  if (!promise) return null;
  const sceneCount = scenes.length;
  const lockedSceneIds = scenes
    .filter(({motionPolicy}) => motionPolicy === 'locked-static')
    .map(({id}) => id)
    .sort();
  if (lockedSceneIds.length === 0 || sceneCount === 0) {
    return {
      original: promise,
      recalculated: promise,
      lockedSceneIds,
      changed: false,
    };
  }
  const eligibleSceneCount = sceneCount - lockedSceneIds.length;
  const recalculated = {
    ...promise,
    minLocalMotionTargets: Math.ceil(
      promise.minLocalMotionTargets * eligibleSceneCount / sceneCount,
    ),
    minParallaxScenes: Math.min(
      promise.minParallaxScenes,
      eligibleSceneCount,
    ),
    minAmbientScenes: Math.min(
      promise.minAmbientScenes,
      eligibleSceneCount,
    ),
  };
  return {
    original: promise,
    recalculated,
    lockedSceneIds,
    changed: JSON.stringify(recalculated) !== JSON.stringify(promise),
  };
};

export const compileStoryboardDirecting = (
  storyboard,
  {plan, styleProfile} = {},
) => {
  const issues = [];
  if (storyboard.directingSummary !== undefined) {
    addIssue(issues, 'storyboard-derived-summary', '输入不得手写 directingSummary；它由编译器生成。', 'directingSummary');
  }
  if (storyboard.motionContract !== undefined) {
    addIssue(
      issues,
      'storyboard-derived-motion-contract',
      '输入不得手写 motionContract；它由编译器生成。',
      'motionContract',
    );
  }
  const treatmentIds = new Set();
  for (const [sceneIndex, scene] of (storyboard.scenes ?? []).entries()) {
    if (scene.compositionPlan !== undefined || scene.directing !== undefined) {
      addIssue(issues, 'storyboard-derived-fields', '输入不得手写 compositionPlan 或 directing；它们由编译器生成。', `scenes[${sceneIndex}]`);
    }
    const motifTargets = new Map();
    let visualSfxCount = 0;
    const motionPolicy = scene.motionPolicy ?? 'standard';
    if (!['standard', 'locked-static'].includes(motionPolicy)) {
      addIssue(
        issues,
        'storyboard-motion-policy',
        'scene.motionPolicy 必须为 standard 或 locked-static。',
        `scenes[${sceneIndex}].motionPolicy`,
      );
    }
    if (
      motionPolicy === 'locked-static' &&
      (!nonEmpty(scene.staticRationale) ||
        (scene.beats ?? []).some((beat) =>
          (beat.treatments ?? []).some(
            (treatment) =>
              treatment.motion?.kind !== 'static' ||
              treatment.changeClass !== 'static-hold' ||
              treatment.graphic !== null,
          ),
        ))
    ) {
      addIssue(
        issues,
        'storyboard-locked-static-drift',
        'locked-static 镜头必须说明 staticRationale，且全部 treatment 都是无 graphic 的 static-hold。',
        `scenes[${sceneIndex}]`,
      );
    }
    for (const [beatIndex, beat] of (scene.beats ?? []).entries()) {
      const beatLocation = `scenes[${sceneIndex}].beats[${beatIndex}]`;
      if (!Array.isArray(beat.treatments) || beat.treatments.length === 0) {
        addIssue(issues, 'storyboard-beat-treatments', '每个节拍至少需要一个导演 treatment。', `${beatLocation}.treatments`);
      }
      for (const [treatmentIndex, treatment] of (beat.treatments ?? []).entries()) {
        const location = `${beatLocation}.treatments[${treatmentIndex}]`;
        issues.push(...validateTreatment(treatment, {location, beatAt: beat.at}));
        if (treatment.graphic?.role === 'visual-sfx') {
          visualSfxCount += 1;
          if (!nonEmpty(beat.soundCue)) {
            addIssue(
              issues,
              'treatment-visual-sfx-sound-cue',
              'visual-sfx 所属节拍必须声明离散 soundCue。',
              `${beatLocation}.soundCue`,
            );
          }
          if (!nonEmpty(treatment.proofTimeId)) {
            addIssue(
              issues,
              'treatment-visual-sfx-proof',
              'visual-sfx 必须绑定所属节拍的 proofTimeId。',
              `${location}.proofTimeId`,
            );
          }
          const policy = styleProfile?.motion?.visualSfx;
          if (
            policy &&
            !policy.allowedKinds?.includes(treatment.graphic.sfxKind)
          ) {
            addIssue(
              issues,
              'treatment-visual-sfx-style-kind',
              `当前 Style Profile 不允许 ${treatment.graphic.sfxKind} visual-sfx。`,
              `${location}.graphic.sfxKind`,
            );
          }
          if (
            policy &&
            (
              treatment.graphic.durationSeconds <
                policy.durationRangeSeconds?.[0] ||
              treatment.graphic.durationSeconds >
                policy.durationRangeSeconds?.[1]
            )
          ) {
            addIssue(
              issues,
              'treatment-visual-sfx-style-duration',
              `visual-sfx 时长必须位于当前 Style Profile 的 ${policy.durationRangeSeconds?.[0]}–${policy.durationRangeSeconds?.[1]} 秒。`,
              `${location}.graphic.durationSeconds`,
            );
          }
        }
        if (treatment.motion?.kind === 'motif-field') {
          if (motifTargets.has(treatment.targetId)) {
            addIssue(issues, 'treatment-motif-target-duplicate', `单镜头 motif-field 目标只能编排一次：${treatment.targetId}。`, `${location}.targetId`);
          }
          motifTargets.set(treatment.targetId, treatment.motion.count);
        }
        if (treatmentIds.has(treatment.id)) addIssue(issues, 'treatment-id-duplicate', `treatment id 重复：${treatment.id}`, `${location}.id`);
        treatmentIds.add(treatment.id);
        if (treatment.proofTimeId !== null && treatment.proofTimeId !== undefined && treatment.proofTimeId !== beat.proofTimeId) {
          addIssue(issues, 'treatment-proof-drift', 'treatment.proofTimeId 必须与所属 beat.proofTimeId 一致。', `${location}.proofTimeId`);
        }
      }
    }
    const motifInstanceCount = [...motifTargets.values()].reduce(
      (total, count) => total + (Number.isInteger(count) && count > 0 ? count : 0),
      0,
    );
    if (motifInstanceCount > MAX_MOTIF_INSTANCES_PER_SCENE) {
      addIssue(
        issues,
        'treatment-motif-scene-budget',
        `单镜头 motif-field 总实例数必须不超过 ${MAX_MOTIF_INSTANCES_PER_SCENE}，当前为 ${motifInstanceCount}。`,
        `scenes[${sceneIndex}].beats`,
      );
    }
    const visualSfxLimit = styleProfile?.motion?.visualSfx?.maxPerScene;
    if (
      Number.isInteger(visualSfxLimit) &&
      visualSfxCount > visualSfxLimit
    ) {
      addIssue(
        issues,
        'treatment-visual-sfx-scene-budget',
        `当前 Style Profile 每镜头最多允许 ${visualSfxLimit} 个 visual-sfx，当前为 ${visualSfxCount}。`,
        `scenes[${sceneIndex}].beats`,
      );
    }
  }
  if (issues.length > 0) {
    const error = new Error(issues.map(({location, message}) => `${location}: ${message}`).join('\n'));
    error.issues = issues;
    throw error;
  }

  let editorial;
  try {
    editorial = compileEditorialSystem({
      editorial: storyboard.editorial,
      scenes: storyboard.scenes ?? [],
      sceneTransitions: storyboard.sceneTransitions ?? [],
      fps: storyboard.editorial?.timebase?.fps,
    });
  } catch (cause) {
    const error = new Error(cause.message);
    error.issues = cause.issues ?? [{code: 'editorial-compile', message: cause.message, location: 'editorial'}];
    throw error;
  }

  let scenes;
  try {
    scenes = storyboard.scenes.map((scene) =>
      compileScene(scene, {projectSlug: storyboard.slug}),
    );
  } catch (cause) {
    const error = new Error(cause.message);
    error.issues = [{code: 'storyboard-compile', message: cause.message, location: 'scenes'}];
    throw error;
  }
  const encounterIssues = scenes.flatMap((scene, index) =>
    validateEncounterAuthoring(scene, {location: `scenes[${index}]`}),
  );
  if (encounterIssues.length > 0) {
    const error = new Error(
      encounterIssues
        .map(({location, message}) => `${location}: ${message}`)
        .join('\n'),
    );
    error.issues = encounterIssues;
    throw error;
  }
  let motionContract;
  try {
    motionContract = compileMotionContract({
      direction: storyboard.motionDirection,
      scenes,
      sceneTransitions: storyboard.sceneTransitions ?? [],
      editorial,
      styleProfile,
    });
  } catch (cause) {
    const error = new Error(cause.message);
    error.issues =
      cause.issues ?? [
        {
          code: 'motion-contract-compile',
          message: cause.message,
          location: 'motionDirection',
        },
      ];
    throw error;
  }
  const motionBudget = plan?.motionBudget ?? null;
  const demand = summarizeDirectingDemand(scenes, motionBudget);
  const budgetIssues = [];
  if (motionBudget) {
    if (demand.requiredStateFamilies > motionBudget.maxPoseSheetCalls) {
      addIssue(budgetIssues, 'directing-required-state-budget', `必需状态家族 ${demand.requiredStateFamilies} 个，超过 ${plan.productionProfile} 档位的 ${motionBudget.maxPoseSheetCalls} 次姿态母版调用上限；请提高档位或缩小故事范围。`, 'directingSummary.requiredStateFamilies');
    }
    if (demand.totalStateFamilies > motionBudget.maxPoseSheetCalls) {
      addIssue(budgetIssues, 'directing-state-budget', `状态家族共 ${demand.totalStateFamilies} 个，超过 ${motionBudget.maxPoseSheetCalls} 次姿态母版调用上限。先删除 enhancement，不得降级 required 动作。`, 'directingSummary.totalStateFamilies');
    }
    if (demand.maxStatesInFamily > motionBudget.maxStatesPerSheet) {
      addIssue(budgetIssues, 'directing-sheet-capacity', `单个状态家族需要 ${demand.maxStatesInFamily} 格，超过单张母版 ${motionBudget.maxStatesPerSheet} 格上限。`, 'directingSummary.maxStatesInFamily');
    }
    if (demand.continuousTargets > motionBudget.maxContinuousTargets) {
      addIssue(budgetIssues, 'directing-continuous-budget', `连续动效目标 ${demand.continuousTargets} 个，超过档位上限 ${motionBudget.maxContinuousTargets}。`, 'directingSummary.continuousTargets');
    }
  }
  if (budgetIssues.length > 0) {
    const error = new Error(budgetIssues.map(({location, message}) => `${location}: ${message}`).join('\n'));
    error.issues = budgetIssues;
    throw error;
  }
  const profileFulfillment = summarizeProfileFulfillment(
    scenes,
    demand,
    plan?.profilePromise ?? null,
  );
  if (profileFulfillment && !profileFulfillment.passed) {
    addIssue(
      budgetIssues,
      'directing-profile-under-delivery',
      `${plan.productionProfile} storyboard 未履行已批准档位的质量下限：${profileFulfillment.issues.join('；')}。`,
      'directingSummary.profileFulfillment',
    );
  }
  if (budgetIssues.length > 0) {
    const error = new Error(
      budgetIssues
        .map(({location, message}) => `${location}: ${message}`)
        .join('\n'),
    );
    error.issues = budgetIssues;
    throw error;
  }
  const styleProofPlan = compileStyleProofPlan(scenes, {
    motionContractFingerprint: motionContract.fingerprint,
  });
  const generationBudget = summarizeLayerSourcePackages(scenes, {
    poseSheetCalls: demand.estimatedPoseSheetCalls,
    hardCeiling: plan?.assetBudget?.maxGeneratedImages ?? null,
    additionalPlans: collectCanonicalContainerPlans(scenes),
  });
  if (
    Number.isInteger(generationBudget.hardCeiling) &&
    generationBudget.requiredProviderImageCalls >
      generationBudget.hardCeiling
  ) {
    addIssue(
      budgetIssues,
      'directing-image-attempt-budget',
      `source packages 与姿态母版至少需要 ${generationBudget.requiredProviderImageCalls} 次图片 provider 调用，超过 ${plan.productionProfile} 档位硬上限 ${generationBudget.hardCeiling}；请提高档位、使用可靠批量状态来源或缩小范围。`,
      'directingSummary.generationBudget.requiredProviderImageCalls',
    );
  }
  if (budgetIssues.length > 0) {
    const error = new Error(
      budgetIssues
        .map(({location, message}) => `${location}: ${message}`)
        .join('\n'),
    );
    error.issues = budgetIssues;
    throw error;
  }
  const directingSummary = {
    profile: plan?.productionProfile ?? null,
    ...demand,
    profileFulfillment,
    generationBudget,
    soundEffectPlan: soundEffectPlanFor({
      slug: storyboard.slug,
      scenes,
    }),
    styleProofPlan,
  };
  directingSummary.fingerprint = hashCompositionValue({
    scenes: scenes.map(({id, directing, compositionPlan}) => ({id, directing, compositionPlan})),
    sceneTransitions: storyboard.sceneTransitions,
    spatialContracts: storyboard.spatialContracts ?? [],
    editorialFingerprint: editorial.fingerprint,
    motionContractFingerprint: motionContract.fingerprint,
    demand: {...directingSummary, budget: undefined, fingerprint: undefined},
  });
  return {
    ...storyboard,
    motionContract,
    editorial,
    scenes,
    directingSummary,
  };
};

export const validateCompiledDirecting = (
  storyboard,
  {plan, styleProfile} = {},
) => {
  try {
    const authoring = {
      ...storyboard,
      editorial: storyboard.editorial
        ? Object.fromEntries(
            Object.entries(storyboard.editorial).filter(
              ([key]) => !['resolvedEditPoints', 'conflicts', 'responsivePlans', 'transitionPlans', 'fingerprint'].includes(key),
            ),
          )
        : storyboard.editorial,
      scenes: (storyboard.scenes ?? []).map(({compositionPlan, directing, ...scene}) => scene),
      motionContract: undefined,
      directingSummary: undefined,
    };
    const effectiveStyleProfile =
      styleProfile ??
      (storyboard.motionContract?.styleProfileBinding
        ? {
            id: storyboard.motionContract.styleProfileBinding.id,
            profileFingerprint:
              storyboard.motionContract.styleProfileBinding
                .profileFingerprint,
            motion: {
              pacing:
                storyboard.motionContract.styleProfileBinding.pacing,
            },
          }
        : null);
    const compiled = compileStoryboardDirecting(authoring, {
      plan,
      styleProfile: effectiveStyleProfile,
    });
    const issues = [];
    for (const [index, scene] of compiled.scenes.entries()) {
      const actual = storyboard.scenes[index];
      if (JSON.stringify(actual.compositionPlan) !== JSON.stringify(scene.compositionPlan)) {
        addIssue(issues, 'storyboard-composition-plan-drift', 'compositionPlan 不是当前 treatments 的编译结果。', `scenes[${index}].compositionPlan`);
      }
      if (JSON.stringify(actual.directing) !== JSON.stringify(scene.directing)) {
        addIssue(issues, 'storyboard-directing-drift', 'directing 指纹或风险摘要已过期。', `scenes[${index}].directing`);
      }
    }
    if (JSON.stringify(storyboard.directingSummary) !== JSON.stringify(compiled.directingSummary)) {
      addIssue(issues, 'storyboard-directing-summary-drift', 'directingSummary 已过期。', 'directingSummary');
    }
    issues.push(
      ...validateCompiledMotionContract({
        storyboard,
        styleProfile: effectiveStyleProfile,
      }),
    );
    return issues;
  } catch (error) {
    return error.issues ?? [{code: 'storyboard-directing-invalid', message: error.message, location: 'scenes'}];
  }
};

const hasVisibleNodeMotion = (node) => {
  if (node?.motion?.path) return true;
  if (node?.motion?.idle && node.motion.idle.preset !== 'still' && node.motion.idle.intensity > 0) return true;
  const frames = node?.motion?.keyframes ?? [];
  const moves = frames.length >= 2 && ['offsetX', 'offsetY', 'scale', 'rotation', 'opacity'].some((property) => {
    const values = frames.map((frame) => frame[property]).filter((value) => value !== undefined);
    return values.length > 0 && new Set(values).size > 1;
  });
  if (moves) return true;
  return (
    node?.kind === 'group' &&
    node.stackingContext === 'scene' &&
    (node.children ?? []).some(hasVisibleNodeMotion)
  );
};

const traverseSpan = (node) => {
  const frames = node?.motion?.keyframes ?? [];
  let maximum = 0;
  for (const left of frames) {
    for (const right of frames) {
      maximum = Math.max(
        maximum,
        Math.hypot(
          (right.offsetX ?? 0) - (left.offsetX ?? 0),
          (right.offsetY ?? 0) - (left.offsetY ?? 0),
        ),
      );
    }
  }
  return maximum;
};

export const validateDirectingExecution = ({scene, storyboardScene, location = 'scene'}) => {
  const issues = [];
  const flattenedNodes = flattenCompositionNodes(scene?.composition?.nodes);
  const nodes = new Map(flattenedNodes.map(({node}) => [node.id, node]));
  const derivationOnlyNodeIds = new Set(
    flattenedNodes
      .filter(
        ({renderParticipation}) => renderParticipation === 'derivation-only',
      )
      .map(({node}) => node.id),
  );
  for (const planned of storyboardScene?.compositionPlan?.stateSequences ?? []) {
    const node = nodes.get(planned.nodeId);
    if (derivationOnlyNodeIds.has(planned.nodeId)) {
      addIssue(
        issues,
        'directing-derivation-only-target',
        `导演计划不能由 derivation-only 状态家族 ${planned.nodeId} 履行。`,
        `${location}.composition.nodes#${planned.nodeId}`,
      );
      continue;
    }
    const runtimeShape = node && {
      poseFamilyId: node.poseFamilyId,
      states: node.states?.map(({id, at, facing}) => ({id, at, facing})),
      playback: node.playback,
      pathViewBinding: node.pathViewBinding,
      transition: node.transition?.type,
    };
    const plannedShape = {
      poseFamilyId: planned.poseFamilyId,
      states: planned.states.map(({id, at, facing}) => ({id, at, facing})),
      playback: planned.playback,
      pathViewBinding: planned.pathViewBinding,
      transition: planned.transition,
    };
    if (node?.kind !== 'state-sequence' || JSON.stringify(runtimeShape) !== JSON.stringify(plannedShape)) {
      addIssue(issues, 'directing-state-sequence-drift', `状态家族 ${planned.nodeId} 与编译计划不一致。`, `${location}.composition.nodes#${planned.nodeId}`);
    }
  }
  for (
    const planned of
      storyboardScene?.compositionPlan?.canonicalContainers ?? []
  ) {
    const group = nodes.get(planned.groupId);
    const binding = group?.canonicalContainer;
    const contents = group?.children?.find(
      ({id}) => id === planned.targetId,
    );
    const runtimeShape = binding && {
      familyId: binding.familyId,
      sourcePackageId: binding.sourcePackageId,
      sourceStrategy: binding.sourceStrategy,
      registrationId: group.registration?.id,
      sourceMasterAssetId: group.registration?.sourceMasterAssetId,
      canvas: group.registration?.canvas,
      cleanPlateAssetId: binding.cleanPlateAssetId,
      canonicalFrameAssetId: binding.canonicalFrameAssetId,
      contentSheetAssetId: binding.contentSheetAssetId,
      interiorMaskAssetId: binding.interiorMaskAssetId,
      authoritativeSurfaceId: binding.authoritativeSurfaceId,
      interiorShape: binding.interiorShape,
      alignmentPolicy: binding.alignmentPolicy,
      states: binding.states?.map(({id, fillLevel}) => ({
        id,
        at: contents?.states?.find((state) => state.id === id)?.at,
        fillLevel,
      })),
      terminalStateId: binding.terminalStateId,
      terminalPolicy: binding.terminalPolicy,
      recoveryPolicy: binding.recoveryPolicy,
    };
    const plannedShape = {
      familyId: planned.familyId,
      sourcePackageId: planned.sourcePackageId,
      sourceStrategy: planned.sourceStrategy,
      registrationId: planned.registrationId,
      sourceMasterAssetId: planned.sourceMasterAssetId,
      canvas: planned.canvas,
      cleanPlateAssetId: planned.cleanPlateAssetId,
      canonicalFrameAssetId: planned.canonicalFrameAssetId,
      contentSheetAssetId: planned.contentSheetAssetId,
      interiorMaskAssetId: planned.interiorMaskAssetId,
      authoritativeSurfaceId: planned.authoritativeSurfaceId,
      interiorShape: planned.interiorShape,
      alignmentPolicy: planned.alignmentPolicy,
      states: planned.states.map(({id, at, fillLevel}) => ({
        id,
        at,
        fillLevel,
      })),
      terminalStateId: planned.terminalStateId,
      terminalPolicy: planned.terminalPolicy,
      recoveryPolicy: planned.recoveryPolicy,
    };
    if (
      group?.kind !== 'group' ||
      group.pattern !== 'canonical-container' ||
      contents?.kind !== 'state-sequence' ||
      binding?.contentsNodeId !== planned.targetId ||
      JSON.stringify(runtimeShape) !== JSON.stringify(plannedShape)
    ) {
      addIssue(
        issues,
        'directing-canonical-container-drift',
        `容器机制 ${planned.groupId} 与编译计划不一致。`,
        `${location}.composition.nodes#${planned.groupId}`,
      );
    }
  }
  for (const planned of storyboardScene?.compositionPlan?.pathMotions ?? []) {
    const node = nodes.get(planned.nodeId);
    if (!node) {
      addIssue(
        issues,
        'directing-path-target-missing',
        `二维路径目标不存在：${planned.nodeId}。`,
        `${location}.composition.nodes#${planned.nodeId}`,
      );
      continue;
    }
    if (derivationOnlyNodeIds.has(planned.nodeId)) {
      addIssue(
        issues,
        'directing-derivation-only-target',
        `二维路径不能由 derivation-only 节点 ${planned.nodeId} 履行。`,
        `${location}.composition.nodes#${planned.nodeId}`,
      );
      continue;
    }
    if (
      node.kind !== 'state-sequence' ||
      JSON.stringify(node.motion?.path) !== JSON.stringify(planned.path)
    ) {
      addIssue(
        issues,
        'directing-path-motion-drift',
        `二维路径 ${planned.nodeId} 与编译计划不一致。`,
        `${location}.composition.nodes#${planned.nodeId}.motion.path`,
      );
    }
    if (
      planned.cameraFollow !== null &&
      JSON.stringify(scene.camera?.follow ?? null) !==
        JSON.stringify(planned.cameraFollow)
    ) {
      addIssue(
        issues,
        'directing-path-camera-drift',
        `二维路径 ${planned.nodeId} 的 camera follow 与编译计划不一致。`,
        `${location}.camera.follow`,
      );
    }
  }
  for (const planned of storyboardScene?.compositionPlan?.continuousMotions ?? []) {
    if (planned.preset === 'parallax-camera') {
      const depths = new Set(collectParallaxDepths(scene?.composition?.nodes ?? []).map(({depth}) => depth));
      if (
        planned.nodeId !== 'scene-camera' ||
        !scene?.camera?.parallax?.enabled ||
        depths.size < 2
      ) {
        addIssue(issues, 'directing-parallax-drift', `导演计划要求确定性景深视差 ${planned.id}，但 camera.parallax 或 depth 层级未按计划实现。`, `${location}.camera.parallax`);
      }
      continue;
    }
    if (planned.nodeId === 'scene-camera') {
      const cameraMoves = scene?.camera?.preset !== 'static' || (scene?.camera?.keyframes?.length ?? 0) >= 2;
      if (!cameraMoves) {
        addIssue(issues, 'directing-continuous-drift', `导演计划要求镜头运动 ${planned.id}，但 camera 为静止。`, `${location}.camera`);
      }
      continue;
    }
    const node = nodes.get(planned.nodeId);
    if (!node) {
      addIssue(issues, 'directing-target-missing', `导演计划的连续动效目标不存在：${planned.nodeId}。`, `${location}.composition`);
    } else if (derivationOnlyNodeIds.has(planned.nodeId)) {
      addIssue(
        issues,
        'directing-derivation-only-target',
        `导演计划不能由 derivation-only 节点 ${planned.nodeId} 履行。`,
        `${location}.composition.nodes#${planned.nodeId}`,
      );
    } else if (planned.preset === 'scroll-world-x') {
      const worldPlan = storyboardScene.compositionPlan.loopingEnvironments?.find(
        ({targetId}) => targetId === planned.nodeId,
      );
      const environment = node.loopingEnvironment;
      const runtimeShape = environment && {
        axis: environment.axis,
        direction: environment.travel.direction,
        distanceViewports: environment.travel.distanceViewports,
        speedRange: environment.speedRange,
        groundStripId: environment.groundStripId,
        subjectBindings: environment.subjectBindings,
        seamProofTimeIds: environment.seamProofTimeIds,
        closedLoop: environment.travel.closedLoop,
        startPhase: environment.travel.startPhase,
        activeFrom: environment.travel.activeFrom ?? 0,
        activeUntil: environment.travel.activeUntil ?? null,
        easing: environment.travel.easing,
        frozen: environment.travel.frozen === true,
        strips: (node.children ?? [])
          .filter(({kind}) => kind === 'world-strip')
          .map(({id, role, surfaceRole, depth}) => ({id, role, surfaceRole, depth})),
      };
      const plannedShape = worldPlan && {
        axis: worldPlan.axis,
        direction: worldPlan.direction,
        distanceViewports: worldPlan.distanceViewports,
        speedRange: worldPlan.speedRange,
        groundStripId: worldPlan.groundStripId,
        subjectBindings: worldPlan.subjectBindings,
        seamProofTimeIds: worldPlan.seamProofTimeIds,
        closedLoop: worldPlan.closedLoop,
        startPhase: worldPlan.startPhase,
        activeFrom: worldPlan.activeFrom ?? 0,
        activeUntil: worldPlan.activeUntil ?? null,
        easing: worldPlan.easing,
        frozen: worldPlan.frozen === true,
        strips: worldPlan.strips,
      };
      if (
        node.kind !== 'group' ||
        node.pattern !== 'looping-environment' ||
        JSON.stringify(runtimeShape) !== JSON.stringify(plannedShape)
      ) {
        addIssue(issues, 'directing-looping-world-drift', `循环世界 ${planned.nodeId} 与编译计划不一致。`, `${location}.composition.nodes#${planned.nodeId}`);
      }
    } else if (!hasVisibleNodeMotion(node)) {
      addIssue(issues, 'directing-continuous-drift', `导演计划要求 ${planned.nodeId} 执行 ${planned.preset}，但节点没有可见关键帧或 idle。`, `${location}.composition.nodes#${planned.nodeId}.motion`);
    } else if (
      planned.preset === 'traverse' &&
      traverseSpan(node) < 0.45
    ) {
      addIssue(
        issues,
        'directing-traverse-span',
        `导演计划要求 ${planned.nodeId} 执行大幅主体航迹，但最大相对位移不足画布对角归一化 0.45。`,
        `${location}.composition.nodes#${planned.nodeId}.motion.keyframes`,
      );
    } else if (
      planned.preset === 'sway' &&
      (
        node.motion?.idle?.preset !== 'sway' ||
        (node.motion?.pivot?.y ?? 0) < 0.8
      )
    ) {
      addIssue(
        issues,
        'directing-sway-pivot',
        `导演计划要求 ${planned.nodeId} 以底部支点连续摆动。`,
        `${location}.composition.nodes#${planned.nodeId}.motion`,
      );
    }
  }
  for (const planned of storyboardScene?.compositionPlan?.motifFields ?? []) {
    const node = nodes.get(planned.nodeId);
    if (!node) {
      addIssue(issues, 'directing-motif-missing', `导演计划的 motif-field 目标不存在：${planned.nodeId}。`, `${location}.composition`);
    } else if (
      node.kind !== 'motif-field' ||
      node.fieldMotion?.preset !== planned.preset ||
      node.fieldMotion?.cycles !== planned.cycles ||
      node.distribution !== planned.distribution ||
      node.count !== planned.count ||
      JSON.stringify(node.bounds) !== JSON.stringify(planned.bounds) ||
      JSON.stringify(node.exclusionZones) !== JSON.stringify(planned.exclusionZones) ||
      JSON.stringify(node.worldBinding ?? null) !== JSON.stringify(planned.worldBinding ?? null)
    ) {
      addIssue(issues, 'directing-motif-drift', `motif-field ${planned.nodeId} 与故事板计划不一致。`, `${location}.composition.nodes#${planned.nodeId}`);
    }
  }
  for (const planned of storyboardScene?.compositionPlan?.visibilityEvents ?? []) {
    const node = nodes.get(planned.nodeId);
    const event = (scene?.events ?? []).find((candidate) =>
      candidate.targetId === planned.nodeId &&
      candidate.beatId === planned.beatId &&
      Math.abs(candidate.at - planned.at) <= 0.035 &&
      candidate.visual?.kind === 'visibility' &&
      candidate.visual.action === planned.action &&
      candidate.visual.transition === planned.transition &&
      candidate.visual.durationSeconds === planned.durationSeconds,
    );
    if (!node) {
      addIssue(issues, 'directing-visibility-target-missing', `导演计划的可见性目标不存在：${planned.nodeId}。`, `${location}.composition`);
    } else if (!event) {
      addIssue(issues, 'directing-visibility-drift', `导演计划要求 ${planned.nodeId} 执行 ${planned.action}/${planned.transition}，项目没有对应 visibility event。`, `${location}.events`);
    } else if (planned.action === 'show' && node.visibility?.initial !== 'hidden' && !(scene.events ?? []).some((candidate) => candidate.targetId === planned.nodeId && candidate.at < planned.at && candidate.visual?.kind === 'visibility' && candidate.visual.action === 'hide')) {
      addIssue(issues, 'directing-visibility-initial', `首次 show 前 ${planned.nodeId} 必须初始隐藏或先执行 hide。`, `${location}.composition.nodes#${planned.nodeId}.visibility`);
    }
  }
  for (const planned of storyboardScene?.compositionPlan?.graphics ?? []) {
    const node = nodes.get(planned.nodeId);
    if (!node) {
      addIssue(issues, 'directing-graphic-missing', `导演计划的图形目标不存在：${planned.nodeId}。`, `${location}.composition`);
    } else if (node.kind !== planned.kind) {
      addIssue(issues, 'directing-graphic-kind', `图形目标 ${planned.nodeId} 必须实现为 ${planned.kind}，当前为 ${node.kind}。`, `${location}.composition.nodes#${planned.nodeId}.kind`);
    } else if (planned.role === 'visual-sfx') {
      const durationSeconds =
        Number(scene?.narration?.startSeconds ?? 0) +
        Number(scene?.narration?.durationSeconds ?? 0) +
        Number(scene?.tailSeconds ?? 0);
      const expectedHideAt = Math.min(
        1,
        planned.at + planned.durationSeconds / Math.max(0.001, durationSeconds),
      );
      const events = scene?.events ?? [];
      const matchingEvents = events.filter(
        (event) =>
          event.targetId === planned.nodeId &&
          event.beatId === planned.beatId,
      );
      const show = matchingEvents.find(
        (event) =>
          Math.abs(event.at - planned.at) <= 0.035 &&
          event.visual?.kind === 'visibility' &&
          event.visual.action === 'show' &&
          event.visual.transition === 'fade-scale',
      );
      const emphasis = matchingEvents.find(
        (event) =>
          Math.abs(event.at - planned.at) <= 0.035 &&
          event.visual?.kind === 'emphasis' &&
          event.visual.action === planned.animation,
      );
      const hide = matchingEvents.find(
        (event) =>
          Math.abs(event.at - expectedHideAt) <= 0.035 &&
          event.visual?.kind === 'visibility' &&
          event.visual.action === 'hide' &&
          event.visual.transition === 'fade-scale',
      );
      const sound = matchingEvents.find(
        (event) =>
          Math.abs(event.at - planned.at) <= 0.035 &&
          Boolean(event.sound),
      );
      if (node.role !== 'visual-sfx' || node.text !== planned.text) {
        addIssue(
          issues,
          'directing-visual-sfx-node',
          `visual-sfx ${planned.nodeId} 必须是 role=visual-sfx 且文字精确为“${planned.text}”的 typography 节点。`,
          `${location}.composition.nodes#${planned.nodeId}`,
        );
      }
      if (node.visibility?.initial !== 'hidden') {
        addIssue(
          issues,
          'directing-visual-sfx-initial',
          `visual-sfx ${planned.nodeId} 必须初始隐藏。`,
          `${location}.composition.nodes#${planned.nodeId}.visibility`,
        );
      }
      if (!show || !emphasis || !hide || !sound) {
        addIssue(
          issues,
          'directing-visual-sfx-events',
          `visual-sfx ${planned.nodeId} 必须在同一节拍包含 fade-scale show、${planned.animation} emphasis、约 ${planned.durationSeconds}s 后的 fade-scale hide，以及同步音效。`,
          `${location}.events`,
        );
      }
      if (
        ![show, emphasis, sound]
          .filter(Boolean)
          .some((event) => event.proofTimeId === planned.proofTimeId)
      ) {
        addIssue(
          issues,
          'directing-visual-sfx-proof',
          `visual-sfx ${planned.nodeId} 的出现、强调或音效事件必须绑定 ${planned.proofTimeId}。`,
          `${location}.events`,
        );
      }
    } else if (!hasVisibleNodeMotion(node)) {
      addIssue(issues, 'directing-graphic-motion', `图形目标 ${planned.nodeId} 必须实现 ${planned.animation} 动效。`, `${location}.composition.nodes#${planned.nodeId}.motion`);
    }
  }
  for (
    const planned of
      storyboardScene?.compositionPlan?.soundEffects ?? []
  ) {
    const expectedSource = String(planned.output)
      .replace(/^public[\\/]/, '')
      .split('\\')
      .join('/');
    const event = (scene?.events ?? []).find(
      (candidate) =>
        candidate.beatId === planned.beatId &&
        Math.abs(candidate.at - planned.at) <= 0.035 &&
        candidate.sound?.src === expectedSource,
    );
    if (!event) {
      addIssue(
        issues,
        'directing-sound-effect-drift',
        `节拍 ${planned.beatId} 必须绑定已编译音效 ${expectedSource}。`,
        `${location}.events`,
      );
    }
  }
  return issues;
};

export const selectStyleProofTarget = (storyboard) => {
  return storyboard?.directingSummary?.styleProofPlan?.targets?.[0] ?? null;
};

export const selectStyleProofTargets = (storyboard) =>
  storyboard?.directingSummary?.styleProofPlan?.targets ?? [];
