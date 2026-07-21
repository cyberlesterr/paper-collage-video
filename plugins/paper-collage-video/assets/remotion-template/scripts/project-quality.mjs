#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  formatQualityStatus,
  prepareQualityReport,
  recordQualityReview,
  recordQualityReviews,
} from './quality-lib.mjs';
import {ROOT} from './project-lib.mjs';

const args = process.argv.slice(2);
const positionals = args.filter((arg) => !arg.startsWith('--'));
const [slug, action = 'status'] = positionals;
const quiet = args.includes('--quiet');
const json = args.includes('--json');
const valueFor = (name) =>
  args.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1);
const listFor = (name) =>
  (valueFor(name) ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

try {
  if (!slug || !['prepare', 'status', 'record', 'record-batch'].includes(action)) {
    throw new Error(
      '用法：project:quality -- <slug> <prepare|status|record|record-batch> [--input=<reviews.json>] [--quiet] [--json]',
    );
  }
  let status;
  if (action === 'record') {
    status = await recordQualityReview({
          slug,
          assetId: valueFor('--asset'),
          compositeId: valueFor('--composite'),
          reviewer: valueFor('--reviewer'),
          passedChecks: listFor('--pass'),
          failedChecks: listFor('--fail'),
          note: valueFor('--note') ?? '',
        });
  } else if (action === 'record-batch') {
    const input = valueFor('--input');
    if (!input) throw new Error('record-batch 必须提供 --input=<reviews.json>。');
    const file = path.resolve(ROOT, input);
    if (file !== ROOT && !file.startsWith(`${ROOT}${path.sep}`)) {
      throw new Error(`reviews 路径越过工作区：${input}`);
    }
    const payload = JSON.parse(await fs.readFile(file, 'utf8'));
    status = await recordQualityReviews({
      slug,
      reviews: Array.isArray(payload) ? payload : payload.reviews,
    });
  } else {
    status = await prepareQualityReport(slug, {write: action === 'prepare'});
  }
  if (json) {
    console.log(
      JSON.stringify(
        {
          ready: status.ready,
          total: status.total,
          passed: status.passed,
          pending: status.pending,
          failed: status.failed,
          changedAssets: status.changedAssets ?? [],
          changedComposites: status.changedComposites ?? [],
          report: path.relative(ROOT, status.file),
        },
        null,
        2,
      ),
    );
  } else {
    console.log(formatQualityStatus(status));
    console.log(`  report: ${path.relative(ROOT, status.file)}`);
  }
  if (!quiet && !json) {
    const changedIds = status.changedIds ?? [];
    const entries = [...status.report.assets, ...status.report.composites];
    const visibleEntries = changedIds.length
      ? entries.filter((entry) => changedIds.includes(entry.assetId ?? entry.compositeId))
      : entries.filter(({status: entryStatus}) => entryStatus !== 'passed');
    for (const entry of visibleEntries) {
      const pending = Object.entries(entry.semanticChecks)
        .filter(([, checkStatus]) => checkStatus !== 'passed')
        .map(([check, checkStatus]) => `${check}:${checkStatus}`)
        .join(', ');
      console.log(`  ${entry.status === 'passed' ? '✓' : '•'} ${entry.assetId ?? entry.compositeId}: ${entry.status}${pending ? ` (${pending})` : ''}`);
    }
  }
  if (action === 'status' && !status.ready) process.exitCode = 1;
} catch (error) {
  console.error(`project:quality failed: ${error.message}`);
  process.exitCode = 1;
}
