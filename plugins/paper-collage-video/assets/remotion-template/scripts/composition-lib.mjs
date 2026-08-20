import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {IDLE_PRESETS} from './production-vocabulary.mjs';
import {
  collectSequenceProofCoverage,
  resolveSequenceLayers,
  resolveSequencePhase,
  resolveSequenceState,
} from './state-sequence-lib.mjs';
import {
  inspectStateAnchorRegistration,
} from './state-sheet-lib.mjs';
import {
  MAX_MOTIF_INSTANCES_PER_FIELD,
  MAX_MOTIF_INSTANCES_PER_SCENE,
  resolveMotifFieldInstances,
} from '../src/motifField.mjs';
import {
  ANNOTATION_KINDS,
  fitEditorialTypography,
  resolveAnnotationRoute,
  validateDataGraphicNode,
} from '../src/editorialPrimitives.mjs';
import {
  WORLD_STRIP_MIN_VIEWPORT_SPAN,
  inspectWorldStripCoverage,
  resolveWorldStripCopies,
  resolveWorldStripFrame,
  resolveWorldStripSpeedFactor,
  resolveWorldStripTileGeometry,
  validateClosedWorldStripLoop,
} from '../src/worldStrip.mjs';
import {resolvePathMotionAtFrame} from '../src/pathMotion.mjs';
import {
  samplePathPolyline,
  validatePathMotion,
} from '../src/pathMotion.mjs';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIRECTORY, '..');
const schema = JSON.parse(
  await fs.readFile(path.join(ROOT, 'schemas', 'composition.schema.json'), 'utf8'),
);

export const COMPOSITION_PATTERNS = schema.$defs.pattern.enum;
export const EMPHASIS_ACTIONS = schema.$defs.emphasisAction.enum;
export const MOTION_EASES = schema.$defs.motionEase.enum;

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;
const normalizedRectangleWithinCanvas = ({x, y, width, height} = {}) =>
  [x, y, width, height].every(finite) &&
  x >= 0 &&
  y >= 0 &&
  width > 0 &&
  height > 0 &&
  x + width <= 1 &&
  y + height <= 1;
const rectangleForTransform = (transform = {}) => ({
  x: transform.x - transform.anchorX * transform.width,
  y: transform.y - transform.anchorY * (transform.height ?? transform.width),
  width: transform.width,
  height: transform.height ?? transform.width,
});
const rectanglesOverlap = (left, right) =>
  left.x < right.x + right.width &&
  left.x + left.width > right.x &&
  left.y < right.y + right.height &&
  left.y + left.height > right.y;
const LAYER_ROLES = ['support-rear', 'subject', 'support-front'];
const RESPONSIVE_LAYER_PROFILES = ['16:9', '9:16', '1:1'];
const maximumAuthoredMotion = (motion = {}) => {
  const keyframes = motion.keyframes ?? [];
  const pathPoints = motion.path
    ? samplePathPolyline(motion.path, 129)
    : [];
  const idle = motion.idle;
  const idleIntensity = idle?.intensity ?? 0;
  const idleMaximum = {
    x:
      idle?.preset === 'sway'
        ? 0.004 * idleIntensity
        : idle?.preset === 'grind'
          ? 0.008 * idleIntensity
          : idle?.preset === 'drift'
            ? 0.005 * idleIntensity
            : 0,
    y:
      idle?.preset === 'float'
        ? 0.006 * idleIntensity
        : idle?.preset === 'drift'
          ? 0.003 * idleIntensity
          : 0,
    scale:
      idle?.preset === 'breathe'
        ? 0.008 * idleIntensity
        : 0,
    rotationDegrees:
      idle?.preset === 'sway'
        ? 2.8 * idleIntensity
        : idle?.preset === 'grind'
          ? 0.55 * idleIntensity
          : 0,
  };
  return {
    x:
      Math.max(0, ...keyframes.map(({offsetX = 0}) => Math.abs(offsetX))) +
      Math.max(0, ...pathPoints.map(({x = 0}) => Math.abs(x))) +
      idleMaximum.x,
    y:
      Math.max(0, ...keyframes.map(({offsetY = 0}) => Math.abs(offsetY))) +
      Math.max(0, ...pathPoints.map(({y = 0}) => Math.abs(y))) +
      idleMaximum.y,
    scale:
      Math.max(
        0,
        ...keyframes.map(({scale = 1}) => Math.abs(scale - 1)),
      ) + idleMaximum.scale,
    rotationDegrees:
      Math.max(
        0,
        ...keyframes.map(({rotation = 0}) => Math.abs(rotation)),
      ) + idleMaximum.rotationDegrees,
  };
};

export const stableStringify = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

export const hashCompositionValue = (value) =>
  createHash('sha256').update(stableStringify(value)).digest('hex');

export const flattenCompositionNodes = (
  nodes = [],
  parent = null,
  inheritedRenderParticipation = 'visible',
) =>
  nodes.flatMap((node) => {
    const renderParticipation =
      node.kind === 'group'
        ? node.renderParticipation ?? inheritedRenderParticipation
        : inheritedRenderParticipation;
    return [
    {node, parent, renderParticipation},
    ...(node.kind === 'group'
      ? flattenCompositionNodes(
          node.children ?? [],
          node,
          renderParticipation,
        )
      : node.kind === 'editorial-switch'
        ? flattenCompositionNodes(
            (node.panels ?? []).map(({node: panel}) => panel),
            node,
            renderParticipation,
          )
      : []),
    ];
  });

export const collectCompositionGroups = (composition) =>
  flattenCompositionNodes(composition?.nodes).filter(({node}) => node.kind === 'group');

export const collectCanonicalContainers = (composition) =>
  collectCompositionGroups(composition).filter(
    ({node}) => node.pattern === 'canonical-container',
  );

export const collectCompositionAssets = (composition) =>
  flattenCompositionNodes(composition?.nodes).filter(({node}) => node.kind === 'asset');

export const collectStateSequences = (composition) =>
  flattenCompositionNodes(composition?.nodes).filter(({node}) => node.kind === 'state-sequence');

export const collectMotifFields = (composition) =>
  flattenCompositionNodes(composition?.nodes).filter(({node}) => node.kind === 'motif-field');

export const collectWorldStrips = (composition) =>
  flattenCompositionNodes(composition?.nodes).filter(({node}) => node.kind === 'world-strip');

export const collectCompositionVisualSources = (composition) => [
  ...collectCompositionAssets(composition).map(({node}) => node.src),
  ...collectStateSequences(composition).flatMap(({node}) => node.states.map(({src}) => src)),
  ...collectMotifFields(composition).flatMap(({node}) => node.motifs.map(({src}) => src)),
  ...collectWorldStrips(composition).map(({node}) => node.src),
];

export const collectRuntimeVisibleCompositionSources = (composition) =>
  flattenCompositionNodes(composition?.nodes)
    .filter(({renderParticipation}) => renderParticipation === 'visible')
    .flatMap(({node}) => {
      if (node.kind === 'asset') return [node.src];
      if (node.kind === 'state-sequence') {
        return node.states.map(({src}) => src);
      }
      if (node.kind === 'motif-field') {
        return node.motifs.map(({src}) => src);
      }
      if (node.kind === 'world-strip') return [node.src];
      return [];
    });

export const pointInPolygon = ([x, y], polygon = []) => {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const [currentX, currentY] = polygon[index] ?? [];
    const [previousX, previousY] = polygon[previous] ?? [];
    if (![currentX, currentY, previousX, previousY].every(finite)) return false;
    const crosses =
      currentY > y !== previousY > y &&
      x < ((previousX - currentX) * (y - currentY)) / (previousY - currentY || 1e-9) + currentX;
    if (crosses) inside = !inside;
  }
  return inside;
};

const resolveAxisAt = (keyframes, progress, property) => {
  const sorted = [...(keyframes ?? [])].sort((left, right) => left.at - right.at);
  if (sorted.length === 0) return property === 'scale' || property === 'opacity' ? 1 : 0;
  const fallback = property === 'scale' || property === 'opacity' ? 1 : 0;
  if (progress <= sorted[0].at) return sorted[0][property] ?? fallback;
  if (progress >= sorted.at(-1).at) return sorted.at(-1)[property] ?? fallback;
  const rightIndex = sorted.findIndex(({at}) => at >= progress);
  const left = sorted[rightIndex - 1];
  const right = sorted[rightIndex];
  const amount = (progress - left.at) / Math.max(1e-9, right.at - left.at);
  return (left[property] ?? fallback) + ((right[property] ?? fallback) - (left[property] ?? fallback)) * amount;
};

export const validateMotionKeyframes = (keyframes, location, add) => {
  if (!Array.isArray(keyframes) || keyframes.length < 2) {
    add('error', 'motion-keyframes-required', '组合节点必须包含至少两个关键帧。', location);
    return;
  }
  let previousAt = -1;
  let authoredValues = 0;
  for (const [index, keyframe] of keyframes.entries()) {
    const keyframeLocation = `${location}[${index}]`;
    if (!finite(keyframe.at) || keyframe.at < 0 || keyframe.at > 1 || keyframe.at <= previousAt) {
      add('error', 'motion-keyframe-at', '关键帧 at 必须位于 0..1 且严格递增。', `${keyframeLocation}.at`);
    }
    previousAt = keyframe.at;
    for (const property of ['offsetX', 'offsetY', 'scale', 'rotation', 'opacity']) {
      if (keyframe[property] !== undefined) {
        authoredValues += 1;
        if (!finite(keyframe[property])) add('error', 'motion-keyframe-value', `${property} 必须是有限数字。`, `${keyframeLocation}.${property}`);
      }
    }
    if (keyframe.scale !== undefined && keyframe.scale <= 0) add('error', 'motion-keyframe-scale', 'scale 必须大于 0。', `${keyframeLocation}.scale`);
    if (keyframe.opacity !== undefined && (keyframe.opacity < 0 || keyframe.opacity > 1)) add('error', 'motion-keyframe-opacity', 'opacity 必须位于 0..1。', `${keyframeLocation}.opacity`);
    if (keyframe.ease !== undefined && !MOTION_EASES.includes(keyframe.ease)) add('error', 'motion-keyframe-ease', `未知 ease：${keyframe.ease}`, `${keyframeLocation}.ease`);
  }
  if (keyframes[0]?.at !== 0 || keyframes.at(-1)?.at !== 1) add('error', 'motion-keyframe-boundaries', '关键帧必须从 at=0 覆盖到 at=1。', location);
  if (authoredValues === 0) add('error', 'motion-keyframe-empty', '关键帧必须显式编排至少一个属性。', location);
};

const validateTransform = (transform, location, add) => {
  if (!transform || typeof transform !== 'object') {
    add('error', 'composition-transform', '组合节点必须声明 transform。', location);
    return;
  }
  for (const property of ['x', 'y', 'width', 'anchorX', 'anchorY']) {
    if (!finite(transform[property])) add('error', 'composition-transform-value', `${property} 必须是有限数字。`, `${location}.${property}`);
  }
  if (!(transform.width > 0)) add('error', 'composition-transform-width', 'width 必须大于 0。', `${location}.width`);
  if (transform.height !== undefined && !(finite(transform.height) && transform.height > 0)) add('error', 'composition-transform-height', 'height 必须大于 0。', `${location}.height`);
  for (const property of ['anchorX', 'anchorY']) {
    if (finite(transform[property]) && (transform[property] < 0 || transform[property] > 1)) add('error', 'composition-transform-anchor', `${property} 必须位于 0..1。`, `${location}.${property}`);
  }
};

