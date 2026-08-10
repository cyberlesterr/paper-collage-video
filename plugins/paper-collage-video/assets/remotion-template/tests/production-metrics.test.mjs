import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {
  classifyQualityReviewer,
  createProductionMetrics,
  finishMetricSegment,
  productionMetricsPath,
  refreshProductionMetrics,
  startMetricSegment,
} from '../scripts/production-metrics-lib.mjs';
import {withCompiledEditorialFixture} from '../fixtures/editorial-fixture.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('quality help bypasses project metrics and does not require a slug', () => {
  const result = spawnSync(
    'npm',
    ['run', 'project:quality', '--', '--help'],
    {cwd: ROOT, encoding: 'utf8'},
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /用法：project:quality/);
});

test('style proof help bypasses project metrics and does not require a slug', () => {
  const result = spawnSync(
    'npm',
    ['run', 'project:style-proof', '--', '--help'],
    {cwd: ROOT, encoding: 'utf8'},
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /用法：project:style-proof/);
});

const productionState = ({slug, createdAt, updatedAt}) => ({
  $schema: '../../schemas/production.schema.json',
  schemaVersion: 1,
  slug,
  stage: 'asset-production',
  createdAt,
  updatedAt,
  approvals: {
    concept: {status: 'approved', decidedAt: createdAt, note: 'test'},
    styleAndVoice: {status: 'approved', decidedAt: createdAt, note: 'test'},
    preview: {status: 'pending', decidedAt: null, note: ''},
    publish: {status: 'pending', decidedAt: null, note: ''},
  },
  workItems: [],
  artifacts: {},
  history: [{at: createdAt, action: 'project-created', stage: 'capability-review', note: ''}],
});

const writeJson = (file, value) =>
  fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');

test('production metrics union overlapping intervals and expose AI review share', async () => {
  const slug = `production-metrics-${process.pid}`;
  const projectDirectory = path.join(ROOT, 'projects', slug);
  const createdAt = '2026-07-22T00:00:00.000Z';
  try {
    await fs.mkdir(projectDirectory, {recursive: true});
    await writeJson(
      path.join(projectDirectory, 'production.json'),
      productionState({slug, createdAt, updatedAt: '2026-07-22T00:00:10.000Z'}),
    );
    await writeJson(
      productionMetricsPath(slug),
      createProductionMetrics({slug, createdAt}),
    );
    await fs.writeFile(
      path.join(projectDirectory, 'generation-attempts.jsonl'),
      [
        {
          schemaVersion: 1,
          attemptId: 'img-11111111-1111-1111-1111-111111111111',
          event: 'reserved',
          status: 'reserved',
          projectSlug: slug,
          assetId: 'test-image',
          provider: 'test-provider',
          model: 'test-model',
          requestFingerprint: 'a'.repeat(64),
          quotaConsumed: false,
          at: '2026-07-22T00:00:01.000Z',
        },
        {
          schemaVersion: 1,
          attemptId: 'img-11111111-1111-1111-1111-111111111111',
          event: 'closed',
          status: 'succeeded',
          projectSlug: slug,
          assetId: 'test-image',
          provider: 'test-provider',
          model: 'test-model',
          requestFingerprint: 'a'.repeat(64),
          quotaConsumed: true,
          at: '2026-07-22T00:00:03.000Z',
        },
      ].map((entry) => JSON.stringify(entry)).join('\n') + '\n',
      'utf8',
    );
    const deterministic = await startMetricSegment({
      slug,
      category: 'deterministic-check',
      operation: 'test-check',
      measurement: 'command-wall-clock',
      at: '2026-07-22T00:00:02.500Z',
    });
    await finishMetricSegment({
      slug,
      segmentId: deterministic.id,
      at: '2026-07-22T00:00:03.500Z',
    });
    const review = await startMetricSegment({
      slug,
      category: 'ai-review',
      operation: 'quality-review',
      measurement: 'review-session-window',
      at: '2026-07-22T00:00:04.000Z',
    });
    await finishMetricSegment({
      slug,
      segmentId: review.id,
      at: '2026-07-22T00:00:06.000Z',
    });

    const metrics = await refreshProductionMetrics(slug);
    assert.equal(metrics.summary.observation.durationMs, 10_000);
    assert.equal(metrics.summary.byCategory['ai-generation'].durationMs, 2_000);
    assert.equal(metrics.summary.aiReview.durationMs, 2_000);
    assert.equal(metrics.summary.aiReview.percentOfObservation, 20);
    assert.equal(metrics.summary.byCategory['deterministic-check'].durationMs, 1_000);
    assert.equal(metrics.summary.measuredUnionMs, 4_500);
    assert.equal(metrics.summary.unattributedMs, 5_500);
    assert.equal(metrics.summary.coverage.status, 'full');
    assert.match(metrics.measurementNotes.reviewSessionWindow, /recorded human decision/);
    assert.match(metrics.measurementNotes.tokenTelemetry, /does not estimate token usage/);
    assert.match(metrics.measurementNotes.categoryOverlap, /de-duplicates all overlaps/);
  } finally {
    await fs.rm(projectDirectory, {recursive: true, force: true});
  }
});

