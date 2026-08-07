import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {createRequestFingerprint, inspectStateSheetRecoveryMask, validateAssetRequest} from '../scripts/provider-lib.mjs';
import {
  inspectCompositeTechnical,
  inspectUntargetedSheetCells,
  proofTimesForStateSequence,
} from '../scripts/quality-lib.mjs';
import {resolvePythonCommand} from '../scripts/python-runtime.mjs';
import {
  createStateFamilyFingerprint,
  resolveOutputStateRegistration,
  stateOutputName,
  summarizeActualPoseSheets,
  validateStateSheetSpec,
} from '../scripts/state-sheet-lib.mjs';
import {
  resolvePathViewWeights,
  resolveSequenceLayers,
  resolveSequenceState,
} from '../scripts/state-sequence-lib.mjs';
import {
  buildTargetWorldMotionProof,
  resolveTargetViewportSnapshot,
} from '../scripts/world-motion-proof-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STYLE_REQUEST = {
  styleProfileBinding: {
    schemaVersion: 1,
    id: 'hand-drawn-cutout-explainer',
    catalogVersion: 'fixture',
    profileFingerprint: 'a'.repeat(64),
    directives: ['fixture ink', 'fixture paper', 'Avoid: fixture gloss'],
  },
  quality: {
    requiredChecks: [
      'style-profile-conformant',
      'identity-family-consistent',
    ],
  },
};
const anchorPolicy = {requiredAnchorIds: ['ground-contact'], maximumDrift: 0.02};
const defaultStateSheetKeying = {
  keyColor: '#ff00ff',
  transparentThreshold: 18,
  opaqueThreshold: 95,
  edgeFeather: 0.6,
  matteErode: 1,
  edgePadding: 6,
};
const stateContract = (state) => ({
  ...state,
  facing: 'right',
  anchors: [{id: 'ground-contact', x: 0.5, y: 0.9}],
});

test('path-bound state sequences inherit proof times from their locomotion contract', () => {
  const scene = {
    id: 'pond',
    motion: {
      proofTimes: [
        {id: 'start', at: 0.05},
        {id: 'turn-a', at: 0.3},
        {id: 'unrelated', at: 0.5},
        {id: 'turn-b', at: 0.7},
        {id: 'settle', at: 0.9},
      ],
    },
  };
  const node = {
    id: 'tadpole',
    motion: {path: {kind: 'cubic-bezier-3d'}},
  };
  const proofTimes = proofTimesForStateSequence({
    scene,
    node,
    spatialContracts: [{
      id: 'tadpole-route',
      kind: 'path-locomotion',
      sceneId: 'pond',
      nodeId: 'tadpole',
      fromProofTimeId: 'start',
      turnProofTimeIds: ['turn-a', 'turn-b'],
      throughProofTimeId: 'settle',
    }],
  });
  assert.deepEqual(
    proofTimes.map(({id}) => id),
    ['start', 'turn-a', 'turn-b', 'settle'],
  );
});

test('path companions in one pose family inherit the lead locomotion proof window', () => {
  const scene = {
    id: 'pond',
    motion: {
      proofTimes: [
        {id: 'start', at: 0.05},
        {id: 'turn', at: 0.5},
        {id: 'settle', at: 0.9},
      ],
    },
    composition: {
      nodes: [
        {
          id: 'lead',
          kind: 'state-sequence',
          poseFamilyId: 'tadpole-swim',
          motion: {path: {kind: 'cubic-bezier-3d'}},
        },
        {
          id: 'follower',
          kind: 'state-sequence',
          poseFamilyId: 'tadpole-swim',
          motion: {path: {kind: 'cubic-bezier-3d'}},
        },
        {
          id: 'unrelated',
          kind: 'state-sequence',
          poseFamilyId: 'other-swim',
          motion: {path: {kind: 'cubic-bezier-3d'}},
        },
      ],
    },
  };
  const spatialContracts = [{
    kind: 'path-locomotion',
    sceneId: 'pond',
    nodeId: 'lead',
    fromProofTimeId: 'start',
    turnProofTimeIds: ['turn'],
    throughProofTimeId: 'settle',
  }];
  assert.deepEqual(
    proofTimesForStateSequence({
      scene,
      node: scene.composition.nodes[1],
      spatialContracts,
    }).map(({id}) => id),
    ['start', 'turn', 'settle'],
  );
  assert.deepEqual(
    proofTimesForStateSequence({
      scene,
      node: scene.composition.nodes[2],
      spatialContracts,
    }),
    [],
  );
});

test('authored state assertions take precedence over locomotion proof fallback', () => {
  const scene = {
    id: 'pond',
    motion: {
      proofTimes: [
        {id: 'start', at: 0.05},
        {
          id: 'authored-state',
          at: 0.5,
          stateAssertions: [{nodeId: 'tadpole', stateId: 'toward-camera'}],
        },
        {id: 'settle', at: 0.9},
      ],
    },
  };
  const proofTimes = proofTimesForStateSequence({
    scene,
    node: {
      id: 'tadpole',
      motion: {path: {kind: 'cubic-bezier-3d'}},
    },
    spatialContracts: [{
      kind: 'path-locomotion',
      sceneId: 'pond',
      nodeId: 'tadpole',
      fromProofTimeId: 'start',
      turnProofTimeIds: [],
      throughProofTimeId: 'settle',
    }],
  });
  assert.deepEqual(proofTimes.map(({id}) => id), ['authored-state']);
});

