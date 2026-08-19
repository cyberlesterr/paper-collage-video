import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildStoryboardScaffold,
  findStoryboardTodoMarkers,
  scaffoldCompletionChecklist,
  storyboardTodoMarker,
} from '../scripts/storyboard-scaffold-lib.mjs';

const fixtureProject = () => ({
  slug: 'scaffold-fixture',
  intake: {aspectRatio: '9:16'},
  video: {width: 1080, height: 1920, fps: 30},
  styleProfile: {
    id: 'paper',
    label: '纸艺拼贴',
    motion: {pacing: 'playful'},
    generation: {compositionPrinciples: ['规则一', '规则二']},
  },
  plan: {
    status: 'resolved',
    scenarioBinding: {
      optionId: 'balanced',
      optionFingerprint: 'f'.repeat(64),
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
          ambientElements: ['飘落树叶'],
          localMotionTargets: [{targetId: 'turtle-path', preset: 'translate'}],
        },
        {
          id: 'scene-02',
          label: '终点',
          beat: '乌龟先到终点。',
          characterActions: ['乌龟撞线'],
          stateFamilies: [],
          layers: {rear: ['终点拱门'], mid: [], front: [], near: []},
          sourcePackages: [],
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
  const treatmentIds = first.beats[0].treatments.map(({id}) => id);
  assert.ok(treatmentIds.includes('race-world-package-treatment'));
  assert.ok(treatmentIds.includes('turtle-walk-treatment'));
  assert.ok(treatmentIds.includes('turtle-path-treatment'));
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
