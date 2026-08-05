import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {availableParallelism} from 'node:os';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {
  assessCreativePlanTimeline,
  validateCreativePlan,
} from './creative-plan-lib.mjs';
import {validateIntake} from './intake-lib.mjs';
import {
  assertStyleProfileCurrent,
  loadStyleCatalog,
  validateStyleProfileSnapshot,
} from './style-catalog-lib.mjs';
import {
  loadStoryboard,
  STORY_BLUEPRINTS,
  validateStoryboard,
} from './storyboard-lib.mjs';
import {validateDirectingExecution} from './motion-treatment-lib.mjs';
import {validateMotionContractExecution} from './motion-contract-lib.mjs';
import {
  EMPHASIS_ACTIONS,
  flattenCompositionNodes,
  validateCompositionStructure,
} from './composition-lib.mjs';
import {
  deriveSceneTimeline,
  validateSceneTransitionSequence,
} from '../src/sceneTimeline.mjs';
import {validateParallaxRig} from '../src/parallax.mjs';
import {validateCameraFollow} from '../src/pathMotion.mjs';
import {validateVisibilityLifecycle} from '../src/visibilityLifecycle.mjs';
import {assessTimelineContinuity} from './timeline-continuity-lib.mjs';
import {
  readGenerationAttemptEvents,
  summarizeGenerationAttempts,
} from './generation-attempt-lib.mjs';
import {
  validateCompiledEditorial,
  validateEditorialTransitionExecution,
} from './editorial-system-lib.mjs';
import {
  activeManifestAssets,
  assertAssetManifest,
} from './asset-manifest-lib.mjs';
import {
  derivationRegionsFromBinding,
  inspectAlphaBands,
} from './alpha-band-lib.mjs';
import {assertRegisteredFamilyGroupMembers} from './registered-family-lib.mjs';
import {
  inspectCanonicalContainerGroupMembers,
} from './canonical-container-lib.mjs';
import {validateProductionContracts} from './world-trajectory-lib.mjs';
import {validateSpatialContracts} from './spatial-contract-lib.mjs';
import {validateEncounterExecution} from './encounter-contract-lib.mjs';
import {
  assessProviderRootRealization,
  buildProviderRootPlan,
} from './provider-root-plan-lib.mjs';
import {assertPlanningScenariosReady} from './planning-scenario-lib.mjs';

const execFileAsync = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(scriptDirectory, '..');
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const resolveRenderConcurrency = (
  parallelism = availableParallelism(),
  maximum = 8,
  requested = process.env.PAPER_COLLAGE_RENDER_CONCURRENCY,
) => {
  if (requested !== undefined && requested !== '') {
    const parsed = Number(requested);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new Error('PAPER_COLLAGE_RENDER_CONCURRENCY must be a positive integer.');
    }
    return Math.min(maximum, parsed);
  }
  return Math.max(1, Math.min(maximum, Math.floor(parallelism)));
};

export const countProviderGeneratedImages = (assets = []) =>
  assets.filter((asset) => {
    if (asset.lifecycle && asset.lifecycle.status !== 'active') return false;
    if (asset.capability !== 'image') return false;
    const derivationMethod =
      asset.request?.compositionBinding?.derivation?.method ??
      asset.compositionBinding?.derivation?.method ??
      null;
    return ['provider-generation', 'provider-edit'].includes(derivationMethod);
  }).length;

export const projectPaths = (slug) => ({
  slug,
  projectDirectory: path.join(ROOT, 'projects', slug),
  projectFile: path.join(ROOT, 'projects', slug, 'project.json'),
  planningScenariosFile: path.join(
    ROOT,
    'projects',
    slug,
    'planning-scenarios.json',
  ),
  productionFile: path.join(ROOT, 'projects', slug, 'production.json'),
  productionMetricsFile: path.join(ROOT, 'projects', slug, 'production-metrics.json'),
  storyboardFile: path.join(ROOT, 'projects', slug, 'storyboard.json'),
  motionLanguageCardFile: path.join(ROOT, 'projects', slug, 'motion-language-card.json'),
  motionApprovalFile: path.join(ROOT, 'projects', slug, 'motion-approval.json'),
  reviewFile: path.join(ROOT, 'projects', slug, 'review.md'),
  semanticContractsFile: path.join(ROOT, 'projects', slug, 'semantic-contracts.json'),
  generationAttemptsFile: path.join(ROOT, 'projects', slug, 'generation-attempts.jsonl'),
  publicDirectory: path.join(ROOT, 'public', 'projects', slug),
  distDirectory: path.join(ROOT, 'dist', slug),
  validationReport: path.join(ROOT, 'dist', slug, 'validation-report.json'),
  assetsReadySeal: path.join(ROOT, 'dist', slug, 'assets-ready-seal.json'),
});

export const assertSlug = (slug) => {
  if (!slug || !SLUG_PATTERN.test(slug)) {
    throw new Error(
      '项目 slug 只能包含小写字母、数字和单个连字符，例如 my-history-film。',
    );
  }
};

export const readJson = async (file) =>
  JSON.parse(await fs.readFile(file, 'utf8'));

export const writeJson = async (file, value) => {
  await fs.mkdir(path.dirname(file), {recursive: true});
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

export const loadProject = async (slug) => {
  assertSlug(slug);
  const paths = projectPaths(slug);
  const project = await readJson(paths.projectFile);
  if (project.schemaVersion !== 12) {
    throw new Error('project.json 必须使用 schemaVersion 12；旧项目不会自动迁移。');
  }
  return {paths, project};
};

export const deriveTimeline = (project) => deriveSceneTimeline(project);

export const stateSequenceMatchesStoryboardPlan = (actual, planned) =>
  actual?.poseFamilyId === planned?.poseFamilyId &&
  JSON.stringify(actual?.playback ?? null) === JSON.stringify(planned?.playback ?? null) &&
  actual?.transition?.type === planned?.transition &&
  JSON.stringify((actual?.states ?? []).map(({id, at, facing}) => ({id, at, facing}))) ===
    JSON.stringify((planned?.states ?? []).map(({id, at, facing}) => ({id, at, facing})));

export const proofOverlapsTransition = ({
  at,
  enterTransitionFrames = 0,
  exitTransitionFrames = 0,
  durationInFrames,
}) => {
  const duration = Math.max(1, durationInFrames);
  return at < enterTransitionFrames / duration || at > 1 - exitTransitionFrames / duration;
};

export const resolveEventProofWindow = ({
  event,
  eventIndex,
  events,
  sceneDurationSeconds,
}) => {
  const start = event.at;
  if (event.visual?.kind === 'visibility') {
    const nextVisibility = (events ?? [])
      .slice(eventIndex + 1)
      .find((candidate) =>
        candidate.targetId === event.targetId &&
        candidate.visual?.kind === 'visibility',
      );
    return {
      start,
      end: nextVisibility?.at ?? 1,
      mode: 'persistent-visibility',
    };
  }
  const duration = event.visual?.durationSeconds ?? 0.1;
  return {
    start,
    end: start + duration / Math.max(0.001, sceneDurationSeconds),
    mode: 'action-window',
  };
};

export const deriveContactSheetSamples = ({
  timeline,
  fps,
  durationSeconds,
  maxPanels = 16,
}) => {
  const scenes = timeline?.scenes ?? [];
  const panelLimit = Math.max(1, Math.floor(maxPanels));
  if (scenes.length === 0) {
    return [0.18, 0.5, 0.84].map((ratio, index) => ({
      time: Math.max(0, Math.min(durationSeconds - 0.04, durationSeconds * ratio)),
      label: `全片 ${index + 1}`,
      sceneId: null,
    }));
  }
  const proofs = scenes.flatMap((scene) =>
    (scene.motion?.proofTimes ?? []).map((proof) => ({scene, proof})),
  );
  const selected =
    proofs.length <= panelLimit
      ? proofs
      : panelLimit === 1
        ? [proofs[Math.floor(proofs.length / 2)]]
        : Array.from({length: panelLimit}, (_, index) =>
            proofs[Math.round((index * (proofs.length - 1)) / (panelLimit - 1))],
          );
  return selected.map(({scene, proof}) => {
      const frame = scene.from + Math.max(0, scene.durationInFrames - 1) * proof.at;
      const time = Math.max(0, Math.min(durationSeconds - 0.04, frame / fps));
      return {
        time,
        label: `${scene.label || scene.id} · ${proof.label}`,
        sceneId: scene.id,
        kind: proof.kind,
      };
    });
};

export const resolvePublicFile = (assetPath) => {
  const publicRoot = path.join(ROOT, 'public');
  const resolved = path.resolve(publicRoot, assetPath);
  if (resolved !== publicRoot && !resolved.startsWith(`${publicRoot}${path.sep}`)) {
    throw new Error(`素材路径越过 public 目录：${assetPath}`);
  }
  return resolved;
};

export const probeMedia = async (file) => {
  const {stdout} = await execFileAsync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_streams',
      '-show_format',
      '-of',
      'json',
      file,
    ],
    {maxBuffer: 8 * 1024 * 1024},
  );
  return JSON.parse(stdout);
};