export const validateCompositionStructure = ({
  composition,
  video,
  proofTimes = [],
  durationSeconds = 1,
  location = 'composition',
  editorial,
  sceneId,
  exclusionZones = [],
  safeArea = {x: 0, y: 0, width: 1, height: 1},
}) => {
  const issues = [];
  const add = (level, code, message, issueLocation) => issues.push({level, code, message, location: issueLocation});
  if (!composition || typeof composition !== 'object') {
    add('error', 'composition-required', '每个镜头必须声明 composition。', location);
    return {issues, nodeIds: new Set(), derivationOnlyNodeIds: new Set(), groups: [], assets: [], sequences: [], motifFields: [], worldStrips: [], freeNodes: []};
  }
  if (
    composition.coordinateSpace?.width !== video?.width ||
    composition.coordinateSpace?.height !== video?.height
  ) {
    add('error', 'composition-coordinate-space', '镜头 composition.coordinateSpace 必须与视频画布一致。', `${location}.coordinateSpace`);
  }
  if (!Array.isArray(composition.nodes) || composition.nodes.length === 0) add('error', 'composition-nodes', 'composition.nodes 至少需要一个节点。', `${location}.nodes`);

  const flat = flattenCompositionNodes(composition.nodes);
  const pathSequenceCoverageByFamily = new Map();
  for (const {node} of flat) {
    if (
      node.kind !== 'state-sequence' ||
      node.motion?.path?.kind !== 'cubic-bezier-3d'
    ) {
      continue;
    }
    const coverage =
      pathSequenceCoverageByFamily.get(node.poseFamilyId) ?? new Set();
    for (const stateId of collectSequenceProofCoverage({node, proofTimes})) {
      coverage.add(stateId);
    }
    pathSequenceCoverageByFamily.set(node.poseFamilyId, coverage);
  }
  const freeNodes = flat.filter(({node, parent}) => parent === null && node.kind !== 'group');
  const nodeIds = new Set();
  const derivationOnlyNodeIds = new Set();
  const groups = [];
  const assets = [];
  const sequences = [];
  const motifFields = [];
  const worldStrips = [];
  for (const {node, parent, renderParticipation} of flat) {
    const nodeLocation = `${location}.nodes#${node?.id ?? 'missing'}`;
    if (!nonEmpty(node?.id) || nodeIds.has(node.id)) add('error', 'composition-node-id', '组合节点 id 缺失或重复。', `${nodeLocation}.id`);
    nodeIds.add(node?.id);
    if (renderParticipation === 'derivation-only') {
      derivationOnlyNodeIds.add(node?.id);
    }
    if (!['asset', 'state-sequence', 'typography', 'shape', 'annotation', 'data-graphic', 'editorial-switch', 'motif-field', 'world-strip', 'group'].includes(node?.kind)) {
      add('error', 'composition-node-kind', `未知组合节点 kind：${node?.kind}`, `${nodeLocation}.kind`);
      continue;
    }
    if (!Number.isInteger(node.z)) add('error', 'composition-node-z', '节点 z 必须是整数。', `${nodeLocation}.z`);
    if (node.depth !== undefined && !(finite(node.depth) && node.depth >= -1 && node.depth <= 1)) {
      add('error', 'composition-node-depth', '节点 depth 必须位于 -1..1。', `${nodeLocation}.depth`);
    }
    validateTransform(node.transform, `${nodeLocation}.transform`, add);
    if (
      node.transform?.opacity === 0 &&
      renderParticipation !== 'derivation-only'
    ) {
      add(
        'error',
        'composition-zero-opacity-source',
        '永久 opacity=0 的节点不是可见执行内容；技术来源组必须显式声明 renderParticipation=derivation-only。',
        `${nodeLocation}.transform.opacity`,
      );
    }
    validateMotionKeyframes(node.motion?.keyframes, `${nodeLocation}.motion.keyframes`, add);
    if (node.motion?.path) {
      for (const issue of validatePathMotion(node.motion.path)) {
        add(
          'error',
          issue.code,
          issue.message,
          `${nodeLocation}.motion.${issue.location}`,
        );
      }
      if (node.kind !== 'state-sequence') {
        add(
          'error',
          'composition-path-state-sequence',
          'path locomotion 必须由 state-sequence 节点执行，不能移动冻结单帧。',
          `${nodeLocation}.motion.path`,
        );
      }
      if (
        (node.motion.keyframes ?? []).some(
          (keyframe) =>
            keyframe.offsetX !== undefined ||
            keyframe.offsetY !== undefined ||
            keyframe.scale !== undefined ||
            keyframe.rotation !== undefined,
        )
      ) {
        add(
          'error',
          'composition-path-keyframe-conflict',
          'path locomotion 已拥有三维位置、透视尺寸与朝向；普通关键帧不得再次声明 offsetX、offsetY、scale 或 rotation。',
          `${nodeLocation}.motion.keyframes`,
        );
      }
      if (
        node.motion.idle &&
        !['still', 'breathe'].includes(node.motion.idle.preset)
      ) {
        add(
          'error',
          'composition-path-idle-conflict',
          'path locomotion 目标的 idle 只能使用 still 或 breathe，避免额外位置/旋转漂移。',
          `${nodeLocation}.motion.idle`,
        );
      }
      if ((node.transform?.rotation ?? 0) !== 0) {
        add(
          'error',
          'composition-path-transform-rotation',
          'path locomotion 的静态 transform.rotation 必须为 0；素材前向请使用 orientation.forwardAngleDegrees。',
          `${nodeLocation}.transform.rotation`,
        );
      }
    }
    if (node.visibility !== undefined && !['visible', 'hidden'].includes(node.visibility?.initial)) {
      add('error', 'composition-node-visibility', 'visibility.initial 必须是 visible 或 hidden。', `${nodeLocation}.visibility.initial`);
    }
    if (node.motion?.idle) {
      if (!IDLE_PRESETS.includes(node.motion.idle.preset)) add('error', 'composition-idle-preset', `未知 idle preset：${node.motion.idle.preset}；idle 只接受 ${IDLE_PRESETS.join('、')}，位移与镜头行为请用 keyframes 或 camera 表达。`, `${nodeLocation}.motion.idle.preset`);
      if (!(finite(node.motion.idle.intensity) && node.motion.idle.intensity >= 0 && node.motion.idle.intensity <= 3)) add('error', 'composition-idle-intensity', 'idle.intensity 必须位于 0..3。', `${nodeLocation}.motion.idle.intensity`);
      if (!(finite(node.motion.idle.cycleSeconds) && node.motion.idle.cycleSeconds > 0)) add('error', 'composition-idle-cycle', 'idle.cycleSeconds 必须大于 0。', `${nodeLocation}.motion.idle.cycleSeconds`);
    }
    if (node.motion?.pivot) {
      for (const property of ['x', 'y']) {
        const value = node.motion.pivot[property];
        if (!(finite(value) && value >= 0 && value <= 1)) {
          add('error', 'composition-motion-pivot', `motion.pivot.${property} 必须位于 0..1。`, `${nodeLocation}.motion.pivot.${property}`);
        }
      }
    }
    if (node.kind === 'asset') {
      assets.push({node, parent});
      if (!nonEmpty(node.src)) add('error', 'composition-asset-src', 'asset 节点必须声明 src。', `${nodeLocation}.src`);
      if (!['background', 'environment', 'character', 'prop', 'decorative'].includes(node.assetRole)) add('error', 'composition-asset-role', `未知 assetRole：${node.assetRole}`, `${nodeLocation}.assetRole`);
      if (node.clip && parent?.pattern !== 'registered-environment') add('error', 'composition-clip-parent', '只有 registered-environment 子资产可以声明 clip。', `${nodeLocation}.clip`);
      continue;
    }

    if (node.kind === 'world-strip') {
      worldStrips.push({node, parent});
      if (parent?.pattern !== 'looping-environment') {
        add('error', 'composition-world-strip-parent', 'world-strip 只能作为 looping-environment 的直接子节点。', nodeLocation);
      }
      if (!['far', 'mid', 'ground', 'near'].includes(node.role)) {
        add('error', 'composition-world-strip-role', `未知 world-strip role：${node.role}`, `${nodeLocation}.role`);
      }
      if (!nonEmpty(node.src)) {
        add('error', 'composition-world-strip-src', 'world-strip 必须声明 src。', `${nodeLocation}.src`);
      }
      const binding = node.loopingStripBinding;
      if (
        binding?.schemaVersion !== 1 ||
        binding?.axis !== 'x' ||
        binding?.role !== node.role ||
        !nonEmpty(binding?.stripId) ||
        !nonEmpty(binding?.sourceAssetId) ||
        !nonEmpty(binding?.derivationFingerprint)
      ) {
        add('error', 'composition-world-strip-binding', 'world-strip 必须绑定当前 schema-v1 horizontal looping strip provenance。', `${nodeLocation}.loopingStripBinding`);
      }
      if (!['exact', 'overlap-crop', 'mirror-crop'].includes(binding?.seamStrategy)) {
        add('error', 'composition-world-strip-strategy', 'world-strip seamStrategy 必须是 exact、overlap-crop 或 mirror-crop。', `${nodeLocation}.loopingStripBinding.seamStrategy`);
      }
      const output = binding?.output;
      if (
        !Number.isInteger(output?.width) ||
        output.width < 1 ||
        !Number.isInteger(output?.height) ||
        output.height < 1
      ) {
        add('error', 'composition-world-strip-output', 'world-strip binding 必须声明有效 output dimensions。', `${nodeLocation}.loopingStripBinding.output`);
      }
      const transform = node.transform ?? {};
      if (
        transform.x !== 0 ||
        transform.width !== 1 ||
        transform.anchorX !== 0 ||
        transform.anchorY !== 0 ||
        !(finite(transform.height) && transform.height > 0)
      ) {
        add('error', 'composition-world-strip-viewport', 'world-strip 必须以 x=0/width=1/top-left anchor 覆盖父级 viewport，并显式声明渲染高度。', `${nodeLocation}.transform`);
      } else if (
        Number.isInteger(output?.width) &&
        output.width > 0 &&
        Number.isInteger(output?.height) &&
        output.height > 0 &&
        finite(parent?.coordinateSpace?.width) &&
        finite(parent?.coordinateSpace?.height)
      ) {
        const geometry = resolveWorldStripTileGeometry({
          viewportWidth: parent.coordinateSpace.width,
          viewportHeight: parent.coordinateSpace.height,
          renderHeight: transform.height * parent.coordinateSpace.height,
          sourceWidth: output.width,
          sourceHeight: output.height,
          overscanPx: parent.loopingEnvironment?.overscanPx ?? 2,
        });
        if (geometry.viewportSpan + 1e-9 < WORLD_STRIP_MIN_VIEWPORT_SPAN) {
          add('error', 'composition-world-strip-span', `world-strip 实际宽度仅 ${geometry.viewportSpan.toFixed(3)} 个 viewport；环境条带至少需要 ${WORLD_STRIP_MIN_VIEWPORT_SPAN}。`, `${nodeLocation}.loopingStripBinding.output`);
        }
        if (geometry.viewportSpan + 1e-9 < (binding.minimumViewportSpan ?? Infinity)) {
          add('error', 'composition-world-strip-binding-span', `world-strip 实际 viewport span ${geometry.viewportSpan.toFixed(3)} 小于 binding 声明的 ${binding.minimumViewportSpan}。`, `${nodeLocation}.loopingStripBinding.minimumViewportSpan`);
        }
      }
      const hasLocalTravel = (node.motion?.keyframes ?? []).some(
        ({offsetX = 0, offsetY = 0, scale = 1, rotation = 0}) =>
          offsetX !== 0 || offsetY !== 0 || scale !== 1 || rotation !== 0,
      );
      if (hasLocalTravel || (node.motion?.idle && node.motion.idle.preset !== 'still')) {
        add('error', 'composition-world-strip-duplicate-motion', 'world-strip 的世界位移由父级 loopingEnvironment 独占；节点不得重复关键帧或 idle 位移。', `${nodeLocation}.motion`);
      }
      continue;
    }

    if (node.kind === 'state-sequence') {
      sequences.push({node, parent});
      if (!['character', 'prop', 'decorative'].includes(node.assetRole)) add('error', 'composition-sequence-role', `未知 state-sequence assetRole：${node.assetRole}`, `${nodeLocation}.assetRole`);
      if (!nonEmpty(node.poseFamilyId)) add('error', 'composition-pose-family', 'state-sequence 必须声明 poseFamilyId。', `${nodeLocation}.poseFamilyId`);
      if (!node.registration || !nonEmpty(node.registration.id) || !nonEmpty(node.registration.sourceMasterAssetId)) add('error', 'composition-sequence-registration', 'state-sequence 必须声明可追溯的 registration。', `${nodeLocation}.registration`);
      if (!(finite(node.registration?.canvas?.width) && node.registration.canvas.width > 0 && finite(node.registration?.canvas?.height) && node.registration.canvas.height > 0)) add('error', 'composition-sequence-canvas', 'state-sequence registration.canvas 必须是有效画布。', `${nodeLocation}.registration.canvas`);
      if (
        !Array.isArray(node.anchorPolicy?.requiredAnchorIds) ||
        node.anchorPolicy.requiredAnchorIds.length < 1 ||
        new Set(node.anchorPolicy.requiredAnchorIds).size !== node.anchorPolicy.requiredAnchorIds.length ||
        !(finite(node.anchorPolicy?.maximumDrift) && node.anchorPolicy.maximumDrift >= 0 && node.anchorPolicy.maximumDrift <= 0.1)
      ) {
        add('error', 'composition-sequence-anchor-policy', 'state-sequence 必须声明 requiredAnchorIds 与 0..0.1 maximumDrift。', `${nodeLocation}.anchorPolicy`);
      }
      if (!Array.isArray(node.states) || node.states.length < 2) {
        add('error', 'composition-sequence-states', 'state-sequence 至少需要两个状态。', `${nodeLocation}.states`);
      } else {
        const stateIds = new Set();
        let previousAt = -1;
        for (const [index, state] of node.states.entries()) {
          const stateLocation = `${nodeLocation}.states[${index}]`;
          if (!nonEmpty(state.id) || stateIds.has(state.id)) add('error', 'composition-sequence-state-id', '状态 id 缺失或重复。', `${stateLocation}.id`);
          stateIds.add(state.id);
          if (!nonEmpty(state.src)) add('error', 'composition-sequence-state-src', '状态必须声明 src。', `${stateLocation}.src`);
          if (!['left', 'right', 'front', 'back', 'neutral'].includes(state.facing)) add('error', 'composition-sequence-state-facing', '状态 facing 无效。', `${stateLocation}.facing`);
          const anchors = new Map((state.anchors ?? []).map((anchor) => [anchor.id, anchor]));
          if (
            !Array.isArray(state.anchors) ||
            anchors.size !== state.anchors.length ||
            node.anchorPolicy?.requiredAnchorIds?.some((id) => !anchors.has(id)) ||
            (state.anchors ?? []).some(({id, x, y}) =>
              !nonEmpty(id) || !finite(x) || x < 0 || x > 1 || !finite(y) || y < 0 || y > 1)
          ) {
            add('error', 'composition-sequence-state-anchors', '每个状态必须声明唯一归一化 anchors 并覆盖 anchorPolicy。', `${stateLocation}.anchors`);
          }
          if (!nonEmpty(state.identityReferenceAssetId) || !/^[a-f0-9]{64}$/.test(state.identityReferenceSha256 ?? '')) {
            add('error', 'composition-sequence-state-identity-reference', '每个状态必须绑定 identityReferenceAssetId 与 SHA-256。', stateLocation);
          }
          if (!finite(state.at) || state.at < 0 || state.at > 1 || state.at <= previousAt) add('error', 'composition-sequence-state-at', '状态 at 必须位于 0..1 且严格递增。', `${stateLocation}.at`);
          previousAt = state.at;
        }
        const identityReferences = new Set(
          node.states.map(({identityReferenceAssetId, identityReferenceSha256}) =>
            `${identityReferenceAssetId}:${identityReferenceSha256}`),
        );
        if (identityReferences.size !== 1) {
          add('error', 'composition-sequence-identity-reference-drift', '同一状态族必须共享一个身份参考及其 SHA-256。', `${nodeLocation}.states`);
        }
        const anchorProof = inspectStateAnchorRegistration({
          states: node.states,
          anchorPolicy: node.anchorPolicy,
        });
        if (!anchorProof.passed) {
          add('error', 'composition-sequence-anchor-drift', '逐状态 anchor 漂移超过 anchorPolicy.maximumDrift。', `${nodeLocation}.states`);
        }
        if (node.states[0]?.at !== 0) add('error', 'composition-sequence-start', '状态序列必须从 at=0 开始。', `${nodeLocation}.states[0].at`);
        const coverage = collectSequenceProofCoverage({node, proofTimes});
        const inheritedPathCoverage =
          node.motion?.path?.kind === 'cubic-bezier-3d'
            ? pathSequenceCoverageByFamily.get(node.poseFamilyId)
            : null;
        for (const state of node.states) {
          if (
            !node.pathViewBinding &&
            !coverage.has(state.id) &&
            !inheritedPathCoverage?.has(state.id)
          ) {
            add('error', 'composition-sequence-proof-coverage', `状态 ${state.id} 缺少 proofTime.stateAssertions 证明。`, `${nodeLocation}.states`);
          }
        }
      }
      if (!['once', 'loop', 'ping-pong'].includes(node.playback?.mode) || !(Number.isInteger(node.playback?.cycles) && node.playback.cycles > 0)) add('error', 'composition-sequence-playback', 'state-sequence playback 必须声明有效 mode 与正整数 cycles。', `${nodeLocation}.playback`);
      if (node.pathViewBinding !== undefined) {
        const binding = node.pathViewBinding;
        const groups = [
          ['planarStateIds', binding?.planarStateIds],
          ['towardStateIds', binding?.towardStateIds],
          ['awayStateIds', binding?.awayStateIds],
        ];
        const allIds = groups.flatMap(([, ids]) => Array.isArray(ids) ? ids : []);
        const knownIds = new Set((node.states ?? []).map(({id}) => id));
        if (
          !finite(binding?.depthVelocityThreshold) ||
          binding.depthVelocityThreshold <= 0 ||
          !finite(binding?.transitionWidth) ||
          binding.transitionWidth < 0 ||
          binding.transitionWidth > binding.depthVelocityThreshold
        ) {
          add('error', 'composition-path-view-threshold', 'pathViewBinding 必须声明正 depthVelocityThreshold，且 transitionWidth 位于 0..threshold。', `${nodeLocation}.pathViewBinding`);
        }
        for (const [field, ids] of groups) {
          if (!Array.isArray(ids) || ids.length < 2 || new Set(ids).size !== ids.length) {
            add('error', 'composition-path-view-group', `${field} 必须包含至少两个不重复循环状态。`, `${nodeLocation}.pathViewBinding.${field}`);
          }
          for (const id of ids ?? []) {
            if (!knownIds.has(id)) add('error', 'composition-path-view-state', `pathViewBinding 状态 ${id} 不存在。`, `${nodeLocation}.pathViewBinding.${field}`);
          }
        }
        if (new Set(allIds).size !== allIds.length) {
          add('error', 'composition-path-view-overlap', 'planar/toward/away 状态组不得互相重叠。', `${nodeLocation}.pathViewBinding`);
        }
        if (node.motion?.path?.kind !== 'cubic-bezier-3d') {
          add('error', 'composition-path-view-motion', 'pathViewBinding 只能绑定 cubic-bezier-3d 路径。', `${nodeLocation}.motion.path`);
        }
      }
      if (node.playback?.mode === 'once' && node.playback.cycles !== 1) add('error', 'composition-sequence-once-cycles', 'once playback 的 cycles 必须为 1。', `${nodeLocation}.playback.cycles`);
      const hasActiveFrom = node.playback?.activeFrom !== undefined;
      const hasActiveUntil = node.playback?.activeUntil !== undefined || node.playback?.holdStateId !== undefined;
      if (hasActiveFrom && !(finite(node.playback.activeFrom) && node.playback.activeFrom > 0 && node.playback.activeFrom < 1)) add('error', 'composition-sequence-active-from', 'activeFrom 必须位于 0..1 之间。', `${nodeLocation}.playback.activeFrom`);
      if (hasActiveUntil && !(
        finite(node.playback?.activeUntil) &&
        node.playback.activeUntil > 0 &&
        node.playback.activeUntil < 1 &&
        nonEmpty(node.playback?.holdStateId)
      )) add('error', 'composition-sequence-segmented-playback', '分段状态序列必须同时声明 0..1 之间的 activeUntil 与 holdStateId。', `${nodeLocation}.playback`);
      if (hasActiveFrom && node.playback?.activeUntil !== undefined && node.playback.activeFrom >= node.playback.activeUntil) add('error', 'composition-sequence-active-window', 'activeFrom 必须早于 activeUntil。', `${nodeLocation}.playback`);
      if (hasActiveUntil && !node.states.some(({id}) => id === node.playback.holdStateId)) add('error', 'composition-sequence-hold-state', `定格状态 ${node.playback?.holdStateId ?? 'none'} 不存在。`, `${nodeLocation}.playback.holdStateId`);
      if (node.playback?.activeStateIds !== undefined) {
        const activeIds = node.playback.activeStateIds;
        const stateIndex = new Map(node.states.map(({id}, index) => [id, index]));
        if (!hasActiveFrom || !Array.isArray(activeIds) || activeIds.length < 2 || new Set(activeIds).size !== activeIds.length) add('error', 'composition-sequence-active-states', 'activeStateIds 需要 activeFrom、至少两个不重复状态。', `${nodeLocation}.playback.activeStateIds`);
        for (const id of activeIds ?? []) if (!stateIndex.has(id)) add('error', 'composition-sequence-active-state', `活动状态 ${id} 不存在。`, `${nodeLocation}.playback.activeStateIds`);
        for (let index = 1; index < (activeIds?.length ?? 0); index += 1) if (stateIndex.get(activeIds[index - 1]) >= stateIndex.get(activeIds[index])) add('error', 'composition-sequence-active-state-order', 'activeStateIds 必须与 states 的顺序一致。', `${nodeLocation}.playback.activeStateIds`);
        const activeSet = new Set(activeIds);
        const exitStates = [];
        for (const state of node.states) {
          if (activeSet.has(state.id) || state.id === node.playback?.holdStateId) continue;
          if (state.at < (node.playback?.activeFrom ?? 1)) continue;
          if (
            node.playback?.activeUntil !== undefined &&
            state.at >= node.playback.activeUntil
          ) {
            exitStates.push(state);
            continue;
          }
          add('error', 'composition-sequence-segment-state', `非活动状态 ${state.id} 必须在 activeFrom 前出现，或在 activeUntil 后作为结束序列。`, `${nodeLocation}.states`);
        }
        if (exitStates.length > 0) {
          const hold = node.states.find(
            ({id}) => id === node.playback?.holdStateId,
          );
          if (
            exitStates[0].at !== node.playback?.activeUntil ||
            !hold ||
            hold.at < exitStates.at(-1).at
          ) {
            add('error', 'composition-sequence-exit-order', '结束序列必须从 activeUntil 开始，并以 holdStateId 作为最后状态。', `${nodeLocation}.states`);
          }
        }
      }
      if (!['cut', 'crossfade'].includes(node.transition?.type) || !(finite(node.transition?.durationSeconds) && node.transition.durationSeconds >= 0)) add('error', 'composition-sequence-transition', 'state-sequence transition 无效。', `${nodeLocation}.transition`);
      if (node.transition?.type === 'cut' && node.transition.durationSeconds !== 0) add('error', 'composition-sequence-cut-duration', 'cut 的 durationSeconds 必须为 0。', `${nodeLocation}.transition.durationSeconds`);
      if (node.transition?.type === 'crossfade' && !(node.transition.durationSeconds > 0)) add('error', 'composition-sequence-crossfade-duration', 'crossfade 的 durationSeconds 必须大于 0。', `${nodeLocation}.transition.durationSeconds`);
      if (node.clip && parent?.pattern !== 'registered-environment') add('error', 'composition-clip-parent', '只有 registered-environment 子节点可以声明 clip。', `${nodeLocation}.clip`);
      continue;
    }

    if (node.kind === 'typography') {
      if (typeof node.text !== 'string') add('error', 'composition-typography-value', 'typography 节点必须声明字符串内容。', `${nodeLocation}.text`);
      const fit = node.treatment?.fit;
      const style = node.treatment?.style;
      if (!nonEmpty(style?.fontFamily)) {
        add('error', 'composition-typography-font', 'typography 必须声明确定的 fontFamily。', `${nodeLocation}.treatment.style.fontFamily`);
      }
      if (
        !finite(fit?.minFontSize) ||
        !finite(fit?.maxFontSize) ||
        fit.minFontSize <= 0 ||
        fit.maxFontSize < fit.minFontSize ||
        !Number.isInteger(fit?.maxLines) ||
        fit.maxLines < 1
      ) add('error', 'composition-typography-fit', 'typography 必须声明有效 min/max font size 和 maxLines。', `${nodeLocation}.treatment.fit`);
      if (!(finite(style?.lineHeight) && style.lineHeight > 0)) add('error', 'composition-typography-style', 'typography 必须声明有效行高。', `${nodeLocation}.treatment.style`);
      if (!finite(node.transform?.height) || node.transform.height <= 0) {
        add('error', 'composition-typography-height', 'typography 节点必须声明 transform.height。', `${nodeLocation}.transform.height`);
      } else if (
        finite(video?.width) &&
        finite(video?.height) &&
        fit?.minFontSize > 0 &&
        fit?.maxFontSize >= fit.minFontSize &&
        fit?.maxLines >= 1 &&
        style?.lineHeight > 0
      ) {
        const report = fitEditorialTypography({
          text: node.text,
          width: node.transform.width * video.width,
          height: node.transform.height * video.height,
          minFontSize: fit.minFontSize,
          maxFontSize: fit.maxFontSize,
          maxLines: fit.maxLines,
          lineHeight: style.lineHeight,
          letterSpacing: style.letterSpacing ?? 0,
        });
        if (report.overflow && fit.overflow === 'error') {
          add('error', 'composition-typography-overflow', `typography 在最小字号 ${fit.minFontSize}px 时仍溢出。`, nodeLocation);
        }
      }
      const reveal = node.treatment?.reveal;
      if (!['none', 'word', 'line', 'edit-point'].includes(reveal?.mode)) {
        add('error', 'composition-typography-reveal', 'typography reveal mode 无效。', `${nodeLocation}.treatment.reveal.mode`);
      }
      if (
        reveal?.mode !== 'none' &&
        (!Array.isArray(reveal?.editPointIds) || reveal.editPointIds.length === 0)
      ) {
        add('error', 'composition-typography-reveal-points', '定时 reveal 必须绑定 edit points。', `${nodeLocation}.treatment.reveal.editPointIds`);
      }
      for (const editPointId of reveal?.editPointIds ?? []) {
        if (editorial && !editorial.resolvedEditPoints?.some((point) => point.id === editPointId && (!sceneId || point.sceneId === sceneId))) {
          add('error', 'composition-typography-edit-point', `typography reveal 引用未知 edit point：${editPointId}`, `${nodeLocation}.treatment.reveal.editPointIds`);
        }
      }
      for (const emphasis of node.treatment?.emphasis ?? []) {
        if (editorial && !editorial.resolvedEditPoints?.some((point) => point.id === emphasis.editPointId && (!sceneId || point.sceneId === sceneId))) {
          add('error', 'composition-typography-emphasis-point', `typography emphasis 引用未知 edit point：${emphasis.editPointId}`, `${nodeLocation}.treatment.emphasis`);
        }
      }
      const textBox = rectangleForTransform(node.transform);
      if (
        node.treatment?.safeAreaMode === 'inside' &&
        (
          textBox.x < safeArea.x ||
          textBox.y < safeArea.y ||
          textBox.x + textBox.width > safeArea.x + safeArea.width ||
          textBox.y + textBox.height > safeArea.y + safeArea.height
        )
      ) {
        add('error', 'composition-typography-safe-area', 'typography 超出当前响应式 safe area。', `${nodeLocation}.transform`);
      }
      for (const zone of exclusionZones.filter(({id}) => node.treatment?.avoidZoneIds?.includes(id))) {
        const padded = {
          x: zone.x - (zone.padding ?? 0),
          y: zone.y - (zone.padding ?? 0),
          width: zone.width + 2 * (zone.padding ?? 0),
          height: zone.height + 2 * (zone.padding ?? 0),
        };
        if (rectanglesOverlap(textBox, padded)) {
          add('error', 'composition-typography-exclusion', `typography 与 exclusion zone ${zone.id} 冲突。`, `${nodeLocation}.treatment.avoidZoneIds`);
        }
      }
      continue;
    }

    if (node.kind === 'annotation') {
      if (!ANNOTATION_KINDS.includes(node.annotationKind)) {
        add('error', 'composition-annotation-kind', `未知 annotation：${node.annotationKind}`, `${nodeLocation}.annotationKind`);
      }
      const route = resolveAnnotationRoute({
        node,
        nodes: composition.nodes,
        zones: exclusionZones,
      });
      if (!route.valid) {
        add('error', `composition-annotation-${route.reason}`, `annotation 路由无效：${route.reason}`, nodeLocation);
      }
      const annotationBox = rectangleForTransform(node.transform);
      if (
        Math.abs(annotationBox.x) > 1e-9 ||
        Math.abs(annotationBox.y) > 1e-9 ||
        Math.abs(annotationBox.width - 1) > 1e-9 ||
        Math.abs(annotationBox.height - 1) > 1e-9
      ) {
        add('error', 'composition-annotation-overlay', 'annotation 必须使用完整画布 overlay transform，保证语义 anchor 坐标一致。', `${nodeLocation}.transform`);
      }
      for (const editPointId of [node.lifecycle?.enterEditPointId, node.lifecycle?.exitEditPointId].filter(Boolean)) {
        if (editorial && !editorial.resolvedEditPoints?.some((point) => point.id === editPointId && (!sceneId || point.sceneId === sceneId))) {
          add('error', 'composition-annotation-edit-point', `annotation 引用未知 edit point：${editPointId}`, `${nodeLocation}.lifecycle`);
        }
      }
      continue;
    }

    if (node.kind === 'data-graphic') {
      for (const dataIssue of validateDataGraphicNode(node, nodeLocation)) {
        add('error', `composition-${dataIssue.code}`, dataIssue.message, dataIssue.location);
      }
      for (const state of node.states ?? []) {
        if (editorial && !editorial.resolvedEditPoints?.some((point) => point.id === state.editPointId && (!sceneId || point.sceneId === sceneId))) {
          add('error', 'composition-data-edit-point', `data state 引用未知 edit point：${state.editPointId}`, `${nodeLocation}.states`);
        }
      }
      continue;
    }

    if (node.kind === 'editorial-switch') {
      const panelIds = new Set();
      for (const panel of node.panels ?? []) {
        if (!nonEmpty(panel.id) || panelIds.has(panel.id)) add('error', 'composition-switch-panel-id', 'switch panel id 缺失或重复。', `${nodeLocation}.panels`);
        panelIds.add(panel.id);
      }
      if (panelIds.size < 2) add('error', 'composition-switch-panels', 'editorial-switch 至少需要两个 panel。', `${nodeLocation}.panels`);
      for (const change of node.changes ?? []) {
        if (!panelIds.has(change.fromPanelId) || !panelIds.has(change.toPanelId)) add('error', 'composition-switch-target', 'switch change 必须引用有效 panel。', `${nodeLocation}.changes`);
        if (!['card-switch', 'panel-replace', 'data-state'].includes(change.treatment)) add('error', 'composition-switch-treatment', `未知 switch treatment：${change.treatment}`, `${nodeLocation}.changes`);
        if (editorial && !editorial.resolvedEditPoints?.some((point) => point.id === change.editPointId && (!sceneId || point.sceneId === sceneId))) {
          add('error', 'composition-switch-edit-point', `switch 引用未知 edit point：${change.editPointId}`, `${nodeLocation}.changes`);
        }
      }
      continue;
    }

    if (node.kind === 'motif-field') {
      const motifIssueCount = issues.length;
      motifFields.push({node, parent});
      if (!Array.isArray(node.motifs) || node.motifs.length < 1 || node.motifs.length > 8) {
        add('error', 'composition-motif-sources', 'motif-field 必须包含 1..8 个 motif 素材。', `${nodeLocation}.motifs`);
      } else {
        const motifIds = new Set();
        for (const [index, motif] of node.motifs.entries()) {
          if (!nonEmpty(motif?.id) || motifIds.has(motif.id)) {
            add('error', 'composition-motif-id', 'motif id 缺失或重复。', `${nodeLocation}.motifs[${index}].id`);
          }
          motifIds.add(motif?.id);
          if (!nonEmpty(motif?.src)) add('error', 'composition-motif-src', 'motif 必须声明 src。', `${nodeLocation}.motifs[${index}].src`);
        }
      }
      if (!(Number.isInteger(node.count) && node.count >= 1 && node.count <= MAX_MOTIF_INSTANCES_PER_FIELD)) {
        add('error', 'composition-motif-count', `motif-field count 必须是 1..${MAX_MOTIF_INSTANCES_PER_FIELD} 的整数。`, `${nodeLocation}.count`);
      }
      if (!Number.isInteger(node.seed)) add('error', 'composition-motif-seed', 'motif-field seed 必须是整数。', `${nodeLocation}.seed`);
      if (!['scattered', 'grid', 'edge'].includes(node.distribution)) {
        add('error', 'composition-motif-distribution', `未知 motif-field distribution：${node.distribution}`, `${nodeLocation}.distribution`);
      }
      if (!['drift', 'fall-drift', 'rise-drift', 'burst', 'orbit'].includes(node.fieldMotion?.preset)) {
        add('error', 'composition-motif-motion', `未知 motif-field motion：${node.fieldMotion?.preset}`, `${nodeLocation}.fieldMotion.preset`);
      }
      if (!(finite(node.fieldMotion?.cycles) && node.fieldMotion.cycles > 0 && node.fieldMotion.cycles <= 12)) {
        add('error', 'composition-motif-cycles', 'motif-field cycles 必须位于 0..12。', `${nodeLocation}.fieldMotion.cycles`);
      }
      if (!(finite(node.baseSize) && node.baseSize > 0 && node.baseSize <= 1)) {
        add('error', 'composition-motif-base-size', 'motif-field baseSize 必须位于 0..1。', `${nodeLocation}.baseSize`);
      }
      for (const property of ['scale', 'rotation', 'opacity']) {
        const range = node.variation?.[property];
        if (
          !Array.isArray(range) ||
          range.length !== 2 ||
          !range.every(finite) ||
          range[0] > range[1]
        ) {
          add('error', 'composition-motif-variation', `${property} 必须是递增的双值范围。`, `${nodeLocation}.variation.${property}`);
        }
      }
      if (
        Array.isArray(node.variation?.scale) &&
        !(node.variation.scale[0] > 0)
      ) add('error', 'composition-motif-scale', 'motif scale 下界必须大于 0。', `${nodeLocation}.variation.scale`);
      if (
        Array.isArray(node.variation?.opacity) &&
        !node.variation.opacity.every((value) => value >= 0 && value <= 1)
      ) add('error', 'composition-motif-opacity', 'motif opacity 必须位于 0..1。', `${nodeLocation}.variation.opacity`);
      if (!normalizedRectangleWithinCanvas(node.bounds)) {
        add('error', 'composition-motif-bounds', 'motif-field bounds 必须完整位于节点画布 0..1 内。', `${nodeLocation}.bounds`);
      }
      if (!Array.isArray(node.exclusionZones) || node.exclusionZones.length > 12) {
        add('error', 'composition-motif-exclusions', 'motif-field exclusionZones 必须是最多 12 项的数组。', `${nodeLocation}.exclusionZones`);
      } else {
        const exclusionIds = new Set();
        for (const [index, zone] of node.exclusionZones.entries()) {
          const zoneLocation = `${nodeLocation}.exclusionZones[${index}]`;
          if (!nonEmpty(zone?.id) || exclusionIds.has(zone.id)) {
            add('error', 'composition-motif-exclusion-id', 'motif 排除区 id 缺失或重复。', `${zoneLocation}.id`);
          }
          exclusionIds.add(zone?.id);
          if (!['rectangle', 'ellipse'].includes(zone?.shape)) {
            add('error', 'composition-motif-exclusion-shape', 'motif 排除区 shape 必须是 rectangle 或 ellipse。', `${zoneLocation}.shape`);
          }
          if (!normalizedRectangleWithinCanvas(zone)) {
            add('error', 'composition-motif-exclusion-bounds', 'motif 排除区必须完整位于节点画布 0..1 内。', zoneLocation);
          }
          if (zone?.padding !== undefined && !(finite(zone.padding) && zone.padding >= 0 && zone.padding <= 0.25)) {
            add('error', 'composition-motif-exclusion-padding', 'motif 排除区 padding 必须位于 0..0.25。', `${zoneLocation}.padding`);
          }
        }
      }
      if (node.worldBinding !== undefined) {
        const binding = node.worldBinding;
        if (
          !nonEmpty(binding?.worldNodeId) ||
          !['far', 'mid', 'ground', 'near'].includes(binding?.stripRole) ||
          !(
            finite(binding?.relativeDriftAmplitude) &&
            binding.relativeDriftAmplitude >= 0 &&
            binding.relativeDriftAmplitude <= 0.05
          )
        ) {
          add(
            'error',
            'composition-motif-world-binding',
            'motif-field worldBinding 必须声明 worldNodeId、有效 stripRole 与 0..0.05 relativeDriftAmplitude。',
            `${nodeLocation}.worldBinding`,
          );
        }
      }
      if (!finite(node.transform?.height) || node.transform.height <= 0) {
        add('error', 'composition-motif-height', 'motif-field 必须声明 transform.height。', `${nodeLocation}.transform.height`);
      }
      if (issues.length === motifIssueCount) {
        try {
          resolveMotifFieldInstances(node);
        } catch (error) {
          add('error', 'composition-motif-placement', error.message, nodeLocation);
        }
      }
      continue;
    }

    if (node.kind === 'shape') {
      if (!['rectangle', 'ellipse', 'line'].includes(node.shape)) add('error', 'composition-shape-kind', `未知 shape：${node.shape}`, `${nodeLocation}.shape`);
      if (!finite(node.transform?.height) || node.transform.height <= 0) add('error', 'composition-shape-height', 'shape 节点必须声明 transform.height。', `${nodeLocation}.transform.height`);
      continue;
    }

    groups.push({node, parent, renderParticipation});
    if (!COMPOSITION_PATTERNS.includes(node.pattern)) add('error', 'composition-pattern', `未知组合模式：${node.pattern}`, `${nodeLocation}.pattern`);
    if (
      node.renderParticipation !== undefined &&
      !['visible', 'derivation-only'].includes(node.renderParticipation)
    ) {
      add(
        'error',
        'composition-render-participation',
        'group.renderParticipation 必须是 visible 或 derivation-only。',
        `${nodeLocation}.renderParticipation`,
      );
    }
    if (
      node.stackingContext !== undefined &&
      !['isolated', 'scene'].includes(node.stackingContext)
    ) {
      add(
        'error',
        'composition-stacking-context',
        'group.stackingContext 必须是 isolated 或 scene。',
        `${nodeLocation}.stackingContext`,
      );
    }
    if (node.stackingContext === 'scene') {
      const transform = node.transform ?? {};
      const staticAxisAlignedCarrier =
        finite(transform.x) &&
        finite(transform.y) &&
        finite(transform.width) &&
        transform.width > 0 &&
        (transform.height === undefined ||
          (finite(transform.height) && transform.height > 0)) &&
        finite(transform.anchorX) &&
        transform.anchorX >= 0 &&
        transform.anchorX <= 1 &&
        finite(transform.anchorY) &&
        transform.anchorY >= 0 &&
        transform.anchorY <= 1 &&
        (transform.scale === undefined || transform.scale === 1) &&
        (transform.rotation === undefined || transform.rotation === 0) &&
        (transform.opacity === undefined || transform.opacity === 1);
      const authored = maximumAuthoredMotion(node.motion);
      const identityMotion =
        authored.x === 0 &&
        authored.y === 0 &&
        authored.scale === 0 &&
        authored.rotationDegrees === 0 &&
        (node.motion?.keyframes ?? []).every(
          ({opacity = 1}) => opacity === 1,
        );
      const childZ = (node.children ?? []).map(({z}) => z);
      if (
        parent !== null ||
        node.pattern !== 'registered-depth-stack' ||
        renderParticipation !== 'visible'
      ) {
        add(
          'error',
          'composition-scene-stacking-scope',
          'scene stacking 只能用于顶层可见 registered-depth-stack。',
          `${nodeLocation}.stackingContext`,
        );
      }
      if (
        !staticAxisAlignedCarrier ||
        !identityMotion ||
        node.visibility !== undefined ||
        node.motion?.idle !== undefined ||
        node.motion?.path !== undefined
      ) {
        add(
          'error',
          'composition-scene-stacking-carrier',
          'scene stacking 组只能使用静态、轴对齐、全不透明的布局载体；不得动画、旋转、缩放、淡入淡出或声明 visibility。',
          nodeLocation,
        );
      }
      if (
        childZ.some((value) => !Number.isInteger(value)) ||
        new Set(childZ).size !== childZ.length
      ) {
        add(
          'error',
          'composition-scene-stacking-z',
          'scene stacking 的三个成员必须声明互不重复的整数 z，以便与场景兄弟节点确定性交错。',
          `${nodeLocation}.children`,
        );
      }
    }
    if (
      node.renderParticipation === 'derivation-only' &&
      (
        parent !== null ||
        !['supported-subject', 'registered-depth-stack'].includes(node.pattern)
      )
    ) {
      add(
        'error',
        'composition-derivation-only-scope',
        'derivation-only 只能用于顶层 supported-subject 或 registered-depth-stack 技术来源组。',
        `${nodeLocation}.renderParticipation`,
      );
    }
    if (
      node.renderParticipation === 'derivation-only' &&
      node.visibility !== undefined
    ) {
      add(
        'error',
        'composition-derivation-only-visibility',
        'derivation-only 组不参与运行时显隐，不能声明 visibility。',
        `${nodeLocation}.visibility`,
      );
    }
    if (!(finite(node.coordinateSpace?.width) && node.coordinateSpace.width > 0 && finite(node.coordinateSpace?.height) && node.coordinateSpace.height > 0)) add('error', 'composition-group-space', 'group.coordinateSpace 必须是有效画布。', `${nodeLocation}.coordinateSpace`);
    if (!Array.isArray(node.children) || node.children.length === 0) add('error', 'composition-group-children', 'group 至少需要一个 child。', `${nodeLocation}.children`);

    if (node.pattern === 'supported-subject') {
      const slots = new Map((node.children ?? []).filter((child) => ['asset', 'state-sequence'].includes(child.kind)).map((child) => [child.slot, child]));
      for (const slot of ['support-rear', 'subject', 'support-front']) {
        if (!slots.has(slot)) add('error', 'composition-support-slot', `supported-subject 缺少 ${slot}。`, `${nodeLocation}.children`);
      }
      if (!node.registration) add('error', 'composition-registration', 'supported-subject 必须声明 registration。', `${nodeLocation}.registration`);
      if (!node.support) add('error', 'composition-support', 'supported-subject 必须声明 support。', `${nodeLocation}.support`);
      const subject = slots.get('subject');
      if (subject && node.support?.subjectId !== subject.id) add('error', 'composition-support-subject', 'support.subjectId 必须指向 subject slot。', `${nodeLocation}.support.subjectId`);
      if (node.support?.layering !== undefined && !['between-supports', 'subject-front'].includes(node.support.layering)) add('error', 'composition-support-layering', 'support.layering 必须是 between-supports 或 subject-front。', `${nodeLocation}.support.layering`);
      for (const child of (node.children ?? []).filter((item) => ['asset', 'state-sequence'].includes(item.kind))) {
        const registrationId = child.kind === 'asset' ? child.registrationId : child.registration?.id;
        if (registrationId !== node.registration?.id) add('error', 'composition-registration-member', `耦合成员 ${child.id} 必须共享 registrationId。`, `${nodeLocation}.children`);
        const groupHasCarrierMotion = (node.motion?.keyframes ?? []).some((keyframe) =>
          (keyframe.offsetX ?? 0) !== 0 ||
          (keyframe.offsetY ?? 0) !== 0 ||
          (keyframe.scale ?? 1) !== 1 ||
          (keyframe.rotation ?? 0) !== 0,
        );
        if (groupHasCarrierMotion && stableStringify(child.motion?.keyframes) === stableStringify(node.motion?.keyframes)) {
          add('error', 'composition-duplicated-carrier-motion', `附着成员 ${child.id} 重复了父组的承载运动。`, `${nodeLocation}.children`);
        }
      }
      for (const proof of proofTimes) {
        if (node.support?.detachProofTimeIds?.includes(proof.id)) continue;
        const subjectX = node.support?.contactAnchor?.x + resolveAxisAt(subject?.motion?.keyframes, proof.at, 'offsetX');
        const subjectY = node.support?.contactAnchor?.y + resolveAxisAt(subject?.motion?.keyframes, proof.at, 'offsetY');
        if (!pointInPolygon([subjectX, subjectY], node.support?.contactZone)) add('error', 'composition-support-contact', `证明时刻 ${proof.id} 的主体支撑点离开 contactZone。`, `${nodeLocation}.support.contactZone`);
      }
    }

    if (node.pattern === 'registered-environment') {
      if (!node.registration) add('error', 'composition-registration', 'registered-environment 必须声明 registration。', `${nodeLocation}.registration`);
      if (node.registration && (node.registration.canvas.width !== node.coordinateSpace.width || node.registration.canvas.height !== node.coordinateSpace.height)) add('error', 'composition-registration-canvas', 'registration.canvas 必须与 group.coordinateSpace 一致。', `${nodeLocation}.registration.canvas`);
      const boundaries = new Map();
      for (const boundary of node.boundaries ?? []) {
        if (!nonEmpty(boundary.id) || boundaries.has(boundary.id)) add('error', 'composition-boundary-id', '边界 id 缺失或重复。', `${nodeLocation}.boundaries`);
        boundaries.set(boundary.id, boundary);
        const masksComplete = nonEmpty(boundary.upperMaskSrc) && nonEmpty(boundary.lowerMaskSrc);
        if (!(finite(boundary.normalizedY) || masksComplete)) add('error', 'composition-boundary-source', '边界必须声明 normalizedY 或上下两张 mask。', `${nodeLocation}.boundaries`);
      }
      const semantics = new Set();
      for (const child of (node.children ?? []).filter((item) => item.kind === 'asset')) {
        if (child.registrationId !== node.registration?.id) add('error', 'composition-registration-member', `注册环境成员 ${child.id} 必须共享 registrationId。`, `${nodeLocation}.children`);
        const transform = child.transform ?? {};
        if (transform.x !== 0 || transform.y !== 0 || transform.width !== 1 || transform.height !== 1 || transform.anchorX !== 0 || transform.anchorY !== 0) add('error', 'composition-registration-transform', `注册环境成员 ${child.id} 必须使用完整母版坐标。`, `${nodeLocation}.children`);
        if (child.clip && !boundaries.has(child.clip.boundaryId)) add('error', 'composition-boundary-reference', `资产 ${child.id} 引用了不存在的边界。`, `${nodeLocation}.children`);
        for (const semantic of child.semanticCoverage ?? []) {
          if (semantics.has(semantic)) add('error', 'composition-semantic-duplicate', `注册环境重复声明语义区域 ${semantic}。`, `${nodeLocation}.children`);
          semantics.add(semantic);
        }
      }
    }

    if (node.pattern === 'registered-depth-stack') {
      if (!node.registration) {
        add(
          'error',
          'composition-registration',
          'registered-depth-stack 必须声明 registration。',
          `${nodeLocation}.registration`,
        );
      }
      if (
        node.registration &&
        (node.registration.canvas.width !== node.coordinateSpace.width ||
          node.registration.canvas.height !== node.coordinateSpace.height)
      ) {
        add(
          'error',
          'composition-registration-canvas',
          'registration.canvas 必须与 group.coordinateSpace 一致。',
          `${nodeLocation}.registration.canvas`,
        );
      }
      if (
        !node.layerStack ||
        node.layerStack.motionCapability !== 'bounded-relative'
      ) {
        add(
          'error',
          'composition-layer-stack',
          'registered-depth-stack 必须声明 bounded-relative layerStack。',
          `${nodeLocation}.layerStack`,
        );
      }
      if (
        !['registered-layer-sheet', 'context-preserving-layer-edits'].includes(
          node.layerStack?.sourceStrategy,
        )
      ) {
        add(
          'error',
          'composition-layer-source-strategy',
          'registered-depth-stack 禁止从 opaque flat master 派生；必须使用 registered-layer-sheet 或完整上下文分层编辑。',
          `${nodeLocation}.layerStack.sourceStrategy`,
        );
      }
      const members = (node.children ?? []).filter((child) =>
        ['asset', 'state-sequence'].includes(child.kind),
      );
      if (
        members.length !== 3 ||
        (node.children ?? []).length !== members.length
      ) {
        add(
          'error',
          'composition-layer-member-count',
          'registered-depth-stack 必须恰好包含三个可注册视觉成员。',
          `${nodeLocation}.children`,
        );
      }
      const slots = new Map(members.map((child) => [child.slot, child]));
      for (const role of LAYER_ROLES) {
        if (!slots.has(role)) {
          add(
            'error',
            'composition-layer-slot',
            `registered-depth-stack 缺少 ${role}。`,
            `${nodeLocation}.children`,
          );
        }
      }
      const ordered = LAYER_ROLES.map((role) => slots.get(role));
      if (
        ordered.every((child) => finite(child?.depth)) &&
        !(
          ordered[0].depth < ordered[1].depth &&
          ordered[1].depth < ordered[2].depth
        )
      ) {
        add(
          'error',
          'composition-layer-depth-order',
          '三层 depth 必须严格满足 support-rear < subject < support-front。',
          `${nodeLocation}.children`,
        );
      }
      const profileLimits = node.layerStack?.revealEnvelope;
      const subjectTravelLimits = node.layerStack?.subjectTravelEnvelope;
      if (subjectTravelLimits) {
        const maxima = {
          x: 0.75,
          y: 0.5,
          scale: 0.5,
          rotationDegrees: 30,
        };
        for (const profile of RESPONSIVE_LAYER_PROFILES) {
          const limit = subjectTravelLimits[profile];
          if (!limit) {
            add(
              'error',
              'composition-subject-travel-profile',
              `layerStack.subjectTravelEnvelope 缺少 ${profile}。`,
              `${nodeLocation}.layerStack.subjectTravelEnvelope.${profile}`,
            );
            continue;
          }
          for (const [key, maximum] of Object.entries(maxima)) {
            if (
              !finite(limit[key]) ||
              limit[key] < 0 ||
              limit[key] > maximum
            ) {
              add(
                'error',
                'composition-subject-travel-limit',
                `${profile}.${key} 必须位于 0..${maximum}。`,
                `${nodeLocation}.layerStack.subjectTravelEnvelope.${profile}.${key}`,
              );
            }
          }
        }
      }
      for (const child of members) {
        const registrationId =
          child.kind === 'asset'
            ? child.registrationId
            : child.registration?.id;
        if (registrationId !== node.registration?.id) {
          add(
            'error',
            'composition-registration-member',
            `景深成员 ${child.id} 必须共享 registrationId。`,
            `${nodeLocation}.children`,
          );
        }
        const transform = child.transform ?? {};
        if (
          transform.x !== 0 ||
          transform.y !== 0 ||
          transform.width !== 1 ||
          transform.height !== 1 ||
          transform.anchorX !== 0 ||
          transform.anchorY !== 0
        ) {
          add(
            'error',
            'composition-layer-canvas',
            `景深成员 ${child.id} 必须保留完整注册画布；不得 tight crop。`,
            `${nodeLocation}.children`,
          );
        }
        const requested = maximumAuthoredMotion(child.motion);
        if (
          (child.motion?.keyframes ?? []).some(
            ({scale}) => finite(scale) && scale < 1,
          )
        ) {
          add(
            'error',
            'composition-layer-scale-shrink',
            `${child.id} 的 layer motion 不得缩小到 scale < 1；reveal envelope 的 scale 只表示保护性 overscan 扩张。`,
            `${nodeLocation}.children#${child.id}.motion`,
          );
        }
        for (const profile of RESPONSIVE_LAYER_PROFILES) {
          const limit =
            child.slot === 'subject' && subjectTravelLimits
              ? subjectTravelLimits[profile]
              : profileLimits?.[profile];
          if (!limit) {
            add(
              'error',
              child.slot === 'subject'
                ? 'composition-subject-travel-profile'
                : 'composition-layer-reveal-profile',
              `${child.slot === 'subject' ? 'layerStack.subjectTravelEnvelope' : 'layerStack.revealEnvelope'} 缺少 ${profile}。`,
              `${nodeLocation}.layerStack.${child.slot === 'subject' ? 'subjectTravelEnvelope' : 'revealEnvelope'}.${profile}`,
            );
            continue;
          }
          for (const key of ['x', 'y', 'scale', 'rotationDegrees']) {
            if (
              !finite(limit[key]) ||
              limit[key] < 0 ||
              requested[key] > limit[key] + 1e-9
            ) {
              add(
                'error',
                child.slot === 'subject' && subjectTravelLimits
                  ? 'composition-subject-travel-exceeded'
                  : 'composition-layer-reveal-exceeded',
                `${child.id} 的 ${key}=${requested[key]} 超过 ${profile} 已证明的${child.slot === 'subject' && subjectTravelLimits ? '主体航迹' : '显露'}包络 ${limit[key] ?? 'missing'}。`,
                `${nodeLocation}.children#${child.id}.motion`,
              );
            }
          }
        }
      }
    }

    if (node.pattern === 'looping-environment') {
      const environment = node.loopingEnvironment;
      const invalidTravel =
        environment?.axis !== 'x' ||
        !['left', 'right'].includes(environment?.travel?.direction) ||
        !['linear', 'ease-out'].includes(environment?.travel?.easing) ||
        !(finite(environment?.travel?.distanceViewports) && environment.travel.distanceViewports > 0) ||
        !(finite(environment?.travel?.startPhase) && environment.travel.startPhase >= 0 && environment.travel.startPhase < 1) ||
        !(finite(environment?.travel?.activeFrom ?? 0) && (environment?.travel?.activeFrom ?? 0) >= 0 && (environment?.travel?.activeFrom ?? 0) < 1) ||
        (environment?.travel?.activeUntil !== undefined && (!(finite(environment.travel.activeUntil) && environment.travel.activeUntil > 0 && environment.travel.activeUntil < 1) || environment.travel.activeUntil <= (environment.travel.activeFrom ?? 0))) ||
        (environment?.travel?.frozen !== undefined && typeof environment.travel.frozen !== 'boolean') ||
        (environment?.travel?.frozen === true && (environment?.travel?.activeFrom !== undefined || environment?.travel?.activeUntil !== undefined)) ||
        typeof environment?.travel?.closedLoop !== 'boolean';
      if (invalidTravel) {
        add('error', 'composition-looping-travel', 'looping-environment 必须声明有效 horizontal linear world travel。', `${nodeLocation}.loopingEnvironment.travel`);
      }
      if (
        !(finite(environment?.speedRange?.far) && environment.speedRange.far > 0) ||
        !(finite(environment?.speedRange?.near) && environment.speedRange.near > environment.speedRange.far)
      ) {
        add('error', 'composition-looping-speed-range', 'looping-environment 必须满足 0 < speedRange.far < speedRange.near。', `${nodeLocation}.loopingEnvironment.speedRange`);
      }
      if (!(finite(environment?.overscanPx) && environment.overscanPx >= 0 && environment.overscanPx <= 16)) {
        add('error', 'composition-looping-overscan', 'looping-environment overscanPx 必须位于 0..16。', `${nodeLocation}.loopingEnvironment.overscanPx`);
      }
      const strips = (node.children ?? []).filter((child) => child.kind === 'world-strip');
      const subjectBindings = environment?.subjectBindings ?? [];
      const subjectIds = new Set(subjectBindings.map(({nodeId}) => nodeId));
      const subjects = (node.children ?? []).filter(({id}) => subjectIds.has(id));
      const trackedBindings = subjectBindings.filter(({role}) => role === 'tracked');
      if (
        strips.length < 2 ||
        subjectBindings.length < 1 ||
        subjects.length !== subjectBindings.length ||
        subjects.some(({kind}) => !['asset', 'state-sequence', 'group'].includes(kind)) ||
        trackedBindings.length !== 1 ||
        (node.children ?? []).length !== strips.length + subjectBindings.length
      ) {
        add(
          'error',
          'composition-looping-members',
          'looping-environment 必须只包含至少两个 world-strip 与 subjectBindings 中声明的 asset/state-sequence/group 主体，且只能有一个 tracked 主体。',
          `${nodeLocation}.children`,
        );
      }
      const roles = new Set();
      const expectedSurfaceRole = {
        far: 'backdrop',
        mid: 'scenery',
        ground: 'walkable-ground',
        near: 'foreground-occluder',
      };
      for (const strip of strips) {
        if (roles.has(strip.role)) {
          add('error', 'composition-looping-role-duplicate', `looping-environment role 重复：${strip.role}。`, `${nodeLocation}.children`);
        }
        roles.add(strip.role);
        if (strip.surfaceRole !== expectedSurfaceRole[strip.role]) {
          add(
            'error',
            'composition-looping-surface-role',
            `world-strip ${strip.id} 的 role=${strip.role} 必须绑定 surfaceRole=${expectedSurfaceRole[strip.role] ?? 'valid-role'}。`,
            `${nodeLocation}.children#${strip.id}.surfaceRole`,
          );
        }
      }
      const ground = strips.find(({id}) => id === environment?.groundStripId);
      if (!ground || ground.role !== 'ground') {
        add('error', 'composition-looping-ground', 'loopingEnvironment.groundStripId 必须指向 role=ground 的 world-strip。', `${nodeLocation}.loopingEnvironment.groundStripId`);
      }
      if (trackedBindings.length !== 1) {
        add(
          'error',
          'composition-looping-tracked-subject',
          'loopingEnvironment.subjectBindings 必须且只能声明一个 role=tracked 的可读性主体。',
          `${nodeLocation}.loopingEnvironment.subjectBindings`,
        );
      }
      const subjectBindingIds = new Set();
      for (const [index, binding] of subjectBindings.entries()) {
        const subject = subjects.find(({id}) => id === binding.nodeId);
        if (
          !nonEmpty(binding.nodeId) ||
          subjectBindingIds.has(binding.nodeId) ||
          !['tracked', 'participant'].includes(binding.role) ||
          !['screen', 'world'].includes(binding.anchorMode) ||
          !['behind-near', 'above-near'].includes(binding.nearOcclusion) ||
          (
            binding.requireNearOverlap !== undefined &&
            typeof binding.requireNearOverlap !== 'boolean'
          ) ||
          !Array.isArray(binding.proofTimeIds) ||
          binding.proofTimeIds.length < 2 ||
          new Set(binding.proofTimeIds).size !== binding.proofTimeIds.length ||
          binding.proofTimeIds.some((id) => !proofTimes.some((proof) => proof.id === id)) ||
          !subject
        ) {
          add(
            'error',
            'composition-looping-subject-binding',
            '每个 subjectBinding 必须唯一绑定组内 asset/state-sequence，并声明有效 role、anchorMode、nearOcclusion 与可选 requireNearOverlap。',
            `${nodeLocation}.loopingEnvironment.subjectBindings[${index}]`,
          );
        }
        subjectBindingIds.add(binding.nodeId);
      }
      const seamProofs = ['before', 'seam', 'after'].map((key) =>
        proofTimes.find(({id}) => id === environment?.seamProofTimeIds?.[key]),
      );
      if (
        seamProofs.some((proof) => !proof) ||
        !(seamProofs[0]?.at < seamProofs[1]?.at && seamProofs[1]?.at < seamProofs[2]?.at)
      ) {
        add('error', 'composition-looping-seam-proofs', 'loopingEnvironment 必须绑定按时间递增的 before/seam/after 三个真实 proof time。', `${nodeLocation}.loopingEnvironment.seamProofTimeIds`);
      }
      const roleOrder = new Map(['far', 'mid', 'ground', 'near'].map((role, index) => [role, index]));
      const orderedByDepth = [...strips].sort(
        (left, right) => roleOrder.get(left.role) - roleOrder.get(right.role),
      );
      for (let index = 1; index < orderedByDepth.length; index += 1) {
        if (!(orderedByDepth[index - 1].depth < orderedByDepth[index].depth)) {
          add('error', 'composition-looping-depth-order', 'world-strip depth 必须严格递增，才能导出单调世界速度。', `${nodeLocation}.children`);
          break;
        }
      }
      if (
        environment &&
        !invalidTravel &&
        strips.length > 0 &&
        finite(node.coordinateSpace?.width) &&
        finite(node.coordinateSpace?.height)
      ) {
        let previousSpeed = -Infinity;
        for (const strip of orderedByDepth) {
          const speedFactor = resolveWorldStripSpeedFactor({
            depth: strip.depth,
            far: environment.speedRange.far,
            near: environment.speedRange.near,
          });
          if (!(speedFactor > previousSpeed)) {
            add('error', 'composition-looping-speed-order', 'world-strip 绝对速度必须随 depth 严格增加。', `${nodeLocation}.children`);
          }
          previousSpeed = speedFactor;
          const geometry = resolveWorldStripTileGeometry({
            viewportWidth: node.coordinateSpace.width,
            viewportHeight: node.coordinateSpace.height,
            renderHeight: strip.transform.height * node.coordinateSpace.height,
            sourceWidth: strip.loopingStripBinding.output.width,
            sourceHeight: strip.loopingStripBinding.output.height,
            overscanPx: environment.overscanPx,
          });
          const stripFrame = resolveWorldStripFrame({
            progress: 0.5,
            viewportWidth: node.coordinateSpace.width,
            tileWidth: geometry.tileWidth,
            direction: environment.travel.direction,
            distanceViewports: environment.travel.distanceViewports,
            speedFactor,
            startPhase: environment.travel.startPhase,
            activeFrom: environment.travel.activeFrom ?? 0,
            activeUntil: environment.travel.activeUntil ?? 1,
            easing: environment.travel.easing,
            overscanPx: environment.overscanPx,
          });
          const coverage = inspectWorldStripCoverage({
            copies: resolveWorldStripCopies({
              firstCopyX: stripFrame.firstCopyX,
              tileWidth: geometry.tileWidth,
              copyCount: geometry.copyCount,
            }),
            viewportWidth: node.coordinateSpace.width,
          });
          if (!coverage.passed) {
            add('error', 'composition-looping-coverage', `world-strip ${strip.id} 在最坏中间相位出现 ${coverage.uncoveredPixels.toFixed(3)}px 未覆盖。`, `${nodeLocation}.children#${strip.id}`);
          }
          if (environment.travel.closedLoop) {
            const closure = validateClosedWorldStripLoop({
              distanceViewports: environment.travel.distanceViewports,
              viewportWidth: node.coordinateSpace.width,
              speedFactor,
              tileWidth: geometry.tileWidth,
            });
            if (!closure.passed) {
              add('error', 'composition-looping-closure', `world-strip ${strip.id} 声明 closedLoop，但场景末相位误差为 ${closure.phaseError.toFixed(6)} periods。`, `${nodeLocation}.loopingEnvironment.travel.closedLoop`);
            }
          }
        }
        if (ground && environment.travel.frozen !== true) {
          const groundSpeed = resolveWorldStripSpeedFactor({
            depth: ground.depth,
            far: environment.speedRange.far,
            near: environment.speedRange.near,
          });
          if (environment.travel.distanceViewports * groundSpeed < 1 - 1e-9) {
            add('error', 'composition-looping-world-displacement', '必需 world travel 必须让 ground strip 在相机补偿后至少移动一个 viewport。', `${nodeLocation}.loopingEnvironment.travel.distanceViewports`);
          }
        }
      }
    }

    if (node.pattern === 'canonical-container') {
      const container = node.canonicalContainer;
      if (!node.registration) {
        add(
          'error',
          'composition-container-registration',
          'canonical-container 必须声明唯一母版 registration。',
          `${nodeLocation}.registration`,
        );
      }
      if (
        node.registration &&
        (
          node.registration.canvas.width !== node.coordinateSpace.width ||
          node.registration.canvas.height !== node.coordinateSpace.height
        )
      ) {
        add(
          'error',
          'composition-container-registration-canvas',
          '容器 registration.canvas 必须与 group.coordinateSpace 一致。',
          `${nodeLocation}.registration.canvas`,
        );
      }
      if (
        container?.schemaVersion !== 1 ||
        !nonEmpty(container?.familyId) ||
        container?.sourceStrategy !==
          'canonical-frame-with-content-sheet' ||
        !/^[a-f0-9]{64}$/.test(
          container?.familyFingerprint ?? '',
        )
      ) {
        add(
          'error',
          'composition-container-binding',
          'canonical-container 必须绑定当前 schema-v1 family fingerprint。',
          `${nodeLocation}.canonicalContainer`,
        );
      }
      const children = node.children ?? [];
      const cleanPlate = children.find(
        ({id}) => id === container?.cleanPlateNodeId,
      );
      const frame = children.find(
        ({id}) => id === container?.canonicalFrameNodeId,
      );
      const contents = children.find(
        ({id}) => id === container?.contentsNodeId,
      );
      if (
        children.length !== 3 ||
        cleanPlate?.kind !== 'asset' ||
        cleanPlate.slot !== 'container-clean-plate' ||
        frame?.kind !== 'asset' ||
        frame.slot !== 'container-frame' ||
        contents?.kind !== 'state-sequence' ||
        contents.slot !== 'container-contents'
      ) {
        add(
          'error',
          'composition-container-members',
          'canonical-container 必须且只能包含 container-clean-plate、container-contents、container-frame 三个权威成员。',
          `${nodeLocation}.children`,
        );
      }
      const expectedCoverage = {
        [container?.cleanPlateNodeId]:
          `container-clean-plate:${container?.familyId}`,
        [container?.contentsNodeId]:
          `container-surface:${container?.authoritativeSurfaceId}`,
        [container?.canonicalFrameNodeId]:
          `container-frame:${container?.familyId}`,
      };
      const coverageIds = new Set();
      for (const child of children) {
        const childLocation = `${nodeLocation}.children#${child.id}`;
        const registrationId =
          child.kind === 'state-sequence'
            ? child.registration?.id
            : child.registrationId;
        if (registrationId !== node.registration?.id) {
          add(
            'error',
            'composition-container-member-registration',
            `容器成员 ${child.id} 必须共享 registrationId。`,
            childLocation,
          );
        }
        const transform = child.transform ?? {};
        if (
          transform.x !== 0 ||
          transform.y !== 0 ||
          transform.width !== 1 ||
          transform.height !== 1 ||
          transform.anchorX !== 0 ||
          transform.anchorY !== 0
        ) {
          add(
            'error',
            'composition-container-member-transform',
            `容器成员 ${child.id} 必须保持完整母版画布，禁止独立缩放或错位。`,
            `${childLocation}.transform`,
          );
        }
        const hasLocalMotion = (
          child.motion?.keyframes ?? []
        ).some(
          ({
            offsetX = 0,
            offsetY = 0,
            scale = 1,
            rotation = 0,
            opacity = 1,
          }) =>
            offsetX !== 0 ||
            offsetY !== 0 ||
            scale !== 1 ||
            rotation !== 0 ||
            opacity !== 1,
        );
        if (
          hasLocalMotion ||
          (
            child.motion?.idle &&
            child.motion.idle.preset !== 'still'
          )
        ) {
          add(
            'error',
            'composition-container-member-motion',
            `容器成员 ${child.id} 不得独立漂移；整体运动只能由父组承载。`,
            `${childLocation}.motion`,
          );
        }
        const expected = expectedCoverage[child.id];
        const coverage = child.semanticCoverage ?? [];
        if (
          !expected ||
          coverage.length !== 1 ||
          coverage[0] !== expected ||
          coverageIds.has(coverage[0])
        ) {
          add(
            'error',
            'composition-container-authority',
            `容器成员 ${child.id} 必须且只能声明自身的一个权威语义覆盖。`,
            `${childLocation}.semanticCoverage`,
          );
        }
        coverageIds.add(coverage[0]);
      }
      if (
        contents?.poseFamilyId !== container?.familyId ||
        JSON.stringify(
          contents?.states?.map(({id}) => id),
        ) !==
          JSON.stringify(
            container?.states?.map(({id}) => id),
          )
      ) {
        add(
          'error',
          'composition-container-state-family',
          'container-contents 的状态 id 必须与 canonicalContainer.states 完全一致。',
          `${nodeLocation}.canonicalContainer.states`,
        );
      }
      const containerStateIds = new Set();
      let previousFill = -Infinity;
      for (const [index, state] of (
        container?.states ?? []
      ).entries()) {
        const stateLocation =
          `${nodeLocation}.canonicalContainer.states[${index}]`;
        if (
          !nonEmpty(state?.id) ||
          containerStateIds.has(state.id) ||
          !finite(state?.fillLevel) ||
          state.fillLevel <= previousFill ||
          !/^[a-f0-9]{64}$/.test(state?.sha256 ?? '') ||
          state.metrics?.outsideMaskPixels !== 0 ||
          state.metrics?.centerDrift >
            (container?.alignmentPolicy?.maximumCenterDrift ??
              -Infinity) ||
          state.metrics?.bottomGap >
            (container?.alignmentPolicy?.maximumBottomGap ??
              -Infinity) ||
          state.metrics?.fillLevelDeviation >
            (container?.alignmentPolicy
              ?.maximumFillLevelDeviation ?? -Infinity) ||
          state.metrics?.interiorRetention <
            (container?.alignmentPolicy
              ?.minimumInteriorRetention ?? Infinity)
        ) {
          add(
            'error',
            'composition-container-state-metrics',
            '每个容器状态必须唯一、fillLevel 递增、无内腔溢出，并满足对齐与填充偏差阈值。',
            stateLocation,
          );
        }
        containerStateIds.add(state?.id);
        previousFill = state?.fillLevel ?? previousFill;
      }
      const terminal = container?.states?.find(
        ({id}) => id === container?.terminalStateId,
      );
      if (
        !terminal ||
        terminal !== container?.states?.at(-1) ||
        terminal.metrics?.fillLevel <
          (container?.terminalPolicy?.minimumFillLevel ??
            Infinity) ||
        terminal.metrics?.rimGap >
          (container?.terminalPolicy?.maximumRimGap ??
            -Infinity) ||
        terminal.metrics?.bottomBandCoverage <
          (container?.terminalPolicy
            ?.minimumBottomBandCoverage ?? Infinity)
      ) {
        add(
          'error',
          'composition-container-terminal',
          '容器终态必须是最后状态，并满足最小填充、最大瓶口间隙和底部承载覆盖。',
          `${nodeLocation}.canonicalContainer.terminalStateId`,
        );
      }
    }
  }
  const topLevelWorlds = new Map(
    flat
      .filter(({node, parent}) =>
        parent === null &&
        node.kind === 'group' &&
        node.pattern === 'looping-environment'
      )
      .map(({node}) => [node.id, node]),
  );
  for (const {node} of motifFields) {
    if (!node.worldBinding) continue;
    const world = topLevelWorlds.get(node.worldBinding.worldNodeId);
    const strip = world?.children?.find(
      (child) =>
        child.kind === 'world-strip' &&
        child.role === node.worldBinding.stripRole,
    );
    if (!world || !strip) {
      add(
        'error',
        'composition-motif-world-target',
        `motif-field ${node.id} 必须绑定顶层 looping-environment 中实际存在的 ${node.worldBinding.stripRole} strip。`,
        `${location}.nodes#${node.id}.worldBinding`,
      );
    }
  }
  const authoritativeContainerSurfaces = new Map();
  for (const {node, renderParticipation} of flat) {
    if (
      renderParticipation !== 'visible' ||
      !['asset', 'state-sequence'].includes(node.kind)
    ) {
      continue;
    }
    for (const coverage of node.semanticCoverage ?? []) {
      if (!coverage.startsWith('container-surface:')) continue;
      const previous = authoritativeContainerSurfaces.get(coverage);
      if (previous) {
        add(
          'error',
          'composition-container-surface-duplicate',
          `权威容器表面 ${coverage} 被 ${previous.id} 与 ${node.id} 重复表示；水体、水面或其他同义贴图只能保留一个消费者。`,
          `${location}.nodes#${node.id}.semanticCoverage`,
        );
      } else {
        authoritativeContainerSurfaces.set(coverage, node);
      }
    }
  }
  const visibleAssetUses = new Map();
  for (const {node, parent, renderParticipation} of flat) {
    if (node.kind !== 'asset' || renderParticipation !== 'visible') continue;
    const key = stableStringify({
      source: node.src,
      parentId: parent?.id ?? 'scene-root',
      transform: node.transform,
      clip: node.clip ?? null,
    });
    const previous = visibleAssetUses.get(key);
    if (previous) {
      add(
        'error',
        'composition-duplicate-visible-asset',
        `可见资产 ${node.src} 在同一父坐标中以完全相同的 transform/clip 重复使用（${previous.id}、${node.id}）；这会造成半透明漂移或重影。重复装饰请使用 motif-field，前景只保留一个权威消费者。`,
        `${location}.nodes#${node.id}`,
      );
    } else {
      visibleAssetUses.set(key, node);
    }
  }
  const motifInstanceCount = motifFields.reduce(
    (total, {node}) =>
      total + (Number.isInteger(node.count) && node.count > 0 ? node.count : 0),
    0,
  );
  if (motifInstanceCount > MAX_MOTIF_INSTANCES_PER_SCENE) {
    add(
      'error',
      'composition-motif-scene-budget',
      `单镜头 motif-field 总实例数必须不超过 ${MAX_MOTIF_INSTANCES_PER_SCENE}，当前为 ${motifInstanceCount}。`,
      `${location}.nodes`,
    );
  }
  const proofFps = video.fps ?? 30;
  for (const proof of proofTimes) {
    const assertionStateIdsByNode = new Map();
    for (const assertion of proof.stateAssertions ?? []) {
      const stateIds = assertionStateIdsByNode.get(assertion.nodeId) ?? [];
      stateIds.push(assertion.stateId);
      assertionStateIdsByNode.set(assertion.nodeId, stateIds);
    }
    const checkedSequenceNodes = new Set();
    for (const assertion of proof.stateAssertions ?? []) {
      const entry = sequences.find(({node}) => node.id === assertion.nodeId);
      if (!entry) {
        add('error', 'composition-sequence-proof-node', `证明 ${proof.id} 引用了不存在的状态序列 ${assertion.nodeId}。`, `${location}.proofTimes#${proof.id}`);
        continue;
      }
      if (derivationOnlyNodeIds.has(assertion.nodeId)) {
        add(
          'error',
          'composition-derivation-only-proof',
          `证明 ${proof.id} 不能引用 derivation-only 状态序列 ${assertion.nodeId}。`,
          `${location}.proofTimes#${proof.id}`,
        );
        continue;
      }
      if (!entry.node.states.some(({id}) => id === assertion.stateId)) add('error', 'composition-sequence-proof-state', `证明 ${proof.id} 引用了不存在的状态 ${assertion.stateId}。`, `${location}.proofTimes#${proof.id}`);
      if (checkedSequenceNodes.has(assertion.nodeId)) continue;
      checkedSequenceNodes.add(assertion.nodeId);
      const allowedStateIds = [
        ...new Set(assertionStateIdsByNode.get(assertion.nodeId) ?? []),
      ];
      const parentWidth = entry.parent?.coordinateSpace?.width ?? video.width;
      const parentHeight = entry.parent?.coordinateSpace?.height ?? video.height;
      const pathAtProof = resolvePathMotionAtFrame({
        pathMotion: entry.node.motion?.path,
        frame: Math.round(
          proof.at * Math.max(1, Math.round(durationSeconds * proofFps) - 1),
        ),
        durationInFrames: Math.max(1, Math.round(durationSeconds * proofFps)),
        fps: proofFps,
        parentWidth,
        parentHeight,
      });
      const pathDepthVelocity = pathAtProof.depthVelocity ?? 0;
      const resolved = resolveSequenceState({
        node: entry.node,
        progress: proof.at,
        pathDepthVelocity,
      });
      if (!allowedStateIds.includes(resolved?.id)) {
        const expectation = allowedStateIds.length === 1
          ? allowedStateIds[0]
          : `覆盖集合 [${allowedStateIds.join(', ')}] 中的一种状态`;
        add('error', 'composition-sequence-proof-mismatch', `证明 ${proof.id} 期望 ${expectation}，但时间调度解析为 ${resolved?.id ?? 'none'}。`, `${location}.proofTimes#${proof.id}`);
      }
      const layersAtProof = resolveSequenceLayers({
        node: entry.node,
        progress: proof.at,
        durationSeconds,
        pathDepthVelocity,
      });
      if (entry.node.transition.type === 'crossfade' && layersAtProof.length > 1) add('error', 'composition-sequence-proof-transition', `证明 ${proof.id} 落在 ${resolved?.id ?? 'none'} 的交叉淡化中，此时状态尚未完全可见。`, `${location}.proofTimes#${proof.id}`);
      if (proof.kind === 'final') {
        const stabilitySpan = entry.node.transition.type === 'crossfade'
          ? entry.node.transition.durationSeconds / Math.max(durationSeconds, 1e-9)
          : 0;
        const samplePoints = [...new Set([
          proof.at,
          Math.max(0, proof.at - stabilitySpan),
          Math.min(1, proof.at + stabilitySpan),
          1,
        ])];
        const stable = samplePoints.every((progress) => {
          const frame = Math.round(
            progress * Math.max(1, Math.round(durationSeconds * proofFps) - 1),
          );
          const pathAtSample = resolvePathMotionAtFrame({
            pathMotion: entry.node.motion?.path,
            frame,
            durationInFrames: Math.max(1, Math.round(durationSeconds * proofFps)),
            fps: proofFps,
            parentWidth,
            parentHeight,
          });
          const layers = resolveSequenceLayers({
            node: entry.node,
            progress,
            durationSeconds,
            pathDepthVelocity: pathAtSample.depthVelocity ?? 0,
          });
          return layers.length === 1 && allowedStateIds.includes(layers[0].id) && Math.abs(layers[0].opacity - 1) < 1e-6;
        });
        if (!stable) add('error', 'composition-sequence-final-unstable', `最终证明 ${proof.id} 的状态集合 [${allowedStateIds.join(', ')}] 必须避开交叉淡化，并稳定保持到镜头结束。`, `${location}.proofTimes#${proof.id}`);
      }
    }
  }
  return {issues, nodeIds, derivationOnlyNodeIds, groups, assets, sequences, motifFields, worldStrips, freeNodes};
};

export const deriveEventTimeline = ({scene, sceneFrom = 0, fps}) =>
  (scene.events ?? []).map((event) => {
    const localFrame = Math.min(scene.durationInFrames - 1, Math.round(event.at * scene.durationInFrames));
    return {
      sceneId: scene.id,
      eventId: event.id,
      beatId: event.beatId,
      targetId: event.targetId,
      visualKind: event.visual?.kind ?? null,
      action: event.visual?.action ?? null,
      localFrame,
      absoluteFrame: sceneFrom + localFrame,
      seconds: (sceneFrom + localFrame) / fps,
      proofTimeId: event.proofTimeId ?? null,
      sound: event.sound?.src ?? null,
    };
  });
