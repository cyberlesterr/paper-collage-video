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
  CharacterLayer,
  EnvironmentLayer,
  NormalizedProjectScene,
  ProjectSound,
  ProjectAudioEvent,
  ProjectTheme,
  NormalizedSubtitleCue,
} from './project';
import {roleMotion, type Role} from './roleMotion';

const clamp = {
  extrapolateLeft: 'clamp',
  extrapolateRight: 'clamp',
} as const;

const backgroundStyle: CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
};

const Character = ({
  layer,
  paperEdge,
}: {
  layer: CharacterLayer;
  paperEdge: string;
}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const landscape = width / height >= 1;
  const layoutScale = Math.min(
    width / (landscape ? 1920 : 1080),
    height / (landscape ? 1080 : 1920),
  );
  const motion = roleMotion[layer.role];
  const layerMotion = layer.motion;
  const delay = Math.round(layer.delaySeconds * fps);
  const entrance = spring({
    fps,
    frame: frame - delay,
    config: {
      damping: layer.role === 'primary' ? 14 : 18,
      mass: layer.role === 'primary' ? 0.85 : 0.7,
      stiffness: layer.role === 'primary' ? 105 : 120,
    },
    durationInFrames: Math.max(
      1,
      Math.round(layerMotion.enterDurationSeconds * fps),
    ),
  });
  const direction = layer.enterFrom === 'left' ? -1 : 1;
  const xOffset =
    layer.enterFrom === 'bottom'
      ? 0
      : (1 - entrance) * motion.distance * direction;
  const elapsed = Math.max(0, frame - delay);
  const cycleFrames = Math.max(1, layerMotion.cycleSeconds * fps);
  const wave = Math.sin(
    (elapsed / cycleFrames) * Math.PI * 2 + (layerMotion.phase ?? layer.z * 0.7),
  );
  const intensity = layerMotion.intensity;
  const idle = layerMotion.idle;
  const idleX =
    idle === 'grind'
      ? wave * 11 * intensity * layoutScale
      : idle === 'drift'
        ? wave * 5 * intensity * layoutScale
        : 0;
  const idleY =
    idle === 'float'
      ? wave * (layer.role === 'primary' ? 2.2 : 1.4) * intensity * layoutScale
      : idle === 'drift'
        ? Math.cos((elapsed / cycleFrames) * Math.PI * 2) * 2.5 * intensity * layoutScale
        : 0;
  const idleScale = idle === 'breathe' ? 1 + wave * 0.008 * intensity : 1;
  const idleRotation = idle === 'grind' ? wave * 0.55 * intensity : 0;
  const yOffset = (1 - entrance) * motion.rise * layoutScale + idleY;
  const scale =
    (motion.startScale + (1 - motion.startScale) * entrance) * idleScale;
  const cutoutFilter = `
    drop-shadow(4px 0 ${paperEdge})
    drop-shadow(-4px 0 ${paperEdge})
    drop-shadow(0 4px ${paperEdge})
    drop-shadow(0 18px 9px rgba(20,15,12,.32))
  `;

  return (
    <div
      style={{
        position: 'absolute',
        left: layer.x,
        bottom: layer.bottom,
        width: layer.width,
        zIndex: layer.z,
        opacity: entrance,
        transform: `translate3d(${xOffset * layoutScale + idleX}px, ${yOffset}px, 0) scale(${scale}) rotate(${idleRotation}deg)`,
        transformOrigin: '50% 100%',
        filter: cutoutFilter,
      }}
    >
      <Img alt="" src={staticFile(layer.src)} style={{display: 'block', width: '100%'}} />
    </div>
  );
};

