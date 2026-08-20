import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildStoryboardScaffold,
  findStoryboardTodoMarkers,
  scaffoldCompletionChecklist,
  storyboardTodoMarker,
} from '../scripts/storyboard-scaffold-lib.mjs';
import {
  compileStoryboardDirecting,
  validateStoryboard,
} from '../scripts/storyboard-lib.mjs';
import {materializeSceneTransitionRecipes} from '../src/sceneTimeline.mjs';

const fixtureProject = () => ({
  slug: 'scaffold-fixture',
  intake: {aspectRatio: '9:16'},
  video: {width: 1080, height: 1920, fps: 30},
  styleProfile: {
    id: 'paper',
    profileFingerprint: 'a'.repeat(64),
    label: '纸艺拼贴',
    motion: {pacing: 'playful', transitionSet: 'paper-story'},
    generation: {compositionPrinciples: ['规则一', '规则二']},
  },
  plan: {
    status: 'resolved',
    resolved: {durationSeconds: 60, sceneCount: 2},
    scenarioBinding: {
      optionId: 'balanced',
      optionFingerprint: 'f'.repeat(64),
    },
    profilePromise: {
      minRequiredStateFamilies: 1,
      minEnhancementStateFamilies: 0,
      minTotalStates: 2,
      minLocalMotionTargets: 1,
      minLayeredScenes: 1,
      minParallaxScenes: 1,
      minAmbientScenes: 1,
    },
  },
});

const fixtureScenarios = () => ({
  commonStory: {summary: '乌龟和兔子赛跑。'},
  options: [
    {id: 'draft', fingerprint: '0'.repeat(64), scenes: []},
    {
      id: 'balanced',
      fingerprint: 'f'.repeat(64),
      durationSeconds: 60,
      rationale: '两场标准节奏。',
      scenes: [
        {
          id: 'scene-01',
          label: '起跑',
          beat: '兔子领先，乌龟稳步穿越世界。',
          characterActions: ['乌龟侧面循环前进', '兔子跳跃超越'],
          stateFamilies: [
            {id: 'turtle-walk', necessity: 'required', states: ['step-a', 'step-b']},
          ],
          layers: {rear: ['远山'], mid: ['赛道'], front: ['草丛'], near: []},
          sourcePackages: [
            {id: 'race-world-package', strategy: 'registered-layer-sheet', providerCalls: 1},
          ],
          parallax: true,
          ambientElements: ['飘落树叶'],
          localMotionTargets: [{targetId: 'turtle-path', preset: 'drift'}],
        },
        {
          id: 'scene-02',
          label: '终点',
          beat: '乌龟先到终点。',
          characterActions: ['乌龟撞线'],
          stateFamilies: [],
          layers: {rear: ['终点拱门'], mid: [], front: [], near: []},
          sourcePackages: [
            {id: 'finish-plate', strategy: 'single-background', providerCalls: 1},
            {id: 'finish-master', strategy: 'rigid-master', providerCalls: 1},
          ],
          localMotionTargets: [],
        },
      ],
      semanticActionCoverage: [
        {
          actionId: 'steady-travel',
          sceneId: 'scene-01',
          targetId: 'turtle-group',
          execution: 'local-motion',
          visibleResult: '乌龟持续向前，没有滑步或倒退。',
        },
        {
          actionId: 'world-package',
          sceneId: 'scene-01',
          targetId: 'race-world',
          execution: 'layer-package',
          visibleResult: '赛道世界无拼接缝。',
        },
      ],
    },
  ],
});

