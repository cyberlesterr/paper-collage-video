#!/usr/bin/env node
import {printCliHelp} from './cli-help-lib.mjs';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {ROOT} from './project-lib.mjs';
import {resolvePythonCommand} from './python-runtime.mjs';

const USAGE =
  "用法：npm run schema:v12 --";
printCliHelp(process.argv.slice(2), USAGE);

const runInherited = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {cwd: ROOT, stdio: 'inherit'});
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code ?? signal}`));
    });
  });

try {
  await runInherited(process.execPath, [
    path.join(ROOT, 'scripts', 'prepare-phase2-proof.mjs'),
  ]);
  await runInherited(process.execPath, [
    path.join(ROOT, 'scripts', 'prepare-looping-world-proof.mjs'),
  ]);
  await runInherited(resolvePythonCommand({root: ROOT}), [
    path.join(ROOT, 'scripts', 'validate_v12_schemas.py'),
  ]);
} catch (error) {
  console.error(`schema:v12 failed: ${error.message}`);
  process.exitCode = 1;
}