test('3D path velocity selects and smoothly blends planar, toward, and away swim loops', () => {
  const states = [
    ['planar-a', 0, 'neutral'],
    ['planar-b', 0.16, 'neutral'],
    ['toward-a', 0.32, 'front'],
    ['toward-b', 0.48, 'front'],
    ['away-a', 0.64, 'back'],
    ['away-b', 0.8, 'back'],
  ].map(([id, at, facing]) => ({id, at, facing}));
  const node = {
    states,
    playback: {mode: 'loop', cycles: 4},
    transition: {type: 'cut', durationSeconds: 0},
    pathViewBinding: {
      depthVelocityThreshold: 0.2,
      transitionWidth: 0.1,
      planarStateIds: ['planar-a', 'planar-b'],
      towardStateIds: ['toward-a', 'toward-b'],
      awayStateIds: ['away-a', 'away-b'],
    },
  };
  assert.equal(resolveSequenceState({
    node,
    progress: 0.1,
    pathDepthVelocity: 0,
  }).id, 'planar-a');
  assert.equal(resolveSequenceState({
    node,
    progress: 0.1,
    pathDepthVelocity: 0.4,
  }).id, 'toward-a');
  assert.equal(resolveSequenceState({
    node,
    progress: 0.1,
    pathDepthVelocity: -0.4,
  }).id, 'away-a');

  const transitionWeights = resolvePathViewWeights({
    node,
    pathDepthVelocity: 0.2,
  });
  assert.deepEqual(
    transitionWeights.map(({view}) => view),
    ['planar', 'toward-camera'],
  );
  assert.ok(transitionWeights.every(({weight}) => Math.abs(weight - 0.5) < 1e-9));
  const layers = resolveSequenceLayers({
    node,
    progress: 0.1,
    durationSeconds: 4,
    pathDepthVelocity: 0.2,
  });
  assert.deepEqual(layers.map(({id}) => id), ['planar-a', 'toward-a']);
  assert.ok(layers.every(({opacity}) => Math.abs(opacity - 0.5) < 1e-9));
});

test('horizontal mirror derives opposite facing and registered anchors deterministically', () => {
  const source = {
    id: 'stride',
    facing: 'left',
    anchors: [{id: 'ground-contact', x: 0.25, y: 0.9}],
    orientationTransform: {
      kind: 'horizontal-mirror',
      outputFacing: 'right',
    },
  };
  assert.deepEqual(resolveOutputStateRegistration(source), {
    facing: 'right',
    anchors: [{id: 'ground-contact', x: 0.75, y: 0.9}],
  });
  const invalid = {
    schemaVersion: 1,
    projectSlug: 'fixture-project',
    sceneId: 'scene-1',
    nodeId: 'reader',
    poseFamilyId: 'reader-poses',
    sourceAssetId: 'reader-sheet',
    input: 'public/reader-sheet.png',
    outputDirectory: 'public/states',
    registration: {
      id: 'reader-registration',
      sourceMasterAssetId: 'reader-master',
    },
    identityReference: {assetId: 'reader-master'},
    anchorPolicy,
    layout: {columns: 2, rows: 1},
    states: [
      {...stateContract({id: 'reading', row: 0, column: 0}), orientationTransform: {kind: 'horizontal-mirror', outputFacing: 'right'}},
      stateContract({id: 'pointing', row: 0, column: 1}),
    ],
    keying: defaultStateSheetKeying,
  };
  assert.ok(
    validateStateSheetSpec(invalid).some((error) =>
      error.includes('orientationTransform'),
    ),
  );
});

const sheetRequest = () => ({
  schemaVersion: 8,
  projectSlug: 'fixture-project',
  assetId: 'reader-state-sheet',
  capability: 'image',
  ...STYLE_REQUEST,
  outputSurface: {mode: 'opaque'},
  output: 'public/projects/fixture-project/assets/reader-state-sheet.png',
  prompt: 'A registered 2x2 pose sheet on a uniform chroma background.',
  compositionBinding: {
    sceneId: 'scene-1',
    nodeId: 'reader',
    pattern: 'state-sequence',
    registrationId: 'reader-registration',
    sourceMasterAssetId: 'reader-master',
    outputRole: 'registered-state-sheet',
    canvas: {width: 2048, height: 2048},
    derivation: {method: 'provider-generation'},
  },
  stateSheetBinding: {
    poseFamilyId: 'reader-poses',
    registrationId: 'reader-registration',
    sourceMasterAssetId: 'reader-master',
    identityReferenceAssetId: 'reader-master',
    anchorPolicy,
    layout: {columns: 2, rows: 2},
    states: [
      {stateId: 'reading', row: 0, column: 0},
      {stateId: 'turning', row: 0, column: 1},
      {stateId: 'pointing', row: 1, column: 0},
      {stateId: 'book-down', row: 1, column: 1},
    ].map(stateContract),
    recoveryPolicy: {
      strategy: 'preserve-sheet-context',
      localDeterministicFixFirst: true,
      isolatedCellGeneration: 'forbidden',
      fallback: 'full-sheet-regeneration',
    },
  },
  semanticBinding: {
    riskClass: 'identity-critical',
    contractIds: ['reader-identity'],
    generationFamily: {
      familyId: 'reader-poses',
      identityMemberIds: ['reader'],
      stateMemberIds: ['reading', 'turning', 'pointing', 'book-down'],
      referenceAssetIds: ['reader-master'],
    },
  },
});

test('a single provider request can contractually cover a registered pose sheet', () => {
  const request = sheetRequest();
  assert.equal(validateAssetRequest(request), request);
  const changed = structuredClone(request);
  changed.stateSheetBinding.states[3].column = 0;
  assert.throws(() => validateAssetRequest(changed), /重复或越界/);
  const familyDrift = structuredClone(request);
  familyDrift.semanticBinding.generationFamily.stateMemberIds.pop();
  assert.throws(() => validateAssetRequest(familyDrift), /同一 family 和成员集合/);
  const fingerprint = createRequestFingerprint({request, providerId: 'host-image', model: 'fixture'});
  const changedFingerprint = createRequestFingerprint({request: changed, providerId: 'host-image', model: 'fixture'});
  assert.notEqual(fingerprint, changedFingerprint);
});

