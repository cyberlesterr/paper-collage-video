import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {
  collectRuntimeVisibleCompositionSources,
  validateCompositionStructure,
} from '../scripts/composition-lib.mjs';
import {
  collectCompositeQualityTargets,
  prepareQualityReport,
} from '../scripts/quality-lib.mjs';
import {
  createCompositionProofProject,
  createSceneProofFingerprint,
} from '../scripts/render-cache-lib.mjs';
import {
  assertRuntimeBuildManifestCurrent,
  createRuntimeBuildManifest,
  createRuntimeSurfaceFingerprint,
  discoverRuntimeInputClosure,
  RUNTIME_BUILD_INPUTS,
  RUNTIME_EXPLICIT_INPUTS,
  RUNTIME_SURFACE_INPUTS,
} from '../scripts/runtime-build-lib.mjs';
import {collectParallaxDepths} from '../src/parallax.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha256File = async (file) =>
  createHash('sha256').update(await fs.readFile(file)).digest('hex');

test('assets-ready runtime identity rejects a locally drifted executable', async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'paper-collage-runtime-integrity-'),
  );
  try {
    for (const relative of RUNTIME_BUILD_INPUTS) {
      const target = path.join(directory, relative);
      await fs.mkdir(path.dirname(target), {recursive: true});
      await fs.copyFile(path.join(ROOT, relative), target);
    }
    const manifest = await createRuntimeBuildManifest({root: directory});
    await fs.writeFile(
      path.join(directory, 'runtime-build.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    await assert.doesNotReject(
      assertRuntimeBuildManifestCurrent({root: directory}),
    );
    await fs.appendFile(
      path.join(directory, 'scripts', 'quality-lib.mjs'),
      '\n// unauthorized local quality relaxation\n',
    );
    await assert.rejects(
      assertRuntimeBuildManifestCurrent({root: directory}),
      /runtime-build\.json 与当前可执行文件不一致.*quality-lib\.mjs/,
    );
  } finally {
    await fs.rm(directory, {recursive: true, force: true});
  }
});

test('runtime build inputs discover every current style card from the catalog', async () => {
  const catalog = JSON.parse(
    await fs.readFile(
      path.join(ROOT, 'public', 'style-catalog', 'catalog.json'),
      'utf8',
    ),
  );
  assert.deepEqual(
    RUNTIME_BUILD_INPUTS.filter((relative) =>
      relative.startsWith('public/style-catalog/') &&
      relative.endsWith('.png'),
    ),
    catalog.styles.map(({image}) => `public/${image}`).sort(),
  );
});

test('complete runtime identity automatically covers every managed contract and executable', async () => {
  const managedRoots = [
    'schemas',
    'scripts',
    'src',
    'templates',
  ];
  const expected = [];
  const visit = async (relative) => {
    const absolute = path.join(ROOT, relative);
    const stat = await fs.stat(absolute).catch(() => null);
    if (!stat) return;
    if (stat.isFile()) {
      if (relative !== 'scripts/sync-plugin-package.mjs') {
        expected.push(relative.split(path.sep).join('/'));
      }
      return;
    }
    for (const entry of await fs.readdir(absolute, {withFileTypes: true})) {
      await visit(path.join(relative, entry.name));
    }
  };
  for (const root of managedRoots) await visit(root);
  for (const relative of expected) {
    assert.ok(
      RUNTIME_BUILD_INPUTS.includes(relative),
      `${relative} must participate in complete runtime identity`,
    );
  }
  assert.ok(!RUNTIME_BUILD_INPUTS.includes('scripts/sync-plugin-package.mjs'));
  assert.ok(
    !RUNTIME_SURFACE_INPUTS['final-visual'].includes(
      'scripts/project-visual-review.mjs',
    ),
    'review plumbing must not invalidate an unchanged visual blueprint',
  );
});

