#!/usr/bin/env node
import {parseCliValue} from './contract-utils.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {resolveWorkspacePath} from './provider-lib.mjs';
import {
  fileExists,
  loadProject,
  readJson,
  writeJsonTransaction,
} from './project-lib.mjs';
import {
  loadProduction,
  syncReviewFromProduction,
} from './production-state.mjs';
import {
  loadStoryboard,
  storyboardFileFor,
} from './storyboard-lib.mjs';
import {prepareSemanticRevision} from './directing-revision-lib.mjs';
import {
  synchronizeDirectingExecution,
} from './directing-execution-sync-lib.mjs';
import {motionLanguageCard} from './motion-contract-lib.mjs';

const args = process.argv.slice(2);
const slug = args.find((arg) => !arg.startsWith('--'));
const valueFor = (name) => parseCliValue(args, name);
const input = valueFor('--input');
const authorizationInput = valueFor('--authorization');
const executionInput = valueFor('--execution');
const json = args.includes('--json');

try {
  if (!slug || !input || !authorizationInput) {
    throw new Error(
      '用法：project:revise-preview-semantic -- <slug> --input=<storyboard.json> --authorization=<semantic-revision-authorization.json> [--execution=<candidate-project.json>] [--json]',
    );
  }
  const [
    {project, paths},
    {paths: productionPaths, state},
    currentStoryboard,
    suppliedStoryboard,
    authorization,
  ] = await Promise.all([
    loadProject(slug),
    loadProduction(slug),
    loadStoryboard(slug),
    fs
      .readFile(
        resolveWorkspacePath(input, '语义重编 storyboard 输入路径'),
        'utf8',
      )
      .then(JSON.parse),
    fs
      .readFile(
        resolveWorkspacePath(
          authorizationInput,
          '语义重编人工授权输入路径',
        ),
        'utf8',
      )
      .then(JSON.parse),
  ]);
  let scenarioOption = null;
  if (
    project.plan?.scenarioBinding &&
    await fileExists(paths.planningScenariosFile)
  ) {
    const scenarios = await readJson(paths.planningScenariosFile);
    scenarioOption = scenarios.options?.find(
      ({id}) => id === project.plan.scenarioBinding.optionId,
    ) ?? null;
  }
  const reportPath = path.posix.join(
    'projects',
    slug,
    'semantic-revision.json',
  );
  const result = prepareSemanticRevision({
    currentStoryboard,
    suppliedStoryboard,
    plan: project.plan,
    styleProfile: project.styleProfile,
    production: state,
    authorization,
    reportPath,
    scenarioOption,
  });
  const executionCandidate = executionInput
    ? JSON.parse(
        await fs.readFile(
          resolveWorkspacePath(
            executionInput,
            '语义重编 execution candidate 路径',
          ),
          'utf8',
        ),
      )
    : project;
  const synchronized = synchronizeDirectingExecution({
    currentProject: {
      ...project,
      plan: result.plan,
    },
    storyboard: result.storyboard,
    executionCandidate: {
      ...executionCandidate,
      plan: result.plan,
    },
    allowedSceneIds: result.report.changedSceneIds,
  });
  synchronized.project.plan = result.plan;
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
        productionPaths.projectDirectory,
        'semantic-revision.json',
      ),
      value: result.report,
    },
    {file: productionPaths.productionFile, value: result.production},
  ]);
  await syncReviewFromProduction(slug, result.production);
  if (json) {
    console.log(JSON.stringify(result.report, null, 2));
  } else {
    console.log(
      `✓ 人工授权语义重编已记录：${result.report.semanticChangedSceneIds.join(', ')}`,
    );
    if (result.report.profilePromiseRecalculation?.changed) {
      console.log(
        `  locked-static 重算：${result.report.profilePromiseRecalculation.lockedSceneIds.join(', ')}`,
      );
    }
    console.log('  project.json 执行树已在写入前自动同步；旧 style/composition/render 证据已失效，请重新证明。');
    console.log(`  报告：${reportPath}`);
  }
} catch (error) {
  console.error(`project:revise-preview-semantic failed: ${error.message}`);
  process.exitCode = 1;
}
