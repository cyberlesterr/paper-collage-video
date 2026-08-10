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
  assertAssetManifest,
  transitionAssetLifecycle,
} from '../scripts/asset-manifest-lib.mjs';
import {
  deepMerge,
  expandCommandTemplate,
  loadAssetRequest,
  recordAssetProvenance,
  refreshActiveCompositionFamilyFingerprints,
  resolveConfirmedProvider,
  runProviderCommand,
  validateAssetRequest,
  validateProviderConfig,
  verifyOutputFile,
} from '../scripts/provider-lib.mjs';
import {
  loadStyleCatalog,
  materializeStyleProfile,
  styleProfileBinding,
} from '../scripts/style-catalog-lib.mjs';
import {
  countProviderGeneratedImages,
  deriveContactSheetSamples,
  inspectCharacterPng,
  resolveRenderConcurrency,
} from '../scripts/project-lib.mjs';
import {createEditorialFixture} from '../fixtures/editorial-fixture.mjs';
import {createMotionDirectionFixture} from '../fixtures/motion-contract-fixture.mjs';
import {
  requiredProviderCapabilitiesForProject,
  writeSoundEffectPlan,
} from '../scripts/sound-effect-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STYLE_REQUEST = {
  styleProfileBinding: {
    schemaVersion: 1,
    id: 'hand-drawn-cutout-explainer',
    catalogVersion: 'fixture',
    profileFingerprint: 'a'.repeat(64),
    directives: ['fixture ink', 'fixture paper', 'Avoid: fixture gloss'],
  },
  quality: {
    requiredChecks: ['style-profile-conformant'],
  },
};

test('sound plans deduplicate provider requests and remove superseded cues', async () => {
  const slug = `sound-plan-${process.pid}`;
  const projectDirectory = path.join(ROOT, 'projects', slug);
  const assetId = 'sfx-paper-tap-fixture';
  const soundEffect = (sceneId) => ({
    id: `${sceneId}-tap-sound`,
    sceneId,
    beatId: 'tap',
    targetId: 'paper-prop',
    cue: 'paper tap',
    at: 0.5,
    proofTimeId: `${sceneId}-proof-tap`,
    assetId,
    output: `public/projects/${slug}/audio/sfx/${assetId}.wav`,
  });
  try {
    const storyboard = {
      slug,
      scenes: ['scene-01', 'scene-02'].map((sceneId) => ({
        compositionPlan: {
          soundEffects: [soundEffect(sceneId)],
        },
      })),
    };
    const written = await writeSoundEffectPlan(storyboard);
    assert.equal(written.plan.requiredSoundEffectCount, 1);
    assert.equal(written.requests.length, 1);
    assert.deepEqual(
      await requiredProviderCapabilitiesForProject(slug),
      ['text', 'image', 'voice', 'sound'],
    );
    const requestFile = path.join(
      projectDirectory,
      'requests',
      `${assetId}.json`,
    );
    const request = JSON.parse(await fsp.readFile(requestFile, 'utf8'));
    assert.doesNotThrow(() => validateAssetRequest(request));
    assert.equal(request.soundBinding.bindings.length, 2);

    const cleared = await writeSoundEffectPlan({slug, scenes: []});
    assert.deepEqual(cleared.removedRequests, [
      `projects/${slug}/requests/${assetId}.json`,
    ]);
    assert.equal(fs.existsSync(requestFile), false);
    assert.deepEqual(
      await requiredProviderCapabilitiesForProject(slug),
      ['text', 'image', 'voice'],
    );
  } finally {
    await fsp.rm(projectDirectory, {recursive: true, force: true});
  }
});

test('asset lifecycle preserves audit records and enforces one active record', () => {
  const record = (recordId, status) => ({
    recordId,
    assetId: 'hero',
    lifecycle: {status, changedAt: '2026-07-23T00:00:00.000Z', reason: 'fixture', supersededBy: null},
  });
  const manifest = {
    schemaVersion: 4,
    projectSlug: 'lifecycle-fixture',
    assets: [record('1'.repeat(64), 'active')],
  };
  assert.doesNotThrow(() => assertAssetManifest(manifest, 'lifecycle-fixture'));
  transitionAssetLifecycle(manifest, 'hero', 'rejected', {reason: 'human rejected'});
  assert.equal(manifest.assets[0].lifecycle.status, 'rejected');
  transitionAssetLifecycle(manifest, 'hero', 'active', {reason: 'human restored'});
  assert.equal(manifest.assets[0].lifecycle.status, 'active');
  manifest.assets.push(record('2'.repeat(64), 'active'));
  assert.throws(() => assertAssetManifest(manifest, 'lifecycle-fixture'), /多个 active/);
});

test('provider recording preserves authoritative registered-family fingerprints', () => {
  const registeredFingerprint = 'f'.repeat(64);
  const compositionBinding = {
    pattern: 'registered-depth-stack',
    registrationId: 'stone-stack',
    sourceMasterAssetId: 'stone-sheet',
    canvas: {width: 960, height: 540},
  };
  const active = (assetId, extra = {}) => ({
    assetId,
    sha256: assetId.padEnd(64, '0').slice(0, 64),
    requestFingerprint: assetId.padStart(64, '1').slice(0, 64),
    compositionBinding,
    stateBinding: null,
    familyFingerprint: null,
    lifecycle: {
      status: 'active',
      changedAt: '2026-01-01T00:00:00.000Z',
      reason: 'fixture',
      supersededBy: null,
    },
    ...extra,
  });
  const manifest = {
    assets: [
      active('stone-sheet'),
      active('stone-rear', {
        registeredFamilyBinding: {
          familyFingerprint: registeredFingerprint,
        },
        familyFingerprint: registeredFingerprint,
      }),
    ],
  };
  refreshActiveCompositionFamilyFingerprints(manifest);
  assert.equal(
    manifest.assets.find(({assetId}) => assetId === 'stone-rear')
      .familyFingerprint,
    registeredFingerprint,
  );
  assert.match(
    manifest.assets.find(({assetId}) => assetId === 'stone-sheet')
      .familyFingerprint,
    /^[a-f0-9]{64}$/,
  );
});

