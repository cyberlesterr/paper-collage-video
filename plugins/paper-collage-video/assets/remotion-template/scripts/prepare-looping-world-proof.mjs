#!/usr/bin/env node
import {printCliHelp} from './cli-help-lib.mjs';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {
  LOOPING_WORLD_DURATION_SECONDS,
  LOOPING_WORLD_FPS,
  LOOPING_WORLD_GROUP_ID,
  LOOPING_WORLD_PROFILES,
  LOOPING_WORLD_SCENE_ID,
  LOOPING_WORLD_SLUG,
  LOOPING_WORLD_STRIPS,
  LOOPING_WORLD_UPDATED_AT,
  compileLoopingWorldStoryboard,
  createLoopingWorldPlan,
  createLoopingWorldProject,
  createLoopingWorldStoryboardAuthoring,
} from '../fixtures/looping-world-fixture.mjs';
import {validateProject} from './project-lib.mjs';
import {validateStoryboard} from './storyboard-lib.mjs';
import {
  LOOPING_STRIP_RECOVERY_POLICY,
  deriveLoopingStrip,
} from './looping-strip-lib.mjs';
import {buildLoopingWorldProof} from './world-motion-proof-lib.mjs';
import {createRuntimeBuildFingerprint} from './runtime-build-lib.mjs';

const USAGE =
  "用法：npm run proof:looping-world:prepare --";
printCliHelp(process.argv.slice(2), USAGE);

const ROOT = path.resolve(import.meta.dirname, '..');
const PUBLIC_DIRECTORY = path.join(ROOT, 'public', 'fixtures', 'looping-world');
const PROOF_DIRECTORY = path.join(ROOT, 'dist', LOOPING_WORLD_SLUG);
const INPUTS_DIRECTORY = path.join(PROOF_DIRECTORY, 'inputs');
const REPORTS_DIRECTORY = path.join(PROOF_DIRECTORY, 'reports');
const STRIP_REPORT_DIRECTORY = path.join(PROOF_DIRECTORY, 'looping-strip');

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const sha256File = async (file) => sha256(await fs.readFile(file));
const writeJson = async (file, value) => {
  await fs.mkdir(path.dirname(file), {recursive: true});
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
};
const publicSrc = (file) =>
  path.relative(path.join(ROOT, 'public'), file).split(path.sep).join('/');

const normalizeHorizontalSeam = async (file, bandPixels = 128) => {
  const source = await sharp(file).png().toBuffer();
  const {data, info} = await sharp(source)
    .ensureAlpha()
    .raw()
    .toBuffer({resolveWithObject: true});
  const band = Math.min(bandPixels, Math.floor(info.width / 4));
  const edge = [...data.subarray(0, info.channels)];
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < band; x += 1) {
      for (const targetX of [x, info.width - band + x]) {
        const offset = (y * info.width + targetX) * info.channels;
        for (let channel = 0; channel < info.channels; channel += 1) {
          data[offset + channel] = edge[channel];
        }
      }
    }
  }
  await sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels,
    },
  })
    .png()
    .toFile(file);
};

const svgDocument = ({width, height, background = null, body}) => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  ${background ? `<rect width="${width}" height="${height}" fill="${background}"/>` : ''}
  ${body}