const Subtitle = ({
  cues,
  theme,
}: {
  cues: NormalizedSubtitleCue[];
  theme: ProjectTheme;
}) => {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();
  const landscape = width / height >= 1;
  const layoutScale = Math.min(
    width / (landscape ? 1920 : 1080),
    height / (landscape ? 1080 : 1920),
  );
  const cue = cues.find(({from, to}) => frame >= from && frame < to);
  if (!cue) return null;

  const opacity = interpolate(
    frame,
    [cue.from, cue.from + 6, cue.to - 6, cue.to],
    [0, 1, 1, 0],
    clamp,
  );

  return (
    <div
      style={{
        position: 'absolute',
        zIndex: 100,
        left: (landscape ? 210 : 72) * layoutScale,
        right: (landscape ? 210 : 72) * layoutScale,
        bottom: (landscape ? 58 : 140) * layoutScale,
        textAlign: 'center',
        opacity,
        color: theme.subtitle,
        fontFamily: theme.fontFile
          ? 'PaperCollageProjectFont, serif'
          : (theme.fontFamily ??
            'STKaiti, KaiTi, "Noto Serif SC", serif'),
        fontWeight: 700,
        fontSize: 42 * layoutScale,
        letterSpacing: 2 * layoutScale,
        lineHeight: 1.35,
        textShadow:
          '0 3px 2px rgba(28,15,10,.9), 0 0 14px rgba(28,15,10,.78)',
      }}
    >
      <span
        style={{
          display: 'inline-block',
          padding: `${12 * layoutScale}px ${32 * layoutScale}px ${14 * layoutScale}px`,
          background: theme.subtitleBackground,
          border: '1px solid rgba(244, 222, 174, .42)',
          boxShadow: '0 8px 24px rgba(40, 16, 10, .22)',
        }}
      >
        {cue.text}
      </span>
    </div>
  );
};

const ChapterLabel = ({
  eyebrow,
  label,
  theme,
}: Pick<NormalizedProjectScene, 'eyebrow' | 'label'> & {
  theme: ProjectTheme;
}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const landscape = width / height >= 1;
  const layoutScale = Math.min(
    width / (landscape ? 1920 : 1080),
    height / (landscape ? 1080 : 1920),
  );
  const enter = spring({
    frame,
    fps,
    config: {damping: 20, stiffness: 90},
  });
  const opacity = interpolate(
    frame,
    [0, Math.round(0.4 * fps), Math.round(3 * fps), Math.round(3.93 * fps)],
    [0, 1, 1, 0],
    clamp,
  );

  return (
    <div
      style={{
        position: 'absolute',
        zIndex: 70,
        top: (landscape ? 72 : 104) * layoutScale,
        left: (landscape ? 92 : 64) * layoutScale,
        opacity,
        transform: `translateX(${(1 - enter) * -42}px)`,
        color: theme.ink,
        fontFamily: theme.fontFile
          ? 'PaperCollageProjectFont, serif'
          : (theme.fontFamily ??
            'STKaiti, KaiTi, "Noto Serif SC", serif'),
      }}
    >
      <div
        style={{
          fontSize: 22 * layoutScale,
          letterSpacing: 8 * layoutScale,
          color: theme.accent,
        }}
      >
        {eyebrow}
      </div>
      <div
        style={{
          marginTop: 10 * layoutScale,
          fontSize: (landscape ? 51 : 44) * layoutScale,
          fontWeight: 700,
          letterSpacing: 7 * layoutScale,
        }}
      >
        {label}
      </div>
      <div
        style={{
          width: 270 * layoutScale * enter,
          height: 4 * layoutScale,
          marginTop: 13 * layoutScale,
          background: `linear-gradient(90deg, ${theme.accent}, transparent)`,
        }}
      />
    </div>
  );
};

const ForegroundPaper = ({color}: {color: string}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const landscape = width / height >= 1;
  const layoutScale = Math.min(
    width / (landscape ? 1920 : 1080),
    height / (landscape ? 1080 : 1920),
  );
  const drift = Math.sin(frame / Math.max(1, fps * 1.53)) * 5 * layoutScale;
  return (
    <>
      <div
        style={{
          position: 'absolute',
          zIndex: 9,
          left: -70 * layoutScale + drift,
          right: -70 * layoutScale - drift,
          bottom: -45 * layoutScale,
          height: 150 * layoutScale,
          background: `linear-gradient(90deg, ${color}, color-mix(in srgb, ${color}, #d65a3d 36%) 44%, ${color})`,
          clipPath:
            'polygon(0 23%, 9% 10%, 18% 24%, 29% 7%, 42% 20%, 53% 4%, 64% 21%, 76% 8%, 89% 24%, 100% 10%, 100% 100%, 0 100%)',
          opacity: 0.88,
          filter: 'drop-shadow(0 -12px 12px rgba(48,23,18,.22))',
        }}
      />
      <div
        style={{
          position: 'absolute',
          zIndex: 10,
          right: 84 * layoutScale + drift * 1.5,
          bottom: 88 * layoutScale,
          width: 120 * layoutScale,
          height: 42 * layoutScale,
          background: 'rgba(231, 214, 171, .55)',
          transform: 'rotate(-11deg)',
          boxShadow: '0 5px 9px rgba(44,24,15,.16)',
        }}
      />
    </>
  );
};

