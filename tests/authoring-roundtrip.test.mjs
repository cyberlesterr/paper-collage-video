// A black-box replay of the boundary an independent agent actually works under:
// it may run commands and read their output, but it may not read schemas or
// implementation source to reconstruct a contract. Everything asserted here is
// reachable from a scaffold or a --json export. When this file needs a value
// that no command prints, the pipeline has a discoverability defect.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertScenarioDecision,
  buildCreativePlanFromScenario,
  buildPlanningScenarios,
  scenarioDecisionFor,
} from '../scripts/planning-scenario-lib.mjs';
import {
  assertSourcePackageDecision,
  sourcePackageDecisionFor,
} from '../scripts/layer-source-plan-lib.mjs';
import {assertConfirmedPlanDecision} from '../scripts/creative-plan-lib.mjs';
import {
  buildStoryboardScaffold,
  findStoryboardTodoMarkers,
} from '../scripts/storyboard-scaffold-lib.mjs';
import {buildSelectionScaffold} from '../scripts/selection-scaffold-lib.mjs';
import {
  compileStoryboardDirecting,
  validateStoryboard,
} from '../scripts/storyboard-lib.mjs';
import {materializeSceneTransitionRecipes} from '../src/sceneTimeline.mjs';
import {confirmIntake} from '../scripts/intake-lib.mjs';
import {
  loadStyleCatalog,
  materializeStyleProfile,
} from '../scripts/style-catalog-lib.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const at = '2026-08-20T00:00:00.000Z';

const fillMarkers = (value) => {
  if (typeof value === 'string') {
    return value.includes('TODO(author)') ? '作者补写的具体内容' : value;
  }
  if (Array.isArray(value)) return value.map(fillMarkers);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, fillMarkers(child)]),
    );
  }
  return value;
};

const sceneFor = ({profile, index, layered, parallax, ambient, families}) => ({
  id: `${profile}-scene-${String(index + 1).padStart(2, '0')}`,
  label: `第 ${index + 1} 幕`,
  beat: `共同故事节拍 ${index + 1}`,
  characterActions: ['角色执行清晰可见的叙事动作'],
  stateFamilies: families,
  layers: {
    rear: layered ? ['远景'] : [],
    mid: ['主体'],
    front: layered ? ['近景'] : [],
    near: [],
  },
  sourcePackages: [
    {
      id: `${profile}-source-${index + 1}`,
      strategy: layered ? 'registered-layer-sheet' : 'single-background',
      providerCalls: 1,
      localDerivatives: layered ? 3 : 0,
      avoidedCalls: layered ? 3 : 0,
    },
  ],
  parallax,
  ambientElements: ambient ? ['飘动的叶片'] : [],
  localMotionTargets: [
    {targetId: `target-${index + 1}-1`, preset: 'drift'},
    {targetId: `target-${index + 1}-2`, preset: 'breathe'},
    {targetId: `target-${index + 1}-3`, preset: 'sway'},
  ],
});

const optionFor = ({
  id,
  storyScope,
  sceneCount,
  durationSeconds,
  familyCount,
  enhancementCount = 0,
}) => {
  const families = [
    ...Array.from({length: familyCount}, (_, index) => ({
      id: `family-${index + 1}`,
      necessity: 'required',
      states: ['state-1', 'state-2', 'state-3', 'state-4'],
    })),
    ...Array.from({length: enhancementCount}, (_, index) => ({
      id: `enhancement-${index + 1}`,
      necessity: 'enhancement',
      states: ['state-1', 'state-2', 'state-3', 'state-4'],
    })),
  ];
  const scenes = Array.from({length: sceneCount}, (_, index) =>
    sceneFor({
      profile: id,
      index,
      layered: true,
      parallax: true,
      ambient: true,
      families: index < families.length ? [families[index]] : [],
    }),
  );
  const closing = scenes.at(-1);
  const closingFamily = {
    id: 'closing-family',
    necessity: 'required',
    states: ['before', 'after'],
  };
  closing.stateFamilies = [...closing.stateFamilies, closingFamily];
  const distinctFamilies = new Set(
    scenes.flatMap(({stateFamilies}) => stateFamilies.map(({id: fid}) => fid)),
  ).size;
  const expected = 1 + sceneCount + distinctFamilies;
  return {
    id,
    storyScope,
    durationSeconds,
    sceneCount,
    estimatedNarrationSeconds: durationSeconds - 6,
    rationale: `${storyScope} 与 ${id} 深度匹配`,
    scenes,
    semanticActionCoverage: [
      {
        actionId: 'closing-change',
        sceneId: closing.id,
        targetId: 'closing-subject',
        execution: 'registered-state',
        stateRef: {poseFamilyId: closingFamily.id, stateId: 'after'},
        visibleResult: '主体在收尾处明确切换到 after 姿态。',
      },
    ],
    proposedImageAttemptLimit: expected + 2,
    providerRecommendation: {
      text: 'current-host-model',
      image: 'user-confirmed-image-provider',
      voice: 'user-confirmed-voice-provider',
    },
    costNote: '按预计图片调用数计。',
    factsAndRightsRisks: [],
    finalEffect: `${id} 的成片承诺`,
  };
};

