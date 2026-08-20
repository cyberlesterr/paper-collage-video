#!/usr/bin/env node
import {printCliHelp} from './cli-help-lib.mjs';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {
  PATH_LOCOMOTION_CONTRACT_ID,
  PATH_LOCOMOTION_DURATION_SECONDS,
  PATH_LOCOMOTION_PROFILES,
  PATH_LOCOMOTION_SCENE_ID,
  PATH_LOCOMOTION_SLUG,
  PATH_LOCOMOTION_UPDATED_AT,
  PATH_LOCOMOTION_WORLD_ID,
  compilePathLocomotionStoryboard,
  createPathLocomotionPlan,
  createPathLocomotionProject,
  createPathLocomotionStoryboardAuthoring,
} from '../fixtures/path-locomotion-fixture.mjs';
import {validateProject} from './project-lib.mjs';
import {createRuntimeBuildFingerprint} from './runtime-build-lib.mjs';
import {inspectSpatialContract} from './spatial-contract-lib.mjs';
import {validateStoryboard} from './storyboard-lib.mjs';

const USAGE =
  "用法：npm run proof:path-locomotion:prepare --";
printCliHelp(process.argv.slice(2), USAGE);

const ROOT = path.resolve(import.meta.dirname, '..');
const PUBLIC_DIRECTORY = path.join(
  ROOT,
  'public',
  'fixtures',
  'path-locomotion',
);
const PROOF_DIRECTORY = path.join(ROOT, 'dist', PATH_LOCOMOTION_SLUG);
const INPUTS_DIRECTORY = path.join(PROOF_DIRECTORY, 'inputs');
const REPORTS_DIRECTORY = path.join(PROOF_DIRECTORY, 'reports');

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const sha256File = async (file) => sha256(await fs.readFile(file));
const publicSrc = (file) =>
  path.relative(path.join(ROOT, 'public'), file).split(path.sep).join('/');
const writeJson = async (file, value) => {
  await fs.mkdir(path.dirname(file), {recursive: true});
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
};
const svgDocument = ({width, height, body, background = null}) => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    ${background ? `<rect width="${width}" height="${height}" fill="${background}"/>` : ''}
    ${body}
  </svg>`,
);

const pondWorldSvg = () => {
  const stones = Array.from({length: 34}, (_, index) => {
    const angle = index / 34 * Math.PI * 2;
    const radius = 720 + (index % 3) * 38;
    const x = 1100 + Math.cos(angle) * radius;
    const y = 1100 + Math.sin(angle) * radius;
    const rotation = angle * 180 / Math.PI + 12;
    return `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${42 + index % 4 * 6}" ry="${21 + index % 3 * 4}" fill="${index % 2 ? '#d7c89a' : '#c4b27f'}" stroke="#365c5c" stroke-width="8" transform="rotate(${rotation.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
  }).join('');
  const reeds = Array.from({length: 18}, (_, index) => {
    const angle = index / 18 * Math.PI * 2;
    const x = 1100 + Math.cos(angle) * 900;
    const y = 1100 + Math.sin(angle) * 900;
    const lean = index % 2 ? 28 : -28;
    return `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${(angle * 180 / Math.PI + 90).toFixed(1)})">
      <path d="M0 0 Q${lean} -90 ${lean * 0.45} -190" fill="none" stroke="#366f57" stroke-width="18" stroke-linecap="round"/>
      <ellipse cx="${(lean * 0.45).toFixed(1)}" cy="-202" rx="18" ry="52" fill="#98693f" stroke="#365449" stroke-width="7"/>
    </g>`;
  }).join('');
  const ripples = [
    [1100, 420, 180, 84],
    [1650, 1110, 148, 72],
    [1080, 1760, 190, 90],
    [510, 1120, 142, 68],
  ].map(([x, y, rx, ry]) =>
    `<g fill="none" stroke="#e9f8ed" stroke-width="14" opacity=".62">
      <ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}"/>
      <ellipse cx="${x}" cy="${y}" rx="${rx * .67}" ry="${ry * .67}"/>
    </g>`
  ).join('');
  const sectors = [
    ['→', 1100, 318],
    ['↘', 1705, 565],
    ['↓', 1880, 1100],
    ['↙', 1680, 1660],
    ['←', 1100, 1882],
    ['↖', 535, 1660],
    ['↑', 320, 1100],
    ['↗', 535, 565],
  ].map(([label, x, y]) =>
    `<g transform="translate(${x} ${y})">
      <circle r="55" fill="#f4c35a" stroke="#274d55" stroke-width="10"/>
      <text x="0" y="18" text-anchor="middle" font-family="Arial, sans-serif" font-size="58" font-weight="700" fill="#274d55">${label}</text>
    </g>`
  ).join('');
  return svgDocument({
    width: 2200,
    height: 2200,
    background: '#8fc9c5',
    body: `
      <circle cx="1100" cy="1100" r="1010" fill="#5e9e75"/>
      <circle cx="1100" cy="1100" r="820" fill="#74bbb7" stroke="#e7d8ac" stroke-width="36"/>
      <path d="M342 1020 C570 890 740 960 898 1095 C1050 1225 1190 1240 1360 1110 C1510 992 1650 930 1870 1020" fill="none" stroke="#a8dcd4" stroke-width="44" opacity=".35"/>
      <path d="M380 1290 C610 1420 790 1355 940 1238 C1080 1130 1240 1120 1415 1250 C1562 1360 1700 1415 1840 1325" fill="none" stroke="#4e9e9d" stroke-width="36" opacity=".34"/>
      ${ripples}
      ${stones}
      ${reeds}
      ${sectors}
      <g transform="translate(1100 1100)">
        <circle r="76" fill="#fff4cf" opacity=".88"/>
        <circle r="38" fill="#f4c35a" stroke="#274d55" stroke-width="10"/>
      </g>
    `,
  });
};

