import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessCreativePlanTimeline,
  approveImageBudgetIncrease,
  assertApprovedImageBudgetDecision,
  assertConfirmedPlanDecision,
  buildCreativePlan,
  deriveAssetBudget,
  deriveMotionBudget,
  deriveCreativePlanMode,
  deriveDurationAuthority,
  resetUnconfirmedCreativePlan,
  summarizeConceptDecision,
  summarizeProductionProfiles,
  validateCreativePlan,
} from '../scripts/creative-plan-lib.mjs';
import {buildProviderRootPlan} from '../scripts/provider-root-plan-lib.mjs';

const at = '2026-07-17T00:00:00.000Z';
const make = (overrides) =>
  buildCreativePlan({
    slug: 'planning-test',
    durationSeconds: 30,
    sceneCount: 3,
    estimatedNarrationSeconds: 25,
    rationale: '按叙事节拍和旁白长度补全',
    at,
    ...overrides,
  });

test('creative planning supports all four partial-input modes', () => {
  const none = make({});
  assert.equal(none.schemaVersion, 4);
  assert.equal(none.inputMode, 'none');
  assert.equal(none.productionProfile, 'balanced');
  assert.deepEqual(none.assetBudget, {
    backgrounds: 3,
    environmentLayers: 2,
    characterSheets: 2,
    styleSamples: 1,
    baseImageAttempts: 8,
    layerPackageAttemptReserve: 12,
    maxGeneratedImages: 20,
  });
  assert.deepEqual(none.motionBudget, {
    maxPoseSheetCalls: 2,
    maxStatesPerSheet: 4,
    maxContinuousTargets: 12,
  });
  assert.equal(none.approvedImageBudget, null);
  assert.deepEqual(none.requested, {durationSeconds: null, sceneCount: null});

  const durationOnly = make({
    requestedDurationSeconds: 45,
    durationSeconds: 45,
    sceneCount: 4,
  });
  assert.equal(durationOnly.inputMode, 'duration-only');
  assert.equal(durationOnly.resolved.durationSeconds, 45);
  assert.equal(durationOnly.resolved.sceneCount, 4);

  const scenesOnly = make({
    requestedSceneCount: 5,
    durationSeconds: 58,
    sceneCount: 5,
  });
  assert.equal(scenesOnly.inputMode, 'scenes-only');
  assert.equal(scenesOnly.resolved.durationSeconds, 58);
  assert.equal(scenesOnly.resolved.sceneCount, 5);

  const both = make({
    requestedDurationSeconds: 24,
    requestedSceneCount: 2,
    durationSeconds: 24,
    sceneCount: 2,
    estimatedNarrationSeconds: 19,
  });
  assert.equal(both.inputMode, 'both');
  assert.deepEqual(both.requested, {durationSeconds: 24, sceneCount: 2});
  assert.deepEqual(validateCreativePlan(both, {slug: 'planning-test'}), []);
});

test('production profiles set explicit generated-image budgets', () => {
  assert.deepEqual(deriveMotionBudget('full-depth', 1), {
    maxPoseSheetCalls: 2,
    maxStatesPerSheet: 6,
    maxContinuousTargets: 6,
  });
  assert.deepEqual(deriveAssetBudget('full-depth', 1), {
    backgrounds: 1,
    environmentLayers: 2,
    characterSheets: 2,
    styleSamples: 1,
    baseImageAttempts: 6,
    layerPackageAttemptReserve: 8,
    maxGeneratedImages: 14,
  });
  assert.deepEqual(deriveAssetBudget('draft', 6), {
    backgrounds: 6,
    environmentLayers: 2,
    characterSheets: 2,
    styleSamples: 1,
    baseImageAttempts: 11,
    layerPackageAttemptReserve: 12,
    maxGeneratedImages: 23,
  });
  assert.equal(deriveAssetBudget('balanced', 6).maxGeneratedImages, 38);
  assert.equal(deriveAssetBudget('full-depth', 6).maxGeneratedImages, 73);
  assert.deepEqual(deriveMotionBudget('draft', 6), {
    maxPoseSheetCalls: 2,
    maxStatesPerSheet: 4,
    maxContinuousTargets: 12,
  });
  assert.deepEqual(deriveMotionBudget('full-depth', 6), {
    maxPoseSheetCalls: 6,
    maxStatesPerSheet: 6,
    maxContinuousTargets: 36,
  });
  assert.equal(
    make({productionProfile: 'full-depth'}).productionProfile,
    'full-depth',
  );
  assert.throws(
    () => make({productionProfile: 'unbounded'}),
    /productionProfile/,
  );
});