test('runtime build identity closes over every local static module dependency', async () => {
  const discovered = await discoverRuntimeInputClosure({
    root: ROOT,
    roots: RUNTIME_EXPLICIT_INPUTS,
  });
  assert.deepEqual(discovered, [
    'fixtures/editorial-fixture.mjs',
    'scripts/cli-help-lib.mjs',
    'scripts/contract-utils.mjs',
    'scripts/directing-execution-sync-lib.mjs',
    'scripts/execution-scaffold-lib.mjs',
    'scripts/friction-report-lib.mjs',
    'scripts/production-metrics-lib.mjs',
    'scripts/production-vocabulary.mjs',
    'scripts/python-runtime.mjs',
    'scripts/selection-scaffold-lib.mjs',
    'scripts/semantic-slices-lib.mjs',
    'scripts/sound-effect-lib.mjs',
    'scripts/state-sheet-lib.mjs',
    'scripts/storyboard-scaffold-lib.mjs',
    'scripts/timeline-continuity-lib.mjs',
    'scripts/visual-blueprint-review-lib.mjs',
  ]);
  for (const relative of discovered) {
    assert.ok(
      RUNTIME_BUILD_INPUTS.includes(relative),
      `${relative} must participate in the complete runtime identity`,
    );
  }
});

test('discovered runtime dependencies invalidate only their owning surfaces', async () => {
  const visualDependencies = [
    'scripts/state-sheet-lib.mjs',
    'scripts/timeline-continuity-lib.mjs',
  ];
  const operationalDependencies = [
    'fixtures/editorial-fixture.mjs',
    'scripts/production-metrics-lib.mjs',
    'scripts/python-runtime.mjs',
    'scripts/visual-blueprint-review-lib.mjs',
  ];
  for (const relative of [...visualDependencies, ...operationalDependencies]) {
    assert.ok(RUNTIME_BUILD_INPUTS.includes(relative));
  }
  for (const relative of visualDependencies) {
    assert.ok(RUNTIME_SURFACE_INPUTS['final-visual'].includes(relative));
    assert.ok(RUNTIME_SURFACE_INPUTS['composition-proof'].includes(relative));
  }
  assert.ok(
    RUNTIME_SURFACE_INPUTS['audio-delivery'].includes(
      'scripts/timeline-continuity-lib.mjs',
    ),
  );
  assert.ok(
    !RUNTIME_SURFACE_INPUTS['audio-delivery'].includes(
      'scripts/state-sheet-lib.mjs',
    ),
  );
  for (const relative of operationalDependencies) {
    assert.ok(!RUNTIME_SURFACE_INPUTS['final-visual'].includes(relative));
    assert.ok(!RUNTIME_SURFACE_INPUTS['composition-proof'].includes(relative));
    assert.ok(!RUNTIME_SURFACE_INPUTS['audio-delivery'].includes(relative));
  }

  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'paper-collage-runtime-closure-'),
  );
  const fingerprints = async () => ({
    build: (await createRuntimeBuildManifest({root: directory})).fingerprint,
    finalVisual: await createRuntimeSurfaceFingerprint(
      'final-visual',
      {root: directory},
    ),
    compositionProof: await createRuntimeSurfaceFingerprint(
      'composition-proof',
      {root: directory},
    ),
    audioDelivery: await createRuntimeSurfaceFingerprint(
      'audio-delivery',
      {root: directory},
    ),
  });
  try {
    for (const relative of RUNTIME_BUILD_INPUTS) {
      const target = path.join(directory, relative);
      await fs.mkdir(path.dirname(target), {recursive: true});
      await fs.copyFile(path.join(ROOT, relative), target);
    }
    const baseline = await fingerprints();
    for (const relative of [...visualDependencies, ...operationalDependencies]) {
      const target = path.join(directory, relative);
      const original = await fs.readFile(target);
      await fs.appendFile(target, '\n// runtime closure mutation\n');
      const changed = await fingerprints();
      assert.notEqual(changed.build, baseline.build, relative);
      if (visualDependencies.includes(relative)) {
        assert.notEqual(changed.finalVisual, baseline.finalVisual, relative);
        assert.notEqual(
          changed.compositionProof,
          baseline.compositionProof,
          relative,
        );
      } else {
        assert.equal(changed.finalVisual, baseline.finalVisual, relative);
        assert.equal(
          changed.compositionProof,
          baseline.compositionProof,
          relative,
        );
      }
      if (relative === 'scripts/timeline-continuity-lib.mjs') {
        assert.notEqual(changed.audioDelivery, baseline.audioDelivery, relative);
      } else {
        assert.equal(changed.audioDelivery, baseline.audioDelivery, relative);
      }
      await fs.writeFile(target, original);
    }
  } finally {
    await fs.rm(directory, {recursive: true, force: true});
  }
});

