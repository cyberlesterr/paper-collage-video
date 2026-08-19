#!/usr/bin/env node
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import sharp from 'sharp';
import {createProductionMetrics} from './production-metrics-lib.mjs';
import {compileStoryboardDirecting} from './motion-treatment-lib.mjs';
import {createRuntimeBuildManifest} from './runtime-build-lib.mjs';
import {createAssetRecordId} from './asset-manifest-lib.mjs';
import {runCommand} from './project-lib.mjs';
import {
  loadStyleCatalog,
  materializeStyleProfile,
} from './style-catalog-lib.mjs';
import {motionLanguageCard} from './motion-contract-lib.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const PLUGIN_ROOT = path.join(ROOT, 'plugins', 'paper-collage-video');
const RUNTIME_ROOT = path.join(PLUGIN_ROOT, 'assets', 'remotion-template');
const SKILL_SOURCE = path.join(ROOT, 'skills', 'make-paper-collage-video');
const SKILL_TARGET = path.join(
  PLUGIN_ROOT,
  'skills',
  'make-paper-collage-video',
);

const copy = async (relativeSource, relativeTarget = relativeSource) => {
  const source = path.join(ROOT, relativeSource);
  const target = path.join(RUNTIME_ROOT, relativeTarget);
  await fs.mkdir(path.dirname(target), {recursive: true});
  await fs.cp(source, target, {recursive: true});
};