const tadpoleSvg = ({tailPhase = 0}) => {
  const bend = [-72, -32, 32, 72][tailPhase] ?? 0;
  const controlY = [-92, -38, 38, 92][tailPhase] ?? 0;
  return svgDocument({
    width: 512,
    height: 512,
    body: `
      <g transform="translate(8 8)">
        <path d="M206 256 C122 206 78 ${256 + controlY} 24 ${256 + bend}" fill="none" stroke="#203c45" stroke-width="76" stroke-linecap="round"/>
        <path d="M206 256 C126 220 82 ${256 + controlY} 30 ${256 + bend}" fill="none" stroke="#344f57" stroke-width="52" stroke-linecap="round"/>
        <ellipse cx="302" cy="256" rx="126" ry="102" fill="#253f48" stroke="#fff3d1" stroke-width="18"/>
        <ellipse cx="345" cy="220" rx="25" ry="31" fill="#fff8e7"/>
        <circle cx="353" cy="221" r="12" fill="#172d35"/>
        <ellipse cx="337" cy="296" rx="30" ry="13" fill="#d36f60" opacity=".7"/>
        <path d="M244 186 Q298 160 355 184" fill="none" stroke="#56737a" stroke-width="16" stroke-linecap="round" opacity=".7"/>
      </g>
    `,
  });
};

const wavBuffer = ({durationSeconds, sampleRate = 48000}) => {
  const sampleCount = Math.round(durationSeconds * sampleRate);
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    const seconds = index / sampleRate;
    const water = Math.sin(seconds * Math.PI * 2 * 84) * 0.18;
    const pulse = Math.max(0, Math.sin(seconds * Math.PI * 2 * 2));
    const sample = Math.round(water * pulse * 32767 * 0.06);
    buffer.writeInt16LE(sample, 44 + index * 2);
  }
  return buffer;
};

