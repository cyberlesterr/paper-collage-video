#!/usr/bin/env node
import {printCliHelp} from './cli-help-lib.mjs';
import {execFile} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import sharp from 'sharp';
import {
  PHASE2_PROOF_PROFILES,
} from '../fixtures/phase2-proof-fixture.mjs';
import {flattenCompositionNodes} from './composition-lib.mjs';
import {
  collectCompositeQualityTargets,
  inspectCompositeTechnical,
} from './quality-lib.mjs';
import {buildAssetEvidence} from './asset-evidence-lib.mjs';
import {
  buildLayerStackProof,
  referenceCellRectForRegisteredSheet,
} from './layer-stack-proof-lib.mjs';
import {createRuntimeBuildFingerprint} from './runtime-build-lib.mjs';
import {
  lifecycleOpacity,
  resolveDataState,
  resolveTypographyEmphasis,
  resolveTypographyReveal,
} from '../src/editorialPrimitives.mjs';
import {
  PHASE2_PROOF_DIR,
  PHASE2_PUBLIC_DIR,
  PHASE2_ROOT,
  hashFiles,
  listFilesRecursively,
  readJson,
  sha256File,
  writeJson,
} from './phase2-proof-lib.mjs';

const USAGE =
  "用法：npm run proof:phase2:verify --";
printCliHelp(process.argv.slice(2), USAGE);

const execFileAsync = promisify(execFile);
const reportsDirectory = path.join(PHASE2_PROOF_DIR, 'reports');
const framesDirectory = path.join(PHASE2_PROOF_DIR, 'frames');
const contactsDirectory = path.join(PHASE2_PROOF_DIR, 'contact-sheets');

const requireFile = async (file) => {
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size === 0) throw new Error('empty');
  } catch {
    throw new Error(`缺少 Phase 2 proof artifact：${file}`);
  }
};

const probeVideo = async (file) => {
  const {stdout} = await execFileAsync('ffprobe', [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_streams',
    '-show_format',
    file,
  ]);
  const probe = JSON.parse(stdout);
  const stream = probe.streams.find(({codec_type: kind}) => kind === 'video');
  if (!stream) throw new Error(`preview 缺少视频流：${file}`);
  const audioStream = probe.streams.find(
    ({codec_type: kind}) => kind === 'audio',
  );
  const [rateNumerator, rateDenominator] = String(stream.avg_frame_rate)
    .split('/')
    .map(Number);
  return {
    width: stream.width,
    height: stream.height,
    fps: rateNumerator / rateDenominator,
    durationSeconds: Number(stream.duration),
    audioDurationSeconds: audioStream ? Number(audioStream.duration) : null,
    containerDurationSeconds: Number(probe.format.duration),
    frameCount: Number(stream.nb_frames),
    codec: stream.codec_name,
  };
};

const extractFrame = async ({video, frame, output}) => {
  await fs.mkdir(path.dirname(output), {recursive: true});
  await execFileAsync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    video,
    '-vf',
    `select=eq(n\\,${frame})`,
    '-vsync',
    '0',
    '-frames:v',
    '1',
    output,
  ]);
  await requireFile(output);
  return output;
};

const contactSheet = async ({files, output, title, columns = 3}) => {
  const thumbWidth = 320;
  const thumbHeight = 190;
  const labelHeight = 46;
  const rows = Math.ceil(files.length / columns);
  const canvasWidth = columns * thumbWidth;
  const canvasHeight = labelHeight + rows * thumbHeight;
  const composites = [{
    input: Buffer.from(
      `<svg width="${canvasWidth}" height="${labelHeight}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#162b35"/><text x="18" y="31" font-family="Arial" font-size="23" font-weight="700" fill="#fffaf0">${title}</text></svg>`,
    ),
    left: 0,
    top: 0,
  }];
  for (const [index, file] of files.entries()) {
    const image = await sharp(file)
      .resize(thumbWidth, thumbHeight, {
        fit: 'contain',
        background: '#162b35',
      })
      .png()
      .toBuffer();
    composites.push({
      input: image,
      left: (index % columns) * thumbWidth,
      top: labelHeight + Math.floor(index / columns) * thumbHeight,
    });
  }
  await fs.mkdir(path.dirname(output), {recursive: true});
  await sharp({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 3,
      background: '#162b35',
    },
  }).composite(composites).png().toFile(output);
  return output;
};

