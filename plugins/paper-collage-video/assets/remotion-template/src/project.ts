import {deriveSceneTimeline} from './sceneTimeline.mjs';
import {applyResponsiveDirectingPlan} from './editorialPrimitives.mjs';

export type SceneBlueprint =
  | 'layered-reveal'
  | 'map-journey'
  | 'archive-stack'
  | 'character-procession'
  | 'discovery-wipe'
  | 'transformation-tableau'
  | 'chapter-tableau'
  | 'quiet-lockup';

export type MotionEase = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'hold';

export type MotionKeyframe = {
  at: number;
  offsetX?: number;
  offsetY?: number;
  scale?: number;
  rotation?: number;
  opacity?: number;
  ease?: MotionEase;
};

export type IdleMotion = {
  preset: 'float' | 'breathe' | 'grind' | 'drift' | 'sway' | 'still';
  intensity: number;
  cycleSeconds: number;
  phase?: number;
};

export type PathPoint = {x: number; y: number; z: number};

export type PathMotion = {
  kind: 'cubic-bezier-3d';
  coordinateSpace: 'parent-normalized-depth';
  start: PathPoint;
  segments: Array<{
    control1: PathPoint;
    control2: PathPoint;
    end: PathPoint;
  }>;
  progress: Array<{
    at: number;
    distance: number;
    ease?: MotionEase;
  }>;
  orientation: {
    mode: 'path-tangent';
    forwardAngleDegrees: number;
    smoothingSeconds: number;
    maximumTurnDegreesPerSecond: number;
  };
  projection: {
    depthDistanceScale: number;
    farScale: number;
    nearScale: number;
    farOpacity: number;
    nearOpacity: number;
    farBlurPx: number;
    nearBlurPx: number;
    depthOrderSpan: number;
  };
};

export type NodeMotion = {
  keyframes: MotionKeyframe[];
  idle?: IdleMotion;
  pivot?: {x: number; y: number};
  path?: PathMotion;
};

export type NodeVisibility = {
  initial: 'visible' | 'hidden';
};

export type NodeTransform = {
  x: number;
  y: number;
  width: number;
  height?: number;
  anchorX: number;
  anchorY: number;
  scale?: number;
  rotation?: number;
  opacity?: number;
};

export type CoordinateSpace = {width: number; height: number};

export type CompositionRegistration = {
  id: string;
  sourceMasterAssetId: string;
  canvas: CoordinateSpace;
  origin: 'top-left';
};

export type CanonicalContainerMetrics = {
  rawBounds: RegisteredFamilyRect;
  alignedBounds: RegisteredFamilyRect;
  maskBounds: RegisteredFamilyRect;
  translation: {x: number; y: number};
  centerDrift: number;
  bottomGap: number;
  fillLevel: number;
  fillLevelDeviation: number;
  rimGap: number;
  bottomBandCoverage: number;
  interiorRetention: number;
  clippedPixels: number;
  outsideMaskPixels: number;
};

export type CanonicalContainerContract = {
  schemaVersion: 1;
  familyId: string;
  sourcePackageId: string;
  sourceStrategy: 'canonical-frame-with-content-sheet';
  familyFingerprint: string;
  cleanPlateNodeId: string;
  canonicalFrameNodeId: string;
  contentsNodeId: string;
  cleanPlateAssetId: string;
  cleanPlateSha256: string;
  canonicalFrameAssetId: string;
  canonicalFrameSha256: string;
  contentSheetAssetId: string;
  contentSheetSha256: string;
  interiorMaskAssetId: string;
  interiorMaskSha256: string;
  authoritativeSurfaceId: string;
  interiorShape: {
    kind: 'polygon';
    points: Array<[number, number]>;
  };
  alignmentPolicy: {
    mode: 'center-bottom';
    maximumTranslationX: number;
    maximumTranslationY: number;
    maximumCenterDrift: number;
    maximumBottomGap: number;
    maximumFillLevelDeviation: number;
    minimumInteriorRetention: number;
  };
  states: Array<{
    id: string;
    fillLevel: number;
    assetId: string;
    sha256: string;
    metrics: CanonicalContainerMetrics;
  }>;
  terminalStateId: string;
  terminalPolicy: {
    minimumFillLevel: number;
    maximumRimGap: number;
    minimumBottomBandCoverage: number;
    bottomBandHeight: number;
  };
  recoveryPolicy: {
    strategy: 'preserve-content-sheet-context';
    localDeterministicFixFirst: true;
    isolatedStateGeneration: 'forbidden';
    providerRepair: 'masked-complete-sheet-edit';
    fallback: 'full-content-sheet-regeneration';
  };
};

export type RegisteredFamilyRole =
  | 'support-rear'
  | 'subject'
  | 'support-front';

export type RegisteredFamilySource =
  | {
      kind: 'registered-layer-sheet';
      assetId: string;
      packageRole: RegisteredFamilyRole;
    }
  | {kind: 'layer-package-member'; assetId: string}
  | {
      kind: 'state-sheet-cell';
      assetId: string;
      poseFamilyId: string;
      stateId: string;
    };

export type RegisteredFamilyRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type RegisteredFamilyDerivation = {
  placement?: RegisteredFamilyRect;
  sourceRect?: RegisteredFamilyRect;
  keying?: {
    keyColor: string;
    transparentThreshold: number;
    opaqueThreshold: number;
    edgeFeather: number;
    matteErode: number;
    edgePadding: number;
  };
  maskAssetId?: string;
  maskChannel?: 'alpha' | 'luminance';
  invertMask?: boolean;
  clip?:
    | {kind: 'rectangle'; rect: RegisteredFamilyRect}
    | {kind: 'polygon'; points: Array<[number, number]>};
};

