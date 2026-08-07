import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {
  collectCompositionAssets,
  collectRuntimeVisibleCompositionSources,
  collectCompositionGroups,
  collectMotifFields,
  collectStateSequences,
  collectWorldStrips,
  deriveEventTimeline,
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
import {
  loadSemanticContracts,
  requiredChecksForSemanticBinding,
  validateSemanticEvidenceTargets,
} from './semantic-contract-lib.mjs';
import {createRuntimeSurfaceFingerprint} from './runtime-build-lib.mjs';
import {
  activeManifestAssets,
  assertAssetManifest,
} from './asset-manifest-lib.mjs';
import {
  MAX_MOTIF_INSTANCES_PER_FIELD,
  resolveMotifFieldInstances,
  verifyMotifFieldLoop,
} from '../src/motifField.mjs';
import {
  fitEditorialTypography,
  resolveAnnotationRoute,
  validateDataGraphicNode,
} from '../src/editorialPrimitives.mjs';
import {
  derivationRegionsFromBinding,
  inspectAlphaBands,
  inspectAlphaTopology,
} from './alpha-band-lib.mjs';
import {
  assertRegisteredFamilyGroupMembers,
} from './registered-family-lib.mjs';
import {
  DEFAULT_REGISTERED_GEOMETRY_LIMITS,
  assertRegisteredGeometryCurrent,
  computeRegisteredGeometryProof,
} from './registered-geometry-lib.mjs';
import {
  inspectCanonicalContainerGroupMembers,
} from './canonical-container-lib.mjs';
import {inspectStateAnchorRegistration} from './state-sheet-lib.mjs';
import {inspectSemanticSliceOutput} from './semantic-slices-lib.mjs';

export const ASSET_QUALITY_CHECKS = [
  'no-text',
  'no-watermark',
  'no-people',
  'safe-area-clear',
  'style-consistent',
  'style-profile-conformant',
  'subject-complete',
  'identity-consistent',
  'identity-distinct-within-frame',
  'identity-family-consistent',
  'cross-scene-identity-continuity',
  'cell-separation',
  'untargeted-cells-unchanged',
  'background-uniform',
  'edge-clean',
  'silhouette-fidelity',
  'negative-space-clean',
  'background-leak-free',
  'mechanism-complete',
  'load-path-readable',
  'physical-plausibility',
  'reference-conformant',
  'diagram-edge-clean',
  'small-text-legible',
  'no-procedural-noise-on-semantic-lines',
  'clean-plate-clear',
  'canonical-frame-only',
  'container-content-only',
  'container-state-separation',
  'container-fill-progression',
];

export const COMPOSITE_QUALITY_CHECKS = [
  'style-profile-consistent',
  'motion-grammar-consistent',
  'pacing-cadence-consistent',
  'camera-strategy-consistent',
  'transition-strategy-consistent',
  'ambient-strategy-consistent',
  'sync-anchors-current',
  'support-contact',
  'inside-or-on-readable',
  'front-occlusion',
  'subject-front-clear',
  'shared-motion',
  'identity-continuity',
  'motion-isolation-clean',
  'registration-aligned',
  'boundary-respected',
  'no-semantic-duplication',
  'depth-readable',
  'final-composition-readable',
  'visual-event-visible',
  'sound-event-bound',
  'proof-time-bound',
  'final-state-preserved',
  'state-order-correct',
  'pose-registration-stable',
  'state-anchor-stable',
  'state-facing-correct',
  'state-identity-consistent',
  'identity-reference-current',
  'transition-clean',
  'depth-order-readable',
  'camera-coupling-clean',
  'registered-groups-stable',
  'layer-completeness-proven',
  'neutral-reconstruction-readable',
  'exploded-view-readable',
  'responsive-motion-stress-clean',
  'field-density-readable',
  'field-bounds-clean',
  'field-exclusions-clean',
  'field-motion-clean',
  'field-loop-clean',
  'typography-fit-clean',
  'typography-timing-bound',
  'visual-sfx-audio-sync',
  'visual-sfx-subtitle-clear',
  'visual-sfx-subject-clear',
  'visual-sfx-density-controlled',
  'visual-sfx-style-consistent',
  'annotation-routing-clean',
  'annotation-exclusions-clean',
  'data-mapping-valid',
  'data-reveal-bound',
  'editorial-transition-continuity',
  'responsive-directing-bounded',
  'strip-seams-clean',
  'coverage-gap-free',
  'depth-speed-readable',
  'world-motion-resolvable',
  'world-lock-clean',
  'repetition-cadence-clean',
  'tracked-subject-readable',
  'world-surfaces-readable',
  'world-anchors-correct',
  'multi-subject-occlusion-correct',
  'signed-world-direction-correct',
  'contact-anchor-current',
  'support-surface-contact',
  'spatial-paint-order-correct',
  'relative-contact-stable',
  'subtitle-clearance',
  'causal-continuity',
  'gait-cadence-clean',
  'signed-travel-direction-correct',
  'travel-facing-readable',
  'travel-monotonic-clean',
  'path-travel-clean',
  'path-heading-readable',
  'turn-continuity-clean',
  'depth-projection-readable',
  'depth-order-clean',
  'camera-follow-coverage-clean',
  'locomotion-cycle-bound',
  'canonical-frame-unique',
  'clean-plate-clear',
  'interior-state-aligned',
  'no-interior-overflow',
  'bottom-load-retained',
  'fill-state-measurable',
  'terminal-fill-readable',
  'authoritative-surface-unique',
];

const compositionAppearance = (appearance) => {
  if (!appearance) return appearance;
  const {subtitles: _subtitles, ...rest} = appearance;
  return rest;
};

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
  mechanism: ['no-watermark', 'subject-complete', 'edge-clean', 'mechanism-complete', 'load-path-readable', 'physical-plausibility', 'reference-conformant', 'style-consistent'],
  diagram: ['subject-complete', 'diagram-edge-clean', 'small-text-legible', 'no-procedural-noise-on-semantic-lines', 'style-consistent'],
  image: ['no-watermark', 'subject-complete', 'style-consistent'],
};

const COMPOSITE_PROFILES = {
  'supported-subject': ['support-contact', 'inside-or-on-readable', 'front-occlusion', 'shared-motion', 'identity-continuity', 'motion-isolation-clean'],
  'registered-environment': ['registration-aligned', 'boundary-respected', 'no-semantic-duplication', 'depth-readable', 'final-composition-readable'],
  'registered-depth-stack': ['registration-aligned', 'layer-completeness-proven', 'depth-order-readable', 'neutral-reconstruction-readable', 'exploded-view-readable', 'responsive-motion-stress-clean', 'final-composition-readable'],
  'canonical-container': [
    'canonical-frame-unique',
    'clean-plate-clear',
    'interior-state-aligned',
    'no-interior-overflow',
    'bottom-load-retained',
    'fill-state-measurable',
    'terminal-fill-readable',
    'authoritative-surface-unique',
    'final-composition-readable',
  ],
  event: ['visual-event-visible', 'sound-event-bound', 'proof-time-bound', 'final-state-preserved'],
  'state-sequence': [
    'state-order-correct',
    'pose-registration-stable',
    'state-anchor-stable',
    'state-facing-correct',
    'state-identity-consistent',
    'identity-reference-current',
    'transition-clean',
    'proof-time-bound',
  ],
  'parallax-rig': ['depth-order-readable', 'camera-coupling-clean', 'registered-groups-stable', 'final-composition-readable'],
  'motif-field': ['field-density-readable', 'field-bounds-clean', 'field-exclusions-clean', 'field-motion-clean', 'field-loop-clean', 'final-composition-readable'],
  'looping-environment': ['strip-seams-clean', 'coverage-gap-free', 'depth-speed-readable', 'world-motion-resolvable', 'repetition-cadence-clean', 'tracked-subject-readable', 'world-surfaces-readable', 'world-anchors-correct', 'multi-subject-occlusion-correct', 'signed-world-direction-correct', 'final-composition-readable'],
  typography: ['typography-fit-clean', 'typography-timing-bound', 'final-composition-readable'],
  annotation: ['annotation-routing-clean', 'annotation-exclusions-clean', 'proof-time-bound'],
  'data-graphic': ['data-mapping-valid', 'data-reveal-bound', 'proof-time-bound'],
  'editorial-transition': ['editorial-transition-continuity', 'proof-time-bound'],
  'responsive-directing': ['responsive-directing-bounded', 'final-composition-readable'],
  'spatial-grounding': [
    'contact-anchor-current',
    'support-surface-contact',
    'final-composition-readable',
  ],
  'spatial-continuity': [
    'causal-continuity',
    'final-composition-readable',
  ],
  'spatial-gait': ['gait-cadence-clean', 'final-composition-readable'],
  'spatial-travel-facing': [
    'signed-travel-direction-correct',
    'travel-facing-readable',
    'travel-monotonic-clean',
    'final-composition-readable',
  ],
  'spatial-path-locomotion': [
    'path-travel-clean',
    'path-heading-readable',
    'turn-continuity-clean',
    'depth-projection-readable',
    'depth-order-clean',
    'camera-follow-coverage-clean',
    'locomotion-cycle-bound',
    'final-composition-readable',
  ],
};

const requiredChecksForSpatialContract = (contract) => {
  if (contract.kind === 'continuity') {
    return COMPOSITE_PROFILES['spatial-continuity'];
  }
  if (contract.kind === 'gait') {
    return COMPOSITE_PROFILES['spatial-gait'];
  }
  if (contract.kind === 'travel-facing') {
    return COMPOSITE_PROFILES['spatial-travel-facing'];
  }
  if (contract.kind === 'path-locomotion') {
    return COMPOSITE_PROFILES['spatial-path-locomotion'];
  }
  return [
    ...COMPOSITE_PROFILES['spatial-grounding'],
    ...(contract.frontOcclusion ? ['spatial-paint-order-correct'] : []),
    ...(contract.mode === 'locked-contact' ? ['relative-contact-stable'] : []),
    ...(contract.subtitleClearance ? ['subtitle-clearance'] : []),
  ];
};

const requiredChecksForGroup = (group) => {
  if (group.pattern === 'looping-environment' && group.loopingEnvironment?.travel?.frozen === true) {
    return [
      'strip-seams-clean',
      'coverage-gap-free',
      'depth-speed-readable',
      'world-lock-clean',
      'tracked-subject-readable',
      'world-surfaces-readable',
      'world-anchors-correct',
      'multi-subject-occlusion-correct',
      'signed-world-direction-correct',
      'final-composition-readable',
    ];
  }
  if (group.pattern === 'looping-environment' && group.loopingEnvironment?.travel?.activeUntil !== undefined) {
    return [
      ...COMPOSITE_PROFILES['looping-environment'],
      'world-lock-clean',
    ];
  }
  if (group.pattern !== 'supported-subject' || group.support?.layering !== 'subject-front') {
    return COMPOSITE_PROFILES[group.pattern];
  }
  return COMPOSITE_PROFILES['supported-subject'].map((check) =>
    check === 'front-occlusion' ? 'subject-front-clear' : check,
  );
};

const qualityReportPath = (slug) => path.join(ROOT, 'projects', slug, 'quality-report.json');
export const compositionProofReportPath = (slug) => path.join(ROOT, 'dist', slug, 'composition-proof', 'report.json');

const TOPOLOGY_ASSET_CHECKS = ['silhouette-fidelity', 'negative-space-clean', 'background-leak-free'];
const EVIDENCE_REQUIRED_CHECKS = new Set([
  ...TOPOLOGY_ASSET_CHECKS,
  'motion-isolation-clean',
  'motion-grammar-consistent',
  'pacing-cadence-consistent',
  'camera-strategy-consistent',
  'transition-strategy-consistent',
  'ambient-strategy-consistent',
  'sync-anchors-current',
  'style-profile-consistent',
  'identity-distinct-within-frame',
  'identity-family-consistent',
  'cross-scene-identity-continuity',
  'untargeted-cells-unchanged',
  'mechanism-complete',
  'load-path-readable',
  'physical-plausibility',
  'reference-conformant',
  'diagram-edge-clean',
  'small-text-legible',
  'no-procedural-noise-on-semantic-lines',
]);

const TEMPORAL_EVIDENCE_PATTERNS = new Set([
  'motion-contract',
  'style-target',
  'state-sequence',
  'spatial-contract',
  'looping-environment',
  'parallax-rig',
  'motif-field',
  'canonical-container',
  'editorial-transition',
]);

export const requiresTemporalEvidence = (target) =>
  TEMPORAL_EVIDENCE_PATTERNS.has(target.pattern) &&
  target.reviewScope !== 'derivation-only';

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

export const inspectUntargetedSheetCells = async ({
  currentFile,
  sourceFile,
  stateSheetBinding,
  recoveryBinding,
}) => {
  if (recoveryBinding?.mode !== 'masked-sheet-edit') {
    return {passed: true, sampledPixels: 0, changedPixels: 0, changedPixelRatio: 0, meanChannelDelta: 0};
  }
  try {
    const [current, source] = await Promise.all([
      sharp(currentFile).ensureAlpha().raw().toBuffer({resolveWithObject: true}),
      sharp(sourceFile).ensureAlpha().raw().toBuffer({resolveWithObject: true}),
    ]);
    if (current.info.width !== source.info.width || current.info.height !== source.info.height || current.info.channels !== source.info.channels) {
      return {
        passed: false,
        reason: 'dimensions-changed',
        current: `${current.info.width}x${current.info.height}x${current.info.channels}`,
        source: `${source.info.width}x${source.info.height}x${source.info.channels}`,
      };
    }
    const width = current.info.width;
    const height = current.info.height;
    const channels = current.info.channels;
    const columns = stateSheetBinding.layout.columns;
    const rows = stateSheetBinding.layout.rows;
    const targeted = new Set(recoveryBinding.targetStateIds);
    const contextStates = stateSheetBinding.states.filter(({stateId}) => !targeted.has(stateId));
    let sampledPixels = 0;
    let changedPixels = 0;
    let totalChannelDelta = 0;
    for (const state of contextStates) {
      const left = Math.round(state.column * width / columns);
      const right = Math.round((state.column + 1) * width / columns);
      const top = Math.round(state.row * height / rows);
      const bottom = Math.round((state.row + 1) * height / rows);
      for (let y = top; y < bottom; y += 1) {
        for (let x = left; x < right; x += 1) {
          const offset = (y * width + x) * channels;
          let pixelChanged = false;
          for (let channel = 0; channel < channels; channel += 1) {
            const delta = Math.abs(current.data[offset + channel] - source.data[offset + channel]);
            totalChannelDelta += delta;
            if (delta > 3) pixelChanged = true;
          }
          sampledPixels += 1;
          if (pixelChanged) changedPixels += 1;
        }
      }
    }
    const changedPixelRatio = sampledPixels === 0 ? 1 : changedPixels / sampledPixels;
    const meanChannelDelta = sampledPixels === 0 ? 255 : totalChannelDelta / (sampledPixels * channels);
    return {
      passed: sampledPixels > 0 && changedPixelRatio <= 0.001 && meanChannelDelta <= 0.5,
      sampledPixels,
      changedPixels,
      changedPixelRatio,
      meanChannelDelta,
    };
  } catch (error) {
    return {passed: false, reason: error.message};
  }
};

const readManifest = async (project) => {
  const file = path.join(ROOT, 'projects', project.slug, 'assets-manifest.json');
  const manifest = (await fileExists(file))
    ? await readJson(file)
    : {schemaVersion: 4, projectSlug: project.slug, assets: []};
  return assertAssetManifest(manifest, project.slug);
};

