import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createRuntimeBuildManifest} from '../scripts/runtime-build-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN_ROOT = path.join(ROOT, 'plugins', 'paper-collage-video');
const RUNTIME_ROOT = path.join(PLUGIN_ROOT, 'assets', 'remotion-template');

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const repositoryVersion = readJson(path.join(ROOT, 'package.json')).version;

const assertPatchedFastUri = (lockFile) => {
  const version = readJson(lockFile).packages?.['node_modules/fast-uri']?.version;
  assert.ok(version, `${lockFile} must lock fast-uri`);
  const [major, minor, patch] = version.split('.').map(Number);
  assert.ok(
    major > 3 || (major === 3 && (minor > 1 || (minor === 1 && patch >= 5))),
    `${lockFile} locks vulnerable fast-uri ${version}; require >=3.1.5`,
  );
};

test('repository marketplace exposes the paper collage plugin', () => {
  const marketplace = readJson(
    path.join(ROOT, '.agents', 'plugins', 'marketplace.json'),
  );
  assert.equal(marketplace.name, 'paper-collage-video');
  assert.equal(marketplace.plugins.length, 1);
  assert.deepEqual(marketplace.plugins[0], {
    name: 'paper-collage-video',
    source: {source: 'local', path: './plugins/paper-collage-video'},
    policy: {installation: 'AVAILABLE', authentication: 'ON_INSTALL'},
    category: 'Creativity',
  });
});

test('plugin manifest points at a complete packaged skill', () => {
  const manifest = readJson(
    path.join(PLUGIN_ROOT, '.codex-plugin', 'plugin.json'),
  );
  assert.equal(manifest.name, 'paper-collage-video');
  assert.equal(manifest.version, repositoryVersion);
  assert.equal(manifest.skills, './skills/');
  assert.ok(manifest.interface.defaultPrompt.length > 0);

  const skillFile = path.join(
    PLUGIN_ROOT,
    'skills',
    'make-paper-collage-video',
    'SKILL.md',
  );
  assert.ok(fs.existsSync(skillFile));
  assert.match(fs.readFileSync(skillFile, 'utf8'), /references\/setup\.md/);
  assert.match(fs.readFileSync(skillFile, 'utf8'), /references\/providers\.md/);
  assert.match(
    fs.readFileSync(skillFile, 'utf8'),
    /references\/story-planning\.md/,
  );
  assert.match(
    fs.readFileSync(skillFile, 'utf8'),
    /references\/editorial-system-v9\.md/,
  );
  assert.ok(
    fs.existsSync(
      path.join(
        PLUGIN_ROOT,
        'skills',
        'make-paper-collage-video',
        'references',
        'setup.md',
      ),
    ),
  );
  assert.ok(fs.existsSync(path.join(PLUGIN_ROOT, 'THIRD_PARTY_NOTICES.md')));
  assert.ok(fs.existsSync(path.join(PLUGIN_ROOT, 'ASSET_LICENSES.md')));
  assert.ok(fs.existsSync(path.join(PLUGIN_ROOT, 'LICENSE')));
});

test('source and packaged skills document publish approval as a post-completion audit command', () => {
  const command =
    'npm run project:advance -- <slug> approve-publish --note="<destination + action + scope>"';
  for (const relative of [
    'SKILL.md',
    path.join('references', 'approval-gates.md'),
  ]) {
    const source = fs.readFileSync(
      path.join(ROOT, 'skills', 'make-paper-collage-video', relative),
      'utf8',
    );
    const packaged = fs.readFileSync(
      path.join(
        PLUGIN_ROOT,
        'skills',
        'make-paper-collage-video',
        relative,
      ),
      'utf8',
    );
    assert.equal(packaged, source, relative);
    assert.ok(source.includes(command), relative);
    assert.match(source, /post-completion audit event/);
  }
});

test('packaged runtime carries the registered-geometry proof script and new regression tests', () => {
  const sourcePackage = readJson(path.join(ROOT, 'package.json'));
  const runtimePackage = readJson(path.join(RUNTIME_ROOT, 'package.json'));
  assert.equal(
    sourcePackage.scripts['proof:registered-geometry'],
    'node scripts/prove-registered-geometry.mjs',
  );
  assert.equal(
    runtimePackage.scripts['proof:registered-geometry'],
    sourcePackage.scripts['proof:registered-geometry'],
    'plugin:sync must copy the proof:registered-geometry script into the packaged workspace',
  );
  for (const relative of [
    'tests/occlusion-action-facing.test.mjs',
    'tests/registered-geometry-temporal-subtitle.test.mjs',
  ]) {
    const source = fs.readFileSync(path.join(ROOT, relative), 'utf8');
    const packaged = fs.readFileSync(
      path.join(RUNTIME_ROOT, relative),
      'utf8',
    );
    assert.equal(packaged, source, relative);
    assert.ok(source.length > 0, relative);
  }
});

