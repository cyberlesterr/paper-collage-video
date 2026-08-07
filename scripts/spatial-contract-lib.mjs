import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {deriveSceneTimeline} from '../src/sceneTimeline.mjs';
import {resolveParallaxState} from '../src/parallax.mjs';
import {
  resolveWorldStripFrame,
  resolveWorldStripSpeedFactor,
} from '../src/worldStrip.mjs';
import {resolveSequenceState} from './state-sequence-lib.mjs';
import {applyResponsiveDirectingPlan} from '../src/editorialPrimitives.mjs';
import {
  angleDifferenceDegrees,
  resolveCameraFollowAtFrame,
  resolvePathMotionAtFrame,
  samplePathPolyline,
} from '../src/pathMotion.mjs';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIRECTORY, '..');
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const distance = (left, right) =>
  Math.hypot(left.x - right.x, left.y - right.y);

const multiply = (left, right) => [
  left[0] * right[0] + left[2] * right[1],
  left[1] * right[0] + left[3] * right[1],
  left[0] * right[2] + left[2] * right[3],
  left[1] * right[2] + left[3] * right[3],
  left[0] * right[4] + left[2] * right[5] + left[4],
  left[1] * right[4] + left[3] * right[5] + left[5],
];
const identity = () => [1, 0, 0, 1, 0, 0];
const translate = (x, y) => [1, 0, 0, 1, x, y];
const scale = (x, y = x) => [x, 0, 0, y, 0, 0];
const rotate = (degrees) => {
  const radians = degrees * Math.PI / 180;
  return [
    Math.cos(radians),
    Math.sin(radians),
    -Math.sin(radians),
    Math.cos(radians),
    0,
    0,
  ];
};
const applyMatrix = (matrix, point) => ({
  x: matrix[0] * point.x + matrix[2] * point.y + matrix[4],
  y: matrix[1] * point.x + matrix[3] * point.y + matrix[5],
});

const ease = (value, name = 'ease-in-out') => {
  const t = clamp01(value);
  if (name === 'ease-in') return t * t;
  if (name === 'ease-out') return 1 - (1 - t) * (1 - t);
  if (name === 'ease-in-out') {
    return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
  }
  if (name === 'hold') return 0;
  return t;
};

const motionStateAt = (node, progress) => {
  const frames = [...(node.motion?.keyframes ?? [])].sort(
    (left, right) => left.at - right.at,
  );
  const defaults = {x: 0, y: 0, scale: 1, rotation: 0};
  const valueFor = (frame, property, fallback) =>
    frame[
      property === 'x'
        ? 'offsetX'
        : property === 'y'
          ? 'offsetY'
          : property
    ] ?? fallback;
  const stateFor = (frame) =>
    Object.fromEntries(
      Object.entries(defaults).map(([property, fallback]) => [
        property,
        valueFor(frame, property, fallback),
      ]),
    );
  if (frames.length === 0) return defaults;
  if (progress <= frames[0].at) return stateFor(frames[0]);
  if (progress >= frames.at(-1).at) return stateFor(frames.at(-1));
  const rightIndex = frames.findIndex(({at}) => at >= progress);
  const left = frames[rightIndex - 1];
  const right = frames[rightIndex];
  const amount = ease(
    (progress - left.at) / Math.max(1e-9, right.at - left.at),
    right.ease,
  );
  return Object.fromEntries(
    Object.entries(defaults).map(([property, fallback]) => [
      property,
      valueFor(left, property, fallback) +
        (valueFor(right, property, fallback) -
          valueFor(left, property, fallback)) *
          amount,
    ]),
  );
};

const phaseFor = (id, seed) => {
  let value = Number(seed ?? 0) >>> 0;
  for (const character of id ?? '') {
    value = Math.imul(value ^ character.charCodeAt(0), 16777619);
  }
  return (value >>> 0) / 0xffffffff * Math.PI * 2;
};

const idleStateAt = ({node, frame, fps, seed}) => {
  const idle = node.motion?.idle;
  const defaults = {x: 0, y: 0, scale: 1, rotation: 0};
  if (!idle || idle.preset === 'still' || idle.intensity === 0) return defaults;
  const cycleFrames = Math.max(1, idle.cycleSeconds * fps);
  const phase = idle.phase ?? phaseFor(node.id, seed);
  const wave = Math.sin(frame / cycleFrames * Math.PI * 2 + phase);
  const intensity = idle.intensity;
  if (idle.preset === 'breathe') {
    return {...defaults, scale: 1 + wave * 0.008 * intensity};
  }
  if (idle.preset === 'float') {
    return {...defaults, y: wave * 0.006 * intensity};
  }
  if (idle.preset === 'drift') {
    return {
      ...defaults,
      x: wave * 0.005 * intensity,
      y: Math.cos(frame / cycleFrames * Math.PI * 2) * 0.003 * intensity,
    };
  }
  if (idle.preset === 'sway') {
    return {
      ...defaults,
      x: wave * 0.004 * intensity,
      rotation: wave * 2.8 * intensity,
    };
  }
  if (idle.preset === 'grind') {
    return {
      ...defaults,
      x: wave * 0.008 * intensity,
      rotation: wave * 0.55 * intensity,
    };
  }
  return defaults;
};

const emphasisStateAt = ({scene, node, progress, durationSeconds}) => {
  const result = {x: 0, y: 0, scale: 1, rotation: 0};
  for (const event of (scene.events ?? []).filter(
    (candidate) =>
      candidate.targetId === node.id &&
      candidate.visual?.kind === 'emphasis',
  )) {
    const visual = event.visual;
    const duration =
      Math.max(0.08, visual.durationSeconds) / Math.max(0.08, durationSeconds);
    const eventProgress = (progress - event.at) / duration;
    if (eventProgress < 0 || eventProgress > 1) continue;
    const envelope =
      Math.sin(eventProgress * Math.PI) * visual.intensity;
    if (visual.action === 'pulse') result.scale *= 1 + envelope * 0.055;
    if (visual.action === 'stamp') {
      result.scale *= 1 + envelope * 0.09;
      result.rotation += (1 - eventProgress) * 2.2 * visual.intensity;
    }
    if (visual.action === 'shake') {
      result.x +=
        Math.sin(eventProgress * Math.PI * 8) * envelope * 0.008;
      result.rotation +=
        Math.sin(eventProgress * Math.PI * 6) * envelope * 0.8;
    }
    if (visual.action === 'lift') result.y -= envelope * 0.025;
    if (visual.action === 'settle') {
      result.y += envelope * 0.014;
      result.rotation -= envelope * 0.65;
    }
    if (visual.action === 'drop-impact') {
      result.y += eventProgress < 0.62
        ? eventProgress * 0.08 * visual.intensity
        : (1 - eventProgress) * 0.018 * visual.intensity;
      result.rotation += envelope * 4.5;
      result.scale *= 1 + Math.max(0, envelope) * 0.025;
    }
    if (visual.action === 'carve') {
      result.x +=
        Math.sin(eventProgress * Math.PI * 10) * envelope * 0.004;
      result.rotation +=
        Math.sin(eventProgress * Math.PI * 8) * envelope * 1.2;
    }
  }
  return result;
};

const cameraFrames = (camera = {}) => {
  if (Array.isArray(camera.keyframes) && camera.keyframes.length >= 2) {
    return [...camera.keyframes].sort((left, right) => left.at - right.at);
  }
  const intensity = Math.max(0.6, Number(camera.intensity ?? 1));
  if (camera.preset === 'pull') {
    return [
      {at: 0, x: -10 * intensity, y: 0, zoom: 1.035},
      {at: 1, x: 12 * intensity, y: 0, zoom: 1.01},
    ];
  }
  if (camera.preset === 'pan-left') {
    return [
      {at: 0, x: 24 * intensity, y: 0, zoom: 1.018},
      {at: 1, x: -24 * intensity, y: 0, zoom: 1.022},
    ];
  }
  if (camera.preset === 'pan-right') {
    return [
      {at: 0, x: -24 * intensity, y: 0, zoom: 1.018},
      {at: 1, x: 24 * intensity, y: 0, zoom: 1.022},
    ];
  }
  if (camera.preset === 'static') {
    return [
      {at: 0, x: 0, y: 0, zoom: 1.01},
      {at: 1, x: 0, y: 0, zoom: 1.01},
    ];
  }
  return [
    {at: 0, x: -10 * intensity, y: 0, zoom: 1.01},
    {at: 1, x: 18 * intensity, y: 0, zoom: 1.028},
  ];
};

const cameraValueAt = (camera, progress, property, fallback) => {
  const frames = cameraFrames(camera);
  if (progress <= frames[0].at) return frames[0][property] ?? fallback;
  if (progress >= frames.at(-1).at) {
    return frames.at(-1)[property] ?? fallback;
  }
  const rightIndex = frames.findIndex(({at}) => at >= progress);
  const left = frames[rightIndex - 1];
  const right = frames[rightIndex];
  const amount =
    (progress - left.at) / Math.max(1e-9, right.at - left.at);
  return (
    (left[property] ?? fallback) +
    ((right[property] ?? fallback) - (left[property] ?? fallback)) * amount
  );
};

const cameraStateAt = (scene, progress, video) => {
  const frame = Math.round(
    progress * Math.max(0, scene.durationInFrames - 1),
  );
  const followed = resolveCameraFollowAtFrame({
    scene,
    video,
    frame,
    fps: video.fps,
  });
  return followed ?? {
    x: cameraValueAt(scene.camera, progress, 'x', 0),
    y: cameraValueAt(scene.camera, progress, 'y', 0),
    zoom: cameraValueAt(scene.camera, progress, 'zoom', 1),
  };
};

const cameraMatrixAt = ({scene, progress, video}) => {
  const camera = cameraStateAt(scene, progress, video);
  const origin = {x: video.width * 0.5, y: video.height * 0.54};
  return multiply(
    translate(origin.x + camera.x, origin.y + camera.y),
    multiply(scale(camera.zoom), translate(-origin.x, -origin.y)),
  );
};

const nodeHeight = ({node, width, parentHeight}) => {
  if (node.transform?.height !== undefined) {
    return Number(node.transform.height) * parentHeight;
  }
  if (node.kind === 'group') {
    return width * node.coordinateSpace.height / node.coordinateSpace.width;
  }
  if (node.kind === 'state-sequence') {
    return width * node.registration.canvas.height / node.registration.canvas.width;
  }
  return width;
};

const slotOrder = (node, layering = 'between-supports') => {
  if (!['asset', 'state-sequence'].includes(node.kind)) return node.z;
  const order = layering === 'subject-front'
    ? {
        'support-rear': -30,
        'contact-shadow': -20,
        'support-front': -10,
        subject: 0,
      }
    : {
        'support-rear': -30,
        'contact-shadow': -20,
        subject: -10,
        'support-front': 0,
      };
  return order[node.slot] ?? node.z;
};

const renderOrder = (node, parent) =>
  parent?.stackingContext === 'scene'
    ? node.z
    : parent &&
      ['supported-subject', 'registered-depth-stack'].includes(parent.pattern)
    ? slotOrder(node, parent.support?.layering)
    : node.z;

const worldOffsetFor = ({parent, node, progress, parentWidth}) => {
  if (
    parent?.pattern !== 'looping-environment' ||
    parent.loopingEnvironment?.subjectBindings?.find(
      ({nodeId}) => nodeId === node.id,
    )?.anchorMode !== 'world'
  ) {
    return 0;
  }
  const ground = parent.children.find(
    (candidate) =>
      candidate.kind === 'world-strip' &&
      candidate.id === parent.loopingEnvironment.groundStripId,
  );
  if (!ground) return 0;
  const speedFactor = resolveWorldStripSpeedFactor({
    depth: ground.depth,
    far: parent.loopingEnvironment.speedRange.far,
    near: parent.loopingEnvironment.speedRange.near,
  });
  const travel = parent.loopingEnvironment.travel;
  return resolveWorldStripFrame({
    progress: travel.frozen === true ? 0 : progress,
    viewportWidth: parentWidth,
    tileWidth: parentWidth,
    direction: travel.direction,
    distanceViewports: travel.distanceViewports,
    speedFactor,
    startPhase: travel.startPhase,
    activeFrom: travel.activeFrom ?? 0,
    activeUntil: travel.activeUntil ?? 1,
    easing: travel.easing,
    overscanPx: parent.loopingEnvironment.overscanPx,
  }).cameraCompensatedDisplacement;
};

