import {stableValue} from './contract-utils.mjs';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {
  assertAssetManifest,
  createAssetRecordId,
} from './asset-manifest-lib.mjs';
import {removeChromaKey} from './chroma-key-lib.mjs';
import {
  BAKED_CHECKERBOARD_MODE,
  BAKED_CHECKERBOARD_POLICY_ID,
  removeBakedCheckerboard,
} from './checkerboard-alpha-lib.mjs';
import {composeDecorativeScatter} from './decorative-scatter-lib.mjs';
import {hashCompositionValue} from './composition-lib.mjs';
import {resolveWorldStripTileGeometry} from '../src/worldStrip.mjs';

export const LOOPING_STRIP_RECOVERY_POLICY = {
  strategy: 'preserve-complete-strip-context',
  localDeterministicFixFirst: true,
  isolatedEdgeGeneration: 'forbidden',
  providerRepair: 'masked-complete-strip-edit',
  fallback: 'full-strip-regeneration',
};

const PROFILES = ['16:9', '9:16', '1:1'];
const ROLES = ['far', 'mid', 'ground', 'near'];
const STRATEGIES = ['exact', 'overlap-crop', 'mirror-crop'];
const GROUND_MINIMUM_EDGE_ALPHA_COVERAGE = 0.05;
const MIRROR_CROP_RENDER_TOLERANCE = {
  rgbMean: 0.01,
  rgbMaximum: 0.2,
  alphaMean: 0.002,
  alphaMaximum: 0.2,
};
export const SEAM_SALIENCE_POLICY = {
  policyId: 'vertical-rail-v1',
  contrastThreshold: 0.08,
  meanMaximum: 0.045,
  p95Maximum: 0.12,
  verticalCoverageMaximum: 0.35,
};
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const sameValue = (left, right) =>
  JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const sha256File = async (file) => sha256(await fs.readFile(file));
const posixRelative = (root, file) => path.relative(root, file).split(path.sep).join('/');

const DEFAULT_SOURCE_SURFACE = {mode: 'opaque'};
const validKeyColor = (value) => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
const sourceSurfaceFor = (spec) => spec?.sourceSurface ?? DEFAULT_SOURCE_SURFACE;
const sameKeyColor = (left, right) => left?.toLowerCase() === right?.toLowerCase();
const thresholdsForRenderScale = (spec) =>
  spec.seamStrategy === 'mirror-crop'
    ? Object.fromEntries(
      Object.entries(spec.thresholds).map(([key, value]) => [
        key,
        Math.max(value, MIRROR_CROP_RENDER_TOLERANCE[key]),
      ]),
    )
    : spec.thresholds;

const validateChromaKeying = (keying) => {
  if (!isObject(keying)) return '色键 sourceSurface 必须声明 keying';
  if (!validKeyColor(keying.keyColor)) return '色键 keying.keyColor 必须是 #RRGGBB';
  if (!(Number.isFinite(keying.transparentThreshold) && keying.transparentThreshold >= 0 && keying.transparentThreshold <= 255)) {
    return '色键 keying.transparentThreshold 必须位于 0..255';
  }
  if (!(Number.isFinite(keying.opaqueThreshold) && keying.opaqueThreshold > keying.transparentThreshold && keying.opaqueThreshold <= 255)) {
    return '色键 keying.opaqueThreshold 必须大于 transparentThreshold 且不超过 255';
  }
  if (!(Number.isFinite(keying.edgeFeather) && keying.edgeFeather >= 0 && keying.edgeFeather <= 8)) {
    return '色键 keying.edgeFeather 必须位于 0..8';
  }
  if (!(Number.isInteger(keying.matteErode) && keying.matteErode >= 0 && keying.matteErode <= 8)) {
    return '色键 keying.matteErode 必须是 0..8 的整数';
  }
  if (!(Number.isInteger(keying.edgePadding) && keying.edgePadding >= 0 && keying.edgePadding <= 64)) {
    return '色键 keying.edgePadding 必须是 0..64 的整数';
  }
  return null;
};

const validateCheckerboardAlpha = (value) => {
  if (!isObject(value)) return 'baked-checkerboard-alpha 必须声明 checkerboardAlpha';
  if (
    !(
      Number.isFinite(value.transparentDistance) &&
      value.transparentDistance >= 0 &&
      value.transparentDistance <= 255
    )
  ) {
    return 'checkerboardAlpha.transparentDistance 必须位于 0..255';
  }
  if (
    !(
      Number.isFinite(value.opaqueDistance) &&
      value.opaqueDistance > value.transparentDistance &&
      value.opaqueDistance <= 255
    )
  ) {
    return 'checkerboardAlpha.opaqueDistance 必须大于 transparentDistance 且不超过 255';
  }
  return null;
};

