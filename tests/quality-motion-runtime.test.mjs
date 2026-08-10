import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {createRequestFingerprint} from '../scripts/provider-lib.mjs';
import {
  assertQualityReviewScaffoldCurrent,
  assertQualityReady,
  buildRegisteredGeometryProofForTarget,
  buildQualityReviewScaffold,
  collectCompositeQualityTargets,
  compositionProofReportPath,
  createQualityReviewContactSheets,
  createQualityReviewScaffold,
  prepareQualityReport,
  recordQualityReviews,
  requiresTransparentAssetSurface,
} from '../scripts/quality-lib.mjs';
import {deriveTimeline, validateProject} from '../scripts/project-lib.mjs';
import {resolvePythonCommand} from '../scripts/python-runtime.mjs';
import {
  defaultSubtitleMaximumCharacters,
  deriveSubtitleCues,
  ensureVisibleNarrationSubtitles,
  segmentSubtitleText,
} from '../scripts/subtitle-lib.mjs';
import {createSubtitleContract} from '../scripts/subtitle-contract-lib.mjs';
import {
  resolveSubtitleFadeFrames,
  resolveSubtitleLayout,
  resolveSubtitleTypography,
} from '../src/subtitleSurface.mjs';
import {
  compileEditorialFixture,
  withCompiledEditorialFixture,
} from '../fixtures/editorial-fixture.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestFixture = (projectSlug, assets) => ({
  schemaVersion: 4,
  projectSlug,
  assets: assets.map((record, index) => ({
    recordId: String(index + 1).padStart(64, '0'),
    lifecycle: {status: 'active', changedAt: '2026-01-01T00:00:00.000Z', reason: 'fixture', supersededBy: null},
    ...record,
  })),
});

test('python resolution prefers an explicit override, then the workspace venv', () => {
  assert.equal(
    resolvePythonCommand({
      root: '/workspace',
      env: {PYTHON_BIN: '/custom/python'},
      platform: 'darwin',
      exists: () => true,
    }),
    '/custom/python',
  );
  assert.equal(
    resolvePythonCommand({
      root: '/workspace',
      env: {},
      platform: 'darwin',
      exists: (file) => file === '/workspace/.venv/bin/python',
    }),
    '/workspace/.venv/bin/python',
  );
  assert.equal(
    resolvePythonCommand({
      root: '/workspace',
      env: {},
      platform: 'darwin',
      exists: () => false,
    }),
    'python3',
  );
});

test('request fingerprints ignore project-specific destinations but preserve generation inputs', () => {
  const base = {
    capability: 'image',
    prompt: 'layered paper mountain',
    model: 'image-model',
    settings: {height: 1080, width: 1920},
  };
  const first = createRequestFingerprint({
    request: {...base, projectSlug: 'one', assetId: 'bg-one', output: 'public/one.png'},
    providerId: 'host-image',
    model: 'image-model',
  });
  const second = createRequestFingerprint({
    request: {...base, projectSlug: 'two', assetId: 'bg-two', output: 'public/two.png'},
    providerId: 'host-image',
    model: 'image-model',
  });
  const changed = createRequestFingerprint({
    request: {...base, prompt: 'different prompt'},
    providerId: 'host-image',
    model: 'image-model',
  });
  assert.equal(first, second);
  assert.notEqual(first, changed);
  const registered = createRequestFingerprint({
    request: {
      ...base,
      compositionBinding: {
        sceneId: 'scene-01', nodeId: 'water', pattern: 'registered-environment',
        registrationId: 'river-a', sourceMasterAssetId: 'river-master', outputRole: 'lower-band',
        canvas: {width: 1920, height: 1080}, derivation: {method: 'alpha-extraction'},
      },
    },
    providerId: 'host-image',
    model: 'image-model',
  });
  const otherFamily = createRequestFingerprint({
    request: {
      ...base,
      compositionBinding: {
        sceneId: 'scene-01', nodeId: 'water', pattern: 'registered-environment',
        registrationId: 'river-b', sourceMasterAssetId: 'river-master', outputRole: 'lower-band',
        canvas: {width: 1920, height: 1080}, derivation: {method: 'alpha-extraction'},
      },
    },
    providerId: 'host-image',
    model: 'image-model',
  });
  assert.notEqual(registered, otherFamily);
});

test('opaque registered source sheets do not pretend to require runtime alpha', () => {
  assert.equal(
    requiresTransparentAssetSurface({
      kind: 'prop',
      reviewScope: 'source-asset',
      outputSurface: {mode: 'layer-sheet'},
    }),
    false,
  );
  assert.equal(
    requiresTransparentAssetSurface({
      kind: 'character',
      reviewScope: 'source-asset',
      outputSurface: {mode: 'chroma-key'},
    }),
    false,
  );
  assert.equal(
    requiresTransparentAssetSurface({
      kind: 'character',
      reviewScope: 'runtime-visible',
      outputSurface: null,
    }),
    true,
  );
  assert.equal(
    requiresTransparentAssetSurface({
      kind: 'prop',
      reviewScope: 'derivation-only',
      registeredFamilyBinding: {
        derivation: {sourceSurface: {mode: 'chroma-key'}},
      },
    }),
    true,
  );
});

