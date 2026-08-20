#!/usr/bin/env node
import {printCliHelp} from './cli-help-lib.mjs';
import path from 'node:path';
import {prepareRegisteredFamilyProof} from './asset-hardening-proof-lib.mjs';
import {
  DEFAULT_REGISTERED_GEOMETRY_LIMITS,
  computeRegisteredGeometryProof,
} from './registered-geometry-lib.mjs';
import {ROOT, writeJson} from './project-lib.mjs';

const USAGE =
  "用法：npm run proof:registered-geometry --";
printCliHelp(process.argv.slice(2), USAGE);

const outputDirectory = path.join(
  ROOT,
  'dist',
  'vox-phase2-proof',
  'registered-geometry',
);
const inputFile = path.join(
  ROOT,
  'dist',
  'vox-phase2-proof',
  'inputs',
  'registered-geometry-proof.json',
);

try {
  if (process.argv.slice(2).length > 0) {
    throw new Error(
      'proof:registered-geometry 是仓库内置 fixture 证明，不接受项目参数；项目几何校验由 project:composition-proof 执行。',
    );
  }
  const {records} = await prepareRegisteredFamilyProof();
  const bound = records
    .map(({registeredFamilyBinding}) => registeredFamilyBinding)
    .filter(Boolean);
  if (bound.length < 2) {
    throw new Error('registered family fixture 缺少可校验的成员记录。');
  }
  const first = bound[0];
  const states = records.map((record, index) => ({
    stateId:
      record.registeredFamilyBinding?.slot ??
      record.registeredFamilyBinding?.role ??
      `member-${index + 1}`,
    file: path.join(ROOT, record.file),
    declaredFacing: 'neutral',
    expectedPlacement:
      record.registeredFamilyBinding?.derivation?.placement ?? null,
  }));
  const proof = await computeRegisteredGeometryProof({
    familyId: first.familyId,
    registrationId: first.registrationId,
    familyFingerprint: first.familyFingerprint,
    canvas: first.canvas,
    states,
    limits: DEFAULT_REGISTERED_GEOMETRY_LIMITS,
    mode: 'placement',
  });
  const proofFile = path.join(outputDirectory, 'proof.json');
  await writeJson(proofFile, proof);
  await writeJson(inputFile, proof);
  if (!proof.passed) {
    throw new Error(
      proof.states
        .flatMap(({stateId, issues}) =>
          issues.map((issue) => `${stateId}: ${issue}`),
        )
        .join('\n'),
    );
  }
  console.log(
    `✓ registered-geometry proof: ${proof.states.length} states, ` +
      `alpha-tight bounds within declared placements`,
  );
  console.log(`✓ proof sample: ${path.relative(ROOT, proofFile)}`);
} catch (error) {
  console.error(`proof:registered-geometry failed: ${error.message}`);
  process.exitCode = 1;
}
