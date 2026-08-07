#!/usr/bin/env node
import path from 'node:path';
import {
  PHASE2_PROOF_PROFILES,
  compilePhase2Storyboard,
  createPhase2Plan,
  createPhase2Project,
  createPhase2StoryboardAuthoring,
} from '../fixtures/phase2-proof-fixture.mjs';
import {
  flattenCompositionNodes,
  hashCompositionValue,
} from './composition-lib.mjs';
import {
  storyboardAuthoringFromCompiled,
  storyboardConceptFingerprint,
} from './directing-revision-lib.mjs';
import {ROOT, validateProject} from './project-lib.mjs';
import {
  collectCompositeQualityTargets,
} from './quality-lib.mjs';
import {
  compileStoryboardDirecting,
  validateStoryboard,
} from './storyboard-lib.mjs';
import {createRuntimeBuildFingerprint} from './runtime-build-lib.mjs';
import {
  fitEditorialTypography,
  resolveAnnotationRoute,
  validateDataGraphicNode,
} from '../src/editorialPrimitives.mjs';
import {
  PHASE2_PROOF_DIR,
  PHASE2_PUBLIC_DIR,
  hashFiles,
  listFilesRecursively,
  preparePhase2Media,
  sha256Value,
  writeJson,
} from './phase2-proof-lib.mjs';
import {prepareRegisteredFamilyProof} from './asset-hardening-proof-lib.mjs';
import {
  DEFAULT_REGISTERED_GEOMETRY_LIMITS,
  computeRegisteredGeometryProof,
} from './registered-geometry-lib.mjs';
import {FIXTURE_STYLE_PROFILE} from '../fixtures/motion-contract-fixture.mjs';

const inputsDirectory = path.join(PHASE2_PROOF_DIR, 'inputs');
const reportsDirectory = path.join(PHASE2_PROOF_DIR, 'reports');

const registeredFamily = await prepareRegisteredFamilyProof();
const registeredGeometry = await computeRegisteredGeometryProof({
  familyId: registeredFamily.records[0].registeredFamilyBinding.familyId,
  registrationId:
    registeredFamily.records[0].registeredFamilyBinding.registrationId,
  familyFingerprint:
    registeredFamily.records[0].registeredFamilyBinding.familyFingerprint,
  canvas: registeredFamily.records[0].registeredFamilyBinding.canvas,
  states: registeredFamily.records.map((record, index) => ({
    stateId:
      record.registeredFamilyBinding?.slot ??
      record.registeredFamilyBinding?.role ??
      `member-${index + 1}`,
    file: path.join(ROOT, record.file),
    declaredFacing: 'neutral',
    expectedPlacement:
      record.registeredFamilyBinding?.derivation?.placement ?? null,
  })),
  limits: DEFAULT_REGISTERED_GEOMETRY_LIMITS,
  mode: 'placement',
});
const media = await preparePhase2Media();
const storyboard = compilePhase2Storyboard({media});
const storyboardIssues = validateStoryboard(storyboard, {
  slug: storyboard.slug,
  plan: createPhase2Plan(),
});
if (storyboardIssues.length > 0) {
  throw new Error(
    storyboardIssues
      .map(({location, message}) => `${location}: ${message}`)
      .join('\n'),
  );
}

const projects = {};
const projectValidation = {};
for (const profile of PHASE2_PROOF_PROFILES) {
  const project = createPhase2Project({media, profileId: profile.id});
  const result = await validateProject(project, {
    storyboard,
    manifest: registeredFamily.manifest,
  });
  const errors = result.issues.filter(({level}) => level === 'error');
  if (errors.length > 0) {
    throw new Error(
      `${profile.id} 项目验证失败：\n${errors
        .map(({location, message}) => `${location}: ${message}`)
        .join('\n')}`,
    );
  }
  projects[profile.id] = project;
  projectValidation[profile.id] = {
    passed: true,
    warnings: result.issues.filter(({level}) => level !== 'error'),
    durationInFrames: result.timeline.durationInFrames,
    durationSeconds: result.timeline.durationSeconds,
  };
}

await writeJson(path.join(inputsDirectory, 'storyboard.json'), storyboard);
await writeJson(
  path.join(inputsDirectory, 'assets-manifest.json'),
  registeredFamily.manifest,
);
await writeJson(
  path.join(inputsDirectory, 'registered-geometry-proof.json'),
  registeredGeometry,
);
await writeJson(
  path.join(inputsDirectory, 'storyboard-authoring.json'),
  createPhase2StoryboardAuthoring({media}),
);
await Promise.all(Object.entries(projects).map(([profileId, project]) =>
  writeJson(
    path.join(inputsDirectory, `project-${profileId.replace(':', 'x')}.json`),
    project,
  )
));

