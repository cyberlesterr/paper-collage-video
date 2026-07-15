import {Composition} from 'remotion';
import {
  DEFAULT_TANG_PAPER_CUTOUT_PROPS,
  TangPaperCutout,
} from './TangPaperCutout';

export const RemotionRoot = () => {
  return (
    <Composition
      id="Tang-Paper-Cutout"
      component={TangPaperCutout}
      durationInFrames={900}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={DEFAULT_TANG_PAPER_CUTOUT_PROPS}
    />
  );
};
