#!/usr/bin/env node
import {printCliHelp} from './cli-help-lib.mjs';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import sharp from 'sharp';
import {
  LOOPING_WORLD_DURATION_SECONDS,
  LOOPING_WORLD_FPS,
  LOOPING_WORLD_GROUP_ID,
  LOOPING_WORLD_PROFILES,
  LOOPING_WORLD_SLUG,
} from '../fixtures/looping-world-fixture.mjs';
import {
  collectCompositeQualityTargets,
  inspectCompositeTechnical,
} from './quality-lib.mjs';
import {createRuntimeBuildFingerprint} from './runtime-build-lib.mjs';

const USAGE =
  "用法：npm run proof:looping-world:verify --";
printCliHelp(process.argv.slice(2), USAGE);

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, '..');
const PROOF_DIRECTORY = path.join(ROOT, 'dist', LOOPING_WORLD_SLUG);
const INPUTS_DIRECTORY = path.join(PROOF_DIRECTORY, 'inputs');
const PREVIEWS_DIRECTORY = path.join(PROOF_DIRECTORY, 'previews');
const FRAMES_DIRECTORY = path.join(PROOF_DIRECTORY, 'frames');
const REPORTS_DIRECTORY = path.join(PROOF_DIRECTORY, 'reports');
const CONTACT_SHEET = path.join(PROOF_DIRECTORY, 'looping-world-contact-sheet.png');

const readJson = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));
const writeJson = async (file, value) => {
  await fs.mkdir(path.dirname(file), {recursive: true});
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
};
const sha256File = async (file) =>
  createHash('sha256').update(await fs.readFile(file)).digest('hex');
const requireFile = async (file) => {
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size === 0) throw new Error(`缺少 proof artifact：${file}`);
};

const probeVideo = async (file) => {
  const {stdout} = await execFileAsync('ffprobe', [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_streams',
    '-show_format',
    file,
  ]);
  const probe = JSON.parse(stdout);
  const stream = probe.streams.find(({codec_type}) => codec_type === 'video');
  const audio = probe.streams.find(({codec_type}) => codec_type === 'audio');
  if (!stream) throw new Error(`${file} 缺少 video stream`);
  const [numerator, denominator] = String(stream.avg_frame_rate).split('/').map(Number);
  return {
    width: stream.width,
    height: stream.height,
    fps: numerator / denominator,
    durationSeconds: Number(stream.duration ?? probe.format.duration),
    frameCount: Number(stream.nb_frames),
    codec: stream.codec_name,
    audioCodec: audio?.codec_name ?? null,
    audioDurationSeconds: audio ? Number(audio.duration ?? probe.format.duration) : null,
  };
};

const extractFrame = async ({video, frame, output}) => {
  await fs.mkdir(path.dirname(output), {recursive: true});
  await execFileAsync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    video,
    '-vf',
    `select=eq(n\\,${frame})`,
    '-vsync',
    '0',
    '-frames:v',
    '1',
    output,
  ]);
  await requireFile(output);
};

const projects = {};
const manifest = await readJson(path.join(INPUTS_DIRECTORY, 'assets-manifest.json'));
const previewReports = [];
const frameArtifacts = [];
const proofFramesByProfile = new Map();
for (const profile of LOOPING_WORLD_PROFILES) {
  const suffix = profile.id.replace(':', 'x');
  const project = await readJson(path.join(INPUTS_DIRECTORY, `project-${suffix}.json`));
  projects[profile.id] = project;
  const video = path.join(PREVIEWS_DIRECTORY, `preview-${suffix}.mp4`);
  await requireFile(video);
  const probe = await probeVideo(video);
  const expectedFrames = LOOPING_WORLD_DURATION_SECONDS * LOOPING_WORLD_FPS;
  if (
    probe.width !== profile.width ||
    probe.height !== profile.height ||
    Math.abs(probe.fps - LOOPING_WORLD_FPS) > 0.001 ||
    Math.abs(probe.durationSeconds - LOOPING_WORLD_DURATION_SECONDS) > 0.04 ||
    probe.frameCount !== expectedFrames ||
    !probe.audioCodec
  ) {
    throw new Error(`${profile.id} preview 媒体规格不匹配：${JSON.stringify(probe)}`);
  }
  previewReports.push({
    profileId: profile.id,
    file: path.relative(ROOT, video),
    sha256: await sha256File(video),
    ...probe,
  });
  const proofFrames = [];
  for (const proof of project.scenes[0].motion.proofTimes) {
    const frame = Math.round(proof.at * (expectedFrames - 1));
    const output = path.join(FRAMES_DIRECTORY, suffix, `${proof.id}-f${frame}.png`);
    await extractFrame({video, frame, output});
    const artifact = {
      profileId: profile.id,
      sceneId: project.scenes[0].id,
      proofTimeId: proof.id,
      frame,
      file: path.relative(ROOT, output),
      sha256: await sha256File(output),
    };
    frameArtifacts.push(artifact);
    proofFrames.push({
      proofTimeId: proof.id,
      fullFrame: artifact.file,
      crop: artifact.file,
      debugFrame: artifact.file,
    });
  }
  proofFramesByProfile.set(profile.id, proofFrames);
}