const editPointReport = {
  schemaVersion: 1,
  fps: storyboard.editorial.timebase.fps,
  rounding: storyboard.editorial.timebase.rounding,
  wordTimingPolicy: storyboard.editorial.wordTimingPolicy,
  media: storyboard.editorial.media,
  mappings: storyboard.editorial.resolvedEditPoints.map((point) => ({
    ...point,
    cueKinds: point.cueIds.map((cueId) =>
      storyboard.editorial.cues.find(({id}) => id === cueId)?.kind
    ),
    bindings: storyboard.editorial.bindings
      .filter(({editPointId}) => editPointId === point.id)
      .map(({id, targetType, targetId, mode, offsetSeconds}) => ({
        id,
        targetType,
        targetId,
        mode: mode ?? null,
        offsetSeconds: offsetSeconds ?? 0,
      })),
  })),
  conflicts: storyboard.editorial.conflicts,
  frameConversion: 'renderFrame = sceneStartFrame + round(actualMediaSeconds * fps)',
};
await writeJson(path.join(reportsDirectory, 'edit-point-report.json'), editPointReport);

const responsiveReport = {
  schemaVersion: 1,
  semanticStoryboardFingerprint: storyboard.directingSummary.fingerprint,
  profiles: storyboard.editorial.responsivePlans.map((plan) => ({
    ...plan,
    projectVideo: projects[plan.profileId].video,
    materializedCoordinateSpaces: projects[plan.profileId].scenes.map((scene) => ({
      sceneId: scene.id,
      coordinateSpace: scene.composition.coordinateSpace,
    })),
  })),
};
await writeJson(
  path.join(reportsDirectory, 'responsive-directing-report.json'),
  responsiveReport,
);

const typographyReport = [];
const annotationReport = [];
const dataReport = [];
for (const [profileId, project] of Object.entries(projects)) {
  const zones = project.editorial.responsiveProfiles.find(({id}) => id === profileId)
    ?.exclusionZones ?? [];
  for (const scene of project.scenes) {
    const nodes = flattenCompositionNodes(scene.composition.nodes);
    for (const {node} of nodes) {
      if (node.kind === 'typography') {
        const layout = fitEditorialTypography({
          text: node.text,
          width: node.transform.width * project.video.width,
          height: (node.transform.height ?? node.transform.width) * project.video.height,
          minFontSize: node.treatment.fit.minFontSize,
          maxFontSize: node.treatment.fit.maxFontSize,
          maxLines: node.treatment.fit.maxLines,
          lineHeight: node.treatment.style.lineHeight,
          letterSpacing: node.treatment.style.letterSpacing ?? 0,
        });
        typographyReport.push({
          profileId,
          sceneId: scene.id,
          nodeId: node.id,
          fontFamily: node.treatment.style.fontFamily,
          ...layout,
          passed: !layout.overflow,
        });
      }
      if (node.kind === 'annotation') {
        const route = resolveAnnotationRoute({
          node,
          nodes: scene.composition.nodes,
          zones,
        });
        annotationReport.push({
          profileId,
          sceneId: scene.id,
          nodeId: node.id,
          annotationKind: node.annotationKind,
          route,
          passed: route.valid && !route.directBlocked,
        });
      }
      if (node.kind === 'data-graphic') {
        const issues = validateDataGraphicNode(node);
        dataReport.push({
          profileId,
          sceneId: scene.id,
          nodeId: node.id,
          graphicKind: node.graphicKind,
          data: node.data,
          geometry: node.geometry ?? null,
          issues,
          passed: issues.length === 0,
          svgMappingFingerprint: sha256Value({
            graphicKind: node.graphicKind,
            data: node.data,
            geometry: node.geometry,
            scale: node.scale,
            format: node.format,
          }),
        });
      }
    }
  }
}
await writeJson(
  path.join(reportsDirectory, 'typography-overflow-fit-report.json'),
  {
    schemaVersion: 1,
    passed: typographyReport.every(({passed}) => passed),
    results: typographyReport,
  },
);
await writeJson(
  path.join(reportsDirectory, 'annotation-collision-exclusion-report.json'),
  {
    schemaVersion: 1,
    passed: annotationReport.every(({passed}) => passed),
    results: annotationReport,
  },
);
await writeJson(
  path.join(reportsDirectory, 'chart-map-timeline-report.json'),
  {
    schemaVersion: 1,
    passed: dataReport.every(({passed}) => passed),
    graphicKinds: [...new Set(dataReport.map(({graphicKind}) => graphicKind))].sort(),
    results: dataReport,
  },
);

