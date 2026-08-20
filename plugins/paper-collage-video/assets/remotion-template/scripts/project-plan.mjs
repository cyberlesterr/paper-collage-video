#!/usr/bin/env node
import {printCliHelp} from './cli-help-lib.mjs';
import {parseCliValue, stableStringify} from './contract-utils.mjs';
import {
  buildCreativePlan,
  PRODUCTION_PROFILES,
  summarizeConceptDecision,
} from './creative-plan-lib.mjs';
import {assertIntakeConfirmed} from './intake-lib.mjs';
import {
  assertPlanningScenariosReady,
  buildCreativePlanFromScenario,
} from './planning-scenario-lib.mjs';
import {
  assertSlug,
  loadProject,
  readJson,
  writeJson,
} from './project-lib.mjs';
import {loadProduction} from './production-state.mjs';

const args = process.argv.slice(2);
const USAGE =
  "用法：npm run project:plan -- <slug> [--duration] [--json] [--narration-seconds] [--profile] [--rationale] [--requested-duration] [--requested-scenes] [--scenario] [--scenes]";
printCliHelp(args, USAGE);
const json = args.includes('--json');
const slug = args.find((arg) => !arg.startsWith('--'));
const valueFor = (name) => parseCliValue(args, name);

const optionalNumber = (name, {integer = false} = {}) => {
  const raw = valueFor(name);
  if (raw === undefined) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || (integer && !Number.isInteger(parsed))) {
    throw new Error(`${name} 必须是${integer ? '正整数' : '正数'}。`);
  }
  return parsed;
};

const printPlan = ({project, json}) => {
  const decision = summarizeConceptDecision(project.plan);
  if (json) {
    console.log(JSON.stringify({plan: project.plan, decision}, null, 2));
    return;
  }
  console.log(`✓ 创作规格：${project.plan.inputMode}`);
  console.log(`  目标时长：${project.plan.resolved.durationSeconds}s`);
  console.log(
    `  时长权威：${decision.durationAuthority === 'human-target' ? '用户指定目标；实测内容必须满足容差' : '内容推断；旁白生成后以实测内容为准'}`,
  );
  console.log(`  目标幕数：${project.plan.resolved.sceneCount}`);
  console.log(`  制作档位：${project.plan.productionProfile}`);
  if (project.plan.scenarioBinding) {
    console.log(`  叙事范围：${project.plan.storyScope}`);
    console.log(`  scenario：${project.plan.scenarioBinding.optionId} · ${project.plan.scenarioBinding.optionFingerprint}`);
    console.log(
      `  scenario 图片调用：预计 ${project.plan.scenarioBinding.expectedProviderImageCalls} · 建议批准上限 ${project.plan.scenarioBinding.proposedImageAttemptLimit}`,
    );
  }
  console.log(
    `  生图 profile ceiling：基础 ${project.plan.assetBudget.baseImageAttempts} + 分层 source-package 预留 ${project.plan.assetBudget.layerPackageAttemptReserve} = 最多 ${project.plan.assetBudget.maxGeneratedImages} 次计费尝试`,
  );
  console.log(
    `  人批准图片尝试上限：${project.plan.approvedImageBudget?.imageAttemptLimit ?? '待组合概念审批'}`,
  );
  console.log(`  动作预算：最多 ${project.plan.motionBudget.maxPoseSheetCalls} 张姿态母版 · 单张 ${project.plan.motionBudget.maxStatesPerSheet} 格 · ${project.plan.motionBudget.maxContinuousTargets} 个连续动效目标`);
  console.log('  可选制作档位：');
  for (const option of decision.profileOptions) {
    const selected = option.id === decision.productionProfile ? '（当前）' : '';
    console.log(
      `    ${option.id}${selected}: 基础 ${option.assetBudget.baseImageAttempts} + 分层预留 ${option.assetBudget.layerPackageAttemptReserve} = 最多 ${option.assetBudget.maxGeneratedImages} 次生图 / ${option.motionBudget.maxPoseSheetCalls} 张姿态母版 · ${option.finalImpact}`,
    );
  }
  console.log(`  计算依据：${project.plan.resolved.rationale}`);
};