const scenarioInput = () => ({
  requested: {durationSeconds: null, sceneCount: null},
  commonStory: {
    logline: '主体经历一次明确的状态变化。',
    audience: '一般观众',
    theme: '变化是可见的',
    ending: '主体停在新的状态上。',
    beats: ['起', '承', '转', '合'],
    semanticActions: [
      {
        id: 'closing-change',
        summary: '结尾必须看见主体切换到 after 姿态。',
        requiredExecution: 'registered-state',
      },
    ],
  },
  options: [
    optionFor({id: 'draft', storyScope: 'concise', sceneCount: 4, durationSeconds: 32, familyCount: 1}),
    optionFor({id: 'balanced', storyScope: 'standard', sceneCount: 6, durationSeconds: 54, familyCount: 2}),
    optionFor({
      id: 'full-depth',
      storyScope: 'expanded',
      sceneCount: 8,
      durationSeconds: 82,
      familyCount: 4,
      enhancementCount: 3,
    }),
  ],
});

test('an agent can go from scenarios to a confirmed concept without reading any schema', async () => {
  const catalog = await loadStyleCatalog({root: ROOT});
  const intake = confirmIntake({
    selection: {
      aspectRatio: '16:9',
      visualStylePreset: catalog.styles[0].id,
      parallaxPreference: 'auto',
    },
    catalog,
    at,
  });
  const slug = 'authoring-roundtrip';

  // Gate 1 — scenarios. Presets and strategies come from the same vocabulary
  // the compiler executes, so nothing planned here can be unexecutable later.
  const scenarios = buildPlanningScenarios({
    slug,
    intake,
    input: scenarioInput(),
    at,
  });

  // Gate 2 — plan. Re-selecting the same option is idempotent, so a decision
  // already copied downstream does not silently expire.
  const plan = buildCreativePlanFromScenario({
    slug,
    scenarios,
    optionId: 'balanced',
    at,
  });
  const replan = buildCreativePlanFromScenario({
    slug,
    scenarios,
    optionId: 'balanced',
    at: plan.scenarioBinding.selectedAt,
  });
  assert.deepEqual(replan, plan);

  const project = {
    slug,
    intake,
    video: {width: 1920, height: 1080, fps: 30},
    styleProfile: materializeStyleProfile(catalog, catalog.styles[0].id),
    plan,
  };

  // Gate 3 — storyboard. The scaffold is the only authoring input; filling its
  // prose markers must be sufficient to compile.
  const scaffold = buildStoryboardScaffold({project, scenarios});
  const filled = fillMarkers(scaffold);
  assert.deepEqual(findStoryboardTodoMarkers(filled), []);
  const storyboard = compileStoryboardDirecting(
    {
      ...filled,
      status: 'ready',
      sceneTransitions: materializeSceneTransitionRecipes(
        filled.sceneTransitions,
        project.styleProfile?.motion?.transitionSet,
      ),
      updatedAt: at,
    },
    {plan, styleProfile: project.styleProfile},
  );
  assert.deepEqual(
    validateStoryboard(storyboard, {slug, plan, styleProfile: project.styleProfile}),
    [],
  );

  // Gate 4 — concept. Every comparable decision comes from the scaffold.
  const selection = buildSelectionScaffold({
    project,
    scenarios,
    storyboard,
    capabilities: ['text', 'image', 'voice'],
  });
  assert.doesNotThrow(() =>
    assertConfirmedPlanDecision(selection.planDecision, plan),
  );
  assert.doesNotThrow(() =>
    assertScenarioDecision(selection.scenarioDecision, scenarios, 'balanced'),
  );
  assert.doesNotThrow(() =>
    assertSourcePackageDecision(
      selection.sourcePackageDecision,
      storyboard.directingSummary,
    ),
  );
  assert.equal(
    selection.budgetDecision.imageAttemptLimit,
    scenarioDecisionFor(scenarios, 'balanced').proposedImageAttemptLimit,
  );
});

test('decisions compare by value and name the offending field', () => {
  const directingSummary = {
    generationBudget: {
      requiredProviderImageCalls: 4,
      expectedProviderImageCalls: 6,
      poseSheetProviderCalls: 2,
      localDerivatives: 9,
      hardCeiling: 14,
      sourcePackagePlans: [],
    },
  };
  const canonical = sourcePackageDecisionFor(directingSummary);

  // Key order is an accident of hand-authoring, not a disagreement.
  const reordered = Object.fromEntries(
    Object.entries(canonical).reverse(),
  );
  assert.doesNotThrow(() =>
    assertSourcePackageDecision(reordered, directingSummary),
  );

  // Copying the whole generationBudget is the mistake that blocked a real run;
  // the error has to name every extra key, not just say "must match".
  assert.throws(
    () =>
      assertSourcePackageDecision(
        directingSummary.generationBudget,
        directingSummary,
      ),
    (error) =>
      error.message.includes('poseSheetProviderCalls') &&
      error.message.includes('localDerivatives') &&
      error.message.includes('--scaffold'),
  );

  assert.throws(
    () =>
      assertSourcePackageDecision(
        {...canonical, hardCeiling: 99},
        directingSummary,
      ),
    /hardCeiling: expected 14, received 99/,
  );
});

