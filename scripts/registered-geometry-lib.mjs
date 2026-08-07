import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const sha256File = async (file) => {
  const hash = createHash('sha256');
  hash.update(await fs.readFile(file));
  return hash.digest('hex');
};

export const DEFAULT_REGISTERED_GEOMETRY_LIMITS = {
  maxCentroidDelta: 0.06,
  maxBaselineDelta: 0.04,
  maxAspectRatioDelta: 0.2,
  maxScaleDrift: 0.18,
  maxProportionDelta: 0.2,
};

const ALPHA_THRESHOLD = 8;

export const alphaTightGeometryForFile = async (file) => {
  const {data, info} = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({resolveWithObject: true});
  const {width, height, channels} = info;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[(y * width + x) * channels + 3];
      if (alpha <= ALPHA_THRESHOLD) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      sumX += x;
      sumY += y;
      count += 1;
    }
  }
  if (count === 0) {
    return {
      empty: true,
      alphaTight: {left: 0, top: 0, right: 0, bottom: 0},
      width: 0,
      height: 0,
      centroid: {x: 0, y: 0},
      baselineY: 0,
      aspectRatio: 0,
      proportion: 0,
      area: 0,
      silhouetteDirection: 'neutral',
      silhouetteBias: 0,
    };
  }
  const tightWidth = maxX - minX + 1;
  const tightHeight = maxY - minY + 1;
  const centroid = {x: sumX / count, y: sumY / count};
  const bias = (centroid.x - (minX + maxX) / 2) / tightWidth;
  const silhouetteDirection =
    bias > 0.12 ? 'right' : bias < -0.12 ? 'left' : 'neutral';
  return {
    empty: false,
    alphaTight: {left: minX, top: minY, right: maxX + 1, bottom: maxY + 1},
    width: tightWidth,
    height: tightHeight,
    centroid,
    baselineY: maxY,
    aspectRatio: tightWidth / tightHeight,
    proportion: count / (width * height),
    area: count,
    silhouetteDirection,
    silhouetteBias: bias,
  };
};

