import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  collectStyleProofTargets,
  prepareQualityReport,
} from './quality-lib.mjs';
import {
  ROOT,
  fileExists,
  loadProject,
  readJson,
} from './project-lib.mjs';
import {loadStoryboard} from './storyboard-lib.mjs';
import {selectStyleProofTargets} from './motion-treatment-lib.mjs';
import {createRuntimeSurfaceFingerprint} from './runtime-build-lib.mjs';
import {buildSpatialContractProof} from './spatial-contract-lib.mjs';

const REQUIRED_ASSET_EVIDENCE = [
  'alphaMask',
  'checkerboard',
  'tightCrop',
  'motionStress',
  'alphaBandReport',
  'alphaBandOverlay',
];
const REQUIRED_FRAME_EVIDENCE = ['fullFrame', 'crop', 'debugFrame'];

export const styleProofReportPath = (slug) => path.join(ROOT, 'dist', slug, 'style-motion-proof.json');

export const styleFingerprintForTarget = (target) => target.fingerprint;

export const buildStyleTargetPatternProof = async ({project, target}) => {
  if (target.pattern !== 'spatial-contract') return {spatialProof: null};
  const spatialProof = await buildSpatialContractProof(
    project,
    target.spatialContract,
  );
  if (!spatialProof.passed) {
    const failed = spatialProof.checks
      .filter(({passed}) => !passed)
      .map(({id}) => id)
      .join(', ');
    throw new Error(
      `spatial contract ${target.spatialContract.id} 的 style proof 未通过：${failed}。`,
    );
  }
  return {spatialProof};
};

export const assertStyleTargetPatternProof = ({target, proof}) => {
  if (target.pattern !== 'spatial-contract') return;
  if (
    proof.spatialProof?.contractId !== target.spatialContract.id ||
    proof.spatialProof?.kind !== target.spatialContract.kind ||
    proof.spatialProof?.passed !== true
  ) {
    throw new Error(
      `${proof.compositeId} 缺少通过且匹配当前契约的空间样式证明。`,
    );
  }
};

const assertEvidenceFile = async (file, label, root = ROOT) => {
  if (typeof file !== 'string' || file.length === 0) throw new Error(`风格拓扑证明缺少 ${label}。`);
  const absolute = path.resolve(root, file);
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) throw new Error(`风格拓扑证明路径越过工作区：${file}`);
  if (!(await fileExists(absolute))) throw new Error(`风格拓扑证明文件不存在：${file}`);
  return absolute;
};

const hashFile = async (file) =>
  createHash('sha256').update(await fs.readFile(file)).digest('hex');

export const assertCanonicalContainerStyleProof = async ({
  target,
  proof,
  root = ROOT,
}) => {
  if (target.pattern !== 'canonical-container') return;
  const containerProof = proof.canonicalContainerProof;
  const artifactEntries = Object.entries(
    containerProof?.artifacts ?? {},
  );
  if (
    containerProof?.passed !== true ||
    containerProof.familyFingerprint !==
      target.group?.canonicalContainer?.familyFingerprint ||
    artifactEntries.length !== 3
  ) {
    throw new Error(
      `${proof.compositeId} 缺少通过且绑定当前家族的 canonical-container 证明。`,
    );
  }
  for (const [key, file] of artifactEntries) {
    const absolute = await assertEvidenceFile(
      file,
      `${proof.compositeId}.canonicalContainer.${key}`,
      root,
    );
    if (
      await hashFile(absolute) !==
      containerProof.artifactHashes?.[file]
    ) {
      throw new Error(
        `${proof.compositeId} 的 canonical-container 证明文件已变化：${file}。`,
      );
    }
  }
};

const allPassed = (semanticChecks) => Object.values(semanticChecks ?? {}).every((status) => status === 'passed');

const assertReviewedEvidence = (entry, files, label) => {
  const reviewed = new Set((entry.evidenceFiles ?? []).map(({file}) => path.normalize(file)));
  for (const file of files) {
    const relative = path.normalize(path.relative(ROOT, path.resolve(ROOT, file)));
    if (!reviewed.has(relative)) throw new Error(`${label} 的质量记录未引用当前证明证据：${file}`);
  }
};

export const selectTargetAssetEvidence = ({report, target}) =>
  (report.assetEvidence ?? []).filter(
    ({sceneId, nodeId}) =>
      sceneId === target.sceneId &&
      target.memberNodeIds.includes(nodeId),
  );

export const selectTargetQualityAssetGroups = ({qualityReport, target}) =>
  target.memberNodeIds
    .map((nodeId) => ({
      nodeId,
      assets: qualityReport.assets.filter(({sources}) =>
        sources.includes(`scene:${target.sceneId}:node:${nodeId}`)),
    }))
    .filter(({assets}) => assets.length > 0);

