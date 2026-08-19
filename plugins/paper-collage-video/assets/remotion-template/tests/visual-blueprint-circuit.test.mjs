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
  assertExecutionRevisedAfterRejection,
  materializeVisualBlueprintProject,
  sceneNeedsMotionClip,
  visualBlueprintReviewRequestFingerprint,
  visualBlueprintFingerprint,
} from '../scripts/visual-blueprint-lib.mjs';
import {
  assertHumanVisualReviewReceipt,
  assertProviderVisualBlueprintGate,
  assertVisualBlueprintApprovalCurrent,
  humanReviewReceiptFingerprint,
} from '../scripts/visual-blueprint-review-lib.mjs';
import {ROOT} from '../scripts/project-lib.mjs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

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
        capability: 'image',
        quality: {kind: 'style-sample'},
      }),
    );
    await assert.doesNotReject(() =>
      assertProviderVisualBlueprintGate({
        projectSlug: slug,
        capability: 'voice',
      }),
    );
    await assert.rejects(
      () =>
        assertProviderVisualBlueprintGate({
          projectSlug: slug,
          capability: 'image',
          quality: {kind: 'character'},
        }),
      /正式素材生产前必须获得当前同源视觉蓝图的人工批准/,
    );
    await assert.rejects(
      () =>
        assertProviderVisualBlueprintGate({
          projectSlug: slug,
          capability: 'voice',
          timingBinding: {
            sceneId: 'scene-01',
            maxDurationSeconds: 3,
          },
        }),
      /正式素材生产前必须获得当前同源视觉蓝图的人工批准/,
    );
    await assert.rejects(
      () =>
        assertProviderVisualBlueprintGate({
          projectSlug: slug,
          capability: 'sound',
          prompt: 'paper tap',
        }),
      /正式素材生产前必须获得当前同源视觉蓝图的人工批准/,
    );
  } finally {
    await fs.rm(projectDirectory, {recursive: true, force: true});
  }
});

test('visual blueprint preserves readable project audio and discloses every fallback', async () => {
  const slug = `blueprint-audio-${process.pid}`;
  const publicDirectory = path.join(ROOT, 'public', 'projects', slug);
  const distDirectory = path.join(ROOT, 'dist', slug);
  try {
    await fs.mkdir(publicDirectory, {recursive: true});
    await fs.writeFile(path.join(publicDirectory, 'narration.wav'), 'voice');
    await fs.writeFile(path.join(publicDirectory, 'music.wav'), 'music');
    const project = visualProject();
    project.slug = slug;
    project.audio = {
      narration: {volume: 1},
      music: {src: `projects/${slug}/music.wav`, volume: 0.2},
      mastering: {targetLufs: -16, toleranceLufs: 1, truePeakDbtp: -1},
    };
    project.scenes[0].narration.src =
      `projects/${slug}/narration.wav`;
    project.scenes[0].events = [
      {
        id: 'missing-sfx',
        beatId: 'action',
        at: 0.5,
        targetId: 'walker',
        visual: null,
        sound: {
          src: `projects/${slug}/missing.wav`,
          volume: 1,
        },
      },
    ];
    const materialized = await materializeVisualBlueprintProject(project);
    assert.equal(
      materialized.project.scenes[0].narration.src,
      project.scenes[0].narration.src,
    );
    assert.equal(materialized.project.audio.music.src, project.audio.music.src);
    assert.equal(materialized.project.scenes[0].events[0].sound, undefined);
    assert.equal(
      materialized.audio.mode,
      'mixed-current-and-silent-fallback',
    );
    assert.deepEqual(materialized.audio.narration.silentFallbackSceneIds, []);
    assert.deepEqual(
      materialized.audio.eventSounds.omitted.map(({eventId}) => eventId),
      ['missing-sfx'],
    );
  } finally {
    await fs.rm(publicDirectory, {recursive: true, force: true});
    await fs.rm(distDirectory, {recursive: true, force: true});
  }
});

