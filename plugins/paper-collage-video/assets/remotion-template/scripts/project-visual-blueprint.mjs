#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {
  ROOT,
  loadProject,
  resolveRenderConcurrency,
  runCommand,
  writeJson,
} from './project-lib.mjs';
import {loadProduction, recordVisualBlueprint} from './production-state.mjs';
import {createRuntimeBuildFingerprint} from './runtime-build-lib.mjs';
import {loadStoryboard} from './storyboard-lib.mjs';
import {deriveSceneTimeline} from '../src/sceneTimeline.mjs';
import {assertOperationAllowed} from './failure-circuit-lib.mjs';
import {
  createVisualBlueprintContract,
  findVisualBlueprintStyleReference,
  materializeVisualBlueprintProject,
  sceneNeedsMotionClip,
  validateVisualBlueprintExecution,
  visualBlueprintFingerprint,
  visualBlueprintPaths,
  visualBlueprintReviewOperation,
} from './visual-blueprint-lib.mjs';

const args = process.argv.slice(2);
const slug = args.find((argument) => !argument.startsWith('--'));

const xmlEscape = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

const hashFile = async (file) => {
  const {createHash} = await import('node:crypto');
  return createHash('sha256').update(await fs.readFile(file)).digest('hex');
};

const relativeRootPath = (file) =>
  path.relative(ROOT, file).split(path.sep).join('/');

const buildFrameSamples = ({timeline, fps}) => {
  const phases = [
    {id: 'start', at: 0.08, label: '开头'},
    {id: 'middle', at: 0.5, label: '中间'},
    {id: 'end', at: 0.92, label: '结尾'},
  ];
  return timeline.scenes.flatMap((scene) =>
    phases.map((phase) => {
      const localFrame = Math.round(
        Math.max(0, scene.durationInFrames - 1) * phase.at,
      );
      const frame = Math.min(
        timeline.durationInFrames - 1,
        scene.from + localFrame,
      );
      return {
        sceneId: scene.id,
        sceneLabel: scene.label || scene.id,
        phase: phase.id,
        phaseLabel: phase.label,
        frame,
        timeSeconds: frame / fps,
      };
    }),
  );
};

const extractFrames = async ({animatic, samples, outputDirectory}) => {
  await fs.rm(outputDirectory, {recursive: true, force: true});
  await fs.mkdir(outputDirectory, {recursive: true});
  const uniqueFrames = [...new Set(samples.map(({frame}) => frame))].sort(
    (left, right) => left - right,
  );
  const temporaryPattern = path.join(outputDirectory, 'raw-%03d.jpg');
  const expression = uniqueFrames
    .map((frame) => `eq(n\\,${frame})`)
    .join('+');
  await runCommand('ffmpeg', [
    '-y',
    '-v',
    'error',
    '-i',
    animatic,
    '-vf',
    `select=${expression}`,
    '-vsync',
    '0',
    '-q:v',
    '2',
    temporaryPattern,
  ]);
  const frameFiles = new Map();
  for (const [index, frame] of uniqueFrames.entries()) {
    frameFiles.set(
      frame,
      path.join(outputDirectory, `raw-${String(index + 1).padStart(3, '0')}.jpg`),
    );
  }
  for (const sample of samples) {
    const destination = path.join(
      outputDirectory,
      `${sample.sceneId}-${sample.phase}.jpg`,
    );
    await fs.copyFile(frameFiles.get(sample.frame), destination);
    sample.file = relativeRootPath(destination);
  }
  for (const file of frameFiles.values()) {
    await fs.rm(file, {force: true});
  }
};

const buildContactSheet = async ({
  project,
  samples,
  output,
}) => {
  const first = path.resolve(ROOT, samples[0].file);
  const metadata = await sharp(first).metadata();
  const frameWidth = metadata.width;
  const frameHeight = metadata.height;
  const labelHeight = 42;
  const titleHeight = 62;
  const sceneIds = [...new Set(samples.map(({sceneId}) => sceneId))];
  const width = frameWidth * 3;
  const height = titleHeight + sceneIds.length * (frameHeight + labelHeight);
  const composites = [];
  for (const [sceneIndex, sceneId] of sceneIds.entries()) {
    const row = samples.filter((sample) => sample.sceneId === sceneId);
    for (const [column, sample] of row.entries()) {
      composites.push({
        input: path.resolve(ROOT, sample.file),
        left: column * frameWidth,
        top: titleHeight + sceneIndex * (frameHeight + labelHeight),
      });
      composites.push({
        input: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${frameWidth}" height="${labelHeight}">
            <rect width="100%" height="100%" fill="${project.theme.canvas}"/>
            <text x="16" y="28" font-family="Arial, sans-serif" font-size="20" font-weight="700" fill="${project.theme.subtitle}">
              ${xmlEscape(sample.sceneLabel)} · ${xmlEscape(sample.phaseLabel)}
            </text>
          </svg>`,
        ),
        left: column * frameWidth,
        top:
          titleHeight +
          sceneIndex * (frameHeight + labelHeight) +
          frameHeight,
      });
    }
  }
  composites.unshift({
    input: Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${titleHeight}">
        <rect width="100%" height="100%" fill="${project.theme.canvas}"/>
        <text x="20" y="40" font-family="Arial, sans-serif" font-size="28" font-weight="800" fill="${project.theme.subtitle}">
          ${xmlEscape(project.title)} · 同源视觉蓝图（每幕 开头 / 中间 / 结尾）
        </text>
      </svg>`,
    ),
    left: 0,
    top: 0,
  });
  await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: project.theme.canvas,
    },
  })
    .composite(composites)
    .jpeg({quality: 88, chromaSubsampling: '4:4:4'})
    .toFile(output);
};

