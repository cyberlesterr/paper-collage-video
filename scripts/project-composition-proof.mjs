#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {deriveCueEvents, flattenCompositionNodes} from './composition-lib.mjs';
import {
  ROOT,
  deriveTimeline,
  formatValidation,
  loadProject,
  projectPaths,
  resolveRenderConcurrency,
  runCommand,
  validateProject,
  writeJson,
} from './project-lib.mjs';
import {
  collectCompositeQualityTargets,
  compositionProofReportPath,
} from './quality-lib.mjs';

const [slug] = process.argv.slice(2).filter((argument) => !argument.startsWith('--'));

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

const findTargetBounds = ({scene, nodeId, video}) => {
  let result = null;
  const visit = (nodes, parentRect, parentGroup = null) => {
    for (const node of nodes ?? []) {
      const transform = node.transform ?? {};
      const width = Number(transform.width ?? 1) * parentRect.width;
      const height = node.kind === 'group'
        ? (transform.height === undefined
            ? width * node.coordinateSpace.height / node.coordinateSpace.width
            : Number(transform.height) * parentRect.height)
        : Number(transform.height ?? 1) * parentRect.height;
      const rect = {
        left: parentRect.left + Number(transform.x ?? 0) * parentRect.width - Number(transform.anchorX ?? 0) * width,
        top: parentRect.top + Number(transform.y ?? 0) * parentRect.height - Number(transform.anchorY ?? 0) * height,
        width,
        height,
      };
      if (node.id === nodeId) result = node.kind === 'group' ? rect : parentGroup ?? rect;
      if (node.kind === 'group') visit(node.children, rect, rect);
    }
  };
  visit(scene.composition?.nodes, {left: 0, top: 0, width: video.width, height: video.height});
  const rect = result ?? {left: 0, top: 0, width: video.width, height: video.height};
  const padding = Math.max(16, Math.round(Math.max(rect.width, rect.height) * 0.08));
  const left = clamp(Math.floor(rect.left - padding), 0, video.width - 1);
  const top = clamp(Math.floor(rect.top - padding), 0, video.height - 1);
  return {
    left,
    top,
    width: clamp(Math.ceil(rect.width + padding * 2), 1, video.width - left),
    height: clamp(Math.ceil(rect.height + padding * 2), 1, video.height - top),
  };
};

const debugOverlay = ({width, height, bounds, label}) => Buffer.from(`
  <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect x="${bounds.left}" y="${bounds.top}" width="${bounds.width}" height="${bounds.height}" fill="none" stroke="#ff3b30" stroke-width="6"/>
    <rect x="${bounds.left}" y="${Math.max(0, bounds.top - 44)}" width="${Math.min(bounds.width, 760)}" height="44" fill="rgba(255,59,48,.9)"/>
    <text x="${bounds.left + 12}" y="${Math.max(30, bounds.top - 12)}" fill="white" font-size="24" font-family="sans-serif">${label.replace(/[<>&]/g, '')}</text>
  </svg>
`);

try {
  if (!slug) throw new Error('用法：project:composition-proof -- <slug>');
  await runCommand(process.execPath, ['scripts/project-sync.mjs', slug]);
  const {project} = await loadProject(slug);
  const validation = await validateProject(project);
  console.log(formatValidation(validation));
  if (!validation.passed) throw new Error('v4 组合结构未通过，不能生成证明帧。');

  const timeline = deriveTimeline(project);
  const paths = projectPaths(slug);
  const outputDirectory = path.dirname(compositionProofReportPath(slug));
  const frameDirectory = path.join(outputDirectory, 'frames');
  const cropDirectory = path.join(outputDirectory, 'crops');
  const debugDirectory = path.join(outputDirectory, 'debug');
  await fs.rm(outputDirectory, {recursive: true, force: true});
  await fs.mkdir(frameDirectory, {recursive: true});
  await fs.mkdir(cropDirectory, {recursive: true});
  await fs.mkdir(debugDirectory, {recursive: true});

  const remotion = path.join(ROOT, 'node_modules', '.bin', 'remotion');
  await runCommand(remotion, ['browser', 'ensure']);
  const rendered = new Map();
  for (const scene of timeline.scenes) {
    for (const proof of scene.motion?.proofTimes ?? []) {
      const absoluteFrame = scene.from + Math.round(proof.at * Math.max(0, scene.durationInFrames - 1));
      const key = `${scene.id}:${proof.id}`;
      const file = path.join(frameDirectory, `${scene.id}-${proof.id}.png`);
      await runCommand(remotion, [
        'still',
        'src/index.ts',
        'Paper-Collage',
        file,
        `--props=${path.relative(ROOT, paths.projectFile)}`,
        `--frame=${absoluteFrame}`,
        `--concurrency=${resolveRenderConcurrency()}`,
      ]);
      rendered.set(key, {file, absoluteFrame});
    }
  }

  const sceneById = new Map(timeline.scenes.map((scene) => [scene.id, scene]));
  const targets = await collectCompositeQualityTargets(project);
  const composites = [];
  for (const target of targets) {
    const proofFrames = [];
    const proofShots = target.proofShots ?? [{
      sceneId: target.sceneId,
      nodeId: target.nodeId,
      proofTimeIds: target.proofTimeIds,
    }];
    for (const shot of proofShots) {
      const scene = sceneById.get(shot.sceneId);
      if (!scene) continue;
      for (const proofTimeId of shot.proofTimeIds) {
        const renderedProof = rendered.get(`${shot.sceneId}:${proofTimeId}`);
        if (!renderedProof) continue;
        const bounds = findTargetBounds({scene, nodeId: shot.nodeId, video: project.video});
        const safeId = target.compositeId.replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
        const cropFile = path.join(cropDirectory, `${safeId}-${shot.sceneId}-${proofTimeId}.png`);
        const debugFile = path.join(debugDirectory, `${safeId}-${shot.sceneId}-${proofTimeId}.png`);
        await sharp(renderedProof.file).extract(bounds).png().toFile(cropFile);
        await sharp(renderedProof.file)
          .composite([{input: debugOverlay({width: project.video.width, height: project.video.height, bounds, label: `${target.compositeId} · ${shot.sceneId} · ${proofTimeId}`})}])
          .png()
          .toFile(debugFile);
        proofFrames.push({
          sceneId: shot.sceneId,
          proofTimeId,
          absoluteFrame: renderedProof.absoluteFrame,
          fullFrame: path.relative(ROOT, renderedProof.file),
          crop: path.relative(ROOT, cropFile),
          debugFrame: path.relative(ROOT, debugFile),
          bounds,
        });
      }
    }
    composites.push({
      compositeId: target.compositeId,
      sceneId: target.sceneId,
      pattern: target.pattern,
      fingerprint: target.fingerprint,
      proofFrames,
    });
  }

  const report = {
    schemaVersion: 1,
    projectSlug: slug,
    generatedAt: new Date().toISOString(),
    composites,
    cueEvents: timeline.scenes.flatMap((scene) => deriveCueEvents({scene, sceneFrom: scene.from, fps: project.video.fps})),
  };
  const reportFile = compositionProofReportPath(slug);
  await writeJson(reportFile, report);
  console.log(`✓ composition proof: ${path.relative(ROOT, reportFile)} (${composites.length} composites)`);
} catch (error) {
  console.error(`project:composition-proof failed: ${error.message}`);
  process.exitCode = 1;
}