test('storyboard scaffold pre-fills approved scenario data and marks creative gaps', () => {
  const scaffold = buildStoryboardScaffold({
    project: fixtureProject(),
    scenarios: fixtureScenarios(),
  });
  assert.equal(scaffold.schemaVersion, 12);
  assert.equal(scaffold.slug, 'scaffold-fixture');
  assert.equal(scaffold.status, 'pending');
  assert.match(scaffold.arc, /乌龟和兔子赛跑/);
  assert.deepEqual(scaffold.style.compositionRules, ['规则一', '规则二']);
  assert.equal(scaffold.motionDirection.pacing, 'playful');
  assert.equal(scaffold.motionDirection.ambient.strategy, 'selective');
  assert.equal(scaffold.editorial.timebase.fps, 30);
  assert.equal(scaffold.editorial.activeProfile, '9:16');
  assert.equal(scaffold.editorial.responsiveProfiles.length, 3);
  assert.equal(scaffold.scenes.length, 2);
  assert.equal(scaffold.sceneTransitions.length, 1);
  assert.equal(scaffold.sceneTransitions[0].fromSceneId, 'scene-01');
  assert.equal(scaffold.sceneTransitions[0].toSceneId, 'scene-02');
  const [first, second] = scaffold.scenes;
  assert.equal(first.title, '起跑');
  assert.equal(first.message, '兔子领先，乌龟稳步穿越世界。');
  assert.equal(first.estimatedDurationSeconds, 30);
  assert.equal(first.beats.length, 3);
  assert.equal(first.proofTimes.length, 3);
  const finalProof = first.proofTimes.at(-1);
  assert.equal(finalProof.kind, 'final');
  assert.ok(finalProof.at > 0.82);
  assert.ok(
    first.proofTimes[1].assertions.includes('乌龟持续向前，没有滑步或倒退。'),
  );
  const establishIds = first.beats[0].treatments.map(({id}) => id);
  const actionIds = first.beats[1].treatments.map(({id}) => id);
  assert.ok(establishIds.includes('scene-01-race-world-package-layers'));
  assert.ok(establishIds.includes('scene-01-turtle-walk-establish'));
  assert.ok(actionIds.includes('scene-01-turtle-walk-action'));
  assert.ok(actionIds.includes('scene-01-turtle-path-motion'));
  // Every beat carries at least one treatment, and ids are scene-prefixed so a
  // family reused across scenes cannot collide.
  assert.ok(
    scaffold.scenes.every((scene) =>
      scene.beats.every(({treatments}) => treatments.length > 0),
    ),
  );
  const allIds = scaffold.scenes.flatMap((scene) =>
    scene.beats.flatMap(({treatments}) => treatments.map(({id}) => id)),
  );
  assert.equal(new Set(allIds).size, allIds.length);
  assert.equal(second.beats.length, 3);
  const markers = findStoryboardTodoMarkers(scaffold);
  assert.ok(markers.length > 0);
  assert.ok(markers.includes('$.style.visualThesis'));
  assert.ok(markers.some((marker) => marker.startsWith('$.scenes[0].beats[0]')));
});

test('scaffold refuses a drifted or missing approved option', () => {
  const project = fixtureProject();
  assert.throws(
    () =>
      buildStoryboardScaffold({
        project: {
          ...project,
          plan: {
            ...project.plan,
            scenarioBinding: {optionId: 'missing', optionFingerprint: 'f'.repeat(64)},
          },
        },
        scenarios: fixtureScenarios(),
      }),
    /不存在已批准的 option/,
  );
  const drifted = fixtureScenarios();
  drifted.options[1].fingerprint = '1'.repeat(64);
  assert.throws(
    () => buildStoryboardScaffold({project, scenarios: drifted}),
    /指纹与 plan.scenarioBinding 不一致/,
  );
});

test('todo markers are located by JSON path and clean documents pass', () => {
  const document = {
    ok: 'ready text',
    pending: storyboardTodoMarker('fill me'),
    nested: {list: ['fine', storyboardTodoMarker('also me')]},
  };
  assert.deepEqual(findStoryboardTodoMarkers(document), [
    '$.pending',
    '$.nested.list[1]',
  ]);
  assert.deepEqual(findStoryboardTodoMarkers({clean: 'yes', n: 3}), []);
});

test('completion checklist dedupes inferred spatial-contract obligations', () => {
  const scaffold = buildStoryboardScaffold({
    project: fixtureProject(),
    scenarios: fixtureScenarios(),
  });
  const option = fixtureScenarios().options[1];
  option.semanticActionCoverage.push({...option.semanticActionCoverage[0]});
  const {markers, obligations} = scaffoldCompletionChecklist({scaffold, option});
  assert.equal(markers.length, findStoryboardTodoMarkers(scaffold).length);
  assert.equal(
    obligations.filter((line) => line.includes('turtle-group')).length,
    1,
  );
  assert.ok(obligations.some((line) => line.includes('race-world')));
});