test('multi-state provider requests reject isolated cells and require context-preserving recovery', () => {
  const isolated = sheetRequest();
  isolated.assetId = 'reader-pointing-repair';
  delete isolated.stateSheetBinding;
  isolated.stateBinding = {
    poseFamilyId: 'reader-poses',
    stateId: 'pointing',
    registrationId: 'reader-registration',
    sourceMasterAssetId: 'reader-master',
    facing: 'right',
    anchors: [{id: 'ground-contact', x: 0.5, y: 0.9}],
    identityReferenceAssetId: 'reader-master',
  };
  assert.throws(
    () => validateAssetRequest(isolated),
    /禁止独立单格 provider 生成/,
  );

  const masked = sheetRequest();
  masked.assetId = 'reader-state-sheet-repair';
  masked.compositionBinding.derivation = {
    method: 'provider-edit',
    parentAssetId: 'reader-state-sheet',
  };
  masked.semanticBinding.generationFamily.referenceAssetIds.push('reader-state-sheet');
  masked.stateSheetRecoveryBinding = {
    mode: 'masked-sheet-edit',
    sourceSheetAssetId: 'reader-state-sheet',
    targetStateIds: ['pointing'],
    maskAssetId: 'reader-pointing-mask',
    maskPolarity: 'white-is-editable',
  };
  masked.quality = {
    kind: 'character-sheet',
    requiredChecks: [
      'identity-family-consistent',
      'cell-separation',
      'reference-conformant',
      'untargeted-cells-unchanged',
      'style-profile-conformant',
    ],
  };
  assert.equal(validateAssetRequest(masked), masked);

  const detached = structuredClone(masked);
  detached.semanticBinding.generationFamily.referenceAssetIds = ['reader-master'];
  assert.throws(
    () => validateAssetRequest(detached),
    /完整原状态表加入 generationFamily.referenceAssetIds/,
  );

  const allCellsMasked = structuredClone(masked);
  allCellsMasked.stateSheetRecoveryBinding.targetStateIds = masked.stateSheetBinding.states.map(({stateId}) => stateId);
  assert.throws(
    () => validateAssetRequest(allCellsMasked),
    /必须使用 full-sheet-regeneration/,
  );

  const fullSheet = structuredClone(masked);
  fullSheet.compositionBinding.derivation.method = 'provider-generation';
  fullSheet.stateSheetRecoveryBinding = {
    mode: 'full-sheet-regeneration',
    sourceSheetAssetId: 'reader-state-sheet',
    targetStateIds: fullSheet.stateSheetBinding.states.map(({stateId}) => stateId),
  };
  fullSheet.quality.requiredChecks = fullSheet.quality.requiredChecks.filter((check) => check !== 'untargeted-cells-unchanged');
  assert.equal(validateAssetRequest(fullSheet), fullSheet);
});

test('masked sheet edits preserve every untargeted cell at pixel level', async () => {
  const directory = path.join(ROOT, 'projects', `sheet-context-${process.pid}`);
  const sourceFile = path.join(directory, 'source.png');
  const repairedFile = path.join(directory, 'repaired.png');
  const driftedFile = path.join(directory, 'drifted.png');
  const sheetBinding = sheetRequest().stateSheetBinding;
  sheetBinding.layout = {columns: 2, rows: 1};
  sheetBinding.states = [
    {stateId: 'reading', row: 0, column: 0},
    {stateId: 'pointing', row: 0, column: 1},
  ];
  const recoveryBinding = {
    mode: 'masked-sheet-edit',
    sourceSheetAssetId: 'reader-state-sheet',
    targetStateIds: ['pointing'],
    maskAssetId: 'reader-pointing-mask',
    maskPolarity: 'white-is-editable',
  };
  try {
    await fs.mkdir(directory, {recursive: true});
    await sharp({create: {width: 200, height: 100, channels: 4, background: '#224466ff'}}).png().toFile(sourceFile);
    await sharp(sourceFile).composite([
      {input: Buffer.from('<svg width="100" height="100"><rect width="100" height="100" fill="#dd8844"/></svg>'), left: 100, top: 0},
    ]).png().toFile(repairedFile);
    const preserved = await inspectUntargetedSheetCells({currentFile: repairedFile, sourceFile, stateSheetBinding: sheetBinding, recoveryBinding});
    assert.equal(preserved.passed, true);

    await sharp(repairedFile).composite([
      {input: Buffer.from('<svg width="100" height="100"><rect width="100" height="100" fill="#335577"/></svg>'), left: 0, top: 0},
    ]).png().toFile(driftedFile);
    const drifted = await inspectUntargetedSheetCells({currentFile: driftedFile, sourceFile, stateSheetBinding: sheetBinding, recoveryBinding});
    assert.equal(drifted.passed, false);
    assert.ok(drifted.changedPixelRatio > 0.9);
  } finally {
    await fs.rm(directory, {recursive: true, force: true});
  }
});

test('masked sheet recovery rejects masks that touch accepted cells', async () => {
  const directory = path.join(ROOT, 'projects', `sheet-mask-${process.pid}`);
  const validMask = path.join(directory, 'valid.png');
  const broadMask = path.join(directory, 'broad.png');
  const stateSheetBinding = sheetRequest().stateSheetBinding;
  stateSheetBinding.layout = {columns: 2, rows: 1};
  stateSheetBinding.states = [
    {stateId: 'reading', row: 0, column: 0},
    {stateId: 'pointing', row: 0, column: 1},
  ];
  const recoveryBinding = {
    mode: 'masked-sheet-edit', sourceSheetAssetId: 'reader-state-sheet',
    targetStateIds: ['pointing'], maskAssetId: 'reader-pointing-mask', maskPolarity: 'white-is-editable',
  };
  try {
    await fs.mkdir(directory, {recursive: true});
    await sharp({create: {width: 200, height: 100, channels: 4, background: '#000000ff'}})
      .composite([{input: Buffer.from('<svg width="100" height="100"><rect width="100" height="100" fill="#ffffff"/></svg>'), left: 100, top: 0}])
      .png().toFile(validMask);
    await sharp({create: {width: 200, height: 100, channels: 4, background: '#ffffffff'}}).png().toFile(broadMask);
    assert.equal((await inspectStateSheetRecoveryMask({maskFile: validMask, stateSheetBinding, recoveryBinding})).passed, true);
    const broad = await inspectStateSheetRecoveryMask({maskFile: broadMask, stateSheetBinding, recoveryBinding});
    assert.equal(broad.passed, false);
    assert.ok(broad.activeOutsideTarget > 0);
  } finally {
    await fs.rm(directory, {recursive: true, force: true});
  }
});

