#!/usr/bin/env node
import {
  formatProduction,
  getStageControl,
  loadProduction,
  summarizeResumeState,
} from './production-state.mjs';
import {loadProject} from './project-lib.mjs';
import {loadStoryboard, summarizeStoryboard} from './storyboard-lib.mjs';

const args = process.argv.slice(2);
const slug = args.find((arg) => !arg.startsWith('--'));
const json = args.includes('--json');
const controlJson = args.includes('--control-json');
const compactJson = args.includes('--compact-json');
const resumeJson = args.includes('--resume-json');

try {
  const {state} = await loadProduction(slug);
  const {project} = await loadProject(slug);
  const plan = project.plan ?? null;
  const storyboard = summarizeStoryboard(await loadStoryboard(slug));
  const control = getStageControl(state);
  if (resumeJson) {
    console.log(JSON.stringify(summarizeResumeState(state, plan, storyboard), null, 2));
  } else if (compactJson) {
    console.log(
      JSON.stringify(
        {
          slug: state.slug,
          stage: state.stage,
          updatedAt: state.updatedAt,
          approvals: state.approvals,
          artifacts: state.artifacts,
          plan,
          storyboard,
          control,
        },
        null,
        2,
      ),
    );
  } else if (controlJson) {
    console.log(JSON.stringify({state, plan, storyboard, control}, null, 2));
  } else {
    console.log(json ? JSON.stringify(state, null, 2) : formatProduction(state));
  }
} catch (error) {
  console.error(`project:status failed: ${error.message}`);
  process.exitCode = 1;
}
