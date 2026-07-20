import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {
  collectCompositionAssets,
  collectCompositionGroups,
  deriveCueEvents,
  flattenCompositionNodes,
  hashCompositionValue,
  pointInPolygon,
} from './composition-lib.mjs';
import {
  ROOT,
  deriveTimeline,
  fileExists,
  inspectCharacterPng,
  loadProject,
  readJson,
  resolvePublicFile,
  writeJson,
} from './project-lib.mjs';

export const ASSET_QUALITY_CHECKS = [
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

export const COMPOSITE_QUALITY_CHECKS = [
  'support-contact',
  'inside-or-on-readable',
  'front-occlusion',
  'shared-motion',
  'identity-continuity',
  'registration-aligned',
  'boundary-respected',
  'no-semantic-duplication',
  'depth-readable',
  'final-composition-readable',
  'visual-event-visible',
  'sound-event-bound',
  'proof-time-bound',
  'final-state-preserved',
];

export const QUALITY_CHECKS = [
  ...ASSET_QUALITY_CHECKS,
  ...COMPOSITE_QUALITY_CHECKS,
];

const QUALITY_PROFILES = {
  background: ['no-text', 'no-watermark', 'no-people', 'safe-area-clear', 'style-consistent'],
  environment: ['no-text', 'no-watermark', 'subject-complete', 'style-consistent'],
  character: ['subject-complete', 'identity-consistent', 'edge-clean', 'style-consistent'],
  prop: ['subject-complete', 'edge-clean', 'style-consistent'],
  decorative: ['no-watermark', 'subject-complete', 'style-consistent'],
  'character-sheet': ['no-text', 'no-watermark', 'subject-complete', 'identity-consistent', 'cell-separation', 'background-uniform', 'style-consistent'],
  'style-sample': ['no-text', 'no-watermark', 'subject-complete', 'style-consistent'],
  image: ['no-watermark', 'subject-complete', 'style-consistent'],
};

const COMPOSITE_PROFILES = {
  'supported-subject': ['support-contact', 'inside-or-on-readable', 'front-occlusion', 'shared-motion', 'identity-continuity'],
  'registered-environment': ['registration-aligned', 'boundary-respected', 'no-semantic-duplication', 'depth-readable', 'final-composition-readable'],
  cue: ['visual-event-visible', 'sound-event-bound', 'proof-time-bound', 'final-state-preserved'],
};

const qualityReportPath = (slug) => path.join(ROOT, 'projects', slug, 'quality-report.json');
export const compositionProofReportPath = (slug) => path.join(ROOT, 'dist', slug, 'composition-proof', 'report.json');

const hashFile = async (file) => createHash('sha256').update(await fs.readFile(file)).digest('hex');
const runtimeAssetId = (file) => `runtime-${createHash('sha256').update(file).digest('hex').slice(0, 12)}`;

const inferManifestKind = (record) => {
  if (record.request?.quality?.kind) return record.request.quality.kind;
  const normalized = record.file.toLowerCase();
  if (normalized.includes('/characters/source/') || record.request?.settings?.layout) return 'character-sheet';
  if (normalized.includes('/style/')) return 'style-sample';
  if (normalized.includes('/plates/')) return 'background';
  return 'image';
};

const assertWorkspaceFile = (file) => {
  const resolved = path.resolve(ROOT, file);
  if (resolved !== ROOT && !resolved.startsWith(`${ROOT}${path.sep}`)) throw new Error(`质量检查路径越过工作区：${file}`);
  return resolved;
};

const readManifest = async (project) => {
  const file = path.join(ROOT, 'projects', project.slug, 'assets-manifest.json');
  return (await fileExists(file)) ? readJson(file) : {schemaVersion: 3, projectSlug: project.slug, assets: []};
};

const collectQualityAssets = async (project, manifest) => {
  const byFile = new Map();
  const add = ({assetId, file, kind, source, requiredChecks}) => {
    const relativeFile = path.relative(ROOT, file);
    const existing = byFile.get(relativeFile);
    if (existing) {
      existing.sources = [...new Set([...existing.sources, source])];
      if (['background', 'environment', 'character', 'prop'].includes(kind)) existing.kind = kind;
      if (requiredChecks?.length) existing.requiredChecks = requiredChecks;
      if (assetId) existing.assetId = assetId;
      return;
    }
    byFile.set(relativeFile, {assetId: assetId || runtimeAssetId(relativeFile), file: relativeFile, kind, sources: [source], ...(requiredChecks?.length ? {requiredChecks} : {})});
  };

  for (const scene of project.scenes ?? []) {
    for (const {node} of collectCompositionAssets(scene.composition)) {
      add({file: resolvePublicFile(node.src), kind: node.assetRole, source: `scene:${scene.id}:node:${node.id}`});
    }
    for (const {node} of collectCompositionGroups(scene.composition)) {
      for (const boundary of node.boundaries ?? []) {
        for (const maskSrc of [boundary.upperMaskSrc, boundary.lowerMaskSrc].filter(Boolean)) {
          add({file: resolvePublicFile(maskSrc), kind: 'environment', source: `scene:${scene.id}:boundary:${boundary.id}`});
        }
      }
    }
  }

  for (const record of manifest.assets ?? []) {
    if (record.capability !== 'image') continue;
    add({assetId: record.assetId, file: assertWorkspaceFile(record.file), kind: inferManifestKind(record), source: `manifest:${record.assetId}`, requiredChecks: record.request?.quality?.requiredChecks});
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
  if (!(await fileExists(file))) return {passed: false, checks: [{id: 'file-exists', passed: false, actual: 'missing'}]};
  const stat = await fs.stat(file);
  const metadata = await sharp(file).metadata();
  const checks = [
    {id: 'file-exists', passed: stat.size > 0, actual: stat.size},
    {id: 'dimensions-readable', passed: Boolean(metadata.width && metadata.height), actual: `${metadata.width ?? 0}x${metadata.height ?? 0}`},
  ];
  if (asset.kind === 'background') {
    const scale = project.quality?.minimumAssetScale ?? 1;
    const minimumWidth = Math.round(project.video.width * scale);
    const minimumHeight = Math.round(project.video.height * scale);
    checks.push({id: 'minimum-resolution', passed: Number(metadata.width ?? 0) >= minimumWidth && Number(metadata.height ?? 0) >= minimumHeight, expected: `${minimumWidth}x${minimumHeight}`, actual: `${metadata.width ?? 0}x${metadata.height ?? 0}`});
  }
  if (['character', 'prop'].includes(asset.kind)) {
    const inspection = await inspectCharacterPng(file);
    checks.push(
      {id: 'alpha-present', passed: inspection.hasAlpha && inspection.transparentPixels > 0, actual: inspection.hasAlpha},
      {id: 'key-edge-clean', passed: inspection.keyEdgeRatio <= 0.12, expected: '<= 0.12', actual: inspection.keyEdgeRatio},
    );
  }
  return {passed: checks.every(({passed}) => passed), checks};
};

const descendants = (group) => flattenCompositionNodes(group.children ?? []).map(({node}) => node);

const hashReferencedFiles = async (sources) => {
  const hashes = {};
  for (const source of [...new Set(sources.filter(Boolean))].sort()) {
    const file = resolvePublicFile(source);
    hashes[source] = (await fileExists(file)) ? await hashFile(file) : null;
  }
  return hashes;
};

const findNode = (scene, id) => flattenCompositionNodes(scene.composition?.nodes).find(({node}) => node.id === id)?.node ?? null;

export const collectCompositeQualityTargets = async (project, {manifest = null} = {}) => {
  const assetManifest = manifest ?? await readManifest(project);
  const recordsByFile = new Map((assetManifest.assets ?? []).map((record) => [path.normalize(record.file), record]));
  const targets = [];
  for (const scene of project.scenes ?? []) {
    for (const {node: group} of collectCompositionGroups(scene.composition)) {
      if (!['supported-subject', 'registered-environment'].includes(group.pattern)) continue;
      const members = descendants(group).filter((node) => node.kind === 'asset');
      const sources = [
        ...members.map(({src}) => src),
        ...(group.boundaries ?? []).flatMap(({upperMaskSrc, lowerMaskSrc}) => [upperMaskSrc, lowerMaskSrc]),
      ];
      const memberHashes = await hashReferencedFiles(sources);
      const familyRecords = members.map((member) => recordsByFile.get(path.normalize(path.relative(ROOT, resolvePublicFile(member.src)))) ?? null);
      const familyProvenance = familyRecords.map((record) => record ? {
        assetId: record.assetId,
        compositionBinding: record.compositionBinding ?? record.request?.compositionBinding ?? null,
        familyFingerprint: record.familyFingerprint ?? null,
      } : null);
      const fingerprint = hashCompositionValue({
        sceneId: scene.id,
        group,
        proofTimes: scene.motion?.proofTimes ?? [],
        timing: {narration: scene.narration, tailSeconds: scene.tailSeconds, transition: scene.transition},
        camera: scene.camera,
        affectingCues: (scene.cues ?? []).filter(({targetId}) => targetId === 'scene' || targetId === group.id),
        memberHashes,
        familyProvenance,
      });
      targets.push({
        compositeId: `group:${scene.id}:${group.id}`,
        sceneId: scene.id,
        pattern: group.pattern,
        nodeId: group.id,
        memberNodeIds: members.map(({id}) => id),
        memberHashes,
        compositionHash: hashCompositionValue(group),
        fingerprint,
        proofTimeIds: (scene.motion?.proofTimes ?? []).map(({id}) => id),
        requiredChecks: COMPOSITE_PROFILES[group.pattern],
        group,
        familyRecords,
      });
    }
    for (const cue of scene.cues ?? []) {
      if (!cue.proofTimeId && !cue.sound) continue;
      const targetNode = cue.targetId === 'scene' ? null : findNode(scene, cue.targetId);
      const targetSources = targetNode ? descendants(targetNode.kind === 'group' ? targetNode : {children: [targetNode]}).filter((node) => node.kind === 'asset').map(({src}) => src) : collectCompositionAssets(scene.composition).map(({node}) => node.src);
      const memberHashes = await hashReferencedFiles(targetSources);
      const proof = (scene.motion?.proofTimes ?? []).find(({id}) => id === cue.proofTimeId) ?? null;
      const fingerprint = hashCompositionValue({sceneId: scene.id, cue, proof, targetNode, timing: {narration: scene.narration, tailSeconds: scene.tailSeconds, transition: scene.transition}, camera: scene.camera, memberHashes});
      targets.push({
        compositeId: `cue:${scene.id}:${cue.id}`,
        sceneId: scene.id,
        pattern: 'cue',
        nodeId: cue.targetId,
        memberNodeIds: targetNode ? [targetNode.id] : [],
        memberHashes,
        compositionHash: hashCompositionValue({cue, proof, targetNode}),
        fingerprint,
        proofTimeIds: cue.proofTimeId ? [cue.proofTimeId] : [],
        requiredChecks: COMPOSITE_PROFILES.cue,
        cue,
      });
    }
  }
  return targets;
};

const alphaCoverageInPolygon = async (source, polygon) => {
  const file = resolvePublicFile(source);
  if (!(await fileExists(file)) || !Array.isArray(polygon) || polygon.length < 3) return 0;
  const {data, info} = await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject: true});
  let sampled = 0;
  let visible = 0;
  for (let y = 0; y < info.height; y += 2) {
    for (let x = 0; x < info.width; x += 2) {
      if (!pointInPolygon([(x + 0.5) / info.width, (y + 0.5) / info.height], polygon)) continue;
      sampled += 1;
      if (data[(y * info.width + x) * info.channels + 3] > 16) visible += 1;
    }
  }
  return sampled === 0 ? 0 : visible / sampled;
};

