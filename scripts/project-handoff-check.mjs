#!/usr/bin/env node
import {assessHandoff, loadProduction} from './production-state.mjs';

const args = process.argv.slice(2);
const slug = args.find((arg) => !arg.startsWith('--'));
const option = (name) =>
  args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);

try {
  const {state} = await loadProduction(slug);
  const result = assessHandoff(state, {
    blocker: option('blocker'),
    needsUser: option('needs-user'),
  });
  if (!result.allowed) {
    console.error(`HANDOFF_BLOCKED: ${result.message}`);
    process.exitCode = 2;
  } else if (result.reason === 'explicit-blocker') {
    console.log(
      `HANDOFF_ALLOWED: 当前阻塞：${result.blocker}；需要用户：${result.needsUser}`,
    );
  } else {
    console.log(`HANDOFF_ALLOWED: ${state.stage} · ${result.reason}`);
  }
} catch (error) {
  console.error(`project:handoff-check failed: ${error.message}`);
  process.exitCode = 1;
}
