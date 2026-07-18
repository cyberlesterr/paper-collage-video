#!/usr/bin/env node
import path from 'node:path';
import {
  formatQualityStatus,
  prepareQualityReport,
  recordQualityReview,
} from './quality-lib.mjs';
import {ROOT} from './project-lib.mjs';

const args = process.argv.slice(2);
const positionals = args.filter((arg) => !arg.startsWith('--'));
const [slug, action = 'status'] = positionals;
const valueFor = (name) =>
  args.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1);
const listFor = (name) =>
  (valueFor(name) ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

try {
  if (!slug || !['prepare', 'status', 'record'].includes(action)) {
    throw new Error(
      '用法：project:quality -- <slug> <prepare|status|record> [--asset=<id>] [--reviewer=<name>] [--pass=a,b] [--fail=c] [--note=<说明>]',
    );
  }
  const status =
    action === 'record'
      ? await recordQualityReview({
          slug,
          assetId: valueFor('--asset'),
          reviewer: valueFor('--reviewer'),
          passedChecks: listFor('--pass'),
          failedChecks: listFor('--fail'),
          note: valueFor('--note') ?? '',
        })
      : await prepareQualityReport(slug, {write: action === 'prepare'});
  console.log(formatQualityStatus(status));
  console.log(`  report: ${path.relative(ROOT, status.file)}`);
  for (const asset of status.report.assets) {
    const pending = Object.entries(asset.semanticChecks)
      .filter(([, checkStatus]) => checkStatus !== 'passed')
      .map(([check, checkStatus]) => `${check}:${checkStatus}`)
      .join(', ');
    console.log(`  ${asset.status === 'passed' ? '✓' : '•'} ${asset.assetId}: ${asset.status}${pending ? ` (${pending})` : ''}`);
  }
  if (action === 'status' && !status.ready) process.exitCode = 1;
} catch (error) {
  console.error(`project:quality failed: ${error.message}`);
  process.exitCode = 1;
}