export type RegisteredFamilySpec = {
  schemaVersion: 2;
  projectSlug: string;
  sceneId: string;
  groupId: string;
  familyId: string;
  pattern: 'supported-subject' | 'registered-depth-stack';
  motionCapability: 'rigid-locked' | 'bounded-relative';
  sourcePackageId: string;
  sourceStrategy:
    | 'rigid-master'
    | 'registered-layer-sheet'
    | 'context-preserving-layer-edits';
  revealEnvelope: LayerRevealEnvelope | null;
  registration: CompositionRegistration;
  members: Array<{
    assetId: string;
    nodeId: string;
    role: RegisteredFamilyRole;
    slot: RegisteredFamilyRole;
    completeness: 'clean-plate' | 'full-silhouette' | 'full-overlay';
    output: string;
    source: RegisteredFamilySource;
    derivation: RegisteredFamilyDerivation;
  }>;
  recoveryPolicy: {
    strategy: 'preserve-family-context';
    localDeterministicFixFirst: true;
    isolatedMemberGeneration: 'forbidden';
    providerRepair: 'masked-complete-source-edit';
    fallback: 'full-source-regeneration';
  };
  applyToProject: boolean;
};

export type RegisteredFamilyBinding = {
  schemaVersion: 2;
  familyId: string;
  pattern: 'supported-subject' | 'registered-depth-stack';
  motionCapability: 'rigid-locked' | 'bounded-relative';
  sourcePackageId: string;
  sourceStrategy: RegisteredFamilySpec['sourceStrategy'];
  revealEnvelope: LayerRevealEnvelope | null;
  registrationId: string;
  sourceMasterAssetId: string;
  canvas: CoordinateSpace;
  origin: 'top-left';
  role: RegisteredFamilyRole;
  slot: RegisteredFamilyRole;
  completeness: 'clean-plate' | 'full-silhouette' | 'full-overlay';
  nodeId: string;
  source: {
    kind: RegisteredFamilySource['kind'];
    assetId: string;
    stateId: string | null;
    sourceSheetAssetId: string | null;
    sourceFamilyFingerprint: string | null;
    sha256: string;
  };
  derivation: {
    placement: RegisteredFamilyRect;
    sourceRect: RegisteredFamilyRect | null;
    sourceSurface: {
      mode: 'alpha' | 'chroma-key' | 'opaque';
      keyColor: string | null;
      tolerance: number | null;
      requestedKeyColor: string | null;
      observedKeyColor: string | null;
      observationPolicyId: 'flat-v1' | null;
      observationPolicyFingerprint: string | null;
      observationFingerprint: string | null;
    } | null;
    keying: RegisteredFamilyDerivation['keying'] | null;
    keyingMetadataSha256: string | null;
    maskAssetId: string | null;
    maskSha256: string | null;
    maskChannel: 'alpha' | 'luminance' | null;
    invertMask: boolean;
    clip: RegisteredFamilyDerivation['clip'] | null;
    trimmed: false;
    outputCanvasPreserved: true;
  };
  recoveryPolicy: RegisteredFamilySpec['recoveryPolicy'];
  familyFingerprint: string;
};

export type CompositionAssetNode = {
  id: string;
  kind: 'asset';
  assetRole: 'background' | 'environment' | 'character' | 'prop' | 'decorative';
  src: string;
  z: number;
  slot?: string;
  registrationId?: string;
  semanticCoverage?: string[];
  depth?: number;
  transform: NodeTransform;
  motion: NodeMotion;
  visibility?: NodeVisibility;
  clip?: {boundaryId: string; side: 'upper' | 'lower'};
};

export type SequenceState = {
  id: string;
  src: string;
  at: number;
  facing: 'left' | 'right' | 'front' | 'back' | 'neutral';
  anchors: Array<{id: string; x: number; y: number}>;
  identityReferenceAssetId: string;
  identityReferenceSha256: string;
};

export type PathViewBinding = {
  depthVelocityThreshold: number;
  transitionWidth: number;
  planarStateIds: string[];
  towardStateIds: string[];
  awayStateIds: string[];
};

export type CompositionStateSequenceNode = {
  id: string;
  kind: 'state-sequence';
  assetRole: 'character' | 'prop' | 'decorative';
  poseFamilyId: string;
  registration: CompositionRegistration;
  anchorPolicy: {
    requiredAnchorIds: string[];
    maximumDrift: number;
  };
  states: SequenceState[];
  playback: {
    mode: 'once' | 'loop' | 'ping-pong';
    cycles: number;
    activeFrom?: number;
    activeUntil?: number;
    holdStateId?: string;
    activeStateIds?: string[];
  };
  pathViewBinding?: PathViewBinding;
  transition: {type: 'cut' | 'crossfade'; durationSeconds: number};
  z: number;
  slot?: string;
  semanticCoverage?: string[];
  depth?: number;
  transform: NodeTransform;
  motion: NodeMotion;
  visibility?: NodeVisibility;
  clip?: {boundaryId: string; side: 'upper' | 'lower'};
};

export type EditorialProfileId = '16:9' | '9:16' | '1:1';

