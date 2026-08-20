#!/usr/bin/env node
import {printCliHelp} from './cli-help-lib.mjs';
import {parseCliValue} from './contract-utils.mjs';
import path from 'node:path';
import {
  assertProviderConfig,
  loadProviderConfig,
  resolveConfirmedProvider,
} from './provider-lib.mjs';
import {
  inspectRejectedOutputRecovery,
  writeRejectedOutputRecovery,
} from './rejected-output-recovery-lib.mjs';
import {readGenerationAttempt} from './generation-attempt-lib.mjs';
import {ROOT, readJson} from './project-lib.mjs';

const args = process.argv.slice(2);
const USAGE =
  '用法：provider:recover-rejected-source -- --spec=<recovery.json> [--check]';
printCliHelp(args, USAGE);
const valueFor = (name) => parseCliValue(args, name);

try {
  const specInput = valueFor('--spec');
  const checkOnly = args.includes('--check');
  if (!specInput) {
    throw new Error(
      USAGE,
    );
  }
  const specFile = path.resolve(ROOT, specInput);
  if (
    specFile !== ROOT &&
    !specFile.startsWith(`${ROOT}${path.sep}`)
  ) {
    throw new Error(`recovery spec 越过工作区：${specInput}`);
  }
  const spec = await readJson(specFile);
  const attempt = (await readGenerationAttempt({
    slug: spec.projectSlug,
    attemptId: spec.attemptId,
  })).attempt;
  const config = assertProviderConfig(
    await loadProviderConfig(spec.projectSlug),
  );
  const provider = resolveConfirmedProvider(
    config.config,
    'image',
    attempt.provider,
  );
  const inspected = await inspectRejectedOutputRecovery({
    root: ROOT,
    spec,
    provider,
  });
  const result = checkOnly
    ? inspected
    : await writeRejectedOutputRecovery(inspected);
  console.log(JSON.stringify({
    status: checkOnly ? 'recoverable' : 'recorded',
    projectSlug: spec.projectSlug,
    attemptId: spec.attemptId,
    recoveryAssetId: spec.recoveryAssetId,
    lifecycle: result.record.lifecycle.status,
    providerCalls: 0,
    ledgerMutation: false,
    ledgerSha256: result.ledgerSha256After ?? result.ledgerSha256Before,
    sourceSha256: result.recovery.sourceSha256,
    observedKeyColors: result.recovery.observedKeyColors,
    observationFingerprint:
      result.providerObservation.observationFingerprint,
    ...(result.providerObservation.cells
      ? {
        cells: result.providerObservation.cells.map((cell) => ({
          packageRole: cell.packageRole,
          ...(cell.stateId ? {stateId: cell.stateId} : {}),
          requestedKeyColor: cell.requestedKeyColor,
          observedKeyColor: cell.observedKeyColor,
          metrics: cell.metrics,
          passed: cell.passed,
          reasons: cell.reasons,
        })),
      }
      : {checkerboard: result.providerObservation.checkerboard}),
  }, null, 2));
} catch (error) {
  console.error(`provider:recover-rejected-source failed: ${error.message}`);
  process.exitCode = 1;
}
