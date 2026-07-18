import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {
  ROOT,
  fileExists,
  inspectCharacterPng,
  loadProject,
  readJson,
  resolvePublicFile,
  writeJson,
} from './project-lib.mjs';

export const QUALITY_CHECKS = [
  'no-text',
  'no-watermark',
  'no-people',
  'safe-area-clear',
  'style-consistent',
  'subject-complete',
  'identity-consistent',
  'cell-separation',
  'background-uniform',
  'edge-clean',
];

const QUALITY_PROFILES = {
  background: [
    'no-text',
    'no-watermark',
    'no-people',
    'safe-area-clear',
    'style-consistent',
  ],
  environment: [
    'no-text',
    'no-watermark',
    'subject-complete',
    'style-consistent',
  ],
  character: [
    'subject-complete',
    'identity-consistent',
    'edge-clean',
    'style-consistent',
  ],
  'character-sheet': [
    'no-text',
    'no-watermark',
    'subject-complete',
    'identity-consistent',
    'cell-separation',
    'background-uniform',
    'style-consistent',
  ],
  'style-sample': [
    'no-text',
    'no-watermark',
    'subject-complete',
    'style-consistent',
  ],
  image: ['no-watermark', 'subject-complete', 'style-consistent'],
};

const qualityReportPath = (slug) =>
  path.join(ROOT, 'projects', slug, 'quality-report.json');

const hashFile = async (file) =>
  createHash('sha256').update(await fs.readFile(file)).digest('hex');

const runtimeAssetId = (file) =>
  `runtime-${createHash('sha256').update(file).digest('hex').slice(0, 12)}`;

const inferManifestKind = (record) => {
  if (record.request?.quality?.kind) return record.request.quality.kind;
  const normalized = record.file.toLowerCase();
  if (normalized.includes('/characters/source/') || record.request?.settings?.layout) {
    return 'character-sheet';
  }
  if (normalized.includes('/style/')) return 'style-sample';
  if (normalized.includes('/plates/')) return 'background';
  return 'image';
};

const assertWorkspaceFile = (file) => {
  const resolved = path.resolve(ROOT, file);
  if (resolved !== ROOT && !resolved.startsWith(`${ROOT}${path.sep}`)) {
    throw new Error(`质量检查路径越过工作区：${file}`);
  }
  return resolved;
};

const collectQualityAssets = async (project) => {
  const byFile = new Map();
  const add = ({assetId, file, kind, source, requiredChecks}) => {
    const relativeFile = path.relative(ROOT, file);
    const existing = byFile.get(relativeFile);
    if (existing) {
      existing.sources = [...new Set([...existing.sources, source])];
      if (kind === 'background' || kind === 'character') existing.kind = kind;
      if (requiredChecks?.length) existing.requiredChecks = requiredChecks;
      return;
    }
    byFile.set(relativeFile, {
      assetId: assetId || runtimeAssetId(relativeFile),
      file: relativeFile,
      kind,
      sources: [source],
      ...(requiredChecks?.length ? {requiredChecks} : {}),
    });
  };

  for (const scene of project.scenes ?? []) {
    add({
      file: resolvePublicFile(scene.background),
      kind: 'background',
      source: `scene:${scene.id}:background`,
    });
    for (const environment of scene.environmentLayers ?? []) {
      add({
        file: resolvePublicFile(environment.src),
        kind: 'environment',
        source: `scene:${scene.id}:environment:${environment.id}`,
      });
    }
    for (const layer of scene.layers ?? []) {
      add({
        file: resolvePublicFile(layer.src),
        kind: 'character',
        source: `scene:${scene.id}:layer:${layer.id}`,
      });
    }
  }

  const manifestFile = path.join(ROOT, 'projects', project.slug, 'assets-manifest.json');
  if (await fileExists(manifestFile)) {
    const manifest = await readJson(manifestFile);
    for (const record of manifest.assets ?? []) {
      if (record.capability !== 'image') continue;
      const file = assertWorkspaceFile(record.file);
      const relativeFile = path.relative(ROOT, file);
      const existing = byFile.get(relativeFile);
      if (existing) {
        existing.assetId = record.assetId;
        existing.sources = [...new Set([...existing.sources, `manifest:${record.assetId}`])];
      } else {
        add({
          assetId: record.assetId,
          file,
          kind: inferManifestKind(record),
          source: `manifest:${record.assetId}`,
          requiredChecks: record.request?.quality?.requiredChecks,
        });
      }
      if (existing && record.request?.quality?.requiredChecks?.length) {
        existing.requiredChecks = record.request.quality.requiredChecks;
      }
    }
  }

  const usedIds = new Set();
  return [...byFile.values()].map((asset) => {
    let assetId = asset.assetId;
    if (usedIds.has(assetId)) assetId = `${assetId}-${runtimeAssetId(asset.file).slice(-6)}`;
    usedIds.add(assetId);
    return {...asset, assetId};
  });
};