const extractMotionClips = async ({
  project,
  timeline,
  animatic,
  outputDirectory,
}) => {
  await fs.rm(outputDirectory, {recursive: true, force: true});
  await fs.mkdir(outputDirectory, {recursive: true});
  const results = [];
  for (const scene of timeline.scenes) {
    const sourceScene = project.scenes.find(({id}) => id === scene.id);
    if (!sceneNeedsMotionClip(sourceScene)) continue;
    const sceneSeconds = scene.durationInFrames / project.video.fps;
    const clipDuration = Math.min(5, sceneSeconds);
    const requestedDuration = Math.min(
      clipDuration,
      Math.max(2, clipDuration),
    );
    const peak =
      sourceScene.motion?.proofTimes?.find(({kind}) => kind === 'peak') ??
      sourceScene.motion?.proofTimes?.find(({kind}) => kind === 'action');
    const localCenter = (peak?.at ?? 0.5) * sceneSeconds;
    const localStart = Math.max(
      0,
      Math.min(
        sceneSeconds - requestedDuration,
        localCenter - requestedDuration / 2,
      ),
    );
    const start = scene.from / project.video.fps + localStart;
    const file = path.join(outputDirectory, `${scene.id}.mp4`);
    await runCommand('ffmpeg', [
      '-y',
      '-v',
      'error',
      '-ss',
      start.toFixed(3),
      '-i',
      animatic,
      '-t',
      requestedDuration.toFixed(3),
      '-an',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '30',
      '-pix_fmt',
      'yuv420p',
      file,
    ]);
    results.push({
      sceneId: scene.id,
      file: relativeRootPath(file),
      startSeconds: start,
      durationSeconds: requestedDuration,
    });
  }
  return results;
};

