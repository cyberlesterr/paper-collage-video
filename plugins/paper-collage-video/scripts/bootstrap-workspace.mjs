#!/usr/bin/env node
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

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
const upgrade = rawArgs.includes('--upgrade');
const statusJson = rawArgs.includes('--status-json');
const pluginManifest = JSON.parse(
  await fs.readFile(path.join(PLUGIN_ROOT, '.codex-plugin', 'plugin.json'), 'utf8'),
);

const exists = async (file) => {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
};

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const deepMerge = (base, overlay) => {
  if (!isPlainObject(base) || !isPlainObject(overlay)) return overlay;
  const merged = {...base};
  for (const [key, value] of Object.entries(overlay)) {
    merged[key] =
      isPlainObject(value) && isPlainObject(base[key])
        ? deepMerge(base[key], value)
        : value;
  }
  return merged;
};

const jsonBytes = (value) =>
  `${JSON.stringify(value, null, 2)}\n`;

const MANAGED_REPLACEMENTS = [
  '.gitignore',
  '.paper-collage-template.json',
  'ASSET_LICENSES.md',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
  'package-lock.json',
  'package.json',
  'providers.local.example.json',
  'remotion.config.ts',
  'requirements.txt',
  'runtime-build.json',
  'tsconfig.json',
  'schemas',
  'scripts',
  'src',
  'templates',
  'tests',
  'fixtures',
  'projects/starter-demo',
  'public/fixtures',
  'public/style-catalog',
  'public/textures',
  'public/projects/starter-demo',
  'dist/starter-demo',
];

const workspaceMarkerValue = ({
  current = null,
  now,
  runtimeBuildFingerprint,
}) => ({
  schemaVersion: 2,
  plugin: 'paper-collage-video',
  pluginVersion: pluginManifest.version,
  runtimeBuildFingerprint,
  createdAt: current?.createdAt ?? now,
  ...(current
    ? {
        previousPluginVersion: current.pluginVersion,
        upgradedAt: now,
      }
    : {}),
});

const replaceManagedRuntime = async ({target, marker, currentMarker}) => {
  const parent = path.dirname(target);
  const stage = await fs.mkdtemp(
    path.join(parent, '.paper-collage-video-upgrade-'),
  );
  const stagedRuntime = path.join(stage, 'next');
  const backupRoot = path.join(stage, 'backup');
  const runtimeBuild = JSON.parse(
    await fs.readFile(path.join(TEMPLATE_ROOT, 'runtime-build.json'), 'utf8'),
  );
  const installed = [];
  try {
    for (const relative of MANAGED_REPLACEMENTS) {
      const source = path.join(TEMPLATE_ROOT, relative);
      if (!(await exists(source))) {
        throw new Error(`插件模板缺少受管运行时路径：${relative}`);
      }
      const staged = path.join(stagedRuntime, relative);
      await fs.mkdir(path.dirname(staged), {recursive: true});
      await fs.cp(source, staged, {recursive: true});
    }

    const templateProviders = JSON.parse(
      await fs.readFile(path.join(TEMPLATE_ROOT, 'providers.json'), 'utf8'),
    );
    const currentProviders = (await exists(path.join(target, 'providers.json')))
      ? JSON.parse(
          await fs.readFile(path.join(target, 'providers.json'), 'utf8'),
        )
      : {};
    await fs.mkdir(stagedRuntime, {recursive: true});
    await fs.writeFile(
      path.join(stagedRuntime, 'providers.json'),
      jsonBytes(deepMerge(templateProviders, currentProviders)),
      'utf8',
    );
    const now = new Date().toISOString();
    await fs.writeFile(
      path.join(stagedRuntime, path.basename(marker)),
      jsonBytes(
        workspaceMarkerValue({
          current: currentMarker,
          now,
          runtimeBuildFingerprint: runtimeBuild.fingerprint,
        }),
      ),
      'utf8',
    );

    const replacements = [
      ...MANAGED_REPLACEMENTS,
      'providers.json',
      path.basename(marker),
    ];
    for (const [index, relative] of replacements.entries()) {
      const source = path.join(stagedRuntime, relative);
      const destination = path.join(target, relative);
      const backup = path.join(backupRoot, String(index));
      const existed = await exists(destination);
      await fs.mkdir(path.dirname(destination), {recursive: true});
      if (existed) {
        await fs.mkdir(path.dirname(backup), {recursive: true});
        await fs.rename(destination, backup);
      }
      try {
        await fs.rename(source, destination);
      } catch (error) {
        if (existed && (await exists(backup))) {
          await fs.rename(backup, destination).catch(() => {});
        }
        throw error;
      }
      installed.push({destination, backup, existed});
    }
  } catch (error) {
    for (const item of [...installed].reverse()) {
      await fs.rm(item.destination, {recursive: true, force: true})
        .catch(() => {});
      if (item.existed && (await exists(item.backup))) {
        await fs.mkdir(path.dirname(item.destination), {recursive: true})
          .catch(() => {});
        await fs.rename(item.backup, item.destination).catch(() => {});
      }
    }
    throw error;
  } finally {
    await fs.rm(stage, {recursive: true, force: true}).catch(() => {});
  }
};

