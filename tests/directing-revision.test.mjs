import assert from 'node:assert/strict';
import test from 'node:test';
import {
  changedEditorialSceneIds,
  prepareDirectingRevision,
  prepareSemanticRevision,
  storyboardConceptFingerprint,
} from '../scripts/directing-revision-lib.mjs';
import {
  synchronizeDirectingExecution,
} from '../scripts/directing-execution-sync-lib.mjs';
import {compileStoryboardDirecting} from '../scripts/storyboard-lib.mjs';
import {buildProviderRootPlan} from '../scripts/provider-root-plan-lib.mjs';
import {
  directingRevisionAuthoring,
  directingRevisionPlan,
  directingRevisionProduction,
  directingRevisionStyleProfile,
} from '../fixtures/directing-revision-fixture.mjs';
import {createEditorialFixture} from '../fixtures/editorial-fixture.mjs';

const loadFixture = async () => {
  const storyboard = compileStoryboardDirecting(structuredClone(directingRevisionAuthoring), {
    plan: directingRevisionPlan,
    styleProfile: directingRevisionStyleProfile,
  });
  return {
    storyboard,
    project: {
      plan: structuredClone(directingRevisionPlan),
      styleProfile: directingRevisionStyleProfile,
    },
    production: structuredClone(directingRevisionProduction),
  };
};

const executionProjectFor = (storyboard) => ({
  schemaVersion: 12,
  slug: storyboard.slug,
  title: 'Directing revision fixture',
  intake: {},
  styleProfile: structuredClone(directingRevisionStyleProfile),
  plan: structuredClone(directingRevisionPlan),
  quality: {},
  video: {width: 1920, height: 1080, fps: 30},
  theme: {},
  voice: {},
  audio: {},
  motionContract: structuredClone(storyboard.motionContract),
  editorial: structuredClone(storyboard.editorial),
  spatialContracts: structuredClone(storyboard.spatialContracts ?? []),
  worlds: [],
  trajectoryContracts: [],
  sceneTransitions: [],
  scenes: storyboard.scenes.map((scene) => ({
    id: scene.id,
    label: scene.title,
    tailSeconds: 0,
    motion: {
      blueprint: scene.blueprint,
      proofTimes: structuredClone(scene.proofTimes),
    },
    composition: {
      coordinateSpace: {width: 1920, height: 1080},
      nodes: [
        {
          id: 'background',
          kind: 'asset',
          assetRole: 'background',
          z: 0,
          src: 'fixtures/vox-primitives/background.png',
          transform: {x: 0, y: 0, width: 1, height: 1},
        },
        {
          id: 'subject',
          kind: 'asset',
          assetRole: 'character',
          z: 1,
          src: 'fixtures/vox-primitives/traveler.png',
          visibility: {initial: 'hidden'},
          transform: {x: 0.3, y: 0.3, width: 0.4, height: 0.5},
        },
        {
          id: 'narrator',
          kind: 'state-sequence',
          assetRole: 'character',
          poseFamilyId: 'narrator-actions',
          z: 2,
          states: [
            {id: 'waiting', src: 'fixtures/vox-primitives/traveler.png', at: 0, facing: 'front'},
            {id: 'pointing', src: 'fixtures/vox-primitives/traveler.png', at: 0.45, facing: 'front'},
          ],
          playback: {mode: 'once', cycles: 1},
          transition: {type: 'cut', durationSeconds: 0},
          transform: {x: 0.7, y: 0.3, width: 0.2, height: 0.5},
        },
      ],
    },
    camera: {preset: 'static', intensity: 0},
    narration: {
      src: 'fixtures/vox-primitives/tone.wav',
      startSeconds: 0,
      durationSeconds: scene.estimatedDurationSeconds,
      text: scene.message,
    },
    events: [],
  })),
});