test('repository and packaged locks exclude the vulnerable fast-uri range', () => {
  assertPatchedFastUri(path.join(ROOT, 'package-lock.json'));
  assertPatchedFastUri(path.join(RUNTIME_ROOT, 'package-lock.json'));
});

test('packaged runtime is lightweight and independent from production projects', () => {
  const packageJson = readJson(path.join(RUNTIME_ROOT, 'package.json'));
  assert.equal(packageJson.name, 'paper-collage-video-workspace');
  assert.equal(packageJson.version, repositoryVersion);
  assert.equal(packageJson.scripts.doctor, 'node scripts/project-doctor.mjs');
  assert.equal(packageJson.scripts['provider:status'], 'node scripts/provider-status.mjs');
  assert.equal(packageJson.scripts['provider:select'], 'node scripts/provider-select.mjs');
  assert.equal(packageJson.scripts['provider:reuse'], 'node scripts/provider-reuse.mjs');
  assert.equal(packageJson.scripts['provider:attempt'], 'node scripts/provider-attempt.mjs');
  assert.equal(packageJson.scripts['provider:request'], 'node scripts/provider-request.mjs');
  assert.equal(packageJson.scripts['provider:recover-record'], 'node scripts/provider-recover-record.mjs');
  assert.equal(
    packageJson.scripts['provider:recover-rejected-source'],
    'node scripts/provider-recover-rejected-source.mjs',
  );
  assert.equal(
    packageJson.scripts['assets:derive-registered-family'],
    'node scripts/derive-registered-family.mjs',
  );
  assert.equal(
    packageJson.scripts['assets:derive-semantic-slices'],
    'node scripts/derive-semantic-slices.mjs',
  );
  assert.equal(
    packageJson.scripts['proof:registered-family'],
    'node scripts/prove-registered-family.mjs',
  );
  assert.equal(
    packageJson.scripts['assets:derive-canonical-container'],
    'node scripts/derive-canonical-container.mjs',
  );
  assert.equal(
    packageJson.scripts['assets:normalize-provider-source'],
    'node scripts/normalize-provider-source.mjs',
  );
  assert.equal(
    packageJson.scripts['proof:canonical-container'],
    'node scripts/prove-canonical-container.mjs',
  );
  assert.equal(
    packageJson.scripts['proof:alpha-bands'],
    'node scripts/prove-alpha-bands.mjs',
  );
  assert.equal(packageJson.scripts['project:plan'], 'node scripts/project-plan.mjs');
  assert.equal(
    packageJson.scripts['project:world-topology-proof'],
    'node scripts/project-world-topology-proof.mjs',
  );
  assert.equal(packageJson.scripts['project:intake'], 'node scripts/project-intake.mjs');
  assert.equal(packageJson.scripts['project:scenarios'], 'node scripts/project-scenarios.mjs');
  assert.equal(packageJson.scripts['project:budget'], 'node scripts/project-budget.mjs');
  assert.equal(
    packageJson.scripts['project:increase-image-budget'],
    'node scripts/project-increase-image-budget.mjs',
  );
  assert.equal(packageJson.scripts['project:storyboard'], 'node scripts/project-storyboard.mjs');
  assert.equal(packageJson.scripts['project:revise-preview-directing'], 'node scripts/project-revise-preview-directing.mjs');
  assert.equal(packageJson.scripts['project:sync-directing'], 'node scripts/project-sync-directing.mjs');
  assert.equal(packageJson.scripts['project:visual-review'], 'node scripts/project-visual-review.mjs');
  assert.equal(packageJson.scripts['project:asset-lifecycle'], 'node scripts/project-asset-lifecycle.mjs');
  assert.equal(packageJson.scripts['project:semantic-contracts'], 'node scripts/project-semantic-contracts.mjs');
  assert.equal(
    packageJson.scripts['project:confirm-concept'],
    'node scripts/project-confirm-concept.mjs',
  );
  assert.equal(
    packageJson.scripts['project:resume'],
    'node scripts/project-status.mjs --resume-json',
  );
  assert.match(packageJson.scripts['project:quality'], /project-metrics-run\.mjs/);
  assert.match(packageJson.scripts['project:composition-proof'], /category=evidence-render/);
  assert.match(packageJson.scripts['project:scene-preview'], /scene-preview-render/);
  assert.equal(packageJson.scripts['project:render-status'], 'node scripts/project-render-status.mjs');
  assert.equal(packageJson.scripts['project:metrics'], 'node scripts/project-metrics.mjs');
  assert.match(packageJson.scripts['project:audio-preflight'], /category=deterministic-check/);
  assert.match(packageJson.scripts['project:audio-calibration'], /category=deterministic-check/);
  assert.match(packageJson.scripts['project:stitch-narration'], /stitch-narration/);
  assert.equal(packageJson.scripts['project:subtitles'], 'node scripts/project-subtitles.mjs');
  assert.match(packageJson.scripts['project:style-proof'], /category=evidence-render/);
  assert.equal(packageJson.scripts['style:proof'], undefined);
  assert.equal(
    packageJson.scripts['sample:vox'],
    'remotion render src/index.ts Paper-Collage dist/vox-primitives/preview.mp4 --props=fixtures/vox-primitives/project.json --codec=h264',
  );
  assert.equal(
    packageJson.scripts['sample:vox:verify'],
    'node scripts/verify-vox-sample.mjs',
  );
  assert.equal(
    packageJson.scripts['proof:phase2:prepare'],
    'node scripts/prepare-phase2-proof.mjs',
  );
  assert.equal(
    packageJson.scripts['proof:phase2:render'],
    'node scripts/render-phase2-proof.mjs',
  );
  assert.equal(
    packageJson.scripts['proof:phase2:verify'],
    'node scripts/verify-phase2-proof.mjs',
  );
  assert.equal(
    packageJson.scripts['schema:v12'],
    'node scripts/schema-v12.mjs',
  );
  assert.ok(fs.existsSync(path.join(RUNTIME_ROOT, 'projects', 'starter-demo')));
  assert.ok(fs.existsSync(path.join(RUNTIME_ROOT, 'THIRD_PARTY_NOTICES.md')));
  assert.ok(fs.existsSync(path.join(RUNTIME_ROOT, 'ASSET_LICENSES.md')));
  assert.ok(fs.existsSync(path.join(RUNTIME_ROOT, 'LICENSE')));
  assert.deepEqual(
    fs.readdirSync(path.join(RUNTIME_ROOT, 'projects')).sort(),
    ['starter-demo'],
  );
  const starterProject = readJson(
    path.join(RUNTIME_ROOT, 'projects', 'starter-demo', 'project.json'),
  );
  const starterManifest = readJson(
    path.join(RUNTIME_ROOT, 'projects', 'starter-demo', 'assets-manifest.json'),
  );
  const starterQuality = readJson(
    path.join(RUNTIME_ROOT, 'projects', 'starter-demo', 'quality-report.json'),
  );
  const starterMetrics = readJson(
    path.join(RUNTIME_ROOT, 'projects', 'starter-demo', 'production-metrics.json'),
  );
  const starterProduction = readJson(
    path.join(RUNTIME_ROOT, 'projects', 'starter-demo', 'production.json'),
  );
  const starterSeal = readJson(
    path.join(RUNTIME_ROOT, 'dist', 'starter-demo', 'assets-ready-seal.json'),
  );
  const starterProof = readJson(
    path.join(
      RUNTIME_ROOT,
      'dist',
      'starter-demo',
      'composition-proof',
      'report.json',
    ),
  );
  const catalogStyleImages = readJson(
    path.join(ROOT, 'public', 'style-catalog', 'catalog.json'),
  ).styles.map(({image}) => `public/${image}`);
  assert.equal(starterProject.schemaVersion, 12);
  assert.ok(starterProject.scenes[0].composition.nodes.length >= 2);
  assert.equal(starterProject.scenes[0].motion.proofTimes.length, 3);
  assert.equal(starterProject.scenes[0].events.length, 3);
  assert.deepEqual(
    starterProject.scenes[0].events.map(({proofTimeId}) => proofTimeId),
    ['proof-establish', 'proof-action', 'proof-final'],
  );
  assert.equal(starterProject.scenes[0].composition.nodes[1].visibility.initial, 'hidden');
  assert.deepEqual(starterProject.sceneTransitions, []);
  assert.deepEqual(starterProject.quality, {minimumAssetScale: 0.5});
  assert.equal(starterManifest.schemaVersion, 4);
  assert.equal(starterQuality.schemaVersion, 7);
  assert.equal(starterQuality.updatedAt, '2026-01-01T00:00:00.000Z');
  assert.match(starterQuality.reviewSurfaceFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(starterQuality.eventTimeline.length, 3);
  assert.equal(starterQuality.composites.length, 5);
  assert.ok(starterQuality.composites.every(({status}) => status === 'passed'));
  assert.equal(starterQuality.assets.length, 2);
  assert.ok(starterQuality.assets.every(({status}) => status === 'passed'));
  assert.equal(starterMetrics.summary.coverage.status, 'full');
  assert.equal(
    starterProduction.artifacts.assetsReadySeal,
    'dist/starter-demo/assets-ready-seal.json',
  );
  assert.equal(
    starterProduction.artifacts.validationReport,
    'dist/starter-demo/validation-report.json',
  );
  for (const relative of [
    'projects/starter-demo/failure-circuit.jsonl',
    'projects/starter-demo/motion-language-card.json',
    'projects/starter-demo/motion-approval.json',
    'projects/starter-demo/visual-blueprint-approval.json',
    'projects/starter-demo/visual-blueprint-review-request.json',
    'projects/starter-demo/visual-blueprint-review-receipt.json',
    'dist/starter-demo/validation-report.json',
    'dist/starter-demo/visual-blueprint/index.json',
    'dist/starter-demo/visual-blueprint/animatic.mp4',
    'dist/starter-demo/visual-blueprint/scene-keyframes.jpg',
    'dist/starter-demo/visual-blueprint/style-frame.jpg',
    'dist/starter-demo/visual-blueprint/keyframes/starter-start.jpg',
    'dist/starter-demo/visual-blueprint/keyframes/starter-middle.jpg',
    'dist/starter-demo/visual-blueprint/keyframes/starter-end.jpg',
    'dist/starter-demo/visual-blueprint/motion-clips/starter.mp4',
    'dist/starter-demo/composition-proof/temporal/motion-contract-whole-film-motion-strip.jpg',
    'dist/starter-demo/composition-proof/temporal/style-profile-childrens-picture-book-paper-motion-strip.jpg',
  ]) {
    assert.ok(
      fs.existsSync(path.join(RUNTIME_ROOT, relative)),
      `packaged starter artifact missing: ${relative}`,
    );
  }
  assert.equal(starterSeal.schemaVersion, 1);
  assert.equal(starterSeal.projectSlug, 'starter-demo');
  assert.match(starterSeal.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(starterProof.frames.length, 3);
  for (const frame of starterProof.frames) {
    assert.match(frame.file, /\.svg$/);
    const svg = fs.readFileSync(path.join(RUNTIME_ROOT, frame.file), 'utf8');
    assert.equal(
      (svg.match(/data:image\/png;base64,/g) ?? []).length,
      2,
      `${frame.file} must embed both canonical starter fixture layers`,
    );
  }
  assert.equal(starterMetrics.summary.aiReview.durationMs, 0);

  for (const relative of [
    'remotion.config.ts',
    'runtime-build.json',
    'scripts/production-state.mjs',
    'scripts/directing-revision-lib.mjs',
    'scripts/directing-execution-sync-lib.mjs',
    'scripts/editorial-system-lib.mjs',
    'scripts/alpha-band-lib.mjs',
    'scripts/asset-hardening-proof-lib.mjs',
    'scripts/asset-evidence-lib.mjs',
    'scripts/asset-manifest-lib.mjs',
    'scripts/chroma-key-lib.mjs',
    'scripts/observed-key-plane-lib.mjs',
    'scripts/audio-preflight-lib.mjs',
    'scripts/audio-calibration-lib.mjs',
    'scripts/assets-ready-seal-lib.mjs',
    'scripts/provider-lib.mjs',
    'scripts/generation-attempt-lib.mjs',
    'scripts/failure-circuit-lib.mjs',
    'scripts/production-metrics-lib.mjs',
    'scripts/semantic-contract-lib.mjs',
    'scripts/provider-attempt.mjs',
    'scripts/provider-request.mjs',
    'scripts/provider-recover-record.mjs',
    'scripts/provider-recover-rejected-source.mjs',
    'scripts/checkerboard-alpha-lib.mjs',
    'scripts/decorative-scatter-lib.mjs',
    'scripts/rejected-output-recovery-lib.mjs',
    'scripts/provider-reuse.mjs',
    'scripts/provider-select.mjs',
    'scripts/python-runtime.mjs',
    'scripts/quality-lib.mjs',
    'scripts/project-quality.mjs',
    'scripts/project-metrics-run.mjs',
    'scripts/project-metrics.mjs',
    'scripts/project-failures.mjs',
    'scripts/project-audio-preflight.mjs',
    'scripts/project-audio-calibration.mjs',
    'scripts/project-stitch-narration.mjs',
    'scripts/project-budget.mjs',
    'scripts/project-asset-lifecycle.mjs',
    'scripts/render-cache-lib.mjs',
    'scripts/render-status-lib.mjs',
    'scripts/runtime-build-lib.mjs',
    'scripts/subtitle-lib.mjs',
    'scripts/subtitle-contract-lib.mjs',
    'scripts/project-subtitles.mjs',
    'scripts/creative-plan-lib.mjs',
    'scripts/intake-lib.mjs',
    'scripts/planning-scenario-lib.mjs',
    'scripts/style-catalog-lib.mjs',
    'scripts/composition-lib.mjs',
    'scripts/container-source-plan-lib.mjs',
    'scripts/derive-canonical-container.mjs',
    'scripts/canonical-container-lib.mjs',
    'scripts/derive-registered-family.mjs',
    'scripts/registered-family-lib.mjs',
    'scripts/derive-semantic-slices.mjs',
    'scripts/semantic-slices-lib.mjs',
    'scripts/world-topology-proof-lib.mjs',
    'scripts/encounter-contract-lib.mjs',
    'scripts/project-world-topology-proof.mjs',
    'scripts/normalize-provider-source.mjs',
    'scripts/motion-treatment-lib.mjs',
    'scripts/motion-contract-lib.mjs',
    'scripts/motion-approval-lib.mjs',
    'scripts/sound-effect-lib.mjs',
    'scripts/project-composition-proof.mjs',
    'scripts/project-render-status.mjs',
    'scripts/phase2-proof-lib.mjs',
    'scripts/prepare-phase2-proof.mjs',
    'scripts/project-semantic-contracts.mjs',
    'scripts/project-plan.mjs',
    'scripts/project-intake.mjs',
    'scripts/project-scenarios.mjs',
    'scripts/project-visual-blueprint.mjs',
    'scripts/project-visual-review.mjs',
    'scripts/project-storyboard.mjs',
    'scripts/project-revise-preview-directing.mjs',
    'scripts/project-sync-directing.mjs',
    'scripts/project-scene-preview.mjs',
    'scripts/storyboard-lib.mjs',
    'scripts/world-trajectory-lib.mjs',
    'scripts/render-phase2-proof.mjs',
    'scripts/schema-v12.mjs',
    'scripts/validate_v12_schemas.py',
    'scripts/verify-phase2-proof.mjs',
    'scripts/verify-vox-sample.mjs',
    'scripts/prove-alpha-bands.mjs',
    'scripts/prove-registered-family.mjs',
    'scripts/prove-canonical-container.mjs',
    'scripts/vox-sample-proof-lib.mjs',
    'scripts/project-confirm-concept.mjs',
    'scripts/style-motion-proof.mjs',
    'scripts/style-proof-lib.mjs',
    'scripts/visual-blueprint-lib.mjs',
    'scripts/visual-blueprint-review-lib.mjs',
    'src/MainVideo.tsx',
    'src/EditorialNodes.tsx',
    'src/editorialPrimitives.mjs',
    'src/editorialPrimitives.d.mts',
    'src/motion.ts',
    'src/ReplicaChapterScene.tsx',
    'src/SceneTransitionOverlay.tsx',
    'src/SubtitleOverlay.tsx',
    'src/sceneTimeline.mjs',
    'src/subtitleSurface.mjs',
    'src/subtitleSurface.d.mts',
    'src/visibilityLifecycle.mjs',
    'src/project.ts',
    'schemas/project.schema.json',
    'schemas/planning-scenarios.schema.json',
    'schemas/style-catalog.schema.json',
    'schemas/style-profile.schema.json',
    'schemas/motion-contract.schema.json',
    'schemas/editorial.schema.json',
    'schemas/semantic-contracts.schema.json',
    'schemas/generation-attempt.schema.json',
    'schemas/failure-circuit.schema.json',
    'schemas/production-metrics.schema.json',
    'schemas/storyboard.schema.json',
    'schemas/storyboard-authoring.schema.json',
    'schemas/providers.schema.json',
    'schemas/quality-report.schema.json',
    'schemas/quality-review-scaffold.schema.json',
    'schemas/quality-review-contact-sheet.schema.json',
    'schemas/registered-family.schema.json',
    'schemas/registered-family-binding.schema.json',
    'schemas/semantic-slices.schema.json',
    'schemas/canonical-container.schema.json',
    'schemas/canonical-container-binding.schema.json',
    'schemas/provider-observation.schema.json',
    'schemas/rejected-output-recovery.schema.json',
    'schemas/world-topology-proof.schema.json',
    'schemas/encounter-contract.schema.json',
    'schemas/provider-source-normalization.schema.json',
    'schemas/visual-blueprint.schema.json',
    'schemas/visual-blueprint-approval.schema.json',
    'schemas/visual-blueprint-review-request.schema.json',
    'schemas/visual-blueprint-review-receipt.schema.json',
    'schemas/sound-effect-plan.schema.json',
    'templates/project/production.json',
    'templates/project/planning-scenarios.json',
    'templates/project/production-metrics.json',
    'templates/project/semantic-contracts.json',
    'templates/project/generation-attempts.jsonl',
    'templates/project/failure-circuit.jsonl',
    'templates/project/storyboard.json',
    'templates/project/quality-report.json',
    'providers.json',
    'fixtures/editorial-fixture.mjs',
    'fixtures/motion-contract-fixture.mjs',
    'fixtures/canonical-container/canonical-container.json',
    'fixtures/canonical-container/canonical-container-binding.json',
    'fixtures/canonical-container/canonical-container-intent.json',
    'fixtures/canonical-container/canonical-container-plan.json',
    'fixtures/phase2-proof-fixture.mjs',
    'tests/canonical-container.test.mjs',
    'tests/p0-p1-hardening.test.mjs',
    'tests/motion-contract.test.mjs',
    'tests/visual-blueprint-circuit.test.mjs',
    'public/fixtures/vox-phase2-proof/narration-1.wav',
    'public/fixtures/vox-phase2-proof/narration-1.timing.json',
    'public/style-catalog/catalog.json',
    'public/style-catalog/generation-provenance.json',
    ...catalogStyleImages,
  ]) {
    assert.deepEqual(
      fs.readFileSync(path.join(RUNTIME_ROOT, relative)),
      fs.readFileSync(path.join(ROOT, relative)),
      `${relative} must be resynced with npm run plugin:sync`,
    );
  }
});

test('source and packaged runtime expose the same current build identity', async () => {
  const [source, packaged] = await Promise.all([
    createRuntimeBuildManifest({root: ROOT}),
    createRuntimeBuildManifest({root: RUNTIME_ROOT}),
  ]);
  assert.equal(source.packageVersion, repositoryVersion);
  assert.equal(packaged.packageVersion, repositoryVersion);
  assert.equal(packaged.fingerprint, source.fingerprint);
  assert.deepEqual(readJson(path.join(ROOT, 'runtime-build.json')), source);
  assert.deepEqual(readJson(path.join(RUNTIME_ROOT, 'runtime-build.json')), packaged);
});

test('packaged resolved plans can be inspected without rewriting them', () => {
  const result = spawnSync(
    process.execPath,
    ['scripts/project-plan.mjs', 'starter-demo', '--json'],
    {cwd: RUNTIME_ROOT, encoding: 'utf8'},
  );
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.decision.productionProfile, 'draft');
  assert.equal(output.decision.durationAuthority, 'human-target');
  assert.deepEqual(
    output.decision.profileOptions.map(({id}) => id),
    ['draft', 'balanced', 'full-depth'],
  );
  assert.ok(
    output.decision.profileOptions.every(
      ({assetBudget, motionBudget}) =>
        Number.isInteger(assetBudget.maxGeneratedImages) &&
        Number.isInteger(motionBudget.maxPoseSheetCalls),
    ),
  );
});

test('packaged starter proof keeps the complete quality gate ready', async () => {
  const runtimeQuality = await import(
    `${pathToFileURL(path.join(RUNTIME_ROOT, 'scripts', 'quality-lib.mjs')).href}?test=${Date.now()}`,
  );
  const prepared = await runtimeQuality.prepareQualityReport('starter-demo', {
    write: false,
  });
  assert.equal(prepared.ready, true);
  assert.equal(prepared.total, 7);
  assert.equal(prepared.passed, 7);
  const validation = spawnSync(
    process.execPath,
    ['scripts/project-validate.mjs', 'starter-demo'],
    {cwd: RUNTIME_ROOT, encoding: 'utf8'},
  );
  assert.equal(validation.status, 0, validation.stderr || validation.stdout);
  const runtimeVisualBlueprint = await import(
    `${pathToFileURL(path.join(RUNTIME_ROOT, 'scripts', 'visual-blueprint-lib.mjs')).href}?test=${Date.now()}`,
  );
  const runtimeVisualBlueprintReview = await import(
    `${pathToFileURL(path.join(RUNTIME_ROOT, 'scripts', 'visual-blueprint-review-lib.mjs')).href}?test=${Date.now()}`,
  );
  await runtimeVisualBlueprint.assertVisualBlueprintReady('starter-demo');
  await runtimeVisualBlueprintReview.assertVisualBlueprintApprovalCurrent(
    'starter-demo',
  );
  const runtimeAssetsReadySeal = await import(
    `${pathToFileURL(path.join(RUNTIME_ROOT, 'scripts', 'assets-ready-seal-lib.mjs')).href}?test=${Date.now()}`,
  );
  await runtimeAssetsReadySeal.assertAssetsReadySealCurrent('starter-demo');
});

test('bootstrap creates an isolated resumable workspace and is idempotent', async () => {
  const target = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'paper-collage-plugin-test-'),
  );
  const bootstrap = path.join(PLUGIN_ROOT, 'scripts', 'bootstrap-workspace.mjs');
  try {
    const first = spawnSync(
      process.execPath,
      [bootstrap, `--target=${target}`],
      {cwd: ROOT, encoding: 'utf8'},
    );
    assert.equal(first.status, 0, first.stderr);
    assert.ok(
      fs.existsSync(path.join(target, '.paper-collage-video-workspace.json')),
    );
    assert.equal(
      readJson(path.join(target, '.paper-collage-video-workspace.json')).pluginVersion,
      repositoryVersion,
    );
    assert.equal(
      readJson(path.join(target, 'package.json')).name,
      'paper-collage-video-workspace',
    );
    assert.match(
      await fsp.readFile(path.join(target, 'src', 'Root.tsx'), 'utf8'),
      /starterDemo as unknown as PaperCollageProject/,
    );
    assert.ok(fs.existsSync(path.join(target, 'providers.json')));
    assert.ok(fs.existsSync(path.join(target, 'providers.local.example.json')));
    const status = spawnSync(
      process.execPath,
      [bootstrap, `--target=${target}`, '--status-json'],
      {cwd: ROOT, encoding: 'utf8'},
    );
    assert.equal(status.status, 0, status.stderr);
    const statusReport = JSON.parse(status.stdout);
    assert.equal(statusReport.compatible, true);
    assert.equal(statusReport.identity.skillVersion, repositoryVersion);
    assert.equal(
      statusReport.identity.workspaceMarkerVersion,
      repositoryVersion,
    );
    assert.equal(
      statusReport.identity.workspacePackageVersion,
      repositoryVersion,
    );
    assert.deepEqual(
      statusReport.identity.actualRuntimeBuild,
      statusReport.identity.packagedRuntimeBuild,
    );
    assert.ok(Object.values(statusReport.commands).every(Boolean));
    assert.equal(statusReport.session.targetMatchesCwd, false);
    assert.equal(statusReport.productionSessionCompatible, false);

    const productionStatus = spawnSync(
      process.execPath,
      [bootstrap, `--target=${target}`, '--status-json'],
      {cwd: target, encoding: 'utf8'},
    );
    assert.equal(productionStatus.status, 0, productionStatus.stderr);
    const productionStatusReport = JSON.parse(productionStatus.stdout);
    assert.equal(productionStatusReport.compatible, true);
    assert.equal(
      productionStatusReport.session.targetMatchesCwd,
      true,
    );
    assert.equal(
      productionStatusReport.productionSessionCompatible,
      true,
    );

    const second = spawnSync(
      process.execPath,
      [bootstrap, `--target=${target}`],
      {cwd: ROOT, encoding: 'utf8'},
    );
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /保留现有文件/);
  } finally {
    await fsp.rm(target, {recursive: true, force: true});
  }
});

