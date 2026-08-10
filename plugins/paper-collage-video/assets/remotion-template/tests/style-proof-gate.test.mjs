import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import {
  assertStyleProofReady,
  assertStyleTargetPatternProof,
  buildStyleTargetPatternProof,
  selectTargetAssetEvidence,
  selectTargetQualityAssetGroups,
  styleFingerprintForTarget,
  styleProofReportPath,
} from '../scripts/style-proof-lib.mjs';
import {
  collectCompositeQualityTargets,
  collectStyleProofTargets,
  prepareQualityReport,
  recordQualityReviews,
} from '../scripts/quality-lib.mjs';
import {padEvidenceBounds} from '../scripts/asset-evidence-lib.mjs';
import {ROOT} from '../scripts/project-lib.mjs';
import {createRuntimeSurfaceFingerprint} from '../scripts/runtime-build-lib.mjs';
import {withCompiledEditorialFixture} from '../fixtures/editorial-fixture.mjs';

const relativePublicSource = (file) => path.relative(path.join(ROOT, 'public'), file);
const relativeWorkspaceFile = (file) => path.relative(ROOT, file);

test('evidence padding converts fractional layout bounds into an enclosing integer crop', () => {
  assert.deepEqual(
    padEvidenceBounds(
      {left: 338.4, top: 306.4, width: 576, height: 576},
      {width: 1920, height: 1080},
      32,
    ),
    {left: 306, top: 274, width: 641, height: 641},
  );
});

test('style spatial targets require an executable matching spatial proof', async () => {
  const target = {
    pattern: 'spatial-contract',
    spatialContract: {
      id: 'crow-flies-right',
      kind: 'travel-facing',
    },
  };
  assert.throws(
    () => assertStyleTargetPatternProof({
      target,
      proof: {
        compositeId: 'spatial-contract:crow-flies-right',
        spatialProof: null,
      },
    }),
    /缺少通过且匹配当前契约的空间样式证明/,
  );
  assert.doesNotThrow(() => assertStyleTargetPatternProof({
    target,
    proof: {
      compositeId: 'spatial-contract:crow-flies-right',
      spatialProof: {
        contractId: 'crow-flies-right',
        kind: 'travel-facing',
        passed: true,
      },
    },
  }));
  assert.deepEqual(
    await buildStyleTargetPatternProof({
      project: {},
      target: {pattern: 'parallax-rig'},
    }),
    {spatialProof: null},
  );
});
const manifestFixture = (projectSlug, assets) => ({
  schemaVersion: 4,
  projectSlug,
  assets: assets.map((record, index) => ({
    recordId: String(index + 1).padStart(64, '0'),
    lifecycle: {status: 'active', changedAt: '2026-01-01T00:00:00.000Z', reason: 'fixture', supersededBy: null},
    ...record,
  })),
});

