#!/usr/bin/env node
import path from 'node:path';
import {
  assertProviderConfig,
  loadAssetRequest,
  loadProviderConfig,
  resolveConfirmedProvider,
} from './provider-lib.mjs';
import {
  closeGenerationAttempt,
  reserveGenerationAttempt,
} from './generation-attempt-lib.mjs';
import {ROOT} from './project-lib.mjs';

const args = process.argv.slice(2);
const action = args.find((arg) => !arg.startsWith('--'));
const valueFor = (name) =>
  args.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1);
const booleanFor = (name) => {
  const value = valueFor(name);
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
};

try {
  if (action === 'reserve') {
    const requestInput = valueFor('--request');
    if (!requestInput) throw new Error('reserve 必须提供 --request=<request.json>。');
    const loadedRequest = await loadAssetRequest(requestInput);
    const loadedConfig = assertProviderConfig(
      await loadProviderConfig(loadedRequest.request.projectSlug),
    );
    const provider = resolveConfirmedProvider(
      loadedConfig.config,
      loadedRequest.request.capability,
      valueFor('--provider') ?? 'auto',
    );
    const result = await reserveGenerationAttempt({
      request: loadedRequest.request,
      provider,
      model: valueFor('--model'),
    });
    if (args.includes('--json')) {
      console.log(JSON.stringify({attemptId: result.event.attemptId, budget: result.budget}, null, 2));
    } else {
      console.log(`✓ 已预留生成额度：${result.event.attemptId}`);
      console.log(`  ledger: ${path.relative(ROOT, result.file)}`);
      console.log(`  budget: ${result.budget.used} used + ${result.budget.reserved} reserved / ${result.budget.maximum}`);
    }
  } else if (action === 'close') {
    const slug = valueFor('--project');
    const attemptId = valueFor('--attempt-id');
    const status = valueFor('--status');
    const quotaConsumed = booleanFor('--quota-consumed');
    if (!slug || !attemptId || !status || quotaConsumed === null) {
      throw new Error('close 必须提供 --project、--attempt-id、--status 和 --quota-consumed=true|false。');
    }
    const result = await closeGenerationAttempt({
      slug,
      attemptId,
      status,
      quotaConsumed,
      note: valueFor('--note') ?? '',
    });
    console.log(`✓ 生成尝试已关闭：${result.event.status} (${result.event.quotaConsumed ? 'counted' : 'not-counted'})`);
  } else {
    throw new Error('用法：provider:attempt -- <reserve|close> ...');
  }
} catch (error) {
  console.error(`provider:attempt failed: ${error.message}`);
  process.exitCode = 1;
}