const validateDecorativeScatter = (scatter) => {
  if (!isObject(scatter)) return null;
  if (!Number.isInteger(scatter.seed)) return 'decorativeScatter.seed 必须是整数';
  if (
    !Number.isInteger(scatter.canvas?.width) ||
    scatter.canvas.width < 1 ||
    !Number.isInteger(scatter.canvas?.height) ||
    scatter.canvas.height < 1
  ) {
    return 'decorativeScatter.canvas 必须是正整数画布';
  }
  if (!Array.isArray(scatter.regions) || scatter.regions.length < 1 || scatter.regions.length > 32) {
    return 'decorativeScatter.regions 必须包含 1..32 个区域';
  }
  const ids = new Set();
  for (const region of scatter.regions) {
    if (!nonEmpty(region.id) || ids.has(region.id) || !validRect(region)) {
      return 'decorativeScatter region id 必须唯一且矩形有效';
    }
    ids.add(region.id);
  }
  if (!Array.isArray(scatter.placements) || scatter.placements.length < 1 || scatter.placements.length > 64) {
    return 'decorativeScatter.placements 必须包含 1..64 项';
  }
  for (const placement of scatter.placements) {
    if (
      !ids.has(placement.sourceId) ||
      ![placement.x, placement.y, placement.scale, placement.rotation, placement.anchorX, placement.anchorY].every(Number.isFinite) ||
      placement.x < 0 || placement.x > 1 ||
      placement.y < 0 || placement.y > 1 ||
      placement.scale <= 0 || placement.scale > 2 ||
      placement.rotation < -30 || placement.rotation > 30 ||
      placement.anchorX < 0 || placement.anchorX > 1 ||
      placement.anchorY < 0 || placement.anchorY > 1 ||
      typeof placement.flipX !== 'boolean'
    ) {
      return 'decorativeScatter placement 必须引用已知区域并声明合法变换与锚点';
    }
  }
  return null;
};

const validRect = (rect) =>
  isObject(rect) &&
  Number.isInteger(rect.left) &&
  rect.left >= 0 &&
  Number.isInteger(rect.top) &&
  rect.top >= 0 &&
  Number.isInteger(rect.width) &&
  rect.width > 0 &&
  Number.isInteger(rect.height) &&
  rect.height > 0;

const validAlphaFeather = (value, tileHeight) =>
  isObject(value) &&
  Number.isInteger(value.topPixels) &&
  value.topPixels >= 0 &&
  value.topPixels <= 1024 &&
  Number.isInteger(value.bottomPixels) &&
  value.bottomPixels >= 0 &&
  value.bottomPixels <= 1024 &&
  value.topPixels + value.bottomPixels > 0 &&
  value.topPixels + value.bottomPixels < tileHeight;

const resolveInside = (root, input, label) => {
  const resolved = path.resolve(root, input);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`${label}越过工作区：${input}`);
  }
  return resolved;
};

export const validateLoopingStripSpec = (spec) => {
  const errors = [];
  if (spec?.schemaVersion !== 1) errors.push('schemaVersion 必须为 1');
  for (const field of ['projectSlug', 'sceneId', 'groupId', 'nodeId', 'stripId', 'assetId', 'sourceAssetId', 'output']) {
    if (!nonEmpty(spec?.[field])) errors.push(`${field} 不能为空`);
  }
  if (!slugPattern.test(spec?.projectSlug ?? '')) errors.push('projectSlug 格式无效');
  if (!ROLES.includes(spec?.role)) errors.push('role 必须是 far、mid、ground 或 near');
  if (spec?.axis !== 'x') errors.push('Phase 2.5 只支持 axis=x');
  if (!STRATEGIES.includes(spec?.seamStrategy)) errors.push('seamStrategy 必须是 exact、overlap-crop 或 mirror-crop');
  if (!validRect(spec?.canonicalTile)) errors.push('canonicalTile 必须是正整数像素矩形');
  if (
    spec?.alphaFeather !== undefined &&
    !validAlphaFeather(spec.alphaFeather, spec?.canonicalTile?.height ?? 0)
  ) {
    errors.push('alphaFeather 必须声明非零且不覆盖完整条带高度的 topPixels/bottomPixels');
  }
  if (
    spec?.edgeStabilizationPixels !== undefined &&
    !(
      Number.isInteger(spec.edgeStabilizationPixels) &&
      spec.edgeStabilizationPixels >= 0 &&
      spec.edgeStabilizationPixels <= 64 &&
      spec.edgeStabilizationPixels * 2 < (spec?.canonicalTile?.width ?? 0)
    )
  ) {
    errors.push('edgeStabilizationPixels 必须是 0..64 且小于 canonicalTile 一半宽度的整数');
  }
  if (!(Number.isInteger(spec?.edgeBandPixels) && spec.edgeBandPixels >= 1 && spec.edgeBandPixels <= 128)) {
    errors.push('edgeBandPixels 必须是 1..128 的整数');
  }
  for (const key of ['rgbMean', 'rgbMaximum', 'alphaMean', 'alphaMaximum']) {
    const value = spec?.thresholds?.[key];
    if (!(Number.isFinite(value) && value >= 0 && value <= 1)) errors.push(`thresholds.${key} 必须位于 0..1`);
  }
  if (!(Number.isFinite(spec?.minimumViewportSpan) && spec.minimumViewportSpan >= 1)) {
    errors.push('minimumViewportSpan 必须至少为 1');
  }
  if (
    !Array.isArray(spec?.proofViewports) ||
    spec.proofViewports.length !== 3 ||
    new Set(spec.proofViewports.map(({profile}) => profile)).size !== 3
  ) {
    errors.push('proofViewports 必须恰好覆盖 16:9、9:16、1:1');
  }
  for (const profile of PROFILES) {
    const viewport = spec?.proofViewports?.find((candidate) => candidate.profile === profile);
    if (
      !viewport ||
      ![viewport.width, viewport.height, viewport.renderHeight].every(
        (value) => Number.isInteger(value) && value > 0,
      )
    ) {
      errors.push(`proofViewports 缺少有效 ${profile} 画幅`);
    }
  }
  if (!sameValue(spec?.recoveryPolicy, LOOPING_STRIP_RECOVERY_POLICY)) {
    errors.push('recoveryPolicy 必须保持完整条带上下文，禁止 isolated edge generation');
  }
  const sourceSurface = sourceSurfaceFor(spec);
  if (!isObject(sourceSurface) || !['opaque', 'chroma-key', BAKED_CHECKERBOARD_MODE].includes(sourceSurface.mode)) {
    errors.push('sourceSurface 必须是 opaque、chroma-key 或 baked-checkerboard-alpha');
  } else if (sourceSurface.mode === 'chroma-key') {
    if (!validKeyColor(sourceSurface.keyColor)) {
      errors.push('chroma-key sourceSurface 必须声明 #RRGGBB keyColor');
    }
    const keyingError = validateChromaKeying(spec?.keying);
    if (keyingError) errors.push(keyingError);
    if (spec?.keying && !sameKeyColor(sourceSurface.keyColor, spec.keying.keyColor)) {
      errors.push('sourceSurface.keyColor 必须与 keying.keyColor 一致');
    }
  } else if (sourceSurface.mode === BAKED_CHECKERBOARD_MODE) {
    const checkerboardError = validateCheckerboardAlpha(spec?.checkerboardAlpha);
    if (checkerboardError) errors.push(checkerboardError);
    if (spec?.keying !== undefined) {
      errors.push('baked-checkerboard-alpha 不能声明 chroma keying');
    }
  } else if (spec?.keying !== undefined || spec?.checkerboardAlpha !== undefined) {
    errors.push('opaque sourceSurface 不能声明 keying');
  }
  const scatterError = validateDecorativeScatter(spec?.decorativeScatter);
  if (scatterError) errors.push(scatterError);
  if (typeof spec?.applyToProject !== 'boolean') errors.push('applyToProject 必须是 boolean');
  return errors;
};