export type EditorialAnchorReference = {
  targetId: string;
  anchor:
    | 'top'
    | 'top-right'
    | 'right'
    | 'bottom-right'
    | 'bottom'
    | 'bottom-left'
    | 'left'
    | 'top-left'
    | 'center';
  point?: {x: number; y: number};
};

export type EditorialMatchDescriptor = {
  shape?: string;
  color?: string;
  value?: string;
  width?: number;
  height?: number;
};

export type EditorialAdvancedTransition = {
  id: string;
  scope: 'scene-boundary' | 'within-shot';
  type:
    | 'match-cut'
    | 'graphic-match'
    | 'shape-match'
    | 'position-scale-match'
    | 'color-value-match'
    | 'within-shot-card-switch'
    | 'panel-replace'
    | 'data-state-transition';
  sceneId: string;
  destinationSceneId?: string;
  editPointId: string;
  semanticIntent: string;
  sourceAnchor: EditorialAnchorReference;
  destinationAnchor: EditorialAnchorReference;
  sourceDescriptor: EditorialMatchDescriptor;
  destinationDescriptor: EditorialMatchDescriptor;
  matchDimensions: Array<'shape' | 'position' | 'scale' | 'color' | 'value'>;
  continuityTolerance: number;
  invalidPolicy: 'reject' | 'fallback';
  fallback?: 'cut' | 'wipe' | 'panel-replace';
  treatment:
    | 'hard-cut'
    | 'card-switch'
    | 'panel-replace'
    | 'data-state'
    | 'slide'
    | 'wipe'
    | 'scale-swap'
    | 'value-tween';
};

export type EditorialTransitionPlan = EditorialAdvancedTransition & {
  editPointFrame: number;
  continuity: Array<{
    profileId: EditorialProfileId;
    source: {x: number; y: number} | null;
    destination: {x: number; y: number} | null;
    distance: number | null;
    dimensionChecks: Partial<Record<
      'shape' | 'position' | 'scale' | 'color' | 'value',
      {
        source: unknown;
        destination: unknown;
        delta?: number | null;
        valid: boolean;
      }
    >>;
    valid: boolean;
    runtimeTreatment: string;
  }>;
  invalidProfiles: EditorialProfileId[];
  runtimeTreatment: string;
  proofFrameIds: string[];
};

export type EditorialSubtitlePlacement = {
  anchor:
    | 'bottom'
    | 'bottom-left'
    | 'bottom-right'
    | 'top'
    | 'top-left'
    | 'top-right'
    | 'center';
  safeArea: {x: number; y: number; width: number; height: number};
  exclusionZones?: Array<{
    id: string;
    role: string;
    x: number;
    y: number;
    width: number;
    height: number;
    padding?: number;
  }>;
};

export type EditorialSystem = {
  timebase: {fps: number; rounding: 'nearest' | 'floor' | 'ceil'};
  wordTimingPolicy: 'require' | 'phrase-fallback' | 'block';
  media: Array<{
    id: string;
    kind: 'narration' | 'sfx' | 'music';
    src: string;
    sha256: string;
    durationSeconds: number;
    timingDataSrc?: string;
    timelineMode: 'scene-local' | 'global';
    sceneOffsetSeconds?: number;
  }>;
  cues: Array<{
    id: string;
    kind: string;
    source: 'authored' | 'detected';
    timingBasis: 'actual-audio' | 'manual';
    mediaId: string;
    sceneId: string;
    atSeconds: number;
    endSeconds?: number;
    text?: string;
    priority: number;
    toleranceSeconds: number;
  }>;
  editPoints: Array<{
    id: string;
    cueIds: string[];
    conflictPolicy: 'merge' | 'highest-priority' | 'offset-within-window' | 'reject';
    priority?: number;
    toleranceSeconds?: number;
  }>;
  bindings: Array<{
    id: string;
    sceneId: string;
    targetType: string;
    targetId: string;
    editPointId: string;
    mode?: string;
    offsetSeconds?: number;
  }>;
  responsiveProfiles: Array<{
    id: EditorialProfileId;
    width: number;
    height: number;
    safeArea: {x: number; y: number; width: number; height: number};
    densityBudget: number;
    typographyScale: number;
    parallaxScale: number;
    exclusionZones: Array<{
      id: string;
      role: string;
      x: number;
      y: number;
      width: number;
      height: number;
      padding?: number;
    }>;
  }>;
  sceneDirecting: Array<Record<string, unknown>>;
  transitions: EditorialAdvancedTransition[];
  activeProfile?: EditorialProfileId;
  resolvedEditPoints: Array<{
    id: string;
    sceneId: string;
    cueIds: string[];
    resolvedSeconds: number;
    mediaFrame: number;
    sceneFrame: number;
    renderFrame: number;
    priority: number;
    toleranceSeconds: number;
    conflictPolicy: string;
    sources: string[];
    timingBasis: string[];
  }>;
  conflicts: Array<Record<string, unknown>>;
  responsivePlans: Array<{
    profileId: EditorialProfileId;
    width: number;
    height: number;
    safeArea: {x: number; y: number; width: number; height: number};
    exclusionZones: Array<{
      id: string;
      role: string;
      x: number;
      y: number;
      width: number;
      height: number;
      padding?: number;
    }>;
    densityBudget: number;
    scenes: Array<{
      sceneId: string;
      compositionProfile: string;
      typographyProfile: string;
      subjectFraming: Record<string, unknown>;
      parallaxScale: number;
      cropFocus: {x: number; y: number};
      densityUsed: number;
      placements: Array<{
        targetId: string;
        role: string;
        transform: NodeTransform;
      }>;
    }>;
  }>;
  transitionPlans: EditorialTransitionPlan[];
  fingerprint: string;
};

