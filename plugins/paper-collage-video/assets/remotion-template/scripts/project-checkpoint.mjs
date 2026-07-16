#!/usr/bin/env node
import {assertSlug} from './project-lib.mjs';
import {
  advanceWorkItem,
  formatProduction,
  WORK_ITEM_STATUSES,
} from './production-state.mjs';

const args = process.argv.slice(2);
const positional = args.filter((arg) => !arg.startsWith('--'));
const [slug, id, status] = positional;
const option = (name) =>
  args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);

try {
  if (!slug || !id || !status) {
    throw new Error(
      '用法：project-checkpoint.mjs <slug> <id> <pending|in-progress|completed|blocked> [--label=说明] [--artifact=路径] [--note=说明]',
    );
  }
  assertSlug(slug);
  if (!WORK_ITEM_STATUSES.includes(status)) {
    throw new Error(`工作项状态必须是：${WORK_ITEM_STATUSES.join(', ')}。`);
  }
  const state = await advanceWorkItem(slug, id, {
    status,
    label: option('label'),
    artifact: option('artifact'),
    note: option('note'),
  });
  console.log(`✓ 已记录工作项：${id} → ${status}`);
  console.log(formatProduction(state));
} catch (error) {
  console.error(`project:checkpoint failed: ${error.message}`);
  process.exitCode = 1;
}