const createAssetRecord = async ({assetId, file, compositionBinding = null}) => {
  const bytes = await fs.readFile(file);
  const metadata = await sharp(file).metadata();
  const digest = sha256(bytes);
  return {
    recordId: sha256(`path-locomotion-record:${assetId}:${digest}`),
    assetId,
    capability: 'image',
    file: path.relative(ROOT, file).split(path.sep).join('/'),
    provider: 'local-deterministic-fixture',
    adapter: 'manual',
    tool: null,
    model: null,
    externalId: null,
    attemptId: null,
    recoveredFromClosedAttempt: false,
    recoveredFromRejectedAttempt: false,
    requestFingerprint: sha256(`path-locomotion-request:${assetId}:${digest}`),
    reusedFrom: null,
    sha256: digest,
    sizeBytes: bytes.length,
    media: {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format ?? 'png',
      hasAlpha: Boolean(metadata.hasAlpha),
    },
    recordedAt: PATH_LOCOMOTION_UPDATED_AT,
    request: {capability: 'image', source: 'deterministic-local-svg'},
    compositionBinding,
    familyFingerprint: null,
    lifecycle: {
      status: 'active',
      changedAt: PATH_LOCOMOTION_UPDATED_AT,
      reason: 'repository-owned zero-provider engineering fixture',
      supersededBy: null,
    },
  };
};

await fs.mkdir(PUBLIC_DIRECTORY, {recursive: true});
await fs.mkdir(INPUTS_DIRECTORY, {recursive: true});
await fs.mkdir(REPORTS_DIRECTORY, {recursive: true});

const worldFile = path.join(PUBLIC_DIRECTORY, 'pond-world.png');
await sharp(pondWorldSvg()).png().toFile(worldFile);

const stateIds = ['tail-left', 'tail-up', 'tail-right', 'tail-down'];
const stateFiles = {};
for (const [index, stateId] of stateIds.entries()) {
  const file = path.join(PUBLIC_DIRECTORY, `${stateId}.png`);
  await sharp(tadpoleSvg({tailPhase: index})).png().toFile(file);
  stateFiles[stateId] = file;
}
const identityFile = path.join(PUBLIC_DIRECTORY, 'tadpole-identity.png');
await sharp(tadpoleSvg({tailPhase: 1})).png().toFile(identityFile);
const identitySha256 = await sha256File(identityFile);

const audioFile = path.join(PUBLIC_DIRECTORY, 'engineering-tone.wav');
await fs.writeFile(
  audioFile,
  wavBuffer({durationSeconds: PATH_LOCOMOTION_DURATION_SECONDS}),
);
const audioSha256 = await sha256File(audioFile);
const timingFile = path.join(PUBLIC_DIRECTORY, 'engineering-tone.timing.json');
await writeJson(timingFile, {
  schemaVersion: 1,
  mediaId: 'path-locomotion-audio',
  mediaSha256: audioSha256,
  durationSeconds: PATH_LOCOMOTION_DURATION_SECONDS,
  source: 'deterministic-local-waveform-fixture',
  sampleRate: 48000,
  cues: [{
    id: `${PATH_LOCOMOTION_SCENE_ID}-fixture-cue`,
    kind: 'narration-phrase',
    source: 'authored',
    atSeconds: 0.08,
    endSeconds: 0.4,
  }],
});
const media = {
  id: 'path-locomotion-audio',
  src: publicSrc(audioFile),
  sha256: audioSha256,
  durationSeconds: PATH_LOCOMOTION_DURATION_SECONDS,
  timingDataSrc: publicSrc(timingFile),
};

const manifest = {
  $schema: '../../schemas/assets-manifest.schema.json',
  schemaVersion: 4,
  projectSlug: PATH_LOCOMOTION_SLUG,
  assets: [
    await createAssetRecord({
      assetId: PATH_LOCOMOTION_WORLD_ID,
      file: worldFile,
      compositionBinding: {
        sceneId: PATH_LOCOMOTION_SCENE_ID,
        nodeId: PATH_LOCOMOTION_WORLD_ID,
        pattern: 'free',
        outputRole: 'world-surface',
      },
    }),
    await createAssetRecord({
      assetId: 'tadpole-identity',
      file: identityFile,
    }),
    ...await Promise.all(stateIds.map((stateId) =>
      createAssetRecord({
        assetId: stateId,
        file: stateFiles[stateId],
        compositionBinding: {
          sceneId: PATH_LOCOMOTION_SCENE_ID,
          nodeId: 'tadpole-swimmer',
          pattern: 'free',
          outputRole: 'registered-state',
        },
      })
    )),
  ],
};
await writeJson(path.join(INPUTS_DIRECTORY, 'assets-manifest.json'), manifest);