const rawRgba = async (input) => {
  const {data, info} = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({resolveWithObject: true});
  return {data, width: info.width, height: info.height, channels: info.channels};
};

export const compareHorizontalEdgeBands = async (
  input,
  edgeBandPixels,
  {mirrorRight = false} = {},
) => {
  const {data, width, height, channels} = await rawRgba(input);
  const band = Math.min(edgeBandPixels, Math.floor(width / 2));
  if (band < 1) throw new Error('条带过窄，无法比较左右边缘。');
  let rgbTotal = 0;
  let alphaTotal = 0;
  let rgbMaximum = 0;
  let alphaMaximum = 0;
  const pixelRgbDifferences = new Uint8Array(band * height);
  const pixelAlphaDifferences = new Uint8Array(band * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < band; x += 1) {
      const leftOffset = (y * width + x) * channels;
      // mirror-crop repeats through a reflected edge: the last pixel of the
      // current tile meets the first pixel of the next one. Compare the right
      // edge in that reflected orientation, otherwise a texture gradient is
      // incorrectly reported as a seam even though its rendered join is
      // continuous.
      const rightX = mirrorRight ? width - 1 - x : width - band + x;
      const rightOffset = (y * width + rightX) * channels;
      // Compare premultiplied colour. PNG RGB values in transparent pixels are
      // not visible and must not turn a harmless resampling fringe into a
      // false red/green/blue seam failure.
      const leftAlpha = data[leftOffset + 3] / 255;
      const rightAlpha = data[rightOffset + 3] / 255;
      const red = Math.abs(data[leftOffset] * leftAlpha - data[rightOffset] * rightAlpha);
      const green = Math.abs(data[leftOffset + 1] * leftAlpha - data[rightOffset + 1] * rightAlpha);
      const blue = Math.abs(data[leftOffset + 2] * leftAlpha - data[rightOffset + 2] * rightAlpha);
      const alpha = Math.abs(data[leftOffset + 3] - data[rightOffset + 3]);
      const rgb = Math.max(red, green, blue);
      const pixel = y * band + x;
      pixelRgbDifferences[pixel] = rgb;
      pixelAlphaDifferences[pixel] = alpha;
      rgbTotal += (red + green + blue) / 3;
      alphaTotal += alpha;
      rgbMaximum = Math.max(rgbMaximum, rgb);
      alphaMaximum = Math.max(alphaMaximum, alpha);
    }
  }
  const pixelCount = band * height;
  return {
    width,
    height,
    bandPixels: band,
    rgbMean: rgbTotal / pixelCount / 255,
    rgbMaximum: rgbMaximum / 255,
    alphaMean: alphaTotal / pixelCount / 255,
    alphaMaximum: alphaMaximum / 255,
    pixelRgbDifferences,
    pixelAlphaDifferences,
  };
};

// A strip can have a perfectly matching transparent left/right margin while
// still exposing a large hole whenever tiles repeat. That is harmless for a
// decorative overlay, but it is invalid for the ground that carries a route.
// Measure the actual alpha support at both repeat boundaries rather than only
// comparing the two boundaries to one another.
export const inspectHorizontalEdgeAlphaCoverage = async (input, edgeBandPixels) => {
  const {data, width, height, channels} = await rawRgba(input);
  const band = Math.min(edgeBandPixels, Math.floor(width / 2));
  if (band < 1) throw new Error('条带过窄，无法检查 ground repeat edge。');
  const coverageFor = (left) => {
    let total = 0;
    for (let y = 0; y < height; y += 1) {
      for (let index = 0; index < band; index += 1) {
        const x = left ? index : width - band + index;
        total += data[(y * width + x) * channels + 3] / 255;
      }
    }
    return total / (band * height);
  };
  const left = coverageFor(true);
  const right = coverageFor(false);
  return {
    bandPixels: band,
    left,
    right,
    minimum: Math.min(left, right),
  };
};