test('manual image imports record provenance without a generation attempt', async () => {
  const slug = `manual-image-import-${process.pid}-${Date.now()}`;
  const projectDirectory = path.join(ROOT, 'projects', slug);
  const publicDirectory = path.join(ROOT, 'public', 'projects', slug);
  const output = path.join(publicDirectory, 'manual.png');
  try {
    await fsp.mkdir(projectDirectory, {recursive: true});
    await fsp.mkdir(publicDirectory, {recursive: true});
    await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 4,
        background: {r: 18, g: 42, b: 73, alpha: 1},
      },
    }).png().toFile(output);
    const result = await recordAssetProvenance({
      request: {
        schemaVersion: 8,
        projectSlug: slug,
        assetId: 'manual-source',
        capability: 'image',
        ...STYLE_REQUEST,
        output: path.relative(ROOT, output),
        prompt: 'Import the already-authorized local source.',
        outputSurface: {mode: 'opaque'},
        compositionBinding: {
          sceneId: 'scene-01',
          nodeId: 'manual-source',
          pattern: 'free',
          canvas: {width: 8, height: 8},
          derivation: {
            method: 'manual-import',
            parentAssetId: 'authorized-source',
          },
        },
      },
      output,
      provider: {
        id: 'manual-image',
        label: 'Authorized local image',
        adapter: 'manual',
        tool: null,
        model: null,
      },
      externalId: 'local-source-fixture',
    });
    assert.equal(result.record.adapter, 'manual');
    assert.equal(result.record.attemptId, null);
    assert.equal(result.record.externalId, 'local-source-fixture');
    const manifest = JSON.parse(
      await fsp.readFile(path.join(projectDirectory, 'assets-manifest.json'), 'utf8'),
    );
    assert.equal(manifest.assets.length, 1);
    assert.equal(manifest.assets[0].lifecycle.status, 'active');
  } finally {
    await fsp.rm(projectDirectory, {recursive: true, force: true});
    await fsp.rm(publicDirectory, {recursive: true, force: true});
  }
});

const storyboardInput = ({slug, sceneCount, durationSeconds}) => ({
  schemaVersion: 12,
  slug,
  arc: 'A concise progression from setup through action to resolution.',
  style: {
    visualThesis: 'Layered paper depth carries the story.',
    compositionRules: ['Keep the subject clear of subtitle space.'],
    layerStrategy: 'Background establishes place; cutouts carry action.',
  },
  motionDirection: createMotionDirectionFixture(),
  scenes: Array.from({length: sceneCount}, (_, index) => ({
    id: `scene-${String(index + 1).padStart(2, '0')}`,
    title: `Scene ${index + 1}`,
    narrativeRole: index === 0 ? 'setup' : index === sceneCount - 1 ? 'resolution' : 'development',
    message: `Narrative beat ${index + 1}`,
    blueprint: index === sceneCount - 1 ? 'quiet-lockup' : 'layered-reveal',
    estimatedDurationSeconds: durationSeconds / sceneCount,
    beats: [
      {id: `s${index + 1}-establish`, at: 0, performanceRole: 'establish', purpose: 'establish', visual: 'Reveal the paper stage', soundCue: null, proofTimeId: `s${index + 1}-proof-establish`, treatments: [{id: `s${index + 1}-establish-hold`, targetId: 'stage', importance: 'supporting', necessity: 'required', changeClass: 'static-hold', motion: {kind: 'static'}, composition: {pattern: 'free'}, graphic: null, semanticRisk: 'decorative', proofTimeId: `s${index + 1}-proof-establish`, rationale: 'Hold a readable opening composition.'}]},
      {id: `s${index + 1}-action`, at: 0.5, performanceRole: 'action', purpose: 'develop', visual: 'Move the main cutout', soundCue: null, proofTimeId: `s${index + 1}-proof-action`, treatments: [{id: `s${index + 1}-action-hold`, targetId: 'subject', importance: 'hero', necessity: 'required', changeClass: 'static-hold', motion: {kind: 'static'}, composition: {pattern: 'free'}, graphic: null, semanticRisk: 'decorative', proofTimeId: `s${index + 1}-proof-action`, rationale: 'Keep the action target readable in this integration fixture.'}]},
      {id: `s${index + 1}-settle`, at: 0.9, performanceRole: 'settle', purpose: 'resolve', visual: 'Lock the composition', soundCue: null, proofTimeId: `s${index + 1}-proof-final`, treatments: [{id: `s${index + 1}-settle-hold`, targetId: 'subject', importance: 'supporting', necessity: 'required', changeClass: 'static-hold', motion: {kind: 'static'}, composition: {pattern: 'free'}, graphic: null, semanticRisk: 'decorative', proofTimeId: `s${index + 1}-proof-final`, rationale: 'Settle the final composition.'}]},
    ],
    proofTimes: [
      {id: `s${index + 1}-proof-establish`, at: 0.08, label: 'Establish', kind: 'establish', assertions: ['World is readable'], stateAssertions: []},
      {id: `s${index + 1}-proof-action`, at: 0.5, label: 'Action', kind: 'peak', assertions: ['Action is visible'], stateAssertions: []},
      {id: `s${index + 1}-proof-final`, at: 0.9, label: 'Resolved', kind: 'final', assertions: ['Final composition is stable'], stateAssertions: []},
    ],
  })),
  editorial: createEditorialFixture({
    sceneIds: Array.from(
      {length: sceneCount},
      (_, index) => `scene-${String(index + 1).padStart(2, '0')}`,
    ),
    durationSeconds,
  }),
  sceneTransitions: Array.from({length: Math.max(0, sceneCount - 1)}, (_, index) => ({
    id: `scene-${String(index + 1).padStart(2, '0')}-to-scene-${String(index + 2).padStart(2, '0')}`,
    fromSceneId: `scene-${String(index + 1).padStart(2, '0')}`,
    toSceneId: `scene-${String(index + 2).padStart(2, '0')}`,
    intent: 'continuity',
    rationale: 'Keep the synthetic fixture moving through one continuous story.',
  })),
});