test('bootstrap upgrades only the managed runtime and preserves user work', async () => {
  const target = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'paper-collage-plugin-upgrade-'),
  );
  const bootstrap = path.join(
    PLUGIN_ROOT,
    'scripts',
    'bootstrap-workspace.mjs',
  );
  try {
    const first = spawnSync(
      process.execPath,
      [bootstrap, `--target=${target}`],
      {cwd: ROOT, encoding: 'utf8'},
    );
    assert.equal(first.status, 0, first.stderr);

    const userProjectFile = path.join(
      target,
      'projects',
      'user-story',
      'project.json',
    );
    const userAssetFile = path.join(
      target,
      'public',
      'projects',
      'user-story',
      'hero.png',
    );
    const localProvidersFile = path.join(target, 'providers.local.json');
    await fsp.mkdir(path.dirname(userProjectFile), {recursive: true});
    await fsp.mkdir(path.dirname(userAssetFile), {recursive: true});
    await fsp.writeFile(userProjectFile, '{"owner":"user"}\n', 'utf8');
    await fsp.writeFile(userAssetFile, 'user-asset', 'utf8');
    await fsp.writeFile(
      localProvidersFile,
      '{"schemaVersion":1,"capabilities":{"text":{"defaultProvider":"custom-text"}}}\n',
      'utf8',
    );
    await fsp.writeFile(
      path.join(target, 'scripts', 'project-lib.mjs'),
      'managed runtime drift\n',
      'utf8',
    );
    const markerFile = path.join(
      target,
      '.paper-collage-video-workspace.json',
    );
    const marker = readJson(markerFile);
    marker.pluginVersion = '0.0.0-old';
    await fsp.writeFile(
      markerFile,
      `${JSON.stringify(marker, null, 2)}\n`,
      'utf8',
    );

    const blocked = spawnSync(
      process.execPath,
      [bootstrap, `--target=${target}`],
      {cwd: ROOT, encoding: 'utf8'},
    );
    assert.equal(blocked.status, 1);
    assert.match(blocked.stderr, /--upgrade/);
    const staleStatus = spawnSync(
      process.execPath,
      [bootstrap, `--target=${target}`, '--status-json'],
      {cwd: ROOT, encoding: 'utf8'},
    );
    assert.equal(staleStatus.status, 0, staleStatus.stderr);
    assert.equal(JSON.parse(staleStatus.stdout).compatible, false);

    const upgraded = spawnSync(
      process.execPath,
      [bootstrap, `--target=${target}`, '--upgrade'],
      {cwd: ROOT, encoding: 'utf8'},
    );
    assert.equal(upgraded.status, 0, upgraded.stderr);
    assert.match(upgraded.stdout, /受管运行时已升级/);
    assert.equal(
      await fsp.readFile(userProjectFile, 'utf8'),
      '{"owner":"user"}\n',
    );
    assert.equal(
      await fsp.readFile(userAssetFile, 'utf8'),
      'user-asset',
    );
    assert.equal(
      await fsp.readFile(localProvidersFile, 'utf8'),
      '{"schemaVersion":1,"capabilities":{"text":{"defaultProvider":"custom-text"}}}\n',
    );
    assert.deepEqual(
      await fsp.readFile(path.join(target, 'scripts', 'project-lib.mjs')),
      await fsp.readFile(
        path.join(RUNTIME_ROOT, 'scripts', 'project-lib.mjs'),
      ),
    );
    const upgradedMarker = readJson(markerFile);
    assert.equal(upgradedMarker.schemaVersion, 2);
    assert.equal(upgradedMarker.pluginVersion, repositoryVersion);
    assert.equal(upgradedMarker.previousPluginVersion, '0.0.0-old');
    assert.match(upgradedMarker.runtimeBuildFingerprint, /^[a-f0-9]{64}$/);
    assert.ok(
      readJson(path.join(target, 'providers.json')).capabilities.sound,
    );
    const currentStatus = spawnSync(
      process.execPath,
      [bootstrap, `--target=${target}`, '--status-json'],
      {cwd: ROOT, encoding: 'utf8'},
    );
    assert.equal(currentStatus.status, 0, currentStatus.stderr);
    assert.equal(JSON.parse(currentStatus.stdout).compatible, true);
  } finally {
    await fsp.rm(target, {recursive: true, force: true});
  }
});

test('bootstrap refuses to overwrite an unrelated non-empty directory', async () => {
  const target = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'paper-collage-plugin-foreign-'),
  );
  const bootstrap = path.join(PLUGIN_ROOT, 'scripts', 'bootstrap-workspace.mjs');
  try {
    await fsp.writeFile(path.join(target, 'user-file.txt'), 'keep me', 'utf8');
    const result = spawnSync(
      process.execPath,
      [bootstrap, `--target=${target}`],
      {cwd: ROOT, encoding: 'utf8'},
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /目标目录不是纸片视频工作区且不为空/);
    assert.equal(
      await fsp.readFile(path.join(target, 'user-file.txt'), 'utf8'),
      'keep me',
    );
  } finally {
    await fsp.rm(target, {recursive: true, force: true});
  }
});
