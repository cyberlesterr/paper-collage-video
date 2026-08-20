import {LAYER_SOURCE_STRATEGIES} from './production-vocabulary.mjs';

const TODO_MARKER = 'TODO(author)';

export const storyboardTodoMarker = (hint) => `${TODO_MARKER}: ${hint}`;

export const findStoryboardTodoMarkers = (value, jsonPath = '$') => {
  if (typeof value === 'string') {
    return value.includes(TODO_MARKER) ? [jsonPath] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((child, index) =>
      findStoryboardTodoMarkers(child, `${jsonPath}[${index}]`),
    );
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) =>
      findStoryboardTodoMarkers(child, `${jsonPath}.${key}`),
    );
  }
  return [];
};

const round = (value, digits = 2) => Number(value.toFixed(digits));

const sceneBlueprintFor = (scene, option) => {
  const text = [
    scene.beat ?? '',
    ...(scene.characterActions ?? []),
    option.rationale ?? '',
  ].join(' ');
  if (/世界|旅行|穿越|路线|travel|journey|route|world/i.test(text)) {
    return 'map-journey';
  }
  return 'layered-reveal';
};

// A scaffold is only useful if the compiler accepts it once the free-text
// markers are filled in. So enum-valued slots (facing, playback, preset,
// motionCapability, …) always carry a legal default and are listed in the
// completion checklist for review; only prose gets a TODO marker.
export const stateNodeIdFor = (family) => `${family.id}-node`;
const stackNodeIdFor = (sourcePackage) => `${sourcePackage.id}-stack`;
const stageNodeIdFor = (scene) => `${scene.id}-stage`;

const LAYER_MEMBERS = [
  {role: 'support-rear', completeness: 'clean-plate', depth: -0.6},
  {role: 'subject', completeness: 'full-silhouette', depth: 0},
  {role: 'support-front', completeness: 'full-overlay', depth: 0.6},
];

const defaultRevealEnvelope = () => ({
  '16:9': {x: 0.08, y: 0.06, scale: 0.06, rotationDegrees: 2},
  '9:16': {x: 0.06, y: 0.08, scale: 0.06, rotationDegrees: 2},
  '1:1': {x: 0.07, y: 0.07, scale: 0.06, rotationDegrees: 2},
});

const layeredCompositionFor = (sourcePackage) => ({
  pattern: 'registered-depth-stack',
  motionCapability: 'bounded-relative',
  sourcePackageId: sourcePackage.id,
  sourceStrategy: sourcePackage.strategy,
  layers: LAYER_MEMBERS.map((member) => ({
    id: `${sourcePackage.id}-${member.role}`,
    ...member,
  })),
  revealEnvelope: defaultRevealEnvelope(),
});

const hasLayeredSource = (scene) =>
  (scene.sourcePackages ?? []).some(
    ({strategy}) =>
      LAYER_SOURCE_STRATEGIES.includes(strategy) && strategy !== 'rigid-master',
  );

const sourcePackageTreatmentFor = (scene, sourcePackage, proofIds) => {
  if (!LAYER_SOURCE_STRATEGIES.includes(sourcePackage.strategy)) {
    // single-background and canonical containers never become a layered
    // source-package plan; they hold the stage instead.
    return {
      id: `${scene.id}-${sourcePackage.id}-hold`,
      targetId: `${sourcePackage.id}-plate`,
      importance: 'supporting',
      necessity: 'required',
      changeClass: 'static-hold',
      semanticRisk: 'decorative',
      rationale: storyboardTodoMarker(
        `${sourcePackage.id}（${sourcePackage.strategy}）在本场承担什么画面职责`,
      ),
      proofTimeId: null,
      graphic: null,
      motion: {kind: 'static'},
      composition: {pattern: 'free'},
    };
  }
  if (sourcePackage.strategy === 'rigid-master') {
    return {
      id: `${scene.id}-${sourcePackage.id}-master`,
      targetId: stackNodeIdFor(sourcePackage),
      importance: 'hero',
      necessity: 'required',
      changeClass: 'static-hold',
      semanticRisk: 'topology',
      rationale: storyboardTodoMarker(
        `${sourcePackage.id} 作为整体刚性底板承载哪些主体关系`,
      ),
      proofTimeId: proofIds.establish,
      graphic: null,
      motion: {kind: 'static'},
      composition: {
        pattern: 'supported-subject',
        motionCapability: 'rigid-locked',
        sourcePackageId: sourcePackage.id,
        sourceStrategy: sourcePackage.strategy,
        relationship: {
          id: `${sourcePackage.id}-support`,
          object: stageNodeIdFor(scene),
          predicate: 'on',
          proof: storyboardTodoMarker(
            `如何证明主体确实落在 ${sourcePackage.id} 上（接触点/投影）`,
          ),
        },
      },
    };
  }
  return {
    id: `${scene.id}-${sourcePackage.id}-layers`,
    targetId: stackNodeIdFor(sourcePackage),
    importance: 'hero',
    necessity: 'required',
    changeClass: 'depth-layer-separation',
    semanticRisk: 'topology',
    rationale: storyboardTodoMarker(
      `${sourcePackage.id} 一次生成后本地拆层，本场要保住哪些登记关系`,
    ),
    proofTimeId: proofIds.establish,
    graphic: null,
    // A registered depth stack driven by a parallax camera *is* the scene's
    // parallax, so a parallax scene needs no second continuous target — which
    // is what kept the scaffold inside plan.motionBudget.maxContinuousTargets.
    motion: {
      kind: 'continuous-transform',
      preset: scene.parallax ? 'parallax-camera' : 'drift',
    },
    composition: layeredCompositionFor(sourcePackage),
  };
};