const collectQualityAssets = async (project, manifest, semanticContracts) => {
  const byFile = new Map();
  const add = ({
    assetId,
    file,
    kind,
    source,
    requiredChecks,
    reviewScope = 'source-asset',
    semanticBinding = null,
    semanticSliceBinding = null,
    alphaTopologyExpectedComponents = [],
    alphaTopologyAllowDetachedComponents = false,
    registeredFamilyBinding = null,
    canonicalContainerBinding = null,
    stateSheetBinding = null,
    outputSurface = null,
    stateSheetRecoveryBinding = null,
    recoverySourceFile = null,
    recoverySourceSha256 = null,
    recoveryEvidenceFiles = [],
    manifestRecordId = null,
    manifestSha256 = null,
  }) => {
    const relativeFile = path.relative(ROOT, file);
    const existing = byFile.get(relativeFile);
    if (existing) {
      existing.sources = [...new Set([...existing.sources, source])];
      if (['background', 'environment', 'character', 'prop', 'mechanism', 'diagram'].includes(kind)) existing.kind = kind;
      if (reviewScope === 'runtime-visible') {
        existing.reviewScope = 'runtime-visible';
      } else if (
        existing.reviewScope !== 'runtime-visible' &&
        (
          reviewScope === 'derivation-only' ||
          existing.reviewScope === 'derivation-only'
        )
      ) {
        existing.reviewScope = 'derivation-only';
      }
      if (existing.reviewScope === 'derivation-only') {
        existing.requiredChecks = [];
      } else if (requiredChecks !== undefined) {
        existing.requiredChecks = [
          ...new Set([...(existing.requiredChecks ?? []), ...requiredChecks]),
        ];
      }
      if (assetId) existing.assetId = assetId;
      if (semanticBinding) existing.semanticBinding = semanticBinding;
      if (semanticSliceBinding) {
        existing.semanticSliceBinding = semanticSliceBinding;
      }
      if (alphaTopologyExpectedComponents.length > 0) {
        existing.alphaTopologyExpectedComponents =
          alphaTopologyExpectedComponents;
      }
      existing.alphaTopologyAllowDetachedComponents =
        existing.alphaTopologyAllowDetachedComponents ||
        alphaTopologyAllowDetachedComponents;
      if (registeredFamilyBinding) {
        existing.registeredFamilyBinding = registeredFamilyBinding;
      }
      if (canonicalContainerBinding) {
        existing.canonicalContainerBinding =
          canonicalContainerBinding;
      }
      if (stateSheetBinding) existing.stateSheetBinding = stateSheetBinding;
      if (outputSurface) existing.outputSurface = outputSurface;
      if (stateSheetRecoveryBinding) existing.stateSheetRecoveryBinding = stateSheetRecoveryBinding;
      if (recoverySourceFile) existing.recoverySourceFile = recoverySourceFile;
      if (recoverySourceSha256) existing.recoverySourceSha256 = recoverySourceSha256;
      if (recoveryEvidenceFiles.length) existing.recoveryEvidenceFiles = recoveryEvidenceFiles;
      if (manifestRecordId) existing.manifestRecordId = manifestRecordId;
      if (manifestSha256) existing.manifestSha256 = manifestSha256;
      return;
    }
    byFile.set(relativeFile, {
      assetId: assetId || runtimeAssetId(relativeFile),
      file: relativeFile,
      kind,
      sources: [source],
      reviewScope,
      semanticBinding,
      semanticSliceBinding,
      alphaTopologyExpectedComponents,
      alphaTopologyAllowDetachedComponents,
      registeredFamilyBinding,
      canonicalContainerBinding,
      stateSheetBinding,
      outputSurface,
      stateSheetRecoveryBinding,
      recoverySourceFile,
      recoverySourceSha256,
      recoveryEvidenceFiles,
      manifestRecordId,
      manifestSha256,
      ...(requiredChecks !== undefined ? {requiredChecks} : {}),
    });
  };

  for (const scene of project.scenes ?? []) {
    for (const {node, parent, renderParticipation} of collectCompositionAssets(scene.composition)) {
      const topologyChecks = renderParticipation === 'visible' &&
        parent && ['supported-subject', 'registered-environment', 'registered-depth-stack'].includes(parent.pattern)
        ? [...(QUALITY_PROFILES[node.assetRole] ?? QUALITY_PROFILES.image), ...TOPOLOGY_ASSET_CHECKS]
        : renderParticipation === 'derivation-only'
          ? []
          : undefined;
      add({
        file: resolvePublicFile(node.src),
        kind: node.assetRole,
        source: `scene:${scene.id}:node:${node.id}`,
        requiredChecks: topologyChecks,
        reviewScope: renderParticipation === 'derivation-only'
          ? 'derivation-only'
          : 'runtime-visible',
      });
    }
    for (const {node, parent, renderParticipation} of collectStateSequences(scene.composition)) {
      const topologyChecks = renderParticipation === 'visible' &&
        parent && ['supported-subject', 'registered-environment', 'registered-depth-stack'].includes(parent.pattern)
        ? [...(QUALITY_PROFILES[node.assetRole] ?? QUALITY_PROFILES.image), ...TOPOLOGY_ASSET_CHECKS]
        : renderParticipation === 'derivation-only'
          ? []
          : undefined;
      for (const state of node.states) {
        add({
          assetId: `${node.poseFamilyId}:${state.id}`,
          file: resolvePublicFile(state.src),
          kind: node.assetRole,
          source: `scene:${scene.id}:node:${node.id}`,
          requiredChecks: topologyChecks,
          reviewScope: renderParticipation === 'derivation-only'
            ? 'derivation-only'
            : 'runtime-visible',
        });
      }
    }
    for (const {node} of collectWorldStrips(scene.composition)) {
      add({
        file: resolvePublicFile(node.src),
        kind: 'environment',
        source: `scene:${scene.id}:node:${node.id}`,
        reviewScope: 'runtime-visible',
        alphaTopologyAllowDetachedComponents:
          ['scenery', 'foreground-occluder'].includes(node.surfaceRole),
      });
    }
    for (const {node, renderParticipation} of collectCompositionGroups(scene.composition)) {
      if (renderParticipation !== 'visible') continue;
      for (const boundary of node.boundaries ?? []) {
        for (const maskSrc of [boundary.upperMaskSrc, boundary.lowerMaskSrc].filter(Boolean)) {
          add({file: resolvePublicFile(maskSrc), kind: 'environment', source: `scene:${scene.id}:boundary:${boundary.id}`, reviewScope: 'runtime-visible'});
        }
      }
    }
  }

  const activeRecords = activeManifestAssets(manifest);
  const recordsByAssetId = new Map(activeRecords.map((record) => [record.assetId, record]));
  for (const record of activeRecords) {
    if (record.capability !== 'image') continue;
    const semanticBinding = record.semanticBinding ?? record.request?.semanticBinding ?? null;
    const registeredFamilyBinding = record.registeredFamilyBinding ?? null;
    const registeredFamilyMaskRecord =
      registeredFamilyBinding?.derivation?.maskAssetId
        ? recordsByAssetId.get(
            registeredFamilyBinding.derivation.maskAssetId,
          ) ?? null
        : null;
    const semanticSliceBinding = record.semanticSliceBinding ?? null;
    const canonicalContainerBinding =
      record.canonicalContainerBinding ?? null;
    const boundContracts = (semanticBinding?.contractIds ?? [])
      .map((id) => semanticContracts.contracts.get(id))
      .filter(Boolean);
    const semanticChecks = requiredChecksForSemanticBinding(semanticBinding, boundContracts);
    const stateSheetRecoveryBinding = record.stateSheetRecoveryBinding ?? record.request?.stateSheetRecoveryBinding ?? null;
    const stateSheetBinding = record.stateSheetBinding ?? record.request?.stateSheetBinding ?? null;
    const recoverySource = stateSheetRecoveryBinding
      ? recordsByAssetId.get(stateSheetRecoveryBinding.sourceSheetAssetId) ?? null
      : null;
    const recoveryMask = stateSheetRecoveryBinding?.maskAssetId
      ? recordsByAssetId.get(stateSheetRecoveryBinding.maskAssetId) ?? null
      : null;
    add({
      assetId: record.assetId,
      file: assertWorkspaceFile(record.file),
      kind: inferManifestKind(record),
      source: `manifest:${record.assetId}`,
      requiredChecks: [...new Set([...(record.request?.quality?.requiredChecks ?? []), ...semanticChecks])],
      semanticBinding,
      semanticSliceBinding,
      alphaTopologyExpectedComponents:
        semanticSliceBinding?.components ??
        registeredFamilyMaskRecord?.semanticSliceBinding?.components ??
        [],
      alphaTopologyAllowDetachedComponents:
        ['mid', 'near'].includes(record.loopingStripBinding?.role) ||
        (
          registeredFamilyBinding?.pattern === 'registered-depth-stack' &&
          ['subject', 'support-front'].includes(
            registeredFamilyBinding?.role,
          )
        ),
      registeredFamilyBinding,
      canonicalContainerBinding,
      stateSheetBinding,
      outputSurface: record.request?.outputSurface ?? null,
      stateSheetRecoveryBinding,
      recoverySourceFile: recoverySource?.file ?? null,
      recoverySourceSha256: recoverySource?.sha256 ?? null,
      recoveryEvidenceFiles: [record.file, recoverySource?.file, recoveryMask?.file].filter(Boolean),
      manifestRecordId: record.recordId,
      manifestSha256: record.sha256,
    });
  }

  const usedIds = new Set();
  return [...byFile.values()].map((asset) => {
    let assetId = asset.assetId;
    if (usedIds.has(assetId)) assetId = `${assetId}-${runtimeAssetId(asset.file).slice(-6)}`;
    usedIds.add(assetId);
    const semanticContractFingerprints = Object.fromEntries(
      (asset.semanticBinding?.contractIds ?? [])
        .map((id) => [id, semanticContracts.fingerprints.get(id) ?? null]),
    );
    return {
      ...asset,
      assetId,
      semanticContractFingerprints,
      styleProfileBinding: project.styleProfile
        ? {
            id: project.styleProfile.id,
            profileFingerprint: project.styleProfile.profileFingerprint,
          }
        : null,
    };
  });
};

export const requiresTransparentAssetSurface = (asset) => {
  if (
    asset.registeredFamilyBinding?.derivation?.sourceSurface?.mode ===
    'chroma-key'
  ) {
    return true;
  }
  if (asset.reviewScope === 'source-asset') {
    return asset.outputSurface?.mode === 'transparent';
  }
  return ['character', 'prop'].includes(asset.kind);
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
  if (asset.reviewScope === 'derivation-only') {
    checks.push({
      id: 'derivation-provenance-current',
      passed:
        typeof asset.manifestRecordId === 'string' &&
        asset.manifestRecordId.length > 0 &&
        asset.manifestSha256 === await hashFile(file),
      expected: asset.manifestSha256,
      actual: {
        recordId: asset.manifestRecordId,
        sha256: await hashFile(file),
      },
    });
  }
  if (asset.kind === 'background') {
    const scale = project.quality?.minimumAssetScale ?? 1;
    const minimumWidth = Math.round(project.video.width * scale);
    const minimumHeight = Math.round(project.video.height * scale);
    checks.push({id: 'minimum-resolution', passed: Number(metadata.width ?? 0) >= minimumWidth && Number(metadata.height ?? 0) >= minimumHeight, expected: `${minimumWidth}x${minimumHeight}`, actual: `${metadata.width ?? 0}x${metadata.height ?? 0}`});
  }
  const hasRegisteredKeying =
    asset.registeredFamilyBinding?.derivation?.sourceSurface?.mode ===
    'chroma-key';
  if (requiresTransparentAssetSurface(asset)) {
    const inspection = await inspectCharacterPng(file);
    checks.push(
      {id: 'alpha-present', passed: inspection.hasAlpha && inspection.transparentPixels > 0, actual: inspection.hasAlpha},
      {id: 'key-edge-clean', passed: inspection.keyEdgeRatio <= 0.12, expected: '<= 0.12', actual: inspection.keyEdgeRatio},
    );
    if (hasRegisteredKeying) {
      const metadataFile = `${file}.key.json`;
      const metadataHash = await fileExists(metadataFile)
        ? await hashFile(metadataFile)
        : null;
      const keyingMetadata = await fileExists(metadataFile)
        ? await readJson(metadataFile)
        : null;
      checks.push({
        id: 'keying-provenance-current',
        passed:
          metadataHash ===
          asset.registeredFamilyBinding.derivation.keyingMetadataSha256,
        expected:
          asset.registeredFamilyBinding.derivation.keyingMetadataSha256,
        actual: metadataHash,
      });
      const sourceSurface =
        asset.registeredFamilyBinding.derivation.sourceSurface;
      if (sourceSurface?.observedKeyColor) {
        checks.push({
          id: 'observed-key-plane-current',
          passed:
            keyingMetadata?.providerObservation?.observationFingerprint ===
              sourceSurface.observationFingerprint &&
            keyingMetadata?.providerObservation?.policyFingerprint ===
              sourceSurface.observationPolicyFingerprint &&
            keyingMetadata?.providerObservation?.observedKeyColor ===
              sourceSurface.observedKeyColor &&
            asset.registeredFamilyBinding.derivation.keying?.keyColor
              ?.toLowerCase() === sourceSurface.observedKeyColor.toLowerCase(),
          expected: {
            observationFingerprint: sourceSurface.observationFingerprint,
            policyFingerprint: sourceSurface.observationPolicyFingerprint,
            observedKeyColor: sourceSurface.observedKeyColor,
          },
          actual: keyingMetadata?.providerObservation ?? null,
        });
      }
    }
  }
  if (metadata.hasAlpha === true) {
    const derivationRegions = derivationRegionsFromBinding(
      asset.registeredFamilyBinding,
    );
    const inspection = await inspectAlphaBands({
      file,
      derivationRegions,
    });
    checks.push({
      id: 'rectangular-alpha-band-free',
      passed: inspection.passed,
      expected: 'no error-severity low-alpha rectangular band',
      actual: inspection,
    });
    const topology = await inspectAlphaTopology({
      file,
      derivationRegions,
      expectedComponents: asset.alphaTopologyExpectedComponents,
      allowDetachedComponents:
        asset.alphaTopologyAllowDetachedComponents,
    });
    checks.push({
      id: 'alpha-topology-clean',
      passed: topology.passed,
      expected:
        'no detached rectangular alpha fragment or hard rectangular derivation boundary',
      actual: topology,
    });
  }
  if (asset.semanticSliceBinding) {
    const semanticSliceInspection = await inspectSemanticSliceOutput({
      file,
      binding: asset.semanticSliceBinding,
    });
    checks.push({
      id: 'semantic-slice-alpha-current',
      passed: semanticSliceInspection.passed,
      expected: {
        components: semanticSliceInspection.expectedComponents,
        alphaPixels: semanticSliceInspection.expectedAlphaPixels,
      },
      actual: {
        components: semanticSliceInspection.actualComponents,
        alphaPixels: semanticSliceInspection.actualAlphaPixels,
      },
    });
  }
  if (asset.semanticBinding?.riskClass === 'diagram-critical' && path.extname(file).toLowerCase() === '.svg') {
    const svg = await fs.readFile(file, 'utf8');
    for (const feature of ['feTurbulence', 'feDisplacementMap', 'feBlend']) {
      const present = new RegExp(`<${feature}\\b`, 'i').test(svg);
      checks.push({
        id: `diagram-filter-${feature}`,
        passed: !present,
        expected: 'absent',
        actual: present ? 'present' : 'absent',
      });
    }
  }
  if (asset.stateSheetRecoveryBinding?.mode === 'masked-sheet-edit') {
    const comparison = asset.recoverySourceFile
      ? await inspectUntargetedSheetCells({
          currentFile: file,
          sourceFile: assertWorkspaceFile(asset.recoverySourceFile),
          stateSheetBinding: asset.stateSheetBinding,
          recoveryBinding: asset.stateSheetRecoveryBinding,
        })
      : {passed: false, reason: 'source-sheet-missing'};
    checks.push({
      id: 'untargeted-cells-unchanged',
      passed: comparison.passed,
      expected: 'changedPixelRatio <= 0.001 and meanChannelDelta <= 0.5',
      actual: comparison,
    });
  }
  return {passed: checks.every(({passed}) => passed), checks};
};

const descendants = (group) => flattenCompositionNodes(group.children ?? []).map(({node}) => node);

const visualSourcesForNode = (node) => {
  if (!node) return [];
  if (node.kind === 'asset') return [node.src];
  if (node.kind === 'state-sequence') return node.states.map(({src}) => src);
  if (node.kind === 'motif-field') return node.motifs.map(({src}) => src);
  if (node.kind === 'world-strip') return [node.src];
  if (node.kind === 'group') return descendants(node).flatMap(visualSourcesForNode);
  return [];
};

const hashReferencedFiles = async (sources) => {
  const hashes = {};
  for (const source of [...new Set(sources.filter(Boolean))].sort()) {
    const file = resolvePublicFile(source);
    hashes[source] = (await fileExists(file)) ? await hashFile(file) : null;
  }
  return hashes;
};

const findNode = (scene, id) => flattenCompositionNodes(scene.composition?.nodes).find(({node}) => node.id === id)?.node ?? null;

const compositionTimingForScene = ({scene, sceneTransitions}) => ({
  narration: {
    startSeconds: scene.narration?.startSeconds,
    durationSeconds: scene.narration?.durationSeconds,
  },
  tailSeconds: scene.tailSeconds,
  sceneTransitions,
});

