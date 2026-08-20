#!/usr/bin/env node
import {printCliHelp} from './cli-help-lib.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {transactAssetManifest} from './asset-manifest-lib.mjs';
import {validateCompositionStructure} from './composition-lib.mjs';
import {
  applyLoopingStripToProject,
  deriveLoopingStrip,
} from './looping-strip-lib.mjs';
import {
  ROOT,
  fileExists,
  readJson,
  writeJson,
} from './project-lib.mjs';

const USAGE =
  '用法：derive-looping-strip.mjs <looping-strip.json>';
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
  const specFile = workspacePath(specInput, 'looping strip spec');
  const spec = await readJson(specFile);
  const projectDirectory = path.join(ROOT, 'projects', spec.projectSlug ?? '');
  const projectFile = path.join(projectDirectory, 'project.json');
  const manifestFile = path.join(projectDirectory, 'assets-manifest.json');
  if (!(await fileExists(projectFile)) || !(await fileExists(manifestFile))) {
    throw new Error('looping strip 必须指向已有 project.json 与 assets-manifest.json');
  }
  const projectInput = await readJson(projectFile);
  const project = structuredClone(projectInput);
  const result = await transactAssetManifest({
    manifestFile,
    projectSlug: spec.projectSlug,
    mutate: (manifest) => deriveLoopingStrip({
      root: ROOT,
      spec,
      manifest,
    }),
  });
  if (spec.applyToProject) {
    applyLoopingStripToProject({
      project,
      spec,
      record: result.record,
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
    if (errors.length > 0) {
      throw new Error(
        `looping-strip authoring 后组合无效：${errors
          .map(({code, message}) => `${code}: ${message}`)
          .join('；')}`,
      );
    }
  }
  const reportDirectory = path.join(ROOT, 'dist', spec.projectSlug, 'looping-strip');
  const reportFile = path.join(reportDirectory, `${spec.stripId}-report.json`);
  await fs.mkdir(reportDirectory, {recursive: true});
  await Promise.all([
    ...(spec.applyToProject ? [writeJson(projectFile, project)] : []),
    writeJson(reportFile, result.report),
  ]);
  console.log(
    `✓ looping strip ${spec.stripId}: source/render-scale seam 与三画幅 span 通过；provider image calls 0，local derivatives 1。`,
  );
  console.log(`✓ manifest: ${path.relative(ROOT, manifestFile)}`);
  if (spec.applyToProject) {
    console.log(`✓ project authoring: ${path.relative(ROOT, projectFile)}`);
  }
  console.log(`✓ report: ${path.relative(ROOT, reportFile)}`);
} catch (error) {
  console.error(`assets:derive-looping-strip failed: ${error.message}`);
  process.exitCode = 1;
}
