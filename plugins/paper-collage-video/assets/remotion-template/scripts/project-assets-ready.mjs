#!/usr/bin/env node
import {spawn} from 'node:child_process';
import path from 'node:path';
import {ROOT} from './project-lib.mjs';

const [slug, ...args] = process.argv.slice(2);

const run = (script, scriptArgs) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(ROOT, 'scripts', script), ...scriptArgs],
      {cwd: ROOT, stdio: 'inherit'},
    );
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${script} exited with ${code ?? signal}`));
    });
  });

try {
  if (!slug) {
    throw new Error('用法：project:assets-ready -- <slug>');
  }
  await run('project-sync.mjs', [slug]);
  await run('project-subtitles.mjs', [slug]);
  await run('project-advance.mjs', [slug, 'assets-ready', ...args]);
} catch (error) {
  console.error(`project:assets-ready failed: ${error.message}`);
  process.exitCode = 1;
}