test('editorial attribution limits responsive placement changes to affected scenes', () => {
  const before = {
    timebase: {fps: 30, rounding: 'nearest'},
    responsiveProfiles: [{id: '16:9', width: 1920, height: 1080}],
    activeProfile: '16:9',
    sceneDirecting: [
      {sceneId: 'scene-01', placements: [{nodeId: 'crow', x: 0.2}]},
      {sceneId: 'scene-02', placements: [{nodeId: 'jar', x: 0.6}]},
    ],
    responsivePlans: [{
      profileId: '16:9',
      scenes: [
        {sceneId: 'scene-01', placements: [{nodeId: 'crow', x: 0.2}]},
        {sceneId: 'scene-02', placements: [{nodeId: 'jar', x: 0.6}]},
      ],
    }],
  };
  const after = structuredClone(before);
  after.sceneDirecting[1].placements[0].x = 0.62;
  after.responsivePlans[0].scenes[1].placements[0].x = 0.62;
  assert.deepEqual(
    changedEditorialSceneIds({
      before,
      after,
      sceneIds: ['scene-01', 'scene-02'],
    }),
    ['scene-02'],
  );

  after.activeProfile = '9:16';
  assert.deepEqual(
    changedEditorialSceneIds({
      before,
      after,
      sceneIds: ['scene-01', 'scene-02'],
    }),
    ['scene-01', 'scene-02'],
  );
});

test('preview directing revision preserves approvals and invalidates derived artifacts', async () => {
  const {storyboard, project, production} = await loadFixture();
  const supplied = structuredClone(storyboard);
  supplied.scenes[0].beats[1].treatments[0].rationale += ' 修改入场速度以回应预览反馈。';
  const result = prepareDirectingRevision({
    currentStoryboard: storyboard,
    suppliedStoryboard: supplied,
    plan: project.plan,
    styleProfile: project.styleProfile,
    production,
    reportPath: 'projects/directing-revision-fixture/directing-revision.json',
    at: '2026-07-23T01:00:00.000Z',
  });
  assert.deepEqual(result.report.changedSceneIds, ['scene-01']);
  assert.ok(result.report.changedScenes[0].categories.includes('directing-fingerprint'));
  assert.equal(result.report.providerApprovalRequired, false);
  assert.equal(result.production.approvals.concept.status, 'approved');
  assert.equal(result.production.approvals.styleAndVoice.status, 'approved');
  assert.equal(result.production.artifacts.preview, null);
  assert.equal(result.production.artifacts.final, null);
  assert.equal(result.production.artifacts.directingRevision, 'projects/directing-revision-fixture/directing-revision.json');
  assert.equal(result.production.workItems.some(({id}) => id === 'directing-revision-scene-01'), true);
});

test('preview directing revision records spatial-contract corrections as directing changes', async () => {
  const {storyboard, project, production} = await loadFixture();
  const supplied = structuredClone(storyboard);
  supplied.spatialContracts = [
    {
      id: 'subject-grounding',
      kind: 'grounding',
      sceneId: 'scene-01',
      subjectNodeId: 'subject',
      supportNodeId: 'background',
      proofTimeIds: ['proof-action', 'proof-final'],
      subjectAnchor: {mode: 'normalized', x: 0.5, y: 0.9},
      supportSurface: {
        points: [{x: 0.2, y: 0.8}, {x: 0.8, y: 0.8}],
      },
      supportScreenBand: {minY: 0.75, maxY: 0.85},
      mode: 'contact',
      maxGap: 0.03,
      maxPenetration: 0.03,
      maxRelativeDrift: 0.05,
    },
  ];
  const result = prepareDirectingRevision({
    currentStoryboard: storyboard,
    suppliedStoryboard: supplied,
    plan: project.plan,
    styleProfile: project.styleProfile,
    production,
    reportPath: 'projects/directing-revision-fixture/directing-revision.json',
    at: '2026-07-23T01:00:00.000Z',
  });
  assert.equal(result.report.spatialContractsChanged, true);
  assert.deepEqual(result.report.changedSpatialContractIds, ['subject-grounding']);
  assert.deepEqual(result.report.changedSceneIds, ['scene-01']);
  assert.equal(result.storyboard.spatialContracts.length, 1);
  assert.equal(result.report.protectedConceptFingerprint, storyboardConceptFingerprint(storyboard));
});

test('proof state coverage is execution-owned and synchronizes atomically without semantic escalation', async () => {
  const {storyboard, project, production} = await loadFixture();
  const supplied = structuredClone(storyboard);
  supplied.scenes[0].proofTimes[1].stateAssertions = [
    {nodeId: 'narrator', stateId: 'pointing'},
    {nodeId: 'narrator', stateId: 'waiting'},
  ];
  const result = prepareDirectingRevision({
    currentStoryboard: storyboard,
    suppliedStoryboard: supplied,
    plan: project.plan,
    styleProfile: project.styleProfile,
    production,
    reportPath:
      'projects/directing-revision-fixture/directing-revision.json',
    at: '2026-08-10T01:00:00.000Z',
  });
  assert.deepEqual(result.report.changedSceneIds, ['scene-01']);
  assert.ok(
    result.report.changedScenes[0].categories.includes('proof-coverage'),
  );
  const currentProject = executionProjectFor(storyboard);
  const synchronized = synchronizeDirectingExecution({
    currentProject,
    storyboard: result.storyboard,
    allowedSceneIds: result.report.changedSceneIds,
  });
  assert.deepEqual(
    synchronized.project.scenes[0].motion.proofTimes,
    result.storyboard.scenes[0].proofTimes,
  );
  assert.equal(synchronized.report.unresolvedIssueCount, 0);
});

