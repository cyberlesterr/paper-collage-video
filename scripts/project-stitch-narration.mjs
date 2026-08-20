#!/usr/bin/env node
import {printCliHelp} from './cli-help-lib.mjs';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ROOT,
  loadProject,
  probeMedia,
  projectPaths,
  resolvePublicFile,
  runCommand,
  writeJson,
} from './project-lib.mjs';

const args = process.argv.slice(2);
const USAGE =
  '用法：project:stitch-narration -- <slug> --scenes=<scene-a,scene-b,...> --target-scene=<new-scene-id> [--gap-seconds=0]';
printCliHelp(args, USAGE);
const slug = args.find((argument) => !argument.startsWith('--'));
const sceneIds = (args.find((argument) => argument.startsWith('--scenes='))?.slice('--scenes='.length) ?? '').split(',').filter(Boolean);
const targetSceneId = args.find((argument) => argument.startsWith('--target-scene='))?.slice('--target-scene='.length);
const gapSeconds = Number(args.find((argument) => argument.startsWith('--gap-seconds='))?.slice('--gap-seconds='.length) ?? 0);

const sha256 = async (file) => createHash('sha256').update(await fs.readFile(file)).digest('hex');

try {
  if (!slug || sceneIds.length < 2 || !targetSceneId || !Number.isFinite(gapSeconds) || gapSeconds < 0 || gapSeconds > 2) {
    throw new Error(USAGE);
  }
  const {project} = await loadProject(slug);
  const indexes = sceneIds.map((id) => project.scenes.findIndex((scene) => scene.id === id));
  if (indexes.some((index) => index < 0) || indexes.some((index, offset) => offset > 0 && index !== indexes[0] + offset)) {
    throw new Error('只允许按项目时间线顺序拼接两个或以上相邻镜头的旁白。');
  }
  const scenes = indexes.map((index) => project.scenes[index]);
  const paths = projectPaths(slug);
  const directory = path.join(paths.publicDirectory, 'audio', 'narration', 'recuts');
  const output = path.join(directory, `${targetSceneId}.wav`);
  const reportFile = path.join(paths.projectDirectory, 'narration-recuts', `${targetSceneId}.json`);
  await fs.mkdir(directory, {recursive: true});
  const filters = scenes.map((_, index) =>
    `[${index}:a]aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo[a${index}]`,
  );
  const concatInputs = scenes.flatMap((_, index) =>
    index === scenes.length - 1 || gapSeconds === 0
      ? [`[a${index}]`]
      : [`[a${index}]`, `[gap${index}]`],
  ).join('');
  if (gapSeconds > 0) {
    for (let index = 0; index < scenes.length - 1; index += 1) {
      filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${gapSeconds.toFixed(3)}[gap${index}]`);
    }
  }
  await runCommand('ffmpeg', [
    '-v', 'error',
    ...scenes.flatMap((scene) => ['-i', resolvePublicFile(scene.narration.src)]),
    '-filter_complex', `${filters.join(';')};${concatInputs}concat=n=${scenes.length + (gapSeconds > 0 ? scenes.length - 1 : 0)}:v=0:a=1,aresample=48000[out]`,
    '-map', '[out]', '-c:a', 'pcm_s16le', '-y', output,
  ]);
  const expectedDurationSeconds = scenes.reduce((sum, scene) => sum + scene.narration.durationSeconds, 0) + gapSeconds * (scenes.length - 1);
  const probe = await probeMedia(output);
  const durationSeconds = Number(probe.format?.duration ?? 0);
  if (!(durationSeconds > 0)) throw new Error('无法测量拼接旁白的输出时长。');
  const subtitleOffsets = [];
  let offset = 0;
  for (const scene of scenes) {
    for (const subtitle of scene.subtitles ?? []) subtitleOffsets.push({...subtitle, fromSeconds: subtitle.fromSeconds + offset, toSeconds: subtitle.toSeconds + offset, sourceSceneId: scene.id});
    offset += scene.narration.durationSeconds + gapSeconds;
  }
  const report = {
    schemaVersion: 1,
    projectSlug: slug,
    targetSceneId,
    generatedAt: new Date().toISOString(),
    sourceSceneIds: sceneIds,
    gapSeconds,
    output: {
      src: path.posix.join('projects', slug, 'audio', 'narration', 'recuts', `${targetSceneId}.wav`),
      file: path.relative(ROOT, output),
      sha256: await sha256(output),
      durationSeconds,
      expectedDurationSeconds,
    },
    narration: {
      text: scenes.map(({narration}) => narration.text).join(' '),
      subtitles: subtitleOffsets,
      sources: scenes.map(({id, narration}) => ({sceneId: id, src: narration.src, durationSeconds: narration.durationSeconds})),
    },
    nextStep: '将此报告中的 output 与 narration 字段写入经审阅的合幕 scene；再运行 project:revise-preview-directing、project:composition-proof 和 project:scene-preview。',
  };
  await writeJson(reportFile, report);
  console.log(`✓ stitched narration: ${path.relative(ROOT, output)}`);
  console.log(`✓ recut report: ${path.relative(ROOT, reportFile)}`);
} catch (error) {
  console.error(`project:stitch-narration failed: ${error.message}`);
  process.exitCode = 1;
}