test('composition-proof runtime surface excludes subtitle and audio-delivery changes', async () => {
  assert.ok(
    RUNTIME_BUILD_INPUTS.includes('fixtures/starter-demo/project.json'),
    'the default composition props must participate in the complete runtime identity',
  );
  for (const entrypoint of ['src/index.ts', 'src/Root.tsx']) {
    assert.ok(
      RUNTIME_BUILD_INPUTS.includes(entrypoint),
      `${entrypoint} must participate in the complete runtime identity`,
    );
    assert.ok(
      RUNTIME_SURFACE_INPUTS['final-visual'].includes(entrypoint),
      `${entrypoint} must invalidate final visual frames`,
    );
    assert.ok(
      RUNTIME_SURFACE_INPUTS['composition-proof'].includes(entrypoint),
      `${entrypoint} must invalidate visual composition proof`,
    );
    assert.ok(
      !RUNTIME_SURFACE_INPUTS['audio-delivery'].includes(entrypoint),
      `${entrypoint} must not invalidate audio delivery`,
    );
  }
  assert.ok(
    !RUNTIME_SURFACE_INPUTS['composition-proof'].includes(
      'src/SubtitleOverlay.tsx',
    ),
  );
  assert.ok(
    RUNTIME_SURFACE_INPUTS['composition-proof'].includes(
      'src/ReplicaChapterScene.tsx',
    ),
  );
  for (const audioDeliveryFile of [
    'schemas/audio-calibration.schema.json',
    'scripts/audio-calibration-lib.mjs',
    'scripts/audio-preflight-lib.mjs',
    'scripts/assets-ready-seal-lib.mjs',
    'scripts/project-assets-ready.mjs',
    'scripts/project-audio-calibration.mjs',
    'scripts/project-audio-preflight.mjs',
    'scripts/project-report.mjs',
  ]) {
    assert.ok(
      !RUNTIME_SURFACE_INPUTS['composition-proof'].includes(audioDeliveryFile),
      `${audioDeliveryFile} must not invalidate visual composition proof`,
    );
    assert.ok(
      !RUNTIME_SURFACE_INPUTS['final-visual'].includes(audioDeliveryFile),
      `${audioDeliveryFile} must not invalidate final visual frames`,
    );
  }
  assert.ok(
    RUNTIME_SURFACE_INPUTS['audio-delivery'].includes(
      'scripts/audio-preflight-lib.mjs',
    ),
  );
  assert.ok(
    !RUNTIME_SURFACE_INPUTS['audio-delivery'].includes(
      'src/SubtitleOverlay.tsx',
    ),
  );
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'paper-collage-runtime-surface-'),
  );
  try {
    for (const relative of RUNTIME_BUILD_INPUTS) {
      const target = path.join(directory, relative);
      await fs.mkdir(path.dirname(target), {recursive: true});
      await fs.copyFile(path.join(ROOT, relative), target);
    }
    const beforeBuild = await createRuntimeBuildManifest({root: directory});
    const beforeSurface = await createRuntimeSurfaceFingerprint(
      'composition-proof',
      {root: directory},
    );
    const beforeFinalVisual = await createRuntimeSurfaceFingerprint(
      'final-visual',
      {root: directory},
    );
    await fs.appendFile(
      path.join(directory, 'src/SubtitleOverlay.tsx'),
      '\n// subtitle-only fixture change\n',
      'utf8',
    );
    const afterSubtitleBuild = await createRuntimeBuildManifest({
      root: directory,
    });
    const afterSubtitleSurface = await createRuntimeSurfaceFingerprint(
      'composition-proof',
      {root: directory},
    );
    const afterSubtitleFinalVisual = await createRuntimeSurfaceFingerprint(
      'final-visual',
      {root: directory},
    );
    assert.notEqual(afterSubtitleBuild.fingerprint, beforeBuild.fingerprint);
    assert.equal(afterSubtitleSurface, beforeSurface);
    assert.notEqual(afterSubtitleFinalVisual, beforeFinalVisual);

    for (const audioDeliveryFile of [
      'schemas/audio-calibration.schema.json',
      'scripts/audio-preflight-lib.mjs',
    ]) {
      const beforeAudioDelivery = await createRuntimeSurfaceFingerprint(
        'audio-delivery',
        {root: directory},
      );
      await fs.appendFile(
        path.join(directory, audioDeliveryFile),
        '\n ',
        'utf8',
      );
      const afterAudioBuild = await createRuntimeBuildManifest({
        root: directory,
      });
      const afterAudioSurface = await createRuntimeSurfaceFingerprint(
        'composition-proof',
        {root: directory},
      );
      const afterAudioFinalVisual = await createRuntimeSurfaceFingerprint(
        'final-visual',
        {root: directory},
      );
      const afterAudioDelivery = await createRuntimeSurfaceFingerprint(
        'audio-delivery',
        {root: directory},
      );
      assert.notEqual(afterAudioBuild.fingerprint, beforeBuild.fingerprint);
      assert.equal(afterAudioSurface, beforeSurface);
      assert.equal(afterAudioFinalVisual, afterSubtitleFinalVisual);
      assert.notEqual(afterAudioDelivery, beforeAudioDelivery);
    }

    await fs.appendFile(
      path.join(directory, 'src/ReplicaChapterScene.tsx'),
      '\n// shared composition fixture change\n',
      'utf8',
    );
    const afterCompositionSurface = await createRuntimeSurfaceFingerprint(
      'composition-proof',
      {root: directory},
    );
    const afterCompositionFinalVisual = await createRuntimeSurfaceFingerprint(
      'final-visual',
      {root: directory},
    );
    assert.notEqual(afterCompositionSurface, beforeSurface);
    assert.notEqual(afterCompositionFinalVisual, afterSubtitleFinalVisual);
  } finally {
    await fs.rm(directory, {recursive: true, force: true});
  }
});

