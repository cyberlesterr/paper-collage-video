#!/usr/bin/env node
import {printCliHelp} from './cli-help-lib.mjs';
import {parseCliValue} from './contract-utils.mjs';
import path from 'node:path';
import {
  assertProviderConfig,
  loadAssetRequest,
  loadProviderConfig,
  recordAssetProvenance,
  resolveConfirmedProvider,
} from './provider-lib.mjs';
import {readGenerationAttempt} from './generation-attempt-lib.mjs';
import {ROOT} from './project-lib.mjs';

const args = process.argv.slice(2);
const USAGE =
  '用法：provider:recover-record -- --request=<request.json> --attempt-id=<id> [--external-id=<id>]';
printCliHelp(args, USAGE);
const valueFor = (name) => parseCliValue(args, name);

try {
  const requestInput = valueFor('--request');
  const attemptId = valueFor('--attempt-id');
  if (!requestInput || !attemptId) {
    throw new Error(
      USAGE,
    );
  }
  const loaded = await loadAssetRequest(requestInput);
  const attempt = (await readGenerationAttempt({
    slug: loaded.request.projectSlug,
    attemptId,
  })).attempt;
  const config = assertProviderConfig(
    await loadProviderConfig(loaded.request.projectSlug),
  );
  const provider = resolveConfirmedProvider(
    config.config,
    loaded.request.capability,
    attempt.provider,
  );
  const recorded = await recordAssetProvenance({
    request: loaded.request,
    output: loaded.output,
    provider,
    model: attempt.model,
    externalId: valueFor('--external-id'),
    attemptId,
    recoverClosedAttempt: true,
  });
  console.log(`✓ 已从关闭尝试恢复资产登记：${recorded.record.file}`);
  console.log(`✓ 资产溯源：${path.relative(ROOT, recorded.manifestFile)}`);
} catch (error) {
  console.error(`provider:recover-record failed: ${error.message}`);
  process.exitCode = 1;
}
