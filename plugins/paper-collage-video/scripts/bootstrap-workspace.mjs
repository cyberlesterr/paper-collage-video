#!/usr/bin/env node
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(SCRIPT_DIR, '..');
const TEMPLATE_ROOT = path.join(PLUGIN_ROOT, 'assets', 'remotion-template');
const rawArgs = process.argv.slice(2);
const valueFor = (name) =>
  rawArgs.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1);
const positionalTarget = rawArgs.find((value) => !value.startsWith('--'));
const targetInput = valueFor('--target') ?? positionalTarget;
const dryRun = rawArgs.includes('--dry-run');
const install = rawArgs.includes('--install');

const exists = async (file) => {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
};

const runInherited = (command, args, cwd) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {cwd, stdio: 'inherit'});
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code ?? signal}`));
    });
  });

const installDependencies = async (target) => {
  await runInherited(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['ci'],
    target,
  );

  const python = process.platform === 'win32' ? 'python' : 'python3';
  await runInherited(python, ['-m', 'venv', '.venv'], target);
  const virtualPython = path.join(
    target,
    '.venv',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
  );
  await runInherited(
    virtualPython,
    ['-m', 'pip', 'install', '-r', 'requirements.txt'],
    target,
  );
};

try {
  if (!targetInput) {
    throw new Error(
      '用法：bootstrap-workspace.mjs --target=<absolute-path> [--install] [--dry-run]',
    );
  }
  if (!(await exists(path.join(TEMPLATE_ROOT, '.paper-collage-template.json')))) {
    throw new Error('插件缺少内置 Remotion 模板；请重新安装插件。');
  }

  const target = path.resolve(targetInput);
  const marker = path.join(target, '.paper-collage-video-workspace.json');
  const targetExists = await exists(target);
  const entries = targetExists ? await fs.readdir(target) : [];
  if (entries.length > 0 && !(await exists(marker))) {
    throw new Error(`目标目录不是纸片视频工作区且不为空：${target}`);
  }

  console.log(`插件：${PLUGIN_ROOT}`);
  console.log(`工作区：${target}`);
  if (dryRun) {
    console.log('✓ dry-run：未写入文件');
    process.exit(0);
  }

  if (!(await exists(marker))) {
    await fs.mkdir(target, {recursive: true});
    await fs.cp(TEMPLATE_ROOT, target, {recursive: true, errorOnExist: true});
    await fs.writeFile(
      marker,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          plugin: 'paper-collage-video',
          pluginVersion: '0.4.0',
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    console.log('✓ Remotion 工作区已创建');
  } else {
    console.log('✓ 已存在纸片视频工作区；保留现有文件');
  }

  if (install) {
    await installDependencies(target);
    await runInherited(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['run', 'doctor', '--', '--ready'],
      target,
    );
  } else {
    console.log('下一步：npm ci');
    console.log('下一步：python3 -m venv .venv && .venv/bin/python -m pip install -r requirements.txt');
    console.log('下一步：npm run doctor -- --ready');
  }
} catch (error) {
  console.error(`bootstrap failed: ${error.message}`);
  process.exitCode = 1;
}
