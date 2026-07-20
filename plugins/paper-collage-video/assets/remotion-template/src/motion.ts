import type {MotionKeyframe, ProjectCue} from './project';

export type MotionState = {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
};

const defaults: MotionState = {x: 0, y: 0, scale: 1, rotation: 0, opacity: 1};
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const ease = (value: number, name: MotionKeyframe['ease']) => {
  const t = clamp01(value);
  switch (name) {
    case 'ease-in':
      return t * t;
    case 'ease-out':
      return 1 - (1 - t) * (1 - t);
    case 'ease-in-out':
      return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    case 'hold':
      return 0;
    case 'linear':
    default:
      return t;
  }
};

export const resolveMotionState = (
  keyframes: MotionKeyframe[],
  progress: number,
): MotionState => {
  if (keyframes.length === 0) return defaults;
  const sorted = [...keyframes].sort((left, right) => left.at - right.at);
  const current = clamp01(progress);
  if (current <= sorted[0].at) return {...defaults, ...sorted[0]};
  if (current >= sorted.at(-1)!.at) return {...defaults, ...sorted.at(-1)!};
  const rightIndex = sorted.findIndex(({at}) => at >= current);
  const left = sorted[Math.max(0, rightIndex - 1)];
  const right = sorted[rightIndex];
  const span = Math.max(0.000001, right.at - left.at);
  const amount = ease((current - left.at) / span, right.ease ?? 'ease-in-out');
  return Object.fromEntries(
    (Object.keys(defaults) as Array<keyof MotionState>).map((property) => {
      const start = left[property] ?? defaults[property];
      const end = right[property] ?? defaults[property];
      return [property, start + (end - start) * amount];
    }),
  ) as MotionState;
};

export const resolveCueState = ({
  cues,
  targetId,
  progress,
  durationSeconds,
}: {
  cues: ProjectCue[];
  targetId: string;
  progress: number;
  durationSeconds: number;
}): MotionState => {
  const result = {...defaults};
  for (const cue of cues.filter((item) => item.targetId === targetId)) {
    const duration = Math.max(0.08, cue.durationSeconds / Math.max(0.08, durationSeconds));
    const cueProgress = (progress - cue.at) / duration;
    if (cueProgress < 0 || cueProgress > 1) continue;
    const envelope = Math.sin(cueProgress * Math.PI) * cue.intensity;
    switch (cue.action) {
      case 'reveal':
        result.opacity *= clamp01(cueProgress * 2.5);
        result.scale *= 0.9 + clamp01(cueProgress * 2.5) * 0.1;
        result.y += (1 - clamp01(cueProgress * 2.5)) * 24 * cue.intensity;
        break;
      case 'pulse':
        result.scale *= 1 + envelope * 0.055;
        break;
      case 'stamp':
        result.scale *= 1 + envelope * 0.09;
        result.rotation += (1 - cueProgress) * 2.2 * cue.intensity;
        break;
      case 'shake':
        result.x += Math.sin(cueProgress * Math.PI * 8) * envelope * 12;
        result.rotation += Math.sin(cueProgress * Math.PI * 6) * envelope * 0.8;
        break;
      case 'lift':
        result.y -= envelope * 22;
        break;
      case 'settle':
        result.y += envelope * 12;
        result.rotation -= envelope * 0.65;
        break;
    }
  }
  return result;
};
