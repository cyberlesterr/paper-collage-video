import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import {
  assertStyleProofReady,
  styleFingerprintForTarget,
  styleProofReportPath,
} from '../scripts/style-proof-lib.mjs';
import {
  collectCompositeQualityTargets,
  prepareQualityReport,
  recordQualityReviews,
} from '../scripts/quality-lib.mjs';
import {ROOT} from '../scripts/project-lib.mjs';

const relativePublicSource = (file) => path.relative(path.join(ROOT, 'public'), file);
const relativeWorkspaceFile = (file) => path.relative(ROOT, file);

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
  const node = (id, slot, assetRole = 'prop') => ({
    id,
    kind: 'asset',
    assetRole,
    src: relativePublicSource(files[id]),
    slot,
    z: 0,
    registrationId: 'family',
    transform: {x: 0, y: 0, width: 1, height: 1, anchorX: 0, anchorY: 0},
    motion: {keyframes: [{at: 0, x: 0}, {at: 1, x: 0}]},
  });
  const project = {
    schemaVersion: 4,
    slug,
    quality: {minimumAssetScale: 1},
    video: {width: 100, height: 100, fps: 30},
    scenes: [{
      id: 'scene',
      tailSeconds: 1,
      transition: {type: 'none', durationSeconds: 0},
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
          motion: {keyframes: [{at: 0, x: 0}, {at: 1, x: 0}]},
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
      cues: [],
    }],
  };
  const storyboard = {
    schemaVersion: 1,
    slug,
    status: 'ready',
    scenes: [{id: 'scene', compositionPlan: {patterns: ['supported-subject']}}],
  };
  const manifest = {
    schemaVersion: 3,
    projectSlug: slug,
    assets: [
      {assetId: 'master', capability: 'image', file: relativeWorkspaceFile(files.master), request: {quality: {kind: 'style-sample'}}},
      {assetId: 'rear', capability: 'image', file: relativeWorkspaceFile(files.rear), compositionBinding: binding('rear', 'support-rear')},
      {assetId: 'subject', capability: 'image', file: relativeWorkspaceFile(files.subject), compositionBinding: binding('subject', 'subject')},
      {assetId: 'front', capability: 'image', file: relativeWorkspaceFile(files.front), compositionBinding: binding('front', 'support-front')},
    ],
  };
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
  const evidencePath = relativeWorkspaceFile(evidenceFile);
  await fs.writeFile(
    styleProofReportPath(slug),
    `${JSON.stringify({
      schemaVersion: 3,
      slug,
      sceneId: 'scene',
      generatedAt: new Date().toISOString(),
      composites: [{
        compositeId: target.compositeId,
        styleFingerprint: styleFingerprintForTarget(target),
        proofFrames: [
          {proofTimeId: 'establish', fullFrame: evidencePath, crop: evidencePath, debugFrame: evidencePath},
          {proofTimeId: 'action', fullFrame: evidencePath, crop: evidencePath, debugFrame: evidencePath},
          {proofTimeId: 'final', fullFrame: evidencePath, crop: evidencePath, debugFrame: evidencePath},
        ],
      }],
      assetEvidence: target.memberNodeIds.map((nodeId) => ({
        nodeId,
        alphaMask: evidencePath,
        checkerboard: evidencePath,
        tightCrop: evidencePath,
        motionStress: evidencePath,
      })),
    }, null, 2)}\n`,
  );
  return {target, evidencePath, unrelatedPath: relativeWorkspaceFile(unrelatedFile)};
};

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
    assert.match(blockedAdvance.stderr, /风格拓扑证明/);

    const {target, evidencePath, unrelatedPath} = await writeProofEvidence({slug, project: fixture.project, files: fixture.files});
    quality = await prepareQualityReport(slug);
    const reviews = quality.report.assets.map((entry) => ({
      assetId: entry.assetId,
      reviewer: 'fixture-vision',
      passedChecks: entry.requiredChecks,
      evidenceFiles: entry.requiredChecks.some((check) => ['silhouette-fidelity', 'negative-space-clean', 'background-leak-free'].includes(check)) ? [evidencePath] : [],
    }));
    const composite = quality.report.composites.find(({compositeId}) => compositeId === target.compositeId);
    reviews.push({
      compositeId: composite.compositeId,
      reviewer: 'fixture-vision',
      passedChecks: composite.requiredChecks,
      evidenceFiles: [evidencePath],
    });
    const recorded = await recordQualityReviews({slug, reviews});
    assert.ok(recorded.report.assets.find(({assetId}) => assetId === 'subject').evidenceFiles.length > 0);
    await assert.doesNotReject(() => assertStyleProofReady(slug));

    const unrelatedReviews = recorded.report.assets.map((entry) => ({
      assetId: entry.assetId,
      reviewer: 'fixture-vision',
      passedChecks: entry.requiredChecks,
      evidenceFiles: entry.requiredChecks.some((check) => ['silhouette-fidelity', 'negative-space-clean', 'background-leak-free'].includes(check)) ? [unrelatedPath] : [],
    }));
    unrelatedReviews.push({
      compositeId: composite.compositeId,
      reviewer: 'fixture-vision',
      passedChecks: composite.requiredChecks,
      evidenceFiles: [unrelatedPath],
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
    const approvedAdvance = spawnSync(
      process.execPath,
      [path.join(ROOT, 'scripts', 'project-advance.mjs'), slug, 'approve-style-voice', '--note=fixture approval'],
      {cwd: ROOT, encoding: 'utf8'},
    );
    assert.equal(approvedAdvance.status, 0, approvedAdvance.stderr);
    const production = JSON.parse(await fs.readFile(path.join(fixture.projectDirectory, 'production.json'), 'utf8'));
    assert.equal(production.stage, 'asset-production');
    assert.equal(production.artifacts.styleProof, relativeWorkspaceFile(styleProofReportPath(slug)));

    await sharp(fixture.files.subject).modulate({brightness: 0.98}).png().toFile(`${fixture.files.subject}.changed.png`);
    await fs.rename(`${fixture.files.subject}.changed.png`, fixture.files.subject);
    await assert.rejects(() => assertStyleProofReady(slug), /过期|重新生成/);
  } finally {
    await fs.rm(fixture.projectDirectory, {recursive: true, force: true});
    await fs.rm(fixture.publicDirectory, {recursive: true, force: true});
    await fs.rm(fixture.distDirectory, {recursive: true, force: true});
  }
});
