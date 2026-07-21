#!/usr/bin/env node
import path from 'node:path';
import {
  assertProviderConfig,
  loadAssetRequest,
  loadProviderConfig,
  recordAssetProvenance,
  resolveConfirmedProvider,
} from './provider-lib.mjs';
import {ROOT} from './project-lib.mjs';

const args = process.argv.slice(2);
const valueFor = (name) =>
  args.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1);

try {
  const requestInput = valueFor('--request');
  const providerId = valueFor('--provider') ?? 'auto';
  if (!requestInput) {
    throw new Error(
      '用法：provider:record -- --request=<request.json> [--provider=<id>] [--model=<model>] [--external-id=<id>] [--attempt-id=<id>]',
    );
  }
  const loadedRequest = await loadAssetRequest(requestInput);
  const loadedConfig = assertProviderConfig(
    await loadProviderConfig(loadedRequest.request.projectSlug),
  );
  const provider = resolveConfirmedProvider(
    loadedConfig.config,
    loadedRequest.request.capability,
    providerId,
  );
  const recorded = await recordAssetProvenance({
    request: loadedRequest.request,
    output: loadedRequest.output,
    provider,
    model: valueFor('--model'),
    externalId: valueFor('--external-id'),
    attemptId: valueFor('--attempt-id'),
  });
  console.log(`✓ 已登记资产：${recorded.record.file}`);
  console.log(`✓ 资产溯源：${path.relative(ROOT, recorded.manifestFile)}`);
} catch (error) {
  console.error(`provider:record failed: ${error.message}`);
  process.exitCode = 1;
}
