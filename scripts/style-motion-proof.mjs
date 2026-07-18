#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {
  ROOT,
  assertSlug,
  fileExists,
  probeMedia,
  projectPaths,
  runCommand,
  writeJson,
} from './project-lib.mjs';

const args = process.argv.slice(2);
const slug = args.find((argument) => !argument.startsWith('--'));
const valueFor = (name) =>
  args.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1);
const numberFor = (name, fallback) => {
  const raw = valueFor(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} 必须是正数。`);
  }
  return parsed;
};

const assertInsideWorkspace = (file, label) => {
  const relative = path.relative(ROOT, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} 必须位于当前工作区。`);
  }
};

const bandAlpha = (y, top, bottom, feather) => {
  if (y < top || y > bottom) return 0;
  if (y < top + feather) return (y - top) / feather;
  if (y > bottom - feather) return (bottom - y) / feather;
  return 1;
};

const ellipseAlpha = (x, y, centerX, centerY, radiusX, radiusY) => {
  const distance = Math.sqrt(
    ((x - centerX) / radiusX) ** 2 + ((y - centerY) / radiusY) ** 2,
  );
  if (distance >= 1) return 0;
  if (distance <= 0.7) return 1;
  return (1 - distance) / 0.3;
};

const createMaskedOverlay = async ({source, width, height, alphaFor}) => {
  const {data, info} = await sharp(source)
    .resize(width, height, {fit: 'cover', position: 'centre'})
    .ensureAlpha()
    .raw()
    .toBuffer({resolveWithObject: true});
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = (y * width + x) * info.channels;
      const alpha = pixel + 3;
      data[alpha] = Math.round(
        data[alpha] *
          Math.max(
            0,
            Math.min(
              1,
              alphaFor(x, y, {
                red: data[pixel],
                green: data[pixel + 1],
                blue: data[pixel + 2],
              }),
            ),
          ),
      );
    }
  }
  return sharp(data, {
    raw: {width: info.width, height: info.height, channels: info.channels},
  })
    .png()
    .toBuffer();
};