const fileExists = async (file) => {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
};

const sha256File = async (file) =>
  createHash('sha256').update(await fs.readFile(file)).digest('hex');

export const inspectCharacterPng = async (file) => {
  const metadata = await sharp(file).metadata();
  const {data, info} = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({resolveWithObject: true});
  let transparentPixels = 0;
  let partialPixels = 0;
  let partialAlphaWeight = 0;
  let visiblePixels = 0;
  let transparentRed = 0;
  let transparentGreen = 0;
  let transparentBlue = 0;
  let lowAlphaPixels = 0;
  let lowAlphaRed = 0;
  let lowAlphaGreen = 0;
  let lowAlphaBlue = 0;

  for (let index = 0; index < data.length; index += info.channels) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const alpha = data[index + 3];
    if (alpha === 0) {
      transparentPixels += 1;
      transparentRed += red;
      transparentGreen += green;
      transparentBlue += blue;
    }
    if (alpha > 0 && alpha < 250) {
      partialPixels += 1;
      partialAlphaWeight += alpha / 255;
    }
    if (alpha > 0) visiblePixels += 1;
    if (alpha > 0 && alpha <= 64) {
      lowAlphaPixels += 1;
      lowAlphaRed += red;
      lowAlphaGreen += green;
      lowAlphaBlue += blue;
    }
  }

  const keySampleCount = transparentPixels || lowAlphaPixels;
  const inferredKeyColor = keySampleCount
    ? [
        (transparentPixels ? transparentRed : lowAlphaRed) / keySampleCount,
        (transparentPixels ? transparentGreen : lowAlphaGreen) / keySampleCount,
        (transparentPixels ? transparentBlue : lowAlphaBlue) / keySampleCount,
      ]
    : null;
  let keyMetadata = null;
  try {
    keyMetadata = JSON.parse(await fs.readFile(`${file}.key.json`, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const declaredKeyColor = /^#[0-9a-f]{6}$/i.test(keyMetadata?.keyColor ?? '')
    ? [1, 3, 5].map((index) => Number.parseInt(keyMetadata.keyColor.slice(index, index + 2), 16))
    : null;
  const inferredSaturation = inferredKeyColor
    ? Math.max(...inferredKeyColor) - Math.min(...inferredKeyColor)
    : 0;
  const keyColor = declaredKeyColor ?? (inferredSaturation >= 80 ? inferredKeyColor : null);
  const keyMean = keyColor
    ? (keyColor[0] + keyColor[1] + keyColor[2]) / 3
    : 0;
  const keyChroma = keyColor?.map((channel) => channel - keyMean) ?? [0, 0, 0];
  const keyChromaMagnitude = Math.hypot(...keyChroma);
  let keyEdgePixels = 0;
  let keyEdgeAlphaWeight = 0;
  if (keyChromaMagnitude >= 18) {
    for (let index = 0; index < data.length; index += info.channels) {
      const alpha = data[index + 3];
      if (alpha <= 0 || alpha >= 250) continue;
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      const mean = (red + green + blue) / 3;
      const chroma = [red - mean, green - mean, blue - mean];
      const chromaMagnitude = Math.hypot(...chroma);
      if (chromaMagnitude < 18) continue;
      const keyDistance = Math.hypot(
        red - keyColor[0],
        green - keyColor[1],
        blue - keyColor[2],
      );
      if (keyDistance > 80) continue;
      const similarity =
        chroma.reduce(
          (total, channel, channelIndex) =>
            total + channel * keyChroma[channelIndex],
          0,
        ) /
        (chromaMagnitude * keyChromaMagnitude);
      if (similarity > 0.9) {
        keyEdgePixels += 1;
        keyEdgeAlphaWeight += alpha / 255;
      }
    }
  }

  const keyColorHex = keyColor
    ? `#${keyColor
        .map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0'))
        .join('')}`
    : null;

  return {
    width: metadata.width,
    height: metadata.height,
    format: metadata.format,
    hasAlpha: metadata.hasAlpha === true,
    transparentPixels,
    partialPixels,
    visiblePixels,
    keyColor: keyChromaMagnitude >= 18 ? keyColorHex : null,
    keyColorSource: declaredKeyColor ? 'metadata' : keyColor ? 'transparent-rgb-fallback' : null,
    keyEdgePixels,
    keyEdgeRatio:
      partialAlphaWeight === 0 ? 0 : keyEdgeAlphaWeight / partialAlphaWeight,
  };
};

const inspectBackground = async (file) => {
  const metadata = await sharp(file).metadata();
  return {
    width: metadata.width,
    height: metadata.height,
    format: metadata.format,
    hasAlpha: metadata.hasAlpha === true,
  };
};

const makeIssue = (level, code, message, location) => ({
  level,
  code,
  message,
  location,
});

const isPositiveNumber = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

export const validateProject = async (project, options = {}) => {
  const issues = [];
  const assets = [];
  const backgroundInspectionCache = new Map();
  const characterInspectionCache = new Map();
  const mediaProbeCache = new Map();
  const memoize = (cache, key, inspect) => {
    if (!cache.has(key)) cache.set(key, inspect());
    return cache.get(key);
  };
  const add = (level, code, message, location) =>
    issues.push(makeIssue(level, code, message, location));
  let manifest = options.manifest ?? null;
  const manifestFile = path.join(
    ROOT,
    'projects',
    project.slug ?? '',
    'assets-manifest.json',
  );
  if (
    !manifest &&
    SLUG_PATTERN.test(project.slug ?? '') &&
    await fileExists(manifestFile)
  ) {
    try {
      manifest = assertAssetManifest(await readJson(manifestFile), project.slug);
    } catch (error) {
      add('error', 'asset-manifest-invalid', error.message, 'assets-manifest.json');
    }
  }
  const manifestByFile = new Map(
    activeManifestAssets(manifest ?? {assets: []}).map((record) => [
      path.normalize(record.file),
      record,
    ]),
  );
  const manifestRecordForSource = (source) =>
    manifestByFile.get(path.normalize(path.join('public', source))) ?? null;
  const inspectRectangularAlphaBands = async ({
    file,
    source,
    location,
    renderSize = null,
  }) => {
    const record = manifestRecordForSource(source);
    const inspection = await inspectAlphaBands({
      file,
      renderSize,
      derivationRegions: derivationRegionsFromBinding(
        record?.registeredFamilyBinding,
      ),
    });
    if (!inspection.passed) {
      add(
        'error',
        'composition-rectangular-alpha-band',
        `透明前景存在确定性低 alpha 矩形裁切带：${inspection.failureMessage}`,
        location,
      );
    } else if (inspection.severity === 'warning') {
      const warnings = inspection.scales.flatMap(({label, diagnostics}) =>
        diagnostics
          .filter(({severity}) => severity === 'warning')
          .map((diagnostic) =>
            `${label} ${diagnostic.orientation} ${diagnostic.coordinateStart}-${diagnostic.coordinateEnd}px spans ${diagnostic.spanStart}-${diagnostic.spanEnd}px`),
      );
      add(
        'warning',
        'composition-alpha-band-warning',
        `透明前景存在未确认的长直低 alpha 带：${warnings.join('；')}`,
        location,
      );
    }
    return inspection;
  };

  if (project.schemaVersion !== 12) {
    add('error', 'schema-version', 'schemaVersion 必须为 12。', 'schemaVersion');
  }
  if (!SLUG_PATTERN.test(project.slug ?? '')) {
    add('error', 'slug', 'slug 格式无效。', 'slug');
  }
  if (!project.title || typeof project.title !== 'string') {
    add('error', 'title', '项目必须有标题。', 'title');
  }
  if (project.intake === undefined) {
    add('error', 'intake-required', 'v12 项目必须包含 intake。', 'intake');
  } else {
    for (const issue of validateIntake(project.intake)) {
      add('error', 'intake-invalid', issue.message, issue.location);
    }
    if (project.intake.status === 'pending' && project.styleProfile !== null) {
      add(
        'error',
        'style-profile-premature',
        'pending intake 的 styleProfile 必须为 null。',
        'styleProfile',
      );
    }
    if (
      project.intake.status === 'confirmed' &&
      (
        (project.intake.aspectRatio === '16:9' &&
          (project.video?.width !== 1920 || project.video?.height !== 1080)) ||
        (project.intake.aspectRatio === '9:16' &&
          (project.video?.width !== 1080 || project.video?.height !== 1920))
      )
    ) {
      add(
        'error',
        'intake-video-drift',
        'video 尺寸必须与已确认 intake.aspectRatio 一致。',
        'video',
      );
    }
    if (project.intake.status === 'confirmed') {
      for (const issue of validateStyleProfileSnapshot(project.styleProfile)) {
        add('error', 'style-profile-invalid', issue.message, issue.location);
      }
      if (
        project.styleProfile?.id !== project.intake.visualStylePreset ||
        project.styleProfile?.catalogVersion !==
          project.intake.styleCatalogVersion ||
        project.styleProfile?.catalogFingerprint !==
          project.intake.styleCatalogFingerprint ||
        project.styleProfile?.profileFingerprint !==
          project.intake.styleProfileFingerprint
      ) {
        add(
          'error',
          'style-profile-intake-drift',
          'styleProfile 必须与已确认 intake 的风格、目录及 Profile 指纹一致。',
          'styleProfile',
        );
      }
      if (
        JSON.stringify(project.theme) !==
        JSON.stringify(project.styleProfile?.render?.theme)
      ) {
        add(
          'error',
          'style-profile-theme-drift',
          'project.theme 必须由已确认 styleProfile.render.theme 原样物化。',
          'theme',
        );
      }
      try {
        assertStyleProfileCurrent({
          styleProfile: project.styleProfile,
          catalog: await loadStyleCatalog(),
        });
      } catch (error) {
        add(
          'error',
          'style-profile-catalog-drift',
          error.message,
          'styleProfile',
        );
      }
    }
  }
  if (!isPositiveNumber(project.video?.width)) {
    add('error', 'video-width', '视频宽度必须为正数。', 'video.width');
  }
  if (!isPositiveNumber(project.video?.height)) {
    add('error', 'video-height', '视频高度必须为正数。', 'video.height');
  }
  if (!isPositiveNumber(project.video?.fps)) {
    add('error', 'video-fps', 'fps 必须为正数。', 'video.fps');
  }
  if (!/^#[0-9a-f]{6}$/i.test(project.theme?.canvas ?? '')) {
    add(
      'error',
      'theme-opaque-canvas',
      'theme.canvas 必须是六位不透明十六进制颜色，作为每幕和转场的隔离底纸。',
      'theme.canvas',
    );
  }
  if (project.plan === undefined) {
    add('error', 'plan-required', 'v9 项目必须包含 plan。', 'plan');
  }
  if (!project.voice || typeof project.voice !== 'object') {
    add('error', 'voice-required', 'v9 项目必须包含 voice。', 'voice');
  }
  if (project.audio?.sfx !== undefined) {
    add('error', 'unsupported-audio-sfx', 'v9 不支持 audio.sfx；请用统一 editorial cue 与 event.sound。', 'audio.sfx');
  }
  if (!isPositiveNumber(project.quality?.minimumAssetScale)) {
    add(
      'error',
      'quality-minimum-scale',
      'quality.minimumAssetScale 必须是正数。',
      'quality.minimumAssetScale',
    );
  }
  if (
    !isPositiveNumber(project.audio?.narration?.volume) ||
    project.audio.narration.volume > 4
  ) {
    add(
      'error',
      'audio-narration-volume',
      'audio.narration.volume 必须是大于 0 且不超过 4 的数字。',
      'audio.narration.volume',
    );
  }
  if (project.audio?.mastering) {
    const {targetLufs, toleranceLufs, truePeakDbtp} = project.audio.mastering;
    if (!Number.isFinite(targetLufs)) {
      add('error', 'audio-target-lufs', 'audio.mastering.targetLufs 必须是数字。', 'audio.mastering.targetLufs');
    }
    if (!isPositiveNumber(toleranceLufs)) {
      add('error', 'audio-lufs-tolerance', 'audio.mastering.toleranceLufs 必须是正数。', 'audio.mastering.toleranceLufs');
    }
    if (!Number.isFinite(truePeakDbtp)) {
      add('error', 'audio-true-peak', 'audio.mastering.truePeakDbtp 必须是数字。', 'audio.mastering.truePeakDbtp');
    }
  } else {
    add(
      'error',
      'audio-mastering-required',
      'audio.mastering 是 v9 项目的必填交付规格。',
      'audio.mastering',
    );
  }
  if (!Array.isArray(project.scenes) || project.scenes.length === 0) {
    add('error', 'scenes-empty', '项目至少需要一个镜头。', 'scenes');
  }
  if (project.plan !== undefined) {
    for (const issue of validateCreativePlan(project.plan, {slug: project.slug})) {
      add('error', issue.code, issue.message, issue.location);
    }
    if (project.plan?.status !== 'resolved') {
      add('error', 'plan-pending', '创作规格尚未补全；请先运行 project:plan。', 'plan');
    }
    if (project.plan?.scenarioBinding) {
      const planningScenariosFile = path.join(
        ROOT,
        'projects',
        project.slug,
        'planning-scenarios.json',
      );
      try {
        const scenarios = assertPlanningScenariosReady(
          await readJson(planningScenariosFile),
          {slug: project.slug, intake: project.intake},
        );
        const option = scenarios.options.find(
          ({id}) => id === project.plan.scenarioBinding.optionId,
        );
        const expectedRootPlan = option
          ? buildProviderRootPlan(option)
          : null;
        if (
          scenarios.fingerprint !==
            project.plan.scenarioBinding.scenarioSetFingerprint ||
          option?.fingerprint !==
            project.plan.scenarioBinding.optionFingerprint ||
          option?.providerEstimate?.expectedImageCalls !==
            project.plan.scenarioBinding.expectedProviderImageCalls ||
          JSON.stringify(expectedRootPlan) !==
            JSON.stringify(project.plan.scenarioBinding.providerRootPlan)
        ) {
          add(
            'error',
            'scenario-provider-root-plan-drift',
            'scenarioBinding/providerRootPlan 必须与当前批准 planning-scenarios 选项完全一致。',
            'plan.scenarioBinding.providerRootPlan',
          );
        }
      } catch (error) {
        add(
          'error',
          'planning-scenarios-invalid',
          `无法验证 scenario provider 根资产计划：${error.message}`,
          'planning-scenarios.json',
        );
      }
    }
  }

  let storyboard = options.storyboard ?? null;
  if (!storyboard && SLUG_PATTERN.test(project.slug ?? '')) {
    try {
      storyboard = await loadStoryboard(project.slug);
    } catch (error) {
      add('error', 'storyboard-missing', `缺少或无法读取 storyboard.json：${error.message}`, 'storyboard');
    }
  }
  if (storyboard) {
    for (const issue of validateStoryboard(storyboard, {
      slug: project.slug,
      plan: project.plan,
      styleProfile: project.styleProfile,
    })) {
      add('error', issue.code, issue.message, `storyboard.${issue.location}`);
    }
    if (storyboard.status !== 'ready') {
      add('error', 'storyboard-pending', 'storyboard.json 必须为 ready。', 'storyboard.status');
    }
    if (JSON.stringify(project.sceneTransitions ?? []) !== JSON.stringify(storyboard.sceneTransitions ?? [])) {
      add('error', 'scene-transitions-drift', 'project.sceneTransitions 必须与已批准故事板完全一致。', 'sceneTransitions');
    }
    if (JSON.stringify(project.spatialContracts ?? []) !== JSON.stringify(storyboard.spatialContracts ?? [])) {
      add(
        'error',
        'spatial-contracts-drift',
        'project.spatialContracts 必须与已批准故事板完全一致。',
        'spatialContracts',
      );
    }
    for (const issue of validateMotionContractExecution({
      project,
      storyboard,
    })) {
      add('error', issue.code, issue.message, issue.location);
    }
    const projectEditorial = project.editorial
      ? {...project.editorial, activeProfile: undefined}
      : null;
    const storyboardEditorial = storyboard.editorial
      ? {...storyboard.editorial, activeProfile: undefined}
      : null;
    if (JSON.stringify(projectEditorial) !== JSON.stringify(storyboardEditorial)) {
      add('error', 'editorial-drift', 'project.editorial 必须与已批准故事板的 v9 编译结果完全一致。', 'editorial');
    }
    const approvedImageBudget = project.plan?.approvedImageBudget;
    const currentExpectedProviderImageCalls =
      storyboard.directingSummary?.generationBudget
        ?.expectedProviderImageCalls ?? 0;
    if (
      approvedImageBudget &&
      (
        project.plan?.scenarioBinding
          ? currentExpectedProviderImageCalls >
            approvedImageBudget.expectedProviderImageCalls
          : approvedImageBudget.expectedProviderImageCalls !==
            currentExpectedProviderImageCalls
      )
    ) {
      add(
        'error',
        'approved-image-budget-storyboard-drift',
        project.plan?.scenarioBinding
          ? `预算审批时全片预计 ${approvedImageBudget.expectedProviderImageCalls} 次图片 provider 调用，当前 storyboard 的结构化素材子集已需要 ${currentExpectedProviderImageCalls} 次；请重新规划并审批预算。`
          : `预算审批时预计 ${approvedImageBudget.expectedProviderImageCalls} 次图片 provider 调用，当前 storyboard 预计 ${currentExpectedProviderImageCalls} 次；请重新审批预算。`,
        'plan.approvedImageBudget.expectedProviderImageCalls',
      );
    }
    if (
      approvedImageBudget &&
      approvedImageBudget.imageAttemptLimit <
        currentExpectedProviderImageCalls
    ) {
      add(
        'error',
        'approved-image-budget-insufficient',
        `当前 storyboard 预计 ${currentExpectedProviderImageCalls} 次图片 provider 调用，超过人批准上限 ${approvedImageBudget.imageAttemptLimit}。`,
        'plan.approvedImageBudget.imageAttemptLimit',
      );
    }
  }
  if (!project.editorial) {
    add('error', 'editorial-required', 'v9 项目必须包含已编译 editorial 系统。', 'editorial');
  } else {
    for (const issue of validateCompiledEditorial({
      editorial: project.editorial,
      scenes: project.scenes ?? [],
      sceneTransitions: project.sceneTransitions ?? [],
      fps: project.video?.fps,
    })) {
      add('error', issue.code, issue.message, issue.location);
    }
    for (const issue of validateEditorialTransitionExecution({
      editorial: project.editorial,
      scenes: project.scenes ?? [],
    })) {
      add('error', issue.code, issue.message, issue.location);
    }
    for (const [mediaIndex, media] of (project.editorial.media ?? []).entries()) {
      const location = `editorial.media[${mediaIndex}]`;
      try {
        const file = resolvePublicFile(media.src);
        if (!(await fileExists(file))) {
          add('error', 'editorial-media-missing', `缺少 editorial 最终本地音频：${media.src}`, `${location}.src`);
          continue;
        }
        const actualSha256 = await sha256File(file);
        if (actualSha256 !== media.sha256) {
          add('error', 'editorial-media-sha-drift', `editorial 音频 SHA-256 漂移：${media.src}`, `${location}.sha256`);
        }
        const inspected = await memoize(mediaProbeCache, file, () => probeMedia(file));
        const actualDuration = Number(inspected.format?.duration);
        if (!Number.isFinite(actualDuration) || Math.abs(actualDuration - media.durationSeconds) > 0.002) {
          add(
            'error',
            'editorial-media-duration-drift',
            `editorial 音频时长 ${media.durationSeconds}s 与实际文件 ${Number.isFinite(actualDuration) ? actualDuration.toFixed(6) : 'unknown'}s 不一致。`,
            `${location}.durationSeconds`,
          );
        }
        if (media.timingDataSrc) {
          const timingFile = resolvePublicFile(media.timingDataSrc);
          if (!(await fileExists(timingFile))) {
            add('error', 'editorial-timing-data-missing', `缺少 editorial 实际时间数据：${media.timingDataSrc}`, `${location}.timingDataSrc`);
          } else {
            const timing = JSON.parse(await fs.readFile(timingFile, 'utf8'));
            if (timing.mediaSha256 !== actualSha256 || Math.abs(Number(timing.durationSeconds) - actualDuration) > 0.002) {
              add('error', 'editorial-timing-data-media-drift', 'timingDataSrc 未绑定当前最终本地音频的 SHA-256 与实际时长。', `${location}.timingDataSrc`);
            }
            const timingCues = new Map((timing.cues ?? []).map((cue) => [cue.id, cue]));
            for (const cue of (project.editorial.cues ?? []).filter(
              (candidate) => candidate.mediaId === media.id && candidate.source === 'detected',
            )) {
              const evidence = timingCues.get(cue.id);
              if (
                !evidence ||
                evidence.kind !== cue.kind ||
                Math.abs(Number(evidence.atSeconds) - cue.atSeconds) > 1e-6
              ) {
                add('error', 'editorial-detected-cue-drift', `detected cue ${cue.id} 与 timingDataSrc 不一致。`, `${location}.timingDataSrc`);
              }
            }
          }
        }
      } catch (error) {
        add('error', 'editorial-media-proof', error.message, location);
      }
    }
  }
  for (const issue of validateSceneTransitionSequence({
    scenes: project.scenes,
    beatScenes: storyboard?.scenes ?? project.scenes,
    sceneTransitions: project.sceneTransitions,
  })) {
    add('error', issue.code, issue.message, issue.location);
  }

  const structuralErrors = issues.some(({level}) => level === 'error');
  const timeline = structuralErrors
    ? {durationInFrames: 0, durationSeconds: 0, scenes: []}
    : deriveTimeline(project);
  const sceneIds = new Set();
  const storyboardScenes = new Map((storyboard?.scenes ?? []).map((scene) => [scene.id, scene]));

  if (project.plan?.status === 'resolved' && timeline.scenes.length > 0) {
    for (const issue of assessCreativePlanTimeline(project.plan, timeline)) {
      add(issue.level, issue.code, issue.message, issue.location);
    }
  }
  if (timeline.scenes.length > 0) {
    for (const issue of assessTimelineContinuity(project, timeline)) {
      add(issue.level, issue.code, issue.message, issue.location);
    }
  }

  for (const [sceneIndex, scene] of (timeline.scenes ?? []).entries()) {
    const sceneLocation = `scenes[${sceneIndex}]`;
    if (!scene.id || sceneIds.has(scene.id)) {
      add('error', 'scene-id', '镜头 id 缺失或重复。', `${sceneLocation}.id`);
    }
    sceneIds.add(scene.id);
    const storyboardScene = storyboardScenes.get(scene.id);
    if (!storyboardScene) {
      add('error', 'storyboard-scene-missing', `storyboard 中没有镜头 ${scene.id}。`, sceneLocation);
    }
    if (!scene.motion || typeof scene.motion !== 'object') {
      add('error', 'scene-motion-required', '每个镜头必须包含 motion 蓝图和证明时刻。', `${sceneLocation}.motion`);
    } else {
      if (!STORY_BLUEPRINTS.includes(scene.motion.blueprint)) {
        add('error', 'scene-blueprint', `未知镜头蓝图：${scene.motion.blueprint}`, `${sceneLocation}.motion.blueprint`);
      }
      if (storyboardScene && scene.motion.blueprint !== storyboardScene.blueprint) {
        add('error', 'scene-blueprint-drift', '项目镜头蓝图必须与已批准故事板一致。', `${sceneLocation}.motion.blueprint`);
      }
      if (!Number.isFinite(scene.motion.intensity) || scene.motion.intensity < 0 || scene.motion.intensity > 3) {
        add('error', 'scene-motion-intensity', 'motion.intensity 必须位于 0..3。', `${sceneLocation}.motion.intensity`);
      }
      if (!Number.isInteger(scene.motion.seed)) {
        add('error', 'scene-motion-seed', 'motion.seed 必须是整数。', `${sceneLocation}.motion.seed`);
      }
      const proofs = scene.motion.proofTimes;
      if (!Array.isArray(proofs) || proofs.length < 3) {
        add('error', 'scene-proof-times', '每个镜头至少需要 3 个证明时刻。', `${sceneLocation}.motion.proofTimes`);
      }
      let previousProof = -1;
      let finalProof = false;
      const proofIds = new Set();
      for (const [proofIndex, proof] of (proofs ?? []).entries()) {
        const proofLocation = `${sceneLocation}.motion.proofTimes[${proofIndex}]`;
        if (!proof.id || proofIds.has(proof.id)) {
          add('error', 'scene-proof-id', '证明时刻 id 缺失或重复。', `${proofLocation}.id`);
        }
        proofIds.add(proof.id);
        if (!Number.isFinite(proof.at) || proof.at < 0 || proof.at > 1 || proof.at <= previousProof) {
          add('error', 'scene-proof-time', '证明时刻 at 必须位于 0..1 且严格递增。', `${proofLocation}.at`);
        }
        previousProof = proof.at;
        if (!['establish', 'action', 'peak', 'final'].includes(proof.kind)) {
          add('error', 'scene-proof-kind', `未知证明类型：${proof.kind}`, `${proofLocation}.kind`);
        }
        if (!Array.isArray(proof.assertions) || proof.assertions.length === 0) {
          add('error', 'scene-proof-assertions', '证明时刻必须包含可见关系断言。', `${proofLocation}.assertions`);
        }
        if (proof.kind === 'final' && proof.at >= 0.82) finalProof = true;
        if (
          proofOverlapsTransition({
            at: proof.at,
            enterTransitionFrames: scene.enterTransitionFrames,
            exitTransitionFrames: scene.exitTransitionFrames,
            durationInFrames: scene.durationInFrames,
          })
        ) {
          add(
            'error',
            'scene-proof-transition-overlap',
            '证明时刻不能落在场景边界转场区内。',
            `${proofLocation}.at`,
          );
        }
      }
      if (!finalProof) add('error', 'scene-final-proof', '镜头必须在 0.82 之后包含 final 证明时刻。', `${sceneLocation}.motion.proofTimes`);
      const proofDrift =
        storyboardScene &&
        (proofs?.length !== storyboardScene.proofTimes.length ||
          proofs?.some((proof, index) => {
            const approved = storyboardScene.proofTimes[index];
            const actualStateAssertions = new Set(
              (proof.stateAssertions ?? []).map(
                ({nodeId, stateId}) => `${nodeId}\u0000${stateId}`,
              ),
            );
            const preservesApprovedStateAssertions =
              (approved.stateAssertions ?? []).every(
                ({nodeId, stateId}) =>
                  actualStateAssertions.has(`${nodeId}\u0000${stateId}`),
              );
            return (
              proof.id !== approved.id ||
              proof.at !== approved.at ||
              proof.label !== approved.label ||
              proof.kind !== approved.kind ||
              JSON.stringify(proof.assertions) !== JSON.stringify(approved.assertions) ||
              !preservesApprovedStateAssertions
            );
          }));
      if (proofDrift) {
        add('error', 'scene-proof-drift', '项目证明时刻必须保留已批准故事板的时刻、可见断言与全部状态断言；执行树可以在同一证明时刻追加新资产的注册状态覆盖。', `${sceneLocation}.motion.proofTimes`);
      }
    }
    if (scene.durationInFrames <= 0) {
      add('error', 'scene-duration', '镜头计算时长必须大于 0。', sceneLocation);
    }
    if (!Number.isFinite(scene.tailSeconds) || scene.tailSeconds < 0) {
      add('error', 'scene-tail', 'tailSeconds 必须是非负秒数。', `${sceneLocation}.tailSeconds`);
    }
    if (scene.appearance?.surfaceTexture && (
      typeof scene.appearance.surfaceTexture.visible !== 'boolean' ||
      !Number.isFinite(scene.appearance.surfaceTexture.opacity) ||
      scene.appearance.surfaceTexture.opacity < 0 ||
      scene.appearance.surfaceTexture.opacity > 1 ||
      !['normal', 'multiply', 'screen', 'overlay'].includes(scene.appearance.surfaceTexture.blendMode)
    )) add('error', 'scene-appearance-texture', 'appearance.surfaceTexture 无效。', `${sceneLocation}.appearance.surfaceTexture`);
    if (scene.appearance?.chapter && (
      typeof scene.appearance.chapter.visible !== 'boolean' ||
      (scene.appearance.chapter.variant !== undefined && !['plain', 'paper-tab'].includes(scene.appearance.chapter.variant))
    )) add('error', 'scene-appearance-chapter', 'appearance.chapter 无效。', `${sceneLocation}.appearance.chapter`);
    if (scene.appearance?.subtitles) {
      const subtitleAppearance = scene.appearance.subtitles;
      if (!['boxed', 'plain', 'hidden'].includes(subtitleAppearance.variant)) {
        add('error', 'scene-appearance-subtitles', 'appearance.subtitles.variant 无效。', `${sceneLocation}.appearance.subtitles.variant`);
      }
      if (
        subtitleAppearance.fontFamily !== undefined &&
        (
          typeof subtitleAppearance.fontFamily !== 'string' ||
          subtitleAppearance.fontFamily.trim().length === 0
        )
      ) {
        add('error', 'scene-appearance-subtitle-font-family', 'appearance.subtitles.fontFamily 必须是非空字体栈。', `${sceneLocation}.appearance.subtitles.fontFamily`);
      }
      if (
        subtitleAppearance.fontWeight !== undefined &&
        (
          !Number.isInteger(subtitleAppearance.fontWeight) ||
          subtitleAppearance.fontWeight < 400 ||
          subtitleAppearance.fontWeight > 800
        )
      ) {
        add('error', 'scene-appearance-subtitle-font-weight', 'appearance.subtitles.fontWeight 必须是 400..800 的整数。', `${sceneLocation}.appearance.subtitles.fontWeight`);
      }
      if (
        subtitleAppearance.edgeTreatment !== undefined &&
        !['soft-shadow', 'crisp-outline', 'none'].includes(
          subtitleAppearance.edgeTreatment,
        )
      ) {
        add('error', 'scene-appearance-subtitle-edge-treatment', 'appearance.subtitles.edgeTreatment 无效。', `${sceneLocation}.appearance.subtitles.edgeTreatment`);
      }
    }

    const narrationLocation = `${sceneLocation}.narration`;
    let narrationTiming = null;
    if (!Number.isFinite(scene.narration?.startSeconds) || scene.narration.startSeconds < 0) {
      add('error', 'narration-start', 'narration.startSeconds 必须是非负秒数。', `${narrationLocation}.startSeconds`);
    }
    try {
      const narrationFile = resolvePublicFile(scene.narration?.src ?? '');
      if (!(await fileExists(narrationFile))) {
        add('error', 'narration-missing', `缺少旁白：${scene.narration?.src}`, narrationLocation);
      } else {
        const probe = await memoize(mediaProbeCache, narrationFile, () =>
          probeMedia(narrationFile),
        );
        const durationSeconds = Number(probe.format?.duration ?? 0);
        assets.push({kind: 'narration', src: scene.narration.src, durationSeconds});
        if (Math.abs(durationSeconds - scene.narration.durationSeconds) > 0.08) {
          add(
            'warning',
            'narration-duration',
            `配置为 ${scene.narration.durationSeconds}s，实测为 ${durationSeconds.toFixed(3)}s；请运行 project:sync。`,
            `${narrationLocation}.durationSeconds`,
          );
        }
      }
    } catch (error) {
      add('error', 'narration-probe', error.message, narrationLocation);
    }
    if (scene.narration?.timingSrc) {
      try {
        const timingFile = resolvePublicFile(scene.narration.timingSrc);
        if (!(await fileExists(timingFile))) {
          add(
            'error',
            'narration-timing-missing',
            `缺少旁白时间戳：${scene.narration.timingSrc}`,
            `${narrationLocation}.timingSrc`,
          );
        } else {
          narrationTiming = await readJson(timingFile);
        }
      } catch (error) {
        add('error', 'narration-timing-path', error.message, `${narrationLocation}.timingSrc`);
      }
    }

    const compositionResult = validateCompositionStructure({
      composition: scene.composition,
      video: project.video,
      proofTimes: scene.motion?.proofTimes ?? [],
      durationSeconds: scene.durationInFrames / project.video.fps,
      location: `${sceneLocation}.composition`,
      editorial: project.editorial,
      sceneId: scene.id,
      exclusionZones:
        project.editorial?.responsiveProfiles?.find(
          ({id}) => id === project.editorial.activeProfile,
        )?.exclusionZones ?? [],
      safeArea:
        project.editorial?.responsiveProfiles?.find(
          ({id}) => id === project.editorial.activeProfile,
        )?.safeArea ?? {x: 0, y: 0, width: 1, height: 1},
    });
    for (const issue of compositionResult.issues) {
      add(issue.level, issue.code, issue.message, issue.location);
    }
    for (const issue of validateCameraFollow({
      scene,
      video: project.video,
    })) {
      add(
        'error',
        issue.code,
        issue.message,
        `${sceneLocation}.${issue.location}`,
      );
    }

    const actualPatterns = new Set(
      compositionResult.groups
        .filter(
          ({renderParticipation}) => renderParticipation === 'visible',
        )
        .map(({node}) => node.pattern),
    );
    if (compositionResult.freeNodes.length > 0) {
      actualPatterns.add('free');
    }

    const actualSequences = new Map(
      compositionResult.sequences
        .filter(
          ({node}) =>
            !compositionResult.derivationOnlyNodeIds.has(node.id),
        )
        .map(({node}) => [node.id, node]),
    );
    for (const planned of storyboardScene?.compositionPlan?.stateSequences ?? []) {
      const actual = actualSequences.get(planned.nodeId);
      if (!actual) {
        add('error', 'composition-sequence-drift', `故事板要求状态序列 ${planned.nodeId}，项目镜头没有实现。`, `${sceneLocation}.composition`);
        continue;
      }
      if (!stateSequenceMatchesStoryboardPlan(actual, planned)) {
        add('error', 'composition-sequence-drift', `状态序列 ${planned.nodeId} 与故事板计划不一致。`, `${sceneLocation}.composition`);
      }
    }

    for (const {node, parent} of compositionResult.sequences) {
      const nodeLocation = `${sceneLocation}.composition.nodes#${node.id}`;
      for (const state of node.states) {
        try {
          const assetFile = resolvePublicFile(state.src);
          if (!(await fileExists(assetFile))) {
            add('error', 'composition-sequence-state-missing', `缺少状态素材：${state.src}`, `${nodeLocation}.states#${state.id}.src`);
            continue;
          }
          const inspection = await memoize(characterInspectionCache, assetFile, () => inspectCharacterPng(assetFile));
          const alphaBandInspection = await inspectRectangularAlphaBands({
            file: assetFile,
            source: state.src,
            location: `${nodeLocation}.states#${state.id}.src`,
          });
          assets.push({kind: node.assetRole, src: state.src, sceneId: scene.id, nodeId: node.id, stateId: state.id, parentId: parent?.id ?? null, registrationId: node.registration.id, alphaBandInspection, ...inspection});
          if (!inspection.hasAlpha || inspection.transparentPixels === 0) add('error', 'composition-sequence-state-alpha', '状态素材必须包含有效透明区域。', `${nodeLocation}.states#${state.id}.src`);
          const {width, height} = node.registration.canvas;
          if (inspection.width !== width || inspection.height !== height) add('error', 'composition-sequence-state-dimensions', `状态必须与注册画布 ${width}x${height} 完全一致，当前为 ${inspection.width}x${inspection.height}。`, `${nodeLocation}.states#${state.id}.src`);
        } catch (error) {
          add('error', 'composition-sequence-state-inspect', error.message, `${nodeLocation}.states#${state.id}.src`);
        }
      }
    }
    for (const pattern of storyboardScene?.compositionPlan?.patterns ?? []) {
      if (!actualPatterns.has(pattern)) {
        add(
          'error',
          'composition-pattern-drift',
          `故事板要求组合模式 ${pattern}，项目镜头没有实现。`,
          `${sceneLocation}.composition`,
        );
      }
    }

    for (const issue of validateDirectingExecution({scene, storyboardScene, location: sceneLocation})) {
      add('error', issue.code, issue.message, issue.location);
    }

    for (const {node, parent} of compositionResult.assets) {
      const nodeLocation = `${sceneLocation}.composition.nodes#${node.id}`;
      try {
        const assetFile = resolvePublicFile(node.src);
        if (!(await fileExists(assetFile))) {
          add('error', 'composition-asset-missing', `缺少组合素材：${node.src}`, `${nodeLocation}.src`);
          continue;
        }
        const isCutout = ['character', 'prop'].includes(node.assetRole);
        const inspection = await memoize(
          isCutout ? characterInspectionCache : backgroundInspectionCache,
          assetFile,
          () => isCutout ? inspectCharacterPng(assetFile) : inspectBackground(assetFile),
        );
        const alphaBandInspection = isCutout
          ? await inspectRectangularAlphaBands({
              file: assetFile,
              source: node.src,
              location: `${nodeLocation}.src`,
            })
          : null;
        assets.push({
          kind: node.assetRole,
          src: node.src,
          sceneId: scene.id,
          nodeId: node.id,
          parentId: parent?.id ?? null,
          registrationId: node.registrationId ?? null,
          alphaBandInspection,
          ...inspection,
        });
        if (isCutout && (!inspection.hasAlpha || inspection.transparentPixels === 0)) {
          add('error', 'composition-asset-alpha', '人物或道具素材必须包含有效透明区域。', `${nodeLocation}.src`);
        }
        if (isCutout && inspection.keyEdgeRatio > 0.12) {
          add(
            'warning',
            'composition-key-edge',
            `可见半透明边缘中 ${(inspection.keyEdgeRatio * 100).toFixed(1)}% 疑似残留色键 ${inspection.keyColor ?? ''}。`,
            `${nodeLocation}.src`,
          );
        }
        if (parent?.registration) {
          const {width, height} = parent.registration.canvas;
          if (inspection.width !== width || inspection.height !== height) {
            add(
              'error',
              'composition-registration-dimensions',
              `注册成员必须与母版画布 ${width}x${height} 完全一致，当前为 ${inspection.width}x${inspection.height}。`,
              `${nodeLocation}.src`,
            );
          }
        } else if (['background', 'environment'].includes(node.assetRole)) {
          const requiredWidth = project.video.width * project.quality.minimumAssetScale;
          const requiredHeight = project.video.height * project.quality.minimumAssetScale;
          if (inspection.width < requiredWidth || inspection.height < requiredHeight) {
            add(
              'error',
              'composition-asset-scale',
              `场景素材至少需要 ${Math.ceil(requiredWidth)}x${Math.ceil(requiredHeight)}，当前为 ${inspection.width}x${inspection.height}。`,
              `${nodeLocation}.src`,
            );
          }
        }
      } catch (error) {
        add('error', 'composition-asset-inspect', error.message, `${nodeLocation}.src`);
      }
    }
    if (manifest) {
      for (const {node: group} of compositionResult.groups.filter(
        ({node}) =>
          ['supported-subject', 'registered-depth-stack'].includes(
            node.pattern,
          ),
      )) {
        const groupLocation = `${sceneLocation}.composition.nodes#${group.id}`;
        const members = (group.children ?? [])
          .filter(({kind}) => ['asset', 'state-sequence'].includes(kind))
          .map((node) => ({
            node,
            records:
              node.kind === 'state-sequence'
                ? node.states.map(({src}) => manifestRecordForSource(src))
                : [manifestRecordForSource(node.src)],
          }));
        const result = assertRegisteredFamilyGroupMembers({
          group,
          members,
          allRecords: activeManifestAssets(manifest),
        });
        if (!result.passed) {
          add(
            'error',
            'composition-registered-family',
            `${group.pattern} 必须消费三成员、层完整、共享注册画布族：${result.errors.join('；')}`,
            groupLocation,
          );
        }
      }
      for (const {node: group} of compositionResult.groups.filter(
        ({node}) => node.pattern === 'canonical-container',
      )) {
        const result =
          await inspectCanonicalContainerGroupMembers({
            root: ROOT,
            group,
            manifest,
          });
        if (!result.passed) {
          add(
            'error',
            'composition-canonical-container-family',
            `canonical-container 必须消费唯一 frame、clean plate、完整内容状态表、同一内腔 mask 与当前本地派生状态：${result.errors.join('；')}`,
            `${sceneLocation}.composition.nodes#${group.id}`,
          );
        }
      }
    }

    for (const {node, parent} of compositionResult.motifFields) {
      const nodeLocation = `${sceneLocation}.composition.nodes#${node.id}`;
      for (const motif of node.motifs ?? []) {
        try {
          const assetFile = resolvePublicFile(motif.src);
          if (!(await fileExists(assetFile))) {
            add('error', 'composition-motif-missing', `缺少 motif 素材：${motif.src}`, `${nodeLocation}.motifs#${motif.id}.src`);
            continue;
          }
          const inspection = await memoize(
            backgroundInspectionCache,
            assetFile,
            () => inspectBackground(assetFile),
          );
          assets.push({
            kind: 'decorative',
            src: motif.src,
            sceneId: scene.id,
            nodeId: node.id,
            motifId: motif.id,
            parentId: parent?.id ?? null,
            ...inspection,
          });
        } catch (error) {
          add('error', 'composition-motif-inspect', error.message, `${nodeLocation}.motifs#${motif.id}.src`);
        }
      }
    }

    for (const {node} of compositionResult.groups) {
      for (const boundary of node.boundaries ?? []) {
        for (const [side, maskSrc] of [
          ['upper', boundary.upperMaskSrc],
          ['lower', boundary.lowerMaskSrc],
        ]) {
          if (!maskSrc) continue;
          const maskLocation = `${sceneLocation}.composition.nodes#${node.id}.boundaries#${boundary.id}.${side}MaskSrc`;
          try {
            const maskFile = resolvePublicFile(maskSrc);
            if (!(await fileExists(maskFile))) {
              add('error', 'composition-boundary-mask-missing', `缺少边界 mask：${maskSrc}`, maskLocation);
              continue;
            }
            const inspection = await memoize(backgroundInspectionCache, maskFile, () => inspectBackground(maskFile));
            if (inspection.width !== node.registration?.canvas.width || inspection.height !== node.registration?.canvas.height) {
              add('error', 'composition-boundary-mask-dimensions', '边界 mask 必须与注册母版画布完全一致。', maskLocation);
            }
          } catch (error) {
            add('error', 'composition-boundary-mask-inspect', error.message, maskLocation);
          }
        }
      }
    }

    if (!scene.camera) {
      add('error', 'camera-required', '每个镜头必须显式配置 camera。', `${sceneLocation}.camera`);
    }
    const cameraKeyframes = scene.camera?.keyframes ?? [];
    for (let index = 0; index < cameraKeyframes.length; index += 1) {
      const keyframe = cameraKeyframes[index];
      if (keyframe.at < 0 || keyframe.at > 1) {
        add('error', 'camera-keyframe-at', 'camera keyframe.at 必须位于 0 到 1。', `${sceneLocation}.camera.keyframes[${index}].at`);
      }
      if (index > 0 && keyframe.at <= cameraKeyframes[index - 1].at) {
        add('error', 'camera-keyframe-order', 'camera keyframes 必须按 at 严格递增。', `${sceneLocation}.camera.keyframes[${index}].at`);
      }
    }
    for (const issue of validateParallaxRig({
      camera: scene.camera,
      composition: scene.composition,
      location: `${sceneLocation}.camera.parallax`,
    })) {
      add(issue.level, issue.code, issue.message, issue.location);
    }

    if (!Array.isArray(scene.events) || scene.events.length === 0) {
      add('error', 'scene-events-required', '每个镜头必须包含与故事节拍对应的 events。', `${sceneLocation}.events`);
    }
    if (scene.audioEvents !== undefined) {
      add('error', 'unsupported-audio-events', 'v9 只允许 scene.events 作为视听事件源。', `${sceneLocation}.audioEvents`);
    }
    const eventIds = new Set();
    const eventBeatIds = new Set();
    const validTargets = new Set(compositionResult.nodeIds);
    const nodesById = new Map(flattenCompositionNodes(scene.composition?.nodes).map(({node}) => [node.id, node]));
    const proofTimesById = new Map((scene.motion?.proofTimes ?? []).map((proof) => [proof.id, proof]));
    const storyboardBeats = new Map((storyboardScene?.beats ?? []).map((beat) => [beat.id, beat]));
    let previousEventAt = -1;
    for (const [eventIndex, event] of (scene.events ?? []).entries()) {
      const eventLocation = `${sceneLocation}.events[${eventIndex}]`;
      if (!event.id || eventIds.has(event.id)) add('error', 'scene-event-id', 'event id 缺失或重复。', `${eventLocation}.id`);
      eventIds.add(event.id);
      if (!event.beatId) add('error', 'scene-event-beat', '每个 event 必须对应一个 beatId。', `${eventLocation}.beatId`);
      eventBeatIds.add(event.beatId);
      const beat = storyboardBeats.get(event.beatId);
      if (!beat) add('error', 'scene-event-beat-missing', `故事板中没有节拍 ${event.beatId}。`, `${eventLocation}.beatId`);
      if (!Number.isFinite(event.at) || event.at < 0 || event.at > 1) add('error', 'scene-event-time', 'event.at 必须位于 0..1。', `${eventLocation}.at`);
      if (Number.isFinite(event.at) && event.at < previousEventAt) add('error', 'scene-event-order', 'events 必须按 at 非递减排列。', `${eventLocation}.at`);
      previousEventAt = Number.isFinite(event.at) ? event.at : previousEventAt;
      const visualSfxPlan = storyboardScene?.compositionPlan?.graphics?.find(
        (graphic) =>
          graphic.role === 'visual-sfx' &&
          graphic.nodeId === event.targetId &&
          graphic.beatId === event.beatId,
      );
      const expectedVisualSfxHideAt = visualSfxPlan
        ? Math.min(
            1,
            visualSfxPlan.at +
              visualSfxPlan.durationSeconds /
                Math.max(0.001, scene.durationInFrames / project.video.fps),
          )
        : null;
      const isVisualSfxHide =
        visualSfxPlan &&
        event.visual?.kind === 'visibility' &&
        event.visual.action === 'hide' &&
        event.visual.transition === 'fade-scale' &&
        Math.abs(event.at - expectedVisualSfxHideAt) <= 0.035;
      if (beat && !isVisualSfxHide && Math.abs(event.at - beat.at) > 0.035) {
        add(
          'error',
          'scene-event-drift',
          'event.at 必须与故事板节拍保持在 0.035 以内；visual-sfx hide 必须位于其编译持续时间末端。',
          `${eventLocation}.at`,
        );
      }
      if (beat?.proofTimeId && event.proofTimeId !== beat.proofTimeId) {
        add(
          'error',
          'scene-event-proof-drift',
          `event 必须使用故事板节拍批准的证明时刻 ${beat.proofTimeId}。`,
          `${eventLocation}.proofTimeId`,
        );
      }
      const visual = event.visual;
      if (compositionResult.derivationOnlyNodeIds.has(event.targetId)) {
        add(
          'error',
          'scene-event-derivation-only-target',
          `event 不能指向不参与渲染的 derivation-only 节点：${event.targetId}`,
          `${eventLocation}.targetId`,
        );
      } else if (!validTargets.has(event.targetId) && !(event.targetId === 'scene' && visual?.kind === 'hold')) add('error', 'scene-event-target', `event 目标必须是存在的组合节点；只有 hold 可使用 scene：${event.targetId}`, `${eventLocation}.targetId`);
      if (visual === null) {
        if (!event.sound) add('error', 'scene-event-empty', 'visual=null 的 event 必须包含 sound。', `${eventLocation}.visual`);
      } else if (visual?.kind === 'visibility') {
        if (!['show', 'hide'].includes(visual.action)) add('error', 'scene-event-visibility-action', 'visibility action 必须是 show 或 hide。', `${eventLocation}.visual.action`);
        if (!['cut', 'fade-rise', 'fade-scale'].includes(visual.transition)) add('error', 'scene-event-visibility-transition', 'visibility transition 无效。', `${eventLocation}.visual.transition`);
        if (visual.transition === 'cut' ? visual.durationSeconds !== 0 : !isPositiveNumber(visual.durationSeconds)) add('error', 'scene-event-visibility-duration', 'cut 时长必须为 0，其他可见性转场时长必须大于 0。', `${eventLocation}.visual.durationSeconds`);
      } else if (visual?.kind === 'emphasis') {
        if (!EMPHASIS_ACTIONS.includes(visual.action)) add('error', 'scene-event-emphasis-action', `未知 emphasis action：${visual.action}`, `${eventLocation}.visual.action`);
        if (!isPositiveNumber(visual.durationSeconds)) add('error', 'scene-event-emphasis-duration', 'emphasis.durationSeconds 必须大于 0。', `${eventLocation}.visual.durationSeconds`);
        if (!Number.isFinite(visual.intensity) || visual.intensity < 0 || visual.intensity > 3) add('error', 'scene-event-emphasis-intensity', 'emphasis.intensity 必须位于 0..3。', `${eventLocation}.visual.intensity`);
      } else if (visual?.kind === 'hold') {
        if (!isPositiveNumber(visual.durationSeconds)) add('error', 'scene-event-hold-duration', 'hold.durationSeconds 必须大于 0。', `${eventLocation}.visual.durationSeconds`);
      } else {
        add('error', 'scene-event-visual-kind', `未知 event visual kind：${visual?.kind}`, `${eventLocation}.visual`);
      }
      if (
        visual?.kind !== 'visibility' &&
        Number.isFinite(event.at) &&
        Number.isFinite(visual?.durationSeconds) &&
        event.at * (scene.durationInFrames / project.video.fps) + visual.durationSeconds >
          scene.durationInFrames / project.video.fps + 1e-6
      ) {
        add('error', 'scene-event-window-overflow', 'event 动作窗口不得超出镜头结尾。', `${eventLocation}.visual.durationSeconds`);
      }
      if (event.proofTimeId) {
        const proof = proofTimesById.get(event.proofTimeId);
        if (!proof) {
          add('error', 'scene-event-proof-missing', `event 绑定的证明时刻不存在：${event.proofTimeId}`, `${eventLocation}.proofTimeId`);
        } else {
          const proofWindow = resolveEventProofWindow({
            event,
            eventIndex,
            events: scene.events ?? [],
            sceneDurationSeconds: scene.durationInFrames / project.video.fps,
          });
          if (proof.at < proofWindow.start - 0.01 || proof.at > proofWindow.end + 0.01) {
            const message = proofWindow.mode === 'persistent-visibility'
              ? 'visibility 证明时刻必须位于动作开始后、同一目标下一次显隐变化前。'
              : '绑定的证明时刻必须落在 event 动作窗口内。';
            add('error', 'scene-event-proof-window', message, `${eventLocation}.proofTimeId`);
          }
        }
      }
      if (event.sound) {
        try {
          if (!(await fileExists(resolvePublicFile(event.sound.src)))) add('error', 'scene-event-sound-missing', `缺少 event 音效：${event.sound.src}`, `${eventLocation}.sound.src`);
        } catch (error) {
          add('error', 'scene-event-sound-path', error.message, `${eventLocation}.sound.src`);
        }
      }
    }
    for (const [beatId, beat] of storyboardBeats) {
      const beatEvents = (scene.events ?? []).filter((event) => event.beatId === beatId);
      if (!eventBeatIds.has(beatId)) add('error', 'scene-event-coverage', `故事板节拍 ${beatId} 没有执行 event。`, `${sceneLocation}.events`);
      if (beat.soundCue && !beatEvents.some(({sound}) => Boolean(sound))) add('error', 'scene-event-sound-required', `节拍要求事件音效 ${beat.soundCue}，至少一个对应 event 必须配置 sound；旁白不使用 soundCue。`, `${sceneLocation}.events`);
    }
    const visibilityInitialStates = Object.fromEntries(
      [...nodesById].map(([id, node]) => [id, node.visibility?.initial ?? 'visible']),
    );
    for (const issue of validateVisibilityLifecycle({
      events: scene.events ?? [],
      targetInitialStates: visibilityInitialStates,
      durationSeconds: scene.durationInFrames / project.video.fps,
    })) {
      add(
        'error',
        issue.code,
        issue.message,
        `${sceneLocation}.events[${issue.eventIndex}].visual`,
      );
    }
    for (const encounterIssue of validateEncounterExecution({
      scene,
      storyboardScene,
      nodesById,
      narrationTiming,
      fps: project.video.fps,
      location: sceneLocation,
    })) {
      add(
        'error',
        encounterIssue.code,
        encounterIssue.message,
        encounterIssue.location,
      );
    }

    let previousSubtitleEnd = -1;
    for (const [subtitleIndex, subtitle] of (scene.subtitles ?? []).entries()) {
      const subtitleLocation = `${sceneLocation}.subtitles[${subtitleIndex}]`;
      if (
        subtitle.fromSeconds < 0 ||
        subtitle.toSeconds <= subtitle.fromSeconds
      ) {
        add('error', 'subtitle-range', '字幕秒数范围无效。', subtitleLocation);
      }
      if (subtitle.toSeconds > scene.durationInFrames / project.video.fps) {
        add('warning', 'subtitle-overflow', '字幕超过镜头结束时间。', subtitleLocation);
      }
      if (subtitle.fromSeconds < previousSubtitleEnd) {
        add('warning', 'subtitle-overlap', '字幕时间发生重叠。', subtitleLocation);
      }
      const characterCount = [...String(subtitle.text ?? '').replace(/\s/g, '')].length;
      const visibleSeconds = subtitle.toSeconds - subtitle.fromSeconds;
      const readingRate = visibleSeconds > 0 ? characterCount / visibleSeconds : Infinity;
      const maximumCharacters =
        project.video.width / project.video.height >= 1 ? 32 : 18;
      if (characterCount > maximumCharacters) {
        add(
          'warning',
          'subtitle-length',
          `字幕含 ${characterCount} 个字符，超过当前画幅建议的 ${maximumCharacters} 个字符。`,
          `${subtitleLocation}.text`,
        );
      }
      if (readingRate > 12) {
        add(
          'warning',
          'subtitle-reading-rate',
          `字幕阅读速度约 ${readingRate.toFixed(1)} 字/秒，建议拆分或延长显示。`,
          subtitleLocation,
        );
      }
      previousSubtitleEnd = Math.max(previousSubtitleEnd, subtitle.toSeconds);
    }
  }

  const sharedAssets = [
    project.theme?.surface?.texture?.src,
    project.theme?.fontFile,
    project.audio?.music?.src,
  ].filter(Boolean);
  for (const asset of sharedAssets) {
    try {
      if (!(await fileExists(resolvePublicFile(asset)))) {
        add('error', 'shared-asset-missing', `缺少共享素材：${asset}`, 'audio/theme');
      }
    } catch (error) {
      add('error', 'shared-asset-path', error.message, 'audio/theme');
    }
  }
  if (project.theme?.fontFile) {
    try {
      const fontFile = resolvePublicFile(project.theme.fontFile);
      if (await fileExists(fontFile)) {
        const header = await fs.readFile(fontFile);
        const signature = header.subarray(0, 4);
        const extension = path.extname(fontFile).toLowerCase();
        const valid =
          (extension === '.woff2' && signature.toString('ascii') === 'wOF2') ||
          (extension === '.woff' && signature.toString('ascii') === 'wOFF') ||
          (extension === '.otf' && signature.toString('ascii') === 'OTTO') ||
          (
            extension === '.ttf' &&
            (
              signature.equals(Buffer.from([0x00, 0x01, 0x00, 0x00])) ||
              signature.toString('ascii') === 'true'
            )
          );
        if (!valid) {
          add(
            'error',
            'font-load-invalid',
            `字体文件头与扩展名不匹配，Chromium 无法确定性加载：${project.theme.fontFile}`,
            'theme.fontFile',
          );
        }
      }
    } catch (error) {
      add('error', 'font-load-inspection', error.message, 'theme.fontFile');
    }
  }

  const profileHardCeiling =
    project.plan?.assetBudget?.maxGeneratedImages ?? null;
  const approvedImageAttemptLimit =
    project.plan?.approvedImageBudget?.imageAttemptLimit ?? null;
  const expectedProviderImageCalls =
    project.plan?.approvedImageBudget?.expectedProviderImageCalls ?? null;
  const attempts = await readGenerationAttemptEvents(project.slug);
  const usage = attempts.exists
    ? summarizeGenerationAttempts(attempts.events)
    : {used: 0, reserved: 0, closed: 0, attempts: [], byStatus: {}};
  const providerBudget = {
    profileHardCeiling,
    approvedImageAttemptLimit,
    expectedProviderImageCalls,
    used: usage.used,
    reserved: usage.reserved,
  };
  const providerRealization = project.plan?.scenarioBinding
    ? assessProviderRootRealization({
        scenarioBinding: project.plan.scenarioBinding,
        manifest: manifest ?? {assets: []},
      })
    : null;
  for (const message of providerRealization?.issues ?? []) {
    add(
      'error',
      'provider-root-realization-incomplete',
      message,
      'plan.scenarioBinding.providerRootPlan',
    );
  }
  if (usage.reserved > 0) {
    add(
      'error',
      'asset-budget-reservations-open',
      `仍有 ${usage.reserved} 次生图额度处于 reserved；请登记结果或显式关闭尝试。`,
      'generation-attempts.jsonl',
    );
  }
  if (
    (usage.used > 0 || usage.reserved > 0) &&
    !Number.isInteger(approvedImageAttemptLimit)
  ) {
    add(
      'error',
      'approved-image-budget-missing',
      '尝试账本已有图片 provider 活动，但项目没有人批准的图片尝试上限。',
      'plan.approvedImageBudget',
    );
  } else if (
    Number.isInteger(approvedImageAttemptLimit) &&
    usage.used > approvedImageAttemptLimit
  ) {
    add(
      'error',
      'asset-budget-exceeded',
      `人批准上限为 ${approvedImageAttemptLimit} 次计费生图，尝试账本已记录 ${usage.used} 次。`,
      'plan.approvedImageBudget.imageAttemptLimit',
    );
  }
  if (!attempts.exists && await fileExists(manifestFile)) {
    const manifest = await readJson(manifestFile);
    const generatedImages = countProviderGeneratedImages(manifest.assets);
    providerBudget.used = generatedImages;
    if (
      generatedImages > 0 &&
      !Number.isInteger(approvedImageAttemptLimit)
    ) {
      add(
        'error',
        'approved-image-budget-missing',
        `manifest 已记录 ${generatedImages} 张 provider 图片，但项目没有人批准的图片尝试上限。`,
        'plan.approvedImageBudget',
      );
    } else if (
      Number.isInteger(approvedImageAttemptLimit) &&
      generatedImages > approvedImageAttemptLimit
    ) {
      add(
        'error',
        'asset-budget-exceeded',
        `人批准上限为 ${approvedImageAttemptLimit} 张生成图，manifest 已记录 ${generatedImages} 张。`,
        'plan.approvedImageBudget.imageAttemptLimit',
      );
    }
  }

  for (const issue of validateProductionContracts(project)) {
    add(issue.level, issue.code, issue.message, issue.location);
  }
  for (const issue of await validateSpatialContracts(project)) {
    add(issue.level, issue.code, issue.message, issue.location);
  }

  const errors = issues.filter(({level}) => level === 'error').length;
  const warnings = issues.filter(({level}) => level === 'warning').length;
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    project: {slug: project.slug, title: project.title},
    plan: project.plan ?? null,
    providerBudget,
    providerRealization,
    passed: errors === 0,
    summary: {errors, warnings, assetCount: assets.length},
    timeline,
    assets,
    issues,
    options,
  };
};

export const writeValidationReport = async (slug, report) => {
  const paths = projectPaths(slug);
  await writeJson(paths.validationReport, report);
  return paths.validationReport;
};

export const formatValidation = (report) => {
  const lines = [
    `${report.passed ? '✓' : '✗'} ${report.project.slug}: ${report.summary.errors} errors, ${report.summary.warnings} warnings`,
    `  ${report.timeline.durationInFrames} frames / ${report.timeline.durationSeconds.toFixed(3)}s`,
  ];
  for (const issue of report.issues) {
    const marker = issue.level === 'error' ? 'ERROR' : 'WARN ';
    lines.push(`  ${marker} ${issue.location}: ${issue.message}`);
  }
  return lines.join('\n');
};

export const runCommand = async (command, args, options = {}) => {
  const {stdout, stderr} = await execFileAsync(command, args, {
    cwd: ROOT,
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
  return {stdout, stderr};
};

export {fileExists};
