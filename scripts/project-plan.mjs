#!/usr/bin/env node
import {
  buildCreativePlan,
  PRODUCTION_PROFILES,
} from './creative-plan-lib.mjs';
import {assertSlug, loadProject, writeJson} from './project-lib.mjs';
import {loadProduction} from './production-state.mjs';

const args = process.argv.slice(2);
const slug = args.find((arg) => !arg.startsWith('--'));
const valueFor = (name) =>
  args.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1);

const optionalNumber = (name, {integer = false} = {}) => {
  const raw = valueFor(name);
  if (raw === undefined) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || (integer && !Number.isInteger(parsed))) {
    throw new Error(`${name} 必须是${integer ? '正整数' : '正数'}。`);
  }
  return parsed;
};

try {
  assertSlug(slug);
  const durationSeconds = optionalNumber('--duration');
  const sceneCount = optionalNumber('--scenes', {integer: true});
  if (durationSeconds === null || sceneCount === null) {
    throw new Error(
      '用法：project:plan -- <slug> --duration=<补全时长秒数> --scenes=<补全幕数> ' +
        '[--requested-duration=<用户指定秒数>] [--requested-scenes=<用户指定幕数>] ' +
        `[--narration-seconds=<预计旁白秒数>] [--profile=${PRODUCTION_PROFILES.join('|')}] ` +
        '--rationale=<计算依据>',
    );
  }
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
  const {paths, project} = await loadProject(slug);
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
  console.log(`✓ 创作规格已补全：${project.plan.inputMode}`);
  console.log(`  目标时长：${project.plan.resolved.durationSeconds}s`);
  console.log(`  目标幕数：${project.plan.resolved.sceneCount}`);
  console.log(`  制作档位：${project.plan.productionProfile}`);
  console.log(`  生图预算：最多 ${project.plan.assetBudget.maxGeneratedImages} 张`);
  console.log(`  计算依据：${project.plan.resolved.rationale}`);
} catch (error) {
  console.error(`project:plan failed: ${error.message}`);
  process.exitCode = 1;
}
