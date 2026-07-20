#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {collectCompositionGroups} from './composition-lib.mjs';
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
  const reportFile = path.join(paths.distDirectory, 'style-motion-proof.json');
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
  const panels = await Promise.all(proofs.map(async (proof, index) => {
    const frameFile = path.join(proofDirectory, `proof-${index + 1}-${proof.id}.png`);
    await runCommand('ffmpeg', ['-v', 'error', '-ss', (proof.at * durationSeconds).toFixed(3), '-i', output, '-frames:v', '1', '-y', frameFile]);
    return sharp(frameFile).resize(480, 270, {fit: 'cover'}).jpeg().toBuffer();
  }));
  await sharp({create: {width: panels.length * 480, height: 270, channels: 3, background: '#160f0d'}})
    .composite(panels.map((input, index) => ({input, left: index * 480, top: 0})))
    .jpeg({quality: 90})
    .toFile(contactSheet);

  const probe = await probeMedia(output);
  const groups = collectCompositionGroups(selected.composition).filter(({node}) => node.pattern !== 'free').map(({node}) => ({id: node.id, pattern: node.pattern, registrationId: node.registration?.id ?? null, sourceMasterAssetId: node.registration?.sourceMasterAssetId ?? null}));
  await writeJson(reportFile, {
    schemaVersion: 2,
    slug,
    generatedAt: new Date().toISOString(),
    sceneId: selected.id,
    output: path.relative(ROOT, output),
    contactSheet: path.relative(ROOT, contactSheet),
    proofProject: path.relative(ROOT, propsFile),
    method: 'real v4 project composition, registered derivatives, authored keyframes and cue runtime',
    groups,
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