const inspectTechnicalQuality = async ({asset, project}) => {
  const file = assertWorkspaceFile(asset.file);
  if (!(await fileExists(file))) {
    return {
      passed: false,
      checks: [{id: 'file-exists', passed: false, actual: 'missing'}],
    };
  }

  const stat = await fs.stat(file);
  const metadata = await sharp(file).metadata();
  const checks = [
    {id: 'file-exists', passed: stat.size > 0, actual: stat.size},
    {
      id: 'dimensions-readable',
      passed: Boolean(metadata.width && metadata.height),
      actual: `${metadata.width ?? 0}x${metadata.height ?? 0}`,
    },
  ];

  if (asset.kind === 'background') {
    const scale = project.quality?.minimumAssetScale ?? 1;
    const minimumWidth = Math.round(project.video.width * scale);
    const minimumHeight = Math.round(project.video.height * scale);
    checks.push({
      id: 'minimum-resolution',
      passed:
        Number(metadata.width ?? 0) >= minimumWidth &&
        Number(metadata.height ?? 0) >= minimumHeight,
      expected: `${minimumWidth}x${minimumHeight}`,
      actual: `${metadata.width ?? 0}x${metadata.height ?? 0}`,
    });
  }

  if (asset.kind === 'character') {
    const inspection = await inspectCharacterPng(file);
    checks.push(
      {
        id: 'alpha-present',
        passed: inspection.hasAlpha && inspection.transparentPixels > 0,
        actual: inspection.hasAlpha,
      },
      {
        id: 'key-edge-clean',
        passed: inspection.keyEdgeRatio <= 0.12,
        expected: '<= 0.12',
        actual: inspection.keyEdgeRatio,
      },
    );
  }

  return {passed: checks.every(({passed}) => passed), checks};
};

const summarizeReport = (report, mode) => {
  const failed = report.assets.filter(({status}) => status === 'needs-revision');
  const pending = report.assets.filter(({status}) => status === 'pending');
  const actualPassed = failed.length === 0 && pending.length === 0;
  return {
    mode,
    ready: mode !== 'required' || actualPassed,
    actualPassed,
    total: report.assets.length,
    passed: report.assets.length - failed.length - pending.length,
    pending: pending.length,
    failed: failed.length,
    report,
  };
};