const EnvironmentCutout = ({
  layer,
  cameraX,
  cameraY,
  cameraZoom,
}: {
  layer: EnvironmentLayer;
  cameraX: number;
  cameraY: number;
  cameraZoom: number;
}) => {
  const depthStrength = Math.max(-1, Math.min(1, layer.depth));
  const parallax = 1 + depthStrength;
  const style: CSSProperties = layer.width
    ? {
        position: 'absolute',
        left: layer.x ?? 0,
        top: layer.y ?? 0,
        width: layer.width,
      }
    : {
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        objectFit: 'cover',
      };
  return (
    <Img
      alt=""
      src={staticFile(layer.src)}
      style={{
        ...style,
        zIndex: layer.z,
        opacity: layer.opacity ?? 1,
        transform: `translate3d(${cameraX * parallax}px, ${cameraY * parallax}px, 0) scale(${1 + (cameraZoom - 1) * (1 + depthStrength * 0.4)})`,
        transformOrigin: '50% 54%',
      }}
    />
  );
};

const RoleSounds = ({
  layers,
  roleSounds,
}: {
  layers: CharacterLayer[];
  roleSounds: Partial<Record<Role, ProjectSound>>;
}) => {
  const {fps} = useVideoConfig();
  return (
    <>
      {layers.map((layer) => {
        const sound = roleSounds[layer.role];
        if (!sound) return null;
        const from = Math.round(layer.delaySeconds * fps);
        return (
          <Sequence key={`sound-${layer.id}`} from={from} layout="none">
            <Audio src={staticFile(sound.src)} volume={sound.volume} />
          </Sequence>
        );
      })}
    </>
  );
};

const AudioEvents = ({events}: {events: ProjectAudioEvent[]}) => {
  const {fps} = useVideoConfig();
  return (
    <>
      {events.map((event) => {
        const from = Math.round(event.atSeconds * fps);
        return (
          <Sequence key={event.id} from={from} layout="none">
            <Audio src={staticFile(event.src)} volume={event.volume} />
          </Sequence>
        );
      })}
    </>
  );
};

const cameraDefaults = (
  preset: NormalizedProjectScene['camera']['preset'],
  intensity: number,
) => {
  switch (preset) {
    case 'pull':
      return [
        {at: 0, x: -4, y: 0, zoom: 1.03},
        {at: 1, x: 5, y: 0, zoom: 1.01},
      ];
    case 'pan-left':
      return [
        {at: 0, x: 10 * intensity, y: 0, zoom: 1.018},
        {at: 1, x: -10 * intensity, y: 0, zoom: 1.022},
      ];
    case 'pan-right':
      return [
        {at: 0, x: -10 * intensity, y: 0, zoom: 1.018},
        {at: 1, x: 10 * intensity, y: 0, zoom: 1.022},
      ];
    case 'static':
      return [
        {at: 0, x: 0, y: 0, zoom: 1.01},
        {at: 1, x: 0, y: 0, zoom: 1.01},
      ];
    case 'push':
    default:
      return [
        {at: 0, x: -6 * intensity, y: 0, zoom: 1.01},
        {at: 1, x: 9 * intensity, y: 0, zoom: 1.026},
      ];
  }
};