test('composition proof input and fingerprints exclude subtitle-only data', async () => {
  const project = {
    video: {width: 1920, height: 1080, fps: 30},
    theme: {texture: null, fontFile: null},
    scenes: [{
      id: 'scene',
      narration: {startSeconds: 0, durationSeconds: 1, text: '原旁白'},
      events: [],
      composition: {coordinateSpace: {width: 1920, height: 1080}, nodes: []},
      subtitles: [{from: 0, to: 30, text: '不会进入构图证明'}],
      appearance: {
        background: '#ffffff',
        subtitles: {variant: 'paper-card', color: '#111111'},
      },
    }],
  };
  const proof = createCompositionProofProject(project);
  assert.deepEqual(proof.scenes[0].subtitles, []);
  assert.deepEqual(proof.scenes[0].appearance.subtitles, {variant: 'hidden'});
  assert.equal(project.scenes[0].subtitles.length, 1);
  assert.equal(project.scenes[0].appearance.subtitles.variant, 'paper-card');
  const changed = structuredClone(project);
  changed.scenes[0].narration.text = '修改后的旁白';
  changed.scenes[0].subtitles[0].text = '修改后的字幕';
  changed.scenes[0].appearance.subtitles.color = '#ff0000';
  const proofInput = {
    proof: {id: 'final', at: 0.9},
    absoluteFrame: 27,
  };
  const beforeComposition = await createSceneProofFingerprint({
    project,
    scene: project.scenes[0],
    ...proofInput,
    surface: 'composition-proof',
  });
  const afterComposition = await createSceneProofFingerprint({
    project: changed,
    scene: changed.scenes[0],
    ...proofInput,
    surface: 'composition-proof',
  });
  const beforeFinal = await createSceneProofFingerprint({
    project,
    scene: project.scenes[0],
    ...proofInput,
  });
  const afterFinal = await createSceneProofFingerprint({
    project: changed,
    scene: changed.scenes[0],
    ...proofInput,
  });
  assert.equal(afterComposition, beforeComposition);
  assert.notEqual(afterFinal, beforeFinal);
});

