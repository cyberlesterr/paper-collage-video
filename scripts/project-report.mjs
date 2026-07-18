#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {
  ROOT,
  deriveContactSheetSamples,
  fileExists,
  loadProject,
  probeMedia,
  projectPaths,
  runCommand,
  validateProject,
  writeJson,
} from './project-lib.mjs';
import {prepareQualityReport} from './quality-lib.mjs';

const args = process.argv.slice(2);
const slug = args.find((arg) => !arg.startsWith('--'));
const artifactArgument = args.find((arg) => arg.startsWith('--artifact='));

const escapeXml = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const parseVolume = (stderr) => {
  const mean = stderr.match(/mean_volume:\s*(-?[\d.]+) dB/);
  const max = stderr.match(/max_volume:\s*(-?[\d.]+) dB/);
  return {
    meanDb: mean ? Number(mean[1]) : null,
    maxDb: max ? Number(max[1]) : null,
  };
};

const parseLoudness = (stderr) => {
  const match = stderr.match(/\{\s*"input_i"[\s\S]*?"target_offset"\s*:\s*"[^"]+"\s*\}/g)?.at(-1);
  if (!match) return {integratedLufs: null, truePeakDbtp: null, loudnessRangeLu: null};
  const parsed = JSON.parse(match);
  const numberOrNull = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  return {
    integratedLufs: numberOrNull(parsed.input_i),
    truePeakDbtp: numberOrNull(parsed.input_tp),
    loudnessRangeLu: numberOrNull(parsed.input_lra),
  };
};

const parseFrameRate = (value) => {
  const [numerator, denominator] = String(value ?? '0/1')
    .split('/')
    .map(Number);
  return denominator ? numerator / denominator : 0;
};

const mapWithConcurrency = async (items, limit, mapper) => {
  const results = new Array(items.length);
  const concurrency = Math.max(1, Math.min(limit, items.length));
  await Promise.all(
    Array.from({length: concurrency}, async (_, workerIndex) => {
      for (let index = workerIndex; index < items.length; index += concurrency) {
        results[index] = await mapper(items[index], index);
      }
    }),
  );
  return results;
};

const createContactSheet = async ({video, output, samples, framesDirectory}) => {
  await fs.mkdir(framesDirectory, {recursive: true});
  const panels = await mapWithConcurrency(
    samples,
    4,
    async (sample, index) => {
      const {time} = sample;
      const frameFile = path.join(framesDirectory, `frame-${index + 1}.png`);
      await runCommand('ffmpeg', [
        '-v',
        'error',
        '-ss',
        time.toFixed(3),
        '-i',
        video,
        '-frames:v',
        '1',
        '-y',
        frameFile,
      ]);
      const image = await sharp(frameFile)
        .resize(480, 270, {fit: 'cover'})
        .png()
        .toBuffer();
      return {...sample, image};
    },
  );

  const padding = 24;
  const gap = 18;
  const panelWidth = 480;
  const panelHeight = 270;
  const labelHeight = 42;
  const columns = Math.min(3, panels.length);
  const rows = Math.ceil(panels.length / columns);
  const width = padding * 2 + panelWidth * columns + gap * (columns - 1);
  const height = padding * 2 + (panelHeight + labelHeight) * rows + gap * (rows - 1);
  const composite = [];
  for (const [index, panel] of panels.entries()) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = padding + column * (panelWidth + gap);
    const top = padding + row * (panelHeight + labelHeight + gap);
    composite.push({input: panel.image, left, top});
    const label = Buffer.from(`
      <svg width="${panelWidth}" height="${labelHeight}">
        <rect width="100%" height="100%" fill="#2b1713"/>
        <text x="16" y="28" fill="#f6ead2" font-size="18" font-family="Arial, PingFang SC, sans-serif">
          ${escapeXml(`${panel.label} · ${panel.time.toFixed(2)}s`)}
        </text>
      </svg>
    `);
    composite.push({input: label, left, top: top + panelHeight});
  }
  await sharp({
    create: {width, height, channels: 3, background: '#160f0d'},
  })
    .composite(composite)
    .jpeg({quality: 90})
    .toFile(output);
};

