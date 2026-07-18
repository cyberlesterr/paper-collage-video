import type {Role} from './roleMotion';

export type EnterFrom = 'left' | 'right' | 'bottom';
export type IdleMotionPreset = 'float' | 'breathe' | 'grind' | 'drift' | 'still';

export type LayerMotion = {
  idle?: IdleMotionPreset;
  intensity?: number;
  cycleSeconds?: number;
  phase?: number;
  enterDurationSeconds?: number;
};

export type CharacterLayer = {
  id: string;
  src: string;
  role: Role;
  x: number;
  bottom: number;
  width: number;
  z: number;
  delay: number;
  delaySeconds?: number;
  enterFrom: EnterFrom;
  motion?: LayerMotion;
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
};

export type SubtitleCue = {
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
  preset?: 'push' | 'pull' | 'pan-left' | 'pan-right' | 'static';
  intensity?: number;
  keyframes?: CameraKeyframe[];
};

export type SceneTransition = {
  type?: 'fade' | 'none';
  durationFrames?: number;
};

export type ProjectAudioEvent = ProjectSound & {
  id: string;
  fromFrame?: number;
  atSeconds?: number;
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
  tailFrames: number;
  background: string;
  environmentLayers?: EnvironmentLayer[];
  camera?: SceneCamera;
  transition?: SceneTransition;
  narration: {
    src: string;
    timingSrc?: string;
    startFrame: number;
    durationSeconds: number;
    text: string;
  };
  layers: CharacterLayer[];
  subtitles: SubtitleCue[];
  audioEvents?: ProjectAudioEvent[];
};

export type PaperCollageProject = {
  $schema?: string;
  schemaVersion: 1;
  slug: string;
  title: string;
  plan?: {
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
    transitionFrames: number;
  };
  quality?: {
    mode: 'required' | 'advisory' | 'off';
    minimumAssetScale?: number;
  };
  theme: ProjectTheme;
  voice?: {
    mode: 'fictional' | 'clone';
    provider?: string;
    voiceId?: string;
    displayName?: string;
    settings?: Record<string, string | number | boolean>;
  };
  audio: {
    music: ProjectSound | null;
    sfx: Partial<Record<Role, ProjectSound>>;
    mastering?: ProjectAudioMastering;
  };
  scenes: ProjectScene[];
};

export type NormalizedProjectScene = ProjectScene & {
  from: number;
  durationInFrames: number;
};

export type NormalizedProject = Omit<PaperCollageProject, 'scenes'> & {
  durationInFrames: number;
  scenes: NormalizedProjectScene[];
};

export const normalizeProject = (
  project: PaperCollageProject,
): NormalizedProject => {
  let cursor = 0;
  const {fps, transitionFrames} = project.video;
  const scenes = project.scenes.map((scene, index) => {
    const narrationFrames = Math.ceil(scene.narration.durationSeconds * fps);
    const durationInFrames =
      scene.narration.startFrame + narrationFrames + scene.tailFrames;
    const sceneTransitionFrames =
      scene.transition?.type === 'none'
        ? 0
        : scene.transition?.durationFrames ?? transitionFrames;
    const from = index === 0 ? 0 : Math.max(0, cursor - sceneTransitionFrames);
    cursor = from + durationInFrames;
    return {...scene, from, durationInFrames};
  });

  return {...project, durationInFrames: cursor, scenes};
};