const percentile = (values, quantile) => {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(
    ordered.length - 1,
    Math.max(0, Math.ceil(ordered.length * quantile) - 1),
  )];
};

/**
 * Detect a visually salient vertical rail even when both sides of the repeat
 * are pixel-identical. The seam band is compared with wider neighborhoods on
 * both sides, using premultiplied RGBA per scanline. A natural localized plant
 * may affect a few rows; a repeated construction rail spans much of the image.
 */
export const inspectVerticalSeamSalience = async (
  input,
  {foldX = null, bandPixels = 2, policy = SEAM_SALIENCE_POLICY} = {},
) => {
  const {data, width, height, channels} = await rawRgba(input);
  const band = Math.max(1, Math.min(
    Math.floor(width / 8),
    Math.round(bandPixels),
  ));
  const sample = (x, y) => {
    const wrappedX = ((x % width) + width) % width;
    const offset = (y * width + wrappedX) * channels;
    const alpha = data[offset + 3] / 255;
    return [
      data[offset] * alpha / 255,
      data[offset + 1] * alpha / 255,
      data[offset + 2] * alpha / 255,
      alpha,
    ];
  };
  const regionMean = (from, to, y) => {
    const total = [0, 0, 0, 0];
    let count = 0;
    for (let x = from; x < to; x += 1) {
      const pixel = sample(x, y);
      for (let channel = 0; channel < 4; channel += 1) {
        total[channel] += pixel[channel];
      }
      count += 1;
    }
    return total.map((value) => value / Math.max(1, count));
  };
  const inspectAt = (seamX, kind) => {
    const contrasts = [];
    for (let y = 0; y < height; y += 1) {
      const seam = regionMean(seamX - band, seamX + band, y);
      const left = regionMean(seamX - band * 4, seamX - band * 2, y);
      const right = regionMean(seamX + band * 2, seamX + band * 4, y);
      const neighbor = left.map((value, channel) => (value + right[channel]) / 2);
      contrasts.push(Math.max(
        Math.abs(seam[0] - neighbor[0]),
        Math.abs(seam[1] - neighbor[1]),
        Math.abs(seam[2] - neighbor[2]),
        Math.abs(seam[3] - neighbor[3]),
      ));
    }
    const mean = contrasts.reduce((sum, value) => sum + value, 0) /
      Math.max(1, contrasts.length);
    const p95 = percentile(contrasts, 0.95);
    const maximum = Math.max(...contrasts, 0);
    const verticalCoverage = contrasts.filter(
      (value) => value >= policy.contrastThreshold,
    ).length / Math.max(1, contrasts.length);
    return {
      kind,
      x: seamX,
      bandPixels: band,
      mean,
      p95,
      maximum,
      verticalCoverage,
      passed:
        mean <= policy.meanMaximum + 1e-12 &&
        p95 <= policy.p95Maximum + 1e-12 &&
        verticalCoverage <= policy.verticalCoverageMaximum + 1e-12,
    };
  };
  const seams = [inspectAt(0, 'tile-boundary')];
  if (Number.isFinite(foldX) && foldX > band * 4 && foldX < width - band * 4) {
    seams.push(inspectAt(Math.round(foldX), 'mirror-fold'));
  }
  return {
    policy,
    width,
    height,
    seams,
    passed: seams.every(({passed}) => passed),
  };
};

const applyAlphaFeather = async (input, alphaFeather) => {
  if (!alphaFeather) return input;
  const {data, info} = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({resolveWithObject: true});
  for (let y = 0; y < info.height; y += 1) {
    const topFactor = alphaFeather.topPixels > 0
      ? Math.min(1, y / alphaFeather.topPixels)
      : 1;
    const bottomFactor = alphaFeather.bottomPixels > 0
      ? Math.min(1, (info.height - 1 - y) / alphaFeather.bottomPixels)
      : 1;
    const factor = Math.min(topFactor, bottomFactor);
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * info.channels + 3;
      data[offset] = Math.round(data[offset] * factor);
    }
  }
  return sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels,
    },
  }).png().toBuffer();
};

