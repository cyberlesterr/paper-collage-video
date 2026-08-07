#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {collectCompositionGroups, collectStateSequences, flattenCompositionNodes} from './composition-lib.mjs';
import {
  buildAssetEvidence,
  padEvidenceBounds,
  safeEvidenceId,
} from './asset-evidence-lib.mjs';
import {
  buildLayerStackProof,
  referenceCellRectForRegisteredSheet,
} from './layer-stack-proof-lib.mjs';
import {
  buildRegisteredGeometryProofForTarget,
  collectStyleProofTargets,
} from './quality-lib.mjs';
import {
  buildStyleTargetPatternProof,
  styleFingerprintForTarget,
  styleProofReportPath,
} from './style-proof-lib.mjs';
import {loadStoryboard} from './storyboard-lib.mjs';
import {selectStyleProofTargets} from './motion-treatment-lib.mjs';
import {createRuntimeBuildFingerprint} from './runtime-build-lib.mjs';
import {
  activeManifestAssets,
  assertAssetManifest,
} from './asset-manifest-lib.mjs';
import {buildLoopingWorldProof} from './world-motion-proof-lib.mjs';
import {spatialContractDebugOverlay} from './spatial-contract-lib.mjs';
import {
  buildCanonicalContainerProof,
} from './canonical-container-lib.mjs';

sharp.cache(false);
sharp.concurrency(1);
import {
  ROOT,
  assertSlug,
  fileExists,
  loadProject,
  probeMedia,
  projectPaths,
  resolvePublicFile,
  resolveRenderConcurrency,
  runCommand,
  readJson,
  writeJson,
} from './project-lib.mjs';

const args = process.argv.slice(2);
const slug = args.find((argument) => !argument.startsWith('--'));
const valueFor = (name) => args.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1);
const durationSeconds = Number(valueFor('--duration') ?? 5);
const STYLE_PROOF_RENDER_SCALE = 0.5;
const printUsage = () => {
  console.log('用法：project:style-proof -- <slug> [--duration=<3..5>]');
};

const debugOverlay = ({width, height, bounds, label}) => Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect x="${bounds.left}" y="${bounds.top}" width="${bounds.width}" height="${bounds.height}" fill="none" stroke="#ff3b30" stroke-width="6"/>
    <rect x="${bounds.left}" y="${Math.max(0, bounds.top - 44)}" width="${Math.min(bounds.width, 720)}" height="44" fill="rgba(255,59,48,.9)"/>
    <text x="${bounds.left + 12}" y="${Math.max(30, bounds.top - 12)}" fill="white" font-size="24" font-family="sans-serif">${label.replace(/[<>&]/g, '')}</text>
  </svg>