export const assertStyleProofReady = async (slug) => {
  const [{project}, storyboard] = await Promise.all([loadProject(slug), loadStoryboard(slug)]);
  const directingTargets = selectStyleProofTargets(storyboard);
  if (directingTargets.length === 0) return {required: false, ready: true, report: null, composites: []};

  const targetGroups = await Promise.all(directingTargets.map((target) => collectStyleProofTargets(project, target)));
  const targets = [...new Map(targetGroups.flat().map((target) => [target.compositeId, target])).values()];

  const reportFile = styleProofReportPath(slug);
  if (!(await fileExists(reportFile))) throw new Error('缺少当前风格拓扑证明；请先运行 npm run project:style-proof。');
  const report = await readJson(reportFile);
  if (report.schemaVersion !== 7 || report.scope !== 'style' || !Array.isArray(report.composites)) {
    throw new Error('风格拓扑证明格式过旧或不完整；请重新运行 npm run project:style-proof。');
  }
  const runtimeBuildFingerprint =
    await createRuntimeSurfaceFingerprint('composition-proof');
  if (
    report.planFingerprint !== storyboard.directingSummary.styleProofPlan.fingerprint ||
    report.motionContractFingerprint !==
      storyboard.motionContract.fingerprint ||
    report.motionApprovalFingerprint !==
      storyboard.motionContract.approvalFingerprint ||
    storyboard.directingSummary.styleProofPlan
      .motionContractFingerprint !==
      storyboard.motionContract.fingerprint ||
    JSON.stringify(report.directingTargets) !== JSON.stringify(directingTargets) ||
    report.runtimeBuildFingerprint !== runtimeBuildFingerprint
  ) {
    throw new Error('风格拓扑证明没有绑定当前多维风险覆盖计划；请重新运行 npm run project:style-proof。');
  }
  if (!Array.isArray(report.outputs) || report.outputs.length === 0) {
    throw new Error('风格拓扑证明缺少 outputs。');
  }
  for (const [index, output] of report.outputs.entries()) {
    await assertEvidenceFile(output.file, `outputs[${index}].file`);
  }
  await assertEvidenceFile(report.contactSheet, 'contactSheet');

  const targetById = new Map(targets.map((target) => [target.compositeId, target]));
  const provenTargets = [];
  for (const proof of report.composites) {
    const target = targetById.get(proof.compositeId);
    if (!target) continue;
    if (proof.fingerprint !== styleFingerprintForTarget(target)) {
      throw new Error(`${proof.compositeId} 的风格拓扑证明已过期；请重新生成。`);
    }
    assertStyleTargetPatternProof({target, proof});
    await assertCanonicalContainerStyleProof({target, proof});
    const frames = proof.proofFrames ?? [];
    for (const proofTimeId of target.proofTimeIds) {
      const frame = frames.find((candidate) => candidate.proofTimeId === proofTimeId);
      if (!frame) throw new Error(`${proof.compositeId} 缺少证明时刻 ${proofTimeId}。`);
      for (const field of REQUIRED_FRAME_EVIDENCE) await assertEvidenceFile(frame[field], `${proof.compositeId}.${proofTimeId}.${field}`);
    }
    if (target.pattern === 'registered-depth-stack') {
      const layerProof = proof.layerStackProof;
      const envelopeExtremes =
        layerProof?.artifacts?.envelopeExtremes ?? [];
      const subjectTravelExtremes =
        layerProof?.artifacts?.subjectTravelExtremes ?? [];
      const subjectTravelRequired = Boolean(
        target.group?.layerStack?.subjectTravelEnvelope,
      );
      if (
        layerProof?.passed !== true ||
        envelopeExtremes.length !== 3 ||
        envelopeExtremes.some(
          ({passed, transparentPixels}) =>
            passed !== true || transparentPixels !== 0,
        ) ||
        (
          subjectTravelRequired &&
          (
            subjectTravelExtremes.length !== 3 ||
            subjectTravelExtremes.some(
              ({passed, transparentPixels}) =>
                passed !== true || transparentPixels !== 0,
            )
          )
        )
      ) {
        throw new Error(
          `${proof.compositeId} 缺少通过的三画幅 layer-family 极值证明。`,
        );
      }
      await assertEvidenceFile(
        layerProof.artifacts.neutralReconstruction,
        `${proof.compositeId}.neutralReconstruction`,
      );
      await assertEvidenceFile(
        layerProof.artifacts.referenceComparison,
        `${proof.compositeId}.referenceComparison`,
      );
      await assertEvidenceFile(
        layerProof.artifacts.explodedView,
        `${proof.compositeId}.explodedView`,
      );
      for (const envelope of envelopeExtremes) {
        await assertEvidenceFile(
          envelope.file,
          `${proof.compositeId}.envelope.${envelope.profile}`,
        );
      }
      for (const envelope of subjectTravelExtremes) {
        await assertEvidenceFile(
          envelope.file,
          `${proof.compositeId}.subjectTravel.${envelope.profile}`,
        );
      }
    }
    if (target.pattern === 'looping-environment') {
      if (
        proof.loopingWorldProof?.passed !== true ||
        proof.loopingWorldProof.coverage?.some(
          ({uncoveredPixels}) => uncoveredPixels !== 0,
        ) ||
        proof.loopingWorldProof.strips?.some(
          ({seamPassed}) => seamPassed !== true,
        )
      ) {
        throw new Error(
          `${proof.compositeId} 缺少通过的三画幅 seam/coverage/world-motion 证明。`,
        );
      }
      for (const strip of proof.loopingWorldProof.strips) {
        await assertEvidenceFile(
          strip.derivationReport,
          `${proof.compositeId}.${strip.nodeId}.derivationReport`,
        );
      }
    }
    for (const evidence of selectTargetAssetEvidence({report, target})) {
      for (const field of REQUIRED_ASSET_EVIDENCE) await assertEvidenceFile(evidence[field], `${evidence.nodeId}.${field}`);
    }
    provenTargets.push(target);
  }
  if (provenTargets.length !== targets.length || provenTargets.length === 0) {
    throw new Error('风格证明没有完整覆盖最高风险导演目标；自由目标也必须提供结构化 composite 证据。');
  }

  const quality = await prepareQualityReport(slug, {
    write: false,
    allowPendingSemanticEvidenceTargets: true,
  });
  for (const target of provenTargets) {
    const composite = quality.report.composites.find(({compositeId}) => compositeId === target.compositeId);
    if (!target.styleOnly && (!composite || !allPassed(composite.semanticChecks))) {
      throw new Error(`${target.compositeId} 的拓扑语义检查尚未全部通过；请检查证明图并用 project:quality record-batch 记录。`);
    }
    const proof = report.composites.find(({compositeId}) => compositeId === target.compositeId);
    const compositeEvidence = (proof?.proofFrames ?? []).flatMap((frame) => REQUIRED_FRAME_EVIDENCE.map((field) => frame[field]));
    if (target.pattern === 'registered-depth-stack') {
      compositeEvidence.push(
        proof.layerStackProof.artifacts.neutralReconstruction,
        proof.layerStackProof.artifacts.referenceComparison,
        proof.layerStackProof.artifacts.explodedView,
        ...proof.layerStackProof.artifacts.envelopeExtremes.map(
          ({file}) => file,
        ),
        ...(proof.layerStackProof.artifacts.subjectTravelExtremes ?? []).map(
          ({file}) => file,
        ),
      );
    }
    if (target.pattern === 'looping-environment') {
      compositeEvidence.push(
        ...proof.loopingWorldProof.strips.map(
          ({derivationReport}) => derivationReport,
        ),
      );
    }
    if (target.pattern === 'canonical-container') {
      compositeEvidence.push(
        ...Object.values(
          proof.canonicalContainerProof.artifacts,
        ),
      );
    }
    const targetAssetEvidence = selectTargetAssetEvidence({report, target});
    compositeEvidence.push(...targetAssetEvidence.map(({motionStress}) => motionStress));
    if (composite) assertReviewedEvidence(composite, compositeEvidence, target.compositeId);
    for (const {nodeId, assets} of selectTargetQualityAssetGroups({
      qualityReport: quality.report,
      target,
    })) {
      if (assets.some((asset) => !asset.technical.passed || !allPassed(asset.semanticChecks))) {
        throw new Error(`${target.compositeId} 的成员 ${nodeId} 尚未通过完整素材质量检查。`);
      }
      for (const asset of assets) {
        const evidence = targetAssetEvidence.find((candidate) =>
          candidate.nodeId === nodeId && candidate.source && path.normalize(path.relative(ROOT, path.resolve(ROOT, 'public', candidate.source))) === path.normalize(asset.file),
        ) ?? targetAssetEvidence.find((candidate) => candidate.nodeId === nodeId && !candidate.source);
        if (!evidence) throw new Error(`${target.compositeId} 的成员 ${nodeId} 缺少 ${asset.file} 的当前素材证据。`);
        assertReviewedEvidence(asset, REQUIRED_ASSET_EVIDENCE.map((field) => evidence[field]), `${target.compositeId} 的成员 ${nodeId}`);
      }
    }
    const masterAssetId = target.group?.registration?.sourceMasterAssetId ?? target.sequence?.registration?.sourceMasterAssetId;
    if (masterAssetId) {
      const master = quality.report.assets.find(({assetId}) => assetId === masterAssetId);
      if (master && (!master.technical.passed || !allPassed(master.semanticChecks))) {
        throw new Error(`${target.compositeId} 的完整母版 ${masterAssetId} 尚未通过质量检查。`);
      }
    }
  }
  return {
    required: true,
    ready: true,
    report: reportFile,
    planFingerprint: storyboard.directingSummary.styleProofPlan.fingerprint,
    motionContractFingerprint: storyboard.motionContract.fingerprint,
    motionApprovalFingerprint:
      storyboard.motionContract.approvalFingerprint,
    targets: directingTargets,
    composites: provenTargets.map(({compositeId}) => compositeId),
  };
};