await writeJson(
  path.join(reportsDirectory, 'transition-continuity-report.json'),
  {
    schemaVersion: 1,
    passed: storyboard.editorial.transitionPlans.every(
      ({invalidProfiles}) => invalidProfiles.length === 0,
    ),
    transitions: storyboard.editorial.transitionPlans,
  },
);

const authoringRevision = storyboardAuthoringFromCompiled(storyboard);
authoringRevision.editorial = structuredClone(authoringRevision.editorial);
authoringRevision.editorial.sceneDirecting[1].typographyProfile =
  'mixed-script-editorial-revision';
authoringRevision.updatedAt = '2026-07-23T00:00:01.000Z';
const revisedStoryboard = compileStoryboardDirecting(authoringRevision, {
  plan: createPhase2Plan(),
  styleProfile: FIXTURE_STYLE_PROFILE,
});
const conceptBefore = storyboardConceptFingerprint(storyboard);
const conceptAfter = storyboardConceptFingerprint(revisedStoryboard);
const directingRevisionReport = {
  schemaVersion: 1,
  passed:
    conceptBefore === conceptAfter &&
    storyboard.directingSummary.fingerprint !==
      revisedStoryboard.directingSummary.fingerprint,
  protectedConceptFingerprint: conceptBefore,
  revisedConceptFingerprint: conceptAfter,
  oldDirectingFingerprint: storyboard.directingSummary.fingerprint,
  newDirectingFingerprint: revisedStoryboard.directingSummary.fingerprint,
  editorialChanged:
    storyboard.editorial.fingerprint !== revisedStoryboard.editorial.fingerprint,
  responsivePlanChanges: {
    before: hashCompositionValue(storyboard.editorial.responsivePlans),
    after: hashCompositionValue(revisedStoryboard.editorial.responsivePlans),
  },
  editPointChanges: {
    before: storyboard.editorial.resolvedEditPoints,
    after: revisedStoryboard.editorial.resolvedEditPoints,
  },
};
if (!directingRevisionReport.passed) {
  throw new Error('Phase 2 directing revision comparison 未证明概念不变且导演指纹变化。');
}
await writeJson(
  path.join(reportsDirectory, 'directing-revision-comparison.json'),
  directingRevisionReport,
);

const qualityTargets = await collectCompositeQualityTargets(projects['16:9'], {
  manifest: registeredFamily.manifest,
});
await writeJson(path.join(reportsDirectory, 'quality-targets.json'), {
  schemaVersion: 1,
  runtimeFingerprint: await createRuntimeBuildFingerprint(),
  targets: qualityTargets.map((target) => ({
    compositeId: target.compositeId,
    sceneId: target.sceneId,
    pattern: target.pattern,
    nodeId: target.nodeId,
    fingerprint: target.fingerprint,
    proofTimeIds: target.proofTimeIds,
    requiredChecks: target.requiredChecks,
  })),
});

const mediaFiles = await listFilesRecursively(PHASE2_PUBLIC_DIR);
const inputFiles = await listFilesRecursively(inputsDirectory);
await writeJson(path.join(reportsDirectory, 'prepare-report.json'), {
  schemaVersion: 1,
  passed: true,
  providerCalls: 0,
  registeredFamily: {
    familyId: registeredFamily.proof.familyId,
    familyFingerprint: registeredFamily.proof.familyFingerprint,
    providerImageCalls: registeredFamily.proof.providerImageCalls,
    localDerivatives: registeredFamily.proof.localDerivatives,
    avoidedCalls: registeredFamily.proof.avoidedCalls,
  },
  projectValidation,
  storyboardFingerprint: storyboard.directingSummary.fingerprint,
  editorialFingerprint: storyboard.editorial.fingerprint,
  runtimeFingerprint: await createRuntimeBuildFingerprint(),
  inputsSha256: {
    ...await hashFiles(mediaFiles),
    ...await hashFiles(inputFiles),
  },
});

console.log(`✓ Phase 2 proof inputs prepared: ${PHASE2_PROOF_DIR}`);
