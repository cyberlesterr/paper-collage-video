import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
export const RUNTIME_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');

const STYLE_CATALOG_FILE = 'public/style-catalog/catalog.json';
const styleCatalog = JSON.parse(
  await fs.readFile(path.join(RUNTIME_ROOT, STYLE_CATALOG_FILE), 'utf8'),
);
const STYLE_CATALOG_IMAGE_INPUTS = styleCatalog.styles.map(({image}) => {
  const normalized = path.posix.normalize(`public/${image}`);
  if (
    !normalized.startsWith('public/style-catalog/') ||
    normalized.includes('..')
  ) {
    throw new Error(`风格目录图片路径越界：${image}`);
  }
  return normalized;
});

const collectManagedRuntimeFiles = async () => {
  const roots = [
    'package.json',
    'providers.json',
    'providers.local.example.json',
    'requirements.txt',
    'remotion.config.ts',
    'tsconfig.json',
    'schemas',
    'scripts',
    'src',
    'templates',
  ];
  const files = [];
  const visit = async (relative) => {
    const absolute = path.join(RUNTIME_ROOT, relative);
    const stat = await fs.stat(absolute).catch(() => null);
    if (!stat) return;
    if (stat.isFile()) {
      if (relative !== 'scripts/sync-plugin-package.mjs') {
        files.push(relative.split(path.sep).join('/'));
      }
      return;
    }
    const entries = await fs.readdir(absolute, {withFileTypes: true});
    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name)
    )) {
      await visit(path.join(relative, entry.name));
    }
  };
  for (const relative of roots) await visit(relative);
  return files.sort();
};