const storyboard = compilePathLocomotionStoryboard({media});
const storyboardIssues = validateStoryboard(storyboard, {
  slug: PATH_LOCOMOTION_SLUG,
  plan: createPathLocomotionPlan(),
});
if (storyboardIssues.length > 0) {
  throw new Error(
    storyboardIssues
      .map(({location, message}) => `${location}: ${message}`)
      .join('\n'),
  );
}
await writeJson(path.join(INPUTS_DIRECTORY, 'storyboard.json'), storyboard);
await writeJson(
  path.join(INPUTS_DIRECTORY, 'storyboard-authoring.json'),
  createPathLocomotionStoryboardAuthoring({media}),
);

const runtimeBuildFingerprint = await createRuntimeBuildFingerprint();
const validations = [];
for (const profile of PATH_LOCOMOTION_PROFILES) {
  const project = createPathLocomotionProject({
    media,
    profileId: profile.id,
    worldSrc: publicSrc(worldFile),
    stateSources: Object.fromEntries(
      stateIds.map((stateId) => [stateId, publicSrc(stateFiles[stateId])]),
    ),
    identitySha256,
  });
  const result = await validateProject(project, {storyboard, manifest});
  const errors = result.issues.filter(({level}) => level === 'error');
  if (errors.length > 0) {
    throw new Error(
      `${profile.id} project validation failed:\n${errors
        .map(({location, message}) => `${location}: ${message}`)
        .join('\n')}`,
    );
  }
  const contract = project.spatialContracts.find(
    ({id}) => id === PATH_LOCOMOTION_CONTRACT_ID,
  );
  const spatialProof = await inspectSpatialContract(project, contract);
  if (!spatialProof.passed) {
    throw new Error(
      `${profile.id} path locomotion proof failed:\n${JSON.stringify(
        spatialProof.checks.filter(({passed}) => !passed),
        null,
        2,
      )}`,
    );
  }
  const suffix = profile.id.replace(':', 'x');
  await writeJson(path.join(INPUTS_DIRECTORY, `project-${suffix}.json`), project);
  await writeJson(
    path.join(REPORTS_DIRECTORY, `spatial-proof-${suffix}.json`),
    {
      contractId: contract.id,
      kind: contract.kind,
      runtimeBuildFingerprint,
      ...spatialProof,
    },
  );
  validations.push({
    profileId: profile.id,
    durationInFrames: result.timeline.durationInFrames,
    durationSeconds: result.timeline.durationSeconds,
    directionSectors: spatialProof.checks.find(
      ({id}) => id === 'path-locomotion-direction-sectors',
    )?.actual,
    depthTravel: spatialProof.checks.find(
      ({id}) => id === 'path-locomotion-depth-travel',
    )?.actual,
    depthDirections: spatialProof.checks.find(
      ({id}) => id === 'path-locomotion-depth-directions',
    )?.actual,
    projectionScaleDelta: spatialProof.checks.find(
      ({id}) => id === 'path-locomotion-depth-projection',
    )?.actual,
    maximumHeadingErrorDegrees: spatialProof.checks.find(
      ({id}) => id === 'path-locomotion-heading',
    )?.actual,
    maximumTurnDegreesPerSecond: spatialProof.checks.find(
      ({id}) => id === 'path-locomotion-turn-rate',
    )?.actual,
    warnings: result.issues.filter(({level}) => level !== 'error'),
  });
}

await writeJson(
  path.join(REPORTS_DIRECTORY, 'prepare-acceptance-report.json'),
  {
    schemaVersion: 1,
    passed: validations.length === PATH_LOCOMOTION_PROFILES.length,
    runtimeBuildFingerprint,
    providerBudget: 0,
    providerCalls: 0,
    localDeterministicAssets: manifest.assets.length,
    validations,
  },
);

console.log(`✓ prepared ${PATH_LOCOMOTION_SLUG}`);
console.log('✓ provider calls: 0; local deterministic assets: 6');
console.log(
  '✓ three profiles passed path, depth projection, heading, turn, gait, and camera checks',
);