export const proofTimesForStateSequence = ({
  scene,
  node,
  spatialContracts = [],
}) => {
  const sceneProofTimes = scene.motion?.proofTimes ?? [];
  const assertedProofTimes = sceneProofTimes.filter((proof) =>
    (proof.stateAssertions ?? []).some(({nodeId}) => nodeId === node.id),
  );
  if (assertedProofTimes.length > 0 || !node.motion?.path) {
    return assertedProofTimes;
  }
  const pathContracts = spatialContracts.filter(
    (contract) =>
      contract.kind === 'path-locomotion' &&
      contract.sceneId === scene.id,
  );
  const directContracts = pathContracts.filter(
    (contract) => contract.nodeId === node.id,
  );
  const matchingContracts = directContracts.length > 0
    ? directContracts
    : pathContracts.filter((contract) => {
        const contractedNode = findNode(scene, contract.nodeId);
        return (
          Boolean(node.poseFamilyId) &&
          contractedNode?.poseFamilyId === node.poseFamilyId &&
          Boolean(contractedNode.motion?.path)
        );
      });
  const contractProofIds = new Set(
    matchingContracts
      .flatMap((contract) => [
        contract.fromProofTimeId,
        ...(contract.turnProofTimeIds ?? []),
        contract.throughProofTimeId,
      ])
      .filter(Boolean),
  );
  return sceneProofTimes.filter(({id}) => contractProofIds.has(id));
};

export const collectCompositeQualityTargets = async (
  project,
  {
    manifest = null,
    allowPendingSemanticEvidenceTargets = false,
  } = {},
) => {
  const runtimeSurfaceFingerprint =
    await createRuntimeSurfaceFingerprint('composition-proof');
  const assetManifest = manifest ?? await readManifest(project);
  const recordsByFile = new Map((assetManifest.assets ?? []).map((record) => [path.normalize(record.file), record]));
  const recordsByAssetId = new Map((assetManifest.assets ?? []).map((record) => [record.assetId, record]));
  const targets = [];
  for (const scene of project.scenes ?? []) {
    const sceneTransitions = (project.sceneTransitions ?? []).filter(
      ({fromSceneId, toSceneId}) => fromSceneId === scene.id || toSceneId === scene.id,
    );
    if (scene.camera?.parallax?.enabled) {
      const nodes = flattenCompositionNodes(scene.composition?.nodes)
        .filter(({renderParticipation}) => renderParticipation === 'visible')
        .map(({node}) => node);
      const memberHashes = await hashReferencedFiles(
        collectRuntimeVisibleCompositionSources(scene.composition),
      );
      const proofTimes = scene.motion?.proofTimes ?? [];
      const depthMap = nodes.map(({id, kind, depth = 0}) => ({id, kind, depth}));
      const fingerprint = hashCompositionValue({
        runtimeSurfaceFingerprint,
        sceneId: scene.id,
        parallax: scene.camera.parallax,
        camera: scene.camera,
        depthMap,
        proofTimes,
        timing: compositionTimingForScene({scene, sceneTransitions}),
        memberHashes,
      });
      targets.push({
        compositeId: `parallax-rig:${scene.id}`,
        sceneId: scene.id,
        pattern: 'parallax-rig',
        nodeId: 'scene-camera',
        memberNodeIds: nodes.map(({id}) => id),
        memberHashes,
        compositionHash: hashCompositionValue({camera: scene.camera, depthMap}),
        fingerprint,
        proofTimeIds: proofTimes.map(({id}) => id),
        requiredChecks: COMPOSITE_PROFILES['parallax-rig'],
        reviewScope: 'runtime-visible',
        parallax: scene.camera.parallax,
        depthMap,
      });
    }
    for (const {node, renderParticipation} of collectMotifFields(scene.composition)) {
      if (renderParticipation !== 'visible') continue;
      const proofTimes = scene.motion?.proofTimes ?? [];
      const memberHashes = await hashReferencedFiles(node.motifs.map(({src}) => src));
      const fingerprint = hashCompositionValue({
        runtimeSurfaceFingerprint,
        sceneId: scene.id,
        node,
        proofTimes,
        timing: compositionTimingForScene({scene, sceneTransitions}),
        camera: scene.camera,
        affectingEvents: (scene.events ?? []).filter(({targetId}) => targetId === node.id),
        memberHashes,
      });
      targets.push({
        compositeId: `motif-field:${scene.id}:${node.id}`,
        sceneId: scene.id,
        pattern: 'motif-field',
        nodeId: node.id,
        memberNodeIds: [node.id],
        memberHashes,
        compositionHash: hashCompositionValue(node),
        fingerprint,
        proofTimeIds: proofTimes.map(({id}) => id),
        requiredChecks: COMPOSITE_PROFILES['motif-field'],
        reviewScope: 'runtime-visible',
        motifField: node,
      });
    }
    for (const {node} of flattenCompositionNodes(scene.composition?.nodes).filter(
      ({node: candidate, renderParticipation}) =>
        renderParticipation === 'visible' &&
        ['typography', 'annotation', 'data-graphic'].includes(candidate.kind),
    )) {
      const pattern = node.kind;
      const proofTimes = scene.motion?.proofTimes ?? [];
      const fingerprint = hashCompositionValue({
        runtimeSurfaceFingerprint,
        sceneId: scene.id,
        node,
        editorialFingerprint: project.editorial?.fingerprint ?? null,
        responsivePlans: project.editorial?.responsivePlans ?? [],
        proofTimes,
      });
      targets.push({
        compositeId: `${pattern}:${scene.id}:${node.id}`,
        sceneId: scene.id,
        pattern,
        nodeId: node.id,
        memberNodeIds: [node.id],
        memberHashes: [],
        compositionHash: hashCompositionValue(node),
        fingerprint,
        proofTimeIds: proofTimes.map(({id}) => id),
        requiredChecks:
          node.kind === 'typography' && node.role === 'visual-sfx'
            ? [
                ...COMPOSITE_PROFILES[pattern],
                'visual-sfx-audio-sync',
                'visual-sfx-subtitle-clear',
                'visual-sfx-subject-clear',
                'visual-sfx-density-controlled',
                'visual-sfx-style-consistent',
              ]
            : COMPOSITE_PROFILES[pattern],
        reviewScope: 'runtime-visible',
        editorialNode: node,
        sceneNodes: scene.composition?.nodes ?? [],
        video: project.video,
        editorial: project.editorial,
        exclusionZones: project.editorial?.responsiveProfiles?.find(
          ({id}) => id === project.editorial.activeProfile,
        )?.exclusionZones ?? [],
        events: (scene.events ?? []).filter(
          ({targetId}) => targetId === node.id,
        ),
      });
    }
    for (const {node, parent, renderParticipation} of collectStateSequences(scene.composition)) {
      if (renderParticipation !== 'visible') continue;
      const proofTimes = proofTimesForStateSequence({
        scene,
        node,
        spatialContracts: project.spatialContracts,
      });
      const memberHashes = await hashReferencedFiles(node.states.map(({src}) => src));
      const stateRecords = node.states.map((state) => recordsByFile.get(path.normalize(path.relative(ROOT, resolvePublicFile(state.src)))) ?? null);
      const registeredFamilyGroup =
        parent?.kind === 'group' &&
        ['supported-subject', 'registered-environment', 'registered-depth-stack', 'canonical-container'].includes(
          parent.pattern,
        )
          ? parent
          : null;
      const registeredFamilyRecords = registeredFamilyGroup
        ? registeredFamilyGroup.children
            .filter(({kind}) => ['asset', 'state-sequence'].includes(kind))
            .flatMap((member) =>
              (member.kind === 'state-sequence'
                ? member.states.map(({src}) => src)
                : [member.src]
              ).map(
                (source) =>
                  recordsByFile.get(
                    path.normalize(
                      path.relative(ROOT, resolvePublicFile(source)),
                    ),
                  ) ?? null,
              ),
            )
        : [];
      const registeredFamilyIds = new Set(
        registeredFamilyRecords
          .map((record) => record?.registeredFamilyBinding?.familyId)
          .filter(Boolean),
      );
      const registeredFamilyContextRecords = registeredFamilyGroup
        ? activeManifestAssets(assetManifest).filter((record) =>
            registeredFamilyIds.has(
              record?.registeredFamilyBinding?.familyId,
            ) ||
            (
              registeredFamilyGroup.pattern ===
                'canonical-container' &&
              record?.canonicalContainerBinding?.familyId ===
                registeredFamilyGroup.canonicalContainer?.familyId
            ),
          )
        : [];
      const familyProvenance = stateRecords.map((record) => record ? {
        assetId: record.assetId,
        compositionBinding: record.compositionBinding ?? record.request?.compositionBinding ?? null,
        stateBinding: record.stateBinding ?? record.request?.stateBinding ?? null,
        familyFingerprint: record.familyFingerprint ?? null,
      } : null);
      const fingerprint = hashCompositionValue({
        runtimeSurfaceFingerprint,
        sceneId: scene.id,
        node,
        proofTimes,
        timing: compositionTimingForScene({scene, sceneTransitions}),
        camera: scene.camera,
        affectingEvents: (scene.events ?? []).filter(({targetId}) => targetId === node.id),
        memberHashes,
        familyProvenance,
      });
      targets.push({
        compositeId: `state-sequence:${scene.id}:${node.id}`,
        sceneId: scene.id,
        pattern: 'state-sequence',
        nodeId: node.id,
        memberNodeIds: [node.id],
        memberHashes,
        compositionHash: hashCompositionValue(node),
        fingerprint,
        proofTimeIds: proofTimes.map(({id}) => id),
        requiredChecks: COMPOSITE_PROFILES['state-sequence'],
        reviewScope: 'runtime-visible',
        sequence: node,
        stateRecords,
        registeredFamilyGroup,
        registeredFamilyRecords,
        registeredFamilyContextRecords,
        identityReferenceRecords: node.states.map(
          ({identityReferenceAssetId}) =>
            recordsByAssetId.get(identityReferenceAssetId) ?? null,
        ),
      });
    }
    for (const {node: group, renderParticipation} of collectCompositionGroups(scene.composition)) {
      if (!['supported-subject', 'registered-environment', 'registered-depth-stack', 'looping-environment', 'canonical-container'].includes(group.pattern)) continue;
      const members = descendants(group).filter((node) => ['asset', 'state-sequence', 'world-strip'].includes(node.kind));
      const sources = [
        ...members.flatMap((member) => member.kind === 'state-sequence' ? member.states.map(({src}) => src) : [member.src]),
        ...(group.boundaries ?? []).flatMap(({upperMaskSrc, lowerMaskSrc}) => [upperMaskSrc, lowerMaskSrc]),
      ];
      const memberHashes = await hashReferencedFiles(sources);
      const familyRecords = members.flatMap((member) =>
        (member.kind === 'state-sequence' ? member.states.map(({src}) => src) : [member.src])
          .map((source) => recordsByFile.get(path.normalize(path.relative(ROOT, resolvePublicFile(source)))) ?? null),
      );
      const familyIds = new Set(
        familyRecords
          .map((record) => record?.registeredFamilyBinding?.familyId)
          .filter(Boolean),
      );
      const familyContextRecords = activeManifestAssets(assetManifest).filter(
        (record) =>
          familyIds.has(record?.registeredFamilyBinding?.familyId) ||
          (
            group.pattern === 'canonical-container' &&
            record?.canonicalContainerBinding?.familyId ===
              group.canonicalContainer?.familyId
          ),
      );
      const familyProvenance = familyRecords.map((record) => record ? {
        assetId: record.assetId,
        compositionBinding: record.compositionBinding ?? record.request?.compositionBinding ?? null,
        registeredFamilyBinding: record.registeredFamilyBinding ?? null,
        loopingStripBinding: record.loopingStripBinding ?? null,
        canonicalContainerBinding:
          record.canonicalContainerBinding ?? null,
        familyFingerprint: record.familyFingerprint ?? null,
      } : null);
      const fingerprint = hashCompositionValue(
        renderParticipation === 'derivation-only'
          ? {
              runtimeSurfaceFingerprint,
              sceneId: scene.id,
              reviewScope: renderParticipation,
              group,
              memberHashes,
              familyProvenance,
            }
          : {
              runtimeSurfaceFingerprint,
              sceneId: scene.id,
              group,
              proofTimes: scene.motion?.proofTimes ?? [],
              timing: compositionTimingForScene({scene, sceneTransitions}),
              camera: scene.camera,
              affectingEvents: (scene.events ?? []).filter(({targetId}) => targetId === group.id),
              memberHashes,
              familyProvenance,
            },
      );
      targets.push({
        compositeId: `group:${scene.id}:${group.id}`,
        sceneId: scene.id,
        pattern: group.pattern,
        nodeId: group.id,
        memberNodeIds: members.map(({id}) => id),
        memberHashes,
        compositionHash: hashCompositionValue(group),
        fingerprint,
        proofTimeIds:
          renderParticipation === 'derivation-only'
            ? []
            : (scene.motion?.proofTimes ?? []).map(({id}) => id),
        requiredChecks:
          renderParticipation === 'derivation-only'
            ? []
            : requiredChecksForGroup(group),
        reviewScope:
          renderParticipation === 'derivation-only'
            ? 'derivation-only'
            : 'runtime-visible',
        group,
        familyRecords,
        familyContextRecords,
        manifest: assetManifest,
      });
    }
    for (const event of scene.events ?? []) {
      if (!event.proofTimeId && !event.sound) continue;
      const targetNode = findNode(scene, event.targetId);
      const targetSources = targetNode
        ? targetNode.kind === 'state-sequence'
          ? targetNode.states.map(({src}) => src)
          : visualSourcesForNode(targetNode)
        : collectRuntimeVisibleCompositionSources(scene.composition);
      const memberHashes = await hashReferencedFiles(targetSources);
      const proof = (scene.motion?.proofTimes ?? []).find(({id}) => id === event.proofTimeId) ?? null;
      const fingerprint = hashCompositionValue({runtimeSurfaceFingerprint, sceneId: scene.id, event, proof, targetNode, timing: compositionTimingForScene({scene, sceneTransitions}), camera: scene.camera, memberHashes});
      targets.push({
        compositeId: `event:${scene.id}:${event.id}`,
        sceneId: scene.id,
        pattern: 'event',
        nodeId: event.targetId,
        memberNodeIds: targetNode ? [targetNode.id] : [],
        memberHashes,
        compositionHash: hashCompositionValue({event, proof, targetNode}),
        fingerprint,
        proofTimeIds: event.proofTimeId ? [event.proofTimeId] : [],
        requiredChecks: COMPOSITE_PROFILES.event,
        reviewScope: 'runtime-visible',
        event,
      });
    }
  }
  const sceneById = new Map(
    (project.scenes ?? []).map((scene) => [scene.id, scene]),
  );
  for (const contract of project.spatialContracts ?? []) {
    const proofShots = contract.kind === 'grounding'
      ? [{
          sceneId: contract.sceneId,
          nodeId: contract.subjectNodeId,
          proofTimeIds: contract.proofTimeIds,
        }]
      : ['gait', 'travel-facing', 'path-locomotion'].includes(contract.kind)
        ? [{
            sceneId: contract.sceneId,
            nodeId: contract.nodeId,
            proofTimeIds: [
              contract.fromProofTimeId,
              ...(contract.kind === 'path-locomotion'
                ? contract.turnProofTimeIds
                : []),
              contract.throughProofTimeId,
            ],
          }]
        : [
            {
              sceneId: contract.from.sceneId,
              nodeId: contract.nodePairs[0].fromNodeId,
              proofTimeIds: [contract.from.proofTimeId],
            },
            {
              sceneId: contract.to.sceneId,
              nodeId: contract.nodePairs[0].toNodeId,
              proofTimeIds: [contract.to.proofTimeId],
            },
          ];
    const references = contract.kind === 'grounding'
      ? [{
          sceneId: contract.sceneId,
          nodeIds: [
            contract.subjectNodeId,
            contract.supportNodeId,
            contract.frontOcclusion?.nodeId,
          ].filter(Boolean),
        }]
      : ['gait', 'travel-facing', 'path-locomotion'].includes(contract.kind)
        ? [{
            sceneId: contract.sceneId,
            nodeIds: [
              contract.nodeId,
              ...(contract.kind === 'path-locomotion'
                ? [contract.worldNodeId]
                : []),
            ],
          }]
        : [
            {
              sceneId: contract.from.sceneId,
              nodeIds: contract.nodePairs.map(({fromNodeId}) => fromNodeId),
            },
            {
              sceneId: contract.to.sceneId,
              nodeIds: contract.nodePairs.map(({toNodeId}) => toNodeId),
            },
          ];
    const nodes = references.flatMap(({sceneId, nodeIds}) => {
      const scene = sceneById.get(sceneId);
      return nodeIds.flatMap((nodeId) => {
        const node = scene ? findNode(scene, nodeId) : null;
        return node ? [{sceneId, node}] : [];
      });
    });
    const memberHashes = await hashReferencedFiles(
      nodes.flatMap(({node}) => visualSourcesForNode(node)),
    );
    const sceneEvidence = proofShots.map((shot) => {
      const scene = sceneById.get(shot.sceneId);
      return {
        sceneId: shot.sceneId,
        nodeId: shot.nodeId,
        proofs: (scene?.motion?.proofTimes ?? []).filter(({id}) =>
          shot.proofTimeIds.includes(id),
        ),
        camera: scene?.camera ?? null,
        events: scene?.events ?? [],
      };
    });
    targets.push({
      compositeId: `spatial-contract:${contract.id}`,
      sceneId: proofShots[0].sceneId,
      pattern: 'spatial-contract',
      nodeId: proofShots[0].nodeId,
      memberNodeIds: [
        ...new Set(nodes.map(({sceneId, node}) => `${sceneId}:${node.id}`)),
      ],
      memberHashes,
      compositionHash: hashCompositionValue(contract),
      fingerprint: hashCompositionValue({
        runtimeSurfaceFingerprint,
        contract,
        sceneEvidence,
        memberHashes,
      }),
      proofTimeIds: [
        ...new Set(proofShots.flatMap(({proofTimeIds}) => proofTimeIds)),
      ],
      proofShots,
      requiredChecks: requiredChecksForSpatialContract(contract),
      reviewScope: 'runtime-visible',
      spatialContract: contract,
    });
  }
  for (const transition of project.editorial?.transitionPlans ?? []) {
    targets.push({
      compositeId: `editorial-transition:${transition.id}`,
      sceneId: transition.sceneId,
      pattern: 'editorial-transition',
      nodeId: transition.sourceAnchor?.targetId ?? transition.id,
      memberNodeIds: [
        transition.sourceAnchor?.targetId,
        transition.destinationAnchor?.targetId,
      ].filter(Boolean),
      memberHashes: [],
      compositionHash: hashCompositionValue(transition),
      fingerprint: hashCompositionValue({
        runtimeSurfaceFingerprint,
        editorialFingerprint: project.editorial.fingerprint,
        transition,
      }),
      proofTimeIds: transition.proofFrameIds,
      requiredChecks: COMPOSITE_PROFILES['editorial-transition'],
      reviewScope: 'runtime-visible',
      editorialTransition: transition,
    });
  }
  for (const responsive of (project.editorial?.responsivePlans ?? []).filter(
    (plan) => plan.scenes.some(({placements}) => placements.length > 0),
  )) {
    const proofShots = responsive.scenes
      .map(({sceneId}) => {
        const scene = (project.scenes ?? []).find(
          (candidate) => candidate.id === sceneId,
        );
        const proofs = scene?.motion?.proofTimes ?? [];
        const representative =
          proofs.find(({kind}) => kind === 'action') ??
          [...proofs].sort(
            (left, right) =>
              Math.abs(Number(left.at) - 0.5) -
              Math.abs(Number(right.at) - 0.5),
          )[0] ??
          null;
        return representative
          ? {
              sceneId,
              nodeId: 'scene-camera',
              proofTimeIds: [representative.id],
            }
          : null;
      })
      .filter(Boolean);
    targets.push({
      compositeId: `responsive-directing:${responsive.profileId}`,
      sceneId: project.scenes?.[0]?.id ?? 'project',
      pattern: 'responsive-directing',
      nodeId: responsive.profileId,
      memberNodeIds: responsive.scenes.flatMap(({placements}) => placements.map(({targetId}) => targetId)),
      memberHashes: [],
      compositionHash: hashCompositionValue(responsive),
      fingerprint: hashCompositionValue({
        runtimeSurfaceFingerprint,
        editorialFingerprint: project.editorial.fingerprint,
        responsive,
        proofShots,
      }),
      proofTimeIds: [
        ...new Set(
          proofShots.flatMap(({proofTimeIds}) => proofTimeIds),
        ),
      ],
      proofShots,
      requiredChecks: COMPOSITE_PROFILES['responsive-directing'],
      reviewScope: 'runtime-visible',
      responsive,
    });
  }
  const semanticContracts = await loadSemanticContracts(project.slug);
  if (semanticContracts.document?.status === 'ready' && semanticContracts.issues.length === 0) {
    const sceneById = new Map((project.scenes ?? []).map((scene) => [scene.id, scene]));
    const semanticTargetIsAvailable = (evidenceTarget) =>
      evidenceTarget.shots.every((shot) => {
        const scene = sceneById.get(shot.sceneId);
        if (!scene) return false;
        if (!shot.nodeId || shot.nodeId === 'scene') return true;
        return flattenCompositionNodes(scene.composition?.nodes)
          .some(({node}) => node.id === shot.nodeId);
      });
    const contractsForEvidence = allowPendingSemanticEvidenceTargets
      ? semanticContracts.document.contracts.map((contract) => ({
          ...contract,
          evidenceTargets: contract.evidenceTargets.filter(
            semanticTargetIsAvailable,
          ),
        }))
      : semanticContracts.document.contracts;
    const evidenceDocument = {
      ...semanticContracts.document,
      contracts: contractsForEvidence,
    };
    const targetIssues = validateSemanticEvidenceTargets(evidenceDocument, project);
    if (targetIssues.length) throw new Error(targetIssues.join('\n'));
    for (const contract of contractsForEvidence) {
      for (const evidenceTarget of contract.evidenceTargets) {
        const proofShots = evidenceTarget.shots.map((shot) => ({
          sceneId: shot.sceneId,
          nodeId: shot.nodeId ?? 'scene',
          proofTimeIds: shot.proofTimeIds,
        }));
        const sources = [];
        const memberNodeIds = [];
        const sceneEvidence = [];
        for (const shot of proofShots) {
          const scene = sceneById.get(shot.sceneId);
          if (!scene) throw new Error(`${contract.id}/${evidenceTarget.id} 引用了未知场景 ${shot.sceneId}。`);
          const targetEntry = shot.nodeId === 'scene'
            ? null
            : flattenCompositionNodes(scene.composition?.nodes)
                .find(({node}) => node.id === shot.nodeId) ?? null;
          const targetNode = targetEntry?.node ?? null;
          if (shot.nodeId !== 'scene' && !targetNode) {
            throw new Error(`${contract.id}/${evidenceTarget.id} 引用了未知节点 ${shot.nodeId}。`);
          }
          if (targetEntry?.renderParticipation === 'derivation-only') {
            throw new Error(
              `${contract.id}/${evidenceTarget.id} 不能把 derivation-only 节点 ${shot.nodeId} 作为可见语义证据。`,
            );
          }
          const nodes = targetNode
            ? (['asset', 'state-sequence'].includes(targetNode.kind) ? [targetNode] : descendants(targetNode).filter(({kind}) => ['asset', 'state-sequence'].includes(kind)))
            : flattenCompositionNodes(scene.composition?.nodes)
                .filter(({renderParticipation}) => renderParticipation === 'visible')
                .map(({node}) => node)
                .filter(({kind}) => ['asset', 'state-sequence'].includes(kind));
          sources.push(...nodes.flatMap((node) => node.kind === 'asset' ? [node.src] : node.states.map(({src}) => src)));
          memberNodeIds.push(...nodes.map(({id}) => id));
          sceneEvidence.push({
            sceneId: scene.id,
            nodeId: shot.nodeId,
            proofTimes: (scene.motion?.proofTimes ?? []).filter(({id}) => shot.proofTimeIds.includes(id)),
            camera: scene.camera,
            events: scene.events,
          });
        }
        const memberHashes = await hashReferencedFiles(sources);
        const fingerprint = hashCompositionValue({
          runtimeSurfaceFingerprint,
          contract,
          evidenceTarget,
          contractFingerprint: semanticContracts.fingerprints.get(contract.id),
          sceneEvidence,
          memberHashes,
        });
        targets.push({
          compositeId: `semantic:${contract.id}:${evidenceTarget.id}`,
          sceneId: proofShots[0].sceneId,
          pattern: 'semantic-contract',
          nodeId: proofShots[0].nodeId,
          memberNodeIds: [...new Set(memberNodeIds)],
          memberHashes,
          compositionHash: hashCompositionValue({contract, evidenceTarget}),
          fingerprint,
          proofTimeIds: [...new Set(proofShots.flatMap(({proofTimeIds}) => proofTimeIds))],
          proofShots,
          requiredChecks: evidenceTarget.checks,
          reviewScope: 'runtime-visible',
          contractId: contract.id,
          contractKind: contract.kind,
        });
      }
    }
  }
  if (project.styleProfile && (project.scenes ?? []).length > 0) {
    const visibleNodes = (project.scenes ?? []).flatMap((scene) =>
      flattenCompositionNodes(scene.composition?.nodes)
        .filter(({renderParticipation}) => renderParticipation === 'visible')
        .map(({node}) => ({sceneId: scene.id, node})),
    );
    const memberHashes = await hashReferencedFiles(
      (project.scenes ?? []).flatMap((scene) =>
        collectRuntimeVisibleCompositionSources(scene.composition),
      ),
    );
    const proofShots = (project.scenes ?? []).map((scene) => ({
      sceneId: scene.id,
      nodeId: 'project-style',
      proofTimeIds: (scene.motion?.proofTimes ?? []).map(({id}) => id),
    }));
    targets.push({
      compositeId: `style-profile:${project.styleProfile.id}`,
      sceneId: project.scenes[0].id,
      pattern: 'style-target',
      nodeId: 'project-style',
      memberNodeIds: visibleNodes.map(
        ({sceneId, node}) => `${sceneId}:${node.id}`,
      ),
      memberHashes,
      compositionHash: hashCompositionValue({
        theme: project.theme,
        scenes: project.scenes.map(({id, appearance, composition}) => ({
          id,
          appearance: compositionAppearance(appearance),
          composition,
        })),
      }),
      fingerprint: hashCompositionValue({
        runtimeSurfaceFingerprint,
        styleProfile: project.styleProfile,
        theme: project.theme,
        scenes: project.scenes.map(
          ({id, appearance, composition, camera}) => ({
            id,
            appearance: compositionAppearance(appearance),
            composition,
            camera,
          }),
        ),
        memberHashes,
      }),
      proofTimeIds: [
        ...new Set(proofShots.flatMap(({proofTimeIds}) => proofTimeIds)),
      ],
      proofShots,
      requiredChecks: project.styleProfile.quality.requiredCompositeChecks,
      reviewScope: 'runtime-visible',
      styleOnly: true,
    });
  }
  if (project.motionContract && (project.scenes ?? []).length > 0) {
    const memberHashes = await hashReferencedFiles(
      (project.scenes ?? []).flatMap((scene) =>
        collectRuntimeVisibleCompositionSources(scene.composition),
      ),
    );
    const proofShots = project.motionContract.scenes.map((coverage) => ({
      sceneId: coverage.sceneId,
      nodeId: 'project-motion',
      proofTimeIds: [
        ...new Set(
          coverage.phrases.map(({proofTimeId}) => proofTimeId),
        ),
      ],
    }));
    targets.push({
      compositeId: 'motion-contract:whole-film',
      sceneId: project.motionContract.scenes[0].sceneId,
      pattern: 'motion-contract',
      nodeId: 'project-motion',
      memberNodeIds: [],
      memberHashes,
      compositionHash: hashCompositionValue({
        direction: project.motionContract.direction,
        scenes: project.motionContract.scenes,
        transitions: project.motionContract.transitions,
        editorialFingerprint:
          project.motionContract.editorialFingerprint,
      }),
      fingerprint: hashCompositionValue({
        runtimeSurfaceFingerprint,
        motionContract: project.motionContract,
        scenes: project.scenes.map(
          ({id, motion, camera, composition, events}) => ({
            id,
            motion,
            camera,
            composition,
            events,
          }),
        ),
        sceneTransitions: project.sceneTransitions,
        editorialFingerprint: project.editorial?.fingerprint ?? null,
        memberHashes,
      }),
      proofTimeIds: [
        ...new Set(
          proofShots.flatMap(({proofTimeIds}) => proofTimeIds),
        ),
      ],
      proofShots,
      requiredChecks:
        project.motionContract.requiredCompositeChecks,
      reviewScope: 'runtime-visible',
      styleOnly: true,
    });
  }
  return targets;
};

