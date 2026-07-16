#!/usr/bin/env node
import {spawn} from 'node:child_process';
import path from 'node:path';
import {ROOT} from './project-lib.mjs';

const [slug, ...args] = process.argv.slice(2);

if (!slug) {
  console.error('project:assets-ready failed: 用法：project:assets-ready -- <slug>');
  process.exitCode = 1;
} else {
  const child = spawn(
    process.execPath,
    [path.join(ROOT, 'scripts', 'project-advance.mjs'), slug, 'assets-ready', ...args],
    {cwd: ROOT, stdio: 'inherit'},
  );
  child.once('error', (error) => {
    console.error(`project:assets-ready failed: ${error.message}`);
    process.exitCode = 1;
  });
  child.once('exit', (code, signal) => {
    if (code !== 0) process.exitCode = code ?? (signal ? 1 : 0);
  });
}