test('a workspace target holding only OS metadata is still initializable', async () => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const {execFile} = await import('node:child_process');
  const {promisify} = await import('node:util');
  const run = promisify(execFile);
  const script = path.join(
    ROOT,
    'plugins/paper-collage-video/scripts/bootstrap-workspace.mjs',
  );
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'paper-collage-bootstrap-'));
  try {
    await fs.writeFile(path.join(directory, '.DS_Store'), 'finder');
    const {stdout} = await run('node', [script, `--target=${directory}`, '--status-json']);
    assert.equal(JSON.parse(stdout).target, directory);

    // Real user content still blocks, and the refusal names it.
    await fs.writeFile(path.join(directory, 'my-notes.txt'), 'keep me');
    await assert.rejects(
      run('node', [script, `--target=${directory}`, '--status-json']),
      (error) => error.stderr.includes('my-notes.txt'),
    );
  } finally {
    await fs.rm(directory, {recursive: true, force: true});
  }
});

test('--help prints usage and exits zero instead of reporting a failure', async () => {
  const {execFile} = await import('node:child_process');
  const {promisify} = await import('node:util');
  const run = promisify(execFile);
  for (const command of [
    'project-scenarios.mjs',
    'project-storyboard.mjs',
    'project-confirm-concept.mjs',
    'project-storyboard-scaffold.mjs',
  ]) {
    const {stdout, stderr} = await run('node', [
      path.join(ROOT, 'scripts', command),
      '--help',
    ]);
    assert.match(stdout, /^用法：/);
    assert.equal(stderr, '');
  }
});

// The scenario card and the storyboard budget count on different bases. That is
// intentional, but it is also what makes hand-reconciling them fail, so the
// documented asymmetry is pinned here.
test('scenario and storyboard call counts use their documented bases', async () => {
  const catalog = await loadStyleCatalog({root: ROOT});
  const intake = confirmIntake({
    selection: {
      aspectRatio: '16:9',
      visualStylePreset: catalog.styles[0].id,
      parallaxPreference: 'auto',
    },
    catalog,
    at,
  });
  const scenarios = buildPlanningScenarios({
    slug: 'call-accounting',
    intake,
    input: scenarioInput(),
    at,
  });
  const option = scenarios.options.find(({id}) => id === 'balanced');
  const estimate = option.providerEstimate;

  // Scenario side: the single style sample is inside expectedImageCalls.
  assert.equal(estimate.styleProofProviderCalls, 1);
  assert.equal(
    estimate.expectedImageCalls,
    estimate.styleProofProviderCalls +
      estimate.sourcePackageProviderCalls +
      estimate.poseSheetProviderCalls,
  );

  const plan = buildCreativePlanFromScenario({
    slug: 'call-accounting',
    scenarios,
    optionId: 'balanced',
    at,
  });
  const project = {
    slug: 'call-accounting',
    intake,
    video: {width: 1920, height: 1080, fps: 30},
    styleProfile: materializeStyleProfile(catalog, catalog.styles[0].id),
    plan,
  };
  const filled = fillMarkers(buildStoryboardScaffold({project, scenarios}));
  const storyboard = compileStoryboardDirecting(
    {
      ...filled,
      status: 'ready',
      sceneTransitions: materializeSceneTransitionRecipes(
        filled.sceneTransitions,
        project.styleProfile?.motion?.transitionSet,
      ),
      updatedAt: at,
    },
    {plan, styleProfile: project.styleProfile},
  );
  const budget = storyboard.directingSummary.generationBudget;

  // Storyboard side: the style sample is not in the budget, and expected never
  // adds a reserve on top of required.
  assert.equal(
    budget.requiredProviderImageCalls,
    budget.sourcePackageProviderCalls + budget.poseSheetProviderCalls,
  );
  assert.equal(budget.expectedProviderImageCalls, budget.requiredProviderImageCalls);
  assert.equal(
    budget.expectedProviderImageCalls,
    estimate.expectedImageCalls - estimate.styleProofProviderCalls,
  );

  // Storyboard avoidedCalls covers layered packages only; the isolated-state
  // calls a pose sheet avoids are reported separately.
  assert.ok(storyboard.directingSummary.avoidedIsolatedStateCalls > 0);
  assert.equal(
    budget.avoidedCalls,
    budget.sourcePackagePlans.reduce((sum, plan) => sum + plan.avoidedCalls, 0),
  );
});