test('lazy metrics creation marks old projects as partial coverage', async () => {
  const slug = `production-metrics-legacy-${process.pid}`;
  const projectDirectory = path.join(ROOT, 'projects', slug);
  const createdAt = '2026-01-01T00:00:00.000Z';
  try {
    await fs.mkdir(projectDirectory, {recursive: true});
    await writeJson(
      path.join(projectDirectory, 'production.json'),
      productionState({slug, createdAt, updatedAt: '2026-01-01T00:00:05.000Z'}),
    );
    const metrics = await refreshProductionMetrics(slug);
    assert.equal(metrics.summary.coverage.status, 'partial');
    assert.equal(metrics.summary.observation.durationMs, 5_000);
  } finally {
    await fs.rm(projectDirectory, {recursive: true, force: true});
  }
});

test('reviewer classification distinguishes the default host AI reviewer', () => {
  assert.equal(classifyQualityReviewer('host-vision'), 'ai-review');
  assert.equal(classifyQualityReviewer('codex:vision'), 'ai-review');
  assert.equal(classifyQualityReviewer('human:editor'), 'human-review');
});

test('project:new initializes a full-coverage production metrics file', async () => {
  const slug = `production-metrics-new-${process.pid}`;
  const projectDirectory = path.join(ROOT, 'projects', slug);
  const publicDirectory = path.join(ROOT, 'public', 'projects', slug);
  try {
    const result = spawnSync(
      process.execPath,
      ['scripts/project-new.mjs', slug, '--title=Metrics Test'],
      {cwd: ROOT, encoding: 'utf8'},
    );
    assert.equal(result.status, 0, result.stderr);
    const metrics = JSON.parse(
      await fs.readFile(path.join(projectDirectory, 'production-metrics.json'), 'utf8'),
    );
    assert.equal(metrics.projectSlug, slug);
    assert.equal(metrics.summary.coverage.status, 'full');
    assert.equal(metrics.summary.aiReview.durationMs, 0);
    const measured = spawnSync(
      process.execPath,
      [
        'scripts/project-metrics-run.mjs',
        '--category=deterministic-check',
        '--operation=status-probe',
        '--script=scripts/project-status.mjs',
        '--slug-index=0',
        '--',
        slug,
      ],
      {cwd: ROOT, encoding: 'utf8'},
    );
    assert.equal(measured.status, 0, measured.stderr);
    const updatedMetrics = JSON.parse(
      await fs.readFile(path.join(projectDirectory, 'production-metrics.json'), 'utf8'),
    );
    const segment = updatedMetrics.segments.find(({operation}) => operation === 'status-probe');
    assert.equal(segment.status, 'completed');
    assert.ok(segment.durationMs >= 0);
  } finally {
    await fs.rm(projectDirectory, {recursive: true, force: true});
    await fs.rm(publicDirectory, {recursive: true, force: true});
  }
});

