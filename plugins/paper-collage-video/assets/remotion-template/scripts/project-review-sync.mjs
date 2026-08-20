#!/usr/bin/env node
import {printCliHelp} from './cli-help-lib.mjs';
import {formatProduction, loadProduction, syncReviewFromProduction} from './production-state.mjs';

const args = process.argv.slice(2);
const USAGE =
  "用法：npm run project:review-sync -- <slug>";
printCliHelp(args, USAGE);
const slug = args.find((arg) => !arg.startsWith('--'));

try {
  const {state} = await loadProduction(slug);
  await syncReviewFromProduction(slug, state);
  console.log(`✓ 已同步 projects/${slug}/review.md`);
  console.log(formatProduction(state));
} catch (error) {
  console.error(`project:review-sync failed: ${error.message}`);
  process.exitCode = 1;
}
