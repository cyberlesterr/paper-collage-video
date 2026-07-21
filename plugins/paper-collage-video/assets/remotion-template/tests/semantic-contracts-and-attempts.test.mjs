import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {
  closeGenerationAttempt,
  readGenerationAttemptEvents,
  reserveGenerationAttempt,
  summarizeGenerationAttempts,
} from '../scripts/generation-attempt-lib.mjs';
import {
  loadAssetRequest,
  recordAssetProvenance,
  validateAssetRequest,
} from '../scripts/provider-lib.mjs';
import {
  collectCompositeQualityTargets,
  prepareQualityReport,
} from '../scripts/quality-lib.mjs';
import {validateSemanticContracts} from '../scripts/semantic-contract-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const fingerprint = ({face, body, head, detail, palette}) => ({
  faceOrFront: face,
  bodyOrProportion: body,
  headOrTop: head,
  facialHairOrDetail: detail,
  palette,
  distinguishingFeatures: [`${face}-${body}`],
});

const identityContract = ({same = false} = {}) => ({
  id: 'recurring-cast',
  kind: 'identity',
  title: 'Recurring cast',
  invariants: ['Every named member remains recognizable.'],
  members: [
    {id: 'member-a', label: 'Member A', fingerprint: fingerprint({face: 'square', body: 'broad', head: 'tall-cap', detail: 'full-beard', palette: ['red']})},
    {id: 'member-b', label: 'Member B', fingerprint: fingerprint({face: same ? 'square' : 'long', body: same ? 'broad' : 'slender', head: 'tall-cap', detail: 'full-beard', palette: ['red']})},
  ],
  coexistenceSets: [{sceneId: 'scene-a', memberIds: ['member-a', 'member-b']}],
  evidenceTargets: [{
    id: 'cast-comparison',
    checks: ['identity-distinct-within-frame', 'cross-scene-identity-continuity'],
    shots: [
      {sceneId: 'scene-a', nodeId: 'cast', proofTimeIds: ['final']},
      {sceneId: 'scene-b', nodeId: 'cast', proofTimeIds: ['final']},
    ],
  }],
});

const mechanismContract = ({connected = true} = {}) => ({
  id: 'working-machine',
  kind: 'mechanism',
  title: 'Working machine',
  invariants: ['The force path remains visible.'],
  parts: [
    {id: 'support', label: 'Support', role: 'fixed'},
    {id: 'connector', label: 'Connector', role: 'connector'},
    {id: 'beam', label: 'Beam', role: 'moving'},
    {id: 'load', label: 'Load', role: 'load'},
  ],
  connections: [
    {from: 'support', to: 'connector', type: 'suspends'},
    {from: 'connector', to: 'beam', type: 'attaches-to'},
    ...(connected ? [{from: 'beam', to: 'load', type: 'supports'}] : []),
  ],
  loadPaths: [{id: 'primary-load-path', sequence: ['support', 'connector', 'beam', 'load'], force: 'gravity and support reaction'}],
  degreesOfFreedom: ['beam rotates around its suspension point'],
  forbiddenForms: ['beam fixed to the frame at both ends'],
  references: [{label: 'construction reference', note: 'Parts and connections verified before generation.'}],
  evidenceTargets: [{id: 'machine-final', checks: ['mechanism-complete', 'load-path-readable', 'physical-plausibility', 'reference-conformant'], shots: [{sceneId: 'scene-a', nodeId: 'machine', proofTimeIds: ['final']}]}],
});

