#!/usr/bin/env node
import {printCliHelp} from './cli-help-lib.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  applyCanonicalContainerToProject,
  buildCanonicalContainerProof,
  deriveCanonicalContainer,
} from './canonical-container-lib.mjs';
import {validateCompositionStructure} from './composition-lib.mjs';
import {
  ROOT,
  fileExists,
  readJson,
  writeJson,
} from './project-lib.mjs';
import {transactAssetManifest} from './asset-manifest-lib.mjs';

const USAGE =
  '用法：derive-canonical-container.mjs <canonical-container.json>';
printCliHelp(process.argv.slice(2), USAGE);

const workspacePath = (input, label) => {
  const resolved = path.resolve(ROOT, input);
  if (
    resolved !== ROOT &&
    !resolved.startsWith(`${ROOT}${path.sep}`)
  ) {
    throw new Error(`${label}越过工作区：${input}`);
  }
  return resolved;
};

try {
  const [specInput] = process.argv
    .slice(2)
    .filter((argument) => !argument.startsWith('--'));
  if (!specInput) {
    throw new Error(
      USAGE,
    );
  }
  const specFile = workspacePath(
    specInput,
    'canonical container spec',
  );
  const spec = await readJson(specFile);
  const projectDirectory = path.join(
    ROOT,
    'projects',
    spec.projectSlug ?? '',
  );
  const projectFile = path.join(projectDirectory, 'project.json');
  const manifestFile = path.join(
    projectDirectory,
    'assets-manifest.json',
  );
  if (
    !(await fileExists(projectFile)) ||
    !(await fileExists(manifestFile))
  ) {
    throw new Error(
      'canonical container 必须指向已有 project.json 与 assets-manifest.json',
    );
  }
  const projectInput = await readJson(projectFile);
  const project = structuredClone(projectInput);
  const result = await transactAssetManifest({
    manifestFile,
    projectSlug: spec.projectSlug,
    mutate: (manifest) => deriveCanonicalContainer({
      root: ROOT,
      spec,
      manifest,
    }),
  });
  if (spec.applyToProject) {
    applyCanonicalContainerToProject({
      project,
      spec,
      manifest: result.manifest,
      records: result.records,
    });
    const scene = project.scenes.find(({id}) => id === spec.sceneId);
    const composition = validateCompositionStructure({
      composition: scene.composition,
      video: project.video,
      proofTimes: scene.motion?.proofTimes ?? [],
      durationSeconds:
        Number(scene.narration?.durationSeconds ?? 0) +
        Number(scene.tailSeconds ?? 0),
      location: `scenes#${scene.id}.composition`,
      editorial: project.editorial,
      sceneId: scene.id,
    });
    const errors = composition.issues.filter(
      ({level}) => level === 'error',
    );
    if (errors.length) {
      throw new Error(
        `canonical-container authoring 后组合无效：${errors
          .map(({code, message}) => `${code}: ${message}`)
          .join('；')}`,
      );
    }
  }
  const reportDirectory = path.join(
    ROOT,
    'dist',
    spec.projectSlug,
    'canonical-container',
  );
  const evidenceDirectory = path.join(reportDirectory, 'evidence');
  const reportFile = path.join(
    reportDirectory,
    `${spec.familyId}-report.json`,
  );
  const group = project.scenes
    .find(({id}) => id === spec.sceneId)
    ?.composition?.nodes?.flatMap(function flatten(node) {
      return [
        node,
        ...(node.kind === 'group'
          ? node.children.flatMap(flatten)
          : []),
      ];
    })
    .find(({id}) => id === spec.groupId);
  const proof =
    spec.applyToProject && group
      ? await buildCanonicalContainerProof({
          root: ROOT,
          group,
          manifest: result.manifest,
          directory: evidenceDirectory,
          evidenceId: spec.familyId,
        })
      : null;
  if (proof && !proof.passed) {
    throw new Error(
      `canonical container proof 未通过：${proof.checks
        .filter(({passed}) => !passed)
        .map(({id}) => id)
        .join(', ')}`,
    );
  }
  await fs.mkdir(reportDirectory, {recursive: true});
  await Promise.all([
    ...(spec.applyToProject
      ? [writeJson(projectFile, project)]
      : []),
    writeJson(reportFile, {
      ...result.report,
      proof: proof
        ? {
            ...proof,
            artifacts: Object.fromEntries(
              Object.entries(proof.artifacts).map(([key, file]) => [
                key,
                path.relative(ROOT, file),
              ]),
            ),
            artifactHashes: Object.fromEntries(
              Object.entries(proof.artifactHashes).map(
                ([file, hash]) => [path.relative(ROOT, file), hash],
              ),
            ),
          }
        : null,
    }),
  ]);
  console.log(
    `✓ canonical container ${spec.familyId}: ${result.records.length} 个本地派生；provider image calls ${result.report.providerImageCalls}，avoided calls ${result.report.avoidedCalls}。`,
  );
  console.log(`✓ manifest: ${path.relative(ROOT, manifestFile)}`);
  if (spec.applyToProject) {
    console.log(`✓ project authoring: ${path.relative(ROOT, projectFile)}`);
  }
  console.log(`✓ report: ${path.relative(ROOT, reportFile)}`);
} catch (error) {
  console.error(
    `assets:derive-canonical-container failed: ${error.message}`,
  );
  process.exitCode = 1;
}
