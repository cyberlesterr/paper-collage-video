import {Composition, type CalculateMetadataFunction} from 'remotion';
import tangDemo from '../projects/tang-demo/project.json';
import {
  DEFAULT_TANG_PAPER_CUTOUT_PROPS,
  TangPaperCutout,
} from './TangPaperCutout';
import {MainVideo} from './MainVideo';
import {
  normalizeProject,
  type PaperCollageProject,
} from './project';

const defaultProject = tangDemo as PaperCollageProject;

const calculateProjectMetadata: CalculateMetadataFunction<PaperCollageProject> = ({
  props,
}) => {
  const normalized = normalizeProject(props);
  return {
    durationInFrames: normalized.durationInFrames,
    fps: normalized.video.fps,
    width: normalized.video.width,
    height: normalized.video.height,
    defaultOutName: `${normalized.slug}.mp4`,
  };
};

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="Paper-Collage"
        component={MainVideo}
        defaultProps={defaultProject}
        calculateMetadata={calculateProjectMetadata}
      />
      <Composition
        id="Tang-Paper-Cutout-Prototype"
        component={TangPaperCutout}
        durationInFrames={900}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={DEFAULT_TANG_PAPER_CUTOUT_PROPS}
      />
    </>
  );
};