const cameraValue = ({
  frame,
  durationInFrames,
  keyframes,
  property,
  fallback,
}: {
  frame: number;
  durationInFrames: number;
  keyframes: Array<{at: number; x?: number; y?: number; zoom?: number}>;
  property: 'x' | 'y' | 'zoom';
  fallback: number;
}) =>
  interpolate(
    frame,
    keyframes.map(({at}) => at * durationInFrames),
    keyframes.map((keyframe) => keyframe[property] ?? fallback),
    clamp,
  );

export const ReplicaChapterScene = ({
  scene,
  narrationVolume,
  roleSounds,
  theme,
}: {
  scene: NormalizedProjectScene;
  narrationVolume: number;
  roleSounds: Partial<Record<Role, ProjectSound>>;
  theme: ProjectTheme;
}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const landscape = width / height >= 1;
  const layoutScale = Math.min(
    width / (landscape ? 1920 : 1080),
    height / (landscape ? 1080 : 1920),
  );
  const rawKeyframes =
    scene.camera.keyframes && scene.camera.keyframes.length >= 2
      ? [...scene.camera.keyframes].sort((left, right) => left.at - right.at)
      : cameraDefaults(scene.camera.preset, scene.camera.intensity);
  const keyframes = rawKeyframes.map((keyframe) => ({
    ...keyframe,
    x: (keyframe.x ?? 0) * layoutScale,
    y: (keyframe.y ?? 0) * layoutScale,
  }));
  const cameraZoom = cameraValue({
    frame,
    durationInFrames: scene.durationInFrames,
    keyframes,
    property: 'zoom',
    fallback: 1,
  });
  const cameraX = cameraValue({
    frame,
    durationInFrames: scene.durationInFrames,
    keyframes,
    property: 'x',
    fallback: 0,
  });
  const cameraY = cameraValue({
    frame,
    durationInFrames: scene.durationInFrames,
    keyframes,
    property: 'y',
    fallback: 0,
  });
  const fadeFrames = scene.transitionFrames;
  const fadeIn =
    fadeFrames === 0 ? 1 : interpolate(frame, [0, fadeFrames], [0, 1], clamp);
  const fadeOut =
    fadeFrames === 0
      ? 1
      : interpolate(
          frame,
          [scene.durationInFrames - fadeFrames, scene.durationInFrames],
          [1, 0],
          clamp,
        );

  return (
    <AbsoluteFill
      style={{
        overflow: 'hidden',
        opacity: Math.min(fadeIn, fadeOut),
        background: theme.sceneBackground,
      }}
    >
      <AbsoluteFill
        style={{
          transform: `translate3d(${cameraX}px, ${cameraY}px, 0) scale(${cameraZoom})`,
          transformOrigin: '50% 54%',
        }}
      >
        <Img alt="" src={staticFile(scene.background)} style={backgroundStyle} />
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          opacity: 0.14,
          mixBlendMode: 'multiply',
          backgroundImage: `url(${staticFile(theme.texture)})`,
          backgroundSize: 'cover',
          zIndex: 6,
          pointerEvents: 'none',
        }}
      />
      {scene.environmentLayers
        .filter(({z}) => z < 4)
        .map((layer) => (
          <EnvironmentCutout
            key={layer.id}
            layer={layer}
            cameraX={cameraX}
            cameraY={cameraY}
            cameraZoom={cameraZoom}
          />
        ))}
      {scene.layers.map((layer) => (
        <Character key={layer.id} layer={layer} paperEdge={theme.paperEdge} />
      ))}
      {scene.environmentLayers
        .filter(({z}) => z >= 4)
        .map((layer) => (
          <EnvironmentCutout
            key={layer.id}
            layer={layer}
            cameraX={cameraX}
            cameraY={cameraY}
            cameraZoom={cameraZoom}
          />
        ))}
      <ForegroundPaper color={theme.foreground} />
      <ChapterLabel eyebrow={scene.eyebrow} label={scene.label} theme={theme} />
      <Subtitle cues={scene.subtitles} theme={theme} />
      <Sequence from={scene.narrationStartFrame} layout="none">
        <Audio
          src={staticFile(scene.narration.src)}
          volume={narrationVolume}
        />
      </Sequence>
      <RoleSounds layers={scene.layers} roleSounds={roleSounds} />
      <AudioEvents events={scene.audioEvents} />
    </AbsoluteFill>
  );
};
