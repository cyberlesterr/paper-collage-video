import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {
  deepMerge,
  expandCommandTemplate,
  recordAssetProvenance,
  resolveConfirmedProvider,
  runProviderCommand,
  validateProviderConfig,
} from '../scripts/provider-lib.mjs';
import {
  deriveContactSheetSamples,
  inspectCharacterPng,
} from '../scripts/project-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('provider overlays add local adapters without replacing bundled providers', () => {
  const base = {
    schemaVersion: 1,
    capabilities: {
      text: {
        defaultProvider: 'host-text',
        providers: {
          'host-text': {label: 'Host text', adapter: 'host'},
        },
      },
      image: {
        defaultProvider: 'host-image',
        providers: {
          'host-image': {label: 'Host image', adapter: 'host'},
        },
      },
      voice: {
        defaultProvider: 'host-voice',
        providers: {
          'host-voice': {label: 'Host voice', adapter: 'host'},
        },
      },
    },
  };
  const overlay = {
    schemaVersion: 1,
    capabilities: {
      image: {
        defaultProvider: 'custom-image',
        providers: {
          'custom-image': {
            label: 'Custom image',
            adapter: 'command',
            requiredEnv: ['IMAGE_API_KEY'],
            command: {
              executable: 'node',
              args: ['adapter.mjs', '--output={output}'],
            },
          },
        },
      },
    },
  };
  const merged = deepMerge(base, overlay);
  assert.equal(merged.capabilities.image.defaultProvider, 'custom-image');
  assert.equal(merged.capabilities.image.providers['host-image'].adapter, 'host');
  assert.equal(merged.capabilities.image.providers['custom-image'].adapter, 'command');
  assert.equal(merged.capabilities.text.defaultProvider, 'host-text');
  assert.equal(merged.capabilities.voice.defaultProvider, 'host-voice');
  assert.deepEqual(validateProviderConfig(merged), []);
  assert.throws(
    () => resolveConfirmedProvider(merged, 'image'),
    /尚未获得用户确认/,
  );
  const confirmed = deepMerge(merged, {
    capabilities: {
      image: {
        selection: {
          status: 'confirmed',
          provider: 'custom-image',
          confirmedAt: '2026-07-17T00:00:00.000Z',
          scope: 'project',
          note: 'Use custom image',
        },
      },
    },
  });
  assert.equal(resolveConfirmedProvider(confirmed, 'image').id, 'custom-image');
  assert.throws(
    () => resolveConfirmedProvider(confirmed, 'image', 'host-image'),
    /未获授权/,
  );
  const unsafe = deepMerge(merged, {
    capabilities: {
      image: {providers: {'custom-image': {apiKey: 'do-not-store-this'}}},
    },
  });
  assert.ok(
    validateProviderConfig(unsafe).some(({code}) => code === 'provider-secret'),
  );
});

test('command templates expand paths without invoking a shell', () => {
  const expanded = expandCommandTemplate(
    '--output={output};literal=$HOME;unknown={missing}',
    {output: '/tmp/a file.png'},
  );
  assert.equal(expanded, '--output=/tmp/a file.png;literal=$HOME;unknown={missing}');
});

test('command adapters write a local output and provenance records its hash', async () => {
  const slug = `provider-test-${process.pid}`;
  const projectDirectory = path.join(ROOT, 'projects', slug);
  const output = path.join(projectDirectory, 'generated.txt');
  try {
    await fsp.mkdir(projectDirectory, {recursive: true});
    await runProviderCommand(
      process.execPath,
      [
        '-e',
        'require("node:fs").writeFileSync(process.argv[1], "adapter output")',
        output,
      ],
      {cwd: ROOT, timeoutSeconds: 5, stdio: 'pipe'},
    );
    const recorded = await recordAssetProvenance({
      request: {
        schemaVersion: 1,
        projectSlug: slug,
        assetId: 'draft-script',
        capability: 'text',
        output: path.relative(ROOT, output),
        prompt: 'Write a short story.',
      },
      output,
      provider: {id: 'test-command', adapter: 'command', model: 'test-model'},
      externalId: 'job-123',
    });
    assert.equal(recorded.record.sizeBytes, 14);
    assert.match(recorded.record.sha256, /^[a-f0-9]{64}$/);
    assert.equal(recorded.record.externalId, 'job-123');
    assert.equal(recorded.record.capability, 'text');
    const manifest = JSON.parse(await fsp.readFile(recorded.manifestFile, 'utf8'));
    assert.equal(manifest.assets[0].assetId, 'draft-script');
  } finally {
    await fsp.rm(projectDirectory, {recursive: true, force: true});
  }
});

