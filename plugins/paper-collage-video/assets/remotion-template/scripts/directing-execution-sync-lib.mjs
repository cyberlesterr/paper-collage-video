import {
  flattenCompositionNodes,
  hashCompositionValue,
} from './composition-lib.mjs';
import {validateDirectingExecution} from './motion-treatment-lib.mjs';

const clone = (value) => structuredClone(value);

const visitNodes = (nodes, visitor) => {
  for (const node of nodes ?? []) {
    visitor(node);
    if (node.kind === 'group') visitNodes(node.children, visitor);
    if (node.kind === 'editorial-switch') {
      for (const panel of node.panels ?? []) {
        visitNodes([panel.node], visitor);
      }
    }
  }
};

const nodeMapFor = (scene) => {
  const nodes = new Map();
  const duplicates = new Set();
  visitNodes(scene?.composition?.nodes, (node) => {
    if (nodes.has(node.id)) duplicates.add(node.id);
    nodes.set(node.id, node);
  });
  return {nodes, duplicates};
};

const mergePlannedStates = ({node, planned, issues, location}) => {
  if (node?.kind !== 'state-sequence') return;
  const currentStates = new Map(
    (node.states ?? []).map((state) => [state.id, state]),
  );
  const missing = planned.states
    .filter(({id}) => !currentStates.has(id))
    .map(({id}) => id);
  if (missing.length > 0) {
    issues.push({
      code: 'execution-sync-state-source-required',
      location,
      message:
        `状态家族 ${planned.nodeId} 新增 ${missing.join(', ')}，但故事板不包含这些状态的素材来源；` +
        '请在 revision execution candidate 中提供同一注册族的完整状态节点。',
    });
    return;
  }
  node.poseFamilyId = planned.poseFamilyId;
  node.states = planned.states.map(({id, at, facing}) => ({
    ...currentStates.get(id),
    id,
    at,
    facing,
  }));
  node.playback = clone(planned.playback);
  if (planned.pathViewBinding === undefined) {
    delete node.pathViewBinding;
  } else {
    node.pathViewBinding = clone(planned.pathViewBinding);
  }
  node.transition = {
    ...(node.transition ?? {}),
    type: planned.transition,
  };
};

const syncVisibilityEvent = ({scene, planned}) => {
  scene.events ??= [];
  const existing = scene.events.find(
    (event) =>
      event.targetId === planned.nodeId &&
      event.beatId === planned.beatId &&
      event.visual?.kind === 'visibility',
  );
  const value = {
    id: existing?.id ?? `directing-${planned.id}`,
    beatId: planned.beatId,
    at: planned.at,
    targetId: planned.nodeId,
    visual: {
      kind: 'visibility',
      action: planned.action,
      transition: planned.transition,
      durationSeconds: planned.durationSeconds,
    },
    ...(planned.proofTimeId
      ? {proofTimeId: planned.proofTimeId}
      : {}),
    ...(existing?.sound ? {sound: existing.sound} : {}),
  };
  if (existing) Object.assign(existing, value);
  else scene.events.push(value);
};

const syncVisualSfx = ({scene, node, planned}) => {
  node.role = 'visual-sfx';
  node.text = planned.text;
  node.visibility = {...node.visibility, initial: 'hidden'};
  scene.events ??= [];
  const durationSeconds =
    Number(scene.narration?.startSeconds ?? 0) +
    Number(scene.narration?.durationSeconds ?? 0) +
    Number(scene.tailSeconds ?? 0);
  const hideAt = Math.min(
    1,
    planned.at +
      planned.durationSeconds / Math.max(0.001, durationSeconds),
  );
  const matching = scene.events.filter(
    (event) =>
      event.targetId === planned.nodeId &&
      event.beatId === planned.beatId,
  );
  const existingSound = matching.find(({sound}) => Boolean(sound))?.sound;
  const eventValues = [
    {
      id: `directing-${planned.id}-show`,
      at: planned.at,
      visual: {
        kind: 'visibility',
        action: 'show',
        transition: 'fade-scale',
        durationSeconds: Math.min(0.2, planned.durationSeconds),
      },
      ...(existingSound ? {sound: existingSound} : {}),
    },
    {
      id: `directing-${planned.id}-emphasis`,
      at: planned.at,
      visual: {
        kind: 'emphasis',
        action: planned.animation,
        durationSeconds: planned.durationSeconds,
        intensity: planned.intensity ?? 1,
      },
    },
    {
      id: `directing-${planned.id}-hide`,
      at: hideAt,
      visual: {
        kind: 'visibility',
        action: 'hide',
        transition: 'fade-scale',
        durationSeconds: Math.min(0.2, planned.durationSeconds),
      },
    },
  ].map((event) => ({
    ...event,
    beatId: planned.beatId,
    targetId: planned.nodeId,
    ...(planned.proofTimeId
      ? {proofTimeId: planned.proofTimeId}
      : {}),
  }));
  scene.events = [
    ...scene.events.filter(
      (event) =>
        event.targetId !== planned.nodeId ||
        event.beatId !== planned.beatId ||
        !['visibility', 'emphasis'].includes(event.visual?.kind),
    ),
    ...eventValues,
  ].sort((left, right) => left.at - right.at || left.id.localeCompare(right.id));
};

