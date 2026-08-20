#!/usr/bin/env node
import {printCliHelp} from './cli-help-lib.mjs';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import sharp from 'sharp';
import {
  PATH_LOCOMOTION_CONTRACT_ID,
  PATH_LOCOMOTION_DURATION_SECONDS,
  PATH_LOCOMOTION_FPS,
  PATH_LOCOMOTION_PROFILES,
  PATH_LOCOMOTION_SLUG,
} from '../fixtures/path-locomotion-fixture.mjs';
import {
  collectCompositeQualityTargets,
  inspectCompositeTechnical,
} from './quality-lib.mjs';
import {createRuntimeBuildFingerprint} from './runtime-build-lib.mjs';

const USAGE =
  "用法：npm run proof:path-locomotion:verify --";
printCliHelp(process.argv.slice(2), USAGE);

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, '..');
const PROOF_DIRECTORY = path.join(ROOT, 'dist', PATH_LOCOMOTION_SLUG);
const INPUTS_DIRECTORY = path.join(PROOF_DIRECTORY, 'inputs');
const PREVIEWS_DIRECTORY = path.join(PROOF_DIRECTORY, 'previews');
const FRAMES_DIRECTORY = path.join(PROOF_DIRECTORY, 'frames');
const REPORTS_DIRECTORY = path.join(PROOF_DIRECTORY, 'reports');
const CONTACT_SHEET = path.join(
  PROOF_DIRECTORY,
  'path-locomotion-contact-sheet.png',
);

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
  const video = probe.streams.find(({codec_type}) => codec_type === 'video');
  const audio = probe.streams.find(({codec_type}) => codec_type === 'audio');
  if (!video) throw new Error(`${file} 缺少 video stream`);
  const [numerator, denominator] = String(video.avg_frame_rate).split('/').map(Number);
  return {
    width: video.width,
    height: video.height,
    fps: numerator / denominator,
    durationSeconds: Number(video.duration ?? probe.format.duration),
    frameCount: Number(video.nb_frames),
    codec: video.codec_name,
    audioCodec: audio?.codec_name ?? null,
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

const manifest = await readJson(path.join(INPUTS_DIRECTORY, 'assets-manifest.json'));
const runtimeBuildFingerprint = await createRuntimeBuildFingerprint();
const previewReports = [];
const frameArtifacts = [];
const technicalReports = [];
for (const profile of PATH_LOCOMOTION_PROFILES) {
  const suffix = profile.id.replace(':', 'x');
  const project = await readJson(
    path.join(INPUTS_DIRECTORY, `project-${suffix}.json`),
  );
  const video = path.join(PREVIEWS_DIRECTORY, `preview-${suffix}.mp4`);
  await requireFile(video);
  const probe = await probeVideo(video);
  const expectedFrames =
    PATH_LOCOMOTION_DURATION_SECONDS * PATH_LOCOMOTION_FPS;
  if (
    probe.width !== profile.width ||
    probe.height !== profile.height ||
    Math.abs(probe.fps - PATH_LOCOMOTION_FPS) > 0.001 ||
    Math.abs(probe.durationSeconds - PATH_LOCOMOTION_DURATION_SECONDS) > 0.04 ||
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

  const target = (await collectCompositeQualityTargets(project, {manifest}))
    .find(
      ({pattern, spatialContract}) =>
        pattern === 'spatial-contract' &&
        spatialContract?.id === PATH_LOCOMOTION_CONTRACT_ID,
    );
  if (!target) throw new Error(`${profile.id} 缺少 path-locomotion quality target`);
  const spatialProof = await readJson(
    path.join(REPORTS_DIRECTORY, `spatial-proof-${suffix}.json`),
  );
  if (spatialProof.runtimeBuildFingerprint !== runtimeBuildFingerprint) {
    throw new Error(`${profile.id} spatial proof runtime fingerprint 已过期`);
  }
  const checks = await inspectCompositeTechnical({
    target,
    proofReport: {
      composites: [{
        compositeId: target.compositeId,
        fingerprint: target.fingerprint,
        proofFrames,
        spatialProof,
      }],
    },
  });
  if (!checks.passed) {
    throw new Error(
      `${profile.id} technical proof failed: ${JSON.stringify(checks)}`,
    );
  }
  technicalReports.push({
    profileId: profile.id,
    compositeId: target.compositeId,
    fingerprint: target.fingerprint,
    passed: checks.passed,
    checks: checks.checks,
  });
}

const finalFile = path.join(PROOF_DIRECTORY, 'final-16x9.mp4');
await requireFile(finalFile);
const finalProbe = await probeVideo(finalFile);
if (
  finalProbe.width !== 960 ||
  finalProbe.height !== 540 ||
  finalProbe.frameCount !== PATH_LOCOMOTION_DURATION_SECONDS * PATH_LOCOMOTION_FPS ||
  Math.abs(finalProbe.durationSeconds - PATH_LOCOMOTION_DURATION_SECONDS) > 0.04 ||
  !finalProbe.audioCodec
) {
  throw new Error(`final 媒体规格不匹配：${JSON.stringify(finalProbe)}`);
}

const thumbnails = await Promise.all(frameArtifacts.map(async ({file}) =>
  sharp(path.join(ROOT, file))
    .resize(320, 180, {fit: 'contain', background: '#17353d'})
    .png()
    .toBuffer()
));
await sharp({
  create: {
    width: 960,
    height: 900,
    channels: 3,
    background: '#17353d',
  },
}).composite(thumbnails.map((input, index) => ({
  input,
  left: index % 3 * 320,
  top: Math.floor(index / 3) * 180,
}))).png().toFile(CONTACT_SHEET);

const acceptance = {
  schemaVersion: 1,
  passed:
    previewReports.length === PATH_LOCOMOTION_PROFILES.length &&
    technicalReports.every(({passed}) => passed),
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
if (!acceptance.passed) {
  throw new Error('path locomotion preview/final acceptance 未通过');
}
await writeJson(
  path.join(REPORTS_DIRECTORY, 'final-acceptance-report.json'),
  acceptance,
);

console.log('✓ three-profile preview acceptance passed');
console.log(
  '✓ path, depth projection/order, heading, turn, gait, and camera technical checks passed',
);
console.log(`✓ final accepted: ${path.relative(ROOT, finalFile)}`);