test('quality scaffold binds pending checks to current proof hashes without pre-approving them', async () => {
  const slug = `scaffold-${process.pid}`;
  const publicDirectory = path.join(ROOT, 'public', 'projects', slug);
  const distDirectory = path.join(ROOT, 'dist', slug);
  const evidenceDirectory = path.join(distDirectory, 'evidence');
  const relative = (file) => path.relative(ROOT, file);
  const files = {
    subject: path.join(publicDirectory, 'subject.png'),
    reference: path.join(publicDirectory, 'reference.png'),
    alpha: path.join(evidenceDirectory, 'alpha.png'),
    checker: path.join(evidenceDirectory, 'checker.png'),
    tight: path.join(evidenceDirectory, 'tight.png'),
    stress: path.join(evidenceDirectory, 'stress.jpg'),
    frame: path.join(distDirectory, 'frame.png'),
    crop: path.join(distDirectory, 'crop.png'),
    debug: path.join(distDirectory, 'debug.png'),
    layerProof: path.join(distDirectory, 'layer-proof.png'),
  };
  await fs.mkdir(publicDirectory, {recursive: true});
  await fs.mkdir(evidenceDirectory, {recursive: true});
  for (const file of Object.values(files)) {
    await sharp({
      create: {width: 8, height: 8, channels: 4, background: '#884422'},
    })
      .toFormat(path.extname(file) === '.jpg' ? 'jpeg' : 'png')
      .toFile(file);
  }
  try {
  const status = {
    report: {
      styleProfile: {
        referenceFile: relative(files.reference),
      },
      assets: [{
        assetId: 'subject',
        file: relative(files.subject),
        sources: ['scene:scene-01:node:subject-node'],
        requiredChecks: ['subject-complete', 'silhouette-fidelity', 'style-profile-conformant'],
        semanticChecks: {'subject-complete': 'passed', 'silhouette-fidelity': 'pending', 'style-profile-conformant': 'pending'},
        status: 'pending',
      }],
      composites: [{
        compositeId: 'group:scene-01:rig',
        fingerprint: 'a'.repeat(64),
        memberNodeIds: ['subject-node'],
        requiredChecks: ['support-contact', 'style-profile-consistent'],
        semanticChecks: {'support-contact': 'pending', 'style-profile-consistent': 'pending'},
        status: 'pending',
      }],
    },
  };
  const compositionProof = {
    assetEvidence: [{
      nodeId: 'subject-node',
      source: `projects/${slug}/subject.png`,
      alphaMask: relative(files.alpha),
      checkerboard: relative(files.checker),
      tightCrop: relative(files.tight),
      motionStress: relative(files.stress),
    }],
    composites: [{
      compositeId: 'group:scene-01:rig',
      fingerprint: 'a'.repeat(64),
      proofFrames: [{
        fullFrame: relative(files.frame),
        crop: relative(files.crop),
        debugFrame: relative(files.debug),
      }],
      layerStackProof: {
        artifacts: {
          neutralReconstruction: relative(files.layerProof),
        },
      },
    }],
  };
  await assert.rejects(
    () => createQualityReviewScaffold({
      status: structuredClone(status),
      projectSlug: slug,
      reviewer: 'host-vision',
      compositionProof: {
        ...compositionProof,
        composites: compositionProof.composites.map((composite) => ({
          ...composite,
          fingerprint: 'b'.repeat(64),
        })),
      },
    }),
    /缺少与当前组合指纹一致的视觉证明/,
  );
  const scaffold = await createQualityReviewScaffold({
    status,
    projectSlug: slug,
    reviewer: 'host-vision',
    compositionProof,
  });
  assert.equal(scaffold.reviews.length, 2);
  assert.equal(scaffold.schemaVersion, 4);
  assert.match(scaffold.sourceReport.fingerprint, /^[a-f0-9]{64}$/);
  assert.ok(
    scaffold.reviews.every(({targetFingerprint}) =>
      /^[a-f0-9]{64}$/.test(targetFingerprint),
    ),
  );
  assert.deepEqual(scaffold.reviews[0].pendingChecks, [
    'silhouette-fidelity',
    'style-profile-conformant',
  ]);
  assert.deepEqual(scaffold.reviews[0].passedChecks, []);
  assert.ok(scaffold.reviews[0].evidenceFiles.some(({file}) => file === relative(files.alpha)));
  assert.ok(
    scaffold.reviews[0].evidenceFiles.some(({file}) => file === relative(files.reference)),
  );
  assert.ok(scaffold.reviews[1].evidenceFiles.some(({file}) => file === relative(files.debug)));
  assert.ok(
    scaffold.reviews[1].evidenceFiles.some(
      ({file}) => file === relative(files.layerProof),
    ),
  );
  assert.ok(
    scaffold.reviews[1].evidenceFiles.some(({file}) => file === relative(files.reference)),
  );
  assert.ok(
    scaffold.reviews.every(({evidenceFiles}) =>
      evidenceFiles.every(({sha256}) => /^[a-f0-9]{64}$/.test(sha256)),
    ),
  );

  const styleScopedStatus = structuredClone(status);
  styleScopedStatus.report.composites.push({
    compositeId: 'group:scene-02:future-rig',
    fingerprint: 'c'.repeat(64),
    memberNodeIds: [],
    requiredChecks: ['final-composition-readable'],
    semanticChecks: {'final-composition-readable': 'pending'},
    status: 'needs-revision',
  });
  const styleScoped = await createQualityReviewScaffold({
    status: styleScopedStatus,
    projectSlug: slug,
    reviewer: 'host-vision',
    compositionProof: {
      composites: [{
        compositeId: 'group:scene-02:future-rig',
        fingerprint: 'c'.repeat(64),
        proofFrames: [],
      }],
    },
    styleProof: compositionProof,
    reviewScope: 'style',
  });
  assert.equal(styleScoped.reviewScope, 'style');
  assert.ok(
    styleScoped.reviews.some(
      ({compositeId}) => compositeId === 'group:scene-01:rig',
    ),
  );
  assert.ok(
    !styleScoped.reviews.some(
      ({compositeId}) => compositeId === 'group:scene-02:future-rig',
    ),
  );
  } finally {
    await fs.rm(publicDirectory, {recursive: true, force: true});
    await fs.rm(distDirectory, {recursive: true, force: true});
  }
});