export const prepareSceneResolution = ({scene, video}) => {
  const timeline = deriveSceneTimeline({
    video,
    scenes: [scene],
    sceneTransitions: [],
  });
  const normalizedScene = timeline.scenes[0];
  const descriptors = new Map();
  const orderedDescriptors = [];
  const visit = ({
    nodes,
    parentDescriptor = null,
    parentWidth,
    parentHeight,
    path = [],
  }) => {
    for (const [index, node] of (nodes ?? []).entries()) {
      if (node.kind === 'group' && node.renderParticipation === 'derivation-only') {
        continue;
      }
      const transform = node.transform ?? {};
      const width = Number(transform.width ?? 1) * parentWidth;
      const height = nodeHeight({node, width, parentHeight});
      const renderPath = [
        ...path,
        {
          node,
          index,
          order: renderOrder(node, parentDescriptor?.node ?? null),
        },
      ];
      const descriptor = {
        node,
        parentDescriptor,
        parentWidth,
        parentHeight,
        width,
        height,
        renderPath,
      };
      descriptors.set(node.id, descriptor);
      orderedDescriptors.push(descriptor);
      if (node.kind === 'group') {
        visit({
          nodes: node.children,
          parentDescriptor: descriptor,
          parentWidth: width,
          parentHeight: height,
          path: node.stackingContext === 'scene' ? path : renderPath,
        });
      }
    }
  };
  visit({
    nodes: scene.composition?.nodes,
    parentWidth: video.width,
    parentHeight: video.height,
  });
  return {
    scene,
    video,
    fps: video.fps,
    durationInFrames: normalizedScene.durationInFrames,
    durationSeconds: normalizedScene.durationInFrames / video.fps,
    descriptors,
    orderedDescriptors,
  };
};

const preparedResolutionContextAt = (prepared, progress) => {
  const frame = Math.round(
    progress * Math.max(0, prepared.durationInFrames - 1),
  );
  const camera = cameraStateAt(prepared.scene, progress, prepared.video);
  return {
    frame,
    camera,
    cameraMatrix: cameraMatrixAt({
      scene: prepared.scene,
      progress,
      video: prepared.video,
    }),
  };
};

const resolvePreparedDescriptorAt = ({
  prepared,
  descriptor,
  progress,
  context,
  entries,
}) => {
  const cached = entries.get(descriptor.node.id);
  if (cached) return cached;
  const parentEntry = descriptor.parentDescriptor
    ? resolvePreparedDescriptorAt({
        prepared,
        descriptor: descriptor.parentDescriptor,
        progress,
        context,
        entries,
      })
    : null;
  const {
    node,
    parentDescriptor,
    parentWidth,
    parentHeight,
    width,
    height,
    renderPath,
  } = descriptor;
  const parent = parentDescriptor?.node ?? null;
  const transform = node.transform ?? {};
  const authored = motionStateAt(node, progress);
  const pathMotion = resolvePathMotionAtFrame({
    pathMotion: node.motion?.path,
    frame: context.frame,
    durationInFrames: prepared.durationInFrames,
    fps: prepared.fps,
    parentWidth,
    parentHeight,
  });
  const idle = idleStateAt({
    node,
    frame: context.frame,
    fps: prepared.fps,
    seed: prepared.scene.motion?.seed,
  });
  const emphasis = emphasisStateAt({
    scene: prepared.scene,
    node,
    progress,
    durationSeconds: prepared.durationSeconds,
  });
  const parallax = resolveParallaxState({
    depth: node.depth ?? 0,
    cameraX: context.camera.x,
    cameraY: context.camera.y,
    cameraZoom: context.camera.zoom,
    parallax: prepared.scene.camera?.parallax,
  });
  const position = {
    x:
      Number(transform.x ?? 0) * parentWidth +
      (authored.x + pathMotion.x + idle.x + emphasis.x) * parentWidth +
      parallax.x +
      worldOffsetFor({
        parent,
        node,
        progress,
        parentWidth,
      }),
    y:
      Number(transform.y ?? 0) * parentHeight +
      (authored.y + pathMotion.y + idle.y + emphasis.y) * parentHeight +
      parallax.y,
  };
  const anchor = {
    x: Number(transform.anchorX ?? 0),
    y: Number(transform.anchorY ?? 0),
  };
  const pivot = {
    x: Number(node.motion?.pivot?.x ?? anchor.x),
    y: Number(node.motion?.pivot?.y ?? anchor.y),
  };
  const resolvedScale =
    Number(transform.scale ?? 1) *
    authored.scale *
    idle.scale *
    emphasis.scale *
    parallax.scale;
  const resolvedRotation =
    Number(transform.rotation ?? 0) +
    authored.rotation +
    pathMotion.rotationDegrees +
    idle.rotation +
    emphasis.rotation;
  const nodeMatrix = multiply(
    translate(position.x - anchor.x * width, position.y - anchor.y * height),
    multiply(
      translate(pivot.x * width, pivot.y * height),
      multiply(
        rotate(resolvedRotation),
        multiply(
          scale(resolvedScale),
          translate(-pivot.x * width, -pivot.y * height),
        ),
      ),
    ),
  );
  const localMatrix = multiply(parentEntry?.localMatrix ?? identity(), nodeMatrix);
  const corners = [
    applyMatrix(localMatrix, {x: 0, y: 0}),
    applyMatrix(localMatrix, {x: width, y: 0}),
    applyMatrix(localMatrix, {x: width, y: height}),
    applyMatrix(localMatrix, {x: 0, y: height}),
  ].map((point) => applyMatrix(context.cameraMatrix, point));
  const entry = {
    node,
    parent,
    matrix: multiply(context.cameraMatrix, localMatrix),
    localMatrix,
    pathMotion,
    parentWidth,
    parentHeight,
    width,
    height,
    corners,
    bounds: {
      left: Math.min(...corners.map(({x}) => x)),
      top: Math.min(...corners.map(({y}) => y)),
      right: Math.max(...corners.map(({x}) => x)),
      bottom: Math.max(...corners.map(({y}) => y)),
    },
    renderPath,
  };
  entries.set(node.id, entry);
  return entry;
};

export const resolvePreparedNodeAt = ({prepared, nodeId, progress}) => {
  const descriptor = prepared.descriptors.get(nodeId);
  if (!descriptor) return null;
  return resolvePreparedDescriptorAt({
    prepared,
    descriptor,
    progress,
    context: preparedResolutionContextAt(prepared, progress),
    entries: new Map(),
  });
};

export const resolveSceneNodes = ({scene, video, progress, prepared = null}) => {
  const activePrepared = prepared ?? prepareSceneResolution({scene, video});
  const context = preparedResolutionContextAt(activePrepared, progress);
  const entries = new Map();
  for (const descriptor of activePrepared.orderedDescriptors) {
    resolvePreparedDescriptorAt({
      prepared: activePrepared,
      descriptor,
      progress,
      context,
      entries,
    });
  }
  return {
    entries,
    frame: context.frame,
    durationSeconds: activePrepared.durationSeconds,
    camera: context.camera,
  };
};

const proofFor = (scene, proofTimeId) =>
  (scene.motion?.proofTimes ?? []).find(({id}) => id === proofTimeId) ?? null;

const resolveAnchor = ({entry, contract, progress}) => {
  if (contract.subjectAnchor.mode === 'normalized') {
    return applyMatrix(entry.matrix, {
      x: contract.subjectAnchor.x * entry.width,
      y: contract.subjectAnchor.y * entry.height,
    });
  }
  if (entry.node.kind !== 'state-sequence') return null;
  const state = resolveSequenceState({
    node: entry.node,
    progress,
    pathDepthVelocity: entry.pathMotion?.depthVelocity ?? 0,
  });
  const anchor = state?.anchors?.find(
    ({id}) => id === contract.subjectAnchor.name,
  );
  return anchor
    ? applyMatrix(entry.matrix, {
        x: anchor.x * entry.width,
        y: anchor.y * entry.height,
      })
    : null;
};

const surfacePoints = ({entry, contract}) =>
  contract.supportSurface.points.map((point) =>
    applyMatrix(entry.matrix, {
      x: point.x * entry.width,
      y: point.y * entry.height,
    }),
  );

const nearestPointOnSegment = (point, start, end) => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const denominator = dx * dx + dy * dy;
  const amount = denominator <= 1e-9
    ? 0
    : clamp01(
        ((point.x - start.x) * dx + (point.y - start.y) * dy) /
          denominator,
      );
  return {
    x: start.x + amount * dx,
    y: start.y + amount * dy,
  };
};

const nearestPointOnSurface = (point, points) => {
  const candidates = points.slice(1).map((end, index) =>
    nearestPointOnSegment(point, points[index], end),
  );
  return candidates.sort(
    (left, right) => distance(point, left) - distance(point, right),
  )[0] ?? null;
};

const comparePaintOrder = (leftEntry, rightEntry) => {
  const leftPath = leftEntry?.renderPath ?? [];
  const rightPath = rightEntry?.renderPath ?? [];
  let index = 0;
  while (
    index < leftPath.length &&
    index < rightPath.length &&
    leftPath[index].node.id === rightPath[index].node.id
  ) {
    index += 1;
  }
  if (index >= leftPath.length || index >= rightPath.length) {
    return 0;
  }
  const left = leftPath[index];
  const right = rightPath[index];
  if (left.order !== right.order) return left.order - right.order;
  return left.index - right.index;
};

const activeProfile = (project) =>
  project.editorial?.responsiveProfiles?.find(
    ({id}) => id === project.editorial.activeProfile,
  ) ?? null;

const subtitleZones = (project) =>
  (activeProfile(project)?.exclusionZones ?? [])
    .filter(({role}) => role === 'subtitle')
    .map(({x, y, width, height, padding = 0}) => ({
      left: (x - padding) * project.video.width,
      top: (y - padding) * project.video.height,
      right: (x + width + padding) * project.video.width,
      bottom: (y + height + padding) * project.video.height,
    }));

const rectangleIntersection = (left, right) => {
  const width = Math.max(
    0,
    Math.min(left.right, right.right) - Math.max(left.left, right.left),
  );
  const height = Math.max(
    0,
    Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top),
  );
  return {width, height, area: width * height};
};

const alphaBoundsCache = new Map();
const assetFileFor = (source) =>
  path.isAbsolute(source) ? source : path.join(ROOT, 'public', source);

const alphaBoundsFor = async (source) => {
  const file = assetFileFor(source);
  const cached = alphaBoundsCache.get(file);
  if (cached) return cached;
  const pending = (async () => {
    const {data, info} = await sharp(file)
      .ensureAlpha()
      .raw()
      .toBuffer({resolveWithObject: true});
    let left = info.width;
    let top = info.height;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        if (data[(y * info.width + x) * info.channels + 3] <= 16) continue;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
    if (right < left || bottom < top) {
      return {left: 0, top: 0, right: 0, bottom: 0, empty: true};
    }
    return {
      left: left / info.width,
      top: top / info.height,
      right: (right + 1) / info.width,
      bottom: (bottom + 1) / info.height,
      empty: false,
    };
  })();
  alphaBoundsCache.set(file, pending);
  return pending;
};

const sourceForEntry = (entry, progress) => {
  if (entry.node.kind === 'asset' || entry.node.kind === 'world-strip') {
    return entry.node.src;
  }
  if (entry.node.kind === 'state-sequence') {
    return resolveSequenceState({
      node: entry.node,
      progress,
      pathDepthVelocity: entry.pathMotion?.depthVelocity ?? 0,
    })?.src ?? null;
  }
  return null;
};

const visibleBoundsFor = async (entry, progress) => {
  const source = sourceForEntry(entry, progress);
  if (!source) return entry.bounds;
  let alpha;
  try {
    alpha = await alphaBoundsFor(source);
  } catch {
    return entry.bounds;
  }
  if (alpha.empty) return entry.bounds;
  const corners = [
    {x: alpha.left, y: alpha.top},
    {x: alpha.right, y: alpha.top},
    {x: alpha.right, y: alpha.bottom},
    {x: alpha.left, y: alpha.bottom},
  ].map(({x, y}) =>
    applyMatrix(entry.matrix, {
      x: x * entry.width,
      y: y * entry.height,
    }),
  );
  return {
    left: Math.min(...corners.map(({x}) => x)),
    top: Math.min(...corners.map(({y}) => y)),
    right: Math.max(...corners.map(({x}) => x)),
    bottom: Math.max(...corners.map(({y}) => y)),
  };
};

const visualFamily = (node) => {
  if (node.kind === 'state-sequence') return `pose:${node.poseFamilyId}`;
  if (node.kind === 'group' && node.layerStack?.sourcePackageId) {
    return `layer:${node.layerStack.sourcePackageId}`;
  }
  if (node.kind === 'group' && node.registration?.sourceMasterAssetId) {
    return `registration:${node.registration.sourceMasterAssetId}`;
  }
  if (node.kind === 'group' && node.pattern === 'looping-environment') {
    return `world:${(node.children ?? [])
      .filter(({kind}) => kind === 'world-strip')
      .map(
        ({role, loopingStripBinding}) =>
          `${role}:${loopingStripBinding?.sourceAssetId ?? 'missing'}`,
      )
      .sort()
      .join('|')}`;
  }
  if (node.kind === 'asset' && node.registrationId) {
    return `registration:${node.registrationId}`;
  }
  if ('src' in node) return `source:${node.src}`;
  return `node:${node.id}`;
};