// A state sequence must open at at=0 and carry at least two states, so every
// family is seeded on the establish beat and changed on the action beat.
const stateFamilyTreatmentFor = (scene, family, {phase, proofTimeId}) => {
  const states = family.states ?? [];
  const stateId =
    phase === 'establish' ? states[0] ?? 'state-1' : states[1] ?? states[0] ?? 'state-1';
  return {
    id: `${scene.id}-${family.id}-${phase}`,
    targetId: stateNodeIdFor(family),
    importance: family.necessity === 'enhancement' ? 'supporting' : 'hero',
    necessity: family.necessity ?? 'required',
    changeClass: 'pose-change',
    semanticRisk: 'identity',
    rationale: storyboardTodoMarker(
      phase === 'establish'
        ? `${family.id} 进场时处于 ${stateId} 的理由`
        : `${family.id} 在本场为什么必须换到 ${stateId}（可见结果是什么）`,
    ),
    proofTimeId,
    graphic: null,
    motion: {
      kind: 'state-sequence',
      poseFamilyId: family.id,
      stateId,
      visualChange: storyboardTodoMarker(
        `切到 ${stateId} 时画面上具体改变了什么`,
      ),
      facing: 'front',
      playback: 'once',
      cycles: 1,
      transition: 'cut',
    },
    composition: {pattern: 'free'},
  };
};

const localMotionTreatmentFor = (scene, target, {carriesAmbient = false} = {}) => ({
  id: `${scene.id}-${target.targetId}-motion`,
  targetId: target.targetId,
  importance: carriesAmbient ? 'ambient' : 'supporting',
  necessity: 'required',
  changeClass: 'ambient-motion',
  semanticRisk: 'decorative',
  rationale: storyboardTodoMarker(
    `${target.targetId} 的 ${target.preset} 轻动作服务什么叙事感受`,
  ),
  proofTimeId: null,
  graphic: null,
  motion: {kind: 'continuous-transform', preset: target.preset},
  composition: {pattern: 'free'},
});

// The scenario card already committed which scenes carry parallax and ambient
// life, and the profile floor is checked again at compile time. Translating
// those flags here is what keeps the author from re-deriving them by hand.
const parallaxTreatmentFor = (scene, proofIds) => ({
  id: `${scene.id}-parallax`,
  targetId: 'scene-camera',
  importance: 'supporting',
  necessity: 'required',
  changeClass: 'depth-parallax',
  semanticRisk: 'topology',
  rationale: storyboardTodoMarker(
    `本场镜头视差要让观众读到哪一层的纵深关系`,
  ),
  proofTimeId: proofIds.establish,
  graphic: null,
  motion: {kind: 'continuous-transform', preset: 'parallax-camera'},
  composition: {pattern: 'free'},
});

const ambientTreatmentFor = (scene) => ({
  id: `${scene.id}-ambient`,
  targetId: `${scene.id}-ambient`,
  importance: 'ambient',
  necessity: 'enhancement',
  changeClass: 'ambient-motion',
  semanticRisk: 'decorative',
  rationale: storyboardTodoMarker(
    `环境元素（${(scene.ambientElements ?? []).join('、')}）如何呼吸而不抢戏`,
  ),
  proofTimeId: null,
  graphic: null,
  motion: {kind: 'continuous-transform', preset: 'float'},
  composition: {pattern: 'free'},
});

