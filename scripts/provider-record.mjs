#!/usr/bin/env node
import {printCliHelp} from './cli-help-lib.mjs';
import {parseCliValue} from './contract-utils.mjs';
import path from 'node:path';
import {
  assertProviderConfig,
  loadAssetRequest,
  loadProviderConfig,
  normalizeReportedModel,
  recordAssetProvenance,
  resolveConfirmedProvider,
} from './provider-lib.mjs';
import {readGenerationAttempt} from './generation-attempt-lib.mjs';
import {ROOT} from './project-lib.mjs';
import {
  assertProviderVisualBlueprintGate,
} from './visual-blueprint-review-lib.mjs';

const args = process.argv.slice(2);
const USAGE =
  '用法：provider:record -- --request=<request.json> [--provider=<id>] [--model=<model>] [--external-id=<id>] [--attempt-id=<id>]';
printCliHelp(args, USAGE);
const valueFor = (name) => parseCliValue(args, name);

try {
  const requestInput = valueFor('--request');
  const providerId = valueFor('--provider') ?? 'auto';
  if (!requestInput) {
    throw new Error(
      USAGE,
    );
  }
  const loadedRequest = await loadAssetRequest(requestInput);
  const loadedConfig = assertProviderConfig(
    await loadProviderConfig(loadedRequest.request.projectSlug),
  );
  const attemptId = valueFor('--attempt-id');
  const attempt = attemptId
    ? (await readGenerationAttempt({
        slug: loadedRequest.request.projectSlug,
        attemptId,
      })).attempt
    : null;
  if (attempt && providerId !== 'auto' && providerId !== attempt.provider) {
    throw new Error(`--provider 与生成尝试继承的 ${attempt.provider} 不一致。`);
  }
  const provider = resolveConfirmedProvider(
    loadedConfig.config,
    loadedRequest.request.capability,
    attempt?.provider ?? providerId,
  );
  await assertProviderVisualBlueprintGate(loadedRequest.request);
  const reportedModel = valueFor('--model');
  const inheritedModel = attempt?.model ?? null;
  const normalizedReportedModel = reportedModel
    ? normalizeReportedModel({provider, model: reportedModel})
    : null;
  if (
    normalizedReportedModel &&
    inheritedModel &&
    normalizedReportedModel !== inheritedModel
  ) {
    throw new Error(
      `--model ${reportedModel} 与生成尝试继承的 ${inheritedModel} 不一致。`,
    );
  }
  const recorded = await recordAssetProvenance({
    request: loadedRequest.request,
    output: loadedRequest.output,
    provider,
    model: inheritedModel ?? normalizedReportedModel,
    externalId: valueFor('--external-id'),
    attemptId,
  });
  console.log(`✓ 已登记资产：${recorded.record.file}`);
  if (recorded.record.capability === 'voice') {
    console.log(`✓ 实测语音时长：${recorded.record.media.durationSeconds.toFixed(3)}s`);
  }
  console.log(`✓ 资产溯源：${path.relative(ROOT, recorded.manifestFile)}`);
} catch (error) {
  console.error(`provider:record failed: ${error.message}`);
  process.exitCode = 1;
}
