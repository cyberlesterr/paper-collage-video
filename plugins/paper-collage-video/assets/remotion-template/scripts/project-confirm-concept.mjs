#!/usr/bin/env node
import fs from 'node:fs/promises';
import {
  assertApprovedImageBudgetDecision,
  assertCreativePlanReady,
  assertConfirmedPlanDecision,
} from './creative-plan-lib.mjs';
import {
  assertSelectedProvidersReady,
  resolveWorkspacePath,
  writeProviderSelections,
} from './provider-lib.mjs';
import {loadProject, writeJson} from './project-lib.mjs';
import {
  loadProduction,
  syncReviewFromProduction,
  transitionProduction,
} from './production-state.mjs';
import {assertStoryboardReady} from './storyboard-lib.mjs';
import {assertSourcePackageDecision} from './layer-source-plan-lib.mjs';
import {
  assertPlanningScenariosReady,
  assertScenarioDecision,
  assertStoryboardMatchesScenario,
} from './planning-scenario-lib.mjs';
import {assertIntakeConfirmed} from './intake-lib.mjs';
import {readJson} from './project-lib.mjs';
import {
  requiredProviderCapabilitiesForStoryboard,
} from './sound-effect-lib.mjs';

const args = process.argv.slice(2);
const slug = args.find((arg) => !arg.startsWith('--'));
const valueFor = (name) =>
  args.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1);

const normalizeSelections = (value) => {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    return Object.entries(value).map(([capability, selection]) => ({
      capability,
      ...selection,
    }));
  }
  throw new Error('selections 必须是数组或按 capability 分组的对象。');
};

try {
  if (!slug) {
    throw new Error(
      '用法：project:confirm-concept -- <slug> --input=<selection.json> 或 --selection=<json>',
    );
  }
  const input = valueFor('--input');
  const inline = valueFor('--selection');
  if (Boolean(input) === Boolean(inline)) {
    throw new Error('--input 和 --selection 必须且只能提供一个。');
  }
  const payload = input
    ? JSON.parse(await fs.readFile(resolveWorkspacePath(input, 'selection 路径'), 'utf8'))
    : JSON.parse(inline);
  const note = String(payload.note ?? '').trim();
  if (!note) throw new Error('确认文件必须记录人的概念与 provider 决定。');
  const selections = normalizeSelections(payload.selections);
  const {paths, state} = await loadProduction(slug);
  if (state.stage !== 'capability-review') {
    throw new Error(
      `project:confirm-concept 只能在 capability-review 阶段运行；当前为 ${state.stage}。`,
    );
  }
  const {project} = await loadProject(slug);
  assertCreativePlanReady(project.plan, {slug});
  const confirmedPlan = assertConfirmedPlanDecision(payload.planDecision, project.plan);
  let confirmedScenario = null;
  let selectedScenarioOption = null;
  if (project.plan.scenarioBinding) {
    assertIntakeConfirmed(project.intake);
    const scenarios = assertPlanningScenariosReady(
      await readJson(paths.planningScenariosFile),
      {slug, intake: project.intake},
    );
    confirmedScenario = assertScenarioDecision(
      payload.scenarioDecision,
      scenarios,
      project.plan.productionProfile,
    );
    selectedScenarioOption = scenarios.options.find(
      ({id}) => id === project.plan.productionProfile,
    );
    if (
      payload.budgetDecision?.imageAttemptLimit !==
      confirmedScenario.proposedImageAttemptLimit
    ) {
      throw new Error(
        `budgetDecision.imageAttemptLimit 必须等于用户在 scenario 卡确认的 ${confirmedScenario.proposedImageAttemptLimit} 次。`,
      );
    }
  }
  const storyboard = await assertStoryboardReady(
    slug,
    project.plan,
    project.styleProfile,
  );
  const requiredProviderCapabilities =
    requiredProviderCapabilitiesForStoryboard(storyboard);
  const supplied = new Set(selections.map(({capability}) => capability));
  const missing = requiredProviderCapabilities.filter(
    (capability) => !supplied.has(capability),
  );
  if (missing.length) {
    throw new Error(
      `本故事板一次确认必须包含 ${requiredProviderCapabilities.join(', ')}；缺少：${missing.join(', ')}。`,
    );
  }
  if (selectedScenarioOption) {
    assertStoryboardMatchesScenario(
      selectedScenarioOption,
      storyboard.directingSummary,
    );
  }
  const confirmedSourcePackages = assertSourcePackageDecision(
    payload.sourcePackageDecision,
    storyboard.directingSummary,
  );
  const at = new Date().toISOString();
  const approvedImageBudget = assertApprovedImageBudgetDecision(
    payload.budgetDecision,
    project.plan,
    storyboard.directingSummary,
    {at},
  );
  const confirmed = await writeProviderSelections({
    slug,
    selections,
    scope: payload.scope ?? 'project',
    note,
    at,
  });
  await assertSelectedProvidersReady(slug, {
    capabilities: requiredProviderCapabilities,
  });
  project.plan = {
    ...project.plan,
    approvedImageBudget,
    updatedAt: at,
  };
  assertCreativePlanReady(project.plan, {slug});
  await writeJson(paths.projectFile, project);

  let next = transitionProduction(state, 'capabilities-ready', {note, at});
  next = transitionProduction(next, 'brief-ready', {at});
  next = transitionProduction(next, 'approve-concept', {note, at});
  await writeJson(paths.productionFile, next);
  await syncReviewFromProduction(slug, next);

  console.log(
    `✓ 已一次确认概念与 provider：${confirmed.selections
      .map(({provider}) => `${provider.capability}=${provider.id}`)
      .join(', ')}`,
  );
  console.log(
    `✓ 已锁定制作规格：${confirmedPlan.productionProfile} · ${confirmedPlan.durationSeconds}s · ${confirmedPlan.sceneCount} 幕 · ${confirmedPlan.durationAuthority}`,
  );
  if (confirmedScenario) {
    console.log(
      `✓ 已锁定 scenario：${confirmedScenario.storyScope} · expected ${confirmedScenario.expectedProviderImageCalls} · approved cap ${confirmedScenario.proposedImageAttemptLimit} · hard ceiling ${confirmedScenario.profileHardCeiling}`,
    );
  }
  console.log(
    `✓ 已锁定分层 source packages：结构最低 ${confirmedSourcePackages.requiredProviderImageCalls} 次图片调用 · 预计 ${confirmedSourcePackages.expectedProviderImageCalls} 次 · profile hard ceiling ${confirmedSourcePackages.hardCeiling ?? '未设置'}`,
  );
  console.log(
    `✓ 已锁定人批准图片尝试上限：${approvedImageBudget.imageAttemptLimit} 次（预计 ${approvedImageBudget.expectedProviderImageCalls} 次）`,
  );
  console.log(`✓ 生产状态：${next.stage}`);
} catch (error) {
  console.error(`project:confirm-concept failed: ${error.message}`);
  process.exitCode = 1;
}
