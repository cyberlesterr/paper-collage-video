import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const execFileAsync = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(scriptDirectory, '..');
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const projectPaths = (slug) => ({
  slug,
  projectDirectory: path.join(ROOT, 'projects', slug),
  projectFile: path.join(ROOT, 'projects', slug, 'project.json'),
  productionFile: path.join(ROOT, 'projects', slug, 'production.json'),
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
  return {paths, project};
};

export const deriveTimeline = (project) => {
  let cursor = 0;
  const fps = project.video?.fps ?? 30;
  const transitionFrames = project.video?.transitionFrames ?? 0;
  const scenes = (project.scenes ?? []).map((scene, index) => {
    const narrationFrames = Math.ceil(
      Number(scene.narration?.durationSeconds ?? 0) * fps,
    );
    const durationInFrames =
      Number(scene.narration?.startFrame ?? 0) +
      narrationFrames +
      Number(scene.tailFrames ?? 0);
    const from = index === 0 ? 0 : Math.max(0, cursor - transitionFrames);
    cursor = from + durationInFrames;
    return {...scene, from, durationInFrames, narrationFrames};
  });
  return {durationInFrames: cursor, durationSeconds: cursor / fps, scenes};
};

export const deriveContactSheetSamples = ({
  timeline,
  fps,
  durationSeconds,
  maxPanels = 8,
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
  const selectedScenes =
    scenes.length <= panelLimit
      ? scenes
      : panelLimit === 1
        ? [scenes[Math.floor(scenes.length / 2)]]
        : Array.from({length: panelLimit}, (_, index) =>
            scenes[
              Math.round((index * (scenes.length - 1)) / (panelLimit - 1))
            ],
          );
  const ratios = selectedScenes.length <= Math.floor(panelLimit / 2) ? [0.28, 0.72] : [0.5];
  return selectedScenes.flatMap((scene) =>
    ratios.map((ratio, ratioIndex) => {
      const frame = scene.from + Math.max(0, scene.durationInFrames - 1) * ratio;
      const time = Math.max(0, Math.min(durationSeconds - 0.04, frame / fps));
      const position = ratios.length === 1 ? '中段' : ratioIndex === 0 ? '前段' : '后段';
      return {
        time,
        label: `${scene.label || scene.id} · ${position}`,
        sceneId: scene.id,
      };
    }),
  );
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

export const validateProject = async (project, options = {}) => {
  const issues = [];
  const assets = [];
  const add = (level, code, message, location) =>
    issues.push(makeIssue(level, code, message, location));

  if (project.schemaVersion !== 1) {
    add('error', 'schema-version', 'schemaVersion 必须为 1。', 'schemaVersion');
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
  if (!Array.isArray(project.scenes) || project.scenes.length === 0) {
    add('error', 'scenes-empty', '项目至少需要一个镜头。', 'scenes');
  }

  const structuralErrors = issues.some(({level}) => level === 'error');
  const timeline = structuralErrors
    ? {durationInFrames: 0, durationSeconds: 0, scenes: []}
    : deriveTimeline(project);
  const sceneIds = new Set();

  for (const [sceneIndex, scene] of (timeline.scenes ?? []).entries()) {
    const sceneLocation = `scenes[${sceneIndex}]`;
    if (!scene.id || sceneIds.has(scene.id)) {
      add('error', 'scene-id', '镜头 id 缺失或重复。', `${sceneLocation}.id`);
    }
    sceneIds.add(scene.id);
    if (scene.durationInFrames <= 0) {
      add('error', 'scene-duration', '镜头计算时长必须大于 0。', sceneLocation);
    }

    const backgroundLocation = `${sceneLocation}.background`;
    try {
      const backgroundFile = resolvePublicFile(scene.background);
      if (!(await fileExists(backgroundFile))) {
        add('error', 'background-missing', `缺少背景：${scene.background}`, backgroundLocation);
      } else {
        const inspection = await inspectBackground(backgroundFile);
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
      }
    } catch (error) {
      add('error', 'background-path', error.message, backgroundLocation);
    }

    const narrationLocation = `${sceneLocation}.narration`;
    try {
      const narrationFile = resolvePublicFile(scene.narration?.src ?? '');
      if (!(await fileExists(narrationFile))) {
        add('error', 'narration-missing', `缺少旁白：${scene.narration?.src}`, narrationLocation);
      } else {
        const probe = await probeMedia(narrationFile);
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
          const inspection = await inspectCharacterPng(layerFile);
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

    let previousSubtitleEnd = -1;
    for (const [subtitleIndex, subtitle] of (scene.subtitles ?? []).entries()) {
      const subtitleLocation = `${sceneLocation}.subtitles[${subtitleIndex}]`;
      if (subtitle.from < 0 || subtitle.to <= subtitle.from) {
        add('error', 'subtitle-range', '字幕帧范围无效。', subtitleLocation);
      }
      if (subtitle.to > scene.durationInFrames) {
        add('warning', 'subtitle-overflow', '字幕超过镜头结束帧。', subtitleLocation);
      }
      if (subtitle.from < previousSubtitleEnd) {
        add('warning', 'subtitle-overlap', '字幕时间发生重叠。', subtitleLocation);
      }
      previousSubtitleEnd = Math.max(previousSubtitleEnd, subtitle.to);
    }
  }

  const sharedAssets = [
    project.theme?.texture,
    project.audio?.music?.src,
    ...Object.values(project.audio?.sfx ?? {}).map((sound) => sound?.src),
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

  const errors = issues.filter(({level}) => level === 'error').length;
  const warnings = issues.filter(({level}) => level === 'warning').length;
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    project: {slug: project.slug, title: project.title},
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
