import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STORY_BLUEPRINTS,
  summarizeStoryboard,
  validateStoryboard,
} from '../scripts/storyboard-lib.mjs';
import {proofOverlapsTransition} from '../scripts/project-lib.mjs';

const readyStoryboard = () => ({
  schemaVersion: 1,
  slug: 'rhythm-test',
  status: 'ready',
  arc: 'A clear setup, action, and resolution.',
  style: {
    visualThesis: 'Paper depth makes causality visible.',
    compositionRules: ['Keep the focal subject readable.'],
    motionLanguage: ['Establish, trigger, settle.'],
    layerStrategy: 'Separate environment, subject, and foreground paper.',
  },
  scenes: [
    {
      id: 'scene-01',
      title: 'The reveal',
      narrativeRole: 'setup',
      message: 'A subject enters a layered world.',
      blueprint: 'layered-reveal',
      estimatedDurationSeconds: 6,
      beats: [
        {id: 'establish', at: 0, purpose: 'place', visual: 'Empty paper world', motion: 'Reveal the scene', audioCue: null},
        {id: 'action', at: 0.48, purpose: 'act', visual: 'Subject rises', motion: 'Lift the subject', audioCue: 'paper lift'},
        {id: 'settle', at: 0.9, purpose: 'resolve', visual: 'Composition locks', motion: 'Settle the subject', audioCue: null},
      ],
      proofTimes: [
        {at: 0.08, label: 'World established', kind: 'establish'},
        {at: 0.5, label: 'Action peaks', kind: 'peak'},
        {at: 0.9, label: 'Composition resolves', kind: 'final'},
      ],
    },
  ],
  updatedAt: '2026-07-20T00:00:00.000Z',
});

const resolvedPlan = {
  status: 'resolved',
  resolved: {sceneCount: 1, durationSeconds: 6},
};

test('storyboard blueprints form a bounded authoring vocabulary', () => {
  assert.deepEqual(STORY_BLUEPRINTS, [
    'layered-reveal',
    'map-journey',
    'archive-stack',
    'character-procession',
    'discovery-wipe',
    'transformation-tableau',
    'chapter-tableau',
    'quiet-lockup',
  ]);
});

test('ready storyboards require ordered beats, final proof, and plan alignment', () => {
  const storyboard = readyStoryboard();
  assert.deepEqual(
    validateStoryboard(storyboard, {slug: 'rhythm-test', plan: resolvedPlan}),
    [],
  );
  const summary = summarizeStoryboard(storyboard);
  assert.equal(summary.sceneCount, 1);
  assert.deepEqual(summary.scenes[0], {
    id: 'scene-01',
    title: 'The reveal',
    narrativeRole: 'setup',
    blueprint: 'layered-reveal',
    beatCount: 3,
    proofCount: 3,
  });

  const invalid = readyStoryboard();
  invalid.scenes[0].beats[1].at = 0;
  invalid.scenes[0].proofTimes[2] = {
    at: 0.7,
    label: 'Too early',
    kind: 'final',
  };
  const issues = validateStoryboard(invalid, {
    slug: 'rhythm-test',
    plan: resolvedPlan,
  });
  assert.ok(issues.some(({code}) => code === 'storyboard-beat-time'));
  assert.ok(issues.some(({code}) => code === 'storyboard-final-proof'));
});

test('storyboard duration and scene count cannot drift from the resolved plan', () => {
  const storyboard = readyStoryboard();
  storyboard.scenes[0].estimatedDurationSeconds = 4;
  const issues = validateStoryboard(storyboard, {
    slug: 'rhythm-test',
    plan: {status: 'resolved', resolved: {sceneCount: 2, durationSeconds: 8}},
  });
  assert.ok(issues.some(({code}) => code === 'storyboard-scene-count'));
  assert.ok(issues.some(({code}) => code === 'storyboard-duration-total'));
});

test('motion proof moments cannot be hidden inside fade transitions', () => {
  assert.equal(
    proofOverlapsTransition({at: 0.08, transitionFrames: 12, durationInFrames: 300}),
    false,
  );
  assert.equal(
    proofOverlapsTransition({at: 0.95, transitionFrames: 30, durationInFrames: 300}),
    true,
  );
});
