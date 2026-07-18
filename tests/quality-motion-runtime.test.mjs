import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {createRequestFingerprint} from '../scripts/provider-lib.mjs';
import {
  assertQualityReady,
  prepareQualityReport,
  recordQualityReview,
} from '../scripts/quality-lib.mjs';
import {deriveTimeline} from '../scripts/project-lib.mjs';
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
});

test('scene-specific transitions override the legacy global overlap', () => {
  const timeline = deriveTimeline({
    video: {fps: 30, transitionFrames: 12},
    scenes: [
      {
        id: 'one',
        narration: {durationSeconds: 2, startFrame: 0},
        tailFrames: 0,
      },
      {
        id: 'two',
        narration: {durationSeconds: 2, startFrame: 0},
        tailFrames: 0,
        transition: {type: 'none', durationFrames: 30},
      },
      {
        id: 'three',
        narration: {durationSeconds: 2, startFrame: 0},
        tailFrames: 0,
        transition: {type: 'fade', durationFrames: 20},
      },
    ],
  });
  assert.equal(timeline.scenes[0].from, 0);
  assert.equal(timeline.scenes[1].from, 60);
  assert.equal(timeline.scenes[2].from, 100);
  assert.equal(timeline.durationInFrames, 160);
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
    startFrame: 9,
    durationSeconds: 6,
    fps: 30,
    maximumCharacters: 12,
  });
  assert.equal(cues[0].from, 9);
  assert.equal(cues.at(-1).to, 189);
  assert.ok(cues.every(({from, to}) => to > from));

  const compressed = deriveSubtitleCues({
    text: '甲。乙。丙。丁。',
    startFrame: 0,
    durationSeconds: 2 / 30,
    fps: 30,
    maximumCharacters: 1,
    gapFrames: 2,
  });
  assert.equal(compressed.length, 2);
  assert.deepEqual(compressed.map(({from, to}) => [from, to]), [[0, 1], [1, 2]]);
});

test('required asset quality resets on file hashes and blocks until every rubric passes', async () => {
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
          schemaVersion: 1,
          slug,
          title: 'Quality Gate',
          quality: {mode: 'required', minimumAssetScale: 1},
          video: {width: 640, height: 360, fps: 30, transitionFrames: 0},
          theme: {},
          audio: {music: null, sfx: {}},
          scenes: [
            {
              id: 'scene',
              background: `projects/${slug}/assets/plates/bg.png`,
              layers: [
                {
                  id: 'hero',
                  src: `projects/${slug}/assets/characters/alpha/hero.png`,
                },
              ],
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
        schemaVersion: 1,
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
    await assert.rejects(() => assertQualityReady(slug), /资产质量门未通过/);

    for (const asset of status.report.assets) {
      status = await recordQualityReview({
        slug,
        assetId: asset.assetId,
        reviewer: 'test-vision',
        passedChecks: asset.requiredChecks,
        note: 'Fixture reviewed',
      });
    }
    assert.equal(status.ready, true);
    assert.equal(status.passed, 2);
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