test('concept decisions expose bounded profile choices with exact scene budgets', () => {
  const plan = make({sceneCount: 2, productionProfile: 'full-depth'});
  const decision = summarizeConceptDecision(plan);
  assert.equal(decision.durationAuthority, 'content-derived');
  assert.deepEqual(
    decision.profileOptions.map(({id, assetBudget}) => [id, assetBudget.maxGeneratedImages]),
    [
      ['draft', 9],
      ['balanced', 14],
      ['full-depth', 25],
    ],
  );
  assert.deepEqual(
    decision.profileOptions.map(({id, motionBudget}) => [id, motionBudget.maxPoseSheetCalls]),
    [['draft', 1], ['balanced', 1], ['full-depth', 2]],
  );
  assert.ok(
    summarizeProductionProfiles(2).every(
      ({summary, finalImpact}) => summary.length > 10 && finalImpact.length > 10,
    ),
  );
  assert.doesNotThrow(() => assertConfirmedPlanDecision({
    productionProfile: 'full-depth',
    durationSeconds: 30,
    sceneCount: 2,
    durationAuthority: 'content-derived',
  }, plan));
  assert.throws(
    () => assertConfirmedPlanDecision({...decision, productionProfile: 'balanced'}, plan),
    /productionProfile 必须与当前计划一致/,
  );
  assert.equal(
    deriveDurationAuthority(make({requestedDurationSeconds: 30})),
    'human-target',
  );
});

test('human-approved image limit is narrower than the profile ceiling and covers expected calls', () => {
  const plan = make({
    sceneCount: 1,
    productionProfile: 'draft',
  });
  const directingSummary = {
    generationBudget: {expectedProviderImageCalls: 1},
  };
  assert.deepEqual(
    assertApprovedImageBudgetDecision(
      {imageAttemptLimit: 2},
      plan,
      directingSummary,
      {at},
    ),
    {
      imageAttemptLimit: 2,
      expectedProviderImageCalls: 1,
      profileHardCeiling: 6,
      approvedAt: at,
    },
  );
  assert.throws(
    () =>
      assertApprovedImageBudgetDecision(
        {imageAttemptLimit: 0},
        plan,
        directingSummary,
      ),
    /低于当前 storyboard 预计需要的 1 次/,
  );
  assert.throws(
    () =>
      assertApprovedImageBudgetDecision(
        {imageAttemptLimit: 7},
        plan,
        directingSummary,
      ),
    /超过 draft profile hard ceiling 6/,
  );
});

test('human-approved image budget increases remain bounded and auditable', () => {
  const base = make({
    sceneCount: 1,
    productionProfile: 'full-depth',
  });
  const plan = {
    ...base,
    scenarioBinding: {
      scenarioSetFingerprint: 'a'.repeat(64),
      optionId: 'full-depth',
      optionFingerprint: 'b'.repeat(64),
      expectedProviderImageCalls: 5,
      proposedImageAttemptLimit: 12,
      providerRootPlan: buildProviderRootPlan({
        id: 'full-depth',
        scenes: [
          {
            id: 'scene-01',
            stateFamilies: [],
            sourcePackages: [
              {
                id: 'depth-package',
                strategy: 'context-preserving-layer-edits',
                providerCalls: 4,
              },
            ],
          },
        ],
      }),
      selectedAt: at,
    },
    storyScope: 'expanded',
    profilePromise: {
      minRequiredStateFamilies: 0,
      minEnhancementStateFamilies: 0,
      minTotalStates: 0,
      minLocalMotionTargets: 0,
      minLayeredScenes: 0,
      minParallaxScenes: 0,
      minAmbientScenes: 0,
    },
    approvedImageBudget: {
      imageAttemptLimit: 12,
      expectedProviderImageCalls: 5,
      profileHardCeiling: 14,
      approvedAt: at,
    },
  };
  const result = approveImageBudgetIncrease({
    plan,
    imageAttemptLimit: 14,
    attempts: {used: 12, reserved: 0},
    humanNote: 'Approve two additional environment attempts',
    at: '2026-07-18T00:00:00.000Z',
  });
  assert.equal(result.plan.approvedImageBudget.imageAttemptLimit, 14);
  assert.equal(result.plan.imageBudgetRevisions.length, 1);
  assert.deepEqual(
    {
      from: result.revision.fromLimit,
      to: result.revision.toLimit,
      used: result.revision.usedAtApproval,
    },
    {from: 12, to: 14, used: 12},
  );
  assert.throws(
    () =>
      approveImageBudgetIncrease({
        plan,
        imageAttemptLimit: 15,
        attempts: {used: 12, reserved: 0},
        humanNote: 'Too high',
      }),
    /超过当前 profile hard ceiling 14/,
  );
});

