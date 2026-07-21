#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {collectCompositionGroups, flattenCompositionNodes} from './composition-lib.mjs';
import {collectCompositeQualityTargets} from './quality-lib.mjs';
import {
  styleFingerprintForTarget,
  styleProofReportPath,
} from './style-proof-lib.mjs';

sharp.cache(false);
sharp.concurrency(1);
import {
  ROOT,
  assertSlug,
  loadProject,
  probeMedia,
  projectPaths,
  resolvePublicFile,
  resolveRenderConcurrency,
  runCommand,
  writeJson,
} from './project-lib.mjs';

const args = process.argv.slice(2);
const slug = args.find((argument) => !argument.startsWith('--'));
const valueFor = (name) => args.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1);
const durationSeconds = Number(valueFor('--duration') ?? 5);

const safeId = (value) => value.replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

const checkerboard = ({width, height, cell = 48}) => Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><pattern id="grid" width="${cell * 2}" height="${cell * 2}" patternUnits="userSpaceOnUse">
      <rect width="${cell * 2}" height="${cell * 2}" fill="#ece8df"/>
      <rect width="${cell}" height="${cell}" fill="#8b8275"/>
      <rect x="${cell}" y="${cell}" width="${cell}" height="${cell}" fill="#8b8275"/>
    </pattern></defs>
    <rect width="100%" height="100%" fill="url(#grid)"/>
  </svg>
`);

const alphaBoundsFor = async (file) => {
  const {data, info} = await sharp(file).ensureAlpha().extractChannel(3).raw().toBuffer({resolveWithObject: true});
  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[y * info.width + x] <= 16) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) return {left: 0, top: 0, width: info.width, height: info.height};
  return {left, top, width: right - left + 1, height: bottom - top + 1};
};

const padBounds = (bounds, {width, height}, padding = 24) => {
  const left = clamp(bounds.left - padding, 0, width - 1);
  const top = clamp(bounds.top - padding, 0, height - 1);
  return {
    left,
    top,
    width: clamp(bounds.width + padding * 2, 1, width - left),
    height: clamp(bounds.height + padding * 2, 1, height - top),
  };
};

const proofBoundsFor = ({group, localBounds, video}) => {
  const transform = group.transform ?? {};
  const groupWidth = Number(transform.width ?? 1) * video.width;
  const groupHeight = transform.height === undefined
    ? groupWidth * group.coordinateSpace.height / group.coordinateSpace.width
    : Number(transform.height) * video.height;
  const groupLeft = Number(transform.x ?? 0) * video.width - Number(transform.anchorX ?? 0) * groupWidth;
  const groupTop = Number(transform.y ?? 0) * video.height - Number(transform.anchorY ?? 0) * groupHeight;
  const scaleX = groupWidth / group.coordinateSpace.width;
  const scaleY = groupHeight / group.coordinateSpace.height;
  return padBounds({
    left: Math.floor(groupLeft + localBounds.left * scaleX),
    top: Math.floor(groupTop + localBounds.top * scaleY),
    width: Math.ceil(localBounds.width * scaleX),
    height: Math.ceil(localBounds.height * scaleY),
  }, video, 32);
};

const unionBounds = (bounds) => {
  const left = Math.min(...bounds.map((entry) => entry.left));
  const top = Math.min(...bounds.map((entry) => entry.top));
  const right = Math.max(...bounds.map((entry) => entry.left + entry.width));
  const bottom = Math.max(...bounds.map((entry) => entry.top + entry.height));
  return {left, top, width: right - left, height: bottom - top};
};

const debugOverlay = ({width, height, bounds, label}) => Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect x="${bounds.left}" y="${bounds.top}" width="${bounds.width}" height="${bounds.height}" fill="none" stroke="#ff3b30" stroke-width="6"/>
    <rect x="${bounds.left}" y="${Math.max(0, bounds.top - 44)}" width="${Math.min(bounds.width, 720)}" height="44" fill="rgba(255,59,48,.9)"/>
    <text x="${bounds.left + 12}" y="${Math.max(30, bounds.top - 12)}" fill="white" font-size="24" font-family="sans-serif">${label.replace(/[<>&]/g, '')}</text>
  </svg>
`);