const runInherited = (command, args, cwd, environment = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      env: {...process.env, ...environment},
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code ?? signal}`));
    });
  });

const installDependencies = async (target) => {
  const cacheRoot = path.join(target, '.cache');
  const npmCache = path.join(cacheRoot, 'npm');
  const pipCache = path.join(cacheRoot, 'pip');
  await Promise.all([
    fs.mkdir(npmCache, {recursive: true}),
    fs.mkdir(pipCache, {recursive: true}),
  ]);
  await runInherited(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['ci'],
    target,
    {npm_config_cache: npmCache},
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
    {PIP_CACHE_DIR: pipCache},
  );
};

try {
  if (!targetInput) {
    throw new Error(
      '用法：bootstrap-workspace.mjs --target=<absolute-path> [--status-json] [--upgrade] [--install] [--dry-run]',
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
  const currentMarker = (await exists(marker))
    ? JSON.parse(await fs.readFile(marker, 'utf8'))
    : null;
  if (
    currentMarker &&
    (
      currentMarker.plugin !== 'paper-collage-video' ||
      !currentMarker.pluginVersion
      )
  ) {
    throw new Error(`工作区标记无效，拒绝覆盖：${marker}`);
  }
  if (statusJson) {
    const templateRuntime = JSON.parse(
      await fs.readFile(path.join(TEMPLATE_ROOT, 'runtime-build.json'), 'utf8'),
    );
    const workspacePackage = (await exists(path.join(target, 'package.json')))
      ? JSON.parse(
          await fs.readFile(path.join(target, 'package.json'), 'utf8'),
        )
      : null;
    const workspaceRuntime = (
      await exists(path.join(target, 'runtime-build.json'))
    )
      ? JSON.parse(
          await fs.readFile(
            path.join(target, 'runtime-build.json'),
            'utf8',
          ),
        )
      : null;
    const requiredCommands = [
      'project:new',
      'project:resume',
      'project:visual-blueprint',
      'project:visual-review',
      'project:sync-directing',
      'project:preview',
      'project:render',
    ];
    let actualRuntime = null;
    let runtimeInspectionError = null;
    if (workspacePackage && workspaceRuntime) {
      try {
        const runtimeBuildLib = await import(
          pathToFileURL(
            path.join(TEMPLATE_ROOT, 'scripts', 'runtime-build-lib.mjs'),
          ).href,
        );
        actualRuntime = await runtimeBuildLib.createRuntimeBuildManifest({
          root: target,
        });
      } catch (error) {
        runtimeInspectionError = error.message;
      }
    }
    const commands = Object.fromEntries(
      requiredCommands.map((command) => [
        command,
        typeof workspacePackage?.scripts?.[command] === 'string',
      ]),
    );
    const identity = {
      skillVersion: pluginManifest.version,
      installedPluginVersion: pluginManifest.version,
      workspaceMarkerVersion: currentMarker?.pluginVersion ?? null,
      workspacePackageVersion: workspacePackage?.version ?? null,
      workspaceRuntimeBuild: workspaceRuntime
        ? {
            packageVersion: workspaceRuntime.packageVersion,
            fingerprint: workspaceRuntime.fingerprint,
          }
        : null,
      actualRuntimeBuild: actualRuntime
        ? {
            packageVersion: actualRuntime.packageVersion,
            fingerprint: actualRuntime.fingerprint,
          }
        : null,
      packagedRuntimeBuild: {
        packageVersion: templateRuntime.packageVersion,
        fingerprint: templateRuntime.fingerprint,
      },
    };
    const compatible =
      identity.workspaceMarkerVersion === pluginManifest.version &&
      identity.workspacePackageVersion === pluginManifest.version &&
      identity.workspaceRuntimeBuild?.packageVersion ===
        pluginManifest.version &&
      identity.workspaceRuntimeBuild?.fingerprint ===
        templateRuntime.fingerprint &&
      identity.actualRuntimeBuild?.fingerprint ===
        templateRuntime.fingerprint &&
      Object.values(commands).every(Boolean);
    console.log(
      JSON.stringify(
        {
          schemaVersion: 1,
          target,
          compatible,
          identity,
          commands,
          runtimeInspectionError,
          upgradeCommand:
            `node ${path.join(PLUGIN_ROOT, 'scripts', 'bootstrap-workspace.mjs')} ` +
            `--target=${target} --upgrade`,
          preserves: [
            'projects except starter-demo',
            'public/projects except starter-demo',
            'dist except starter-demo',
            'providers.local.json',
            'dependency caches and unrelated user files',
          ],
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }
  const versionChanged =
    currentMarker?.pluginVersion !== undefined &&
    currentMarker.pluginVersion !== pluginManifest.version;
  if (versionChanged && !upgrade) {
    throw new Error(
      `工作区运行时为 ${currentMarker.pluginVersion}，当前插件为 ${pluginManifest.version}；` +
        `请显式运行 --upgrade。用户 projects、public/projects、dist（starter-demo 除外）和 providers.local.json 会被保留。`,
    );
  }

  console.log(`插件：${PLUGIN_ROOT}`);
  console.log(`工作区：${target}`);
  if (dryRun) {
    console.log(
      currentMarker
        ? `✓ dry-run：将${upgrade ? '升级受管运行时' : '保留当前工作区'}，未写入文件`
        : '✓ dry-run：将创建工作区，未写入文件',
    );
    process.exit(0);
  }

  if (!(await exists(marker))) {
    await fs.mkdir(target, {recursive: true});
    await fs.cp(TEMPLATE_ROOT, target, {recursive: true, errorOnExist: true});
    await fs.writeFile(
      marker,
      jsonBytes(
        workspaceMarkerValue({
          now: new Date().toISOString(),
          runtimeBuildFingerprint: JSON.parse(
            await fs.readFile(
              path.join(TEMPLATE_ROOT, 'runtime-build.json'),
              'utf8',
            ),
          ).fingerprint,
        }),
      ),
      'utf8',
    );
    console.log('✓ Remotion 工作区已创建');
  } else if (upgrade) {
    await replaceManagedRuntime({
      target,
      marker,
      currentMarker,
    });
    console.log(
      `✓ 受管运行时已升级：${currentMarker.pluginVersion} → ${pluginManifest.version}`,
    );
    console.log(
      '✓ 已保留用户项目、项目素材、非 starter-demo 输出、providers.local.json、依赖缓存和其他用户文件',
    );
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