test('semantic contracts reject cloned coexisting identities and broken force paths', () => {
  const cloned = {
    schemaVersion: 1,
    projectSlug: 'contract-test',
    status: 'ready',
    contracts: [identityContract({same: true})],
  };
  assert.ok(validateSemanticContracts(cloned).some(({code}) => code === 'identity-not-distinct'));

  const disconnected = {
    ...cloned,
    contracts: [mechanismContract({connected: false})],
  };
  assert.ok(validateSemanticContracts(disconnected).some(({code}) => code === 'mechanism-load-path-disconnected'));

  const valid = {
    ...cloned,
    contracts: [identityContract(), mechanismContract()],
  };
  assert.deepEqual(validateSemanticContracts(valid), []);

  const identityWithoutSameFrameProof = identityContract();
  identityWithoutSameFrameProof.evidenceTargets[0].checks = ['identity-family-consistent'];
  assert.ok(
    validateSemanticContracts({...valid, contracts: [identityWithoutSameFrameProof]})
      .some(({code}) => code === 'identity-coexistence-evidence'),
  );

  const mechanismWithoutPhysicalProof = mechanismContract();
  mechanismWithoutPhysicalProof.evidenceTargets[0].checks = ['mechanism-complete'];
  assert.ok(
    validateSemanticContracts({...valid, contracts: [mechanismWithoutPhysicalProof]})
      .some(({code}) => code === 'semantic-check-coverage'),
  );
});

test('schema-v3 image requests classify semantic risk independently from composition families', () => {
  const base = {
    schemaVersion: 3,
    projectSlug: 'contract-test',
    assetId: 'cast-master',
    capability: 'image',
    output: 'public/cast.png',
    prompt: 'A recurring cast in one full-frame plate.',
    compositionBinding: {
      sceneId: 'scene-a',
      nodeId: 'cast',
      pattern: 'free',
      outputRole: 'master-plate',
      canvas: {width: 100, height: 100},
      derivation: {method: 'provider-generation'},
    },
  };
  assert.throws(() => validateAssetRequest(base), /semanticBinding/);
  assert.throws(
    () => validateAssetRequest({...base, semanticBinding: {riskClass: 'identity-critical', contractIds: ['recurring-cast']}}),
    /generationFamily/,
  );
  assert.doesNotThrow(() => validateAssetRequest({
    ...base,
    semanticBinding: {
      riskClass: 'identity-critical',
      contractIds: ['recurring-cast'],
      generationFamily: {familyId: 'cast-family', memberIds: ['member-a', 'member-b'], referenceAssetIds: []},
    },
  }));
  assert.throws(
    () => validateAssetRequest({...base, semanticBinding: {riskClass: 'decorative', contractIds: ['recurring-cast']}}),
    /decorative 图像不得绑定关键 semantic contract/,
  );
});

test('multi-contract images inherit checks and identity family rules from every bound contract', async () => {
  const slug = `multi-contract-${process.pid}`;
  const projectDirectory = path.join(ROOT, 'projects', slug);
  const requestFile = path.join(projectDirectory, 'requests', 'machine-cast.json');
  const request = {
    schemaVersion: 3,
    projectSlug: slug,
    assetId: 'machine-cast',
    capability: 'image',
    output: `public/projects/${slug}/machine-cast.png`,
    prompt: 'Two recurring operators using a complete working machine.',
    compositionBinding: {
      sceneId: 'scene-a', nodeId: 'machine', pattern: 'free', outputRole: 'master-plate',
      canvas: {width: 100, height: 100}, derivation: {method: 'provider-generation'},
    },
    semanticBinding: {
      riskClass: 'mechanism-critical',
      contractIds: ['working-machine', 'recurring-cast'],
    },
    quality: {
      kind: 'mechanism',
      requiredChecks: ['mechanism-complete', 'load-path-readable', 'physical-plausibility', 'reference-conformant'],
    },
  };
  try {
    await fs.mkdir(path.dirname(requestFile), {recursive: true});
    await fs.writeFile(path.join(projectDirectory, 'generation-attempts.jsonl'), '');
    await fs.writeFile(path.join(projectDirectory, 'semantic-contracts.json'), `${JSON.stringify({
      schemaVersion: 1,
      projectSlug: slug,
      status: 'ready',
      contracts: [identityContract(), mechanismContract()],
    }, null, 2)}\n`);
    await fs.writeFile(requestFile, `${JSON.stringify(request, null, 2)}\n`);
    await assert.rejects(() => loadAssetRequest(path.relative(ROOT, requestFile)), /绑定 identity 契约.*generationFamily/);

    request.semanticBinding.generationFamily = {
      familyId: 'cast-family', memberIds: ['member-a', 'member-b'], referenceAssetIds: [],
    };
    await fs.writeFile(requestFile, `${JSON.stringify(request, null, 2)}\n`);
    await assert.rejects(() => loadAssetRequest(path.relative(ROOT, requestFile)), /不得省略任一绑定契约要求/);

    request.quality.requiredChecks.push('identity-family-consistent');
    await fs.writeFile(requestFile, `${JSON.stringify(request, null, 2)}\n`);
    const loaded = await loadAssetRequest(path.relative(ROOT, requestFile));
    assert.equal(loaded.request.semanticBinding.generationFamily.familyId, 'cast-family');
  } finally {
    await fs.rm(projectDirectory, {recursive: true, force: true});
  }
});