const stageHoldTreatmentFor = (scene, role, proofTimeId) => ({
  id: `${scene.id}-${role}-hold`,
  targetId: stageNodeIdFor(scene),
  importance: 'supporting',
  necessity: 'required',
  changeClass: 'static-hold',
  semanticRisk: 'decorative',
  rationale: storyboardTodoMarker(
    `${role} 阶段画面保持不动时，观众应该在读什么`,
  ),
  proofTimeId,
  graphic: null,
  motion: {kind: 'static'},
  composition: {pattern: 'free'},
});

const beatsFor = (scene, sceneProofIds) => {
  const actions = scene.characterActions ?? [];
  const establish = [
    ...(scene.sourcePackages ?? []).map((sourcePackage) =>
      sourcePackageTreatmentFor(scene, sourcePackage, sceneProofIds),
    ),
    ...(scene.stateFamilies ?? []).map((family) =>
      stateFamilyTreatmentFor(scene, family, {
        phase: 'establish',
        proofTimeId: sceneProofIds.establish,
      }),
    ),
    ...(scene.parallax && !hasLayeredSource(scene)
      ? [parallaxTreatmentFor(scene, sceneProofIds)]
      : []),
  ];
  const action = [
    ...(scene.stateFamilies ?? []).map((family) =>
      stateFamilyTreatmentFor(scene, family, {
        phase: 'action',
        proofTimeId: sceneProofIds.action,
      }),
    ),
    // An ambient scene is proven by an `ambient` treatment that actually
    // moves. Promoting one planned local-motion target costs no extra
    // continuous target, so the scaffold stays inside plan.motionBudget.
    ...(scene.localMotionTargets ?? []).map((target, index) =>
      localMotionTreatmentFor(scene, target, {
        carriesAmbient: index === 0 && (scene.ambientElements ?? []).length > 0,
      }),
    ),
    ...((scene.ambientElements ?? []).length > 0 &&
    (scene.localMotionTargets ?? []).length === 0
      ? [ambientTreatmentFor(scene)]
      : []),
  ];
  return [
    {
      id: `${scene.id}-establish`,
      at: 0,
      performanceRole: 'establish',
      purpose: storyboardTodoMarker(
        `开场要让观众立刻理解什么？（场景要点：${scene.beat ?? ''}）`,
      ),
      visual: storyboardTodoMarker(
        `开场画面（可用元素：${(scene.layers?.rear ?? []).join('、') || '见 scenario 卡'}）`,
      ),
      soundCue: null,
      proofTimeId: sceneProofIds.establish,
      treatments: establish.length
        ? establish
        : [stageHoldTreatmentFor(scene, 'establish', sceneProofIds.establish)],
    },
    {
      id: `${scene.id}-action`,
      at: 0.4,
      performanceRole: 'action',
      purpose: storyboardTodoMarker(
        `本场核心动作（scenario 动作：${actions.join('；') || '未声明'}）`,
      ),
      visual: storyboardTodoMarker('核心动作的画面呈现'),
      soundCue: null,
      proofTimeId: sceneProofIds.action,
      treatments: action.length
        ? action
        : [stageHoldTreatmentFor(scene, 'action', sceneProofIds.action)],
    },
    {
      id: `${scene.id}-settle`,
      at: 0.8,
      performanceRole: 'settle',
      purpose: storyboardTodoMarker('结尾如何收束并交接到下一场/全片终态'),
      visual: storyboardTodoMarker('终态画面'),
      soundCue: null,
      proofTimeId: sceneProofIds.final,
      treatments: [
        stageHoldTreatmentFor(scene, 'settle', sceneProofIds.final),
      ],
    },
  ];
};

