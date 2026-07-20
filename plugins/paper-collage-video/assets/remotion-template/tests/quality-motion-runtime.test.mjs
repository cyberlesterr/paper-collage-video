import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {createRequestFingerprint} from '../scripts/provider-lib.mjs';
import {
  assertQualityReady,
  collectCompositeQualityTargets,
  compositionProofReportPath,
  prepareQualityReport,
  recordQualityReviews,
} from '../scripts/quality-lib.mjs';
import {deriveTimeline, validateProject} from '../scripts/project-lib.mjs';
import {resolvePythonCommand} from '../scripts/python-runtime.mjs';
import {deriveSubtitleCues, segmentSubtitleText} from '../scripts/subtitle-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

test('v4 scene transitions use one seconds-based timing protocol', () => {
  const timeline = deriveTimeline({
    video: {fps: 30},
    scenes: [
      {
        id: 'one',
        narration: {durationSeconds: 2, startSeconds: 0},
        tailSeconds: 0,
        transition: {type: 'fade', durationSeconds: 0.4},
      },
      {
        id: 'two',
        narration: {durationSeconds: 2, startSeconds: 0},
        tailSeconds: 0,
        transition: {type: 'none', durationSeconds: 1},
      },
      {
        id: 'three',
        narration: {durationSeconds: 2, startSeconds: 0},
        tailSeconds: 0,
        transition: {type: 'fade', durationSeconds: 2 / 3},
      },
    ],
  });
  assert.equal(timeline.scenes[0].from, 0);
  assert.equal(timeline.scenes[1].from, 60);
  assert.equal(timeline.scenes[2].from, 100);
  assert.equal(timeline.durationInFrames, 160);
});

test('pre-v4 projects are rejected instead of migrated', async () => {
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
        code === 'schema-version' && message.includes('必须为 4'),
    ),
  );
});

test('v4 projects require an explicit bounded narration gain', async () => {
  const base = {
    schemaVersion: 4,
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
        {
          schemaVersion: 4,
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
                    motion: {keyframes: [{at: 0, y: 0}, {at: 1, y: 0}]},
                  },
                ],
              },
            },
          ],
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    await fs.writeFile(
      path.join(projectDirectory, 'assets-manifest.json'),
      `${JSON.stringify({
        schemaVersion: 3,
        projectSlug: slug,
        assets: [
          {
            assetId: 'hero-alpha',
            capability: 'image',
            file: path.relative(ROOT, characterFile),
            request: {
              quality: {requiredChecks: ['edge-clean']},
            },
          },
        ],
      })}\n`,
      'utf8',
    );

    let status = await prepareQualityReport(slug);
    assert.equal(status.ready, false);
    assert.equal(status.pending, 2);
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
              reviewer: 'test-vision',
              passedChecks: status.report.assets[0].requiredChecks,
            },
            {
              assetId: 'missing-asset',
              reviewer: 'test-vision',
              passedChecks: [],
            },
          ],
        }),
      /未知质量对象：missing-asset/,
    );
    assert.equal(await fs.readFile(reportFile, 'utf8'), beforeInvalidBatch);

    status = await recordQualityReviews({
      slug,
      reviews: status.report.assets.map((asset) => ({
        assetId: asset.assetId,
        reviewer: 'test-vision',
        passedChecks: asset.requiredChecks,
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
    assert.equal(
      status.report.assets.find(({kind}) => kind === 'background').status,
      'pending',
    );
  } finally {
    await fs.rm(projectDirectory, {recursive: true, force: true});
    await fs.rm(publicDirectory, {recursive: true, force: true});
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
  const node = (id, slot, role = 'prop') => ({
    id,
    kind: 'asset',
    assetRole: role,
    src: path.relative(path.join(ROOT, 'public'), sources[id]),
    z: 0,
    slot,
    registrationId: 'boat-family',
    transform: {x: 0, y: 0, width: 1, height: 1, anchorX: 0, anchorY: 0},
    motion: {keyframes: [{at: 0, x: 0}, {at: 1, x: 0}]},
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
    const project = {
      schemaVersion: 4,
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
            motion: {keyframes: [{at: 0, x: 0}, {at: 1, x: 0}]},
            registration: {id: 'boat-family', sourceMasterAssetId: 'boat-master', canvas: {width: 100, height: 100}, origin: 'top-left'},
            support: {
              subjectId: 'traveler', contactAnchor: {x: 0.5, y: 0.7},
              contactZone: [[0.25, 0.5], [0.8, 0.5], [0.8, 0.9], [0.25, 0.9]],
              occlusionZone: [[0.18, 0.52], [0.82, 0.52], [0.82, 0.92], [0.18, 0.92]],
            },
            children: [node('boat-rear', 'support-rear'), node('traveler', 'subject', 'character'), node('boat-front', 'support-front')],
          }],
        },
        cues: [],
      }],
    };
    await fs.writeFile(path.join(projectDirectory, 'project.json'), `${JSON.stringify(project, null, 2)}\n`, 'utf8');
    await fs.writeFile(path.join(projectDirectory, 'assets-manifest.json'), `${JSON.stringify({
      schemaVersion: 3,
      projectSlug: slug,
      assets: [
        ['boat-rear', 'support-rear'],
        ['traveler', 'subject'],
        ['boat-front', 'support-front'],
      ].map(([assetId, outputRole]) => ({assetId, capability: 'image', file: relativeSource(assetId), compositionBinding: binding(assetId, outputRole)})),
    }, null, 2)}\n`, 'utf8');

    const [target] = await collectCompositeQualityTargets(project);
    const proofFile = compositionProofReportPath(slug);
    const frame = path.join(path.dirname(proofFile), 'frame.png');
    const crop = path.join(path.dirname(proofFile), 'crop.png');
    await fs.mkdir(path.dirname(proofFile), {recursive: true});
    await fs.copyFile(sources['boat-front'], frame);
    await fs.copyFile(sources['boat-front'], crop);
    await fs.writeFile(proofFile, `${JSON.stringify({schemaVersion: 1, projectSlug: slug, composites: [{compositeId: target.compositeId, fingerprint: target.fingerprint, proofFrames: [{proofTimeId: 'final', fullFrame: path.relative(ROOT, frame), crop: path.relative(ROOT, crop)}]}]}, null, 2)}\n`, 'utf8');

    let status = await prepareQualityReport(slug);
    assert.equal(status.scopes.composites.pending, 1);
    status = await recordQualityReviews({
      slug,
      reviews: status.report.assets.map((entry) => ({assetId: entry.assetId, reviewer: 'fixture-reviewer', passedChecks: entry.requiredChecks})),
    });
    assert.equal(status.ready, false);
    assert.equal(status.scopes.assets.pending, 0);
    assert.equal(status.scopes.composites.pending, 1);
    const composite = status.report.composites[0];
    status = await recordQualityReviews({
      slug,
      reviews: [{compositeId: composite.compositeId, reviewer: 'fixture-reviewer', passedChecks: composite.requiredChecks}],
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
