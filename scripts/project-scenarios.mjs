#!/usr/bin/env node
import {printCliHelp} from './cli-help-lib.mjs';
import {parseCliValue} from './contract-utils.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {assertIntakeConfirmed} from './intake-lib.mjs';
import {
  assertPlanningScenariosReady,
  buildPlanningScenarios,
  scenarioDecisionFor,
} from './planning-scenario-lib.mjs';
import {resetUnconfirmedCreativePlan} from './creative-plan-lib.mjs';
import {loadProject, projectPaths, readJson, writeJson} from './project-lib.mjs';
import {resolveWorkspacePath} from './provider-lib.mjs';
import {loadProduction} from './production-state.mjs';

const args = process.argv.slice(2);
const USAGE =
  '用法：project:scenarios -- <slug> [--input=<scenarios.json> [--replace-unconfirmed-plan]|--json]';
printCliHelp(args, USAGE);
const slug = args.find((arg) => !arg.startsWith('--'));
const json = args.includes('--json');
const replaceUnconfirmedPlan = args.includes('--replace-unconfirmed-plan');
const valueFor = (name) => parseCliValue(args, name);

// Derived, unapproved storyboard artifacts. Budget approval and any generation
// attempt are checked before this runs, so nothing here has been paid for.
const DERIVED_STORYBOARD_ARTIFACTS = [
  'storyboard.json',
  'motion-language-card.json',
  'sound-effect-plan.json',
  'semantic-contracts.json',
];

const clearUnapprovedMotionContract = async ({project, paths}) => {
  const cleared = [];
  if (project.motionContract !== null && project.motionContract !== undefined) {
    project.motionContract = null;
    cleared.push('project.motionContract');
  }
  project.editorial = null;
  project.spatialContracts = [];
  for (const name of DERIVED_STORYBOARD_ARTIFACTS) {
    const file = path.join(paths.projectDirectory, name);
    const exists = await fs
      .stat(file)
      .then((stat) => stat.isFile())
      .catch(() => false);
    if (!exists) continue;
    await fs.rm(file, {force: true});
    cleared.push(name);
  }
  return cleared;
};

const printScenarios = (scenarios) => {
  const decisions = scenarios.options.map(({id}) =>
    scenarioDecisionFor(scenarios, id),
  );
  if (json) {
    console.log(JSON.stringify({scenarios, decisions}, null, 2));
    return;
  }
  console.log(`✓ 三档规划：共同故事骨架 ${scenarios.commonStory.beats.length} 个节拍`);
  console.log(
    `  executable style: ${scenarios.styleProfileBinding.id} · ${scenarios.styleProfileBinding.profileFingerprint}`,
  );
  for (const option of scenarios.options) {
    const estimate = option.providerEstimate;
    console.log(
      `  ${option.label}: ${option.durationSeconds}s · ${option.sceneCount} 幕 · expected ${estimate.expectedImageCalls} / proposed cap ${estimate.proposedImageAttemptLimit} / hard ceiling ${estimate.hardCeiling} · local ${estimate.localDerivatives} · avoided ${estimate.avoidedCalls}`,
    );
    console.log(`    ${option.finalEffect}`);
  }
};

try {
  if (!slug) throw new Error(USAGE);
  const {state} = await loadProduction(slug);
  if (state.stage !== 'capability-review') {
    throw new Error(`project:scenarios 只能在 capability-review 阶段运行；当前为 ${state.stage}。`);
  }
  const {project} = await loadProject(slug);
  assertIntakeConfirmed(project.intake);
  const paths = projectPaths(slug);
  const input = valueFor('--input');
  let scenarios;
  if (input) {
    if (project.plan?.status === 'resolved') {
      if (!replaceUnconfirmedPlan) {
        throw new Error(
          'Creative Plan 已锁定；若概念尚未批准且 provider 零消费，请在获得新的明确人工授权后使用 --replace-unconfirmed-plan。',
        );
      }
      if (state.approvals?.concept?.status !== 'pending') {
        throw new Error(
          '--replace-unconfirmed-plan 只能用于 concept approval 仍为 pending 的项目。',
        );
      }
      if (project.plan.approvedImageBudget !== null) {
        throw new Error(
          '--replace-unconfirmed-plan 拒绝已批准预算的项目。',
        );
      }
      const attempts = await fs.readFile(paths.generationAttemptsFile, 'utf8');
      if (attempts.trim()) {
        throw new Error(
          '--replace-unconfirmed-plan 拒绝已有 generation attempt 记录的项目。',
        );
      }
      const manifest = await readJson(
        `${paths.projectDirectory}/assets-manifest.json`,
      );
      if ((manifest.assets ?? []).length > 0) {
        throw new Error(
          '--replace-unconfirmed-plan 拒绝已有 manifest asset 的项目。',
        );
      }
    }
    const supplied = JSON.parse(
      await fs.readFile(resolveWorkspacePath(input, 'scenario 输入路径'), 'utf8'),
    );
    scenarios = buildPlanningScenarios({
      slug,
      intake: project.intake,
      input: supplied,
    });
    if (project.plan?.status === 'resolved') {
      project.plan = resetUnconfirmedCreativePlan(project.plan, {slug});
      // Reaching the scenario gate again always means a storyboard was already
      // compiled — that is where material drift becomes visible. The motion
      // contract it produced is derived and unapproved, so clearing it is what
      // makes the documented "go back to the scenario gate" path executable.
      const clearedArtifacts = await clearUnapprovedMotionContract({
        project,
        paths,
      });
      await writeJson(paths.projectFile, project);
      if (clearedArtifacts.length > 0) {
        console.log(
          `已清除未获批的 motion contract 与派生产物：${clearedArtifacts.join('、')}`,
        );
      }
    }
    await writeJson(paths.planningScenariosFile, scenarios);
  } else {
    scenarios = assertPlanningScenariosReady(
      await readJson(paths.planningScenariosFile),
      {slug, intake: project.intake},
    );
  }
  printScenarios(scenarios);
} catch (error) {
  console.error(`project:scenarios failed: ${error.message}`);
  process.exitCode = 1;
}