const inspectGrounding = async (project, contract, {includeAlpha = false} = {}) => {
  const scene = (project.scenes ?? []).find(({id}) => id === contract.sceneId);
  const checks = [];
  const measurements = [];
  if (!scene) {
    return {
      passed: false,
      checks: [{
        id: 'grounding-scene-exists',
        passed: false,
        expected: contract.sceneId,
        actual: null,
      }],
      measurements,
    };
  }
  const zones = subtitleZones(project);
  for (const proofTimeId of contract.proofTimeIds) {
    const proof = proofFor(scene, proofTimeId);
    if (!proof) {
      checks.push({
        id: `proof-exists:${proofTimeId}`,
        passed: false,
        expected: proofTimeId,
        actual: null,
      });
      continue;
    }
    const resolved = resolveSceneNodes({
      scene,
      video: project.video,
      progress: proof.at,
    });
    const subject = resolved.entries.get(contract.subjectNodeId);
    const support = resolved.entries.get(contract.supportNodeId);
    if (!subject || !support) {
      checks.push({
        id: `nodes-exist:${proofTimeId}`,
        passed: false,
        expected: [contract.subjectNodeId, contract.supportNodeId],
        actual: [
          subject?.node.id ?? null,
          support?.node.id ?? null,
        ],
      });
      continue;
    }
    const anchor = resolveAnchor({
      entry: subject,
      contract,
      progress: proof.at,
    });
    const surface = surfacePoints({entry: support, contract});
    const nearest = anchor ? nearestPointOnSurface(anchor, surface) : null;
    if (!anchor || !nearest) {
      checks.push({
        id: `anchor-resolves:${proofTimeId}`,
        passed: false,
        expected: contract.subjectAnchor,
        actual: null,
      });
      continue;
    }
    const signedGap = (nearest.y - anchor.y) / project.video.height;
    const normalizedSupportY = nearest.y / project.video.height;
    const contactPassed =
      signedGap <= contract.maxGap + 1e-9 &&
      signedGap >= -contract.maxPenetration - 1e-9;
    checks.push({
      id: `support-contact:${proofTimeId}`,
      passed: contactPassed,
      expected: {
        maximumGap: contract.maxGap,
        maximumPenetration: contract.maxPenetration,
      },
      actual: {signedGap},
    });
    checks.push({
      id: `support-screen-band:${proofTimeId}`,
      passed:
        contract.supportScreenBand?.minY <= contract.supportScreenBand?.maxY &&
        normalizedSupportY + 1e-9 >= contract.supportScreenBand.minY &&
        normalizedSupportY <= contract.supportScreenBand.maxY + 1e-9,
      expected: contract.supportScreenBand,
      actual: {y: normalizedSupportY},
    });
    const measurement = {
      sceneId: scene.id,
      proofTimeId,
      progress: proof.at,
      anchor,
      nearestSurfacePoint: nearest,
      supportSurface: surface,
      signedGap,
      normalizedSupportY,
      subjectBounds: subject.bounds,
      supportBounds: support.bounds,
    };
    if (contract.frontOcclusion) {
      const front = resolved.entries.get(contract.frontOcclusion.nodeId);
      const paintComparison = front
        ? comparePaintOrder(front, subject)
        : 0;
      const expectedFront =
        contract.frontOcclusion.relation === 'in-front-of-subject';
      const paintPassed =
        Boolean(front) &&
        (expectedFront ? paintComparison > 0 : paintComparison < 0);
      checks.push({
        id: `paint-order:${proofTimeId}`,
        passed: paintPassed,
        expected: contract.frontOcclusion.relation,
        actual: front
          ? paintComparison > 0
            ? 'in-front-of-subject'
            : paintComparison < 0
              ? 'behind-subject'
              : 'same-stacking-context'
          : 'missing',
      });
      if (includeAlpha && front) {
        const frontBounds = await visibleBoundsFor(front, proof.at);
        const subjectBounds = await visibleBoundsFor(subject, proof.at);
        const intersection = rectangleIntersection(frontBounds, subjectBounds);
        const subjectArea = Math.max(
          1,
          (subjectBounds.right - subjectBounds.left) *
            (subjectBounds.bottom - subjectBounds.top),
        );
        const overlap = intersection.area / subjectArea;
        const minimum = contract.frontOcclusion.minimumAlphaOverlap ?? 0;
        checks.push({
          id: `front-alpha-overlap:${proofTimeId}`,
          passed: overlap + 1e-9 >= minimum,
          expected: {minimum},
          actual: {overlap},
        });
        measurement.frontVisibleBounds = frontBounds;
        measurement.frontAlphaOverlap = overlap;
      }
    }
    if (contract.subtitleClearance) {
      if (zones.length === 0) {
        checks.push({
          id: `subtitle-zone:${proofTimeId}`,
          passed: false,
          expected: 'active responsive profile subtitle exclusion zone',
          actual: null,
        });
      } else {
        const subjectBounds = includeAlpha
          ? await visibleBoundsFor(subject, proof.at)
          : subject.bounds;
        const gap = Math.min(
          ...zones.map((zone) => (zone.top - subjectBounds.bottom) / project.video.height),
        );
        const overlap = zones.some(
          (zone) => rectangleIntersection(subjectBounds, zone).area > 0,
        );
        checks.push({
          id: `subtitle-clearance:${proofTimeId}`,
          passed:
            !overlap &&
            gap + 1e-9 >= contract.subtitleClearance.minimumGap,
          expected: {
            minimumGap: contract.subtitleClearance.minimumGap,
            overlap: false,
          },
          actual: {gap, overlap},
        });
        measurement.subjectVisibleBounds = subjectBounds;
        measurement.subtitleZones = zones;
        measurement.subtitleGap = gap;
      }
    }
    measurements.push(measurement);
  }
  if (contract.mode === 'locked-contact' && measurements.length >= 2) {
    const first = measurements[0];
    const firstVector = {
      x:
        (first.anchor.x - first.nearestSurfacePoint.x) /
        project.video.width,
      y:
        (first.anchor.y - first.nearestSurfacePoint.y) /
        project.video.height,
    };
    const maximumDrift = Math.max(
      ...measurements.map((measurement) =>
        distance(firstVector, {
          x:
            (measurement.anchor.x - measurement.nearestSurfacePoint.x) /
            project.video.width,
          y:
            (measurement.anchor.y - measurement.nearestSurfacePoint.y) /
            project.video.height,
        }),
      ),
    );
    checks.push({
      id: 'relative-contact-stable',
      passed: maximumDrift <= contract.maxRelativeDrift + 1e-9,
      expected: {maximum: contract.maxRelativeDrift},
      actual: {maximumDrift},
    });
  }
  return {
    passed: checks.length > 0 && checks.every(({passed}) => passed),
    checks,
    measurements,
  };
};

const inspectContinuity = (project, contract) => {
  const timeline = deriveSceneTimeline(project);
  const fromScene = timeline.scenes.find(({id}) => id === contract.from.sceneId);
  const toScene = timeline.scenes.find(({id}) => id === contract.to.sceneId);
  const checks = [];
  const measurements = [];
  if (!fromScene || !toScene) {
    return {
      passed: false,
      checks: [{
        id: 'continuity-scenes-exist',
        passed: false,
        expected: [contract.from.sceneId, contract.to.sceneId],
        actual: [fromScene?.id ?? null, toScene?.id ?? null],
      }],
      measurements,
    };
  }
  const fromIndex = timeline.scenes.findIndex(({id}) => id === fromScene.id);
  const toIndex = timeline.scenes.findIndex(({id}) => id === toScene.id);
  checks.push({
    id: 'continuity-scenes-adjacent',
    passed: toIndex === fromIndex + 1,
    expected: fromIndex + 1,
    actual: toIndex,
  });
  const fromProof = proofFor(fromScene, contract.from.proofTimeId);
  const toProof = proofFor(toScene, contract.to.proofTimeId);
  if (!fromProof || !toProof) {
    checks.push({
      id: 'continuity-proofs-exist',
      passed: false,
      expected: [
        contract.from.proofTimeId,
        contract.to.proofTimeId,
      ],
      actual: [fromProof?.id ?? null, toProof?.id ?? null],
    });
    return {passed: false, checks, measurements};
  }
  const fromResolved = resolveSceneNodes({
    scene: fromScene,
    video: project.video,
    progress: fromProof.at,
  });
  const toResolved = resolveSceneNodes({
    scene: toScene,
    video: project.video,
    progress: toProof.at,
  });
  for (const pair of contract.nodePairs) {
    const from = fromResolved.entries.get(pair.fromNodeId);
    const to = toResolved.entries.get(pair.toNodeId);
    if (!from || !to) {
      checks.push({
        id: `continuity-nodes:${pair.role}`,
        passed: false,
        expected: [pair.fromNodeId, pair.toNodeId],
        actual: [from?.node.id ?? null, to?.node.id ?? null],
      });
      continue;
    }
    const fromCenter = {
      x: (from.bounds.left + from.bounds.right) / 2 / project.video.width,
      y: (from.bounds.top + from.bounds.bottom) / 2 / project.video.height,
    };
    const toCenter = {
      x: (to.bounds.left + to.bounds.right) / 2 / project.video.width,
      y: (to.bounds.top + to.bounds.bottom) / 2 / project.video.height,
    };
    const positionDelta = distance(fromCenter, toCenter);
    const fromScale = Math.max(
      (from.bounds.right - from.bounds.left) / project.video.width,
      (from.bounds.bottom - from.bounds.top) / project.video.height,
    );
    const toScale = Math.max(
      (to.bounds.right - to.bounds.left) / project.video.width,
      (to.bounds.bottom - to.bounds.top) / project.video.height,
    );
    const scaleDelta = Math.abs(fromScale - toScale);
    const fromFamily = visualFamily(from.node);
    const toFamily = visualFamily(to.node);
    checks.push(
      {
        id: `continuity-position:${pair.role}`,
        passed: positionDelta <= pair.maxPositionDelta + 1e-9,
        expected: {maximum: pair.maxPositionDelta},
        actual: {positionDelta},
      },
      {
        id: `continuity-scale:${pair.role}`,
        passed: scaleDelta <= pair.maxScaleDelta + 1e-9,
        expected: {maximum: pair.maxScaleDelta},
        actual: {scaleDelta},
      },
      {
        id: `continuity-family:${pair.role}`,
        passed: !pair.requireSameFamily || fromFamily === toFamily,
        expected: pair.requireSameFamily ? fromFamily : 'not-required',
        actual: toFamily,
      },
    );
    measurements.push({
      role: pair.role,
      fromNodeId: pair.fromNodeId,
      toNodeId: pair.toNodeId,
      fromCenter,
      toCenter,
      positionDelta,
      fromScale,
      toScale,
      scaleDelta,
      fromFamily,
      toFamily,
    });
  }
  const fromCamera = cameraStateAt(fromScene, fromProof.at, project.video);
  const toCamera = cameraStateAt(toScene, toProof.at, project.video);
  const cameraPositionDelta = Math.hypot(
    (fromCamera.x - toCamera.x) / project.video.width,
    (fromCamera.y - toCamera.y) / project.video.height,
  );
  const cameraZoomDelta = Math.abs(fromCamera.zoom - toCamera.zoom);
  checks.push(
    {
      id: 'continuity-camera-position',
      passed:
        cameraPositionDelta <= contract.maxCameraPositionDelta + 1e-9,
      expected: {maximum: contract.maxCameraPositionDelta},
      actual: {cameraPositionDelta},
    },
    {
      id: 'continuity-camera-zoom',
      passed: cameraZoomDelta <= contract.maxCameraZoomDelta + 1e-9,
      expected: {maximum: contract.maxCameraZoomDelta},
      actual: {cameraZoomDelta},
    },
  );
  const contractsById = new Map(
    (project.spatialContracts ?? []).map((candidate) => [
      candidate.id,
      candidate,
    ]),
  );
  const grounding = contract.groundingContractIds.map((id) =>
    contractsById.get(id),
  );
  checks.push({
    id: 'continuity-grounding-bound',
    passed:
      grounding.length >= 2 &&
      grounding.every((candidate) => candidate?.kind === 'grounding') &&
      grounding.some((candidate) => candidate?.sceneId === fromScene.id) &&
      grounding.some((candidate) => candidate?.sceneId === toScene.id),
    expected: {
      fromSceneId: fromScene.id,
      toSceneId: toScene.id,
    },
    actual: grounding.map((candidate) => candidate
      ? {id: candidate.id, kind: candidate.kind, sceneId: candidate.sceneId}
      : null),
  });
  return {
    passed: checks.length > 0 && checks.every(({passed}) => passed),
    checks,
    measurements,
  };
};