test('new ledger-enabled projects cannot bypass semantic contracts with schema-v2 images', async () => {
  const slug = `request-v3-${process.pid}`;
  const projectDirectory = path.join(ROOT, 'projects', slug);
  const requestFile = path.join(projectDirectory, 'requests', 'legacy.json');
  try {
    await fs.mkdir(path.dirname(requestFile), {recursive: true});
    await fs.writeFile(path.join(projectDirectory, 'generation-attempts.jsonl'), '');
    await fs.writeFile(requestFile, `${JSON.stringify({
      schemaVersion: 2,
      projectSlug: slug,
      assetId: 'legacy-image',
      capability: 'image',
      output: `public/projects/${slug}/legacy.png`,
      prompt: 'Legacy image request',
      compositionBinding: {
        sceneId: 'scene-a', nodeId: 'legacy', pattern: 'free', outputRole: 'plate',
        canvas: {width: 100, height: 100}, derivation: {method: 'provider-generation'},
      },
    }, null, 2)}\n`);
    await assert.rejects(
      () => loadAssetRequest(path.relative(ROOT, requestFile)),
      /必须使用 schema-v3 image request/,
    );
  } finally {
    await fs.rm(projectDirectory, {recursive: true, force: true});
  }
});

test('attempt ledger blocks over-budget calls and counts rejected provider output', async () => {
  const slug = `attempt-ledger-${process.pid}`;
  const projectDirectory = path.join(ROOT, 'projects', slug);
  const output = path.join(ROOT, 'public', 'projects', slug, 'wrong-size.png');
  const provider = {id: 'test-image', adapter: 'host', model: 'fixture'};
  const request = {
    schemaVersion: 3,
    projectSlug: slug,
    assetId: 'diagram-card',
    capability: 'image',
    output: path.relative(ROOT, output),
    prompt: 'A clean diagram card.',
    compositionBinding: {
      sceneId: 'scene-a', nodeId: 'diagram', pattern: 'free', outputRole: 'overlay',
      canvas: {width: 100, height: 100}, derivation: {method: 'provider-generation'},
    },
    semanticBinding: {riskClass: 'diagram-critical', contractIds: ['diagram-contract']},
  };
  try {
    await fs.mkdir(projectDirectory, {recursive: true});
    await fs.mkdir(path.dirname(output), {recursive: true});
    await fs.writeFile(path.join(projectDirectory, 'project.json'), `${JSON.stringify({
      schemaVersion: 4,
      slug,
      plan: {productionProfile: 'draft', assetBudget: {maxGeneratedImages: 1}},
      video: {width: 100, height: 100, fps: 30},
      audio: {narration: {volume: 1}},
      scenes: [],
    }, null, 2)}\n`);
    await fs.writeFile(path.join(projectDirectory, 'generation-attempts.jsonl'), '');
    await fs.writeFile(path.join(projectDirectory, 'assets-manifest.json'), `${JSON.stringify({schemaVersion: 3, projectSlug: slug, assets: []})}\n`);
    const reserved = await reserveGenerationAttempt({request, provider});
    await assert.rejects(() => reserveGenerationAttempt({request: {...request, assetId: 'second-card'}, provider}), /预算已用尽/);

    await sharp({create: {width: 80, height: 100, channels: 4, background: '#ffffff'}}).png().toFile(output);
    await assert.rejects(
      () => recordAssetProvenance({request, output, provider, attemptId: reserved.event.attemptId}),
      /尺寸 80x100.*100x100/,
    );
    const ledger = await readGenerationAttemptEvents(slug);
    const summary = summarizeGenerationAttempts(ledger.events);
    assert.equal(summary.used, 1);
    assert.equal(summary.reserved, 0);
    assert.equal(summary.byStatus.rejected, 1);
    await assert.rejects(() => reserveGenerationAttempt({request: {...request, assetId: 'third-card'}, provider}), /预算已用尽/);
  } finally {
    await fs.rm(projectDirectory, {recursive: true, force: true});
    await fs.rm(path.join(ROOT, 'public', 'projects', slug), {recursive: true, force: true});
  }
});