test('composite quality fingerprints ignore subtitle transcript formatting but retain timing', async () => {
  const project = {
    slug: 'subtitle-quality-fingerprint-fixture',
    video: {width: 1920, height: 1080, fps: 30},
    theme: {texture: null, fontFile: null},
    sceneTransitions: [],
    scenes: [{
      id: 'scene',
      narration: {
        startSeconds: 0,
        durationSeconds: 2,
        text: '第一句 第二句',
      },
      tailSeconds: 0.2,
      camera: {
        parallax: {enabled: true, strength: 0.2, focalDepth: 0},
      },
      motion: {proofTimes: []},
      events: [],
      composition: {
        coordinateSpace: {width: 1920, height: 1080},
        nodes: [],
      },
      subtitles: [{fromSeconds: 0, toSeconds: 2, text: '第一句 第二句'}],
    }],
  };
  const manifest = {assets: []};
  const [before] = await collectCompositeQualityTargets(project, {manifest});
  const formattingChange = structuredClone(project);
  formattingChange.scenes[0].narration.text = '第一句  第二句';
  formattingChange.scenes[0].subtitles = [
    {fromSeconds: 0, toSeconds: 1, text: '第一句'},
    {fromSeconds: 1.1, toSeconds: 2, text: '第二句'},
  ];
  const [afterFormatting] = await collectCompositeQualityTargets(
    formattingChange,
    {manifest},
  );
  assert.equal(afterFormatting.fingerprint, before.fingerprint);

  const timingChange = structuredClone(formattingChange);
  timingChange.scenes[0].narration.durationSeconds = 2.5;
  const [afterTiming] = await collectCompositeQualityTargets(timingChange, {
    manifest,
  });
  assert.notEqual(afterTiming.fingerprint, before.fingerprint);
});

test('whole-film style composition fingerprints exclude subtitle presentation', async () => {
  const project = {
    slug: 'subtitle-style-fingerprint-fixture',
    video: {width: 1920, height: 1080, fps: 30},
    theme: {texture: null, fontFile: null},
    styleProfile: {
      id: 'fixture-style',
      quality: {requiredCompositeChecks: ['style-profile-consistent']},
    },
    sceneTransitions: [],
    scenes: [{
      id: 'scene',
      appearance: {
        background: '#ffffff',
        subtitles: {variant: 'hidden'},
      },
      narration: {startSeconds: 0, durationSeconds: 2, text: '字幕'},
      tailSeconds: 0.2,
      camera: {preset: 'still', intensity: 0},
      motion: {proofTimes: []},
      events: [],
      composition: {
        coordinateSpace: {width: 1920, height: 1080},
        nodes: [],
      },
      subtitles: [{fromSeconds: 0, toSeconds: 2, text: '字幕'}],
    }],
  };
  const manifest = {assets: []};
  const before = (await collectCompositeQualityTargets(project, {manifest}))
    .find(({compositeId}) => compositeId === 'style-profile:fixture-style');
  const subtitleChange = structuredClone(project);
  subtitleChange.scenes[0].appearance.subtitles = {
    variant: 'boxed',
    edgeTreatment: 'crisp-outline',
  };
  const afterSubtitle = (
    await collectCompositeQualityTargets(subtitleChange, {manifest})
  ).find(({compositeId}) => compositeId === 'style-profile:fixture-style');
  assert.equal(afterSubtitle.fingerprint, before.fingerprint);
  assert.equal(afterSubtitle.compositionHash, before.compositionHash);

  const compositionChange = structuredClone(subtitleChange);
  compositionChange.scenes[0].appearance.background = '#eeeeee';
  const afterComposition = (
    await collectCompositeQualityTargets(compositionChange, {manifest})
  ).find(({compositeId}) => compositeId === 'style-profile:fixture-style');
  assert.notEqual(afterComposition.fingerprint, before.fingerprint);
});

