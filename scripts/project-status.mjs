#!/usr/bin/env node
import {
  formatProduction,
  getStageControl,
  loadProduction,
} from './production-state.mjs';

const args = process.argv.slice(2);
const slug = args.find((arg) => !arg.startsWith('--'));
const json = args.includes('--json');
const controlJson = args.includes('--control-json');

try {
  const {state} = await loadProduction(slug);
  if (controlJson) {
    console.log(JSON.stringify({state, control: getStageControl(state)}, null, 2));
  } else {
    console.log(json ? JSON.stringify(state, null, 2) : formatProduction(state));
  }
} catch (error) {
  console.error(`project:status failed: ${error.message}`);
  process.exitCode = 1;
}
