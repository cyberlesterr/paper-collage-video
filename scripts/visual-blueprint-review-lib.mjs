import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ROOT,
  fileExists,
  jsonDocumentBytes,
  projectPaths,
  readJson,
  writeJsonTransaction,
} from './project-lib.mjs';
import {
  assertOperationCircuitClosed,
  recordOperationSuccess,
} from './failure-circuit-lib.mjs';
import {
  assertVisualBlueprintReady,
  requiredVisualBlueprintArtifactFiles,
  visualBlueprintPaths,
  visualBlueprintReviewOperation,
  visualBlueprintReviewRequestFingerprint,
} from './visual-blueprint-lib.mjs';

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const hashValue = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hashFile = async (file) =>
  createHash('sha256').update(await fs.readFile(file)).digest('hex');
const hashJsonDocument = (value) =>
  createHash('sha256').update(jsonDocumentBytes(value)).digest('hex');

export const humanReviewReceiptFingerprint = (receipt) => {
  const {receiptFingerprint, ...value} = receipt;
  return hashValue(value);
};

export const assertHumanVisualReviewReceipt = ({
  receipt,
  request,
  expectedDecision = null,
}) => {
  const reviewerId = receipt?.reviewer?.id;
  const evidence = receipt?.evidence;
  if (
    receipt?.schemaVersion !== 1 ||
    receipt.projectSlug !== request?.projectSlug ||
    receipt.requestFingerprint !== request?.requestFingerprint ||
    !['approved', 'revise'].includes(receipt.decision) ||
    (expectedDecision && receipt.decision !== expectedDecision) ||
    receipt.reviewer?.role !== 'human' ||
    typeof reviewerId !== 'string' ||
    !reviewerId.startsWith('human:') ||
    reviewerId.length <= 'human:'.length ||
    typeof receipt.note !== 'string' ||
    !receipt.note.trim() ||
    !Number.isFinite(Date.parse(receipt.decidedAt)) ||
    evidence?.kind !== 'host-user-message' ||
    typeof evidence.host !== 'string' ||
    !evidence.host.trim() ||
    typeof evidence.threadId !== 'string' ||
    !evidence.threadId.trim() ||
    typeof evidence.messageReference !== 'string' ||
    !evidence.messageReference.trim() ||
    !HASH_PATTERN.test(evidence.userMessageSha256 ?? '') ||
    !HASH_PATTERN.test(receipt.receiptFingerprint ?? '') ||
    receipt.receiptFingerprint !== humanReviewReceiptFingerprint(receipt)
  ) {
    throw new Error(
      '视觉蓝图决定必须使用绑定当前人审请求和宿主用户消息的有效 human review receipt。',
    );
  }
  if (Date.parse(receipt.decidedAt) < Date.parse(request.createdAt)) {
    throw new Error('human review receipt 早于当前人审请求，不能用于批准。');
  }
  return receipt;
};

export const assertVisualBlueprintReviewRequestCurrent = async (slug) => {
  const paths = visualBlueprintPaths(slug);
  if (!(await fileExists(paths.reviewRequest))) {
    throw new Error(
      '缺少当前视觉蓝图人审请求；请重新运行 project:visual-blueprint。',
    );
  }
  const [request, ready] = await Promise.all([
    readJson(paths.reviewRequest),
    assertVisualBlueprintReady(slug),
  ]);
  if (
    request.schemaVersion !== 1 ||
    request.projectSlug !== slug ||
    request.status !== 'awaiting-human' ||
    request.blueprintReport !== path.relative(ROOT, ready.file) ||
    request.blueprintReportSha256 !== (await hashFile(ready.file)) ||
    request.visualContractFingerprint !==
      ready.report.visualContractFingerprint ||
    request.runtimeBuildFingerprint !==
      ready.report.runtimeBuildFingerprint ||
    request.requestFingerprint !==
      visualBlueprintReviewRequestFingerprint(request)
  ) {
    throw new Error('视觉蓝图人审请求无效或已过期；请重新生成蓝图。');
  }
  const expectedArtifacts =
    requiredVisualBlueprintArtifactFiles(ready.report);
  if (
    JSON.stringify(request.reviewArtifacts?.map(({file}) => file) ?? []) !==
    JSON.stringify(expectedArtifacts)
  ) {
    throw new Error('视觉蓝图人审请求没有覆盖当前全部待看产物。');
  }
  for (const {file, sha256} of request.reviewArtifacts) {
    if (
      sha256 !== ready.report.artifactHashes?.[file] ||
      !HASH_PATTERN.test(sha256 ?? '')
    ) {
      throw new Error(`视觉蓝图人审请求中的产物绑定已过期：${file}`);
    }
  }
  return {file: paths.reviewRequest, request, ready};
};

