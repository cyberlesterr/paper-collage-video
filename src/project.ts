import type {Role} from './roleMotion';

export type EnterFrom = 'left' | 'right' | 'bottom';
export type IdleMotionPreset = 'float' | 'breathe' | 'grind' | 'drift' | 'still';
export type SceneBlueprint =
  | 'layered-reveal'
  | 'map-journey'
  | 'archive-stack'
  | 'character-procession'
  | 'discovery-wipe'
  | 'transformation-tableau'
  | 'chapter-tableau'
  | 'quiet-lockup';
export type MotionEase = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'hold';

export type MotionKeyframe = {
  at: number;
  x?: number;
  y?: number;
  scale?: number;
  rotation?: number;
  opacity?: number;
  ease?: MotionEase;
};

export type LayerMotion = {
  idle: IdleMotionPreset;
  intensity: number;
  cycleSeconds: number;
  phase?: number;
  enterDurationSeconds: number;
  keyframes: MotionKeyframe[];
};

export type CharacterLayer = {
  id: string;
  src: string;
  role: Role;
  x: number;
  bottom: number;
  width: number;
  z: number;
  delaySeconds: number;
  enterFrom: EnterFrom;
  motion: LayerMotion;
};

export type EnvironmentLayer = {
  id: string;
  src: string;
  depth: number;
  z: number;
  x?: number;
  y?: number;
  width?: number;
  opacity?: number;
  motion: {
    keyframes: MotionKeyframe[];
  };
};

export type SubtitleCue = {
  fromSeconds: number;
  toSeconds: number;
  text: string;
};

export type NormalizedSubtitleCue = {
  from: number;
  to: number;
  text: string;
};

export type CameraKeyframe = {
  at: number;
  x?: number;
  y?: number;
  zoom?: number;
};

export type SceneCamera = {
  preset: 'push' | 'pull' | 'pan-left' | 'pan-right' | 'static';
  intensity: number;
  keyframes?: CameraKeyframe[];
};

export type SceneTransition = {
  type: 'fade' | 'none';
  durationSeconds: number;
};

export type ProjectCue = {
  id: string;
  beatId: string;
  at: number;
  durationSeconds: number;
  targetId: string;
  action: 'reveal' | 'pulse' | 'stamp' | 'shake' | 'lift' | 'settle';
  intensity: number;
  sound?: ProjectSound;
};

export type ProofTime = {
  at: number;
  label: string;
  kind: 'establish' | 'action' | 'peak' | 'final';
};

export type SceneMotion = {
  blueprint: SceneBlueprint;
  intensity: number;
  seed: number;
  proofTimes: ProofTime[];
};

export type ProjectTheme = {
  canvas: string;
  sceneBackground: string;
  accent: string;
  ink: string;
  subtitle: string;
  subtitleBackground: string;
  paperEdge: string;
  foreground: string;
  texture: string;
  fontFamily?: string;
  fontFile?: string;
};

export type ProjectSound = {
  src: string;
  volume: number;
};

export type ProjectAudioMastering = {
  targetLufs: number;
  toleranceLufs: number;
  truePeakDbtp: number;
};

export type ProjectScene = {
  id: string;
  label: string;
  eyebrow: string;
  tailSeconds: number;
  background: string;
  environmentLayers: EnvironmentLayer[];
  motion: SceneMotion;
  camera: SceneCamera;
  transition: SceneTransition;
  narration: {
    src: string;
    timingSrc?: string;
    startSeconds: number;
    durationSeconds: number;
    text: string;
  };
  layers: CharacterLayer[];
  subtitles: SubtitleCue[];
  cues: ProjectCue[];
};

export type PaperCollageProject = {
  $schema?: string;
  schemaVersion: 3;
  slug: string;
  title: string;
  plan: {
    schemaVersion: 1;
    slug: string;
    status: 'pending' | 'resolved';
    inputMode: 'none' | 'duration-only' | 'scenes-only' | 'both';
    requested: {
      durationSeconds: number | null;
      sceneCount: number | null;
    };
    resolved: null | {
      durationSeconds: number;
      sceneCount: number;
      estimatedNarrationSeconds: number | null;
      rationale: string;
      resolvedAt: string;
    };
    updatedAt: string;
  };
  video: {
    width: number;
    height: number;
    fps: number;
  };
  quality: {
    minimumAssetScale: number;
  };
  theme: ProjectTheme;
  voice: {
    mode: 'fictional' | 'clone';
    provider?: string;
    voiceId?: string;
    profile?: string;
    displayName?: string;
    settings?: Record<string, string | number | boolean>;
  };
  audio: {
    narration: {
      volume: number;
    };
    music: ProjectSound | null;
    mastering: ProjectAudioMastering;
  };
  scenes: ProjectScene[];
};

export type NormalizedProjectScene = Omit<ProjectScene, 'subtitles'> & {
  from: number;
  durationInFrames: number;
  narrationStartFrame: number;
  transitionFrames: number;
  subtitles: NormalizedSubtitleCue[];
};

export type NormalizedProject = Omit<PaperCollageProject, 'scenes'> & {
  durationInFrames: number;
  scenes: NormalizedProjectScene[];
};

export const normalizeProject = (
  project: PaperCollageProject,
): NormalizedProject => {
  let cursor = 0;
  const {fps} = project.video;
  const scenes = project.scenes.map((scene, index) => {
    const narrationFrames = Math.ceil(scene.narration.durationSeconds * fps);
    const narrationStartFrame = Math.round(scene.narration.startSeconds * fps);
    const tailFrames = Math.ceil(scene.tailSeconds * fps);
    const durationInFrames =
      narrationStartFrame + narrationFrames + tailFrames;
    const sceneTransitionFrames =
      scene.transition.type === 'none'
        ? 0
        : Math.round(scene.transition.durationSeconds * fps);
    const from = index === 0 ? 0 : Math.max(0, cursor - sceneTransitionFrames);
    cursor = from + durationInFrames;
    return {
      ...scene,
      from,
      durationInFrames,
      narrationStartFrame,
      transitionFrames: sceneTransitionFrames,
      subtitles: scene.subtitles.map((cue) => ({
        from: Math.round(cue.fromSeconds * fps),
        to: Math.round(cue.toSeconds * fps),
        text: cue.text,
      })),
    };
  });

  return {
    ...project,
    durationInFrames: scenes.length === 0 ? fps : cursor,
    scenes,
  };
};
