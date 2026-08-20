import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  COMPOSITION_PATTERNS,
  RELATIONSHIP_PREDICATES,
  compileStoryboardDirecting,
  validateCompiledDirecting,
} from './motion-treatment-lib.mjs';
import {validateSceneTransitionSequence} from '../src/sceneTimeline.mjs';
import {validateCompiledEditorial} from './editorial-system-lib.mjs';
import {validateStoryboardSpatialContracts} from './spatial-contract-lib.mjs';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIRECTORY, '..');
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const STORY_BLUEPRINTS = [
  'layered-reveal',
  'map-journey',
  'archive-stack',
  'character-procession',
  'discovery-wipe',
  'transformation-tableau',
  'chapter-tableau',
  'quiet-lockup',
];

export const PROOF_KINDS = ['establish', 'action', 'peak', 'final'];
export {COMPOSITION_PATTERNS, RELATIONSHIP_PREDICATES, compileStoryboardDirecting};

const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;
const normalizedTime = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

export const storyboardFileFor = (slug) => {
  if (!SLUG_PATTERN.test(slug ?? '')) throw new Error(`无效项目 slug：${slug}`);
  return path.join(ROOT, 'projects', slug, 'storyboard.json');
};

export const validateStoryboard = (
  storyboard,
  {slug, plan, styleProfile} = {},
) => {
  const issues = [];
  const add = (code, message, location) => issues.push({code, message, location});
  if (storyboard?.schemaVersion !== 12) {
    add('storyboard-schema-version', 'storyboard.schemaVersion 必须为 12。', 'schemaVersion');
  }
  if (storyboard?.slug !== slug) {
    add('storyboard-slug', `storyboard.slug 必须为 ${slug}。`, 'slug');
  }
  if (!['pending', 'ready'].includes(storyboard?.status)) {
    add('storyboard-status', 'storyboard.status 必须为 pending 或 ready。', 'status');
  }
  if (storyboard?.status !== 'ready') return issues;

  for (const editorialIssue of validateCompiledEditorial({
    editorial: storyboard.editorial,
    scenes: storyboard.scenes ?? [],
    sceneTransitions: storyboard.sceneTransitions ?? [],
    fps: storyboard.editorial?.timebase?.fps,
  })) {
    add(editorialIssue.code, editorialIssue.message, editorialIssue.location);
  }

  if (!nonEmpty(storyboard.arc)) add('storyboard-arc', '故事板必须写明全片叙事弧。', 'arc');
  const style = storyboard.style;
  if (!style || typeof style !== 'object') {
    add('storyboard-style', '故事板必须包含 style。', 'style');
  } else {
    for (const key of ['visualThesis', 'layerStrategy']) {
      if (!nonEmpty(style[key])) add(`storyboard-style-${key}`, `style.${key} 不能为空。`, `style.${key}`);
    }
    for (const key of ['compositionRules']) {
      if (!Array.isArray(style[key]) || style[key].length === 0 || style[key].some((item) => !nonEmpty(item))) {
        add(`storyboard-style-${key}`, `style.${key} 必须包含至少一条明确规则。`, `style.${key}`);
      }
    }
  }

  const scenes = storyboard.scenes;
  if (!Array.isArray(scenes) || scenes.length === 0) {
    add('storyboard-scenes', 'ready 故事板至少需要一个镜头。', 'scenes');
    return issues;
  }
  if (plan?.status === 'resolved' && scenes.length !== plan.resolved?.sceneCount) {
    add(
      'storyboard-scene-count',
      `故事板需要 ${plan.resolved?.sceneCount} 个镜头，当前为 ${scenes.length} 个。`,
      'scenes',
    );
  }
  for (const issue of validateSceneTransitionSequence({
    scenes,
    sceneTransitions: storyboard.sceneTransitions,
  })) {
    add(`storyboard-${issue.code}`, issue.message, issue.location);
  }
  for (const issue of validateStoryboardSpatialContracts(storyboard)) {
    add(issue.code, issue.message, issue.location);
  }
  const sceneIds = new Set();
  let estimatedDuration = 0;
  for (const [sceneIndex, scene] of scenes.entries()) {
    const location = `scenes[${sceneIndex}]`;
    if (!nonEmpty(scene.id) || sceneIds.has(scene.id)) {
      add('storyboard-scene-id', '镜头 id 缺失或重复。', `${location}.id`);
    }
    sceneIds.add(scene.id);
    for (const key of ['title', 'narrativeRole', 'message']) {
      if (!nonEmpty(scene[key])) add(`storyboard-scene-${key}`, `${key} 不能为空。`, `${location}.${key}`);
    }
    if (!STORY_BLUEPRINTS.includes(scene.blueprint)) {
      add('storyboard-blueprint', `未知镜头蓝图：${scene.blueprint}`, `${location}.blueprint`);
    }
    if (!(typeof scene.estimatedDurationSeconds === 'number' && scene.estimatedDurationSeconds > 0)) {
      add('storyboard-duration', 'estimatedDurationSeconds 必须大于 0。', `${location}.estimatedDurationSeconds`);
    } else {
      estimatedDuration += scene.estimatedDurationSeconds;
    }
    const compositionPlan = scene.compositionPlan;
    if (!compositionPlan || typeof compositionPlan !== 'object') {
      add('storyboard-composition-plan', '每个镜头必须声明 compositionPlan。', `${location}.compositionPlan`);
    } else {
      if (
        !Array.isArray(compositionPlan.patterns) ||
        compositionPlan.patterns.length === 0 ||
        compositionPlan.patterns.some((pattern) => !COMPOSITION_PATTERNS.includes(pattern))
      ) {
        add('storyboard-composition-pattern', 'compositionPlan.patterns 必须使用受支持的组合模式。', `${location}.compositionPlan.patterns`);
      }
      if (!Array.isArray(compositionPlan.relationships)) {
        add('storyboard-composition-relationships', 'compositionPlan.relationships 必须是数组。', `${location}.compositionPlan.relationships`);
      }
      const relationshipIds = new Set();
      for (const [relationshipIndex, relationship] of (compositionPlan.relationships ?? []).entries()) {
        const relationshipLocation = `${location}.compositionPlan.relationships[${relationshipIndex}]`;
        if (!nonEmpty(relationship.id) || relationshipIds.has(relationship.id)) {
          add('storyboard-relationship-id', '关系 id 缺失或重复。', `${relationshipLocation}.id`);
        }
        relationshipIds.add(relationship.id);
        for (const key of ['subject', 'object', 'proof']) {
          if (!nonEmpty(relationship[key])) add(`storyboard-relationship-${key}`, `关系 ${key} 不能为空。`, `${relationshipLocation}.${key}`);
        }
        if (!RELATIONSHIP_PREDICATES.includes(relationship.predicate)) {
          add('storyboard-relationship-predicate', `未知关系 predicate：${relationship.predicate}`, `${relationshipLocation}.predicate`);
        }
        const requiredPattern = ['inside', 'on', 'held-by', 'worn-by'].includes(relationship.predicate)
          ? 'supported-subject'
          : 'registered-environment';
        if (!(compositionPlan.patterns ?? []).includes(requiredPattern)) {
          add('storyboard-relationship-pattern', `关系 ${relationship.id} 必须声明模式 ${requiredPattern}。`, `${location}.compositionPlan.patterns`);
        }
      }
      if (!Array.isArray(compositionPlan.stateSequences)) {
        add('storyboard-state-sequences', 'compositionPlan.stateSequences 必须是数组。', `${location}.compositionPlan.stateSequences`);
      }
      const sequenceIds = new Set();
      for (const [sequenceIndex, sequence] of (compositionPlan.stateSequences ?? []).entries()) {
        const sequenceLocation = `${location}.compositionPlan.stateSequences[${sequenceIndex}]`;
        if (!nonEmpty(sequence.nodeId) || sequenceIds.has(sequence.nodeId)) add('storyboard-sequence-node-id', '状态序列 nodeId 缺失或重复。', `${sequenceLocation}.nodeId`);
        sequenceIds.add(sequence.nodeId);
        if (!nonEmpty(sequence.poseFamilyId)) add('storyboard-sequence-family', '状态序列必须声明 poseFamilyId。', `${sequenceLocation}.poseFamilyId`);
        const playback = sequence.playback;
        if (!['once', 'loop', 'ping-pong'].includes(playback?.mode) || !(Number.isInteger(playback?.cycles) && playback.cycles > 0)) {
          add('storyboard-sequence-playback', '状态序列 playback 必须声明有效 mode 与正整数 cycles。', `${sequenceLocation}.playback`);
        }
        if (playback?.mode === 'once' && playback.cycles !== 1) add('storyboard-sequence-once-cycles', 'once playback 的 cycles 必须为 1。', `${sequenceLocation}.playback.cycles`);
        if (playback?.activeFrom !== undefined && !(normalizedTime(playback.activeFrom) && playback.activeFrom > 0 && playback.activeFrom < 1)) add('storyboard-sequence-active-from', 'activeFrom 必须位于 0..1 之间。', `${sequenceLocation}.playback.activeFrom`);
        if ((playback?.activeUntil === undefined) !== (playback?.holdStateId === undefined)) add('storyboard-sequence-hold-window', 'activeUntil 与 holdStateId 必须同时声明。', `${sequenceLocation}.playback`);
        if (playback?.activeUntil !== undefined && !(normalizedTime(playback.activeUntil) && playback.activeUntil > 0 && playback.activeUntil < 1)) add('storyboard-sequence-active-until', 'activeUntil 必须位于 0..1 之间。', `${sequenceLocation}.playback.activeUntil`);
        if (playback?.activeFrom !== undefined && playback?.activeUntil !== undefined && playback.activeFrom >= playback.activeUntil) add('storyboard-sequence-active-window', 'activeFrom 必须早于 activeUntil。', `${sequenceLocation}.playback`);
        if (playback?.activeStateIds !== undefined && (
          playback.activeFrom === undefined ||
          !Array.isArray(playback.activeStateIds) ||
          playback.activeStateIds.length < 2 ||
          new Set(playback.activeStateIds).size !== playback.activeStateIds.length
        )) add('storyboard-sequence-active-states', 'activeStateIds 需要 activeFrom 和至少两个不重复状态。', `${sequenceLocation}.playback.activeStateIds`);
        if (!['cut', 'crossfade'].includes(sequence.transition)) add('storyboard-sequence-transition', '状态序列 transition 无效。', `${sequenceLocation}.transition`);
        const stateIds = new Set();
        let previousStateAt = -1;
        if (!Array.isArray(sequence.states) || sequence.states.length < 2) add('storyboard-sequence-states', '状态序列至少需要两个状态。', `${sequenceLocation}.states`);
        for (const [stateIndex, state] of (sequence.states ?? []).entries()) {
          const stateLocation = `${sequenceLocation}.states[${stateIndex}]`;
          if (!nonEmpty(state.id) || stateIds.has(state.id)) add('storyboard-sequence-state-id', '状态 id 缺失或重复。', `${stateLocation}.id`);
          stateIds.add(state.id);
          if (!normalizedTime(state.at) || state.at <= previousStateAt) add('storyboard-sequence-state-at', '状态 at 必须位于 0..1 且严格递增。', `${stateLocation}.at`);
          previousStateAt = state.at;
          if (!nonEmpty(state.visualChange)) add('storyboard-sequence-visual-change', '状态必须描述可见变化。', `${stateLocation}.visualChange`);
        }
        if (sequence.states?.[0]?.at !== 0) add('storyboard-sequence-start', '状态序列必须从 at=0 开始。', `${sequenceLocation}.states[0].at`);
        if (playback?.holdStateId !== undefined && !stateIds.has(playback.holdStateId)) add('storyboard-sequence-hold-state', 'holdStateId 必须引用一个已声明状态。', `${sequenceLocation}.playback.holdStateId`);
        if (playback?.activeStateIds !== undefined) {
          const stateIndex = new Map((sequence.states ?? []).map(({id}, index) => [id, index]));
          for (const id of playback.activeStateIds) {
            if (!stateIds.has(id)) add('storyboard-sequence-active-state', `activeStateIds 引用了未知状态 ${id}。`, `${sequenceLocation}.playback.activeStateIds`);
          }
          for (let index = 1; index < playback.activeStateIds.length; index += 1) {
            if (stateIndex.get(playback.activeStateIds[index - 1]) >= stateIndex.get(playback.activeStateIds[index])) add('storyboard-sequence-active-order', 'activeStateIds 必须与 states 的顺序一致。', `${sequenceLocation}.playback.activeStateIds`);
          }
          const activeIds = new Set(playback.activeStateIds);
          const exitStates = [];
          for (const state of sequence.states ?? []) {
            if (activeIds.has(state.id) || state.id === playback.holdStateId) continue;
            if (state.at < playback.activeFrom) continue;
            if (
              playback.activeUntil !== undefined &&
              state.at >= playback.activeUntil
            ) {
              exitStates.push(state);
              continue;
            }
            add('storyboard-sequence-segment-state', `非活动状态 ${state.id} 必须早于 activeFrom，或在 activeUntil 后作为结束序列。`, `${sequenceLocation}.states`);
          }
          if (exitStates.length > 0) {
            const hold = sequence.states.find(
              ({id}) => id === playback.holdStateId,
            );
            if (
              exitStates[0].at !== playback.activeUntil ||
              !hold ||
              hold.at < exitStates.at(-1).at
            ) {
              add('storyboard-sequence-exit-order', '结束序列必须从 activeUntil 开始，并以 holdStateId 作为最后状态。', `${sequenceLocation}.states`);
            }
          }
        }
      }
      if (!Array.isArray(compositionPlan.continuousMotions)) {
        add('storyboard-continuous-motions', 'compositionPlan.continuousMotions 必须是数组。', `${location}.compositionPlan.continuousMotions`);
      }
      if (!Array.isArray(compositionPlan.visibilityEvents)) {
        add('storyboard-visibility-events', 'compositionPlan.visibilityEvents 必须是数组。', `${location}.compositionPlan.visibilityEvents`);
      }
      if (!Array.isArray(compositionPlan.graphics)) {
        add('storyboard-graphics', 'compositionPlan.graphics 必须是数组。', `${location}.compositionPlan.graphics`);
      }
      if (!Array.isArray(compositionPlan.soundEffects)) {
        add(
          'storyboard-sound-effects',
          'compositionPlan.soundEffects 必须是由 soundCue 编译出的数组。',
          `${location}.compositionPlan.soundEffects`,
        );
      }
    }
    if (!Array.isArray(scene.beats) || scene.beats.length < 3) {
      add('storyboard-beats', '每个镜头至少需要 3 个节拍。', `${location}.beats`);
    }
    const beatIds = new Set();
    const beatEvidenceBindings = [];
    let previousBeat = -1;
    for (const [beatIndex, beat] of (scene.beats ?? []).entries()) {
      const beatLocation = `${location}.beats[${beatIndex}]`;
      if (!nonEmpty(beat.id) || beatIds.has(beat.id)) add('storyboard-beat-id', '节拍 id 缺失或重复。', `${beatLocation}.id`);
      beatIds.add(beat.id);
      if (!normalizedTime(beat.at) || beat.at <= previousBeat) {
        add('storyboard-beat-time', '节拍 at 必须位于 0..1 且严格递增。', `${beatLocation}.at`);
      }
      previousBeat = beat.at;
      for (const key of ['purpose', 'visual']) {
        if (!nonEmpty(beat[key])) add(`storyboard-beat-${key}`, `${key} 不能为空。`, `${beatLocation}.${key}`);
      }
      if (!Array.isArray(beat.treatments) || beat.treatments.length === 0) {
        add('storyboard-beat-treatments', '每个节拍至少需要一个导演 treatment。', `${beatLocation}.treatments`);
      }
      if (Object.hasOwn(beat, 'audioCue')) {
        add(
          'storyboard-beat-audio-cue-legacy',
          'audioCue 已移除：离散事件音效请使用 soundCue，旁白只属于 scene.narration。',
          `${beatLocation}.audioCue`,
        );
      }
      if (!Object.hasOwn(beat, 'soundCue')) {
        add(
          'storyboard-beat-sound-field',
          'v12 节拍必须显式声明 soundCue（离散事件音效字符串或 null）。',
          `${beatLocation}.soundCue`,
        );
      }
      if (beat.soundCue !== null && beat.soundCue !== undefined && !nonEmpty(beat.soundCue)) {
        add('storyboard-beat-sound', 'soundCue 必须为离散事件音效的非空字符串或 null；旁白只属于 scene.narration。', `${beatLocation}.soundCue`);
      }
      if (!Object.hasOwn(beat, 'proofTimeId')) {
        add('storyboard-beat-proof-field', 'v5 节拍必须显式声明 proofTimeId（字符串或 null）。', `${beatLocation}.proofTimeId`);
      }
      if (beat.proofTimeId !== null && beat.proofTimeId !== undefined && !nonEmpty(beat.proofTimeId)) {
        add('storyboard-beat-proof-id', 'proofTimeId 必须为非空字符串或 null。', `${beatLocation}.proofTimeId`);
      }
      if (beat.soundCue && !nonEmpty(beat.proofTimeId)) {
        add('storyboard-sound-proof-required', '带 soundCue 的节拍必须绑定事件级 proofTimeId。', `${beatLocation}.proofTimeId`);
      }
      if (nonEmpty(beat.proofTimeId)) {
        beatEvidenceBindings.push({proofTimeId: beat.proofTimeId, location: beatLocation});
      }
    }
    if (!Array.isArray(scene.proofTimes) || scene.proofTimes.length < 3) {
      add('storyboard-proof-times', '每个镜头至少需要 3 个证明时刻。', `${location}.proofTimes`);
    }
    let previousProof = -1;
    let hasFinal = false;
    const proofIds = new Set();
    for (const [proofIndex, proof] of (scene.proofTimes ?? []).entries()) {
      const proofLocation = `${location}.proofTimes[${proofIndex}]`;
      if (!nonEmpty(proof.id) || proofIds.has(proof.id)) {
        add('storyboard-proof-id', '证明时刻 id 缺失或重复。', `${proofLocation}.id`);
      }
      proofIds.add(proof.id);
      if (!normalizedTime(proof.at) || proof.at <= previousProof) {
        add('storyboard-proof-time', '证明时刻 at 必须位于 0..1 且严格递增。', `${proofLocation}.at`);
      }
      previousProof = proof.at;
      if (!nonEmpty(proof.label)) add('storyboard-proof-label', '证明时刻必须有 label。', `${proofLocation}.label`);
      if (!PROOF_KINDS.includes(proof.kind)) add('storyboard-proof-kind', `未知证明类型：${proof.kind}`, `${proofLocation}.kind`);
      if (!Array.isArray(proof.assertions) || proof.assertions.length === 0 || proof.assertions.some((item) => !nonEmpty(item))) {
        add('storyboard-proof-assertions', '证明时刻必须声明至少一项可见关系断言。', `${proofLocation}.assertions`);
      }
      if (!Array.isArray(proof.stateAssertions)) add('storyboard-proof-state-assertions', 'v5 proofTime 必须显式声明 stateAssertions 数组。', `${proofLocation}.stateAssertions`);
      if (proof.kind === 'final' && proof.at >= 0.82) hasFinal = true;
    }
    for (const sequence of compositionPlan?.stateSequences ?? []) {
      const plannedStates = new Set(sequence.states.map(({id}) => id));
      const assertedStates = new Set((scene.proofTimes ?? []).flatMap((proof) =>
        (proof.stateAssertions ?? []).filter(({nodeId}) => nodeId === sequence.nodeId).map(({stateId}) => stateId),
      ));
      for (const stateId of assertedStates) {
        if (!plannedStates.has(stateId)) add('storyboard-proof-state-unknown', `状态证明引用了未知状态 ${stateId}。`, `${location}.proofTimes`);
      }
      for (const stateId of plannedStates) {
        if (!sequence.pathViewBinding && !assertedStates.has(stateId)) {
          add('storyboard-proof-state-coverage', `状态 ${sequence.nodeId}/${stateId} 缺少证明时刻。`, `${location}.proofTimes`);
        }
      }
    }
    // The reverse direction: an assertion pointing at a target that never
    // becomes a state sequence in this scene. The execution layer requires a
    // stateAssertion to resolve to a real state-sequence node with at least two
    // proven states, so a static "it is still doing X" claim recorded here is
    // unsatisfiable — and used to surface only after the whole execution tree
    // had been materialized, past the point where the storyboard can be edited.
    const plannedSequenceIds = new Set(
      (compositionPlan?.stateSequences ?? []).map(({nodeId}) => nodeId),
    );
    const assertedNodeIds = new Set(
      (scene.proofTimes ?? []).flatMap((proof) =>
        (proof.stateAssertions ?? []).map(({nodeId}) => nodeId),
      ),
    );
    for (const nodeId of assertedNodeIds) {
      if (!plannedSequenceIds.has(nodeId)) {
        add(
          'storyboard-proof-state-without-sequence',
          `${nodeId} 有状态证明，但本场没有让它换状态的 treatment。静态事实写进 proofTime.assertions 文字断言；stateAssertions 只用于真实发生切换的状态族。`,
          `${location}.proofTimes`,
        );
      }
    }
    for (const sequence of compositionPlan?.stateSequences ?? []) {
      if ((sequence.states ?? []).length < 2) {
        add(
          'storyboard-proof-state-single',
          `${sequence.nodeId} 在本场只规划了 ${(sequence.states ?? []).length} 个状态；状态序列至少需要两个状态才能执行。要么补上真实的第二个状态，要么改用文字断言。`,
          `${location}.proofTimes`,
        );
      }
    }
    for (const binding of beatEvidenceBindings) {
      if (!proofIds.has(binding.proofTimeId)) {
        add(
          'storyboard-beat-proof-missing',
          `节拍绑定的证明时刻不存在：${binding.proofTimeId}。`,
          `${binding.location}.proofTimeId`,
        );
      }
    }
    if (!hasFinal) add('storyboard-final-proof', '每个镜头必须在 0.82 之后设置 final 证明时刻。', `${location}.proofTimes`);
  }

  const plannedDuration = plan?.status === 'resolved' ? plan.resolved?.durationSeconds : null;
  if (plannedDuration && Math.abs(estimatedDuration - plannedDuration) > Math.max(1, plannedDuration * 0.08)) {
    add(
      'storyboard-duration-total',
      `镜头预计总时长 ${estimatedDuration.toFixed(2)}s 与计划 ${plannedDuration.toFixed(2)}s 相差超过 8%。`,
      'scenes',
    );
  }
  issues.push(
    ...validateCompiledDirecting(storyboard, {plan, styleProfile}),
  );
  return issues;
};

