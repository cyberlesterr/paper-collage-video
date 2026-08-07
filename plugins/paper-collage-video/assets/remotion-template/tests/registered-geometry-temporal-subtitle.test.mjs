import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import {
  computeRegisteredGeometryProof,
} from '../scripts/registered-geometry-lib.mjs';
import {
  inspectCompositeTechnical,
  qualityReviewPanel,
  requiresTemporalEvidence,
} from '../scripts/quality-lib.mjs';
import {ROOT} from '../scripts/project-lib.mjs';
import {createSubtitleContract} from '../scripts/subtitle-contract-lib.mjs';

const sha256 = async (file) =>
  createHash('sha256').update(await fs.readFile(file)).digest('hex');

test('registered geometry proof rejects centroid drift and mirrored facing', async () => {
  const directory = path.join(ROOT, 'public', 'fixtures', 'geometry-test');
  await fs.mkdir(directory, {recursive: true});
  try {
    const writeState = async (name, offsetX) => {
      const file = path.join(directory, `${name}.png`);
      await sharp({
        create: {
          width: 200,
          height: 200,
          channels: 4,
          background: {r: 0, g: 0, b: 0, alpha: 0},
        },
      })
        .composite([{
          input: Buffer.from(
            `<svg width="200" height="200">` +
              `<rect x="${20 + offsetX}" y="50" width="80" height="120" fill="#3b7d42"/>` +
              `<rect x="${100 + offsetX}" y="90" width="80" height="40" fill="#3b7d42"/></svg>`,
          ),
          left: 0,
          top: 0,
        }])
        .png()
        .toFile(file);
      return file;
    };
    const alignedA = await writeState('aligned-a', 0);
    const alignedB = await writeState('aligned-b', 0);
    const drifted = await writeState('drifted', 45);
    const states = (file, facing) => ({
      stateId: file.includes('drifted') ? 'drifted' : file.includes('mirrored') ? 'mirrored' : 'aligned',
      file,
      declaredFacing: facing,
    });
    const canvas = {width: 200, height: 200};
    const limits = {
      maxCentroidDelta: 0.06,
      maxBaselineDelta: 0.04,
      maxAspectRatioDelta: 0.2,
      maxScaleDrift: 0.18,
      maxProportionDelta: 0.2,
    };
    const aligned = await computeRegisteredGeometryProof({
      familyId: 'pose-family',
      registrationId: 'reg',
      familyFingerprint: 'a'.repeat(64),
      canvas,
      states: [states(alignedA, 'left'), states(alignedB, 'left')],
      limits,
    });
    assert.equal(aligned.passed, true);

    const driftProof = await computeRegisteredGeometryProof({
      familyId: 'pose-family',
      registrationId: 'reg',
      familyFingerprint: 'a'.repeat(64),
      canvas,
      states: [states(alignedA, 'left'), states(drifted, 'left')],
      limits,
    });
    assert.equal(driftProof.passed, false);
    assert.ok(
      driftProof.states
        .find(({stateId}) => stateId === 'drifted')
        .issues.some((issue) => issue.includes('质心')),
    );

    const mirroredProof = await computeRegisteredGeometryProof({
      familyId: 'pose-family',
      registrationId: 'reg',
      familyFingerprint: 'a'.repeat(64),
      canvas,
      states: [
        states(alignedA, 'left'),
        states(alignedA, 'right'),
      ],
      limits,
    });
    assert.equal(mirroredProof.passed, false);
    assert.ok(
      mirroredProof.states
        .flatMap(({issues}) => issues)
        .some((issue) => issue.includes('facing')),
    );
  } finally {
    await fs.rm(directory, {recursive: true, force: true});
  }
});

test('placement mode rejects alpha-tight bounds outside the declared placement', async () => {
  const directory = path.join(ROOT, 'public', 'fixtures', 'geometry-placement-test');
  await fs.mkdir(directory, {recursive: true});
  try {
    const file = path.join(directory, 'out-of-placement.png');
    await sharp({
      create: {
        width: 200,
        height: 200,
        channels: 4,
        background: {r: 0, g: 0, b: 0, alpha: 0},
      },
    })
      .composite([{
        input: Buffer.from(
          '<svg width="200" height="200"><rect x="120" y="120" width="60" height="60" fill="#3b7d42"/></svg>',
        ),
        left: 0,
        top: 0,
      }])
      .png()
      .toFile(file);
    const proof = await computeRegisteredGeometryProof({
      familyId: 'layer-family',
      registrationId: 'reg',
      familyFingerprint: 'a'.repeat(64),
      canvas: {width: 200, height: 200},
      states: [
        {
          stateId: 'member-a',
          file,
          declaredFacing: 'neutral',
          expectedPlacement: {left: 0, top: 0, width: 100, height: 100},
        },
      ],
      limits: {
        maxCentroidDelta: 0.06,
        maxBaselineDelta: 0.04,
        maxAspectRatioDelta: 0.2,
        maxScaleDrift: 0.18,
        maxProportionDelta: 0.2,
      },
      mode: 'placement',
    });
    assert.equal(proof.passed, false);
    assert.ok(
      proof.states
        .flatMap(({issues}) => issues)
        .some((issue) => issue.includes('超出注册 placement')),
    );
  } finally {
    await fs.rm(directory, {recursive: true, force: true});
  }
});

