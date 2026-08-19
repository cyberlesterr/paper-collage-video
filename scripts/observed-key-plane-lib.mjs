import {stableValue} from './contract-utils.mjs';
import {createHash} from 'node:crypto';
import sharp from 'sharp';

export const OBSERVED_KEY_PLANE_MODE = 'provider-native-observed';
export const OBSERVED_KEY_PLANE_POLICY_ID = 'flat-v1';

export const DEFAULT_OBSERVED_KEY_PLANE_POLICY = Object.freeze({
  policyId: OBSERVED_KEY_PLANE_POLICY_ID,
  maximumRequestedDistance: 96,
  minimumCoverage: 0.08,
  minimumBoundaryCoverage: 0.4,
  maximumClusterP95Distance: 18,
  maximumClusterP99Distance: 48,
  minimumLargestComponentShare: 0.55,
  minimumForegroundP10Distance: 20,
  maximumInterCellObservedDistance: 16,
});

const sha256Value = (value) =>
  createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');

export const observedKeyPlanePolicyFingerprint = (
  policy = DEFAULT_OBSERVED_KEY_PLANE_POLICY,
) => sha256Value(policy);

export const parseHexColor = (value) => {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error(`色键颜色必须是 #RRGGBB：${value ?? '(empty)'}`);
  }
  return value
    .slice(1)
    .match(/.{2}/g)
    .map((part) => Number.parseInt(part, 16));
};

export const rgbToHex = (rgb) =>
  `#${rgb.map((value) => Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, '0')).join('')}`;

export const colorDistance = (left, right) =>
  Math.sqrt(left.reduce(
    (sum, value, index) => sum + ((value - right[index]) ** 2),
    0,
  ));

const percentile = (values, ratio) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * ratio) - 1),
  );
  return sorted[index];
};

const channelMedian = (colors, channel) =>
  percentile(colors.map((rgb) => rgb[channel]), 0.5);

const validRect = (rect, width, height) =>
  Number.isInteger(rect?.left) &&
  Number.isInteger(rect?.top) &&
  Number.isInteger(rect?.width) &&
  Number.isInteger(rect?.height) &&
  rect.left >= 0 &&
  rect.top >= 0 &&
  rect.width > 1 &&
  rect.height > 1 &&
  rect.left + rect.width <= width &&
  rect.top + rect.height <= height;