test('registered sheet processing preserves row-major cells and produces stable family fingerprints', () => {
  const spec = {
    schemaVersion: 1,
    projectSlug: 'fixture-project',
    sceneId: 'scene-1',
    nodeId: 'reader',
    poseFamilyId: 'reader-poses',
    sourceAssetId: 'reader-state-sheet',
    input: 'public/projects/fixture-project/assets/reader-state-sheet.png',
    outputDirectory: 'public/projects/fixture-project/assets/reader-poses',
    registration: {id: 'reader-registration', sourceMasterAssetId: 'reader-master'},
    identityReference: {assetId: 'reader-master'},
    anchorPolicy,
    layout: {columns: 2, rows: 2},
    states: [
      {id: 'reading', row: 0, column: 0},
      {id: 'turning', row: 0, column: 1},
      {id: 'pointing', row: 1, column: 0},
      {id: 'book-down', row: 1, column: 1},
    ].map(stateContract),
    keying: {...defaultStateSheetKeying, keyColor: 'auto'},
  };
  assert.deepEqual(validateStateSheetSpec(spec), []);
  assert.equal(stateOutputName({poseFamilyId: spec.poseFamilyId, stateId: 'book-down'}), 'reader-poses-book-down.png');
  const members = spec.states.map(({id}) => ({stateId: id, sha256: id}));
  const first = createStateFamilyFingerprint({sourceSha256: 'source', spec, members});
  const second = createStateFamilyFingerprint({sourceSha256: 'source', spec, members: [...members].reverse()});
  assert.equal(first, second);
  assert.equal(first, createStateFamilyFingerprint({sourceSha256: 'source', spec, members: members.map((member) => ({...member, stat: {mtimeMs: Date.now()}}))}));
  const invalid = structuredClone(spec);
  invalid.states[2].column = 1;
  assert.ok(validateStateSheetSpec(invalid).length > 0);
  const invalidKeying = structuredClone(spec);
  invalidKeying.keying.opaqueThreshold = invalidKeying.keying.transparentThreshold;
  assert.ok(
    validateStateSheetSpec(invalidKeying).some((error) =>
      error.includes('transparentThreshold'),
    ),
  );
  const drifted = structuredClone(spec);
  drifted.states[2].anchors[0].x = 0.7;
  assert.ok(validateStateSheetSpec(drifted).some((error) => error.includes('anchor 漂移')));

  const explicit = structuredClone(spec);
  explicit.extraction = {
    mode: 'explicit-source-rects',
    canvas: {width: 140, height: 100},
    cells: explicit.states.map(({id}, index) => ({
      stateId: id,
      sourceRect: {left: index * 100, top: 0, width: 100, height: 100},
      placement: {left: 0, top: 0},
    })),
  };
  assert.deepEqual(validateStateSheetSpec(explicit), []);
  const overlap = structuredClone(explicit);
  overlap.extraction.cells[1].sourceRect.left = 80;
  assert.ok(validateStateSheetSpec(overlap).some((error) => error.includes('不得重叠')));
  assert.notEqual(
    createStateFamilyFingerprint({sourceSha256: 'source', spec, members}),
    createStateFamilyFingerprint({sourceSha256: 'source', spec: explicit, members}),
  );
});

