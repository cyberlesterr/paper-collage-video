// The compiled storyboard already carries every structural decision the
// execution tree needs: layer stacks, state sequences, path motions, motif
// fields and proof times all live in `scene.compositionPlan`. Materializing it
// by hand meant re-typing thousands of lines of data the compiler had just
// derived, so this maps rather than invents. Production sources stay missing —
// the blueprint renderer substitutes deterministic labeled proxies — and only
// layout judgement is left to the author.
import {IDLE_PRESETS} from './production-vocabulary.mjs';
import {validateCompositionStructure} from './composition-lib.mjs';
import {validateDirectingExecution} from './motion-treatment-lib.mjs';

const TODO_MARKER = 'TODO(author)';

// Presets outside the idle set describe travel or camera behaviour, so they
// become an actual displacement instead of a self-loop. The spans here are not
// cosmetic: the directing contract requires a traverse to cover at least 0.45
// of the normalized canvas diagonal, so a token nudge is rejected downstream.
const TRAVERSE_HALF_SPAN = 0.24;

const KEYFRAMES_BY_PRESET = {
  traverse: [
    {at: 0, offsetX: -TRAVERSE_HALF_SPAN},
    {at: 1, offsetX: TRAVERSE_HALF_SPAN, ease: 'ease-in-out'},
  ],
  'scroll-world-x': [
    {at: 0, offsetX: -0.2},
    {at: 1, offsetX: 0.2, ease: 'linear'},
  ],
  bounce: [
    {at: 0, offsetY: 0},
    {at: 0.5, offsetY: -0.06},
    {at: 1, offsetY: 0, ease: 'ease-in-out'},
  ],
  pulse: [
    {at: 0, scale: 1},
    {at: 0.5, scale: 1.06},
    {at: 1, scale: 1, ease: 'ease-in-out'},
  ],
  settle: [
    {at: 0, offsetY: -0.04},
    {at: 1, offsetY: 0, ease: 'ease-out'},
  ],
};

const keyframesForPreset = (preset) =>
  KEYFRAMES_BY_PRESET[preset] ?? [
    {at: 0, scale: 1},
    {at: 1, scale: 1},
  ];

export const executionTodoMarker = (hint) => `${TODO_MARKER}: ${hint}`;

export const findExecutionTodoMarkers = (value, jsonPath = '$') => {
  if (typeof value === 'string') {
    return value.includes(TODO_MARKER) ? [jsonPath] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((child, index) =>
      findExecutionTodoMarkers(child, `${jsonPath}[${index}]`),
    );
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) =>
      findExecutionTodoMarkers(child, `${jsonPath}.${key}`),
    );
  }
  return [];
};

const round = (value, digits = 3) => Number(Number(value).toFixed(digits));

const registrationIdFor = (id) => `${id}-registration`;

const backgroundSrcFor = (slug, sceneId, layerId) =>
  `projects/${slug}/assets/backgrounds/${sceneId}/${layerId}.png`;

const characterSrcFor = (slug, poseFamilyId, stateId) =>
  `projects/${slug}/assets/characters/${poseFamilyId}/${stateId}.png`;

const propSrcFor = (slug, sceneId, targetId) =>
  `projects/${slug}/assets/props/${sceneId}/${targetId}.png`;

const identityReferenceFrom = (manifest) => {
  const asset = (manifest?.assets ?? []).find(
    ({assetId}) => assetId === 'style-sample',
  );
  return asset
    ? {identityReferenceAssetId: asset.assetId, identityReferenceSha256: asset.sha256}
    : null;
};

const layerStackNodeFor = ({stack, slug, sceneId, video, idle}) => ({
  id: stack.targetId,
  kind: 'group',
  pattern: stack.pattern,
  z: 0,
  depth: 0,
  coordinateSpace: {width: video.width, height: video.height},
  transform: {
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    anchorX: 0,
    anchorY: 0,
    scale: 1.08,
  },
  motion: {
    keyframes: [
      {at: 0, offsetX: -0.02},
      {at: 1, offsetX: 0.02, ease: 'ease-in-out'},
    ],
    ...(idle ? {idle} : {}),
  },
  registration: {
    id: registrationIdFor(stack.id),
    sourceMasterAssetId: `${stack.id}-master`,
    canvas: {width: video.width, height: video.height},
    origin: 'top-left',
  },
  layerStack: {
    sourcePackageId: stack.id,
    sourceStrategy: stack.sourceStrategy,
    motionCapability: stack.motionCapability,
    ...(stack.revealEnvelope ? {revealEnvelope: stack.revealEnvelope} : {}),
    ...(stack.subjectTravelEnvelope
      ? {subjectTravelEnvelope: stack.subjectTravelEnvelope}
      : {}),
  },
  children: (stack.layers ?? []).map((layer, index) => ({
    id: layer.id,
    kind: 'asset',
    assetRole: 'background',
    src: backgroundSrcFor(slug, sceneId, layer.id),
    z: index,
    slot: layer.role,
    registrationId: registrationIdFor(stack.id),
    depth: layer.depth,
    transform: {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      anchorX: 0,
      anchorY: 0,
    },
    motion: {
      keyframes: [
        {at: 0, scale: 1},
        {at: 1, scale: 1},
      ],
    },
  })),
});