export const collectStyleProofTargets = async (project, directingTarget) => {
  const allTargets = (await collectCompositeQualityTargets(project, {
    allowPendingSemanticEvidenceTargets: true,
  })).filter(
    ({reviewScope, pattern}) =>
      reviewScope === 'runtime-visible' && pattern !== 'style-target',
  );
  const matchesDirectingTarget = (target) => {
    const shots = target.proofShots ?? [{
      sceneId: target.sceneId,
      nodeId: target.nodeId,
    }];
    return shots.some(({sceneId, nodeId}) =>
      sceneId === directingTarget.sceneId &&
      (nodeId === directingTarget.targetId || (target.memberNodeIds ?? []).includes(directingTarget.targetId)) &&
      (!directingTarget.proofTimeId || (target.proofTimeIds ?? []).includes(directingTarget.proofTimeId)),
    );
  };
  const formalTargets = allTargets.filter(matchesDirectingTarget);
  if (formalTargets.length > 0) return formalTargets;

  const scene = (project.scenes ?? []).find(({id}) => id === directingTarget.sceneId);
  const targetEntry = scene && directingTarget.targetId !== 'scene-camera'
    ? flattenCompositionNodes(scene.composition?.nodes)
        .find(({node}) => node.id === directingTarget.targetId) ?? null
    : null;
  if (targetEntry?.renderParticipation === 'derivation-only') {
    throw new Error(
      `style proof 不能把 derivation-only 节点 ${directingTarget.targetId} 当作可见导演目标。`,
    );
  }
  const targetNode = scene && directingTarget.targetId !== 'scene-camera'
    ? targetEntry?.node ?? null
    : null;
  const nodes = targetNode
    ? (['asset', 'state-sequence', 'motif-field'].includes(targetNode.kind)
        ? [targetNode]
        : descendants(targetNode).filter(({kind}) => ['asset', 'state-sequence', 'motif-field'].includes(kind)))
    : [];
  const sources = nodes.flatMap(visualSourcesForNode);
  const memberHashes = await hashReferencedFiles(sources);
  const runtimeSurfaceFingerprint =
    await createRuntimeSurfaceFingerprint('composition-proof');
  const proofTimes = scene?.motion?.proofTimes ?? [];
  return [{
    compositeId: `style-target:${directingTarget.sceneId}:${directingTarget.targetId}`,
    sceneId: directingTarget.sceneId,
    pattern: 'style-target',
    nodeId: directingTarget.targetId,
    memberNodeIds: nodes.map(({id}) => id),
    memberHashes,
    compositionHash: hashCompositionValue(targetNode ?? {targetId: directingTarget.targetId}),
    fingerprint: hashCompositionValue({
      runtimeSurfaceFingerprint,
      directingTarget,
      sceneId: scene?.id,
      targetNode,
      proofTimes,
      camera: scene?.camera,
      memberHashes,
    }),
    proofTimeIds: proofTimes.map(({id}) => id),
    requiredChecks: [],
    reviewScope: 'runtime-visible',
    styleOnly: true,
  }];
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

const registeredGroupMembersForTarget = (target) => {
  const recordsByFile = new Map(
    (target.familyRecords ?? [])
      .filter(Boolean)
      .map((record) => [path.normalize(record.file), record]),
  );
  const recordForSource = (source) =>
    recordsByFile.get(
      path.normalize(path.relative(ROOT, resolvePublicFile(source))),
    ) ?? null;
  return (target.group?.children ?? [])
    .filter(({kind}) => ['asset', 'state-sequence'].includes(kind))
    .map((node) => ({
      node,
      records:
        node.kind === 'state-sequence'
          ? node.states.map(({src}) => recordForSource(src))
          : [recordForSource(node.src)],
    }));
};

export const stateSequenceRegistrationStatus = ({
  sequence,
  stateRecords,
  registeredFamily,
  canonicalContainerGroup = null,
}) => {
  const poseStateRegistrationsBound = stateRecords.every((record, index) => {
    if (!record) return false;
    const binding = record.stateBinding ?? record.request?.stateBinding;
    const state = sequence.states[index];
    return (
      binding?.poseFamilyId === sequence.poseFamilyId &&
      binding?.registrationId === sequence.registration.id &&
      binding?.stateId === state.id &&
      binding?.facing === state.facing &&
      JSON.stringify(binding?.anchors) === JSON.stringify(state.anchors) &&
      binding?.identityReferenceAssetId === state.identityReferenceAssetId &&
      binding?.identityReferenceSha256 === state.identityReferenceSha256
    );
  });
  const registeredFamilyStatesBound =
    registeredFamily.passed &&
    stateRecords.every((record) => {
      const binding = record?.registeredFamilyBinding;
      return (
        binding?.registrationId === sequence.registration.id &&
        binding?.sourceMasterAssetId ===
          sequence.registration.sourceMasterAssetId &&
        binding?.slot === sequence.slot &&
        binding?.canvas?.width === sequence.registration.canvas.width &&
        binding?.canvas?.height === sequence.registration.canvas.height &&
        binding?.origin === sequence.registration.origin
      );
    });
  const canonicalContainerStatesBound =
    canonicalContainerGroup?.pattern === 'canonical-container' &&
    canonicalContainerGroup.canonicalContainer?.contentsNodeId ===
      sequence.id &&
    stateRecords.every((record, index) => {
      const binding = record?.canonicalContainerBinding;
      return (
        binding?.role === 'content-state' &&
        binding?.familyId === sequence.poseFamilyId &&
        binding?.registrationId === sequence.registration.id &&
        binding?.sourceMasterAssetId ===
          sequence.registration.sourceMasterAssetId &&
        binding?.canvas?.width ===
          sequence.registration.canvas.width &&
        binding?.canvas?.height ===
          sequence.registration.canvas.height &&
        binding?.stateId === sequence.states[index]?.id &&
        binding?.familyFingerprint ===
          canonicalContainerGroup.canonicalContainer
            .familyFingerprint
      );
    });
  return {
    passed:
      poseStateRegistrationsBound ||
      registeredFamilyStatesBound ||
      canonicalContainerStatesBound,
    mode: canonicalContainerStatesBound
      ? 'canonical-container'
      : registeredFamilyStatesBound
      ? 'registered-family'
      : poseStateRegistrationsBound
        ? 'pose-state'
        : 'unbound',
    poseStateRegistrationsBound,
    registeredFamilyStatesBound,
    canonicalContainerStatesBound,
  };
};

export const expectedRegisteredFamilyAlphaEvidenceCount = (target) =>
  (target.familyRecords ?? []).filter(Boolean).length;

export const buildRegisteredGeometryProofForTarget = async ({
  target,
  root,
}) => {
  const states = [];
  let binding = null;
  if (target.pattern === 'state-sequence') {
    const records = (target.registeredFamilyRecords ?? []).filter(Boolean);
    binding = records[0]?.registeredFamilyBinding ?? null;
    if (binding && (target.sequence?.states ?? []).length >= 2) {
      for (const state of target.sequence.states) {
        states.push({
          stateId: state.id,
          file: path.join(root, 'public', state.src),
          declaredFacing: state.facing ?? 'neutral',
        });
      }
    }
  } else {
    const records = (target.familyRecords ?? []).filter(Boolean);
    binding = records[0]?.registeredFamilyBinding ?? null;
    for (const record of records) {
      const familyBinding = record.registeredFamilyBinding;
      if (!familyBinding) continue;
      states.push({
        stateId:
          familyBinding.slot ??
          familyBinding.role ??
          record.assetId,
        file: path.resolve(root, record.file),
        declaredFacing: 'neutral',
        expectedPlacement:
          familyBinding.derivation?.placement ?? null,
      });
    }
  }
  if (!binding || states.length < 2) return null;
  return computeRegisteredGeometryProof({
    familyId: binding.familyId,
    registrationId: binding.registrationId,
    familyFingerprint: binding.familyFingerprint,
    canvas: binding.canvas,
    states,
    limits: DEFAULT_REGISTERED_GEOMETRY_LIMITS,
    mode: binding.pattern === 'state-sequence' ? 'reference' : 'placement',
  });
};

export const inspectCompositeTechnical = async ({target, proofReport}) => {
  if (target.reviewScope === 'derivation-only') {
    const registeredFamily = assertRegisteredFamilyGroupMembers({
      group: target.group,
      members: registeredGroupMembersForTarget(target),
      allRecords: target.familyContextRecords,
    });
    const provenanceCurrent = (target.familyRecords ?? [])
      .filter(Boolean)
      .every(
        (record) =>
          target.memberHashes[
            path.normalize(record.file).replace(/^public[\\/]/, '')
          ] === record.sha256,
      );
    const checks = [
      {
        id: 'derivation-family-complete',
        passed: registeredFamily.passed,
        expected: 'complete registered three-member source family context for every active state',
        actual: {
          errors: registeredFamily.errors,
          familyIds: registeredFamily.familyIds,
          stateful: registeredFamily.stateful,
        },
      },
      {
        id: 'derivation-provenance-current',
        passed: provenanceCurrent,
        expected: 'manifest hashes match every derivation-only member',
        actual: provenanceCurrent,
      },
    ];
    return {passed: checks.every(({passed}) => passed), checks, proofFrames: []};
  }
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
  const temporalRequired = requiresTemporalEvidence(target);
  const temporalEvidence = proofEntry?.temporalEvidence ?? null;
  const temporalFilesCurrent =
    temporalEvidence &&
    (
      await Promise.all(
        [
          {file: temporalEvidence.file, sha256: temporalEvidence.sha256},
          ...(temporalEvidence.frames ?? []).map(({file, sha256}) => ({
            file,
            sha256,
          })),
        ].map(async ({file, sha256}) => {
          try {
            const absoluteFile = assertWorkspaceFile(file);
            return (
              (await fileExists(absoluteFile)) &&
              (await hashFile(absoluteFile)) === sha256
            );
          } catch {
            return false;
          }
        }),
      )
    ).every(Boolean);
  const distinctFrameHashes = new Set(
    (temporalEvidence?.frames ?? []).map(({sha256}) => sha256),
  );
  const temporalMotionPresent =
    (temporalEvidence?.frames?.length ?? 0) >= 3 &&
    distinctFrameHashes.size >= 2;
  if (temporalRequired) {
    checks.push(
      {
        id: 'temporal-evidence-current',
        passed: Boolean(temporalFilesCurrent),
        expected: 'current temporal evidence strip bound by fingerprint',
        actual: temporalEvidence
          ? {
              file: temporalEvidence.file,
              frames: (temporalEvidence.frames ?? []).length,
              current: temporalFilesCurrent,
            }
          : null,
      },
      {
        id: 'temporal-evidence-motion',
        passed: temporalMotionPresent,
        expected: 'at least three sampled frames with observable change',
        actual: {
          frames: (temporalEvidence?.frames ?? []).length,
          distinctFrameHashes: distinctFrameHashes.size,
        },
      },
    );
  }
  if (
    ['supported-subject', 'registered-depth-stack', 'state-sequence'].includes(
      target.pattern,
    )
  ) {
    const geometryRecords =
      target.pattern === 'state-sequence'
        ? (target.registeredFamilyRecords ?? []).filter(Boolean)
        : (target.familyRecords ?? []).filter(Boolean);
    const familyBinding =
      geometryRecords.find(
        (record) => record?.registeredFamilyBinding,
      )?.registeredFamilyBinding ?? null;
    const geometryCurrent = await assertRegisteredGeometryCurrent({
      familyBinding,
      proof: proofEntry?.registeredGeometryProof ?? null,
      records: geometryRecords,
    });
    checks.push({
      id: 'registered-geometry-current',
      passed: !familyBinding || geometryCurrent.passed,
      expected:
        'when a registered family is bound, alpha-tight centroid/baseline/aspect/scale/proportion drift stays within limits and facing is consistent',
      actual: {
        hasBinding: Boolean(familyBinding),
        issues: geometryCurrent.issues,
      },
    });
  }
  if (target.pattern === 'supported-subject') {
    const front = target.group.children.find(({kind, slot}) => kind === 'asset' && slot === 'support-front');
    const alphaCoverage = front ? await alphaCoverageInPolygon(front.src, target.group.support?.occlusionZone) : 0;
    const registration = target.group.registration;
    const familyBound = target.familyRecords.every((record) => {
      const binding = record?.compositionBinding ?? record?.request?.compositionBinding;
      return binding?.registrationId === registration?.id && binding?.sourceMasterAssetId === registration?.sourceMasterAssetId;
    });
    const registeredFamily = assertRegisteredFamilyGroupMembers({
      group: target.group,
      members: registeredGroupMembersForTarget(target),
      allRecords: target.familyContextRecords,
    });
    if (target.group.support?.layering === 'subject-front') {
      checks.push({id: 'subject-front-layering', passed: true, expected: 'subject-front', actual: 'subject-front'});
    } else {
      checks.push({id: 'front-alpha-in-occlusion-zone', passed: alphaCoverage > 0.002, expected: '> 0.002', actual: alphaCoverage});
    }
    checks.push(
      {id: 'registered-source-family', passed: familyBound, actual: familyBound},
      {
        id: 'registered-family-derivation',
        passed: registeredFamily.passed,
        expected: 'three full-canvas registered-family members with matching roles',
        actual: {
          passed: registeredFamily.passed,
          errors: registeredFamily.errors,
          familyIds: registeredFamily.familyIds,
          stateful: registeredFamily.stateful,
        },
      },
    );
    const alphaEvidence = (proofReport?.assetEvidence ?? []).filter(
      (entry) =>
        entry.sceneId === target.sceneId &&
        target.memberNodeIds.includes(entry.nodeId),
    );
    const expectedAlphaEvidenceCount =
      expectedRegisteredFamilyAlphaEvidenceCount(target);
    const alphaEvidenceCurrent =
      expectedAlphaEvidenceCount > 0 &&
      alphaEvidence.length === expectedAlphaEvidenceCount &&
      alphaEvidence.every((entry) => {
        const inspection = entry.alphaBandInspection;
        if (!inspection?.passed || !entry.renderSize) return false;
        const renderScaleCovered =
          inspection.scales?.some(({label}) => label === 'render-scale') ||
          (
            inspection.sourceSize?.width === Math.round(entry.renderSize.width) &&
            inspection.sourceSize?.height === Math.round(entry.renderSize.height)
          );
        return renderScaleCovered;
      });
    checks.push({
      id: 'alpha-band-proof-evidence',
      passed: alphaEvidenceCurrent,
      expected: 'all three members pass original and actual proof/render scale alpha-band inspection',
      actual: alphaEvidence.map((entry) => ({
        nodeId: entry.nodeId,
        passed: entry.alphaBandInspection?.passed ?? false,
        renderSize: entry.renderSize ?? null,
        scales: entry.alphaBandInspection?.scales?.map(({label}) => label) ?? [],
      })),
    });
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
  if (target.pattern === 'registered-depth-stack') {
    const registeredFamily = assertRegisteredFamilyGroupMembers({
      group: target.group,
      members: registeredGroupMembersForTarget(target),
      allRecords: target.familyContextRecords,
    });
    const layerProof = proofEntry?.layerStackProof;
    const layerArtifacts = [
      layerProof?.artifacts?.neutralReconstruction,
      layerProof?.artifacts?.referenceComparison,
      layerProof?.artifacts?.explodedView,
      ...(layerProof?.artifacts?.envelopeExtremes ?? []).map(
        ({file}) => file,
      ),
      ...(layerProof?.artifacts?.subjectTravelExtremes ?? []).map(
        ({file}) => file,
      ),
    ].filter(Boolean);
    const subjectTravelRequired = Boolean(
      target.group.layerStack?.subjectTravelEnvelope,
    );
    const layerArtifactsPresent =
      layerArtifacts.length === (subjectTravelRequired ? 9 : 6) &&
      (
        await Promise.all(
          layerArtifacts.map(async (file) => {
            try {
              return await fileExists(assertWorkspaceFile(file));
            } catch {
              return false;
            }
          }),
        )
      ).every(Boolean);
    const envelopeResults =
      layerProof?.artifacts?.envelopeExtremes ?? [];
    const subjectTravelResults =
      layerProof?.artifacts?.subjectTravelExtremes ?? [];
    checks.push(
      {
        id: 'registered-layer-family',
        passed: registeredFamily.passed,
        expected:
          'three complete full-canvas active members with complete source-family context for every state',
        actual: {
          passed: registeredFamily.passed,
          errors: registeredFamily.errors,
          familyIds: registeredFamily.familyIds,
          stateful: registeredFamily.stateful,
        },
      },
      {
        id: 'layer-proof-artifacts',
        passed: layerArtifactsPresent,
        expected:
          'neutral reconstruction, reference comparison, exploded view, and three responsive envelope extremes',
        actual: layerArtifacts,
      },
      {
        id: 'responsive-envelope-alpha',
        passed:
          envelopeResults.length === 3 &&
          envelopeResults.every(
            ({passed, transparentPixels}) =>
              passed && transparentPixels === 0,
          ),
        expected: 'zero transparent pixels at both extremes of all profiles',
        actual: envelopeResults.map(
          ({profile, passed, transparentPixels}) => ({
            profile,
            passed,
            transparentPixels,
          }),
        ),
      },
      {
        id: 'subject-travel-proof',
        passed:
          !subjectTravelRequired ||
          (
            subjectTravelResults.length === 3 &&
            subjectTravelResults.every(
              ({passed, transparentPixels}) =>
                passed && transparentPixels === 0,
            )
          ),
        expected:
          'when authored, subject-only lower-left and upper-right travel extremes remain complete in all responsive profiles',
        actual: subjectTravelResults.map(
          ({profile, passed, transparentPixels}) => ({
            profile,
            passed,
            transparentPixels,
          }),
        ),
      },
    );
    const alphaEvidence = (proofReport?.assetEvidence ?? []).filter(
      (entry) =>
        entry.sceneId === target.sceneId &&
        target.memberNodeIds.includes(entry.nodeId),
    );
    checks.push({
      id: 'alpha-band-proof-evidence',
      passed:
        alphaEvidence.length === 3 &&
        alphaEvidence.every(
          (entry) => entry.alphaBandInspection?.passed,
        ),
      expected:
        'all three complete members pass original and actual render-scale alpha-band inspection',
      actual: alphaEvidence.map((entry) => ({
        nodeId: entry.nodeId,
        passed: entry.alphaBandInspection?.passed ?? false,
      })),
    });
  }
  if (target.pattern === 'canonical-container') {
    const family = await inspectCanonicalContainerGroupMembers({
      root: ROOT,
      group: target.group,
      manifest: target.manifest,
    });
    const proof = proofEntry?.canonicalContainerProof;
    const artifactFiles = Object.values(
      proof?.artifacts ?? {},
    ).filter(Boolean);
    const artifactsCurrent =
      artifactFiles.length === 3 &&
      (
        await Promise.all(
          artifactFiles.map(async (file) => {
            try {
              const absolute = assertWorkspaceFile(file);
              return (
                await fileExists(absolute) &&
                await hashFile(absolute) ===
                  proof?.artifactHashes?.[file]
              );
            } catch {
              return false;
            }
          }),
        )
      ).every(Boolean);
    const contract = target.group.canonicalContainer;
    const terminal = contract.states.find(
      ({id}) => id === contract.terminalStateId,
    );
    checks.push(
      {
        id: 'canonical-container-family-current',
        passed: family.passed,
        expected: 'all canonical source and derived records current',
        actual: family.errors,
      },
      {
        id: 'canonical-container-proof',
        passed:
          proof?.passed === true &&
          artifactsCurrent &&
          proof?.familyFingerprint ===
            contract.familyFingerprint,
        expected: {
          passed: true,
          familyFingerprint: contract.familyFingerprint,
          artifactCount: 3,
        },
        actual: {
          passed: proof?.passed ?? false,
          familyFingerprint:
            proof?.familyFingerprint ?? null,
          artifactCount: artifactFiles.length,
        },
      },
      {
        id: 'canonical-container-authority',
        passed:
          target.group.children.filter(
            ({slot}) => slot === 'container-frame',
          ).length === 1 &&
          target.group.children.filter(
            ({semanticCoverage = []}) =>
              semanticCoverage.includes(
                `container-surface:${contract.authoritativeSurfaceId}`,
              ),
          ).length === 1,
        expected: 'one frame and one authoritative contents consumer',
        actual: target.group.children.map(
          ({id, slot, semanticCoverage}) => ({
            id,
            slot,
            semanticCoverage,
          }),
        ),
      },
      {
        id: 'canonical-container-state-metrics',
        passed: contract.states.every(
          ({metrics}) =>
            metrics.outsideMaskPixels === 0 &&
            metrics.centerDrift <=
              contract.alignmentPolicy.maximumCenterDrift &&
            metrics.bottomGap <=
              contract.alignmentPolicy.maximumBottomGap &&
            metrics.fillLevelDeviation <=
              contract.alignmentPolicy
                .maximumFillLevelDeviation &&
            metrics.interiorRetention >=
              contract.alignmentPolicy.minimumInteriorRetention,
        ),
        expected: contract.alignmentPolicy,
        actual: contract.states.map(({id, metrics}) => ({
          id,
          metrics,
        })),
      },
      {
        id: 'canonical-container-terminal',
        passed:
          terminal?.metrics.fillLevel >=
            contract.terminalPolicy.minimumFillLevel &&
          terminal?.metrics.rimGap <=
            contract.terminalPolicy.maximumRimGap &&
          terminal?.metrics.bottomBandCoverage >=
            contract.terminalPolicy
              .minimumBottomBandCoverage,
        expected: contract.terminalPolicy,
        actual: terminal?.metrics ?? null,
      },
    );
  }
  if (target.pattern === 'looping-environment') {
    const strips = target.group.children.filter(({kind}) => kind === 'world-strip');
    const stripRecords = target.familyRecords.filter(
      (record) => record?.adapter === 'looping-strip-derivative',
    );
    const bindingsCurrent =
      strips.length >= 2 &&
      strips.length === stripRecords.length &&
      stripRecords.every((record) => {
        const node = strips.find(({src}) =>
          path.normalize(path.relative(ROOT, resolvePublicFile(src))) ===
          path.normalize(record?.file ?? ''),
        );
        return (
          record?.adapter === 'looping-strip-derivative' &&
          record?.lifecycle?.status === 'active' &&
          node?.loopingStripBinding?.derivationFingerprint ===
            record.loopingStripBinding?.derivationFingerprint &&
          node?.role === record.loopingStripBinding?.role
        );
      });
    const worldProof = proofEntry?.loopingWorldProof;
    checks.push(
      {
        id: 'looping-strip-provenance',
        passed: bindingsCurrent,
        expected: 'all world-strip nodes bind active deterministic looping-strip derivatives',
        actual: bindingsCurrent,
      },
      {
        id: 'looping-world-proof',
        passed:
          worldProof?.passed === true &&
          worldProof.coverage?.every(({uncoveredPixels}) => uncoveredPixels === 0) &&
          worldProof.strips?.every(({seamPassed}) => seamPassed),
        expected: 'current seam, coverage, depth-speed, wrap, and camera-compensated world-motion proof',
        actual: worldProof ?? null,
      },
      {
        id: 'looping-world-visible-surfaces',
        passed:
          worldProof?.strips?.every(
            ({visibleSurfaceProof}) => visibleSurfaceProof?.passed === true,
          ) === true,
        expected:
          'every semantic strip has visible full-span source support and walkable ground has real support at both repeat edges',
        actual:
          worldProof?.strips?.map(
            ({nodeId, role, surfaceRole, visibleSurfaceProof}) => ({
              nodeId,
              role,
              surfaceRole,
              visibleSurfaceProof,
            }),
          ) ?? null,
      },
      {
        id: 'looping-world-subject-topology',
        passed:
          worldProof?.subjectProofs?.length ===
            target.group.loopingEnvironment.subjectBindings.length &&
          worldProof.subjectProofs.every(({proof}) => proof?.passed === true) &&
          worldProof.subjectOcclusions?.every(({passed}) => passed) === true,
        expected:
          'all screen/world anchored subjects follow their declared motion and near-layer occlusion relation',
        actual: {
          subjectProofs: worldProof?.subjectProofs ?? null,
          subjectOcclusions: worldProof?.subjectOcclusions ?? null,
        },
      },
    );
  }
  if (target.pattern === 'event') {
    checks.push(
      {id: 'event-proof-bound', passed: Boolean(target.event.proofTimeId), actual: target.event.proofTimeId ?? null},
      {id: 'event-sound-valid', passed: !target.event.sound || Boolean(target.event.sound.src), actual: target.event.sound?.src ?? 'not-required'},
    );
  }
  if (target.pattern === 'state-sequence') {
    const proofStateIds = new Set((target.proofTimeIds ?? []).flatMap((proofTimeId) => {
      const proof = proofFrames.find((frame) => frame.proofTimeId === proofTimeId);
      return proof ? [proofTimeId] : [];
    }));
    const registeredFamily =
      target.registeredFamilyGroup &&
      target.registeredFamilyGroup.pattern !==
        'canonical-container'
      ? assertRegisteredFamilyGroupMembers({
          group: target.registeredFamilyGroup,
          members: registeredGroupMembersForTarget({
            group: target.registeredFamilyGroup,
            familyRecords: target.registeredFamilyRecords,
          }),
          allRecords: target.registeredFamilyContextRecords,
        })
      : {passed: false, errors: [], familyIds: [], stateful: false};
    const registrationStatus = stateSequenceRegistrationStatus({
      sequence: target.sequence,
      stateRecords: target.stateRecords,
      registeredFamily,
      canonicalContainerGroup:
        target.registeredFamilyGroup?.pattern ===
        'canonical-container'
          ? target.registeredFamilyGroup
          : null,
    });
    const registeredDimensions = new Set(target.stateRecords.map((record) =>
      record?.media ? `${record.media.width}x${record.media.height}` : 'missing',
    ));
    const expectedDimensions = `${target.sequence.registration.canvas.width}x${target.sequence.registration.canvas.height}`;
    const anchorRegistrationProof = inspectStateAnchorRegistration({
      states: target.sequence.states,
      anchorPolicy: target.sequence.anchorPolicy,
    });
    const anchorEvidence = await Promise.all(target.stateRecords.map(async (record) => {
      const evidence = (record?.stateBinding ?? record?.request?.stateBinding)?.anchorEvidence;
      if (!evidence?.file || !evidence?.sha256) {
        return {
          file: evidence?.file ?? null,
          expectedSha256: evidence?.sha256 ?? null,
          actualSha256: null,
          passed: false,
        };
      }
      try {
        const file = assertWorkspaceFile(evidence.file);
        const actualSha256 = (await fileExists(file)) ? await hashFile(file) : null;
        return {
          file: evidence.file,
          expectedSha256: evidence.sha256,
          actualSha256,
          passed: actualSha256 === evidence.sha256,
        };
      } catch {
        return {
          file: evidence.file,
          expectedSha256: evidence.sha256,
          actualSha256: null,
          passed: false,
        };
      }
    }));
    const identityReferencesCurrent = target.sequence.states.every((state, index) => {
      const record = target.identityReferenceRecords[index];
      return (
        record?.lifecycle?.status === 'active' &&
        record.sha256 === state.identityReferenceSha256
      );
    });
    const facingsDeclared = target.sequence.states.every(
      ({facing}) => ['left', 'right', 'front', 'back', 'neutral'].includes(facing),
    );
    checks.push(
      {id: 'state-proofs-complete', passed: proofStateIds.size === target.proofTimeIds.length, expected: target.proofTimeIds.length, actual: proofStateIds.size},
      {
        id: 'registered-state-family',
        passed: registrationStatus.passed,
        actual: {
          mode: registrationStatus.mode,
          registeredFamily: {
            passed: registeredFamily.passed,
            errors: registeredFamily.errors,
            familyIds: registeredFamily.familyIds,
            stateful: registeredFamily.stateful,
          },
        },
      },
      {id: 'registered-state-dimensions', passed: registeredDimensions.size === 1 && registeredDimensions.has(expectedDimensions), expected: expectedDimensions, actual: [...registeredDimensions].join(', ')},
      {
        id: 'state-anchor-registration',
        passed:
          anchorRegistrationProof.passed &&
          (
            registrationStatus.registeredFamilyStatesBound ||
            registrationStatus.canonicalContainerStatesBound ||
            anchorEvidence.every(({passed}) => passed)
          ),
        expected:
          'declared anchor drift within policy plus current pose overlays or complete full-canvas registered-family context',
        actual: {
          anchorRegistrationProof,
          anchorEvidence,
          registeredFamilyStatesBound:
            registrationStatus.registeredFamilyStatesBound,
          canonicalContainerStatesBound:
            registrationStatus.canonicalContainerStatesBound,
        },
      },
      {
        id: 'state-facing-metadata',
        passed: facingsDeclared,
        expected: 'every state declares a valid facing for visual review',
        actual: target.sequence.states.map(({id, facing}) => ({stateId: id, facing})),
      },
      {
        id: 'state-identity-reference',
        passed: identityReferencesCurrent,
        expected: 'every state binds the current active identity-reference SHA-256',
        actual: target.sequence.states.map((state, index) => ({
          stateId: state.id,
          assetId: state.identityReferenceAssetId,
          expectedSha256: state.identityReferenceSha256,
          actualSha256: target.identityReferenceRecords[index]?.sha256 ?? null,
          lifecycleStatus: target.identityReferenceRecords[index]?.lifecycle?.status ?? null,
        })),
      },
    );
  }
  if (target.pattern === 'spatial-contract') {
    const spatialProof = proofEntry?.spatialProof;
    checks.push({
      id: 'spatial-contract-proof',
      passed:
        spatialProof?.contractId === target.spatialContract.id &&
        spatialProof?.kind === target.spatialContract.kind &&
        spatialProof?.passed === true,
      expected: {
        contractId: target.spatialContract.id,
        kind: target.spatialContract.kind,
        passed: true,
      },
      actual: spatialProof
        ? {
            contractId: spatialProof.contractId,
            kind: spatialProof.kind,
            passed: spatialProof.passed,
            failedChecks: spatialProof.checks
              ?.filter(({passed}) => !passed)
              .map(({id}) => id) ?? [],
          }
        : null,
    });
  }
  if (target.pattern === 'parallax-rig') {
    const depthLevels = new Set(target.depthMap.map(({depth}) => depth));
    checks.push(
      {id: 'parallax-enabled', passed: target.parallax?.enabled === true, expected: true, actual: target.parallax?.enabled ?? false},
      {id: 'parallax-depth-levels', passed: depthLevels.size >= 2, expected: '>= 2', actual: depthLevels.size},
    );
  }
  if (target.pattern === 'motif-field') {
    const field = target.motifField;
    const bounds = field.bounds;
    const boundsWithinCanvas =
      bounds?.x >= 0 &&
      bounds?.y >= 0 &&
      bounds?.width > 0 &&
      bounds?.height > 0 &&
      bounds.x + bounds.width <= 1 &&
      bounds.y + bounds.height <= 1;
    const exclusionIds = new Set();
    const exclusionsValid =
      Array.isArray(field.exclusionZones) &&
      field.exclusionZones.length <= 12 &&
      field.exclusionZones.every((zone) => {
        const uniqueId = typeof zone.id === 'string' && zone.id.length > 0 && !exclusionIds.has(zone.id);
        exclusionIds.add(zone.id);
        return (
          uniqueId &&
          ['rectangle', 'ellipse'].includes(zone.shape) &&
          zone.x >= 0 &&
          zone.y >= 0 &&
          zone.width > 0 &&
          zone.height > 0 &&
          zone.x + zone.width <= 1 &&
          zone.y + zone.height <= 1 &&
          (zone.padding === undefined || (zone.padding >= 0 && zone.padding <= 0.25))
        );
      });
    let placementError = null;
    let placedCount = 0;
    try {
      placedCount = resolveMotifFieldInstances(field).length;
    } catch (error) {
      placementError = error.message;
    }
    const loop = verifyMotifFieldLoop(field.fieldMotion);
    checks.push(
      {id: 'motif-count-bounded', passed: Number.isInteger(field.count) && field.count >= 1 && field.count <= MAX_MOTIF_INSTANCES_PER_FIELD, expected: `1..${MAX_MOTIF_INSTANCES_PER_FIELD}`, actual: field.count},
      {id: 'motif-seed-fixed', passed: Number.isInteger(field.seed), expected: 'integer', actual: field.seed},
      {id: 'motif-bounds-contained', passed: boundsWithinCanvas, expected: 'inside 0..1', actual: bounds},
      {id: 'motif-exclusions-valid', passed: exclusionsValid, expected: '<= 12 unique normalized zones', actual: field.exclusionZones},
      {id: 'motif-placement-complete', passed: placementError === null && placedCount === field.count, expected: field.count, actual: placementError ?? placedCount},
      {id: 'motif-loop-continuous', passed: loop.passed, expected: 'continuous transform or invisible respawn', actual: loop},
    );
  }
  if (target.pattern === 'typography') {
    const node = target.editorialNode;
    const layout = fitEditorialTypography({
      text: node.text,
      width: node.transform.width * target.video.width,
      height: (node.transform.height ?? node.transform.width) * target.video.height,
      minFontSize: node.treatment.fit.minFontSize,
      maxFontSize: node.treatment.fit.maxFontSize,
      maxLines: node.treatment.fit.maxLines,
      lineHeight: node.treatment.style.lineHeight,
      letterSpacing: node.treatment.style.letterSpacing ?? 0,
    });
    const pointIds = [
      ...(node.treatment.reveal?.editPointIds ?? []),
      ...(node.treatment.emphasis ?? []).map(({editPointId}) => editPointId),
    ];
    const timingBound = pointIds.every((editPointId) =>
      target.editorial.resolvedEditPoints.some(
        (point) => point.id === editPointId && point.sceneId === target.sceneId,
      ),
    );
    checks.push(
      {id: 'typography-fit', passed: !layout.overflow, expected: 'no overflow', actual: layout},
      {id: 'typography-edit-points', passed: timingBound, expected: pointIds, actual: timingBound},
    );
    if (node.role === 'visual-sfx') {
      const showEvents = (target.events ?? []).filter(
        ({visual}) =>
          visual?.kind === 'visibility' && visual.action === 'show',
      );
      const hideEvents = (target.events ?? []).filter(
        ({visual}) =>
          visual?.kind === 'visibility' && visual.action === 'hide',
      );
      const soundEvents = (target.events ?? []).filter(({sound}) => sound);
      const beatIds = new Set(showEvents.map(({beatId}) => beatId));
      const audioSynchronized = soundEvents.some(
        ({beatId, at}) =>
          beatIds.has(beatId) &&
          showEvents.some(
            (show) => show.beatId === beatId && Math.abs(show.at - at) <= 0.035,
          ),
      );
      checks.push(
        {
          id: 'visual-sfx-event-lifecycle',
          passed: showEvents.length > 0 && hideEvents.length > 0,
          expected: 'show then hide',
          actual: {show: showEvents.length, hide: hideEvents.length},
        },
        {
          id: 'visual-sfx-audio-sync',
          passed: audioSynchronized,
          expected: 'sound and show within 0.035 normalized time',
          actual: audioSynchronized,
        },
      );
    }
  }
  if (target.pattern === 'annotation') {
    const route = resolveAnnotationRoute({
      node: target.editorialNode,
      nodes: target.sceneNodes,
      zones: target.exclusionZones,
    });
    checks.push(
      {id: 'annotation-route', passed: route.valid, expected: 'valid', actual: route},
      {id: 'annotation-exclusions', passed: route.valid && !route.directBlocked, expected: 'clear', actual: route.directBlocked},
    );
  }
  if (target.pattern === 'data-graphic') {
    const dataIssues = validateDataGraphicNode(target.editorialNode);
    const timingBound = (target.editorialNode.states ?? []).every(({editPointId}) =>
      target.editorial.resolvedEditPoints.some(
        (point) => point.id === editPointId && point.sceneId === target.sceneId,
      ),
    );
    checks.push(
      {id: 'data-schema', passed: dataIssues.length === 0, expected: [], actual: dataIssues},
      {id: 'data-edit-points', passed: timingBound, expected: true, actual: timingBound},
    );
  }
  if (target.pattern === 'editorial-transition') {
    const invalid = target.editorialTransition.invalidProfiles ?? [];
    checks.push({
      id: 'editorial-transition-continuity',
      passed: invalid.length === 0 || target.editorialTransition.invalidPolicy === 'fallback',
      expected: 'valid or deterministic fallback',
      actual: target.editorialTransition.continuity,
    });
  }
  if (target.pattern === 'responsive-directing') {
    const bounded = target.responsive.scenes.every(
      ({densityUsed}) => densityUsed <= target.responsive.densityBudget,
    );
    checks.push({
      id: 'responsive-density-budget',
      passed: bounded,
      expected: `<= ${target.responsive.densityBudget}`,
      actual: target.responsive.scenes.map(({sceneId, densityUsed}) => ({sceneId, densityUsed})),
    });
  }
  return {
    passed: checks.every(({passed}) => passed),
    checks,
    proofFrames,
    temporalEvidence,
  };
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

const qualityEntryId = (entry) => entry.assetId ?? entry.compositeId;

export const qualityReviewTargetFingerprint = (entry) =>
  hashCompositionValue({
    id: qualityEntryId(entry),
    reviewScope: entry.reviewScope,
    contentFingerprint: entry.fingerprint ?? entry.sha256 ?? null,
    requiredChecks: entry.requiredChecks ?? [],
    technical: entry.technical ?? null,
    proofFrames: entry.proofFrames ?? [],
    evidenceFiles: entry.evidenceFiles ?? [],
    temporalEvidence: entry.temporalEvidence ?? null,
  });

export const refreshQualityReviewSurfaceFingerprint = (report) => {
  const entries = [...(report.assets ?? []), ...(report.composites ?? [])]
    .map((entry) => ({
      id: qualityEntryId(entry),
      targetFingerprint: qualityReviewTargetFingerprint(entry),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  report.reviewSurfaceFingerprint = hashCompositionValue({
    contract: 'quality-review-surface-v2',
    projectSlug: report.projectSlug,
    entries,
  });
  return report.reviewSurfaceFingerprint;
};

export const summarizeQualityReport = (report) => {
  const assets = summarizeEntries(report.assets ?? []);
  const composites = summarizeEntries(report.composites ?? []);
  const total = {total: assets.total + composites.total, passed: assets.passed + composites.passed, pending: assets.pending + composites.pending, failed: assets.failed + composites.failed};
  return {ready: total.pending === 0 && total.failed === 0, actualPassed: total.pending === 0 && total.failed === 0, ...total, scopes: {assets, composites}, report};
};

const evidenceFilesAreCurrent = async (evidenceFiles) => {
  if (!Array.isArray(evidenceFiles) || evidenceFiles.length === 0) return true;
  try {
    const current = await Promise.all(evidenceFiles.map(async (evidence) => {
      if (typeof evidence?.file !== 'string' || typeof evidence?.sha256 !== 'string') return false;
      const absoluteFile = assertWorkspaceFile(evidence.file);
      return (await fileExists(absoluteFile)) && await hashFile(absoluteFile) === evidence.sha256;
    }));
    return current.every(Boolean);
  } catch {
    return false;
  }
};

const preservedReview = async ({previous, fingerprint, requiredChecks}) => {
  const sameTarget = previous?.fingerprint === fingerprint || previous?.sha256 === fingerprint;
  const preserve = sameTarget && await evidenceFilesAreCurrent(previous?.evidenceFiles);
  return {
    semanticChecks: Object.fromEntries(requiredChecks.map((check) => [check, preserve ? previous.semanticChecks?.[check] ?? 'pending' : 'pending'])),
    reviewer: preserve ? previous.reviewer ?? null : null,
    reviewedAt: preserve ? previous.reviewedAt ?? null : null,
    note: preserve ? previous.note ?? '' : '',
    evidenceFiles: preserve ? previous.evidenceFiles ?? [] : [],
  };
};

export const prepareQualityReport = async (
  slug,
  {
    write = true,
    allowPendingSemanticEvidenceTargets = false,
  } = {},
) => {
  const {project} = await loadProject(slug);
  const file = qualityReportPath(slug);
  const existing = (await fileExists(file)) ? await readJson(file) : null;
  const manifest = await readManifest(project);
  const semanticContracts = await loadSemanticContracts(slug);
  if (semanticContracts.issues.length) {
    throw new Error(
      semanticContracts.issues.map(({location, message}) => `${location}: ${message}`).join('\n'),
    );
  }
  const previousAssets = new Map((existing?.assets ?? []).map((entry) => [entry.assetId, entry]));
  const previousComposites = new Map((existing?.composites ?? []).map((entry) => [entry.compositeId, entry]));
  const assets = await collectQualityAssets(project, manifest, semanticContracts);
  const inspectedAssets = await Promise.all(assets.map(async (asset) => {
    const absoluteFile = assertWorkspaceFile(asset.file);
    const sha256 = (await fileExists(absoluteFile)) ? await hashFile(absoluteFile) : null;
    const baseRequiredChecks =
      asset.requiredChecks !== undefined
        ? asset.requiredChecks
        : QUALITY_PROFILES[asset.kind] ?? QUALITY_PROFILES.image;
    const requiredChecks = [
      ...new Set([
        ...baseRequiredChecks,
        ...(asset.reviewScope === 'derivation-only'
          ? []
          : project.styleProfile?.quality?.requiredAssetChecks ?? []),
      ]),
    ];
    const unknownChecks = requiredChecks.filter((check) => !ASSET_QUALITY_CHECKS.includes(check));
    if (unknownChecks.length) throw new Error(`${asset.assetId} 含未知资产质量检查：${unknownChecks.join(', ')}`);
    const fingerprint = hashCompositionValue({
      sha256,
      styleProfileFingerprint:
        project.styleProfile?.profileFingerprint ?? null,
      semanticBinding: asset.semanticBinding,
      semanticContractFingerprints: asset.semanticContractFingerprints,
      stateSheetBinding: asset.stateSheetBinding,
      stateSheetRecoveryBinding: asset.stateSheetRecoveryBinding,
      registeredFamilyBinding: asset.registeredFamilyBinding,
      canonicalContainerBinding:
        asset.canonicalContainerBinding,
      recoverySourceSha256: asset.recoverySourceSha256,
      reviewScope: asset.reviewScope,
      manifestRecordId: asset.manifestRecordId,
      manifestSha256: asset.manifestSha256,
    });
    const review = await preservedReview({previous: previousAssets.get(asset.assetId), fingerprint, requiredChecks});
    const technical = await inspectTechnicalQuality({asset, project});
    return {...asset, sha256, fingerprint, requiredChecks, technical, ...review, status: entryStatus({technical, semanticChecks: review.semanticChecks})};
  }));

  const proofFile = compositionProofReportPath(slug);
  const styleProofFile = path.join(ROOT, 'dist', slug, 'style-motion-proof.json');
  const proofReports = [];
  if (await fileExists(proofFile)) proofReports.push(await readJson(proofFile));
  if (await fileExists(styleProofFile)) proofReports.push(await readJson(styleProofFile));
  const targets = await collectCompositeQualityTargets(project, {
    manifest,
    allowPendingSemanticEvidenceTargets,
  });
  const inspectedComposites = await Promise.all(targets.map(async (target) => {
    const review = await preservedReview({previous: previousComposites.get(target.compositeId), fingerprint: target.fingerprint, requiredChecks: target.requiredChecks});
    const currentProofReport = proofReports.find((report) =>
      report.composites?.some(
        ({compositeId, fingerprint}) =>
          compositeId === target.compositeId &&
          fingerprint === target.fingerprint,
      ));
    const technical = await inspectCompositeTechnical({
      target,
      proofReport: currentProofReport ?? null,
    });
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
      temporalEvidence: technical.temporalEvidence ?? null,
      reviewScope: target.reviewScope,
      requiredChecks: target.requiredChecks,
      technical: {passed: technical.passed, checks: technical.checks},
      ...review,
      status: entryStatus({technical, semanticChecks: review.semanticChecks}),
    };
  }));
  const timeline = deriveTimeline(project);
  const report = {
    $schema: '../../schemas/quality-report.schema.json',
    schemaVersion: 7,
    projectSlug: slug,
    updatedAt: new Date().toISOString(),
    styleProfile: project.styleProfile
      ? {
          id: project.styleProfile.id,
          profileFingerprint: project.styleProfile.profileFingerprint,
          referenceFile: path.join(
            'public',
            project.styleProfile.referenceImage,
          ),
          referenceSha256: await hashFile(
            resolvePublicFile(project.styleProfile.referenceImage),
          ),
          reviewFocus: project.styleProfile.quality.reviewFocus,
        }
      : null,
    motionContract: project.motionContract
      ? {
          approvalFingerprint:
            project.motionContract.approvalFingerprint,
          executionFingerprint: project.motionContract.fingerprint,
          summary: project.motionContract.direction.summary,
          requiredCompositeChecks:
            project.motionContract.requiredCompositeChecks,
        }
      : null,
    eventTimeline: timeline.scenes.flatMap((scene) => deriveEventTimeline({scene, sceneFrom: scene.from, fps: project.video.fps})),
    assetHistory: (manifest.assets ?? [])
      .filter(({lifecycle}) => lifecycle.status !== 'active')
      .map(({recordId, assetId, file: assetFile, sha256, lifecycle}) => ({
        recordId,
        assetId,
        file: assetFile,
        sha256,
        lifecycle,
      })),
    assets: inspectedAssets,
    composites: inspectedComposites,
  };
  refreshQualityReviewSurfaceFingerprint(report);
  if (write) await writeJson(file, report);
  return {file, ...summarizeQualityReport(report)};
};

export const recordQualityReviews = async ({
  slug,
  reviews,
  sourceReportFingerprint = null,
  allowPendingSemanticEvidenceTargets = false,
}) => {
  if (!Array.isArray(reviews) || reviews.length === 0) throw new Error('批量质量记录必须包含至少一项 review。');
  const prepared = await prepareQualityReport(slug, {
    write: false,
    allowPendingSemanticEvidenceTargets,
  });
  if (
    sourceReportFingerprint !== null &&
    sourceReportFingerprint !== prepared.report.reviewSurfaceFingerprint
  ) {
    throw new Error(
      `质量审核 scaffold 已过期：记录 ${sourceReportFingerprint}，当前 ${prepared.report.reviewSurfaceFingerprint}。重新运行 project:quality ${slug} scaffold --force。`,
    );
  }
  const entries = [...prepared.report.assets, ...prepared.report.composites];
  const normalized = [];
  const reviewedIds = new Set();
  for (const review of reviews) {
    const reviewId = review.assetId ?? review.compositeId;
    const entry = entries.find((candidate) => (candidate.assetId ?? candidate.compositeId) === reviewId);
    if (!entry) throw new Error(`未知质量对象：${reviewId}`);
    const targetFingerprint = qualityReviewTargetFingerprint(entry);
    if (
      review.targetFingerprint !== undefined &&
      review.targetFingerprint !== targetFingerprint
    ) {
      throw new Error(
        `${reviewId} 的审核目标已过期：记录 ${review.targetFingerprint}，当前 ${targetFingerprint}。`,
      );
    }
    if (reviewedIds.has(reviewId)) throw new Error(`批量质量记录不能重复包含对象：${reviewId}`);
    reviewedIds.add(reviewId);
    if (!review.reviewer?.trim()) throw new Error(`${reviewId} 的质量记录必须提供 reviewer。`);
    const passedChecks = review.passedChecks ?? [];
    const failedChecks = review.failedChecks ?? [];
    for (const check of [...passedChecks, ...failedChecks]) {
      if (!QUALITY_CHECKS.includes(check)) throw new Error(`未知质量检查：${check}`);
      if (!entry.requiredChecks.includes(check)) throw new Error(`${reviewId} 不需要质量检查 ${check}。`);
    }
    const evidenceFiles = [];
    if (review.evidenceFiles === undefined) {
      for (const evidence of entry.evidenceFiles ?? []) {
        if (await evidenceFilesAreCurrent([evidence])) evidenceFiles.push(evidence);
      }
    } else {
      for (const evidence of review.evidenceFiles) {
        const evidenceFile =
          typeof evidence === 'string' ? evidence : evidence?.file;
        if (typeof evidenceFile !== 'string' || evidenceFile.trim().length === 0) throw new Error(`${reviewId} 的 evidenceFiles 必须包含非空路径和 SHA-256。`);
        const absoluteFile = assertWorkspaceFile(evidenceFile.trim());
        if (!(await fileExists(absoluteFile))) throw new Error(`${reviewId} 的质量证据不存在：${evidenceFile}`);
        const sha256 = await hashFile(absoluteFile);
        if (
          typeof evidence === 'object' &&
          evidence !== null &&
          evidence.sha256 !== sha256
        ) {
          throw new Error(`${reviewId} 的质量证据已变化：${evidenceFile}。请重新生成 scaffold。`);
        }
        evidenceFiles.push({file: path.relative(ROOT, absoluteFile), sha256});
      }
    }
    if (passedChecks.some((check) => EVIDENCE_REQUIRED_CHECKS.has(check)) && evidenceFiles.length === 0) {
      throw new Error(`${reviewId} 的证据型质量检查必须提供 evidenceFiles。`);
    }
    if (
      requiresTemporalEvidence(entry) &&
      !entry.temporalEvidence
    ) {
      throw new Error(
        `${reviewId} 需要当前 temporal evidence 才能记录质量结果；先重新运行 project:composition-proof 或 project:style-proof。`,
      );
    }
    normalized.push({entry, reviewId, reviewer: review.reviewer.trim(), passedChecks, failedChecks, note: (review.note ?? '').trim(), evidenceFiles});
  }
  const changedIds = [];
  for (const item of normalized) {
    for (const check of item.passedChecks) item.entry.semanticChecks[check] = 'passed';
    for (const check of item.failedChecks) item.entry.semanticChecks[check] = 'failed';
    item.entry.status = entryStatus(item.entry);
    item.entry.reviewer = item.reviewer;
    item.entry.reviewedAt = new Date().toISOString();
    item.entry.note = item.note;
    if (item.evidenceFiles.length > 0) item.entry.evidenceFiles = item.evidenceFiles;
    changedIds.push(item.reviewId);
  }
  prepared.report.updatedAt = new Date().toISOString();
  refreshQualityReviewSurfaceFingerprint(prepared.report);
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

const proofEvidenceFiles = (proofFrame) =>
  [proofFrame?.fullFrame, proofFrame?.crop, proofFrame?.debugFrame].filter(Boolean);

const layerStackProofEvidenceFiles = (layerStackProof) =>
  [
    layerStackProof?.artifacts?.neutralReconstruction,
    layerStackProof?.artifacts?.referenceComparison,
    layerStackProof?.artifacts?.explodedView,
    ...(layerStackProof?.artifacts?.envelopeExtremes ?? []).map(
      ({file}) => file,
    ),
    ...(layerStackProof?.artifacts?.subjectTravelExtremes ?? []).map(
      ({file}) => file,
    ),
  ].filter(Boolean);

const canonicalContainerProofEvidenceFiles = (
  canonicalContainerProof,
) =>
  Object.values(
    canonicalContainerProof?.artifacts ?? {},
  ).filter(Boolean);

const assetEvidenceFiles = (entry) =>
  [
    entry?.alphaMask,
    entry?.checkerboard,
    entry?.tightCrop,
    entry?.motionStress,
    entry?.alphaBandReport,
    entry?.alphaBandOverlay,
  ]
    .filter(Boolean);

const currentProofCompositeFor = (proofReports, composite) =>
  proofReports
    .flatMap((report) => report.composites ?? [])
    .find(
      ({compositeId, fingerprint}) =>
        compositeId === composite.compositeId &&
        fingerprint === composite.fingerprint,
    );

const evidenceRecordsFor = async (files) =>
  (
    await Promise.all(
      [...new Set(files.filter(Boolean))].map(async (file) => {
        try {
          const absoluteFile = assertWorkspaceFile(file);
          if (!(await fileExists(absoluteFile))) return null;
          return {
            file: path.relative(ROOT, absoluteFile),
            sha256: await hashFile(absoluteFile),
          };
        } catch {
          return null;
        }
      }),
    )
  ).filter(Boolean);

export const createQualityReviewScaffold = async ({
  status,
  projectSlug,
  reviewer,
  compositionProof = null,
  styleProof = null,
  includePassed = false,
  reviewScope = 'all',
}) => {
  if (!['all', 'style'].includes(reviewScope)) {
    throw new Error('质量审核 scope 必须是 all 或 style。');
  }
  const proofReports = [compositionProof, styleProof].filter(Boolean);
  const currentProofReports = proofReports.filter((report) =>
    (status.report.composites ?? []).some((composite) =>
      currentProofCompositeFor([report], composite),
    ),
  );
  const proofAssets = currentProofReports.flatMap((report) => report.assetEvidence ?? []);
  const evidenceForAsset = (asset) => {
    const files = [asset.file];
    if (
      asset.requiredChecks?.includes('style-profile-conformant') &&
      status.report.styleProfile?.referenceFile
    ) {
      files.push(status.report.styleProfile.referenceFile);
    }
    const normalizedAssetFile = path.normalize(asset.file);
    for (const entry of proofAssets) {
      const sourceFile = entry.source
        ? path.relative(ROOT, resolvePublicFile(entry.source))
        : null;
      if (sourceFile && path.normalize(sourceFile) === normalizedAssetFile) {
        files.push(...assetEvidenceFiles(entry));
      }
    }
    const sourceBindings = (asset.sources ?? [])
      .map((source) => source.match(/^scene:([^:]+):node:(.+)$/))
      .filter(Boolean)
      .map((match) => ({sceneId: match[1], nodeId: match[2]}));
    for (const composite of status.report.composites ?? []) {
      if (!(composite.memberNodeIds ?? []).some((nodeId) =>
        sourceBindings.some((binding) => binding.nodeId === nodeId),
      )) continue;
      const proof = currentProofCompositeFor(currentProofReports, composite);
      files.push(...(proof?.proofFrames ?? []).flatMap(proofEvidenceFiles));
    }
    return [...new Set(files.filter(Boolean))];
  };
  const evidenceForComposite = (composite) => {
    const proof = currentProofCompositeFor(currentProofReports, composite);
    if (!proof) {
      throw new Error(
        `${composite.compositeId} 缺少与当前组合指纹一致的视觉证明；先重新运行 project:composition-proof 或 project:style-proof，不能复用旧帧。`,
      );
    }
    if (requiresTemporalEvidence(composite) && !composite.temporalEvidence) {
      throw new Error(
        `${composite.compositeId} 是需要动态证据的组合目标，但缺少当前 temporal evidence；先重新运行 project:composition-proof 或 project:style-proof。`,
      );
    }
    const files = [
      ...(proof?.proofFrames ?? []).flatMap(proofEvidenceFiles),
      ...layerStackProofEvidenceFiles(proof?.layerStackProof),
      ...canonicalContainerProofEvidenceFiles(
        proof?.canonicalContainerProof,
      ),
    ];
    if (
      composite.requiredChecks?.includes('style-profile-consistent') &&
      status.report.styleProfile?.referenceFile
    ) {
      files.push(status.report.styleProfile.referenceFile);
    }
    files.push(
      ...(proof?.loopingWorldProof?.strips ?? [])
        .map(({derivationReport}) => derivationReport)
        .filter(Boolean),
    );
    for (const nodeId of composite.memberNodeIds ?? []) {
      for (const entry of proofAssets.filter((candidate) => candidate.nodeId === nodeId)) {
        files.push(...assetEvidenceFiles(entry));
      }
    }
    return [...new Set(files.filter(Boolean))];
  };
  const styleCompositeIds = new Set(
    reviewScope === 'style'
      ? (styleProof?.composites ?? [])
          .filter((proof) =>
            (status.report.composites ?? []).some(
              (composite) =>
                composite.compositeId === proof.compositeId &&
                composite.fingerprint === proof.fingerprint,
            ),
          )
          .map(({compositeId}) => compositeId)
      : [],
  );
  const entries = [...status.report.assets, ...status.report.composites]
    .filter((entry) => includePassed || entry.status !== 'passed')
    .filter(
      (entry) =>
        reviewScope !== 'style' ||
        Boolean(entry.assetId) ||
        styleCompositeIds.has(entry.compositeId),
    );
  const reviews = [];
  for (const entry of entries) {
    const assetId = entry.assetId ?? null;
    const compositeId = entry.compositeId ?? null;
    const proof = compositeId
      ? currentProofCompositeFor(currentProofReports, entry)
      : null;
    const evidenceClasses = compositeId
      ? [
          ...new Set([
            ...((proof?.proofFrames ?? []).some(({fullFrame}) => fullFrame)
              ? ['full']
              : []),
            ...((proof?.proofFrames ?? []).some(({crop}) => crop)
              ? ['crop']
              : []),
            ...((proof?.proofFrames ?? []).some(({debugFrame}) => debugFrame)
              ? ['debug']
              : []),
            ...(entry.temporalEvidence ? ['temporal'] : []),
          ]),
        ]
      : [];
    const evidenceFiles = await evidenceRecordsFor(
      assetId
        ? [...new Set([...evidenceForAsset(entry), ...(entry.recoveryEvidenceFiles ?? [])])]
        : [
            ...evidenceForComposite(entry),
            ...(entry.temporalEvidence
              ? [
                  entry.temporalEvidence.file,
                  ...(entry.temporalEvidence.frames ?? []).map(
                    ({file}) => file,
                  ),
                ]
              : []),
          ],
    );
    entry.evidenceFiles = evidenceFiles;
    reviews.push({
      ...(assetId ? {assetId} : {compositeId}),
      reviewer,
      ...(compositeId ? {evidenceClasses} : {}),
      ...(compositeId
        ? {temporalEvidence: entry.temporalEvidence ?? null}
        : {}),
      requiredChecks: entry.requiredChecks,
      pendingChecks: Object.entries(entry.semanticChecks)
        .filter(([, checkStatus]) => checkStatus !== 'passed')
        .map(([check]) => check),
      passedChecks: [],
      failedChecks: [],
      evidenceFiles,
      note: '',
    });
  }
  refreshQualityReviewSurfaceFingerprint(status.report);
  for (const review of reviews) {
    const entry = entries.find(
      (candidate) =>
        qualityEntryId(candidate) === (review.assetId ?? review.compositeId),
    );
    review.targetFingerprint = qualityReviewTargetFingerprint(entry);
  }
  return {
    $schema: '../../schemas/quality-review-scaffold.schema.json',
    schemaVersion: 4,
    projectSlug,
    reviewScope,
    generatedAt: new Date().toISOString(),
    sourceReport: {
      file: path.relative(ROOT, status.file ?? qualityReportPath(projectSlug)),
      schemaVersion: status.report.schemaVersion,
      fingerprint:
        status.report.reviewSurfaceFingerprint ??
        refreshQualityReviewSurfaceFingerprint(status.report),
    },
    instructions:
      'Inspect every evidence file. Move each pending check into passedChecks or failedChecks and write a concrete note; never pass a check only to unblock production.',
    reviews,
  };
};

export const buildQualityReviewScaffold = async ({
  slug,
  reviewer = 'host-vision',
  includePassed = false,
  reviewScope = 'all',
}) => {
  const status = await prepareQualityReport(slug, {
    allowPendingSemanticEvidenceTargets: reviewScope === 'style',
  });
  const compositionFile = compositionProofReportPath(slug);
  const styleFile = path.join(ROOT, 'dist', slug, 'style-motion-proof.json');
  const [compositionProof, styleProof] = await Promise.all([
    (await fileExists(compositionFile)) ? readJson(compositionFile) : null,
    (await fileExists(styleFile)) ? readJson(styleFile) : null,
  ]);
  const scaffold = await createQualityReviewScaffold({
    status,
    projectSlug: slug,
    reviewer,
    compositionProof,
    styleProof,
    includePassed,
    reviewScope,
  });
  status.report.updatedAt = new Date().toISOString();
  scaffold.sourceReport = {
    file: path.relative(ROOT, status.file),
    schemaVersion: status.report.schemaVersion,
    fingerprint: status.report.reviewSurfaceFingerprint,
  };
  const currentEntries = new Map(
    [...status.report.assets, ...status.report.composites].map((entry) => [
      qualityEntryId(entry),
      entry,
    ]),
  );
  for (const review of scaffold.reviews) {
    review.targetFingerprint = qualityReviewTargetFingerprint(
      currentEntries.get(review.assetId ?? review.compositeId),
    );
  }
  await writeJson(status.file, status.report);
  return {status, scaffold};
};

export const assertQualityReviewScaffoldCurrent = async ({
  slug,
  scaffold,
  status = null,
}) => {
  if (scaffold?.schemaVersion !== 4 || scaffold?.projectSlug !== slug) {
    throw new Error(`质量审核 scaffold 必须是 ${slug} 的 schemaVersion 4 文件。`);
  }
  if (!scaffold?.sourceReport?.fingerprint) {
    throw new Error('质量审核 scaffold 缺少 sourceReport.fingerprint。');
  }
  const prepared = status ?? await prepareQualityReport(slug, {
    write: false,
    allowPendingSemanticEvidenceTargets: scaffold.reviewScope === 'style',
  });
  if (
    scaffold.sourceReport.fingerprint !==
    prepared.report.reviewSurfaceFingerprint
  ) {
    throw new Error(
      `质量审核 scaffold 已过期：记录 ${scaffold.sourceReport.fingerprint}，当前 ${prepared.report.reviewSurfaceFingerprint}。`,
    );
  }
  const entries = new Map(
    [...prepared.report.assets, ...prepared.report.composites].map((entry) => [
      qualityEntryId(entry),
      entry,
    ]),
  );
  for (const review of scaffold.reviews ?? []) {
    const reviewId = review.assetId ?? review.compositeId;
    const entry = entries.get(reviewId);
    if (!entry) throw new Error(`质量审核 scaffold 引用了未知对象：${reviewId}`);
    const expected = qualityReviewTargetFingerprint(entry);
    if (review.targetFingerprint !== expected) {
      throw new Error(
        `${reviewId} 的审核目标已过期：记录 ${review.targetFingerprint ?? 'missing'}，当前 ${expected}。`,
      );
    }
    if (!(await evidenceFilesAreCurrent(review.evidenceFiles))) {
      throw new Error(`${reviewId} 的质量证据文件已缺失或内容变化；请重新生成 scaffold。`);
    }
    const temporalCurrent = await Promise.all(
      [
        {file: review.temporalEvidence?.file, sha256: review.temporalEvidence?.sha256},
        ...(review.temporalEvidence?.frames ?? []).map(({file, sha256}) => ({
          file,
          sha256,
        })),
      ].filter(({file}) => Boolean(file)).map(async ({file, sha256}) => {
        try {
          const absoluteFile = assertWorkspaceFile(file);
          return (
            (await fileExists(absoluteFile)) &&
            (await hashFile(absoluteFile)) === sha256
          );
        } catch {
          return false;
        }
      }),
    );
    if (
      review.compositeId &&
      requiresTemporalEvidence(entry) &&
      (
        !review.temporalEvidence ||
        !temporalCurrent.every(Boolean)
      )
    ) {
      throw new Error(
        `${review.compositeId} 的动态证据缺失或已变化；请重新运行 project:composition-proof 后重新生成 scaffold。`,
      );
    }
  }
  return prepared;
};

const escapeSvgText = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

export const qualityReviewPanel = async ({review, index}) => {
  const temporalEvidence = review.temporalEvidence ?? null;
  const preferred = temporalEvidence?.file
    ? [{file: temporalEvidence.file}]
    : [];
  const seen = new Set();
  const imageEvidence = [];
  for (const evidence of [...preferred, ...(review.evidenceFiles ?? [])]) {
    try {
      const file = assertWorkspaceFile(evidence.file);
      if (seen.has(file)) continue;
      seen.add(file);
      if (!(await fileExists(file))) continue;
      const metadata = await sharp(file).metadata();
      if (metadata.width && metadata.height) {
        imageEvidence.push({
          file,
          relativeFile: path.relative(ROOT, file),
          sha256: await hashFile(file),
        });
      }
    } catch {
      // Non-image evidence remains available in the scaffold but is not a panel.
    }
  }
  const selected = imageEvidence[0] ?? null;
  const panelWidth = 360;
  const imageHeight = 202;
  const labelHeight = 58;
  const image = selected
    ? await sharp(selected.file)
        .resize(panelWidth, imageHeight, {
          fit: 'contain',
          background: '#1c1714',
        })
        .flatten({background: '#1c1714'})
        .png()
        .toBuffer()
    : Buffer.from(`
        <svg width="${panelWidth}" height="${imageHeight}">
          <rect width="100%" height="100%" fill="#1c1714"/>
          <text x="50%" y="50%" text-anchor="middle" fill="#b9aa96"
            font-size="18" font-family="Arial, PingFang SC, sans-serif">no image evidence</text>
        </svg>
      `);
  const id = review.assetId ?? review.compositeId;
  const label = Buffer.from(`
    <svg width="${panelWidth}" height="${labelHeight}">
      <rect width="100%" height="100%" fill="#2b1713"/>
      <text x="12" y="23" fill="#f6ead2" font-size="15"
        font-family="Arial, PingFang SC, sans-serif">${escapeSvgText(`${index + 1}. ${id}`)}</text>
      <text x="12" y="45" fill="#d9c6aa" font-size="12"
        font-family="Arial, PingFang SC, sans-serif">${escapeSvgText(
          `${(review.pendingChecks ?? []).length} pending · ${temporalEvidence ? 'temporal' : 'static'} · ${selected?.relativeFile ?? 'no image evidence'}`,
        )}</text>
    </svg>
  `);
  return {
    id,
    targetFingerprint: review.targetFingerprint,
    temporalEvidence: Boolean(temporalEvidence),
    selectedFile: selected?.relativeFile ?? null,
    evidence: imageEvidence.map(({file: _file, ...evidence}) => evidence),
    panel: await sharp({
      create: {
        width: panelWidth,
        height: imageHeight + labelHeight,
        channels: 3,
        background: '#1c1714',
      },
    })
      .composite([
        {input: image, left: 0, top: 0},
        {input: label, left: 0, top: imageHeight},
      ])
      .jpeg({quality: 90})
      .toBuffer(),
  };
};

export const createQualityReviewContactSheets = async ({
  slug,
  scaffold,
  outputDirectory = path.join(
    ROOT,
    'dist',
    slug,
    'quality-review-contact-sheets',
  ),
}) => {
  const status = await assertQualityReviewScaffoldCurrent({slug, scaffold});
  const directory = assertWorkspaceFile(outputDirectory);
  await fs.mkdir(directory, {recursive: true});
  const panels = await Promise.all(
    (scaffold.reviews ?? []).map((review, index) =>
      qualityReviewPanel({review, index}),
    ),
  );
  if (panels.length === 0) {
    throw new Error('当前质量审核 scaffold 没有待展示的 review。');
  }
  const scaffoldFingerprint = hashCompositionValue(scaffold);
  const pageSize = 18;
  const pages = [];
  for (let pageIndex = 0; pageIndex < panels.length; pageIndex += pageSize) {
    const pagePanels = panels.slice(pageIndex, pageIndex + pageSize);
    const columns = Math.min(3, pagePanels.length);
    const rows = Math.ceil(pagePanels.length / columns);
    const panelWidth = 360;
    const panelHeight = 260;
    const padding = 20;
    const gap = 12;
    const width =
      padding * 2 + panelWidth * columns + gap * Math.max(0, columns - 1);
    const height =
      padding * 2 + panelHeight * rows + gap * Math.max(0, rows - 1);
    const composite = pagePanels.map((panel, panelIndex) => ({
      input: panel.panel,
      left: padding + (panelIndex % columns) * (panelWidth + gap),
      top: padding + Math.floor(panelIndex / columns) * (panelHeight + gap),
    }));
    const pageNumber = pages.length + 1;
    const pageFile = path.join(
      directory,
      `quality-review-${status.report.reviewSurfaceFingerprint.slice(0, 12)}-page-${String(pageNumber).padStart(2, '0')}.jpg`,
    );
    await sharp({
      create: {width, height, channels: 3, background: '#100d0b'},
    })
      .composite(composite)
      .jpeg({quality: 90})
      .toFile(pageFile);
    pages.push({
      page: pageNumber,
      file: path.relative(ROOT, pageFile),
      sha256: await hashFile(pageFile),
      reviewIds: pagePanels.map(({id}) => id),
    });
  }
  const index = {
    $schema:
      '../../schemas/quality-review-contact-sheet.schema.json',
    schemaVersion: 1,
    projectSlug: slug,
    generatedAt: new Date().toISOString(),
    sourceReport: scaffold.sourceReport,
    scaffoldFingerprint,
    pages,
    reviews: panels.map(({panel: _panel, ...panel}) => panel),
  };
  const indexFile = path.join(directory, 'index.json');
  await writeJson(indexFile, index);
  return {file: indexFile, index};
};

export const formatQualityStatus = (status) => `${status.ready ? '✓' : '✗'} quality: ${status.passed}/${status.total} passed, ${status.pending} pending, ${status.failed} failed (assets ${status.scopes.assets.passed}/${status.scopes.assets.total}, composites ${status.scopes.composites.passed}/${status.scopes.composites.total})`;
