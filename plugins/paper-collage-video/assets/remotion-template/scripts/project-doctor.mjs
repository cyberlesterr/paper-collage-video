#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const args = new Set(process.argv.slice(2));
const json = args.has('--json');
const ready = args.has('--ready');
const checks = [];

const record = (id, status, message, details = null) => {
  checks.push({id, status, message, details});
};

const run = (command, commandArgs) =>
  spawnSync(command, commandArgs, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

const commandCheck = (id, command, commandArgs, required = true) => {
  const result = run(command, commandArgs);
  if (result.error || result.status !== 0) {
    record(
      id,
      required ? 'error' : 'warning',
      `${command} 不可用`,
      result.error?.message ?? result.stderr.trim() ?? null,
    );
    return false;
  }
  record(id, 'ok', `${command} 可用`, result.stdout.trim() || result.stderr.trim());
  return true;
};

const nodeMajor = Number(process.versions.node.split('.')[0]);
record(
  'node',
  nodeMajor >= 20 ? 'ok' : 'error',
  `Node.js ${process.versions.node}`,
  nodeMajor >= 20 ? null : '需要 Node.js 20 或更高版本',
);

commandCheck('ffmpeg', 'ffmpeg', ['-version']);
commandCheck('ffprobe', 'ffprobe', ['-version']);

const packageFile = path.join(ROOT, 'package.json');
record(
  'workspace',
  fs.existsSync(packageFile) ? 'ok' : 'error',
  fs.existsSync(packageFile) ? '工作区结构存在' : '缺少 package.json',
  ROOT,
);

const remotionBinary = path.join(
  ROOT,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'remotion.cmd' : 'remotion',
);
record(
  'node-dependencies',
  fs.existsSync(remotionBinary) ? 'ok' : ready ? 'error' : 'warning',
  fs.existsSync(remotionBinary) ? 'npm 依赖已安装' : 'npm 依赖尚未安装',
  fs.existsSync(remotionBinary) ? null : '运行 npm ci',
);

const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';
const pythonAvailable = commandCheck(
  'python',
  pythonCommand,
  ['--version'],
  ready,
);
if (pythonAvailable) {
  const virtualPython = path.join(
    ROOT,
    '.venv',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
  );
  const python = fs.existsSync(virtualPython) ? virtualPython : pythonCommand;
  const modules = run(python, ['-c', 'import numpy; import PIL']);
  record(
    'python-dependencies',
    modules.status === 0 ? 'ok' : ready ? 'error' : 'warning',
    modules.status === 0 ? 'Python 图像依赖已安装' : '缺少 numpy 或 Pillow',
    modules.status === 0
      ? python
      : '运行 python3 -m pip install -r requirements.txt，推荐使用 .venv',
  );
}

const summary = {
  root: ROOT,
  ready: !checks.some(({status}) => status === 'error'),
  checks,
};

if (json) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`Paper Collage Video doctor: ${summary.ready ? 'READY' : 'NOT READY'}`);
  for (const check of checks) {
    const symbol = {ok: '✓', warning: '⚠', error: '✗'}[check.status];
    console.log(`${symbol} ${check.message}`);
    if (check.details) console.log(`  ${check.details}`);
  }
}

if (!summary.ready) process.exitCode = 1;