const proofTimesFor = (scene, sceneProofIds, semanticCoverage) => {
  const sceneCoverage = semanticCoverage.filter(
    (entry) => entry.sceneId === scene.id,
  );
  const coverageAssertions = sceneCoverage
    .map((entry) => entry.visibleResult)
    .filter(Boolean);
  // Each state the scaffold actually plays needs a proof moment at the beat
  // that plays it, otherwise the compiler reports an unproven state.
  const stateAssertionsAt = (phase) =>
    (scene.stateFamilies ?? []).flatMap((family) => {
      const states = family.states ?? [];
      const stateId =
        phase === 'establish' ? states[0] : states[1] ?? states[0];
      return stateId ? [{nodeId: stateNodeIdFor(family), stateId}] : [];
    });
  return [
    {
      id: sceneProofIds.establish,
      at: 0.05,
      label: storyboardTodoMarker('开场证明时刻要一眼看到什么'),
      kind: 'establish',
      assertions: coverageAssertions.length
        ? coverageAssertions.slice(0, 2)
        : [storyboardTodoMarker('开场可见结果断言')],
      stateAssertions: stateAssertionsAt('establish'),
    },
    {
      id: sceneProofIds.action,
      at: 0.5,
      label: storyboardTodoMarker('中段动作证明时刻'),
      kind: 'action',
      assertions: coverageAssertions.length
        ? coverageAssertions
        : [storyboardTodoMarker('核心动作可见结果断言')],
      stateAssertions: stateAssertionsAt('action'),
    },
    {
      id: sceneProofIds.final,
      at: 0.9,
      label: storyboardTodoMarker('终态证明时刻（必须在 at>0.82）'),
      kind: 'final',
      assertions: [storyboardTodoMarker('全场结束时的稳定终态断言')],
      stateAssertions: [],
    },
  ];
};

const defaultResponsiveProfiles = () => [
  {
    id: '16:9',
    width: 1920,
    height: 1080,
    safeArea: {x: 0.05, y: 0.05, width: 0.9, height: 0.9},
    densityBudget: 14,
    typographyScale: 1,
    parallaxScale: 1,
    exclusionZones: [
      {id: 'subtitle-16x9', role: 'subtitle', x: 0.1, y: 0.79, width: 0.8, height: 0.13, padding: 0.02},
    ],
  },
  {
    id: '9:16',
    width: 1080,
    height: 1920,
    safeArea: {x: 0.08, y: 0.05, width: 0.84, height: 0.9},
    densityBudget: 10,
    typographyScale: 0.9,
    parallaxScale: 0.75,
    exclusionZones: [
      {id: 'subtitle-9x16', role: 'subtitle', x: 0.08, y: 0.91, width: 0.84, height: 0.04, padding: 0.004},
    ],
  },
  {
    id: '1:1',
    width: 1080,
    height: 1080,
    safeArea: {x: 0.07, y: 0.07, width: 0.86, height: 0.86},
    densityBudget: 11,
    typographyScale: 0.95,
    parallaxScale: 0.85,
    exclusionZones: [
      {id: 'subtitle-1x1', role: 'subtitle', x: 0.08, y: 0.86, width: 0.84, height: 0.09, padding: 0.01},
    ],
  },
];