test('bundled provider status is valid and defers host capability selection', () => {
  const result = spawnSync(
    process.execPath,
    [path.join(ROOT, 'scripts', 'provider-status.mjs'), '--json'],
    {cwd: ROOT, encoding: 'utf8'},
  );
  assert.equal(result.status, 0, result.stderr);
  const status = JSON.parse(result.stdout);
  assert.equal(status.valid, true);
  assert.equal(status.allConfirmed, false);
  assert.equal(status.capabilities.text.readiness.status, 'agent-check-required');
  assert.equal(status.capabilities.image.readiness.status, 'agent-check-required');
  assert.equal(status.capabilities.voice.readiness.status, 'agent-check-required');
  assert.ok(
    status.capabilities.image.candidates.some(({id}) => id === 'manual-image'),
  );
});

test('new projects wait for confirmed providers before entering the brief', async () => {
  const slug = `v2-smoke-${process.pid}`;
  const projectDirectory = path.join(ROOT, 'projects', slug);
  const publicDirectory = path.join(ROOT, 'public', 'projects', slug);
  try {
    const result = spawnSync(
      process.execPath,
      [path.join(ROOT, 'scripts', 'project-new.mjs'), slug, '--title=V2 Smoke'],
      {cwd: ROOT, encoding: 'utf8'},
    );
    assert.equal(result.status, 0, result.stderr);
    const project = JSON.parse(
      await fsp.readFile(path.join(projectDirectory, 'project.json'), 'utf8'),
    );
    const manifest = JSON.parse(
      await fsp.readFile(
        path.join(projectDirectory, 'assets-manifest.json'),
        'utf8',
      ),
    );
    assert.equal(project.voice.provider, 'auto');
    assert.equal(project.voice.profile, 'warm-storyteller');
    assert.equal(manifest.projectSlug, slug);
    assert.deepEqual(manifest.assets, []);
    assert.ok(fs.existsSync(path.join(projectDirectory, 'providers.json')));
    assert.ok(fs.existsSync(path.join(projectDirectory, 'requests', '.gitkeep')));

    const initialProduction = JSON.parse(
      await fsp.readFile(path.join(projectDirectory, 'production.json'), 'utf8'),
    );
    assert.equal(initialProduction.stage, 'capability-review');

    const blockedAdvance = spawnSync(
      process.execPath,
      [
        path.join(ROOT, 'scripts', 'project-advance.mjs'),
        slug,
        'capabilities-ready',
        '--note=Try to continue without provider choices',
      ],
      {cwd: ROOT, encoding: 'utf8'},
    );
    assert.notEqual(blockedAdvance.status, 0);
    assert.match(blockedAdvance.stderr, /尚未获得用户确认/);

    const select = (...selectionArgs) =>
      spawnSync(
        process.execPath,
        [path.join(ROOT, 'scripts', 'provider-select.mjs'), slug, ...selectionArgs],
        {cwd: ROOT, encoding: 'utf8'},
      );
    const invalidSelection = select(
      'text',
      'host-text',
      '--adapter=command',
      '--note=Invalid adapter override',
    );
    assert.notEqual(invalidSelection.status, 0);
    assert.match(invalidSelection.stderr, /command adapter 必须配置/);
    const untouchedOverlay = JSON.parse(
      await fsp.readFile(path.join(projectDirectory, 'providers.json'), 'utf8'),
    );
    assert.equal(untouchedOverlay.capabilities, undefined);

    const textSelection = select(
      'text',
      'host-text',
      '--note=Use the host language model',
    );
    assert.equal(textSelection.status, 0, textSelection.stderr);
    const imageSelection = select(
      'image',
      'gpt-image',
      '--label=GPT Image',
      '--adapter=host',
      '--tool=image_gen__imagegen',
      '--model=gpt-image',
      '--note=Use the detected GPT Image capability',
    );
    assert.equal(imageSelection.status, 0, imageSelection.stderr);
    const voiceSelection = select(
      'voice',
      'manual-voice',
      '--note=Import authorized fictional narration',
    );
    assert.equal(voiceSelection.status, 0, voiceSelection.stderr);

    const statusResult = spawnSync(
      process.execPath,
      [path.join(ROOT, 'scripts', 'provider-status.mjs'), slug, '--json'],
      {cwd: ROOT, encoding: 'utf8'},
    );
    assert.equal(statusResult.status, 0, statusResult.stderr);
    const providerStatus = JSON.parse(statusResult.stdout);
    assert.equal(providerStatus.allConfirmed, true);
    assert.equal(providerStatus.capabilities.image.provider.tool, 'image_gen__imagegen');

    const advance = spawnSync(
      process.execPath,
      [
        path.join(ROOT, 'scripts', 'project-advance.mjs'),
        slug,
        'capabilities-ready',
        '--note=Confirmed host text and image plus manual fictional narration',
      ],
      {cwd: ROOT, encoding: 'utf8'},
    );
    assert.equal(advance.status, 0, advance.stderr);
    const production = JSON.parse(
      await fsp.readFile(path.join(projectDirectory, 'production.json'), 'utf8'),
    );
    assert.equal(production.stage, 'brief');
  } finally {
    await fsp.rm(projectDirectory, {recursive: true, force: true});
    await fsp.rm(publicDirectory, {recursive: true, force: true});
  }
});