const inspectCompositeTechnical = async ({target, proofReport}) => {
  const proofEntry = proofReport?.composites?.find(({compositeId}) => compositeId === target.compositeId);
  const proofFrames = proofEntry?.proofFrames ?? [];
  const artifactsPresent = proofFrames.length > 0 && (await Promise.all(
    proofFrames.flatMap(({fullFrame, crop}) => [fullFrame, crop]).map(async (file) => {
      if (!file) return false;
      try {
        return await fileExists(assertWorkspaceFile(file));
      } catch {
        return false;
      }
    }),
  )).every(Boolean);
  const checks = [
    {id: 'proof-current', passed: proofEntry?.fingerprint === target.fingerprint, expected: target.fingerprint, actual: proofEntry?.fingerprint ?? null},
    {id: 'proof-artifacts-present', passed: artifactsPresent, actual: proofFrames.length},
  ];
  if (target.pattern === 'supported-subject') {
    const front = target.group.children.find(({kind, slot}) => kind === 'asset' && slot === 'support-front');
    const alphaCoverage = front ? await alphaCoverageInPolygon(front.src, target.group.support?.occlusionZone) : 0;
    const registration = target.group.registration;
    const familyBound = target.familyRecords.every((record) => {
      const binding = record?.compositionBinding ?? record?.request?.compositionBinding;
      return binding?.registrationId === registration?.id && binding?.sourceMasterAssetId === registration?.sourceMasterAssetId;
    });
    checks.push(
      {id: 'front-alpha-in-occlusion-zone', passed: alphaCoverage > 0.002, expected: '> 0.002', actual: alphaCoverage},
      {id: 'registered-source-family', passed: familyBound, actual: familyBound},
    );
  }
  if (target.pattern === 'registered-environment') {
    const children = target.group.children.filter(({kind}) => kind === 'asset');
    const boundariesCovered = (target.group.boundaries ?? []).every((boundary) => ['upper', 'lower'].every((side) => children.some((child) => child.clip?.boundaryId === boundary.id && child.clip.side === side)));
    const registration = target.group.registration;
    const familyBound = target.familyRecords.every((record) => {
      const binding = record?.compositionBinding ?? record?.request?.compositionBinding;
      return binding?.registrationId === registration?.id && binding?.sourceMasterAssetId === registration?.sourceMasterAssetId;
    });
    checks.push(
      {id: 'boundary-clips-present', passed: boundariesCovered, actual: boundariesCovered},
      {id: 'registered-source-family', passed: familyBound, actual: familyBound},
    );
  }
  if (target.pattern === 'cue') {
    checks.push(
      {id: 'cue-proof-bound', passed: Boolean(target.cue.proofTimeId), actual: target.cue.proofTimeId ?? null},
      {id: 'cue-sound-valid', passed: !target.cue.sound || Boolean(target.cue.sound.src), actual: target.cue.sound?.src ?? 'not-required'},
    );
  }
  return {passed: checks.every(({passed}) => passed), checks, proofFrames};
};