test('state sheet processor turns one recorded provider image into registered local states', async (context) => {
  const python = resolvePythonCommand({root: ROOT});
  const dependencies = spawnSync(python, ['-c', 'import numpy; from PIL import Image'], {cwd: ROOT});
  if (dependencies.status !== 0) return context.skip('numpy and Pillow are not installed');
  const slug = `state-sheet-e2e-${process.pid}`;
  const projectDirectory = path.join(ROOT, 'projects', slug);
  const publicDirectory = path.join(ROOT, 'public', 'projects', slug);
  const input = path.join(publicDirectory, 'reader-sheet.png');
  const outputDirectory = path.join(publicDirectory, 'states');
  try {
    await fs.mkdir(projectDirectory, {recursive: true});
    await fs.mkdir(publicDirectory, {recursive: true});
    const left = await sharp({create: {width: 100, height: 100, channels: 3, background: '#ff00ff'}})
      .composite([{input: Buffer.from('<svg width="100" height="100"><circle cx="30" cy="54" r="24" fill="#3b7d42"/></svg>')}])
      .png().toBuffer();
    const right = await sharp({create: {width: 100, height: 100, channels: 3, background: '#ff00ff'}})
      .composite([{input: Buffer.from('<svg width="100" height="100"><rect x="24" y="24" width="52" height="60" rx="12" fill="#d48a32"/></svg>')}])
      .png().toBuffer();
    await sharp({create: {width: 200, height: 100, channels: 3, background: '#ff00ff'}})
      .composite([{input: left, left: 0, top: 0}, {input: right, left: 100, top: 0}])
      .png().toFile(input);
    const sourceSha256 = createHash('sha256').update(await fs.readFile(input)).digest('hex');
    const binding = {
      poseFamilyId: 'reader-poses', registrationId: 'reader-registration', sourceMasterAssetId: 'reader-master',
      identityReferenceAssetId: 'reader-master', anchorPolicy,
      layout: {columns: 2, rows: 1},
      states: [
        {stateId: 'reading', row: 0, column: 0},
        {stateId: 'pointing', row: 0, column: 1},
      ].map(stateContract),
      recoveryPolicy: {
        strategy: 'preserve-sheet-context', localDeterministicFixFirst: true,
        isolatedCellGeneration: 'forbidden', fallback: 'full-sheet-regeneration',
      },
    };
    await fs.writeFile(path.join(projectDirectory, 'assets-manifest.json'), `${JSON.stringify({
      schemaVersion: 4,
      projectSlug: slug,
      assets: [
        {
          recordId: '1'.padStart(64, '0'), lifecycle: {status: 'recovery-source', changedAt: '2026-01-01T00:00:00.000Z', reason: 'fixture-recovered-state-sheet', supersededBy: null},
          assetId: 'reader-sheet', capability: 'image', file: path.relative(ROOT, input), provider: 'fixture', adapter: 'host',
          attemptId: 'img-44444444-4444-4444-8444-444444444444',
          recoveredFromRejectedAttempt: true,
          requestFingerprint: 'a'.repeat(64), reusedFrom: null, sha256: sourceSha256, sizeBytes: (await fs.stat(input)).size,
          recordedAt: '2026-01-01T00:00:00.000Z', request: {stateSheetBinding: binding}, compositionBinding: null,
          stateSheetBinding: binding, familyFingerprint: null,
          providerObservation: {
            schemaVersion: 1,
            mode: 'provider-native-observed',
            policyId: 'flat-v1',
            policyFingerprint: 'c'.repeat(64),
            observationFingerprint: 'd'.repeat(64),
            sourceAttempt: {
              attemptId: 'img-44444444-4444-4444-8444-444444444444',
              status: 'rejected',
              quotaConsumed: true,
              requestFingerprint: 'a'.repeat(64),
              output: path.relative(ROOT, input),
            },
            cells: ['reading', 'pointing'].map((stateId, index) => ({
              schemaVersion: 1,
              packageRole: 'state',
              stateId,
              mode: 'provider-native-observed',
              policy: {},
              policyFingerprint: 'c'.repeat(64),
              requestedKeyColor: '#ff00ff',
              observedKeyColor: '#ff00ff',
              rect: {
                left: index * 100,
                top: 0,
                width: 100,
                height: 100,
              },
              metrics: {
                totalPixels: 10000,
                candidatePixels: 8000,
                coverage: 0.8,
                boundaryCoverage: 1,
                requestedToObservedDistance: 0,
                clusterP95Distance: 0,
                clusterP99Distance: 0,
                largestComponentShare: 1,
                foregroundP10Distance: 100,
              },
              passed: true,
              reasons: [],
            })),
          },
        },
        {
          recordId: '9'.padStart(64, '0'), lifecycle: {status: 'active', changedAt: '2026-01-01T00:00:00.000Z', reason: 'identity-reference', supersededBy: null},
          assetId: 'reader-master', capability: 'image', file: path.relative(ROOT, input), provider: 'fixture', adapter: 'manual',
          requestFingerprint: '9'.repeat(64), reusedFrom: null, sha256: sourceSha256, sizeBytes: (await fs.stat(input)).size,
          recordedAt: '2026-01-01T00:00:00.000Z', request: null, compositionBinding: null,
        },
      ],
    }, null, 2)}\n`);
    const specFile = path.join(projectDirectory, 'reader-state-sheet.json');
    await fs.writeFile(specFile, `${JSON.stringify({
      schemaVersion: 1, projectSlug: slug, sceneId: 'scene-1', nodeId: 'reader', poseFamilyId: 'reader-poses',
      sourceAssetId: 'reader-sheet', input: path.relative(ROOT, input), outputDirectory: path.relative(ROOT, outputDirectory),
      registration: {id: 'reader-registration', sourceMasterAssetId: 'reader-master'},
      identityReference: {assetId: 'reader-master'}, anchorPolicy,
      layout: {columns: 2, rows: 1}, states: [
        {id: 'reading', row: 0, column: 0},
        {id: 'pointing', row: 0, column: 1},
      ].map((state) => ({
        ...stateContract(state),
        orientationTransform: {
          kind: 'horizontal-mirror',
          outputFacing: 'left',
        },
      })),
      keying: {
        ...defaultStateSheetKeying,
        transparentThreshold: 22,
        opaqueThreshold: 121,
        edgeFeather: 1.25,
        edgePadding: 4,
      },
    }, null, 2)}\n`);
    const processed = spawnSync(process.execPath, ['scripts/process-state-sheet.mjs', path.relative(ROOT, specFile)], {cwd: ROOT, encoding: 'utf8'});
    assert.equal(processed.status, 0, processed.stderr);
    const report = JSON.parse(await fs.readFile(path.join(outputDirectory, 'reader-poses-state-sheet-report.json'), 'utf8'));
    assert.equal(report.providerImageCalls, 1);
    assert.equal(report.schemaVersion, 4);
    assert.equal(report.anchorRegistrationProof.passed, true);
    assert.equal(report.identityReference.assetId, 'reader-master');
    assert.equal(report.generationMode, 'rejected-output-recovery');
    assert.equal(report.sourceLifecycle, 'recovery-source');
    assert.deepEqual(report.observedKeyColors, {
      reading: '#ff00ff',
      pointing: '#ff00ff',
    });
    assert.equal(report.isolatedCellGenerationUsed, false);
    assert.equal(report.derivedStateCount, 2);
    assert.equal(report.avoidedIndividualCalls, 1);
    const keyingMetadata = JSON.parse(
      await fs.readFile(
        path.join(outputDirectory, 'reader-poses-reading.png.key.json'),
        'utf8',
      ),
    );
    assert.equal(keyingMetadata.transparentThreshold, 22);
    assert.equal(keyingMetadata.opaqueThreshold, 121);
    assert.equal(keyingMetadata.edgeFeather, 1.25);
    assert.equal(keyingMetadata.transparentRgb.paddingPixels, 4);
    const dimensions = await Promise.all(['reading', 'pointing'].map(async (stateId) => {
      const metadata = await sharp(path.join(outputDirectory, `reader-poses-${stateId}.png`)).metadata();
      return `${metadata.width}x${metadata.height}:${metadata.hasAlpha}`;
    }));
    assert.deepEqual(dimensions, ['100x100:true', '100x100:true']);
    const manifest = JSON.parse(await fs.readFile(path.join(projectDirectory, 'assets-manifest.json'), 'utf8'));
    assert.equal(manifest.assets.filter(({adapter}) => adapter === 'registered-sheet-cell').length, 2);
    assert.equal(new Set(manifest.assets.filter(({stateBinding}) => stateBinding).map(({familyFingerprint}) => familyFingerprint)).size, 1);
    const reading = manifest.assets.find(
      ({assetId, lifecycle}) =>
        assetId === 'reader-poses-reading' && lifecycle.status === 'active',
    );
    assert.equal(reading.stateBinding.facing, 'left');
    assert.equal(
      reading.compositionBinding.derivation.orientationTransform.kind,
      'horizontal-mirror',
    );
    const alphaCentroidX = await sharp(
      path.join(outputDirectory, 'reader-poses-reading.png'),
    ).ensureAlpha().raw().toBuffer({resolveWithObject: true}).then(
      ({data, info}) => {
        let weightedX = 0;
        let alphaTotal = 0;
        for (let y = 0; y < info.height; y += 1) {
          for (let x = 0; x < info.width; x += 1) {
            const alpha = data[(y * info.width + x) * info.channels + 3];
            weightedX += x * alpha;
            alphaTotal += alpha;
          }
        }
        return weightedX / alphaTotal;
      },
    );
    assert.ok(
      alphaCentroidX > 60,
      `expected mirrored alpha centroid > 60, got ${alphaCentroidX}`,
    );
    assert.deepEqual(summarizeActualPoseSheets(manifest), {
      families: [{
        poseFamilyId: 'reader-poses',
        stateIds: ['pointing', 'reading'],
        sourceAssetIds: ['reader-sheet'],
        providerCalls: 1,
        deterministicDerivatives: 2,
        providerCallsAvoidedByBatching: 1,
      }],
      providerCalls: 1,
      deterministicDerivatives: 2,
      providerCallsAvoidedByBatching: 1,
    });
  } finally {
    await fs.rm(projectDirectory, {recursive: true, force: true});
    await fs.rm(publicDirectory, {recursive: true, force: true});
  }
});