test('contact sheet sampling covers the front and back of every short project scene', () => {
  const timeline = {
    scenes: [
      {id: 'one', label: '第一幕', from: 0, durationInFrames: 90},
      {id: 'two', label: '第二幕', from: 78, durationInFrames: 120},
      {id: 'three', label: '第三幕', from: 186, durationInFrames: 75},
    ],
  };
  const samples = deriveContactSheetSamples({
    timeline,
    fps: 30,
    durationSeconds: 8.7,
  });
  assert.equal(samples.length, 6);
  assert.deepEqual(
    samples.map(({sceneId}) => sceneId),
    ['one', 'one', 'two', 'two', 'three', 'three'],
  );
  assert.ok(samples.every(({time}) => time >= 0 && time < 8.7));
});

test('generic chroma key removes magenta while preserving an opaque green subject', async (t) => {
  const virtualPython = path.join(
    ROOT,
    '.venv',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
  );
  const python = fs.existsSync(virtualPython)
    ? virtualPython
    : process.platform === 'win32'
      ? 'python'
      : 'python3';
  const dependencyCheck = spawnSync(python, ['-c', 'import numpy; import PIL'], {
    encoding: 'utf8',
    timeout: 8000,
  });
  if (dependencyCheck.status !== 0) {
    t.skip('numpy and Pillow are not installed');
    return;
  }

  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'paper-key-test-'));
  const input = path.join(directory, 'magenta.png');
  const output = path.join(directory, 'alpha.png');
  const metadata = path.join(directory, 'alpha.key.json');
  try {
    const subject = await sharp({
      create: {width: 40, height: 40, channels: 3, background: '#00cc33'},
    })
      .png()
      .toBuffer();
    await sharp({
      create: {width: 80, height: 80, channels: 3, background: '#ff00ff'},
    })
      .composite([{input: subject, left: 20, top: 20}])
      .png()
      .toFile(input);
    const result = spawnSync(
      python,
      [
        path.join(ROOT, 'scripts', 'remove_chroma_key.py'),
        '--input',
        input,
        '--out',
        output,
        '--key-color',
        'auto',
        '--matte-erode',
        '1',
        '--metadata',
        metadata,
        '--force',
      ],
      {encoding: 'utf8', timeout: 10000},
    );
    assert.equal(result.status, 0, result.stderr);
    const {data, info} = await sharp(output)
      .ensureAlpha()
      .raw()
      .toBuffer({resolveWithObject: true});
    const pixel = (x, y) => {
      const offset = (y * info.width + x) * info.channels;
      return [...data.subarray(offset, offset + info.channels)];
    };
    assert.equal(pixel(0, 0)[3], 0);
    const center = pixel(40, 40);
    assert.ok(center[1] > 190, `green subject was damaged: ${center}`);
    assert.ok(center[3] > 250, `center alpha was eroded: ${center}`);
    const inspection = await inspectCharacterPng(output);
    assert.match(inspection.keyColor, /^#f[0-9a-f]0[0-9a-f]f[0-9a-f]$/i);
    assert.ok(inspection.keyEdgeRatio < 0.2, inspection);
    assert.ok(fs.existsSync(metadata));
  } finally {
    await fsp.rm(directory, {recursive: true, force: true});
  }
});
