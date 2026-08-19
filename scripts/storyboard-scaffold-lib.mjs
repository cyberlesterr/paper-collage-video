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

const treatmentSkeletonsFor = (scene) => [
  ...(scene.sourcePackages ?? []).map((sourcePackage) => ({
    id: `${sourcePackage.id}-treatment`,
    targetId: storyboardTodoMarker(
      `为源包 ${sourcePackage.id} 命名承载节点 id`,
    ),
    importance: 'hero',
    necessity: 'required',
    changeClass: 'depth-layer-separation',
    motion: {kind: 'continuous-transform', preset: 'drift'},
    composition: {
      pattern: 'registered-depth-stack',
      motionCapability: storyboardTodoMarker(
        'rigid-locked 或 bounded-relative（读 layer-complete-assets.md）',
      ),
      sourcePackageId: sourcePackage.id,
      sourceStrategy: sourcePackage.strategy,
    },
  })),
  ...(scene.stateFamilies ?? []).map((family) => ({
    id: `${family.id}-treatment`,
    targetId: storyboardTodoMarker(
      `为状态家族 ${family.id} 命名 state-sequence 节点 id`,
    ),
    importance: family.necessity === 'required' ? 'hero' : 'support',
    necessity: family.necessity ?? 'required',
    changeClass: 'state-replacement',
    motion: {kind: 'state-sequence', preset: 'loop'},
    composition: {
      pattern: 'free',
      stateFamilyId: family.id,
      states: family.states ?? [],
    },
  })),
  ...(scene.localMotionTargets ?? []).map((target) => ({
    id: `${target.targetId}-treatment`,
    targetId: target.targetId,
    importance: 'support',
    necessity: 'required',
    changeClass: 'local-motion',
    motion: {kind: 'continuous-transform', preset: target.preset},
    composition: {pattern: 'free'},
  })),
];

const beatsFor = (scene, sceneProofIds) => {
  const actions = scene.characterActions ?? [];
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
      treatments: treatmentSkeletonsFor(scene),
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
      treatments: [],
    },
    {
      id: `${scene.id}-settle`,
      at: 0.8,
      performanceRole: 'settle',
      purpose: storyboardTodoMarker('结尾如何收束并交接到下一场/全片终态'),
      visual: storyboardTodoMarker('终态画面'),
      soundCue: null,
      proofTimeId: sceneProofIds.final,
      treatments: [],
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
  const stateAssertions = (scene.stateFamilies ?? []).flatMap((family) =>
    (family.states ?? []).slice(0, 1).map((stateId) => ({
      nodeId: storyboardTodoMarker(`状态家族 ${family.id} 的实际节点 id`),
      stateId,
    })),
  );
  return [
    {
      id: sceneProofIds.establish,
      at: 0.05,
      label: storyboardTodoMarker('开场证明时刻要一眼看到什么'),
      kind: 'establish',
      assertions: coverageAssertions.length
        ? coverageAssertions.slice(0, 2)
        : [storyboardTodoMarker('开场可见结果断言')],
      stateAssertions: [],
    },
    {
      id: sceneProofIds.action,
      at: 0.5,
      label: storyboardTodoMarker('中段动作证明时刻'),
      kind: 'action',
      assertions: coverageAssertions.length
        ? coverageAssertions
        : [storyboardTodoMarker('核心动作可见结果断言')],
      stateAssertions,
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
      sceneDirecting: [],
      transitions: [],
      activeProfile: project.intake?.aspectRatio ?? '16:9',
    },
    spatialContracts: [],
    scenes,
    sceneTransitions,
    updatedAt: new Date().toISOString(),
  };
};

export const scaffoldCompletionChecklist = ({scaffold, option}) => {
  const markers = findStoryboardTodoMarkers(scaffold);
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
  return {markers, obligations: [...obligations]};
};
