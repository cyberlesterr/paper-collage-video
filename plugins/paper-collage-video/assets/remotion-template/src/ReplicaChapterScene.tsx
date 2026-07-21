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
  CompositionAssetNode,
  CompositionBoundary,
  CompositionGroupNode,
  CompositionNode,
  CoordinateSpace,
  NormalizedProjectScene,
  NormalizedSubtitleCue,
  ProjectCue,
  ProjectTheme,
} from './project';
import {resolveCueState, resolveIdleState, resolveMotionState} from './motion';

const clamp = {
  extrapolateLeft: 'clamp',
  extrapolateRight: 'clamp',
} as const;

const phaseFor = (id: string, seed: number) => {
  let value = seed >>> 0;
  for (const character of id) value = Math.imul(value ^ character.charCodeAt(0), 16777619);
  return (value >>> 0) / 0xffffffff * Math.PI * 2;
};

const slotOrder = (node: CompositionNode) => {
  if (node.kind !== 'asset') return node.z;
  const fixed = {
    'support-rear': -30,
    'contact-shadow': -20,
    subject: -10,
    'support-front': 0,
  } as Record<string, number>;
  return fixed[node.slot ?? ''] ?? node.z;
};

const composeNodeTransform = ({
  node,
  parent,
  progress,
  frame,
  fps,
  cues,
  durationSeconds,
  seed,
}: {
  node: CompositionNode;
  parent: CoordinateSpace;
  progress: number;
  frame: number;
  fps: number;
  cues: ProjectCue[];
  durationSeconds: number;
  seed: number;
}) => {
  const authored = resolveMotionState(node.motion.keyframes, progress);
  const idle = resolveIdleState({
    idle: node.motion.idle,
    frame,
    fps,
    phase: phaseFor(node.id, seed),
  });
  const cue = resolveCueState({cues, targetId: node.id, progress, durationSeconds});
  const transform = node.transform;
  const width = transform.width * parent.width;
  const height = transform.height === undefined ? undefined : transform.height * parent.height;
  return {
    left: transform.x * parent.width,
    top: transform.y * parent.height,
    width,
    height,
    opacity: (transform.opacity ?? 1) * authored.opacity * idle.opacity * cue.opacity,
    css: `translate(${-transform.anchorX * 100}%, ${-transform.anchorY * 100}%) translate3d(${(authored.x + idle.x + cue.x) * parent.width}px, ${(authored.y + idle.y + cue.y) * parent.height}px, 0) scale(${(transform.scale ?? 1) * authored.scale * idle.scale * cue.scale}) rotate(${(transform.rotation ?? 0) + authored.rotation + idle.rotation + cue.rotation}deg)`,
  };
};

