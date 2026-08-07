import type {CSSProperties} from 'react';
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import type {
  CompositionAnnotationNode,
  CompositionAssetNode,
  CompositionBoundary,
  CompositionDataGraphicNode,
  CompositionEditorialSwitchNode,
  CompositionGroupNode,
  CompositionMotifFieldNode,
  CompositionNode,
  CompositionShapeNode,
  CompositionStateSequenceNode,
  CompositionTypographyNode,
  CompositionWorldStripNode,
  CoordinateSpace,
  EditorialSubtitlePlacement,
  EditorialSystem,
  NormalizedProjectScene,
  ProjectEvent,
  ProjectTheme,
} from './project';
import {
  AnnotationView,
  DataGraphicView,
  EditorialSwitchView,
  TypographyView,
} from './EditorialNodes';
import {
  resolveMotifFieldInstances,
  resolveMotifFieldMotion,
  resolveWorldBoundMotifX,
} from './motifField.mjs';
import {resolveEmphasisState, resolveIdleState, resolveMotionState, resolveVisibilityState} from './motion';
import {resolveParallaxState} from './parallax.mjs';
import {
  resolveCameraFollowAtFrame,
  resolvePathMotionAtFrame,
} from './pathMotion.mjs';
import {resolveSceneTransitionPresentation} from './sceneTimeline.mjs';
import {resolveSequenceLayers} from './stateSequence';
import {SubtitleOverlay} from './SubtitleOverlay';
import {
  resolveWorldStripCopies,
  resolveWorldStripFrame,
  resolveWorldStripSpeedFactor,
  resolveWorldStripTileGeometry,
} from './worldStrip.mjs';

const clamp = {
  extrapolateLeft: 'clamp',
  extrapolateRight: 'clamp',
} as const;

export const subjectSurfaceFilter = (
  surface: ProjectTheme['surface'],
) => {
  const filters: string[] = [];
  if (surface.subjectEdge.mode === 'paper-outline') {
    const {color, widthPx} = surface.subjectEdge;
    filters.push(
      `drop-shadow(${widthPx}px 0 ${color})`,
      `drop-shadow(${-widthPx}px 0 ${color})`,
    );
  }
  if (surface.subjectShadow.mode === 'drop-shadow') {
    const {offsetXPx, offsetYPx, blurPx, color} = surface.subjectShadow;
    filters.push(
      `drop-shadow(${offsetXPx}px ${offsetYPx}px ${blurPx}px ${color})`,
    );
  }
  return filters.length > 0 ? filters.join(' ') : undefined;
};

const phaseFor = (id: string, seed: number) => {
  let value = seed >>> 0;
  for (const character of id) value = Math.imul(value ^ character.charCodeAt(0), 16777619);
  return (value >>> 0) / 0xffffffff * Math.PI * 2;
};

const slotOrder = (node: CompositionNode, layering: 'between-supports' | 'subject-front' = 'between-supports') => {
  if (node.kind !== 'asset' && node.kind !== 'state-sequence') return node.z;
  const fixed = layering === 'subject-front' ? {
    'support-rear': -30,
    'contact-shadow': -20,
    'support-front': -10,
    subject: 0,
  } : {
    'support-rear': -30,
    'contact-shadow': -20,
    subject: -10,
    'support-front': 0,
  } as Record<string, number>;
  fixed['container-clean-plate'] = -30;
  fixed['container-contents'] = -20;
  fixed['container-frame'] = -10;
  return fixed[node.slot ?? ''] ?? node.z;
};

const composeNodeTransform = ({
  node,
  parent,
  progress,
  frame,
  fps,
  events,
  durationSeconds,
  seed,
  cameraX,
  cameraY,
  cameraZoom,
  parallax,
  worldAnchorOffsetX = 0,
}: {
  node: CompositionNode;
  parent: CoordinateSpace;
  progress: number;
  frame: number;
  fps: number;
  events: ProjectEvent[];
  durationSeconds: number;
  seed: number;
  cameraX: number;
  cameraY: number;
  cameraZoom: number;
  parallax: NormalizedProjectScene['camera']['parallax'];
  worldAnchorOffsetX?: number;
}) => {
  const authored = resolveMotionState(node.motion.keyframes, progress);
  const pathMotion = resolvePathMotionAtFrame({
    pathMotion: node.motion.path,
    frame,
    durationInFrames: Math.max(1, Math.round(durationSeconds * fps)),
    fps,
    parentWidth: parent.width,
    parentHeight: parent.height,
  });
  const idle = resolveIdleState({
    idle: node.motion.idle,
    frame,
    fps,
    phase: phaseFor(node.id, seed),
  });
  const emphasis = resolveEmphasisState({events, targetId: node.id, progress, durationSeconds});
  const visibility = resolveVisibilityState({
    events,
    targetId: node.id,
    initial: node.visibility?.initial,
    progress,
    durationSeconds,
  });
  const transform = node.transform;
  const depth = resolveParallaxState({
    depth: node.depth ?? 0,
    cameraX,
    cameraY,
    cameraZoom,
    parallax,
  });
  const width = transform.width * parent.width;
  const height = transform.height === undefined ? undefined : transform.height * parent.height;
  return {
    left: transform.x * parent.width,
    top: transform.y * parent.height,
    width,
    height,
    opacity: (transform.opacity ?? 1) * authored.opacity * idle.opacity * emphasis.opacity * visibility.opacity * pathMotion.projectionOpacity,
    pathFilter: pathMotion.projectionBlurPx > 0
      ? `blur(${pathMotion.projectionBlurPx}px)`
      : undefined,
    depthOrder: pathMotion.depthOrder,
    pathDepthVelocity: pathMotion.depthVelocity,
    css: `translate(${-transform.anchorX * 100}%, ${-transform.anchorY * 100}%) translate3d(${(authored.x + pathMotion.x + idle.x + emphasis.x + visibility.x) * parent.width + depth.x + worldAnchorOffsetX}px, ${(authored.y + pathMotion.y + idle.y + emphasis.y + visibility.y) * parent.height + depth.y}px, 0) scale(${(transform.scale ?? 1) * authored.scale * idle.scale * emphasis.scale * visibility.scale * depth.scale * pathMotion.projectionScale}) rotate(${(transform.rotation ?? 0) + authored.rotation + pathMotion.rotationDegrees + idle.rotation + emphasis.rotation + visibility.rotation}deg)`,
  };
};