export type CompositionTypographyNode = {
  id: string;
  kind: 'typography';
  role?: 'visual-sfx';
  text: string;
  treatment: {
    fit: {
      minFontSize: number;
      maxFontSize: number;
      maxLines: number;
      overflow: 'error' | 'clip';
    };
    style: {
      color: string;
      fontWeight: number;
      lineHeight: number;
      align: 'left' | 'center' | 'right';
      letterSpacing?: number;
      fontFamily?: string;
    };
    effects: {
      stroke?: {color: string; width: number};
      shadow?: {color: string; x: number; y: number; blur: number};
      pad?: {color: string; padding: number; radius: number};
    };
    highlights: Array<{text: string; color: string}>;
    reveal: {
      mode: 'none' | 'word' | 'line' | 'edit-point';
      editPointIds: string[];
      units?: Array<{id: string; text: string}>;
    };
    emphasis: Array<{
      text: string;
      editPointId: string;
      durationFrames: number;
      scale: number;
      offsetX: number;
      offsetY: number;
      color: string;
    }>;
    safeAreaMode: 'inside' | 'allow-bleed';
    avoidZoneIds: string[];
  };
  z: number;
  depth?: number;
  transform: NodeTransform;
  motion: NodeMotion;
  visibility?: NodeVisibility;
};

export type CompositionAnnotationNode = {
  id: string;
  kind: 'annotation';
  annotationKind:
    | 'arrow'
    | 'leader-line'
    | 'label'
    | 'badge'
    | 'explainer-card'
    | 'callout'
    | 'bracket'
    | 'numeric-counter'
    | 'percentage-counter';
  anchor: EditorialAnchorReference;
  target: EditorialAnchorReference;
  routing: 'straight' | 'orthogonal';
  avoidZoneIds: string[];
  label: string;
  value: number;
  style: {color: string; background: string; strokeWidth: number; fontSize: number};
  lifecycle: {
    enterEditPointId?: string;
    exitEditPointId?: string;
    enterFrames?: number;
    exitFrames?: number;
  };
  z: number;
  depth?: number;
  transform: NodeTransform;
  motion: NodeMotion;
  visibility?: NodeVisibility;
};

export type CompositionDataGraphicNode = {
  id: string;
  kind: 'data-graphic';
  graphicKind:
    | 'bar-chart'
    | 'column-chart'
    | 'line-chart'
    | 'comparison-table'
    | 'timeline'
    | 'map'
    | 'flow';
  data: Record<string, unknown>;
  geometry?: Array<{regionId: string; path: string}>;
  scale: {domain: [number, number]};
  format: {prefix?: string; suffix?: string; unit?: string; decimals?: number; multiplier?: number};
  states: Array<{id: string; editPointId: string; reveal: number; focusIds: string[]}>;
  style: {ink: string; paper: string; accent: string; muted: string; fontSize: number};
  z: number;
  depth?: number;
  transform: NodeTransform;
  motion: NodeMotion;
  visibility?: NodeVisibility;
};

export type CompositionEditorialSwitchNode = {
  id: string;
  kind: 'editorial-switch';
  panels: Array<{id: string; node: CompositionNode}>;
  changes: Array<{
    id: string;
    editPointId: string;
    fromPanelId: string;
    toPanelId: string;
    treatment: 'card-switch' | 'panel-replace' | 'data-state';
    durationFrames: number;
  }>;
  z: number;
  depth?: number;
  transform: NodeTransform;
  motion: NodeMotion;
  visibility?: NodeVisibility;
};

export type CompositionShapeNode = {
  id: string;
  kind: 'shape';
  shape: 'rectangle' | 'ellipse' | 'line';
  style: {fill: string; stroke: string; strokeWidth: number; radius: number};
  z: number;
  depth?: number;
  transform: NodeTransform;
  motion: NodeMotion;
  visibility?: NodeVisibility;
};

export type CompositionBoundary = {
  id: string;
  normalizedY?: number;
  upperMaskSrc?: string;
  lowerMaskSrc?: string;
  upperSemantic: string;
  lowerSemantic: string;
};

export type LayerRevealLimit = {
  x: number;
  y: number;
  scale: number;
  rotationDegrees: number;
};

export type LayerRevealEnvelope = {
  '16:9': LayerRevealLimit;
  '9:16': LayerRevealLimit;
  '1:1': LayerRevealLimit;
};

export type LoopingStripBinding = {
  schemaVersion: 1;
  stripId: string;
  role: 'far' | 'mid' | 'ground' | 'near';
  sourceAssetId: string;
  axis: 'x';
  seamStrategy: 'exact' | 'overlap-crop' | 'mirror-crop';
  source: {
    sha256: string;
    width: number;
    height: number;
    provider: string;
    adapter: string;
    recordId: string;
  };
  canonicalTile: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  alphaFeather?: {
    topPixels: number;
    bottomPixels: number;
  } | null;
  output: {
    width: number;
    height: number;
    hasAlpha: boolean;
  };
  minimumViewportSpan: number;
  edgeBandPixels: number;
  derivationFingerprint: string;
};

export type CompositionWorldStripNode = {
  id: string;
  kind: 'world-strip';
  role: 'far' | 'mid' | 'ground' | 'near';
  surfaceRole:
    | 'backdrop'
    | 'scenery'
    | 'walkable-ground'
    | 'foreground-occluder';
  src: string;
  loopingStripBinding: LoopingStripBinding;
  z: number;
  depth: number;
  transform: NodeTransform;
  motion: NodeMotion;
  visibility?: NodeVisibility;
};

