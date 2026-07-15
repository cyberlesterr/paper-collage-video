import {AbsoluteFill, Audio, Sequence, staticFile} from 'remotion';
import {
  ReplicaChapterScene,
  type ReplicaScene,
} from './ReplicaChapterScene';
import script from './script.json';

const scenes = script.scenes as ReplicaScene[];

export const MainVideo = () => {
  return (
    <AbsoluteFill style={{background: '#6e1e19'}}>
      <Audio src={staticFile('audio/music/tang-ambient.wav')} volume={0.52} />
      {scenes.map((scene) => (
        <Sequence
          key={scene.id}
          from={scene.from}
          durationInFrames={scene.durationInFrames}
        >
          <ReplicaChapterScene scene={scene} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

export const REPLICA_VIDEO_DURATION = script.durationInFrames;