const deriveTileBuffer = async ({sourceBuffer, spec}) => {
  let canonical = await sharp(sourceBuffer).extract(spec.canonicalTile).png().toBuffer();
  if ((spec.edgeStabilizationPixels ?? 0) > 0) {
    const pixels = await sharp(canonical)
      .ensureAlpha()
      .raw()
      .toBuffer({resolveWithObject: true});
    const stabilized = Buffer.from(pixels.data);
    const band = spec.edgeStabilizationPixels;
    for (let y = 0; y < pixels.info.height; y += 1) {
      const leftSource = (y * pixels.info.width + band) * pixels.info.channels;
      const rightSource =
        (y * pixels.info.width + pixels.info.width - band - 1) *
        pixels.info.channels;
      for (let x = 0; x < band; x += 1) {
        pixels.data.copy(
          stabilized,
          (y * pixels.info.width + x) * pixels.info.channels,
          leftSource,
          leftSource + pixels.info.channels,
        );
        pixels.data.copy(
          stabilized,
          (y * pixels.info.width + pixels.info.width - 1 - x) *
            pixels.info.channels,
          rightSource,
          rightSource + pixels.info.channels,
        );
      }
    }
    canonical = await sharp(stabilized, {
      raw: {
        width: pixels.info.width,
        height: pixels.info.height,
        channels: pixels.info.channels,
      },
    }).png().toBuffer();
  }
  const tile = spec.seamStrategy !== 'mirror-crop'
    ? canonical
    : await (async () => {
      const metadata = await sharp(canonical).metadata();
      const mirrored = await sharp(canonical).flop().png().toBuffer();
      return sharp({
        create: {
          width: metadata.width * 2,
          height: metadata.height,
          channels: 4,
          background: {r: 0, g: 0, b: 0, alpha: 0},
        },
      })
        .composite([
          {input: canonical, left: 0, top: 0},
          {input: mirrored, left: metadata.width, top: 0},
        ])
        .png()
        .toBuffer();
    })();
  return applyAlphaFeather(tile, spec.alphaFeather);
};

export const edgeMetricsPass = (metrics, thresholds) =>
  metrics.rgbMean <= thresholds.rgbMean + 1e-12 &&
  metrics.rgbMaximum <= thresholds.rgbMaximum + 1e-12 &&
  metrics.alphaMean <= thresholds.alphaMean + 1e-12 &&
  metrics.alphaMaximum <= thresholds.alphaMaximum + 1e-12;

const publicBindingPath = (root, file) => {
  const publicRoot = path.join(root, 'public');
  if (file !== publicRoot && !file.startsWith(`${publicRoot}${path.sep}`)) {
    throw new Error(`looping strip output 必须位于 public/：${file}`);
  }
  return posixRelative(publicRoot, file);
};

const writeEvidence = async ({
  tileBuffer,
  sourceMetrics,
  evidenceDirectory,
  stripId,
  mirrorRight = false,
}) => {
  await fs.mkdir(evidenceDirectory, {recursive: true});
  const tile = sharp(tileBuffer);
  const metadata = await tile.metadata();
  const band = sourceMetrics.bandPixels;
  const left = await sharp(tileBuffer).extract({left: 0, top: 0, width: band, height: metadata.height}).png().toBuffer();
  const rightRaw = await sharp(tileBuffer).extract({left: metadata.width - band, top: 0, width: band, height: metadata.height}).png().toBuffer();
  const right = mirrorRight ? await sharp(rightRaw).flop().png().toBuffer() : rightRaw;
  const comparisonFile = path.join(evidenceDirectory, `${stripId}-edge-comparison.png`);
  const stitchFile = path.join(evidenceDirectory, `${stripId}-three-tile-stitch.png`);
  const rgbHeatmapFile = path.join(evidenceDirectory, `${stripId}-rgb-heatmap.png`);
  const alphaHeatmapFile = path.join(evidenceDirectory, `${stripId}-alpha-heatmap.png`);
  const divider = await sharp({
    create: {width: 2, height: metadata.height, channels: 4, background: '#ffcc00'},
  }).png().toBuffer();
  await sharp({
    create: {
      width: band * 2 + 2,
      height: metadata.height,
      channels: 4,
      background: {r: 0, g: 0, b: 0, alpha: 0},
    },
  }).composite([
    {input: left, left: 0, top: 0},
    {input: divider, left: band, top: 0},
    {input: right, left: band + 2, top: 0},
  ]).png().toFile(comparisonFile);
  await sharp({
    create: {
      width: metadata.width * 3,
      height: metadata.height,
      channels: 4,
      background: {r: 0, g: 0, b: 0, alpha: 0},
    },
  }).composite([
    {input: tileBuffer, left: 0, top: 0},
    {input: tileBuffer, left: metadata.width, top: 0},
    {input: tileBuffer, left: metadata.width * 2, top: 0},
  ]).png().toFile(stitchFile);
  const heatmap = async (values, color, output) => {
    const rgba = Buffer.alloc(band * metadata.height * 4);
    for (let index = 0; index < values.length; index += 1) {
      const offset = index * 4;
      rgba[offset] = color === 'rgb' ? values[index] : 0;
      rgba[offset + 1] = 0;
      rgba[offset + 2] = color === 'alpha' ? values[index] : 0;
      rgba[offset + 3] = 255;
    }
    await sharp(rgba, {raw: {width: band, height: metadata.height, channels: 4}})
      .resize({width: Math.max(64, band * 8), height: metadata.height, kernel: 'nearest'})
      .png()
      .toFile(output);
  };
  await Promise.all([
    heatmap(sourceMetrics.pixelRgbDifferences, 'rgb', rgbHeatmapFile),
    heatmap(sourceMetrics.pixelAlphaDifferences, 'alpha', alphaHeatmapFile),
  ]);
  return {comparisonFile, stitchFile, rgbHeatmapFile, alphaHeatmapFile};
};