export const loadStoryboard = async (slug) =>
  JSON.parse(await fs.readFile(storyboardFileFor(slug), 'utf8'));

export const assertStoryboardReady = async (
  slug,
  plan,
  styleProfile = undefined,
) => {
  let storyboard;
  try {
    storyboard = await loadStoryboard(slug);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('缺少 storyboard.json；请先运行 project:storyboard。');
    throw error;
  }
  const issues = validateStoryboard(storyboard, {
    slug,
    plan,
    styleProfile,
  });
  if (storyboard.status !== 'ready' || issues.length > 0) {
    const detail = issues.map(({location, message}) => `${location}: ${message}`).join('；');
    throw new Error(`故事板尚未就绪；请先运行 project:storyboard。${detail ? ` ${detail}` : ''}`);
  }
  return storyboard;
};

export const summarizeStoryboard = (storyboard) => ({
  status: storyboard?.status ?? 'missing',
  arc: storyboard?.status === 'ready' ? storyboard.arc : null,
  sceneCount: Array.isArray(storyboard?.scenes) ? storyboard.scenes.length : 0,
  transitionCount: Array.isArray(storyboard?.sceneTransitions) ? storyboard.sceneTransitions.length : 0,
  scenes:
    storyboard?.status === 'ready'
      ? storyboard.scenes.map(({id, title, narrativeRole, blueprint, compositionPlan, directing, beats, proofTimes}) => ({
          id,
          title,
          narrativeRole,
          blueprint,
          patterns: compositionPlan.patterns,
          treatmentCount: directing.treatmentCount,
          riskScore: directing.riskScore,
          beatCount: beats.length,
          evidenceBoundBeatCount: beats.filter(({proofTimeId}) => Boolean(proofTimeId)).length,
          proofCount: proofTimes.length,
        }))
      : [],
  directing: storyboard?.status === 'ready'
      ? {
        fingerprint: storyboard.directingSummary?.fingerprint ?? null,
        motionContract: storyboard.motionContract
          ? {
              summary: storyboard.motionContract.direction.summary,
              approvalFingerprint:
                storyboard.motionContract.approvalFingerprint,
              executionFingerprint: storyboard.motionContract.fingerprint,
            }
          : null,
        styleProofPlan: storyboard.directingSummary?.styleProofPlan ?? null,
        estimatedPoseSheetCalls: storyboard.directingSummary?.estimatedPoseSheetCalls ?? 0,
        avoidedIsolatedStateCalls: storyboard.directingSummary?.avoidedIsolatedStateCalls ?? 0,
        generationBudget: storyboard.directingSummary?.generationBudget ?? null,
        soundEffectPlan:
          storyboard.directingSummary?.soundEffectPlan ?? null,
      }
    : null,
});