const buildAssetEvidence = async ({node, directory}) => {
  const sourceFile = resolvePublicFile(node.src);
  const metadata = await sharp(sourceFile).metadata();
  const width = metadata.width;
  const height = metadata.height;
  if (!width || !height) throw new Error(`${node.id} 无法读取尺寸。`);
  const id = safeId(node.id);
  const alphaMaskFile = path.join(directory, `${id}-alpha.png`);
  const checkerboardFile = path.join(directory, `${id}-checkerboard.png`);
  const tightCropFile = path.join(directory, `${id}-tight.png`);
  const motionStressFile = path.join(directory, `${id}-motion-stress.jpg`);
  const bounds = await alphaBoundsFor(sourceFile);
  const padded = padBounds(bounds, {width, height}, Math.max(12, Math.round(Math.max(width, height) * 0.015)));
  await sharp(sourceFile).ensureAlpha().extractChannel(3).png().toFile(alphaMaskFile);
  const checker = checkerboard({width, height});
  const normal = await sharp(checker).composite([{input: sourceFile}]).png().toBuffer();
  await sharp(normal).png().toFile(checkerboardFile);
  await sharp(normal).extract(padded).png().toFile(tightCropFile);
  const shiftX = Math.max(8, Math.round(width * 0.02));
  const shiftY = Math.max(4, Math.round(height * 0.01));
  const shiftedAsset = await sharp(sourceFile)
    .affine([[1, 0], [0, 1]], {idx: shiftX, idy: shiftY, background: '#00000000'})
    .png()
    .toBuffer();
  const shifted = await sharp(checker).composite([{input: shiftedAsset}]).png().toBuffer();
  const panels = await Promise.all([normal, shifted].map((input) => sharp(input).resize(640, 360, {fit: 'contain', background: '#2b2622'}).jpeg({quality: 92}).toBuffer()));
  await sharp({create: {width: 1280, height: 360, channels: 3, background: '#2b2622'}})
    .composite([{input: panels[0], left: 0, top: 0}, {input: panels[1], left: 640, top: 0}])
    .jpeg({quality: 92})
    .toFile(motionStressFile);
  return {
    nodeId: node.id,
    source: node.src,
    alphaBounds: bounds,
    alphaMask: path.relative(ROOT, alphaMaskFile),
    checkerboard: path.relative(ROOT, checkerboardFile),
    tightCrop: path.relative(ROOT, tightCropFile),
    motionStress: path.relative(ROOT, motionStressFile),
  };
};