const writeAndLockStoryboard = async ({slug, projectDirectory, sceneCount, durationSeconds}) => {
  const input = path.join(projectDirectory, 'storyboard-input.json');
  await fsp.writeFile(input, `${JSON.stringify(storyboardInput({slug, sceneCount, durationSeconds}), null, 2)}\n`, 'utf8');
  return spawnSync(
    process.execPath,
    [path.join(ROOT, 'scripts', 'project-storyboard.mjs'), slug, `--input=${path.relative(ROOT, input)}`],
    {cwd: ROOT, encoding: 'utf8'},
  );
};

test('preview rendering caps concurrency at available CPU capacity', () => {
  assert.equal(resolveRenderConcurrency(16, 8, undefined), 8);
  assert.equal(resolveRenderConcurrency(8, 8, undefined), 8);
  assert.equal(resolveRenderConcurrency(4, 8, undefined), 4);
  assert.equal(resolveRenderConcurrency(1, 8, undefined), 1);
  assert.equal(resolveRenderConcurrency(0, 8, undefined), 1);
});

test('preview rendering accepts a bounded explicit concurrency override', () => {
  assert.equal(resolveRenderConcurrency(16, 8, '1'), 1);
  assert.equal(resolveRenderConcurrency(16, 8, '4'), 4);
  assert.equal(resolveRenderConcurrency(16, 8, '12'), 8);
  assert.throws(
    () => resolveRenderConcurrency(16, 8, '0'),
    /positive integer/,
  );
  assert.throws(
    () => resolveRenderConcurrency(16, 8, 'many'),
    /positive integer/,
  );
});

test('generated-image budgets exclude deterministic derivatives and manual SVG assets', () => {
  const image = (method) => ({
    capability: 'image',
  outputSurface: {mode: 'opaque'},
    request: {compositionBinding: {derivation: {method}}},
  });
  assert.equal(
    countProviderGeneratedImages([
      image('provider-generation'),
      image('provider-edit'),
      image('alpha-extraction'),
      image('mask-application'),
      image('manual-import'),
      {capability: 'voice'},
    ]),
    2,
  );
});

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
        schemaVersion: 8,
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
    assert.equal(recorded.record.compositionBinding, null);
    assert.equal(recorded.record.familyFingerprint, null);
    const manifest = JSON.parse(await fsp.readFile(recorded.manifestFile, 'utf8'));
    assert.equal(manifest.assets[0].assetId, 'draft-script');
    assert.equal(manifest.assets[0].lifecycle.status, 'active');
    await fsp.writeFile(output, 'replacement output');
    await recordAssetProvenance({
      request: recorded.record.request,
      output,
      provider: {id: 'test-command', adapter: 'command', model: 'test-model'},
    });
    const replaced = JSON.parse(await fsp.readFile(recorded.manifestFile, 'utf8'));
    assert.equal(replaced.schemaVersion, 4);
    assert.equal(replaced.assets.length, 2);
    assert.equal(replaced.assets[0].lifecycle.status, 'superseded');
    assert.equal(replaced.assets[0].lifecycle.supersededBy, replaced.assets[1].recordId);
    assert.equal(replaced.assets[1].lifecycle.status, 'active');
  } finally {
    await fsp.rm(projectDirectory, {recursive: true, force: true});
  }
});

test('voice outputs are measured and rejected before recording when scene timing cannot fit', async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'voice-timing-'));
  const output = path.join(directory, 'tone.wav');
  try {
    const generated = spawnSync('ffmpeg', [
      '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
      '-t', '1.2', '-y', output,
    ], {encoding: 'utf8'});
    assert.equal(generated.status, 0, generated.stderr);
    const base = {
      schemaVersion: 8,
      projectSlug: 'voice-timing-test',
      assetId: 'scene-one-narration',
      capability: 'voice',
      output: path.relative(ROOT, output),
      text: 'A short line.',
      timingBinding: {sceneId: 'scene-01', minDurationSeconds: 1, maxDurationSeconds: 2},
    };
    assert.doesNotThrow(() => validateAssetRequest(base));
    const measured = await verifyOutputFile(output, base);
    assert.ok(measured.metadata.durationSeconds >= 1.19);
    await assert.rejects(
      verifyOutputFile(output, {
        ...base,
        timingBinding: {sceneId: 'scene-01', maxDurationSeconds: 1},
      }),
      /超过 scene-01 允许的最长/,
    );
  } finally {
    await fsp.rm(directory, {recursive: true, force: true});
  }
});