const writeFixture = async (slug) => {
  const projectDirectory = path.join(ROOT, 'projects', slug);
  const publicDirectory = path.join(ROOT, 'public', 'projects', slug);
  const distDirectory = path.join(ROOT, 'dist', slug);
  const files = Object.fromEntries(
    ['master', 'rear', 'subject', 'front'].map((id) => [id, path.join(publicDirectory, `${id}.png`)]),
  );
  await fs.mkdir(projectDirectory, {recursive: true});
  await fs.mkdir(publicDirectory, {recursive: true});

  await sharp({create: {width: 100, height: 100, channels: 4, background: '#d9c49fff'}})
    .png()
    .toFile(files.master);
  for (const [id, left, width] of [
    ['rear', 12, 76],
    ['front', 10, 80],
  ]) {
    const block = await sharp({create: {width, height: 20, channels: 4, background: '#704827ff'}})
      .png()
      .toBuffer();
    await sharp({create: {width: 100, height: 100, channels: 4, background: '#00000000'}})
      .composite([{input: block, left, top: id === 'rear' ? 58 : 68}])
      .png()
      .toFile(files[id]);
  }

  const hardMaskWithMissingLeg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
      <rect width="100" height="100" fill="black"/>
      <path d="M25 20 H75 V62 H68 V84 H57 V62 H48 V84 H37 V62 H25 Z" fill="white"/>
    </svg>
  `);
  const subjectRgb = await sharp({create: {width: 100, height: 100, channels: 3, background: '#68717b'}})
    .png()
    .toBuffer();
  const subjectAlpha = await sharp(hardMaskWithMissingLeg).greyscale().threshold(128).png().toBuffer();
  await sharp(subjectRgb).joinChannel(subjectAlpha).png().toFile(files.subject);

  const binding = (nodeId, outputRole) => ({
    sceneId: 'scene',
    nodeId,
    pattern: 'supported-subject',
    registrationId: 'family',
    sourceMasterAssetId: 'master',
    outputRole,
    canvas: {width: 100, height: 100},
    derivation: {method: 'alpha-extraction', parentAssetId: 'master'},
  });
  const registeredFamilyBinding = (nodeId, role) => ({
    schemaVersion: 1,
    familyId: 'style-proof-family',
    pattern: 'supported-subject',
    registrationId: 'family',
    sourceMasterAssetId: 'master',
    canvas: {width: 100, height: 100},
    origin: 'top-left',
    role,
    slot: role,
    nodeId,
    source: {
      kind: 'source-master',
      assetId: 'master',
      stateId: null,
      sourceSheetAssetId: null,
      sourceFamilyFingerprint: null,
      sha256: 'a'.repeat(64),
    },
    derivation: {
      placement: {left: 0, top: 0, width: 100, height: 100},
      maskAssetId: null,
      maskSha256: null,
      maskChannel: null,
      invertMask: false,
      clip: null,
      trimmed: false,
      outputCanvasPreserved: true,
    },
    recoveryPolicy: {
      strategy: 'preserve-family-context',
      localDeterministicFixFirst: true,
      isolatedMemberGeneration: 'forbidden',
      providerRepair: 'masked-complete-source-edit',
      fallback: 'full-source-regeneration',
    },
    familyFingerprint: 'f'.repeat(64),
  });
  const node = (id, slot, assetRole = 'prop') => ({
    id,
    kind: 'asset',
    assetRole,
    src: relativePublicSource(files[id]),
    slot,
    z: 0,
    registrationId: 'family',
    transform: {x: 0, y: 0, width: 1, height: 1, anchorX: 0, anchorY: 0},
    motion: {keyframes: [{at: 0, offsetX: 0}, {at: 1, offsetX: 0}]},
  });
  const project = withCompiledEditorialFixture({
    slug,
    quality: {minimumAssetScale: 1},
    video: {width: 100, height: 100, fps: 30},
    scenes: [{
      id: 'scene',
      tailSeconds: 1,
      narration: {src: 'projects/fixture/audio.mp3', startSeconds: 0, durationSeconds: 3, text: ''},
      camera: {preset: 'static', intensity: 0},
      motion: {
        proofTimes: [
          {id: 'establish', at: 0.1, kind: 'establish'},
          {id: 'action', at: 0.5, kind: 'action'},
          {id: 'final', at: 0.9, kind: 'final'},
        ],
      },
      composition: {
        coordinateSpace: {width: 100, height: 100},
        nodes: [{
          id: 'rig',
          kind: 'group',
          pattern: 'supported-subject',
          z: 0,
          coordinateSpace: {width: 100, height: 100},
          transform: {x: 0, y: 0, width: 1, height: 1, anchorX: 0, anchorY: 0},
          motion: {keyframes: [{at: 0, offsetX: 0}, {at: 1, offsetX: 0}]},
          registration: {id: 'family', sourceMasterAssetId: 'master', canvas: {width: 100, height: 100}, origin: 'top-left'},
          support: {
            subjectId: 'subject',
            contactAnchor: {x: 0.5, y: 0.78},
            contactZone: [[0.2, 0.48], [0.8, 0.48], [0.8, 0.9], [0.2, 0.9]],
            occlusionZone: [[0.1, 0.58], [0.9, 0.58], [0.9, 0.92], [0.1, 0.92]],
          },
          children: [
            node('rear', 'support-rear'),
            node('subject', 'subject', 'character'),
            node('front', 'support-front'),
          ],
        }],
      },
      events: [],
    }],
    sceneTransitions: [],
  });
  const storyboard = {
    schemaVersion: 12,
    slug,
    status: 'ready',
    directingSummary: {
      styleProofPlan: {
        motionContractFingerprint: 'd'.repeat(64),
        requiredCoverage: ['relationship:coupled', 'relationship:supported-subject', 'semantic:topology'],
        targets: [{
          sceneId: 'scene',
          treatmentId: 'subject-on-support',
          targetId: 'subject',
          proofTimeId: null,
          riskScore: 46,
          directingFingerprint: 'a'.repeat(64),
          sourceFamilyKey: 'target:subject',
          coverage: ['relationship:coupled', 'relationship:supported-subject', 'semantic:topology'],
        }],
        sourceFamilyKeys: ['target:subject'],
        fingerprint: 'c'.repeat(64),
      },
    },
    motionContract: {
      schemaVersion: 1,
      direction: {
        summary: 'Fixture motion direction',
      },
      styleProfileBinding: {
        id: 'childrens-picture-book-paper',
        profileFingerprint: 'f'.repeat(64),
        pacing: 'gentle',
      },
      scenes: [{
        sceneId: 'scene',
        phrases: [
          {role: 'establish', beatId: 'establish', proofTimeId: 'establish'},
          {role: 'action', beatId: 'action', proofTimeId: 'action'},
          {role: 'settle', beatId: 'settle', proofTimeId: 'final'},
        ],
      }],
      transitions: [],
      editorialFingerprint: 'b'.repeat(64),
      requiredCompositeChecks: [
        'motion-grammar-consistent',
        'pacing-cadence-consistent',
        'camera-strategy-consistent',
        'transition-strategy-consistent',
        'ambient-strategy-consistent',
        'sync-anchors-current',
      ],
      fingerprint: 'd'.repeat(64),
      approvalFingerprint: 'e'.repeat(64),
    },
    scenes: [{
      id: 'scene',
      directing: {fingerprint: 'a'.repeat(64), riskScore: 46, highestRiskTreatmentId: 'subject-on-support', treatmentCount: 1},
      beats: [{id: 'action', treatments: [{id: 'subject-on-support', targetId: 'subject'}]}],
      compositionPlan: {patterns: ['supported-subject'], relationships: [], stateSequences: [], continuousMotions: [], visibilityEvents: [], graphics: []},
    }],
  };
  const manifest = manifestFixture(slug, [
      {assetId: 'master', capability: 'image', file: relativeWorkspaceFile(files.master), request: {quality: {kind: 'style-sample'}}},
      {assetId: 'rear', capability: 'image', adapter: 'registered-family-member', file: relativeWorkspaceFile(files.rear), media: {width: 100, height: 100, format: 'png', hasAlpha: true}, compositionBinding: binding('rear', 'support-rear'), registeredFamilyBinding: registeredFamilyBinding('rear', 'support-rear'), familyFingerprint: 'f'.repeat(64)},
      {assetId: 'subject', capability: 'image', adapter: 'registered-family-member', file: relativeWorkspaceFile(files.subject), media: {width: 100, height: 100, format: 'png', hasAlpha: true}, compositionBinding: binding('subject', 'subject'), registeredFamilyBinding: registeredFamilyBinding('subject', 'subject'), familyFingerprint: 'f'.repeat(64)},
      {assetId: 'front', capability: 'image', adapter: 'registered-family-member', file: relativeWorkspaceFile(files.front), media: {width: 100, height: 100, format: 'png', hasAlpha: true}, compositionBinding: binding('front', 'support-front'), registeredFamilyBinding: registeredFamilyBinding('front', 'support-front'), familyFingerprint: 'f'.repeat(64)},
    ]);
  const production = {
    $schema: '../../schemas/production.schema.json',
    schemaVersion: 1,
    slug,
    stage: 'style-review',
    createdAt: '2026-07-21T00:00:00.000Z',
    updatedAt: '2026-07-21T00:00:00.000Z',
    approvals: {
      concept: {status: 'approved', decidedAt: '2026-07-21T00:00:00.000Z', note: 'fixture concept'},
      styleAndVoice: {status: 'pending', decidedAt: null, note: ''},
      preview: {status: 'pending', decidedAt: null, note: ''},
      publish: {status: 'pending', decidedAt: null, note: ''},
    },
    workItems: [],
    artifacts: {
      brief: `projects/${slug}/brief.md`,
      project: `projects/${slug}/project.json`,
      storyboard: `projects/${slug}/storyboard.json`,
      prompts: `projects/${slug}/prompts.json`,
      review: `projects/${slug}/review.md`,
      validationReport: null,
      preview: null,
      final: null,
      report: null,
      contactSheet: null,
    },
    history: [{at: '2026-07-21T00:00:00.000Z', action: 'fixture-created', stage: 'style-review', note: ''}],
  };
  await fs.writeFile(path.join(projectDirectory, 'project.json'), `${JSON.stringify(project, null, 2)}\n`);
  await fs.writeFile(path.join(projectDirectory, 'storyboard.json'), `${JSON.stringify(storyboard, null, 2)}\n`);
  await fs.writeFile(path.join(projectDirectory, 'assets-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await fs.writeFile(path.join(projectDirectory, 'production.json'), `${JSON.stringify(production, null, 2)}\n`);
  return {project, files, projectDirectory, publicDirectory, distDirectory};
};

const writeProofEvidence = async ({slug, project, files}) => {
  const evidenceDirectory = path.join(ROOT, 'dist', slug, 'style-proof', 'evidence');
  await fs.mkdir(evidenceDirectory, {recursive: true});
  const evidenceFile = path.join(evidenceDirectory, 'evidence.png');
  await fs.copyFile(files.subject, evidenceFile);
  const unrelatedFile = path.join(evidenceDirectory, 'unrelated.png');
  await sharp({create: {width: 20, height: 20, channels: 4, background: '#ffffffff'}}).png().toFile(unrelatedFile);
  const [target] = await collectCompositeQualityTargets(project);
  const runtimeBuildFingerprint =
    await createRuntimeSurfaceFingerprint('composition-proof');
  const evidencePath = relativeWorkspaceFile(evidenceFile);
  await fs.writeFile(
    styleProofReportPath(slug),
    `${JSON.stringify({
      schemaVersion: 7,
      scope: 'style',
      slug,
      planFingerprint: 'c'.repeat(64),
      motionContractFingerprint: 'd'.repeat(64),
      motionApprovalFingerprint: 'e'.repeat(64),
      directingTargets: [{
        sceneId: 'scene',
        treatmentId: 'subject-on-support',
        targetId: 'subject',
        proofTimeId: null,
        riskScore: 46,
        directingFingerprint: 'a'.repeat(64),
        sourceFamilyKey: 'target:subject',
        coverage: ['relationship:coupled', 'relationship:supported-subject', 'semantic:topology'],
      }],
      runtimeBuildFingerprint,
      generatedAt: new Date().toISOString(),
      outputs: [{sceneId: 'scene', file: evidencePath, durationSeconds: 4}],
      contactSheet: evidencePath,
      composites: [{
        compositeId: target.compositeId,
        fingerprint: styleFingerprintForTarget(target),
        proofFrames: [
          {proofTimeId: 'establish', fullFrame: evidencePath, crop: evidencePath, debugFrame: evidencePath},
          {proofTimeId: 'action', fullFrame: evidencePath, crop: evidencePath, debugFrame: evidencePath},
          {proofTimeId: 'final', fullFrame: evidencePath, crop: evidencePath, debugFrame: evidencePath},
        ],
      }],
      assetEvidence: target.memberNodeIds.map((nodeId) => ({
        sceneId: target.sceneId,
        nodeId,
        alphaMask: evidencePath,
        checkerboard: evidencePath,
        tightCrop: evidencePath,
        motionStress: evidencePath,
        alphaBandReport: evidencePath,
        alphaBandOverlay: evidencePath,
        renderSize: {width: 1, height: 1},
        alphaBandInspection: {
          passed: true,
          sourceSize: {width: 100, height: 100},
          scales: [{label: 'original'}, {label: 'render-scale'}],
        },
      })),
    }, null, 2)}\n`,
  );
  return {target, evidencePath, unrelatedPath: relativeWorkspaceFile(unrelatedFile)};
};

test('free directing targets still produce a structured style composite', async () => {
  const slug = `style-proof-free-${process.pid}`;
  const fixture = await writeFixture(slug);
  try {
    const project = structuredClone(fixture.project);
    const subject = project.scenes[0].composition.nodes[0].children.find(({id}) => id === 'subject');
    delete subject.slot;
    delete subject.registrationId;
    project.scenes[0].composition.nodes = [subject];
    const targets = await collectStyleProofTargets(project, {
      sceneId: 'scene',
      treatmentId: 'free-subject',
      targetId: 'subject',
      directingFingerprint: 'b'.repeat(64),
    });
    assert.equal(targets.length, 1);
    assert.equal(targets[0].compositeId, 'style-target:scene:subject');
    assert.equal(targets[0].styleOnly, true);
    assert.deepEqual(targets[0].memberNodeIds, ['subject']);
    assert.equal(targets[0].proofTimeIds.length, 3);
  } finally {
    await fs.rm(fixture.projectDirectory, {recursive: true, force: true});
    await fs.rm(fixture.publicDirectory, {recursive: true, force: true});
    await fs.rm(fixture.distDirectory, {recursive: true, force: true});
  }
});

test('style proof asset requirements ignore non-file composite members', () => {
  const target = {
    sceneId: 'scene',
    memberNodeIds: ['rig', 'subject', 'fish-field'],
  };
  const report = {
    assetEvidence: [
      {sceneId: 'scene', nodeId: 'subject'},
      {sceneId: 'other-scene', nodeId: 'subject'},
    ],
  };
  const qualityReport = {
    assets: [{
      assetId: 'subject',
      sources: ['scene:scene:node:subject'],
    }],
  };

  assert.deepEqual(
    selectTargetAssetEvidence({report, target}).map(({nodeId}) => nodeId),
    ['subject'],
  );
  assert.deepEqual(
    selectTargetQualityAssetGroups({qualityReport, target}).map(({nodeId}) => nodeId),
    ['subject'],
  );
});

test('style topology gate rejects hard-alpha false confidence, unrelated evidence, and stale evidence', async () => {
  const slug = `style-proof-gate-${process.pid}`;
  const fixture = await writeFixture(slug);
  try {
    let quality = await prepareQualityReport(slug);
    const subject = quality.report.assets.find(({assetId}) => assetId === 'subject');
    assert.equal(subject.technical.passed, true);
    assert.equal(subject.technical.checks.find(({id}) => id === 'key-edge-clean').actual, 0);
    assert.ok(subject.requiredChecks.includes('silhouette-fidelity'));
    assert.ok(subject.requiredChecks.includes('negative-space-clean'));
    assert.ok(subject.requiredChecks.includes('background-leak-free'));
    assert.ok(subject.requiredChecks.includes('subject-complete'));
    assert.ok(subject.requiredChecks.includes('edge-clean'));
    assert.ok(subject.requiredChecks.includes('style-consistent'));
    await assert.rejects(() => assertStyleProofReady(slug), /风格拓扑证明/);
    const blockedAdvance = spawnSync(
      process.execPath,
      [path.join(ROOT, 'scripts', 'project-advance.mjs'), slug, 'approve-style-voice', '--note=fixture approval'],
      {cwd: ROOT, encoding: 'utf8'},
    );
    assert.notEqual(blockedAdvance.status, 0);
    assert.match(blockedAdvance.stderr, /视觉蓝图/);

    const {target, evidencePath, unrelatedPath} = await writeProofEvidence({slug, project: fixture.project, files: fixture.files});
    quality = await prepareQualityReport(slug);
    const reviews = quality.report.assets.map((entry) => ({
      assetId: entry.assetId,
      reviewer: 'human:fixture-vision',
      passedChecks: entry.requiredChecks,
      evidenceFiles: entry.requiredChecks.some((check) => ['silhouette-fidelity', 'negative-space-clean', 'background-leak-free'].includes(check)) ? [evidencePath] : [],
      note: 'Fixture reviewed',
    }));
    const composite = quality.report.composites.find(({compositeId}) => compositeId === target.compositeId);
    reviews.push({
      compositeId: composite.compositeId,
      reviewer: 'human:fixture-vision',
      passedChecks: composite.requiredChecks,
      evidenceFiles: [evidencePath],
      note: 'Fixture reviewed',
    });
    const recorded = await recordQualityReviews({slug, reviews});
    assert.ok(recorded.report.assets.find(({assetId}) => assetId === 'subject').evidenceFiles.length > 0);
    await assert.doesNotReject(() => assertStyleProofReady(slug));

    const unrelatedReviews = recorded.report.assets.map((entry) => ({
      assetId: entry.assetId,
      reviewer: 'human:fixture-vision',
      passedChecks: entry.requiredChecks,
      evidenceFiles: entry.requiredChecks.some((check) => ['silhouette-fidelity', 'negative-space-clean', 'background-leak-free'].includes(check)) ? [unrelatedPath] : [],
      note: 'Fixture reviewed',
    }));
    unrelatedReviews.push({
      compositeId: composite.compositeId,
      reviewer: 'human:fixture-vision',
      passedChecks: composite.requiredChecks,
      evidenceFiles: [unrelatedPath],
      note: 'Fixture reviewed',
    });
    await recordQualityReviews({slug, reviews: unrelatedReviews});
    await assert.rejects(() => assertStyleProofReady(slug), /未引用当前证明证据/);
    await recordQualityReviews({slug, reviews});
    await assert.doesNotReject(() => assertStyleProofReady(slug));

    await sharp(evidencePath).modulate({brightness: 0.98}).png().toFile(`${evidencePath}.changed.png`);
    await fs.rename(`${evidencePath}.changed.png`, evidencePath);
    await assert.rejects(() => assertStyleProofReady(slug), /尚未全部通过|尚未通过完整素材质量检查/);
    await fs.copyFile(fixture.files.subject, evidencePath);
    await assert.doesNotReject(() => assertStyleProofReady(slug));
    fixture.project.motionContract = {
      ...JSON.parse(
        await fs.readFile(
          path.join(fixture.projectDirectory, 'storyboard.json'),
          'utf8',
        ),
      ).motionContract,
    };
    await fs.writeFile(
      path.join(fixture.projectDirectory, 'project.json'),
      `${JSON.stringify(fixture.project, null, 2)}\n`,
    );
    await sharp(fixture.files.subject).modulate({brightness: 0.98}).png().toFile(`${fixture.files.subject}.changed.png`);
    await fs.rename(`${fixture.files.subject}.changed.png`, fixture.files.subject);
    await assert.rejects(() => assertStyleProofReady(slug), /过期|重新生成/);
  } finally {
    await fs.rm(fixture.projectDirectory, {recursive: true, force: true});
    await fs.rm(fixture.publicDirectory, {recursive: true, force: true});
    await fs.rm(fixture.distDirectory, {recursive: true, force: true});
  }
});