export const RUNTIME_EXPLICIT_INPUTS = [
  'package.json',
  'requirements.txt',
  'remotion.config.ts',
  'schemas/composition.schema.json',
  'schemas/editorial.schema.json',
  'schemas/assets-manifest.schema.json',
  'schemas/asset-request.schema.json',
  'schemas/provider-source-normalization.schema.json',
  'schemas/audio-calibration.schema.json',
  'schemas/production.schema.json',
  'schemas/planning-scenarios.schema.json',
  'schemas/provider-observation.schema.json',
  'schemas/project.schema.json',
  'schemas/quality-report.schema.json',
  'schemas/quality-review-scaffold.schema.json',
  'schemas/quality-review-contact-sheet.schema.json',
  'schemas/looping-strip.schema.json',
  'schemas/motion-contract.schema.json',
  'schemas/registered-family.schema.json',
  'schemas/registered-family-binding.schema.json',
  'schemas/registered-geometry-proof.schema.json',
  'schemas/canonical-container.schema.json',
  'schemas/canonical-container-binding.schema.json',
  'schemas/rejected-output-recovery.schema.json',
  'schemas/semantic-contracts.schema.json',
  'schemas/semantic-revision-authorization.schema.json',
  'schemas/spatial-contract.schema.json',
  'schemas/state-sheet.schema.json',
  'schemas/storyboard.schema.json',
  'schemas/storyboard-authoring.schema.json',
  'schemas/world-topology-proof.schema.json',
  'schemas/encounter-contract.schema.json',
  'schemas/failure-circuit.schema.json',
  'schemas/style-catalog.schema.json',
  'schemas/style-profile.schema.json',
  'schemas/sound-effect-plan.schema.json',
  'schemas/visual-blueprint.schema.json',
  'schemas/visual-blueprint-approval.schema.json',
  STYLE_CATALOG_FILE,
  'public/style-catalog/generation-provenance.json',
  ...STYLE_CATALOG_IMAGE_INPUTS,
  'scripts/composition-lib.mjs',
  'scripts/creative-plan-lib.mjs',
  'scripts/intake-lib.mjs',
  'scripts/planning-scenario-lib.mjs',
  'scripts/style-catalog-lib.mjs',
  'scripts/alpha-band-lib.mjs',
  'scripts/asset-evidence-lib.mjs',
  'scripts/asset-manifest-lib.mjs',
  'scripts/chroma-key-lib.mjs',
  'scripts/checkerboard-alpha-lib.mjs',
  'scripts/decorative-scatter-lib.mjs',
  'scripts/asset-hardening-proof-lib.mjs',
  'scripts/audio-calibration-lib.mjs',
  'scripts/audio-preflight-lib.mjs',
  'scripts/assets-ready-seal-lib.mjs',
  'scripts/directing-revision-lib.mjs',
  'scripts/editorial-system-lib.mjs',
  'scripts/generation-attempt-lib.mjs',
  'scripts/failure-circuit-lib.mjs',
  'scripts/layer-source-plan-lib.mjs',
  'scripts/container-source-plan-lib.mjs',
  'scripts/layer-stack-proof-lib.mjs',
  'scripts/looping-strip-lib.mjs',
  'scripts/world-topology-proof-lib.mjs',
  'scripts/encounter-contract-lib.mjs',
  'scripts/motion-approval-lib.mjs',
  'scripts/motion-contract-lib.mjs',
  'scripts/motion-treatment-lib.mjs',
  'scripts/observed-key-plane-lib.mjs',
  'scripts/provider-attempt.mjs',
  'scripts/provider-lib.mjs',
  'scripts/provider-root-plan-lib.mjs',
  'scripts/provider-recover-rejected-source.mjs',
  'scripts/project-composition-proof.mjs',
  'scripts/project-world-topology-proof.mjs',
  'scripts/project-budget.mjs',
  'scripts/project-advance.mjs',
  'scripts/project-assets-ready.mjs',
  'scripts/project-audio-preflight.mjs',
  'scripts/project-confirm-concept.mjs',
  'scripts/project-visual-blueprint.mjs',
  'scripts/project-intake.mjs',
  'scripts/project-doctor.mjs',
  'scripts/project-failures.mjs',
  'scripts/project-friction.mjs',
  'scripts/project-storyboard-scaffold.mjs',
  'scripts/project-materialize-execution.mjs',
  'scripts/project-lib.mjs',
  'scripts/project-metrics-run.mjs',
  'scripts/project-plan.mjs',
  'scripts/project-quality.mjs',
  'scripts/project-scenarios.mjs',
  'scripts/project-render-status.mjs',
  'scripts/project-revise-preview-semantic.mjs',
  'scripts/project-render.mjs',
  'scripts/project-report.mjs',
  'scripts/project-subtitles.mjs',
  'scripts/phase2-proof-lib.mjs',
  'scripts/world-motion-proof-lib.mjs',
  'scripts/world-trajectory-lib.mjs',
  'scripts/prepare-phase2-proof.mjs',
  'scripts/prepare-looping-world-proof.mjs',
  'scripts/prepare-path-locomotion-proof.mjs',
  'scripts/production-state.mjs',
  'scripts/process-state-sheet.mjs',
  'scripts/derive-registered-family.mjs',
  'scripts/derive-canonical-container.mjs',
  'scripts/derive-looping-strip.mjs',
  'scripts/normalize-provider-source.mjs',
  'scripts/registered-family-lib.mjs',
  'scripts/registered-geometry-lib.mjs',
  'scripts/prove-registered-geometry.mjs',
  'scripts/canonical-container-lib.mjs',
  'scripts/rejected-output-recovery-lib.mjs',
  'scripts/quality-lib.mjs',
  'scripts/render-cache-lib.mjs',
  'scripts/render-status-lib.mjs',
  'scripts/runtime-build-lib.mjs',
  'scripts/semantic-contract-lib.mjs',
  'scripts/remove_chroma_key.py',
  'scripts/state-sequence-lib.mjs',
  'scripts/spatial-contract-lib.mjs',
  'scripts/style-motion-proof.mjs',
  'scripts/project-scene-preview.mjs',
  'scripts/project-stitch-narration.mjs',
  'scripts/style-proof-lib.mjs',
  'scripts/visual-blueprint-lib.mjs',
  'scripts/storyboard-lib.mjs',
  'scripts/subtitle-contract-lib.mjs',
  'scripts/subtitle-lib.mjs',
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
  'fixtures/canonical-container/canonical-container.json',
  'fixtures/canonical-container/canonical-container-binding.json',
  'fixtures/canonical-container/canonical-container-intent.json',
  'fixtures/canonical-container/canonical-container-plan.json',
  'fixtures/starter-demo/project.json',
  'fixtures/motion-contract-fixture.mjs',
  'fixtures/phase2-proof-fixture.mjs',
  'fixtures/looping-world-fixture.mjs',
  'fixtures/path-locomotion-fixture.mjs',
  'src/index.ts',
  'src/Root.tsx',
  'src/MainVideo.tsx',
  'src/EditorialNodes.tsx',
  'src/ReplicaChapterScene.tsx',
  'src/SceneTransitionOverlay.tsx',
  'src/SubtitleOverlay.tsx',
  'src/motion.ts',
  'src/editorialPrimitives.mjs',
  'src/motifField.mjs',
  'src/parallax.mjs',
  'src/pathMotion.mjs',
  'src/pathMotion.d.mts',
  'src/worldStrip.mjs',
  'src/project.ts',
  'src/sceneTimeline.mjs',
  'src/stateSequence.ts',
  'src/subtitleSurface.mjs',
  'src/subtitleSurface.d.mts',
  'src/visibilityLifecycle.mjs',
];