test('creative planning preserves each explicit user constraint', () => {
  assert.throws(
    () =>
      make({
        requestedDurationSeconds: 30,
        durationSeconds: 35,
      }),
    /不得改写该目标/,
  );
  assert.throws(
    () =>
      make({
        requestedSceneCount: 3,
        sceneCount: 4,
      }),
    /不得改写该目标/,
  );
});

test('an unapproved resolved plan can return to pending without carrying approval', () => {
  const resolved = make({
    requestedSceneCount: 1,
    sceneCount: 1,
    productionProfile: 'full-depth',
  });
  resolved.assetBudget.maxGeneratedImages = 12;
  const pending = resetUnconfirmedCreativePlan(resolved, {
    slug: 'planning-test',
    at,
  });
  assert.equal(pending.status, 'pending');
  assert.deepEqual(pending.requested, {
    durationSeconds: null,
    sceneCount: 1,
  });
  assert.equal(pending.resolved, null);
  assert.equal(pending.assetBudget, null);
  assert.equal(pending.motionBudget, null);
  assert.equal(pending.approvedImageBudget, null);
  assert.deepEqual(validateCreativePlan(pending, {slug: 'planning-test'}), []);
});

test('creative planning rejects narration that cannot fit the target duration', () => {
  assert.throws(
    () => make({durationSeconds: 20, estimatedNarrationSeconds: 22}),
    /不能超过目标成片时长/,
  );
});

test('input mode is derived independently for duration and scene count', () => {
  assert.equal(
    deriveCreativePlanMode({durationSeconds: 20, sceneCount: null}),
    'duration-only',
  );
  assert.equal(
    deriveCreativePlanMode({durationSeconds: null, sceneCount: 4}),
    'scenes-only',
  );
});

test('resolved plans enforce scene count without padding inferred duration', () => {
  const plan = make({durationSeconds: 30, sceneCount: 3});
  assert.deepEqual(
    assessCreativePlanTimeline(plan, {
      durationSeconds: 31.5,
      scenes: [{}, {}, {}],
    }),
    [],
  );
  const issues = assessCreativePlanTimeline(plan, {
    durationSeconds: 38,
    scenes: [{}, {}],
  });
  assert.equal(issues.find(({code}) => code === 'plan-scene-count').level, 'error');
  assert.equal(issues.some(({code}) => code === 'plan-duration-drift'), false);

  const explicitDuration = make({
    requestedDurationSeconds: 30,
    durationSeconds: 30,
    sceneCount: 3,
  });
  const explicitIssues = assessCreativePlanTimeline(explicitDuration, {
    durationSeconds: 38,
    scenes: [{}, {}, {}],
  });
  assert.equal(
    explicitIssues.find(({code}) => code === 'plan-duration-drift').level,
    'error',
  );
  const deficitIssues = assessCreativePlanTimeline(explicitDuration, {
    durationSeconds: 24,
    scenes: [{}, {}, {}],
  });
  assert.equal(
    deficitIssues.find(({code}) => code === 'duration-content-deficit').level,
    'error',
  );
});