const storyboard = await readJson(
  path.join(PHASE2_PROOF_DIR, 'inputs', 'storyboard.json'),
);
const assetManifest = await readJson(
  path.join(PHASE2_PROOF_DIR, 'inputs', 'assets-manifest.json'),
);
const projects = {};
for (const profile of PHASE2_PROOF_PROFILES) {
  const suffix = profile.id.replace(':', 'x');
  projects[profile.id] = await readJson(
    path.join(PHASE2_PROOF_DIR, 'inputs', `project-${suffix}.json`),
  );
}

const previewReports = {};
const proofTimeArtifacts = [];
const transitionArtifacts = [];
const dataArtifacts = [];
const contactSheets = [];
for (const profile of PHASE2_PROOF_PROFILES) {
  const suffix = profile.id.replace(':', 'x');
  const project = projects[profile.id];
  const preview = path.join(
    PHASE2_PROOF_DIR,
    'previews',
    `preview-${suffix}.mp4`,
  );
  await requireFile(preview);
  const probe = await probeVideo(preview);
  const expectedFrames = 180;
  if (
    probe.width !== profile.width ||
    probe.height !== profile.height ||
    Math.abs(probe.fps - 30) > 0.001 ||
    Math.abs(probe.durationSeconds - 6) > 0.04 ||
    (Number.isFinite(probe.frameCount) && probe.frameCount !== expectedFrames)
  ) {
    throw new Error(`${profile.id} preview 媒体规格不匹配：${JSON.stringify(probe)}`);
  }
  previewReports[profile.id] = {
    file: path.relative(PHASE2_ROOT, preview),
    ...probe,
  };

  const profileProofFrames = [];
  let sceneStart = 0;
  for (const scene of project.scenes) {
    const sceneFrames = Math.ceil(
      (scene.narration.startSeconds +
        scene.narration.durationSeconds +
        scene.tailSeconds) *
        project.video.fps,
    );
    for (const proof of scene.motion.proofTimes) {
      const frame =
        sceneStart +
        Math.round(proof.at * Math.max(1, sceneFrames - 1));
      const output = path.join(
        framesDirectory,
        suffix,
        'proof-times',
        `${proof.id}-f${frame}.png`,
      );
      await extractFrame({video: preview, frame, output});
      const record = {
        profileId: profile.id,
        sceneId: scene.id,
        proofTimeId: proof.id,
        frame,
        file: path.relative(PHASE2_ROOT, output),
        sha256: await sha256File(output),
      };
      proofTimeArtifacts.push(record);
      profileProofFrames.push(output);
    }
    sceneStart += sceneFrames;
  }
  const profileContact = path.join(
    contactsDirectory,
    `contact-sheet-${suffix}.png`,
  );
  await contactSheet({
    files: profileProofFrames,
    output: profileContact,
    title: `VOX Phase 2 · ${profile.id} · proofTimes`,
  });
  contactSheets.push(profileContact);

  for (const transition of storyboard.editorial.transitionPlans) {
    for (const [phase, delta] of [['before', -1], ['at', 0], ['after', 1]]) {
      const frame = Math.max(
        0,
        Math.min(expectedFrames - 1, transition.editPointFrame + delta),
      );
      const output = path.join(
        framesDirectory,
        suffix,
        'transitions',
        transition.id,
        `${phase}-f${frame}.png`,
      );
      await extractFrame({video: preview, frame, output});
      transitionArtifacts.push({
        profileId: profile.id,
        transitionId: transition.id,
        phase,
        frame,
        file: path.relative(PHASE2_ROOT, output),
        sha256: await sha256File(output),
      });
    }
  }

  const dataFramePlan = [
    ['bar-chart', 96],
    ['column-chart', 112],
    ['line-chart', 123],
    ['comparison-table', 134],
    ['timeline', 144],
    ['map', 156],
    ['flow', 171],
  ];
  const profileDataFrames = [];
  for (const [graphicKind, frame] of dataFramePlan) {
    const output = path.join(
      framesDirectory,
      suffix,
      'data',
      `${graphicKind}-f${frame}.png`,
    );
    await extractFrame({video: preview, frame, output});
    dataArtifacts.push({
      profileId: profile.id,
      graphicKind,
      frame,
      file: path.relative(PHASE2_ROOT, output),
      sha256: await sha256File(output),
    });
    profileDataFrames.push(output);
  }
  await contactSheet({
    files: profileDataFrames,
    output: path.join(contactsDirectory, `data-contact-sheet-${suffix}.png`),
    title: `VOX Phase 2 · ${profile.id} · data SVG states`,
    columns: 4,
  });
}

