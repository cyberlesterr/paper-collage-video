import {hashCompositionValue} from './composition-lib.mjs';
import {transitionDirectingRevision} from './production-state.mjs';
import {
  compileStoryboardDirecting,
  validateStoryboard,
} from './storyboard-lib.mjs';
import {
  recalculateProfilePromiseForLockedStaticScenes,
} from './motion-treatment-lib.mjs';
import {
  assertStoryboardMatchesScenario,
} from './planning-scenario-lib.mjs';
import {materializeSceneTransitionRecipes} from '../src/sceneTimeline.mjs';

const sceneConcept = (scene) => ({
  id: scene.id,
  title: scene.title,
  narrativeRole: scene.narrativeRole,
  message: scene.message,
  blueprint: scene.blueprint,
  motionPolicy: scene.motionPolicy ?? 'standard',
  staticRationale: scene.staticRationale ?? null,
  beats: (scene.beats ?? []).map((beat) => ({
    id: beat.id,
    performanceRole: beat.performanceRole,
    purpose: beat.purpose,
    visual: beat.visual,
    soundCue: beat.soundCue,
  })),
  proofs: (scene.proofTimes ?? []).map((proof) => ({
    id: proof.id,
    label: proof.label,
    kind: proof.kind,
    assertions: proof.assertions,
  })),
});

export const storyboardConceptFingerprint = (storyboard) =>
  hashCompositionValue({
    arc: storyboard.arc,
    style: storyboard.style,
    motionDirection: storyboard.motionDirection,
    scenes: (storyboard.scenes ?? []).map(sceneConcept),
  });

export const storyboardAuthoringFromCompiled = (storyboard) => ({
  ...storyboard,
  editorial: storyboard.editorial
    ? Object.fromEntries(
        Object.entries(storyboard.editorial).filter(
          ([key]) => !['resolvedEditPoints', 'conflicts', 'responsivePlans', 'transitionPlans', 'fingerprint'].includes(key),
        ),
      )
    : storyboard.editorial,
  scenes: (storyboard.scenes ?? []).map(({compositionPlan, directing, ...scene}) => scene),
  motionContract: undefined,
  directingSummary: undefined,
});

const changedCategories = (before, after) => {
  const categories = [];
  const differs = (left, right) =>
    hashCompositionValue(left) !== hashCompositionValue(right);
  if (before.estimatedDurationSeconds !== after.estimatedDurationSeconds) {
    categories.push('estimated-duration');
  }
  if (differs(before.beats?.map(({at}) => at), after.beats?.map(({at}) => at))) {
    categories.push('beat-timing');
  }
  if (differs(before.beats?.map(({treatments}) => treatments), after.beats?.map(({treatments}) => treatments))) {
    categories.push('treatments');
  }
  if (differs(before.proofTimes?.map(({at}) => at), after.proofTimes?.map(({at}) => at))) {
    categories.push('proof-timing');
  }
  if (
    differs(
      before.proofTimes?.map(({id, stateAssertions}) => ({
        id,
        stateAssertions: stateAssertions ?? [],
      })),
      after.proofTimes?.map(({id, stateAssertions}) => ({
        id,
        stateAssertions: stateAssertions ?? [],
      })),
    )
  ) {
    categories.push('proof-coverage');
  }
  if (differs(before.compositionPlan, after.compositionPlan)) categories.push('compiled-plan');
  if (before.directing?.fingerprint !== after.directing?.fingerprint) {
    categories.push('directing-fingerprint');
  }
  return categories;
};

const styleProofTarget = (storyboard) => {
  const plan = storyboard.directingSummary?.styleProofPlan ?? null;
  return plan ? {fingerprint: plan.fingerprint, targets: plan.targets} : null;
};

