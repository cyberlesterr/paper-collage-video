#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ROOT,
  loadProject,
  writeJsonTransaction,
} from './project-lib.mjs';
import {resolveWorkspacePath} from './provider-lib.mjs';
import {loadStoryboard} from './storyboard-lib.mjs';
import {
  synchronizeDirectingExecution,
} from './directing-execution-sync-lib.mjs';

const args = process.argv.slice(2);
const slug = args.find((argument) => !argument.startsWith('--'));
const valueFor = (name) =>
  args.find((argument) => argument.startsWith(`${name}=`))
    ?.slice(name.length + 1);

try {
  if (!slug) {
    throw new Error(
      '用法：project:sync-directing -- <slug> [--execution=<candidate-project.json>] [--scenes=<scene-a,scene-b>] [--json]',
    );
  }
  const [{project, paths}, storyboard] = await Promise.all([
    loadProject(slug),
    loadStoryboard(slug),
  ]);
  const executionInput = valueFor('--execution');
  const executionCandidate = executionInput
    ? JSON.parse(
        await fs.readFile(
          resolveWorkspacePath(
            executionInput,
            '导演执行候选项目路径',
          ),
          'utf8',
        ),
      )
    : project;
  const requestedScenes = valueFor('--scenes')
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const allowedSceneIds =
    requestedScenes?.length > 0
      ? requestedScenes
      : storyboard.scenes.map(({id}) => id);
  const synchronized = synchronizeDirectingExecution({
    currentProject: project,
    storyboard,
    executionCandidate,
    allowedSceneIds,
  });
  const report = {
    schemaVersion: 1,
    slug,
    createdAt: new Date().toISOString(),
    allowedSceneIds,
    ...synchronized.report,
  };
  const reportFile = path.join(
    paths.projectDirectory,
    'directing-execution-sync.json',
  );
  await writeJsonTransaction([
    {file: paths.projectFile, value: synchronized.project},
    {file: reportFile, value: report},
  ]);
  if (args.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `✓ 导演执行树已同步：${report.changedSceneIds.join(', ') || '根契约字段'}`,
    );
    console.log(`✓ 报告：${path.relative(ROOT, reportFile)}`);
  }
} catch (error) {
  console.error(`project:sync-directing failed: ${error.message}`);
  process.exitCode = 1;
}