test('human visual review receipt is bound to the current request and old note shortcut is blocked', () => {
  const request = {
    schemaVersion: 1,
    projectSlug: 'blueprint-test',
    status: 'awaiting-human',
    createdAt: '2026-08-10T01:00:00.000Z',
  };
  request.requestFingerprint =
    visualBlueprintReviewRequestFingerprint(request);
  const receipt = {
    $schema:
      '../../schemas/visual-blueprint-review-receipt.schema.json',
    schemaVersion: 1,
    projectSlug: request.projectSlug,
    requestFingerprint: request.requestFingerprint,
    decision: 'approved',
    reviewer: {id: 'human:fixture-owner', role: 'human'},
    note: '我已查看全片蓝图和每幕关键帧，同意这个视觉方案。',
    decidedAt: '2026-08-10T01:05:00.000Z',
    evidence: {
      kind: 'host-user-message',
      host: 'codex-desktop',
      threadId: 'fixture-thread',
      messageReference: 'fixture-user-turn',
      userMessageSha256: createHash('sha256')
        .update('explicit user approval')
        .digest('hex'),
    },
  };
  receipt.receiptFingerprint = humanReviewReceiptFingerprint(receipt);
  assert.equal(
    assertHumanVisualReviewReceipt({receipt, request}),
    receipt,
  );
  const reorderedReceipt = Object.fromEntries(
    Object.entries(receipt).reverse(),
  );
  assert.equal(
    humanReviewReceiptFingerprint(reorderedReceipt),
    receipt.receiptFingerprint,
  );
  assert.throws(
    () =>
      assertHumanVisualReviewReceipt({
        receipt,
        request: {
          ...request,
          requestFingerprint: 'f'.repeat(64),
        },
      }),
    /requestFingerprint 未绑定当前人审请求/,
  );

  const blocked = spawnSync(
    process.execPath,
    [
      path.join(ROOT, 'scripts', 'project-advance.mjs'),
      'blueprint-test',
      'approve-style-voice',
      '--note=agent supplied note',
    ],
    {cwd: ROOT, encoding: 'utf8'},
  );
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /不能再由自由文本 --note 直接记录/);
});

test('a stale approval without the current receipt reports the human review boundary', async () => {
  const slug = 'missing-current-review-receipt';
  const projectDirectory = path.join(ROOT, 'projects', slug);
  try {
    await fs.mkdir(projectDirectory, {recursive: true});
    await fs.writeFile(
      path.join(projectDirectory, 'visual-blueprint-approval.json'),
      '{"schemaVersion":1,"status":"approved"}\n',
    );
    await assert.rejects(
      () => assertVisualBlueprintApprovalCurrent(slug),
      /正在等待人工审片回执.*不能继续正式素材生产/,
    );
  } finally {
    await fs.rm(projectDirectory, {recursive: true, force: true});
  }
});

test('Chromium work stops before rendering or failure-circuit accounting in a restricted host', () => {
  const result = spawnSync(
    process.execPath,
    [
      path.join(ROOT, 'scripts', 'project-metrics-run.mjs'),
      '--category=evidence-render',
      '--operation=visual-blueprint',
      '--script=scripts/project-visual-blueprint.mjs',
      '--slug-index=0',
      '--',
      'chromium-preflight-fixture',
    ],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEX_SANDBOX: 'seatbelt',
        PAPER_COLLAGE_EXECUTION_CONTEXT: '',
      },
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /HOST_CHROMIUM_AUTHORIZATION_REQUIRED/);
  assert.doesNotMatch(result.stderr, /首次失败已记录|同类失败第/);
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
    const operation = 'composition-proof';
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
      explicit: 'renderer crashed before writing evidence',
    });
    const first = await recordOperationFailure({
      slug,
      operation,
      inputFingerprint: firstInput,
      failureSignature,
      evidence: 'first renderer crash',
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
      evidence: 'second renderer crash',
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
      note: 'human confirmed the renderer environment was repaired',
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

test('human revise blocks only an unchanged blueprint and never opens a circuit', async () => {
  const slug = 'revise-guard-test';
  const projectDirectory = path.join(ROOT, 'projects', slug);
  const rejectedFingerprint = 'a'.repeat(64);
  const requestFingerprint = 'b'.repeat(64);
  try {
    await fs.mkdir(projectDirectory, {recursive: true});
    await fs.writeFile(
      path.join(projectDirectory, 'visual-blueprint-review-request.json'),
      `${JSON.stringify({
        schemaVersion: 1,
        projectSlug: slug,
        status: 'awaiting-human',
        requestFingerprint,
        visualContractFingerprint: rejectedFingerprint,
      })}\n`,
    );
    await fs.writeFile(
      path.join(projectDirectory, 'visual-blueprint-review-receipt.json'),
      `${JSON.stringify({
        schemaVersion: 1,
        projectSlug: slug,
        requestFingerprint,
        decision: 'revise',
        note: '荷叶的遮挡顺序不对，青蛙要移到前景。',
      })}\n`,
    );
    await assert.rejects(
      () =>
        assertExecutionRevisedAfterRejection({
          slug,
          fingerprint: rejectedFingerprint,
        }),
      /执行树未发生任何变化/,
    );
    await assert.doesNotReject(() =>
      assertExecutionRevisedAfterRejection({
        slug,
        fingerprint: 'c'.repeat(64),
      }),
    );
    await fs.writeFile(
      path.join(projectDirectory, 'visual-blueprint-review-receipt.json'),
      `${JSON.stringify({
        schemaVersion: 1,
        projectSlug: slug,
        requestFingerprint,
        decision: 'approved',
        note: '通过。',
      })}\n`,
    );
    await assert.doesNotReject(() =>
      assertExecutionRevisedAfterRejection({
        slug,
        fingerprint: rejectedFingerprint,
      }),
    );
    const circuits = await readFailureCircuitEvents(slug);
    assert.equal(circuits.exists, false);
  } finally {
    await fs.rm(projectDirectory, {recursive: true, force: true});
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
