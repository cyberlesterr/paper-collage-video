#!/usr/bin/env node
import {printCliHelp} from './cli-help-lib.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {
  collectCompositionAssets,
  collectCompositionGroups,
  collectStateSequences,
  collectWorldStrips,
  deriveEventTimeline,
} from './composition-lib.mjs';
import {
  assetEvidenceIsCurrent,
  buildAssetEvidence,
} from './asset-evidence-lib.mjs';
import {
  ROOT,
  deriveTimeline,
  formatValidation,
  loadProject,
  projectPaths,
  resolvePublicFile,
  resolveRenderConcurrency,
  runCommand,
  validateProject,
  fileExists,
  readJson,
  writeJson,
} from './project-lib.mjs';
import {
  collectCompositeQualityTargets,
  compositionProofReportPath,
  buildRegisteredGeometryProofForTarget,
} from './quality-lib.mjs';
import {
  createCompositionProofProject,
  createSceneProofFingerprint,
} from './render-cache-lib.mjs';
import {
  createRuntimeBuildFingerprint,
  createRuntimeSurfaceFingerprint,
} from './runtime-build-lib.mjs';
import {
  activeManifestAssets,
  assertAssetManifest,
} from './asset-manifest-lib.mjs';
import {summarizeProductionContracts} from './world-trajectory-lib.mjs';
import {
  buildLayerStackProof,
  referenceCellRectForRegisteredSheet,
} from './layer-stack-proof-lib.mjs';
import {applyResponsiveDirectingPlan} from '../src/editorialPrimitives.mjs';
import {
  buildLoopingWorldProof,
  buildTraverseWorldMotionProofs,
} from './world-motion-proof-lib.mjs';
import {
  buildSpatialContractProof,
  spatialContractDebugOverlay,
  summarizeSpatialContracts,
} from './spatial-contract-lib.mjs';
import {
  buildCanonicalContainerProof,
} from './canonical-container-lib.mjs';

const args = process.argv.slice(2);
const USAGE =
  '用法：project:composition-proof -- <slug>';
printCliHelp(args, USAGE);
const [slug] = args.filter((argument) => !argument.startsWith('--'));
const force = args.includes('--force');
const hashFile = async (file) =>
  createHash('sha256').update(await fs.readFile(file)).digest('hex');

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

const summarizeEncounterContracts = (project) =>
  (project.scenes ?? []).flatMap((scene) =>
    (scene.encounters ?? []).map((contract) => ({
      sceneId: scene.id,
      contractId: contract.id,
      travelerNodeId: contract.travelerNodeId,
      targetNodeId: contract.targetNodeId,
      worldNodeId: contract.worldNodeId,
      narrationCueId: contract.narrationCueId,
      phaseEvents: Object.fromEntries(
        Object.entries(contract.phaseBeatIds).map(([phase, beatId]) => [
          phase,
          scene.events.find(
            (event) =>
              event.beatId === beatId &&
              event.targetId === contract.targetNodeId &&
              event.encounter?.contractId === contract.id &&
              event.encounter?.phase === phase,
          )?.id ?? null,
        ]),
      ),
      opacityLifecycleUsed: scene.events.some(
        (event) =>
          event.targetId === contract.targetNodeId &&
          event.visual?.kind === 'visibility',
      ),
      passed: true,
    })),
  );