await contactSheet({
  files: contactSheets,
  output: path.join(contactsDirectory, 'contact-sheet-all-formats.png'),
  title: 'VOX Phase 2 · responsive directing comparison',
  columns: 3,
});

const mediaVerification = [];
for (const item of storyboard.editorial.media) {
  const file = path.join(PHASE2_ROOT, 'public', item.src);
  await requireFile(file);
  const actualSha256 = await sha256File(file);
  if (actualSha256 !== item.sha256) {
    throw new Error(`editorial media SHA 漂移：${item.src}`);
  }
  mediaVerification.push({
    mediaId: item.id,
    file: path.relative(PHASE2_ROOT, file),
    sha256: actualSha256,
    durationSeconds: item.durationSeconds,
    timelineMode: item.timelineMode,
    sceneOffsetSeconds: item.sceneOffsetSeconds ?? 0,
  });
}

const sceneStarts = new Map([
  ['phase2-scene-1', 0],
  ['phase2-scene-2', 90],
]);
const cueById = new Map(storyboard.editorial.cues.map((cue) => [cue.id, cue]));
const mediaById = new Map(storyboard.editorial.media.map((item) => [item.id, item]));
const pointById = new Map(
  storyboard.editorial.editPoints.map((point) => [point.id, point]),
);
const editPointChecks = storyboard.editorial.resolvedEditPoints.map((point) => {
  const authored = pointById.get(point.id);
  const cues = authored.cueIds.map((cueId) => cueById.get(cueId));
  const winner = [...cues].sort(
    (left, right) =>
      right.priority - left.priority ||
      left.atSeconds - right.atSeconds ||
      left.id.localeCompare(right.id),
  )[0];
  const timingCue = authored.conflictPolicy === 'merge'
    ? [...cues].sort(
        (left, right) =>
          left.atSeconds - right.atSeconds || left.id.localeCompare(right.id),
      )[0]
    : winner;
  const timingMedia = mediaById.get(timingCue.mediaId);
  const authoredMediaFrame = Math.round(timingCue.atSeconds * 30);
  const authoredOffsetFrame = Math.round(
    (timingMedia.sceneOffsetSeconds ?? 0) * 30,
  );
  const expectedRenderFrame = timingMedia.timelineMode === 'global'
    ? authoredMediaFrame + authoredOffsetFrame
    : sceneStarts.get(timingCue.sceneId) +
      authoredMediaFrame +
      authoredOffsetFrame;
  const toleranceFrames = Math.floor(point.toleranceSeconds * 30);
  const delta = Math.abs(point.renderFrame - expectedRenderFrame);
  const passed = authored.conflictPolicy === 'offset-within-window'
    ? delta <= toleranceFrames
    : delta === 0;
  return {
    editPointId: point.id,
    cueId: timingCue.id,
    actualMediaSeconds: timingCue.atSeconds,
    authoredMediaFrame,
    expectedRenderFrame,
    resolvedMediaFrame: point.mediaFrame,
    resolvedSceneFrame: point.sceneFrame,
    resolvedRenderFrame: point.renderFrame,
    toleranceFrames,
    delta,
    passed,
  };
});
if (!editPointChecks.every(({passed}) => passed)) {
  throw new Error('edit point 到渲染帧的确定性换算验证失败。');
}

