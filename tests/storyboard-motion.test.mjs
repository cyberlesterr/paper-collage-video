import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STORY_BLUEPRINTS,
  compileStoryboardDirecting as compileStoryboardDirectingBase,
  summarizeStoryboard,
  validateStoryboard,
} from '../scripts/storyboard-lib.mjs';
import {buildCreativePlan} from '../scripts/creative-plan-lib.mjs';
import {
  selectStyleProofTarget,
  stateSheetGridForCount,
  validateDirectingExecution,
} from '../scripts/motion-treatment-lib.mjs';
import {
  proofOverlapsTransition,
  stateSequenceMatchesStoryboardPlan,
} from '../scripts/project-lib.mjs';
import {createEditorialFixture} from '../fixtures/editorial-fixture.mjs';
import {
  createMotionDirectionFixture,
  FIXTURE_STYLE_PROFILE,
} from '../fixtures/motion-contract-fixture.mjs';

const compileStoryboardDirecting = (storyboard, options = {}) =>
  compileStoryboardDirectingBase(storyboard, {
    ...options,
    styleProfile: FIXTURE_STYLE_PROFILE,
  });

const plan = (profile = 'balanced') => buildCreativePlan({
  slug: 'rhythm-test',
  durationSeconds: 6,
  sceneCount: 1,
  productionProfile: profile,
  rationale: 'test',
  at: '2026-07-20T00:00:00.000Z',
});

const staticTreatment = ({id, targetId = 'subject', proofTimeId = null}) => ({
  id,
  targetId,
  importance: 'supporting',
  necessity: 'required',
  changeClass: 'static-hold',
  motion: {kind: 'static'},
  composition: {pattern: 'free'},
  graphic: null,
  semanticRisk: 'decorative',
  proofTimeId,
  rationale: 'A still hold keeps this beat readable.',
});

