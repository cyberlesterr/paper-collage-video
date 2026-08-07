import {
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import type {
  EditorialSubtitlePlacement,
  EditorialSystem,
  NormalizedSubtitleCue,
  ProjectTheme,
  SceneAppearance,
} from './project';
import {
  resolveSubtitleFadeFrames,
  resolveSubtitleLayout,
  resolveSubtitleScenePlacement,
  resolveSubtitleTypography,
} from './subtitleSurface.mjs';

const clamp = {
  extrapolateLeft: 'clamp',
  extrapolateRight: 'clamp',
} as const;

export const SubtitleOverlay = ({
  cues,
  theme,
  appearance,
  safeArea,
  placement,
}: {
  cues: NormalizedSubtitleCue[];
  theme: ProjectTheme;
  appearance?: SceneAppearance['subtitles'];
  safeArea?: EditorialSystem['responsiveProfiles'][number]['safeArea'];
  placement?: EditorialSubtitlePlacement;
}) => {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();
  const scale = Math.min(width / 1920, height / 1080);
  const cue = cues.find(({from, to}) => frame >= from && frame < to);
  if (!cue || appearance?.variant === 'hidden') return null;
  const fadeFrames = resolveSubtitleFadeFrames({from: cue.from, to: cue.to});
  const opacity = fadeFrames === 0
    ? 1
    : interpolate(
        frame,
        [cue.from, cue.from + fadeFrames, cue.to - fadeFrames, cue.to],
        [0, 1, 1, 0],
        clamp,
      );
  const layout = resolveSubtitleLayout({
    safeArea,
    maxWidth: appearance?.maxWidth,
    width,
    height,
  });
  const sceneLayout = resolveSubtitleScenePlacement({
    placement,
    safeArea,
    maxWidth: appearance?.maxWidth,
    width,
    height,
  });
  const typography = resolveSubtitleTypography({
    appearance,
    theme,
    scale,
  });
  const activeLayout = placement ? sceneLayout : layout;
  return (
    <div
      style={{
        position: 'absolute',
        zIndex: 100,
        left: `${activeLayout.leftPercent}%`,
        right: `${activeLayout.rightPercent}%`,
        ...(placement && sceneLayout.anchor !== 'bottom'
          ? {top: sceneLayout.topPixels}
          : {bottom: activeLayout.bottomPixels}),
        textAlign: 'center',
        opacity,
        color: appearance?.color ?? theme.subtitle,
        fontFamily: typography.fontFamily,
        fontWeight: typography.fontWeight,
        fontSize: 42 * scale,
        letterSpacing: 2 * scale,
        lineHeight: 1.35,
        textShadow: typography.textShadow,
      }}
    >
      <span
        style={{
          display: 'inline-block',
          padding: appearance?.variant === 'plain'
            ? 0
            : `${12 * scale}px ${32 * scale}px ${14 * scale}px`,
          background: appearance?.variant === 'plain'
            ? 'transparent'
            : (appearance?.background ?? theme.subtitleBackground),
          border: appearance?.variant === 'plain'
            ? undefined
            : '1px solid rgba(244, 222, 174, .42)',
          boxShadow: appearance?.variant === 'plain'
            ? undefined
            : '0 8px 24px rgba(40, 16, 10, .22)',
        }}
      >
        {cue.text}
      </span>
    </div>
  );
};