export type LoopingEnvironmentTravel = {
  direction: 'left' | 'right';
  distanceViewports: number;
  easing: 'linear' | 'ease-out';
  closedLoop: boolean;
  startPhase: number;
  /** Normalized scene cue; phase is held before this point. */
  activeFrom?: number;
  /** Normalized scene lock; phase remains at the completed travel after this point. */
  activeUntil?: number;
  /** Reuse registered strips as one locked tableau; never advance the world phase. */
  frozen?: boolean;
};

export type CompositionGroupNode = {
  id: string;
  kind: 'group';
  pattern:
    | 'free'
    | 'supported-subject'
    | 'registered-environment'
    | 'registered-depth-stack'
    | 'looping-environment'
    | 'canonical-container';
  renderParticipation?: 'visible' | 'derivation-only';
  /**
   * `scene` lets a top-level registered depth stack expose its registered
   * members to the scene z-order so external characters can interleave with
   * them. The group may be a static axis-aligned layout carrier, but it may not
   * animate, rotate, fade, or create its own isolated stacking context.
   */
  stackingContext?: 'isolated' | 'scene';
  z: number;
  depth?: number;
  coordinateSpace: CoordinateSpace;
  transform: NodeTransform;
  motion: NodeMotion;
  visibility?: NodeVisibility;
  registration?: CompositionRegistration;
  layerStack?: {
    sourcePackageId: string;
    sourceStrategy:
      | 'registered-layer-sheet'
      | 'context-preserving-layer-edits';
    motionCapability: 'bounded-relative';
    revealEnvelope: LayerRevealEnvelope;
    subjectTravelEnvelope?: LayerRevealEnvelope;
  };
  loopingEnvironment?: {
    axis: 'x';
    groundStripId: string;
    subjectBindings: Array<{
      nodeId: string;
      role: 'tracked' | 'participant';
      anchorMode: 'screen' | 'world';
      nearOcclusion: 'behind-near' | 'above-near';
      requireNearOverlap?: boolean;
      proofTimeIds: string[];
    }>;
    seamProofTimeIds: {
      before: string;
      seam: string;
      after: string;
    };
    travel: LoopingEnvironmentTravel;
    speedRange: {
      far: number;
      near: number;
    };
    overscanPx: number;
  };
  canonicalContainer?: CanonicalContainerContract;
  support?: {
    subjectId: string;
    layering?: 'between-supports' | 'subject-front';
    contactAnchor: {x: number; y: number};
    contactZone: Array<[number, number]>;
    occlusionZone: Array<[number, number]>;
    detachProofTimeIds?: string[];
  };
  boundaries?: CompositionBoundary[];
  children: CompositionNode[];
};

export type CompositionMotifFieldNode = {
  id: string;
  kind: 'motif-field';
  motifs: Array<{id: string; src: string}>;
  count: number;
  seed: number;
  distribution: 'scattered' | 'grid' | 'edge';
  fieldMotion: {
    preset: 'drift' | 'fall-drift' | 'rise-drift' | 'burst' | 'orbit';
    cycles: number;
  };
  baseSize: number;
  variation: {
    scale: [number, number];
    rotation: [number, number];
    opacity: [number, number];
  };
  bounds: {x: number; y: number; width: number; height: number};
  exclusionZones: Array<{
    id: string;
    shape: 'rectangle' | 'ellipse';
    x: number;
    y: number;
    width: number;
    height: number;
    padding?: number;
  }>;
  worldBinding?: {
    worldNodeId: string;
    stripRole: 'far' | 'mid' | 'ground' | 'near';
    relativeDriftAmplitude: number;
  };
  z: number;
  depth?: number;
  transform: NodeTransform;
  motion: NodeMotion;
  visibility?: NodeVisibility;
};

export type CompositionNode =
  | CompositionAssetNode
  | CompositionStateSequenceNode
  | CompositionTypographyNode
  | CompositionShapeNode
  | CompositionAnnotationNode
  | CompositionDataGraphicNode
  | CompositionEditorialSwitchNode
  | CompositionMotifFieldNode
  | CompositionWorldStripNode
  | CompositionGroupNode;

export type SceneComposition = {
  coordinateSpace: CoordinateSpace;
  world?: {
    id: string;
    groupId: string;
    route: {
      subjectIds: string[];
      subjectSafeBand: {x: number; y: number; width: number; height: number};
      markerNodeIds: string[];
    };
  };
  nodes: CompositionNode[];
};

export type SubtitleCue = {fromSeconds: number; toSeconds: number; text: string};
export type NormalizedSubtitleCue = {from: number; to: number; text: string};

export type CameraKeyframe = {at: number; x?: number; y?: number; zoom?: number};
export type CameraFollow = {
  targetNodeId: string;
  worldNodeId: string;
  framing: {x: number; y: number};
  lookAheadSeconds: number;
  smoothingSeconds: number;
  zoom: number;
  worldBounds: {x: number; y: number; width: number; height: number};
};
export type SceneCamera = {
  preset: 'push' | 'pull' | 'pan-left' | 'pan-right' | 'static';
  intensity: number;
  keyframes?: CameraKeyframe[];
  follow?: CameraFollow;
  parallax?: {
    enabled: boolean;
    strength: number;
    focalDepth: number;
  };
};