const inspectGait = (project, contract) => {
  const timeline = deriveSceneTimeline(project);
  const scene = timeline.scenes.find(({id}) => id === contract.sceneId);
  const checks = [];
  if (!scene) {
    return {
      passed: false,
      checks: [{
        id: 'gait-scene-exists',
        passed: false,
        expected: contract.sceneId,
        actual: null,
      }],
      measurements: [],
    };
  }
  const from = proofFor(scene, contract.fromProofTimeId);
  const through = proofFor(scene, contract.throughProofTimeId);
  const prepared = prepareSceneResolution({scene, video: project.video});
  const entry = resolvePreparedNodeAt({
    prepared,
    nodeId: contract.nodeId,
    progress: from?.at ?? 0,
  });
  if (!from || !through || through.at <= from.at || entry?.node.kind !== 'state-sequence') {
    checks.push({
      id: 'gait-window-resolves',
      passed: false,
      expected: {
        nodeKind: 'state-sequence',
        orderedProofs: [contract.fromProofTimeId, contract.throughProofTimeId],
      },
      actual: {
        nodeKind: entry?.node.kind ?? null,
        from: from?.at ?? null,
        through: through?.at ?? null,
      },
    });
    return {passed: false, checks, measurements: []};
  }
  const node = entry.node;
  const states = new Set(node.states.map(({id}) => id));
  const configuredStatesPassed = contract.stateIds.every((id) => states.has(id));
  checks.push({
    id: 'gait-states-exist',
    passed: configuredStatesPassed,
    expected: contract.stateIds,
    actual: [...states],
  });
  const fromFrame = Math.round(from.at * Math.max(0, scene.durationInFrames - 1));
  const throughFrame = Math.round(
    through.at * Math.max(0, scene.durationInFrames - 1),
  );
  let previous = null;
  let changes = 0;
  let lastChangeFrame = fromFrame;
  const observed = new Set();
  for (let frame = fromFrame; frame <= throughFrame; frame += 1) {
    const progress = frame / Math.max(1, scene.durationInFrames - 1);
    const frameEntry = resolvePreparedNodeAt({
      prepared,
      nodeId: contract.nodeId,
      progress,
    });
    const state = resolveSequenceState({
      node,
      progress,
      pathDepthVelocity: frameEntry?.pathMotion?.depthVelocity ?? 0,
    });
    if (!state) continue;
    observed.add(state.id);
    if (previous !== null && state.id !== previous) {
      changes += 1;
      lastChangeFrame = frame;
    }
    previous = state.id;
  }
  const seconds = Math.max(
    1 / project.video.fps,
    (throughFrame - fromFrame) / project.video.fps,
  );
  const changesPerSecond = changes / seconds;
  const maximumAllowedStillSeconds =
    1.5 / contract.minimumChangesPerSecond;
  const terminalStillSeconds =
    (throughFrame - lastChangeFrame) / project.video.fps;
  checks.push(
    {
      id: 'gait-state-coverage',
      passed: contract.stateIds.every((id) => observed.has(id)),
      expected: contract.stateIds,
      actual: [...observed],
    },
    {
      id: 'gait-cadence',
      passed:
        changesPerSecond + 1e-9 >= contract.minimumChangesPerSecond,
      expected: {minimumChangesPerSecond: contract.minimumChangesPerSecond},
      actual: {changes, seconds, changesPerSecond},
    },
  );
  if (contract.continueThroughWindowEnd) {
    checks.push(
      {
        id: 'gait-active-through-window',
        passed:
          node.playback.activeUntil === undefined ||
          node.playback.activeUntil + 1e-9 >= through.at,
        expected: {activeUntilAtOrAfter: through.at},
        actual: {activeUntil: node.playback.activeUntil ?? 1},
      },
      {
        id: 'gait-no-terminal-freeze',
        passed: terminalStillSeconds <= maximumAllowedStillSeconds + 1e-9,
        expected: {maximumStillSeconds: maximumAllowedStillSeconds},
        actual: {terminalStillSeconds},
      },
    );
  }
  return {
    passed: checks.every(({passed}) => passed),
    checks,
    measurements: [{
      sceneId: scene.id,
      fromProofTimeId: from.id,
      throughProofTimeId: through.id,
      changes,
      seconds,
      changesPerSecond,
      terminalStillSeconds,
      observedStateIds: [...observed],
    }],
  };
};

const inspectTravelFacing = (project, contract) => {
  const timeline = deriveSceneTimeline(project);
  const scene = timeline.scenes.find(({id}) => id === contract.sceneId);
  const checks = [];
  if (!scene) {
    return {
      passed: false,
      checks: [{
        id: 'travel-facing-scene-exists',
        passed: false,
        expected: contract.sceneId,
        actual: null,
      }],
      measurements: [],
    };
  }
  const from = proofFor(scene, contract.fromProofTimeId);
  const through = proofFor(scene, contract.throughProofTimeId);
  const prepared = prepareSceneResolution({
    scene,
    video: project.video,
  });
  const initial = resolvePreparedNodeAt({
    prepared,
    nodeId: contract.nodeId,
    progress: from?.at ?? 0,
  });
  if (
    !from ||
    !through ||
    through.at <= from.at ||
    initial?.node.kind !== 'state-sequence'
  ) {
    checks.push({
      id: 'travel-facing-window-resolves',
      passed: false,
      expected: {
        nodeKind: 'state-sequence',
        orderedProofs: [
          contract.fromProofTimeId,
          contract.throughProofTimeId,
        ],
      },
      actual: {
        nodeKind: initial?.node.kind ?? null,
        from: from?.at ?? null,
        through: through?.at ?? null,
      },
    });
    return {passed: false, checks, measurements: []};
  }
  const fromFrame = Math.round(
    from.at * Math.max(0, scene.durationInFrames - 1),
  );
  const throughFrame = Math.round(
    through.at * Math.max(0, scene.durationInFrames - 1),
  );
  const samples = [];
  for (let frame = fromFrame; frame <= throughFrame; frame += 1) {
    const progress = frame / Math.max(1, scene.durationInFrames - 1);
    const entry = resolvePreparedNodeAt({
      prepared,
      nodeId: contract.nodeId,
      progress,
    });
    if (!entry || entry.node.kind !== 'state-sequence') continue;
    const center = applyMatrix(entry.localMatrix, {
      x: entry.width * 0.5,
      y: entry.height * 0.5,
    });
    const state = resolveSequenceState({node: entry.node, progress});
    const rotationDegrees =
      Math.atan2(entry.localMatrix[1], entry.localMatrix[0]) * 180 / Math.PI;
    const flipped =
      entry.localMatrix[0] * entry.localMatrix[3] -
        entry.localMatrix[1] * entry.localMatrix[2] < 0;
    samples.push({
      frame,
      progress,
      x: center.x / project.video.width,
      y: center.y / project.video.height,
      rotationDegrees,
      flipped,
      headingDegrees: rotationDegrees + (flipped ? 180 : 0),
      stateId: state?.id ?? null,
      facing: state?.facing ?? null,
    });
  }
  const direction = contract.direction === 'right' ? 1 : -1;
  const signedSegments = samples.slice(1).map((sample, index) =>
    direction * (sample.x - samples[index].x),
  );
  const netTravel = samples.length >= 2
    ? direction * (samples.at(-1).x - samples[0].x)
    : 0;
  const observedStates = [
    ...new Map(
      samples.map(({stateId, facing}) => [
        stateId,
        {stateId, facing},
      ]),
    ).values(),
  ];
  const facingAxisDegrees =
    contract.expectedFacing === 'right'
      ? 0
      : contract.expectedFacing === 'left'
        ? 180
        : null;
  const angularDistance = (left, right) => {
    const delta = Math.abs(((left - right + 540) % 360) - 180);
    return delta;
  };
  const renderFacingPassed =
    facingAxisDegrees === null ||
    (
      samples.length > 0 &&
      samples.every(
        ({headingDegrees}) =>
          angularDistance(headingDegrees, facingAxisDegrees) <= 90,
      )
    );
  const velocitySamples = [];
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const speed = Math.hypot(
      current.x - previous.x,
      current.y - previous.y,
    );
    if (speed > 0.001) {
      velocitySamples.push({
        angle: Math.atan2(
          current.y - previous.y,
          current.x - previous.x,
        ) * 180 / Math.PI,
        speed,
      });
    }
  }
  const headingVelocityPassed =
    facingAxisDegrees === null ||
    velocitySamples.length === 0 ||
    velocitySamples.every(({angle}) =>
      angularDistance(angle, facingAxisDegrees) <= 60,
    );
  checks.push(
    {
      id: 'travel-facing-samples-resolve',
      passed: samples.length >= 2,
      expected: 'at least two resolved state-sequence samples',
      actual: samples.length,
    },
    {
      id: 'travel-facing-direction',
      passed: netTravel + 1e-9 >= contract.minimumTravel,
      expected: {
        direction: contract.direction,
        minimumTravel: contract.minimumTravel,
      },
      actual: {netTravel},
    },
    {
      id: 'travel-facing-monotonic',
      passed: signedSegments.every((delta) => delta >= -1e-6),
      expected: `no ${contract.direction === 'right' ? 'leftward' : 'rightward'} segment in the proof window`,
      actual: {
        minimumSignedSegment:
          signedSegments.length > 0 ? Math.min(...signedSegments) : null,
      },
    },
    {
      id: 'travel-facing-state-metadata',
      passed:
        observedStates.length > 0 &&
        observedStates.every(
          ({facing}) => facing === contract.expectedFacing,
        ),
      expected: {
        facing: contract.expectedFacing,
        rationale: contract.rationale,
      },
      actual: observedStates,
    },
    {
      id: 'travel-facing-render-facing',
      passed: renderFacingPassed,
      expected: {
        facing: contract.expectedFacing,
        toleranceDegrees: 90,
      },
      actual: samples.map(({headingDegrees, flipped, facing}) => ({
        headingDegrees,
        flipped,
        stateFacing: facing,
      })),
    },
    {
      id: 'travel-facing-velocity-heading',
      passed: headingVelocityPassed,
      expected: {
        facing: contract.expectedFacing,
        toleranceDegrees: 60,
      },
      actual: velocitySamples.map(({angle, speed}) => ({
        velocityAngle: angle,
        speed,
      })),
    },
  );
  const endpoints = [
    {proofTimeId: from.id, sample: samples[0]},
    {proofTimeId: through.id, sample: samples.at(-1)},
  ];
  return {
    passed: checks.every(({passed}) => passed),
    checks,
    measurements: endpoints.map(({proofTimeId, sample}) => ({
      sceneId: scene.id,
      proofTimeId,
      nodeId: contract.nodeId,
      center: sample ? {
        x: sample.x * project.video.width,
        y: sample.y * project.video.height,
      } : null,
      startCenter: samples[0] ? {
        x: samples[0].x * project.video.width,
        y: samples[0].y * project.video.height,
      } : null,
      endCenter: samples.at(-1) ? {
        x: samples.at(-1).x * project.video.width,
        y: samples.at(-1).y * project.video.height,
      } : null,
      direction: contract.direction,
      expectedFacing: contract.expectedFacing,
      observedFacing: sample?.facing ?? null,
      netTravel,
    })),
  };
};