const finalFile = path.join(PROOF_DIRECTORY, 'final-16x9.mp4');
await requireFile(finalFile);
const finalProbe = await probeVideo(finalFile);
if (
  finalProbe.width !== 960 ||
  finalProbe.height !== 540 ||
  Math.abs(finalProbe.durationSeconds - LOOPING_WORLD_DURATION_SECONDS) > 0.04 ||
  finalProbe.frameCount !== LOOPING_WORLD_DURATION_SECONDS * LOOPING_WORLD_FPS ||
  !finalProbe.audioCodec
) {
  throw new Error(`final 媒体规格不匹配：${JSON.stringify(finalProbe)}`);
}

const thumbnails = await Promise.all(frameArtifacts.map(async ({file}) =>
  sharp(path.join(ROOT, file))
    .resize(320, 180, {fit: 'contain', background: '#172e35'})
    .png()
    .toBuffer()
));
await sharp({
  create: {
    width: 960,
    height: 540,
    channels: 3,
    background: '#172e35',
  },
}).composite(thumbnails.map((input, index) => ({
  input,
  left: index % 3 * 320,
  top: Math.floor(index / 3) * 180,
}))).png().toFile(CONTACT_SHEET);

const runtimeBuildFingerprint = await createRuntimeBuildFingerprint();
const technicalReports = [];
for (const profile of LOOPING_WORLD_PROFILES) {
  const project = projects[profile.id];
  const targets = await collectCompositeQualityTargets(project, {manifest});
  const target = targets.find(
    ({pattern, nodeId}) =>
      pattern === 'looping-environment' && nodeId === LOOPING_WORLD_GROUP_ID,
  );
  if (!target) throw new Error(`${profile.id} 缺少 looping-environment quality target`);
  const suffix = profile.id.replace(':', 'x');
  const worldProof = await readJson(
    path.join(REPORTS_DIRECTORY, `world-motion-${suffix}.json`),
  );
  if (worldProof.runtimeBuildFingerprint !== runtimeBuildFingerprint) {
    throw new Error(`${profile.id} world motion proof runtime fingerprint 已过期`);
  }
  const proofReport = {
    composites: [{
      compositeId: target.compositeId,
      fingerprint: target.fingerprint,
      proofFrames: proofFramesByProfile.get(profile.id),
      loopingWorldProof: worldProof,
    }],
  };
  const checks = await inspectCompositeTechnical({target, proofReport});
  if (!checks.passed) {
    throw new Error(`${profile.id} technical composite proof failed: ${JSON.stringify(checks)}`);
  }
  technicalReports.push({
    profileId: profile.id,
    compositeId: target.compositeId,
    fingerprint: target.fingerprint,
    passed: checks.passed,
    checks: checks.checks,
  });
}

const acceptance = {
  schemaVersion: 1,
  passed:
    previewReports.length === 3 &&
    technicalReports.every(({passed}) => passed) &&
    finalProbe.frameCount === LOOPING_WORLD_DURATION_SECONDS * LOOPING_WORLD_FPS,
  runtimeBuildFingerprint,
  providerBudget: 0,
  providerCalls: 0,
  previews: previewReports,
  final: {
    file: path.relative(ROOT, finalFile),
    sha256: await sha256File(finalFile),
    ...finalProbe,
  },
  proofFrames: frameArtifacts,
  contactSheet: path.relative(ROOT, CONTACT_SHEET),
  contactSheetSha256: await sha256File(CONTACT_SHEET),
  technicalReports,
};
if (!acceptance.passed) throw new Error('looping world preview/final acceptance 未通过');
await writeJson(path.join(REPORTS_DIRECTORY, 'final-acceptance-report.json'), acceptance);

console.log('✓ three-profile preview acceptance passed');
console.log('✓ looping-world style/motion technical checks passed');
console.log(`✓ final accepted: ${path.relative(ROOT, finalFile)}`);
