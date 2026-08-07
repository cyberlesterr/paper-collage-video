import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import {
  buildSpatialContractProof,
  inspectSpatialContract,
  validateMultiActorNarrationSpatialCoverage,
} from '../scripts/spatial-contract-lib.mjs';
import {ROOT} from '../scripts/project-lib.mjs';

const still = {
  keyframes: [
    {at: 0, offsetX: 0, offsetY: 0},
    {at: 1, offsetX: 0, offsetY: 0},
  ],
};

const asset = ({
  id,
  x = 0,
  y = 0,
  width = 1,
  height = 1,
  z = 0,
  src = null,
  motion = still,
}) => ({
  id,
  kind: 'asset',
  assetRole: 'environment',
  ...(src ? {src} : {}),
  z,
  transform: {x, y, width, height, anchorX: 0, anchorY: 0},
  motion,
});

const stateSequence = ({
  id = 'actor',
  facing = 'right',
  motion = still,
  x = 0.3,
  y = 0.4,
  width = 0.2,
  height = 0.3,
  rotation = 0,
}) => ({
  id,
  kind: 'state-sequence',
  assetRole: 'character',
  poseFamilyId: 'actor-family',
  registration: {
    id: 'actor-registration',
    sourceMasterAssetId: 'actor-sheet',
    canvas: {width: 1000, height: 1000},
    origin: 'top-left',
  },
  anchorPolicy: {
    requiredAnchorIds: ['ground-contact'],
    maximumDrift: 0.01,
  },
  states: [
    {
      id: 'pose-a',
      src: 'fixtures/spatial/pose-a.png',
      at: 0,
      facing,
      anchors: [{id: 'ground-contact', x: 0.5, y: 1}],
      identityReferenceAssetId: 'actor-master',
      identityReferenceSha256: 'a'.repeat(64),
    },
    {
      id: 'pose-b',
      src: 'fixtures/spatial/pose-b.png',
      at: 0.5,
      facing,
      anchors: [{id: 'ground-contact', x: 0.5, y: 1}],
      identityReferenceAssetId: 'actor-master',
      identityReferenceSha256: 'a'.repeat(64),
    },
  ],
  playback: {mode: 'loop', cycles: 8},
  transition: {type: 'cut', durationSeconds: 0},
  z: 2,
  transform: {x, y, width, height, anchorX: 0, anchorY: 0, rotation},
  motion,
});

const proofTimes = [
  {id: 'establish', at: 0.08, kind: 'establish', label: 'establish', assertions: []},
  {id: 'action', at: 0.35, kind: 'action', label: 'action', assertions: []},
  {id: 'peak', at: 0.62, kind: 'peak', label: 'peak', assertions: []},
  {id: 'settle', at: 0.9, kind: 'final', label: 'settle', assertions: []},
];

const scene = ({id, nodes, proofs = proofTimes, narration = null}) => ({
  id,
  label: id,
  eyebrow: id,
  tailSeconds: 0,
  durationInFrames: 240,
  motion: {
    blueprint: 'chapter-tableau',
    intensity: 1,
    seed: 7,
    proofTimes: proofs,
  },
  composition: {
    coordinateSpace: {width: 1000, height: 1000},
    nodes,
  },
  camera: {
    preset: 'static',
    intensity: 1,
    parallax: {enabled: false, strength: 0, focalDepth: 0},
  },
  narration: narration ?? {
    src: `fixtures/spatial/${id}.wav`,
    startSeconds: 0,
    durationSeconds: 8,
    text: id,
  },
  subtitles: [],
  events: [],
});

const baseProject = (scenes, spatialContracts = []) => ({
  slug: 'occlusion-action-test',
  video: {width: 1000, height: 1000, fps: 30},
  scenes,
  sceneTransitions: [],
  editorial: {
    activeProfile: '1:1',
    responsiveProfiles: [{
      id: '1:1',
      width: 1000,
      height: 1000,
      safeArea: {x: 0.05, y: 0.05, width: 0.9, height: 0.9},
      densityBudget: 10,
      typographyScale: 1,
      parallaxScale: 1,
      exclusionZones: [],
    }],
    responsivePlans: [],
    cues: [
      {
        id: 'cue-approach',
        kind: 'narration-phrase',
        sceneId: 'scene-1',
        mediaId: 'narration-1',
        atSeconds: 2.8,
        priority: 60,
        toleranceSeconds: 0.1,
      },
    ],
  },
  spatialContracts,
});

