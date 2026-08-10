import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ROOT,
  fileExists,
  loadProject,
  projectPaths,
  readJson,
  writeJson,
} from './project-lib.mjs';
import {loadStoryboard} from './storyboard-lib.mjs';
import {assertVisualBlueprintApprovalCurrent} from './visual-blueprint-review-lib.mjs';

const hashFile = async (file) =>
  createHash('sha256').update(await fs.readFile(file)).digest('hex');

export const motionApprovalFileFor = (slug) =>
  projectPaths(slug).motionApprovalFile;

export const recordMotionApproval = async ({
  slug,
  visualBlueprint,
  reviewReceipt,
  write = true,
}) => {
  const note = String(reviewReceipt?.note ?? '').trim();
  if (
    reviewReceipt?.decision !== 'approved' ||
    reviewReceipt?.reviewer?.role !== 'human' ||
    !reviewReceipt?.reviewer?.id?.startsWith('human:') ||
    !reviewReceipt?.receiptFingerprint ||
    !note
  ) {
    throw new Error('动作语言批准必须绑定当前视觉蓝图的人工批准回执。');
  }
  const [{project}, storyboard] = await Promise.all([
    loadProject(slug),
    loadStoryboard(slug),
  ]);
  if (
    JSON.stringify(project.motionContract) !==
    JSON.stringify(storyboard.motionContract)
  ) {
    throw new Error(
      'project.motionContract 与 storyboard.motionContract 不一致，不能记录动作语言批准。',
    );
  }
  if (
    visualBlueprint?.report?.visualContractFingerprint === undefined ||
    visualBlueprint.report.projectSlug !== slug
  ) {
    throw new Error(
      '同源视觉蓝图没有绑定当前项目，不能记录动作语言批准。',
    );
  }
  const record = {
    schemaVersion: 2,
    slug,
    approvedAt: reviewReceipt.decidedAt,
    reviewer: reviewReceipt.reviewer.id,
    humanNote: note,
    reviewReceiptFingerprint: reviewReceipt.receiptFingerprint,
    styleProfileBinding: storyboard.motionContract.styleProfileBinding,
    motionApprovalFingerprint:
      storyboard.motionContract.approvalFingerprint,
    approvedExecutionFingerprint: storyboard.motionContract.fingerprint,
    visualBlueprintFingerprint:
      visualBlueprint.report.visualContractFingerprint,
    visualBlueprintReport: path.relative(
      ROOT,
      visualBlueprint.file,
    ),
    visualBlueprintReportSha256: await hashFile(
      visualBlueprint.file,
    ),
  };
  const file = motionApprovalFileFor(slug);
  if (write) await writeJson(file, record);
  return {file, record};
};

export const assertMotionApprovalCurrent = async (slug) => {
  const file = motionApprovalFileFor(slug);
  if (!(await fileExists(file))) {
    throw new Error(
      '缺少当前动作语言批准；请展示当前视觉蓝图与动作语言卡，并用 project:visual-review 消费人工回执。',
    );
  }
  const [record, {project}, storyboard, visualApproval] = await Promise.all([
    readJson(file),
    loadProject(slug),
    loadStoryboard(slug),
    assertVisualBlueprintApprovalCurrent(slug),
  ]);
  if (
    record.schemaVersion !== 2 ||
    record.slug !== slug ||
    !record.reviewer?.startsWith('human:') ||
    !record.humanNote?.trim() ||
    !Number.isFinite(Date.parse(record.approvedAt)) ||
    !/^[a-f0-9]{64}$/.test(record.reviewReceiptFingerprint ?? '') ||
    !/^[a-f0-9]{64}$/.test(record.visualBlueprintFingerprint ?? '') ||
    !record.visualBlueprintReport?.trim() ||
    !/^[a-f0-9]{64}$/.test(record.visualBlueprintReportSha256 ?? '')
  ) {
    throw new Error('motion-approval.json 格式或人工归因无效。');
  }
  if (
    record.motionApprovalFingerprint !==
      storyboard.motionContract?.approvalFingerprint ||
    record.motionApprovalFingerprint !==
      project.motionContract?.approvalFingerprint
  ) {
    throw new Error(
      '动作语言批准已过期：全片动作语法、节拍角色、同步锚点、转场意图或 Style Profile 已变化。',
    );
  }
  if (
    record.visualBlueprintFingerprint !==
      visualApproval.approval.visualContractFingerprint ||
    record.visualBlueprintReport !==
      visualApproval.approval.blueprintReport ||
    record.visualBlueprintReportSha256 !==
      visualApproval.approval.blueprintReportSha256 ||
    record.reviewReceiptFingerprint !==
      visualApproval.approval.reviewReceiptFingerprint ||
    record.reviewer !== visualApproval.receipt.reviewer.id
  ) {
    throw new Error('动作语言批准没有绑定当前视觉蓝图人工回执。');
  }
  if (
    record.styleProfileBinding?.profileFingerprint !==
      project.styleProfile?.profileFingerprint
  ) {
    throw new Error(
      '动作语言批准绑定的 Style Profile 已变化。',
    );
  }
  return {file, record};
};