const clipStyle = ({
  node,
  boundaries,
}: {
  node: CompositionAssetNode | CompositionStateSequenceNode;
  boundaries: CompositionBoundary[];
}): CSSProperties => {
  if (!node.clip) return {};
  const boundary = boundaries.find(({id}) => id === node.clip?.boundaryId);
  if (!boundary) return {};
  const maskSrc = node.clip.side === 'upper' ? boundary.upperMaskSrc : boundary.lowerMaskSrc;
  if (maskSrc) {
    const url = `url(${staticFile(maskSrc)})`;
    return {
      maskImage: url,
      WebkitMaskImage: url,
      maskSize: '100% 100%',
      WebkitMaskSize: '100% 100%',
      maskRepeat: 'no-repeat',
      WebkitMaskRepeat: 'no-repeat',
    };
  }
  const y = boundary.normalizedY ?? 0.5;
  return node.clip.side === 'upper'
    ? {clipPath: `inset(0 0 ${(1 - y) * 100}% 0)`}
    : {clipPath: `inset(${y * 100}% 0 0 0)`};
};

const containerStyle = ({
  node,
  resolved,
  renderZ,
}: {
  node: CompositionNode;
  resolved: ReturnType<typeof composeNodeTransform>;
  renderZ: number;
}): CSSProperties => ({
  position: 'absolute',
  left: resolved.left,
  top: resolved.top,
  width: resolved.width,
  ...(resolved.height === undefined ? {} : {height: resolved.height}),
  zIndex: renderZ + resolved.depthOrder,
  opacity: resolved.opacity,
  transform: resolved.css,
  transformOrigin: `${(node.motion.pivot?.x ?? node.transform.anchorX) * 100}% ${(node.motion.pivot?.y ?? node.transform.anchorY) * 100}%`,
});

const AssetView = ({
  node,
  parent,
  boundaries,
  progress,
  frame,
  fps,
  events,
  durationSeconds,
  seed,
  renderZ,
  surface,
  cameraX,
  cameraY,
  cameraZoom,
  parallax,
  worldAnchorOffsetX,
}: {
  node: CompositionAssetNode;
  parent: CoordinateSpace;
  boundaries: CompositionBoundary[];
  progress: number;
  frame: number;
  fps: number;
  events: ProjectEvent[];
  durationSeconds: number;
  seed: number;
  renderZ: number;
  surface: ProjectTheme['surface'];
  cameraX: number;
  cameraY: number;
  cameraZoom: number;
  parallax: NormalizedProjectScene['camera']['parallax'];
  worldAnchorOffsetX?: number;
}) => {
  const resolved = composeNodeTransform({node, parent, progress, frame, fps, events, durationSeconds, seed, cameraX, cameraY, cameraZoom, parallax, worldAnchorOffsetX});
  const cutout = ['character', 'prop'].includes(node.assetRole);
  return (
    <div
      data-composition-node={node.id}
      data-composition-kind="asset"
      style={{
        ...containerStyle({node, resolved, renderZ}),
        filter: [
          cutout ? subjectSurfaceFilter(surface) : null,
          resolved.pathFilter,
        ].filter(Boolean).join(' ') || undefined,
        ...clipStyle({node, boundaries}),
      }}
    >
      <Img
        alt=""
        src={staticFile(node.src)}
        style={{display: 'block', width: '100%', height: resolved.height === undefined ? 'auto' : '100%', objectFit: 'contain'}}
      />
    </div>
  );
};

