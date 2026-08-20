#!/usr/bin/env node
import {printCliHelp} from './cli-help-lib.mjs';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {
  ROOT,
  formatValidation,
  loadProject,
  validateProject,
  writeValidationReport,
} from './project-lib.mjs';
import {assertQualityReady, formatQualityStatus} from './quality-lib.mjs';
import {createAssetsReadySeal} from './assets-ready-seal-lib.mjs';
import {
  loadProduction,
  recordAssetsReadySeal,
  resolveAssetsReadyMode,
} from './production-state.mjs';
import {assertMotionApprovalCurrent} from './motion-approval-lib.mjs';
import {assertRuntimeBuildManifestCurrent} from './runtime-build-lib.mjs';
import {assertVisualBlueprintApprovalCurrent} from './visual-blueprint-review-lib.mjs';

const USAGE =
  '用法：project:assets-ready -- <slug>';
printCliHelp(process.argv.slice(2), USAGE);

const [slug, ...args] = process.argv.slice(2);

const run = (script, scriptArgs) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(ROOT, 'scripts', script), ...scriptArgs],
      {cwd: ROOT, stdio: 'inherit'},
    );
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${script} exited with ${code ?? signal}`));
    });
  });

try {
  if (!slug) {
    throw new Error(USAGE);
  }
  const {state} = await loadProduction(slug);
  const mode = resolveAssetsReadyMode(state.stage);
  await assertRuntimeBuildManifestCurrent();
  await assertVisualBlueprintApprovalCurrent(slug);
  await assertMotionApprovalCurrent(slug);
  await run('project-sync.mjs', [slug]);
  await run('project-subtitles.mjs', [slug]);
  await run('project-audio-calibration.mjs', [slug, 'run']);
  const {project} = await loadProject(slug);
  const validation = await validateProject(project);
  const reportFile = await writeValidationReport(slug, validation);
  console.log(formatValidation(validation));
  if (!validation.passed) {
    throw new Error('素材与项目校验未通过。');
  }
  const quality = await assertQualityReady(slug);
  console.log(formatQualityStatus(quality));
  const seal = await createAssetsReadySeal(slug, {
    project,
    validation,
    quality,
  });
  console.log(`✓ assets-ready seal：${path.relative(ROOT, seal.file)}`);
  if (mode === 'advance') {
    await run('project-advance.mjs', [slug, 'assets-ready', ...args]);
  } else {
    await recordAssetsReadySeal(slug, {
      assetsReadySeal: path.relative(ROOT, seal.file),
      validationReport: path.relative(ROOT, reportFile),
    });
    console.log(`✓ assets-ready 幂等复核完成；生产阶段保持 ${state.stage}，下一步重新运行 project:preview。`);
  }
} catch (error) {
  console.error(`project:assets-ready failed: ${error.message}`);
  process.exitCode = 1;
}
