import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN_ROOT = path.join(ROOT, 'plugins', 'paper-collage-video');
const RUNTIME_ROOT = path.join(PLUGIN_ROOT, 'assets', 'remotion-template');

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

test('repository marketplace exposes the paper collage plugin', () => {
  const marketplace = readJson(
    path.join(ROOT, '.agents', 'plugins', 'marketplace.json'),
  );
  assert.equal(marketplace.name, 'paper-collage-video');
  assert.equal(marketplace.plugins.length, 1);
  assert.deepEqual(marketplace.plugins[0], {
    name: 'paper-collage-video',
    source: {source: 'local', path: './plugins/paper-collage-video'},
    policy: {installation: 'AVAILABLE', authentication: 'ON_INSTALL'},
    category: 'Creativity',
  });
});

test('plugin manifest points at a complete packaged skill', () => {
  const manifest = readJson(
    path.join(PLUGIN_ROOT, '.codex-plugin', 'plugin.json'),
  );
  assert.equal(manifest.name, 'paper-collage-video');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.skills, './skills/');
  assert.ok(manifest.interface.defaultPrompt.length > 0);

  const skillFile = path.join(
    PLUGIN_ROOT,
    'skills',
    'make-paper-collage-video',
    'SKILL.md',
  );
  assert.ok(fs.existsSync(skillFile));
  assert.match(fs.readFileSync(skillFile, 'utf8'), /references\/setup\.md/);
  assert.ok(
    fs.existsSync(
      path.join(
        PLUGIN_ROOT,
        'skills',
        'make-paper-collage-video',
        'references',
        'setup.md',
      ),
    ),
  );
});

test('packaged runtime is lightweight and independent from production projects', () => {
  const packageJson = readJson(path.join(RUNTIME_ROOT, 'package.json'));
  assert.equal(packageJson.name, 'paper-collage-video-workspace');
  assert.equal(packageJson.scripts.doctor, 'node scripts/project-doctor.mjs');
  assert.ok(fs.existsSync(path.join(RUNTIME_ROOT, 'projects', 'starter-demo')));
  assert.equal(fs.existsSync(path.join(RUNTIME_ROOT, 'projects', 'tang-demo')), false);
  assert.equal(
    fs.existsSync(path.join(RUNTIME_ROOT, 'projects', 'xuanzang-westward')),
    false,
  );

  for (const relative of [
    'scripts/production-state.mjs',
    'schemas/project.schema.json',
    'templates/project/production.json',
  ]) {
    assert.equal(
      fs.readFileSync(path.join(RUNTIME_ROOT, relative), 'utf8'),
      fs.readFileSync(path.join(ROOT, relative), 'utf8'),
      `${relative} must be resynced with npm run plugin:sync`,
    );
  }
});

test('bootstrap creates an isolated resumable workspace and is idempotent', async () => {
  const target = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'paper-collage-plugin-test-'),
  );
  const bootstrap = path.join(PLUGIN_ROOT, 'scripts', 'bootstrap-workspace.mjs');
  try {
    const first = spawnSync(
      process.execPath,
      [bootstrap, `--target=${target}`],
      {cwd: ROOT, encoding: 'utf8'},
    );
    assert.equal(first.status, 0, first.stderr);
    assert.ok(
      fs.existsSync(path.join(target, '.paper-collage-video-workspace.json')),
    );
    assert.equal(
      readJson(path.join(target, 'package.json')).name,
      'paper-collage-video-workspace',
    );

    const second = spawnSync(
      process.execPath,
      [bootstrap, `--target=${target}`],
      {cwd: ROOT, encoding: 'utf8'},
    );
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /保留现有文件/);
  } finally {
    await fsp.rm(target, {recursive: true, force: true});
  }
});

test('bootstrap refuses to overwrite an unrelated non-empty directory', async () => {
  const target = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'paper-collage-plugin-foreign-'),
  );
  const bootstrap = path.join(PLUGIN_ROOT, 'scripts', 'bootstrap-workspace.mjs');
  try {
    await fsp.writeFile(path.join(target, 'user-file.txt'), 'keep me', 'utf8');
    const result = spawnSync(
      process.execPath,
      [bootstrap, `--target=${target}`],
      {cwd: ROOT, encoding: 'utf8'},
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /目标目录不是纸片视频工作区且不为空/);
    assert.equal(
      await fsp.readFile(path.join(target, 'user-file.txt'), 'utf8'),
      'keep me',
    );
  } finally {
    await fsp.rm(target, {recursive: true, force: true});
  }
});