const inspectOcclusion = async (
  project,
  contract,
  {includeAlpha = false} = {},
) => {
  const timeline = deriveSceneTimeline(project);
  const scene = timeline.scenes.find(({id}) => id === contract.sceneId);
  const checks = [];
  if (!scene) {
    return {
      passed: false,
      checks: [{
        id: 'occlusion-scene-exists',
        passed: false,
        expected: contract.sceneId,
        actual: null,
      }],
      measurements: [],
    };
  }
  const prepared = prepareSceneResolution({scene, video: project.video});
  const measurements = [];
  for (const proofTimeId of contract.proofTimeIds) {
    const proof = proofFor(scene, proofTimeId);
    if (!proof) {
      checks.push({
        id: `occlusion-proof:${proofTimeId}`,
        passed: false,
        expected: proofTimeId,
        actual: null,
      });
      continue;
    }
    const resolved = resolveSceneNodes({
      scene,
      video: project.video,
      progress: proof.at,
      prepared,
    });
    const subject = resolved.entries.get(contract.subjectNodeId);
    const foreground = resolved.entries.get(contract.foregroundNodeId);
    if (!subject || !foreground) {
      checks.push({
        id: `occlusion-nodes:${proofTimeId}`,
        passed: false,
        expected: [contract.subjectNodeId, contract.foregroundNodeId],
        actual: [subject?.node.id ?? null, foreground?.node.id ?? null],
      });
      continue;
    }
    const paintDelta = comparePaintOrder(foreground, subject);
    const desiredSign =
      contract.relation === 'in-front-of-subject' ? 1 : -1;
    const paintPassed = paintDelta === 0
      ? contract.relation === 'behind-subject'
      : Math.sign(paintDelta) === desiredSign;
    const subjectBounds = includeAlpha
      ? await visibleBoundsFor(subject, proof.at)
      : subject.bounds;
    const foregroundBounds = includeAlpha
      ? await visibleBoundsFor(foreground, proof.at)
      : foreground.bounds;
    const intersection = rectangleIntersection(
      subjectBounds,
      foregroundBounds,
    );
    const subjectArea =
      (subjectBounds.right - subjectBounds.left) *
      (subjectBounds.bottom - subjectBounds.top);
    const overlapRatio =
      subjectArea > 0 ? intersection.area / subjectArea : 0;
    const overlapPassed = contract.relation === 'in-front-of-subject'
      ? overlapRatio + 1e-9 >= contract.minimumAlphaOverlap
      : overlapRatio <= Math.min(contract.minimumAlphaOverlap, 0.02);
    checks.push(
      {
        id: `occlusion-paint-order:${proofTimeId}`,
        passed: paintPassed,
        expected: {
          relation: contract.relation,
          foregroundPaintIndexAboveSubject:
            contract.relation === 'in-front-of-subject',
        },
        actual: {
          paintDelta,
          subjectZ: subject.node.z,
          foregroundZ: foreground.node.z,
          subjectStackingContext:
            subject.renderPath?.at(-1)?.node?.stackingContext ?? null,
        },
      },
      {
        id: `occlusion-alpha-overlap:${proofTimeId}`,
        passed: overlapPassed,
        expected: {
          relation: contract.relation,
          minimumAlphaOverlap: contract.minimumAlphaOverlap,
          mode: includeAlpha ? 'alpha-tight' : 'bounds',
        },
        actual: {overlapRatio},
      },
      {
        id: `occlusion-subject-not-lifted:${proofTimeId}`,
        passed:
          contract.relation === 'behind-subject' ||
          paintPassed,
        expected: contract.relation === 'in-front-of-subject'
          ? 'subject stacking stays below the foreground layer'
          : 'foreground stacking stays below the subject',
        actual: {
          subjectZ: subject.node.z,
          foregroundZ: foreground.node.z,
          paintDelta,
        },
      },
    );
    measurements.push({
      sceneId: scene.id,
      proofTimeId,
      subjectNodeId: contract.subjectNodeId,
      foregroundNodeId: contract.foregroundNodeId,
      paintDelta,
      overlapRatio,
      subjectZ: subject.node.z,
      foregroundZ: foreground.node.z,
    });
  }
  return {
    passed: checks.length > 0 && checks.every(({passed}) => passed),
    checks,
    measurements,
  };
};

const contractWindowAt = (contract) => {
  if (['gait', 'travel-facing', 'path-locomotion'].includes(contract.kind)) {
    return {from: contract.fromProofTimeId, through: contract.throughProofTimeId};
  }
  if (contract.kind === 'occlusion') {
    const times = contract.proofTimeIds ?? [];
    return {from: times[0] ?? null, through: times.at(-1) ?? null};
  }
  if (contract.kind === 'action-sequence') {
    const times = (contract.phases ?? []).map(({proofTimeId}) => proofTimeId);
    return {from: times[0] ?? null, through: times.at(-1) ?? null};
  }
  return {from: null, through: null};
};

const inspectActionSequence = (project, contract) => {
  const timeline = deriveSceneTimeline(project);
  const scene = timeline.scenes.find(({id}) => id === contract.sceneId);
  const checks = [];
  if (!scene) {
    return {
      passed: false,
      checks: [{
        id: 'action-sequence-scene-exists',
        passed: false,
        expected: contract.sceneId,
        actual: null,
      }],
      measurements: [],
    };
  }
  const fps = project.video.fps;
  const phases = contract.phases.map((phase) => ({
    ...phase,
    proof: proofFor(scene, phase.proofTimeId),
  }));
  const missingProofs = phases.filter(({proof}) => !proof);
  if (missingProofs.length > 0) {
    checks.push({
      id: 'action-sequence-proofs-resolve',
      passed: false,
      expected: contract.phases.map(({proofTimeId}) => proofTimeId),
      actual: missingProofs.map(({proofTimeId}) => proofTimeId),
    });
    return {passed: false, checks, measurements: []};
  }
  const ordered = phases.every(
    (phase, index) =>
      index === 0 || phase.proof.at > phases[index - 1].proof.at,
  );
  const durationSeconds = scene.durationInFrames / fps;
  const narrationFrom = Number(scene.narration?.startSeconds ?? 0);
  const narrationTo =
    narrationFrom + Number(scene.narration?.durationSeconds ?? 0);
  const narrationPresent = Number(scene.narration?.durationSeconds ?? 0) > 0;
  const cue = (project.editorial?.cues ?? []).find(
    ({id}) => id === contract.narrationCueId,
  );
  const cueExists =
    Boolean(cue) &&
    cue.sceneId === contract.sceneId &&
    cue.kind.startsWith('narration');
  const phaseSeconds = (phase) =>
    phase.proof.at * durationSeconds;
  const actionPhase = phases.find(({phase}) => phase === 'action') ??
    phases.find(({phase}) => phase === 'peak');
  const cueTimingPassed =
    !cueExists ||
    !actionPhase ||
    Math.abs(
      phaseSeconds(actionPhase) -
        (narrationFrom + Number(cue.atSeconds ?? 0)),
    ) <= contract.narrationToleranceSeconds + 1e-9;
  checks.push(
    {
      id: 'action-sequence-ordered',
      passed: ordered,
      expected: 'strictly increasing proof times across phases',
      actual: phases.map(({phase, proof}) => ({
        phase,
        at: proof.at,
      })),
    },
    {
      id: 'action-sequence-narration-window',
      passed:
        !narrationPresent ||
        phases.every((phase) => {
          const at = phaseSeconds(phase);
          return (
            at >= narrationFrom - contract.narrationToleranceSeconds - 1e-9 &&
            at <= narrationTo + contract.narrationToleranceSeconds + 1e-9
          );
        }),
      expected: {
        narrationWindowSeconds: [narrationFrom, narrationTo],
        toleranceSeconds: contract.narrationToleranceSeconds,
      },
      actual: phases.map(({phase, proofTimeId}) => ({
        phase,
        proofTimeId,
        seconds: phaseSeconds({proof: {at: proofFor(scene, proofTimeId).at}}),
      })),
    },
    {
      id: 'action-sequence-cue-exists',
      passed: cueExists,
      expected: {
        narrationCueId: contract.narrationCueId,
        sceneId: contract.sceneId,
      },
      actual: cue ? {id: cue.id, sceneId: cue.sceneId, kind: cue.kind} : null,
    },
    {
      id: 'action-sequence-cue-timing',
      passed: cueTimingPassed,
      expected: {
        actionPhaseWithinToleranceSeconds:
          contract.narrationToleranceSeconds,
      },
      actual: {
        cueAtSeconds: cue?.atSeconds ?? null,
        actionPhaseSeconds: actionPhase
          ? phaseSeconds(actionPhase)
          : null,
      },
    },
  );
  const prepared = prepareSceneResolution({scene, video: project.video});
  const measurements = [];
  let previous = null;
  for (const phase of phases) {
    const entry = resolvePreparedNodeAt({
      prepared,
      nodeId: phase.nodeId,
      progress: phase.proof.at,
    });
    const statePassed =
      !phase.stateId ||
      (
        entry?.node.kind === 'state-sequence' &&
        resolveSequenceState({
          node: entry.node,
          progress: phase.proof.at,
          pathDepthVelocity: entry.pathMotion?.depthVelocity ?? 0,
        })?.id === phase.stateId
      );
    let travelPassed = true;
    let travel = null;
    if (phase.direction && phase.minimumTravel !== undefined && previous) {
      const center = entry
        ? applyMatrix(entry.localMatrix, {
            x: entry.width * 0.5,
            y: entry.height * 0.5,
          })
        : null;
      if (center && previous.center) {
        const dx = (center.x - previous.center.x) / project.video.width;
        const signed =
          (phase.direction === 'right' ? 1 : -1) * dx;
        travelPassed =
          signed + 1e-9 >= phase.minimumTravel;
        travel = {signedDeltaX: signed, minimumTravel: phase.minimumTravel};
      }
    }
    checks.push(
      {
        id: `action-phase-resolves:${phase.phase}`,
        passed: Boolean(entry),
        expected: phase.nodeId,
        actual: entry?.node.id ?? null,
      },
      {
        id: `action-phase-state:${phase.phase}`,
        passed: statePassed,
        expected: phase.stateId ?? 'no-state-assertion',
        actual: entry?.node.kind === 'state-sequence'
          ? resolveSequenceState({
              node: entry.node,
              progress: phase.proof.at,
              pathDepthVelocity: entry.pathMotion?.depthVelocity ?? 0,
            })?.id ?? null
          : null,
      },
      ...(phase.direction
        ? [{
            id: `action-phase-travel:${phase.phase}`,
            passed: travelPassed,
            expected: {
              direction: phase.direction,
              minimumTravel: phase.minimumTravel,
            },
            actual: travel ?? 'missing-previous-phase',
          }]
        : []),
    );
    const center = entry
      ? applyMatrix(entry.localMatrix, {
          x: entry.width * 0.5,
          y: entry.height * 0.5,
        })
      : null;
    measurements.push({
      sceneId: scene.id,
      phase: phase.phase,
      proofTimeId: phase.proofTimeId,
      nodeId: phase.nodeId,
      center: center
        ? {
            x: center.x / project.video.width,
            y: center.y / project.video.height,
          }
        : null,
    });
    previous = {phase, center};
  }
  const contractsByScene = (project.spatialContracts ?? []).filter(
    ({id, sceneId}) =>
      sceneId === contract.sceneId && id !== contract.id,
  );
  const actorPassed = contract.actors.map((actor) => {
    const bound = contractsByScene.find(
      ({id}) => id === actor.contractId,
    );
    const boundNodeMatches =
      bound &&
      (
        bound.nodeId === actor.nodeId ||
        (
          bound.kind === 'occlusion' &&
          bound.subjectNodeId === actor.nodeId
        ) ||
        (
          bound.kind === 'action-sequence' &&
          bound.actors?.some(({nodeId}) => nodeId === actor.nodeId)
        )
      );
    const window = bound ? contractWindowAt(bound) : null;
    const fromProof = window?.from
      ? proofFor(scene, window.from)
      : null;
    const throughProof = window?.through
      ? proofFor(scene, window.through)
      : null;
    const firstPhase = phases[0].proof;
    const lastPhase = phases.at(-1).proof;
    const windowOverlaps =
      Boolean(fromProof && throughProof) &&
      fromProof.at <= lastPhase.at &&
      throughProof.at >= firstPhase.at;
    return {
      nodeId: actor.nodeId,
      contractId: actor.contractId,
      passed: Boolean(boundNodeMatches && windowOverlaps),
      issues: [
        ...(boundNodeMatches ? [] : ['actor 未绑定同幕同节点轨迹/遮挡契约']),
        ...(windowOverlaps ? [] : ['绑定契约窗口未覆盖动作窗口']),
      ],
    };
  });
  checks.push({
    id: 'action-actor-trajectory',
    passed: actorPassed.every(({passed}) => passed),
    expected: contract.actors.map(({nodeId, contractId}) => ({
      nodeId,
      contractId,
    })),
    actual: actorPassed,
  });
  return {
    passed: checks.length > 0 && checks.every(({passed}) => passed),
    checks,
    measurements,
  };
};

const directionSectorFor = (degrees) =>
  Math.round((((degrees % 360) + 360) % 360) / 45) % 8;