const bindCompiledSoundEffects = (scene, storyboardScene) => {
  scene.events ??= [];
  for (const planned of storyboardScene.compositionPlan?.soundEffects ?? []) {
    const event =
      scene.events.find(
        (candidate) =>
          candidate.beatId === planned.beatId &&
          Math.abs(candidate.at - planned.at) <= 0.035,
      ) ??
      {
        id: `fixture-${planned.id}`,
        beatId: planned.beatId,
        targetId: planned.targetId,
        at: planned.at,
        proofTimeId: planned.proofTimeId,
        visual: null,
      };
    event.sound = {
      src: planned.output.replace(/^public\//, ''),
      volume: 1,
    };
    if (!scene.events.includes(event)) scene.events.push(event);
  }
};

test('state-sheet grids always provide enough cells through the 12-state ceiling', () => {
  assert.deepEqual(stateSheetGridForCount(1), {columns: 2, rows: 2});
  assert.deepEqual(stateSheetGridForCount(4), {columns: 2, rows: 2});
  assert.deepEqual(stateSheetGridForCount(5), {columns: 3, rows: 2});
  assert.deepEqual(stateSheetGridForCount(6), {columns: 3, rows: 2});
  assert.deepEqual(stateSheetGridForCount(7), {columns: 4, rows: 2});
  assert.deepEqual(stateSheetGridForCount(8), {columns: 4, rows: 2});
  assert.deepEqual(stateSheetGridForCount(9), {columns: 3, rows: 3});
  assert.deepEqual(stateSheetGridForCount(10), {columns: 4, rows: 3});
  assert.deepEqual(stateSheetGridForCount(12), {columns: 4, rows: 3});
  assert.throws(() => stateSheetGridForCount(0), /1\.\.12/);
  assert.throws(() => stateSheetGridForCount(13), /1\.\.12/);
});

const authoredStoryboard = () => ({
  schemaVersion: 12,
  slug: 'rhythm-test',
  status: 'ready',
  arc: 'A clear setup, action, and resolution.',
  style: {
    visualThesis: 'Paper depth makes causality visible.',
    compositionRules: ['Keep the focal subject readable.'],
    layerStrategy: 'Separate environment, subject, and foreground paper.',
  },
  motionDirection: createMotionDirectionFixture(),
  scenes: [
    {
      id: 'scene-01',
      title: 'The reveal',
      narrativeRole: 'setup',
      message: 'A subject enters a layered world.',
      blueprint: 'layered-reveal',
      estimatedDurationSeconds: 6,
      beats: [
        {
          id: 'establish', at: 0, performanceRole: 'establish', purpose: 'place', visual: 'Empty paper world', soundCue: null, proofTimeId: 'proof-establish',
          treatments: [staticTreatment({id: 'hold-stage', targetId: 'stage', proofTimeId: 'proof-establish'})],
        },
        {
          id: 'action', at: 0.48, performanceRole: 'action', purpose: 'act', visual: 'Subject lands on stage', soundCue: 'paper lift', proofTimeId: 'proof-action',
          treatments: [{
            id: 'land-on-stage',
            targetId: 'subject',
            importance: 'hero',
            necessity: 'required',
            changeClass: 'contact-change',
            motion: {kind: 'static'},
            composition: {
              pattern: 'supported-subject',
              relationship: {id: 'subject-on-stage', predicate: 'on', object: 'stage', proof: 'The subject visibly contacts the stage'},
            },
            graphic: null,
            semanticRisk: 'topology',
            proofTimeId: 'proof-action',
            rationale: 'Contact must remain intact while the stage moves.',
          }],
        },
        {
          id: 'settle', at: 0.9, performanceRole: 'settle', purpose: 'resolve', visual: 'Composition locks', soundCue: null, proofTimeId: 'proof-final',
          treatments: [staticTreatment({id: 'hold-final', proofTimeId: 'proof-final'})],
        },
      ],
      proofTimes: [
        {id: 'proof-establish', at: 0.08, label: 'World established', kind: 'establish', assertions: ['The stage is readable'], stateAssertions: []},
        {id: 'proof-action', at: 0.5, label: 'Action peaks', kind: 'peak', assertions: ['The subject contacts the stage'], stateAssertions: []},
        {id: 'proof-final', at: 0.9, label: 'Composition resolves', kind: 'final', assertions: ['The final relationship is stable'], stateAssertions: []},
      ],
    },
  ],
  editorial: createEditorialFixture({
    sceneIds: ['scene-01'],
    durationSeconds: 6,
  }),
  sceneTransitions: [],
  updatedAt: '2026-07-20T00:00:00.000Z',
});

const readyStoryboard = (profile = 'balanced') =>
  compileStoryboardDirecting(authoredStoryboard(), {plan: plan(profile)});

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

test('v12 compiles treatments into motion/composition plans, risk selection, source packages, and cost evidence', () => {
  const storyboard = readyStoryboard();
  assert.deepEqual(validateStoryboard(storyboard, {slug: 'rhythm-test', plan: plan()}), []);
  assert.deepEqual(storyboard.scenes[0].compositionPlan.patterns, ['free', 'supported-subject']);
  assert.equal(storyboard.scenes[0].compositionPlan.relationships[0].predicate, 'on');
  assert.match(storyboard.scenes[0].directing.fingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(selectStyleProofTarget(storyboard), {
    sceneId: 'scene-01',
    treatmentId: 'land-on-stage',
    targetId: 'subject',
    proofTimeId: 'proof-action',
    riskScore: 46,
    directingFingerprint: storyboard.scenes[0].directing.fingerprint,
    sourceFamilyKey: 'target:subject',
    coverage: ['relationship:coupled', 'relationship:supported-subject', 'semantic:topology'],
  });

  const summary = summarizeStoryboard(storyboard);
  assert.equal(summary.sceneCount, 1);
  assert.equal(summary.scenes[0].treatmentCount, 3);
  assert.equal(summary.directing.estimatedPoseSheetCalls, 0);
  assert.equal(summary.directing.styleProofPlan.targets[0].treatmentId, 'land-on-stage');
});

test('v10 compiles one registered depth stack before provider approval', () => {
  const authored = authoredStoryboard();
  authored.scenes[0].beats[1].treatments[0] = {
    ...authored.scenes[0].beats[1].treatments[0],
    id: 'boat-layer-package',
    targetId: 'boat-stack',
    changeClass: 'depth-layer-separation',
    motion: {kind: 'continuous-transform', preset: 'drift'},
    composition: {
      pattern: 'registered-depth-stack',
      motionCapability: 'bounded-relative',
      sourcePackageId: 'boat-waves-package',
      sourceStrategy: 'registered-layer-sheet',
      layers: [
        {
          id: 'rear',
          role: 'support-rear',
          completeness: 'clean-plate',
          depth: -0.7,
        },
        {
          id: 'boat',
          role: 'subject',
          completeness: 'full-silhouette',
          depth: 0,
        },
        {
          id: 'front',
          role: 'support-front',
          completeness: 'full-overlay',
          depth: 0.7,
        },
      ],
      revealEnvelope: {
        '16:9': {x: 0.04, y: 0.03, scale: 0.05, rotationDegrees: 2},
        '9:16': {x: 0.02, y: 0.04, scale: 0.04, rotationDegrees: 1},
        '1:1': {x: 0.03, y: 0.03, scale: 0.04, rotationDegrees: 1},
      },
      subjectTravelEnvelope: {
        '16:9': {x: 0.58, y: 0.32, scale: 0.3, rotationDegrees: 12},
        '9:16': {x: 0.42, y: 0.4, scale: 0.28, rotationDegrees: 10},
        '1:1': {x: 0.48, y: 0.36, scale: 0.28, rotationDegrees: 10},
      },
    },
    semanticRisk: 'topology',
    rationale: 'The three complete registered layers may move only inside their proven responsive reveal envelope.',
  };
  const storyboard = compileStoryboardDirecting(authored, {
    plan: plan('draft'),
  });
  const [layerPlan] =
    storyboard.scenes[0].compositionPlan.layerStacks;
  assert.equal(layerPlan.id, 'boat-waves-package');
  assert.equal(layerPlan.providerImageCalls, 1);
  assert.equal(layerPlan.subjectTravelEnvelope['16:9'].x, 0.58);
  assert.equal(
    storyboard.directingSummary.generationBudget
      .requiredProviderImageCalls,
    1,
  );
  assert.equal(
    storyboard.directingSummary.generationBudget.hardCeiling,
    6,
  );
});

test('v10 compiles one horizontal looping world with compiler-owned strip roles and proof bindings', () => {
  const authored = authoredStoryboard();
  authored.scenes[0].beats[1].treatments[0] = {
    ...authored.scenes[0].beats[1].treatments[0],
    id: 'road-world-travel',
    targetId: 'road-world',
    changeClass: 'world-travel',
    motion: {kind: 'continuous-transform', preset: 'scroll-world-x'},
    composition: {
      pattern: 'looping-environment',
      world: {
        axis: 'x',
        direction: 'left',
        distanceViewports: 8,
        speedRange: {far: 0.18, near: 1.2},
        groundStripId: 'road-strip',
        subjectBindings: [{
          nodeId: 'paper-car',
          role: 'tracked',
          anchorMode: 'screen',
          nearOcclusion: 'behind-near',
          proofTimeIds: ['proof-establish', 'proof-action', 'proof-final'],
        }],
        seamProofTimeIds: {
          before: 'proof-establish',
          seam: 'proof-action',
          after: 'proof-final',
        },
        closedLoop: false,
        startPhase: 0.12,
        activeFrom: 0.2,
        strips: [
          {id: 'mountain-strip', role: 'far', surfaceRole: 'backdrop', depth: -0.85},
          {id: 'tree-strip', role: 'mid', surfaceRole: 'scenery', depth: -0.2},
          {id: 'road-strip', role: 'ground', surfaceRole: 'walkable-ground', depth: 0.4},
          {id: 'grass-strip', role: 'near', surfaceRole: 'foreground-occluder', depth: 0.9},
        ],
      },
    },
    semanticRisk: 'decorative',
    rationale: 'The tracked car stays readable while a seamless paper world moves past it at depth-relative speeds.',
  };
  const storyboard = compileStoryboardDirecting(authored, {plan: plan()});
  const [world] = storyboard.scenes[0].compositionPlan.loopingEnvironments;
  assert.equal(world.targetId, 'road-world');
  assert.deepEqual(world.subjectBindings, [{
    nodeId: 'paper-car',
    role: 'tracked',
    anchorMode: 'screen',
    nearOcclusion: 'behind-near',
    proofTimeIds: ['proof-establish', 'proof-action', 'proof-final'],
  }]);
  assert.equal(world.activeFrom, 0.2);
  assert.deepEqual(world.seamProofTimeIds, {
    before: 'proof-establish',
    seam: 'proof-action',
    after: 'proof-final',
  });
  assert.deepEqual(
    world.strips.map(({role}) => role),
    ['far', 'mid', 'ground', 'near'],
  );
  assert.ok(
    storyboard.directingSummary.styleProofPlan.requiredCoverage.includes(
      'motion:looping-world',
    ),
  );
  assert.ok(
    storyboard.directingSummary.styleProofPlan.requiredCoverage.includes(
      'proof:world-motion',
    ),
  );

  const frozenAuthored = structuredClone(authored);
  const frozenWorld = frozenAuthored.scenes[0].beats[1].treatments[0].composition.world;
  delete frozenWorld.activeFrom;
  frozenWorld.frozen = true;
  const frozenStoryboard = compileStoryboardDirecting(frozenAuthored, {plan: plan()});
  const [frozenPlan] = frozenStoryboard.scenes[0].compositionPlan.loopingEnvironments;
  assert.equal(frozenPlan.frozen, true);
  assert.deepEqual(validateStoryboard(frozenStoryboard, {slug: 'rhythm-test', plan: plan()}), []);
  const runtimeScene = {
    composition: {
      nodes: [{
        id: frozenPlan.targetId,
        kind: 'group',
        pattern: 'looping-environment',
        loopingEnvironment: {
          axis: frozenPlan.axis,
          groundStripId: frozenPlan.groundStripId,
          subjectBindings: frozenPlan.subjectBindings,
          seamProofTimeIds: frozenPlan.seamProofTimeIds,
          travel: {
            direction: frozenPlan.direction,
            distanceViewports: frozenPlan.distanceViewports,
            easing: 'linear',
            closedLoop: frozenPlan.closedLoop,
            startPhase: frozenPlan.startPhase,
            frozen: true,
          },
          speedRange: frozenPlan.speedRange,
          overscanPx: 2,
        },
        children: [
          ...frozenPlan.strips.map(({id, role, surfaceRole, depth}) => ({id, kind: 'world-strip', role, surfaceRole, depth})),
          {id: 'paper-car', kind: 'asset'},
        ],
      }],
    },
  };
  bindCompiledSoundEffects(runtimeScene, frozenStoryboard.scenes[0]);
  assert.deepEqual(validateDirectingExecution({scene: runtimeScene, storyboardScene: frozenStoryboard.scenes[0]}), []);
  runtimeScene.composition.nodes[0].loopingEnvironment.travel.frozen = false;
  assert.ok(validateDirectingExecution({scene: runtimeScene, storyboardScene: frozenStoryboard.scenes[0]})
    .some(({code}) => code === 'directing-looping-world-drift'));
});

test('traverse and bottom-pivot sway treatments require their runtime motion signatures', () => {
  const authored = authoredStoryboard();
  authored.scenes[0].beats[0].proofTimeId = 'proof-establish';
  authored.scenes[0].beats[0].treatments = [{
    ...staticTreatment({
      id: 'submarine-traverse',
      targetId: 'submarine',
      proofTimeId: 'proof-establish',
    }),
    changeClass: 'ambient-motion',
    motion: {kind: 'continuous-transform', preset: 'traverse'},
  }];
  authored.scenes[0].beats[1].treatments = [{
    ...staticTreatment({
      id: 'seaweed-sway',
      targetId: 'seaweed',
      proofTimeId: 'proof-action',
    }),
    changeClass: 'ambient-motion',
    motion: {kind: 'continuous-transform', preset: 'sway'},
  }];
  const storyboard = compileStoryboardDirecting(authored, {plan: plan()});
  assert.ok(
    storyboard.directingSummary.styleProofPlan.requiredCoverage.includes(
      'motion:subject-traverse',
    ),
  );
  assert.ok(
    storyboard.directingSummary.styleProofPlan.requiredCoverage.includes(
      'motion:bottom-pivot-sway',
    ),
  );
  const runtimeScene = {
    camera: {preset: 'static'},
    composition: {
      nodes: [
        {
          id: 'submarine',
          motion: {
            keyframes: [
              {at: 0, offsetX: -0.45, offsetY: 0.28},
              {at: 1, offsetX: 0.45, offsetY: -0.28},
            ],
          },
        },
        {
          id: 'seaweed',
          motion: {
            keyframes: [{at: 0, rotation: 0}, {at: 1, rotation: 0}],
            idle: {preset: 'sway', intensity: 1, cycleSeconds: 3},
            pivot: {x: 0.5, y: 1},
          },
        },
      ],
    },
  };
  bindCompiledSoundEffects(runtimeScene, storyboard.scenes[0]);
  assert.deepEqual(validateDirectingExecution({
    scene: runtimeScene,
    storyboardScene: storyboard.scenes[0],
  }), []);
  runtimeScene.composition.nodes[0].motion.keyframes[1].offsetX = -0.2;
  runtimeScene.composition.nodes[0].motion.keyframes[1].offsetY = 0.2;
  assert.ok(validateDirectingExecution({
    scene: runtimeScene,
    storyboardScene: storyboard.scenes[0],
  }).some(({code}) => code === 'directing-traverse-span'));
});

test('scene-stacked depth stacks satisfy carrier motion through moving registered children', () => {
  const storyboardScene = {
    compositionPlan: {
      continuousMotions: [{
        id: 'stack-drift',
        nodeId: 'depth-stack',
        preset: 'drift',
        at: 0,
        proofTimeId: 'proof-establish',
      }],
    },
  };
  const runtimeScene = {
    composition: {
      nodes: [{
        id: 'depth-stack',
        kind: 'group',
        pattern: 'registered-depth-stack',
        stackingContext: 'scene',
        motion: {
          keyframes: [{at: 0, offsetX: 0}, {at: 1, offsetX: 0}],
        },
        children: [{
          id: 'rear',
          kind: 'asset',
          motion: {
            keyframes: [{at: 0, offsetX: -0.01}, {at: 1, offsetX: 0.01}],
          },
        }],
      }],
    },
  };
  assert.deepEqual(
    validateDirectingExecution({scene: runtimeScene, storyboardScene}),
    [],
  );
  runtimeScene.composition.nodes[0].children[0].motion.keyframes[1].offsetX = -0.01;
  assert.ok(
    validateDirectingExecution({scene: runtimeScene, storyboardScene})
      .some(({code}) => code === 'directing-continuous-drift'),
  );
});

test('style proof planning covers semantic, coupled, and state risks with the fewest source families', () => {
  const authored = authoredStoryboard();
  authored.scenes[0].beats[0].proofTimeId = 'proof-establish';
  authored.scenes[0].beats[0].treatments = [{
    id: 'butterfly-folded',
    targetId: 'butterfly',
    importance: 'hero',
    necessity: 'required',
    changeClass: 'pose-change',
    motion: {kind: 'state-sequence', poseFamilyId: 'butterfly-flight', stateId: 'folded', facing: 'right', visualChange: 'Wings folded', playback: 'once', transition: 'cut'},
    composition: {pattern: 'supported-subject', relationship: {id: 'butterfly-on-flower', predicate: 'on', object: 'flower', proof: 'Butterfly remains registered to the flower'}},
    graphic: null,
    semanticRisk: 'topology',
    proofTimeId: 'proof-establish',
    rationale: 'The first registered state establishes the coupled family.',
  }];
  authored.scenes[0].beats[1].treatments = [{
    ...authored.scenes[0].beats[0].treatments[0],
    id: 'butterfly-open',
    motion: {...authored.scenes[0].beats[0].treatments[0].motion, stateId: 'open', visualChange: 'Wings open'},
    proofTimeId: 'proof-action',
  }];
  authored.scenes[0].beats[2].proofTimeId = 'proof-final';
  authored.scenes[0].beats[2].treatments = [{
    ...staticTreatment({id: 'diagram-lockup', targetId: 'diagram', proofTimeId: 'proof-final'}),
    importance: 'hero',
    semanticRisk: 'diagram',
    rationale: 'The final diagram must remain readable.',
  }];
  const storyboard = compileStoryboardDirecting(authored, {plan: plan()});
  const stylePlan = storyboard.directingSummary.styleProofPlan;
  assert.deepEqual(stylePlan.requiredCoverage, [
    'motion:state-sequence',
    'relationship:coupled',
    'relationship:supported-subject',
    'semantic:diagram',
  ]);
  assert.deepEqual(stylePlan.targets.map(({treatmentId}) => treatmentId), [
    'butterfly-folded',
    'diagram-lockup',
  ]);
  assert.deepEqual(stylePlan.sourceFamilyKeys, [
    'pose-family:butterfly-flight',
    'target:diagram',
  ]);
});

test('style proof planning keeps one representative target for a low-risk free composition', () => {
  const input = authoredStoryboard();
  input.scenes[0].beats = input.scenes[0].beats.map((beat, index) => ({
    ...beat,
    treatments: [{
      ...staticTreatment({
        id: `quiet-${index}`,
        targetId: index === 1 ? 'hero' : 'stage',
        proofTimeId: beat.proofTimeId,
      }),
      importance: index === 1 ? 'hero' : 'supporting',
    }],
  }));
  const storyboard = compileStoryboardDirecting(
    input,
    {plan: plan()},
  );
  assert.deepEqual(
    storyboard.directingSummary.styleProofPlan.requiredCoverage,
    ['baseline:representative'],
  );
  assert.equal(storyboard.directingSummary.styleProofPlan.targets.length, 1);
  assert.equal(
    storyboard.directingSummary.styleProofPlan.targets[0].coverage[0],
    'baseline:representative',
  );
});

test('compiled composition plans and fingerprints cannot drift from treatments', () => {
  const storyboard = readyStoryboard();
  storyboard.scenes[0].compositionPlan.patterns = ['free'];
  storyboard.scenes[0].directing.fingerprint = '0'.repeat(64);
  const issues = validateStoryboard(storyboard, {slug: 'rhythm-test', plan: plan()});
  assert.ok(issues.some(({code}) => code === 'storyboard-composition-plan-drift'));
  assert.ok(issues.some(({code}) => code === 'storyboard-directing-drift'));
});

test('routing rejects pose changes that are disguised as cheap transforms', () => {
  const authored = authoredStoryboard();
  authored.scenes[0].beats[1].treatments[0] = {
    ...authored.scenes[0].beats[1].treatments[0],
    changeClass: 'pose-change',
    motion: {kind: 'continuous-transform', preset: 'bounce'},
  };
  assert.throws(
    () => compileStoryboardDirecting(authored, {plan: plan()}),
    /pose-change 必须路由为 state-sequence/,
  );
});

test('question marks and circles route to editable graphics without pose-sheet cost', () => {
  const authored = authoredStoryboard();
  authored.scenes[0].beats[1].treatments = [{
    id: 'bounce-question-mark',
    targetId: 'question-mark',
    importance: 'supporting',
    necessity: 'enhancement',
    changeClass: 'graphic-emphasis',
    motion: {kind: 'continuous-transform', preset: 'bounce'},
    composition: {pattern: 'free'},
    graphic: {kind: 'shape', animation: 'bounce', role: 'generic'},
    semanticRisk: 'decorative',
    proofTimeId: 'proof-action',
    rationale: 'A live shape is cheaper and sharper than a new character pose.',
  }];
  const storyboard = compileStoryboardDirecting(authored, {plan: plan()});
  assert.deepEqual(storyboard.scenes[0].compositionPlan.graphics, [{
    id: 'bounce-question-mark',
    beatId: 'action',
    nodeId: 'question-mark',
    kind: 'shape',
    animation: 'bounce',
    role: 'generic',
    at: 0.48,
    proofTimeId: 'proof-action',
  }]);
  assert.equal(storyboard.directingSummary.estimatedPoseSheetCalls, 0);
  assert.equal(storyboard.directingSummary.continuousTargets, 1);
  const runtimeScene = {
    camera: {preset: 'static'},
    composition: {nodes: [{
      id: 'question-mark', kind: 'shape',
      motion: {keyframes: [{at: 0, offsetY: 0}, {at: 1, offsetY: -0.04}]},
    }]},
  };
  bindCompiledSoundEffects(runtimeScene, storyboard.scenes[0]);
  assert.deepEqual(validateDirectingExecution({
    scene: runtimeScene,
    storyboardScene: storyboard.scenes[0],
  }), []);
  runtimeScene.composition.nodes[0].motion.keyframes[1].offsetY = 0;
  assert.ok(validateDirectingExecution({
    scene: runtimeScene,
    storyboardScene: storyboard.scenes[0],
  }).some(({code}) => code === 'directing-continuous-drift'));
});

test('visual sound effects compile as sparse audio-bound typography with a complete runtime lifecycle', () => {
  const authored = authoredStoryboard();
  authored.scenes[0].beats[1].soundCue = 'hard landing';
  authored.scenes[0].beats[1].treatments = [{
    id: 'landing-impact-sfx',
    targetId: 'landing-impact-text',
    importance: 'supporting',
    necessity: 'enhancement',
    changeClass: 'graphic-emphasis',
    motion: {kind: 'continuous-transform', preset: 'bounce'},
    composition: {pattern: 'free'},
    graphic: {
      kind: 'typography',
      animation: 'drop-impact',
      role: 'visual-sfx',
      sfxKind: 'impact',
      text: '咚！',
      durationSeconds: 0.45,
      audioBinding: 'beat-sound-cue',
    },
    semanticRisk: 'decorative',
    proofTimeId: 'proof-action',
    rationale: 'A single impact word reinforces the audible landing without becoming dialogue.',
  }];
  const storyboard = compileStoryboardDirecting(authored, {plan: plan()});
  const graphic = storyboard.scenes[0].compositionPlan.graphics[0];
  assert.deepEqual(graphic, {
    id: 'landing-impact-sfx',
    beatId: 'action',
    nodeId: 'landing-impact-text',
    kind: 'typography',
    animation: 'drop-impact',
    role: 'visual-sfx',
    sfxKind: 'impact',
    text: '咚！',
    durationSeconds: 0.45,
    audioBinding: 'beat-sound-cue',
    soundCue: 'hard landing',
    at: 0.48,
    proofTimeId: 'proof-action',
  });
  assert.ok(
    storyboard.directingSummary.styleProofPlan.requiredCoverage.includes(
      'graphic:visual-sfx',
    ),
  );

  const runtimeScene = {
    narration: {startSeconds: 0, durationSeconds: 6},
    tailSeconds: 0,
    composition: {
      nodes: [{
        id: 'landing-impact-text',
        kind: 'typography',
        role: 'visual-sfx',
        text: '咚！',
        visibility: {initial: 'hidden'},
        motion: {idle: {preset: 'bounce', intensity: 0.4}},
      }],
    },
    events: [
      {
        id: 'impact-show',
        beatId: 'action',
        targetId: 'landing-impact-text',
        at: 0.48,
        proofTimeId: 'proof-action',
        visual: {
          kind: 'visibility',
          action: 'show',
          transition: 'fade-scale',
          durationSeconds: 0.08,
        },
        sound: {cue: 'hard landing'},
      },
      {
        id: 'impact-emphasis',
        beatId: 'action',
        targetId: 'landing-impact-text',
        at: 0.48,
        proofTimeId: 'proof-action',
        visual: {
          kind: 'emphasis',
          action: 'drop-impact',
          durationSeconds: 0.2,
          intensity: 1,
        },
      },
      {
        id: 'impact-hide',
        beatId: 'action',
        targetId: 'landing-impact-text',
        at: 0.555,
        proofTimeId: 'proof-action',
        visual: {
          kind: 'visibility',
          action: 'hide',
          transition: 'fade-scale',
          durationSeconds: 0.08,
        },
      },
    ],
  };
  bindCompiledSoundEffects(runtimeScene, storyboard.scenes[0]);
  assert.deepEqual(validateDirectingExecution({
    scene: runtimeScene,
    storyboardScene: storyboard.scenes[0],
  }), []);

  delete runtimeScene.events[0].sound;
  assert.ok(validateDirectingExecution({
    scene: runtimeScene,
    storyboardScene: storyboard.scenes[0],
  }).some(({code}) => code === 'directing-visual-sfx-events'));
});

test('visibility changes compile to persistent events with an explicit initial state', () => {
  const authored = authoredStoryboard();
  authored.scenes[0].beats[1].treatments = [{
    id: 'show-subject',
    targetId: 'subject',
    importance: 'hero',
    necessity: 'required',
    changeClass: 'visibility-change',
    motion: {kind: 'visibility-transition', action: 'show', transition: 'fade-rise', durationSeconds: 0.5},
    composition: {pattern: 'free'},
    graphic: null,
    semanticRisk: 'decorative',
    proofTimeId: 'proof-action',
    rationale: 'The subject must be absent before the beat and remain visible afterwards.',
  }];
  const storyboard = compileStoryboardDirecting(authored, {plan: plan()});
  assert.deepEqual(storyboard.scenes[0].compositionPlan.visibilityEvents, [{
    id: 'show-subject',
    beatId: 'action',
    nodeId: 'subject',
    action: 'show',
    transition: 'fade-rise',
    durationSeconds: 0.5,
    at: 0.48,
    proofTimeId: 'proof-action',
  }]);
  assert.equal(storyboard.directingSummary.visibilityTargets, 1);
  const runtimeScene = {
    camera: {preset: 'static'},
    composition: {nodes: [{id: 'subject', kind: 'asset', visibility: {initial: 'hidden'}, motion: {keyframes: [{at: 0}, {at: 1}]}}]},
    events: [{id: 'subject-show', beatId: 'action', targetId: 'subject', at: 0.48, visual: {kind: 'visibility', action: 'show', transition: 'fade-rise', durationSeconds: 0.5}}],
  };
  bindCompiledSoundEffects(runtimeScene, storyboard.scenes[0]);
  assert.deepEqual(validateDirectingExecution({scene: runtimeScene, storyboardScene: storyboard.scenes[0]}), []);
  delete runtimeScene.composition.nodes[0].visibility;
  assert.ok(validateDirectingExecution({scene: runtimeScene, storyboardScene: storyboard.scenes[0]})
    .some(({code}) => code === 'directing-visibility-initial'));
});

test('parallax rigs and motif fields compile into first-class directing plans', () => {
  const authored = authoredStoryboard();
  authored.scenes[0].beats[0].proofTimeId = 'proof-establish';
  authored.scenes[0].beats[0].treatments = [{
    id: 'camera-depth-rig',
    targetId: 'scene-camera',
    importance: 'supporting',
    necessity: 'required',
    changeClass: 'depth-parallax',
    motion: {kind: 'continuous-transform', preset: 'parallax-camera'},
    composition: {pattern: 'free'},
    graphic: null,
    semanticRisk: 'decorative',
    proofTimeId: 'proof-establish',
    rationale: 'The camera must reveal deterministic depth between the paper planes.',
  }];
  authored.scenes[0].beats[1].treatments = [{
    id: 'petal-field-motion',
    targetId: 'petal-field',
    importance: 'ambient',
    necessity: 'enhancement',
    changeClass: 'decorative-field',
    motion: {
      kind: 'motif-field',
      preset: 'fall-drift',
      distribution: 'scattered',
      count: 18,
      cycles: 2,
      bounds: {x: 0.05, y: 0.08, width: 0.9, height: 0.82},
      exclusionZones: [{
        id: 'title-zone',
        shape: 'rectangle',
        x: 0.25,
        y: 0.3,
        width: 0.5,
        height: 0.4,
        padding: 0.02,
      }],
      worldBinding: {
        worldNodeId: 'travelling-world',
        stripRole: 'mid',
        relativeDriftAmplitude: 0.004,
      },
    },
    composition: {pattern: 'free'},
    graphic: null,
    semanticRisk: 'decorative',
    proofTimeId: 'proof-action',
    rationale: 'A bounded repeated field supplies editorial energy without generated video.',
  }];
  const storyboard = compileStoryboardDirecting(authored, {plan: plan()});
  assert.deepEqual(storyboard.scenes[0].compositionPlan.continuousMotions, [{
    id: 'camera-depth-rig',
    nodeId: 'scene-camera',
    preset: 'parallax-camera',
    at: 0,
    proofTimeId: 'proof-establish',
  }]);
  assert.deepEqual(storyboard.scenes[0].compositionPlan.motifFields, [{
    id: 'petal-field-motion',
    nodeId: 'petal-field',
    preset: 'fall-drift',
    distribution: 'scattered',
    count: 18,
    cycles: 2,
    bounds: {x: 0.05, y: 0.08, width: 0.9, height: 0.82},
    exclusionZones: [{
      id: 'title-zone',
      shape: 'rectangle',
      x: 0.25,
      y: 0.3,
      width: 0.5,
      height: 0.4,
      padding: 0.02,
    }],
    worldBinding: {
      worldNodeId: 'travelling-world',
      stripRole: 'mid',
      relativeDriftAmplitude: 0.004,
    },
    at: 0.48,
    proofTimeId: 'proof-action',
  }]);
  assert.equal(storyboard.directingSummary.motifFieldTargets, 1);
  assert.ok(storyboard.directingSummary.styleProofPlan.requiredCoverage.includes('motion:motif-field'));

  const runtimeScene = {
    camera: {
      preset: 'pan-right',
      parallax: {enabled: true, strength: 0.8, focalDepth: 0},
    },
    composition: {
      nodes: [
        {id: 'background', kind: 'asset', depth: -1, motion: {keyframes: [{at: 0}, {at: 1}]}},
        {
          id: 'petal-field',
          kind: 'motif-field',
          depth: 0.7,
          count: 18,
          distribution: 'scattered',
          fieldMotion: {preset: 'fall-drift', cycles: 2},
          bounds: {x: 0.05, y: 0.08, width: 0.9, height: 0.82},
          exclusionZones: [{
            id: 'title-zone',
            shape: 'rectangle',
            x: 0.25,
            y: 0.3,
            width: 0.5,
            height: 0.4,
            padding: 0.02,
          }],
          worldBinding: {
            worldNodeId: 'travelling-world',
            stripRole: 'mid',
            relativeDriftAmplitude: 0.004,
          },
          motion: {keyframes: [{at: 0}, {at: 1}]},
        },
      ],
    },
  };
  bindCompiledSoundEffects(runtimeScene, storyboard.scenes[0]);
  assert.deepEqual(validateDirectingExecution({
    scene: runtimeScene,
    storyboardScene: storyboard.scenes[0],
  }), []);
  runtimeScene.composition.nodes[1].count = 19;
  assert.ok(validateDirectingExecution({
    scene: runtimeScene,
    storyboardScene: storyboard.scenes[0],
  }).some(({code}) => code === 'directing-motif-drift'));
});

test('Cao Chong-style hero actions compile to one context-preserving pose sheet', () => {
  const authored = authoredStoryboard();
  const scene = authored.scenes[0];
  scene.beats[0].proofTimeId = 'proof-establish';
  scene.beats[0].treatments = [{
    id: 'cao-hold-book', targetId: 'cao', importance: 'hero', necessity: 'required',
    changeClass: 'pose-change',
    motion: {kind: 'state-sequence', poseFamilyId: 'cao-actions', stateId: 'holding-book', facing: 'right', visualChange: 'Cao holds the open book', playback: 'once', transition: 'cut'},
    composition: {pattern: 'free'}, graphic: null, semanticRisk: 'identity', proofTimeId: 'proof-establish', rationale: 'Start the hero pose family on the common canvas.',
  }];
  scene.beats[1].treatments = [{
    id: 'cao-point-board', targetId: 'cao', importance: 'hero', necessity: 'required',
    changeClass: 'pose-change',
    motion: {kind: 'state-sequence', poseFamilyId: 'cao-actions', stateId: 'pointing-board', facing: 'right', visualChange: 'Cao points at the board', playback: 'once', transition: 'cut'},
    composition: {pattern: 'free'}, graphic: null, semanticRisk: 'identity', proofTimeId: 'proof-action', rationale: 'A real limb change needs a registered state, not rotation.',
  }];
  scene.proofTimes[0].stateAssertions = [{nodeId: 'cao', stateId: 'holding-book'}];
  scene.proofTimes[1].stateAssertions = [{nodeId: 'cao', stateId: 'pointing-board'}];
  const storyboard = compileStoryboardDirecting(authored, {plan: plan('draft')});
  assert.equal(storyboard.scenes[0].compositionPlan.stateSequences.length, 1);
  assert.deepEqual(
    storyboard.scenes[0].compositionPlan.stateSequences[0].states.map(({id}) => id),
    ['holding-book', 'pointing-board'],
  );
  assert.equal(storyboard.directingSummary.estimatedPoseSheetCalls, 1);
  assert.equal(storyboard.directingSummary.avoidedIsolatedStateCalls, 1);
  assert.deepEqual(storyboard.directingSummary.poseSheetPlans, [{
    targetId: 'cao',
    targetIds: ['cao'],
    poseFamilyId: 'cao-actions',
    necessity: 'required',
    stateIds: ['holding-book', 'pointing-board'],
    stateFacings: [
      {stateId: 'holding-book', facing: 'right'},
      {stateId: 'pointing-board', facing: 'right'},
    ],
    grid: {columns: 2, rows: 2},
    providerCalls: 1,
    repairPolicy: 'masked-edit-complete-sheet',
  }]);
  assert.deepEqual(validateStoryboard(storyboard, {slug: 'rhythm-test', plan: plan('draft')}), []);
});

test('temporal instances that reuse one pose family consume one registered sheet', () => {
  const authored = authoredStoryboard();
  const scene = authored.scenes[0];
  const makeState = ({id, targetId, stateId, proofTimeId}) => ({
    id,
    targetId,
    importance: 'hero',
    necessity: 'required',
    changeClass: 'pose-change',
    motion: {
      kind: 'state-sequence',
      poseFamilyId: 'hare-actions',
      stateId,
      facing: 'right',
      visualChange: `${targetId} shows ${stateId}`,
      playback: 'once',
      transition: 'cut',
    },
    composition: {pattern: 'free'},
    graphic: null,
    semanticRisk: 'identity',
    proofTimeId,
    rationale: 'Temporal handoff reuses the same registered hare state sheet.',
  });
  scene.beats[0].proofTimeId = 'proof-establish';
  scene.beats[0].treatments = [
    makeState({id: 'hare-run', targetId: 'hare', stateId: 'run', proofTimeId: 'proof-establish'}),
    makeState({id: 'hare-chaser-run', targetId: 'hare-chaser', stateId: 'run', proofTimeId: 'proof-establish'}),
  ];
  scene.beats[1].treatments = [
    makeState({id: 'hare-sleep', targetId: 'hare', stateId: 'sleep', proofTimeId: 'proof-action'}),
    makeState({id: 'hare-chaser-concedes', targetId: 'hare-chaser', stateId: 'head-low', proofTimeId: 'proof-action'}),
  ];
  scene.proofTimes[0].stateAssertions = [
    {nodeId: 'hare', stateId: 'run'},
    {nodeId: 'hare-chaser', stateId: 'run'},
  ];
  scene.proofTimes[1].stateAssertions = [
    {nodeId: 'hare', stateId: 'sleep'},
    {nodeId: 'hare-chaser', stateId: 'head-low'},
  ];
  const storyboard = compileStoryboardDirecting(authored, {plan: plan('draft')});
  assert.equal(storyboard.scenes[0].compositionPlan.stateSequences.length, 2);
  assert.equal(storyboard.directingSummary.estimatedPoseSheetCalls, 1);
  assert.equal(storyboard.directingSummary.totalStateFamilies, 1);
  assert.deepEqual(storyboard.directingSummary.poseSheetPlans, [{
    targetId: 'hare',
    targetIds: ['hare', 'hare-chaser'],
    poseFamilyId: 'hare-actions',
    necessity: 'required',
    stateIds: ['head-low', 'run', 'sleep'],
    stateFacings: [
      {stateId: 'head-low', facing: 'right'},
      {stateId: 'run', facing: 'right'},
      {stateId: 'sleep', facing: 'right'},
    ],
    grid: {columns: 2, rows: 2},
    providerCalls: 1,
    repairPolicy: 'masked-edit-complete-sheet',
  }]);
  assert.deepEqual(validateStoryboard(storyboard, {slug: 'rhythm-test', plan: plan('draft')}), []);
});

test('project-level state-plan comparison checks the full playback contract', () => {
  const planned = {
    poseFamilyId: 'hare-actions',
    states: [{id: 'sleep', at: 0, facing: 'right'}, {id: 'run-a', at: 0.2, facing: 'right'}, {id: 'run-b', at: 0.4, facing: 'right'}],
    playback: {mode: 'loop', cycles: 3, activeFrom: 0.2, activeUntil: 0.8, holdStateId: 'sleep', activeStateIds: ['run-a', 'run-b']},
    transition: 'cut',
  };
  const actual = {
    poseFamilyId: 'hare-actions',
    states: structuredClone(planned.states),
    playback: structuredClone(planned.playback),
    transition: {type: 'cut', durationSeconds: 0},
  };
  assert.equal(stateSequenceMatchesStoryboardPlan(actual, planned), true);
  actual.playback.cycles = 2;
  assert.equal(stateSequenceMatchesStoryboardPlan(actual, planned), false);
});

test('state-family authoring compiles a held prelude and registered gait plan that runtime execution must match', () => {
  const authored = authoredStoryboard();
  const scene = authored.scenes[0];
  scene.beats[0].proofTimeId = 'proof-establish';
  scene.beats[2].proofTimeId = 'proof-final';
  const base = {
    targetId: 'hare',
    importance: 'hero',
    necessity: 'required',
    changeClass: 'pose-change',
    composition: {pattern: 'free'},
    graphic: null,
    semanticRisk: 'identity',
    rationale: 'The hare holds still before alternating two registered running poses.',
  };
  scene.beats[0].treatments = [{
    ...base,
    id: 'hare-sleep',
    proofTimeId: 'proof-establish',
    motion: {kind: 'state-sequence', poseFamilyId: 'hare-actions', stateId: 'sleep', facing: 'right', visualChange: 'Hare sleeps', playback: 'loop', transition: 'cut'},
  }];
  scene.beats[1].treatments = [{
    ...base,
    id: 'hare-stride-a',
    proofTimeId: 'proof-action',
    motion: {
      kind: 'state-sequence', poseFamilyId: 'hare-actions', stateId: 'stride-a', facing: 'right', visualChange: 'Left foreleg forward',
      playback: 'loop', transition: 'cut', cycles: 3, activeFrom: 0.48, activeStateIds: ['stride-a', 'stride-b'],
    },
  }];
  scene.beats[2].treatments = [{
    ...base,
    id: 'hare-stride-b',
    proofTimeId: 'proof-final',
    motion: {kind: 'state-sequence', poseFamilyId: 'hare-actions', stateId: 'stride-b', facing: 'right', visualChange: 'Right foreleg forward', playback: 'loop', transition: 'cut'},
  }];
  scene.proofTimes[0].stateAssertions = [{nodeId: 'hare', stateId: 'sleep'}];
  scene.proofTimes[1].stateAssertions = [{nodeId: 'hare', stateId: 'stride-a'}];
  scene.proofTimes[2].stateAssertions = [{nodeId: 'hare', stateId: 'stride-b'}];
  const storyboard = compileStoryboardDirecting(authored, {plan: plan('draft')});
  const [family] = storyboard.scenes[0].compositionPlan.stateSequences;
  assert.deepEqual(family.playback, {
    mode: 'loop', cycles: 3, activeFrom: 0.48, activeStateIds: ['stride-a', 'stride-b'],
  });
  assert.deepEqual(validateStoryboard(storyboard, {slug: 'rhythm-test', plan: plan('draft')}), []);

  const runtimeScene = {
    composition: {
      nodes: [{
        id: 'hare', kind: 'state-sequence', poseFamilyId: 'hare-actions',
        states: family.states.map(({id, at, facing}) => ({id, at, facing})),
        playback: structuredClone(family.playback),
        transition: {type: family.transition, durationSeconds: 0},
      }],
    },
  };
  bindCompiledSoundEffects(runtimeScene, storyboard.scenes[0]);
  assert.deepEqual(validateDirectingExecution({scene: runtimeScene, storyboardScene: storyboard.scenes[0]}), []);
  runtimeScene.composition.nodes[0].playback.activeStateIds = ['stride-b', 'stride-a'];
  assert.ok(validateDirectingExecution({scene: runtimeScene, storyboardScene: storyboard.scenes[0]})
    .some(({code}) => code === 'directing-state-sequence-drift'));
});

test('required hero state families cannot be silently downgraded to fit draft budget', () => {
  const authored = authoredStoryboard();
  const scene = authored.scenes[0];
  scene.beats[0].proofTimeId = 'proof-establish';
  scene.beats[0].treatments = ['cao', 'elephant'].map((targetId) => ({
    id: `${targetId}-start`, targetId, importance: 'hero', necessity: 'required', changeClass: 'pose-change',
    motion: {kind: 'state-sequence', poseFamilyId: `${targetId}-actions`, stateId: 'start', facing: 'right', visualChange: 'Start pose', playback: 'once', transition: 'cut'},
    composition: {pattern: 'free'}, graphic: null, semanticRisk: 'identity', proofTimeId: 'proof-establish', rationale: 'Required opening state.',
  }));
  scene.beats[1].treatments = ['cao', 'elephant'].map((targetId) => ({
    id: `${targetId}-finish`, targetId, importance: 'hero', necessity: 'required', changeClass: 'pose-change',
    motion: {kind: 'state-sequence', poseFamilyId: `${targetId}-actions`, stateId: 'finish', facing: 'right', visualChange: 'Finish pose', playback: 'once', transition: 'cut'},
    composition: {pattern: 'free'}, graphic: null, semanticRisk: 'identity', proofTimeId: 'proof-action', rationale: 'Required final state.',
  }));
  scene.proofTimes[0].stateAssertions = ['cao', 'elephant'].map((nodeId) => ({nodeId, stateId: 'start'}));
  scene.proofTimes[1].stateAssertions = ['cao', 'elephant'].map((nodeId) => ({nodeId, stateId: 'finish'}));
  assert.throws(
    () => compileStoryboardDirecting(authored, {plan: plan('draft')}),
    /请提高档位或缩小故事范围/,
  );
});

test('ready storyboards require ordered beats, final proof, and plan alignment', () => {
  const storyboard = readyStoryboard();
  storyboard.scenes[0].beats[1].at = 0;
  storyboard.scenes[0].proofTimes[2] = {
    id: 'proof-final', at: 0.7, label: 'Too early', kind: 'final', assertions: ['Too early'], stateAssertions: [],
  };
  const issues = validateStoryboard(storyboard, {slug: 'rhythm-test', plan: plan()});
  assert.ok(issues.some(({code}) => code === 'storyboard-beat-time'));
  assert.ok(issues.some(({code}) => code === 'storyboard-final-proof'));
});

test('v12 storyboard sound beats require an approved event-level proof', () => {
  const storyboard = readyStoryboard();
  storyboard.scenes[0].beats[1].proofTimeId = null;
  assert.ok(validateStoryboard(storyboard, {slug: 'rhythm-test', plan: plan()})
    .some(({code}) => code === 'storyboard-sound-proof-required'));
});

test('v12 rejects the legacy audioCue field and requires an explicit soundCue', () => {
  const legacy = readyStoryboard();
  legacy.scenes[0].beats[1].audioCue = legacy.scenes[0].beats[1].soundCue;
  delete legacy.scenes[0].beats[1].soundCue;
  const issues = validateStoryboard(legacy, {slug: 'rhythm-test', plan: plan()});
  assert.ok(issues.some(({code}) => code === 'storyboard-beat-audio-cue-legacy'));
  assert.ok(issues.some(({code}) => code === 'storyboard-beat-sound-field'));
});

test('camera treatments reject scene-number aliases', () => {
  const storyboard = readyStoryboard();
  storyboard.scenes[0].beats[0].treatments[0].targetId = 'scene-04-camera';
  assert.ok(validateStoryboard(storyboard, {slug: 'rhythm-test', plan: plan()})
    .some(({code}) => code === 'treatment-camera-target-alias'));
});

test('motion proof moments cannot be hidden inside scene boundary transitions', () => {
  assert.equal(proofOverlapsTransition({at: 0.08, enterTransitionFrames: 12, exitTransitionFrames: 0, durationInFrames: 300}), false);
  assert.equal(proofOverlapsTransition({at: 0.95, enterTransitionFrames: 0, exitTransitionFrames: 30, durationInFrames: 300}), true);
});

test('path locomotion compiles as an orthogonal route bound to one looping state family and camera follow', () => {
  const authored = authoredStoryboard();
  const path = {
    kind: 'cubic-bezier-3d',
    coordinateSpace: 'parent-normalized-depth',
    start: {x: -0.3, y: 0, z: -0.4},
    segments: [{
      control1: {x: -0.12, y: -0.2, z: -0.1},
      control2: {x: 0.12, y: 0.2, z: 0.2},
      end: {x: 0.3, y: 0, z: 0.5},
    }],
    progress: [
      {at: 0, distance: 0, ease: 'ease-in-out'},
      {at: 1, distance: 1, ease: 'ease-in-out'},
    ],
    orientation: {
      mode: 'path-tangent',
      forwardAngleDegrees: 0,
      smoothingSeconds: 0.08,
      maximumTurnDegreesPerSecond: 240,
    },
    projection: {
      depthDistanceScale: 0.65,
      farScale: 0.68,
      nearScale: 1.35,
      farOpacity: 0.7,
      nearOpacity: 1,
      farBlurPx: 2,
      nearBlurPx: 0,
      depthOrderSpan: 40,
    },
  };
  const stateTreatment = ({id, stateId, visualChange, proofTimeId}) => ({
    id,
    targetId: 'tadpoles',
    importance: 'supporting',
    necessity: 'required',
    changeClass: 'pose-change',
    motion: {
      kind: 'state-sequence',
      poseFamilyId: 'tadpole-swim',
      stateId,
      facing: 'neutral',
      visualChange,
      playback: 'loop',
      transition: 'cut',
      cycles: 8,
    },
    composition: {pattern: 'free'},
    graphic: null,
    semanticRisk: 'identity',
    proofTimeId,
    rationale: 'Registered tail phases make swimming visible.',
  });
  authored.scenes[0].beats[0].treatments.push(
    stateTreatment({
      id: 'tail-left-state',
      stateId: 'tail-left',
      visualChange: 'Tail bends left.',
      proofTimeId: 'proof-establish',
    }),
    {
      id: 'tadpole-path',
      targetId: 'tadpoles',
      importance: 'supporting',
      necessity: 'required',
      changeClass: 'path-travel',
      motion: {
        kind: 'path-locomotion',
        path,
        cameraFollow: {
          targetNodeId: 'tadpoles',
          worldNodeId: 'pond-world',
          framing: {x: 0.5, y: 0.54},
          lookAheadSeconds: 0.15,
          smoothingSeconds: 0.2,
          zoom: 1,
          worldBounds: {x: -1, y: -1, width: 3, height: 3},
        },
      },
      composition: {pattern: 'free'},
      graphic: null,
      semanticRisk: 'identity',
      proofTimeId: 'proof-establish',
      rationale: 'One curved world-space route owns position and heading.',
    },
  );
  authored.scenes[0].beats[1].treatments.push(
    stateTreatment({
      id: 'tail-right-state',
      stateId: 'tail-right',
      visualChange: 'Tail bends right.',
      proofTimeId: 'proof-action',
    }),
  );
  authored.spatialContracts = [{
    id: 'tadpole-path-contract',
    kind: 'path-locomotion',
    sceneId: 'scene-01',
    nodeId: 'tadpoles',
    worldNodeId: 'pond-world',
    fromProofTimeId: 'proof-establish',
    throughProofTimeId: 'proof-final',
    turnProofTimeIds: ['proof-action'],
    stateIds: ['tail-left', 'tail-right'],
    minimumChangesPerSecond: 2,
    continueThroughWindowEnd: true,
    minimumTravel: 0.4,
    minimumDepthTravel: 0.6,
    minimumProjectionScaleDelta: 0.3,
    requiredDepthDirections: ['toward-camera'],
    minimumDirectionSectors: 2,
    maximumHeadingErrorDegrees: 20,
    maximumTurnDegreesPerSecond: 240,
    requireCameraFollow: true,
  }];

  const compiled = compileStoryboardDirecting(authored, {plan: plan()});
  const scene = compiled.scenes[0];
  assert.equal(scene.compositionPlan.pathMotions.length, 1);
  assert.deepEqual(scene.compositionPlan.pathMotions[0], {
    id: 'tadpole-path',
    nodeId: 'tadpoles',
    path,
    cameraFollow: authored.scenes[0].beats[0].treatments[2].motion.cameraFollow,
    at: 0,
    proofTimeId: 'proof-establish',
  });
  assert.equal(
    scene.compositionPlan.stateSequences[0].poseFamilyId,
    'tadpole-swim',
  );
  assert.ok(
    compiled.motionContract.scenes[0].continuousTreatmentIds.includes(
      'tadpole-path',
    ),
  );
  assert.ok(
    compiled.motionContract.scenes[0].cameraTreatmentIds.includes(
      'tadpole-path',
    ),
  );
  assert.ok(
    compiled.directingSummary.styleProofPlan.requiredCoverage.includes(
      'motion:path-locomotion',
    ),
  );
});

test('one camera may follow the lead while sibling path swimmers omit camera follow', () => {
  const sharedPath = {
    kind: 'cubic-bezier-3d',
    coordinateSpace: 'parent-normalized-depth',
    start: {x: -0.2, y: 0, z: 0},
    segments: [{
      control1: {x: -0.05, y: -0.1, z: 0},
      control2: {x: 0.05, y: 0.1, z: 0},
      end: {x: 0.2, y: 0, z: 0},
    }],
    progress: [
      {at: 0, distance: 0, ease: 'linear'},
      {at: 1, distance: 1, ease: 'linear'},
    ],
    orientation: {
      mode: 'path-tangent',
      forwardAngleDegrees: 0,
      smoothingSeconds: 0.08,
      maximumTurnDegreesPerSecond: 240,
    },
    projection: {
      depthDistanceScale: 0.65,
      farScale: 0.68,
      nearScale: 1.35,
      farOpacity: 0.7,
      nearOpacity: 1,
      farBlurPx: 2,
      nearBlurPx: 0,
      depthOrderSpan: 40,
    },
  };
  const follow = {
    targetNodeId: 'lead',
    worldNodeId: 'pond-world',
    framing: {x: 0.5, y: 0.54},
    lookAheadSeconds: 0.15,
    smoothingSeconds: 0.2,
    zoom: 1,
    worldBounds: {x: -1, y: -1, width: 3, height: 3},
  };
  const pathNode = (id) => ({
    id,
    kind: 'state-sequence',
    motion: {path: sharedPath},
  });
  const runtimeScene = {
    camera: {follow},
    composition: {nodes: [pathNode('lead'), pathNode('follower')]},
  };
  const storyboardScene = {
    compositionPlan: {
      pathMotions: [
        {id: 'lead-path', nodeId: 'lead', path: sharedPath, cameraFollow: follow},
        {
          id: 'follower-path',
          nodeId: 'follower',
          path: sharedPath,
          cameraFollow: null,
        },
      ],
    },
  };

  assert.deepEqual(
    validateDirectingExecution({scene: runtimeScene, storyboardScene}),
    [],
  );
});
