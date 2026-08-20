#!/usr/bin/env node
import {printCliHelp} from './cli-help-lib.mjs';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {
  collectCompositionVisualSources,
} from './composition-lib.mjs';
import {
  deriveContactSheetSamples,
  deriveTimeline,
  probeMedia,
  readJson,
  runCommand,
  writeJson,
} from './project-lib.mjs';
import {compileStoryboardDirecting} from './motion-treatment-lib.mjs';
import {createRuntimeBuildManifest} from './runtime-build-lib.mjs';
import {
  assertVoxSampleProofPassed,
  buildVoxSampleProofReport,
} from './vox-sample-proof-lib.mjs';
import {createEditorialFixture} from '../fixtures/editorial-fixture.mjs';
import {FIXTURE_STYLE_PROFILE} from '../fixtures/motion-contract-fixture.mjs';

const USAGE =
  "用法：npm run sample:vox:verify -- [--preview=<值>]";
printCliHelp(process.argv.slice(2), USAGE);

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIRECTORY, '..');
const FIXTURE_DIRECTORY = path.join(ROOT, 'fixtures', 'vox-primitives');
const OUTPUT_DIRECTORY = path.join(ROOT, 'dist', 'vox-primitives', 'proof');
const previewArgument = process.argv.find((argument) => argument.startsWith('--preview='));
const preview = previewArgument
  ? path.resolve(ROOT, previewArgument.slice('--preview='.length))
  : path.join(ROOT, 'dist', 'vox-primitives', 'preview.mp4');

const sha256File = async (file) =>
  createHash('sha256').update(await fs.readFile(file)).digest('hex');

const escapeXml = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const extractFrame = async ({frame, output}) => {
  await runCommand('ffmpeg', [
    '-v',
    'error',
    '-i',
    preview,
    '-vf',
    `select=eq(n\\,${frame})`,
    '-frames:v',
    '1',
    '-y',
    output,
  ]);
};

const createContactSheet = async ({samples, output}) => {
  const frameDirectory = path.join(OUTPUT_DIRECTORY, 'frames');
  await fs.mkdir(frameDirectory, {recursive: true});
  const panels = [];
  for (const [index, sample] of samples.entries()) {
    const frameFile = path.join(frameDirectory, `${String(index + 1).padStart(2, '0')}-${sample.frame}.png`);
    await extractFrame({frame: sample.frame, output: frameFile});
    panels.push({
      ...sample,
      file: path.relative(ROOT, frameFile),
      image: await sharp(frameFile).resize(480, 270, {fit: 'cover'}).png().toBuffer(),
    });
  }
  const columns = 3;
  const rows = Math.ceil(panels.length / columns);
  const panelWidth = 480;
  const panelHeight = 270;
  const labelHeight = 44;
  const gap = 16;
  const padding = 20;
  const composites = [];
  for (const [index, panel] of panels.entries()) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = padding + column * (panelWidth + gap);
    const top = padding + row * (panelHeight + labelHeight + gap);
    composites.push({input: panel.image, left, top});
    composites.push({
      input: Buffer.from(`
        <svg width="${panelWidth}" height="${labelHeight}">
          <rect width="100%" height="100%" fill="#263a3d"/>
          <text x="14" y="28" fill="#fff8ea" font-size="17" font-family="Arial, sans-serif">
            ${escapeXml(`${panel.label} · f${panel.frame} · ${panel.time.toFixed(3)}s`)}
          </text>
        </svg>
      `),
      left,
      top: top + panelHeight,
    });
  }
  await sharp({
    create: {
      width: padding * 2 + columns * panelWidth + (columns - 1) * gap,
      height: padding * 2 + rows * (panelHeight + labelHeight) + (rows - 1) * gap,
      channels: 3,
      background: '#17282a',
    },
  }).composite(composites).jpeg({quality: 92}).toFile(output);
  return panels.map(({image, ...panel}) => panel);
};

const [contract, project, storyboard, media, runtimeBuild] = await Promise.all([
  readJson(path.join(FIXTURE_DIRECTORY, 'proof-contract.json')),
  readJson(path.join(FIXTURE_DIRECTORY, 'project.json')),
  readJson(path.join(FIXTURE_DIRECTORY, 'storyboard-input.json')),
  probeMedia(preview),
  createRuntimeBuildManifest({root: ROOT}),
]);
const compiledStoryboard = compileStoryboardDirecting({
  ...storyboard,
  editorial: createEditorialFixture({
    sceneIds: storyboard.scenes.map(({id}) => id),
    fps: project.video.fps,
  }),
}, {
  plan: project.plan,
  styleProfile: FIXTURE_STYLE_PROFILE,
});
const timeline = deriveTimeline(project);
const durationSeconds = Number(media.format?.duration ?? contract.expected.durationSeconds);
const proofSamples = deriveContactSheetSamples({
  timeline,
  fps: project.video.fps,
  durationSeconds,
  maxPanels: 16,
}).map((sample) => ({
  ...sample,
  frame: Math.round(sample.time * project.video.fps),
}));
const boundaryFrame = timeline.scenes[1].from;
proofSamples.push(
  {
    label: 'rhythmic cut · outgoing',
    sceneId: timeline.scenes[0].id,
    kind: 'boundary-before',
    frame: boundaryFrame - 1,
    time: (boundaryFrame - 1) / project.video.fps,
  },
  {
    label: 'rhythmic cut · incoming',
    sceneId: timeline.scenes[1].id,
    kind: 'boundary-after',
    frame: boundaryFrame,
    time: boundaryFrame / project.video.fps,
  },
);
await fs.mkdir(OUTPUT_DIRECTORY, {recursive: true});
const contactSheet = path.join(OUTPUT_DIRECTORY, 'contact-sheet.jpg');
const renderedSamples = await createContactSheet({samples: proofSamples, output: contactSheet});
const assetFiles = [...new Set(project.scenes.flatMap((scene) => [
  ...collectCompositionVisualSources(scene.composition),
  scene.narration.src,
]))].sort();
const assetFingerprints = Object.fromEntries(await Promise.all(
  assetFiles.map(async (relative) => [
    relative,
    await sha256File(path.join(ROOT, 'public', relative)),
  ]),
));
const report = buildVoxSampleProofReport({
  contract,
  project,
  storyboard,
  compiledStoryboard,
  timeline,
  media,
  runtimeBuild,
  fingerprints: {
    project: await sha256File(path.join(FIXTURE_DIRECTORY, 'project.json')),
    storyboard: await sha256File(path.join(FIXTURE_DIRECTORY, 'storyboard-input.json')),
    preview: await sha256File(preview),
    assets: assetFingerprints,
  },
  proofSamples: renderedSamples,
  artifacts: {
    preview: path.relative(ROOT, preview),
    contactSheet: path.relative(ROOT, contactSheet),
  },
  generatedAt: new Date().toISOString(),
});
const reportFile = path.join(OUTPUT_DIRECTORY, 'report.json');
await writeJson(reportFile, report);
assertVoxSampleProofPassed(report);
console.log(`✓ VOX 样片正式证明通过：${path.relative(ROOT, reportFile)}`);
console.log(`✓ 固定证明联系表：${path.relative(ROOT, contactSheet)}`);
console.log(`✓ 视频 SHA-256：${report.fingerprints.preview}`);