const clipStyle = ({
  node,
  boundaries,
}: {
  node: CompositionAssetNode;
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

const AssetView = ({
  node,
  parent,
  boundaries,
  progress,
  frame,
  fps,
  cues,
  durationSeconds,
  seed,
  renderZ,
  paperEdge,
}: {
  node: CompositionAssetNode;
  parent: CoordinateSpace;
  boundaries: CompositionBoundary[];
  progress: number;
  frame: number;
  fps: number;
  cues: ProjectCue[];
  durationSeconds: number;
  seed: number;
  renderZ: number;
  paperEdge: string;
}) => {
  const resolved = composeNodeTransform({node, parent, progress, frame, fps, cues, durationSeconds, seed});
  const cutout = ['character', 'prop'].includes(node.assetRole) || node.slot?.startsWith('support');
  return (
    <div
      data-composition-node={node.id}
      data-composition-kind="asset"
      style={{
        position: 'absolute',
        left: resolved.left,
        top: resolved.top,
        width: resolved.width,
        ...(resolved.height === undefined ? {} : {height: resolved.height}),
        zIndex: renderZ,
        opacity: resolved.opacity,
        transform: resolved.css,
        transformOrigin: `${node.transform.anchorX * 100}% ${node.transform.anchorY * 100}%`,
        filter: cutout
          ? `drop-shadow(3px 0 ${paperEdge}) drop-shadow(-3px 0 ${paperEdge}) drop-shadow(0 10px 7px rgba(20,15,12,.28))`
          : undefined,
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

const GroupView = ({
  node,
  parent,
  progress,
  frame,
  fps,
  cues,
  durationSeconds,
  seed,
  renderZ,
  paperEdge,
}: {
  node: CompositionGroupNode;
  parent: CoordinateSpace;
  progress: number;
  frame: number;
  fps: number;
  cues: ProjectCue[];
  durationSeconds: number;
  seed: number;
  renderZ: number;
  paperEdge: string;
}) => {
  const resolved = composeNodeTransform({node, parent, progress, frame, fps, cues, durationSeconds, seed});
  const ratio = node.coordinateSpace.height / node.coordinateSpace.width;
  const height = resolved.height ?? resolved.width * ratio;
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
        transformOrigin: `${node.transform.anchorX * 100}% ${node.transform.anchorY * 100}%`,
      }}
    >
      {[...node.children]
        .sort((left, right) => slotOrder(left) - slotOrder(right))
        .map((child) => (
          <CompositionNodeView
            key={child.id}
            node={child}
            parent={{width: resolved.width, height}}
            boundaries={node.boundaries ?? []}
            progress={progress}
            frame={frame}
            fps={fps}
            cues={cues}
            durationSeconds={durationSeconds}
            seed={seed}
            renderZ={node.pattern === 'supported-subject' ? slotOrder(child) : child.z}
            paperEdge={paperEdge}
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
  cues,
  durationSeconds,
  seed,
  renderZ = node.z,
  paperEdge,
}: {
  node: CompositionNode;
  parent: CoordinateSpace;
  boundaries?: CompositionBoundary[];
  progress: number;
  frame: number;
  fps: number;
  cues: ProjectCue[];
  durationSeconds: number;
  seed: number;
  renderZ?: number;
  paperEdge: string;
}) =>
  node.kind === 'group' ? (
    <GroupView {...{node, parent, progress, frame, fps, cues, durationSeconds, seed, renderZ, paperEdge}} />
  ) : (
    <AssetView {...{node, parent, boundaries, progress, frame, fps, cues, durationSeconds, seed, renderZ, paperEdge}} />
  );

const Subtitle = ({cues, theme}: {cues: NormalizedSubtitleCue[]; theme: ProjectTheme}) => {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();
  const scale = Math.min(width / 1920, height / 1080);
  const cue = cues.find(({from, to}) => frame >= from && frame < to);
  if (!cue) return null;
  const opacity = interpolate(frame, [cue.from, cue.from + 6, cue.to - 6, cue.to], [0, 1, 1, 0], clamp);
  return (
    <div style={{position: 'absolute', zIndex: 100, left: 210 * scale, right: 210 * scale, bottom: 58 * scale, textAlign: 'center', opacity, color: theme.subtitle, fontFamily: theme.fontFile ? 'PaperCollageProjectFont, serif' : (theme.fontFamily ?? 'STKaiti, KaiTi, "Noto Serif SC", serif'), fontWeight: 700, fontSize: 42 * scale, letterSpacing: 2 * scale, lineHeight: 1.35, textShadow: '0 3px 2px rgba(28,15,10,.9), 0 0 14px rgba(28,15,10,.78)'}}>
      <span style={{display: 'inline-block', padding: `${12 * scale}px ${32 * scale}px ${14 * scale}px`, background: theme.subtitleBackground, border: '1px solid rgba(244, 222, 174, .42)', boxShadow: '0 8px 24px rgba(40, 16, 10, .22)'}}>{cue.text}</span>
    </div>
  );
};

const ChapterLabel = ({eyebrow, label, theme}: Pick<NormalizedProjectScene, 'eyebrow' | 'label'> & {theme: ProjectTheme}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const scale = Math.min(width / 1920, height / 1080);
  const enter = spring({frame, fps, config: {damping: 20, stiffness: 90}});
  const opacity = interpolate(frame, [0, Math.round(0.4 * fps), Math.round(3 * fps), Math.round(3.93 * fps)], [0, 1, 1, 0], clamp);
  return (
    <div style={{position: 'absolute', zIndex: 70, top: 72 * scale, left: 92 * scale, opacity, transform: `translateX(${(1 - enter) * -42}px)`, color: theme.ink, fontFamily: theme.fontFile ? 'PaperCollageProjectFont, serif' : (theme.fontFamily ?? 'STKaiti, KaiTi, "Noto Serif SC", serif')}}>
      <div style={{fontSize: 22 * scale, letterSpacing: 8 * scale, color: theme.accent}}>{eyebrow}</div>
      <div style={{marginTop: 10 * scale, fontSize: 51 * scale, fontWeight: 700, letterSpacing: 7 * scale}}>{label}</div>
      <div style={{width: 270 * scale * enter, height: 4 * scale, marginTop: 13 * scale, background: `linear-gradient(90deg, ${theme.accent}, transparent)`}} />
    </div>
  );
};

const CueSounds = ({cues, durationInFrames}: {cues: ProjectCue[]; durationInFrames: number}) => (
  <>
    {cues.map((cue) => {
      if (!cue.sound) return null;
      const from = Math.min(durationInFrames - 1, Math.round(cue.at * durationInFrames));
      return <Sequence key={`cue-sound-${cue.id}`} from={from} layout="none"><Audio src={staticFile(cue.sound.src)} volume={cue.sound.volume} /></Sequence>;
    })}
  </>
);

const cameraDefaults = (preset: NormalizedProjectScene['camera']['preset'], intensity: number) => {
  switch (preset) {
    case 'pull': return [{at: 0, x: -4, y: 0, zoom: 1.03}, {at: 1, x: 5, y: 0, zoom: 1.01}];
    case 'pan-left': return [{at: 0, x: 10 * intensity, y: 0, zoom: 1.018}, {at: 1, x: -10 * intensity, y: 0, zoom: 1.022}];
    case 'pan-right': return [{at: 0, x: -10 * intensity, y: 0, zoom: 1.018}, {at: 1, x: 10 * intensity, y: 0, zoom: 1.022}];
    case 'static': return [{at: 0, x: 0, y: 0, zoom: 1.01}, {at: 1, x: 0, y: 0, zoom: 1.01}];
    default: return [{at: 0, x: -6 * intensity, y: 0, zoom: 1.01}, {at: 1, x: 9 * intensity, y: 0, zoom: 1.026}];
  }
};

const cameraValue = ({frame, durationInFrames, keyframes, property, fallback}: {frame: number; durationInFrames: number; keyframes: Array<{at: number; x?: number; y?: number; zoom?: number}>; property: 'x' | 'y' | 'zoom'; fallback: number}) =>
  interpolate(frame, keyframes.map(({at}) => at * durationInFrames), keyframes.map((keyframe) => keyframe[property] ?? fallback), clamp);

export const ReplicaChapterScene = ({scene, narrationVolume, theme}: {scene: NormalizedProjectScene; narrationVolume: number; theme: ProjectTheme}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const progress = Math.max(0, Math.min(1, frame / Math.max(1, scene.durationInFrames - 1)));
  const durationSeconds = scene.durationInFrames / fps;
  const sceneCue = resolveCueState({cues: scene.cues, targetId: 'scene', progress, durationSeconds});
  const cameraFrames = scene.camera.keyframes && scene.camera.keyframes.length >= 2 ? [...scene.camera.keyframes].sort((a, b) => a.at - b.at) : cameraDefaults(scene.camera.preset, scene.camera.intensity);
  const cameraZoom = cameraValue({frame, durationInFrames: scene.durationInFrames, keyframes: cameraFrames, property: 'zoom', fallback: 1});
  const cameraX = cameraValue({frame, durationInFrames: scene.durationInFrames, keyframes: cameraFrames, property: 'x', fallback: 0});
  const cameraY = cameraValue({frame, durationInFrames: scene.durationInFrames, keyframes: cameraFrames, property: 'y', fallback: 0});
  const fadeFrames = scene.transitionFrames;
  const fadeIn = fadeFrames === 0 ? 1 : interpolate(frame, [0, fadeFrames], [0, 1], clamp);
  const fadeOut = fadeFrames === 0 ? 1 : interpolate(frame, [scene.durationInFrames - fadeFrames, scene.durationInFrames], [1, 0], clamp);
  return (
    <AbsoluteFill style={{overflow: 'hidden', opacity: Math.min(fadeIn, fadeOut), background: theme.sceneBackground}}>
      <AbsoluteFill style={{transform: `translate3d(${sceneCue.x * scene.composition.coordinateSpace.width}px, ${sceneCue.y * scene.composition.coordinateSpace.height}px, 0) scale(${sceneCue.scale}) rotate(${sceneCue.rotation}deg)`, opacity: sceneCue.opacity, transformOrigin: '50% 54%'}}>
        <AbsoluteFill style={{transform: `translate3d(${cameraX}px, ${cameraY}px, 0) scale(${cameraZoom})`, transformOrigin: '50% 54%'}}>
          {[...scene.composition.nodes].sort((a, b) => a.z - b.z).map((node) => (
            <CompositionNodeView key={node.id} node={node} parent={scene.composition.coordinateSpace} progress={progress} frame={frame} fps={fps} cues={scene.cues} durationSeconds={durationSeconds} seed={scene.motion.seed} paperEdge={theme.paperEdge} />
          ))}
        </AbsoluteFill>
        <AbsoluteFill style={{opacity: 0.14, mixBlendMode: 'multiply', backgroundImage: `url(${staticFile(theme.texture)})`, backgroundSize: 'cover', zIndex: 60, pointerEvents: 'none'}} />
      </AbsoluteFill>
      <ChapterLabel eyebrow={scene.eyebrow} label={scene.label} theme={theme} />
      <Subtitle cues={scene.subtitles} theme={theme} />
      <Sequence from={scene.narrationStartFrame} layout="none"><Audio src={staticFile(scene.narration.src)} volume={narrationVolume} /></Sequence>
      <CueSounds cues={scene.cues} durationInFrames={scene.durationInFrames} />
    </AbsoluteFill>
  );
};