try {
  assertSlug(slug);
  const paths = projectPaths(slug);
  const inputArgument = valueFor('--input');
  if (!inputArgument) {
    throw new Error(
      '用法：style:proof -- <slug> --input=<工作区图片路径> [--duration=5] [--fps=30]',
    );
  }
  const input = path.resolve(ROOT, inputArgument);
  assertInsideWorkspace(input, '输入图片');
  if (!(await fileExists(input))) throw new Error(`输入图片不存在：${inputArgument}`);

  const durationSeconds = numberFor('--duration', 5);
  const fps = numberFor('--fps', 30);
  const frames = Math.max(1, Math.round(durationSeconds * fps));
  const lastFrame = Math.max(1, frames - 1);
  const width = 960;
  const height = 540;
  const proofDirectory = path.join(paths.distDirectory, 'style-proof');
  const output = path.join(paths.distDirectory, 'style-motion-proof.mp4');
  const reportFile = path.join(paths.distDirectory, 'style-motion-proof.json');
  const contactSheet = path.join(
    paths.distDirectory,
    'style-motion-proof-contact-sheet.jpg',
  );
  const sourceBackup = path.join(
    proofDirectory,
    `source${path.extname(input).toLowerCase() || '.png'}`,
  );
  const normalizedTemp = path.join(path.dirname(input), '.style-sample-normalized.png');
  const waterLayer = path.join(proofDirectory, 'water-band.png');
  const foregroundLayer = path.join(proofDirectory, 'foreground-band.png');
  const grindLayer = path.join(proofDirectory, 'grind-region.png');

  await fs.mkdir(proofDirectory, {recursive: true});
  if (!(await fileExists(sourceBackup))) {
    await fs.copyFile(input, sourceBackup);
  }
  await sharp(input)
    .resize(1920, 1080, {fit: 'cover', position: 'centre', kernel: sharp.kernel.lanczos3})
    .png({compressionLevel: 9})
    .toFile(normalizedTemp);
  await fs.rename(normalizedTemp, input);

  await fs.writeFile(
    waterLayer,
    await createMaskedOverlay({
      source: input,
      width,
      height,
      alphaFor: (_x, y, {red, green, blue}) => {
        const coolColor = Math.max(
          0,
          Math.min(1, ((green + blue) / 2 - red + 12) / 42),
        );
        return bandAlpha(y, height * 0.52, height * 0.83, 24) * coolColor;
      },
    }),
  );
  await fs.writeFile(
    foregroundLayer,
    await createMaskedOverlay({
      source: input,
      width,
      height,
      alphaFor: (_x, y) => bandAlpha(y, height * 0.78, height, 28),
    }),
  );
  await fs.writeFile(
    grindLayer,
    await createMaskedOverlay({
      source: input,
      width,
      height,
      alphaFor: (x, y) =>
        ellipseAlpha(x, y, width * 0.76, height * 0.64, width * 0.18, height * 0.23),
    }),
  );

  const filter = [
    `[0:v]scale=1000:562,crop=${width}:${height}:x='20+8*n/${lastFrame}':y='11+2*sin(n*PI/${lastFrame})',setsar=1[base]`,
    `[1:v]scale=1020:574,crop=${width}:${height}:x='30+12*sin(n*PI/${lastFrame})':y=17,setsar=1[water]`,
    `[2:v]scale=1040:585,crop=${width}:${height}:x='40+18*sin(n*PI/${lastFrame})':y='22+3*sin(n*PI/${lastFrame})',setsar=1[foreground]`,
    `[3:v]scale=${width}:${height},setsar=1[grind]`,
    `[base][water]overlay=0:0:shortest=1[with-water]`,
    `[with-water][grind]overlay=x='2*sin(2*PI*t/1.4)':y=0:shortest=1[with-grind]`,
    `[with-grind][foreground]overlay=0:0:shortest=1,format=yuv420p[video]`,
  ].join(';');

  await runCommand('ffmpeg', [
    '-v',
    'error',
    '-loop',
    '1',
    '-framerate',
    String(fps),
    '-i',
    input,
    '-loop',
    '1',
    '-framerate',
    String(fps),
    '-i',
    waterLayer,
    '-loop',
    '1',
    '-framerate',
    String(fps),
    '-i',
    foregroundLayer,
    '-loop',
    '1',
    '-framerate',
    String(fps),
    '-i',
    grindLayer,
    '-filter_complex',
    filter,
    '-map',
    '[video]',
    '-frames:v',
    String(frames),
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '18',
    '-movflags',
    '+faststart',
    '-y',
    output,
  ]);

  const probe = await probeMedia(output);
  const video = probe.streams?.find(({codec_type}) => codec_type === 'video');
  const samples = [0, durationSeconds / 2, Math.max(0, durationSeconds - 0.1)];
  const panels = await Promise.all(
    samples.map(async (time, index) => {
      const frame = path.join(proofDirectory, `proof-frame-${index + 1}.png`);
      await runCommand('ffmpeg', [
        '-v',
        'error',
        '-ss',
        time.toFixed(3),
        '-i',
        output,
        '-frames:v',
        '1',
        '-y',
        frame,
      ]);
      return sharp(frame).resize(480, 270, {fit: 'cover'}).jpeg().toBuffer();
    }),
  );
  await sharp({
    create: {width: 1440, height: 270, channels: 3, background: '#160f0d'},
  })
    .composite(
      panels.map((inputBuffer, index) => ({
        input: inputBuffer,
        left: index * 480,
        top: 0,
      })),
    )
    .jpeg({quality: 90})
    .toFile(contactSheet);
  const report = {
    schemaVersion: 1,
    slug,
    generatedAt: new Date().toISOString(),
    input: path.relative(ROOT, input),
    preservedSource: path.relative(ROOT, sourceBackup),
    output: path.relative(ROOT, output),
    contactSheet: path.relative(ROOT, contactSheet),
    method: 'single-sample masked parallax and local grind-region motion proof',
    productionCaveat:
      'This gate proof reuses masked regions from one approved sample. Production scenes still require independent background, environment and character assets.',
    durationSeconds: Number(probe.format?.duration ?? durationSeconds),
    fps,
    frames,
    width: video?.width ?? width,
    height: video?.height ?? height,
    layers: ['base-push', 'water-band', 'grind-region', 'foreground-band'],
  };
  await writeJson(reportFile, report);
  console.log(`✓ 风格样片已规范化：${path.relative(ROOT, input)} (1920x1080)`);
  console.log(`✓ 运动证明：${path.relative(ROOT, output)}`);
  console.log(`✓ 运动联系表：${path.relative(ROOT, contactSheet)}`);
  console.log(`✓ 运动报告：${path.relative(ROOT, reportFile)}`);
} catch (error) {
  console.error(`style:proof failed: ${error.message}`);
  process.exitCode = 1;
}