const JAVASCRIPT_MODULE_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
]);
const LOCAL_IMPORT_PATTERN =
  /(?:\bimport\s+(?:[^"'();]*?\s+from\s*)?|\bexport\s+(?:[^"']*?\s+from\s*))["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
const LOCAL_IMPORT_RESOLUTION_SUFFIXES = [
  '',
  '.mjs',
  '.js',
  '.ts',
  '.tsx',
  '.json',
  '/index.mjs',
  '/index.js',
  '/index.ts',
  '/index.tsx',
];

const relativeRuntimePath = (root, file) =>
  path.relative(root, file).split(path.sep).join('/');

const resolveLocalRuntimeImport = async ({root, importer, specifier}) => {
  if (!specifier.startsWith('.')) return null;
  const normalizedSpecifier = specifier.split(/[?#]/, 1)[0];
  const unresolved = path.resolve(path.dirname(importer), normalizedSpecifier);
  const relative = path.relative(root, unresolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(
      `runtime 本地导入越界：${relativeRuntimePath(root, importer)} -> ${specifier}`,
    );
  }
  for (const suffix of LOCAL_IMPORT_RESOLUTION_SUFFIXES) {
    const candidate = `${unresolved}${suffix}`;
    const stat = await fs.stat(candidate).catch(() => null);
    if (stat?.isFile()) return candidate;
  }
  throw new Error(
    `runtime 本地导入无法解析：${relativeRuntimePath(root, importer)} -> ${specifier}`,
  );
};

export const discoverRuntimeInputClosure = async ({
  root = RUNTIME_ROOT,
  roots = RUNTIME_EXPLICIT_INPUTS,
} = {}) => {
  const explicit = new Set(roots);
  const discovered = new Set();
  const visited = new Set();
  const queue = roots
    .filter((relative) =>
      JAVASCRIPT_MODULE_EXTENSIONS.has(path.extname(relative)),
    )
    .map((relative) => path.resolve(root, relative));
  while (queue.length > 0) {
    const importer = queue.shift();
    const importerRelative = relativeRuntimePath(root, importer);
    if (visited.has(importerRelative)) continue;
    visited.add(importerRelative);
    const source = await fs.readFile(importer, 'utf8');
    LOCAL_IMPORT_PATTERN.lastIndex = 0;
    for (
      let match = LOCAL_IMPORT_PATTERN.exec(source);
      match;
      match = LOCAL_IMPORT_PATTERN.exec(source)
    ) {
      const resolved = await resolveLocalRuntimeImport({
        root,
        importer,
        specifier: match[1] ?? match[2],
      });
      if (!resolved) continue;
      const relative = relativeRuntimePath(root, resolved);
      if (!explicit.has(relative)) discovered.add(relative);
      if (
        JAVASCRIPT_MODULE_EXTENSIONS.has(path.extname(relative)) &&
        !visited.has(relative)
      ) {
        queue.push(resolved);
      }
    }
  }
  return [...discovered].sort();
};

const RUNTIME_DISCOVERED_INPUTS = await discoverRuntimeInputClosure();

const RUNTIME_OUTPUT_INPUTS = [
  ...RUNTIME_EXPLICIT_INPUTS,
  ...RUNTIME_DISCOVERED_INPUTS,
];

export const RUNTIME_BUILD_INPUTS = [
  ...new Set([
    ...RUNTIME_OUTPUT_INPUTS,
    ...(await collectManagedRuntimeFiles()),
  ]),
].sort();

const AUDIO_DELIVERY_ONLY_INPUTS = [
  'schemas/audio-calibration.schema.json',
  'scripts/assets-ready-seal-lib.mjs',
  'scripts/audio-calibration-lib.mjs',
  'scripts/audio-preflight-lib.mjs',
  'scripts/project-assets-ready.mjs',
  'scripts/project-audio-calibration.mjs',
  'scripts/project-audio-preflight.mjs',
  'scripts/project-report.mjs',
];

const SUBTITLE_PRESENTATION_INPUTS = [
  'scripts/project-subtitles.mjs',
  'scripts/subtitle-contract-lib.mjs',
  'scripts/subtitle-lib.mjs',
  'src/SubtitleOverlay.tsx',
  'src/subtitleSurface.mjs',
  'src/subtitleSurface.d.mts',
];

const NON_OUTPUT_RUNTIME_INPUTS = [
  'fixtures/editorial-fixture.mjs',
  'scripts/production-metrics-lib.mjs',
  'scripts/python-runtime.mjs',
  'scripts/visual-blueprint-review-lib.mjs',
];

const AUDIO_DELIVERY_RUNTIME_INPUTS = new Set([
  'package.json',
  'schemas/audio-calibration.schema.json',
  'schemas/project.schema.json',
  'scripts/audio-calibration-lib.mjs',
  'scripts/audio-preflight-lib.mjs',
  'scripts/project-lib.mjs',
  'scripts/project-render.mjs',
  'scripts/render-cache-lib.mjs',
  'scripts/runtime-build-lib.mjs',
  'scripts/timeline-continuity-lib.mjs',
  'src/sceneTimeline.mjs',
]);

export const RUNTIME_SURFACE_INPUTS = {
  'final-visual': RUNTIME_OUTPUT_INPUTS.filter(
    (relative) => ![
      ...AUDIO_DELIVERY_ONLY_INPUTS,
      ...NON_OUTPUT_RUNTIME_INPUTS,
    ].includes(relative),
  ),
  'composition-proof': RUNTIME_OUTPUT_INPUTS.filter((relative) => ![
    ...AUDIO_DELIVERY_ONLY_INPUTS,
    ...SUBTITLE_PRESENTATION_INPUTS,
    ...NON_OUTPUT_RUNTIME_INPUTS,
  ].includes(relative)),
  'audio-delivery': RUNTIME_OUTPUT_INPUTS.filter(
    (relative) => AUDIO_DELIVERY_RUNTIME_INPUTS.has(relative),
  ),
};

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const digestRuntimeInput = async ({
  root,
  relative,
  includePackageVersion,
}) => {
  if (relative !== 'package.json') {
    return sha256(await fs.readFile(path.join(root, relative)));
  }
  const packageJson = JSON.parse(
    await fs.readFile(path.join(root, relative), 'utf8'),
  );
  return sha256(JSON.stringify({
    ...(includePackageVersion ? {version: packageJson.version} : {}),
    dependencies: packageJson.dependencies,
    devDependencies: packageJson.devDependencies,
  }));
};

const fingerprintRuntimeInputs = async ({
  root,
  inputs,
  includePackageVersion,
}) => {
  const files = {};
  for (const relative of inputs) {
    files[relative] = await digestRuntimeInput({
      root,
      relative,
      includePackageVersion,
    });
  }
  return {
    files,
    fingerprint: sha256(
      Object.entries(files).map(([file, digest]) => `${file}\0${digest}`).join('\n'),
    ),
  };
};

export const createRuntimeSurfaceFingerprint = async (
  surface,
  {root = RUNTIME_ROOT} = {},
) => {
  const inputs = RUNTIME_SURFACE_INPUTS[surface];
  if (!inputs) throw new Error(`未知 runtime surface：${surface}`);
  return (
    await fingerprintRuntimeInputs({
      root,
      inputs,
      includePackageVersion: false,
    })
  ).fingerprint;
};

export const createRuntimeBuildManifest = async ({root = RUNTIME_ROOT} = {}) => {
  const build = await fingerprintRuntimeInputs({
    root,
    inputs: RUNTIME_BUILD_INPUTS,
    includePackageVersion: true,
  });
  const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const surfaces = Object.fromEntries(
    await Promise.all(
      Object.keys(RUNTIME_SURFACE_INPUTS).map(async (surface) => [
        surface,
        await createRuntimeSurfaceFingerprint(surface, {root}),
      ]),
    ),
  );
  return {
    schemaVersion: 2,
    packageVersion: packageJson.version,
    fingerprint: build.fingerprint,
    surfaces,
    files: build.files,
  };
};

export const createRuntimeBuildFingerprint = async (options) =>
  (await createRuntimeBuildManifest(options)).fingerprint;

export const assertRuntimeBuildManifestCurrent = async ({
  root = RUNTIME_ROOT,
} = {}) => {
  const file = path.join(root, 'runtime-build.json');
  let recorded;
  try {
    recorded = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    throw new Error(`无法读取 runtime-build.json：${error.message}`);
  }
  const current = await createRuntimeBuildManifest({root});
  if (JSON.stringify(recorded) !== JSON.stringify(current)) {
    const changedFiles = new Set([
      ...Object.keys(recorded?.files ?? {}),
      ...Object.keys(current.files),
    ]);
    const drift = [...changedFiles]
      .filter((relative) => recorded?.files?.[relative] !== current.files[relative])
      .slice(0, 8);
    throw new Error(
      `runtime-build.json 与当前可执行文件不一致` +
        `${drift.length ? `：${drift.join(', ')}` : ''}；` +
        '请从已同步的插件重新 bootstrap 工作区，或在源仓库完成正式 plugin:sync。',
    );
  }
  return current;
};