try {
  const {project} = await loadProject(slug);
  const paths = projectPaths(slug);
  const requestedArtifact = artifactArgument?.slice('--artifact='.length);
  const finalArtifact = path.join(paths.distDirectory, 'final.mp4');
  const previewArtifact = path.join(paths.distDirectory, 'preview.mp4');
  const artifact = requestedArtifact
    ? path.resolve(ROOT, requestedArtifact)
    : (await fileExists(finalArtifact))
      ? finalArtifact
      : previewArtifact;
  if (!(await fileExists(artifact))) {
    throw new Error('没有可验收的视频，请先运行 project:preview 或 project:render。');
  }

  const validation = await validateProject(project);
  const probe = await probeMedia(artifact);
  const durationSeconds = Number(probe.format?.duration ?? 0);
  const videoStream = probe.streams?.find((stream) => stream.codec_type === 'video');
  const audioStream = probe.streams?.find((stream) => stream.codec_type === 'audio');
  const volume = audioStream
    ? parseVolume(
        (
          await runCommand('ffmpeg', [
            '-i',
            artifact,
            '-map',
            '0:a:0',
            '-af',
            'volumedetect',
            '-f',
            'null',
            '-',
          ])
        ).stderr,
      )
    : {meanDb: null, maxDb: null};
  const loudness = audioStream
    ? parseLoudness(
        (
          await runCommand('ffmpeg', [
            '-i',
            artifact,
            '-map',
            '0:a:0',
            '-af',
            'loudnorm=I=-16:TP=-1:LRA=11:print_format=json',
            '-f',
            'null',
            '-',
          ])
        ).stderr,
      )
    : {integratedLufs: null, truePeakDbtp: null, loudnessRangeLu: null};
  const isPreview = path.basename(artifact) === 'preview.mp4';
  const expectedScale = isPreview ? 0.5 : 1;
  const expectedWidth = Math.round(project.video.width * expectedScale);
  const expectedHeight = Math.round(project.video.height * expectedScale);
  const frameRate = parseFrameRate(videoStream?.r_frame_rate);
  const technicalChecks = [
    {
      id: 'video-stream',
      passed: Boolean(videoStream),
      expected: 'present',
      actual: videoStream ? 'present' : 'missing',
    },
    {
      id: 'resolution',
      passed:
        videoStream?.width === expectedWidth &&
        videoStream?.height === expectedHeight,
      expected: `${expectedWidth}x${expectedHeight}`,
      actual: videoStream ? `${videoStream.width}x${videoStream.height}` : 'missing',
    },
    {
      id: 'frame-rate',
      passed: Math.abs(frameRate - project.video.fps) < 0.001,
      expected: project.video.fps,
      actual: frameRate,
    },
    {
      id: 'duration',
      passed:
        Math.abs(durationSeconds - validation.timeline.durationSeconds) <= 0.1,
      expected: validation.timeline.durationSeconds,
      actual: durationSeconds,
    },
    {
      id: 'audio-stream',
      passed: Boolean(audioStream),
      expected: 'present',
      actual: audioStream ? 'present' : 'missing',
    },
    {
      id: 'audio-clipping',
      passed: volume.maxDb === null || volume.maxDb <= -0.1,
      expected: '<= -0.1 dB',
      actual: volume.maxDb,
    },
  ];
  const mastering = project.audio?.mastering;
  if (mastering) {
    technicalChecks.push(
      {
        id: 'audio-loudness',
        passed:
          loudness.integratedLufs !== null &&
          Math.abs(loudness.integratedLufs - mastering.targetLufs) <=
            mastering.toleranceLufs,
        expected: `${mastering.targetLufs} ± ${mastering.toleranceLufs} LUFS`,
        actual: loudness.integratedLufs,
      },
      {
        id: 'audio-true-peak',
        passed:
          loudness.truePeakDbtp !== null &&
          loudness.truePeakDbtp <= mastering.truePeakDbtp,
        expected: `<= ${mastering.truePeakDbtp} dBTP`,
        actual: loudness.truePeakDbtp,
      },
    );
  }
  const contactSheet = path.join(paths.distDirectory, 'contact-sheet.jpg');
  const contactSheetSamples = deriveContactSheetSamples({
    timeline: validation.timeline,
    fps: project.video.fps,
    durationSeconds,
  });
  await createContactSheet({
    video: artifact,
    output: contactSheet,
    samples: contactSheetSamples,
    framesDirectory: path.join(paths.distDirectory, 'frames'),
  });

  const quality = await prepareQualityReport(slug);
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    project: {slug: project.slug, title: project.title},
    artifact: {
      file: path.relative(ROOT, artifact),
      durationSeconds,
      sizeBytes: Number(probe.format?.size ?? 0),
      bitRate: Number(probe.format?.bit_rate ?? 0),
      video: videoStream
        ? {
            codec: videoStream.codec_name,
            width: videoStream.width,
            height: videoStream.height,
            frameRate: videoStream.r_frame_rate,
          }
        : null,
      audio: audioStream
        ? {
            codec: audioStream.codec_name,
            sampleRate: Number(audioStream.sample_rate),
            channels: audioStream.channels,
            ...volume,
            ...loudness,
          }
        : null,
    },
    validation: {
      passed: validation.passed,
      summary: validation.summary,
      issues: validation.issues,
    },
    quality: {
      mode: quality.mode,
      ready: quality.ready,
      actualPassed: quality.actualPassed,
      total: quality.total,
      passed: quality.passed,
      pending: quality.pending,
      failed: quality.failed,
      file: path.relative(ROOT, quality.file),
    },
    technicalChecks,
    passed:
      validation.passed &&
      quality.ready &&
      technicalChecks.every((check) => check.passed),
    contactSheet: path.relative(ROOT, contactSheet),
    contactSheetSamples,
  };
  const reportFile = path.join(paths.distDirectory, 'report.json');
  await writeJson(reportFile, report);
  console.log(`✓ 验收报告：${path.relative(ROOT, reportFile)}`);
  console.log(`✓ 关键帧联系表：${path.relative(ROOT, contactSheet)}`);
  for (const check of technicalChecks) {
    console.log(
      `${check.passed ? '✓' : '✗'} ${check.id}: ${check.actual} (expected ${check.expected})`,
    );
  }
  if (!report.passed) process.exitCode = 1;
} catch (error) {
  console.error(`project:report failed: ${error.message}`);
  process.exitCode = 1;
}
