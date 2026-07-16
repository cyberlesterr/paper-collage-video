import type {CharacterLayer, SubtitleCue} from './ReplicaChapterScene';
import type {Role} from './roleMotion';

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
};

export type ProjectSound = {
  src: string;
  volume: number;
};

export type ProjectScene = {
  id: string;
  label: string;
  eyebrow: string;
  tailFrames: number;
  background: string;
  narration: {
    src: string;
    startFrame: number;
    durationSeconds: number;
    text: string;
  };
  layers: CharacterLayer[];
  subtitles: SubtitleCue[];
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
    const from = index === 0 ? 0 : Math.max(0, cursor - transitionFrames);
    cursor = from + durationInFrames;
    return {...scene, from, durationInFrames};
  });

  return {...project, durationInFrames: cursor, scenes};
};