const makeProofTone = ({sampleRate = 48000, seconds = 1} = {}) => {
  const sampleCount = sampleRate * seconds;
  const buffer = Buffer.alloc(44 + sampleCount * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + sampleCount * 2, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(sampleCount * 2, 40);
  for (let sample = 0; sample < sampleCount; sample += 1) {
    buffer.writeInt16LE(Math.round(Math.sin(sample / sampleRate * Math.PI * 2 * 220) * 220), 44 + sample * 2);
  }
  return buffer;
};

try {
  assertSlug(slug);
  if (!Number.isFinite(durationSeconds) || durationSeconds < 3 || durationSeconds > 5) throw new Error('--duration 必须位于 3..5 秒。');
  const {project} = await loadProject(slug);
  const selected = project.scenes.find((scene) => collectCompositionGroups(scene.composition).some(({node}) => ['supported-subject', 'registered-environment'].includes(node.pattern)));
  if (!selected) throw new Error('项目没有可用于真实拓扑样片的 supported-subject 或 registered-environment 组合。');

  const paths = projectPaths(slug);
  const proofDirectory = path.join(paths.distDirectory, 'style-proof');
  const propsFile = path.join(proofDirectory, 'project.json');
  const output = path.join(paths.distDirectory, 'style-motion-proof.mp4');
  const reportFile = styleProofReportPath(slug);
  const contactSheet = path.join(paths.distDirectory, 'style-motion-proof-contact-sheet.jpg');
  const toneSrc = `projects/${slug}/audio/style-proof-tone.wav`;
  const toneFile = resolvePublicFile(toneSrc);
  await fs.mkdir(path.dirname(toneFile), {recursive: true});
  await fs.writeFile(toneFile, makeProofTone());

  const proofProject = {
    ...project,
    plan: {
      ...project.plan,
      requested: {durationSeconds, sceneCount: 1},
      resolved: {...project.plan.resolved, durationSeconds, sceneCount: 1},
    },
    audio: {...project.audio, narration: {volume: 0.01}, music: null},
    scenes: [{
      ...selected,
      tailSeconds: durationSeconds - 1,
      transition: {type: 'none', durationSeconds: 0},
      narration: {src: toneSrc, startSeconds: 0, durationSeconds: 1, text: ''},
      subtitles: [],
    }],
  };
  await writeJson(propsFile, proofProject);

  const frameCount = Math.round(durationSeconds * project.video.fps);
  const remotion = path.join(ROOT, 'node_modules', '.bin', 'remotion');
  await runCommand(remotion, [
    'render', 'src/index.ts', 'Paper-Collage', output,
    `--props=${path.relative(ROOT, propsFile)}`,
    `--frames=0-${Math.max(1, frameCount - 1)}`,
    `--concurrency=${resolveRenderConcurrency()}`,
    '--scale=0.5', '--crf=24', '--audio-bitrate=96k',
  ]);

  const proofs = selected.motion.proofTimes.length <= 3
    ? selected.motion.proofTimes
    : [selected.motion.proofTimes[0], selected.motion.proofTimes[Math.floor(selected.motion.proofTimes.length / 2)], selected.motion.proofTimes.at(-1)];
  const frameDirectory = path.join(proofDirectory, 'frames');
  const cropDirectory = path.join(proofDirectory, 'crops');
  const debugDirectory = path.join(proofDirectory, 'debug');
  const evidenceDirectory = path.join(proofDirectory, 'evidence');
  await Promise.all([frameDirectory, cropDirectory, debugDirectory, evidenceDirectory].map((directory) => fs.mkdir(directory, {recursive: true})));
  const renderedFrames = new Map();
  const panels = await Promise.all(proofs.map(async (proof, index) => {
    const frameFile = path.join(frameDirectory, `proof-${index + 1}-${proof.id}.png`);
    const frame = Math.round(proof.at * Math.max(1, frameCount - 1));
    await runCommand(remotion, [
      'still', 'src/index.ts', 'Paper-Collage', frameFile,
      `--props=${path.relative(ROOT, propsFile)}`,
      `--frame=${frame}`,
      `--concurrency=${resolveRenderConcurrency()}`,
    ]);
    renderedFrames.set(proof.id, frameFile);
    return sharp(frameFile).resize(640, 360, {fit: 'cover'}).jpeg().toBuffer();
  }));
  await sharp({create: {width: panels.length * 640, height: 360, channels: 3, background: '#160f0d'}})
    .composite(panels.map((input, index) => ({input, left: index * 640, top: 0})))
    .jpeg({quality: 90})
    .toFile(contactSheet);

  const coupledGroups = collectCompositionGroups(selected.composition).filter(({node}) => ['supported-subject', 'registered-environment'].includes(node.pattern));
  const memberNodes = new Map();
  for (const {node: group} of coupledGroups) {
    for (const {node} of flattenCompositionNodes(group.children).filter(({node}) => node.kind === 'asset')) memberNodes.set(node.id, node);
  }
  const assetEvidence = [];
  for (const node of memberNodes.values()) {
    assetEvidence.push(await buildAssetEvidence({node, directory: evidenceDirectory}));
  }
  const evidenceByNode = new Map(assetEvidence.map((entry) => [entry.nodeId, entry]));
  const targets = (await collectCompositeQualityTargets(project)).filter(({sceneId, pattern}) => sceneId === selected.id && ['supported-subject', 'registered-environment'].includes(pattern));
  const composites = [];
  for (const target of targets) {
    const localBounds = unionBounds(target.memberNodeIds.map((nodeId) => evidenceByNode.get(nodeId)?.alphaBounds).filter(Boolean));
    const bounds = proofBoundsFor({group: target.group, localBounds, video: project.video});
    const proofFrames = [];
    for (const proofTimeId of target.proofTimeIds) {
      const fullFrame = renderedFrames.get(proofTimeId);
      if (!fullFrame) continue;
      const id = `${safeId(target.compositeId)}-${safeId(proofTimeId)}`;
      const cropFile = path.join(cropDirectory, `${id}.png`);
      const debugFile = path.join(debugDirectory, `${id}.png`);
      await sharp(fullFrame).extract(bounds).png().toFile(cropFile);
      await sharp(fullFrame)
        .composite([{input: debugOverlay({width: project.video.width, height: project.video.height, bounds, label: `${target.compositeId} · ${proofTimeId}`})}])
        .png()
        .toFile(debugFile);
      proofFrames.push({
        proofTimeId,
        fullFrame: path.relative(ROOT, fullFrame),
        crop: path.relative(ROOT, cropFile),
        debugFrame: path.relative(ROOT, debugFile),
        bounds,
      });
    }
    composites.push({
      compositeId: target.compositeId,
      styleFingerprint: styleFingerprintForTarget(target),
      proofFrames,
    });
  }

  const probe = await probeMedia(output);
  const groups = coupledGroups.map(({node}) => ({id: node.id, pattern: node.pattern, registrationId: node.registration?.id ?? null, sourceMasterAssetId: node.registration?.sourceMasterAssetId ?? null}));
  await writeJson(reportFile, {
    schemaVersion: 3,
    slug,
    generatedAt: new Date().toISOString(),
    sceneId: selected.id,
    output: path.relative(ROOT, output),
    contactSheet: path.relative(ROOT, contactSheet),
    proofProject: path.relative(ROOT, propsFile),
    method: 'real v4 project composition, registered derivatives, authored keyframes and cue runtime',
    groups,
    composites,
    assetEvidence,
    durationSeconds: Number(probe.format?.duration ?? durationSeconds),
    proofFrameCount: panels.length,
  });
  console.log(`✓ v4 真实拓扑运动证明：${path.relative(ROOT, output)}`);
  console.log(`✓ 组合证明联系表：${path.relative(ROOT, contactSheet)}`);
  console.log(`✓ 运动报告：${path.relative(ROOT, reportFile)}`);
} catch (error) {
  console.error(`style:proof failed: ${error.message}`);
  process.exitCode = 1;
}