const editorialSceneScope = (editorial, sceneId) => {
  const cues = (editorial?.cues ?? []).filter((cue) => cue.sceneId === sceneId);
  const cueIds = new Set(cues.map(({id}) => id));
  const transitions = (editorial?.transitions ?? []).filter(
    (transition) =>
      transition.sceneId === sceneId ||
      transition.fromSceneId === sceneId ||
      transition.toSceneId === sceneId,
  );
  return {
    cues,
    editPoints: (editorial?.editPoints ?? []).filter((point) =>
      point.cueIds?.some((id) => cueIds.has(id)),
    ),
    bindings: (editorial?.bindings ?? []).filter(
      (binding) => binding.sceneId === sceneId,
    ),
    sceneDirecting: (editorial?.sceneDirecting ?? []).find(
      (directing) => directing.sceneId === sceneId,
    ) ?? null,
    resolvedEditPoints: (editorial?.resolvedEditPoints ?? []).filter(
      (point) => point.sceneId === sceneId,
    ),
    responsivePlans: (editorial?.responsivePlans ?? []).map((profile) => ({
      profileId: profile.profileId,
      scene: profile.scenes?.find((scene) => scene.sceneId === sceneId) ?? null,
    })),
    transitionPlans: (editorial?.transitionPlans ?? []).filter(
      (transition) =>
        transition.sceneId === sceneId ||
        transition.fromSceneId === sceneId ||
        transition.toSceneId === sceneId,
    ),
    transitions,
  };
};

const editorialGlobalScope = (editorial) => ({
  timebase: editorial?.timebase ?? null,
  wordTimingPolicy: editorial?.wordTimingPolicy ?? null,
  media: editorial?.media ?? [],
  responsiveProfiles: editorial?.responsiveProfiles ?? [],
  activeProfile: editorial?.activeProfile ?? null,
});

export const changedEditorialSceneIds = ({
  before,
  after,
  sceneIds,
}) => {
  const ids = [...sceneIds];
  if (
    hashCompositionValue(editorialGlobalScope(before)) !==
    hashCompositionValue(editorialGlobalScope(after))
  ) {
    return ids.sort();
  }
  return ids.filter(
    (sceneId) =>
      hashCompositionValue(editorialSceneScope(before, sceneId)) !==
      hashCompositionValue(editorialSceneScope(after, sceneId)),
  ).sort();
};

const authorizationFingerprint = (authorization) =>
  hashCompositionValue({
    schemaVersion: authorization.schemaVersion,
    id: authorization.id,
    slug: authorization.slug,
    source: authorization.source,
    allowedSceneIds: [...authorization.allowedSceneIds].sort(),
    humanNote: authorization.humanNote.trim(),
    equivalentQualityEvidence: authorization.equivalentQualityEvidence.map(
      (entry) => entry.trim(),
    ),
    decidedAt: authorization.decidedAt,
  });

const assertSemanticRevisionAuthorization = ({
  authorization,
  slug,
  sceneIds,
}) => {
  if (
    authorization?.schemaVersion !== 1 ||
    authorization.slug !== slug ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(authorization.id ?? '') ||
    ![
      'preview-changes-requested',
      'style-review-feedback',
      'asset-production-feedback',
    ].includes(authorization.source) ||
    !Array.isArray(authorization.allowedSceneIds) ||
    authorization.allowedSceneIds.length < 1 ||
    new Set(authorization.allowedSceneIds).size !==
      authorization.allowedSceneIds.length ||
    authorization.allowedSceneIds.some((id) => !sceneIds.has(id)) ||
    typeof authorization.humanNote !== 'string' ||
    !authorization.humanNote.trim() ||
    !Array.isArray(authorization.equivalentQualityEvidence) ||
    authorization.equivalentQualityEvidence.length < 1 ||
    authorization.equivalentQualityEvidence.some(
      (entry) => typeof entry !== 'string' || !entry.trim(),
    ) ||
    !Number.isFinite(Date.parse(authorization.decidedAt))
  ) {
    throw new Error(
      'semantic revision authorization 必须绑定当前项目、合法来源、允许改变的镜头、人类原话、等价质量说明和决定时间。',
    );
  }
  return authorization;
};

