#!/usr/bin/env node
import {printCliHelp} from './cli-help-lib.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {transactAssetManifest} from './asset-manifest-lib.mjs';
import {
  ROOT,
  fileExists,
  readJson,
  writeJson,
} from './project-lib.mjs';
import {deriveSemanticSlices} from './semantic-slices-lib.mjs';

const USAGE =
  '用法：derive-semantic-slices.mjs <semantic-slices.json>';
printCliHelp(process.argv.slice(2), USAGE);

const workspacePath = (input, label) => {
  const resolved = path.resolve(ROOT, input);
  if (resolved !== ROOT && !resolved.startsWith(`${ROOT}${path.sep}`)) {
    throw new Error(`${label}越过工作区：${input}`);
  }
  return resolved;
};

try {
  const [specInput] = process.argv.slice(2).filter(
    (argument) => !argument.startsWith('--'),
  );
  if (!specInput) {
    throw new Error(USAGE);
  }
  const spec = await readJson(workspacePath(specInput, 'semantic slices spec'));
  const projectDirectory = path.join(ROOT, 'projects', spec.projectSlug ?? '');
  const manifestFile = path.join(projectDirectory, 'assets-manifest.json');
  if (!(await fileExists(manifestFile))) {
    throw new Error('semantic slices 必须指向已有 assets-manifest.json');
  }
  const result = await transactAssetManifest({
    manifestFile,
    projectSlug: spec.projectSlug,
    mutate: (manifest) => deriveSemanticSlices({
      root: ROOT,
      spec,
      manifest,
    }),
  });
  const reportDirectory = path.join(
    ROOT,
    'dist',
    spec.projectSlug,
    'semantic-slices',
  );
  const reportFile = path.join(
    reportDirectory,
    `${spec.topologyId}-report.json`,
  );
  await fs.mkdir(reportDirectory, {recursive: true});
  await writeJson(reportFile, result.report);
  console.log(
    `✓ semantic slices ${spec.topologyId}: provider image calls 0，` +
    `local derivatives ${result.records.length}，全部 alpha 组件唯一归属。`,
  );
  console.log(`✓ manifest: ${path.relative(ROOT, manifestFile)}`);
  console.log(`✓ report: ${path.relative(ROOT, reportFile)}`);
} catch (error) {
  console.error(`assets:derive-semantic-slices failed: ${error.message}`);
  process.exitCode = 1;
}