const proofProject = projects['16:9'];
const title1 = flattenCompositionNodes(
  proofProject.scenes[0].composition.nodes,
).find(({node}) => node.id === 'title-1').node;
const title2 = flattenCompositionNodes(
  proofProject.scenes[1].composition.nodes,
).find(({node}) => node.id === 'title-2').node;
const wordBefore = resolveTypographyReveal({
  node: title1,
  editorial: proofProject.editorial,
  sceneId: 'phase2-scene-1',
  frame: 12,
  lines: [title1.text],
});
const wordAfter = resolveTypographyReveal({
  node: title1,
  editorial: proofProject.editorial,
  sceneId: 'phase2-scene-1',
  frame: 68,
  lines: [title1.text],
});
const lineBefore = resolveTypographyReveal({
  node: title2,
  editorial: proofProject.editorial,
  sceneId: 'phase2-scene-2',
  frame: 8,
  lines: ['从音频', '到 SVG 证明'],
});
const lineAfter = resolveTypographyReveal({
  node: title2,
  editorial: proofProject.editorial,
  sceneId: 'phase2-scene-2',
  frame: 24,
  lines: ['从音频', '到 SVG 证明'],
});
const emphasis = resolveTypographyEmphasis({
  node: title1,
  editorial: proofProject.editorial,
  sceneId: 'phase2-scene-1',
  frame: 41,
});
const typographyTiming = {
  passed:
    wordBefore.filter(({visible}) => visible).length <
      wordAfter.filter(({visible}) => visible).length &&
    lineBefore.filter(({visible}) => visible).length <
      lineAfter.filter(({visible}) => visible).length &&
    emphasis.some(({text}) => text === '42') &&
    title1.treatment.highlights.some(({text}) => text === '42'),
  wordBefore,
  wordAfter,
  lineBefore,
  lineAfter,
  emphasis,
};
if (!typographyTiming.passed) {
  throw new Error('逐词、逐行或关键词 emphasis 证明失败。');
}

const scene2Nodes = flattenCompositionNodes(
  proofProject.scenes[1].composition.nodes,
).map(({node}) => node);
const counterChecks = scene2Nodes
  .filter(
    ({kind, annotationKind}) =>
      kind === 'annotation' &&
      ['numeric-counter', 'percentage-counter'].includes(annotationKind),
  )
  .map((node) => {
    const point = proofProject.editorial.resolvedEditPoints.find(
      ({id}) => id === node.lifecycle.enterEditPointId,
    );
    const frame = point.sceneFrame + (node.lifecycle.enterFrames ?? 1);
    const progress = lifecycleOpacity({
      lifecycle: node.lifecycle,
      editorial: proofProject.editorial,
      sceneId: 'phase2-scene-2',
      frame,
    });
    return {
      nodeId: node.id,
      annotationKind: node.annotationKind,
      frame,
      progress,
      renderedValue:
        node.annotationKind === 'percentage-counter'
          ? `${Math.round(node.value * progress)}%`
          : Math.round(node.value * progress),
      passed: progress === 1,
    };
  });
if (counterChecks.length !== 2 || !counterChecks.every(({passed}) => passed)) {
  throw new Error('数字 counter 状态证明失败。');
}

const dataStateChecks = scene2Nodes
  .filter(({kind}) => kind === 'data-graphic')
  .map((node) => ({
    nodeId: node.id,
    graphicKind: node.graphicKind,
    state: resolveDataState({
      node,
      editorial: proofProject.editorial,
      sceneId: 'phase2-scene-2',
      frame: 80,
    }),
  }));