export const prepareDirectingRevision = ({
  currentStoryboard,
  suppliedStoryboard,
  plan,
  styleProfile,
  production,
  reportPath,
  source = 'preview',
  at = new Date().toISOString(),
}) => {
  const authored = storyboardAuthoringFromCompiled(suppliedStoryboard);
  const candidate = compileStoryboardDirecting({
    ...authored,
    $schema: '../../schemas/storyboard.schema.json',
    schemaVersion: 12,
    slug: currentStoryboard.slug,
    status: 'ready',
    sceneTransitions: materializeSceneTransitionRecipes(
      authored.sceneTransitions,
      styleProfile?.motion?.transitionSet,
    ),
    updatedAt: at,
  }, {plan, styleProfile});

  const issues = validateStoryboard(candidate, {
    slug: currentStoryboard.slug,
    plan,
    styleProfile,
  });
  if (issues.length > 0) {
    throw new Error(issues.map(({location, message}) => `${location}: ${message}`).join('\n'));
  }
  const beforeConcept = storyboardConceptFingerprint(currentStoryboard);
  const afterConcept = storyboardConceptFingerprint(candidate);
  if (beforeConcept !== afterConcept) {
      throw new Error('导演重编不得改变已批准的故事概念、风格、镜头语义、节拍语义或证明断言。');
  }
  if (
    currentStoryboard.motionContract?.approvalFingerprint !==
    candidate.motionContract?.approvalFingerprint
  ) {
    throw new Error(
      '导演重编不得改变已批准的全片动作语言或节拍角色；请返回现有风格/动作语言 gate。',
    );
  }

  const previousScenes = new Map(currentStoryboard.scenes.map((scene) => [scene.id, scene]));
  const changedScenes = candidate.scenes
    .map((scene) => ({
      sceneId: scene.id,
      categories: changedCategories(previousScenes.get(scene.id), scene),
    }))
    .filter(({categories}) => categories.length > 0);
  const changedSceneIds = new Set(changedScenes.map(({sceneId}) => sceneId));
  const transitionsChanged = hashCompositionValue(currentStoryboard.sceneTransitions) !==
    hashCompositionValue(candidate.sceneTransitions);
  const editorialChanged =
    currentStoryboard.editorial?.fingerprint !== candidate.editorial?.fingerprint;
  const editorialSceneIds = editorialChanged
    ? changedEditorialSceneIds({
        before: currentStoryboard.editorial,
        after: candidate.editorial,
        sceneIds: candidate.scenes.map(({id}) => id),
      })
    : [];
  const spatialContractsChanged =
    hashCompositionValue(currentStoryboard.spatialContracts ?? []) !==
    hashCompositionValue(candidate.spatialContracts ?? []);
  const beforeSpatialContracts = new Map(
    (currentStoryboard.spatialContracts ?? []).map((contract) => [
      contract.id,
      contract,
    ]),
  );
  const afterSpatialContracts = new Map(
    (candidate.spatialContracts ?? []).map((contract) => [
      contract.id,
      contract,
    ]),
  );
  const changedSpatialContractIds = [
    ...new Set([
      ...beforeSpatialContracts.keys(),
      ...afterSpatialContracts.keys(),
    ]),
  ].filter(
    (id) =>
      hashCompositionValue(beforeSpatialContracts.get(id) ?? null) !==
      hashCompositionValue(afterSpatialContracts.get(id) ?? null),
  ).sort();
  if (transitionsChanged) {
    for (const transition of candidate.sceneTransitions ?? []) {
      changedSceneIds.add(transition.fromSceneId);
      changedSceneIds.add(transition.toSceneId);
    }
  }
  if (editorialChanged) {
    for (const sceneId of editorialSceneIds) changedSceneIds.add(sceneId);
  }
  if (spatialContractsChanged) {
    for (const contract of changedSpatialContractIds.flatMap((id) => [
      beforeSpatialContracts.get(id),
      afterSpatialContracts.get(id),
    ]).filter(Boolean)) {
      if (contract.sceneId) changedSceneIds.add(contract.sceneId);
      if (contract.from?.sceneId) changedSceneIds.add(contract.from.sceneId);
      if (contract.to?.sceneId) changedSceneIds.add(contract.to.sceneId);
    }
  }
  if (changedSceneIds.size === 0) {
    throw new Error('导演重编没有产生任何实际变化。');
  }

  const beforeStyleTarget = styleProofTarget(currentStoryboard);
  const afterStyleTarget = styleProofTarget(candidate);
  const invalidateStyleProof = hashCompositionValue(beforeStyleTarget) !==
    hashCompositionValue(afterStyleTarget);
  const report = {
    schemaVersion: 1,
    slug: currentStoryboard.slug,
    createdAt: at,
    oldDirectingFingerprint: currentStoryboard.directingSummary?.fingerprint ?? null,
    newDirectingFingerprint: candidate.directingSummary?.fingerprint ?? null,
    motionContract: {
      oldApprovalFingerprint:
        currentStoryboard.motionContract?.approvalFingerprint ?? null,
      newApprovalFingerprint:
        candidate.motionContract?.approvalFingerprint ?? null,
      oldExecutionFingerprint:
        currentStoryboard.motionContract?.fingerprint ?? null,
      newExecutionFingerprint:
        candidate.motionContract?.fingerprint ?? null,
      approvalPreserved:
        currentStoryboard.motionContract?.approvalFingerprint ===
        candidate.motionContract?.approvalFingerprint,
    },
    protectedConceptFingerprint: beforeConcept,
    changedSceneIds: [...changedSceneIds].sort(),
    changedScenes,
    transitionsChanged,
    editorialChanged,
    changedEditorialSceneIds: editorialSceneIds,
    spatialContractsChanged,
    changedSpatialContractIds,
    editPointChanges: {
      before: currentStoryboard.editorial?.resolvedEditPoints ?? [],
      after: candidate.editorial?.resolvedEditPoints ?? [],
    },
    responsivePlanChanges: {
      beforeFingerprint: hashCompositionValue(currentStoryboard.editorial?.responsivePlans ?? []),
      afterFingerprint: hashCompositionValue(candidate.editorial?.responsivePlans ?? []),
    },
    executionSyncRequired: true,
    providerApprovalRequired: false,
    motionBudget: {
      approved: plan.motionBudget ?? null,
      before: currentStoryboard.directingSummary?.budget ?? null,
      after: candidate.directingSummary?.budget ?? null,
    },
    styleProof: {
      before: beforeStyleTarget,
      after: afterStyleTarget,
      invalidated: invalidateStyleProof,
    },
    invalidatedArtifacts: [
      'validationReport',
      'preview',
      'final',
      'report',
      'contactSheet',
      ...(invalidateStyleProof ? ['styleProof'] : []),
    ],
  };
  const nextProduction = transitionDirectingRevision(production, {
    changedSceneIds: report.changedSceneIds,
    invalidateStyleProof,
    source,
    reportPath,
    at,
  });
  return {storyboard: candidate, production: nextProduction, report: {...report, source}};
};