const entryStatus = ({technical, semanticChecks}) => {
  const values = Object.values(semanticChecks);
  if (!technical.passed || values.includes('failed')) return 'needs-revision';
  return values.every((status) => status === 'passed') ? 'passed' : 'pending';
};

const summarizeEntries = (entries) => {
  const failed = entries.filter(({status}) => status === 'needs-revision');
  const pending = entries.filter(({status}) => status === 'pending');
  return {total: entries.length, passed: entries.length - failed.length - pending.length, pending: pending.length, failed: failed.length};
};

export const summarizeQualityReport = (report) => {
  const assets = summarizeEntries(report.assets ?? []);
  const composites = summarizeEntries(report.composites ?? []);
  const total = {total: assets.total + composites.total, passed: assets.passed + composites.passed, pending: assets.pending + composites.pending, failed: assets.failed + composites.failed};
  return {ready: total.pending === 0 && total.failed === 0, actualPassed: total.pending === 0 && total.failed === 0, ...total, scopes: {assets, composites}, report};
};

const preservedReview = ({previous, fingerprint, requiredChecks}) => {
  const preserve = previous?.fingerprint === fingerprint || previous?.sha256 === fingerprint;
  return {
    semanticChecks: Object.fromEntries(requiredChecks.map((check) => [check, preserve ? previous.semanticChecks?.[check] ?? 'pending' : 'pending'])),
    reviewer: preserve ? previous.reviewer ?? null : null,
    reviewedAt: preserve ? previous.reviewedAt ?? null : null,
    note: preserve ? previous.note ?? '' : '',
  };
};