test('executable style profiles create one fingerprinted whole-film quality target', async () => {
  const project = withCompiledEditorialFixture({
    slug: 'style-profile-target',
    styleProfile: {
      id: 'hand-drawn-cutout-explainer',
      profileFingerprint: 'a'.repeat(64),
      quality: {
        requiredCompositeChecks: ['style-profile-consistent'],
      },
    },
    theme: {
      canvas: '#000000',
      sceneBackground: '#111111',
      accent: '#ffffff',
      ink: '#ffffff',
      subtitle: '#ffffff',
      subtitleBackground: '#000000',
      foreground: '#111111',
      surface: {
        texture: {src: 'textures/paper-grain.png', opacity: 0.14, blendMode: 'multiply'},
        subjectEdge: {mode: 'paper-outline', color: '#ffffff', widthPx: 3},
        subjectShadow: {
          mode: 'drop-shadow',
          offsetXPx: 0,
          offsetYPx: 10,
          blurPx: 7,
          color: 'rgba(20,15,12,.28)',
        },
      },
    },
    video: {width: 100, height: 100, fps: 30},
    audio: {narration: {volume: 1}},
    scenes: [{
      id: 'scene',
      label: 'Scene',
      eyebrow: '',
      tailSeconds: 0,
      motion: {
        blueprint: 'layered-reveal',
        intensity: 1,
        seed: 1,
        proofTimes: [{
          id: 'final',
          at: 0.9,
          label: 'Final',
          kind: 'final',
          assertions: ['Style is readable'],
          stateAssertions: [],
        }],
      },
      camera: {preset: 'static', intensity: 0},
      narration: {src: 'missing.wav', startSeconds: 0, durationSeconds: 1, text: 'x'},
      subtitles: [],
      events: [],
      composition: {
        coordinateSpace: {width: 100, height: 100},
        nodes: [],
      },
    }],
    sceneTransitions: [],
  });
  const targets = await collectCompositeQualityTargets(project);
  const target = targets.find(
    ({compositeId}) =>
      compositeId === 'style-profile:hand-drawn-cutout-explainer',
  );
  assert.deepEqual(target.requiredChecks, ['style-profile-consistent']);
  assert.match(target.fingerprint, /^[a-f0-9]{64}$/);
});

test('v9 scene transitions use one seconds-based intent-routed opaque-boundary protocol', () => {
  const timeline = deriveTimeline({
    video: {fps: 30},
    scenes: [
      {
        id: 'one',
        narration: {durationSeconds: 2, startSeconds: 0.4},
        tailSeconds: 0.4,
      },
      {
        id: 'two',
        narration: {durationSeconds: 2, startSeconds: 0.4},
        tailSeconds: 0.4,
      },
      {
        id: 'three',
        narration: {durationSeconds: 2, startSeconds: 0.4},
        tailSeconds: 0,
      },
    ],
    sceneTransitions: [
      {id: 'one-two', fromSceneId: 'one', toSceneId: 'two', intent: 'location-change', rationale: 'Move the paper stage into a new location.', treatment: {type: 'wipe', edgeStyle: 'paper', motivation: 'authored', direction: 'left-to-right', durationSeconds: 0.4}},
      {id: 'two-three', fromSceneId: 'two', toSceneId: 'three', intent: 'chapter-reset', rationale: 'Close the chapter behind opaque paper.', treatment: {type: 'dip', edgeStyle: 'paper', motivation: 'authored', durationSeconds: 0.4}},
    ],
  });
  assert.equal(timeline.scenes[0].from, 0);
  assert.equal(timeline.scenes[1].from, 72);
  assert.equal(timeline.scenes[2].from, 144);
  assert.equal(timeline.durationInFrames, 216);
});

test('pre-v12 projects are rejected instead of migrated', async () => {
  const report = await validateProject({
    schemaVersion: 1,
    slug: 'old-project',
    title: 'Old project',
    video: {width: 1920, height: 1080, fps: 30, transitionFrames: 12},
    theme: {},
    audio: {music: null},
    scenes: [],
  });
  assert.equal(report.passed, false);
  assert.ok(
    report.issues.some(
      ({code, message}) =>
          code === 'schema-version' && message.includes('必须为 12'),
    ),
  );
});