const StateSequenceView = ({
  node,
  parent,
  boundaries,
  progress,
  frame,
  fps,
  events,
  durationSeconds,
  seed,
  renderZ,
  surface,
  cameraX,
  cameraY,
  cameraZoom,
  parallax,
  worldAnchorOffsetX,
}: {
  node: CompositionStateSequenceNode;
  parent: CoordinateSpace;
  boundaries: CompositionBoundary[];
  progress: number;
  frame: number;
  fps: number;
  events: ProjectEvent[];
  durationSeconds: number;
  seed: number;
  renderZ: number;
  surface: ProjectTheme['surface'];
  cameraX: number;
  cameraY: number;
  cameraZoom: number;
  parallax: NormalizedProjectScene['camera']['parallax'];
  worldAnchorOffsetX?: number;
}) => {
  const resolved = composeNodeTransform({node, parent, progress, frame, fps, events, durationSeconds, seed, cameraX, cameraY, cameraZoom, parallax, worldAnchorOffsetX});
  const layers = resolveSequenceLayers({
    node,
    progress,
    durationSeconds,
    pathDepthVelocity: resolved.pathDepthVelocity,
  });
  const registeredHeight = resolved.height ?? resolved.width * node.registration.canvas.height / node.registration.canvas.width;
  return (
    <div
      data-composition-node={node.id}
      data-composition-kind="state-sequence"
      data-pose-family={node.poseFamilyId}
      data-active-state={layers.at(-1)?.id}
      style={{
        ...containerStyle({node, resolved, renderZ}),
        height: registeredHeight,
        filter: [
          subjectSurfaceFilter(surface),
          resolved.pathFilter,
        ].filter(Boolean).join(' '),
        ...clipStyle({node, boundaries}),
      }}
    >
      {layers.map((layer) => (
        <Img
          key={layer.id}
          alt=""
          src={staticFile(layer.src)}
          data-sequence-state={layer.id}
          style={{
            position: 'absolute',
            inset: 0,
            display: 'block',
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            opacity: layer.opacity,
          }}
        />
      ))}
    </div>
  );
};

const ShapeView = ({
  node,
  parent,
  progress,
  frame,
  fps,
  events,
  durationSeconds,
  seed,
  renderZ,
  cameraX,
  cameraY,
  cameraZoom,
  parallax,
}: {
  node: CompositionShapeNode;
  parent: CoordinateSpace;
  progress: number;
  frame: number;
  fps: number;
  events: ProjectEvent[];
  durationSeconds: number;
  seed: number;
  renderZ: number;
  cameraX: number;
  cameraY: number;
  cameraZoom: number;
  parallax: NormalizedProjectScene['camera']['parallax'];
}) => {
  const resolved = composeNodeTransform({node, parent, progress, frame, fps, events, durationSeconds, seed, cameraX, cameraY, cameraZoom, parallax});
  const isLine = node.shape === 'line';
  return (
    <div
      data-composition-node={node.id}
      data-composition-kind="shape"
      style={{
        ...containerStyle({node, resolved, renderZ}),
        height: isLine ? Math.max(1, node.style.strokeWidth) : resolved.height,
        background: isLine ? node.style.stroke : node.style.fill,
        border: isLine ? undefined : `${node.style.strokeWidth}px solid ${node.style.stroke}`,
        borderRadius: node.shape === 'ellipse' ? '50%' : node.style.radius,
        boxSizing: 'border-box',
      }}
    />
  );
};