// The generator's only real contract: fill in the prose and the compiler must
// accept it. Asserting that the scaffold "has all the fields" is what let a
// scaffold full of invalid enums ship.
test('a scaffold with its markers filled in compiles as a storyboard', () => {
  const project = fixtureProject();
  const scaffold = buildStoryboardScaffold({
    project,
    scenarios: fixtureScenarios(),
  });
  const fill = (value) => {
    if (typeof value === 'string') {
      return value.includes('TODO(author)') ? '作者补写的具体内容' : value;
    }
    if (Array.isArray(value)) return value.map(fill);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [key, fill(child)]),
      );
    }
    return value;
  };
  const filled = fill(scaffold);
  assert.deepEqual(findStoryboardTodoMarkers(filled), []);
  const authored = {
    ...filled,
    status: 'ready',
    sceneTransitions: materializeSceneTransitionRecipes(
      filled.sceneTransitions,
      project.styleProfile.motion.transitionSet,
    ),
    updatedAt: '2026-08-20T00:00:00.000Z',
  };
  const storyboard = compileStoryboardDirecting(authored, {
    plan: project.plan,
    styleProfile: project.styleProfile,
  });
  assert.deepEqual(
    validateStoryboard(storyboard, {
      slug: project.slug,
      plan: project.plan,
      styleProfile: project.styleProfile,
    }),
    [],
  );
  // The profile floors the scenario gate promised are met by construction.
  assert.equal(storyboard.directingSummary.profileFulfillment.passed, true);
});

// A static "it is still doing X" claim recorded as a stateAssertion cannot be
// executed: the execution layer resolves it to a state-sequence node needing at
// least two proven states. It used to pass the storyboard gate and only fail
// after the whole execution tree had been materialized, past the point where
// the storyboard could still be edited.
test('a state assertion with no state change in that scene is rejected at compile', () => {
  const project = fixtureProject();
  const scaffold = buildStoryboardScaffold({
    project,
    scenarios: fixtureScenarios(),
  });
  const fill = (value) => {
    if (typeof value === 'string') {
      return value.includes('TODO(author)') ? '作者补写的具体内容' : value;
    }
    if (Array.isArray(value)) return value.map(fill);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [key, fill(child)]),
      );
    }
    return value;
  };
  const filled = fill(scaffold);
  filled.scenes[0].proofTimes[1].stateAssertions = [
    ...filled.scenes[0].proofTimes[1].stateAssertions,
    {nodeId: 'sheep-flock', stateId: 'grazing'},
  ];
  const storyboard = compileStoryboardDirecting(
    {
      ...filled,
      status: 'ready',
      sceneTransitions: materializeSceneTransitionRecipes(
        filled.sceneTransitions,
        project.styleProfile.motion.transitionSet,
      ),
      updatedAt: '2026-08-21T00:00:00.000Z',
    },
    {plan: project.plan, styleProfile: project.styleProfile},
  );
  const issues = validateStoryboard(storyboard, {
    slug: project.slug,
    plan: project.plan,
    styleProfile: project.styleProfile,
  });
  const reported = issues.find(
    ({code}) => code === 'storyboard-proof-state-without-sequence',
  );
  assert.ok(reported, '应当报出没有状态切换的状态证明');
  assert.match(reported.message, /sheep-flock/);
  // The message has to name the fix, not just the violation.
  assert.match(reported.message, /文字断言/);
});

// The scaffold must not author the shape it just taught the compiler to reject.
test('scaffold skips state sequences for families planned with a single state', () => {
  const scenarios = fixtureScenarios();
  scenarios.options[1].scenes[0].stateFamilies.push({
    id: 'sheep-flock',
    necessity: 'required',
    states: ['grazing'],
  });
  const scaffold = buildStoryboardScaffold({
    project: fixtureProject(),
    scenarios,
  });
  const first = scaffold.scenes[0];
  const treatmentIds = first.beats.flatMap(({treatments}) =>
    treatments.map(({id}) => id),
  );
  assert.ok(!treatmentIds.some((id) => id.includes('sheep-flock')));
  const asserted = first.proofTimes.flatMap(({stateAssertions}) =>
    stateAssertions.map(({nodeId}) => nodeId),
  );
  assert.ok(!asserted.includes('sheep-flock-node'));
  assert.ok(asserted.includes('turtle-walk-node'));
});
