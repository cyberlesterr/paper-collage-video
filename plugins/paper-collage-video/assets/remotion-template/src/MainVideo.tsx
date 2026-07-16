import {useMemo} from 'react';
import {AbsoluteFill, Audio, Sequence, staticFile} from 'remotion';
import {ReplicaChapterScene} from './ReplicaChapterScene';
import {
  normalizeProject,
  type PaperCollageProject,
} from './project';

export const MainVideo = (project: PaperCollageProject) => {
  const normalized = useMemo(() => normalizeProject(project), [project]);
  return (
    <AbsoluteFill style={{background: normalized.theme.canvas}}>
      {normalized.audio.music ? (
        <Audio
          src={staticFile(normalized.audio.music.src)}
          volume={normalized.audio.music.volume}
        />
      ) : null}
      {normalized.scenes.map((scene) => (
        <Sequence
          key={scene.id}
          from={scene.from}
          durationInFrames={scene.durationInFrames}
        >
          <ReplicaChapterScene
            scene={scene}
            roleSounds={normalized.audio.sfx}
            theme={normalized.theme}
          />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
