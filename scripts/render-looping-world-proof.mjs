#!/usr/bin/env node
import {printCliHelp} from './cli-help-lib.mjs';
import {execFile} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  LOOPING_WORLD_PROFILES,
  LOOPING_WORLD_SLUG,
} from '../fixtures/looping-world-fixture.mjs';

const USAGE =
  "用法：npm run proof:looping-world:render --";
printCliHelp(process.argv.slice(2), USAGE);

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, '..');
const PROOF_DIRECTORY = path.join(ROOT, 'dist', LOOPING_WORLD_SLUG);
const INPUTS_DIRECTORY = path.join(PROOF_DIRECTORY, 'inputs');
const PREVIEWS_DIRECTORY = path.join(PROOF_DIRECTORY, 'previews');
const REPORTS_DIRECTORY = path.join(PROOF_DIRECTORY, 'reports');
const remotion = path.join(ROOT, 'node_modules', '.bin', 'remotion');

const writeJson = async (file, value) => {
  await fs.mkdir(path.dirname(file), {recursive: true});
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
};
const requireFile = async (file) => {
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size === 0) throw new Error(`缺少渲染输入：${file}`);
};

await fs.mkdir(PREVIEWS_DIRECTORY, {recursive: true});
const renders = [];
for (const profile of LOOPING_WORLD_PROFILES) {
  const suffix = profile.id.replace(':', 'x');
  const propsFile = path.join(INPUTS_DIRECTORY, `project-${suffix}.json`);
  await requireFile(propsFile);
  const output = path.join(PREVIEWS_DIRECTORY, `preview-${suffix}.mp4`);
  const startedAt = Date.now();
  await execFileAsync(
    remotion,
    [
      'render',
      'src/index.ts',
      'Paper-Collage',
      output,
      `--props=${propsFile}`,
      '--codec=h264',
      '--crf=22',
      '--pixel-format=yuv420p',
      '--audio-bitrate=96k',
      '--concurrency=2',
      '--log=error',
    ],
    {cwd: ROOT, maxBuffer: 16 * 1024 * 1024},
  );
  renders.push({
    kind: 'preview',
    profileId: profile.id,
    width: profile.width,
    height: profile.height,
    output: path.relative(ROOT, output),
    elapsedMs: Date.now() - startedAt,
  });
  console.log(`✓ rendered preview ${profile.id}`);
}

const finalProps = path.join(INPUTS_DIRECTORY, 'project-16x9.json');
const finalOutput = path.join(PROOF_DIRECTORY, 'final-16x9.mp4');
const finalStartedAt = Date.now();
await execFileAsync(
  remotion,
  [
    'render',
    'src/index.ts',
    'Paper-Collage',
    finalOutput,
    `--props=${finalProps}`,
    '--codec=h264',
    '--crf=17',
    '--pixel-format=yuv420p',
    '--audio-bitrate=128k',
    '--concurrency=2',
    '--log=error',
  ],
  {cwd: ROOT, maxBuffer: 16 * 1024 * 1024},
);
renders.push({
  kind: 'final',
  profileId: '16:9',
  width: 960,
  height: 540,
  output: path.relative(ROOT, finalOutput),
  elapsedMs: Date.now() - finalStartedAt,
});
console.log('✓ rendered final 16:9');

await writeJson(path.join(REPORTS_DIRECTORY, 'render-report.json'), {
  schemaVersion: 1,
  passed: true,
  providerCalls: 0,
  renderer: 'Remotion Chromium',
  renders,
});