export const prepareSemanticRevision = ({
  currentStoryboard,
  suppliedStoryboard,
  plan,
  styleProfile,
  production,
  authorization,
  reportPath,
  scenarioOption = null,
  at = new Date().toISOString(),
}) => {
  const currentSceneIds = new Set(
    currentStoryboard.scenes.map(({id}) => id),
  );
  assertSemanticRevisionAuthorization({
    authorization,
    slug: currentStoryboard.slug,
    sceneIds: currentSceneIds,
  });
  const sourceByAuthorization = {
    'preview-changes-requested': 'preview',
    'style-review-feedback': 'style-review',
    'asset-production-feedback': 'asset-production',
  };
  const source = sourceByAuthorization[authorization.source];
  const authored = storyboardAuthoringFromCompiled(suppliedStoryboard);
  if (
    hashCompositionValue(currentStoryboard.arc) !==
      hashCompositionValue(authored.arc) ||
    hashCompositionValue(currentStoryboard.style) !==
      hashCompositionValue(authored.style) ||
    hashCompositionValue(currentStoryboard.motionDirection) !==
      hashCompositionValue(authored.motionDirection)
  ) {
    throw new Error(
      '语义重编授权按镜头生效；全片 arc、style 或 motionDirection 变化必须返回其所属概念/风格决策。',
    );
  }
  const profileRecalculation =
    recalculateProfilePromiseForLockedStaticScenes({
      promise: plan.profilePromise ?? null,
      scenes: authored.scenes ?? [],
    });
  const nextPlan = profileRecalculation?.changed
    ? {
        ...plan,
        profilePromise: profileRecalculation.recalculated,
        profilePromiseRevision: {
          authorizationId: authorization.id,
          authorizationFingerprint: authorizationFingerprint(authorization),
          lockedSceneIds: profileRecalculation.lockedSceneIds,
          original: profileRecalculation.original,
          recalculated: profileRecalculation.recalculated,
          equivalentQualityEvidence:
            authorization.equivalentQualityEvidence.map((entry) =>
              entry.trim(),
            ),
          decidedAt: authorization.decidedAt,
        },
        updatedAt: at,
      }
    : plan;
  const candidate = compileStoryboardDirecting({
    ...authored,
    $schema: '../../schemas/storyboard.schema.json',
    schemaVersion: 12,
    slug: currentStoryboard.slug,
    status: 'ready',
    sceneTransitions: materializeSceneTransitionRecipes(
      authored.sceneTransitions,
      styleProfile?.motion?.transitionSet,
    ),
    updatedAt: at,
  }, {plan: nextPlan, styleProfile});
  const issues = validateStoryboard(candidate, {
    slug: currentStoryboard.slug,
    plan: nextPlan,
    styleProfile,
  });
  if (issues.length > 0) {
    throw new Error(
      issues
        .map(({location, message}) => `${location}: ${message}`)
        .join('\n'),
    );
  }
  if (scenarioOption) {
    // The owning scenario remains the budget and critical-action boundary.
    assertStoryboardMatchesScenario(
      scenarioOption,
      candidate.directingSummary,
    );
  }
  const beforeScenes = new Map(
    currentStoryboard.scenes.map((scene) => [scene.id, scene]),
  );
  const semanticChangedSceneIds = candidate.scenes
    .filter(
      (scene) =>
        hashCompositionValue(sceneConcept(beforeScenes.get(scene.id))) !==
        hashCompositionValue(sceneConcept(scene)),
    )
    .map(({id}) => id)
    .sort();
  if (semanticChangedSceneIds.length === 0) {
    throw new Error(
      'human-authorized semantic revision 必须产生至少一个真实镜头语义变化；纯导演变化请使用 project:revise-preview-directing。',
    );
  }
  const allowed = new Set(authorization.allowedSceneIds);
  const unauthorized = semanticChangedSceneIds.filter(
    (sceneId) => !allowed.has(sceneId),
  );
  if (unauthorized.length > 0) {
    throw new Error(
      `语义重编越过人类授权镜头：${unauthorized.join(', ')}。`,
    );
  }
  const directingChangedScenes = candidate.scenes
    .map((scene) => ({
      sceneId: scene.id,
      categories: changedCategories(beforeScenes.get(scene.id), scene),
    }))
    .filter(({categories}) => categories.length > 0);
  const changedSceneIds = [
    ...new Set([
      ...semanticChangedSceneIds,
      ...directingChangedScenes.map(({sceneId}) => sceneId),
    ]),
  ].sort();
  const unauthorizedChangedSceneIds = changedSceneIds.filter(
    (sceneId) => !allowed.has(sceneId),
  );
  if (unauthorizedChangedSceneIds.length > 0) {
    throw new Error(
      `语义重编的执行变化越过人类授权镜头：${unauthorizedChangedSceneIds.join(', ')}。`,
    );
  }
  const nextProduction = transitionDirectingRevision(production, {
    changedSceneIds,
    invalidateStyleProof: true,
    source,
    reportPath,
    at,
  });
  const motionApprovalInvalidated =
    currentStoryboard.motionContract?.approvalFingerprint !==
    candidate.motionContract?.approvalFingerprint;
  if (motionApprovalInvalidated) {
    nextProduction.approvals.styleAndVoice = {
      status: 'pending',
      decidedAt: null,
      note: '',
    };
    nextProduction.artifacts.motionApproval = null;
    nextProduction.stage = 'style-review';
  }
  nextProduction.artifacts.semanticRevision = reportPath;
  nextProduction.artifacts.directingRevision = null;
  const historyEntry = nextProduction.history.at(-1);
  historyEntry.action = 'revise-preview-semantic';
  historyEntry.note =
    `${authorization.id} · ${source} · ${changedSceneIds.join(', ')} · ${reportPath}`;
  const report = {
    schemaVersion: 1,
    slug: currentStoryboard.slug,
    createdAt: at,
    source,
    authorization: {
      ...authorization,
      fingerprint: authorizationFingerprint(authorization),
    },
    oldConceptFingerprint:
      storyboardConceptFingerprint(currentStoryboard),
    newConceptFingerprint: storyboardConceptFingerprint(candidate),
    semanticChangedSceneIds,
    changedSceneIds,
    changedScenes: directingChangedScenes,
    profilePromiseRecalculation: profileRecalculation,
    executionSyncRequired: true,
    providerApprovalRequired: false,
    motionApprovalInvalidated,
    invalidatedArtifacts: [
      'styleProof',
      'validationReport',
      'preview',
      'final',
      'report',
      'contactSheet',
    ],
  };
  return {
    storyboard: candidate,
    plan: nextPlan,
    production: nextProduction,
    report,
  };
};
