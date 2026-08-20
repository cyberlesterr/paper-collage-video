#!/usr/bin/env node
import {printCliHelp} from './cli-help-lib.mjs';
import {parseCliValue} from './contract-utils.mjs';
import path from 'node:path';
import {
  transactAssetManifest,
  transitionAssetLifecycle,
} from './asset-manifest-lib.mjs';
import {ROOT, assertSlug} from './project-lib.mjs';

const args = process.argv.slice(2);
const USAGE =
  '用法：project:asset-lifecycle -- <slug> --asset=<id> --status=<active|rejected|recovery-source> --reason=<具体原因>';
printCliHelp(args, USAGE);
const slug = args.find((arg) => !arg.startsWith('--'));
const valueFor = (name) => parseCliValue(args, name);

try {
  assertSlug(slug);
  const assetId = valueFor('--asset');
  const status = valueFor('--status');
  const reason = valueFor('--reason');
  if (!assetId || !status || !reason) {
    throw new Error(USAGE);
  }
  const manifestFile = path.join(ROOT, 'projects', slug, 'assets-manifest.json');
  const {record} = await transactAssetManifest({
    manifestFile,
    projectSlug: slug,
    mutate: (manifest) => ({
      manifest,
      record: transitionAssetLifecycle(manifest, assetId, status, {reason}),
    }),
  });
  console.log(`✓ 资产生命周期：${record.assetId} -> ${record.lifecycle.status}`);
} catch (error) {
  console.error(`project:asset-lifecycle failed: ${error.message}`);
  process.exitCode = 1;
}
