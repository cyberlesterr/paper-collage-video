import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assertOperationAllowed,
  computeOperationInputFingerprint,
  deriveFailureSignature,
  readFailureCircuitEvents,
  recordOperationFailure,
  recordOperationSuccess,
  resolveFailureCircuit,
  summarizeFailureCircuits,
} from '../scripts/failure-circuit-lib.mjs';
import {
  assertProviderVisualBlueprintGate,
  sceneNeedsMotionClip,
  visualBlueprintFingerprint,
} from '../scripts/visual-blueprint-lib.mjs';
import {ROOT} from '../scripts/project-lib.mjs';

const visualProject = () => ({
  slug: 'blueprint-test',
  intake: {
    aspectRatio: '16:9',
    visualStylePreset: 'paper',
    parallaxPreference: 'auto',
    styleProfileFingerprint: '1'.repeat(64),
  },
  styleProfile: {
    id: 'paper',
    profileFingerprint: '1'.repeat(64),
  },
  video: {width: 1920, height: 1080, fps: 30},
  theme: {canvas: '#fff8ea', ink: '#33251d'},
  motionContract: {
    fingerprint: '2'.repeat(64),
    approvalFingerprint: '3'.repeat(64),
  },
  editorial: {timebase: {fps: 30, rounding: 'nearest'}},
  spatialContracts: [],
  worlds: [],
  trajectoryContracts: [],
  sceneTransitions: [],
  scenes: [
    {
      id: 'scene-a',
      label: 'Scene A',
      eyebrow: 'A',
      tailSeconds: 0.5,
      appearance: {depth: 'layered'},
      motion: {
        blueprint: 'travel',
        proofTimes: [
          {id: 'start', at: 0.05, kind: 'establish'},
          {id: 'middle', at: 0.5, kind: 'peak'},
          {id: 'end', at: 0.95, kind: 'final'},
        ],
      },
      composition: {
        coordinateSpace: {width: 1920, height: 1080},
        nodes: [
          {
            id: 'walker',
            kind: 'state-sequence',
            assetRole: 'character',
            z: 4,
            registration: {canvas: {width: 512, height: 512}},
            playback: {
              mode: 'loop',
              activeFrom: 0.2,
              activeUntil: 0.8,
              activeStateIds: ['walk-a', 'walk-b'],
            },
            transform: {
              x: 0.15,
              y: 0.42,
              width: 0.3,
              height: 0.5,
            },
            motion: {
              keyframes: [
                {at: 0, offsetX: 0},
                {at: 1, offsetX: 0.5},
              ],
            },
            states: [
              {
                id: 'walk-a',
                src: 'projects/blueprint-test/a.png',
                sha256: 'a'.repeat(64),
                facing: 'right',
              },
              {
                id: 'walk-b',
                src: 'projects/blueprint-test/b.png',
                sha256: 'b'.repeat(64),
                facing: 'right',
              },
            ],
          },
        ],
      },
      camera: {preset: 'follow', intensity: 0.5},
      narration: {
        src: 'projects/blueprint-test/narration.wav',
        startSeconds: 0,
        durationSeconds: 4,
        text: 'Walk.',
      },
      events: [],
    },
  ],
});

test('visual blueprint fingerprint ignores replaceable sources but binds directing decisions', () => {
  const project = visualProject();
  const sourceReplacement = structuredClone(project);
  sourceReplacement.scenes[0].composition.nodes[0].states[0].src =
    'projects/blueprint-test/final-a.png';
  sourceReplacement.scenes[0].composition.nodes[0].states[0].sha256 =
    'f'.repeat(64);
  sourceReplacement.scenes[0].composition.nodes[0].states[0].provider =
    'replacement-provider';
  assert.equal(
    visualBlueprintFingerprint(sourceReplacement),
    visualBlueprintFingerprint(project),
  );

  for (const mutate of [
    (value) => {
      value.scenes[0].composition.nodes[0].z = 1;
    },
    (value) => {
      value.scenes[0].composition.nodes[0].transform.x = 0.25;
    },
    (value) => {
      value.scenes[0].composition.nodes[0].states[0].facing = 'left';
    },
    (value) => {
      value.scenes[0].composition.nodes[0].playback.activeUntil = 0.7;
    },
    (value) => {
      value.scenes[0].camera.intensity = 0.8;
    },
    (value) => {
      value.scenes[0].narration.durationSeconds = 5;
    },
  ]) {
    const changed = structuredClone(project);
    mutate(changed);
    assert.notEqual(
      visualBlueprintFingerprint(changed),
      visualBlueprintFingerprint(project),
    );
  }
  assert.equal(sceneNeedsMotionClip(project.scenes[0]), true);
});