test('v12 projects require an explicit bounded narration gain', async () => {
  const base = {
    schemaVersion: 12,
    slug: 'narration-gain-test',
    title: 'Narration gain test',
    quality: {minimumAssetScale: 1},
    video: {width: 1920, height: 1080, fps: 30},
    theme: {},
    voice: {mode: 'fictional'},
    audio: {
      music: null,
      mastering: {targetLufs: -16, toleranceLufs: 3, truePeakDbtp: -1},
    },
    scenes: [],
    sceneTransitions: [],
    editorial: compileEditorialFixture(),
  };
  const missing = await validateProject(base);
  assert.ok(
    missing.issues.some(({code}) => code === 'audio-narration-volume'),
  );
  const excessive = await validateProject({
    ...base,
    audio: {...base.audio, narration: {volume: 4.01}},
  });
  assert.ok(
    excessive.issues.some(({code}) => code === 'audio-narration-volume'),
  );
  const valid = await validateProject({
    ...base,
    audio: {...base.audio, narration: {volume: 1.42}},
  });
  assert.equal(
    valid.issues.some(({code}) => code === 'audio-narration-volume'),
    false,
  );
  const legacyRoleSounds = await validateProject({
    ...base,
    audio: {...base.audio, narration: {volume: 1}, sfx: {}},
  });
  assert.ok(
    legacyRoleSounds.issues.some(({code}) => code === 'unsupported-audio-sfx'),
  );
  const transparentCanvas = await validateProject({
    ...base,
    theme: {canvas: 'rgba(110, 30, 25, 0.5)'},
    audio: {...base.audio, narration: {volume: 1}},
  });
  assert.ok(
    transparentCanvas.issues.some(({code}) => code === 'theme-opaque-canvas'),
  );
});

test('subtitle fallback splits long narration and fills the measured narration window', () => {
  const segments = segmentSubtitleText(
    '第一句话很短。第二句话比较长，需要按照逗号拆开，确保竖屏也能阅读。',
    12,
  );
  assert.ok(segments.length >= 3);
  assert.ok(segments.every((segment) => [...segment].length <= 12));
  const cues = deriveSubtitleCues({
    text: segments.join(''),
    startSeconds: 0.3,
    durationSeconds: 6,
    fps: 30,
    maximumCharacters: 12,
  });
  assert.equal(cues[0].fromSeconds, 0.3);
  assert.equal(cues.at(-1).toSeconds, 6.3);
  assert.ok(cues.every(({fromSeconds, toSeconds}) => toSeconds > fromSeconds));

  const compressed = deriveSubtitleCues({
    text: '甲。乙。丙。丁。',
    startSeconds: 0,
    durationSeconds: 2 / 30,
    fps: 30,
    maximumCharacters: 1,
    gapSeconds: 2 / 30,
  });
  assert.equal(compressed.length, 2);
  assert.deepEqual(
    compressed.map(({fromSeconds, toSeconds}) => [fromSeconds, toSeconds]),
    [[0, 1 / 30], [1 / 30, 2 / 30]],
  );
});

test('subtitle segmentation keeps Chinese closing punctuation with its sentence', () => {
  const text = '兔子说：“继续吧。”乌龟点头。';
  const segments = segmentSubtitleText(text, 20);
  assert.deepEqual(segments, ['兔子说：“继续吧。”', '乌龟点头。']);
  assert.equal(segments.join(''), text);
  assert.ok(segments.every((segment) => !/^[”’」』）》】〕〉》]/u.test(segment)));
});

test('subtitle segmentation preserves phrase spaces and balances punctuation-free text', () => {
  const text =
    '古时候有个农夫 每天早早下田 挥着锄头 一心一意地照料庄稼';
  const segments = segmentSubtitleText(text, 16);
  assert.deepEqual(segments, [
    '古时候有个农夫 每天早早下田',
    '挥着锄头 一心一意地照料庄稼',
  ]);
  assert.equal(
    segments.join(' ').replace(/\s+/gu, ' '),
    text.replace(/\s+/gu, ' '),
  );
  assert.ok(
    segments.every(
      (segment) => [...segment.replace(/\s/gu, '')].length <= 16,
    ),
  );

  const balanced = segmentSubtitleText('甲'.repeat(30), 28);
  assert.deepEqual(
    balanced.map((segment) => [...segment].length),
    [15, 15],
  );
  assert.equal(
    defaultSubtitleMaximumCharacters({width: 1920, height: 1080}),
    18,
  );
  assert.equal(
    defaultSubtitleMaximumCharacters({width: 1080, height: 1920}),
    16,
  );
});