test('diagram filters fail deterministically and semantic proof targets span scenes', async () => {
  const slug = `semantic-proof-${process.pid}`;
  const projectDirectory = path.join(ROOT, 'projects', slug);
  const publicDirectory = path.join(ROOT, 'public', 'projects', slug);
  const cardFile = path.join(publicDirectory, 'card.svg');
  const castFile = path.join(publicDirectory, 'cast.png');
  const scene = (id) => ({
    id,
    motion: {proofTimes: [{id: 'final', at: 0.9, label: 'Final', kind: 'final', assertions: ['Readable']}]},
    composition: {
      coordinateSpace: {width: 100, height: 100},
      nodes: [
        {id: 'cast', kind: 'asset', assetRole: 'character', src: `projects/${slug}/cast.png`, z: 1, transform: {x: 0, y: 0, width: 1, height: 1, anchorX: 0, anchorY: 0}, motion: {keyframes: [{at: 0}, {at: 1}]}},
        ...(id === 'scene-a' ? [{id: 'diagram', kind: 'asset', assetRole: 'decorative', src: `projects/${slug}/card.svg`, z: 2, transform: {x: 0, y: 0, width: 1, height: 1, anchorX: 0, anchorY: 0}, motion: {keyframes: [{at: 0}, {at: 1}]}}] : []),
      ],
    },
    cues: [],
  });
  const diagram = {
    id: 'diagram-contract',
    kind: 'diagram',
    title: 'Clean diagram',
    invariants: ['Text and arrows remain crisp.'],
    protectedLayers: ['text', 'icons', 'arrows', 'borders'],
    forbiddenSvgFeatures: ['feTurbulence', 'feDisplacementMap', 'feBlend'],
    finalCanvas: {width: 100, height: 100},
    evidenceTargets: [{id: 'diagram-final', checks: ['diagram-edge-clean', 'small-text-legible', 'no-procedural-noise-on-semantic-lines'], shots: [{sceneId: 'scene-a', nodeId: 'diagram', proofTimeIds: ['final']}]}],
  };
  try {
    await fs.mkdir(projectDirectory, {recursive: true});
    await fs.mkdir(publicDirectory, {recursive: true});
    await fs.writeFile(cardFile, '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><filter id="noise"><feTurbulence/></filter><text filter="url(#noise)" x="5" y="50">A</text></svg>');
    await sharp({create: {width: 100, height: 100, channels: 4, background: '#806040'}}).png().toFile(castFile);
    const project = {
      schemaVersion: 4,
      slug,
      quality: {minimumAssetScale: 1},
      video: {width: 100, height: 100, fps: 30},
      audio: {narration: {volume: 1}},
      scenes: [scene('scene-a'), scene('scene-b')],
    };
    await fs.writeFile(path.join(projectDirectory, 'project.json'), `${JSON.stringify(project, null, 2)}\n`);
    await fs.writeFile(path.join(projectDirectory, 'assets-manifest.json'), `${JSON.stringify({
      schemaVersion: 3,
      projectSlug: slug,
      assets: [{
        assetId: 'diagram-card', capability: 'image', file: path.relative(ROOT, cardFile),
        request: {quality: {kind: 'diagram'}, semanticBinding: {riskClass: 'diagram-critical', contractIds: ['diagram-contract']}},
        semanticBinding: {riskClass: 'diagram-critical', contractIds: ['diagram-contract']},
      }],
    }, null, 2)}\n`);
    await fs.writeFile(path.join(projectDirectory, 'semantic-contracts.json'), `${JSON.stringify({
      schemaVersion: 1,
      projectSlug: slug,
      status: 'ready',
      contracts: [identityContract(), diagram],
    }, null, 2)}\n`);

    const targets = await collectCompositeQualityTargets(project);
    const identityTarget = targets.find(({compositeId}) => compositeId === 'semantic:recurring-cast:cast-comparison');
    assert.equal(identityTarget.proofShots.length, 2);
    assert.deepEqual(identityTarget.requiredChecks, ['identity-distinct-within-frame', 'cross-scene-identity-continuity']);

    const quality = await prepareQualityReport(slug);
    const card = quality.report.assets.find(({assetId}) => assetId === 'diagram-card');
    assert.equal(card.status, 'needs-revision');
    assert.ok(card.technical.checks.some(({id, passed}) => id === 'diagram-filter-feTurbulence' && !passed));
  } finally {
    await fs.rm(projectDirectory, {recursive: true, force: true});
    await fs.rm(publicDirectory, {recursive: true, force: true});
    await fs.rm(path.join(ROOT, 'dist', slug), {recursive: true, force: true});
  }
});

