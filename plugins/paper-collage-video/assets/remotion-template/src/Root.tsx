import {Composition, type CalculateMetadataFunction} from 'remotion';
import starterDemo from '../projects/starter-demo/project.json';
import {MainVideo} from './MainVideo';
import {normalizeProject, type PaperCollageProject} from './project';

const defaultProject = starterDemo as PaperCollageProject;

const calculateProjectMetadata: CalculateMetadataFunction<PaperCollageProject> = ({props}) => {
  const normalized = normalizeProject(props);
  return {
    durationInFrames: normalized.durationInFrames,
    fps: normalized.video.fps,
    width: normalized.video.width,
    height: normalized.video.height,
    defaultOutName: `${normalized.slug}.mp4`,
  };
};

export const RemotionRoot = () => (
  <Composition
    id="Paper-Collage"
    component={MainVideo}
    defaultProps={defaultProject}
    calculateMetadata={calculateProjectMetadata}
  />
);