test('subtitle fades stay monotonic for short cues and layout honors portrait safe area', () => {
  const fades = Array.from({length: 12}, (_, index) =>
    resolveSubtitleFadeFrames({from: 0, to: index + 1}),
  );
  assert.deepEqual(fades, [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  for (let duration = 1; duration <= 12; duration += 1) {
    const fade = resolveSubtitleFadeFrames({from: 0, to: duration});
    assert.ok(fade * 2 < duration);
  }
  const layout = resolveSubtitleLayout({
    safeArea: {x: 0.08, y: 0.05, width: 0.84, height: 0.9},
    width: 1080,
    height: 1920,
  });
  assert.equal(layout.contract, 'responsive-safe-area-v1');
  assert.ok(layout.bottomPixels > 96);
  assert.ok(layout.leftPercent >= 8);
  assert.ok(layout.rightPercent >= 8);
});

test('subtitle typography can use a screen font and crisp non-blurred edge independently of the theme', () => {
  const typography = resolveSubtitleTypography({
    appearance: {
      variant: 'boxed',
      fontFamily: '"PingFang SC", sans-serif',
      fontWeight: 600,
      edgeTreatment: 'crisp-outline',
    },
    theme: {fontFamily: 'STKaiti, serif'},
    scale: 0.5,
  });
  assert.equal(typography.contract, 'subtitle-typography-v1');
  assert.equal(typography.fontFamily, '"PingFang SC", sans-serif');
  assert.equal(typography.fontWeight, 600);
  assert.equal(typography.edgeTreatment, 'crisp-outline');
  assert.doesNotMatch(typography.textShadow, /14px/u);
  assert.doesNotMatch(typography.textShadow, /blur/u);
});

test('subtitle derivation restores visible crisp subtitles for narrated scenes', () => {
  const scene = {
    narration: {
      src: 'projects/example/narration.mp3',
      durationSeconds: 2,
    },
    subtitles: [{fromSeconds: 0, toSeconds: 2, text: '清晰字幕'}],
    appearance: {subtitles: {variant: 'hidden'}},
  };
  assert.equal(ensureVisibleNarrationSubtitles(scene), true);
  assert.deepEqual(scene.appearance.subtitles, {
    variant: 'boxed',
    edgeTreatment: 'crisp-outline',
  });
  assert.equal(ensureVisibleNarrationSubtitles(scene), false);
});

test('subtitle delivery contract checks transcript, timing, safe area, and font source', async () => {
  const project = {
    video: {width: 1080, height: 1920, fps: 30},
    theme: {fontFamily: 'STKaiti'},
    editorial: {
      activeProfile: '9:16',
      responsiveProfiles: [
        {
          id: '9:16',
          safeArea: {x: 0.08, y: 0.05, width: 0.84, height: 0.9},
        },
      ],
    },
    scenes: [
      {
        id: 'race',
        narration: {
          src: 'projects/test/audio/race.wav',
          startSeconds: 0.2,
          durationSeconds: 2,
          text: '乌龟继续向前。',
        },
        subtitles: [
          {fromSeconds: 0.2, toSeconds: 2.2, text: '乌龟继续向前。'},
        ],
      },
    ],
  };
  const contract = await createSubtitleContract(project);
  assert.equal(contract.passed, true);
  assert.equal(contract.summary.requiredScenes, 1);
  assert.ok(contract.checks.every(({passed}) => passed));
  assert.deepEqual(
    contract.checks.find(({id}) => id === 'subtitle-segmentation-surface')
      .actual,
    [
      {
        sceneId: 'race',
        maximumCharactersPerCue: 16,
        longestCueCharacters: 7,
        cueCount: 1,
        phraseSpacingPresent: false,
      },
    ],
  );

  const broken = await createSubtitleContract({
    ...project,
    scenes: [
      {
        ...project.scenes[0],
        subtitles: [{fromSeconds: 0.2, toSeconds: 0.4, text: '兔子停下。'}],
      },
    ],
  });
  assert.equal(broken.passed, false);
  assert.equal(
    broken.checks.find(({id}) => id === 'subtitle-transcript-match').passed,
    false,
  );
  assert.equal(
    broken.checks.find(({id}) => id === 'subtitle-narration-coverage').passed,
    false,
  );

  const missingTranscript = await createSubtitleContract({
    ...project,
    scenes: [
      {
        ...project.scenes[0],
        narration: {...project.scenes[0].narration, text: ''},
      },
    ],
  });
  assert.equal(missingTranscript.passed, false);
  assert.equal(
    missingTranscript.checks.find(({id}) => id === 'subtitle-narration-text').passed,
    false,
  );
});

test('required asset quality resets on hashes and batch reviews write atomically', async () => {
  const slug = `quality-gate-${process.pid}`;
  const projectDirectory = path.join(ROOT, 'projects', slug);
  const publicDirectory = path.join(ROOT, 'public', 'projects', slug);
  const backgroundFile = path.join(publicDirectory, 'assets', 'plates', 'bg.png');
  const characterFile = path.join(
    publicDirectory,
    'assets',
    'characters',
    'alpha',
    'hero.png',
  );
  try {
    await fs.mkdir(path.dirname(backgroundFile), {recursive: true});
    await fs.mkdir(path.dirname(characterFile), {recursive: true});
    await fs.mkdir(projectDirectory, {recursive: true});
    await sharp({
      create: {width: 640, height: 360, channels: 3, background: '#d9c9a4'},
    })
      .png()
      .toFile(backgroundFile);
    const subject = await sharp({
      create: {width: 40, height: 80, channels: 4, background: '#355070'},
    })
      .png()
      .toBuffer();
    await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 4,
        background: {r: 0, g: 0, b: 0, alpha: 0},
      },
    })
      .composite([{input: subject, left: 30, top: 10}])
      .png()
      .toFile(characterFile);
    await fs.writeFile(
      path.join(projectDirectory, 'project.json'),
      `${JSON.stringify(
        withCompiledEditorialFixture({
          slug,
          title: 'Quality Gate',
          quality: {minimumAssetScale: 1},
          video: {width: 640, height: 360, fps: 30},
          theme: {},
          audio: {music: null},
          scenes: [
            {
              id: 'scene',
              composition: {
                coordinateSpace: {width: 640, height: 360},
                nodes: [
                  {
                    id: 'background',
                    kind: 'asset',
                    assetRole: 'background',
                    src: `projects/${slug}/assets/plates/bg.png`,
                    z: 0,
                    transform: {x: 0, y: 0, width: 1, height: 1, anchorX: 0, anchorY: 0},
                    motion: {keyframes: [{at: 0, scale: 1}, {at: 1, scale: 1}]},
                  },
                  {
                    id: 'hero',
                    kind: 'asset',
                    assetRole: 'character',
                    src: `projects/${slug}/assets/characters/alpha/hero.png`,
                    z: 1,
                    transform: {x: 0.5, y: 1, width: 0.2, anchorX: 0.5, anchorY: 1},
                    motion: {keyframes: [{at: 0, offsetY: 0}, {at: 1, offsetY: 0}]},
                  },
                ],
              },
            },
          ],
          sceneTransitions: [],
        }),
        null,
        2,
      )}\n`,
      'utf8',
    );
    await fs.writeFile(
      path.join(projectDirectory, 'assets-manifest.json'),
      `${JSON.stringify(manifestFixture(slug, [
          {
            assetId: 'hero-alpha',
            capability: 'image',
            file: path.relative(ROOT, characterFile),
            request: {
              quality: {requiredChecks: ['edge-clean']},
            },
          },
          {
            assetId: 'rejected-style',
            capability: 'image',
            file: path.relative(ROOT, characterFile),
            lifecycle: {status: 'rejected', changedAt: '2026-01-02T00:00:00.000Z', reason: 'human-rejected', supersededBy: null},
          },
        ]))}\n`,
      'utf8',
    );

    let status = await prepareQualityReport(slug);
    assert.equal(status.ready, false);
    assert.equal(status.pending, 2);
    assert.equal(status.report.assetHistory.length, 1);
    assert.equal(status.report.assetHistory[0].lifecycle.status, 'rejected');
    assert.deepEqual(
      status.report.assets.find(({kind}) => kind === 'character').requiredChecks,
      ['edge-clean'],
    );
    await assert.rejects(() => assertQualityReady(slug), /资产与组合质量门未通过/);

    const reportFile = path.join(projectDirectory, 'quality-report.json');
    const beforeInvalidBatch = await fs.readFile(reportFile, 'utf8');
    await assert.rejects(
      () =>
        recordQualityReviews({
          slug,
          reviews: [
            {
              assetId: status.report.assets[0].assetId,
              reviewer: 'codex:vision',
              passedChecks: [status.report.assets[0].requiredChecks[0]],
              note: 'AI must not decide visual quality',
            },
          ],
        }),
      /必须来自 human:<id>/,
    );
    await assert.rejects(
      () =>
        recordQualityReviews({
          slug,
          reviews: [
            {
              assetId: status.report.assets[0].assetId,
              reviewer: 'human:test-vision',
              passedChecks: status.report.assets[0].requiredChecks,
              note: 'Fixture reviewed',
            },
            {
              assetId: 'missing-asset',
              reviewer: 'human:test-vision',
              passedChecks: [],
              note: 'Fixture reviewed',
            },
          ],
        }),
      /未知质量对象：missing-asset/,
    );
    assert.equal(await fs.readFile(reportFile, 'utf8'), beforeInvalidBatch);

    const built = await buildQualityReviewScaffold({
      slug,
      reviewer: 'human:test-vision',
    });
    assert.ok(built.scaffold.reviews.every(({evidenceFiles}) => evidenceFiles.length > 0));
    assert.equal(built.scaffold.schemaVersion, 4);
    assert.equal(
      built.scaffold.sourceReport.fingerprint,
      built.status.report.reviewSurfaceFingerprint,
    );
    await assert.doesNotReject(() =>
      assertQualityReviewScaffoldCurrent({slug, scaffold: built.scaffold}),
    );
    const contactSheets = await createQualityReviewContactSheets({
      slug,
      scaffold: built.scaffold,
    });
    assert.equal(
      contactSheets.index.sourceReport.fingerprint,
      built.scaffold.sourceReport.fingerprint,
    );
    assert.ok(contactSheets.index.pages.length > 0);
    assert.ok(
      contactSheets.index.pages.every(({sha256}) =>
        /^[a-f0-9]{64}$/.test(sha256),
      ),
    );
    status = await recordQualityReviews({
      slug,
      sourceReportFingerprint: built.scaffold.sourceReport.fingerprint,
      reviews: built.scaffold.reviews.map(({evidenceFiles, pendingChecks, ...review}) => ({
        ...review,
        passedChecks: pendingChecks,
        failedChecks: [],
        note: 'Fixture reviewed',
      })),
    });
    assert.equal(status.ready, true);
    assert.equal(status.passed, 2);
    assert.deepEqual(status.changedAssets.sort(), status.report.assets.map(({assetId}) => assetId).sort());
    await assert.doesNotReject(() => assertQualityReady(slug));

    const changedBackground = await sharp(backgroundFile)
      .modulate({brightness: 0.99})
      .png()
      .toBuffer();
    await fs.writeFile(backgroundFile, changedBackground);
    status = await prepareQualityReport(slug);
    assert.equal(status.ready, false);
    await assert.rejects(
      () =>
        recordQualityReviews({
          slug,
          sourceReportFingerprint: built.scaffold.sourceReport.fingerprint,
          reviews: built.scaffold.reviews,
        }),
      /scaffold 已过期/,
    );
    await assert.rejects(
      () =>
        createQualityReviewContactSheets({
          slug,
          scaffold: built.scaffold,
        }),
      /scaffold 已过期/,
    );
    assert.equal(
      status.report.assets.find(({kind}) => kind === 'background').status,
      'pending',
    );
  } finally {
    await fs.rm(projectDirectory, {recursive: true, force: true});
    await fs.rm(publicDirectory, {recursive: true, force: true});
    await fs.rm(path.join(ROOT, 'dist', slug), {recursive: true, force: true});
  }
});

