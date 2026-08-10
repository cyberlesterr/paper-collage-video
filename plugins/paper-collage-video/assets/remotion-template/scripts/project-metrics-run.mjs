#!/usr/bin/env node
import {spawn} from 'node:child_process';
import path from 'node:path';
import {ROOT} from './project-lib.mjs';
import {
  finishMetricSegment,
  startMetricSegment,
} from './production-metrics-lib.mjs';
import {
  assertOperationAllowed,
  computeOperationInputFingerprint,
  deriveFailureSignature,
  normalizeFailureEvidence,
  recordOperationFailure,
  recordOperationSuccess,
} from './failure-circuit-lib.mjs';

const args = process.argv.slice(2);
const valueFor = (name) =>
  args.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1);
const separator = args.indexOf('--');
const childArgs = separator >= 0 ? args.slice(separator + 1) : [];
const category = valueFor('--category');
const operation = valueFor('--operation');
const script = valueFor('--script');
const slugIndex = Number(valueFor('--slug-index') ?? 0);
const qualityActions = new Set([
  'prepare',
  'status',
  'scaffold',
  'contact-sheet',
  'accept-human',
  'record',
  'record-batch',
]);
const slug =
  script === 'scripts/project-quality.mjs' &&
  qualityActions.has(childArgs[0])
    ? childArgs[1]
    : childArgs[slugIndex];

const run = (file, commandArgs) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [file, ...commandArgs], {
    cwd: ROOT,
    stdio: ['inherit', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    process.stdout.write(chunk);
    stdout = `${stdout}${chunk}`.slice(-64 * 1024);
  });
  child.stderr.on('data', (chunk) => {
    process.stderr.write(chunk);
    stderr = `${stderr}${chunk}`.slice(-64 * 1024);
  });
  child.once('error', reject);
  child.once('exit', (code, signal) =>
    resolve({code, signal, stdout, stderr}),
  );
});

let segment = null;
let inputFingerprint = null;
try {
  const helpRequested = childArgs.includes('--help') || childArgs.includes('-h');
  if (!category || !operation || !script || (!helpRequested && !slug) || !Number.isInteger(slugIndex)) {
    throw new Error(
      '用法：project-metrics-run.mjs --category=<category> --operation=<name> --script=<file> --slug-index=<n> -- <child args>',
    );
  }
  if (helpRequested) {
    const result = await run(path.resolve(ROOT, script), childArgs);
    if (result.code !== 0) process.exitCode = result.code ?? 1;
  } else {
    inputFingerprint = await computeOperationInputFingerprint({
      slug,
      operation,
      script,
      arguments: childArgs,
    });
    await assertOperationAllowed({slug, operation, inputFingerprint});
    segment = await startMetricSegment({
      slug,
      category,
      operation,
      measurement: 'command-wall-clock',
      source: 'command-wrapper',
      metadata: {script, arguments: childArgs},
    });
    const result = await run(path.resolve(ROOT, script), childArgs);
    await finishMetricSegment({
      slug,
      segmentId: segment.id,
      status: result.code === 0 ? 'completed' : 'failed',
      metadata: {exitCode: result.code, signal: result.signal ?? null},
    });
    if (result.code === 0) {
      await recordOperationSuccess({slug, operation, inputFingerprint});
    } else {
      const evidence =
        normalizeFailureEvidence(`${result.stderr}\n${result.stdout}`) ||
        `${script} exited with ${result.code ?? result.signal ?? 'unknown'}`;
      const failure = await recordOperationFailure({
        slug,
        operation,
        inputFingerprint,
        failureSignature: deriveFailureSignature({
          operation,
          exitCode: result.code,
          signal: result.signal,
          stdout: result.stdout,
          stderr: result.stderr,
        }),
        evidence,
      });
      if (failure.circuit.open) {
        console.error(
          `⛔ ${operation} 同类失败第 ${failure.circuit.count} 次；` +
            `熔断 ${failure.circuit.circuitId} 已打开，停止自动重试。`,
        );
      } else {
        console.error(
          `⚠ ${operation} 首次失败已记录；输入未变化时禁止重跑。`,
        );
      }
      process.exitCode = result.code ?? 1;
    }
  }
} catch (error) {
  if (segment) {
    await finishMetricSegment({
      slug,
      segmentId: segment.id,
      status: 'failed',
      metadata: {error: error.message},
    }).catch(() => {});
  }
  console.error(`production control stopped: ${error.message}`);
  process.exitCode = 1;
}