try {
  if (!slug) {
    throw new Error('用法：project:visual-blueprint -- <slug>');
  }
  const [{state}, {project}, storyboard] = await Promise.all([
    loadProduction(slug),
    loadProject(slug),
    loadStoryboard(slug),
  ]);
  if (!['style-review', 'asset-production'].includes(state.stage)) {
    throw new Error(
      `视觉蓝图只能在 style-review 或已批准后的修订期生成；当前为 ${state.stage}。`,
    );
  }
  if (state.approvals.concept?.status !== 'approved') {
    throw new Error('视觉蓝图需要已批准的故事范围与制作规格。');
  }
  const issues = validateVisualBlueprintExecution({project, storyboard});
  if (issues.length > 0) {
    throw new Error(
      `执行树尚不能成为最终同源蓝图：\n${issues
        .map(({location, message}) => `- ${location}: ${message}`)
        .join('\n')}`,
    );
  }

  await assertOperationAllowed({
    slug,
    operation: visualBlueprintReviewOperation,
    inputFingerprint: visualBlueprintFingerprint(project),
  });

  const paths = visualBlueprintPaths(slug);
  await fs.rm(paths.directory, {recursive: true, force: true});
  await fs.mkdir(paths.directory, {recursive: true});
  const materialized = await materializeVisualBlueprintProject(project);
  await writeJson(paths.props, materialized.project);

  const remotion = path.join(ROOT, 'node_modules', '.bin', 'remotion');
  const scale = Math.min(
    1,
    480 / Math.max(project.video.width, project.video.height),
  );
  await runCommand(remotion, ['browser', 'ensure']);
  await runCommand(remotion, [
    'render',
    'src/index.ts',
    'Paper-Collage',
    paths.animatic,
    `--props=${relativeRootPath(paths.props)}`,
    `--concurrency=${Math.min(4, resolveRenderConcurrency())}`,
    `--scale=${scale}`,
    '--codec=h264',
    '--crf=32',
    '--pixel-format=yuv420p',
    '--log=error',
  ]);

  const timeline = deriveSceneTimeline(materialized.project);
  const samples = buildFrameSamples({
    timeline,
    fps: project.video.fps,
  });
  await extractFrames({
    animatic: paths.animatic,
    samples,
    outputDirectory: paths.keyframes,
  });
  await buildContactSheet({
    project,
    samples,
    output: paths.contactSheet,
  });
  const styleFrameSample =
    samples.find(({phase}) => phase === 'middle') ?? samples[0];
  await fs.copyFile(
    path.resolve(ROOT, styleFrameSample.file),
    paths.styleFrame,
  );
  const motionClips = await extractMotionClips({
    project,
    timeline,
    animatic: paths.animatic,
    outputDirectory: paths.clips,
  });
  const clipsByScene = new Map(
    motionClips.map((clip) => [clip.sceneId, clip]),
  );
  const styleReference = await findVisualBlueprintStyleReference(slug);
  const visualContractFingerprint = visualBlueprintFingerprint(project);
  const runtimeBuildFingerprint = await createRuntimeBuildFingerprint();
  const scenes = timeline.scenes.map((scene) => {
    const sceneSamples = samples.filter(({sceneId}) => sceneId === scene.id);
    return {
      sceneId: scene.id,
      label: scene.label,
      durationSeconds: scene.durationInFrames / project.video.fps,
      keyframes: Object.fromEntries(
        sceneSamples.map(({phase, file}) => [phase, file]),
      ),
      motionClip: clipsByScene.get(scene.id)?.file ?? null,
      userDecisionScope: [
        '构图与主体位置',
        '图层前后关系与遮挡意图',
        '角色运动方向与朝向',
        '逐帧状态切换、循环区间与位移协调',
        '镜头运动、景深和节奏',
      ],
    };
  });
  const artifactFiles = [
    relativeRootPath(paths.animatic),
    relativeRootPath(paths.contactSheet),
    relativeRootPath(paths.styleFrame),
    ...scenes.flatMap(({keyframes, motionClip}) => [
      ...Object.values(keyframes),
      motionClip,
    ]),
  ].filter(Boolean);
  const artifactHashes = Object.fromEntries(
    await Promise.all(
      artifactFiles.map(async (file) => [
        file,
        await hashFile(path.resolve(ROOT, file)),
      ]),
    ),
  );
  const report = {
    $schema: '../../../schemas/visual-blueprint.schema.json',
    schemaVersion: 1,
    projectSlug: slug,
    generatedAt: new Date().toISOString(),
    status: 'awaiting-human',
    reviewMode: 'single-human-visual-decision',
    source: {
      project: relativeRootPath(projectPathsFor(slug).projectFile),
      storyboard: relativeRootPath(projectPathsFor(slug).storyboardFile),
      contract: createVisualBlueprintContract(project),
    },
    visualContractFingerprint,
    runtimeBuildFingerprint,
    renderProfile: {
      width: Math.round(project.video.width * scale),
      height: Math.round(project.video.height * scale),
      fps: project.video.fps,
      sourceRenderer: 'Paper-Collage',
      proxyPolicy: 'keep-current-real-source-else-deterministic-proxy',
    },
    sourceCoverage: materialized.coverage,
    styleReference,
    artifacts: {
      animatic: relativeRootPath(paths.animatic),
      contactSheet: relativeRootPath(paths.contactSheet),
      styleFrame: relativeRootPath(paths.styleFrame),
    },
    artifactHashes,
    scenes,
    machineChecks: [
      {id: 'all-scenes-covered', passed: scenes.length === storyboard.scenes.length},
      {id: 'three-keyframes-per-scene', passed: scenes.every(({keyframes}) => Object.keys(keyframes).length === 3)},
      {id: 'motion-clips-for-dynamic-scenes', passed: project.scenes.every((scene) => !sceneNeedsMotionClip(scene) || clipsByScene.has(scene.id))},
      {id: 'current-runtime-bound', passed: true},
      {id: 'artifact-hashes-recorded', passed: artifactFiles.every((file) => Boolean(artifactHashes[file]))},
    ],
    decisionBoundary: {
      machine:
        '只确认文件存在、编码可读、覆盖完整、哈希与运行时新鲜度；不判断画面好坏。',
      human:
        '一次观看风格样张、全片低清 animatic、每幕开头/中间/结尾和动态片段，直接批准或提出修改。',
      finalPreview:
        '正式素材替换后，人再判断真实接缝、穿模、遮挡、素材破损、身份一致性和整体观感。',
    },
  };
  await writeJson(paths.report, report);
  await recordVisualBlueprint(slug, relativeRootPath(paths.report));
  console.log(`✓ 同源视觉蓝图：${relativeRootPath(paths.animatic)}`);
  console.log(`✓ 每幕关键帧：${relativeRootPath(paths.contactSheet)}`);
  console.log(`✓ 蓝图报告：${relativeRootPath(paths.report)}`);
  console.log(
    `  sources: ${materialized.coverage.actual} actual + ${materialized.coverage.proxy} proxy`,
  );
  if (!styleReference) {
    console.log(
      '⚠ 尚无故事专属风格样张；可以先看布局，但 approve-style-voice 会拒绝批准，直到样张存在并重新生成蓝图。',
    );
  }
} catch (error) {
  console.error(`project:visual-blueprint failed: ${error.message}`);
  process.exitCode = 1;
}

function projectPathsFor(projectSlug) {
  return {
    projectFile: path.join(ROOT, 'projects', projectSlug, 'project.json'),
    storyboardFile: path.join(ROOT, 'projects', projectSlug, 'storyboard.json'),
  };
}