test('explicit registered source rects preserve a full silhouette that crosses a nominal grid boundary', async (context) => {
  const python = resolvePythonCommand({root: ROOT});
  const dependencies = spawnSync(python, ['-c', 'import numpy; from PIL import Image'], {cwd: ROOT});
  if (dependencies.status !== 0) return context.skip('numpy and Pillow are not installed');
  const slug = `state-sheet-explicit-${process.pid}`;
  const projectDirectory = path.join(ROOT, 'projects', slug);
  const publicDirectory = path.join(ROOT, 'public', 'projects', slug);
  const input = path.join(publicDirectory, 'reader-sheet.png');
  const outputDirectory = path.join(publicDirectory, 'states');
  try {
    await fs.mkdir(projectDirectory, {recursive: true});
    await fs.mkdir(publicDirectory, {recursive: true});
    await sharp({create: {width: 220, height: 100, channels: 3, background: '#ff00ff'}})
      .composite([
        {input: Buffer.from('<svg width="120" height="100"><rect x="12" y="28" width="102" height="50" rx="18" fill="#3b7d42"/></svg>'), left: 0, top: 0},
        {input: Buffer.from('<svg width="100" height="100"><rect x="12" y="20" width="76" height="60" rx="14" fill="#d48a32"/></svg>'), left: 120, top: 0},
      ])
      .png().toFile(input);
    const sourceSha256 = createHash('sha256').update(await fs.readFile(input)).digest('hex');
    const binding = {
      poseFamilyId: 'reader-poses', registrationId: 'reader-registration', sourceMasterAssetId: 'reader-master',
      identityReferenceAssetId: 'reader-master', anchorPolicy,
      layout: {columns: 2, rows: 1},
      states: [
        {stateId: 'reading', row: 0, column: 0},
        {stateId: 'pointing', row: 0, column: 1},
      ].map(stateContract),
      recoveryPolicy: {
        strategy: 'preserve-sheet-context', localDeterministicFixFirst: true,
        isolatedCellGeneration: 'forbidden', fallback: 'full-sheet-regeneration',
      },
    };
    await fs.writeFile(path.join(projectDirectory, 'assets-manifest.json'), `${JSON.stringify({
      schemaVersion: 4,
      projectSlug: slug,
      assets: [
        {
          recordId: '2'.padStart(64, '0'), lifecycle: {status: 'active', changedAt: '2026-01-01T00:00:00.000Z', reason: 'fixture', supersededBy: null},
          assetId: 'reader-sheet', capability: 'image', file: path.relative(ROOT, input), provider: 'fixture', adapter: 'host',
          requestFingerprint: 'b'.repeat(64), reusedFrom: null, sha256: sourceSha256, sizeBytes: (await fs.stat(input)).size,
          recordedAt: '2026-01-01T00:00:00.000Z', request: {stateSheetBinding: binding}, compositionBinding: null,
          stateSheetBinding: binding, familyFingerprint: null,
        },
        {
          recordId: '8'.padStart(64, '0'), lifecycle: {status: 'active', changedAt: '2026-01-01T00:00:00.000Z', reason: 'identity-reference', supersededBy: null},
          assetId: 'reader-master', capability: 'image', file: path.relative(ROOT, input), provider: 'fixture', adapter: 'manual',
          requestFingerprint: '8'.repeat(64), reusedFrom: null, sha256: sourceSha256, sizeBytes: (await fs.stat(input)).size,
          recordedAt: '2026-01-01T00:00:00.000Z', request: null, compositionBinding: null,
        },
      ],
    }, null, 2)}\n`);
    const specFile = path.join(projectDirectory, 'reader-state-sheet.json');
    await fs.writeFile(specFile, `${JSON.stringify({
      schemaVersion: 1, projectSlug: slug, sceneId: 'scene-1', nodeId: 'reader', poseFamilyId: 'reader-poses',
      sourceAssetId: 'reader-sheet', input: path.relative(ROOT, input), outputDirectory: path.relative(ROOT, outputDirectory),
      registration: {id: 'reader-registration', sourceMasterAssetId: 'reader-master'},
      identityReference: {assetId: 'reader-master'}, anchorPolicy,
      layout: {columns: 2, rows: 1}, states: [
        {id: 'reading', row: 0, column: 0},
        {id: 'pointing', row: 0, column: 1},
      ].map(stateContract),
      keying: defaultStateSheetKeying,
      extraction: {
        mode: 'explicit-source-rects', canvas: {width: 120, height: 100},
        cells: [
          {stateId: 'reading', sourceRect: {left: 0, top: 0, width: 120, height: 100}, placement: {left: 0, top: 0}},
          {stateId: 'pointing', sourceRect: {left: 120, top: 0, width: 100, height: 100}, placement: {left: 0, top: 0}},
        ],
      },
    }, null, 2)}\n`);
    const processed = spawnSync(process.execPath, ['scripts/process-state-sheet.mjs', path.relative(ROOT, specFile)], {cwd: ROOT, encoding: 'utf8'});
    assert.equal(processed.status, 0, processed.stderr);
    const reading = path.join(outputDirectory, 'reader-poses-reading.png');
    const pointing = path.join(outputDirectory, 'reader-poses-pointing.png');
    const [readingPixels, pointingPixels] = await Promise.all([
      sharp(reading).ensureAlpha().raw().toBuffer({resolveWithObject: true}),
      sharp(pointing).ensureAlpha().raw().toBuffer({resolveWithObject: true}),
    ]);
    assert.equal(readingPixels.info.width, 120);
    assert.equal(pointingPixels.info.width, 120);
    const alphaAt = ({data, info}, x, y) => data[(y * info.width + x) * 4 + 3];
    assert.ok(alphaAt(readingPixels, 110, 52) > 200, 'wide first pose remains intact past nominal 110px grid edge');
    assert.ok(alphaAt(pointingPixels, 86, 52) > 200, 'second pose remains registered on the shared 120px canvas');
    assert.equal(alphaAt(pointingPixels, 119, 52), 0, 'source-rect padding stays keyed transparent rather than becoming an opaque band');
    const manifest = JSON.parse(await fs.readFile(path.join(projectDirectory, 'assets-manifest.json'), 'utf8'));
    const derived = manifest.assets.filter(({adapter}) => adapter === 'registered-sheet-cell');
    assert.deepEqual(derived.map(({compositionBinding}) => compositionBinding.derivation.method), ['explicit-source-rects', 'explicit-source-rects']);
  } finally {
    await fs.rm(projectDirectory, {recursive: true, force: true});
    await fs.rm(publicDirectory, {recursive: true, force: true});
  }
});

