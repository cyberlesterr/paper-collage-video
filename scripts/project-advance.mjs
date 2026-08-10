#!/usr/bin/env node
import path from 'node:path';
import {
  ROOT,
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
import {recordMotionApproval} from './motion-approval-lib.mjs';
import {
  assertVisualBlueprintReady,
  recordVisualBlueprintApproval,
  visualBlueprintPaths,
  visualBlueprintReviewOperation,
} from './visual-blueprint-lib.mjs';
import {
  deriveFailureSignature,
  recordOperationFailure,
} from './failure-circuit-lib.mjs';

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
  const {state: currentState} = await loadProduction(slug);
  transitionProduction(currentState, action, {note});

  const artifacts = {};
  if (action === 'capabilities-ready') {
    await assertSelectedProvidersReady(slug);
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
  if (action === 'approve-style-voice') {
    const visualBlueprint = await assertVisualBlueprintReady(slug);
    const motionApproval = await recordMotionApproval({
      slug,
      humanNote: note,
      visualBlueprint,
    });
    artifacts.motionApproval = path.relative(
      ROOT,
      motionApproval.file,
    );
    const visualBlueprintApproval = await recordVisualBlueprintApproval({
      slug,
      humanNote: note,
    });
    artifacts.visualBlueprint =
      visualBlueprintApproval.record.blueprintReport;
    artifacts.visualBlueprintApproval = path.relative(
      ROOT,
      visualBlueprintApproval.file,
    );
    console.log(
      `✓ 动作语言批准：${motionApproval.record.motionApprovalFingerprint}`,
    );
    console.log(
      `✓ 同源视觉蓝图批准：${visualBlueprintApproval.record.visualContractFingerprint}`,
    );
  }
  if (action === 'approve-visual-blueprint') {
    const visualBlueprintApproval = await recordVisualBlueprintApproval({
      slug,
      humanNote: note,
    });
    artifacts.visualBlueprint =
      visualBlueprintApproval.record.blueprintReport;
    artifacts.visualBlueprintApproval = path.relative(
      ROOT,
      visualBlueprintApproval.file,
    );
  }
  if (action === 'request-visual-blueprint-revision') {
    const report = await readJson(visualBlueprintPaths(slug).report);
    const failure = await recordOperationFailure({
      slug,
      operation: visualBlueprintReviewOperation,
      inputFingerprint: report.visualContractFingerprint,
      failureSignature: deriveFailureSignature({
        operation: visualBlueprintReviewOperation,
        explicit: 'human visual blueprint rejected',
      }),
      evidence:
        `human rejected visual contract ${report.visualContractFingerprint}: ${note}`,
    });
    console.log(
      failure.circuit.open
        ? `⛔ 同源视觉蓝图第 ${failure.circuit.count} 次被退回；熔断 ${failure.circuit.circuitId} 已打开，停止自动改稿。`
        : '⚠ 同源视觉蓝图首次被退回；必须改变项目几何、时序或运动输入后才能重新生成。',
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
