#!/usr/bin/env node
import {printCliHelp} from './cli-help-lib.mjs';
import {execFile} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import {PHASE2_PROOF_PROFILES} from '../fixtures/phase2-proof-fixture.mjs';
import {
  PHASE2_PROOF_DIR,
  readJson,
  writeJson,
} from './phase2-proof-lib.mjs';

const USAGE =
  "用法：npm run proof:phase2:render --";
printCliHelp(process.argv.slice(2), USAGE);

const execFileAsync = promisify(execFile);
const root = path.resolve(PHASE2_PROOF_DIR, '..', '..');
const remotion = path.join(root, 'node_modules', '.bin', 'remotion');
const previewsDirectory = path.join(PHASE2_PROOF_DIR, 'previews');
await fs.mkdir(previewsDirectory, {recursive: true});

const renders = [];
for (const profile of PHASE2_PROOF_PROFILES) {
  const suffix = profile.id.replace(':', 'x');
  const propsFile = path.join(PHASE2_PROOF_DIR, 'inputs', `project-${suffix}.json`);
  await readJson(propsFile);
  const output = path.join(previewsDirectory, `preview-${suffix}.mp4`);
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
      '--crf=20',
      '--pixel-format=yuv420p',
      '--concurrency=2',
      '--log=error',
    ],
    {
      cwd: root,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  renders.push({
    profileId: profile.id,
    width: profile.width,
    height: profile.height,
    output: path.relative(root, output),
    elapsedMs: Date.now() - startedAt,
  });
  console.log(`✓ rendered ${profile.id}: ${output}`);
}

await writeJson(path.join(PHASE2_PROOF_DIR, 'reports', 'render-report.json'), {
  schemaVersion: 1,
  passed: true,
  providerCalls: 0,
  renderer: 'Remotion Chromium',
  renders,
});
