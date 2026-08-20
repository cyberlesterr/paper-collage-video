#!/usr/bin/env node
import {printCliHelp} from './cli-help-lib.mjs';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ROOT,
  formatValidation,
  loadProject,
  projectPaths,
  resolveRenderConcurrency,
  runCommand,
  validateProject,
  writeJson,
} from './project-lib.mjs';
import {createVisualFingerprint} from './render-cache-lib.mjs';

const args = process.argv.slice(2);
const USAGE =
  '用法：project:scene-preview -- <slug> --scene=<sceneId>';
printCliHelp(args, USAGE);
const slug = args.find((argument) => !argument.startsWith('--'));
const sceneId = args.find((argument) => argument.startsWith('--scene='))?.slice('--scene='.length);

const run = (command, commandArgs) => new Promise((resolve, reject) => {
  const child = spawn(command, commandArgs, {cwd: ROOT, stdio: 'inherit'});
  child.once('error', reject);
  child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code ?? signal}`)));
});

try {
  if (!slug || !sceneId) throw new Error(USAGE);
  await runCommand(process.execPath, ['scripts/project-sync.mjs', slug]);
  const {project} = await loadProject(slug);
  const validation = await validateProject(project);
  console.log(formatValidation(validation));
  if (!validation.passed) throw new Error('项目校验未通过，不能生成真实场景预览。');
  const scene = project.scenes.find(({id}) => id === sceneId);
  if (!scene) throw new Error(`不存在镜头：${sceneId}`);
  const paths = projectPaths(slug);
  const directory = path.join(paths.distDirectory, 'scene-previews');
  const propsFile = path.join(directory, `${sceneId}.project.json`);
  const output = path.join(directory, `${sceneId}.mp4`);
  const reportFile = path.join(directory, `${sceneId}.json`);
  await fs.mkdir(directory, {recursive: true});
  const previewProject = {
    ...project,
    scenes: [scene],
    sceneTransitions: [],
    worlds: (project.worlds ?? []).filter(({sceneIds}) => sceneIds.includes(sceneId)).map((world) => ({...world, sceneIds: [sceneId]})),
    trajectoryContracts: [],
  };
  await writeJson(propsFile, previewProject);
  const remotion = path.join(ROOT, 'node_modules', '.bin', 'remotion');
  await run(remotion, ['browser', 'ensure']);
  await run(remotion, [
    'render', 'src/index.ts', 'Paper-Collage', output,
    `--props=${path.relative(ROOT, propsFile)}`,
    `--concurrency=${resolveRenderConcurrency()}`,
    '--scale=0.5', '--crf=28', '--audio-bitrate=96k', '--log=error',
  ]);
  await writeJson(reportFile, {
    schemaVersion: 1,
    projectSlug: slug,
    sceneId,
    generatedAt: new Date().toISOString(),
    scope: 'actual-scene-composition',
    source: {
      project: path.relative(ROOT, paths.projectFile),
      sceneId,
      visualFingerprint: await createVisualFingerprint(previewProject, 'scene-preview'),
    },
    props: path.relative(ROOT, propsFile),
    artifact: path.relative(ROOT, output),
    note: '这是实际 project.json 中该镜头的独立渲染，不是风格样张；跨幕转场会在全片 preview 中另行审阅。',
  });
  console.log(`✓ actual scene preview: ${path.relative(ROOT, output)}`);
  console.log(`✓ report: ${path.relative(ROOT, reportFile)}`);
} catch (error) {
  console.error(`project:scene-preview failed: ${error.message}`);
  process.exitCode = 1;
}