const findTargetBounds = ({scene, nodeId, video}) => {
  if (scene.camera?.follow) {
    return {left: 0, top: 0, width: video.width, height: video.height};
  }
  let result = null;
  const visit = (nodes, parentRect, parentGroup = null) => {
    for (const node of nodes ?? []) {
      const transform = node.transform ?? {};
      const width = Number(transform.width ?? 1) * parentRect.width;
      const height = node.kind === 'group'
        ? (transform.height === undefined
            ? width * node.coordinateSpace.height / node.coordinateSpace.width
            : Number(transform.height) * parentRect.height)
        : node.kind === 'state-sequence' && transform.height === undefined
          ? width * node.registration.canvas.height / node.registration.canvas.width
        : Number(transform.height ?? 1) * parentRect.height;
      const rect = {
        left: parentRect.left + Number(transform.x ?? 0) * parentRect.width - Number(transform.anchorX ?? 0) * width,
        top: parentRect.top + Number(transform.y ?? 0) * parentRect.height - Number(transform.anchorY ?? 0) * height,
        width,
        height,
      };
      if (node.id === nodeId) result = node.kind === 'group' ? rect : parentGroup ?? rect;
      if (node.kind === 'group') visit(node.children, rect, rect);
    }
  };
  visit(scene.composition?.nodes, {left: 0, top: 0, width: video.width, height: video.height});
  const rect = result ?? {left: 0, top: 0, width: video.width, height: video.height};
  const padding = Math.max(16, Math.round(Math.max(rect.width, rect.height) * 0.08));
  const left = clamp(Math.floor(rect.left - padding), 0, video.width - 1);
  const top = clamp(Math.floor(rect.top - padding), 0, video.height - 1);
  return {
    left,
    top,
    width: clamp(Math.ceil(rect.width + padding * 2), 1, video.width - left),
    height: clamp(Math.ceil(rect.height + padding * 2), 1, video.height - top),
  };
};

const findNodeRenderSize = ({scene, nodeId, video}) => {
  let result = null;
  const visit = (nodes, parentRect) => {
    for (const node of nodes ?? []) {
      const transform = node.transform ?? {};
      const width = Number(transform.width ?? 1) * parentRect.width;
      const height = node.kind === 'group'
        ? (transform.height === undefined
            ? width * node.coordinateSpace.height / node.coordinateSpace.width
            : Number(transform.height) * parentRect.height)
        : node.kind === 'state-sequence' && transform.height === undefined
          ? width * node.registration.canvas.height / node.registration.canvas.width
          : Number(transform.height ?? 1) * parentRect.height;
      const rect = {
        left: parentRect.left + Number(transform.x ?? 0) * parentRect.width -
          Number(transform.anchorX ?? 0) * width,
        top: parentRect.top + Number(transform.y ?? 0) * parentRect.height -
          Number(transform.anchorY ?? 0) * height,
        width,
        height,
      };
      if (node.id === nodeId) result = {
        width: Math.max(1, Math.round(width)),
        height: Math.max(1, Math.round(height)),
      };
      if (node.kind === 'group') visit(node.children, rect);
    }
  };
  visit(
    scene.composition?.nodes,
    {left: 0, top: 0, width: video.width, height: video.height},
  );
  return result;
};

const debugOverlay = ({width, height, bounds, label}) => Buffer.from(`
  <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect x="${bounds.left}" y="${bounds.top}" width="${bounds.width}" height="${bounds.height}" fill="none" stroke="#ff3b30" stroke-width="6"/>
    <rect x="${bounds.left}" y="${Math.max(0, bounds.top - 44)}" width="${Math.min(bounds.width, 760)}" height="44" fill="rgba(255,59,48,.9)"/>
    <text x="${bounds.left + 12}" y="${Math.max(30, bounds.top - 12)}" fill="white" font-size="24" font-family="sans-serif">${label.replace(/[<>&]/g, '')}</text>
  </svg>
`);

