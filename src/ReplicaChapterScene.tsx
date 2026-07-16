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
  NormalizedProjectScene,
  ProjectSound,
  ProjectTheme,
} from './project';
import {roleMotion, type Role} from './roleMotion';

export type EnterFrom = 'left' | 'right' | 'bottom';

export type CharacterLayer = {
  id: string;
  src: string;
  role: Role;
  x: number;
  bottom: number;
  width: number;
  z: number;
  delay: number;
  enterFrom: EnterFrom;
};

export type SubtitleCue = {
  from: number;
  to: number;
  text: string;
};

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
  const {fps} = useVideoConfig();
  const motion = roleMotion[layer.role];
  const entrance = spring({
    fps,
    frame: frame - layer.delay,
    config: {
      damping: layer.role === 'primary' ? 14 : 18,
      mass: layer.role === 'primary' ? 0.85 : 0.7,
      stiffness: layer.role === 'primary' ? 105 : 120,
    },
    durationInFrames: 34,
  });
  const direction = layer.enterFrom === 'left' ? -1 : 1;
  const xOffset =
    layer.enterFrom === 'bottom'
      ? 0
      : (1 - entrance) * motion.distance * direction;
  const yOffset =
    (1 - entrance) * motion.rise +
    Math.sin((frame - layer.delay + layer.z * 11) / 42) *
      (layer.role === 'primary' ? 2.2 : 1.4);
  const scale = motion.startScale + (1 - motion.startScale) * entrance;
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
        transform: `translate3d(${xOffset}px, ${yOffset}px, 0) scale(${scale})`,
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
  cues: SubtitleCue[];
  theme: ProjectTheme;
}) => {
  const frame = useCurrentFrame();
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
        left: 210,
        right: 210,
        bottom: 58,
        textAlign: 'center',
        opacity,
        color: theme.subtitle,
        fontFamily: 'STKaiti, KaiTi, "Noto Serif SC", serif',
        fontWeight: 700,
        fontSize: 42,
        letterSpacing: 2,
        lineHeight: 1.35,
        textShadow:
          '0 3px 2px rgba(28,15,10,.9), 0 0 14px rgba(28,15,10,.78)',
      }}
    >
      <span
        style={{
          display: 'inline-block',
          padding: '12px 32px 14px',
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
  const enter = spring({
    frame,
    fps: 30,
    config: {damping: 20, stiffness: 90},
  });
  const opacity = interpolate(frame, [0, 12, 90, 118], [0, 1, 1, 0], clamp);

  return (
    <div
      style={{
        position: 'absolute',
        zIndex: 70,
        top: 72,
        left: 92,
        opacity,
        transform: `translateX(${(1 - enter) * -42}px)`,
        color: theme.ink,
        fontFamily: 'STKaiti, KaiTi, "Noto Serif SC", serif',
      }}
    >
      <div style={{fontSize: 22, letterSpacing: 8, color: theme.accent}}>
        {eyebrow}
      </div>
      <div
        style={{
          marginTop: 10,
          fontSize: 51,
          fontWeight: 700,
          letterSpacing: 7,
        }}
      >
        {label}
      </div>
      <div
        style={{
          width: 270 * enter,
          height: 4,
          marginTop: 13,
          background: `linear-gradient(90deg, ${theme.accent}, transparent)`,
        }}
      />
    </div>
  );
};

const ForegroundPaper = ({color}: {color: string}) => {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame / 46) * 5;
  return (
    <>
      <div
        style={{
          position: 'absolute',
          zIndex: 9,
          left: -70 + drift,
          right: -70 - drift,
          bottom: -45,
          height: 150,
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
          right: 84 + drift * 1.5,
          bottom: 88,
          width: 120,
          height: 42,
          background: 'rgba(231, 214, 171, .55)',
          transform: 'rotate(-11deg)',
          boxShadow: '0 5px 9px rgba(44,24,15,.16)',
        }}
      />
    </>
  );
};

const RoleSounds = ({
  layers,
  roleSounds,
}: {
  layers: CharacterLayer[];
  roleSounds: Partial<Record<Role, ProjectSound>>;
}) => (
  <>
    {layers.map((layer) => {
      const sound = roleSounds[layer.role];
      if (!sound) return null;
      return (
        <Sequence key={`sound-${layer.id}`} from={layer.delay} layout="none">
          <Audio src={staticFile(sound.src)} volume={sound.volume} />
        </Sequence>
      );
    })}
  </>
);

export const ReplicaChapterScene = ({
  scene,
  roleSounds,
  theme,
}: {
  scene: NormalizedProjectScene;
  roleSounds: Partial<Record<Role, ProjectSound>>;
  theme: ProjectTheme;
}) => {
  const frame = useCurrentFrame();
  const cameraZoom = interpolate(
    frame,
    [0, scene.durationInFrames],
    [1.01, 1.026],
    clamp,
  );
  const cameraX = interpolate(
    frame,
    [0, scene.durationInFrames],
    [-6, 9],
    clamp,
  );
  const fadeIn = interpolate(frame, [0, 18], [0, 1], clamp);
  const fadeOut = interpolate(
    frame,
    [scene.durationInFrames - 18, scene.durationInFrames],
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
          transform: `translateX(${cameraX}px) scale(${cameraZoom})`,
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
      {scene.layers.map((layer) => (
        <Character key={layer.id} layer={layer} paperEdge={theme.paperEdge} />
      ))}
      <ForegroundPaper color={theme.foreground} />
      <ChapterLabel eyebrow={scene.eyebrow} label={scene.label} theme={theme} />
      <Subtitle cues={scene.subtitles} theme={theme} />
      <Sequence from={scene.narration.startFrame} layout="none">
        <Audio src={staticFile(scene.narration.src)} volume={1} />
      </Sequence>
      <RoleSounds layers={scene.layers} roleSounds={roleSounds} />
    </AbsoluteFill>
  );
};
