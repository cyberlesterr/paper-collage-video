#!/usr/bin/env node
import {printCliHelp} from './cli-help-lib.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {resolveWorkspacePath} from './provider-lib.mjs';
import {
  loadProject,
  writeJsonTransaction,
} from './project-lib.mjs';
import {
  loadProduction,
  syncReviewFromProduction,
} from './production-state.mjs';
import {loadStoryboard, storyboardFileFor} from './storyboard-lib.mjs';
import {prepareDirectingRevision} from './directing-revision-lib.mjs';
import {
  synchronizeDirectingExecution,
} from './directing-execution-sync-lib.mjs';
import {motionLanguageCard} from './motion-contract-lib.mjs';

const args = process.argv.slice(2);
const USAGE =
  '用法：project:revise-preview-directing -- <slug> --input=<storyboard.json> [--execution=<candidate-project.json>] [--source=style-review|preview|asset-production] [--json]';
printCliHelp(args, USAGE);
const slug = args.find((arg) => !arg.startsWith('--'));
const input = args.find((arg) => arg.startsWith('--input='))?.slice('--input='.length);
const executionInput = args
  .find((arg) => arg.startsWith('--execution='))
  ?.slice('--execution='.length);
const source = args.find((arg) => arg.startsWith('--source='))?.slice('--source='.length) ?? 'preview';
const json = args.includes('--json');

try {
  if (!slug || !input) {
    throw new Error(USAGE);
  }
  const [{project}, {paths, state}, currentStoryboard] = await Promise.all([
    loadProject(slug),
    loadProduction(slug),
    loadStoryboard(slug),
  ]);
  const suppliedStoryboard = JSON.parse(
    await fs.readFile(resolveWorkspacePath(input, '导演重编 storyboard 输入路径'), 'utf8'),
  );
  const executionCandidate = executionInput
    ? JSON.parse(
        await fs.readFile(
          resolveWorkspacePath(
            executionInput,
            '导演重编 execution candidate 路径',
          ),
          'utf8',
        ),
      )
    : project;
  const reportPath = path.posix.join('projects', slug, 'directing-revision.json');
  const result = prepareDirectingRevision({
    currentStoryboard,
    suppliedStoryboard,
    plan: project.plan,
    styleProfile: project.styleProfile,
    production: state,
    reportPath,
    source,
  });
  const synchronized = synchronizeDirectingExecution({
    currentProject: project,
    storyboard: result.storyboard,
    executionCandidate,
    allowedSceneIds: result.report.changedSceneIds,
  });
  result.report.executionSyncRequired = false;
  result.report.executionSync = synchronized.report;
  await writeJsonTransaction([
    {file: storyboardFileFor(slug), value: result.storyboard},
    {file: paths.projectFile, value: synchronized.project},
    {
      file: paths.motionLanguageCardFile,
      value: motionLanguageCard(result.storyboard.motionContract),
    },
    {
      file: path.join(
        paths.projectDirectory,
        'directing-revision.json',
      ),
      value: result.report,
    },
    {file: paths.productionFile, value: result.production},
  ]);
  await syncReviewFromProduction(slug, result.production);
  if (json) console.log(JSON.stringify(result.report, null, 2));
  else {
    console.log(`✓ 正式导演重编已记录：${result.report.changedSceneIds.join(', ')}`);
    console.log('  project.json 执行树已在写入前自动同步并验证；旧证明已失效，请继续重新验证和预览。');
    console.log(`  报告：${reportPath}`);
  }
} catch (error) {
  console.error(`project:revise-preview-directing failed: ${error.message}`);
  process.exitCode = 1;
}