const writeJson = async (file, value) => {
  await fs.mkdir(path.dirname(file), {recursive: true});
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

const makeTestToneWav = ({sampleRate = 48000, seconds = 1} = {}) => {
  const channels = 1;
  const bitsPerSample = 16;
  const sampleCount = sampleRate * seconds;
  const dataSize = sampleCount * channels * (bitsPerSample / 8);
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
  buffer.writeUInt16LE(channels * (bitsPerSample / 8), 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  const amplitude = Math.round(32767 * 0.1);
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const value = Math.round(
      Math.sin((sample / sampleRate) * Math.PI * 2 * 440) * amplitude,
    );
    buffer.writeInt16LE(value, 44 + sample * 2);
  }
  return buffer;
};

const hashFile = async (file) =>
  createHash('sha256').update(await fs.readFile(file)).digest('hex');

const runtimeAssetId = (file) =>
  `runtime-${createHash('sha256').update(file).digest('hex').slice(0, 12)}`;

const sourceRuntimeBuild = await createRuntimeBuildManifest({root: ROOT});
await writeJson(path.join(ROOT, 'runtime-build.json'), sourceRuntimeBuild);

await fs.rm(RUNTIME_ROOT, {recursive: true, force: true});
await fs.rm(SKILL_TARGET, {recursive: true, force: true});
await fs.mkdir(RUNTIME_ROOT, {recursive: true});
await fs.mkdir(path.dirname(SKILL_TARGET), {recursive: true});
await fs.cp(SKILL_SOURCE, SKILL_TARGET, {recursive: true});
for (const notice of ['LICENSE', 'ASSET_LICENSES.md', 'THIRD_PARTY_NOTICES.md']) {
  await fs.copyFile(path.join(ROOT, notice), path.join(PLUGIN_ROOT, notice));
}

for (const entry of [
  '.gitignore',
  'LICENSE',
  'ASSET_LICENSES.md',
  'THIRD_PARTY_NOTICES.md',
  'package-lock.json',
  'providers.local.example.json',
  'providers.json',
  'remotion.config.ts',
  'requirements.txt',
  'runtime-build.json',
  'tsconfig.json',
  'schemas',
  'templates',
  'scripts/alpha-band-lib.mjs',
  'scripts/asset-hardening-proof-lib.mjs',
  'scripts/asset-evidence-lib.mjs',
  'scripts/asset-manifest-lib.mjs',
  'scripts/chroma-key-lib.mjs',
  'scripts/checkerboard-alpha-lib.mjs',
  'scripts/decorative-scatter-lib.mjs',
  'scripts/observed-key-plane-lib.mjs',
  'scripts/audio-preflight-lib.mjs',
  'scripts/audio-calibration-lib.mjs',
  'scripts/assets-ready-seal-lib.mjs',
  'scripts/creative-plan-lib.mjs',
  'scripts/intake-lib.mjs',
  'scripts/planning-scenario-lib.mjs',
  'scripts/style-catalog-lib.mjs',
  'scripts/composition-lib.mjs',
  'scripts/layer-source-plan-lib.mjs',
  'scripts/container-source-plan-lib.mjs',
  'scripts/layer-stack-proof-lib.mjs',
  'scripts/looping-strip-lib.mjs',
  'scripts/world-topology-proof-lib.mjs',
  'scripts/encounter-contract-lib.mjs',
  'scripts/motion-treatment-lib.mjs',
  'scripts/motion-contract-lib.mjs',
  'scripts/motion-approval-lib.mjs',
  'scripts/sound-effect-lib.mjs',
  'scripts/process-character-sheet.mjs',
  'scripts/derive-registered-family.mjs',
  'scripts/derive-semantic-slices.mjs',
  'scripts/derive-canonical-container.mjs',
  'scripts/derive-looping-strip.mjs',
  'scripts/normalize-provider-source.mjs',
  'scripts/registered-family-lib.mjs',
  'scripts/registered-geometry-lib.mjs',
  'scripts/prove-registered-geometry.mjs',
  'scripts/semantic-slices-lib.mjs',
  'scripts/canonical-container-lib.mjs',
  'scripts/process-state-sheet.mjs',
  'scripts/state-sheet-lib.mjs',
  'scripts/state-sequence-lib.mjs',
  'scripts/spatial-contract-lib.mjs',
  'scripts/python-runtime.mjs',
  'scripts/provider-lib.mjs',
  'scripts/provider-root-plan-lib.mjs',
  'scripts/generation-attempt-lib.mjs',
  'scripts/failure-circuit-lib.mjs',
  'scripts/production-metrics-lib.mjs',
  'scripts/semantic-contract-lib.mjs',
  'scripts/provider-attempt.mjs',
  'scripts/provider-request.mjs',
  'scripts/provider-recover-record.mjs',
  'scripts/provider-recover-rejected-source.mjs',
  'scripts/rejected-output-recovery-lib.mjs',
  'scripts/provider-reuse.mjs',
  'scripts/provider-select.mjs',
  'scripts/provider-record.mjs',
  'scripts/provider-run.mjs',
  'scripts/provider-status.mjs',
  'scripts/production-state.mjs',
  'scripts/directing-revision-lib.mjs',
  'scripts/directing-execution-sync-lib.mjs',
  'scripts/editorial-system-lib.mjs',
  'scripts/project-advance.mjs',
  'scripts/project-assets-ready.mjs',
  'scripts/project-audio-preflight.mjs',
  'scripts/project-audio-calibration.mjs',
  'scripts/project-asset-lifecycle.mjs',
  'scripts/project-checkpoint.mjs',
  'scripts/project-confirm-concept.mjs',
  'scripts/project-visual-blueprint.mjs',
  'scripts/project-visual-review.mjs',
  'scripts/project-intake.mjs',
  'scripts/project-composition-proof.mjs',
  'scripts/project-budget.mjs',
  'scripts/project-increase-image-budget.mjs',
  'scripts/project-doctor.mjs',
  'scripts/project-handoff-check.mjs',
  'scripts/project-failures.mjs',
  'scripts/project-friction.mjs',
  'scripts/friction-report-lib.mjs',
  'scripts/project-storyboard-scaffold.mjs',
  'scripts/storyboard-scaffold-lib.mjs',
  'scripts/project-lib.mjs',
  'scripts/contract-utils.mjs',
  'scripts/phase2-proof-lib.mjs',
  'scripts/world-motion-proof-lib.mjs',
  'scripts/prepare-phase2-proof.mjs',
  'scripts/prepare-looping-world-proof.mjs',
  'scripts/prepare-path-locomotion-proof.mjs',
  'scripts/project-metrics-run.mjs',
  'scripts/project-metrics.mjs',
  'scripts/project-new.mjs',
  'scripts/project-plan.mjs',
  'scripts/project-scenarios.mjs',
  'scripts/project-render-status.mjs',
  'scripts/project-quality.mjs',
  'scripts/project-render.mjs',
  'scripts/project-scene-preview.mjs',
  'scripts/project-stitch-narration.mjs',
  'scripts/project-report.mjs',
  'scripts/project-review-sync.mjs',
  'scripts/project-status.mjs',
  'scripts/project-storyboard.mjs',
  'scripts/project-world-topology-proof.mjs',
  'scripts/project-revise-preview-directing.mjs',
  'scripts/project-revise-preview-semantic.mjs',
  'scripts/project-sync-directing.mjs',
  'scripts/project-semantic-contracts.mjs',
  'scripts/storyboard-lib.mjs',
  'scripts/render-phase2-proof.mjs',
  'scripts/render-looping-world-proof.mjs',
  'scripts/render-path-locomotion-proof.mjs',
  'scripts/schema-v12.mjs',
  'scripts/validate_v12_schemas.py',
  'scripts/verify-phase2-proof.mjs',
  'scripts/verify-looping-world-proof.mjs',
  'scripts/verify-path-locomotion-proof.mjs',
  'scripts/verify-vox-sample.mjs',
  'scripts/prove-alpha-bands.mjs',
  'scripts/prove-registered-family.mjs',
  'scripts/prove-canonical-container.mjs',
  'scripts/vox-sample-proof-lib.mjs',
  'scripts/project-sync.mjs',
  'scripts/project-subtitles.mjs',
  'scripts/project-validate.mjs',
  'scripts/quality-lib.mjs',
  'scripts/render-cache-lib.mjs',
  'scripts/render-status-lib.mjs',
  'scripts/runtime-build-lib.mjs',
  'scripts/rasterize-assets.mjs',
  'scripts/remove_chroma_key.py',
  'scripts/split_sheet.py',
  'scripts/subtitle-lib.mjs',
  'scripts/subtitle-contract-lib.mjs',
  'scripts/timeline-continuity-lib.mjs',
  'scripts/style-motion-proof.mjs',
  'scripts/style-proof-lib.mjs',
  'scripts/visual-blueprint-lib.mjs',
  'scripts/visual-blueprint-review-lib.mjs',
  'scripts/world-trajectory-lib.mjs',
  'src/Root.tsx',
  'src/MainVideo.tsx',
  'src/EditorialNodes.tsx',
  'src/editorialPrimitives.mjs',
  'src/editorialPrimitives.d.mts',
  'src/motion.ts',
  'src/ReplicaChapterScene.tsx',
  'src/SceneTransitionOverlay.tsx',
  'src/SubtitleOverlay.tsx',
  'src/index.ts',
  'src/motifField.mjs',
  'src/motifField.d.mts',
  'src/parallax.mjs',
  'src/parallax.d.mts',
  'src/pathMotion.mjs',
  'src/pathMotion.d.mts',
  'src/worldStrip.mjs',
  'src/worldStrip.d.mts',
  'src/project.ts',
  'src/sceneTimeline.mjs',
  'src/sceneTimeline.d.mts',
  'src/subtitleSurface.mjs',
  'src/subtitleSurface.d.mts',
  'src/stateSequence.ts',
  'src/visibilityLifecycle.mjs',
  'src/visibilityLifecycle.d.mts',
  'tests/provider-and-assets.test.mjs',
  'tests/provider-root-plan.test.mjs',
  'tests/production-metrics.test.mjs',
  'tests/audio-render-cache.test.mjs',
  'tests/creative-plan.test.mjs',
  'tests/intake-and-scenarios.test.mjs',
  'tests/composition-v4.test.mjs',
  'tests/world-trajectory-contract.test.mjs',
  'tests/editorial-system-v9.test.mjs',
  'tests/canonical-container.test.mjs',
  'tests/registered-family-hardening.test.mjs',
  'tests/semantic-slices.test.mjs',
  'tests/observed-key-plane-recovery.test.mjs',
  'tests/state-sequence-v5.test.mjs',
  'tests/production-state.test.mjs',
  'tests/directing-revision.test.mjs',
  'tests/motion-contract.test.mjs',
  'tests/quality-motion-runtime.test.mjs',
  'tests/occlusion-action-facing.test.mjs',
  'tests/registered-geometry-temporal-subtitle.test.mjs',
  'tests/runtime-surface-scope.test.mjs',
  'tests/storyboard-motion.test.mjs',
  'tests/looping-world.test.mjs',
  'tests/p0-p1-hardening.test.mjs',
  'tests/checkerboard-alpha.test.mjs',
  'tests/path-locomotion.test.mjs',
  'tests/vox-primitives.test.mjs',
  'tests/vox-sample-proof.test.mjs',
  'tests/style-proof-gate.test.mjs',
  'tests/semantic-contracts-and-attempts.test.mjs',
  'tests/spatial-contract.test.mjs',
  'tests/timeline-continuity.test.mjs',
  'tests/render-continuity.test.mjs',
  'tests/visual-blueprint-circuit.test.mjs',
  'tests/visibility-scene-transition.test.mjs',
  'fixtures/composition-v4',
  'fixtures/canonical-container',
  'fixtures/starter-demo/project.json',
  'fixtures/vox-primitives',
  'fixtures/directing-revision-fixture.mjs',
  'fixtures/editorial-fixture.mjs',
  'fixtures/motion-contract-fixture.mjs',
  'fixtures/phase2-proof-fixture.mjs',
  'fixtures/looping-world-fixture.mjs',
  'fixtures/path-locomotion-fixture.mjs',
  'public/fixtures/composition-v4',
  'public/fixtures/vox-primitives',
  'public/fixtures/vox-phase2-proof',
  'public/fixtures/looping-world',
  'public/fixtures/path-locomotion',
  'public/textures/paper-grain.png',
  'public/style-catalog',
]) {
  await copy(entry);
}

const rootPackage = JSON.parse(
  await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'),
);
const workspacePackage = {
  ...rootPackage,
  name: 'paper-collage-video-workspace',
  version: rootPackage.version,
  private: true,
  engines: {node: '>=20'},
  scripts: {
    'assets:rasterize': rootPackage.scripts['assets:rasterize'],
    'assets:process-sheet': rootPackage.scripts['assets:process-sheet'],
    'assets:process-state-sheet': rootPackage.scripts['assets:process-state-sheet'],
    'assets:derive-registered-family': rootPackage.scripts['assets:derive-registered-family'],
    'assets:derive-semantic-slices': rootPackage.scripts['assets:derive-semantic-slices'],
    'assets:derive-canonical-container': rootPackage.scripts['assets:derive-canonical-container'],
    'assets:derive-looping-strip': rootPackage.scripts['assets:derive-looping-strip'],
    'assets:normalize-provider-source': rootPackage.scripts['assets:normalize-provider-source'],
    'proof:registered-family': rootPackage.scripts['proof:registered-family'],
    'proof:registered-geometry': rootPackage.scripts['proof:registered-geometry'],
    'proof:canonical-container': rootPackage.scripts['proof:canonical-container'],
    'proof:alpha-bands': rootPackage.scripts['proof:alpha-bands'],
    'provider:status': rootPackage.scripts['provider:status'],
    'provider:select': rootPackage.scripts['provider:select'],
    'provider:run': rootPackage.scripts['provider:run'],
    'provider:request': rootPackage.scripts['provider:request'],
    'provider:record': rootPackage.scripts['provider:record'],
    'provider:recover-record': rootPackage.scripts['provider:recover-record'],
    'provider:recover-rejected-source': rootPackage.scripts['provider:recover-rejected-source'],
    'provider:reuse': rootPackage.scripts['provider:reuse'],
    'provider:attempt': rootPackage.scripts['provider:attempt'],
    'project:new': rootPackage.scripts['project:new'],
    'project:intake': rootPackage.scripts['project:intake'],
    'project:scenarios': rootPackage.scripts['project:scenarios'],
    'project:plan': rootPackage.scripts['project:plan'],
    'project:storyboard': rootPackage.scripts['project:storyboard'],
    'project:world-topology-proof': rootPackage.scripts['project:world-topology-proof'],
    'project:revise-preview-directing': rootPackage.scripts['project:revise-preview-directing'],
    'project:revise-preview-semantic': rootPackage.scripts['project:revise-preview-semantic'],
    'project:semantic-contracts': rootPackage.scripts['project:semantic-contracts'],
    'project:confirm-concept': rootPackage.scripts['project:confirm-concept'],
    'project:visual-blueprint': rootPackage.scripts['project:visual-blueprint'],
    'project:visual-review': rootPackage.scripts['project:visual-review'],
    'project:quality': rootPackage.scripts['project:quality'],
    'project:composition-proof': rootPackage.scripts['project:composition-proof'],
    'project:metrics': rootPackage.scripts['project:metrics'],
    'project:budget': rootPackage.scripts['project:budget'],
    'project:increase-image-budget': rootPackage.scripts['project:increase-image-budget'],
    'project:resume': rootPackage.scripts['project:resume'],
    'project:status': rootPackage.scripts['project:status'],
    'project:handoff-check': rootPackage.scripts['project:handoff-check'],
    'project:failures': rootPackage.scripts['project:failures'],
    'project:friction': rootPackage.scripts['project:friction'],
    'project:storyboard-scaffold': rootPackage.scripts['project:storyboard-scaffold'],
    'project:checkpoint': rootPackage.scripts['project:checkpoint'],
    'project:asset-lifecycle': rootPackage.scripts['project:asset-lifecycle'],
    'project:review-sync': rootPackage.scripts['project:review-sync'],
    'project:advance': rootPackage.scripts['project:advance'],
    'project:assets-ready': rootPackage.scripts['project:assets-ready'],
    'project:audio-preflight': rootPackage.scripts['project:audio-preflight'],
    'project:audio-calibration': rootPackage.scripts['project:audio-calibration'],
    'project:stitch-narration': rootPackage.scripts['project:stitch-narration'],
    'project:sync': rootPackage.scripts['project:sync'],
    'project:sync-directing': rootPackage.scripts['project:sync-directing'],
    'project:subtitles': rootPackage.scripts['project:subtitles'],
    'project:validate': rootPackage.scripts['project:validate'],
    'project:preview': rootPackage.scripts['project:preview'],
    'project:scene-preview': rootPackage.scripts['project:scene-preview'],
    'project:render': rootPackage.scripts['project:render'],
    'project:render-status': rootPackage.scripts['project:render-status'],
    'project:report': rootPackage.scripts['project:report'],
    'project:style-proof': rootPackage.scripts['project:style-proof'],
    doctor: 'node scripts/project-doctor.mjs',
    'sample:vox': rootPackage.scripts['sample:vox'],
    'sample:vox:verify': rootPackage.scripts['sample:vox:verify'],
    'proof:phase2:prepare': rootPackage.scripts['proof:phase2:prepare'],
    'proof:phase2:render': rootPackage.scripts['proof:phase2:render'],
    'proof:phase2:verify': rootPackage.scripts['proof:phase2:verify'],
    'proof:phase2': rootPackage.scripts['proof:phase2'],
    'proof:looping-world:prepare': rootPackage.scripts['proof:looping-world:prepare'],
    'proof:looping-world:render': rootPackage.scripts['proof:looping-world:render'],
    'proof:looping-world:verify': rootPackage.scripts['proof:looping-world:verify'],
    'proof:looping-world': rootPackage.scripts['proof:looping-world'],
    'proof:path-locomotion:prepare': rootPackage.scripts['proof:path-locomotion:prepare'],
    'proof:path-locomotion:render': rootPackage.scripts['proof:path-locomotion:render'],
    'proof:path-locomotion:verify': rootPackage.scripts['proof:path-locomotion:verify'],
    'proof:path-locomotion': rootPackage.scripts['proof:path-locomotion'],
    'schema:v12': rootPackage.scripts['schema:v12'],
    dev: 'remotion studio src/index.ts --props=projects/starter-demo/project.json',
    check: rootPackage.scripts.check,
    bundle: rootPackage.scripts.bundle,
    test: rootPackage.scripts.test,
    render: 'npm run project:render -- starter-demo',
    'render:preview': 'npm run project:preview -- starter-demo',
  },
};
await writeJson(path.join(RUNTIME_ROOT, 'package.json'), workspacePackage);

const packagedRuntimeBuild = await createRuntimeBuildManifest({root: RUNTIME_ROOT});
if (packagedRuntimeBuild.fingerprint !== sourceRuntimeBuild.fingerprint) {
  throw new Error(`packaged runtime fingerprint drift: source=${sourceRuntimeBuild.fingerprint} package=${packagedRuntimeBuild.fingerprint}`);
}
await writeJson(path.join(RUNTIME_ROOT, 'runtime-build.json'), packagedRuntimeBuild);

const pluginManifestFile = path.join(PLUGIN_ROOT, '.codex-plugin', 'plugin.json');
const pluginManifest = JSON.parse(await fs.readFile(pluginManifestFile, 'utf8'));
pluginManifest.version = rootPackage.version;
await writeJson(pluginManifestFile, pluginManifest);

const lock = JSON.parse(
  await fs.readFile(path.join(RUNTIME_ROOT, 'package-lock.json'), 'utf8'),
);
lock.name = workspacePackage.name;
lock.version = workspacePackage.version;
lock.packages[''].name = workspacePackage.name;
lock.packages[''].version = workspacePackage.version;
lock.packages[''].license = workspacePackage.license;
await writeJson(path.join(RUNTIME_ROOT, 'package-lock.json'), lock);

const starterToneBuffer = makeTestToneWav();
const starterToneSha256 = createHash('sha256').update(starterToneBuffer).digest('hex');
const starterEditorial = {
  timebase: {fps: 30, rounding: 'nearest'},
  wordTimingPolicy: 'phrase-fallback',
  media: [{
    id: 'starter-narration',
    kind: 'narration',
    src: 'projects/starter-demo/audio/narration/01-test-tone.wav',
    sha256: starterToneSha256,
    durationSeconds: 1,
    timelineMode: 'scene-local',
    timingDataSrc: 'projects/starter-demo/audio/narration/01-test-tone.timing.json',
  }],
  cues: [
    {id: 'starter-open-cue', kind: 'narration-phrase', source: 'detected', timingBasis: 'actual-audio', mediaId: 'starter-narration', sceneId: 'starter', atSeconds: 0.08, priority: 70, toleranceSeconds: 0.04},
    {id: 'starter-action-cue', kind: 'semantic-emphasis', source: 'authored', timingBasis: 'actual-audio', mediaId: 'starter-narration', sceneId: 'starter', atSeconds: 0.5, priority: 90, toleranceSeconds: 0.04},
    {id: 'starter-final-cue', kind: 'sentence', source: 'detected', timingBasis: 'actual-audio', mediaId: 'starter-narration', sceneId: 'starter', atSeconds: 0.9, priority: 80, toleranceSeconds: 0.04},
  ],
  editPoints: [
    {id: 'starter-open', cueIds: ['starter-open-cue'], conflictPolicy: 'highest-priority'},
    {id: 'starter-action', cueIds: ['starter-action-cue'], conflictPolicy: 'highest-priority'},
    {id: 'starter-final', cueIds: ['starter-final-cue'], conflictPolicy: 'highest-priority'},
  ],
  bindings: [
    {id: 'starter-action-binding', sceneId: 'starter', targetType: 'graphic-action', targetId: 'traveler', editPointId: 'starter-action', mode: 'element'},
  ],
  responsiveProfiles: [
    {id: '16:9', width: 1920, height: 1080, safeArea: {x: 0.06, y: 0.06, width: 0.88, height: 0.88}, densityBudget: 8, typographyScale: 1, parallaxScale: 1, exclusionZones: []},
    {id: '9:16', width: 1080, height: 1920, safeArea: {x: 0.08, y: 0.05, width: 0.84, height: 0.9}, densityBudget: 6, typographyScale: 0.92, parallaxScale: 0.72, exclusionZones: []},
    {id: '1:1', width: 1080, height: 1080, safeArea: {x: 0.07, y: 0.07, width: 0.86, height: 0.86}, densityBudget: 7, typographyScale: 0.96, parallaxScale: 0.86, exclusionZones: []},
  ],
  sceneDirecting: [{
    sceneId: 'starter',
    compositionProfile: 'starter-balanced',
    typographyProfile: 'editorial-default',
    subjectFraming: {mode: 'contain', focusPoint: {x: 0.5, y: 0.5}},
    placements: [],
  }],
  transitions: [],
  activeProfile: '16:9',
};

const starterStyleProfile = materializeStyleProfile(
  await loadStyleCatalog(),
  'childrens-picture-book-paper',
);
const project = {
  $schema: '../../schemas/project.schema.json',
  schemaVersion: 12,
  slug: 'starter-demo',
  title: 'Paper Collage Starter',
  intake: {
    schemaVersion: 2,
    status: 'confirmed',
    aspectRatio: '16:9',
    visualStylePreset: starterStyleProfile.id,
    parallaxPreference: 'auto',
    styleCatalogVersion: starterStyleProfile.catalogVersion,
    styleCatalogFingerprint: starterStyleProfile.catalogFingerprint,
    styleProfileFingerprint: starterStyleProfile.profileFingerprint,
    confirmedAt: '2026-01-01T00:00:00.000Z',
    note: 'Bundled fixture',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  styleProfile: starterStyleProfile,
  motionContract: null,
  plan: {
    schemaVersion: 4,
    slug: 'starter-demo',
    status: 'resolved',
    inputMode: 'both',
    productionProfile: 'draft',
    assetBudget: {
      backgrounds: 1,
      environmentLayers: 1,
      characterSheets: 1,
      styleSamples: 1,
      baseImageAttempts: 4,
      layerPackageAttemptReserve: 2,
      maxGeneratedImages: 6,
    },
    motionBudget: {
      maxPoseSheetCalls: 1,
      maxStatesPerSheet: 4,
      maxContinuousTargets: 2,
    },
    approvedImageBudget: {
      imageAttemptLimit: 1,
      expectedProviderImageCalls: 0,
      profileHardCeiling: 6,
      approvedAt: '2026-01-01T00:00:00.000Z',
    },
    requested: {durationSeconds: 1.2, sceneCount: 1},
    resolved: {
      durationSeconds: 1.2,
      sceneCount: 1,
      estimatedNarrationSeconds: 1,
      rationale: 'Bundled technical fixture',
      resolvedAt: '2026-01-01T00:00:00.000Z',
    },
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  quality: {minimumAssetScale: 0.5},
  video: {width: 1920, height: 1080, fps: 30},
  theme: structuredClone(starterStyleProfile.render.theme),
  voice: {mode: 'fictional', provider: 'fixture', displayName: 'Test tone fixture'},
  audio: {
    narration: {volume: 1},
    music: null,
    mastering: {targetLufs: -24, toleranceLufs: 3, truePeakDbtp: -18},
  },
  scenes: [
    {
      id: 'starter',
      label: '纸片分层视频',
      eyebrow: 'STARTER',
      tailSeconds: 0.2,
      motion: {
        blueprint: 'layered-reveal',
        intensity: 0.7,
        seed: 17,
        proofTimes: [
          {id: 'proof-establish', at: 0.08, label: '建立纸面空间', kind: 'establish', assertions: ['背景完整建立'], stateAssertions: []},
          {id: 'proof-action', at: 0.62, label: '主体进入画面', kind: 'peak', assertions: ['主体位于画面中央'], stateAssertions: []},
          {id: 'proof-final', at: 0.9, label: '标题与主体稳定', kind: 'final', assertions: ['主体与标题构图稳定'], stateAssertions: []},
        ],
      },
      composition: {
        coordinateSpace: {width: 1920, height: 1080},
        nodes: [
          {
            id: 'background',
            kind: 'asset',
            assetRole: 'background',
            src: 'projects/starter-demo/assets/plates/01-bg.png',
            z: 0,
            transform: {x: 0, y: 0, width: 1, height: 1, anchorX: 0, anchorY: 0},
            motion: {keyframes: [{at: 0, scale: 1}, {at: 1, scale: 1.015, ease: 'ease-in-out'}]},
          },
          {
            id: 'traveler',
            kind: 'asset',
            assetRole: 'character',
            src: 'projects/starter-demo/assets/characters/alpha/01-traveler.png',
            z: 4,
            visibility: {initial: 'hidden'},
            transform: {x: 0, y: 0, width: 1, height: 1, anchorX: 0, anchorY: 0},
            motion: {
              idle: {preset: 'breathe', intensity: 0.5, cycleSeconds: 2.8},
              keyframes: [
                {at: 0, offsetX: -0.01, opacity: 0.72, ease: 'ease-out'},
                {at: 0.5, offsetX: 0.003, scale: 1.03, opacity: 1, ease: 'ease-in-out'},
                {at: 1, offsetX: 0, scale: 1, opacity: 1, ease: 'ease-out'},
              ],
            },
          },
        ],
      },
      camera: {preset: 'push', intensity: 0.6},
      narration: {
        src: 'projects/starter-demo/audio/narration/01-test-tone.wav',
        startSeconds: 0,
        durationSeconds: 1,
        text: '纸片分层视频',
      },
      subtitles: [{fromSeconds: 0, toSeconds: 1, text: '纸片分层视频'}],
      events: [
        {id: 'establish', beatId: 'establish', proofTimeId: 'proof-establish', at: 0, targetId: 'background', visual: {kind: 'emphasis', action: 'pulse', durationSeconds: 0.35, intensity: 0.35}},
        {id: 'subject-arrives', beatId: 'subject-arrives', proofTimeId: 'proof-action', at: 0.5, targetId: 'traveler', visual: {kind: 'visibility', action: 'show', transition: 'fade-rise', durationSeconds: 0.5}},
        {id: 'lockup', beatId: 'lockup', proofTimeId: 'proof-final', at: 0.9, targetId: 'traveler', visual: {kind: 'emphasis', action: 'settle', durationSeconds: 0.1, intensity: 0.55}},
      ],
    },
  ],
  sceneTransitions: [],
};

const storyboard = compileStoryboardDirecting({
  $schema: '../../schemas/storyboard.schema.json',
  schemaVersion: 12,
  slug: 'starter-demo',
  status: 'ready',
  arc: '从空纸面建立分层空间，再让主体进入并稳定成标题画面。',
  style: {
    visualThesis: '以可见纸张深度和克制动作证明可编辑的拼贴空间。',
    compositionRules: ['主体保持在字幕安全区上方', '前中后景至少形成两个深度层次'],
    layerStrategy: '背景承载空间，透明主体承载动作，前景纸片负责压边。',
  },
  motionDirection: {
    schemaVersion: 1,
    summary: '先建立纸面空间，再让主体完成清晰动作，最后留出可读稳定段。',
    pacing: 'gentle',
    performance: {
      grammar: ['establish', 'action', 'settle'],
      anticipation: 'selective',
      followThrough: 'selective',
      poseStrategy: 'mixed',
      minimumFinalHoldRatio: 0.1,
    },
    camera: {strategy: 'motivated'},
    transitions: {strategy: 'story-led'},
    ambient: {strategy: 'selective'},
    styleDeviationRationale: null,
  },
  editorial: starterEditorial,
  scenes: [
    {
      id: 'starter',
      title: '纸片分层视频',
      narrativeRole: '开场与能力证明',
      message: '纸拼贴镜头由有节奏的分层运动构成。',
      blueprint: 'layered-reveal',
      estimatedDurationSeconds: 1.2,
      beats: [
        {id: 'establish', at: 0, performanceRole: 'establish', purpose: '建立空间', visual: '纸面与背景出现', soundCue: null, proofTimeId: 'proof-establish', treatments: [{id: 'establish-scene', targetId: 'background', importance: 'supporting', necessity: 'required', changeClass: 'static-hold', motion: {kind: 'static'}, composition: {pattern: 'free'}, graphic: null, semanticRisk: 'decorative', proofTimeId: 'proof-establish', rationale: '先建立稳定纸面空间。'}]},
        {id: 'subject-arrives', at: 0.5, performanceRole: 'action', purpose: '交付主体', visual: '人物纸片进入中心', soundCue: null, proofTimeId: 'proof-action', treatments: [{id: 'show-traveler', targetId: 'traveler', importance: 'hero', necessity: 'required', changeClass: 'visibility-change', motion: {kind: 'visibility-transition', action: 'show', transition: 'fade-rise', durationSeconds: 0.5}, composition: {pattern: 'free'}, graphic: null, semanticRisk: 'decorative', proofTimeId: 'proof-action', rationale: '主体从明确的隐藏状态持续出现，并在事件后保持可见。'}]},
        {id: 'lockup', at: 0.9, performanceRole: 'settle', purpose: '稳定结论', visual: '人物与标题形成锁定构图', soundCue: null, proofTimeId: 'proof-final', treatments: [{id: 'hold-lockup', targetId: 'traveler', importance: 'supporting', necessity: 'required', changeClass: 'static-hold', motion: {kind: 'static'}, composition: {pattern: 'free'}, graphic: null, semanticRisk: 'decorative', proofTimeId: 'proof-final', rationale: '结尾保持构图稳定。'}]},
      ],
      proofTimes: [
        {id: 'proof-establish', at: 0.08, label: '建立纸面空间', kind: 'establish', assertions: ['背景完整建立'], stateAssertions: []},
        {id: 'proof-action', at: 0.62, label: '主体进入画面', kind: 'peak', assertions: ['主体位于画面中央'], stateAssertions: []},
        {id: 'proof-final', at: 0.9, label: '标题与主体稳定', kind: 'final', assertions: ['主体与标题构图稳定'], stateAssertions: []},
      ],
    },
  ],
  sceneTransitions: [],
  updatedAt: '2026-01-01T00:00:00.000Z',
}, {plan: project.plan, styleProfile: project.styleProfile});
project.motionContract = storyboard.motionContract;
project.editorial = storyboard.editorial;
await writeJson(
  path.join(RUNTIME_ROOT, 'projects', 'starter-demo', 'project.json'),
  project,
);
await writeJson(
  path.join(RUNTIME_ROOT, 'projects', 'starter-demo', 'storyboard.json'),
  storyboard,
);
await writeJson(
  path.join(RUNTIME_ROOT, 'projects', 'starter-demo', 'motion-language-card.json'),
  motionLanguageCard(storyboard.motionContract),
);

const at = '2026-01-01T00:00:00.000Z';
const production = {
  $schema: '../../schemas/production.schema.json',
  schemaVersion: 1,
  slug: 'starter-demo',
  stage: 'complete',
  createdAt: at,
  updatedAt: at,
  approvals: Object.fromEntries(
    ['concept', 'styleAndVoice', 'preview', 'publish'].map((key) => [
      key,
      {status: 'approved', decidedAt: at, note: 'Bundled fixture'},
    ]),
  ),
  workItems: [],
  artifacts: {
    brief: 'projects/starter-demo/brief.md',
    project: 'projects/starter-demo/project.json',
    storyboard: 'projects/starter-demo/storyboard.json',
    prompts: 'projects/starter-demo/prompts.json',
    review: 'projects/starter-demo/review.md',
    motionLanguageCard: 'projects/starter-demo/motion-language-card.json',
    motionApproval: 'projects/starter-demo/motion-approval.json',
    visualBlueprint: null,
    visualBlueprintApproval: null,
    validationReport: null,
    assetsReadySeal: null,
    preview: null,
    final: null,
    report: null,
    contactSheet: null,
  },
  history: [{at, action: 'fixture-created', stage: 'complete', note: ''}],
};
await writeJson(
  path.join(RUNTIME_ROOT, 'projects', 'starter-demo', 'production.json'),
  production,
);
await writeJson(
  path.join(RUNTIME_ROOT, 'projects', 'starter-demo', 'production-metrics.json'),
  createProductionMetrics({slug: 'starter-demo', createdAt: at}),
);
await writeJson(
  path.join(RUNTIME_ROOT, 'projects', 'starter-demo', 'prompts.json'),
  {imageModel: 'fixture', assets: []},
);
await writeJson(
  path.join(RUNTIME_ROOT, 'projects', 'starter-demo', 'providers.json'),
  {$schema: '../../schemas/providers.schema.json', schemaVersion: 1},
);
await fs.writeFile(
  path.join(RUNTIME_ROOT, 'projects', 'starter-demo', 'brief.md'),
  '# 项目简报：Paper Collage Starter\n\n这是插件自带的轻量技术样例。\n',
  'utf8',
);
await fs.writeFile(
  path.join(RUNTIME_ROOT, 'projects', 'starter-demo', 'review.md'),
  '# 验收记录：Paper Collage Starter\n\n- Bundled fixture\n',
  'utf8',
);
const starterRequests = path.join(
  RUNTIME_ROOT,
  'projects',
  'starter-demo',
  'requests',
);
await fs.mkdir(starterRequests, {recursive: true});
await fs.writeFile(path.join(starterRequests, '.gitkeep'), '', 'utf8');
await fs.writeFile(
  path.join(RUNTIME_ROOT, 'projects', 'starter-demo', 'failure-circuit.jsonl'),
  '',
  'utf8',
);

await copy(
  'fixtures/starter-demo/01-bg.png',
  'public/projects/starter-demo/assets/plates/01-bg.png',
);
await copy(
  'fixtures/starter-demo/01-traveler.png',
  'public/projects/starter-demo/assets/characters/alpha/01-traveler.png',
);
const starterStyleSampleRelative =
  'public/projects/starter-demo/assets/characters/alpha/01-traveler.png';
const starterStyleSampleFile = path.join(
  RUNTIME_ROOT,
  starterStyleSampleRelative,
);
const starterStyleSampleSha256 = await hashFile(starterStyleSampleFile);
const starterStyleSampleStat = await fs.stat(starterStyleSampleFile);
const starterStyleSampleMedia = await sharp(
  starterStyleSampleFile,
).metadata();
const starterStyleRequest = {
  quality: {
    kind: 'style-sample',
    requiredChecks: [
      'no-text',
      'no-watermark',
      'subject-complete',
      'style-consistent',
    ],
  },
};
const starterStyleRequestFingerprint = createHash('sha256')
  .update(JSON.stringify(starterStyleRequest))
  .digest('hex');
await writeJson(
  path.join(RUNTIME_ROOT, 'projects', 'starter-demo', 'assets-manifest.json'),
  {
    $schema: '../../schemas/assets-manifest.schema.json',
    schemaVersion: 4,
    projectSlug: 'starter-demo',
    assets: [
      {
        recordId: createAssetRecordId({
          assetId: 'starter-style-sample',
          requestFingerprint: starterStyleRequestFingerprint,
          sha256: starterStyleSampleSha256,
          recordedAt: at,
        }),
        assetId: 'starter-style-sample',
        capability: 'image',
        file: starterStyleSampleRelative,
        provider: 'fixture',
        adapter: 'manual',
        requestFingerprint: starterStyleRequestFingerprint,
        reusedFrom: null,
        sha256: starterStyleSampleSha256,
        sizeBytes: starterStyleSampleStat.size,
        media: {
          width: starterStyleSampleMedia.width,
          height: starterStyleSampleMedia.height,
          format: starterStyleSampleMedia.format ?? null,
          hasAlpha: starterStyleSampleMedia.hasAlpha === true,
        },
        recordedAt: at,
        request: starterStyleRequest,
        compositionBinding: null,
        familyFingerprint: null,
        lifecycle: {
          status: 'active',
          changedAt: at,
          reason: 'Bundled story-specific style fixture',
          supersededBy: null,
        },
      },
    ],
  },
);
const narrationFile = path.join(
  RUNTIME_ROOT,
  'public',
  'projects',
  'starter-demo',
  'audio',
  'narration',
  '01-test-tone.wav',
);
await fs.mkdir(path.dirname(narrationFile), {recursive: true});
await fs.writeFile(narrationFile, starterToneBuffer);
await fs.writeFile(
  path.join(path.dirname(narrationFile), '01-test-tone.timing.json'),
  `${JSON.stringify({
    schemaVersion: 1,
    mediaSha256: starterToneSha256,
    durationSeconds: 1,
    cues: starterEditorial.cues.map(({id, kind, atSeconds}) => ({
      id,
      kind,
      atSeconds,
    })),
  }, null, 2)}\n`,
  'utf8',
);

const fixtureQualityAssets = [
  {
    file: 'public/projects/starter-demo/assets/plates/01-bg.png',
    kind: 'background',
    source: 'scene:starter:node:background',
    checks: ['no-text', 'no-watermark', 'no-people', 'safe-area-clear', 'style-consistent'],
  },
  {
    file: 'public/projects/starter-demo/assets/characters/alpha/01-traveler.png',
    kind: 'character',
    source: 'scene:starter:node:traveler',
    checks: ['subject-complete', 'identity-consistent', 'edge-clean', 'style-consistent'],
  },
];
await writeJson(
  path.join(RUNTIME_ROOT, 'projects', 'starter-demo', 'quality-report.json'),
  {
    $schema: '../../schemas/quality-report.schema.json',
    schemaVersion: 7,
    projectSlug: 'starter-demo',
    updatedAt: at,
    styleProfile: null,
    motionContract: null,
    reviewSurfaceFingerprint:
      '0000000000000000000000000000000000000000000000000000000000000000',
    eventTimeline: [],
    assetHistory: [],
    assets: await Promise.all(
      fixtureQualityAssets.map(async ({file, kind, source, checks}) => ({
        assetId: runtimeAssetId(file),
        file,
        kind,
        sources: [source],
        sha256: await hashFile(path.join(RUNTIME_ROOT, file)),
        requiredChecks: checks,
        technical: {passed: true, checks: []},
        semanticChecks: Object.fromEntries(checks.map((check) => [check, 'passed'])),
        status: 'passed',
        reviewer: 'human:bundled-fixture',
        reviewedAt: at,
        note: 'Repository-owned technical fixture',
      })),
    ),
    composites: [],
  },
);

const starterProofDirectory = path.join(
  RUNTIME_ROOT,
  'dist',
  'starter-demo',
  'composition-proof',
);
const starterProofFrameDirectory = path.join(starterProofDirectory, 'frames');
await fs.mkdir(starterProofFrameDirectory, {recursive: true});
const backgroundFile = path.join(
  RUNTIME_ROOT,
  'public',
  'projects',
  'starter-demo',
  'assets',
  'plates',
  '01-bg.png',
);
const travelerFile = path.join(
  RUNTIME_ROOT,
  'public',
  'projects',
  'starter-demo',
  'assets',
  'characters',
  'alpha',
  '01-traveler.png',
);
const [backgroundData, travelerData] = await Promise.all([
  fs.readFile(backgroundFile),
  fs.readFile(travelerFile),
]);
const starterProofSvg = (offsetPx = 0) => [
  '<svg xmlns="http://www.w3.org/2000/svg"',
  ` width="${project.video.width}"`,
  ` height="${project.video.height}"`,
  ` viewBox="0 0 ${project.video.width} ${project.video.height}">`,
  `<g transform="translate(${offsetPx} 0)">`,
  `<image href="data:image/png;base64,${backgroundData.toString('base64')}"`,
  ` width="${project.video.width}" height="${project.video.height}"/>`,
  `<image href="data:image/png;base64,${travelerData.toString('base64')}"`,
  ` width="${project.video.width}" height="${project.video.height}"/>`,
  '</g>',
  '</svg>\n',
].join('');
const starterProofFiles = new Map();
for (const [index, proof] of project.scenes[0].motion.proofTimes.entries()) {
  const file = path.join(starterProofFrameDirectory, `${proof.id}.svg`);
  await fs.writeFile(file, starterProofSvg(index * 120), 'utf8');
  starterProofFiles.set(proof.id, path.relative(RUNTIME_ROOT, file));
}

const runtimeProjectLib = await import(
  `${pathToFileURL(path.join(RUNTIME_ROOT, 'scripts', 'project-lib.mjs')).href}?sync=${Date.now()}`,
);
const runtimeQualityLib = await import(
  `${pathToFileURL(path.join(RUNTIME_ROOT, 'scripts', 'quality-lib.mjs')).href}?sync=${Date.now()}`,
);
const runtimeVisualBlueprintLib = await import(
  `${pathToFileURL(path.join(RUNTIME_ROOT, 'scripts', 'visual-blueprint-lib.mjs')).href}?sync=${Date.now()}`,
);
const runtimeVisualBlueprintReviewLib = await import(
  `${pathToFileURL(path.join(RUNTIME_ROOT, 'scripts', 'visual-blueprint-review-lib.mjs')).href}?sync=${Date.now()}`,
);
const runtimeMotionApprovalLib = await import(
  `${pathToFileURL(path.join(RUNTIME_ROOT, 'scripts', 'motion-approval-lib.mjs')).href}?sync=${Date.now()}`,
);
const {project: starterRuntimeProject} = await runtimeProjectLib.loadProject(
  'starter-demo',
);
const starterTargets = await runtimeQualityLib.collectCompositeQualityTargets(
  starterRuntimeProject,
);
const starterProofFramesForTarget = (target) =>
  target.proofTimeIds.map((proofTimeId) => {
    const proof = project.scenes[0].motion.proofTimes.find(
      ({id}) => id === proofTimeId,
    );
    const file = starterProofFiles.get(proofTimeId);
    return {
      sceneId: target.sceneId,
      proofTimeId,
      absoluteFrame: Math.round(
        proof.at *
          (project.video.fps * project.plan.resolved.durationSeconds - 1),
      ),
      frameFingerprint: `bundled-${proofTimeId}`,
      fullFrame: file,
      crop: file,
      debugFrame: file,
      bounds: {
        left: 0,
        top: 0,
        width: project.video.width,
        height: project.video.height,
      },
    };
  });
const starterTemporalEvidenceForTarget = async (target) => {
  const frames = [];
  for (const proofTimeId of target.proofTimeIds) {
    const proof = project.scenes[0].motion.proofTimes.find(
      ({id}) => id === proofTimeId,
    );
    const file = starterProofFiles.get(proofTimeId);
    if (!file) continue;
    frames.push({
      at: proof?.at ?? null,
      file,
      sha256: await hashFile(path.join(RUNTIME_ROOT, file)),
    });
  }
  if (frames.length < 3) return null;
  const safeId = target.compositeId
    .replace(/[^a-z0-9-]+/gi, '-')
    .toLowerCase();
  const stripFile = path.join(
    starterProofDirectory,
    'temporal',
    `${safeId}-motion-strip.jpg`,
  );
  await fs.mkdir(path.dirname(stripFile), {recursive: true});
  const panels = await Promise.all(
    frames.slice(0, 8).map(async ({at, file}, index) => {
      const image = await sharp(path.join(RUNTIME_ROOT, file))
        .resize(360, 203, {fit: 'cover'})
        .jpeg()
        .toBuffer();
      const label = Buffer.from(
        `<svg width="360" height="40" xmlns="http://www.w3.org/2000/svg">` +
          `<rect width="100%" height="100%" fill="#1c1714"/>` +
          `<text x="12" y="27" fill="#f6ead2" font-size="17" font-family="Arial, PingFang SC, sans-serif">${String(at ?? index).replace(/[<>&]/g, '')}</text></svg>`,
      );
      return {image, label};
    }),
  );
  const stripWidth = panels.length * 360;
  const stripHeight = 243;
  await sharp({
    create: {
      width: stripWidth,
      height: stripHeight,
      channels: 3,
      background: '#100d0b',
    },
  })
    .composite(
      panels.flatMap(({image, label}, index) => [
        {input: label, left: index * 360, top: 0},
        {input: image, left: index * 360, top: 40},
      ]),
    )
    .jpeg({quality: 90})
    .toFile(stripFile);
  return {
    file: path.relative(RUNTIME_ROOT, stripFile),
    sha256: await hashFile(stripFile),
    frames,
  };
};
await writeJson(path.join(starterProofDirectory, 'report.json'), {
  schemaVersion: 2,
  projectSlug: 'starter-demo',
  generatedAt: at,
  frames: project.scenes[0].motion.proofTimes.map((proof) => ({
    sceneId: 'starter',
    proofTimeId: proof.id,
    absoluteFrame: Math.round(
      proof.at * (project.video.fps * project.plan.resolved.durationSeconds - 1),
    ),
    fingerprint: `bundled-${proof.id}`,
    file: starterProofFiles.get(proof.id),
  })),
  composites: await Promise.all(starterTargets.map(async (target) => ({
    compositeId: target.compositeId,
    sceneId: target.sceneId,
    pattern: target.pattern,
    fingerprint: target.fingerprint,
    proofFrames: starterProofFramesForTarget(target),
    temporalEvidence: await starterTemporalEvidenceForTarget(target),
  }))),
  assetEvidence: [],
  cache: {
    frames: {reused: 0, rendered: 3},
    composites: {reused: 0, generated: starterTargets.length},
    evidence: {reused: 0, generated: 0},
  },
});

const starterBlueprintDirectory = path.join(
  RUNTIME_ROOT,
  'dist',
  'starter-demo',
  'visual-blueprint',
);
const starterBlueprintKeyframes = path.join(
  starterBlueprintDirectory,
  'keyframes',
);
const starterBlueprintClips = path.join(
  starterBlueprintDirectory,
  'motion-clips',
);
await fs.mkdir(starterBlueprintKeyframes, {recursive: true});
await fs.mkdir(starterBlueprintClips, {recursive: true});
const starterBlueprintSamples = [
  ['start', 'proof-establish'],
  ['middle', 'proof-action'],
  ['end', 'proof-final'],
];
const starterBlueprintFrameFiles = {};
for (const [phase, proofTimeId] of starterBlueprintSamples) {
  const file = path.join(
    starterBlueprintKeyframes,
    `starter-${phase}.jpg`,
  );
  await sharp(path.join(RUNTIME_ROOT, starterProofFiles.get(proofTimeId)))
    .resize(480, 270, {fit: 'cover'})
    .jpeg({quality: 86, chromaSubsampling: '4:4:4'})
    .toFile(file);
  starterBlueprintFrameFiles[phase] = path
    .relative(RUNTIME_ROOT, file)
    .split(path.sep)
    .join('/');
}
const starterBlueprintContactSheet = path.join(
  starterBlueprintDirectory,
  'scene-keyframes.jpg',
);
await sharp({
  create: {
    width: 1440,
    height: 324,
    channels: 3,
    background: project.theme.canvas,
  },
})
  .composite([
    {
      input: Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="54">` +
          `<rect width="100%" height="100%" fill="${project.theme.canvas}"/>` +
          `<text x="18" y="36" font-family="Arial, sans-serif" font-size="26" font-weight="700" fill="${project.theme.subtitle}">Starter · 开头 / 中间 / 结尾</text>` +
          '</svg>',
      ),
      left: 0,
      top: 0,
    },
    ...starterBlueprintSamples.map(([phase], index) => ({
      input: path.join(
        RUNTIME_ROOT,
        starterBlueprintFrameFiles[phase],
      ),
      left: index * 480,
      top: 54,
    })),
  ])
  .jpeg({quality: 88, chromaSubsampling: '4:4:4'})
  .toFile(starterBlueprintContactSheet);
const starterBlueprintStyleFrame = path.join(
  starterBlueprintDirectory,
  'style-frame.jpg',
);
await fs.copyFile(
  path.join(RUNTIME_ROOT, starterBlueprintFrameFiles.middle),
  starterBlueprintStyleFrame,
);
const starterBlueprintAnimatic = path.join(
  starterBlueprintDirectory,
  'animatic.mp4',
);
await runCommand(
  'ffmpeg',
  [
    '-y',
    '-v',
    'error',
    '-loop',
    '1',
    '-framerate',
    '30',
    '-i',
    path.join(RUNTIME_ROOT, starterBlueprintFrameFiles.middle),
    '-t',
    '1.2',
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '32',
    '-pix_fmt',
    'yuv420p',
    '-map_metadata',
    '-1',
    '-fflags',
    '+bitexact',
    '-flags:v',
    '+bitexact',
    starterBlueprintAnimatic,
  ],
  {cwd: RUNTIME_ROOT},
);
const starterBlueprintMotionClip = path.join(
  starterBlueprintClips,
  'starter.mp4',
);
await fs.copyFile(starterBlueprintAnimatic, starterBlueprintMotionClip);
const starterBlueprintRelative = (file) =>
  path.relative(RUNTIME_ROOT, file).split(path.sep).join('/');
const starterBlueprintArtifactFiles = [
  starterBlueprintRelative(starterBlueprintAnimatic),
  starterBlueprintRelative(starterBlueprintContactSheet),
  starterBlueprintRelative(starterBlueprintStyleFrame),
  ...Object.values(starterBlueprintFrameFiles),
  starterBlueprintRelative(starterBlueprintMotionClip),
];
const starterBlueprintReport = {
  $schema: '../../../schemas/visual-blueprint.schema.json',
  schemaVersion: 2,
  projectSlug: 'starter-demo',
  generatedAt: at,
  status: 'awaiting-human',
  reviewMode: 'single-human-visual-decision',
  source: {
    project: 'projects/starter-demo/project.json',
    storyboard: 'projects/starter-demo/storyboard.json',
    contract:
      runtimeVisualBlueprintLib.createVisualBlueprintContract(
        starterRuntimeProject,
      ),
  },
  visualContractFingerprint:
    runtimeVisualBlueprintLib.visualBlueprintFingerprint(
      starterRuntimeProject,
    ),
  runtimeBuildFingerprint:
    packagedRuntimeBuild.surfaces['final-visual'],
  renderProfile: {
    width: 480,
    height: 270,
    fps: 30,
    sourceRenderer: 'Paper-Collage',
    proxyPolicy: 'keep-current-real-source-else-deterministic-proxy',
  },
  sourceCoverage: {actual: 2, proxy: 0, total: 2, actualRatio: 1},
  audio: (
    await runtimeVisualBlueprintLib.materializeVisualBlueprintProject(
      starterRuntimeProject,
    )
  ).audio,
  styleReference: {
    assetId: 'starter-style-sample',
    file: starterStyleSampleRelative,
    sha256: starterStyleSampleSha256,
  },
  artifacts: {
    animatic: starterBlueprintRelative(starterBlueprintAnimatic),
    contactSheet: starterBlueprintRelative(starterBlueprintContactSheet),
    styleFrame: starterBlueprintRelative(starterBlueprintStyleFrame),
  },
  artifactHashes: Object.fromEntries(
    await Promise.all(
      starterBlueprintArtifactFiles.map(async (file) => [
        file,
        await hashFile(path.join(RUNTIME_ROOT, file)),
      ]),
    ),
  ),
  scenes: [
    {
      sceneId: 'starter',
      label: '纸片分层视频',
      durationSeconds: 1.2,
      keyframes: starterBlueprintFrameFiles,
      motionClip: starterBlueprintRelative(starterBlueprintMotionClip),
      userDecisionScope: [
        '构图与主体位置',
        '图层前后关系与遮挡意图',
        '角色运动方向与朝向',
        '逐帧状态切换、循环区间与位移协调',
        '镜头运动、景深和节奏',
      ],
    },
  ],
  machineChecks: [
    {id: 'all-scenes-covered', passed: true},
    {id: 'three-keyframes-per-scene', passed: true},
    {id: 'motion-clips-for-dynamic-scenes', passed: true},
    {id: 'current-runtime-bound', passed: true},
    {id: 'artifact-hashes-recorded', passed: true},
    {id: 'audio-policy-disclosed', passed: true},
  ],
  decisionBoundary: {
    machine: '只确认技术完整性，不判断画面好坏。',
    human: '一次观看蓝图并批准或提出修改。',
    finalPreview: '正式素材替换后由人判断真实视觉缺陷。',
  },
};
const starterBlueprintReportFile = path.join(
  starterBlueprintDirectory,
  'index.json',
);
await writeJson(starterBlueprintReportFile, starterBlueprintReport);
await runtimeVisualBlueprintLib.assertVisualBlueprintReady('starter-demo');
const starterReviewRequest =
  await runtimeVisualBlueprintLib.createVisualBlueprintReviewRequest({
    slug: 'starter-demo',
    report: starterBlueprintReport,
    createdAt: at,
  });
await writeJson(starterReviewRequest.file, starterReviewRequest.request);
const starterReviewReceipt = {
  $schema: '../../schemas/visual-blueprint-review-receipt.schema.json',
  schemaVersion: 1,
  projectSlug: 'starter-demo',
  requestFingerprint: starterReviewRequest.request.requestFingerprint,
  decision: 'approved',
  reviewer: {
    id: 'human:bundled-fixture-maintainer',
    role: 'human',
  },
  note: 'Bundled fixture approved by maintainers',
  decidedAt: at,
  evidence: {
    kind: 'host-user-message',
    host: 'repository-package-sync',
    threadId: 'bundled-fixture',
    messageReference: 'maintainer-reviewed-starter-blueprint',
    userMessageSha256: createHash('sha256')
      .update('Bundled starter fixture maintainer approval')
      .digest('hex'),
  },
};
starterReviewReceipt.receiptFingerprint =
  runtimeVisualBlueprintReviewLib.humanReviewReceiptFingerprint(
    starterReviewReceipt,
  );
const starterBlueprintApproval =
  await runtimeVisualBlueprintReviewLib.recordVisualBlueprintApproval({
    slug: 'starter-demo',
    receipt: starterReviewReceipt,
    write: false,
  });
const starterMotionApproval =
  await runtimeMotionApprovalLib.recordMotionApproval({
    slug: 'starter-demo',
    visualBlueprint: starterBlueprintApproval.current.ready,
    reviewReceipt: starterReviewReceipt,
    write: false,
  });
await writeJson(
  starterBlueprintApproval.receiptFile,
  starterReviewReceipt,
);
await writeJson(
  starterBlueprintApproval.file,
  starterBlueprintApproval.record,
);
await writeJson(
  starterMotionApproval.file,
  starterMotionApproval.record,
);
production.artifacts.visualBlueprint =
  starterBlueprintRelative(starterBlueprintReportFile);
production.artifacts.visualBlueprintApproval =
  starterBlueprintRelative(starterBlueprintApproval.file);
production.artifacts.visualBlueprintReviewRequest =
  starterBlueprintRelative(starterReviewRequest.file);
production.artifacts.visualBlueprintReviewReceipt =
  starterBlueprintRelative(starterBlueprintApproval.receiptFile);

const starterPreparedQuality = await runtimeQualityLib.prepareQualityReport(
  'starter-demo',
  {write: false},
);
starterPreparedQuality.report.updatedAt = at;
for (const asset of starterPreparedQuality.report.assets) {
  asset.semanticChecks = Object.fromEntries(
    asset.requiredChecks.map((check) => [check, 'passed']),
  );
  asset.reviewer = 'human:bundled-fixture';
  asset.reviewedAt = at;
  asset.note = 'Repository-owned technical fixture asset';
  asset.evidenceFiles = [];
  asset.status = 'passed';
}
for (const composite of starterPreparedQuality.report.composites) {
  composite.semanticChecks = Object.fromEntries(
    composite.requiredChecks.map((check) => [check, 'passed']),
  );
  composite.reviewer = 'human:bundled-fixture';
  composite.reviewedAt = at;
  composite.note = 'Repository-owned technical fixture proof';
  composite.evidenceFiles = await Promise.all(
    [
      ...new Set(
        composite.proofFrames.flatMap(({fullFrame, crop}) => [fullFrame, crop]),
      ),
    ].map(async (file) => ({
      file,
      sha256: await hashFile(path.join(RUNTIME_ROOT, file)),
    })),
  );
  composite.status = 'passed';
}
runtimeQualityLib.refreshQualityReviewSurfaceFingerprint(
  starterPreparedQuality.report,
);
await writeJson(
  path.join(RUNTIME_ROOT, 'projects', 'starter-demo', 'quality-report.json'),
  starterPreparedQuality.report,
);

const starterValidation = await runtimeProjectLib.validateProject(
  starterRuntimeProject,
);
if (!starterValidation.passed) {
  throw new Error('packaged starter validation must pass before sealing');
}
starterValidation.generatedAt = at;
await writeJson(
  path.join(RUNTIME_ROOT, 'dist', 'starter-demo', 'validation-report.json'),
  starterValidation,
);
const starterQualityReady = await runtimeQualityLib.assertQualityReady(
  'starter-demo',
);
starterQualityReady.report.updatedAt = at;
await writeJson(starterQualityReady.file, starterQualityReady.report);
const runtimeAssetsReadySealLib = await import(
  `${pathToFileURL(path.join(RUNTIME_ROOT, 'scripts', 'assets-ready-seal-lib.mjs')).href}?sync=${Date.now()}`,
);
const starterSeal = await runtimeAssetsReadySealLib.createAssetsReadySeal(
  'starter-demo',
  {
    project: starterRuntimeProject,
    validation: starterValidation,
    quality: starterQualityReady,
  },
);
starterSeal.seal.generatedAt = at;
await writeJson(starterSeal.file, starterSeal.seal);
production.artifacts.validationReport = path.relative(
  RUNTIME_ROOT,
  path.join(RUNTIME_ROOT, 'dist', 'starter-demo', 'validation-report.json'),
);
production.artifacts.assetsReadySeal = path.relative(
  RUNTIME_ROOT,
  starterSeal.file,
);
await writeJson(
  path.join(RUNTIME_ROOT, 'projects', 'starter-demo', 'production.json'),
  production,
);

await writeJson(path.join(RUNTIME_ROOT, '.paper-collage-template.json'), {
  schemaVersion: 1,
  plugin: 'paper-collage-video',
  pluginVersion: rootPackage.version,
});

console.log(`✓ Plugin skill synced: ${path.relative(ROOT, SKILL_TARGET)}`);
console.log(`✓ Runtime template synced: ${path.relative(ROOT, RUNTIME_ROOT)}`);
