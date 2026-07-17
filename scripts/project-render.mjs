#!/usr/bin/env node
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ROOT,
  formatValidation,
  loadProject,
  projectPaths,
  resolveRenderConcurrency,
  validateProject,
  writeValidationReport,
} from './project-lib.mjs';
import {assertRenderAllowed, recordRender} from './production-state.mjs';

const [mode, slug] = process.argv.slice(2);

const runInherited = (command, args, {captureOutput = false} = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      stdio: captureOutput ? ['inherit', 'pipe', 'pipe'] : 'inherit',
    });
    let stdout = '';
    let stderr = '';
    if (captureOutput) {
      child.stdout.on('data', (chunk) => {
        process.stdout.write(chunk);
        stdout = `${stdout}${chunk}`.slice(-64 * 1024);
      });
      child.stderr.on('data', (chunk) => {
        process.stderr.write(chunk);
        stderr = `${stderr}${chunk}`.slice(-64 * 1024);
      });
    }
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else {
        const error = new Error(`${command} exited with ${code ?? signal}`);
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      }
    });
  });

const friendlyRenderError = (error) => {
  const evidence = `${error.message}\n${error.stdout ?? ''}\n${error.stderr ?? ''}`;
  if (
    /MachPortRendezvous|Failed to launch the browser process|Permission denied|Operation not permitted|zygote_host/i.test(
      evidence,
    )
  ) {
    return new Error(
      'Remotion 浏览器启动被当前环境权限阻止。请在允许启动 Chromium 子进程的环境中重试同一条 project:preview/project:render 命令；项目状态和已有素材均已保留。',
    );
  }
  return error;
};

try {
  if (!['preview', 'render'].includes(mode)) {
    throw new Error('用法：project-render.mjs <preview|render> <slug>');
  }
  await assertRenderAllowed(slug, mode);
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
    args.push(
      '--scale=0.5',
      `--concurrency=${resolveRenderConcurrency()}`,
    );
  }
  const remotion = path.join(ROOT, 'node_modules', '.bin', 'remotion');
  await runInherited(remotion, ['browser', 'ensure'], {captureOutput: true}).catch(
    (error) => {
      throw friendlyRenderError(error);
    },
  );
  await runInherited(remotion, args, {captureOutput: true}).catch((error) => {
    throw friendlyRenderError(error);
  });
  await runInherited(process.execPath, [
    'scripts/project-report.mjs',
    slug,
    `--artifact=${output}`,
  ]);
  const production = await recordRender(slug, mode);
  console.log(`✓ 生产状态：${production.stage}`);
} catch (error) {
  console.error(`project:${mode ?? 'render'} failed: ${error.message}`);
  process.exitCode = 1;
}
