#!/usr/bin/env node
import {printCliHelp} from './cli-help-lib.mjs';
import path from 'node:path';
import {
  buildCanonicalContainerProof,
} from './canonical-container-lib.mjs';
import {
  ROOT,
  fileExists,
  readJson,
  writeJson,
} from './project-lib.mjs';
import {assertAssetManifest} from './asset-manifest-lib.mjs';

const USAGE =
  '用法：prove-canonical-container.mjs <slug> <family-id>';
printCliHelp(process.argv.slice(2), USAGE);

try {
  const [slug, familyId] = process.argv
    .slice(2)
    .filter((argument) => !argument.startsWith('--'));
  if (!slug || !familyId) {
    throw new Error(
      USAGE,
    );
  }
  const projectFile = path.join(
    ROOT,
    'projects',
    slug,
    'project.json',
  );
  const manifestFile = path.join(
    ROOT,
    'projects',
    slug,
    'assets-manifest.json',
  );
  if (
    !(await fileExists(projectFile)) ||
    !(await fileExists(manifestFile))
  ) {
    throw new Error('缺少 project.json 或 assets-manifest.json。');
  }
  const project = await readJson(projectFile);
  const manifest = assertAssetManifest(
    await readJson(manifestFile),
    slug,
  );
  const groups = project.scenes.flatMap(({composition}) =>
    composition.nodes.flatMap(function flatten(node) {
      return [
        node,
        ...(node.kind === 'group'
          ? node.children.flatMap(flatten)
          : []),
      ];
    }),
  );
  const group = groups.find(
    ({pattern, canonicalContainer}) =>
      pattern === 'canonical-container' &&
      canonicalContainer?.familyId === familyId,
  );
  if (!group) throw new Error(`找不到 canonical container ${familyId}`);
  const directory = path.join(
    ROOT,
    'dist',
    slug,
    'canonical-container',
    'evidence',
  );
  const proof = await buildCanonicalContainerProof({
    root: ROOT,
    group,
    manifest,
    directory,
    evidenceId: familyId,
  });
  const reportFile = path.join(
    ROOT,
    'dist',
    slug,
    'canonical-container',
    `${familyId}-proof.json`,
  );
  await writeJson(reportFile, {
    ...proof,
    artifacts: Object.fromEntries(
      Object.entries(proof.artifacts).map(([key, file]) => [
        key,
        path.relative(ROOT, file),
      ]),
    ),
    artifactHashes: Object.fromEntries(
      Object.entries(proof.artifactHashes).map(([file, hash]) => [
        path.relative(ROOT, file),
        hash,
      ]),
    ),
  });
  if (!proof.passed) {
    throw new Error(
      proof.checks
        .filter(({passed}) => !passed)
        .map(({id}) => id)
        .join(', '),
    );
  }
  console.log(
    `✓ canonical container proof: ${path.relative(ROOT, reportFile)}`,
  );
} catch (error) {
  console.error(`proof:canonical-container failed: ${error.message}`);
  process.exitCode = 1;
}
