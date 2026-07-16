#!/usr/bin/env node
import path from 'node:path';
import {
  ROOT,
  assertSlug,
  fileExists,
  formatValidation,
  loadProject,
  projectPaths,
  readJson,
  validateProject,
  writeValidationReport,
} from './project-lib.mjs';
import {advanceProduction, formatProduction} from './production-state.mjs';
import {assertSelectedProvidersReady} from './provider-lib.mjs';

const args = process.argv.slice(2);
const positional = args.filter((arg) => !arg.startsWith('--'));
const [slug, action] = positional;
const noteArgument = args.find((arg) => arg.startsWith('--note='));
const note = noteArgument?.slice('--note='.length) ?? '';

const requirePassingArtifact = async (slugValue, filename) => {
  const paths = projectPaths(slugValue);
  const artifact = path.join(paths.distDirectory, filename);
  const reportFile = path.join(paths.distDirectory, 'report.json');
  if (!(await fileExists(artifact)) || !(await fileExists(reportFile))) {
    throw new Error(`${filename} 或 report.json 不存在，不能记录人工批准。`);
  }
  const report = await readJson(reportFile);
  if (!report.passed || path.basename(report.artifact?.file ?? '') !== filename) {
    throw new Error(`report.json 未证明 ${filename} 已通过技术验收。`);
  }
};

try {
  if (!slug || !action) {
    throw new Error('用法：project-advance.mjs <slug> <action> [--note=说明]');
  }
  assertSlug(slug);

  const artifacts = {};
  if (action === 'capabilities-ready') {
    await assertSelectedProvidersReady(slug);
  }
  if (action === 'assets-ready') {
    const {project} = await loadProject(slug);
    const validation = await validateProject(project);
    const reportFile = await writeValidationReport(slug, validation);
    console.log(formatValidation(validation));
    if (!validation.passed) {
      throw new Error('素材与项目校验未通过，不能进入 preview。');
    }
    artifacts.validationReport = path.relative(ROOT, reportFile);
  }
  if (action === 'approve-preview') {
    await requirePassingArtifact(slug, 'preview.mp4');
  }
  if (action === 'approve-publish') {
    await requirePassingArtifact(slug, 'final.mp4');
  }

  const state = await advanceProduction(slug, action, {note, artifacts});
  console.log(`✓ 已记录：${action}`);
  console.log(formatProduction(state));
} catch (error) {
  console.error(`project:advance failed: ${error.message}`);
  process.exitCode = 1;
}
