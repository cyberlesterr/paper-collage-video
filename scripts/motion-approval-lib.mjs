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

const hashFile = async (file) =>
  createHash('sha256').update(await fs.readFile(file)).digest('hex');

export const motionApprovalFileFor = (slug) =>
  projectPaths(slug).motionApprovalFile;

export const recordMotionApproval = async ({
  slug,
  humanNote,
  visualBlueprint,
  at = new Date().toISOString(),
}) => {
  const note = humanNote.trim();
  if (!note) {
    throw new Error('动作语言批准必须保留人的明确原话。');
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
    schemaVersion: 1,
    slug,
    approvedAt: at,
    humanNote: note,
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
  await writeJson(file, record);
  return {file, record};
};

export const assertMotionApprovalCurrent = async (slug) => {
  const file = motionApprovalFileFor(slug);
  if (!(await fileExists(file))) {
    throw new Error(
      '缺少当前动作语言批准；请在现有风格/虚构声音 gate 展示动作语言卡并重新记录 approve-style-voice。',
    );
  }
  const [record, {project}, storyboard] = await Promise.all([
    readJson(file),
    loadProject(slug),
    loadStoryboard(slug),
  ]);
  if (
    record.schemaVersion !== 1 ||
    record.slug !== slug ||
    !record.humanNote?.trim() ||
    !Number.isFinite(Date.parse(record.approvedAt)) ||
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
    record.styleProfileBinding?.profileFingerprint !==
      project.styleProfile?.profileFingerprint
  ) {
    throw new Error(
      '动作语言批准绑定的 Style Profile 已变化。',
    );
  }
  return {file, record};
};