test('execution synchronization removes storyboard/project semantic drift without allowing source smuggling', async () => {
  const {storyboard} = await loadFixture();
  const currentProject = executionProjectFor(storyboard);
  const revised = structuredClone(storyboard);
  revised.scenes[0].title = '同步后的镜头标题';
  revised.scenes[0].message = '同步后的旁白文案。';
  revised.scenes[0].blueprint = 'quiet-lockup';
  const synchronized = synchronizeDirectingExecution({
    currentProject,
    storyboard: revised,
    allowedSceneIds: ['scene-01'],
  });
  assert.equal(
    synchronized.project.scenes[0].label,
    '同步后的镜头标题',
  );
  assert.equal(
    synchronized.project.scenes[0].narration.text,
    '同步后的旁白文案。',
  );
  assert.equal(
    synchronized.project.scenes[0].motion.blueprint,
    'quiet-lockup',
  );

  const smuggled = structuredClone(currentProject);
  smuggled.scenes[0].narration.src = 'unauthorized-new-voice.wav';
  assert.throws(
    () =>
      synchronizeDirectingExecution({
        currentProject,
        storyboard: revised,
        executionCandidate: smuggled,
        allowedSceneIds: ['scene-01'],
      }),
    /改变了旁白源、时长、字幕或其他非导演镜头字段/,
  );
});

test('style-review directing revision preserves the approved concept before style approval exists', async () => {
  const {storyboard, project, production} = await loadFixture();
  const supplied = structuredClone(storyboard);
  supplied.scenes[0].beats[1].treatments[0].rationale += ' 在风格审查中调整可见变化的执行节奏。';
  const styleReview = structuredClone(production);
  styleReview.stage = 'style-review';
  styleReview.approvals.styleAndVoice = {status: 'pending', decidedAt: null, note: ''};
  const result = prepareDirectingRevision({
    currentStoryboard: storyboard,
    suppliedStoryboard: supplied,
    plan: project.plan,
    styleProfile: project.styleProfile,
    production: styleReview,
    reportPath: 'projects/directing-revision-fixture/directing-revision.json',
    source: 'style-review',
    at: '2026-07-25T01:00:00.000Z',
  });
  assert.equal(result.production.stage, 'style-review');
  assert.equal(result.production.approvals.styleAndVoice.status, 'pending');
  assert.equal(result.report.source, 'style-review');
});

test('preview directing revision rejects protected concept changes and no-op input', async () => {
  const {storyboard, project, production} = await loadFixture();
  const conceptChange = structuredClone(storyboard);
  conceptChange.scenes[0].message = '改变已经批准的镜头含义';
  assert.throws(() => prepareDirectingRevision({
    currentStoryboard: storyboard,
    suppliedStoryboard: conceptChange,
    plan: project.plan,
    styleProfile: project.styleProfile,
    production,
    reportPath: 'projects/example/directing-revision.json',
  }), /不得改变已批准/);
  assert.throws(() => prepareDirectingRevision({
    currentStoryboard: storyboard,
    suppliedStoryboard: structuredClone(storyboard),
    plan: project.plan,
    styleProfile: project.styleProfile,
    production,
    reportPath: 'projects/example/directing-revision.json',
  }), /没有产生任何实际变化/);
});

test('preview directing revision requires the recorded human return gate', async () => {
  const {storyboard, project, production} = await loadFixture();
  const supplied = structuredClone(storyboard);
  supplied.scenes[0].beats[1].treatments[0].rationale += ' 调整。';
  production.approvals.preview.status = 'pending';
  assert.throws(() => prepareDirectingRevision({
    currentStoryboard: storyboard,
    suppliedStoryboard: supplied,
    plan: project.plan,
    styleProfile: project.styleProfile,
    production,
    reportPath: 'projects/example/directing-revision.json',
  }), /只能响应已记录/);
});