const MotifFieldView = ({
  node,
  parent,
  progress,
  frame,
  fps,
  events,
  durationSeconds,
  seed,
  renderZ,
  cameraX,
  cameraY,
  cameraZoom,
  parallax,
  rootNodes,
}: {
  node: CompositionMotifFieldNode;
  parent: CoordinateSpace;
  progress: number;
  frame: number;
  fps: number;
  events: ProjectEvent[];
  durationSeconds: number;
  seed: number;
  renderZ: number;
  cameraX: number;
  cameraY: number;
  cameraZoom: number;
  parallax: NormalizedProjectScene['camera']['parallax'];
  rootNodes: CompositionNode[];
}) => {
  const world = node.worldBinding
    ? rootNodes.find(
        (candidate): candidate is CompositionGroupNode =>
          candidate.kind === 'group' &&
          candidate.pattern === 'looping-environment' &&
          candidate.id === node.worldBinding?.worldNodeId,
      )
    : null;
  const strip = world && node.worldBinding
    ? world.children.find(
        (candidate): candidate is CompositionWorldStripNode =>
          candidate.kind === 'world-strip' &&
          candidate.role === node.worldBinding?.stripRole,
      )
    : null;
  const resolved = composeNodeTransform({
    node,
    parent,
    progress,
    frame,
    fps,
    events,
    durationSeconds,
    seed,
    cameraX: world ? 0 : cameraX,
    cameraY: world ? 0 : cameraY,
    cameraZoom: world ? 1 : cameraZoom,
    parallax: world && parallax
      ? {...parallax, enabled: false}
      : parallax,
  });
  const height = resolved.height ?? resolved.width;
  const size = node.baseSize * resolved.width;
  const instances = resolveMotifFieldInstances(node);
  const worldDisplacementPx = world?.loopingEnvironment && strip
    ? resolveWorldStripFrame({
        progress: world.loopingEnvironment.travel.frozen === true ? 0 : progress,
        viewportWidth: resolved.width,
        tileWidth: resolved.width,
        direction: world.loopingEnvironment.travel.direction,
        distanceViewports: world.loopingEnvironment.travel.distanceViewports,
        speedFactor: resolveWorldStripSpeedFactor({
          depth: strip.depth,
          far: world.loopingEnvironment.speedRange.far,
          near: world.loopingEnvironment.speedRange.near,
        }),
        startPhase: world.loopingEnvironment.travel.startPhase,
        activeFrom: world.loopingEnvironment.travel.activeFrom ?? 0,
        activeUntil: world.loopingEnvironment.travel.activeUntil ?? 1,
        easing: world.loopingEnvironment.travel.easing,
        overscanPx: world.loopingEnvironment.overscanPx,
      }).cameraCompensatedDisplacement
    : 0;
  return (
    <div
      data-composition-node={node.id}
      data-composition-kind="motif-field"
      data-motif-count={instances.length}
      style={{
        ...containerStyle({node, resolved, renderZ}),
        height,
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
    >
      {instances.map((instance) => {
        const field = resolveMotifFieldMotion({
          instance,
          preset: node.fieldMotion.preset,
          progress,
          cycles: node.fieldMotion.cycles,
          horizontalAmplitude: node.worldBinding?.relativeDriftAmplitude,
        });
        const instanceX = node.worldBinding
          ? resolveWorldBoundMotifX({
              instanceX: instance.x,
              localOffsetX: field.x,
              worldDisplacementPx,
              viewportWidth: resolved.width,
              bounds: node.bounds,
            })
          : instance.x;
        return (
          <Img
            key={instance.id}
            alt=""
            src={staticFile(instance.src)}
            data-motif-instance={instance.id}
            style={{
              position: 'absolute',
              left: instanceX * resolved.width,
              top: instance.y * height,
              width: size,
              height: size,
              objectFit: 'contain',
              opacity: instance.opacity * field.opacity,
              transform: `translate(-50%, -50%) translate3d(${node.worldBinding ? 0 : field.x * resolved.width}px, ${field.y * height}px, 0) scale(${instance.scale * field.scale}) rotate(${instance.rotation + field.rotation}deg)`,
              transformOrigin: '50% 50%',
            }}
          />
        );
      })}
    </div>
  );
};

const WorldStripView = ({
  node,
  parent,
  progress,
  frame,
  fps,
  events,
  durationSeconds,
  seed,
  renderZ,
  cameraX,
  cameraY,
  cameraZoom,
  parallax,
  loopingEnvironment,
}: {
  node: CompositionWorldStripNode;
  parent: CoordinateSpace;
  progress: number;
  frame: number;
  fps: number;
  events: ProjectEvent[];
  durationSeconds: number;
  seed: number;
  renderZ: number;
  cameraX: number;
  cameraY: number;
  cameraZoom: number;
  parallax: NormalizedProjectScene['camera']['parallax'];
  loopingEnvironment: NonNullable<CompositionGroupNode['loopingEnvironment']>;
}) => {
  const worldDepth = resolveParallaxState({
    depth: node.depth,
    cameraX,
    cameraY,
    cameraZoom,
    parallax,
  });
  const resolved = composeNodeTransform({
    node,
    parent,
    progress,
    frame,
    fps,
    events,
    durationSeconds,
    seed,
    cameraX: 0,
    cameraY: 0,
    cameraZoom: 1,
    parallax: parallax ? {...parallax, enabled: false} : undefined,
  });
  const containerHeight = resolved.height ?? parent.height;
  const contentScale = Math.max(1, worldDepth.scale);
  const renderHeight = containerHeight * contentScale;
  const geometry = resolveWorldStripTileGeometry({
    viewportWidth: resolved.width,
    viewportHeight: parent.height,
    renderHeight,
    sourceWidth: node.loopingStripBinding.output.width,
    sourceHeight: node.loopingStripBinding.output.height,
    overscanPx: loopingEnvironment.overscanPx,
  });
  const speedFactor = resolveWorldStripSpeedFactor({
    depth: node.depth,
    far: loopingEnvironment.speedRange.far,
    near: loopingEnvironment.speedRange.near,
  });
  const worldIsFrozen = loopingEnvironment.travel.frozen === true;
  const worldIsLocked = worldIsFrozen || (
    loopingEnvironment.travel.activeUntil !== undefined &&
    progress >= loopingEnvironment.travel.activeUntil
  );
  const stripFrame = resolveWorldStripFrame({
    progress: worldIsFrozen ? 0 : progress,
    viewportWidth: resolved.width,
    tileWidth: geometry.tileWidth,
    direction: loopingEnvironment.travel.direction,
    distanceViewports: loopingEnvironment.travel.distanceViewports,
    speedFactor,
    startPhase: loopingEnvironment.travel.startPhase,
    activeFrom: loopingEnvironment.travel.activeFrom ?? 0,
    activeUntil: loopingEnvironment.travel.activeUntil ?? 1,
    easing: loopingEnvironment.travel.easing,
    overscanPx: loopingEnvironment.overscanPx,
    phaseOffsetPx: worldIsLocked ? 0 : worldDepth.x,
  });
  const copies = resolveWorldStripCopies({
    firstCopyX: stripFrame.firstCopyX,
    tileWidth: geometry.tileWidth,
    copyCount: geometry.copyCount,
  });
  return (
    <div
      data-composition-node={node.id}
      data-composition-kind="world-strip"
      data-world-strip-role={node.role}
      data-world-strip-phase={stripFrame.phaseNormalized}
      data-world-strip-speed={speedFactor}
      data-world-strip-wraps={stripFrame.wraps}
      data-world-strip-copies={geometry.copyCount}
      data-world-strip-camera-offset={worldIsLocked ? 0 : worldDepth.x}
      data-world-strip-camera-scale={contentScale}
      style={{
        ...containerStyle({node, resolved, renderZ}),
        height: containerHeight,
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
    >
      {copies.map((copy) => (
        <Img
          key={`${node.id}-tile-${copy.index}`}
          alt=""
          src={staticFile(node.src)}
          data-world-strip-copy={copy.index}
          style={{
            position: 'absolute',
            left: copy.x,
            top: containerHeight - renderHeight,
            width: copy.width,
            height: renderHeight,
            maxWidth: 'none',
            objectFit: 'fill',
          }}
        />
      ))}
    </div>
  );
};

const GroupView = ({
  node,
  parent,
  progress,
  frame,
  fps,
  events,
  durationSeconds,
  seed,
  renderZ,
  surface,
  cameraX,
  cameraY,
  cameraZoom,
  parallax,
  sceneId,
  editorial,
  rootNodes,
  zones,
  worldAnchorOffsetX,
}: {
  node: CompositionGroupNode;
  parent: CoordinateSpace;
  progress: number;
  frame: number;
  fps: number;
  events: ProjectEvent[];
  durationSeconds: number;
  seed: number;
  renderZ: number;
  surface: ProjectTheme['surface'];
  cameraX: number;
  cameraY: number;
  cameraZoom: number;
  parallax: NormalizedProjectScene['camera']['parallax'];
  sceneId: string;
  editorial: EditorialSystem;
  rootNodes: CompositionNode[];
  zones: EditorialSystem['responsiveProfiles'][number]['exclusionZones'];
  worldAnchorOffsetX?: number;
}) => {
  if (node.stackingContext === 'scene') {
    const width = node.transform.width * parent.width;
    const height =
      node.transform.height === undefined
        ? width *
          node.coordinateSpace.height /
          node.coordinateSpace.width
        : node.transform.height * parent.height;
    const left =
      node.transform.x * parent.width -
      node.transform.anchorX * width;
    const top =
      node.transform.y * parent.height -
      node.transform.anchorY * height;
    return (
      <div
        data-composition-node={node.id}
        data-composition-kind={node.pattern}
        data-stacking-context="scene"
        style={{
          position: 'absolute',
          left,
          top,
          width,
          height,
        }}
      >
        {[...node.children]
          .sort((left, right) => left.z - right.z)
          .map((child) => (
            <CompositionNodeView
              key={child.id}
              node={child}
              parent={{width, height}}
              progress={progress}
              frame={frame}
              fps={fps}
              events={events}
              durationSeconds={durationSeconds}
              seed={seed}
              renderZ={child.z}
              surface={surface}
              cameraX={cameraX}
              cameraY={cameraY}
              cameraZoom={cameraZoom}
              parallax={parallax}
              sceneId={sceneId}
              editorial={editorial}
              rootNodes={rootNodes}
              zones={zones}
            />
          ))}
      </div>
    );
  }
  const loopingWorld = node.pattern === 'looping-environment';
  const resolved = composeNodeTransform({
    node,
    parent,
    progress,
    frame,
    fps,
    events,
    durationSeconds,
    seed,
    cameraX: loopingWorld ? 0 : cameraX,
    cameraY: loopingWorld ? 0 : cameraY,
    cameraZoom: loopingWorld ? 1 : cameraZoom,
    parallax:
      loopingWorld && parallax
        ? {...parallax, enabled: false}
        : parallax,
    worldAnchorOffsetX,
  });
  const ratio = node.coordinateSpace.height / node.coordinateSpace.width;
  const height = resolved.height ?? resolved.width * ratio;
  const groundStrip = loopingWorld
    ? node.children.find(
        (child): child is CompositionWorldStripNode =>
          child.kind === 'world-strip' &&
          child.id === node.loopingEnvironment?.groundStripId,
      )
    : null;
  const groundSpeed = groundStrip && node.loopingEnvironment
    ? resolveWorldStripSpeedFactor({
        depth: groundStrip.depth,
        far: node.loopingEnvironment.speedRange.far,
        near: node.loopingEnvironment.speedRange.near,
      })
    : 0;
  const worldSubjectOffsetX = (childId: string) => {
    const binding = node.loopingEnvironment?.subjectBindings.find(
      ({nodeId}) => nodeId === childId,
    );
    if (
      !binding ||
      binding.anchorMode !== 'world' ||
      !node.loopingEnvironment ||
      !groundStrip
    ) {
      return 0;
    }
    return resolveWorldStripFrame({
      progress: node.loopingEnvironment.travel.frozen === true ? 0 : progress,
      viewportWidth: resolved.width,
      tileWidth: resolved.width,
      direction: node.loopingEnvironment.travel.direction,
      distanceViewports: node.loopingEnvironment.travel.distanceViewports,
      speedFactor: groundSpeed,
      startPhase: node.loopingEnvironment.travel.startPhase,
      activeFrom: node.loopingEnvironment.travel.activeFrom ?? 0,
      activeUntil: node.loopingEnvironment.travel.activeUntil ?? 1,
      easing: node.loopingEnvironment.travel.easing,
      overscanPx: node.loopingEnvironment.overscanPx,
    }).cameraCompensatedDisplacement;
  };
  return (
    <div
      data-composition-node={node.id}
      data-composition-kind={node.pattern}
      style={{
        position: 'absolute',
        left: resolved.left,
        top: resolved.top,
        width: resolved.width,
        height,
        zIndex: renderZ,
        opacity: resolved.opacity,
        transform: resolved.css,
        transformOrigin: `${(node.motion.pivot?.x ?? node.transform.anchorX) * 100}% ${(node.motion.pivot?.y ?? node.transform.anchorY) * 100}%`,
      }}
    >
      {[...node.children]
        .sort((left, right) => slotOrder(left, node.support?.layering) - slotOrder(right, node.support?.layering))
        .map((child) => (
          <CompositionNodeView
            key={child.id}
            node={child}
            parent={{width: resolved.width, height}}
            boundaries={node.boundaries ?? []}
            progress={progress}
            frame={frame}
            fps={fps}
            events={events}
            durationSeconds={durationSeconds}
            seed={seed}
            renderZ={['supported-subject', 'registered-depth-stack', 'canonical-container'].includes(node.pattern) ? slotOrder(child, node.support?.layering) : child.z}
            surface={surface}
            cameraX={cameraX}
            cameraY={cameraY}
            cameraZoom={cameraZoom}
            parallax={parallax}
            sceneId={sceneId}
            editorial={editorial}
            rootNodes={rootNodes}
            zones={zones}
            loopingEnvironment={node.loopingEnvironment}
            worldAnchorOffsetX={worldSubjectOffsetX(child.id)}
          />
        ))}
    </div>
  );
};

const CompositionNodeView = ({
  node,
  parent,
  boundaries = [],
  progress,
  frame,
  fps,
  events,
  durationSeconds,
  seed,
  renderZ = node.z,
  surface,
  cameraX,
  cameraY,
  cameraZoom,
  parallax,
  sceneId,
  editorial,
  rootNodes,
  zones,
  loopingEnvironment,
  worldAnchorOffsetX,
}: {
  node: CompositionNode;
  parent: CoordinateSpace;
  boundaries?: CompositionBoundary[];
  progress: number;
  frame: number;
  fps: number;
  events: ProjectEvent[];
  durationSeconds: number;
  seed: number;
  renderZ?: number;
  surface: ProjectTheme['surface'];
  cameraX: number;
  cameraY: number;
  cameraZoom: number;
  parallax: NormalizedProjectScene['camera']['parallax'];
  sceneId: string;
  editorial: EditorialSystem;
  rootNodes: CompositionNode[];
  zones: EditorialSystem['responsiveProfiles'][number]['exclusionZones'];
  loopingEnvironment?: CompositionGroupNode['loopingEnvironment'];
  worldAnchorOffsetX?: number;
}) => {
  if (node.kind === 'group' && node.renderParticipation === 'derivation-only') {
    return null;
  }
  if (node.kind === 'group') return <GroupView {...{node, parent, progress, frame, fps, events, durationSeconds, seed, renderZ, surface, cameraX, cameraY, cameraZoom, parallax, sceneId, editorial, rootNodes, zones, worldAnchorOffsetX}} />;
  if (node.kind === 'asset') return <AssetView {...{node, parent, boundaries, progress, frame, fps, events, durationSeconds, seed, renderZ, surface, cameraX, cameraY, cameraZoom, parallax, worldAnchorOffsetX}} />;
  if (node.kind === 'state-sequence') return <StateSequenceView {...{node, parent, boundaries, progress, frame, fps, events, durationSeconds, seed, renderZ, surface, cameraX, cameraY, cameraZoom, parallax, worldAnchorOffsetX}} />;
  if (node.kind === 'typography') {
    const resolved = composeNodeTransform({node, parent, progress, frame, fps, events, durationSeconds, seed, cameraX, cameraY, cameraZoom, parallax});
    return <TypographyView node={node as CompositionTypographyNode} sceneId={sceneId} frame={frame} editorial={editorial} container={containerStyle({node, resolved, renderZ})} width={resolved.width} height={resolved.height ?? parent.height} />;
  }
  if (node.kind === 'annotation') {
    const resolved = composeNodeTransform({node, parent, progress, frame, fps, events, durationSeconds, seed, cameraX, cameraY, cameraZoom, parallax});
    return <AnnotationView node={node as CompositionAnnotationNode} sceneId={sceneId} frame={frame} editorial={editorial} container={containerStyle({node, resolved, renderZ})} width={resolved.width} height={resolved.height ?? parent.height} nodes={rootNodes} zones={zones} />;
  }
  if (node.kind === 'data-graphic') {
    const resolved = composeNodeTransform({node, parent, progress, frame, fps, events, durationSeconds, seed, cameraX, cameraY, cameraZoom, parallax});
    return <DataGraphicView node={node as CompositionDataGraphicNode} sceneId={sceneId} frame={frame} editorial={editorial} container={containerStyle({node, resolved, renderZ})} width={resolved.width} height={resolved.height ?? resolved.width} />;
  }
  if (node.kind === 'editorial-switch') {
    const switchNode = node as CompositionEditorialSwitchNode;
    const resolved = composeNodeTransform({node, parent, progress, frame, fps, events, durationSeconds, seed, cameraX, cameraY, cameraZoom, parallax});
    const switchHeight = resolved.height ?? resolved.width;
    return (
      <EditorialSwitchView
        node={switchNode}
        sceneId={sceneId}
        frame={frame}
        editorial={editorial}
        container={containerStyle({node, resolved, renderZ})}
        width={resolved.width}
        height={switchHeight}
        renderPanel={(panel) => (
          <CompositionNodeView
            node={panel}
            parent={{width: resolved.width, height: switchHeight}}
            progress={progress}
            frame={frame}
            fps={fps}
            events={events}
            durationSeconds={durationSeconds}
            seed={seed}
            surface={surface}
            cameraX={0}
            cameraY={0}
            cameraZoom={1}
            parallax={{enabled: false, strength: 0, focalDepth: 0}}
            sceneId={sceneId}
            editorial={editorial}
            rootNodes={rootNodes}
            zones={zones}
          />
        )}
      />
    );
  }
  if (node.kind === 'motif-field') return <MotifFieldView {...{node, parent, progress, frame, fps, events, durationSeconds, seed, renderZ, cameraX, cameraY, cameraZoom, parallax, rootNodes}} />;
  if (node.kind === 'world-strip') {
    if (!loopingEnvironment) return null;
    return <WorldStripView {...{node, parent, progress, frame, fps, events, durationSeconds, seed, renderZ, cameraX, cameraY, cameraZoom, parallax, loopingEnvironment}} />;
  }
  return <ShapeView {...{node, parent, progress, frame, fps, events, durationSeconds, seed, renderZ, cameraX, cameraY, cameraZoom, parallax}} />;
};

const ChapterLabel = ({eyebrow, label, theme, variant = 'plain'}: Pick<NormalizedProjectScene, 'eyebrow' | 'label'> & {theme: ProjectTheme; variant?: 'plain' | 'paper-tab'}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const scale = Math.min(width / 1920, height / 1080);
  const enter = spring({frame, fps, config: {damping: 20, stiffness: 90}});
  const opacity = interpolate(frame, [0, Math.round(0.4 * fps), Math.round(3 * fps), Math.round(3.93 * fps)], [0, 1, 1, 0], clamp);
  return (
    <div style={{position: 'absolute', zIndex: 70, top: 62 * scale, left: 76 * scale, opacity, transform: `translateX(${(1 - enter) * -42}px) rotate(-0.6deg)`, color: theme.ink, padding: variant === 'paper-tab' ? `${18 * scale}px ${28 * scale}px ${20 * scale}px` : 0, background: variant === 'paper-tab' ? 'rgba(247,241,228,.94)' : undefined, border: variant === 'paper-tab' ? `2px solid ${theme.surface.subjectEdge.mode === 'paper-outline' ? theme.surface.subjectEdge.color : theme.accent}` : undefined, boxShadow: variant === 'paper-tab' ? '0 8px 22px rgba(28,22,15,.24), 0 2px 0 rgba(255,255,255,.65) inset' : undefined, fontFamily: theme.fontFile ? 'PaperCollageProjectFont, serif' : (theme.fontFamily ?? 'STKaiti, KaiTi, "Noto Serif SC", serif')}}>
      <div style={{fontSize: 24 * scale, fontWeight: 700, letterSpacing: 7 * scale, color: variant === 'paper-tab' ? '#7A5B18' : theme.accent, textShadow: variant === 'paper-tab' ? '0 1px 0 rgba(255,255,255,.8)' : undefined}}>{eyebrow}</div>
      <div style={{marginTop: 8 * scale, fontSize: 56 * scale, fontWeight: 800, letterSpacing: 6 * scale, textShadow: variant === 'paper-tab' ? '0 1px 0 rgba(255,255,255,.8)' : undefined}}>{label}</div>
      <div style={{width: 290 * scale * enter, height: 5 * scale, marginTop: 12 * scale, background: `linear-gradient(90deg, ${theme.accent}, transparent)`}} />
    </div>
  );
};

const EventSounds = ({events, durationInFrames}: {events: ProjectEvent[]; durationInFrames: number}) => (
  <>
    {events.map((event) => {
      if (!event.sound) return null;
      const from = Math.min(durationInFrames - 1, Math.round(event.at * durationInFrames));
      return <Sequence key={`event-sound-${event.id}`} from={from} layout="none"><Audio src={staticFile(event.sound.src)} volume={event.sound.volume} /></Sequence>;
    })}
  </>
);

const cameraDefaults = (preset: NormalizedProjectScene['camera']['preset'], intensity: number) => {
  const perceptibleIntensity = Math.max(0.6, intensity);
  switch (preset) {
    case 'pull': return [{at: 0, x: -10 * perceptibleIntensity, y: 0, zoom: 1.035}, {at: 1, x: 12 * perceptibleIntensity, y: 0, zoom: 1.01}];
    case 'pan-left': return [{at: 0, x: 24 * perceptibleIntensity, y: 0, zoom: 1.018}, {at: 1, x: -24 * perceptibleIntensity, y: 0, zoom: 1.022}];
    case 'pan-right': return [{at: 0, x: -24 * perceptibleIntensity, y: 0, zoom: 1.018}, {at: 1, x: 24 * perceptibleIntensity, y: 0, zoom: 1.022}];
    case 'static': return [{at: 0, x: 0, y: 0, zoom: 1.01}, {at: 1, x: 0, y: 0, zoom: 1.01}];
    default: return [{at: 0, x: -10 * perceptibleIntensity, y: 0, zoom: 1.01}, {at: 1, x: 18 * perceptibleIntensity, y: 0, zoom: 1.028}];
  }
};

const cameraValue = ({frame, durationInFrames, keyframes, property, fallback}: {frame: number; durationInFrames: number; keyframes: Array<{at: number; x?: number; y?: number; zoom?: number}>; property: 'x' | 'y' | 'zoom'; fallback: number}) =>
  interpolate(frame, keyframes.map(({at}) => at * durationInFrames), keyframes.map((keyframe) => keyframe[property] ?? fallback), clamp);

export const ReplicaChapterScene = ({scene, narrationVolume, theme, editorial}: {scene: NormalizedProjectScene; narrationVolume: number; theme: ProjectTheme; editorial: EditorialSystem}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const progress = Math.max(0, Math.min(1, frame / Math.max(1, scene.durationInFrames - 1)));
  const durationSeconds = scene.durationInFrames / fps;
  const cameraFrames = scene.camera.keyframes && scene.camera.keyframes.length >= 2 ? [...scene.camera.keyframes].sort((a, b) => a.at - b.at) : cameraDefaults(scene.camera.preset, scene.camera.intensity);
  const followedCamera = resolveCameraFollowAtFrame({
    scene,
    video: {width, height},
    frame,
    fps,
  });
  const cameraZoom = followedCamera?.zoom ?? cameraValue({frame, durationInFrames: scene.durationInFrames, keyframes: cameraFrames, property: 'zoom', fallback: 1});
  const cameraX = followedCamera?.x ?? cameraValue({frame, durationInFrames: scene.durationInFrames, keyframes: cameraFrames, property: 'x', fallback: 0});
  const cameraY = followedCamera?.y ?? cameraValue({frame, durationInFrames: scene.durationInFrames, keyframes: cameraFrames, property: 'y', fallback: 0});
  const boundary = resolveSceneTransitionPresentation({transition: scene.enterTransition, frame});
  const surfaceTexture = scene.appearance?.surfaceTexture ?? (
    theme.surface.texture
      ? {
          visible: true,
          opacity: theme.surface.texture.opacity,
          blendMode: theme.surface.texture.blendMode,
        }
      : {visible: false, opacity: 0, blendMode: 'normal' as const}
  );
  const profile = editorial.responsiveProfiles.find(({id}) => id === editorial.activeProfile);
  const zones = profile?.exclusionZones ?? [];
  const sceneDirecting = editorial.sceneDirecting?.find(
    (entry) => (entry as {sceneId?: string}).sceneId === scene.id,
  );
  const subtitlePlacement = (sceneDirecting as {
    subtitlePlacement?: EditorialSubtitlePlacement;
  } | undefined)?.subtitlePlacement;
  return (
    <AbsoluteFill style={{overflow: 'hidden', visibility: boundary.incomingVisible ? 'visible' : 'hidden', clipPath: boundary.incomingClipPath, transform: boundary.incomingTransform, transformOrigin: boundary.incomingTransformOrigin, background: theme.canvas, willChange: 'transform, clip-path'}}>
      <AbsoluteFill style={{background: scene.appearance?.background ?? theme.sceneBackground}} />
      <AbsoluteFill>
        <AbsoluteFill style={{transform: `translate3d(${cameraX}px, ${cameraY}px, 0) scale(${cameraZoom})`, transformOrigin: '50% 54%'}}>
          {[...scene.composition.nodes].sort((a, b) => a.z - b.z).map((node) => (
            <CompositionNodeView key={node.id} node={node} parent={scene.composition.coordinateSpace} progress={progress} frame={frame} fps={fps} events={scene.events} durationSeconds={durationSeconds} seed={scene.motion.seed} surface={theme.surface} cameraX={cameraX} cameraY={cameraY} cameraZoom={cameraZoom} parallax={scene.camera.parallax} sceneId={scene.id} editorial={editorial} rootNodes={scene.composition.nodes} zones={zones} />
          ))}
        </AbsoluteFill>
        {surfaceTexture.visible && theme.surface.texture ? <AbsoluteFill style={{opacity: surfaceTexture.opacity, mixBlendMode: surfaceTexture.blendMode, backgroundImage: `url(${staticFile(theme.surface.texture.src)})`, backgroundSize: 'cover', zIndex: 60, pointerEvents: 'none'}} /> : null}
      </AbsoluteFill>
      {scene.appearance?.chapter?.visible === false ? null : <ChapterLabel eyebrow={scene.eyebrow} label={scene.label} theme={theme} variant={scene.appearance?.chapter?.variant} />}
      <SubtitleOverlay cues={scene.subtitles} theme={theme} appearance={scene.appearance?.subtitles} safeArea={profile?.safeArea} placement={subtitlePlacement} />
      <Sequence from={scene.narrationStartFrame} layout="none"><Audio src={staticFile(scene.narration.src)} volume={narrationVolume} /></Sequence>
      <EventSounds events={scene.events} durationInFrames={scene.durationInFrames} />
    </AbsoluteFill>
  );
};
