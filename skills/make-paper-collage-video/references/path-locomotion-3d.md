# Three-Dimensional Path Locomotion

Read this when a recurring subject must swim, fly, run, or otherwise travel
through arbitrary screen directions and optical depth in one continuous world.
This is the first-class route for curved travel with automatic heading,
perspective projection, dynamic depth order, and a bound limited-animation
cycle. It is not a pile of position/scale keyframes and rotated duplicates.

## Authoring Contract

Author two orthogonal treatments on the same target:

1. one or more `state-sequence` treatments define the registered locomotion
   family, state timing, `playback=loop`, and `cycles`;
2. exactly one `path-locomotion` treatment with
   `changeClass=path-travel` defines the route and camera decision.

The path treatment owns:

- `path.kind=cubic-bezier-3d`;
- `coordinateSpace=parent-normalized-depth`;
- one start point and one or more cubic segments;
- an explicit `z` on every point, where `-1` is far and `1` is near-camera;
- a normalized arc-length `progress` schedule from distance `0` to `1`;
- `orientation.mode=path-tangent`;
- the source artwork's `forwardAngleDegrees`;
- bounded heading smoothing and maximum turn rate;
- one `projection` contract for depth-distance weighting, far/near scale,
  opacity, blur, and dynamic depth-order span;
- `cameraFollow`, explicitly either one follow object or `null`.

The first path progress time equals the containing beat's `at`. Use progress
keyframes to ease or hold distance; do not bake timing into a dense list of
position samples. The runtime builds an arc-length table, so equal distance
progress produces visually even physical speed across segments and aspect
ratios.

The source state family has one canonical forward axis. `forwardAngleDegrees`
maps that axis onto the path tangent. Do not generate up/down/diagonal copies
merely to cover eight directions. Direction-specific states are justified only
when the silhouette or semantics truly change, such as a banking wing,
side-specific prop, or asymmetric face that rotation cannot preserve.

When optical travel materially changes the silhouette, the state treatments may
share one `pathViewBinding`. It partitions the registered family into disjoint
`planarStateIds`, `towardStateIds`, and `awayStateIds`, with at least two loop
states per group. `depthVelocityThreshold` chooses when optical motion becomes
readable, and `transitionWidth` defines a continuous blend around that
threshold. Every treatment in the same pose family must repeat the same
binding, and all referenced states must be authored in that family. This is
velocity-driven view selection, not a time-coded pose cut: a depth turn blends
through the planar loop before entering the opposite depth view while all
groups retain the same loop phase.

Derive loop `cycles` from the active travel window instead of using a short
fixed ceiling. For a `loop` family, choose at least
`ceil(minimumChangesPerSecond * activeWindowSeconds / stateCount)` cycles, then
raise it when visual review shows that the illustrated action needs a faster
cadence. Long one-take travel may therefore require dozens of cycles. The
authored and compiled state-sequence contracts accept any positive integer;
`once` remains exactly one cycle. The separate `motif-field` primitive retains
its bounded `0..12` cycle range.

## Runtime Ownership

`node.motion.path` owns additive parent-normalized `x`/`y`, optical `z`,
path-derived rotation, and depth projection. The target keeps its stable base
position in `transform.x/y`.
Therefore:

- the path target must be a `state-sequence`;
- its ordinary keyframes must not author `offsetX`, `offsetY`, or `rotation`;
- its static `transform.rotation` remains zero;
- its idle preset may only be `still` or `breathe`;
- one state loop, or three phase-synchronized view loops through
  `pathViewBinding`, supplies the swimming/flying/running cadence while the path
  independently supplies translation, heading, and the view blend.

Path tangent and arc length are resolved in physical parent pixels plus the
declared optical-depth distance scale, not square normalized space. This
prevents diagonal headings and depth speed from drifting across aspect ratios.
Heading is unwrapped across `-180/180`, smoothed, and rate-limited; a pure
toward/away segment retains its last readable screen heading instead of
inventing a turn.

## Coherent World and Camera Follow