export const recordVisualBlueprintApproval = async ({
  slug,
  receipt,
  write = true,
}) => {
  const current = await assertVisualBlueprintReviewRequestCurrent(slug);
  const validatedReceipt = assertHumanVisualReviewReceipt({
    receipt,
    request: current.request,
    expectedDecision: 'approved',
  });
  await assertOperationCircuitClosed({
    slug,
    operation: visualBlueprintReviewOperation,
  });
  const paths = visualBlueprintPaths(slug);
  const record = {
    $schema: '../../schemas/visual-blueprint-approval.schema.json',
    schemaVersion: 2,
    projectSlug: slug,
    status: 'approved',
    blueprintReport: path.relative(ROOT, current.ready.file),
    blueprintReportSha256: await hashFile(current.ready.file),
    visualContractFingerprint:
      current.ready.report.visualContractFingerprint,
    runtimeBuildFingerprint: current.ready.report.runtimeBuildFingerprint,
    reviewRequest: path.relative(ROOT, current.file),
    reviewRequestSha256: await hashFile(current.file),
    reviewRequestFingerprint: current.request.requestFingerprint,
    reviewReceipt: path.relative(ROOT, paths.reviewReceipt),
    reviewReceiptSha256: hashJsonDocument(validatedReceipt),
    reviewReceiptFingerprint: validatedReceipt.receiptFingerprint,
    decision: {
      authority: 'human-review-receipt',
      reviewer: validatedReceipt.reviewer.id,
      note: validatedReceipt.note.trim(),
      decidedAt: validatedReceipt.decidedAt,
    },
  };
  if (write) {
    await writeJsonTransaction([
      {file: paths.reviewReceipt, value: validatedReceipt},
      {file: paths.approval, value: record},
    ]);
    await recordOperationSuccess({
      slug,
      operation: visualBlueprintReviewOperation,
      inputFingerprint:
        current.ready.report.visualContractFingerprint,
      note: `human receipt approval: ${validatedReceipt.receiptFingerprint}`,
    });
  }
  return {
    file: paths.approval,
    record,
    receiptFile: paths.reviewReceipt,
    receipt: validatedReceipt,
    current,
  };
};

export const assertVisualBlueprintApprovalCurrent = async (slug) => {
  const paths = visualBlueprintPaths(slug);
  if (!(await fileExists(paths.approval))) {
    throw new Error('正式素材生产前必须获得当前同源视觉蓝图的人工批准。');
  }
  if (!(await fileExists(paths.reviewReceipt))) {
    throw new Error(
      '当前视觉蓝图正在等待人工审片回执；必须先向用户展示 animatic、每幕关键帧和动态片段，不能继续正式素材生产。',
    );
  }
  const [approval, receipt, current] = await Promise.all([
    readJson(paths.approval),
    readJson(paths.reviewReceipt),
    assertVisualBlueprintReviewRequestCurrent(slug),
  ]);
  assertHumanVisualReviewReceipt({
    receipt,
    request: current.request,
    expectedDecision: 'approved',
  });
  if (
    approval.schemaVersion !== 2 ||
    approval.status !== 'approved' ||
    approval.projectSlug !== slug ||
    approval.decision?.authority !== 'human-review-receipt' ||
    approval.decision?.reviewer !== receipt.reviewer.id ||
    approval.decision?.note !== receipt.note.trim() ||
    approval.decision?.decidedAt !== receipt.decidedAt
  ) {
    throw new Error(
      'visual-blueprint-approval.json 无效或没有绑定当前人工回执。',
    );
  }
  if (
    approval.visualContractFingerprint !==
      current.ready.report.visualContractFingerprint ||
    approval.runtimeBuildFingerprint !==
      current.ready.report.runtimeBuildFingerprint ||
    approval.blueprintReport !==
      path.relative(ROOT, current.ready.file) ||
    approval.blueprintReportSha256 !==
      (await hashFile(current.ready.file)) ||
    approval.reviewRequest !== path.relative(ROOT, current.file) ||
    approval.reviewRequestSha256 !== (await hashFile(current.file)) ||
    approval.reviewRequestFingerprint !==
      current.request.requestFingerprint ||
    approval.reviewReceipt !==
      path.relative(ROOT, paths.reviewReceipt) ||
    approval.reviewReceiptSha256 !== hashJsonDocument(receipt) ||
    approval.reviewReceiptFingerprint !== receipt.receiptFingerprint
  ) {
    throw new Error('视觉蓝图批准已过期；正式生产不得偏离已批准几何与时序。');
  }
  return {
    file: paths.approval,
    approval,
    receipt,
    current,
    ready: current.ready,
  };
};

export const assertProviderVisualBlueprintGate = async (request) => {
  if (request?.capability === 'text') {
    return {required: false, reason: 'text-does-not-produce-final-media'};
  }
  if (request?.quality?.kind === 'style-sample') {
    return {required: false, reason: 'single-style-sample-before-blueprint'};
  }
  if (
    request?.capability === 'voice' &&
    request.timingBinding === undefined
  ) {
    return {required: false, reason: 'fictional-voice-audition'};
  }
  const productionFile = projectPaths(request.projectSlug).productionFile;
  if (!(await fileExists(productionFile))) {
    return {
      required: false,
      reason: 'library-fixture-without-production-state',
    };
  }
  const current = await assertVisualBlueprintApprovalCurrent(
    request.projectSlug,
  );
  return {
    required: true,
    reason: 'bulk-provider-production',
    approval: current.approval,
  };
};