const stateSequenceNodeFor = ({
  sequence,
  slug,
  video,
  identityReference,
  index,
}) => {
  const anchorIds = sequence.anchorPolicy?.requiredAnchorIds ?? ['foot'];
  return {
    id: sequence.nodeId,
    kind: 'state-sequence',
    assetRole: 'character',
    poseFamilyId: sequence.poseFamilyId,
    registration: {
      id: registrationIdFor(sequence.poseFamilyId),
      sourceMasterAssetId: `${sequence.poseFamilyId}-sheet`,
      canvas: {width: 1024, height: 1024},
      origin: 'top-left',
    },
    anchorPolicy: {
      requiredAnchorIds: [...anchorIds],
      maximumDrift: sequence.anchorPolicy?.maximumDrift ?? 0.04,
    },
    states: (sequence.states ?? []).map((state) => ({
      id: state.id,
      src: characterSrcFor(slug, sequence.poseFamilyId, state.id),
      at: state.at,
      facing: state.facing ?? 'neutral',
      anchors: anchorIds.map((id) => ({id, x: 0.5, y: 0.9})),
      ...(identityReference ?? {}),
    })),
    playback: {
      mode: sequence.playback?.mode ?? 'once',
      cycles: sequence.playback?.cycles ?? 1,
    },
    transition: {
      type: sequence.transition?.type ?? 'cut',
      durationSeconds: sequence.transition?.durationSeconds ?? 0,
    },
    ...(sequence.pathViewBinding
      ? {pathViewBinding: sequence.pathViewBinding}
      : {}),
    motion: {
      keyframes: [
        {at: 0, scale: 1},
        {at: 1, scale: 1},
      ],
      ...(sequence.path ? {path: sequence.path} : {}),
    },
    z: 5 + index,
    depth: 0.45,
    transform: {
      x: round(0.3 + index * 0.18),
      y: 0.63,
      width: 0.22,
      anchorX: 0.5,
      anchorY: 0.9,
    },
  };
};

const continuousAssetNodeFor = ({motion, slug, sceneId, index}) => ({
  id: motion.nodeId,
  kind: 'asset',
  assetRole: 'prop',
  src: propSrcFor(slug, sceneId, motion.nodeId),
  z: 20 + index,
  depth: 0.2,
  transform: {
    x: motion.preset === 'traverse' ? 0.5 : round(0.2 + index * 0.12),
    y: 0.45,
    width: 0.14,
    anchorX: 0.5,
    anchorY: 0.5,
  },
  motion: {
    keyframes: keyframesForPreset(motion.preset),
    ...(IDLE_PRESETS.includes(motion.preset)
      ? {idle: {preset: motion.preset, intensity: 0.3, cycleSeconds: 4}}
      : {}),
    ...(motion.preset === 'sway' ? {pivot: {x: 0.5, y: 0.9}} : {}),
  },
});

const motifFieldNodeFor = ({field, slug, sceneId, index}) => ({
  id: field.nodeId,
  kind: 'motif-field',
  src: propSrcFor(slug, sceneId, field.nodeId),
  z: 40 + index,
  depth: 0.1,
  transform: {
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    anchorX: 0,
    anchorY: 0,
  },
  fieldMotion: {
    preset: field.preset,
    cycles: field.cycles,
    ...(field.instances === undefined ? {} : {instances: field.instances}),
  },
});

const eventsFor = (scene) =>
  (scene.beats ?? [])
    .filter(({proofTimeId}) => proofTimeId)
    .map((beat) => {
      const anchor = (beat.treatments ?? [])[0];
      return {
        id: `${beat.id}-event`,
        beatId: beat.id,
        proofTimeId: beat.proofTimeId,
        at: beat.at,
        targetId: anchor?.targetId ?? `${scene.id}-stage`,
        visual: {
          kind: 'emphasis',
          action: 'pulse',
          durationSeconds: 0.96,
          intensity: 0.28,
        },
      };
    });

const cameraFor = (scene, pathMotions) => {
  const follow = pathMotions.find(({cameraFollow}) => cameraFollow)?.cameraFollow;
  const parallax = (scene.compositionPlan?.continuousMotions ?? []).some(
    ({preset}) => preset === 'parallax-camera',
  );
  return {
    preset: 'push',
    intensity: 0.38,
    parallax: {enabled: parallax, strength: parallax ? 0.22 : 0, focalDepth: 0},
    ...(follow ? {follow} : {}),
  };
};