const inspectPathLocomotion = (project, contract) => {
  const timeline = deriveSceneTimeline(project);
  const scene = timeline.scenes.find(({id}) => id === contract.sceneId);
  if (!scene) {
    return {
      passed: false,
      checks: [{
        id: 'path-locomotion-scene-exists',
        passed: false,
        expected: contract.sceneId,
        actual: null,
      }],
      measurements: [],
    };
  }
  const from = proofFor(scene, contract.fromProofTimeId);
  const through = proofFor(scene, contract.throughProofTimeId);
  const proofIds = [
    contract.fromProofTimeId,
    ...(contract.turnProofTimeIds ?? []),
    contract.throughProofTimeId,
  ];
  const proofTimes = proofIds.map((id) => proofFor(scene, id));
  const prepared = prepareSceneResolution({
    scene,
    video: project.video,
  });
  const initial = resolvePreparedNodeAt({
    prepared,
    nodeId: contract.nodeId,
    progress: from?.at ?? 0,
  });
  const checks = [];
  if (
    !from ||
    !through ||
    through.at <= from.at ||
    proofTimes.some((proof) => !proof) ||
    initial?.node.kind !== 'state-sequence' ||
    !initial.node.motion?.path
  ) {
    checks.push({
      id: 'path-locomotion-window-resolves',
      passed: false,
      expected: {
        nodeKind: 'state-sequence',
        path: 'cubic-bezier-3d',
        orderedProofIds: proofIds,
      },
      actual: {
        nodeKind: initial?.node.kind ?? null,
        path: initial?.node.motion?.path?.kind ?? null,
        proofs: proofTimes.map((proof) => proof?.at ?? null),
      },
    });
    return {passed: false, checks, measurements: []};
  }
  const fromFrame = Math.round(
    from.at * Math.max(0, scene.durationInFrames - 1),
  );
  const throughFrame = Math.round(
    through.at * Math.max(0, scene.durationInFrames - 1),
  );
  const samples = [];
  for (let frame = fromFrame; frame <= throughFrame; frame += 1) {
    const progress = frame / Math.max(1, scene.durationInFrames - 1);
    const entry = resolvePreparedNodeAt({
      prepared,
      nodeId: contract.nodeId,
      progress,
    });
    if (!entry || entry.node.kind !== 'state-sequence') continue;
    const pathAnchor = {
      x: Number(entry.node.transform?.anchorX ?? 0.5),
      y: Number(entry.node.transform?.anchorY ?? 0.5),
    };
    const localCenter = applyMatrix(entry.localMatrix, {
      x: entry.width * pathAnchor.x,
      y: entry.height * pathAnchor.y,
    });
    const screenCenter = applyMatrix(entry.matrix, {
      x: entry.width * pathAnchor.x,
      y: entry.height * pathAnchor.y,
    });
    const screenCorners = [
      {x: 0, y: 0},
      {x: entry.width, y: 0},
      {x: entry.width, y: entry.height},
      {x: 0, y: entry.height},
    ].map((point) => applyMatrix(entry.matrix, point));
    const screenBounds = {
      minX:
        Math.min(...screenCorners.map(({x}) => x)) /
        project.video.width,
      maxX:
        Math.max(...screenCorners.map(({x}) => x)) /
        project.video.width,
      minY:
        Math.min(...screenCorners.map(({y}) => y)) /
        project.video.height,
      maxY:
        Math.max(...screenCorners.map(({y}) => y)) /
        project.video.height,
    };
    const state = resolveSequenceState({node: entry.node, progress});
    samples.push({
      frame,
      progress,
      x: localCenter.x / project.video.width,
      y: localCenter.y / project.video.height,
      screenCenter,
      screenBounds,
      path: entry.pathMotion,
      z: entry.pathMotion.z,
      projectionScale: entry.pathMotion.projectionScale,
      flipped:
        entry.localMatrix[0] * entry.localMatrix[3] -
          entry.localMatrix[1] * entry.localMatrix[2] < 0,
      renderedHeadingDegrees:
        Math.atan2(entry.localMatrix[1], entry.localMatrix[0]) *
          180 / Math.PI +
        initial.node.motion.path.orientation.forwardAngleDegrees,
      stateId: state?.id ?? null,
      distance: entry.pathMotion?.distance ?? null,
    });
  }
  const movingSegments = [];
  for (let index = 1; index < samples.length; index += 1) {
    const left = samples[index - 1];
    const right = samples[index];
    const dx = right.x - left.x;
    const dy = right.y - left.y;
    const pixelDx = dx * project.video.width;
    const pixelDy = dy * project.video.height;
    const length =
      Math.hypot(pixelDx, pixelDy) /
      Math.max(1, Math.min(project.video.width, project.video.height));
    if (length <= 1e-7) continue;
    const headingDegrees = right.path.headingDegrees;
    const movementAngleDegrees =
      Math.atan2(pixelDy, pixelDx) * 180 / Math.PI;
    movingSegments.push({
      frame: right.frame,
      length,
      headingDegrees,
      movementAngleDegrees,
      renderedHeadingDegrees: right.renderedHeadingDegrees,
      headingErrorDegrees: angleDifferenceDegrees(
        headingDegrees,
        right.renderedHeadingDegrees,
      ),
      sector: directionSectorFor(headingDegrees),
    });
  }
  const totalTravel = movingSegments.reduce(
    (sum, segment) => sum + segment.length,
    0,
  );
  const depthSegments = samples.slice(1).map((sample, index) => ({
    frame: sample.frame,
    delta: sample.z - samples[index].z,
  }));
  const totalDepthTravel = depthSegments.reduce(
    (sum, {delta}) => sum + Math.abs(delta),
    0,
  );
  const depthDirections = [
    ...new Set(
      depthSegments.flatMap(({delta}) => {
        if (Math.abs(delta) <= 1e-7) return [];
        return [delta > 0 ? 'toward-camera' : 'away-camera'];
      }),
    ),
  ].sort();
  const projectionScales = samples.map(({projectionScale}) => projectionScale);
  const projectionScaleDelta =
    projectionScales.length > 0
      ? Math.max(...projectionScales) - Math.min(...projectionScales)
      : 0;
  const sectors = [...new Set(movingSegments.map(({sector}) => sector))].sort(
    (left, right) => left - right,
  );
  const maximumHeadingError = Math.max(
    0,
    ...movingSegments.map(({headingErrorDegrees}) => headingErrorDegrees),
  );
  const turnRates = samples.slice(1).map((sample, index) =>
    angleDifferenceDegrees(
      samples[index].renderedHeadingDegrees,
      sample.renderedHeadingDegrees,
    ) * project.video.fps,
  );
  const maximumTurnRate = Math.max(0, ...turnRates);
  const distanceMonotonic = samples.every(
    (sample, index) =>
      index === 0 ||
      sample.distance === null ||
      samples[index - 1].distance === null ||
      sample.distance >= samples[index - 1].distance - 1e-6,
  );
  const span =
    samples.length >= 2
      ? Math.hypot(
          (Math.max(...samples.map(({x}) => x)) -
            Math.min(...samples.map(({x}) => x))) *
            project.video.width,
          (Math.max(...samples.map(({y}) => y)) -
            Math.min(...samples.map(({y}) => y))) *
            project.video.height,
        ) /
        Math.max(1, Math.min(project.video.width, project.video.height))
      : 0;
  const noJitter = span > 1e-9 && totalTravel >= 0.2 * span;
  const flippedSamples = samples.filter(({flipped}) => flipped);
  const safeBand = contract.screenSafeBand ?? null;
  const safeBandValid = !safeBand || (
    safeBand.minX < safeBand.maxX &&
    safeBand.minY < safeBand.maxY
  );
  const safeBandViolations = safeBand && safeBandValid
    ? samples.filter(({screenBounds}) =>
        screenBounds.minX < safeBand.minX - 1e-6 ||
        screenBounds.maxX > safeBand.maxX + 1e-6 ||
        screenBounds.minY < safeBand.minY - 1e-6 ||
        screenBounds.maxY > safeBand.maxY + 1e-6
      )
    : [];
  const follow = scene.camera?.follow;
  const origin = {
    x: project.video.width * 0.5,
    y: project.video.height * 0.54,
  };
  const coverageSamples = samples.map((sample) => {
    const camera = cameraStateAt(scene, sample.progress, project.video);
    const left =
      (0 - origin.x - camera.x) / camera.zoom + origin.x;
    const right =
      (project.video.width - origin.x - camera.x) / camera.zoom + origin.x;
    const top =
      (0 - origin.y - camera.y) / camera.zoom + origin.y;
    const bottom =
      (project.video.height - origin.y - camera.y) / camera.zoom + origin.y;
    const viewport = {
      left: left / project.video.width,
      right: right / project.video.width,
      top: top / project.video.height,
      bottom: bottom / project.video.height,
    };
    const bounds = follow?.worldBounds;
    const covered = Boolean(
      bounds &&
      viewport.left >= bounds.x - 1e-6 &&
      viewport.right <= bounds.x + bounds.width + 1e-6 &&
      viewport.top >= bounds.y - 1e-6 &&
      viewport.bottom <= bounds.y + bounds.height + 1e-6
    );
    return {frame: sample.frame, viewport, covered};
  });
  const gait = inspectGait(project, {
    ...contract,
    kind: 'gait',
  });
  checks.push(
    {
      id: 'path-locomotion-samples-resolve',
      passed: samples.length >= 2 && movingSegments.length >= 1,
      expected: 'at least two samples and one moving segment',
      actual: {
        samples: samples.length,
        movingSegments: movingSegments.length,
      },
    },
    {
      id: 'path-locomotion-travel',
      passed: totalTravel + 1e-9 >= contract.minimumTravel,
      expected: contract.minimumTravel,
      actual: totalTravel,
    },
    {
      id: 'path-locomotion-depth-travel',
      passed:
        totalDepthTravel + 1e-9 >=
        (contract.minimumDepthTravel ?? 0),
      expected: contract.minimumDepthTravel ?? 0,
      actual: totalDepthTravel,
    },
    {
      id: 'path-locomotion-depth-directions',
      passed: (contract.requiredDepthDirections ?? []).every(
        (direction) => depthDirections.includes(direction),
      ),
      expected: contract.requiredDepthDirections ?? [],
      actual: depthDirections,
    },
    {
      id: 'path-locomotion-depth-projection',
      passed:
        projectionScaleDelta + 1e-9 >=
        (contract.minimumProjectionScaleDelta ?? 0),
      expected: contract.minimumProjectionScaleDelta ?? 0,
      actual: projectionScaleDelta,
    },
    {
      id: 'path-locomotion-direction-sectors',
      passed: sectors.length >= contract.minimumDirectionSectors,
      expected: contract.minimumDirectionSectors,
      actual: {count: sectors.length, sectors},
    },
    {
      id: 'path-locomotion-heading',
      passed:
        movingSegments.length > 0 &&
        maximumHeadingError <= contract.maximumHeadingErrorDegrees + 1e-6,
      expected: {maximumHeadingErrorDegrees: contract.maximumHeadingErrorDegrees},
      actual: {maximumHeadingErrorDegrees: maximumHeadingError},
    },
    {
      id: 'path-locomotion-turn-rate',
      passed:
        maximumTurnRate <= contract.maximumTurnDegreesPerSecond + 1e-6,
      expected: {
        maximumTurnDegreesPerSecond: contract.maximumTurnDegreesPerSecond,
      },
      actual: {maximumTurnDegreesPerSecond: maximumTurnRate},
    },
    {
      id: 'path-locomotion-no-backtrack',
      passed:
        distanceMonotonic,
      expected: 'resolved arc-length path distance is never decreasing',
      actual: {
        monotonic: distanceMonotonic,
      },
    },
    {
      id: 'path-locomotion-no-jitter',
      passed: noJitter,
      expected: 'total travel spans a meaningful path extent instead of oscillating around one point',
      actual: {totalTravel, span, ratio: span > 1e-9 ? totalTravel / span : 0},
    },
    {
      id: 'path-locomotion-flip-consistent',
      passed: flippedSamples.length === 0,
      expected: 'path rendering never mirrors the registered state artwork',
      actual: {
        flippedFrames: flippedSamples.map(({frame}) => frame),
      },
    },
    ...(safeBand
      ? [{
          id: 'path-locomotion-screen-safe-band',
          passed: safeBandValid && safeBandViolations.length === 0,
          expected: safeBand,
          actual: {
            valid: safeBandValid,
            violationFrames: safeBandViolations.map(({frame}) => frame),
            minimumObservedY: Math.min(
              ...samples.map(({screenBounds}) => screenBounds.minY),
            ),
            maximumObservedY: Math.max(
              ...samples.map(({screenBounds}) => screenBounds.maxY),
            ),
          },
        }]
      : []),
    {
      id: 'path-locomotion-camera-binding',
      passed:
        !contract.requireCameraFollow ||
        (
          follow?.targetNodeId === contract.nodeId &&
          follow?.worldNodeId === contract.worldNodeId
        ),
      expected: contract.requireCameraFollow
        ? {
            targetNodeId: contract.nodeId,
            worldNodeId: contract.worldNodeId,
          }
        : 'camera follow optional',
      actual: follow ?? null,
    },
    {
      id: 'path-locomotion-camera-coverage',
      passed:
        !contract.requireCameraFollow ||
        (
          coverageSamples.length > 0 &&
          coverageSamples.every(({covered}) => covered)
        ),
      expected: 'camera viewport remains inside declared world bounds',
      actual: {
        failedFrames: coverageSamples
          .filter(({covered}) => !covered)
          .map(({frame}) => frame),
      },
    },
    ...gait.checks,
  );

  const descriptor = prepared.descriptors.get(contract.nodeId);
  const pathPolyline = samplePathPolyline(
    initial.node.motion.path,
    97,
    descriptor.parentWidth,
    descriptor.parentHeight,
  );
  const measurements = proofTimes.map((proof) => {
    const frame = Math.round(
      proof.at * Math.max(0, scene.durationInFrames - 1),
    );
    const progress = frame / Math.max(1, scene.durationInFrames - 1);
    const entry = resolvePreparedNodeAt({
      prepared,
      nodeId: contract.nodeId,
      progress,
    });
    const cameraMatrix = cameraMatrixAt({
      scene,
      progress,
      video: project.video,
    });
    const parentEntry = descriptor.parentDescriptor
      ? resolvePreparedNodeAt({
          prepared,
          nodeId: descriptor.parentDescriptor.node.id,
          progress,
        })
      : null;
    const parentMatrix = parentEntry?.localMatrix ?? identity();
    const pathPoints = pathPolyline.map((point) =>
      applyMatrix(
        cameraMatrix,
        applyMatrix(parentMatrix, {
          x:
            (initial.node.transform.x + point.x) *
            descriptor.parentWidth,
          y:
            (initial.node.transform.y + point.y) *
            descriptor.parentHeight,
        }),
      ),
    );
    const center = entry
      ? applyMatrix(entry.matrix, {
          x: entry.width * 0.5,
          y: entry.height * 0.5,
        })
      : null;
    return {
      sceneId: scene.id,
      proofTimeId: proof.id,
      frame,
      center,
      startCenter: pathPoints[0],
      endCenter: pathPoints.at(-1),
      pathPoints,
      headingDegrees: entry
        ? Math.atan2(entry.localMatrix[1], entry.localMatrix[0]) *
            180 / Math.PI +
          initial.node.motion.path.orientation.forwardAngleDegrees
        : null,
      rotationDegrees: entry
        ? Math.atan2(entry.localMatrix[1], entry.localMatrix[0]) *
          180 / Math.PI
        : null,
      totalTravel,
      totalDepthTravel,
      depthDirections,
      projectionScale: entry?.pathMotion?.projectionScale ?? null,
      projectionScaleDelta,
      directionSectors: sectors,
      maximumHeadingErrorDegrees: maximumHeadingError,
      maximumTurnDegreesPerSecond: maximumTurnRate,
      screenBounds: entry
        ? {
            minX:
              Math.min(
                ...[
                  {x: 0, y: 0},
                  {x: entry.width, y: 0},
                  {x: entry.width, y: entry.height},
                  {x: 0, y: entry.height},
                ].map((point) => applyMatrix(entry.matrix, point).x),
              ) / project.video.width,
            maxX:
              Math.max(
                ...[
                  {x: 0, y: 0},
                  {x: entry.width, y: 0},
                  {x: entry.width, y: entry.height},
                  {x: 0, y: entry.height},
                ].map((point) => applyMatrix(entry.matrix, point).x),
              ) / project.video.width,
            minY:
              Math.min(
                ...[
                  {x: 0, y: 0},
                  {x: entry.width, y: 0},
                  {x: entry.width, y: entry.height},
                  {x: 0, y: entry.height},
                ].map((point) => applyMatrix(entry.matrix, point).y),
              ) / project.video.height,
            maxY:
              Math.max(
                ...[
                  {x: 0, y: 0},
                  {x: entry.width, y: 0},
                  {x: entry.width, y: entry.height},
                  {x: 0, y: entry.height},
                ].map((point) => applyMatrix(entry.matrix, point).y),
              ) / project.video.height,
          }
        : null,
    };
  });
  return {
    passed: checks.every(({passed}) => passed),
    checks,
    measurements,
  };
};