test('only the single style sample may use an image provider before blueprint approval', async () => {
  const slug = `blueprint-provider-gate-${process.pid}`;
  const projectDirectory = path.join(ROOT, 'projects', slug);
  try {
    await fs.mkdir(projectDirectory, {recursive: true});
    await fs.writeFile(
      path.join(projectDirectory, 'production.json'),
      '{}\n',
    );
    await assert.doesNotReject(() =>
      assertProviderVisualBlueprintGate({
        projectSlug: slug,
        quality: {kind: 'style-sample'},
      }),
    );
    await assert.rejects(
      () =>
        assertProviderVisualBlueprintGate({
          projectSlug: slug,
          quality: {kind: 'character'},
        }),
      /正式素材生产前必须获得当前同源视觉蓝图的人工批准/,
    );
  } finally {
    await fs.rm(projectDirectory, {recursive: true, force: true});
  }
});

test('unchanged failures stop immediately and the second matching failure opens a circuit', async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'paper-collage-circuit-'),
  );
  const slug = 'circuit-test';
  try {
    await fs.mkdir(path.join(root, 'projects', slug), {recursive: true});
    await fs.mkdir(path.join(root, 'public', 'projects', slug), {
      recursive: true,
    });
    await fs.mkdir(path.join(root, 'scripts'), {recursive: true});
    await fs.writeFile(
      path.join(root, 'projects', slug, 'project.json'),
      '{"revision":1}\n',
    );
    await fs.writeFile(
      path.join(root, 'runtime-build.json'),
      '{"fingerprint":"fixture"}\n',
    );
    await fs.writeFile(
      path.join(root, 'scripts', 'task.mjs'),
      'process.exitCode = 1;\n',
    );
    const operation = 'visual-blueprint-review';
    const command = {
      slug,
      operation,
      script: 'scripts/task.mjs',
      arguments: [slug],
      root,
    };
    const firstInput = await computeOperationInputFingerprint(command);
    const failureSignature = deriveFailureSignature({
      operation,
      explicit: 'human visual blueprint rejected',
    });
    const first = await recordOperationFailure({
      slug,
      operation,
      inputFingerprint: firstInput,
      failureSignature,
      evidence: 'first human rejection',
      root,
    });
    assert.equal(first.circuit.open, false);
    await assert.rejects(
      () =>
        assertOperationAllowed({
          slug,
          operation,
          inputFingerprint: firstInput,
          root,
        }),
      /禁止原样重跑/,
    );

    await fs.writeFile(
      path.join(root, 'projects', slug, 'project.json'),
      '{"revision":2}\n',
    );
    const secondInput = await computeOperationInputFingerprint(command);
    assert.notEqual(secondInput, firstInput);
    await assert.doesNotReject(() =>
      assertOperationAllowed({
        slug,
        operation,
        inputFingerprint: secondInput,
        root,
      }),
    );
    const second = await recordOperationFailure({
      slug,
      operation,
      inputFingerprint: secondInput,
      failureSignature,
      evidence: 'second human rejection',
      root,
    });
    assert.equal(second.circuit.open, true);
    await assert.rejects(
      () =>
        assertOperationAllowed({
          slug,
          operation,
          inputFingerprint: secondInput,
          root,
        }),
      /流程熔断已打开/,
    );

    await resolveFailureCircuit({
      slug,
      circuitId: second.circuit.circuitId,
      note: 'human changed the directing strategy',
      root,
    });
    await assert.doesNotReject(() =>
      assertOperationAllowed({
        slug,
        operation,
        inputFingerprint: secondInput,
        root,
      }),
    );
  } finally {
    await fs.rm(root, {recursive: true, force: true});
  }
});

test('a changed input that succeeds clears a single command failure', async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'paper-collage-recovery-'),
  );
  const slug = 'recovery-test';
  try {
    await fs.mkdir(path.join(root, 'projects', slug), {recursive: true});
    const operation = 'preview-render';
    const failureSignature = deriveFailureSignature({
      operation,
      explicit: 'render failed',
    });
    await recordOperationFailure({
      slug,
      operation,
      inputFingerprint: '1'.repeat(64),
      failureSignature,
      evidence: 'render failed',
      root,
    });
    await recordOperationSuccess({
      slug,
      operation,
      inputFingerprint: '2'.repeat(64),
      root,
    });
    const loaded = await readFailureCircuitEvents(slug, {root});
    const summary = summarizeFailureCircuits(loaded.events);
    assert.deepEqual(summary.circuits, []);
    assert.deepEqual(summary.open, []);
  } finally {
    await fs.rm(root, {recursive: true, force: true});
  }
});