test('state-sequence quality requires current anchors, facing, and identity references', async () => {
  const slug = `state-quality-${process.pid}`;
  const directory = path.join(ROOT, 'public', 'projects', slug);
  const evidenceFile = path.join(directory, 'anchors.png');
  try {
    await fs.mkdir(directory, {recursive: true});
    await sharp({
      create: {width: 24, height: 24, channels: 4, background: '#3b7d42ff'},
    }).png().toFile(evidenceFile);
    const evidenceSha256 = createHash('sha256')
      .update(await fs.readFile(evidenceFile))
      .digest('hex');
    const relativeEvidence = path.relative(ROOT, evidenceFile);
    const identitySha256 = 'd'.repeat(64);
    const states = ['reading', 'pointing'].map((id, index) => ({
      id,
      src: `projects/${slug}/${id}.png`,
      at: index * 0.5,
      facing: 'right',
      anchors: [{id: 'ground-contact', x: 0.5, y: 0.9}],
      identityReferenceAssetId: 'reader-master',
      identityReferenceSha256: identitySha256,
    }));
    const stateRecords = states.map((state) => ({
      lifecycle: {status: 'active'},
      media: {width: 24, height: 24},
      stateBinding: {
        poseFamilyId: 'reader-poses',
        stateId: state.id,
        registrationId: 'reader-registration',
        facing: state.facing,
        anchors: state.anchors,
        identityReferenceAssetId: state.identityReferenceAssetId,
        identityReferenceSha256: state.identityReferenceSha256,
        anchorEvidence: {file: relativeEvidence, sha256: evidenceSha256},
      },
    }));
    const target = {
      compositeId: 'state-sequence:scene:reader',
      fingerprint: 'f'.repeat(64),
      pattern: 'state-sequence',
      proofTimeIds: ['proof-reading', 'proof-pointing'],
      sequence: {
        poseFamilyId: 'reader-poses',
        registration: {
          id: 'reader-registration',
          canvas: {width: 24, height: 24},
        },
        anchorPolicy,
        states,
      },
      stateRecords,
      identityReferenceRecords: states.map(() => ({
        lifecycle: {status: 'active'},
        sha256: identitySha256,
      })),
    };
    const temporalFrames = await Promise.all(
      ['t0', 't1', 't2'].map(async (name, index) => {
        const file = path.join(directory, `frame-${name}.png`);
        await sharp({
          create: {
            width: 24,
            height: 24,
            channels: 4,
            background: index % 2 === 0 ? '#3b7d42ff' : '#7d3b42ff',
          },
        }).png().toFile(file);
        return {
          at: index / 2,
          file: path.relative(ROOT, file),
          sha256: createHash('sha256')
            .update(await fs.readFile(file))
            .digest('hex'),
        };
      }),
    );
    const stripFile = path.join(directory, 'motion-strip.jpg');
    await sharp({
      create: {width: 24 * 3, height: 24, channels: 3, background: '#100d0b'},
    }).jpeg().toFile(stripFile);
    const proofReport = {
      composites: [{
        compositeId: target.compositeId,
        fingerprint: target.fingerprint,
        temporalEvidence: {
          file: path.relative(ROOT, stripFile),
          sha256: createHash('sha256')
            .update(await fs.readFile(stripFile))
            .digest('hex'),
          frames: temporalFrames,
        },
        proofFrames: target.proofTimeIds.map((proofTimeId) => ({
          proofTimeId,
          fullFrame: relativeEvidence,
          crop: relativeEvidence,
        })),
      }],
    };
    const current = await inspectCompositeTechnical({target, proofReport});
    assert.equal(current.passed, true);
    assert.ok(current.checks.some(
      ({id, passed}) => id === 'state-anchor-registration' && passed,
    ));

    const staleIdentity = structuredClone(target);
    staleIdentity.identityReferenceRecords[1].sha256 = 'e'.repeat(64);
    const rejected = await inspectCompositeTechnical({
      target: staleIdentity,
      proofReport,
    });
    assert.equal(rejected.passed, false);
    assert.ok(rejected.checks.some(
      ({id, passed}) => id === 'state-identity-reference' && !passed,
    ));
  } finally {
    await fs.rm(directory, {recursive: true, force: true});
  }
});

