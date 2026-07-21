#!/usr/bin/env node
import fs from 'node:fs/promises';
import {
  assertCreativePlanReady,
} from './creative-plan-lib.mjs';
import {
  PROVIDER_CAPABILITIES,
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
  const supplied = new Set(selections.map(({capability}) => capability));
  const missing = PROVIDER_CAPABILITIES.filter(
    (capability) => !supplied.has(capability),
  );
  if (missing.length) {
    throw new Error(`一次确认必须包含 text、image、voice；缺少：${missing.join(', ')}。`);
  }
  const {paths, state} = await loadProduction(slug);
  if (state.stage !== 'capability-review') {
    throw new Error(
      `project:confirm-concept 只能在 capability-review 阶段运行；当前为 ${state.stage}。`,
    );
  }
  const {project} = await loadProject(slug);
  assertCreativePlanReady(project.plan, {slug});
  await assertStoryboardReady(slug, project.plan);
  const at = new Date().toISOString();
  const confirmed = await writeProviderSelections({
    slug,
    selections,
    scope: payload.scope ?? 'project',
    note,
    at,
  });
  await assertSelectedProvidersReady(slug);

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
  console.log(`✓ 生产状态：${next.stage}`);
} catch (error) {
  console.error(`project:confirm-concept failed: ${error.message}`);
  process.exitCode = 1;
}