export const prepareQualityReport = async (slug, {write = true} = {}) => {
  const {project} = await loadProject(slug);
  const file = qualityReportPath(slug);
  const existing = (await fileExists(file)) ? await readJson(file) : null;
  const previousById = new Map(
    (existing?.assets ?? []).map((asset) => [asset.assetId, asset]),
  );
  const assets = await collectQualityAssets(project);
  const inspected = await Promise.all(
    assets.map(async (asset) => {
      const absoluteFile = assertWorkspaceFile(asset.file);
      const sha256 = (await fileExists(absoluteFile)) ? await hashFile(absoluteFile) : null;
      const previous = previousById.get(asset.assetId);
      const preserve = previous?.sha256 === sha256;
      const requiredChecks = asset.requiredChecks?.length
        ? [...new Set(asset.requiredChecks)]
        : QUALITY_PROFILES[asset.kind] ?? QUALITY_PROFILES.image;
      const unknownChecks = requiredChecks.filter(
        (check) => !QUALITY_CHECKS.includes(check),
      );
      if (unknownChecks.length) {
        throw new Error(
          `${asset.assetId} 含未知质量检查：${unknownChecks.join(', ')}`,
        );
      }
      const semanticChecks = Object.fromEntries(
        requiredChecks.map((check) => [
          check,
          preserve ? previous.semanticChecks?.[check] ?? 'pending' : 'pending',
        ]),
      );
      const technical = await inspectTechnicalQuality({asset, project});
      const semanticFailed = Object.values(semanticChecks).includes('failed');
      const semanticPassed = Object.values(semanticChecks).every(
        (status) => status === 'passed',
      );
      return {
        ...asset,
        sha256,
        requiredChecks,
        technical,
        semanticChecks,
        status:
          !technical.passed || semanticFailed
            ? 'needs-revision'
            : semanticPassed
              ? 'passed'
              : 'pending',
        reviewer: preserve ? previous.reviewer ?? null : null,
        reviewedAt: preserve ? previous.reviewedAt ?? null : null,
        note: preserve ? previous.note ?? '' : '',
      };
    }),
  );
  const report = {
    $schema: '../../schemas/quality-report.schema.json',
    schemaVersion: 1,
    projectSlug: slug,
    updatedAt: new Date().toISOString(),
    assets: inspected,
  };
  if (write) await writeJson(file, report);
  return {file, ...summarizeReport(report, project.quality?.mode ?? 'advisory')};
};

export const recordQualityReview = async ({
  slug,
  assetId,
  reviewer,
  passedChecks = [],
  failedChecks = [],
  note = '',
}) => {
  const prepared = await prepareQualityReport(slug);
  const asset = prepared.report.assets.find((entry) => entry.assetId === assetId);
  if (!asset) throw new Error(`未知质量资产：${assetId}`);
  if (!reviewer?.trim()) throw new Error('质量记录必须提供 --reviewer。');
  for (const check of [...passedChecks, ...failedChecks]) {
    if (!QUALITY_CHECKS.includes(check)) throw new Error(`未知质量检查：${check}`);
    if (!asset.requiredChecks.includes(check)) {
      throw new Error(`${assetId} 不需要质量检查 ${check}。`);
    }
  }
  for (const check of passedChecks) asset.semanticChecks[check] = 'passed';
  for (const check of failedChecks) asset.semanticChecks[check] = 'failed';
  const semanticFailed = Object.values(asset.semanticChecks).includes('failed');
  const semanticPassed = Object.values(asset.semanticChecks).every(
    (status) => status === 'passed',
  );
  asset.status =
    !asset.technical.passed || semanticFailed
      ? 'needs-revision'
      : semanticPassed
        ? 'passed'
        : 'pending';
  asset.reviewer = reviewer.trim();
  asset.reviewedAt = new Date().toISOString();
  asset.note = note.trim();
  prepared.report.updatedAt = new Date().toISOString();
  await writeJson(prepared.file, prepared.report);
  const {project} = await loadProject(slug);
  return {file: prepared.file, ...summarizeReport(prepared.report, project.quality?.mode ?? 'advisory')};
};

export const assertQualityReady = async (slug) => {
  const status = await prepareQualityReport(slug);
  if (!status.ready) {
    const unresolved = status.report.assets
      .filter(({status: assetStatus}) => assetStatus !== 'passed')
      .map(({assetId, status: assetStatus}) => `${assetId} (${assetStatus})`)
      .join(', ');
    throw new Error(`资产质量门未通过：${unresolved}。运行 project:quality 查看或记录检查。`);
  }
  return status;
};

export const formatQualityStatus = (status) =>
  `${status.ready ? '✓' : '✗'} quality (${status.mode}): ${status.passed}/${status.total} passed, ${status.pending} pending, ${status.failed} failed`;