test('human-authorized semantic revision records changed meaning and recalculates locked-static motion floors', async () => {
  const {storyboard, project, production} = await loadFixture();
  const plan = {
    ...project.plan,
    storyScope: 'concise',
    scenarioBinding: {
      scenarioSetFingerprint: 'a'.repeat(64),
      optionId: 'draft',
      optionFingerprint: 'b'.repeat(64),
      expectedProviderImageCalls: 1,
      proposedImageAttemptLimit: 1,
      providerRootPlan: buildProviderRootPlan({
        id: 'draft',
        scenes: [],
      }),
      selectedAt: '2026-07-23T00:00:00.000Z',
    },
    profilePromise: {
      minRequiredStateFamilies: 0,
      minEnhancementStateFamilies: 0,
      minTotalStates: 0,
      minLocalMotionTargets: 1,
      minLayeredScenes: 0,
      minParallaxScenes: 0,
      minAmbientScenes: 0,
    },
  };
  const current = compileStoryboardDirecting(
    structuredClone(directingRevisionAuthoring),
    {plan, styleProfile: project.styleProfile},
  );
  const supplied = structuredClone(current);
  supplied.scenes[0].message = '主体安静停留，让观众阅读画面中的结论。';
  supplied.scenes[0].motionPolicy = 'locked-static';
  supplied.scenes[0].staticRationale = '用户要求结尾完全静止，保留阅读时间。';
  for (const beat of supplied.scenes[0].beats) {
    for (const treatment of beat.treatments) {
      treatment.changeClass = 'static-hold';
      treatment.motion = {kind: 'static'};
      treatment.graphic = null;
      treatment.rationale = '人工授权的完全静止阅读镜头。';
    }
  }
  for (const proof of supplied.scenes[0].proofTimes) {
    proof.stateAssertions = [];
  }
  const authorization = {
    schemaVersion: 1,
    id: 'quiet-ending',
    slug: current.slug,
    source: 'preview-changes-requested',
    allowedSceneIds: ['scene-01'],
    humanNote: '结尾不要再动，让孩子有时间看清楚结论。',
    equivalentQualityEvidence: [
      '最终 proof 必须保持主体、结论和安全区同时清晰可读。',
    ],
    decidedAt: '2026-07-23T00:30:00.000Z',
  };
  const result = prepareSemanticRevision({
    currentStoryboard: current,
    suppliedStoryboard: supplied,
    plan,
    styleProfile: project.styleProfile,
    production,
    authorization,
    reportPath: 'projects/directing-revision-fixture/semantic-revision.json',
    at: '2026-07-23T01:00:00.000Z',
  });
  assert.deepEqual(result.report.semanticChangedSceneIds, ['scene-01']);
  assert.equal(result.storyboard.scenes[0].motionPolicy, 'locked-static');
  assert.equal(
    result.plan.profilePromise.minLocalMotionTargets,
    0,
  );
  assert.equal(result.plan.profilePromise.minParallaxScenes, 0);
  assert.equal(result.plan.profilePromise.minAmbientScenes, 0);
  assert.deepEqual(
    result.plan.profilePromiseRevision.lockedSceneIds,
    ['scene-01'],
  );
  assert.equal(
    result.production.history.at(-1).action,
    'revise-preview-semantic',
  );
  assert.equal(
    result.production.artifacts.semanticRevision,
    'projects/directing-revision-fixture/semantic-revision.json',
  );
  assert.equal(result.production.artifacts.styleProof, null);
});

test('semantic revision cannot change an unapproved scene or masquerade as a directing-only revision', async () => {
  const {storyboard, project, production} = await loadFixture();
  const supplied = structuredClone(storyboard);
  supplied.scenes[0].message = '改变镜头含义';
  const authorization = {
    schemaVersion: 1,
    id: 'wrong-scene',
    slug: storyboard.slug,
    source: 'preview-changes-requested',
    allowedSceneIds: ['missing-scene'],
    humanNote: '只改另一个镜头。',
    equivalentQualityEvidence: ['保持原质量。'],
    decidedAt: '2026-07-23T00:30:00.000Z',
  };
  assert.throws(
    () => prepareSemanticRevision({
      currentStoryboard: storyboard,
      suppliedStoryboard: supplied,
      plan: project.plan,
      styleProfile: project.styleProfile,
      production,
      authorization,
      reportPath: 'projects/example/semantic-revision.json',
    }),
    /人工授权|当前项目/,
  );
});

