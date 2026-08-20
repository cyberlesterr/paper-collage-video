// Single source of truth for the vocabularies shared by the planning gate
// (planning-scenario-lib) and the execution gate (motion-treatment-lib,
// layer-source-plan-lib, container-source-plan-lib).
//
// These enums used to be declared independently on both sides, so a scenario
// could pass the planning gate using a term the compiler had never heard of —
// the author only discovered it after the whole storyboard was written.
// Anything spendable at planning time must be executable at compile time, so
// both sides import from here.

export const CANONICAL_CONTAINER_SOURCE_STRATEGY =
  'canonical-frame-with-content-sheet';

// One table, two views. `layerSource` marks the strategies that compile into a
// storyboard source-package plan; the others are planning-budget-only (a plain
// background) or carry their own compiler (canonical containers, whose costs
// depend on the bound state family and are computed at compile time).
export const SOURCE_PACKAGE_STRATEGIES = {
  'single-background': {
    layerSource: false,
    costs: {providerCalls: 1, localDerivatives: 0, avoidedCalls: 0},
  },
  'rigid-master': {
    layerSource: true,
    costs: {providerCalls: 1, localDerivatives: 0, avoidedCalls: 0},
  },
  'registered-layer-sheet': {
    layerSource: true,
    costs: {providerCalls: 1, localDerivatives: 3, avoidedCalls: 3},
  },
  'context-preserving-layer-edits': {
    layerSource: true,
    costs: {providerCalls: 4, localDerivatives: 3, avoidedCalls: 0},
  },
  [CANONICAL_CONTAINER_SOURCE_STRATEGY]: {
    layerSource: false,
    costs: null,
  },
};

export const LAYER_SOURCE_STRATEGIES = Object.entries(SOURCE_PACKAGE_STRATEGIES)
  .filter(([, {layerSource}]) => layerSource)
  .map(([strategy]) => strategy);

export const STRATEGY_COSTS = Object.fromEntries(
  Object.entries(SOURCE_PACKAGE_STRATEGIES)
    .filter(([, {costs}]) => costs !== null)
    .map(([strategy, {costs}]) => [strategy, costs]),
);

export const CHANGE_CLASSES = [
  'ambient-motion',
  'camera-change',
  'pose-change',
  'prop-state-change',
  'contact-change',
  'shared-boundary',
  'graphic-emphasis',
  'mechanism-state',
  'static-hold',
  'visibility-change',
  'depth-parallax',
  'depth-layer-separation',
  'decorative-field',
  'world-travel',
  'path-travel',
];

export const MOTION_KINDS = [
  'static',
  'continuous-transform',
  'state-sequence',
  'visibility-transition',
  'motif-field',
  'path-locomotion',
];

export const CONTINUOUS_PRESETS = [
  'breathe',
  'float',
  'drift',
  'bounce',
  'pulse',
  'camera',
  'settle',
  'traverse',
  'sway',
  'parallax-camera',
  'scroll-world-x',
];

export const STATE_FACINGS = ['left', 'right', 'front', 'back', 'neutral'];

// Idle motion is a subtle self-loop, so it accepts a narrower set than the
// continuous-transform presets: locomotion and camera behaviours (traverse,
// parallax-camera, scroll-world-x, …) are expressed as keyframes or camera
// settings instead. Both sides read this list so a preset that plans cleanly
// cannot become an unknown idle preset at execution time.
export const IDLE_PRESETS = [
  'float',
  'breathe',
  'grind',
  'drift',
  'sway',
  'still',
];