test('occlusion contract proves paint order and rejects a lifted subject', async () => {
  const foreground = asset({
    id: 'grass',
    x: 0.3,
    y: 0.5,
    width: 0.5,
    height: 0.2,
    z: 5,
  });
  const subject = stateSequence({
    id: 'hero',
    x: 0.4,
    y: 0.55,
    width: 0.3,
    height: 0.4,
  });
  const contract = {
    id: 'occlusion-grass',
    kind: 'occlusion',
    sceneId: 'scene-1',
    subjectNodeId: 'hero',
    foregroundNodeId: 'grass',
    relation: 'in-front-of-subject',
    proofTimeIds: ['establish', 'settle'],
    minimumAlphaOverlap: 0.05,
    rationale: 'Foreground grass naturally covers the hero lower body.',
  };
  const project = baseProject([
    scene({id: 'scene-1', nodes: [subject, foreground]}),
  ], [contract]);
  const passed = await inspectSpatialContract(project, contract);
  assert.equal(passed.passed, true);
  assert.ok(
    passed.checks.some(
      ({id, passed: checkPassed}) =>
        id === 'occlusion-subject-not-lifted:establish' && checkPassed,
    ),
  );

  const lifted = structuredClone(project);
  lifted.scenes[0].composition.nodes.find(({id}) => id === 'hero').z = 9;
  const liftedFailure = await inspectSpatialContract(lifted, contract);
  assert.equal(liftedFailure.passed, false);
  assert.ok(
    liftedFailure.checks.some(
      ({id, passed}) =>
        id.startsWith('occlusion-paint-order:') && !passed,
    ),
  );
});

test('occlusion alpha-tight overlap fails closed when the foreground does not cover the subject', async () => {
  const directory = path.join(ROOT, 'public', 'fixtures', 'occlusion-test');
  await fs.mkdir(directory, {recursive: true});
  try {
    const subjectFile = path.join(directory, 'hero.png');
    const foregroundFile = path.join(directory, 'grass.png');
    await sharp({
      create: {
        width: 200,
        height: 200,
        channels: 4,
        background: {r: 0, g: 0, b: 0, alpha: 0},
      },
    })
      .composite([{
        input: Buffer.from(
          '<svg width="200" height="200"><rect x="60" y="40" width="80" height="140" fill="#3b7d42"/></svg>',
        ),
        left: 0,
        top: 0,
      }])
      .png()
      .toFile(subjectFile);
    await sharp({
      create: {
        width: 200,
        height: 200,
        channels: 4,
        background: {r: 0, g: 0, b: 0, alpha: 0},
      },
    })
      .composite([{
        input: Buffer.from(
          '<svg width="200" height="200"><rect x="20" y="150" width="160" height="30" fill="#4a7a2e"/></svg>',
        ),
        left: 0,
        top: 0,
      }])
      .png()
      .toFile(foregroundFile);
    const foreground = asset({
      id: 'grass',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      z: 5,
      src: 'fixtures/occlusion-test/grass.png',
    });
    const subject = asset({
      id: 'hero',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      z: 2,
      src: 'fixtures/occlusion-test/hero.png',
    });
    const contract = {
      id: 'occlusion-alpha',
      kind: 'occlusion',
      sceneId: 'scene-1',
      subjectNodeId: 'hero',
      foregroundNodeId: 'grass',
      relation: 'in-front-of-subject',
      proofTimeIds: ['establish'],
      minimumAlphaOverlap: 0.08,
      rationale: 'grass bar overlaps the hero lower body',
    };
    const project = baseProject([
      scene({id: 'scene-1', nodes: [subject, foreground]}),
    ], [contract]);
    const passed = await buildSpatialContractProof(project, contract);
    assert.equal(passed.passed, true);

    const lifted = structuredClone(project);
    lifted.scenes[0].composition.nodes.find(({id}) => id === 'hero').z = 9;
    const failed = await buildSpatialContractProof(lifted, contract);
    assert.equal(failed.passed, false);
  } finally {
    await fs.rm(directory, {recursive: true, force: true});
  }
});