const publicAssetSource = (output) =>
  String(output).replace(/^public[\\/]/, '').split('\\').join('/');

const syncSoundEffect = ({scene, nodes, planned, issues}) => {
  scene.events ??= [];
  if (!nodes.has(planned.targetId)) {
    issues.push({
      code: 'execution-sync-sound-target-missing',
      location: `scene:${scene.id}.composition.nodes#${planned.targetId}`,
      message:
        `音效 ${planned.assetId} 的目标 ${planned.targetId} 不存在；` +
        '请在 revision execution candidate 中提供该执行节点。',
    });
    return;
  }
  const generatedId = `directing-${planned.id}`;
  const event =
    scene.events.find(({id}) => id === generatedId) ??
    scene.events.find(
      (candidate) =>
        candidate.beatId === planned.beatId &&
        candidate.targetId === planned.targetId &&
        Math.abs(candidate.at - planned.at) <= 0.035,
    ) ??
    scene.events.find(
      (candidate) =>
        candidate.beatId === planned.beatId &&
        Math.abs(candidate.at - planned.at) <= 0.035,
    );
  const sound = {
    src: publicAssetSource(planned.output),
    volume: 1,
  };
  if (event) {
    event.sound = sound;
    return;
  }
  scene.events.push({
    id: generatedId,
    beatId: planned.beatId,
    at: planned.at,
    targetId: planned.targetId,
    visual: null,
    proofTimeId: planned.proofTimeId,
    sound,
  });
};