test('world-motion proof resolves a looping state sequence through its hold state', async () => {
  const slug = `state-proof-${process.pid}`;
  const directory = path.join(ROOT, 'public', 'projects', slug);
  const run = path.join(directory, 'run.png');
  const sleep = path.join(directory, 'sleep.png');
  try {
    await fs.mkdir(directory, {recursive: true});
    await Promise.all([
      sharp({create: {width: 24, height: 24, channels: 4, background: '#3b7d42ff'}}).png().toFile(run),
      sharp({create: {width: 24, height: 24, channels: 4, background: '#d48a32ff'}}).png().toFile(sleep),
    ]);
    const node = {
      id: 'runner', kind: 'state-sequence', poseFamilyId: 'runner-poses',
      registration: {id: 'runner-registration', sourceMasterAssetId: 'runner-sheet', canvas: {width: 24, height: 24}, origin: 'top-left'},
      states: [
        {id: 'sleep', src: `projects/${slug}/sleep.png`, at: 0},
        {id: 'run-a', src: `projects/${slug}/run.png`, at: 0.01},
      ],
      playback: {mode: 'loop', cycles: 2, activeFrom: 0.01, activeUntil: 0.3, holdStateId: 'sleep', activeStateIds: ['run-a']},
      transition: {type: 'cut', durationSeconds: 0}, z: 2, depth: 0,
      transform: {x: 0.2, y: 0.5, width: 0.2, height: 0.2, anchorX: 0, anchorY: 0},
      motion: {keyframes: [{at: 0, offsetX: 0}, {at: 1, offsetX: 0}]},
    };
    const scene = {
      camera: {preset: 'static'},
      composition: {nodes: [node]},
    };
    const snapshot = await resolveTargetViewportSnapshot({
      scene, nodeId: 'runner', progress: 0.38, video: {width: 100, height: 100},
    });
    assert.equal(snapshot.source, `projects/${slug}/sleep.png`);
  } finally {
    await fs.rm(directory, {recursive: true, force: true});
  }
});

test('world-motion proof isolates an editable shape without a raster source', async () => {
  const scene = {
    camera: {preset: 'static'},
    composition: {
      nodes: [{
        id: 'carried-stone',
        kind: 'shape',
        shape: 'ellipse',
        style: {
          fill: '#74685c',
          stroke: '#3f352d',
          strokeWidth: 2,
          radius: 999,
        },
        z: 3,
        depth: 0,
        transform: {
          x: 0.2,
          y: 0.3,
          width: 0.08,
          height: 0.1,
          anchorX: 0.5,
          anchorY: 0.5,
        },
        motion: {
          keyframes: [
            {at: 0, offsetX: 0, offsetY: 0},
            {at: 1, offsetX: 0.4, offsetY: -0.1},
          ],
        },
      }],
    },
  };
  const snapshot = await resolveTargetViewportSnapshot({
    scene,
    nodeId: 'carried-stone',
    progress: 0.5,
    video: {width: 1000, height: 500},
  });
  assert.equal(snapshot.source, 'shape:ellipse');
  assert.equal(snapshot.sourceKind, 'editable-shape');
  assert.deepEqual(snapshot.alphaBounds, {
    x: 0,
    y: 0,
    width: 1,
    height: 1,
  });
  assert.ok(snapshot.visibleAreaRatio > 0.99);
  assert.ok(snapshot.screenOccupancy > 0);
});

test('world-motion proof keeps a readable occupancy floor for small editable props', async () => {
  const scene = {
    camera: {preset: 'static'},
    composition: {
      nodes: [{
        id: 'carried-stone',
        kind: 'shape',
        shape: 'ellipse',
        style: {
          fill: '#74685c',
          stroke: '#3f352d',
          strokeWidth: 2,
          radius: 999,
        },
        z: 3,
        depth: 0,
        transform: {
          x: 0.2,
          y: 0.3,
          width: 0.018,
          height: 0.024,
          anchorX: 0.5,
          anchorY: 0.5,
        },
        motion: {
          keyframes: [
            {at: 0, offsetX: 0, offsetY: 0},
            {at: 1, offsetX: 0.4, offsetY: -0.1},
          ],
        },
      }],
    },
  };
  const proof = await buildTargetWorldMotionProof({
    scene,
    nodeId: 'carried-stone',
    proofTimes: [
      {id: 'start', at: 0},
      {id: 'end', at: 1},
    ],
    video: {width: 1920, height: 1080},
  });
  assert.equal(proof.thresholds.minimumScreenOccupancy, 0.00025);
  assert.equal(proof.readabilityPassed, true);
  assert.equal(proof.motionResolvable, true);
  assert.equal(proof.passed, true);
});