test('proof:registered-geometry CLI exits zero on the built-in registered-layer fixture', () => {
  const result = spawnSync(
    'npm',
    ['run', 'proof:registered-geometry'],
    {cwd: ROOT, encoding: 'utf8'},
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('contact sheet panel prefers the temporal motion strip for temporal targets', async () => {
  const directory = path.join(ROOT, 'public', 'fixtures', 'panel-test');
  await fs.mkdir(directory, {recursive: true});
  try {
    const writeImage = async (name, color) => {
      const file = path.join(directory, `${name}.png`);
      await sharp({
        create: {
          width: 120,
          height: 68,
          channels: 4,
          background: color,
        },
      }).png().toFile(file);
      return path.relative(ROOT, file);
    };
    const hashFile = async (relative) =>
      sha256(path.join(ROOT, relative));
    const frameA = await writeImage('frame-a', '#3b7d42ff');
    const frameB = await writeImage('frame-b', '#7d3b42ff');
    const stripFile = path.join(directory, 'motion-strip.jpg');
    await sharp({
      create: {
        width: 360,
        height: 243,
        channels: 3,
        background: '#100d0b',
      },
    }).jpeg().toFile(stripFile);
    const stripRelative = path.relative(ROOT, stripFile);
    const temporalReview = {
      compositeId: 'motion-contract:whole-film',
      targetFingerprint: 'f'.repeat(64),
      reviewer: 'host-vision',
      pendingChecks: ['motion-grammar-consistent'],
      passedChecks: [],
      failedChecks: [],
      evidenceFiles: [
        {file: frameA, sha256: await hashFile(frameA)},
        {file: frameB, sha256: await hashFile(frameB)},
        {file: stripRelative, sha256: await hashFile(stripRelative)},
      ],
      temporalEvidence: {
        file: stripRelative,
        sha256: await hashFile(stripRelative),
        frames: [
          {at: 0, file: frameA, sha256: await hashFile(frameA)},
          {at: 1, file: frameB, sha256: await hashFile(frameB)},
        ],
      },
      note: '',
    };
    const temporalPanel = await qualityReviewPanel({
      review: temporalReview,
      index: 0,
    });
    assert.equal(temporalPanel.temporalEvidence, true);
    assert.equal(temporalPanel.selectedFile, stripRelative);

    const assetReview = {
      assetId: 'boat-front',
      targetFingerprint: 'e'.repeat(64),
      reviewer: 'host-vision',
      pendingChecks: ['edge-clean'],
      passedChecks: [],
      failedChecks: [],
      evidenceFiles: [
        {file: frameA, sha256: await hashFile(frameA)},
        {file: frameB, sha256: await hashFile(frameB)},
      ],
      note: '',
    };
    const assetPanel = await qualityReviewPanel({
      review: assetReview,
      index: 1,
    });
    assert.equal(assetPanel.temporalEvidence, false);
    assert.equal(assetPanel.selectedFile, frameA);
  } finally {
    await fs.rm(directory, {recursive: true, force: true});
  }
});

test('temporal evidence fails closed when missing or stale', async () => {
  const directory = path.join(ROOT, 'public', 'projects', `temporal-${process.pid}`);
  await fs.mkdir(directory, {recursive: true});
  try {
    const writeFrame = async (name, color) => {
      const file = path.join(directory, `${name}.png`);
      await sharp({
        create: {width: 24, height: 24, channels: 4, background: color},
      }).png().toFile(file);
      return path.relative(ROOT, file);
    };
    const frames = [
      {at: 0, file: await writeFrame('f0', '#3b7d42ff')},
      {at: 0.5, file: await writeFrame('f1', '#7d3b42ff')},
      {at: 1, file: await writeFrame('f2', '#423b7dff')},
    ].map((frame) => ({...frame, sha256: null}));
    for (const frame of frames) {
      frame.sha256 = await sha256(path.join(ROOT, frame.file));
    }
    const stripFile = path.join(directory, 'strip.jpg');
    await sharp({
      create: {width: 24 * 3, height: 24, channels: 3, background: '#100d0b'},
    }).jpeg().toFile(stripFile);
    const temporalEvidence = {
      file: path.relative(ROOT, stripFile),
      sha256: await sha256(stripFile),
      frames,
    };
    const target = {
      compositeId: 'motion-contract:whole-film',
      fingerprint: 'f'.repeat(64),
      pattern: 'motion-contract',
      proofTimeIds: ['p0', 'p1', 'p2'],
      reviewScope: 'runtime-visible',
    };
    assert.equal(requiresTemporalEvidence(target), true);

    const stale = await inspectCompositeTechnical({
      target,
      proofReport: {
        composites: [{
          compositeId: target.compositeId,
          fingerprint: target.fingerprint,
          proofFrames: frames.map(({at, file}) => ({
            proofTimeId: `p${at * 2}`,
            fullFrame: file,
            crop: file,
          })),
        }],
      },
    });
    assert.equal(stale.passed, false);
    assert.ok(
      stale.checks.some(
        ({id, passed}) => id === 'temporal-evidence-current' && !passed,
      ),
    );

    const current = await inspectCompositeTechnical({
      target,
      proofReport: {
        composites: [{
          compositeId: target.compositeId,
          fingerprint: target.fingerprint,
          temporalEvidence,
          proofFrames: frames.map(({at, file}) => ({
            proofTimeId: `p${at * 2}`,
            fullFrame: file,
            crop: file,
          })),
        }],
      },
    });
    assert.equal(current.passed, true);
    assert.ok(
      current.checks.every(
        ({id, passed}) =>
          !id.startsWith('temporal-evidence-') || passed,
      ),
    );

    await fs.writeFile(path.join(ROOT, frames[1].file), 'changed');
    const mutated = await inspectCompositeTechnical({
      target,
      proofReport: {
        composites: [{
          compositeId: target.compositeId,
          fingerprint: target.fingerprint,
          temporalEvidence,
          proofFrames: frames.map(({at, file}) => ({
            proofTimeId: `p${at * 2}`,
            fullFrame: file,
            crop: file,
          })),
        }],
      },
    });
    assert.equal(mutated.passed, false);
  } finally {
    await fs.rm(directory, {recursive: true, force: true});
  }
});

test('scene subtitle placement rejects unresolved exclusion conflicts', async () => {
  const project = {
    video: {width: 1080, height: 1920, fps: 30},
    theme: {fontFamily: 'STKaiti'},
    editorial: {
      activeProfile: '9:16',
      responsiveProfiles: [
        {
          id: '9:16',
          safeArea: {x: 0.08, y: 0.05, width: 0.84, height: 0.9},
        },
      ],
      sceneDirecting: [
        {
          sceneId: 'forest',
          subtitlePlacement: {
            anchor: 'bottom',
            safeArea: {x: 0.05, y: 0.05, width: 0.9, height: 0.9},
            exclusionZones: [
              {
                id: 'bird',
                role: 'subject',
                x: 0.05,
                y: 0.05,
                width: 0.9,
                height: 0.9,
              },
            ],
          },
        },
      ],
    },
    scenes: [
      {
        id: 'forest',
        narration: {
          src: 'projects/test/audio/forest.wav',
          startSeconds: 0.2,
          durationSeconds: 2,
          text: '老虎扑向前方。',
        },
        subtitles: [
          {fromSeconds: 0.2, toSeconds: 2.2, text: '老虎扑向前方。'},
        ],
      },
    ],
  };
  const conflicting = await createSubtitleContract(project);
  assert.equal(conflicting.passed, false);
  assert.equal(
    conflicting.checks.find(({id}) => id === 'subtitle-scene-placement').passed,
    false,
  );

  const resolvedProject = structuredClone(project);
  resolvedProject.editorial.sceneDirecting[0].subtitlePlacement.safeArea = {
    x: 0.05,
    y: 0.05,
    width: 0.9,
    height: 0.4,
  };
  resolvedProject.editorial.sceneDirecting[0].subtitlePlacement.exclusionZones = [
    {
      id: 'title',
      role: 'title',
      x: 0.05,
      y: 0.05,
      width: 0.9,
      height: 0.2,
    },
  ];
  const resolved = await createSubtitleContract(resolvedProject);
  assert.equal(resolved.passed, true);
  assert.equal(
    resolved.checks.find(({id}) => id === 'subtitle-scene-placement').passed,
    true,
  );
});