Use one oversized top-level world node when the camera must follow the subject.
The path target is normally top-level. Inside a top-level
`looping-environment`, it may instead be that world's direct
`role=tracked`, `anchorMode=screen` subject; arbitrary nested or world-anchored
participants cannot drive the camera. `camera.follow` binds:

- `targetNodeId` to the path target;
- `worldNodeId` to that one coherent world surface;
- normalized subject framing;
- optional look-ahead and smoothing;
- fixed zoom;
- normalized `worldBounds`.

The runtime follows the same resolved path used by the subject and clamps the
viewport to `worldBounds`. Do not duplicate the route as camera keyframes, swap
backgrounds during travel, or combine follow with camera keyframes. A finite
pond, sky, room, or map uses this contract; a horizontally
repeating road still uses `looping-environment`.

## Executable Spatial Proof

Every path treatment requires one root `spatialContracts[]` record with
`kind=path-locomotion`. It binds the scene, path node, world node, start/end
proofs, explicit turn proofs, locomotion state ids, minimum cadence, minimum
travel, minimum optical-depth travel and projection-scale delta, required
toward/away directions, direction-sector coverage, maximum heading error,
maximum turn rate, and whether camera follow is required.
When a route has a hard visible boundary such as a waterline, ceiling, or
subtitle corridor, add `screenSafeBand`. The proof applies the complete
registered node canvas through its resolved scale and rotation at every sampled
frame, rather than checking only the subject center.

The deterministic evaluator samples every frame and proves:

- real three-dimensional travel over the requested proof window;
- required toward-camera/away-camera segments and visible projection change;
- the required subset of eight direction sectors;
- rendered heading against measured physical movement;
- frame-to-frame turn-rate bounds;
- the complete transformed registration canvas stays inside `screenSafeBand`
  when one is declared;
- state-loop cadence and continuation through the window;
- exact path/camera/world binding;
- a camera viewport that stays inside the declared world.

Temporal evidence is mandatory, not optional: the evaluator must observe the
contracted state ids actually rotating (not a frozen pose), signed path
displacement, heading/velocity consistency, and no backward or jitter-only
segments. Metadata or static endpoint crops alone fail. The same evidence is
packaged as a fingerprint-bound temporal motion strip consumed by the
whole-film motion review, so a stale strip cannot be reviewed as current.

For any left/right `travel-facing` contract, the rendered transform (rotation
and any horizontal mirror) must agree with the expected facing, the velocity
direction must agree with that facing, and the registered state family must
pass alpha-tight silhouette-facing consistency. A state whose metadata says
`right` while its pixels face `left` fails before human review.

For a velocity-driven `pathViewBinding`, do not hand-author
`proofTime.stateAssertions` that freeze a planar/toward/away state at a story
beat: sibling paths can legitimately have different depth velocities at the
same time. The path-locomotion contract owns frame-by-frame view-family and
cadence evidence. Ordinary, time-authored state sequences still require
explicit proof-time coverage for every state.

Style proof must include start, every declared turn, and end frames plus the
path/heading debug overlay. Human review then checks
`path-travel-clean`, `path-heading-readable`, `turn-continuity-clean`,
`depth-projection-readable`, `depth-order-clean`,
`camera-follow-coverage-clean`, and `locomotion-cycle-bound`. A passing render
alone is not evidence that the route, turn, cycle, and world contracts agree.

## Provider and Cost Rule

Generate the smallest complete registered locomotion family, preferably one
2×2 sheet for a four-phase planar loop. When optical silhouettes are required,
batch the planar, toward, and away phases into one dense registered sheet
instead of three unrelated provider families. Keep one shared canvas, anchor,
identity reference, and canonical forward axis for every cell. Reuse the
planar family at all screen headings; let `pathViewBinding` select front/back
cells only for real depth motion. Local splitting, registration, and
orientation correction are deterministic derivatives; they do not become
extra provider calls. If a cell needs provider repair, retain the complete
original sheet as context according to the normal state-family recovery policy.