test('asset approval cannot bypass a pending or stale supported-subject composite', async () => {
  const slug = `composite-gate-${process.pid}`;
  const projectDirectory = path.join(ROOT, 'projects', slug);
  const publicDirectory = path.join(ROOT, 'public', 'projects', slug);
  const distDirectory = path.join(ROOT, 'dist', slug);
  const sources = Object.fromEntries(['boat-rear', 'traveler', 'boat-front'].map((id) => [id, path.join(publicDirectory, `${id}.png`)]));
  const relativeSource = (id) => path.relative(ROOT, sources[id]);
  const binding = (nodeId, outputRole) => ({
    sceneId: 'scene',
    nodeId,
    pattern: 'supported-subject',
    registrationId: 'boat-family',
    sourceMasterAssetId: 'boat-master',
    outputRole,
    canvas: {width: 100, height: 100},
    derivation: {method: 'alpha-extraction', parentAssetId: 'boat-master'},
  });
  const registeredFamilyBinding = (nodeId, role) => ({
    schemaVersion: 2,
    familyId: 'boat-family-members',
    pattern: 'supported-subject',
    motionCapability: 'bounded-relative',
    sourcePackageId: 'boat-layer-package',
    sourceStrategy: 'registered-layer-sheet',
    revealEnvelope: {
      '16:9': {x: 0.02, y: 0.02, scale: 0.04, rotationDegrees: 1},
      '9:16': {x: 0.015, y: 0.02, scale: 0.04, rotationDegrees: 1},
      '1:1': {x: 0.018, y: 0.018, scale: 0.04, rotationDegrees: 1},
    },
    registrationId: 'boat-family',
    sourceMasterAssetId: 'boat-master',
    canvas: {width: 100, height: 100},
    origin: 'top-left',
    role,
    slot: role,
    completeness: {
      'support-rear': 'clean-plate',
      subject: 'full-silhouette',
      'support-front': 'full-overlay',
    }[role],
    nodeId,
    source: {
      kind: 'registered-layer-sheet',
      assetId: 'boat-layer-sheet',
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
    recoveryPolicy: {
      strategy: 'preserve-family-context',
      localDeterministicFixFirst: true,
      isolatedMemberGeneration: 'forbidden',
      providerRepair: 'masked-complete-source-edit',
      fallback: 'full-source-regeneration',
    },
    familyFingerprint: 'f'.repeat(64),
  });
  const node = (id, slot, role = 'prop') => ({
    id,
    kind: 'asset',
    assetRole: role,
    src: path.relative(path.join(ROOT, 'public'), sources[id]),
    z: 0,
    slot,
    registrationId: 'boat-family',
    transform: {x: 0, y: 0, width: 1, height: 1, anchorX: 0, anchorY: 0},
    motion: {keyframes: [{at: 0, offsetX: 0}, {at: 1, offsetX: 0}]},
  });
  try {
    await fs.mkdir(publicDirectory, {recursive: true});
    await fs.mkdir(projectDirectory, {recursive: true});
    for (const [index, file] of Object.values(sources).entries()) {
      const block = await sharp({create: {width: 62, height: 34, channels: 4, background: {r: 80 + index * 40, g: 90, b: 120, alpha: 1}}}).png().toBuffer();
      await sharp({create: {width: 100, height: 100, channels: 4, background: {r: 0, g: 0, b: 0, alpha: 0}}})
        .composite([{input: block, left: 19, top: 56}])
        .png()
        .toFile(file);
    }
    const project = withCompiledEditorialFixture({
      slug,
      quality: {minimumAssetScale: 1},
      video: {width: 100, height: 100, fps: 30},
      scenes: [{
        id: 'scene',
        motion: {proofTimes: [{id: 'establish', at: 0.08}, {id: 'action', at: 0.5}, {id: 'final', at: 0.9}]},
        composition: {
          coordinateSpace: {width: 100, height: 100},
          nodes: [{
            id: 'boat-rig', kind: 'group', pattern: 'supported-subject', z: 0,
            coordinateSpace: {width: 100, height: 100},
            transform: {x: 0, y: 0, width: 1, height: 1, anchorX: 0, anchorY: 0},
            motion: {keyframes: [{at: 0, offsetX: 0}, {at: 1, offsetX: 0}]},
            registration: {id: 'boat-family', sourceMasterAssetId: 'boat-master', canvas: {width: 100, height: 100}, origin: 'top-left'},
            support: {
              subjectId: 'traveler', contactAnchor: {x: 0.5, y: 0.7},
              contactZone: [[0.25, 0.5], [0.8, 0.5], [0.8, 0.9], [0.25, 0.9]],
              occlusionZone: [[0.18, 0.52], [0.82, 0.52], [0.82, 0.92], [0.18, 0.92]],
            },
            children: [node('boat-rear', 'support-rear'), node('traveler', 'subject', 'character'), node('boat-front', 'support-front')],
          }],
        },
        events: [],
      }],
      sceneTransitions: [],
    });
    await fs.writeFile(path.join(projectDirectory, 'project.json'), `${JSON.stringify(project, null, 2)}\n`, 'utf8');
    await fs.writeFile(path.join(projectDirectory, 'assets-manifest.json'), `${JSON.stringify(manifestFixture(slug, [
        ['boat-rear', 'support-rear'],
        ['traveler', 'subject'],
      ['boat-front', 'support-front'],
      ].map(([assetId, outputRole]) => ({
        assetId,
        capability: 'image',
        adapter: 'registered-family-member',
        file: relativeSource(assetId),
        media: {width: 100, height: 100, format: 'png', hasAlpha: true},
        compositionBinding: binding(assetId, outputRole),
        registeredFamilyBinding: registeredFamilyBinding(assetId, outputRole),
        familyFingerprint: 'f'.repeat(64),
      }))), null, 2)}\n`, 'utf8');

    const [target] = await collectCompositeQualityTargets(project);
    const registeredGeometryProof =
      await buildRegisteredGeometryProofForTarget({target, root: ROOT});
    const proofFile = compositionProofReportPath(slug);
    const frame = path.join(path.dirname(proofFile), 'frame.png');
    const crop = path.join(path.dirname(proofFile), 'crop.png');
    await fs.mkdir(path.dirname(proofFile), {recursive: true});
    await fs.copyFile(sources['boat-front'], frame);
    await fs.copyFile(sources['boat-front'], crop);
    await fs.writeFile(proofFile, `${JSON.stringify({
      schemaVersion: 1,
      projectSlug: slug,
      composites: [{
        compositeId: target.compositeId,
        fingerprint: target.fingerprint,
        registeredGeometryProof,
        proofFrames: [{proofTimeId: 'final', fullFrame: path.relative(ROOT, frame), crop: path.relative(ROOT, crop)}],
      }],
      assetEvidence: ['boat-rear', 'traveler', 'boat-front'].map((nodeId) => ({
        sceneId: 'scene',
        nodeId,
        renderSize: {width: 1, height: 1},
        alphaBandInspection: {
          passed: true,
          sourceSize: {width: 100, height: 100},
          scales: [{label: 'original'}, {label: 'render-scale'}],
        },
      })),
    }, null, 2)}\n`, 'utf8');

    let status = await prepareQualityReport(slug);
    assert.equal(status.scopes.composites.pending, 1);
    status = await recordQualityReviews({
      slug,
      reviews: status.report.assets.map((entry) => ({
        assetId: entry.assetId,
        reviewer: 'human:fixture-reviewer',
        passedChecks: entry.requiredChecks,
        evidenceFiles: [path.relative(ROOT, frame)],
        note: 'Fixture reviewed',
      })),
    });
    assert.equal(status.ready, false);
    assert.equal(status.scopes.assets.pending, 0);
    assert.equal(status.scopes.composites.pending, 1);
    const composite = status.report.composites[0];
    status = await recordQualityReviews({
      slug,
      reviews: [{
        compositeId: composite.compositeId,
        reviewer: 'human:fixture-reviewer',
        passedChecks: composite.requiredChecks,
        evidenceFiles: [path.relative(ROOT, frame)],
        note: 'Fixture reviewed',
      }],
    });
    assert.equal(status.ready, true);

    await sharp(sources['boat-front']).modulate({brightness: 0.96}).png().toFile(`${sources['boat-front']}.changed.png`);
    await fs.rename(`${sources['boat-front']}.changed.png`, sources['boat-front']);
    status = await prepareQualityReport(slug);
    assert.equal(status.ready, false);
    assert.equal(status.report.composites[0].status, 'needs-revision');
    assert.ok(status.report.composites[0].technical.checks.some(({id, passed}) => id === 'proof-current' && !passed));
  } finally {
    await fs.rm(projectDirectory, {recursive: true, force: true});
    await fs.rm(publicDirectory, {recursive: true, force: true});
    await fs.rm(distDirectory, {recursive: true, force: true});
  }
});
