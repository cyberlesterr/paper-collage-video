#!/usr/bin/env node
import {formatProduction, loadProduction} from './production-state.mjs';

const args = process.argv.slice(2);
const slug = args.find((arg) => !arg.startsWith('--'));
const json = args.includes('--json');

try {
  const {state} = await loadProduction(slug);
  console.log(json ? JSON.stringify(state, null, 2) : formatProduction(state));
} catch (error) {
  console.error(`project:status failed: ${error.message}`);
  process.exitCode = 1;
}