export const inspectSpatialContract = async (
  project,
  contract,
  options = {},
) => {
  const hasActiveResponsivePlan = (
    project.editorial?.responsivePlans ?? []
  ).some(
    ({profileId}) => profileId === project.editorial?.activeProfile,
  );
  const executableProject = hasActiveResponsivePlan
    ? applyResponsiveDirectingPlan(project)
    : project;
  if (contract.kind === 'grounding') {
    return inspectGrounding(executableProject, contract, options);
  }
  if (contract.kind === 'continuity') {
    return inspectContinuity(executableProject, contract);
  }
  if (contract.kind === 'gait') {
    return inspectGait(executableProject, contract);
  }
  if (contract.kind === 'travel-facing') {
    return inspectTravelFacing(executableProject, contract);
  }
  if (contract.kind === 'path-locomotion') {
    return inspectPathLocomotion(executableProject, contract);
  }
  if (contract.kind === 'occlusion') {
    return inspectOcclusion(executableProject, contract, options);
  }
  if (contract.kind === 'action-sequence') {
    return inspectActionSequence(executableProject, contract);
  }
  return {
    passed: false,
    checks: [{
      id: 'spatial-contract-kind',
      passed: false,
      expected: [
        'grounding',
        'continuity',
        'gait',
        'travel-facing',
        'path-locomotion',
        'occlusion',
        'action-sequence',
      ],
      actual: contract.kind ?? null,
    }],
    measurements: [],
  };
};

export const validateSpatialContracts = async (project) => {
  const issues = [];
  if (project.spatialContracts !== undefined &&
      !Array.isArray(project.spatialContracts)) {
    issues.push({
      level: 'error',
      code: 'spatial-contracts-type',
      message: 'spatialContracts 必须为数组。',
      location: 'spatialContracts',
    });
    return issues;
  }
  const ids = new Set();
  for (const [index, contract] of (project.spatialContracts ?? []).entries()) {
    const location = `spatialContracts[${index}]`;
    if (
      typeof contract?.id !== 'string' ||
      contract.id.length === 0 ||
      ids.has(contract.id)
    ) {
      issues.push({
        level: 'error',
        code: 'spatial-contract-id',
        message: 'spatial contract id 缺失或重复。',
        location: `${location}.id`,
      });
      continue;
    }
    ids.add(contract.id);
    const inspection = await inspectSpatialContract(project, contract);
    for (const check of inspection.checks.filter(({passed}) => !passed)) {
      issues.push({
        level: 'error',
        code: `spatial-${check.id.replace(/:[^:]+$/, '')}`,
        message: `空间契约 ${contract.id} 未通过 ${check.id}：期望 ${JSON.stringify(check.expected)}，实际 ${JSON.stringify(check.actual)}。`,
        location,
      });
    }
  }
  issues.push(...validateMultiActorNarrationSpatialCoverage(project));
  return issues;
};

const collectMotionActorNodes = (scene) => {
  const nodes = [];
  const visit = (list) => {
    for (const node of list ?? []) {
      if (
        node?.kind === 'state-sequence' ||
        node?.motion?.path
      ) {
        nodes.push(node);
      }
      if (node?.kind === 'group') visit(node.children);
    }
  };
  visit(scene.composition?.nodes);
  return nodes;
};

export const validateMultiActorNarrationSpatialCoverage = (project) => {
  const issues = [];
  const contracts = project.spatialContracts ?? [];
  const timeline = deriveSceneTimeline(project);
  for (const scene of project.scenes ?? []) {
    const narration = scene.narration;
    if (
      !narration ||
      !(Number(narration.durationSeconds ?? 0) > 0)
    ) {
      continue;
    }
    const narrationFrom = Number(narration.startSeconds ?? 0);
    const narrationTo =
      narrationFrom + Number(narration.durationSeconds ?? 0);
    const timelineScene = timeline.scenes.find(
      ({id}) => id === scene.id,
    );
    if (!timelineScene) continue;
    const durationSeconds =
      timelineScene.durationInFrames / project.video.fps;
    const actors = collectMotionActorNodes(scene).filter((node) => {
      const activeFrom = node.playback?.activeFrom ?? 0;
      const activeUntil = node.playback?.activeUntil ?? 1;
      return (
        activeFrom * durationSeconds <= narrationTo &&
        activeUntil * durationSeconds >= narrationFrom
      );
    });
    if (actors.length < 2) continue;
    for (const node of actors) {
      const covered = contracts.some((contract) => {
        if (contract.sceneId !== scene.id) return false;
        const nodeMatches =
          ['gait', 'travel-facing', 'path-locomotion'].includes(contract.kind)
            ? contract.nodeId === node.id
            : contract.kind === 'occlusion'
              ? contract.subjectNodeId === node.id
              : contract.kind === 'action-sequence'
                ? contract.actors?.some(
                    ({nodeId}) => nodeId === node.id,
                  )
                : false;
        if (!nodeMatches) return false;
        const window = contractWindowAt(contract);
        const from = window?.from
          ? proofFor(scene, window.from)
          : null;
        const through = window?.through
          ? proofFor(scene, window.through)
          : null;
        if (!from || !through) return false;
        return (
          from.at * durationSeconds <= narrationTo &&
          through.at * durationSeconds >= narrationFrom
        );
      });
      if (!covered) {
        issues.push({
          level: 'error',
          code: 'narration-multi-actor-trajectory',
          message:
            `镜头 ${scene.id} 的旁白窗口内活跃多个动作演员，` +
            `节点 ${node.id} 缺少覆盖旁白窗口的轨迹/朝向/路径/动作契约。`,
          location: `scenes[${project.scenes.indexOf(scene)}]`,
        });
      }
    }
  }
  return issues;
};