test('action-sequence proves ordered multi-phase motion and per-actor contracts', async () => {
  const moving = {
    keyframes: [
      {at: 0, offsetX: -0.2, offsetY: 0},
      {at: 1, offsetX: 0.2, offsetY: 0},
    ],
  };
  const actor = stateSequence({id: 'tiger', motion: moving});
  const prey = stateSequence({
    id: 'fox',
    x: 0.5,
    y: 0.45,
    width: 0.18,
    height: 0.26,
    motion: moving,
  });
  const actorContract = {
    id: 'tiger-path',
    kind: 'travel-facing',
    sceneId: 'scene-1',
    nodeId: 'tiger',
    fromProofTimeId: 'establish',
    throughProofTimeId: 'settle',
    direction: 'right',
    expectedFacing: 'right',
    minimumTravel: 0.3,
    rationale: 'tiger advances right across the scene',
  };
  const preyContract = {
    id: 'fox-path',
    kind: 'travel-facing',
    sceneId: 'scene-1',
    nodeId: 'fox',
    fromProofTimeId: 'establish',
    throughProofTimeId: 'settle',
    direction: 'right',
    expectedFacing: 'right',
    minimumTravel: 0.2,
    rationale: 'fox retreats right while pressed',
  };
  const contract = {
    id: 'tiger-pounce',
    kind: 'action-sequence',
    sceneId: 'scene-1',
    narrationCueId: 'cue-approach',
    narrationToleranceSeconds: 0.5,
    phases: [
      {phase: 'establish', proofTimeId: 'establish', nodeId: 'tiger'},
      {
        phase: 'action',
        proofTimeId: 'action',
        nodeId: 'tiger',
        direction: 'right',
        minimumTravel: 0.09,
      },
      {phase: 'peak', proofTimeId: 'peak', nodeId: 'tiger'},
      {phase: 'settle', proofTimeId: 'settle', nodeId: 'tiger'},
    ],
    actors: [
      {nodeId: 'tiger', contractId: 'tiger-path'},
      {nodeId: 'fox', contractId: 'fox-path'},
    ],
  };
  const project = baseProject([
    scene({id: 'scene-1', nodes: [actor, prey]}),
  ], [contract, actorContract, preyContract]);
  const passed = await inspectSpatialContract(project, contract);
  assert.equal(passed.passed, true);
  assert.ok(
    passed.checks.some(
      ({id, passed: checkPassed}) =>
        id === 'action-actor-trajectory' && checkPassed,
    ),
  );

  const endpointOnly = structuredClone(project);
  endpointOnly.spatialContracts[0].phases = [
    {phase: 'establish', proofTimeId: 'establish', nodeId: 'tiger'},
    {
      phase: 'action',
      proofTimeId: 'action',
      nodeId: 'tiger',
      direction: 'right',
      minimumTravel: 0.5,
    },
    {phase: 'peak', proofTimeId: 'settle', nodeId: 'tiger'},
    {phase: 'settle', proofTimeId: 'peak', nodeId: 'tiger'},
  ];
  const endpointFailure = await inspectSpatialContract(
    endpointOnly,
    endpointOnly.spatialContracts[0],
  );
  assert.equal(endpointFailure.passed, false);
  assert.ok(
    endpointFailure.checks.some(
      ({id, passed}) =>
        (id === 'action-phase-travel:action' || id === 'action-sequence-ordered') &&
        !passed,
    ),
  );

  const missingActorContract = structuredClone(project);
  missingActorContract.spatialContracts = [
    contract,
    actorContract,
  ];
  const actorFailure = await inspectSpatialContract(
    missingActorContract,
    contract,
  );
  assert.equal(actorFailure.passed, false);
  assert.ok(
    actorFailure.checks.some(
      ({id, passed}) => id === 'action-actor-trajectory' && !passed,
    ),
  );
});

test('multi-actor narration requires per-actor spatial coverage', () => {
  const moving = {
    keyframes: [
      {at: 0, offsetX: -0.2, offsetY: 0},
      {at: 1, offsetX: 0.2, offsetY: 0},
    ],
  };
  const project = baseProject([
    scene({
      id: 'scene-1',
      nodes: [
        stateSequence({id: 'tiger', motion: moving}),
        stateSequence({
          id: 'fox',
          x: 0.5,
          y: 0.45,
          width: 0.18,
          height: 0.26,
          motion: moving,
        }),
      ],
    }),
  ], []);
  const issues = validateMultiActorNarrationSpatialCoverage(project);
  assert.equal(issues.length, 2);

  const covered = baseProject([
    scene({
      id: 'scene-1',
      nodes: [
        stateSequence({id: 'tiger', motion: moving}),
        stateSequence({
          id: 'fox',
          x: 0.5,
          y: 0.45,
          width: 0.18,
          height: 0.26,
          motion: moving,
        }),
      ],
    }),
  ], [
    {
      id: 'tiger-path',
      kind: 'travel-facing',
      sceneId: 'scene-1',
      nodeId: 'tiger',
      fromProofTimeId: 'establish',
      throughProofTimeId: 'settle',
      direction: 'right',
      expectedFacing: 'right',
      minimumTravel: 0.3,
      rationale: 'tiger advances',
    },
    {
      id: 'fox-path',
      kind: 'travel-facing',
      sceneId: 'scene-1',
      nodeId: 'fox',
      fromProofTimeId: 'establish',
      throughProofTimeId: 'settle',
      direction: 'right',
      expectedFacing: 'right',
      minimumTravel: 0.2,
      rationale: 'fox retreats',
    },
  ]);
  assert.deepEqual(
    validateMultiActorNarrationSpatialCoverage(covered),
    [],
  );
});

test('travel-facing binds facing to the rendered transform', async () => {
  const moving = {
    keyframes: [
      {at: 0, offsetX: -0.2, offsetY: 0},
      {at: 1, offsetX: 0.2, offsetY: 0},
    ],
  };
  const contract = {
    id: 'hero-facing',
    kind: 'travel-facing',
    sceneId: 'scene-1',
    nodeId: 'hero',
    fromProofTimeId: 'establish',
    throughProofTimeId: 'settle',
    direction: 'right',
    expectedFacing: 'right',
    minimumTravel: 0.3,
    rationale: 'hero faces the travel direction',
  };
  const passing = baseProject([
    scene({id: 'scene-1', nodes: [stateSequence({id: 'hero', motion: moving})]}),
  ], [contract]);
  assert.equal((await inspectSpatialContract(passing, contract)).passed, true);

  const mirrored = structuredClone(passing);
  mirrored.scenes[0].composition.nodes[0].transform.rotation = 180;
  const failure = await inspectSpatialContract(mirrored, contract);
  assert.equal(failure.passed, false);
  assert.ok(
    failure.checks.some(
      ({id, passed}) => id === 'travel-facing-render-facing' && !passed,
    ),
  );
});
