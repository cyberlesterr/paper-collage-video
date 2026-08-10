#!/usr/bin/env node
import path from 'node:path';
import {
  assertSlug,
  fileExists,
  loadProject,
  projectPaths,
  readJson,
} from './project-lib.mjs';
import {
  advanceProduction,
  formatProduction,
  loadProduction,
  transitionProduction,
} from './production-state.mjs';
import {assertSelectedProvidersReady} from './provider-lib.mjs';
import {assertCreativePlanReady} from './creative-plan-lib.mjs';
import {assertStoryboardReady} from './storyboard-lib.mjs';
import {
  requiredProviderCapabilitiesForProject,
} from './sound-effect-lib.mjs';

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
  if (
    [
      'approve-style-voice',
      'approve-visual-blueprint',
      'request-visual-blueprint-revision',
    ].includes(action)
  ) {
    throw new Error(
      `${action} 不能再由自由文本 --note 直接记录；请先向用户展示当前视觉蓝图，再使用 ` +
        'npm run project:visual-review -- <slug> <approve|revise> --receipt=<绑定当前用户消息的回执>。',
    );
  }
  const {state: currentState} = await loadProduction(slug);
  transitionProduction(currentState, action, {note});

  const artifacts = {};
  if (action === 'capabilities-ready') {
    await assertSelectedProvidersReady(slug, {
      capabilities: await requiredProviderCapabilitiesForProject(slug),
    });
  }
  if (action === 'brief-ready') {
    const {project} = await loadProject(slug);
    assertCreativePlanReady(project.plan, {slug});
    await assertStoryboardReady(
      slug,
      project.plan,
      project.styleProfile,
    );
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