test('v8 image requests require executable style, composition, and semantic bindings', () => {
  assert.throws(
    () => validateAssetRequest({schemaVersion: 8, projectSlug: 'binding-test', assetId: 'water', capability: 'image', output: 'public/water.png', prompt: 'water'}),
    /compositionBinding/,
  );
  assert.doesNotThrow(() => validateAssetRequest({
    schemaVersion: 8,
    projectSlug: 'binding-test',
    assetId: 'water',
    capability: 'image',
    ...STYLE_REQUEST,
    quality: {
      requiredChecks: [
        'style-profile-conformant',
        'silhouette-fidelity',
        'negative-space-clean',
        'background-leak-free',
      ],
    },
  outputSurface: {mode: 'opaque'},
    output: 'public/water.png',
    prompt: 'derive water from registered master',
    compositionBinding: {
      sceneId: 'scene-01', nodeId: 'water', pattern: 'registered-environment', registrationId: 'river-family',
      sourceMasterAssetId: 'river-master', outputRole: 'lower-band', canvas: {width: 1920, height: 1080},
      derivation: {method: 'alpha-extraction', parentAssetId: 'river-master'},
    },
    semanticBinding: {riskClass: 'topology-critical', contractIds: ['river-topology']},
  }));
});

test('loaded image requests must execute the current project Style Profile', async () => {
  const slug = `style-request-${process.pid}-${Date.now()}`;
  const projectDirectory = path.join(ROOT, 'projects', slug);
  const requestFile = path.join(projectDirectory, 'requests', 'plate.json');
  try {
    const catalog = await loadStyleCatalog({root: ROOT});
    const styleProfile = materializeStyleProfile(
      catalog,
      'hand-drawn-cutout-explainer',
    );
    const binding = styleProfileBinding(styleProfile);
    await fsp.mkdir(path.dirname(requestFile), {recursive: true});
    await fsp.writeFile(
      path.join(projectDirectory, 'project.json'),
      `${JSON.stringify({styleProfile}, null, 2)}\n`,
    );
    const request = {
      schemaVersion: 8,
      projectSlug: slug,
      assetId: 'plate',
      capability: 'image',
      output: `public/projects/${slug}/plate.png`,
      prompt: `Create a paper plate. ${binding.directives.join(' ')}`,
      styleProfileBinding: binding,
      outputSurface: {mode: 'opaque'},
      compositionBinding: {
        sceneId: 'scene',
        nodeId: 'plate',
        pattern: 'free',
        outputRole: 'plate',
        canvas: {width: 100, height: 100},
        derivation: {method: 'provider-generation'},
      },
      semanticBinding: {riskClass: 'decorative', contractIds: []},
      quality: {
        kind: 'image',
        requiredChecks: styleProfile.quality.requiredAssetChecks,
      },
    };
    await fsp.writeFile(
      requestFile,
      `${JSON.stringify(request, null, 2)}\n`,
    );
    const loaded = await loadAssetRequest(path.relative(ROOT, requestFile));
    assert.equal(
      loaded.request.styleProfileBinding.profileFingerprint,
      styleProfile.profileFingerprint,
    );

    request.styleProfileBinding.profileFingerprint = 'b'.repeat(64);
    await fsp.writeFile(
      requestFile,
      `${JSON.stringify(request, null, 2)}\n`,
    );
    await assert.rejects(
      () => loadAssetRequest(path.relative(ROOT, requestFile)),
      /styleProfileBinding 与当前 project.styleProfile 不一致/,
    );
  } finally {
    await fsp.rm(projectDirectory, {recursive: true, force: true});
  }
});