const syncScene = ({scene, storyboardScene}) => {
  const issues = [];
  const changes = [];
  const before = hashCompositionValue(scene);
  scene.motion = {
    ...(scene.motion ?? {}),
    proofTimes: clone(storyboardScene.proofTimes ?? []),
  };
  const {nodes, duplicates} = nodeMapFor(scene);
  for (const id of duplicates) {
    issues.push({
      code: 'execution-sync-duplicate-node',
      location: `scene:${scene.id}.composition.nodes#${id}`,
      message: `执行树包含重复节点 id ${id}；自动同步不会猜测应保留哪一个。`,
    });
  }

  for (const planned of storyboardScene.compositionPlan?.stateSequences ?? []) {
    mergePlannedStates({
      node: nodes.get(planned.nodeId),
      planned,
      issues,
      location: `scene:${scene.id}.composition.nodes#${planned.nodeId}`,
    });
  }
  for (const planned of storyboardScene.compositionPlan?.pathMotions ?? []) {
    const node = nodes.get(planned.nodeId);
    if (node?.kind === 'state-sequence') {
      node.motion = {...(node.motion ?? {}), path: clone(planned.path)};
      if (planned.cameraFollow === null) {
        if (scene.camera) delete scene.camera.follow;
      } else {
        scene.camera = {
          ...(scene.camera ?? {}),
          follow: clone(planned.cameraFollow),
        };
      }
    }
  }
  for (const planned of storyboardScene.compositionPlan?.motifFields ?? []) {
    const node = nodes.get(planned.nodeId);
    if (node?.kind !== 'motif-field') continue;
    node.fieldMotion = {
      ...(node.fieldMotion ?? {}),
      preset: planned.preset,
      cycles: planned.cycles,
    };
    node.distribution = planned.distribution;
    node.count = planned.count;
    node.bounds = clone(planned.bounds);
    node.exclusionZones = clone(planned.exclusionZones);
    if (planned.worldBinding === null || planned.worldBinding === undefined) {
      delete node.worldBinding;
    } else {
      node.worldBinding = clone(planned.worldBinding);
    }
  }
  for (
    const planned of
      storyboardScene.compositionPlan?.canonicalContainers ?? []
  ) {
    const group = nodes.get(planned.groupId);
    const contents = group?.children?.find(
      ({id}) => id === planned.targetId,
    );
    if (
      group?.kind !== 'group' ||
      contents?.kind !== 'state-sequence'
    ) {
      continue;
    }
    group.pattern = 'canonical-container';
    group.registration = {
      ...(group.registration ?? {}),
      id: planned.registrationId,
      sourceMasterAssetId: planned.sourceMasterAssetId,
      canvas: clone(planned.canvas),
    };
    group.canonicalContainer = {
      ...(group.canonicalContainer ?? {}),
      familyId: planned.familyId,
      sourcePackageId: planned.sourcePackageId,
      sourceStrategy: planned.sourceStrategy,
      contentsNodeId: planned.targetId,
      cleanPlateAssetId: planned.cleanPlateAssetId,
      canonicalFrameAssetId: planned.canonicalFrameAssetId,
      contentSheetAssetId: planned.contentSheetAssetId,
      interiorMaskAssetId: planned.interiorMaskAssetId,
      authoritativeSurfaceId: planned.authoritativeSurfaceId,
      interiorShape: clone(planned.interiorShape),
      alignmentPolicy: clone(planned.alignmentPolicy),
      states: planned.states.map(({id, fillLevel}) => ({
        id,
        fillLevel,
      })),
      terminalStateId: planned.terminalStateId,
      terminalPolicy: clone(planned.terminalPolicy),
      recoveryPolicy: clone(planned.recoveryPolicy),
    };
    const currentStates = new Map(
      (contents.states ?? []).map((state) => [state.id, state]),
    );
    if (
      planned.states.every(({id}) => currentStates.has(id))
    ) {
      contents.states = planned.states.map(({id, at}) => ({
        ...currentStates.get(id),
        id,
        at,
      }));
    }
  }
  for (const planned of storyboardScene.compositionPlan?.visibilityEvents ?? []) {
    if (nodes.has(planned.nodeId)) syncVisibilityEvent({scene, planned});
  }
  for (const planned of storyboardScene.compositionPlan?.graphics ?? []) {
    const node = nodes.get(planned.nodeId);
    if (!node || node.kind !== planned.kind) continue;
    if (planned.role === 'visual-sfx') {
      syncVisualSfx({scene, node, planned});
    }
  }
  for (const planned of storyboardScene.compositionPlan?.soundEffects ?? []) {
    syncSoundEffect({scene, nodes, planned, issues});
  }
  scene.events = (scene.events ?? []).sort(
    (left, right) =>
      left.at - right.at || left.id.localeCompare(right.id),
  );

  issues.push(
    ...validateDirectingExecution({
      scene,
      storyboardScene,
      location: `scene:${scene.id}`,
    }),
  );
  if (hashCompositionValue(scene) !== before) {
    changes.push(scene.id);
  }
  return {issues, changes};
};

// validateDirectingExecution only walks plan → node, so a state sequence the
// plan no longer contains is invisible to it. A hand-edited tree could keep such
// an orphan, sync would report a synchronized and verified tree, and only the
// blueprint would reject it. Sync will not delete authored nodes on its own, so
// it names them instead of silently passing them through.
const orphanSequenceIssues = ({scene, storyboardScene}) => {
  const planned = new Set(
    (storyboardScene.compositionPlan?.stateSequences ?? []).map(
      ({nodeId}) => nodeId,
    ),
  );
  return flattenCompositionNodes(scene.composition?.nodes)
    .map(({node}) => node)
    .filter(({kind, id}) => kind === 'state-sequence' && !planned.has(id))
    .map(({id}) => ({
      code: 'execution-sync-orphan-state-sequence',
      location: `scene:${scene.id}.composition.nodes#${id}`,
      message:
        `执行树里的状态序列 ${id} 已不在当前故事板计划中；自动同步不会删除手写节点。` +
        '请在 --execution 候选里移除它，或在 storyboard 中恢复对应的状态切换 treatment。',
    }));
};

const protectedProjectRoot = (project) => ({
  schemaVersion: project.schemaVersion,
  slug: project.slug,
  title: project.title,
  intake: project.intake,
  styleProfile: project.styleProfile,
  plan: project.plan,
  quality: project.quality,
  video: project.video,
  theme: project.theme,
  voice: project.voice,
  audio: project.audio,
  worlds: project.worlds,
  trajectoryContracts: project.trajectoryContracts,
});