`);

const findNodeRect = ({scene, nodeId, video}) => {
  let result = null;
  const visit = (nodes, parentRect) => {
    for (const node of nodes ?? []) {
      const transform = node.transform ?? {};
      const width = Number(transform.width ?? 1) * parentRect.width;
      const height = transform.height !== undefined
        ? Number(transform.height) * parentRect.height
        : node.kind === 'group'
          ? width * node.coordinateSpace.height / node.coordinateSpace.width
          : node.kind === 'state-sequence'
            ? width * node.registration.canvas.height / node.registration.canvas.width
            : parentRect.height;
      const rect = {
        left: parentRect.left + Number(transform.x ?? 0) * parentRect.width - Number(transform.anchorX ?? 0) * width,
        top: parentRect.top + Number(transform.y ?? 0) * parentRect.height - Number(transform.anchorY ?? 0) * height,
        width,
        height,
      };
      if (node.id === nodeId) result = rect;
      if (node.kind === 'group') visit(node.children, rect);
    }
  };
  visit(scene.composition?.nodes, {left: 0, top: 0, width: video.width, height: video.height});
  return result ?? {left: 0, top: 0, width: video.width, height: video.height};
};

const findTargetBounds = ({scene, nodeId, video}) =>
  scene.camera?.follow
    ? {left: 0, top: 0, width: video.width, height: video.height}
    : padEvidenceBounds(findNodeRect({scene, nodeId, video}), video, 32);

const makeProofTone = ({sampleRate = 48000, seconds = 1} = {}) => {
  const sampleCount = sampleRate * seconds;
  const buffer = Buffer.alloc(44 + sampleCount * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + sampleCount * 2, 4);
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
  buffer.writeUInt32LE(sampleCount * 2, 40);
  for (let sample = 0; sample < sampleCount; sample += 1) {
    buffer.writeInt16LE(Math.round(Math.sin(sample / sampleRate * Math.PI * 2 * 220) * 220), 44 + sample * 2);
  }
  return buffer;
};

try {
  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
  }
  assertSlug(slug);
  if (!Number.isFinite(durationSeconds) || durationSeconds < 3 || durationSeconds > 5) throw new Error('--duration 必须位于 3..5 秒。');
  const [{project}, storyboard] = await Promise.all([loadProject(slug), loadStoryboard(slug)]);
  const directingTargets = selectStyleProofTargets(storyboard);
  if (directingTargets.length === 0) throw new Error('故事板没有可用于风格运动样片的风险覆盖计划。');
  for (const directingTarget of directingTargets) {
    const scene = project.scenes.find(({id}) => id === directingTarget.sceneId);
    if (!scene) throw new Error(`项目没有实现风险覆盖镜头 ${directingTarget.sceneId}。`);
    const node = directingTarget.targetId === 'scene-camera'
      ? {kind: 'camera'}
      : flattenCompositionNodes(scene.composition?.nodes)
          .find(({node: candidate}) => candidate.id === directingTarget.targetId)?.node;
    if (!node) throw new Error(`风险覆盖目标不存在：${directingTarget.sceneId}/${directingTarget.targetId}。`);
  }
  const targetGroups = await Promise.all(directingTargets.map((target) => collectStyleProofTargets(project, target)));
  const targets = [...new Map(targetGroups.flat().map((target) => [target.compositeId, target])).values()];
  if (targets.length === 0) throw new Error('风险覆盖计划没有生成可审核的风格证据目标。');
  const runtimeBuildFingerprint = await createRuntimeBuildFingerprint();

  const paths = projectPaths(slug);
  const proofDirectory = path.join(paths.distDirectory, 'style-proof');
  const reportFile = styleProofReportPath(slug);
  const contactSheet = path.join(paths.distDirectory, 'style-motion-proof-contact-sheet.jpg');
  const toneSrc = `projects/${slug}/audio/style-proof-tone.wav`;
  const toneFile = resolvePublicFile(toneSrc);
  await fs.mkdir(path.dirname(toneFile), {recursive: true});
  await fs.writeFile(toneFile, makeProofTone());
  const frameCount = Math.round(durationSeconds * project.video.fps);
  const remotion = path.join(ROOT, 'node_modules', '.bin', 'remotion');
  const frameDirectory = path.join(proofDirectory, 'frames');
  const cropDirectory = path.join(proofDirectory, 'crops');
  const debugDirectory = path.join(proofDirectory, 'debug');
  const evidenceDirectory = path.join(proofDirectory, 'evidence');
  await Promise.all([frameDirectory, cropDirectory, debugDirectory, evidenceDirectory].map((directory) => fs.mkdir(directory, {recursive: true})));
  const renderedFrames = new Map();
  const panels = [];
  const outputs = [];
  const proofProjects = [];
  const requiredByScene = new Map();
  for (const target of targets) {
    const shots = target.proofShots ?? [{sceneId: target.sceneId, proofTimeIds: target.proofTimeIds}];
    for (const shot of shots) {
      const required = requiredByScene.get(shot.sceneId) ?? new Set();
      for (const proofTimeId of shot.proofTimeIds ?? target.proofTimeIds ?? []) required.add(proofTimeId);
      requiredByScene.set(shot.sceneId, required);
    }
  }
  for (const [sceneId, requiredProofIds] of requiredByScene) {
    const selected = project.scenes.find(({id}) => id === sceneId);
    if (!selected) throw new Error(`风格证据引用了未实现镜头 ${sceneId}。`);
    const propsFile = path.join(proofDirectory, `project-${safeEvidenceId(sceneId)}.json`);
    const output = path.join(paths.distDirectory, `style-motion-proof-${safeEvidenceId(sceneId)}.mp4`);
    const proofProject = {
      ...project,
      plan: {
        ...project.plan,
        requested: {durationSeconds, sceneCount: 1},
        resolved: {...project.plan.resolved, durationSeconds, sceneCount: 1},
      },
      audio: {...project.audio, narration: {volume: 0.01}, music: null},
      scenes: [{
        ...selected,
        tailSeconds: durationSeconds - 1,
        transition: {type: 'none', durationSeconds: 0},
        narration: {src: toneSrc, startSeconds: 0, durationSeconds: 1, text: ''},
        subtitles: [],
      }],
    };
    await writeJson(propsFile, proofProject);
    await runCommand(remotion, [
      'render', 'src/index.ts', 'Paper-Collage', output,
      `--props=${path.relative(ROOT, propsFile)}`,
      `--frames=0-${Math.max(1, frameCount - 1)}`,
      `--concurrency=${resolveRenderConcurrency()}`,
      `--scale=${STYLE_PROOF_RENDER_SCALE}`, '--crf=24', '--audio-bitrate=96k',
    ]);
    const probe = await probeMedia(output);
    outputs.push({sceneId, file: path.relative(ROOT, output), durationSeconds: Number(probe.format?.duration ?? durationSeconds)});
    proofProjects.push(path.relative(ROOT, propsFile));
    const proofs = selected.motion.proofTimes.filter(({id}) => requiredProofIds.has(id));
    for (const proof of proofs) {
      const frameFile = path.join(frameDirectory, `${safeEvidenceId(sceneId)}-${safeEvidenceId(proof.id)}.png`);
      const frame = Math.round(proof.at * Math.max(1, frameCount - 1));
      await runCommand(remotion, [
        'still', 'src/index.ts', 'Paper-Collage', frameFile,
        `--props=${path.relative(ROOT, propsFile)}`,
        `--frame=${frame}`,
        `--concurrency=${resolveRenderConcurrency()}`,
      ]);
      renderedFrames.set(`${sceneId}:${proof.id}`, frameFile);
      panels.push(await sharp(frameFile).resize(640, 360, {fit: 'cover'}).jpeg().toBuffer());
    }
  }
  if (panels.length === 0) throw new Error('风险覆盖计划没有可渲染的证明时刻。');
  await sharp({create: {width: panels.length * 640, height: 360, channels: 3, background: '#160f0d'}})
    .composite(panels.map((input, index) => ({input, left: index * 640, top: 0})))
    .jpeg({quality: 90})
    .toFile(contactSheet);

  const selectedScenes = project.scenes.filter(({id}) => requiredByScene.has(id));
  const manifestFile = path.join(
    projectPaths(slug).projectDirectory,
    'assets-manifest.json',
  );
  const manifest = (await fileExists(manifestFile))
    ? assertAssetManifest(await readJson(manifestFile), slug)
    : {schemaVersion: 4, projectSlug: slug, assets: []};
  const recordsByFile = new Map(
    activeManifestAssets(manifest).map((record) => [
      path.normalize(record.file),
      record,
    ]),
  );
  const recordsByAssetId = new Map(
    activeManifestAssets(manifest).map((record) => [
      record.assetId,
      record,
    ]),
  );
  const coupledGroups = selectedScenes.flatMap((scene) =>
    collectCompositionGroups(scene.composition)
      .filter(({node}) => ['supported-subject', 'registered-environment', 'registered-depth-stack', 'looping-environment', 'canonical-container'].includes(node.pattern))
      .map((entry) => ({...entry, sceneId: scene.id})),
  );
  const stateSequences = selectedScenes.flatMap((scene) =>
    collectStateSequences(scene.composition).map((entry) => ({...entry, sceneId: scene.id})),
  );
  const memberNodes = new Map();
  for (const {node: group, sceneId} of coupledGroups) {
    for (const {node} of flattenCompositionNodes(group.children)) {
      if (node.kind === 'asset') memberNodes.set(`${sceneId}:${node.id}:${node.src}`, {
        node,
        sceneId,
        evidenceId: `${sceneId}-${node.id}`,
      });
      if (node.kind === 'world-strip') memberNodes.set(`${sceneId}:${node.id}:${node.src}`, {
        node,
        sceneId,
        evidenceId: `${sceneId}-${node.id}`,
      });
      if (node.kind === 'state-sequence') {
        for (const state of node.states) memberNodes.set(`${sceneId}:${node.id}:${state.src}`, {
          node: {...node, kind: 'asset', src: state.src},
          sceneId,
          evidenceId: `${sceneId}-${node.id}-${state.id}`,
        });
      }
    }
  }
  for (const {node, sceneId} of stateSequences) {
    for (const state of node.states) memberNodes.set(`${sceneId}:${node.id}:${state.src}`, {
      node: {...node, kind: 'asset', src: state.src},
      sceneId,
      evidenceId: `${sceneId}-${node.id}-${state.id}`,
    });
  }
  const targetMemberIds = new Set(targets.flatMap(({memberNodeIds}) => memberNodeIds));
  for (const selected of selectedScenes) {
    for (const {node} of flattenCompositionNodes(selected.composition?.nodes)) {
      if (!targetMemberIds.has(node.id)) continue;
      if (node.kind === 'asset') memberNodes.set(`${selected.id}:${node.id}:${node.src}`, {
        node,
        sceneId: selected.id,
        evidenceId: `${selected.id}-${node.id}`,
      });
      if (node.kind === 'world-strip') memberNodes.set(`${selected.id}:${node.id}:${node.src}`, {
        node,
        sceneId: selected.id,
        evidenceId: `${selected.id}-${node.id}`,
      });
      if (node.kind === 'state-sequence') {
        for (const state of node.states) memberNodes.set(`${selected.id}:${node.id}:${state.src}`, {
          node: {...node, kind: 'asset', src: state.src},
          sceneId: selected.id,
          evidenceId: `${selected.id}-${node.id}-${state.id}`,
        });
      }
    }
  }
  const assetEvidence = [];
  for (const {node, sceneId, evidenceId} of memberNodes.values()) {
    const scene = project.scenes.find(({id}) => id === sceneId);
    const rect = findNodeRect({scene, nodeId: node.id, video: project.video});
    const record = recordsByFile.get(
      path.normalize(path.join('public', node.src)),
    ) ?? null;
    assetEvidence.push({
      ...await buildAssetEvidence({
        node,
        directory: evidenceDirectory,
        evidenceId,
        renderSize: {
          width: Math.max(1, Math.round(rect.width * STYLE_PROOF_RENDER_SCALE)),
          height: Math.max(1, Math.round(rect.height * STYLE_PROOF_RENDER_SCALE)),
        },
        registeredFamilyBinding: record?.registeredFamilyBinding ?? null,
        canonicalContainerBinding:
          record?.canonicalContainerBinding ?? null,
      }),
      sceneId,
    });
  }
  const composites = [];
  for (const target of targets) {
    const {spatialProof} = await buildStyleTargetPatternProof({
      project,
      target,
    });
    const proofFrames = [];
    const shots = target.proofShots ?? [{sceneId: target.sceneId, nodeId: target.nodeId, proofTimeIds: target.proofTimeIds}];
    for (const shot of shots) {
      const selected = project.scenes.find(({id}) => id === shot.sceneId);
      const bounds = findTargetBounds({scene: selected, nodeId: shot.nodeId ?? target.nodeId, video: project.video});
      for (const proofTimeId of shot.proofTimeIds ?? target.proofTimeIds) {
        const fullFrame = renderedFrames.get(`${shot.sceneId}:${proofTimeId}`);
        if (!fullFrame) continue;
        const id = `${safeEvidenceId(target.compositeId)}-${safeEvidenceId(shot.sceneId)}-${safeEvidenceId(proofTimeId)}`;
        const cropFile = path.join(cropDirectory, `${id}.jpg`);
        const debugFile = path.join(debugDirectory, `${id}.jpg`);
        await sharp(fullFrame)
          .extract(bounds)
          .jpeg({quality: 92, chromaSubsampling: '4:4:4'})
          .toFile(cropFile);
        await sharp(fullFrame)
          .composite([{
            input: target.pattern === 'spatial-contract'
              ? spatialContractDebugOverlay({
                  proof: spatialProof,
                  sceneId: shot.sceneId,
                  proofTimeId,
                  width: project.video.width,
                  height: project.video.height,
                })
              : debugOverlay({
                  width: project.video.width,
                  height: project.video.height,
                  bounds,
                  label: `${target.compositeId} · ${proofTimeId}`,
                }),
          }])
          .jpeg({quality: 92, chromaSubsampling: '4:4:4'})
          .toFile(debugFile);
        proofFrames.push({
          sceneId: shot.sceneId,
          proofTimeId,
          at: selected.motion?.proofTimes?.find(
            ({id}) => id === proofTimeId,
          )?.at ?? null,
          fullFrame: path.relative(ROOT, fullFrame),
          crop: path.relative(ROOT, cropFile),
          debugFrame: path.relative(ROOT, debugFile),
          bounds,
        });
      }
    }
    const hashFile = async (file) =>
      createHash('sha256').update(await fs.readFile(file)).digest('hex');
    let temporalEvidence = null;
    if (proofFrames.length >= 3) {
      const temporalDirectory = path.join(evidenceDirectory, 'temporal');
      await fs.mkdir(temporalDirectory, {recursive: true});
      const safeId = safeEvidenceId(target.compositeId);
      const frames = await Promise.all(
        proofFrames.map(async (frame) => ({
          at: Number.isFinite(frame.at) ? frame.at : null,
          file: frame.fullFrame,
          sha256: await hashFile(path.resolve(ROOT, frame.fullFrame)),
        })),
      );
      const stripFile = path.join(
        temporalDirectory,
        `${safeId}-motion-strip.jpg`,
      );
      const panels = await Promise.all(
        frames.slice(0, 8).map(async ({at, file}, index) => {
          const image = await sharp(path.resolve(ROOT, file))
            .resize(360, 203, {fit: 'cover'})
            .jpeg()
            .toBuffer();
          const label = Buffer.from(
            `<svg width="360" height="40" xmlns="http://www.w3.org/2000/svg">` +
              `<rect width="100%" height="100%" fill="#1c1714"/>` +
              `<text x="12" y="27" fill="#f6ead2" font-size="17" font-family="Arial, PingFang SC, sans-serif">${String(at ?? index).replace(/[<>&]/g, '')}</text></svg>`,
          );
          return {image, label};
        }),
      );
      const stripWidth = panels.length * 360;
      const stripHeight = 243;
      await sharp({
        create: {
          width: stripWidth,
          height: stripHeight,
          channels: 3,
          background: '#100d0b',
        },
      })
        .composite(
          panels.flatMap(({image, label}, index) => [
            {input: label, left: index * 360, top: 0},
            {input: image, left: index * 360, top: 40},
          ]),
        )
        .jpeg({quality: 90})
        .toFile(stripFile);
      temporalEvidence = {
        file: path.relative(ROOT, stripFile),
        sha256: await hashFile(stripFile),
        frames,
      };
      await writeJson(
        path.join(temporalDirectory, `${safeId}-motion-strip.json`),
        temporalEvidence,
      );
    }
    let registeredGeometryProof = null;
    if (
      ['supported-subject', 'registered-depth-stack', 'state-sequence'].includes(
        target.pattern,
      )
    ) {
      registeredGeometryProof = await buildRegisteredGeometryProofForTarget({
        target,
        root: ROOT,
      });
      if (
        registeredGeometryProof &&
        !registeredGeometryProof.passed
      ) {
        throw new Error(
          `registered family ${target.compositeId} 的 alpha-tight 几何校验未通过：` +
            registeredGeometryProof.states
              .flatMap(({stateId, issues}) =>
                issues.map((issue) => `${stateId}: ${issue}`),
              )
              .join('；'),
        );
      }
    }
    let layerStackProof = null;
    if (target.pattern === 'registered-depth-stack') {
      const memberFiles = new Map(
        target.group.children
          .filter(({kind}) => kind === 'asset')
          .map((node) => [node.id, resolvePublicFile(node.src)]),
      );
      const referenceRecord = recordsByAssetId.get(
        target.group.registration.sourceMasterAssetId,
      );
      const referenceFile = referenceRecord?.file
        ? path.resolve(ROOT, referenceRecord.file)
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
        directory: evidenceDirectory,
        evidenceId: `${target.sceneId}-${target.nodeId}-layer-stack`,
      });
      layerStackProof = {
        ...built,
        artifacts: {
          neutralReconstruction: path.relative(
            ROOT,
            built.artifacts.neutralReconstruction,
          ),
          referenceComparison: path.relative(
            ROOT,
            built.artifacts.referenceComparison,
          ),
          explodedView: path.relative(
            ROOT,
            built.artifacts.explodedView,
          ),
          envelopeExtremes:
            built.artifacts.envelopeExtremes.map((entry) => ({
              ...entry,
              file: path.relative(ROOT, entry.file),
            })),
          subjectTravelExtremes:
            built.artifacts.subjectTravelExtremes.map((entry) => ({
              ...entry,
              file: path.relative(ROOT, entry.file),
            })),
        },
        artifactHashes: Object.fromEntries(
          Object.entries(built.artifactHashes).map(
            ([file, hash]) => [path.relative(ROOT, file), hash],
          ),
        ),
      };
    }
    let loopingWorldProof = null;
    if (target.pattern === 'looping-environment') {
      loopingWorldProof = await buildLoopingWorldProof({
        root: ROOT,
        projectSlug: slug,
        scene: project.scenes.find(({id}) => id === target.sceneId),
        group: target.group,
        video: project.video,
        runtimeBuildFingerprint,
      });
      if (!loopingWorldProof.passed) {
        throw new Error(
          `looping environment ${target.nodeId} 的 style seam/coverage/world-motion proof 未通过。`,
        );
      }
    }
    let canonicalContainerProof = null;
    if (target.pattern === 'canonical-container') {
      const built = await buildCanonicalContainerProof({
        root: ROOT,
        group: target.group,
        manifest,
        directory: evidenceDirectory,
        evidenceId:
          `${target.sceneId}-${target.nodeId}-canonical-container`,
      });
      canonicalContainerProof = {
        ...built,
        familyFingerprint:
          target.group.canonicalContainer.familyFingerprint,
        artifacts: Object.fromEntries(
          Object.entries(built.artifacts).map(([key, file]) => [
            key,
            path.relative(ROOT, file),
          ]),
        ),
        artifactHashes: Object.fromEntries(
          Object.entries(built.artifactHashes).map(
            ([file, hash]) => [path.relative(ROOT, file), hash],
          ),
        ),
      };
      if (!canonicalContainerProof.passed) {
        throw new Error(
          `canonical container ${target.nodeId} 的 style frame/mask/alignment/final-state proof 未通过。`,
        );
      }
    }
    composites.push({
      compositeId: target.compositeId,
      pattern: target.pattern,
      nodeId: target.nodeId,
      memberNodeIds: target.memberNodeIds,
      fingerprint: styleFingerprintForTarget(target),
      proofFrames,
      temporalEvidence,
      registeredGeometryProof,
      layerStackProof,
      loopingWorldProof,
      canonicalContainerProof,
      spatialProof,
    });
  }

  const groups = [
    ...coupledGroups.map(({node, sceneId}) => ({sceneId, id: node.id, pattern: node.pattern, registrationId: node.registration?.id ?? null, sourceMasterAssetId: node.registration?.sourceMasterAssetId ?? null})),
    ...stateSequences.map(({node, sceneId}) => ({sceneId, id: node.id, pattern: 'state-sequence', registrationId: node.registration.id, sourceMasterAssetId: node.registration.sourceMasterAssetId})),
  ];
  await writeJson(reportFile, {
    schemaVersion: 7,
    slug,
    generatedAt: new Date().toISOString(),
    planFingerprint: storyboard.directingSummary.styleProofPlan.fingerprint,
    motionContractFingerprint: storyboard.motionContract.fingerprint,
    motionApprovalFingerprint:
      storyboard.motionContract.approvalFingerprint,
    motionLanguageCard: path.relative(
      ROOT,
      paths.motionLanguageCardFile,
    ),
    directingTargets,
    runtimeBuildFingerprint,
    outputs,
    contactSheet: path.relative(ROOT, contactSheet),
    proofProjects,
    scope: 'style',
    method: 'compiler-selected semantic, coupled-relationship, and state-sequence risk coverage rendered through real project compositions with source-family reuse',
    groups,
    composites,
    assetEvidence,
    proofFrameCount: panels.length,
  });
  console.log(`✓ v7 动作契约绑定的多维风险风格证明：${outputs.map(({file}) => file).join(', ')}`);
  console.log(`✓ 组合证明联系表：${path.relative(ROOT, contactSheet)}`);
  console.log(`✓ 运动报告：${path.relative(ROOT, reportFile)}`);
} catch (error) {
  console.error(`project:style-proof failed: ${error.message}`);
  process.exitCode = 1;
}
