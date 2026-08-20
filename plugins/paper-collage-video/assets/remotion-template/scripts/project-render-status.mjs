#!/usr/bin/env node
import {printCliHelp} from './cli-help-lib.mjs';
import path from 'node:path';
import {ROOT} from './project-lib.mjs';
import {readRenderStatus} from './render-status-lib.mjs';

const args = process.argv.slice(2);
const USAGE =
  '用法：project:render-status -- <slug> [--json]';
printCliHelp(args, USAGE);
const slug = args.find((argument) => !argument.startsWith('--'));
const json = args.includes('--json');

try {
  if (!slug) throw new Error(USAGE);
  const result = await readRenderStatus(slug);
  if (json) console.log(JSON.stringify(result, null, 2));
  else if (!result.status) console.log(`◇ render status: ${slug} 尚未启动预览或正式渲染。`);
  else {
    const {status, artifact} = result;
    console.log(`render status: ${slug} · ${status.mode} · ${status.phase}`);
    console.log(`  started: ${status.startedAt}; updated: ${status.updatedAt}`);
    if (artifact) console.log(`  artifact: ${artifact.exists ? 'ready' : 'missing'} · ${artifact.file}${artifact.bytes === null ? '' : ` · ${artifact.bytes} bytes`}`);
    if (status.detail) console.log(`  detail: ${status.detail}`);
    if (status.error) console.log(`  error: ${status.error}`);
    console.log(`  progress: ${status.progressAvailability}`);
    console.log(`  status file: ${path.relative(ROOT, result.file)}`);
  }
} catch (error) {
  console.error(`project:render-status failed: ${error.message}`);
  process.exitCode = 1;
}
