#!/usr/bin/env node
import path from 'node:path';
import {
  ROOT,
  readJson,
  writeJsonTransaction,
} from './project-lib.mjs';
import {resolveWorkspacePath} from './provider-lib.mjs';
import {
  loadProduction,
  syncReviewFromProduction,
  transitionProduction,
} from './production-state.mjs';
import {recordMotionApproval} from './motion-approval-lib.mjs';
import {
  assertHumanVisualReviewReceipt,
  assertVisualBlueprintReviewRequestCurrent,
  recordVisualBlueprintApproval,
} from './visual-blueprint-review-lib.mjs';
import {
  visualBlueprintPaths,
  visualBlueprintReviewOperation,
} from './visual-blueprint-lib.mjs';
import {
  deriveFailureSignature,
  recordOperationFailure,
  recordOperationSuccess,
} from './failure-circuit-lib.mjs';

const args = process.argv.slice(2);
const positionals = args.filter((argument) => !argument.startsWith('--'));
const [slug, action] = positionals;
const valueFor = (name) =>
  args.find((argument) => argument.startsWith(`${name}=`))
    ?.slice(name.length + 1);

try {
  const receiptInput = valueFor('--receipt');
  if (!slug || !['approve', 'revise'].includes(action) || !receiptInput) {
    throw new Error(
      '用法：project:visual-review -- <slug> <approve|revise> --receipt=<visual-blueprint-review-receipt.json>',
    );
  }
  const receipt = await readJson(
    resolveWorkspacePath(receiptInput, '视觉蓝图人工回执路径'),
  );
  const current = await assertVisualBlueprintReviewRequestCurrent(slug);
  const expectedDecision = action === 'approve' ? 'approved' : 'revise';
  assertHumanVisualReviewReceipt({
    receipt,
    request: current.request,
    expectedDecision,
  });
  const {paths: productionPaths, state} = await loadProduction(slug);
  const paths = visualBlueprintPaths(slug);
  const receiptArtifact = path.relative(ROOT, paths.reviewReceipt);

  if (action === 'approve') {
    const approval = await recordVisualBlueprintApproval({
      slug,
      receipt,
      write: false,
    });
    const motionApproval = await recordMotionApproval({
      slug,
      visualBlueprint: approval.current.ready,
      reviewReceipt: receipt,
      write: false,
    });
    const productionAction =
      state.stage === 'style-review'
        ? 'approve-style-voice'
        : state.stage === 'asset-production'
          ? 'approve-visual-blueprint'
          : null;
    if (!productionAction) {
      throw new Error(
        `当前阶段 ${state.stage} 不能批准视觉蓝图；必须处于 style-review 或 asset-production。`,
      );
    }
    const next = transitionProduction(state, productionAction, {
      note: receipt.note.trim(),
      at: receipt.decidedAt,
      artifacts: {
        motionApproval: path.relative(ROOT, motionApproval.file),
        visualBlueprint: approval.record.blueprintReport,
        visualBlueprintReviewRequest:
          approval.record.reviewRequest,
        visualBlueprintReviewReceipt: receiptArtifact,
        visualBlueprintApproval: path.relative(ROOT, approval.file),
      },
    });
    await writeJsonTransaction([
      {file: paths.reviewReceipt, value: receipt},
      {file: approval.file, value: approval.record},
      {file: motionApproval.file, value: motionApproval.record},
      {file: productionPaths.productionFile, value: next},
    ]);
    await syncReviewFromProduction(slug, next);
    await recordOperationSuccess({
      slug,
      operation: visualBlueprintReviewOperation,
      inputFingerprint:
        current.ready.report.visualContractFingerprint,
      note: `human receipt approval: ${receipt.receiptFingerprint}`,
    });
    console.log(
      `✓ 已消费当前用户回执并批准同源视觉蓝图：${receipt.receiptFingerprint}`,
    );
    console.log(`✓ 生产状态：${next.stage}`);
  } else {
    const next = transitionProduction(
      state,
      'request-visual-blueprint-revision',
      {
        note: receipt.note.trim(),
        at: receipt.decidedAt,
        artifacts: {
          visualBlueprintReviewRequest: path.relative(
            ROOT,
            current.file,
          ),
          visualBlueprintReviewReceipt: receiptArtifact,
          visualBlueprintApproval: null,
        },
      },
    );
    await writeJsonTransaction([
      {file: paths.reviewReceipt, value: receipt},
      {file: productionPaths.productionFile, value: next},
    ]);
    await syncReviewFromProduction(slug, next);
    const failure = await recordOperationFailure({
      slug,
      operation: visualBlueprintReviewOperation,
      inputFingerprint:
        current.ready.report.visualContractFingerprint,
      failureSignature: deriveFailureSignature({
        operation: visualBlueprintReviewOperation,
        explicit: 'human visual blueprint rejected',
      }),
      evidence:
        `human receipt ${receipt.receiptFingerprint}: ${receipt.note.trim()}`,
    });
    console.log(
      failure.circuit.open
        ? `⛔ 同类视觉方案已第二次被退回；熔断 ${failure.circuit.circuitId} 已打开，停止自动改稿。`
        : '⚠ 当前视觉蓝图已退回；必须改变几何、时序、动作或其他真实输入后才能重新生成。',
    );
  }
} catch (error) {
  console.error(`project:visual-review failed: ${error.message}`);
  process.exitCode = 1;
}
