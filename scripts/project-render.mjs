#!/usr/bin/env node
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ROOT,
  formatValidation,
  loadProject,
  projectPaths,
  validateProject,
  writeValidationReport,
} from './project-lib.mjs';

const [mode, slug] = process.argv.slice(2);

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
  if (!['preview', 'render'].includes(mode)) {
    throw new Error('用法：project-render.mjs <preview|render> <slug>');
  }
  await runInherited(process.execPath, ['scripts/project-sync.mjs', slug]);
  const {project} = await loadProject(slug);
  const report = await validateProject(project);
  await writeValidationReport(slug, report);
  console.log(formatValidation(report));
  if (!report.passed) {
    throw new Error('项目校验未通过，已停止渲染。');
  }

  const paths = projectPaths(slug);
  await fs.mkdir(paths.distDirectory, {recursive: true});
  const output = path.join(
    paths.distDirectory,
    mode === 'preview' ? 'preview.mp4' : 'final.mp4',
  );
  const args = [
    'render',
    'src/index.ts',
    'Paper-Collage',
    output,
    `--props=${path.relative(ROOT, paths.projectFile)}`,
  ];
  if (mode === 'preview') {
    args.push('--scale=0.5', '--concurrency=8');
  }
  await runInherited(path.join(ROOT, 'node_modules', '.bin', 'remotion'), args);
  await runInherited(process.execPath, [
    'scripts/project-report.mjs',
    slug,
    `--artifact=${output}`,
  ]);
} catch (error) {
  console.error(`project:${mode ?? 'render'} failed: ${error.message}`);
  process.exitCode = 1;
}
