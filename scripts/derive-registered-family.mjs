#!/usr/bin/env node
import {printCliHelp} from './cli-help-lib.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {validateCompositionStructure} from './composition-lib.mjs';
import {
  applyRegisteredFamilyToProject,
  deriveRegisteredFamily,
} from './registered-family-lib.mjs';
import {
  ROOT,
  fileExists,
  readJson,
  writeJson,
} from './project-lib.mjs';
import {transactAssetManifest} from './asset-manifest-lib.mjs';

const USAGE =
  '用法：derive-registered-family.mjs <registered-family.json>';
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
  const specFile = workspacePath(specInput, 'registered family spec');
  const spec = await readJson(specFile);
  const projectDirectory = path.join(ROOT, 'projects', spec.projectSlug ?? '');
  const projectFile = path.join(projectDirectory, 'project.json');
  const manifestFile = path.join(projectDirectory, 'assets-manifest.json');
  if (!(await fileExists(projectFile)) || !(await fileExists(manifestFile))) {
    throw new Error('registered family 必须指向已有 project.json 与 assets-manifest.json');
  }
  const projectInput = await readJson(projectFile);
  const project = structuredClone(projectInput);
  const result = await transactAssetManifest({
    manifestFile,
    projectSlug: spec.projectSlug,
    mutate: (manifest) => deriveRegisteredFamily({
      root: ROOT,
      spec,
      manifest,
    }),
  });
  if (spec.applyToProject) {
    applyRegisteredFamilyToProject({
      project,
      spec,
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
    const errors = composition.issues.filter(({level}) => level === 'error');
    if (errors.length) {
      throw new Error(
        `registered-family authoring 后组合无效：${errors
          .map(({code, message}) => `${code}: ${message}`)
          .join('；')}`,
      );
    }
  }
  const reportDirectory = path.join(
    ROOT,
    'dist',
    spec.projectSlug,
    'registered-family',
  );
  const reportFile = path.join(reportDirectory, `${spec.familyId}-report.json`);
  const compositionFragment = {
    groupId: spec.groupId,
    registration: spec.registration,
    members: result.records.map((record) => ({
      nodeId: record.registeredFamilyBinding.nodeId,
      role: record.registeredFamilyBinding.role,
      slot: record.registeredFamilyBinding.slot,
      src: path.normalize(record.file)
        .slice(`public${path.sep}`.length)
        .split(path.sep)
        .join('/'),
      registrationId: record.registeredFamilyBinding.registrationId,
    })),
  };
  await fs.mkdir(reportDirectory, {recursive: true});
  await Promise.all([
    ...(spec.applyToProject ? [writeJson(projectFile, project)] : []),
    writeJson(reportFile, {...result.report, compositionFragment}),
  ]);
  console.log(
    `✓ registered family ${spec.familyId}: ${result.records.length} 个完整画布本地派生；provider image calls ${result.report.providerImageCalls}，avoided calls ${result.report.avoidedCalls}。`,
  );
  console.log(`✓ manifest: ${path.relative(ROOT, manifestFile)}`);
  if (spec.applyToProject) {
    console.log(`✓ project authoring: ${path.relative(ROOT, projectFile)}`);
  }
  console.log(`✓ report: ${path.relative(ROOT, reportFile)}`);
} catch (error) {
  console.error(`assets:derive-registered-family failed: ${error.message}`);
  process.exitCode = 1;
}