export const prepareQualityReport = async (slug, {write = true} = {}) => {
  const {project} = await loadProject(slug);
  const file = qualityReportPath(slug);
  const existing = (await fileExists(file)) ? await readJson(file) : null;
  const manifest = await readManifest(project);
  const previousAssets = new Map((existing?.assets ?? []).map((entry) => [entry.assetId, entry]));
  const previousComposites = new Map((existing?.composites ?? []).map((entry) => [entry.compositeId, entry]));
  const assets = await collectQualityAssets(project, manifest);
  const inspectedAssets = await Promise.all(assets.map(async (asset) => {
    const absoluteFile = assertWorkspaceFile(asset.file);
    const sha256 = (await fileExists(absoluteFile)) ? await hashFile(absoluteFile) : null;
    const requiredChecks = [...new Set(asset.requiredChecks?.length ? asset.requiredChecks : QUALITY_PROFILES[asset.kind] ?? QUALITY_PROFILES.image)];
    const unknownChecks = requiredChecks.filter((check) => !ASSET_QUALITY_CHECKS.includes(check));
    if (unknownChecks.length) throw new Error(`${asset.assetId} 含未知资产质量检查：${unknownChecks.join(', ')}`);
    const review = preservedReview({previous: previousAssets.get(asset.assetId), fingerprint: sha256, requiredChecks});
    const technical = await inspectTechnicalQuality({asset, project});
    return {...asset, sha256, requiredChecks, technical, ...review, status: entryStatus({technical, semanticChecks: review.semanticChecks})};
  }));

  const proofFile = compositionProofReportPath(slug);
  const proofReport = (await fileExists(proofFile)) ? await readJson(proofFile) : null;
  const targets = await collectCompositeQualityTargets(project, {manifest});
  const inspectedComposites = await Promise.all(targets.map(async (target) => {
    const review = preservedReview({previous: previousComposites.get(target.compositeId), fingerprint: target.fingerprint, requiredChecks: target.requiredChecks});
    const technical = await inspectCompositeTechnical({target, proofReport});
    return {
      compositeId: target.compositeId,
      sceneId: target.sceneId,
      pattern: target.pattern,
      nodeId: target.nodeId,
      memberNodeIds: target.memberNodeIds,
      memberHashes: target.memberHashes,
      compositionHash: target.compositionHash,
      fingerprint: target.fingerprint,
      proofTimeIds: target.proofTimeIds,
      proofFrames: technical.proofFrames,
      requiredChecks: target.requiredChecks,
      technical: {passed: technical.passed, checks: technical.checks},
      ...review,
      status: entryStatus({technical, semanticChecks: review.semanticChecks}),
    };
  }));
  const timeline = deriveTimeline(project);
  const report = {
    $schema: '../../schemas/quality-report.schema.json',
    schemaVersion: 2,
    projectSlug: slug,
    updatedAt: new Date().toISOString(),
    cueEvents: timeline.scenes.flatMap((scene) => deriveCueEvents({scene, sceneFrom: scene.from, fps: project.video.fps})),
    assets: inspectedAssets,
    composites: inspectedComposites,
  };
  if (write) await writeJson(file, report);
  return {file, ...summarizeQualityReport(report)};
};