export type EmphasisAction =
  | 'pulse'
  | 'stamp'
  | 'shake'
  | 'lift'
  | 'settle'
  | 'drop-impact'
  | 'carve';

export type VisibilityTransition = 'cut' | 'fade-rise' | 'fade-scale';

export type EventVisual =
  | {
      kind: 'visibility';
      action: 'show' | 'hide';
      transition: VisibilityTransition;
      durationSeconds: number;
    }
  | {
      kind: 'emphasis';
      action: EmphasisAction;
      durationSeconds: number;
      intensity: number;
    }
  | {
      kind: 'hold';
      durationSeconds: number;
    };

export type ProjectEvent = {
  id: string;
  beatId: string;
  at: number;
  targetId: string;
  visual: EventVisual | null;
  proofTimeId?: string;
  encounter?: {
    contractId: string;
    phase: 'enter' | 'approach' | 'answer' | 'exit';
    narrationCueId?: string;
  };
  sound?: ProjectSound;
};

export type EncounterContract = {
  id: string;
  travelerNodeId: string;
  targetNodeId: string;
  worldNodeId: string;
  narrationCueId: string;
  phaseBeatIds: {
    enter: string;
    approach: string;
    answer: string;
    exit: string;
  };
  entryEdge: 'left' | 'right';
  exitEdge: 'left' | 'right';
  minimumTravelViewports: number;
  cueToleranceSeconds: number;
};

export type SceneBoundaryTransition = {
  id: string;
  fromSceneId: string;
  toSceneId: string;
  intent:
    | 'continuity'
    | 'location-change'
    | 'time-passage'
    | 'focus-reveal'
    | 'chapter-reset'
    | 'impact';
  rationale: string;
  treatment: {
    type:
      | 'cut'
      | 'wipe'
      | 'dip'
      | 'slide'
      | 'iris'
      | 'page-turn'
      | 'shutters';
    motivation: 'semantic-default' | 'authored' | 'rhythmic' | 'impact';
    durationSeconds: number;
    edgeStyle?: 'clean' | 'paper' | 'torn';
    direction?:
      | 'left-to-right'
      | 'right-to-left'
      | 'top-to-bottom'
      | 'bottom-to-top';
    beatId?: string;
  };
};

export type ProofTime = {
  id: string;
  at: number;
  label: string;
  kind: 'establish' | 'action' | 'peak' | 'final';
  assertions: string[];
  stateAssertions?: Array<{nodeId: string; stateId: string}>;
};

export type SceneMotion = {
  blueprint: SceneBlueprint;
  intensity: number;
  seed: number;
  proofTimes: ProofTime[];
};

export type ProjectTheme = {
  canvas: string;
  sceneBackground: string;
  accent: string;
  ink: string;
  subtitle: string;
  subtitleBackground: string;
  foreground: string;
  surface: {
    texture: null | {
      src: string;
      opacity: number;
      blendMode: 'normal' | 'multiply' | 'screen' | 'overlay';
    };
    subjectEdge:
      | {mode: 'none'}
      | {mode: 'paper-outline'; color: string; widthPx: number};
    subjectShadow:
      | {mode: 'none'}
      | {
          mode: 'drop-shadow';
          offsetXPx: number;
          offsetYPx: number;
          blurPx: number;
          color: string;
        };
  };
  fontFamily?: string;
  fontFile?: string;
};

export type ProjectSound = {src: string; volume: number};
export type ProjectAudioMastering = {
  targetLufs: number;
  toleranceLufs: number;
  truePeakDbtp: number;
};

export type SceneAppearance = {
  background?: string;
  surfaceTexture?: {
    visible: boolean;
    opacity: number;
    blendMode: 'normal' | 'multiply' | 'screen' | 'overlay';
  };
  chapter?: {
    visible: boolean;
    variant?: 'plain' | 'paper-tab';
  };
  subtitles?: {
    variant: 'boxed' | 'plain' | 'hidden';
    color?: string;
    background?: string;
    maxWidth?: number;
    fontFamily?: string;
    fontWeight?: number;
    edgeTreatment?: 'soft-shadow' | 'crisp-outline' | 'none';
  };
};

export type ProjectScene = {
  id: string;
  label: string;
  eyebrow: string;
  tailSeconds: number;
  appearance?: SceneAppearance;
  motion: SceneMotion;
  composition: SceneComposition;
  camera: SceneCamera;
  narration: {
    src: string;
    timingSrc?: string;
    startSeconds: number;
    durationSeconds: number;
    text: string;
  };
  encounters?: EncounterContract[];
  subtitles: SubtitleCue[];
  events: ProjectEvent[];
};

