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

export type IdleMotion = {
  preset: 'float' | 'breathe' | 'grind' | 'drift' | 'still';
  intensity: number;
  cycleSeconds: number;
  phase?: number;
};

export type NodeMotion = {
  keyframes: MotionKeyframe[];
  idle?: IdleMotion;
};

export type NodeTransform = {
  x: number;
  y: number;
  width: number;
  height?: number;
  anchorX: number;
  anchorY: number;
  scale?: number;
  rotation?: number;
  opacity?: number;
};

export type CoordinateSpace = {width: number; height: number};

export type CompositionRegistration = {
  id: string;
  sourceMasterAssetId: string;
  canvas: CoordinateSpace;
  origin: 'top-left';
};

export type CompositionAssetNode = {
  id: string;
  kind: 'asset';
  assetRole: 'background' | 'environment' | 'character' | 'prop' | 'decorative';
  src: string;
  z: number;
  slot?: string;
  registrationId?: string;
  semanticCoverage?: string[];
  depth?: number;
  transform: NodeTransform;
  motion: NodeMotion;
  clip?: {boundaryId: string; side: 'upper' | 'lower'};
};

export type CompositionBoundary = {
  id: string;
  normalizedY?: number;
  upperMaskSrc?: string;
  lowerMaskSrc?: string;
  upperSemantic: string;
  lowerSemantic: string;
};

export type CompositionGroupNode = {
  id: string;
  kind: 'group';
  pattern: 'free' | 'supported-subject' | 'registered-environment';
  z: number;
  coordinateSpace: CoordinateSpace;
  transform: NodeTransform;
  motion: NodeMotion;
  registration?: CompositionRegistration;
  support?: {
    subjectId: string;
    contactAnchor: {x: number; y: number};
    contactZone: Array<[number, number]>;
    occlusionZone: Array<[number, number]>;
    detachProofTimeIds?: string[];
  };
  boundaries?: CompositionBoundary[];
  children: CompositionNode[];
};

export type CompositionNode = CompositionAssetNode | CompositionGroupNode;

export type SceneComposition = {
  coordinateSpace: CoordinateSpace;
  nodes: CompositionNode[];
};

export type SubtitleCue = {fromSeconds: number; toSeconds: number; text: string};
export type NormalizedSubtitleCue = {from: number; to: number; text: string};

export type CameraKeyframe = {at: number; x?: number; y?: number; zoom?: number};
export type SceneCamera = {
  preset: 'push' | 'pull' | 'pan-left' | 'pan-right' | 'static';
  intensity: number;
  keyframes?: CameraKeyframe[];
};

export type SceneTransition = {type: 'fade' | 'none'; durationSeconds: number};
export type CueAction =
  | 'reveal'
  | 'pulse'
  | 'stamp'
  | 'shake'
  | 'lift'
  | 'settle'
  | 'drop-impact'
  | 'carve';

export type ProjectCue = {
  id: string;
  beatId: string;
  at: number;
  durationSeconds: number;
  targetId: string;
  action: CueAction;
  intensity: number;
  proofTimeId?: string;
  sound?: ProjectSound;
};

export type ProofTime = {
  id: string;
  at: number;
  label: string;
  kind: 'establish' | 'action' | 'peak' | 'final';
  assertions: string[];
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

export type ProjectSound = {src: string; volume: number};
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
  motion: SceneMotion;
  composition: SceneComposition;
  camera: SceneCamera;
  transition: SceneTransition;
  narration: {
    src: string;
    timingSrc?: string;
    startSeconds: number;
    durationSeconds: number;
    text: string;
  };
  subtitles: SubtitleCue[];
  cues: ProjectCue[];
};

export type PaperCollageProject = {
  $schema?: string;
  schemaVersion: 4;
  slug: string;
  title: string;
  plan: {
    schemaVersion: 1;
    slug: string;
    status: 'pending' | 'resolved';
    inputMode: 'none' | 'duration-only' | 'scenes-only' | 'both';
    productionProfile?: 'draft' | 'balanced' | 'full-depth';
    assetBudget?: {
      backgrounds: number;
      environmentLayers: number;
      characterSheets: number;
      styleSamples: number;
      maxGeneratedImages: number;
    } | null;
    requested: {durationSeconds: number | null; sceneCount: number | null};
    resolved: null | {
      durationSeconds: number;
      sceneCount: number;
      estimatedNarrationSeconds: number | null;
      rationale: string;
      resolvedAt: string;
    };
    updatedAt: string;
  };
  video: {width: number; height: number; fps: number};
  quality: {minimumAssetScale: number};
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
    narration: {volume: number};
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

export const normalizeProject = (project: PaperCollageProject): NormalizedProject => {
  let cursor = 0;
  const {fps} = project.video;
  const scenes = project.scenes.map((scene, index) => {
    const narrationFrames = Math.ceil(scene.narration.durationSeconds * fps);
    const narrationStartFrame = Math.round(scene.narration.startSeconds * fps);
    const tailFrames = Math.ceil(scene.tailSeconds * fps);
    const durationInFrames = narrationStartFrame + narrationFrames + tailFrames;
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