try {
  if (!slug) throw new Error(USAGE);
  await runCommand(process.execPath, ['scripts/project-sync.mjs', slug]);
  const {project} = await loadProject(slug);
  const validation = await validateProject(project);
  console.log(formatValidation(validation));
  if (!validation.passed) throw new Error('v12 组合结构未通过，不能生成证明帧。');

  const timeline = deriveTimeline(project);
  const paths = projectPaths(slug);
  const outputDirectory = path.dirname(compositionProofReportPath(slug));
  const frameDirectory = path.join(outputDirectory, 'frames');
  const cropDirectory = path.join(outputDirectory, 'crops');
  const debugDirectory = path.join(outputDirectory, 'debug');
  const responsiveInputDirectory = path.join(
    outputDirectory,
    'responsive-inputs',
  );
  await fs.mkdir(frameDirectory, {recursive: true});
  await fs.mkdir(cropDirectory, {recursive: true});
  await fs.mkdir(debugDirectory, {recursive: true});
  await fs.mkdir(responsiveInputDirectory, {recursive: true});
  const evidenceDirectory = path.join(outputDirectory, 'evidence');
  await fs.mkdir(evidenceDirectory, {recursive: true});
  const runtimeBuildFingerprint = await createRuntimeBuildFingerprint();
  const runtimeSurfaceFingerprint =
    await createRuntimeSurfaceFingerprint('composition-proof');
  const proofProject = createCompositionProofProject(project);
  const proofProjectFile = path.join(outputDirectory, 'project.json');
  await writeJson(proofProjectFile, proofProject);

  const reportFile = compositionProofReportPath(slug);
  const previous = (await fileExists(reportFile))
    ? await readJson(reportFile).catch(() => null)
    : null;
  const previousFrames = new Map(
    (previous?.frames ?? []).map((frame) => [
      `${frame.profileId ?? 'active'}:${frame.sceneId}:${frame.proofTimeId}`,
      frame,
    ]),
  );
  const previousComposites = new Map(
    (previous?.composites ?? []).map((entry) => [entry.compositeId, entry]),
  );
  const previousEvidence = new Map(
    (previous?.assetEvidence ?? []).map((entry) => [
      `${entry.sceneId ?? ''}:${entry.nodeId}:${entry.source}`,
      entry,
    ]),
  );
  const manifestFile = path.join(
    ROOT,
    'projects',
    slug,
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

  const remotion = path.join(ROOT, 'node_modules', '.bin', 'remotion');
  const rendered = new Map();
  const frames = [];
  let browserReady = false;
  let reusedFrames = 0;
  let renderedFrames = 0;
  for (const scene of timeline.scenes) {
    for (const proof of scene.motion?.proofTimes ?? []) {
      const absoluteFrame = scene.from + Math.round(proof.at * Math.max(0, scene.durationInFrames - 1));
      const key = `${scene.id}:${proof.id}`;
      const file = path.join(frameDirectory, `${scene.id}-${proof.id}.png`);
      const fingerprint = await createSceneProofFingerprint({
        project,
        scene,
        proof,
        absoluteFrame,
        surface: 'composition-proof',
      });
      const cached = previousFrames.get(`active:${key}`);
      const reusable =
        !force &&
        cached?.fingerprint === fingerprint &&
        cached.absoluteFrame === absoluteFrame &&
        await fileExists(file);
      if (reusable) {
        reusedFrames += 1;
      } else {
        if (!browserReady) {
          await runCommand(remotion, ['browser', 'ensure']);
          browserReady = true;
        }
        await runCommand(remotion, [
          'still',
          'src/index.ts',
          'Paper-Collage',
          file,
          `--props=${path.relative(ROOT, proofProjectFile)}`,
          `--frame=${absoluteFrame}`,
          `--concurrency=${resolveRenderConcurrency()}`,
        ]);
        renderedFrames += 1;
      }
      const entry = {
        sceneId: scene.id,
        proofTimeId: proof.id,
        absoluteFrame,
        fingerprint,
        file: path.relative(ROOT, file),
      };
      frames.push(entry);
      rendered.set(key, {
        file,
        absoluteFrame,
        fingerprint,
        width: project.video.width,
        height: project.video.height,
      });
    }
  }

  const sceneById = new Map(timeline.scenes.map((scene) => [scene.id, scene]));
  const targets = (await collectCompositeQualityTargets(project)).filter(
    ({reviewScope}) => reviewScope === 'runtime-visible',
  );
  const coupledNodes = new Map();
  for (const scene of project.scenes ?? []) {
    for (const {node, parent, renderParticipation} of collectCompositionAssets(scene.composition)) {
      if (renderParticipation !== 'visible') continue;
      if (
        !parent ||
        ![
          'supported-subject',
          'registered-environment',
          'registered-depth-stack',
          'canonical-container',
        ].includes(parent.pattern)
      ) continue;
      coupledNodes.set(`${scene.id}:${node.id}:${node.src}`, {
        sceneId: scene.id,
        node,
        renderSize: findNodeRenderSize({
          scene,
          nodeId: node.id,
          video: project.video,
        }),
      });
    }
    for (const {node, parent, renderParticipation} of collectWorldStrips(scene.composition)) {
      if (renderParticipation !== 'visible') continue;
      if (parent?.pattern !== 'looping-environment') continue;
      coupledNodes.set(`${scene.id}:${node.id}:${node.src}`, {
        sceneId: scene.id,
        node,
        renderSize: findNodeRenderSize({
          scene,
          nodeId: node.id,
          video: project.video,
        }),
      });
    }
    for (const {node, renderParticipation} of collectStateSequences(scene.composition)) {
      if (renderParticipation !== 'visible') continue;
      for (const state of node.states) {
        coupledNodes.set(`${scene.id}:${node.id}:${state.src}`, {
          sceneId: scene.id,
          stateId: state.id,
          node: {...node, kind: 'asset', src: state.src},
          renderSize: findNodeRenderSize({
            scene,
            nodeId: node.id,
            video: project.video,
          }),
        });
      }
    }
  }
  const assetEvidence = [];
  let reusedEvidence = 0;
  let generatedEvidence = 0;
  for (const {
    sceneId,
    node,
    stateId = null,
    renderSize,
  } of coupledNodes.values()) {
    const record = recordsByFile.get(
      path.normalize(path.join('public', node.src)),
    ) ?? null;
    const registeredFamilyBinding = record?.registeredFamilyBinding ?? null;
    const canonicalContainerBinding =
      record?.canonicalContainerBinding ?? null;
    const cached = previousEvidence.get(`${sceneId}:${node.id}:${node.src}`);
    if (!force && await assetEvidenceIsCurrent(cached, node, {
      renderSize,
      registeredFamilyBinding,
      canonicalContainerBinding,
    })) {
      assetEvidence.push(cached);
      reusedEvidence += 1;
    } else {
      assetEvidence.push({
        ...await buildAssetEvidence({
          node,
          directory: evidenceDirectory,
          evidenceId: `${sceneId}-${node.id}${stateId ? `-${stateId}` : ''}`,
          renderSize,
          registeredFamilyBinding,
          canonicalContainerBinding,
        }),
        sceneId,
      });
      generatedEvidence += 1;
    }
  }
  const responsiveVariants = new Map();
  const responsiveRendered = new Map();
  const responsiveVariantFor = async (target) => {
    const profileId = target.responsive.profileId;
    const cached = responsiveVariants.get(profileId);
    if (cached) return cached;
    const responsiveProject = applyResponsiveDirectingPlan({
      ...structuredClone(proofProject),
      video: {
        ...project.video,
        width: target.responsive.width,
        height: target.responsive.height,
      },
      editorial: {
        ...structuredClone(project.editorial),
        activeProfile: profileId,
      },
    });
    const responsiveTimeline = deriveTimeline(responsiveProject);
    const inputFile = path.join(
      responsiveInputDirectory,
      `project-${profileId.replace(':', 'x')}.json`,
    );
    await writeJson(inputFile, responsiveProject);
    const variant = {
      project: responsiveProject,
      timeline: responsiveTimeline,
      inputFile,
    };
    responsiveVariants.set(profileId, variant);
    return variant;
  };
  const renderResponsiveProof = async ({target, sceneId, proofTimeId}) => {
    const profileId = target.responsive.profileId;
    const key = `${profileId}:${sceneId}:${proofTimeId}`;
    const existing = responsiveRendered.get(key);
    if (existing) return existing;
    const variant = await responsiveVariantFor(target);
    const scene = variant.timeline.scenes.find(({id}) => id === sceneId);
    const proof = scene?.motion?.proofTimes?.find(
      ({id}) => id === proofTimeId,
    );
    if (!scene || !proof) {
      throw new Error(
        `${target.compositeId} 缺少响应式证明时刻 ${sceneId}/${proofTimeId}。`,
      );
    }
    const absoluteFrame =
      scene.from +
      Math.round(
        proof.at * Math.max(0, scene.durationInFrames - 1),
      );
    const safeProfile = profileId.replace(':', 'x');
    const file = path.join(
      frameDirectory,
      `responsive-${safeProfile}-${sceneId}-${proofTimeId}.png`,
    );
    const fingerprint = await createSceneProofFingerprint({
      project: variant.project,
      scene,
      proof,
      absoluteFrame,
      surface: 'composition-proof',
    });
    const cached = previousFrames.get(key);
    const reusable =
      !force &&
      cached?.fingerprint === fingerprint &&
      cached.absoluteFrame === absoluteFrame &&
      await fileExists(file);
    if (reusable) {
      reusedFrames += 1;
    } else {
      if (!browserReady) {
        await runCommand(remotion, ['browser', 'ensure']);
        browserReady = true;
      }
      await runCommand(remotion, [
        'still',
        'src/index.ts',
        'Paper-Collage',
        file,
        `--props=${path.relative(ROOT, variant.inputFile)}`,
        `--frame=${absoluteFrame}`,
        `--concurrency=${resolveRenderConcurrency()}`,
      ]);
      renderedFrames += 1;
    }
    const entry = {
      profileId,
      sceneId,
      proofTimeId,
      absoluteFrame,
      fingerprint,
      file: path.relative(ROOT, file),
    };
    frames.push(entry);
    const renderedEntry = {
      file,
      absoluteFrame,
      fingerprint,
      width: target.responsive.width,
      height: target.responsive.height,
    };
    responsiveRendered.set(key, renderedEntry);
    return renderedEntry;
  };
  const composites = [];
  let reusedComposites = 0;
  let generatedComposites = 0;
  for (const target of targets) {
    const cached = previousComposites.get(target.compositeId);
    const proofShots = target.proofShots ?? [{
      sceneId: target.sceneId,
      nodeId: target.nodeId,
      proofTimeIds: target.proofTimeIds,
    }];
    const expectedProofs = proofShots.flatMap((shot) =>
      shot.proofTimeIds.map((proofTimeId) => ({sceneId: shot.sceneId, proofTimeId})),
    );
    if (target.pattern === 'responsive-directing') {
      for (const expected of expectedProofs) {
        await renderResponsiveProof({target, ...expected});
      }
    }
    const renderedProofFor = ({sceneId, proofTimeId}) =>
      target.pattern === 'responsive-directing'
        ? responsiveRendered.get(
            `${target.responsive.profileId}:${sceneId}:${proofTimeId}`,
          )
        : rendered.get(`${sceneId}:${proofTimeId}`);
    const reusableComposite =
      !force &&
      cached?.fingerprint === target.fingerprint &&
      cached.proofFrames?.length === expectedProofs.length &&
      (await Promise.all(expectedProofs.map(async ({sceneId, proofTimeId}) => {
        const renderedProof = renderedProofFor({sceneId, proofTimeId});
        const cachedFrame = cached.proofFrames.find((entry) =>
          entry.sceneId === sceneId && entry.proofTimeId === proofTimeId,
        );
        return Boolean(
          renderedProof &&
          cachedFrame?.frameFingerprint === renderedProof.fingerprint &&
          await fileExists(path.resolve(ROOT, cachedFrame.fullFrame ?? '')) &&
          await fileExists(path.resolve(ROOT, cachedFrame.crop ?? '')) &&
          await fileExists(path.resolve(ROOT, cachedFrame.debugFrame ?? '')),
        );
      }))).every(Boolean) &&
      (
        target.pattern !== 'registered-depth-stack' ||
        (
          cached.layerStackProof?.passed === true &&
          (
            await Promise.all([
              cached.layerStackProof.artifacts?.neutralReconstruction,
              cached.layerStackProof.artifacts?.referenceComparison,
              cached.layerStackProof.artifacts?.explodedView,
              ...(cached.layerStackProof.artifacts?.envelopeExtremes ?? [])
                .map(({file}) => file),
              ...(cached.layerStackProof.artifacts?.subjectTravelExtremes ?? [])
                .map(({file}) => file),
            ].map((file) =>
              file
                ? fileExists(path.resolve(ROOT, file))
                : false,
            ))
          ).every(Boolean)
        )
      ) &&
      (
        target.pattern !== 'looping-environment' ||
        cached.loopingWorldProof?.passed === true
      ) &&
      (
        target.pattern !== 'canonical-container' ||
        (
          cached.canonicalContainerProof?.passed === true &&
          cached.canonicalContainerProof?.familyFingerprint ===
            target.group.canonicalContainer?.familyFingerprint &&
          Object.values(
            cached.canonicalContainerProof.artifacts ?? {},
          ).length === 3 &&
          (
            await Promise.all(
              Object.values(
                cached.canonicalContainerProof.artifacts ?? {},
              ).map(async (file) => {
                if (!file) return false;
                const absolute = path.resolve(ROOT, file);
                return (
                  await fileExists(absolute) &&
                  await hashFile(absolute) ===
                    cached.canonicalContainerProof
                      .artifactHashes?.[file]
                );
              }),
            )
          ).every(Boolean)
        )
      ) &&
      (
        target.pattern !== 'spatial-contract' ||
        cached.spatialProof?.passed === true
      );
    if (reusableComposite) {
      composites.push(cached);
      reusedComposites += 1;
      continue;
    }
    let spatialProof = null;
    if (target.pattern === 'spatial-contract') {
      spatialProof = await buildSpatialContractProof(
        project,
        target.spatialContract,
      );
      if (!spatialProof.passed) {
        const failed = spatialProof.checks
          .filter(({passed}) => !passed)
          .map(({id}) => id)
          .join(', ');
        throw new Error(
          `spatial contract ${target.spatialContract.id} 未通过：${failed}。`,
        );
      }
    }
    const proofFrames = [];
    for (const shot of proofShots) {
      const scene = sceneById.get(shot.sceneId);
      if (!scene) continue;
      for (const proofTimeId of shot.proofTimeIds) {
        const renderedProof = renderedProofFor({
          sceneId: shot.sceneId,
          proofTimeId,
        });
        if (!renderedProof) continue;
        const bounds =
          target.pattern === 'responsive-directing'
            ? {
                left: 0,
                top: 0,
                width: renderedProof.width,
                height: renderedProof.height,
              }
            : findTargetBounds({
                scene,
                nodeId: shot.nodeId,
                video: project.video,
              });
        const safeId = target.compositeId.replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
        const cropFile = path.join(cropDirectory, `${safeId}-${shot.sceneId}-${proofTimeId}.jpg`);
        const debugFile = path.join(debugDirectory, `${safeId}-${shot.sceneId}-${proofTimeId}.jpg`);
        await sharp(renderedProof.file)
          .extract(bounds)
          .jpeg({quality: 92, chromaSubsampling: '4:4:4'})
          .toFile(cropFile);
        await sharp(renderedProof.file)
          .composite([{
            input: target.pattern === 'spatial-contract'
              ? spatialContractDebugOverlay({
                  proof: spatialProof,
                  sceneId: shot.sceneId,
                  proofTimeId,
                  width: renderedProof.width,
                  height: renderedProof.height,
                })
              : debugOverlay({
                  width: renderedProof.width,
                  height: renderedProof.height,
                  bounds,
                  label: `${target.compositeId} · ${shot.sceneId} · ${proofTimeId}`,
                }),
          }])
          .jpeg({quality: 92, chromaSubsampling: '4:4:4'})
          .toFile(debugFile);
        proofFrames.push({
          ...(target.pattern === 'responsive-directing'
            ? {profileId: target.responsive.profileId}
            : {}),
          sceneId: shot.sceneId,
          proofTimeId,
          at: scene.motion?.proofTimes?.find(
            ({id}) => id === proofTimeId,
          )?.at ?? null,
          absoluteFrame: renderedProof.absoluteFrame,
          frameFingerprint: renderedProof.fingerprint,
          fullFrame: path.relative(ROOT, renderedProof.file),
          crop: path.relative(ROOT, cropFile),
          debugFrame: path.relative(ROOT, debugFile),
          bounds,
        });
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
        runtimeBuildFingerprint: runtimeSurfaceFingerprint,
      });
      if (!loopingWorldProof.passed) {
        throw new Error(
          `looping environment ${target.nodeId} 的 seam/coverage/speed/world-motion proof 未通过。`,
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
        evidenceId: `${target.sceneId}-${target.nodeId}-canonical-container`,
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
          `canonical container ${target.nodeId} 的 frame/mask/alignment/final-state proof 未通过。`,
        );
      }
    }
    let temporalEvidence = null;
    if (proofFrames.length >= 3) {
      const temporalDirectory = path.join(evidenceDirectory, 'temporal');
      await fs.mkdir(temporalDirectory, {recursive: true});
      const safeId = target.compositeId
        .replace(/[^a-z0-9-]+/gi, '-')
        .toLowerCase();
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
      const compositeInputs = panels.flatMap(
        ({image, label}, index) => [
          {input: label, left: index * 360, top: 0},
          {input: image, left: index * 360, top: 40},
        ],
      );
      await sharp({
        create: {
          width: stripWidth,
          height: stripHeight,
          channels: 3,
          background: '#100d0b',
        },
      })
        .composite(compositeInputs)
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
    composites.push({
      compositeId: target.compositeId,
      sceneId: target.sceneId,
      pattern: target.pattern,
      fingerprint: target.fingerprint,
      proofFrames,
      temporalEvidence,
      registeredGeometryProof,
      layerStackProof,
      loopingWorldProof,
      canonicalContainerProof,
      spatialProof,
    });
    generatedComposites += 1;
  }

  const storyboard = (await fileExists(paths.storyboardFile))
    ? await readJson(paths.storyboardFile)
    : null;
  const traverseWorldMotionProofs = [];
  if (storyboard) {
    for (const scene of project.scenes ?? []) {
      const storyboardScene = storyboard.scenes?.find(({id}) => id === scene.id);
      traverseWorldMotionProofs.push(
        ...await buildTraverseWorldMotionProofs({
          project,
          scene,
          storyboardScene,
        }),
      );
    }
  }
  const report = {
    schemaVersion: 4,
    projectSlug: slug,
    generatedAt: new Date().toISOString(),
    scope: 'project',
    runtimeBuildFingerprint,
    runtimeSurface: {
      id: 'composition-proof',
      fingerprint: runtimeSurfaceFingerprint,
    },
    frames,
    composites,
    worldMotionProofs: traverseWorldMotionProofs,
    encounterProofs: summarizeEncounterContracts(project),
    productionContracts: summarizeProductionContracts(project),
    spatialContracts: summarizeSpatialContracts(project),
    assetEvidence,
    eventTimeline: timeline.scenes.flatMap((scene) => deriveEventTimeline({scene, sceneFrom: scene.from, fps: project.video.fps})),
    cache: {
      forced: force,
      reusedFrames,
      renderedFrames,
      reusedComposites,
      generatedComposites,
      reusedEvidence,
      generatedEvidence,
    },
  };
  await writeJson(reportFile, report);
  console.log(`✓ composition proof: ${path.relative(ROOT, reportFile)} (${composites.length} composites)`);
  console.log(`✓ proof cache: frames ${reusedFrames} reused / ${renderedFrames} rendered; composites ${reusedComposites} reused / ${generatedComposites} generated; evidence ${reusedEvidence} reused / ${generatedEvidence} generated`);
} catch (error) {
  console.error(`project:composition-proof failed: ${error.message}`);
  process.exitCode = 1;
}
