#!/usr/bin/env node
import {printCliHelp} from './cli-help-lib.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ROOT,
  readJson,
  writeJson,
  writeJsonTransaction,
} from './project-lib.mjs';
import {parseCliValue, sha256Text} from './contract-utils.mjs';
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
  humanReviewReceiptFingerprint,
  recordVisualBlueprintApproval,
} from './visual-blueprint-review-lib.mjs';
import {visualBlueprintPaths} from './visual-blueprint-lib.mjs';

const args = process.argv.slice(2);
const USAGE =
  '用法：project:visual-review -- <slug> make-receipt --decision=<approved|revise> ';
printCliHelp(args, USAGE);
const positionals = args.filter((argument) => !argument.startsWith('--'));
const [slug, action] = positionals;
const valueFor = (name) => parseCliValue(args, name);

const makeReceipt = async () => {
  const decision = valueFor('--decision');
  const note = (valueFor('--note') ?? '').trim();
  const reviewerInput = (valueFor('--reviewer') ?? '').trim();
  const host = (valueFor('--host') ?? '').trim();
  const threadId = (valueFor('--thread') ?? '').trim();
  const messageReference = (valueFor('--message-ref') ?? '').trim();
  const messageText = valueFor('--message-file')
    ? await fs.readFile(
        resolveWorkspacePath(valueFor('--message-file'), '宿主用户消息文件'),
        'utf8',
      )
    : valueFor('--message');
  if (
    !['approved', 'revise'].includes(decision) ||
    !note ||
    !reviewerInput ||
    !host ||
    !threadId ||
    !messageReference ||
    typeof messageText !== 'string' ||
    !messageText.trim()
  ) {
    throw new Error(
      USAGE +
        '--note=<用户原话> --reviewer=<human:id> --host=<host> --thread=<threadId> ' +
        '--message-ref=<消息引用> (--message=<原文>|--message-file=<路径>)',
    );
  }
  const current = await assertVisualBlueprintReviewRequestCurrent(slug);
  const receipt = {
    $schema: '../../schemas/visual-blueprint-review-receipt.schema.json',
    schemaVersion: 1,
    projectSlug: slug,
    requestFingerprint: current.request.requestFingerprint,
    decision,
    reviewer: {
      id: reviewerInput.startsWith('human:')
        ? reviewerInput
        : `human:${reviewerInput}`,
      role: 'human',
    },
    note,
    decidedAt: new Date().toISOString(),
    evidence: {
      kind: 'host-user-message',
      host,
      threadId,
      messageReference,
      userMessageSha256: sha256Text(messageText),
    },
  };
  receipt.receiptFingerprint = humanReviewReceiptFingerprint(receipt);
  assertHumanVisualReviewReceipt({
    receipt,
    request: current.request,
    expectedDecision: decision,
  });
  const paths = visualBlueprintPaths(slug);
  await writeJson(paths.reviewReceipt, receipt);
  const receiptPath = path.relative(ROOT, paths.reviewReceipt);
  console.log(`✓ 已生成当前人审回执：${receiptPath}`);
  console.log(
    `下一步：npm run project:visual-review -- ${slug} ${
      decision === 'approved' ? 'approve' : 'revise'
    } --receipt=${receiptPath}`,
  );
};

try {
  if (!slug || !['approve', 'revise', 'make-receipt'].includes(action)) {
    throw new Error(
      '用法：project:visual-review -- <slug> <approve|revise> --receipt=<receipt.json>，' +
        '或 project:visual-review -- <slug> make-receipt --decision=... （代算回执指纹）',
    );
  }
  if (action === 'make-receipt') {
    await makeReceipt();
  } else {
    const receiptInput = valueFor('--receipt');
    if (!receiptInput) {
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
      console.log(
        '⚠ 当前视觉蓝图已按人工意见退回；请修改 project/storyboard 执行树后重新运行 project:visual-blueprint。',
      );
    }
  }
} catch (error) {
  console.error(`project:visual-review failed: ${error.message}`);
  process.exitCode = 1;
}