export const validateStoryboardSpatialContracts = (storyboard) => {
  const issues = [];
  if (
    storyboard.spatialContracts !== undefined &&
    !Array.isArray(storyboard.spatialContracts)
  ) {
    return [{
      code: 'storyboard-spatial-contracts-type',
      message: 'spatialContracts 必须为数组。',
      location: 'spatialContracts',
    }];
  }
  const contracts = storyboard.spatialContracts ?? [];
  const sceneById = new Map(
    (storyboard.scenes ?? []).map((scene, index) => [
      scene.id,
      {scene, index},
    ]),
  );
  const ids = new Set();
  const groundingById = new Map();
  for (const [index, contract] of contracts.entries()) {
    const location = `spatialContracts[${index}]`;
    if (
      typeof contract?.id !== 'string' ||
      contract.id.length === 0 ||
      ids.has(contract.id)
    ) {
      issues.push({
        code: 'storyboard-spatial-contract-id',
        message: 'spatial contract id 缺失或重复。',
        location: `${location}.id`,
      });
      continue;
    }
    ids.add(contract.id);
    if (contract.kind === 'grounding') groundingById.set(contract.id, contract);
    if (
      contract.kind === 'grounding' ||
      contract.kind === 'gait' ||
      contract.kind === 'travel-facing' ||
      contract.kind === 'path-locomotion' ||
      contract.kind === 'occlusion' ||
      contract.kind === 'action-sequence'
    ) {
      const scene = sceneById.get(contract.sceneId)?.scene;
      if (!scene) {
        issues.push({
          code: 'storyboard-spatial-scene',
          message: `空间契约 ${contract.id} 引用了未知镜头 ${contract.sceneId}。`,
          location: `${location}.sceneId`,
        });
        continue;
      }
      const proofIds = new Set(
        (scene.proofTimes ?? []).map(({id}) => id),
      );
      const referenced = contract.kind === 'grounding'
        ? contract.proofTimeIds
        : contract.kind === 'path-locomotion'
          ? [
              contract.fromProofTimeId,
              ...(contract.turnProofTimeIds ?? []),
              contract.throughProofTimeId,
            ]
          : contract.kind === 'occlusion'
            ? contract.proofTimeIds
            : contract.kind === 'action-sequence'
              ? (contract.phases ?? []).map(({proofTimeId}) => proofTimeId)
          : [contract.fromProofTimeId, contract.throughProofTimeId];
      for (const proofTimeId of referenced ?? []) {
        if (!proofIds.has(proofTimeId)) {
          issues.push({
            code: 'storyboard-spatial-proof',
            message: `空间契约 ${contract.id} 引用了未知证明时刻 ${proofTimeId}。`,
            location,
          });
        }
      }
      if (contract.kind === 'action-sequence') {
        for (const actor of contract.actors ?? []) {
          const bound = contracts.find(
            (candidate) => candidate.id === actor.contractId,
          );
          const boundMatchesNode =
            bound &&
            (
              bound.sceneId === contract.sceneId &&
              (
                bound.nodeId === actor.nodeId ||
                (
                  bound.kind === 'occlusion' &&
                  bound.subjectNodeId === actor.nodeId
                ) ||
                (
                  bound.kind === 'action-sequence' &&
                  bound.actors?.some(({nodeId}) => nodeId === actor.nodeId)
                )
              )
            );
          if (!boundMatchesNode) {
            issues.push({
              code: 'storyboard-action-actor-trajectory',
              message: `多阶段动作契约 ${contract.id} 的演员 ${actor.nodeId} 必须绑定同一镜头的轨迹/遮挡契约 ${actor.contractId}。`,
              location,
            });
          }
        }
      }
      if (contract.kind === 'travel-facing') {
        const cadenceContract = contracts.find(
          (candidate) =>
            candidate.kind === 'gait' &&
            candidate.sceneId === contract.sceneId &&
            candidate.nodeId === contract.nodeId,
        );
        if (!cadenceContract) {
          issues.push({
            code: 'storyboard-travel-facing-gait-required',
            message: `运动朝向契约 ${contract.id} 必须为同一角色声明 gait 契约，以证明可见位移期间持续使用至少两个注册动作状态。`,
            location,
          });
        }
        const sequence = scene.compositionPlan?.stateSequences?.find(
          ({nodeId}) => nodeId === contract.nodeId,
        );
        if (!sequence) {
          issues.push({
            code: 'storyboard-travel-facing-node',
            message: `运动朝向契约 ${contract.id} 必须引用编译后的 state-sequence 节点。`,
            location: `${location}.nodeId`,
          });
        } else {
          const fromAt = scene.proofTimes.find(
            ({id}) => id === contract.fromProofTimeId,
          )?.at;
          const throughAt = scene.proofTimes.find(
            ({id}) => id === contract.throughProofTimeId,
          )?.at;
          if (fromAt !== undefined && throughAt !== undefined) {
            const activeStates = sequence.states.filter((state, stateIndex) => {
              const nextAt =
                sequence.states[stateIndex + 1]?.at ?? 1;
              return state.at <= throughAt && nextAt >= fromAt;
            });
            if (
              activeStates.length === 0 ||
              activeStates.some(
                ({facing}) => facing !== contract.expectedFacing,
              )
            ) {
              issues.push({
                code: 'storyboard-travel-facing-state',
                message: `运动朝向契约 ${contract.id} 的窗口内状态必须全部声明 facing=${contract.expectedFacing}。`,
                location,
              });
            }
          }
        }
      }
      if (contract.kind === 'path-locomotion') {
        const sequence = scene.compositionPlan?.stateSequences?.find(
          ({nodeId}) => nodeId === contract.nodeId,
        );
        const pathMotion = scene.compositionPlan?.pathMotions?.find(
          ({nodeId}) => nodeId === contract.nodeId,
        );
        if (!sequence || !pathMotion) {
          issues.push({
            code: 'storyboard-path-locomotion-plan',
            message: `二维路径契约 ${contract.id} 必须同时引用编译后的 path motion 与 state-sequence。`,
            location,
          });
        } else {
          const knownStateIds = new Set(sequence.states.map(({id}) => id));
          if (
            !contract.stateIds.every((stateId) => knownStateIds.has(stateId)) ||
            !['loop', 'ping-pong'].includes(sequence.playback.mode)
          ) {
            issues.push({
              code: 'storyboard-path-locomotion-cycle',
              message: `二维路径契约 ${contract.id} 必须绑定当前循环状态家族中的至少两个状态。`,
              location,
            });
          }
          if (
            contract.requireCameraFollow &&
            (
              pathMotion.cameraFollow?.targetNodeId !== contract.nodeId ||
              pathMotion.cameraFollow?.worldNodeId !== contract.worldNodeId
            )
          ) {
            issues.push({
              code: 'storyboard-path-locomotion-camera',
              message: `二维路径契约 ${contract.id} 的镜头跟随必须绑定同一目标和世界节点。`,
              location,
            });
          }
        }
      }
    }
    if (contract.kind === 'grounding' && contract.frontOcclusion) {
      const occlusionContract = contracts.find(
        (candidate) =>
          candidate.kind === 'occlusion' &&
          candidate.sceneId === contract.sceneId &&
          candidate.subjectNodeId === contract.subjectNodeId &&
          candidate.foregroundNodeId === contract.frontOcclusion.nodeId &&
          candidate.relation === contract.frontOcclusion.relation,
      );
      if (!occlusionContract) {
        issues.push({
          code: 'storyboard-grounding-front-occlusion-contract',
          message: `接地契约 ${contract.id} 声明了前景遮挡 ${contract.frontOcclusion.nodeId}，必须同时声明匹配的 occlusion 空间契约，禁止仅靠声明通过。`,
          location: `spatialContracts[${index}].frontOcclusion`,
        });
      }
    }
    if (contract.kind === 'continuity') {
      const from = sceneById.get(contract.from?.sceneId);
      const to = sceneById.get(contract.to?.sceneId);
      if (!from || !to || to.index !== from.index + 1) {
        issues.push({
          code: 'storyboard-spatial-continuity-adjacent',
          message: `连续性契约 ${contract.id} 必须绑定相邻的出入镜头。`,
          location,
        });
        continue;
      }
      for (const endpoint of [contract.from, contract.to]) {
        if (
          !(sceneById.get(endpoint.sceneId)?.scene.proofTimes ?? [])
            .some(({id}) => id === endpoint.proofTimeId)
        ) {
          issues.push({
            code: 'storyboard-spatial-continuity-proof',
            message: `连续性契约 ${contract.id} 引用了未知证明时刻 ${endpoint.sceneId}/${endpoint.proofTimeId}。`,
            location,
          });
        }
      }
    }
  }
  for (const [index, contract] of contracts.entries()) {
    if (contract.kind !== 'continuity') continue;
    const grounding = (contract.groundingContractIds ?? []).map((id) =>
      groundingById.get(id),
    );
    if (
      grounding.length < 2 ||
      grounding.some((candidate) => !candidate) ||
      !grounding.some(({sceneId}) => sceneId === contract.from.sceneId) ||
      !grounding.some(({sceneId}) => sceneId === contract.to.sceneId)
    ) {
      issues.push({
        code: 'storyboard-spatial-continuity-grounding',
        message: `连续性契约 ${contract.id} 必须绑定出入两幕各自的 grounding 契约。`,
        location: `spatialContracts[${index}].groundingContractIds`,
      });
    }
  }
  for (const scene of storyboard.scenes ?? []) {
    const sequenceNodeIds = new Set(
      (scene.compositionPlan?.stateSequences ?? []).map(({nodeId}) => nodeId),
    );
    const directedTargets = [
      ...new Set(
        (scene.compositionPlan?.continuousMotions ?? [])
          .filter(
            ({nodeId, preset}) =>
              sequenceNodeIds.has(nodeId) && preset === 'traverse',
          )
          .map(({nodeId}) => nodeId),
      ),
    ];
    for (const nodeId of directedTargets) {
      if (
        !contracts.some(
          (contract) =>
            contract.kind === 'travel-facing' &&
            contract.sceneId === scene.id &&
            contract.nodeId === nodeId,
        )
      ) {
        issues.push({
          code: 'storyboard-travel-facing-required',
          message: `镜头 ${scene.id} 的移动状态角色 ${nodeId} 必须声明 travel-facing 契约，绑定实际行进方向与状态朝向。`,
          location: 'spatialContracts',
        });
      }
    }
    for (const pathMotion of scene.compositionPlan?.pathMotions ?? []) {
      if (
        !contracts.some(
          (contract) =>
            contract.kind === 'path-locomotion' &&
            contract.sceneId === scene.id &&
            contract.nodeId === pathMotion.nodeId,
        )
      ) {
        issues.push({
          code: 'storyboard-path-locomotion-required',
          message: `镜头 ${scene.id} 的二维路径角色 ${pathMotion.nodeId} 必须声明 path-locomotion 空间契约。`,
          location: 'spatialContracts',
        });
      }
    }
  }
  return issues;
};

export const buildSpatialContractProof = async (project, contract) => ({
  contractId: contract.id,
  kind: contract.kind,
  ...await inspectSpatialContract(project, contract, {includeAlpha: true}),
});

export const summarizeSpatialContracts = (project) => ({
  total: project.spatialContracts?.length ?? 0,
  grounding:
    project.spatialContracts?.filter(({kind}) => kind === 'grounding').length ??
    0,
  continuity:
    project.spatialContracts?.filter(({kind}) => kind === 'continuity').length ??
    0,
  gait:
    project.spatialContracts?.filter(({kind}) => kind === 'gait').length ?? 0,
  travelFacing:
    project.spatialContracts?.filter(({kind}) => kind === 'travel-facing')
      .length ?? 0,
  pathLocomotion:
    project.spatialContracts?.filter(({kind}) => kind === 'path-locomotion')
      .length ?? 0,
  occlusion:
    project.spatialContracts?.filter(({kind}) => kind === 'occlusion').length ??
    0,
  actionSequence:
    project.spatialContracts?.filter(({kind}) => kind === 'action-sequence')
      .length ?? 0,
});

const escapeXml = (value) =>
  String(value).replace(/[<>&'"]/g, (character) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    "'": '&apos;',
    '"': '&quot;',
  })[character]);

export const spatialContractDebugOverlay = ({
  proof,
  sceneId,
  proofTimeId,
  width,
  height,
}) => {
  const measurement = proof.measurements?.find(
    (candidate) =>
      candidate.sceneId === sceneId &&
      candidate.proofTimeId === proofTimeId,
  );
  const checks = proof.checks.filter(({id}) =>
    id.endsWith(`:${proofTimeId}`) || !id.includes(':'),
  );
  const color = checks.every(({passed}) => passed) ? '#30d158' : '#ff453a';
  const surface = measurement?.supportSurface?.map(
    ({x, y}) => `${x},${y}`,
  ).join(' ') ?? '';
  const zones = (measurement?.subtitleZones ?? []).map((zone) =>
    `<rect x="${zone.left}" y="${zone.top}" width="${zone.right - zone.left}" height="${zone.bottom - zone.top}" fill="rgba(255,159,10,.14)" stroke="#ff9f0a" stroke-width="4"/>`,
  ).join('');
  const anchor = measurement?.anchor
    ? `<circle cx="${measurement.anchor.x}" cy="${measurement.anchor.y}" r="11" fill="${color}"/><line x1="${measurement.anchor.x}" y1="${measurement.anchor.y}" x2="${measurement.nearestSurfacePoint.x}" y2="${measurement.nearestSurfacePoint.y}" stroke="${color}" stroke-width="5"/>`
    : '';
  const travelArrow =
    measurement?.startCenter && measurement?.endCenter
      ? `<line x1="${measurement.startCenter.x}" y1="${measurement.startCenter.y}" x2="${measurement.endCenter.x}" y2="${measurement.endCenter.y}" stroke="${color}" stroke-width="8" marker-end="url(#travel-arrow)"/><circle cx="${measurement.center?.x ?? measurement.startCenter.x}" cy="${measurement.center?.y ?? measurement.startCenter.y}" r="12" fill="${color}"/>`
      : '';
  const pathPolyline = measurement?.pathPoints?.length
    ? `<polyline points="${measurement.pathPoints.map(({x, y}) => `${x},${y}`).join(' ')}" fill="none" stroke="#64d2ff" stroke-width="7" stroke-dasharray="18 12"/><circle cx="${measurement.center?.x ?? measurement.pathPoints[0].x}" cy="${measurement.center?.y ?? measurement.pathPoints[0].y}" r="14" fill="${color}"/>`
    : '';
  const headingLine =
    measurement?.center &&
    Number.isFinite(measurement.headingDegrees)
      ? (() => {
          const radians = measurement.headingDegrees * Math.PI / 180;
          const length = Math.min(width, height) * 0.1;
          return `<line x1="${measurement.center.x}" y1="${measurement.center.y}" x2="${measurement.center.x + Math.cos(radians) * length}" y2="${measurement.center.y + Math.sin(radians) * length}" stroke="#ffd60a" stroke-width="7" marker-end="url(#heading-arrow)"/>`;
        })()
      : '';
  return Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <marker id="travel-arrow" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto"><path d="M0,0 L12,6 L0,12 z" fill="${color}"/></marker>
        <marker id="heading-arrow" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto"><path d="M0,0 L12,6 L0,12 z" fill="#ffd60a"/></marker>
      </defs>
      ${zones}
      ${surface ? `<polyline points="${surface}" fill="none" stroke="#64d2ff" stroke-width="7"/>` : ''}
      ${anchor}
      ${travelArrow}
      ${pathPolyline}
      ${headingLine}
      <rect x="16" y="16" width="${Math.min(width - 32, 1040)}" height="54" rx="10" fill="rgba(0,0,0,.78)" stroke="${color}" stroke-width="3"/>
      <text x="34" y="52" fill="white" font-size="25" font-family="sans-serif">${escapeXml(`${proof.contractId} · ${proof.kind} · ${proof.passed ? 'PASS' : 'FAIL'}`)}</text>
    </svg>
  `);
};
