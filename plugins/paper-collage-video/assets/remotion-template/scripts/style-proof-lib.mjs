import path from 'node:path';
import {
  collectCompositeQualityTargets,
  prepareQualityReport,
} from './quality-lib.mjs';
import {
  ROOT,
  fileExists,
  loadProject,
  readJson,
} from './project-lib.mjs';
import {loadStoryboard} from './storyboard-lib.mjs';

const COUPLED_PATTERNS = new Set(['supported-subject', 'registered-environment']);
const REQUIRED_ASSET_EVIDENCE = ['alphaMask', 'checkerboard', 'tightCrop', 'motionStress'];
const REQUIRED_FRAME_EVIDENCE = ['fullFrame', 'crop', 'debugFrame'];

export const styleProofReportPath = (slug) => path.join(ROOT, 'dist', slug, 'style-motion-proof.json');

export const styleFingerprintForTarget = (target) => target.fingerprint;

const assertEvidenceFile = async (file, label) => {
  if (typeof file !== 'string' || file.length === 0) throw new Error(`风格拓扑证明缺少 ${label}。`);
  const absolute = path.resolve(ROOT, file);
  if (absolute !== ROOT && !absolute.startsWith(`${ROOT}${path.sep}`)) throw new Error(`风格拓扑证明路径越过工作区：${file}`);
  if (!(await fileExists(absolute))) throw new Error(`风格拓扑证明文件不存在：${file}`);
};

const allPassed = (semanticChecks) => Object.values(semanticChecks ?? {}).every((status) => status === 'passed');

const assertReviewedEvidence = (entry, files, label) => {
  const reviewed = new Set((entry.evidenceFiles ?? []).map(({file}) => path.normalize(file)));
  for (const file of files) {
    const relative = path.normalize(path.relative(ROOT, path.resolve(ROOT, file)));
    if (!reviewed.has(relative)) throw new Error(`${label} 的质量记录未引用当前证明证据：${file}`);
  }
};

export const assertStyleProofReady = async (slug) => {
  const [{project}, storyboard] = await Promise.all([loadProject(slug), loadStoryboard(slug)]);
  const required = (storyboard.scenes ?? []).some((scene) =>
    (scene.compositionPlan?.patterns ?? []).some((pattern) => COUPLED_PATTERNS.has(pattern)),
  );
  if (!required) return {required: false, ready: true, report: null, composites: []};

  const targets = (await collectCompositeQualityTargets(project)).filter(({pattern}) => COUPLED_PATTERNS.has(pattern));
  if (targets.length === 0) throw new Error('故事板需要耦合拓扑，但项目尚未实现 supported-subject 或 registered-environment 组合。');

  const reportFile = styleProofReportPath(slug);
  if (!(await fileExists(reportFile))) throw new Error('缺少当前风格拓扑证明；请先运行 npm run style:proof。');
  const report = await readJson(reportFile);
  if (report.schemaVersion !== 3 || !Array.isArray(report.composites) || report.composites.length === 0) {
    throw new Error('风格拓扑证明格式过旧或不完整；请重新运行 npm run style:proof。');
  }

  const targetById = new Map(targets.map((target) => [target.compositeId, target]));
  const provenTargets = [];
  for (const proof of report.composites) {
    const target = targetById.get(proof.compositeId);
    if (!target) continue;
    if (proof.styleFingerprint !== styleFingerprintForTarget(target)) {
      throw new Error(`${proof.compositeId} 的风格拓扑证明已过期；请重新生成。`);
    }
    const frames = proof.proofFrames ?? [];
    for (const proofTimeId of target.proofTimeIds) {
      const frame = frames.find((candidate) => candidate.proofTimeId === proofTimeId);
      if (!frame) throw new Error(`${proof.compositeId} 缺少证明时刻 ${proofTimeId}。`);
      for (const field of REQUIRED_FRAME_EVIDENCE) await assertEvidenceFile(frame[field], `${proof.compositeId}.${proofTimeId}.${field}`);
    }
    const assetEvidence = report.assetEvidence ?? [];
    for (const nodeId of target.memberNodeIds) {
      const evidence = assetEvidence.find((candidate) => candidate.nodeId === nodeId);
      if (!evidence) throw new Error(`${proof.compositeId} 缺少成员 ${nodeId} 的 alpha 证据。`);
      for (const field of REQUIRED_ASSET_EVIDENCE) await assertEvidenceFile(evidence[field], `${nodeId}.${field}`);
    }
    provenTargets.push(target);
  }
  if (provenTargets.length === 0) throw new Error('风格拓扑证明没有覆盖当前项目中的耦合组合。');

  const quality = await prepareQualityReport(slug, {write: false});
  for (const target of provenTargets) {
    const composite = quality.report.composites.find(({compositeId}) => compositeId === target.compositeId);
    if (!composite || !allPassed(composite.semanticChecks)) {
      throw new Error(`${target.compositeId} 的拓扑语义检查尚未全部通过；请检查证明图并用 project:quality record-batch 记录。`);
    }
    const proof = report.composites.find(({compositeId}) => compositeId === target.compositeId);
    const compositeEvidence = (proof?.proofFrames ?? []).flatMap((frame) => REQUIRED_FRAME_EVIDENCE.map((field) => frame[field]));
    const targetAssetEvidence = (report.assetEvidence ?? []).filter(({nodeId}) => target.memberNodeIds.includes(nodeId));
    compositeEvidence.push(...targetAssetEvidence.map(({motionStress}) => motionStress));
    assertReviewedEvidence(composite, compositeEvidence, target.compositeId);
    for (const nodeId of target.memberNodeIds) {
      const asset = quality.report.assets.find(({sources}) => sources.includes(`scene:${target.sceneId}:node:${nodeId}`));
      if (!asset || !asset.technical.passed || !allPassed(asset.semanticChecks)) {
        throw new Error(`${target.compositeId} 的成员 ${nodeId} 尚未通过完整素材质量检查。`);
      }
      const evidence = targetAssetEvidence.find((candidate) => candidate.nodeId === nodeId);
      assertReviewedEvidence(asset, REQUIRED_ASSET_EVIDENCE.map((field) => evidence[field]), `${target.compositeId} 的成员 ${nodeId}`);
    }
    const masterAssetId = target.group.registration?.sourceMasterAssetId;
    if (masterAssetId) {
      const master = quality.report.assets.find(({assetId}) => assetId === masterAssetId);
      if (master && (!master.technical.passed || !allPassed(master.semanticChecks))) {
        throw new Error(`${target.compositeId} 的完整母版 ${masterAssetId} 尚未通过质量检查。`);
      }
    }
  }
  return {required: true, ready: true, report: reportFile, composites: provenTargets.map(({compositeId}) => compositeId)};
};
