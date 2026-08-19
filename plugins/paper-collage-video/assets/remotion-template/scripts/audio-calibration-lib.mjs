import {stableValue} from './contract-utils.mjs';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  collectProjectAudioEvents,
  runAudioPreflight,
} from './audio-preflight-lib.mjs';
import {
  ROOT,
  projectPaths,
  resolvePublicFile,
  writeJson,
} from './project-lib.mjs';

export const audioCalibrationPath = (slug) =>
  path.join(ROOT, 'projects', slug, 'audio-calibration.json');

export const validateAudioCalibration = (calibration, expectedSlug) => {
  const errors = [];
  if (calibration?.schemaVersion !== 2) errors.push('schemaVersion 必须为 2');
  if (calibration?.projectSlug !== expectedSlug) errors.push(`projectSlug 必须为 ${expectedSlug}`);
  if (!['ready', 'failed'].includes(calibration?.status)) {
    errors.push('status 必须为 ready 或 failed');
  }
  if (!/^[0-9a-f]{64}$/.test(calibration?.sourceFingerprint ?? '')) {
    errors.push('sourceFingerprint 必须是 sha256');
  }
  for (const key of ['currentNarrationVolume', 'recommendedNarrationVolume']) {
    if (!Number.isFinite(calibration?.[key]) || calibration[key] <= 0) {
      errors.push(`${key} 必须是正数`);
    }
  }
  if (!calibration?.processingNote?.trim()) errors.push('processingNote 不能为空');
  if (errors.length) throw new Error(`audio-calibration.json 无效：${errors.join('；')}`);
  return calibration;
};

export const createAudioCalibrationSourceFingerprint = async (project) => {
  const {timeline, events} = collectProjectAudioEvents(project);
  const sources = [];
  for (const src of [...new Set(events.map(({src}) => src))].sort()) {
    const file = resolvePublicFile(src);
    const bytes = await fs.readFile(file);
    sources.push({
      src,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }
  const contract = {
    projectSlug: project.slug,
    fps: project.video.fps,
    durationSeconds: timeline.durationSeconds,
    mastering: project.audio.mastering,
    events: events.map(({kind, id, sceneId = null, src, startSeconds, volume}) => ({
      kind,
      id,
      sceneId,
      src,
      startSeconds,
      volume: kind === 'narration' ? null : volume,
    })),
    sources,
  };
  return createHash('sha256')
    .update(JSON.stringify(stableValue(contract)))
    .digest('hex');
};

export const writeAudioCalibrationRecord = async ({
  project,
  report,
  at = new Date().toISOString(),
}) => {
  const sourceFingerprint = await createAudioCalibrationSourceFingerprint(project);
  const record = {
    $schema: '../../schemas/audio-calibration.schema.json',
    schemaVersion: 2,
    projectSlug: project.slug,
    status: report.passed ? 'ready' : 'failed',
    sourceFingerprint,
    currentNarrationVolume: project.audio.narration.volume,
    recommendedNarrationVolume: report.recommendedNarrationVolume,
    generatedAt: at,
    verifiedAt: report.passed ? at : undefined,
    processingNote: report.passed
      ? (
          report.masteringProcessing?.applied
            ? `系统已通过 ${report.masteringProcessing.method} 自动完成母带校准。`
            : '当前交付编码面预检已经通过。'
        )
      : '自动母带处理仍未达到交付契约；这是待诊断的技术失败，不是用户审批项。',
    preflight: report,
  };
  await writeJson(audioCalibrationPath(project.slug), record);
  return record;
};

export const ensureAudioCalibrationReady = async ({project}) => {
  const paths = projectPaths(project.slug);
  await fs.mkdir(paths.distDirectory, {recursive: true});
  const report = await runAudioPreflight({
    project,
    output: path.join(paths.distDirectory, 'audio-preflight.wav'),
  });
  const calibration = await writeAudioCalibrationRecord({project, report});
  return {ready: report.passed, calibration, report};
};