const protectedSceneSourceContract = (scene) => ({
  id: scene.id,
  eyebrow: scene.eyebrow,
  tailSeconds: scene.tailSeconds,
  narration: {
    src: scene.narration?.src,
    timingSrc: scene.narration?.timingSrc,
    startSeconds: scene.narration?.startSeconds,
    durationSeconds: scene.narration?.durationSeconds,
  },
  subtitles: scene.subtitles,
  encounters: scene.encounters,
});

const assertExecutionCandidateScope = ({
  currentProject,
  candidateProject,
  allowedSceneIds,
}) => {
  if (
    candidateProject?.schemaVersion !== currentProject.schemaVersion ||
    candidateProject.slug !== currentProject.slug ||
    hashCompositionValue(protectedProjectRoot(candidateProject)) !==
      hashCompositionValue(protectedProjectRoot(currentProject))
  ) {
    throw new Error(
      'revision execution candidate 改变了项目身份、制作规格、风格、声音或其他非导演根字段。',
    );
  }
  const allowed = new Set(allowedSceneIds);
  const currentScenes = new Map(
    currentProject.scenes.map((scene) => [scene.id, scene]),
  );
  const candidateScenes = new Map(
    candidateProject.scenes.map((scene) => [scene.id, scene]),
  );
  if (
    currentScenes.size !== candidateScenes.size ||
    [...currentScenes.keys()].some((id) => !candidateScenes.has(id))
  ) {
    throw new Error('revision execution candidate 不得增删或重命名镜头。');
  }
  const outsideScope = [...currentScenes.keys()].filter(
    (id) =>
      !allowed.has(id) &&
      hashCompositionValue(currentScenes.get(id)) !==
        hashCompositionValue(candidateScenes.get(id)),
  );
  if (outsideScope.length > 0) {
    throw new Error(
      `revision execution candidate 越过本次镜头范围：${outsideScope.join(', ')}。`,
    );
  }
  const protectedChanges = [...allowed]
    .filter((id) => currentScenes.has(id) && candidateScenes.has(id))
    .filter(
      (id) =>
        hashCompositionValue(
          protectedSceneSourceContract(currentScenes.get(id)),
        ) !==
        hashCompositionValue(
          protectedSceneSourceContract(candidateScenes.get(id)),
        ),
    );
  if (protectedChanges.length > 0) {
    throw new Error(
      `revision execution candidate 改变了旁白源、时长、字幕或其他非导演镜头字段：${protectedChanges.join(', ')}。`,
    );
  }
};

export const synchronizeDirectingExecution = ({
  currentProject,
  storyboard,
  executionCandidate = currentProject,
  allowedSceneIds,
}) => {
  assertExecutionCandidateScope({
    currentProject,
    candidateProject: executionCandidate,
    allowedSceneIds,
  });
  const project = clone(executionCandidate);
  project.motionContract = clone(storyboard.motionContract);
  project.editorial = clone(storyboard.editorial);
  project.spatialContracts = clone(storyboard.spatialContracts ?? []);
  project.sceneTransitions = clone(storyboard.sceneTransitions ?? []);
  const storyboardScenes = new Map(
    storyboard.scenes.map((scene) => [scene.id, scene]),
  );
  const issues = [];
  const changedSceneIds = new Set();
  for (const scene of project.scenes) {
    const storyboardScene = storyboardScenes.get(scene.id);
    if (!storyboardScene) {
      issues.push({
        code: 'execution-sync-storyboard-scene-missing',
        location: `scene:${scene.id}`,
        message: `执行镜头 ${scene.id} 不在当前故事板中。`,
      });
      continue;
    }
    scene.label = storyboardScene.title;
    scene.narration = {
      ...scene.narration,
      text: storyboardScene.message,
    };
    scene.motion = {
      ...scene.motion,
      blueprint: storyboardScene.blueprint,
    };
    const result = syncScene({scene, storyboardScene});
    for (const issue of result.issues) issues.push(issue);
    for (const id of result.changes) changedSceneIds.add(id);
    for (const issue of orphanSequenceIssues({scene, storyboardScene})) {
      issues.push(issue);
    }
  }
  if (issues.length > 0) {
    const error = new Error(
      `执行树自动同步后仍有 ${issues.length} 个无法安全推导的问题；未写入任何项目文件：\n` +
        issues
          .map(({location, message}) => `- ${location}: ${message}`)
          .join('\n'),
    );
    error.code = 'DIRECTING_EXECUTION_SYNC_UNRESOLVED';
    error.issues = issues;
    throw error;
  }
  return {
    project,
    report: {
      status: 'synchronized',
      changedSceneIds: [...changedSceneIds].sort(),
      unresolvedIssueCount: 0,
    },
  };
};
