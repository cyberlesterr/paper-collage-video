import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessCreativePlanTimeline,
  buildCreativePlan,
  deriveAssetBudget,
  deriveCreativePlanMode,
  validateCreativePlan,
} from '../scripts/creative-plan-lib.mjs';

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
  assert.equal(none.inputMode, 'none');
  assert.equal(none.productionProfile, 'balanced');
  assert.deepEqual(none.assetBudget, {
    backgrounds: 3,
    environmentLayers: 2,
    characterSheets: 1,
    styleSamples: 1,
    maxGeneratedImages: 7,
  });
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
  assert.deepEqual(deriveAssetBudget('draft', 6), {
    backgrounds: 6,
    environmentLayers: 2,
    characterSheets: 2,
    styleSamples: 1,
    maxGeneratedImages: 11,
  });
  assert.equal(deriveAssetBudget('balanced', 6).maxGeneratedImages, 13);
  assert.equal(deriveAssetBudget('full-depth', 6).maxGeneratedImages, 23);
  assert.equal(
    make({productionProfile: 'full-depth'}).productionProfile,
    'full-depth',
  );
  assert.throws(
    () => make({productionProfile: 'unbounded'}),
    /productionProfile/,
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

test('resolved plans enforce scene count and surface meaningful duration drift', () => {
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
  assert.equal(issues.find(({code}) => code === 'plan-duration-drift').level, 'warning');

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
});