export const deriveLoopingStrip = async ({
  root,
  spec,
  manifest: manifestInput,
}) => {
  const errors = validateLoopingStripSpec(spec);
  if (errors.length > 0) throw new Error(errors.join('；'));
  const manifest = assertAssetManifest(structuredClone(manifestInput), spec.projectSlug);
  const sourceRecord = manifest.assets.find(
    (record) =>
      record.assetId === spec.sourceAssetId &&
      ['active', 'recovery-source'].includes(record.lifecycle?.status),
  );
  if (!sourceRecord) {
    throw new Error(`找不到 active 或 recovery-source source asset：${spec.sourceAssetId}`);
  }
  const sourceFile = resolveInside(root, sourceRecord.file, 'source asset');
  const outputFile = resolveInside(root, spec.output, 'looping strip output');
  const sourceSurface = sourceSurfaceFor(spec);
  const sourceRequestSurface = sourceRecord.request?.outputSurface ?? null;
  if (
    sourceSurface.mode === 'chroma-key' &&
    (
      sourceRequestSurface?.mode !== 'chroma-key' ||
      !sameKeyColor(sourceRequestSurface.keyColor, sourceSurface.keyColor)
    )
  ) {
    throw new Error(
      `source asset ${spec.sourceAssetId} 必须保留匹配的 provider chroma-key provenance`,
    );
  }
  if (
    sourceSurface.mode === BAKED_CHECKERBOARD_MODE &&
    (
      sourceRecord.lifecycle?.status !== 'recovery-source' ||
      sourceRecord.providerObservation?.mode !== BAKED_CHECKERBOARD_MODE ||
      sourceRecord.providerObservation?.policyId !== BAKED_CHECKERBOARD_POLICY_ID ||
      sourceRequestSurface?.mode !== 'alpha'
    )
  ) {
    throw new Error(
      `source asset ${spec.sourceAssetId} 必须保留通过的 baked-checkerboard recovery provenance`,
    );
  }
  let sourceBuffer = await fs.readFile(sourceFile);
  let keyingMetadata = null;
  if (sourceSurface.mode === 'chroma-key') {
    ({buffer: sourceBuffer, metadata: keyingMetadata} = await removeChromaKey({
      input: sourceFile,
      ...spec.keying,
    }));
  } else if (sourceSurface.mode === BAKED_CHECKERBOARD_MODE) {
    ({buffer: sourceBuffer, metadata: keyingMetadata} = await removeBakedCheckerboard({
      input: sourceFile,
      ...spec.checkerboardAlpha,
    }));
  }
  if (spec.decorativeScatter) {
    sourceBuffer = await composeDecorativeScatter({
      source: sourceBuffer,
      ...spec.decorativeScatter,
    });
  }
  const sourceMetadata = await sharp(sourceBuffer).metadata();
  if (
    spec.canonicalTile.left + spec.canonicalTile.width > sourceMetadata.width ||
    spec.canonicalTile.top + spec.canonicalTile.height > sourceMetadata.height
  ) {
    throw new Error('canonicalTile 越过 source dimensions。');
  }
  const sourceSha256 = await sha256File(sourceFile);
  if (sourceRecord.sha256 !== sourceSha256) {
    throw new Error(`source asset ${spec.sourceAssetId} SHA 已变化；请先重新登记来源。`);
  }
  const tileBuffer = await deriveTileBuffer({sourceBuffer, spec});
  const tileMetadata = await sharp(tileBuffer).metadata();
  const mirrorRight = spec.seamStrategy === 'mirror-crop';
  const sourceMetrics = await compareHorizontalEdgeBands(
    tileBuffer,
    spec.edgeBandPixels,
    {mirrorRight},
  );
  const sourceEdgeAlphaCoverage = await inspectHorizontalEdgeAlphaCoverage(
    tileBuffer,
    spec.edgeBandPixels,
  );
  const sourcePassed = edgeMetricsPass(sourceMetrics, spec.thresholds);
  const sourceGroundEdgePassed =
    spec.role !== 'ground' ||
    sourceEdgeAlphaCoverage.minimum + 1e-12 >= GROUND_MINIMUM_EDGE_ALPHA_COVERAGE;
  const renderScaleThresholds = thresholdsForRenderScale(spec);
  const sourceSalience = await inspectVerticalSeamSalience(tileBuffer, {
    foldX: mirrorRight ? tileMetadata.width / 2 : null,
    bandPixels: Math.min(4, spec.edgeBandPixels),
  });
  const renderScale = [];
  for (const viewport of spec.proofViewports) {
    const scaled = await sharp(tileBuffer).resize({height: viewport.renderHeight}).png().toBuffer();
    const scaledBand = Math.max(1, Math.round(spec.edgeBandPixels * viewport.renderHeight / tileMetadata.height));
    const metrics = await compareHorizontalEdgeBands(scaled, scaledBand, {mirrorRight});
    const scaledMetadata = await sharp(scaled).metadata();
    const seamSalience = await inspectVerticalSeamSalience(scaled, {
      foldX: mirrorRight ? scaledMetadata.width / 2 : null,
      bandPixels: Math.min(4, scaledBand),
    });
    const geometry = resolveWorldStripTileGeometry({
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      renderHeight: viewport.renderHeight,
      sourceWidth: tileMetadata.width,
      sourceHeight: tileMetadata.height,
    });
    renderScale.push({
      profile: viewport.profile,
      viewport,
      viewportSpan: geometry.viewportSpan,
      copyCount: geometry.copyCount,
      metrics: {
        rgbMean: metrics.rgbMean,
        rgbMaximum: metrics.rgbMaximum,
        alphaMean: metrics.alphaMean,
        alphaMaximum: metrics.alphaMaximum,
        bandPixels: metrics.bandPixels,
      },
      edgeAlphaCoverage: await inspectHorizontalEdgeAlphaCoverage(scaled, scaledBand),
      thresholds: renderScaleThresholds,
      seamPassed: edgeMetricsPass(metrics, renderScaleThresholds),
      seamSalience,
      saliencePassed: seamSalience.passed,
      spanPassed: geometry.viewportSpan + 1e-9 >= spec.minimumViewportSpan,
    });
  }
  const derivationFingerprint = hashCompositionValue({
    schemaVersion: 1,
    sourceAssetId: spec.sourceAssetId,
    sourceSha256,
    role: spec.role,
    axis: spec.axis,
    seamStrategy: spec.seamStrategy,
    canonicalTile: spec.canonicalTile,
    alphaFeather: spec.alphaFeather ?? null,
    edgeStabilizationPixels: spec.edgeStabilizationPixels ?? 0,
    edgeBandPixels: spec.edgeBandPixels,
    thresholds: spec.thresholds,
    renderScaleThresholds,
    minimumViewportSpan: spec.minimumViewportSpan,
    proofViewports: spec.proofViewports,
    recoveryPolicy: spec.recoveryPolicy,
    sourceSurface,
    keying: spec.keying ?? null,
    checkerboardAlpha: spec.checkerboardAlpha ?? null,
    decorativeScatter: spec.decorativeScatter ?? null,
    seamSaliencePolicy: SEAM_SALIENCE_POLICY,
  });
  if (
    !sourcePassed ||
    !sourceSalience.passed ||
    !sourceGroundEdgePassed ||
    renderScale.some(({seamPassed, saliencePassed, spanPassed, edgeAlphaCoverage}) =>
      !seamPassed ||
      !saliencePassed ||
      !spanPassed ||
      (spec.role === 'ground' && edgeAlphaCoverage.minimum + 1e-12 < GROUND_MINIMUM_EDGE_ALPHA_COVERAGE),
    )
  ) {
    const failed = [
      ...(sourcePassed ? [] : ['source-resolution seam']),
      ...(sourceSalience.passed ? [] : ['source-resolution seam salience']),
      ...(sourceGroundEdgePassed ? [] : ['source-resolution ground edge alpha coverage']),
      ...renderScale.filter(({seamPassed}) => !seamPassed).map(({profile}) => `${profile} render-scale seam`),
      ...renderScale.filter(({saliencePassed}) => !saliencePassed).map(({profile}) => `${profile} seam salience`),
      ...renderScale.filter(({spanPassed}) => !spanPassed).map(({profile}) => `${profile} viewport span`),
      ...renderScale
        .filter(({edgeAlphaCoverage}) =>
          spec.role === 'ground' && edgeAlphaCoverage.minimum + 1e-12 < GROUND_MINIMUM_EDGE_ALPHA_COVERAGE,
        )
        .map(({profile}) => `${profile} ground edge alpha coverage`),
    ];
    throw new Error(`looping strip proof 未通过：${failed.join('、')}`);
  }
  await fs.mkdir(path.dirname(outputFile), {recursive: true});
  await fs.writeFile(outputFile, tileBuffer);
  const outputSha256 = await sha256File(outputFile);
  const outputMetadata = await sharp(outputFile).metadata();
  const keyingMetadataFile = ['chroma-key', BAKED_CHECKERBOARD_MODE].includes(sourceSurface.mode)
    ? `${outputFile}.key.json`
    : null;
  const keyingRecord = keyingMetadataFile
    ? {
      schemaVersion: 1,
      sourceAssetId: spec.sourceAssetId,
      sourceSha256,
      sourceSurface,
      keying: spec.keying ?? null,
      checkerboardAlpha: spec.checkerboardAlpha ?? null,
      decorativeScatter: spec.decorativeScatter ?? null,
      outputSha256,
      ...keyingMetadata,
    }
    : null;
  if (keyingMetadataFile) {
    await fs.writeFile(keyingMetadataFile, `${JSON.stringify(keyingRecord, null, 2)}\n`);
  }
  const keyingMetadataSha256 = keyingRecord
    ? sha256(JSON.stringify(keyingRecord))
    : null;
  const binding = {
    schemaVersion: 1,
    stripId: spec.stripId,
    role: spec.role,
    sourceAssetId: spec.sourceAssetId,
    axis: 'x',
    seamStrategy: spec.seamStrategy,
    source: {
      sha256: sourceSha256,
      width: sourceMetadata.width,
      height: sourceMetadata.height,
      provider: sourceRecord.provider,
      adapter: sourceRecord.adapter,
      recordId: sourceRecord.recordId,
      surface: sourceSurface,
      keying: spec.keying ?? null,
      checkerboardAlpha: spec.checkerboardAlpha ?? null,
      decorativeScatter: spec.decorativeScatter ?? null,
      keyingMetadataSha256,
    },
    canonicalTile: spec.canonicalTile,
    alphaFeather: spec.alphaFeather ?? null,
    edgeStabilizationPixels: spec.edgeStabilizationPixels ?? 0,
    output: {
      width: outputMetadata.width,
      height: outputMetadata.height,
      hasAlpha: Boolean(outputMetadata.hasAlpha),
    },
    minimumViewportSpan: spec.minimumViewportSpan,
    edgeBandPixels: spec.edgeBandPixels,
    derivationFingerprint,
  };
  const recordedAt = new Date().toISOString();
  const record = {
    recordId: createAssetRecordId({
      assetId: spec.assetId,
      requestFingerprint: derivationFingerprint,
      sha256: outputSha256,
      recordedAt,
    }),
    assetId: spec.assetId,
    capability: 'image',
    file: posixRelative(root, outputFile),
    provider: sourceRecord.provider,
    adapter: 'looping-strip-derivative',
    tool: null,
    model: sourceRecord.model ?? null,
    externalId: null,
    attemptId: null,
    recoveredFromClosedAttempt: false,
    recoveredFromRejectedAttempt: false,
    requestFingerprint: derivationFingerprint,
    reusedFrom: sourceRecord.recordId,
    sha256: outputSha256,
    sizeBytes: (await fs.stat(outputFile)).size,
    media: {
      width: outputMetadata.width,
      height: outputMetadata.height,
      format: outputMetadata.format ?? 'png',
      hasAlpha: Boolean(outputMetadata.hasAlpha),
    },
    recordedAt,
    request: {
      capability: 'image',
      derivation: 'looping-strip',
      sourceAssetId: spec.sourceAssetId,
      canonicalTile: spec.canonicalTile,
      alphaFeather: spec.alphaFeather ?? null,
      edgeStabilizationPixels: spec.edgeStabilizationPixels ?? 0,
      seamStrategy: spec.seamStrategy,
      sourceSurface,
      keying: spec.keying ?? null,
      checkerboardAlpha: spec.checkerboardAlpha ?? null,
      decorativeScatter: spec.decorativeScatter ?? null,
    },
    compositionBinding: {
      sceneId: spec.sceneId,
      nodeId: spec.nodeId,
      pattern: 'looping-environment',
      outputRole: spec.role,
      derivation: {method: 'crop', parentAssetId: spec.sourceAssetId},
    },
    loopingStripBinding: binding,
    familyFingerprint: derivationFingerprint,
    lifecycle: {
      status: 'active',
      changedAt: recordedAt,
      reason: 'deterministic looping strip derivation passed seam and viewport-span proof',
      supersededBy: null,
    },
  };
  for (const prior of manifest.assets.filter(
    (candidate) => candidate.assetId === spec.assetId && candidate.lifecycle?.status === 'active',
  )) {
    prior.lifecycle = {
      status: 'superseded',
      changedAt: recordedAt,
      reason: 'replaced by current looping strip derivation',
      supersededBy: record.recordId,
    };
  }
  manifest.assets.push(record);
  const evidenceDirectory = path.join(root, 'dist', spec.projectSlug, 'looping-strip', 'evidence');
  const evidence = await writeEvidence({
    tileBuffer,
    sourceMetrics,
    evidenceDirectory,
    stripId: spec.stripId,
    mirrorRight,
  });
  return {
    manifest,
    record,
    binding,
    report: {
      schemaVersion: 1,
      stripId: spec.stripId,
      assetId: spec.assetId,
      sourceAssetId: spec.sourceAssetId,
      sourceSha256,
      outputSha256,
      providerImageCalls: 0,
      localDerivatives: 1,
      avoidedCalls: 1,
      seamStrategy: spec.seamStrategy,
      alphaFeather: spec.alphaFeather ?? null,
      edgeStabilizationPixels: spec.edgeStabilizationPixels ?? 0,
      sourceSurface,
      keyingMetadataSha256,
      thresholds: spec.thresholds,
      renderScaleThresholds,
      seamSaliencePolicy: SEAM_SALIENCE_POLICY,
      sourceSalience,
      sourceMetrics: {
        rgbMean: sourceMetrics.rgbMean,
        rgbMaximum: sourceMetrics.rgbMaximum,
        alphaMean: sourceMetrics.alphaMean,
        alphaMaximum: sourceMetrics.alphaMaximum,
        bandPixels: sourceMetrics.bandPixels,
      },
      sourceEdgeAlphaCoverage,
      groundMinimumEdgeAlphaCoverage:
        spec.role === 'ground' ? GROUND_MINIMUM_EDGE_ALPHA_COVERAGE : null,
      renderScale,
      evidence: Object.fromEntries(
        Object.entries(evidence).map(([key, file]) => [key, posixRelative(root, file)]),
      ),
      derivationFingerprint,
      passed: true,
    },
    publicSrc: publicBindingPath(root, outputFile),
  };
};