</svg>`,
);

const mountainSvg = ({width, height}) => svgDocument({
  width,
  height,
  background: '#a8d2cf',
  body: `
    <circle cx="${Math.round(width * 0.73)}" cy="118" r="72" fill="#f4c35a" opacity=".9"/>
    <path d="M0 620 L92 568 L218 595 L342 446 L498 586 L650 382 L830 582 L1014 480 L1172 590 L1355 425 L1540 584 L1735 502 L${width} 620 L${width} ${height} L0 ${height}Z" fill="#668f83"/>
    <path d="M0 654 L172 594 L350 642 L512 532 L716 648 L928 570 L1130 646 L1325 552 L1514 642 L1710 594 L${width} 654 L${width} ${height} L0 ${height}Z" fill="#416f68"/>
    <path d="M0 690 C260 648 420 694 650 660 C860 630 1030 698 1260 662 C1480 630 1700 686 ${width} 664 L${width} ${height} L0 ${height}Z" fill="#284e4b"/>
    <path d="M320 460 l22 38 32-12-19 36 26 27-39-8-21 33-4-41-38-10 36-17z" fill="#f8e7bd" opacity=".7"/>
    <path d="M1330 448 l20 32 29-10-17 31 23 23-35-6-18 28-4-35-33-9 31-14z" fill="#f8e7bd" opacity=".7"/>
  `,
});

const treeSvg = ({width, height}) => {
  const clusters = Array.from({length: 14}, (_, index) => {
    const x = 110 + index * ((width - 220) / 13);
    const scale = 0.72 + (index % 4) * 0.09;
    return `
      <g transform="translate(${x.toFixed(1)} ${height - 42}) scale(${scale})">
        <rect x="-13" y="-240" width="26" height="240" rx="8" fill="#684d39"/>
        <circle cx="-44" cy="-226" r="72" fill="${index % 2 ? '#3f7653' : '#548c5c'}"/>
        <circle cx="30" cy="-246" r="84" fill="${index % 3 ? '#5b965f' : '#4a8257'}"/>
        <circle cx="6" cy="-326" r="70" fill="${index % 2 ? '#74a767' : '#649b61'}"/>
        <path d="M-72 -205 Q-24 -166 34 -202" fill="none" stroke="#efe1b8" stroke-width="10" opacity=".55"/>
      </g>
    `;
  }).join('');
  return svgDocument({
    width,
    height,
    body: `
      <path d="M0 ${height - 38} H${width} V${height} H0Z" fill="#3f684e" opacity=".75"/>
      ${clusters}
    `,
  });
};

const roadSvg = ({width, height}) => {
  const dashes = Array.from({length: 16}, (_, index) => {
    const x = 170 + index * ((width - 340) / 15);
    return `<path d="M${x.toFixed(1)} 450 l110 0 34 34-130 0z" fill="#f8e7bd" opacity=".9"/>`;
  }).join('');
  const stones = Array.from({length: 24}, (_, index) => {
    const x = 120 + index * ((width - 240) / 23);
    const y = 570 + (index % 3) * 34;
    return `<ellipse cx="${x.toFixed(1)}" cy="${y}" rx="${18 + index % 4 * 4}" ry="${7 + index % 3 * 2}" fill="#745f55" opacity=".55"/>`;
  }).join('');
  return svgDocument({
    width,
    height,
    background: '#9e7358',
    body: `
      <path d="M0 0 H${width} V132 Q${Math.round(width * .75)} 88 ${Math.round(width * .5)} 132 T0 132Z" fill="#5d8e5a"/>
      <path d="M0 132 Q${Math.round(width * .25)} 86 ${Math.round(width * .5)} 132 T${width} 132 V210 H0Z" fill="#d5b56e"/>
      <path d="M0 226 H${width}" stroke="#443e3d" stroke-width="18" stroke-dasharray="32 28" opacity=".38"/>
      ${dashes}
      ${stones}
      <path d="M0 688 Q${Math.round(width * .2)} 650 ${Math.round(width * .4)} 686 T${Math.round(width * .8)} 684 T${width} 686 V${height} H0Z" fill="#6d5349"/>
    `,
  });
};

const grassSvg = ({width, height}) => {
  const tufts = Array.from({length: 34}, (_, index) => {
    const x = 88 + index * ((width - 176) / 33);
    const heightOffset = 300 + (index % 5) * 44;
    const lean = index % 2 === 0 ? -34 : 34;
    return `
      <g transform="translate(${x.toFixed(1)} ${height - 4})">
        <path d="M0 0 Q${lean} -${heightOffset * .52} ${lean * .7} -${heightOffset}" fill="none" stroke="#244f43" stroke-width="20" stroke-linecap="round"/>
        <path d="M5 0 Q${-lean * .45} -${heightOffset * .5} ${-lean * .65} -${heightOffset * .78}" fill="none" stroke="#3f7653" stroke-width="15" stroke-linecap="round"/>
        <path d="M-4 0 Q${lean * .3} -${heightOffset * .42} ${lean * .85} -${heightOffset * .64}" fill="none" stroke="#6d9d5e" stroke-width="12" stroke-linecap="round"/>
      </g>
    `;
  }).join('');
  return svgDocument({
    width,
    height,
    body: `
      <path d="M0 ${height - 52} Q${Math.round(width * .18)} ${height - 100} ${Math.round(width * .36)} ${height - 54} T${Math.round(width * .72)} ${height - 56} T${width} ${height - 54} V${height} H0Z" fill="#244f43"/>
      ${tufts}
    `,
  });
};

const carSvg = () => svgDocument({
  width: 720,
  height: 360,
  body: `
    <g transform="translate(18 22)">
      <path d="M90 210 L136 112 Q154 74 204 66 H420 Q470 68 504 112 L566 204 L638 220 V284 H70 V236Z" fill="#e0a23c" stroke="#24343c" stroke-width="18" stroke-linejoin="round"/>
      <path d="M210 88 H408 Q442 90 466 122 L500 188 H166 L194 116 Q200 96 210 88Z" fill="#d8ece5" stroke="#24343c" stroke-width="14"/>
      <path d="M330 92 V186" stroke="#24343c" stroke-width="12"/>
      <rect x="88" y="212" width="86" height="24" rx="12" fill="#fff0c7"/>
      <circle cx="206" cy="276" r="58" fill="#24343c"/>
      <circle cx="206" cy="276" r="28" fill="#d8c9a5"/>
      <circle cx="516" cy="276" r="58" fill="#24343c"/>
      <circle cx="516" cy="276" r="28" fill="#d8c9a5"/>
      <path d="M94 204 L82 164 L114 146 L142 198Z" fill="#d86a45" stroke="#24343c" stroke-width="10"/>
      <path d="M582 218 h52" stroke="#fff0c7" stroke-width="18" stroke-linecap="round"/>
      <path d="M68 302 Q360 330 650 300" fill="none" stroke="#24343c" stroke-width="13" stroke-linecap="round" opacity=".32"/>
    </g>
  `,
});

const finishMarkerSvg = () => svgDocument({
  width: 240,
  height: 420,
  body: `
    <path d="M116 398 V38" stroke="#24343c" stroke-width="22" stroke-linecap="round"/>
    <path d="M126 52 H218 L188 112 L218 172 H126Z" fill="#fff0c7" stroke="#24343c" stroke-width="14" stroke-linejoin="round"/>
    <path d="M142 68 h32 v32 h-32z M174 100 h28 v32 h-28z M142 132 h32 v24 h-32z" fill="#d86a45"/>
    <ellipse cx="116" cy="370" rx="76" ry="10" fill="#24343c"/>
  `,
});

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
    const pulse = Math.sin(seconds * Math.PI * 2 * 110) * 0.25 +
      Math.sin(seconds * Math.PI * 2 * 165) * 0.12;
    const cadence = 0.32 + 0.68 * Math.max(0, Math.sin(seconds * Math.PI * 2 * 0.5));
    const sample = Math.round(pulse * cadence * 32767 * 0.1);
    buffer.writeInt16LE(sample, 44 + index * 2);
  }
  return buffer;
};

const createSourceRecord = async ({assetId, file, compositionBinding = null}) => {
  const bytes = await fs.readFile(file);
  const metadata = await sharp(file).metadata();
  const digest = sha256(bytes);
  return {
    recordId: sha256(`looping-world-source-record:${assetId}:${digest}`),
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
    requestFingerprint: sha256(`looping-world-source-request:${assetId}:${digest}`),
    reusedFrom: null,
    sha256: digest,
    sizeBytes: bytes.length,
    media: {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format ?? 'png',
      hasAlpha: Boolean(metadata.hasAlpha),
    },
    recordedAt: LOOPING_WORLD_UPDATED_AT,
    request: {capability: 'image', source: 'deterministic-local-svg'},
    compositionBinding,
    familyFingerprint: null,
    lifecycle: {
      status: 'active',
      changedAt: LOOPING_WORLD_UPDATED_AT,
      reason: 'repository-owned zero-provider engineering fixture source',
      supersededBy: null,
    },
  };
};

await fs.mkdir(PUBLIC_DIRECTORY, {recursive: true});
await fs.mkdir(INPUTS_DIRECTORY, {recursive: true});
await fs.mkdir(REPORTS_DIRECTORY, {recursive: true});
await fs.mkdir(STRIP_REPORT_DIRECTORY, {recursive: true});

const svgBuilders = {
  far: mountainSvg,
  mid: treeSvg,
  ground: roadSvg,
  near: grassSvg,
};
const sourceRecords = [];
const sourceFiles = {};
for (const strip of LOOPING_WORLD_STRIPS) {
  const sourceFile = path.join(PUBLIC_DIRECTORY, `${strip.stripId}-source.png`);
  await sharp(svgBuilders[strip.role]({
    width: strip.sourceWidth,
    height: strip.sourceHeight,
  })).png().toFile(sourceFile);
  await normalizeHorizontalSeam(sourceFile);
  sourceFiles[strip.id] = sourceFile;
  sourceRecords.push(await createSourceRecord({
    assetId: strip.sourceAssetId,
    file: sourceFile,
  }));
}

const carFile = path.join(PUBLIC_DIRECTORY, 'paper-car.png');
await sharp(carSvg()).png().toFile(carFile);
const carRecord = await createSourceRecord({
  assetId: 'paper-car',
  file: carFile,
  compositionBinding: {
    sceneId: LOOPING_WORLD_SCENE_ID,
    nodeId: 'paper-car',
    pattern: 'looping-environment',
    outputRole: 'tracked-subject',
  },
});
const finishMarkerFile = path.join(PUBLIC_DIRECTORY, 'finish-marker.png');
await sharp(finishMarkerSvg()).png().toFile(finishMarkerFile);
const finishMarkerRecord = await createSourceRecord({
  assetId: 'finish-marker',
  file: finishMarkerFile,
  compositionBinding: {
    sceneId: LOOPING_WORLD_SCENE_ID,
    nodeId: 'finish-marker',
    pattern: 'looping-environment',
    outputRole: 'world-anchored-participant',
  },
});

const audioFile = path.join(PUBLIC_DIRECTORY, 'engineering-tone.wav');
await fs.writeFile(audioFile, wavBuffer({durationSeconds: LOOPING_WORLD_DURATION_SECONDS}));
const audioSha256 = await sha256File(audioFile);
const timingFile = path.join(PUBLIC_DIRECTORY, 'engineering-tone.timing.json');
await writeJson(timingFile, {
  schemaVersion: 1,
  mediaId: 'looping-world-audio',
  mediaSha256: audioSha256,
  durationSeconds: LOOPING_WORLD_DURATION_SECONDS,
  source: 'deterministic-local-waveform-fixture',
  sampleRate: 48000,
  cues: [{
    id: `${LOOPING_WORLD_SCENE_ID}-fixture-cue`,
    kind: 'narration-phrase',
    source: 'authored',
    atSeconds: 0.08,
    endSeconds: 0.4,
  }],
});
const media = {
  id: 'looping-world-audio',
  src: publicSrc(audioFile),
  sha256: audioSha256,
  durationSeconds: LOOPING_WORLD_DURATION_SECONDS,
  timingDataSrc: publicSrc(timingFile),
};

let manifest = {
  $schema: '../../schemas/assets-manifest.schema.json',
  schemaVersion: 4,
  projectSlug: LOOPING_WORLD_SLUG,
  assets: [...sourceRecords, carRecord, finishMarkerRecord],
};
const stripAssets = {};
const derivationReports = [];
for (const strip of LOOPING_WORLD_STRIPS) {
  const outputFile = path.join(PUBLIC_DIRECTORY, `${strip.stripId}-loop.png`);
  const spec = {
    $schema: '../../schemas/looping-strip.schema.json',
    schemaVersion: 1,
    projectSlug: LOOPING_WORLD_SLUG,
    sceneId: LOOPING_WORLD_SCENE_ID,
    groupId: LOOPING_WORLD_GROUP_ID,
    nodeId: strip.id,
    stripId: strip.stripId,
    assetId: strip.assetId,
    role: strip.role,
    sourceAssetId: strip.sourceAssetId,
    output: path.relative(ROOT, outputFile).split(path.sep).join('/'),
    axis: 'x',
    seamStrategy: 'exact',
    canonicalTile: {
      left: 0,
      top: 0,
      width: strip.sourceWidth,
      height: strip.sourceHeight,
    },
    edgeBandPixels: 8,
    thresholds: {
      rgbMean: 0,
      rgbMaximum: 0,
      alphaMean: 0,
      alphaMaximum: 0,
    },
    minimumViewportSpan: 1.05,
    proofViewports: LOOPING_WORLD_PROFILES.map((profile) => ({
      profile: profile.id,
      width: profile.width,
      height: profile.height,
      renderHeight: Math.round(strip.height * profile.height),
    })),
    recoveryPolicy: LOOPING_STRIP_RECOVERY_POLICY,
    applyToProject: false,
  };
  await writeJson(
    path.join(INPUTS_DIRECTORY, `${strip.stripId}-derivation.json`),
    spec,
  );
  const result = await deriveLoopingStrip({root: ROOT, spec, manifest});
  manifest = result.manifest;
  stripAssets[strip.id] = {
    src: result.publicSrc,
    binding: result.binding,
  };
  derivationReports.push(result.report);
  await writeJson(
    path.join(STRIP_REPORT_DIRECTORY, `${strip.stripId}-report.json`),
    result.report,
  );
}

const storyboard = compileLoopingWorldStoryboard({media});
const storyboardIssues = validateStoryboard(storyboard, {
  slug: LOOPING_WORLD_SLUG,
  plan: createLoopingWorldPlan(),
});
if (storyboardIssues.length > 0) {
  throw new Error(storyboardIssues.map(({location, message}) => `${location}: ${message}`).join('\n'));
}
await writeJson(path.join(INPUTS_DIRECTORY, 'storyboard.json'), storyboard);
await writeJson(
  path.join(INPUTS_DIRECTORY, 'storyboard-authoring.json'),
  createLoopingWorldStoryboardAuthoring({media}),
);
await writeJson(path.join(INPUTS_DIRECTORY, 'assets-manifest.json'), manifest);

const runtimeBuildFingerprint = await createRuntimeBuildFingerprint();
const projectValidation = [];
const worldProofs = [];
for (const profile of LOOPING_WORLD_PROFILES) {
  const project = createLoopingWorldProject({
    media,
    profileId: profile.id,
    stripAssets,
    carSrc: publicSrc(carFile),
    finishMarkerSrc: publicSrc(finishMarkerFile),
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
  const suffix = profile.id.replace(':', 'x');
  await writeJson(path.join(INPUTS_DIRECTORY, `project-${suffix}.json`), project);
  const group = project.scenes[0].composition.nodes.find(
    ({id}) => id === LOOPING_WORLD_GROUP_ID,
  );
  const proof = await buildLoopingWorldProof({
    root: ROOT,
    projectSlug: LOOPING_WORLD_SLUG,
    scene: project.scenes[0],
    group,
    video: project.video,
    runtimeBuildFingerprint,
    profiles: LOOPING_WORLD_PROFILES.map(({id, width, height}) => ({
      profile: id,
      width,
      height,
    })),
  });
  if (!proof.passed) {
    throw new Error(`${profile.id} looping world proof failed: ${JSON.stringify(proof)}`);
  }
  await writeJson(path.join(REPORTS_DIRECTORY, `world-motion-${suffix}.json`), proof);
  projectValidation.push({
    profileId: profile.id,
    passed: true,
    durationInFrames: result.timeline.durationInFrames,
    durationSeconds: result.timeline.durationSeconds,
    warnings: result.issues.filter(({level}) => level !== 'error'),
  });
  worldProofs.push({profileId: profile.id, ...proof});
}

const acceptance = {
  schemaVersion: 1,
  passed:
    derivationReports.length === LOOPING_WORLD_STRIPS.length &&
    derivationReports.every(({passed}) => passed) &&
    worldProofs.every(({passed}) => passed),
  runtimeBuildFingerprint,
  providerBudget: 0,
  providerImageCalls: 0,
  localDeterministicDerivatives: derivationReports.reduce(
    (total, {localDerivatives}) => total + localDerivatives,
    0,
  ),
  avoidedProviderCalls: derivationReports.reduce(
    (total, {avoidedCalls}) => total + avoidedCalls,
    0,
  ),
  minimumWrapCount: Math.min(
    ...worldProofs.flatMap(({strips}) => strips.map(({wrapCount}) => wrapCount)),
  ),
  allProfilesGapFree: worldProofs.every(({coverage}) =>
    coverage.every(({uncoveredPixels}) => uncoveredPixels === 0)
  ),
  allSeamsPassed: worldProofs.every(({strips}) =>
    strips.every(({seamPassed}) => seamPassed)
  ),
  speedStrictlyDepthOrdered: worldProofs.every(({speedOrdered}) => speedOrdered),
  trackedSubjectReadable: worldProofs.every(
    ({trackedSubjectProof}) => trackedSubjectProof.readabilityPassed,
  ),
  visibleWorldSurfaces: worldProofs.every(({strips}) =>
    strips.every(({visibleSurfaceProof}) => visibleSurfaceProof.passed)
  ),
  allSubjectAnchorsPassed: worldProofs.every(({subjectProofs}) =>
    subjectProofs.every(({proof}) => proof.passed)
  ),
  allSubjectOcclusionsPassed: worldProofs.every(({subjectOcclusions}) =>
    subjectOcclusions.every(({passed}) => passed)
  ),
  signedWorldDirectionPassed: worldProofs.every(
    ({signedDirectionProof}) => signedDirectionProof.passed,
  ),
  foregroundOcclusion: worldProofs.map(
    ({profileId, foregroundOcclusion}) => ({
      profileId,
      ...foregroundOcclusion,
    }),
  ),
  projectValidation,
  derivations: derivationReports.map((report) => ({
    stripId: report.stripId,
    passed: report.passed,
    derivationFingerprint: report.derivationFingerprint,
    evidence: report.evidence,
  })),
};
if (!acceptance.passed || acceptance.minimumWrapCount < 4) {
  throw new Error(`looping world acceptance failed: ${JSON.stringify(acceptance)}`);
}
await writeJson(path.join(REPORTS_DIRECTORY, 'prepare-acceptance-report.json'), acceptance);

console.log(`✓ prepared ${LOOPING_WORLD_SLUG}`);
console.log(`✓ provider calls: 0; local derivatives: ${acceptance.localDeterministicDerivatives}`);
console.log(`✓ minimum strip wraps: ${acceptance.minimumWrapCount}`);