test('image output surfaces reject baked transparency and invalid chroma boundaries', async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'provider-surface-'));
  const opaque = path.join(directory, 'opaque.png');
  const alpha = path.join(directory, 'alpha.png');
  const nativeStateSheet = path.join(directory, 'native-state-sheet.png');
  const wrongAspectStateSheet = path.join(directory, 'wrong-aspect-state-sheet.png');
  const mixedSheet = path.join(directory, 'mixed-sheet.png');
  const checkerSheet = path.join(directory, 'checker-sheet.png');
  const request = {
    schemaVersion: 8,
    capability: 'image',
    compositionBinding: {canvas: {width: 32, height: 32}},
  };
  try {
    await sharp({
      create: {width: 32, height: 32, channels: 3, background: '#cccccc'},
    }).png().toFile(opaque);
    await assert.rejects(
      verifyOutputFile(opaque, {...request, outputSurface: {mode: 'alpha'}}),
      /真实透明像素/,
    );
    await assert.rejects(
      verifyOutputFile(opaque, {
        ...request,
        outputSurface: {mode: 'chroma-key', keyColor: '#00ff00', tolerance: 8},
      }),
      /可靠色键面/,
    );
    await sharp({
      create: {width: 32, height: 32, channels: 4, background: '#cccccc00'},
    }).png().toFile(alpha);
    await assert.rejects(
      verifyOutputFile(alpha, {...request, outputSurface: {mode: 'opaque'}}),
      /声明 opaque/,
    );
    await assert.doesNotReject(
      verifyOutputFile(alpha, {...request, outputSurface: {mode: 'alpha'}}),
    );
    const stateSheetRequest = {
      ...request,
      compositionBinding: {canvas: {width: 32, height: 32}},
      outputSurface: {
        mode: 'chroma-key',
        keyColor: '#ff00ff',
        tolerance: 8,
        keyPlane: {mode: 'provider-native-observed', policyId: 'flat-v1'},
      },
      stateSheetBinding: {
        layout: {columns: 2, rows: 2},
      },
    };
    await sharp(Buffer.from(`
      <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">
        <rect width="64" height="64" fill="#ff00ff"/>
        <circle cx="16" cy="16" r="8" fill="#63a142"/>
        <circle cx="48" cy="16" r="8" fill="#63a142"/>
        <circle cx="16" cy="48" r="8" fill="#63a142"/>
        <circle cx="48" cy="48" r="8" fill="#63a142"/>
      </svg>
    `)).png().toFile(nativeStateSheet);
    await assert.doesNotReject(
      verifyOutputFile(nativeStateSheet, stateSheetRequest),
    );
    await sharp(Buffer.from(`
      <svg xmlns="http://www.w3.org/2000/svg" width="64" height="48">
        <rect width="64" height="48" fill="#ff00ff"/>
        <circle cx="16" cy="12" r="6" fill="#63a142"/>
        <circle cx="48" cy="12" r="6" fill="#63a142"/>
        <circle cx="16" cy="36" r="6" fill="#63a142"/>
        <circle cx="48" cy="36" r="6" fill="#63a142"/>
      </svg>
    `)).png().toFile(wrongAspectStateSheet);
    await assert.rejects(
      verifyOutputFile(wrongAspectStateSheet, stateSheetRequest),
      /与请求画布 32x32 不一致/,
    );
    const sheetRequest = {
      ...request,
      compositionBinding: {canvas: {width: 128, height: 128}},
      outputSurface: {mode: 'layer-sheet'},
      layerPackageBinding: {
        sheetLayout: {
          columns: 2,
          rows: 2,
          providerSource: {
            canvasMode: 'provider-native',
            minimumWidth: 64,
            minimumHeight: 64,
            cellExtraction: 'explicit-rects',
          },
          cells: [
            {packageRole: 'reference', row: 0, column: 0, outputSurface: {mode: 'opaque'}},
            {packageRole: 'support-rear', row: 0, column: 1, outputSurface: {mode: 'opaque'}},
            {packageRole: 'subject', row: 1, column: 0, outputSurface: {mode: 'chroma-key', keyColor: '#ff00ff', tolerance: 8, keyPlane: {mode: 'provider-native-observed', policyId: 'flat-v1'}}},
            {packageRole: 'support-front', row: 1, column: 1, outputSurface: {mode: 'chroma-key', keyColor: '#ff00ff', tolerance: 8, keyPlane: {mode: 'provider-native-observed', policyId: 'flat-v1'}}},
          ],
        },
      },
    };
    await sharp(Buffer.from(`
      <svg xmlns="http://www.w3.org/2000/svg" width="66" height="66">
        <rect width="66" height="66" fill="#ffffff"/>
        <rect x="0" y="0" width="32" height="32" fill="#173f72"/>
        <rect x="34" y="0" width="32" height="32" fill="#173f72"/>
        <rect x="0" y="34" width="32" height="32" fill="#fa02ce"/>
        <ellipse cx="16" cy="50" rx="9" ry="6" fill="#f5bd20"/>
        <rect x="34" y="34" width="32" height="32" fill="#fa03cd"/>
        <path d="M34 60 Q50 42 66 60 V66 H34 Z" fill="#2f733f"/>
      </svg>
    `)).png().toFile(mixedSheet);
    const observed = await verifyOutputFile(mixedSheet, sheetRequest);
    assert.deepEqual(
      observed.keyPlaneObservation.cells.map(
        ({packageRole, observedKeyColor}) => [packageRole, observedKeyColor],
      ),
      [['subject', '#fa02ce'], ['support-front', '#fa03cd']],
    );
    await sharp({
      create: {width: 66, height: 66, channels: 3, background: '#dddddd'},
    }).png().toFile(checkerSheet);
    await assert.rejects(
      verifyOutputFile(checkerSheet, sheetRequest),
      /observed key plane 不合格/,
    );
  } finally {
    await fsp.rm(directory, {recursive: true, force: true});
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

  const compactResult = spawnSync(
    process.execPath,
    [path.join(ROOT, 'scripts', 'provider-status.mjs'), '--compact-json'],
    {cwd: ROOT, encoding: 'utf8'},
  );
  assert.equal(compactResult.status, 0, compactResult.stderr);
  const compact = JSON.parse(compactResult.stdout);
  assert.equal(compact.valid, true);
  assert.equal('candidates' in compact.capabilities.image, false);
  assert.ok(compactResult.stdout.length < result.stdout.length / 2);
});