test('derivation-only registered family passes deterministic checks without human review items', async () => {
  const slug = `derivation-only-${process.pid}`;
  const projectDirectory = path.join(ROOT, 'projects', slug);
  const publicDirectory = path.join(ROOT, 'public', 'projects', slug);
  const roles = ['support-rear', 'subject', 'support-front'];
  const familyFingerprint = 'f'.repeat(64);
  const recoveryPolicy = {
    strategy: 'preserve-family-context',
    localDeterministicFixFirst: true,
    isolatedMemberGeneration: 'forbidden',
    providerRepair: 'masked-complete-source-edit',
    fallback: 'full-source-regeneration',
  };
  const nodeFor = (role) => ({
    id: role,
    kind: 'asset',
    assetRole: role === 'subject' ? 'character' : 'prop',
    src: `projects/${slug}/${role}.png`,
    z: roles.indexOf(role),
    slot: role,
    registrationId: 'technical-family',
    transform: {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      anchorX: 0,
      anchorY: 0,
    },
    motion: {keyframes: [{at: 0, offsetX: 0}, {at: 1, offsetX: 0}]},
  });
  try {
    await fs.mkdir(projectDirectory, {recursive: true});
    await fs.mkdir(publicDirectory, {recursive: true});
    const records = [];
    for (const [index, role] of roles.entries()) {
      const file = path.join(publicDirectory, `${role}.png`);
      const block = await sharp({
        create: {
          width: 40,
          height: 30,
          channels: 4,
          background: {r: 60 + index * 50, g: 90, b: 130, alpha: 1},
        },
      }).png().toBuffer();
      await sharp({
        create: {
          width: 100,
          height: 100,
          channels: 4,
          background: {r: 0, g: 0, b: 0, alpha: 0},
        },
      }).composite([{input: block, left: 30, top: 55}]).png().toFile(file);
      records.push({
        recordId: String(index + 1).padStart(64, '0'),
        assetId: role,
        capability: 'image',
        adapter: 'registered-family-member',
        file: path.relative(ROOT, file),
        sha256: await sha256File(file),
        media: {width: 100, height: 100, format: 'png', hasAlpha: true},
        lifecycle: {
          status: 'active',
          changedAt: '2026-01-01T00:00:00.000Z',
          reason: 'fixture',
          supersededBy: null,
        },
        familyFingerprint,
        registeredFamilyBinding: {
          schemaVersion: 2,
          familyId: 'technical-family-members',
          pattern: 'supported-subject',
          motionCapability: 'bounded-relative',
          sourcePackageId: 'technical-source-package',
          sourceStrategy: 'registered-layer-sheet',
          revealEnvelope: {
            '16:9': {x: 0.02, y: 0.02, scale: 0.04, rotationDegrees: 1},
            '9:16': {x: 0.02, y: 0.02, scale: 0.04, rotationDegrees: 1},
            '1:1': {x: 0.02, y: 0.02, scale: 0.04, rotationDegrees: 1},
          },
          registrationId: 'technical-family',
          sourceMasterAssetId: 'technical-master',
          canvas: {width: 100, height: 100},
          origin: 'top-left',
          role,
          slot: role,
          completeness: {
            'support-rear': 'clean-plate',
            subject: 'full-silhouette',
            'support-front': 'full-overlay',
          }[role],
          nodeId: role,
          source: {
            kind: 'registered-layer-sheet',
            assetId: 'technical-sheet',
            stateId: null,
            sourceSheetAssetId: null,
            sourceFamilyFingerprint: null,
            sha256: 'a'.repeat(64),
          },
          derivation: {
            placement: {left: 0, top: 0, width: 100, height: 100},
            sourceRect: null,
            sourceSurface: null,
            keying: null,
            keyingMetadataSha256: null,
            maskAssetId: null,
            maskSha256: null,
            maskChannel: null,
            invertMask: false,
            clip: null,
            trimmed: false,
            outputCanvasPreserved: true,
          },
          recoveryPolicy,
          familyFingerprint,
        },
      });
    }
    const project = {
      schemaVersion: 12,
      slug,
      video: {width: 100, height: 100, fps: 30},
      quality: {minimumAssetScale: 1},
      scenes: [{
        id: 'scene',
        durationInFrames: 30,
        narration: {startSeconds: 0, durationSeconds: 1, text: ''},
        tailSeconds: 0,
        motion: {
          proofTimes: [
            {id: 'establish', at: 0.08},
            {id: 'action', at: 0.5},
            {id: 'final', at: 0.9},
          ],
        },
        composition: {
          coordinateSpace: {width: 100, height: 100},
          nodes: [{
            id: 'technical-rig',
            kind: 'group',
            pattern: 'supported-subject',
            renderParticipation: 'derivation-only',
            z: 0,
            coordinateSpace: {width: 100, height: 100},
            transform: {
              x: 0,
              y: 0,
              width: 1,
              height: 1,
              anchorX: 0,
              anchorY: 0,
            },
            motion: {keyframes: [{at: 0, offsetX: 0}, {at: 1, offsetX: 0}]},
            registration: {
              id: 'technical-family',
              sourceMasterAssetId: 'technical-master',
              canvas: {width: 100, height: 100},
              origin: 'top-left',
            },
            support: {
              subjectId: 'subject',
              contactAnchor: {x: 0.5, y: 0.7},
              contactZone: [[0.2, 0.4], [0.8, 0.4], [0.8, 0.9], [0.2, 0.9]],
              occlusionZone: [[0.2, 0.4], [0.8, 0.4], [0.8, 0.9], [0.2, 0.9]],
            },
            children: roles.map(nodeFor),
          }],
        },
        events: [],
      }],
      sceneTransitions: [],
    };
    assert.deepEqual(
      collectRuntimeVisibleCompositionSources(
        project.scenes[0].composition,
      ),
      [],
    );
    assert.deepEqual(
      collectParallaxDepths(project.scenes[0].composition.nodes),
      [],
    );
    const opacityHidden = structuredClone(project.scenes[0].composition);
    delete opacityHidden.nodes[0].renderParticipation;
    opacityHidden.nodes[0].transform.opacity = 0;
    const hiddenIssues = validateCompositionStructure({
      composition: opacityHidden,
      video: project.video,
      proofTimes: project.scenes[0].motion.proofTimes,
      durationSeconds: 1,
      location: 'scene.composition',
    }).issues;
    assert.ok(
      hiddenIssues.some(
        ({code}) => code === 'composition-zero-opacity-source',
      ),
    );
    await fs.writeFile(
      path.join(projectDirectory, 'project.json'),
      `${JSON.stringify(project, null, 2)}\n`,
      'utf8',
    );
    await fs.writeFile(
      path.join(projectDirectory, 'assets-manifest.json'),
      `${JSON.stringify({
        schemaVersion: 4,
        projectSlug: slug,
        assets: records,
      }, null, 2)}\n`,
      'utf8',
    );

    const status = await prepareQualityReport(slug);
    assert.equal(status.ready, true);
    assert.equal(status.pending, 0);
    assert.equal(status.report.assets.length, 3);
    assert.ok(
      status.report.assets.every(
        ({reviewScope, requiredChecks, status: entryStatus}) =>
          reviewScope === 'derivation-only' &&
          requiredChecks.length === 0 &&
          entryStatus === 'passed',
      ),
    );
    assert.equal(status.report.composites.length, 1);
    assert.equal(
      status.report.composites[0].reviewScope,
      'derivation-only',
    );
    assert.deepEqual(status.report.composites[0].requiredChecks, []);
    assert.deepEqual(status.report.composites[0].proofFrames, []);
    assert.ok(
      status.report.composites[0].technical.checks.every(
        ({passed}) => passed,
      ),
    );
  } finally {
    await fs.rm(projectDirectory, {recursive: true, force: true});
    await fs.rm(publicDirectory, {recursive: true, force: true});
    await fs.rm(path.join(ROOT, 'dist', slug), {recursive: true, force: true});
  }
});