const annotationReport = await readJson(
  path.join(reportsDirectory, 'annotation-collision-exclusion-report.json'),
);
const dataReport = await readJson(
  path.join(reportsDirectory, 'chart-map-timeline-report.json'),
);
const typographyReport = await readJson(
  path.join(reportsDirectory, 'typography-overflow-fit-report.json'),
);
const transitionReport = await readJson(
  path.join(reportsDirectory, 'transition-continuity-report.json'),
);
const responsiveReport = await readJson(
  path.join(reportsDirectory, 'responsive-directing-report.json'),
);
const requiredGraphicKinds = [
  'bar-chart',
  'column-chart',
  'comparison-table',
  'flow',
  'line-chart',
  'map',
  'timeline',
];
if (
  !annotationReport.passed ||
  !dataReport.passed ||
  !typographyReport.passed ||
  !transitionReport.passed ||
  responsiveReport.profiles.length !== 3 ||
  JSON.stringify(dataReport.graphicKinds) !== JSON.stringify(requiredGraphicKinds)
) {
  throw new Error('Phase 2 结构化 proof report 未覆盖全部正式原语。');
}

const qualityEntries = [];
const registeredFamilyArtifacts = [];
for (const profile of PHASE2_PROOF_PROFILES) {
  const suffix = profile.id.replace(':', 'x');
  const project = projects[profile.id];
  const targets = await collectCompositeQualityTargets(project, {
    manifest: assetManifest,
  });
  for (const target of targets) {
    let artifact;
    let proofTimeId = target.proofTimeIds[0] ?? 'responsive-plan';
    if (target.pattern === 'editorial-transition') {
      artifact = transitionArtifacts.find(
        (candidate) =>
          candidate.profileId === profile.id &&
          candidate.transitionId === target.editorialTransition.id &&
          candidate.phase === 'at',
      )?.file;
    } else if (target.pattern === 'responsive-directing') {
      artifact = path.relative(
        PHASE2_ROOT,
        path.join(contactsDirectory, `contact-sheet-${suffix}.png`),
      );
    } else {
      artifact = proofTimeArtifacts.find(
        (candidate) =>
          candidate.profileId === profile.id &&
          candidate.sceneId === target.sceneId,
      )?.file;
    }
    if (!artifact) throw new Error(`质量目标 ${target.compositeId} 缺少 proof frame。`);
    let cropArtifact = artifact;
    let assetEvidence = [];
    let layerStackProof = null;
    if (
      target.pattern === 'supported-subject' ||
      target.pattern === 'registered-depth-stack'
    ) {
      const sourceFile = path.join(PHASE2_ROOT, artifact);
      const bounds = {
        left: Math.max(0, Math.floor(target.group.transform.x * profile.width)),
        top: Math.max(0, Math.floor(target.group.transform.y * profile.height)),
        width: Math.max(1, Math.round(target.group.transform.width * profile.width)),
        height: Math.max(1, Math.round(target.group.transform.height * profile.height)),
      };
      bounds.width = Math.min(bounds.width, profile.width - bounds.left);
      bounds.height = Math.min(bounds.height, profile.height - bounds.top);
      const cropFile = path.join(
        framesDirectory,
        suffix,
        'registered-family',
        `${target.group.id}.png`,
      );
      await fs.mkdir(path.dirname(cropFile), {recursive: true});
      await sharp(sourceFile).extract(bounds).png().toFile(cropFile);
      cropArtifact = path.relative(PHASE2_ROOT, cropFile);
      const evidenceDirectory = path.join(
        PHASE2_PROOF_DIR,
        'asset-hardening',
        'registered-family',
        'phase2-render-scale',
        suffix,
      );
      await fs.mkdir(evidenceDirectory, {recursive: true});
      for (const node of target.group.children.filter(({kind}) => kind === 'asset')) {
        const record = target.familyRecords.find(
          (candidate) => candidate?.registeredFamilyBinding?.nodeId === node.id,
        );
        assetEvidence.push({
          sceneId: target.sceneId,
          ...await buildAssetEvidence({
            node,
            directory: evidenceDirectory,
            evidenceId: `${target.sceneId}-${node.id}`,
            renderSize: {
              width: bounds.width,
              height: bounds.height,
            },
            registeredFamilyBinding: record?.registeredFamilyBinding ?? null,
          }),
        });
      }
      if (target.pattern === 'registered-depth-stack') {
        const memberFiles = new Map(
          target.group.children
            .filter(({kind}) => kind === 'asset')
            .map((node) => [
              node.id,
              path.join(PHASE2_ROOT, 'public', node.src),
            ]),
        );
        const referenceRecord = assetManifest.assets.find(
          ({assetId}) =>
            assetId === target.group.registration.sourceMasterAssetId,
        );
        const referenceFile = referenceRecord?.file
          ? path.join(PHASE2_ROOT, referenceRecord.file)
          : null;
        const built = await buildLayerStackProof({
          group: target.group,
          memberFiles,
          referenceFile,
          referenceRect: referenceFile
            ? await referenceCellRectForRegisteredSheet({
                record: referenceRecord,
                file: referenceFile,
              })
            : null,
          directory: path.join(
            PHASE2_PROOF_DIR,
            'asset-hardening',
            'registered-family',
            'layer-stack',
            suffix,
          ),
          evidenceId: `${target.sceneId}-${target.group.id}`,
        });
        layerStackProof = {
          ...built,
          artifacts: {
            neutralReconstruction: path.relative(
              PHASE2_ROOT,
              built.artifacts.neutralReconstruction,
            ),
            referenceComparison: path.relative(
              PHASE2_ROOT,
              built.artifacts.referenceComparison,
            ),
            explodedView: path.relative(
              PHASE2_ROOT,
              built.artifacts.explodedView,
            ),
            envelopeExtremes: built.artifacts.envelopeExtremes.map(
              (entry) => ({
                ...entry,
                file: path.relative(PHASE2_ROOT, entry.file),
              }),
            ),
          },
        };
      }
      registeredFamilyArtifacts.push({
        profileId: profile.id,
        compositeId: target.compositeId,
        fullFrame: artifact,
        crop: cropArtifact,
        bounds,
        assetEvidence,
        layerStackProof,
      });
    }
    const proofReport = {
      composites: [{
        compositeId: target.compositeId,
        fingerprint: target.fingerprint,
        proofFrames: [{
          proofTimeId,
          fullFrame: artifact,
          crop: cropArtifact,
        }],
        layerStackProof,
      }],
      assetEvidence,
    };
    const technical = await inspectCompositeTechnical({target, proofReport});
    qualityEntries.push({
      profileId: profile.id,
      compositeId: target.compositeId,
      pattern: target.pattern,
      fingerprint: target.fingerprint,
      requiredChecks: target.requiredChecks,
      technical,
      passed: technical.passed,
    });
  }
}
const qualityReport = {
  schemaVersion: 1,
  passed: qualityEntries.every(({passed}) => passed),
  total: qualityEntries.length,
  entries: qualityEntries,
};
await writeJson(
  path.join(reportsDirectory, 'quality-report.json'),
  qualityReport,
);
if (!qualityReport.passed) {
  const failed = qualityEntries
    .filter(({passed}) => !passed)
    .map(({profileId, compositeId}) => `${profileId}:${compositeId}`);
  throw new Error(`Phase 2 quality report 未通过：${failed.join(', ')}`);
}
const registeredFamilyChromiumPassed =
  registeredFamilyArtifacts.length === PHASE2_PROOF_PROFILES.length &&
  registeredFamilyArtifacts.every(({assetEvidence, layerStackProof}) =>
    assetEvidence.length === 3 &&
    assetEvidence.every(({alphaBandInspection}) => alphaBandInspection.passed) &&
    layerStackProof?.passed === true &&
    layerStackProof.artifacts.envelopeExtremes.length === 3);