const sceneNodeFor = ({scene, slug, video, identityReference}) => {
  const plan = scene.compositionPlan ?? {};
  const idleByTarget = new Map(
    (plan.continuousMotions ?? []).map((motion) => [motion.nodeId, motion]),
  );
  const nodes = [];
  for (const stack of plan.layerStacks ?? []) {
    const motion = idleByTarget.get(stack.targetId);
    idleByTarget.delete(stack.targetId);
    nodes.push(
      layerStackNodeFor({
        stack,
        slug,
        sceneId: scene.id,
        video,
        idle:
          motion && IDLE_PRESETS.includes(motion.preset)
            ? {preset: motion.preset, intensity: 0.35, cycleSeconds: 4.2}
            : null,
      }),
    );
  }
  const pathByNode = new Map(
    (plan.pathMotions ?? []).map((entry) => [entry.nodeId, entry]),
  );
  for (const [index, sequence] of (plan.stateSequences ?? []).entries()) {
    idleByTarget.delete(sequence.nodeId);
    nodes.push(
      stateSequenceNodeFor({
        sequence: {...sequence, path: pathByNode.get(sequence.nodeId)?.path},
        slug,
        video,
        identityReference,
        index,
      }),
    );
  }
  for (const [index, field] of (plan.motifFields ?? []).entries()) {
    idleByTarget.delete(field.nodeId);
    nodes.push(motifFieldNodeFor({field, slug, sceneId: scene.id, index}));
  }
  // Anything the storyboard animates that no structural node already owns still
  // needs a carrier, otherwise the continuous target has nothing to move.
  let assetIndex = 0;
  for (const motion of idleByTarget.values()) {
    if (motion.nodeId === 'scene-camera') continue;
    nodes.push(
      continuousAssetNodeFor({
        motion,
        slug,
        sceneId: scene.id,
        index: assetIndex,
      }),
    );
    assetIndex += 1;
  }
  return nodes;
};

export const buildExecutionScaffold = ({project, storyboard, manifest = null}) => {
  if (!Array.isArray(storyboard?.scenes) || storyboard.scenes.length === 0) {
    throw new Error('storyboard 没有已编译的镜头；先运行 project:storyboard。');
  }
  const slug = project.slug;
  const video = {
    width: project.video?.width ?? 1920,
    height: project.video?.height ?? 1080,
    fps: project.video?.fps ?? 30,
  };
  const identityReference = identityReferenceFrom(manifest);
  const sceneCount = storyboard.scenes.length;
  const scenes = storyboard.scenes.map((scene, index) => ({
    id: scene.id,
    label: scene.title,
    eyebrow: `故事 ${index + 1} / ${sceneCount}`,
    tailSeconds: 1,
    motion: {
      blueprint: scene.blueprint,
      proofTimes: scene.proofTimes ?? [],
    },
    composition: {
      coordinateSpace: {width: video.width, height: video.height},
      nodes: sceneNodeFor({scene, slug, video, identityReference}),
    },
    camera: cameraFor(scene, scene.compositionPlan?.pathMotions ?? []),
    narration: {
      src: `projects/${slug}/audio/narration/${scene.id}.mp3`,
      startSeconds: 0.5,
      durationSeconds: round(scene.estimatedDurationSeconds ?? 12, 2),
      text: scene.message,
    },
    subtitles: [],
    events: eventsFor(scene),
  }));
  return {
    scenes,
    sceneTransitions: storyboard.sceneTransitions ?? [],
  };
};

// A generator that exits 0 on a tree the blueprint rejects is worse than no
// generator: the success line reads as verification. This runs exactly the two
// checks the blueprint runs, so the command can never again claim success on a
// tree that will fail at the next gate.
export const validateExecutionTree = ({project, storyboard, scenes}) => {
  const storyboardScenes = new Map(
    storyboard.scenes.map((scene) => [scene.id, scene]),
  );
  const profile = storyboard.editorial?.responsiveProfiles?.find(
    ({id}) => id === storyboard.editorial?.activeProfile,
  );
  const issues = [];
  for (const scene of scenes) {
    const storyboardScene = storyboardScenes.get(scene.id);
    if (!storyboardScene) continue;
    for (const issue of validateCompositionStructure({
      composition: scene.composition,
      video: project.video,
      proofTimes: scene.motion?.proofTimes ?? [],
      durationSeconds: scene.narration?.durationSeconds ?? 1,
      sceneId: scene.id,
      editorial: storyboard.editorial,
      exclusionZones: profile?.exclusionZones ?? [],
      safeArea: profile?.safeArea ?? {x: 0, y: 0, width: 1, height: 1},
      location: `scenes#${scene.id}.composition`,
    }).issues) {
      if (issue.level === 'error') issues.push(issue);
    }
    issues.push(
      ...validateDirectingExecution({
        scene,
        storyboardScene,
        location: `scenes#${scene.id}`,
      }),
    );
  }
  return issues;
};

export const executionScaffoldChecklist = ({scaffold, manifest = null}) => {
  const review = [];
  if (!identityReferenceFrom(manifest)) {
    review.push(
      '- 未找到已登记的 style-sample：状态序列缺少身份参考，先完成风格样张登记再物化',
    );
  }
  for (const scene of scaffold.scenes) {
    for (const node of scene.composition.nodes) {
      if (node.kind === 'state-sequence' || node.kind === 'asset') {
        review.push(
          `- ${scene.id}/${node.id}: transform 为等距占位（x=${node.transform.x}, y=${node.transform.y}, width=${node.transform.width}），按真实构图调整`,
        );
      }
    }
  }
  return {markers: findExecutionTodoMarkers(scaffold), review};
};