try {
  assertSlug(slug);
  const durationSeconds = optionalNumber('--duration');
  const sceneCount = optionalNumber('--scenes', {integer: true});
  const scenarioId = valueFor('--scenario');
  const {paths, project} = await loadProject(slug);
  if (
    scenarioId === undefined &&
    durationSeconds === null &&
    sceneCount === null &&
    project.plan?.status === 'resolved'
  ) {
    printPlan({project, json});
  } else if (scenarioId !== undefined) {
    if (!PRODUCTION_PROFILES.includes(scenarioId)) {
      throw new Error(`--scenario 必须是 ${PRODUCTION_PROFILES.join('|')}。`);
    }
    if (durationSeconds !== null || sceneCount !== null) {
      throw new Error('--scenario 不能与 --duration 或 --scenes 同时使用。');
    }
    const {state} = await loadProduction(slug);
    if (!['capability-review', 'brief', 'concept-review'].includes(state.stage)) {
      throw new Error(
        `project:plan 只能在 capability-review、brief 或 concept-review 阶段运行；当前为 ${state.stage}。`,
      );
    }
    assertIntakeConfirmed(project.intake);
    const scenarios = assertPlanningScenariosReady(
      await readJson(paths.planningScenariosFile),
      {slug, intake: project.intake},
    );
    // Re-selecting the same option must be a no-op: a fresh resolvedAt/
    // selectedAt would silently invalidate a planDecision the author already
    // copied into their concept selection.
    const priorBinding = project.plan?.scenarioBinding ?? null;
    const unchanged =
      priorBinding?.optionId === scenarioId &&
      priorBinding?.scenarioSetFingerprint === scenarios.fingerprint &&
      priorBinding?.optionFingerprint ===
        scenarios.options.find(({id}) => id === scenarioId)?.fingerprint;
    const rebuilt = buildCreativePlanFromScenario({
      slug,
      scenarios,
      optionId: scenarioId,
      ...(unchanged ? {at: priorBinding.selectedAt} : {}),
    });
    if (!unchanged || stableStringify(rebuilt) !== stableStringify(project.plan)) {
      project.plan = rebuilt;
      await writeJson(paths.projectFile, project);
    }
    printPlan({project, json});
  } else if (durationSeconds === null || sceneCount === null) {
    throw new Error(
      '推荐：project:plan -- <slug> --scenario=draft|balanced|full-depth；兼容直接规划：' +
        'project:plan -- <slug> --duration=<补全时长秒数> --scenes=<补全幕数> ' +
        '[--requested-duration=<用户指定秒数>] [--requested-scenes=<用户指定幕数>] ' +
        `[--narration-seconds=<预计旁白秒数>] [--profile=${PRODUCTION_PROFILES.join('|')}] ` +
        '--rationale=<计算依据>；已有计划可用 project:plan -- <slug> --json 只读查看。',
    );
  } else {
    const requestedDurationSeconds = optionalNumber('--requested-duration');
    const requestedSceneCount = optionalNumber('--requested-scenes', {integer: true});
    const estimatedNarrationSeconds = optionalNumber('--narration-seconds');
    const rationale = valueFor('--rationale');
    const {state} = await loadProduction(slug);
    if (!['capability-review', 'brief', 'concept-review'].includes(state.stage)) {
      throw new Error(
        `project:plan 只能在 capability-review、brief 或 concept-review 阶段运行；当前为 ${state.stage}。`,
      );
    }
    const productionProfile = valueFor('--profile') ?? 'balanced';
    project.plan = buildCreativePlan({
      slug,
      requestedDurationSeconds,
      requestedSceneCount,
      durationSeconds,
      sceneCount,
      estimatedNarrationSeconds,
      productionProfile,
      rationale,
    });
    await writeJson(paths.projectFile, project);
    printPlan({project, json});
  }
} catch (error) {
  console.error(`project:plan failed: ${error.message}`);
  process.exitCode = 1;
}
