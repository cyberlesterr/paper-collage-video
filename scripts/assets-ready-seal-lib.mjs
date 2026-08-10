import path from 'node:path';
import {hashCompositionValue} from './composition-lib.mjs';
import {
  ROOT,
  fileExists,
  loadProject,
  projectPaths,
  readJson,
  writeJson,
} from './project-lib.mjs';
import {
  createAudioFingerprint,
  createVisualFingerprint,
} from './render-cache-lib.mjs';
import {createSubtitleContract} from './subtitle-contract-lib.mjs';
import {loadStoryboard} from './storyboard-lib.mjs';
import {assertVisualBlueprintApprovalCurrent} from './visual-blueprint-review-lib.mjs';

const stableValidation = (report) => ({
  schemaVersion: report.schemaVersion,
  project: report.project,
  plan: report.plan,
  providerBudget: report.providerBudget,
  providerRealization: report.providerRealization,
  passed: report.passed,
  summary: report.summary,
  timeline: report.timeline,
  assets: report.assets,
  issues: report.issues,
});

const stableQuality = (report) => ({
  $schema: report.$schema,
  schemaVersion: report.schemaVersion,
  projectSlug: report.projectSlug,
  styleProfile: report.styleProfile,
  motionContract: report.motionContract,
  eventTimeline: report.eventTimeline,
  assetHistory: report.assetHistory,
  assets: report.assets,
  composites: report.composites,
  reviewSurfaceFingerprint: report.reviewSurfaceFingerprint,
});

const stableStoryboard = ({updatedAt: _updatedAt, ...storyboard}) => storyboard;

export const assetsReadySealFileFor = (slug) =>
  path.join(projectPaths(slug).distDirectory, 'assets-ready-seal.json');

export const createAssetsReadyBasis = async ({
  project,
  validation,
  quality,
  storyboard,
}) => {
  const [subtitleContract, visualBlueprint] = await Promise.all([
    createSubtitleContract(project),
    assertVisualBlueprintApprovalCurrent(project.slug),
  ]);
  return {
    projectSlug: project.slug,
    visualFingerprint: await createVisualFingerprint(project, 'assets-ready'),
    audioFingerprint: await createAudioFingerprint(project),
    storyboardFingerprint: hashCompositionValue(stableStoryboard(storyboard)),
    validationFingerprint: hashCompositionValue(stableValidation(validation)),
    qualityFingerprint: hashCompositionValue(stableQuality(quality.report ?? quality)),
    subtitleFingerprint: subtitleContract.fingerprint,
    subtitleContract,
    visualBlueprint: {
      visualContractFingerprint:
        visualBlueprint.approval.visualContractFingerprint,
      approvalFile: path.relative(ROOT, visualBlueprint.file),
      approvalNote: visualBlueprint.approval.decision.note,
      decidedAt: visualBlueprint.approval.decision.decidedAt,
    },
  };
};

export const createAssetsReadySeal = async (
  slug,
  {project: providedProject, validation, quality} = {},
) => {
  const project =
    providedProject ?? (await loadProject(slug)).project;
  const storyboard = await loadStoryboard(slug);
  if (!validation?.passed) {
    throw new Error('validation report 未通过，不能创建 assets-ready seal。');
  }
  if (!(quality?.ready ?? false)) {
    throw new Error('quality report 未通过，不能创建 assets-ready seal。');
  }
  const basis = await createAssetsReadyBasis({
    project,
    validation,
    quality,
    storyboard,
  });
  if (!basis.subtitleContract.passed) {
    const failed = basis.subtitleContract.checks
      .filter(({passed}) => !passed)
      .map(({id}) => id)
      .join(', ');
    throw new Error(`字幕交付契约未通过：${failed}。`);
  }
  const seal = {
    schemaVersion: 1,
    projectSlug: slug,
    generatedAt: new Date().toISOString(),
    fingerprint: hashCompositionValue(basis),
    basis,
  };
  const file = assetsReadySealFileFor(slug);
  await writeJson(file, seal);
  return {file, seal};
};

export const assertAssetsReadySealCurrent = async (slug) => {
  const file = assetsReadySealFileFor(slug);
  if (!(await fileExists(file))) {
    throw new Error(
      `缺少 ${path.relative(ROOT, file)}；必须运行 project:assets-ready，不能直接记录 assets-ready。`,
    );
  }
  const seal = await readJson(file);
  if (seal.schemaVersion !== 1 || seal.projectSlug !== slug) {
    throw new Error('assets-ready seal 格式或项目绑定无效，请重新运行 project:assets-ready。');
  }
  const {project, paths} = await loadProject(slug);
  const qualityFile = path.join(paths.projectDirectory, 'quality-report.json');
  const [validation, quality, storyboard] = await Promise.all([
    readJson(paths.validationReport),
    readJson(qualityFile),
    loadStoryboard(slug),
  ]);
  if (!validation.passed) {
    throw new Error('当前 validation report 未通过，请重新运行 project:assets-ready。');
  }
  const currentBasis = await createAssetsReadyBasis({
    project,
    validation,
    quality,
    storyboard,
  });
  if (!currentBasis.subtitleContract.passed) {
    throw new Error('当前字幕交付契约未通过，请重新运行 project:assets-ready 修复。');
  }
  const currentFingerprint = hashCompositionValue(currentBasis);
  if (currentFingerprint !== seal.fingerprint) {
    throw new Error(
      'assets-ready seal 已过期：项目、素材、音频、故事板、质量记录、字幕或 runtime 已变化；请重新运行 project:assets-ready。',
    );
  }
  return {file, seal, basis: currentBasis};
};