if (!registeredFamilyChromiumPassed) {
  throw new Error('Phase 2 三画幅 registered-family Chromium proof 未通过');
}
await writeJson(
  path.join(reportsDirectory, 'registered-family-chromium-proof.json'),
  {
    schemaVersion: 1,
    passed: registeredFamilyChromiumPassed,
    renderer: 'Remotion Chromium',
    providerCalls: 0,
    artifacts: registeredFamilyArtifacts,
  },
);

await writeJson(path.join(reportsDirectory, 'proof-times-report.json'), {
  schemaVersion: 1,
  passed: proofTimeArtifacts.length === 18,
  artifacts: proofTimeArtifacts,
});
await writeJson(path.join(reportsDirectory, 'transition-frame-report.json'), {
  schemaVersion: 1,
  passed:
    transitionArtifacts.length ===
    storyboard.editorial.transitionPlans.length * 3 * 3,
  artifacts: transitionArtifacts,
});
await writeJson(path.join(reportsDirectory, 'data-frame-report.json'), {
  schemaVersion: 1,
  passed: dataArtifacts.length === requiredGraphicKinds.length * 3,
  artifacts: dataArtifacts,
  stateChecks: dataStateChecks,
});

const runtimeSourceDirectories = [
  path.join(PHASE2_ROOT, 'src'),
  path.join(PHASE2_ROOT, 'schemas'),
  path.join(PHASE2_ROOT, 'scripts'),
];
const runtimeFiles = (
  await Promise.all(runtimeSourceDirectories.map(listFilesRecursively))
).flat();
const proofFilesBeforeFingerprint = await listFilesRecursively(PHASE2_PROOF_DIR);
const mediaFiles = await listFilesRecursively(PHASE2_PUBLIC_DIR);
const fingerprints = {
  inputsAndArtifacts: await hashFiles([
    ...proofFilesBeforeFingerprint.filter(
      (file) =>
        !file.endsWith('fingerprint-report.json') &&
        !file.endsWith('verifier-report.json'),
    ),
    ...mediaFiles,
  ]),
  runtime: await hashFiles(runtimeFiles),
};
const fingerprintReport = {
  schemaVersion: 1,
  passed: true,
  runtimeBuildFingerprint: await createRuntimeBuildFingerprint(),
  files: fingerprints,
};
await writeJson(
  path.join(reportsDirectory, 'fingerprint-report.json'),
  fingerprintReport,
);

const verifierReport = {
  schemaVersion: 1,
  passed: true,
  providerCalls: 0,
  previews: previewReports,
  media: mediaVerification,
  editPointChecks,
  typographyTiming,
  counterChecks,
  dataGraphicKinds: requiredGraphicKinds,
  responsiveProfiles: responsiveReport.profiles.map(
    ({profileId, width, height, densityBudget}) => ({
      profileId,
      width,
      height,
      densityBudget,
    }),
  ),
  transitionTypes: storyboard.editorial.transitionPlans.map(({type}) => type),
  transitionFrameCount: transitionArtifacts.length,
  proofTimeFrameCount: proofTimeArtifacts.length,
  qualityTargetCount: qualityEntries.length,
  registeredFamilyChromiumProfiles: registeredFamilyArtifacts.length,
  runtimeBuildFingerprint: fingerprintReport.runtimeBuildFingerprint,
  fingerprintReportSha256: await sha256File(
    path.join(reportsDirectory, 'fingerprint-report.json'),
  ),
};
await writeJson(
  path.join(reportsDirectory, 'verifier-report.json'),
  verifierReport,
);

console.log(`✓ Phase 2 proof verified: ${PHASE2_PROOF_DIR}`);