export type SpatialContract =
  | {
      id: string;
      kind: 'grounding';
      sceneId: string;
      subjectNodeId: string;
      supportNodeId: string;
      proofTimeIds: string[];
      subjectAnchor:
        | {mode: 'normalized'; x: number; y: number}
        | {mode: 'state-anchor'; name: string};
      supportSurface: {points: Array<{x: number; y: number}>};
      supportScreenBand: {minY: number; maxY: number};
      mode: 'contact' | 'locked-contact';
      maxGap: number;
      maxPenetration: number;
      maxRelativeDrift: number;
      frontOcclusion?: {
        nodeId: string;
        relation: 'in-front-of-subject' | 'behind-subject';
        minimumAlphaOverlap?: number;
      };
      subtitleClearance?: {minimumGap: number};
    }
  | {
      id: string;
      kind: 'continuity';
      from: {sceneId: string; proofTimeId: string};
      to: {sceneId: string; proofTimeId: string};
      nodePairs: Array<{
        role: 'world' | 'subject' | 'prop' | 'support';
        fromNodeId: string;
        toNodeId: string;
        requireSameFamily: boolean;
        maxPositionDelta: number;
        maxScaleDelta: number;
      }>;
      groundingContractIds: string[];
      maxCameraPositionDelta: number;
      maxCameraZoomDelta: number;
    }
  | {
      id: string;
      kind: 'gait';
      sceneId: string;
      nodeId: string;
      fromProofTimeId: string;
      throughProofTimeId: string;
      stateIds: string[];
      minimumChangesPerSecond: number;
      continueThroughWindowEnd: boolean;
    }
  | {
      id: string;
      kind: 'travel-facing';
      sceneId: string;
      nodeId: string;
      fromProofTimeId: string;
      throughProofTimeId: string;
      direction: 'left' | 'right';
      expectedFacing: 'left' | 'right' | 'front' | 'back' | 'neutral';
      minimumTravel: number;
      rationale: string;
    }
  | {
      id: string;
      kind: 'path-locomotion';
      sceneId: string;
      nodeId: string;
      worldNodeId: string;
      fromProofTimeId: string;
      throughProofTimeId: string;
      turnProofTimeIds: string[];
      stateIds: string[];
      minimumChangesPerSecond: number;
      continueThroughWindowEnd: boolean;
      minimumTravel: number;
      minimumDepthTravel: number;
      minimumProjectionScaleDelta: number;
      requiredDepthDirections: Array<'toward-camera' | 'away-camera'>;
      minimumDirectionSectors: number;
      maximumHeadingErrorDegrees: number;
      maximumTurnDegreesPerSecond: number;
      screenSafeBand?: {
        minX: number;
        maxX: number;
        minY: number;
        maxY: number;
        rationale: string;
      };
      requireCameraFollow: boolean;
    }
  | {
      id: string;
      kind: 'occlusion';
      sceneId: string;
      subjectNodeId: string;
      foregroundNodeId: string;
      relation: 'in-front-of-subject' | 'behind-subject';
      proofTimeIds: string[];
      minimumAlphaOverlap: number;
      rationale: string;
    }
  | {
      id: string;
      kind: 'action-sequence';
      sceneId: string;
      narrationCueId: string;
      narrationToleranceSeconds: number;
      phases: Array<{
        phase:
          | 'establish'
          | 'anticipate'
          | 'action'
          | 'peak'
          | 'follow-through'
          | 'settle';
        proofTimeId: string;
        nodeId: string;
        stateId?: string;
        direction?: 'left' | 'right';
        minimumTravel?: number;
        rationale?: string;
      }>;
      actors: Array<{nodeId: string; contractId: string}>;
    };

