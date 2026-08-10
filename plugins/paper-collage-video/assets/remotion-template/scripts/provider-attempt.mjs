#!/usr/bin/env node
import path from 'node:path';
import {
  assertProviderConfig,
  buildProviderInvocation,
  loadAssetRequest,
  loadProviderConfig,
  resolveConfirmedProvider,
} from './provider-lib.mjs';
import {
  closeGenerationAttempt,
  readGenerationAttemptEvents,
  reserveGenerationAttempt,
  summarizeGenerationAttempts,
} from './generation-attempt-lib.mjs';
import {ROOT, loadProject} from './project-lib.mjs';
import {assertProviderVisualBlueprintGate} from './visual-blueprint-review-lib.mjs';

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
    await assertProviderVisualBlueprintGate(loadedRequest.request);
    const result = await reserveGenerationAttempt({
      request: loadedRequest.request,
      provider,
      model: valueFor('--model'),
    });
    if (args.includes('--json')) {
      console.log(JSON.stringify({
        attemptId: result.event.attemptId,
        budget: result.budget,
        invocation: buildProviderInvocation({
          request: loadedRequest.request,
          provider,
          attemptId: result.event.attemptId,
          model: result.event.model,
        }),
      }, null, 2));
    } else {
      console.log(`✓ 已预留生成额度：${result.event.attemptId}`);
      console.log(`  ledger: ${path.relative(ROOT, result.file)}`);
      console.log(`  budget: ${result.budget.used} used + ${result.budget.reserved} reserved / ${result.budget.maximum}`);
    }
  } else if (action === 'summary') {
    const slug = valueFor('--project');
    if (!slug) throw new Error('summary 必须提供 --project=<slug>。');
    const loaded = await readGenerationAttemptEvents(slug);
    const summary = summarizeGenerationAttempts(loaded.events);
    const {project} = await loadProject(slug);
    const profileHardCeiling =
      project.plan?.assetBudget?.maxGeneratedImages ?? null;
    const approvedImageAttemptLimit =
      project.plan?.approvedImageBudget?.imageAttemptLimit ?? null;
    const output = {
      projectSlug: slug,
      ledger: path.relative(ROOT, loaded.file),
      exists: loaded.exists,
      budget: {
        profileHardCeiling,
        approvedImageAttemptLimit,
        remaining:
          Number.isInteger(approvedImageAttemptLimit)
            ? Math.max(
              0,
              approvedImageAttemptLimit - summary.used - summary.reserved,
            )
            : null,
      },
      ...summary,
    };
    if (args.includes('--json')) console.log(JSON.stringify(output, null, 2));
    else {
      console.log(`Generation attempts: ${slug}`);
      console.log(
        `  approved ${approvedImageAttemptLimit ?? 'pending'} / profile ${profileHardCeiling ?? 'unresolved'}; remaining ${output.budget.remaining ?? 'pending'}`,
      );
      console.log(`  used ${summary.used}; reserved ${summary.reserved}; closed ${summary.closed}`);
      for (const [status, count] of Object.entries(summary.byStatus)) {
        console.log(`  ${status}: ${count}`);
      }
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
    console.log(
      `✓ 生成尝试${result.reused ? '已是目标关闭状态，未重复写入' : '已关闭'}：` +
      `${result.event.status} (${result.event.quotaConsumed ? 'counted' : 'not-counted'})`,
    );
  } else {
    throw new Error('用法：provider:attempt -- <reserve|summary|close> ...');
  }
} catch (error) {
  console.error(`provider:attempt failed: ${error.message}`);
  process.exitCode = 1;
}