export const applyLoopingStripToProject = ({
  project,
  spec,
  record,
}) => {
  const scene = (project.scenes ?? []).find(({id}) => id === spec.sceneId);
  if (!scene) throw new Error(`project 缺少 scene ${spec.sceneId}`);
  const walk = (nodes = []) => {
    for (const node of nodes) {
      if (node.id === spec.groupId && node.kind === 'group') return node;
      if (node.kind === 'group') {
        const match = walk(node.children ?? []);
        if (match) return match;
      }
    }
    return null;
  };
  const group = walk(scene.composition?.nodes ?? []);
  if (!group || group.pattern !== 'looping-environment') {
    throw new Error(`project 缺少 looping-environment group ${spec.groupId}`);
  }
  const node = (group.children ?? []).find(
    (candidate) => candidate.id === spec.nodeId && candidate.kind === 'world-strip',
  );
  if (!node) throw new Error(`group ${spec.groupId} 缺少 world-strip ${spec.nodeId}`);
  if (node.role !== spec.role) throw new Error(`${spec.nodeId} role 与 derivation spec 不一致`);
  node.src = path.normalize(record.file)
    .slice(`public${path.sep}`.length)
    .split(path.sep)
    .join('/');
  node.loopingStripBinding = record.loopingStripBinding;
  return project;
};