test('quality record-batch emits output and creates a bound incremental scaffold', async () => {
  const slug = `production-metrics-review-${process.pid}`;
  const projectDirectory = path.join(ROOT, 'projects', slug);
  const publicDirectory = path.join(ROOT, 'public', 'projects', slug);
  const backgroundFile = path.join(publicDirectory, 'assets', 'plates', 'background.png');
  const accentFile = path.join(publicDirectory, 'assets', 'plates', 'accent.png');
  const createdAt = new Date(Date.now() - 2_000).toISOString();
  try {
    await fs.mkdir(projectDirectory, {recursive: true});
    await fs.mkdir(path.dirname(backgroundFile), {recursive: true});
    await sharp({
      create: {width: 640, height: 360, channels: 3, background: '#d8c7a2'},
    }).png().toFile(backgroundFile);
    await sharp({
      create: {width: 96, height: 96, channels: 4, background: '#b45f45'},
    }).png().toFile(accentFile);
    await writeJson(
      path.join(projectDirectory, 'production.json'),
      productionState({slug, createdAt, updatedAt: createdAt}),
    );
    await writeJson(path.join(projectDirectory, 'project.json'), withCompiledEditorialFixture({
      slug,
      title: 'Metrics review fixture',
      quality: {minimumAssetScale: 0.5},
      video: {width: 640, height: 360, fps: 30},
      theme: {},
      audio: {music: null},
      scenes: [{
        id: 'scene',
        composition: {
          coordinateSpace: {width: 640, height: 360},
          nodes: [{
            id: 'background',
            kind: 'asset',
            assetRole: 'background',
            src: `projects/${slug}/assets/plates/background.png`,
            z: 0,
            transform: {x: 0, y: 0, width: 1, height: 1, anchorX: 0, anchorY: 0},
            motion: {keyframes: [{at: 0, scale: 1}, {at: 1, scale: 1}]},
          }, {
            id: 'accent',
            kind: 'asset',
            assetRole: 'decorative',
            src: `projects/${slug}/assets/plates/accent.png`,
            z: 1,
            transform: {x: 0.7, y: 0.2, width: 0.12, anchorX: 0.5, anchorY: 0.5},
            motion: {keyframes: [{at: 0, scale: 1}, {at: 1, scale: 1}]},
          }],
        },
      }],
      sceneTransitions: [],
    }));
    const scaffoldFile = path.join(projectDirectory, 'quality-review-scaffold.json');
    const scaffoldResult = spawnSync(
      'npm',
      [
        'run',
        'project:quality',
        '--',
        slug,
        'scaffold',
        `--output=${path.relative(ROOT, scaffoldFile)}`,
        '--reviewer=human:test-editor',
      ],
      {cwd: ROOT, encoding: 'utf8'},
    );
    assert.equal(scaffoldResult.status, 0, scaffoldResult.stderr);
    assert.match(scaffoldResult.stdout, /质量审核脚手架/);
    const scaffold = JSON.parse(await fs.readFile(scaffoldFile, 'utf8'));
    assert.equal(scaffold.schemaVersion, 4);
    assert.equal(scaffold.reviews.length, 2);
    for (const review of scaffold.reviews.slice(0, 1)) {
      review.passedChecks = review.pendingChecks;
      review.failedChecks = [];
      review.note = 'Inspected test fixture';
    }
    scaffold.reviews = scaffold.reviews.slice(0, 1);
    await writeJson(scaffoldFile, scaffold);
    const recordResult = spawnSync(
      'npm',
      [
        'run',
        'project:quality',
        '--',
        slug,
        'record-batch',
        `--input=${path.relative(ROOT, scaffoldFile)}`,
        '--quiet',
      ],
      {cwd: ROOT, encoding: 'utf8'},
    );
    assert.equal(recordResult.status, 0, recordResult.stderr);
    assert.match(recordResult.stdout, /quality: 1\/2 passed/);
    assert.match(recordResult.stdout, /remaining: 1 review/);
    const pendingFile = path.join(
      projectDirectory,
      'quality-review-scaffold.pending.json',
    );
    const pendingScaffold = JSON.parse(await fs.readFile(pendingFile, 'utf8'));
    assert.equal(pendingScaffold.schemaVersion, 4);
    assert.equal(pendingScaffold.reviews.length, 1);
    assert.match(
      pendingScaffold.sourceReport.fingerprint,
      /^[a-f0-9]{64}$/,
    );
    const contactSheet = spawnSync(
      'npm',
      [
        'run',
        'project:quality',
        '--',
        slug,
        'contact-sheet',
        `--input=${path.relative(ROOT, pendingFile)}`,
        '--quiet',
      ],
      {cwd: ROOT, encoding: 'utf8'},
    );
    assert.equal(contactSheet.status, 0, contactSheet.stderr);
    const finalRecord = spawnSync(
      'npm',
      [
        'run',
        'project:quality',
        '--',
        slug,
        'accept-human',
        `--input=${path.relative(ROOT, pendingFile)}`,
        '--reviewer=human:test-editor',
        '--note=Inspected remaining fixture',
        '--quiet',
      ],
      {cwd: ROOT, encoding: 'utf8'},
    );
    assert.equal(finalRecord.status, 0, finalRecord.stderr);
    assert.match(finalRecord.stdout, /quality: 2\/2 passed/);
    const metrics = JSON.parse(await fs.readFile(productionMetricsPath(slug), 'utf8'));
    const reviewSegments = metrics.segments.filter(
      ({operation}) => operation === 'quality-review',
    );
    assert.equal(reviewSegments.length, 2);
    assert.ok(
      reviewSegments.every(
        ({category, status, durationMs}) =>
          category === 'human-review' &&
          status === 'completed' &&
          durationMs >= 0,
      ),
    );
    assert.equal(
      metrics.summary.byCategory['human-review'].segmentCount,
      2,
    );
    assert.equal(
      metrics.summary.byCategory['deterministic-check'].segmentCount,
      4,
    );
  } finally {
    await fs.rm(projectDirectory, {recursive: true, force: true});
    await fs.rm(publicDirectory, {recursive: true, force: true});
  }
});