test('semantic revision rejects directing changes outside the authorized scene set', async () => {
  const authoring = structuredClone(directingRevisionAuthoring);
  const second = structuredClone(authoring.scenes[0]);
  second.id = 'scene-02';
  second.title = '第二张纸面';
  for (const beat of second.beats) {
    beat.id = `second-${beat.id}`;
    beat.proofTimeId = `second-${beat.proofTimeId}`;
    for (const treatment of beat.treatments) {
      treatment.id = `second-${treatment.id}`;
      treatment.targetId = `${treatment.targetId}-02`;
      treatment.proofTimeId = `second-${treatment.proofTimeId}`;
    }
  }
  for (const proof of second.proofTimes) {
    proof.id = `second-${proof.id}`;
    for (const assertion of proof.stateAssertions ?? []) {
      assertion.nodeId = `${assertion.nodeId}-02`;
    }
  }
  authoring.scenes.push(second);
  authoring.sceneTransitions = [
    {
      id: 'scene-01-scene-02',
      fromSceneId: 'scene-01',
      toSceneId: 'scene-02',
      intent: 'location-change',
      rationale: '第二张纸面继续同一个可读动作。',
      treatment: {
        type: 'wipe',
        edgeStyle: 'paper',
        motivation: 'authored',
        direction: 'left-to-right',
        durationSeconds: 0.4,
      },
    },
  ];
  authoring.editorial = createEditorialFixture({
    sceneIds: ['scene-01', 'scene-02'],
    mediaDurationSeconds: 12,
  });
  const plan = {
    ...directingRevisionPlan,
    resolved: {
      ...directingRevisionPlan.resolved,
      durationSeconds: 12,
      sceneCount: 2,
    },
  };
  const current = compileStoryboardDirecting(authoring, {
    plan,
    styleProfile: directingRevisionStyleProfile,
  });
  const supplied = structuredClone(current);
  supplied.scenes[0].message = '人工只授权改变第一幕含义。';
  supplied.scenes[1].beats[1].treatments[0].rationale +=
    ' 未经授权的导演变化。';
  const authorization = {
    schemaVersion: 1,
    id: 'scene-one-only',
    slug: current.slug,
    source: 'preview-changes-requested',
    allowedSceneIds: ['scene-01'],
    humanNote: '只修改第一幕。',
    equivalentQualityEvidence: ['第二幕必须保持不变。'],
    decidedAt: '2026-08-10T00:30:00.000Z',
  };
  assert.throws(
    () =>
      prepareSemanticRevision({
        currentStoryboard: current,
        suppliedStoryboard: supplied,
        plan,
        styleProfile: directingRevisionStyleProfile,
        production: structuredClone(directingRevisionProduction),
        authorization,
        reportPath:
          'projects/directing-revision-fixture/semantic-revision.json',
      }),
    /执行变化越过人类授权镜头：scene-02/,
  );
});

// validateDirectingExecution only walks plan → node, so a state sequence the
// plan no longer contains was invisible to sync. A hand-edited tree could keep
// one, sync reported a synchronized and verified tree, and only the blueprint
// rejected it — the success line read as verification it had not performed.
test('synchronization names an orphan state sequence instead of passing it through', async () => {
  const {storyboard} = await loadFixture();
  const currentProject = executionProjectFor(storyboard);
  currentProject.scenes[0].composition.nodes.push({
    id: 'sheep-flock',
    kind: 'state-sequence',
    assetRole: 'character',
    poseFamilyId: 'sheep-actions',
    z: 3,
    states: [
      {id: 'grazing', src: 'fixtures/vox-primitives/traveler.png', at: 0, facing: 'front'},
      {id: 'grazing', src: 'fixtures/vox-primitives/traveler.png', at: 0.5, facing: 'front'},
    ],
    playback: {mode: 'once', cycles: 1},
    transition: {type: 'cut', durationSeconds: 0},
    transform: {x: 0.1, y: 0.3, width: 0.2, height: 0.4},
  });
  assert.throws(
    () =>
      synchronizeDirectingExecution({
        currentProject,
        storyboard,
        allowedSceneIds: ['scene-01'],
      }),
    (error) =>
      error.code === 'DIRECTING_EXECUTION_SYNC_UNRESOLVED' &&
      error.issues.some(
        ({code, message}) =>
          code === 'execution-sync-orphan-state-sequence' &&
          message.includes('sheep-flock') &&
          message.includes('--execution'),
      ),
  );
});
