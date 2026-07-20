#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  PROVIDER_CAPABILITIES,
  inspectProviderReadiness,
  loadProviderConfig,
  resolveProvider,
} from './provider-lib.mjs';
import {resolvePythonCommand} from './python-runtime.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const args = new Set(process.argv.slice(2));
const json = args.has('--json');
const ready = args.has('--ready');
const checks = [];
const commandTimeoutMs = 15000;

const record = (id, status, message, details = null) => {
  checks.push({id, status, message, details});
};

const run = (command, commandArgs) =>
  spawnSync(command, commandArgs, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: commandTimeoutMs,
  });

const commandCheck = (id, command, commandArgs, required = true) => {
  const result = run(command, commandArgs);
  if (result.error || result.status !== 0) {
    record(
      id,
      required ? 'error' : 'warning',
      `${command} 不可用`,
      result.error?.code === 'ETIMEDOUT'
        ? `${command} 检查超过 ${commandTimeoutMs / 1000} 秒，已终止`
        : result.error?.message ?? result.stderr.trim() ?? null,
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
const requiredWorkspaceScripts = [
  'project:new',
  'project:resume',
  'project:composition-proof',
  'project:quality',
  'project:preview',
  'project:render',
];
let workspaceDetails = ROOT;
let workspaceReady = false;
if (fs.existsSync(packageFile)) {
  try {
    const packageJson = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
    const missingScripts = requiredWorkspaceScripts.filter(
      (name) => !packageJson.scripts?.[name],
    );
    workspaceReady = missingScripts.length === 0;
    workspaceDetails = workspaceReady
      ? ROOT
      : `缺少 npm scripts：${missingScripts.join(', ')}`;
  } catch (error) {
    workspaceDetails = `package.json 无效：${error.message}`;
  }
}
record(
  'workspace',
  workspaceReady ? 'ok' : 'error',
  workspaceReady ? '工作区结构存在' : '工作区结构不完整',
  fs.existsSync(packageFile) ? workspaceDetails : '缺少 package.json',
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

const pythonCommand = resolvePythonCommand({root: ROOT});
const pythonAvailable = commandCheck(
  'python',
  pythonCommand,
  ['--version'],
  ready,
);
if (pythonAvailable) {
  const modules = run(pythonCommand, ['-c', 'import numpy; import PIL']);
  record(
    'python-dependencies',
    modules.status === 0 ? 'ok' : ready ? 'error' : 'warning',
    modules.status === 0 ? 'Python 图像依赖已安装' : '缺少 numpy 或 Pillow',
    modules.status === 0
      ? pythonCommand
      : '运行 python3 -m venv .venv && .venv/bin/python -m pip install -r requirements.txt',
  );
}

try {
  const loaded = await loadProviderConfig();
  const providerErrors = loaded.issues.filter(({level}) => level === 'error');
  record(
    'provider-config',
    providerErrors.length === 0 ? 'ok' : 'error',
    providerErrors.length === 0 ? 'Provider 配置有效' : 'Provider 配置无效',
    providerErrors.length
      ? providerErrors.map(({location, message}) => `${location}: ${message}`).join('\n')
      : loaded.sources.filter(({loaded: active}) => active).map(({file}) => path.relative(ROOT, file)).join(', '),
  );
  if (providerErrors.length === 0) {
    for (const capability of PROVIDER_CAPABILITIES) {
      const provider = resolveProvider(loaded.config, capability);
      const readiness = await inspectProviderReadiness(provider);
      record(
        `provider-${capability}`,
        readiness.status === 'error' ? (ready ? 'error' : 'warning') : readiness.status === 'ready' ? 'ok' : 'warning',
        `${capability} provider: ${provider.id} (${provider.adapter})`,
        readiness.message,
      );
    }
  }
} catch (error) {
  record('provider-config', 'error', '无法读取 Provider 配置', error.message);
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