export const recordQualityReviews = async ({slug, reviews}) => {
  if (!Array.isArray(reviews) || reviews.length === 0) throw new Error('批量质量记录必须包含至少一项 review。');
  const prepared = await prepareQualityReport(slug, {write: false});
  const entries = [...prepared.report.assets, ...prepared.report.composites];
  const normalized = [];
  const reviewedIds = new Set();
  for (const review of reviews) {
    const reviewId = review.assetId ?? review.compositeId;
    const entry = entries.find((candidate) => (candidate.assetId ?? candidate.compositeId) === reviewId);
    if (!entry) throw new Error(`未知质量对象：${reviewId}`);
    if (reviewedIds.has(reviewId)) throw new Error(`批量质量记录不能重复包含对象：${reviewId}`);
    reviewedIds.add(reviewId);
    if (!review.reviewer?.trim()) throw new Error(`${reviewId} 的质量记录必须提供 reviewer。`);
    const passedChecks = review.passedChecks ?? [];
    const failedChecks = review.failedChecks ?? [];
    for (const check of [...passedChecks, ...failedChecks]) {
      if (!QUALITY_CHECKS.includes(check)) throw new Error(`未知质量检查：${check}`);
      if (!entry.requiredChecks.includes(check)) throw new Error(`${reviewId} 不需要质量检查 ${check}。`);
    }
    normalized.push({entry, reviewId, reviewer: review.reviewer.trim(), passedChecks, failedChecks, note: (review.note ?? '').trim()});
  }
  const changedIds = [];
  for (const item of normalized) {
    for (const check of item.passedChecks) item.entry.semanticChecks[check] = 'passed';
    for (const check of item.failedChecks) item.entry.semanticChecks[check] = 'failed';
    item.entry.status = entryStatus(item.entry);
    item.entry.reviewer = item.reviewer;
    item.entry.reviewedAt = new Date().toISOString();
    item.entry.note = item.note;
    changedIds.push(item.reviewId);
  }
  prepared.report.updatedAt = new Date().toISOString();
  await writeJson(prepared.file, prepared.report);
  return {file: prepared.file, changedIds, changedAssets: changedIds.filter((id) => prepared.report.assets.some(({assetId}) => assetId === id)), changedComposites: changedIds.filter((id) => prepared.report.composites.some(({compositeId}) => compositeId === id)), ...summarizeQualityReport(prepared.report)};
};

export const recordQualityReview = async (review) => recordQualityReviews({slug: review.slug, reviews: [review]});

export const assertQualityReady = async (slug) => {
  const status = await prepareQualityReport(slug);
  if (!status.ready) {
    const unresolved = [...status.report.assets, ...status.report.composites]
      .filter(({status: entryStatusValue}) => entryStatusValue !== 'passed')
      .map((entry) => `${entry.assetId ?? entry.compositeId} (${entry.status})`)
      .join(', ');
    throw new Error(`资产与组合质量门未通过：${unresolved}。运行 project:quality 查看或记录检查。`);
  }
  return status;
};

export const readQualityReportStatus = async (slug) => {
  const file = qualityReportPath(slug);
  const report = await readJson(file);
  return {file, ...summarizeQualityReport(report)};
};

export const formatQualityStatus = (status) => `${status.ready ? '✓' : '✗'} quality: ${status.passed}/${status.total} passed, ${status.pending} pending, ${status.failed} failed (assets ${status.scopes.assets.passed}/${status.scopes.assets.total}, composites ${status.scopes.composites.passed}/${status.scopes.composites.total})`;