export const buildStoryboardScaffold = ({project, scenarios}) => {
  const binding = project.plan?.scenarioBinding;
  if (!binding?.optionId) {
    throw new Error('project.plan.scenarioBinding 缺失；先运行 project:plan 选定 scenario。');
  }
  const option = (scenarios.options ?? []).find(
    ({id}) => id === binding.optionId,
  );
  if (!option) {
    throw new Error(`planning-scenarios.json 中不存在已批准的 option：${binding.optionId}。`);
  }
  if (binding.optionFingerprint && option.fingerprint !== binding.optionFingerprint) {
    throw new Error(
      'planning-scenarios.json 的 option 指纹与 plan.scenarioBinding 不一致；scenario 文件被改动过，先解决漂移。',
    );
  }
  const commonStory =
    typeof scenarios.commonStory === 'string'
      ? scenarios.commonStory
      : scenarios.commonStory?.summary ?? '';
  const sceneCount = Math.max(option.scenes?.length ?? 0, 1);
  const perSceneSeconds = round((option.durationSeconds ?? 60) / sceneCount);
  const scenes = (option.scenes ?? []).map((scene) => {
    const sceneProofIds = {
      establish: `${scene.id}-proof-establish`,
      action: `${scene.id}-proof-action`,
      final: `${scene.id}-proof-final`,
    };
    return {
      id: scene.id,
      title: scene.label ?? scene.id,
      narrativeRole: storyboardTodoMarker('该场在整体叙事弧中的角色'),
      message: scene.beat ?? storyboardTodoMarker('该场要传达的一句话'),
      blueprint: sceneBlueprintFor(scene, option),
      estimatedDurationSeconds: perSceneSeconds,
      beats: beatsFor(scene, sceneProofIds),
      proofTimes: proofTimesFor(
        scene,
        sceneProofIds,
        option.semanticActionCoverage ?? [],
      ),
    };
  });
  const sceneTransitions = scenes.slice(1).map((scene, index) => ({
    id: `boundary-${scenes[index].id}-${scene.id}`,
    fromSceneId: scenes[index].id,
    toSceneId: scene.id,
    intent: 'continuity',
    rationale: storyboardTodoMarker('两场之间的叙事关系与镜头意图'),
  }));
  return {
    $schema: '../../schemas/storyboard-authoring.schema.json',
    schemaVersion: 12,
    slug: project.slug,
    status: 'pending',
    arc: `${commonStory}${commonStory ? ' ' : ''}${option.rationale ?? ''}`.trim() ||
      storyboardTodoMarker('整体叙事弧'),
    style: {
      visualThesis: storyboardTodoMarker(
        `一句话视觉论点（风格：${project.styleProfile?.label ?? project.styleProfile?.id ?? '?'}）`,
      ),
      compositionRules:
        project.styleProfile?.generation?.compositionPrinciples?.length
          ? [...project.styleProfile.generation.compositionPrinciples]
          : [storyboardTodoMarker('构图规则')],
      layerStrategy: storyboardTodoMarker(
        `层策略（scenario 层规划：rear=${(option.scenes?.[0]?.layers?.rear ?? []).join('/') || '?'}）`,
      ),
    },
    motionDirection: {
      schemaVersion: 1,
      summary: storyboardTodoMarker('全片动作语言一句话总结'),
      pacing: project.styleProfile?.motion?.pacing ?? 'gentle',
      performance: {
        grammar: ['establish', 'action', 'settle'],
        anticipation: 'selective',
        followThrough: 'selective',
        poseStrategy: 'mixed',
        minimumFinalHoldRatio: 0.08,
      },
      camera: {strategy: 'motivated'},
      transitions: {strategy: 'story-led'},
      ambient: {strategy: option.scenes?.some((scene) => (scene.ambientElements ?? []).length > 0) ? 'selective' : 'minimal'},
      styleDeviationRationale: null,
    },
    editorial: {
      timebase: {fps: project.video?.fps ?? 30, rounding: 'nearest'},
      wordTimingPolicy: 'phrase-fallback',
      media: [],
      cues: [],
      editPoints: [],
      bindings: [],
      responsiveProfiles: defaultResponsiveProfiles(),
      sceneDirecting: scenes.map(({id}) => ({sceneId: id, placements: []})),
      transitions: [],
      activeProfile: project.intake?.aspectRatio ?? '16:9',
    },
    spatialContracts: [],
    scenes,
    sceneTransitions,
    updatedAt: new Date().toISOString(),
  };
};

// Enum slots carry compilable defaults instead of markers, so they would
// otherwise ship unreviewed. Surfacing them keeps the scaffold honest about
// which decisions it made on the author's behalf.
const reviewableDefaults = (scaffold) => {
  const review = [];
  for (const scene of scaffold.scenes ?? []) {
    for (const beat of scene.beats ?? []) {
      for (const treatment of beat.treatments ?? []) {
        if (treatment.motion?.kind === 'state-sequence') {
          review.push(
            `- ${scene.id}/${treatment.id}: facing=${treatment.motion.facing}、playback=${treatment.motion.playback}、transition=${treatment.motion.transition} 为默认值，按真实表演复核`,
          );
        }
        if (treatment.composition?.pattern === 'registered-depth-stack') {
          review.push(
            `- ${scene.id}/${treatment.id}: revealEnvelope 与三层 depth 为保守默认值，按实际构图复核`,
          );
        }
      }
    }
  }
  return review;
};

export const scaffoldCompletionChecklist = ({scaffold, option}) => {
  const markers = findStoryboardTodoMarkers(scaffold);
  const defaults = reviewableDefaults(scaffold);
  const obligations = new Set();
  for (const entry of option?.semanticActionCoverage ?? []) {
    if (entry.execution === 'local-motion') {
      obligations.add(
        `- ${entry.sceneId}/${entry.targetId}: local-motion → 需要 gait/travel-facing 空间合同（motion-directing.md）`,
      );
    }
    if (entry.execution === 'layer-package') {
      obligations.add(
        `- ${entry.sceneId}/${entry.targetId}: layer-package → 需要 occlusion/grounding 空间合同（layer-complete-assets.md）`,
      );
    }
  }
  return {markers, defaults, obligations: [...obligations]};
};