const largestComponent = ({mask, width, height}) => {
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  let largest = 0;
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;
    let head = 0;
    let tail = 0;
    let size = 0;
    queue[tail++] = start;
    visited[start] = 1;
    while (head < tail) {
      const index = queue[head++];
      size += 1;
      const x = index % width;
      const y = Math.floor(index / width);
      if (x > 0) {
        const next = index - 1;
        if (mask[next] && !visited[next]) {
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
      if (x + 1 < width) {
        const next = index + 1;
        if (mask[next] && !visited[next]) {
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
      if (y > 0) {
        const next = index - width;
        if (mask[next] && !visited[next]) {
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
      if (y + 1 < height) {
        const next = index + width;
        if (mask[next] && !visited[next]) {
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
    }
    largest = Math.max(largest, size);
  }
  return largest;
};

export const validateObservedKeyPlaneDeclaration = (value) => {
  if (
    value?.mode !== OBSERVED_KEY_PLANE_MODE ||
    value?.policyId !== OBSERVED_KEY_PLANE_POLICY_ID ||
    Object.keys(value).some((key) => !['mode', 'policyId'].includes(key))
  ) {
    throw new Error(
      `keyPlane 必须声明 ${OBSERVED_KEY_PLANE_MODE}/${OBSERVED_KEY_PLANE_POLICY_ID}`,
    );
  }
  return value;
};

export const inspectObservedKeyPlanePixels = ({
  data,
  imageWidth,
  imageHeight,
  channels,
  rect = {left: 0, top: 0, width: imageWidth, height: imageHeight},
  requestedKeyColor,
  candidateKeyColor = requestedKeyColor,
  policy = DEFAULT_OBSERVED_KEY_PLANE_POLICY,
}) => {
  if (!validRect(rect, imageWidth, imageHeight)) {
    throw new Error('observed key plane sourceRect 无效或越过图像边界');
  }
  if (channels < 3) throw new Error('observed key plane 需要 RGB 图像数据');
  const requestedRgb = parseHexColor(requestedKeyColor);
  const candidateRgb = parseHexColor(candidateKeyColor);
  const totalPixels = rect.width * rect.height;
  const candidates = [];
  const candidateMask = new Uint8Array(totalPixels);
  let boundaryPixels = 0;
  let candidateBoundaryPixels = 0;

  for (let localY = 0; localY < rect.height; localY += 1) {
    for (let localX = 0; localX < rect.width; localX += 1) {
      const x = rect.left + localX;
      const y = rect.top + localY;
      const offset = (y * imageWidth + x) * channels;
      const rgb = [data[offset], data[offset + 1], data[offset + 2]];
      const index = localY * rect.width + localX;
      const isCandidate =
        colorDistance(rgb, candidateRgb) <= policy.maximumRequestedDistance;
      if (isCandidate) {
        candidates.push(rgb);
        candidateMask[index] = 1;
      }
      const boundary =
        localX < 2 ||
        localY < 2 ||
        localX >= rect.width - 2 ||
        localY >= rect.height - 2;
      if (boundary) {
        boundaryPixels += 1;
        if (isCandidate) candidateBoundaryPixels += 1;
      }
    }
  }

  if (candidates.length === 0) {
    return {
      schemaVersion: 1,
      mode: OBSERVED_KEY_PLANE_MODE,
      policy,
      policyFingerprint: observedKeyPlanePolicyFingerprint(policy),
      requestedKeyColor: requestedKeyColor.toLowerCase(),
      candidateKeyColor: candidateKeyColor.toLowerCase(),
      observedKeyColor: null,
      rect,
      metrics: {
        totalPixels,
        candidatePixels: 0,
        coverage: 0,
        boundaryCoverage: 0,
        requestedToObservedDistance: null,
        clusterP95Distance: null,
        clusterP99Distance: null,
        largestComponentShare: 0,
        foregroundP10Distance: null,
      },
      passed: false,
      reasons: ['no-request-near-candidates'],
    };
  }

  const observedRgb = [0, 1, 2].map((channel) =>
    channelMedian(candidates, channel));
  const clusterDistances = candidates.map((rgb) =>
    colorDistance(rgb, observedRgb));
  const clusterP95Distance = percentile(clusterDistances, 0.95);
  const clusterP99Distance = percentile(clusterDistances, 0.99);
  const inlierMask = new Uint8Array(totalPixels);
  let inlierPixels = 0;
  const foregroundDistances = [];
  for (let localY = 0; localY < rect.height; localY += 1) {
    for (let localX = 0; localX < rect.width; localX += 1) {
      const index = localY * rect.width + localX;
      const x = rect.left + localX;
      const y = rect.top + localY;
      const offset = (y * imageWidth + x) * channels;
      const rgb = [data[offset], data[offset + 1], data[offset + 2]];
      const distance = colorDistance(rgb, observedRgb);
      if (
        candidateMask[index] &&
        distance <= policy.maximumClusterP99Distance
      ) {
        inlierMask[index] = 1;
        inlierPixels += 1;
      } else if (!candidateMask[index]) {
        foregroundDistances.push(distance);
      }
    }
  }
  const largest = largestComponent({
    mask: inlierMask,
    width: rect.width,
    height: rect.height,
  });
  const coverage = candidates.length / totalPixels;
  const boundaryCoverage = candidateBoundaryPixels / Math.max(1, boundaryPixels);
  const largestComponentShare = largest / Math.max(1, inlierPixels);
  const foregroundP10Distance = percentile(foregroundDistances, 0.1);
  const requestedToObservedDistance = colorDistance(requestedRgb, observedRgb);
  const reasons = [];
  if (coverage < policy.minimumCoverage) reasons.push('coverage-too-low');
  if (boundaryCoverage < policy.minimumBoundaryCoverage) {
    reasons.push('boundary-coverage-too-low');
  }
  if (clusterP95Distance > policy.maximumClusterP95Distance) {
    reasons.push('cluster-p95-too-wide');
  }
  if (clusterP99Distance > policy.maximumClusterP99Distance) {
    reasons.push('cluster-p99-too-wide');
  }
  if (largestComponentShare < policy.minimumLargestComponentShare) {
    reasons.push('largest-component-too-small');
  }
  if (
    foregroundP10Distance !== null &&
    foregroundP10Distance < policy.minimumForegroundP10Distance
  ) {
    reasons.push('foreground-separation-too-low');
  }

  return {
    schemaVersion: 1,
    mode: OBSERVED_KEY_PLANE_MODE,
    policy,
    policyFingerprint: observedKeyPlanePolicyFingerprint(policy),
    requestedKeyColor: requestedKeyColor.toLowerCase(),
    candidateKeyColor: candidateKeyColor.toLowerCase(),
    observedKeyColor: rgbToHex(observedRgb),
    rect,
    metrics: {
      totalPixels,
      candidatePixels: candidates.length,
      coverage,
      boundaryCoverage,
      requestedToObservedDistance,
      clusterP95Distance,
      clusterP99Distance,
      largestComponentShare,
      foregroundP10Distance,
    },
    passed: reasons.length === 0,
    reasons,
  };
};

export const inspectObservedKeyPlaneFile = async ({
  file,
  rect,
  requestedKeyColor,
  candidateKeyColor = requestedKeyColor,
  policy = DEFAULT_OBSERVED_KEY_PLANE_POLICY,
}) => {
  const pixels = await sharp(file)
    .removeAlpha()
    .raw()
    .toBuffer({resolveWithObject: true});
  return inspectObservedKeyPlanePixels({
    data: pixels.data,
    imageWidth: pixels.info.width,
    imageHeight: pixels.info.height,
    channels: pixels.info.channels,
    rect,
    requestedKeyColor,
    candidateKeyColor,
    policy,
  });
};

export const assertObservedKeyPlaneSet = ({
  observations,
  policy = DEFAULT_OBSERVED_KEY_PLANE_POLICY,
}) => {
  const labelFor = ({packageRole, stateId}) =>
    packageRole === 'state' ? `state:${stateId ?? 'unknown'}` : packageRole;
  const failed = observations.filter(({passed}) => !passed);
  if (failed.length > 0) {
    throw new Error(
      failed
        .map((observation) =>
          `${labelFor(observation)}: ${observation.reasons.join(', ')}`)
        .join('；'),
    );
  }
  for (let index = 0; index < observations.length; index += 1) {
    for (let other = index + 1; other < observations.length; other += 1) {
      const distance = colorDistance(
        parseHexColor(observations[index].observedKeyColor),
        parseHexColor(observations[other].observedKeyColor),
      );
      if (distance > policy.maximumInterCellObservedDistance) {
        throw new Error(
          `${labelFor(observations[index])}/${labelFor(observations[other])} ` +
          `观测色差 ${distance.toFixed(2)} 超过 ${policy.maximumInterCellObservedDistance}`,
        );
      }
    }
  }
  return observations;
};