export type PaperCollageProject = {
  $schema?: string;
  schemaVersion: 12;
  slug: string;
  title: string;
  styleProfile: null | {
    schemaVersion: 2;
    id: string;
    label: string;
    summary: string;
    catalogVersion: string;
    catalogFingerprint: string;
    profileFingerprint: string;
    referenceImage: string;
    generation: {
      promptDirectives: string[];
      negativeDirectives: string[];
      compositionPrinciples: string[];
      preferredSurfaces: Array<
        'alpha' | 'chroma-key' | 'opaque' | 'layer-sheet' | 'seamless-strip-x'
      >;
    };
    motion: {
      pacing: 'gentle' | 'playful' | 'measured' | 'dynamic';
      preferredIdlePresets: Array<'float' | 'breathe' | 'drift' | 'sway' | 'still'>;
      transitionSet: 'paper-story' | 'clean-video';
      visualSfx: {
        policy: 'rare' | 'selective' | 'expressive';
        maxPerScene: number;
        allowedKinds: Array<'impact' | 'motion'>;
        durationRangeSeconds: [number, number];
      };
    };
    render: {theme: ProjectTheme};
    quality: {
      requiredAssetChecks: string[];
      requiredCompositeChecks: string[];
      reviewFocus: string[];
    };
  };
  motionContract: null | {
    schemaVersion: 1;
    direction: {
      schemaVersion: 1;
      summary: string;
      pacing: 'gentle' | 'playful' | 'measured' | 'dynamic';
      performance: {
        grammar: Array<
          | 'establish'
          | 'anticipate'
          | 'action'
          | 'follow-through'
          | 'settle'
          | 'hold'
          | 'transition'
        >;
        anticipation: 'none' | 'selective' | 'required-for-hero';
        followThrough: 'none' | 'selective' | 'required-for-hero';
        poseStrategy: 'continuous-led' | 'pose-to-pose' | 'mixed';
        minimumFinalHoldRatio: number;
      };
      camera: {strategy: 'locked' | 'motivated' | 'expressive'};
      transitions: {
        strategy: 'story-led' | 'rhythmic-accented' | 'chapter-led';
      };
      ambient: {strategy: 'minimal' | 'selective' | 'persistent'};
      styleDeviationRationale: string | null;
    };
    styleProfileBinding: {
      id: string;
      profileFingerprint: string;
      pacing: 'gentle' | 'playful' | 'measured' | 'dynamic';
    };
    scenes: Array<{
      sceneId: string;
      motionPolicy: 'standard' | 'locked-static';
      phrases: Array<{
        role:
          | 'establish'
          | 'anticipate'
          | 'action'
          | 'follow-through'
          | 'settle'
          | 'hold'
          | 'transition';
        beatId: string;
        at: number;
        proofTimeId: string;
      }>;
      heroActionBeatIds: string[];
      stateSequenceTreatmentIds: string[];
      continuousTreatmentIds: string[];
      cameraTreatmentIds: string[];
      ambientTreatmentIds: string[];
      finalHoldRatio: number;
      exception: null | {kind: 'locked-static'; rationale: string};
    }>;
    transitions: Array<{
      id: string;
      intent: string;
      type: string;
      motivation: string;
    }>;
    editorialFingerprint: string;
    requiredCompositeChecks: string[];
    approvalFingerprint: string;
    fingerprint: string;
  };
  plan: {
    schemaVersion: 4;
    slug: string;
    status: 'pending' | 'resolved';
    inputMode: 'none' | 'duration-only' | 'scenes-only' | 'both';
    productionProfile: 'draft' | 'balanced' | 'full-depth';
    assetBudget: {
      backgrounds: number;
      environmentLayers: number;
      characterSheets: number;
      styleSamples: number;
      baseImageAttempts: number;
      layerPackageAttemptReserve: number;
      maxGeneratedImages: number;
    } | null;
    motionBudget: {
      maxPoseSheetCalls: number;
      maxStatesPerSheet: number;
      maxContinuousTargets: number;
    } | null;
    approvedImageBudget: {
      imageAttemptLimit: number;
      expectedProviderImageCalls: number;
      profileHardCeiling: number;
      approvedAt: string;
    } | null;
    imageBudgetRevisions?: Array<{
      schemaVersion: 1;
      fromLimit: number;
      toLimit: number;
      usedAtApproval: number;
      reservedAtApproval: number;
      profileHardCeiling: number;
      authorizedAt: string;
      humanNote: string;
    }>;
    requested: {durationSeconds: number | null; sceneCount: number | null};
    resolved: null | {
      durationSeconds: number;
      sceneCount: number;
      estimatedNarrationSeconds: number | null;
      rationale: string;
      resolvedAt: string;
    };
    updatedAt: string;
  };
  video: {width: number; height: number; fps: number};
  quality: {minimumAssetScale: number};
  theme: ProjectTheme;
  voice: {
    mode: 'fictional' | 'clone';
    provider?: string;
    voiceId?: string;
    profile?: string;
    displayName?: string;
    settings?: Record<string, string | number | boolean>;
  };
  audio: {
    narration: {volume: number};
    music: ProjectSound | null;
    mastering: ProjectAudioMastering;
  };
  editorial: EditorialSystem;
  worlds?: Array<{
    id: string;
    sceneIds: string[];
    requiredStripRoles: Array<'far' | 'mid' | 'ground' | 'near'>;
  }>;
  trajectoryContracts?: Array<{
    id: string;
    sequence: string[];
    assertions: Array<
      | {id: string; kind: 'state-at'; sceneId: string; proofTimeId: string; nodeId: string; stateId: string}
      | {id: string; kind: 'relative-order'; sceneId: string; proofTimeId: string; leadingNodeId: string; trailingNodeId: string; leadingSide: 'left' | 'right'; minimumGap: number}
      | {id: string; kind: 'travel'; sceneId: string; proofTimeId: string; nodeId: string; fromProofTimeId: string; toProofTimeId: string; direction: 'left' | 'right'; minimumDelta: number}
      | {id: string; kind: 'offscreen-at'; sceneId: string; proofTimeId: string; nodeId: string; side: 'left' | 'right'}
    >;
  }>;
  spatialContracts?: SpatialContract[];
  scenes: ProjectScene[];
  sceneTransitions: SceneBoundaryTransition[];
};

export type NormalizedSceneBoundaryTransition = SceneBoundaryTransition & {
  from: number;
  durationInFrames: number;
};

export type NormalizedProjectScene = Omit<ProjectScene, 'subtitles'> & {
  from: number;
  durationInFrames: number;
  narrationFrames: number;
  narrationStartFrame: number;
  enterTransitionFrames: number;
  exitTransitionFrames: number;
  enterTransition: NormalizedSceneBoundaryTransition | null;
  subtitles: NormalizedSubtitleCue[];
};

export type DerivedSceneTimeline = {
  durationInFrames: number;
  durationSeconds: number;
  scenes: Array<
    ProjectScene & {
      from: number;
      durationInFrames: number;
      narrationFrames: number;
      narrationStartFrame: number;
      enterTransitionFrames: number;
      exitTransitionFrames: number;
      enterTransition: NormalizedSceneBoundaryTransition | null;
    }
  >;
  transitions: NormalizedSceneBoundaryTransition[];
};

export type NormalizedProject = Omit<PaperCollageProject, 'scenes'> & {
  durationInFrames: number;
  durationSeconds: number;
  scenes: NormalizedProjectScene[];
  transitions: NormalizedSceneBoundaryTransition[];
};

export const normalizeProject = (project: PaperCollageProject): NormalizedProject => {
  const directed = applyResponsiveDirectingPlan(project);
  const {fps} = directed.video;
  const timeline = deriveSceneTimeline(directed);
  return {
    ...directed,
    ...timeline,
    scenes: timeline.scenes.map((scene) => ({
      ...scene,
      subtitles: scene.subtitles.map((cue) => ({
        from: Math.round(cue.fromSeconds * fps),
        to: Math.round(cue.toSeconds * fps),
        text: cue.text,
      })),
    })),
  };
};