test('new projects require a locked storyboard before concept approval', async () => {
  const slug = `v9-smoke-${process.pid}`;
  const projectDirectory = path.join(ROOT, 'projects', slug);
  const publicDirectory = path.join(ROOT, 'public', 'projects', slug);
  try {
    const result = spawnSync(
      process.execPath,
      [path.join(ROOT, 'scripts', 'project-new.mjs'), slug, '--title=V4 Smoke'],
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
    assert.equal(project.schemaVersion, 12);
    assert.deepEqual(project.quality, {minimumAssetScale: 1});
    assert.equal(project.voice.profile, 'warm-storyteller');
    assert.equal(project.plan.status, 'pending');
    assert.equal(project.plan.schemaVersion, 4);
    assert.equal(project.plan.motionBudget, null);
    assert.equal(project.plan.approvedImageBudget, null);
    assert.equal(manifest.projectSlug, slug);
    assert.equal(manifest.schemaVersion, 4);
    assert.deepEqual(manifest.assets, []);
    assert.ok(fs.existsSync(path.join(projectDirectory, 'providers.json')));
    assert.ok(fs.existsSync(path.join(projectDirectory, 'storyboard.json')));
    const storyboardTemplate = JSON.parse(await fsp.readFile(path.join(projectDirectory, 'storyboard.json'), 'utf8'));
    assert.equal(storyboardTemplate.schemaVersion, 12);
    assert.deepEqual(storyboardTemplate.sceneTransitions, []);
    assert.match(storyboardTemplate.$schema, /storyboard-authoring\.schema\.json$/);
    assert.ok(fs.existsSync(path.join(projectDirectory, 'requests', '.gitkeep')));
    assert.ok(fs.existsSync(path.join(publicDirectory, 'assets', 'style', '.gitkeep')));
    assert.ok(
      fs.existsSync(
        path.join(publicDirectory, 'assets', 'environment', 'rear', '.gitkeep'),
      ),
    );
    assert.ok(
      fs.existsSync(
        path.join(publicDirectory, 'assets', 'environment', 'mid', '.gitkeep'),
      ),
    );
    assert.ok(
      fs.existsSync(
        path.join(
          publicDirectory,
          'assets',
          'environment',
          'foreground',
          '.gitkeep',
        ),
      ),
    );

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

    const intakeWithoutPresentationRoot = spawnSync(
      process.execPath,
      [
        path.join(ROOT, 'scripts', 'project-intake.mjs'),
        slug,
        '--json',
      ],
      {cwd: ROOT, encoding: 'utf8'},
    );
    assert.notEqual(intakeWithoutPresentationRoot.status, 0);
    assert.match(
      intakeWithoutPresentationRoot.stderr,
      /展示 intake 风格卡必须提供 --presentation-root/,
    );

    const intakeGate = spawnSync(
      process.execPath,
      [
        path.join(ROOT, 'scripts', 'project-intake.mjs'),
        slug,
        '--json',
        `--presentation-root=${ROOT}`,
      ],
      {cwd: ROOT, encoding: 'utf8'},
    );
    assert.equal(intakeGate.status, 0, intakeGate.stderr);
    const intakeGatePayload = JSON.parse(intakeGate.stdout);
    assert.equal(intakeGatePayload.presentation.ready, true);
    assert.equal(
      intakeGatePayload.presentation.catalogFingerprint,
      intakeGatePayload.presentation.presentationFingerprint,
    );
    for (const style of intakeGatePayload.questions.find(
      ({id}) => id === 'visualStylePreset',
    ).options) {
      assert.match(style.imageSha256, /^[a-f0-9]{64}$/);
      assert.ok(style.runtimePath.endsWith(style.image));
      assert.ok(style.presentationPath.endsWith(style.image));
    }

    const intakeResult = spawnSync(
      process.execPath,
      [
        path.join(ROOT, 'scripts', 'project-intake.mjs'),
        slug,
        '--selection={"aspectRatio":"16:9","visualStylePreset":"childrens-picture-book-paper","parallaxPreference":"auto","note":"Workflow fixture intake"}',
      ],
      {cwd: ROOT, encoding: 'utf8'},
    );
    assert.equal(intakeResult.status, 0, intakeResult.stderr);

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
      '--output-mode=local-file',
      '--output-evidence=Image tool returned a verified local PNG fixture',
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

    const blockedBrief = spawnSync(
      process.execPath,
      [path.join(ROOT, 'scripts', 'project-advance.mjs'), slug, 'brief-ready'],
      {cwd: ROOT, encoding: 'utf8'},
    );
    assert.notEqual(blockedBrief.status, 0);
    assert.match(blockedBrief.stderr, /请先运行 project:plan/);

    const planResult = spawnSync(
      process.execPath,
      [
        path.join(ROOT, 'scripts', 'project-plan.mjs'),
        slug,
        '--requested-duration=45',
        '--duration=45',
        '--scenes=4',
        '--narration-seconds=38',
        '--rationale=Four visual beats fit the requested duration',
      ],
      {cwd: ROOT, encoding: 'utf8'},
    );
    assert.equal(planResult.status, 0, planResult.stderr);
    const plannedProject = JSON.parse(
      await fsp.readFile(path.join(projectDirectory, 'project.json'), 'utf8'),
    );
    assert.equal(plannedProject.plan.inputMode, 'duration-only');
    assert.equal(plannedProject.plan.requested.durationSeconds, 45);
    assert.equal(plannedProject.plan.requested.sceneCount, null);
    assert.equal(plannedProject.plan.resolved.sceneCount, 4);

    const missingStoryboard = spawnSync(
      process.execPath,
      [path.join(ROOT, 'scripts', 'project-advance.mjs'), slug, 'brief-ready'],
      {cwd: ROOT, encoding: 'utf8'},
    );
    assert.notEqual(missingStoryboard.status, 0);
    assert.match(missingStoryboard.stderr, /project:storyboard/);

    const storyboard = await writeAndLockStoryboard({
      slug,
      projectDirectory,
      sceneCount: 4,
      durationSeconds: 45,
    });
    assert.equal(storyboard.status, 0, storyboard.stderr);
    const compiledStoryboard = JSON.parse(
      await fsp.readFile(path.join(projectDirectory, 'storyboard.json'), 'utf8'),
    );
    assert.equal(compiledStoryboard.schemaVersion, 12);
    assert.ok(compiledStoryboard.sceneTransitions.every(({intent}) => intent === 'continuity'));
    assert.ok(compiledStoryboard.sceneTransitions.every(({treatment}) => treatment.type === 'slide' && treatment.edgeStyle === 'paper'));
    assert.ok(compiledStoryboard.sceneTransitions.every(({treatment}) => treatment.motivation === 'semantic-default'));

    const compactStatus = spawnSync(
      process.execPath,
      [path.join(ROOT, 'scripts', 'project-status.mjs'), slug, '--compact-json'],
      {cwd: ROOT, encoding: 'utf8'},
    );
    assert.equal(compactStatus.status, 0, compactStatus.stderr);
    assert.equal(JSON.parse(compactStatus.stdout).plan.inputMode, 'duration-only');
    assert.equal(JSON.parse(compactStatus.stdout).storyboard.status, 'ready');

    const briefReady = spawnSync(
      process.execPath,
      [path.join(ROOT, 'scripts', 'project-advance.mjs'), slug, 'brief-ready'],
      {cwd: ROOT, encoding: 'utf8'},
    );
    assert.equal(briefReady.status, 0, briefReady.stderr);
    const conceptProduction = JSON.parse(
      await fsp.readFile(path.join(projectDirectory, 'production.json'), 'utf8'),
    );
    assert.equal(conceptProduction.stage, 'concept-review');

    const approveConcept = spawnSync(
      process.execPath,
      [
        path.join(ROOT, 'scripts', 'project-advance.mjs'),
        slug,
        'approve-concept',
        '--note=Approve the planned duration and scenes',
      ],
      {cwd: ROOT, encoding: 'utf8'},
    );
    assert.equal(approveConcept.status, 0, approveConcept.stderr);
    const latePlan = spawnSync(
      process.execPath,
      [
        path.join(ROOT, 'scripts', 'project-plan.mjs'),
        slug,
        '--duration=30',
        '--scenes=3',
        '--rationale=Attempt to change an approved plan',
      ],
      {cwd: ROOT, encoding: 'utf8'},
    );
    assert.notEqual(latePlan.status, 0);
    assert.match(
      latePlan.stderr,
      /只能在 capability-review、brief 或 concept-review/,
    );
  } finally {
    await fsp.rm(projectDirectory, {recursive: true, force: true});
    await fsp.rm(publicDirectory, {recursive: true, force: true});
  }
});

test('concept and all providers can be confirmed in one workflow command', async () => {
  const slug = `combined-confirm-${process.pid}`;
  const projectDirectory = path.join(ROOT, 'projects', slug);
  const publicDirectory = path.join(ROOT, 'public', 'projects', slug);
  try {
    const created = spawnSync(
      process.execPath,
      [path.join(ROOT, 'scripts', 'project-new.mjs'), slug, '--title=Combined Confirm'],
      {cwd: ROOT, encoding: 'utf8'},
    );
    assert.equal(created.status, 0, created.stderr);
    const intake = spawnSync(
      process.execPath,
      [
        path.join(ROOT, 'scripts', 'project-intake.mjs'),
        slug,
        '--selection={"aspectRatio":"16:9","visualStylePreset":"childrens-picture-book-paper","parallaxPreference":"auto","note":"Fixture intake"}',
      ],
      {cwd: ROOT, encoding: 'utf8'},
    );
    assert.equal(intake.status, 0, intake.stderr);
    const planned = spawnSync(
      process.execPath,
      [
        path.join(ROOT, 'scripts', 'project-plan.mjs'),
        slug,
        '--duration=30',
        '--scenes=3',
        '--narration-seconds=24',
        '--profile=balanced',
        '--rationale=Three concise visual beats',
      ],
      {cwd: ROOT, encoding: 'utf8'},
    );
    assert.equal(planned.status, 0, planned.stderr);
    const storyboard = await writeAndLockStoryboard({
      slug,
      projectDirectory,
      sceneCount: 3,
      durationSeconds: 30,
    });
    assert.equal(storyboard.status, 0, storyboard.stderr);
    const selectionFile = path.join(projectDirectory, 'concept-confirmation.json');
    await fsp.writeFile(
      selectionFile,
      `${JSON.stringify(
        {
          note: 'Approve the concept, balanced budget, and detected providers',
          planDecision: {
            productionProfile: 'balanced',
            durationSeconds: 30,
            sceneCount: 3,
            durationAuthority: 'content-derived',
          },
          sourcePackageDecision: {
            requiredProviderImageCalls: 0,
            expectedProviderImageCalls: 0,
            hardCeiling: 20,
            sourcePackagePlans: [],
          },
          budgetDecision: {
            imageAttemptLimit: 2,
          },
          selections: {
            text: {providerId: 'host-text'},
            image: {providerId: 'manual-image'},
            voice: {providerId: 'manual-voice'},
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    const confirmed = spawnSync(
      process.execPath,
      [
        path.join(ROOT, 'scripts', 'project-confirm-concept.mjs'),
        slug,
        `--input=${path.relative(ROOT, selectionFile)}`,
      ],
      {cwd: ROOT, encoding: 'utf8'},
    );
    assert.equal(confirmed.status, 0, confirmed.stderr);
    assert.match(confirmed.stdout, /生产状态：style-review/);
    const production = JSON.parse(
      await fsp.readFile(path.join(projectDirectory, 'production.json'), 'utf8'),
    );
    assert.equal(production.stage, 'style-review');
    assert.equal(production.approvals.concept.status, 'approved');
    const approvedProject = JSON.parse(
      await fsp.readFile(path.join(projectDirectory, 'project.json'), 'utf8'),
    );
    assert.deepEqual(
      {
        imageAttemptLimit:
          approvedProject.plan.approvedImageBudget.imageAttemptLimit,
        expectedProviderImageCalls:
          approvedProject.plan.approvedImageBudget.expectedProviderImageCalls,
        profileHardCeiling:
          approvedProject.plan.approvedImageBudget.profileHardCeiling,
      },
      {
        imageAttemptLimit: 2,
        expectedProviderImageCalls: 0,
        profileHardCeiling: 20,
      },
    );
    const providers = spawnSync(
      process.execPath,
      [path.join(ROOT, 'scripts', 'provider-status.mjs'), slug, '--json'],
      {cwd: ROOT, encoding: 'utf8'},
    );
    assert.equal(providers.status, 0, providers.stderr);
    assert.equal(JSON.parse(providers.stdout).allConfirmed, true);

    const resume = spawnSync(
      process.execPath,
      [path.join(ROOT, 'scripts', 'project-status.mjs'), slug, '--resume-json'],
      {cwd: ROOT, encoding: 'utf8'},
    );
    assert.equal(resume.status, 0, resume.stderr);
    const resumeStatus = JSON.parse(resume.stdout);
    assert.equal(resumeStatus.productionProfile, 'balanced');
    assert.equal(resumeStatus.storyboard.sceneCount, 3);
    assert.equal(resumeStatus.control.mode, 'wait-human');
    assert.equal('approvals' in resumeStatus, false);
    assert.equal('artifacts' in resumeStatus, false);
  } finally {
    await fsp.rm(projectDirectory, {recursive: true, force: true});
    await fsp.rm(publicDirectory, {recursive: true, force: true});
  }
});

test('contact sheet sampling renders the authored proof moments', () => {
  const timeline = {
    scenes: [
      {id: 'one', label: '第一幕', from: 0, durationInFrames: 90, motion: {proofTimes: [{at: 0.08, label: '建立', kind: 'establish'}, {at: 0.5, label: '动作', kind: 'peak'}, {at: 0.9, label: '落定', kind: 'final'}]}},
      {id: 'two', label: '第二幕', from: 78, durationInFrames: 120, motion: {proofTimes: [{at: 0.08, label: '建立', kind: 'establish'}, {at: 0.5, label: '动作', kind: 'peak'}, {at: 0.9, label: '落定', kind: 'final'}]}},
      {id: 'three', label: '第三幕', from: 186, durationInFrames: 75, motion: {proofTimes: [{at: 0.08, label: '建立', kind: 'establish'}, {at: 0.5, label: '动作', kind: 'peak'}, {at: 0.9, label: '落定', kind: 'final'}]}},
    ],
  };
  const samples = deriveContactSheetSamples({
    timeline,
    fps: 30,
    durationSeconds: 8.7,
  });
  assert.equal(samples.length, 9);
  assert.deepEqual(
    samples.map(({sceneId}) => sceneId),
    ['one', 'one', 'one', 'two', 'two', 'two', 'three', 'three', 'three'],
  );
  assert.equal(samples.filter(({kind}) => kind === 'final').length, 3);
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
    timeout: 30000,
  });
  if (dependencyCheck.status !== 0) {
    t.skip('numpy and Pillow are not installed');
    return;
  }

  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'paper-key-test-'));
  const input = path.join(directory, 'magenta.png');
  const output = path.join(directory, 'alpha.png');
  const metadata = `${output}.key.json`;
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
      {encoding: 'utf8', timeout: 30000},
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
    assert.equal(inspection.keyColorSource, 'metadata');
    const transparentRgb = pixel(0, 0).slice(0, 3);
    assert.ok(transparentRgb.every((channel) => channel !== 255 || transparentRgb[1] !== 0));
    const resized = await sharp(output)
      .resize(24, 24)
      .flatten({background: '#777777'})
      .raw()
      .toBuffer();
    let magentaPixels = 0;
    for (let index = 0; index < resized.length; index += 3) {
      if (resized[index] > 180 && resized[index + 2] > 180 && resized[index + 1] < 100) magentaPixels += 1;
    }
    assert.equal(magentaPixels, 0);
    assert.ok(inspection.keyEdgeRatio < 0.2, inspection);
    assert.ok(fs.existsSync(metadata));
  } finally {
    await fsp.rm(directory, {recursive: true, force: true});
  }
});

test('neutral transparent RGB is not mistaken for a chroma key without metadata', async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'paper-neutral-key-test-'));
  const output = path.join(directory, 'neutral.png');
  try {
    const pixels = Buffer.alloc(8 * 8 * 4);
    for (let index = 0; index < pixels.length; index += 4) {
      pixels[index] = 243;
      pixels[index + 1] = 235;
      pixels[index + 2] = 216;
      pixels[index + 3] = 0;
    }
    await sharp(pixels, {raw: {width: 8, height: 8, channels: 4}}).png().toFile(output);
    const inspection = await inspectCharacterPng(output);
    assert.equal(inspection.keyColor, null);
    assert.equal(inspection.keyColorSource, null);
  } finally {
    await fsp.rm(directory, {recursive: true, force: true});
  }
});

test('key-edge inspection requires both chroma direction and proximity to the declared key', async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'paper-key-distance-test-'));
  const output = path.join(directory, 'distance.png');
  try {
    const pixels = Buffer.from([
      186, 41, 145, 128,
      112, 38, 84, 128,
    ]);
    await sharp(pixels, {raw: {width: 2, height: 1, channels: 4}})
      .png()
      .toFile(output);
    await fsp.writeFile(
      `${output}.key.json`,
      `${JSON.stringify({keyColor: '#ba2991'})}\n`,
    );
    const inspection = await inspectCharacterPng(output);
    assert.ok(inspection.keyEdgeRatio > 0.45, inspection);
    assert.ok(inspection.keyEdgeRatio < 0.55, inspection);
  } finally {
    await fsp.rm(directory, {recursive: true, force: true});
  }
});
