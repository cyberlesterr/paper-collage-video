import {execFile} from 'node:child_process';
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
import {
  loadStoryboard,
  STORY_BLUEPRINTS,
  validateStoryboard,
} from './storyboard-lib.mjs';

const execFileAsync = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(scriptDirectory, '..');
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const resolveRenderConcurrency = (
  parallelism = availableParallelism(),
  maximum = 8,
) => Math.max(1, Math.min(maximum, Math.floor(parallelism)));

export const projectPaths = (slug) => ({
  slug,
  projectDirectory: path.join(ROOT, 'projects', slug),
  projectFile: path.join(ROOT, 'projects', slug, 'project.json'),
  productionFile: path.join(ROOT, 'projects', slug, 'production.json'),
  storyboardFile: path.join(ROOT, 'projects', slug, 'storyboard.json'),
  reviewFile: path.join(ROOT, 'projects', slug, 'review.md'),
  publicDirectory: path.join(ROOT, 'public', 'projects', slug),
  distDirectory: path.join(ROOT, 'dist', slug),
  validationReport: path.join(ROOT, 'dist', slug, 'validation-report.json'),
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
  if (project.schemaVersion !== 3) {
    throw new Error('project.json 必须使用 schemaVersion 3；请重新创建项目。');
  }
  return {paths, project};
};

export const deriveTimeline = (project) => {
  let cursor = 0;
  const fps = Number(project.video?.fps ?? 30);
  const scenes = (project.scenes ?? []).map((scene, index) => {
    const narrationFrames = Math.ceil(
      Number(scene.narration?.durationSeconds ?? 0) * fps,
    );
    const narrationStartFrame = Math.round(
      Number(scene.narration?.startSeconds ?? 0) * fps,
    );
    const tailFrames = Math.ceil(Number(scene.tailSeconds ?? 0) * fps);
    const durationInFrames = narrationStartFrame + narrationFrames + tailFrames;
    const sceneTransitionFrames =
      scene.transition?.type === 'none'
        ? 0
        : Math.round(Number(scene.transition?.durationSeconds ?? 0) * fps);
    const from = index === 0 ? 0 : Math.max(0, cursor - sceneTransitionFrames);
    cursor = from + durationInFrames;
    return {
      ...scene,
      from,
      durationInFrames,
      narrationFrames,
      narrationStartFrame,
      transitionFrames: sceneTransitionFrames,
    };
  });
  return {durationInFrames: cursor, durationSeconds: cursor / fps, scenes};
};

export const proofOverlapsTransition = ({
  at,
  transitionFrames,
  durationInFrames,
}) => {
  const transitionRatio = transitionFrames / Math.max(1, durationInFrames);
  return at < transitionRatio || at > 1 - transitionRatio;
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
  const keyColor = keySampleCount
    ? [
        (transparentPixels ? transparentRed : lowAlphaRed) / keySampleCount,
        (transparentPixels ? transparentGreen : lowAlphaGreen) / keySampleCount,
        (transparentPixels ? transparentBlue : lowAlphaBlue) / keySampleCount,
      ]
    : null;
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

const MOTION_EASES = ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'hold'];
const CUE_ACTIONS = ['reveal', 'pulse', 'stamp', 'shake', 'lift', 'settle'];

const validateMotionKeyframes = (keyframes, location, add) => {
  if (!Array.isArray(keyframes) || keyframes.length < 2) {
    add('error', 'motion-keyframes-required', '分层运动必须包含至少两个关键帧。', location);
    return;
  }
  let previousAt = -1;
  let authoredValues = 0;
  for (const [index, keyframe] of keyframes.entries()) {
    const keyframeLocation = `${location}[${index}]`;
    if (!Number.isFinite(keyframe.at) || keyframe.at < 0 || keyframe.at > 1 || keyframe.at <= previousAt) {
      add('error', 'motion-keyframe-at', '关键帧 at 必须位于 0..1 且严格递增。', `${keyframeLocation}.at`);
    }
    previousAt = keyframe.at;
    for (const property of ['x', 'y', 'scale', 'rotation', 'opacity']) {
      if (keyframe[property] !== undefined) {
        authoredValues += 1;
        if (!Number.isFinite(keyframe[property])) {
          add('error', 'motion-keyframe-value', `${property} 必须是有限数字。`, `${keyframeLocation}.${property}`);
        }
      }
    }
    if (keyframe.scale !== undefined && keyframe.scale <= 0) {
      add('error', 'motion-keyframe-scale', 'scale 必须大于 0。', `${keyframeLocation}.scale`);
    }
    if (keyframe.opacity !== undefined && (keyframe.opacity < 0 || keyframe.opacity > 1)) {
      add('error', 'motion-keyframe-opacity', 'opacity 必须位于 0..1。', `${keyframeLocation}.opacity`);
    }
    if (keyframe.ease !== undefined && !MOTION_EASES.includes(keyframe.ease)) {
      add('error', 'motion-keyframe-ease', `未知 ease：${keyframe.ease}`, `${keyframeLocation}.ease`);
    }
  }
  if (keyframes[0]?.at !== 0 || keyframes.at(-1)?.at !== 1) {
    add('error', 'motion-keyframe-boundaries', '关键帧必须从 at=0 覆盖到 at=1。', location);
  }
  if (authoredValues === 0) {
    add('error', 'motion-keyframe-empty', '关键帧必须显式编排至少一个运动属性。', location);
  }
};

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

  if (project.schemaVersion !== 3) {
    add('error', 'schema-version', 'schemaVersion 必须为 3。', 'schemaVersion');
  }
  if (!SLUG_PATTERN.test(project.slug ?? '')) {
    add('error', 'slug', 'slug 格式无效。', 'slug');
  }
  if (!project.title || typeof project.title !== 'string') {
    add('error', 'title', '项目必须有标题。', 'title');
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
  if (project.plan === undefined) {
    add('error', 'plan-required', 'v3 项目必须包含 plan。', 'plan');
  }
  if (!project.voice || typeof project.voice !== 'object') {
    add('error', 'voice-required', 'v3 项目必须包含 voice。', 'voice');
  }
  if (project.audio?.sfx !== undefined) {
    add('error', 'unsupported-v2-audio-sfx', 'v3 不支持 audio.sfx；请用逐节拍 cue.sound。', 'audio.sfx');
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
      'audio.mastering 是 v3 项目的必填交付规格。',
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
    for (const issue of validateStoryboard(storyboard, {slug: project.slug, plan: project.plan})) {
      add('error', issue.code, issue.message, `storyboard.${issue.location}`);
    }
    if (storyboard.status !== 'ready') {
      add('error', 'storyboard-pending', 'storyboard.json 必须为 ready。', 'storyboard.status');
    }
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
      for (const [proofIndex, proof] of (proofs ?? []).entries()) {
        const proofLocation = `${sceneLocation}.motion.proofTimes[${proofIndex}]`;
        if (!Number.isFinite(proof.at) || proof.at < 0 || proof.at > 1 || proof.at <= previousProof) {
          add('error', 'scene-proof-time', '证明时刻 at 必须位于 0..1 且严格递增。', `${proofLocation}.at`);
        }
        previousProof = proof.at;
        if (!['establish', 'action', 'peak', 'final'].includes(proof.kind)) {
          add('error', 'scene-proof-kind', `未知证明类型：${proof.kind}`, `${proofLocation}.kind`);
        }
        if (proof.kind === 'final' && proof.at >= 0.82) finalProof = true;
        if (
          scene.transition?.type === 'fade' &&
          proofOverlapsTransition({
            at: proof.at,
            transitionFrames: scene.transitionFrames,
            durationInFrames: scene.durationInFrames,
          })
        ) {
          add(
            'error',
            'scene-proof-transition-overlap',
            '证明时刻不能落在淡入/淡出遮挡区内。',
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
            return (
              proof.at !== approved.at ||
              proof.label !== approved.label ||
              proof.kind !== approved.kind
            );
          }));
      if (proofDrift) {
        add('error', 'scene-proof-drift', '项目证明时刻必须与已批准故事板完全一致。', `${sceneLocation}.motion.proofTimes`);
      }
    }
    if (scene.durationInFrames <= 0) {
      add('error', 'scene-duration', '镜头计算时长必须大于 0。', sceneLocation);
    }
    if (!scene.transition) {
      add('error', 'transition-required', '每个镜头必须显式配置 transition。', `${sceneLocation}.transition`);
    } else if (
      !['fade', 'none'].includes(scene.transition.type) ||
      !Number.isFinite(scene.transition.durationSeconds) ||
      scene.transition.durationSeconds < 0
    ) {
      add('error', 'transition-invalid', 'transition 必须包含有效 type 和非负 durationSeconds。', `${sceneLocation}.transition`);
    } else if (scene.transitionFrames * 2 >= scene.durationInFrames) {
      add(
        'warning',
        'transition-too-long',
        '转场时长占镜头时长的一半或更多。',
        `${sceneLocation}.transition.durationSeconds`,
      );
    }
    if (!Number.isFinite(scene.tailSeconds) || scene.tailSeconds < 0) {
      add('error', 'scene-tail', 'tailSeconds 必须是非负秒数。', `${sceneLocation}.tailSeconds`);
    }

    const backgroundLocation = `${sceneLocation}.background`;
    try {
      const backgroundFile = resolvePublicFile(scene.background);
      if (!(await fileExists(backgroundFile))) {
        add('error', 'background-missing', `缺少背景：${scene.background}`, backgroundLocation);
      } else {
        const inspection = await memoize(
          backgroundInspectionCache,
          backgroundFile,
          () => inspectBackground(backgroundFile),
        );
        assets.push({kind: 'background', src: scene.background, ...inspection});
        const sourceRatio = inspection.width / inspection.height;
        const videoRatio = project.video.width / project.video.height;
        if (Math.abs(sourceRatio - videoRatio) > 0.035) {
          add(
            'warning',
            'background-aspect',
            `背景宽高比 ${sourceRatio.toFixed(3)} 与视频 ${videoRatio.toFixed(3)} 差异较大。`,
            backgroundLocation,
          );
        }
        const minimumScale = project.quality.minimumAssetScale;
        const minimumWidth = Math.round(project.video.width * minimumScale);
        const minimumHeight = Math.round(project.video.height * minimumScale);
        if (inspection.width < minimumWidth || inspection.height < minimumHeight) {
          add(
            'error',
            'background-resolution',
            `背景 ${inspection.width}x${inspection.height} 低于质量规格 ${minimumWidth}x${minimumHeight}。`,
            backgroundLocation,
          );
        }
      }
    } catch (error) {
      add('error', 'background-path', error.message, backgroundLocation);
    }

    const narrationLocation = `${sceneLocation}.narration`;
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
        if (!(await fileExists(resolvePublicFile(scene.narration.timingSrc)))) {
          add(
            'error',
            'narration-timing-missing',
            `缺少旁白时间戳：${scene.narration.timingSrc}`,
            `${narrationLocation}.timingSrc`,
          );
        }
      } catch (error) {
        add('error', 'narration-timing-path', error.message, `${narrationLocation}.timingSrc`);
      }
    }

    const layerIds = new Set();
    let primaryCount = 0;
    for (const [layerIndex, layer] of (scene.layers ?? []).entries()) {
      const layerLocation = `${sceneLocation}.layers[${layerIndex}]`;
      if (!layer.id || layerIds.has(layer.id)) {
        add('error', 'layer-id', '图层 id 缺失或重复。', `${layerLocation}.id`);
      }
      layerIds.add(layer.id);
      if (layer.role === 'primary') primaryCount += 1;
      if (!['primary', 'secondary', 'tertiary'].includes(layer.role)) {
        add('error', 'layer-role', `未知角色类型：${layer.role}`, `${layerLocation}.role`);
      }
      if (!['left', 'right', 'bottom'].includes(layer.enterFrom)) {
        add('error', 'layer-enter', `未知入场方向：${layer.enterFrom}`, `${layerLocation}.enterFrom`);
      }
      if (!Number.isFinite(layer.delaySeconds) || layer.delaySeconds < 0) {
        add('error', 'layer-delay', '人物 delaySeconds 必须是非负秒数。', `${layerLocation}.delaySeconds`);
      }
      if (!layer.motion) {
        add('error', 'layer-motion-required', '每个人物图层必须显式配置 motion。', `${layerLocation}.motion`);
      }
      if (
        layer.motion?.idle !== undefined &&
        !['float', 'breathe', 'grind', 'drift', 'still'].includes(layer.motion.idle)
      ) {
        add('error', 'layer-motion', `未知 idle 动画：${layer.motion.idle}`, `${layerLocation}.motion.idle`);
      }
      validateMotionKeyframes(layer.motion?.keyframes, `${layerLocation}.motion.keyframes`, add);
      if (
        layer.motion &&
        (!Number.isFinite(layer.motion.intensity) ||
          layer.motion.intensity < 0 ||
          !isPositiveNumber(layer.motion.cycleSeconds) ||
          !isPositiveNumber(layer.motion.enterDurationSeconds))
      ) {
        add('error', 'layer-motion-values', 'motion 必须包含有效的 intensity、cycleSeconds 和 enterDurationSeconds。', `${layerLocation}.motion`);
      }
      if (!isPositiveNumber(layer.width)) {
        add('error', 'layer-width', '人物宽度必须大于 0。', `${layerLocation}.width`);
      }
      if (layer.x + layer.width < 0 || layer.x > project.video.width) {
        add('warning', 'layer-off-canvas', '人物完全位于画布之外。', layerLocation);
      }
      try {
        const layerFile = resolvePublicFile(layer.src);
        if (!(await fileExists(layerFile))) {
          add('error', 'layer-missing', `缺少人物素材：${layer.src}`, `${layerLocation}.src`);
        } else {
          const inspection = await memoize(
            characterInspectionCache,
            layerFile,
            () => inspectCharacterPng(layerFile),
          );
          assets.push({kind: 'character', src: layer.src, ...inspection});
          if (!inspection.hasAlpha || inspection.transparentPixels === 0) {
            add('error', 'layer-alpha', '人物 PNG 没有有效透明区域。', `${layerLocation}.src`);
          }
          if (inspection.keyEdgeRatio > 0.12) {
            add(
              'warning',
              'layer-key-edge',
              `可见半透明边缘中 ${(inspection.keyEdgeRatio * 100).toFixed(1)}% 疑似残留色键 ${inspection.keyColor ?? ''}。`,
              `${layerLocation}.src`,
            );
          }
        }
      } catch (error) {
        add('error', 'layer-inspect', error.message, `${layerLocation}.src`);
      }
    }
    if (primaryCount === 0) {
      add('warning', 'primary-missing', '镜头没有 primary 主体。', `${sceneLocation}.layers`);
    }

    if (!Array.isArray(scene.environmentLayers)) {
      add('error', 'environment-layers-required', '每个镜头必须包含 environmentLayers 数组。', `${sceneLocation}.environmentLayers`);
    }
    const environmentIds = new Set();
    for (const [environmentIndex, environment] of (
      scene.environmentLayers ?? []
    ).entries()) {
      const environmentLocation = `${sceneLocation}.environmentLayers[${environmentIndex}]`;
      if (!environment.id || environmentIds.has(environment.id)) {
        add(
          'error',
          'environment-id',
          '环境图层 id 缺失或重复。',
          `${environmentLocation}.id`,
        );
      }
      environmentIds.add(environment.id);
      if (!environment.motion) {
        add('error', 'environment-motion-required', '环境图层必须包含 motion。', `${environmentLocation}.motion`);
      }
      validateMotionKeyframes(environment.motion?.keyframes, `${environmentLocation}.motion.keyframes`, add);
      if (environment.depth < -1 || environment.depth > 1) {
        add(
          'error',
          'environment-depth',
          '环境图层 depth 必须位于 -1 到 1。',
          `${environmentLocation}.depth`,
        );
      }
      try {
        const environmentFile = resolvePublicFile(environment.src);
        if (!(await fileExists(environmentFile))) {
          add(
            'error',
            'environment-missing',
            `缺少环境图层：${environment.src}`,
            `${environmentLocation}.src`,
          );
        } else {
          const inspection = await memoize(
            backgroundInspectionCache,
            environmentFile,
            () => inspectBackground(environmentFile),
          );
          assets.push({kind: 'environment', src: environment.src, ...inspection});
        }
      } catch (error) {
        add('error', 'environment-inspect', error.message, `${environmentLocation}.src`);
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

    if (!Array.isArray(scene.cues) || scene.cues.length === 0) {
      add('error', 'scene-cues-required', '每个镜头必须包含与故事节拍对应的 cues。', `${sceneLocation}.cues`);
    }
    if (scene.audioEvents !== undefined) {
      add('error', 'unsupported-v2-audio-events', 'v3 不支持 audioEvents；请按 beatId 使用 cues。', `${sceneLocation}.audioEvents`);
    }
    const cueIds = new Set();
    const cueBeatIds = new Set();
    const validTargets = new Set(['scene', ...layerIds, ...environmentIds]);
    const storyboardBeats = new Map((storyboardScene?.beats ?? []).map((beat) => [beat.id, beat]));
    for (const [cueIndex, cue] of (scene.cues ?? []).entries()) {
      const cueLocation = `${sceneLocation}.cues[${cueIndex}]`;
      if (!cue.id || cueIds.has(cue.id)) add('error', 'scene-cue-id', 'cue id 缺失或重复。', `${cueLocation}.id`);
      cueIds.add(cue.id);
      if (!cue.beatId || cueBeatIds.has(cue.beatId)) add('error', 'scene-cue-beat', '每个 cue 必须唯一对应一个 beatId。', `${cueLocation}.beatId`);
      cueBeatIds.add(cue.beatId);
      const beat = storyboardBeats.get(cue.beatId);
      if (!beat) add('error', 'scene-cue-beat-missing', `故事板中没有节拍 ${cue.beatId}。`, `${cueLocation}.beatId`);
      if (!Number.isFinite(cue.at) || cue.at < 0 || cue.at > 1) add('error', 'scene-cue-time', 'cue.at 必须位于 0..1。', `${cueLocation}.at`);
      if (beat && Math.abs(cue.at - beat.at) > 0.035) add('error', 'scene-cue-drift', 'cue.at 必须与故事板节拍保持在 0.035 以内。', `${cueLocation}.at`);
      if (!isPositiveNumber(cue.durationSeconds)) add('error', 'scene-cue-duration', 'cue.durationSeconds 必须大于 0。', `${cueLocation}.durationSeconds`);
      if (!validTargets.has(cue.targetId)) add('error', 'scene-cue-target', `cue 目标不存在：${cue.targetId}`, `${cueLocation}.targetId`);
      if (!CUE_ACTIONS.includes(cue.action)) add('error', 'scene-cue-action', `未知 cue action：${cue.action}`, `${cueLocation}.action`);
      if (!Number.isFinite(cue.intensity) || cue.intensity < 0 || cue.intensity > 3) add('error', 'scene-cue-intensity', 'cue.intensity 必须位于 0..3。', `${cueLocation}.intensity`);
      if (beat?.audioCue && !cue.sound) add('error', 'scene-cue-sound-required', `节拍要求声音 ${beat.audioCue}，对应 cue 必须配置 sound。`, `${cueLocation}.sound`);
      if (cue.sound) {
        try {
          if (!(await fileExists(resolvePublicFile(cue.sound.src)))) add('error', 'scene-cue-sound-missing', `缺少 cue 音效：${cue.sound.src}`, `${cueLocation}.sound.src`);
        } catch (error) {
          add('error', 'scene-cue-sound-path', error.message, `${cueLocation}.sound.src`);
        }
      }
    }
    for (const beatId of storyboardBeats.keys()) {
      if (!cueBeatIds.has(beatId)) add('error', 'scene-cue-coverage', `故事板节拍 ${beatId} 没有执行 cue。`, `${sceneLocation}.cues`);
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
    project.theme?.texture,
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

  const generatedImageBudget = project.plan?.assetBudget?.maxGeneratedImages;
  if (Number.isInteger(generatedImageBudget) && generatedImageBudget > 0) {
    const manifestFile = path.join(
      ROOT,
      'projects',
      project.slug,
      'assets-manifest.json',
    );
    if (await fileExists(manifestFile)) {
      const manifest = await readJson(manifestFile);
      const generatedImages = (manifest.assets ?? []).filter(
        ({capability}) => capability === 'image',
      ).length;
      if (generatedImages > generatedImageBudget) {
        add(
          'warning',
          'asset-budget-exceeded',
          `${project.plan.productionProfile ?? 'balanced'} 档位预算最多 ${generatedImageBudget} 张生成图，当前记录 ${generatedImages} 张；请复用素材或在概念审批时显式升级档位。`,
          'plan.assetBudget.maxGeneratedImages',
        );
      }
    }
  }

  const errors = issues.filter(({level}) => level === 'error').length;
  const warnings = issues.filter(({level}) => level === 'warning').length;
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    project: {slug: project.slug, title: project.title},
    plan: project.plan ?? null,
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