test('manual attempt closure requires truthful quota semantics', async () => {
  const slug = `attempt-close-${process.pid}`;
  const projectDirectory = path.join(ROOT, 'projects', slug);
  const request = {
    schemaVersion: 3,
    projectSlug: slug,
    assetId: 'asset',
    capability: 'image',
    compositionBinding: {derivation: {method: 'provider-generation'}},
  };
  try {
    await fs.mkdir(projectDirectory, {recursive: true});
    await fs.writeFile(path.join(projectDirectory, 'project.json'), JSON.stringify({plan: {assetBudget: {maxGeneratedImages: 2}}}));
    const reserved = await reserveGenerationAttempt({request, provider: {id: 'provider'}});
    await assert.rejects(
      () => closeGenerationAttempt({slug, attemptId: reserved.event.attemptId, status: 'rejected', quotaConsumed: false}),
      /必须计入生成额度/,
    );
  } finally {
    await fs.rm(projectDirectory, {recursive: true, force: true});
  }
});

test('parallel reservations cannot oversubscribe the approved image budget', async () => {
  const slug = `attempt-race-${process.pid}`;
  const projectDirectory = path.join(ROOT, 'projects', slug);
  const request = (assetId) => ({
    schemaVersion: 3,
    projectSlug: slug,
    assetId,
    capability: 'image',
    compositionBinding: {derivation: {method: 'provider-generation'}},
  });
  try {
    await fs.mkdir(projectDirectory, {recursive: true});
    await fs.writeFile(path.join(projectDirectory, 'project.json'), JSON.stringify({plan: {assetBudget: {maxGeneratedImages: 1}}}));
    await fs.writeFile(path.join(projectDirectory, 'generation-attempts.jsonl'), '');
    const results = await Promise.allSettled([
      reserveGenerationAttempt({request: request('first'), provider: {id: 'provider'}}),
      reserveGenerationAttempt({request: request('second'), provider: {id: 'provider'}}),
    ]);
    assert.equal(results.filter(({status}) => status === 'fulfilled').length, 1);
    assert.equal(results.filter(({status}) => status === 'rejected').length, 1);
    const summary = summarizeGenerationAttempts((await readGenerationAttemptEvents(slug)).events);
    assert.equal(summary.reserved, 1);
  } finally {
    await fs.rm(projectDirectory, {recursive: true, force: true});
  }
});