export const computeRegisteredGeometryProof = async ({
  familyId,
  registrationId,
  familyFingerprint,
  canvas,
  states,
  referenceStateId = null,
  limits = DEFAULT_REGISTERED_GEOMETRY_LIMITS,
  mode = 'reference',
}) => {
  const placementRectFor = (state) => {
    const placement = state.expectedPlacement;
    if (!placement) return null;
    if (placement.width > 1 || placement.height > 1) {
      return {
        left: Number(placement.left ?? 0) / canvas.width,
        top: Number(placement.top ?? 0) / canvas.height,
        width: Number(placement.width ?? canvas.width) / canvas.width,
        height: Number(placement.height ?? canvas.height) / canvas.height,
      };
    }
    return {
      left: Number(placement.x ?? placement.left ?? 0),
      top: Number(placement.y ?? placement.top ?? 0),
      width: Number(placement.width ?? 1),
      height: Number(placement.height ?? 1),
    };
  };
  const resolved = [];
  for (const state of states) {
    const file = path.resolve(state.file);
    const sha256 = await sha256File(file);
    const geometry = await alphaTightGeometryForFile(file);
    resolved.push({
      stateId: state.stateId,
      file: state.file,
      sha256,
      declaredFacing: state.declaredFacing ?? 'neutral',
      geometry,
      expectedPlacement: placementRectFor(state),
    });
  }
  const referenceIndex = referenceStateId
    ? Math.max(
        0,
        resolved.findIndex(({stateId}) => stateId === referenceStateId),
      )
    : 0;
  const reference = resolved[referenceIndex];
  if (!reference || reference.geometry.empty) {
    throw new Error(
      `registered geometry proof 需要至少一个非空参考状态：${referenceStateId ?? resolved[0]?.stateId ?? 'none'}`,
    );
  }
  const canvasHeight = Math.max(1, canvas.height);
  const canvasArea = Math.max(1, canvas.width * canvas.height);
  const referenceGeometry = reference.geometry;
  const proofStates = resolved.map((state) => {
    const issues = [];
    const geometry = state.geometry;
    const placementMode = mode === 'placement' && state.expectedPlacement;
    const referenceForDelta = placementMode
      ? null
      : referenceGeometry;
    if (geometry.empty) {
      issues.push('state 缺少 alpha 像素，不能参与注册几何校验。');
      return {
        stateId: state.stateId,
        file: state.file,
        sha256: state.sha256,
        declaredFacing: state.declaredFacing,
        geometry,
        drift: {
          centroidDelta: null,
          baselineDelta: null,
          aspectRatioDelta: null,
          scaleDrift: null,
          proportionDelta: null,
          facingConsistent: false,
        },
        passed: false,
        issues,
      };
    }
    let centroidDelta;
    let baselineDelta;
    let aspectRatioDelta;
    let scaleDrift;
    let proportionDelta;
    if (placementMode) {
      const placement = state.expectedPlacement;
      const centroidX = geometry.centroid.x / canvas.width;
      const centroidY = geometry.centroid.y / canvas.height;
      centroidDelta = Math.hypot(
        centroidX - (placement.left + placement.width / 2),
        centroidY - (placement.top + placement.height / 2),
      );
      baselineDelta = Math.abs(
        geometry.baselineY / canvas.height -
          (placement.top + placement.height),
      );
      aspectRatioDelta =
        Math.abs(
          geometry.aspectRatio -
            placement.width / Math.max(1e-9, placement.height),
        ) / Math.max(1e-9, placement.width / Math.max(1e-9, placement.height));
      scaleDrift = Math.abs(
        geometry.height / canvas.height - placement.height,
      );
      proportionDelta = Math.abs(
        geometry.area / canvasArea -
          placement.width * placement.height,
      );
    } else {
      centroidDelta =
        Math.hypot(
          geometry.centroid.x - referenceForDelta.centroid.x,
          geometry.centroid.y - referenceForDelta.centroid.y,
        ) / canvasHeight;
      baselineDelta =
        Math.abs(geometry.baselineY - referenceForDelta.baselineY) /
        canvasHeight;
      aspectRatioDelta =
        Math.abs(
          geometry.aspectRatio - referenceForDelta.aspectRatio,
        ) / Math.max(1e-9, referenceForDelta.aspectRatio);
      scaleDrift =
        Math.abs(geometry.height - referenceForDelta.height) /
        Math.max(1e-9, referenceForDelta.height);
      proportionDelta =
        Math.abs(geometry.area - referenceForDelta.area) / canvasArea;
    }
    const facingConsistent =
      state.declaredFacing === 'left' || state.declaredFacing === 'right'
        ? (
            geometry.silhouetteDirection === 'neutral' ||
            geometry.silhouetteDirection === state.declaredFacing
          )
        : true;
    if (placementMode) {
      const placement = state.expectedPlacement;
      const tolerance = 0.02;
      const tightLeft = geometry.alphaTight.left / canvas.width;
      const tightTop = geometry.alphaTight.top / canvas.height;
      const tightRight = geometry.alphaTight.right / canvas.width;
      const tightBottom = geometry.alphaTight.bottom / canvas.height;
      const contained =
        tightLeft >= placement.left - tolerance &&
        tightTop >= placement.top - tolerance &&
        tightRight <= placement.left + placement.width + tolerance &&
        tightBottom <= placement.top + placement.height + tolerance;
      if (!contained) {
        issues.push(
          `alpha-tight 边界超出注册 placement：` +
            `[${tightLeft.toFixed(3)}, ${tightTop.toFixed(3)}, ` +
            `${tightRight.toFixed(3)}, ${tightBottom.toFixed(3)}]`,
        );
      }
    } else {
      if (centroidDelta > limits.maxCentroidDelta) {
        issues.push(
          `质心漂移 ${centroidDelta.toFixed(4)} 超过上限 ${limits.maxCentroidDelta}`,
        );
      }
      if (baselineDelta > limits.maxBaselineDelta) {
        issues.push(
          `基线漂移 ${baselineDelta.toFixed(4)} 超过上限 ${limits.maxBaselineDelta}`,
        );
      }
      if (aspectRatioDelta > limits.maxAspectRatioDelta) {
        issues.push(
          `宽高比漂移 ${aspectRatioDelta.toFixed(4)} 超过上限 ${limits.maxAspectRatioDelta}`,
        );
      }
      if (scaleDrift > limits.maxScaleDrift) {
        issues.push(`缩放漂移 ${scaleDrift.toFixed(4)} 超过上限 ${limits.maxScaleDrift}`);
      }
      if (proportionDelta > limits.maxProportionDelta) {
        issues.push(
          `占比漂移 ${proportionDelta.toFixed(4)} 超过上限 ${limits.maxProportionDelta}`,
        );
      }
    }
    if (!facingConsistent) {
      issues.push(
        `声明 facing=${state.declaredFacing} 但 alpha 剪影方向为 ${geometry.silhouetteDirection}。`,
      );
    }
    return {
      stateId: state.stateId,
      file: state.file,
      sha256: state.sha256,
      declaredFacing: state.declaredFacing,
      geometry,
      drift: {
        centroidDelta,
        baselineDelta,
        aspectRatioDelta,
        scaleDrift,
        proportionDelta,
        facingConsistent,
      },
      passed: issues.length === 0,
      issues,
    };
  });
  const passed = proofStates.every(({passed: statePassed}) => statePassed);
  const fingerprintSource = {
    contract: 'registered-geometry-proof-v1',
    familyId,
    registrationId,
    familyFingerprint,
    canvas,
    limits,
    states: proofStates.map(
      ({stateId, sha256, declaredFacing, geometry, drift}) => ({
        stateId,
        sha256,
        declaredFacing,
        geometry,
        drift,
      }),
    ),
  };
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(fingerprintSource))
    .digest('hex');
  return {
    schemaVersion: 1,
    familyId,
    registrationId,
    familyFingerprint,
    canvas,
    referenceStateId: reference.stateId,
    limits,
    states: proofStates,
    passed,
    fingerprint,
  };
};

export const assertRegisteredGeometryCurrent = async ({
  familyBinding,
  proof,
  records = [],
}) => {
  const issues = [];
  if (!proof || typeof proof !== 'object') {
    return {passed: false, issues: ['缺少 registered geometry proof。']};
  }
  if (proof.familyId !== familyBinding?.familyId) {
    issues.push('registered geometry proof familyId 与绑定不一致。');
  }
  if (proof.registrationId !== familyBinding?.registrationId) {
    issues.push('registered geometry proof registrationId 与绑定不一致。');
  }
  if (proof.familyFingerprint !== familyBinding?.familyFingerprint) {
    issues.push('registered geometry proof familyFingerprint 与绑定不一致。');
  }
  if (!proof.passed) {
    issues.push('registered geometry proof 未通过几何漂移校验。');
  }
  for (const state of proof.states ?? []) {
    try {
      const absoluteFile = path.resolve(state.file);
      if (
        !(await fs.stat(absoluteFile)).isFile() ||
        (await sha256File(absoluteFile)) !== state.sha256
      ) {
        issues.push(
          `registered geometry state ${state.stateId} 文件缺失或内容变化。`,
        );
      }
    } catch {
      issues.push(
        `registered geometry state ${state.stateId} 文件无法读取。`,
      );
    }
  }
  return {passed: issues.length === 0, issues};
};
