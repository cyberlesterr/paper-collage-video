# Motion Directing and Effect Routing

Read this while deciding how a story beat should move. The goal is not to maximize animation. The goal is to choose the smallest truthful mechanism that makes the approved meaning visible and reviewable.

## Bind Every Beat to the Whole-Film Grammar

Storyboard v12 owns one structured `motionDirection` before individual
treatments are selected. Declare whole-film pacing, ordered performance grammar,
anticipation/follow-through policy, pose strategy, minimum final hold, camera
strategy, transition strategy, and ambient strategy. If pacing differs from the
selected executable Style Profile, explain why in
`styleDeviationRationale`.

Assign every beat one `performanceRole` from `establish`, `anticipate`,
`action`, `follow-through`, `settle`, `hold`, or `transition`, in the global
grammar order. Every role binds a proof moment; `settle` binds the final proof
and preserves the declared final hold. `project:storyboard` compiles these
choices into `motionContract`; never hand-author that contract or restore
descriptive `style.motionLanguage` prose. Read `motion-contract-v1.md` for the
approval and whole-film quality rules.

## Start From the Visible Change

Do not begin with a renderer preset. For each beat, name what visibly changes:

| Change class | Required route | Typical examples |
|---|---|---|
| `static-hold` | `motion.kind=static` | readable tableau, deliberate ending hold |
| `ambient-motion` | `continuous-transform` | breathing, paper drift, floating question mark |
| `camera-change` | `continuous-transform` on `scene-camera` | push, pull, pan |
| `depth-parallax` | `continuous-transform` with `parallax-camera` on `scene-camera` | camera-coupled paper planes at authored depth |
| `depth-layer-separation` | `registered-depth-stack` with `bounded-relative` | complete rear plate, complete subject, and complete front overlay move within reviewed reveal envelopes; a full-silhouette subject may additionally use a proved `subjectTravelEnvelope` |
| `world-travel` | `looping-environment` with `scroll-world-x` | tracked vehicle remains readable while seamless mountains, trees, road, and near vegetation cross multiple horizontal wraps |
| `path-travel` | `motion.kind=path-locomotion` plus a separate looping `state-sequence` on the same target | swimmer, flyer, or runner follows a cubic 3D route, turns with its tangent, changes optical depth, and keeps cycling inside one coherent world |
| `pose-change` | `state-sequence` | hand moves from chest to pointing at a board |
| `prop-state-change` | `state-sequence` | page turns, cards change, book lowers |
| `contact-change` | `supported-subject` | person stands on a boat, book remains in hand |
| `shared-boundary` | `registered-environment` | elephant crosses a waterline, object passes behind a desk edge |
| `graphic-emphasis` | editable typography/shape node plus `continuous-transform` | question marks, circles, arrows, highlights, or a short audio-bound visual sound effect |
| `mechanism-state` | proof-bound treatment with `mechanism` or `diagram` risk | scale balance, force path, causal diagram |
| `visibility-change` | `visibility-transition` plus node `visibility.initial` | a question mark first appears, a card is removed, a label remains after entering |
| `decorative-field` | `motion.kind=motif-field` | bounded petals, dots, fragments, confetti, diagram accents |

A treatment has orthogonal dimensions. Motion (`static`, continuous transform,
state sequence, path locomotion, persistent visibility transition, or
deterministic motif field), composition (`free`, supported subject, registered depth stack, or
registered environment), graphic mechanism, and semantic risk can coexist. A
pointing child standing on a boat is both a state sequence and a supported
subject; do not collapse it into one exclusive effect label.

`depth-parallax` is not generic drift. It targets `scene-camera`, uses
`parallax-camera`, and requires visible camera movement plus at least two
distinct runtime `depth` values in `-1..1`. `0` is the focal plane. A rigid
coupled group owns one depth; its registered children must not repeat the
world-space parallax path. A `registered-depth-stack` is the only coupled
pattern whose rear/subject/front children own separate ordered depths and
bounded local motion. It is legal only after the compiler has locked the three
complete layer roles, shared canvas, source strategy, and 16:9/9:16/1:1 reveal
envelopes. A free group may add deliberate local depth only when that nested
separation is part of the approved design.

`motif-field` is decorative only. Author one target with preset (`drift`, `fall-drift`, `rise-drift`, `burst`, or `orbit`), distribution (`scattered`, `grid`, or `edge`), bounded `count<=64`, cycles, normalized placement `bounds`, and explicit rectangle/ellipse `exclusionZones` around titles, faces, labels, and explanatory data. `rise-drift` is the deterministic physical bubble primitive: every instance begins just below the field, moves monotonically upward, expands slightly, and hides its top/bottom respawn. Keep all fields in one scene at or below 192 instances. Runtime supplies a fixed integer seed, 1–8 reviewed motif sources, base size, and bounded scale/rotation/opacity variation. Placement uses deterministic bounded rejection with motif-footprint clearance; loop presets either close geometrically or hide the respawn edge. The renderer expands the instances deterministically; do not author a large array of individual asset nodes.

`world-travel` is persistent world geometry, not a larger `traverse` or a
motif loop. Author `axis=x`, direction, distance in viewport widths, strictly
ordered far/near speeds, ground strip, tracked subject, exact start phase,
and optionally `activeFrom` as a normalized action cue. Before that cue the
world is held completely still. Declare `activeUntil` when its complete
authored distance must ease to a terminal phase and remain locked for the rest
of the scene: it must be after `activeFrom`, freezes the resolved strip phase
and camera compensation after the cue, and requires both ordinary world-motion
proof and a `world-lock-clean` review. Without `activeUntil`, the distance
resolves by scene end. For a tableau that must stay still for its complete
duration, declare `world.frozen=true` instead; it is mutually exclusive with
both active-window cues, preserves depth order and strip coverage, and requires
a `world-lock-clean` review rather than movement/repetition checks. This is for
a real held tableau before travel, not a substitute for hiding a moving
background. Also author
ordered semantic strip roles, and before/seam/after proof ids. Every
`world-strip` resolves to at least one viewport width at its authored height.
The compiled plan must pass `project:world-topology-proof` before any
environment image call. This provider-free gate proves that the planned
geometry, depth-speed order, ground, subject anchoring, travel distance, and
three seam moments are structurally capable of producing the intended shot;
an attractive generated strip cannot repair a failed topology.
Each strip declares its visible surface role: backdrop, scenery,
walkable-ground, or foreground-occluder. The looping group also owns
`subjectBindings`: exactly one tracked subject plus any declared participants.
A subject chooses `anchorMode=screen|world`, its near-layer occlusion relation,
whether that relation requires real vertical overlap (`requireNearOverlap`,
default true), and the proof moments that must show it. Sparse low foreground
may disable overlap while retaining the declared z-order. Screen-anchored subjects remain in the
focal corridor; world-anchored markers and actors inherit the ground
displacement. This allows a starter, finish marker, or second racer to belong
to the same world and lets near strips genuinely occlude selected actors.
The renderer expands strip copies internally. Authors never place repeated
asset nodes.

When a narration cue identifies an encountered world participant, direct the
interaction as one `scene.encounters[]` contract with four ordered physical
phases: enter, approach, answer, and exit. Bind the cue only to answer and keep
the actor world-anchored through the whole lifecycle. Do not schedule several
possible animals at once and choose by opacity; the cue, target, phase events,
and actual narration timing must agree.

A deliberately motionless scene uses `motionPolicy=locked-static` plus a human
rationale and static-only treatments. This may recalculate only the
local-motion, parallax-scene, and ambient-scene floors for the remaining
eligible scenes. It never discounts required state families, layered scenes,
provider calls, or semantic actions.

At execution, one root world maps every strip role to a stable source asset
across its scenes. A route traveler also declares the inclusive proof window in
which it must fit the walkable safe band; use that window when a racer must
leave after a verified legal run. Use a `monotonic-travel` trajectory assertion
for a forward-only chase that may end in a true stop, rather than faking the
hold with a small backward correction.

Every `state-sequence` treatment declares the visible state's exact `facing`.
The compiler carries it into the registered family and provider-facing sheet
plan, rejects cross-scene reuse of one state id with conflicting facings, and
compares it with the runtime state record. Do not infer facing later from a
prompt or asset filename.

For a state family with an opening pose and later cyclic action, author the
same `playback` mode on every related treatment, then declare the family-level
`cycles`, `activeFrom`, and ordered `activeStateIds` on one of those treatments.
The compiler carries the resolved playback plan into the runtime contract and
rejects a composition whose registered state ids, timing, or playback drifts.
For a closing hold, declare paired `activeUntil` and `holdStateId`. If the
subject must visibly decelerate, land, or make contact before that hold, place
ordered non-active exit states beginning exactly at `activeUntil`; the runtime
plays them once and requires `holdStateId` to name the final exit state. Use at
least two alternating registered locomotion states for sustained walking,
running, flying, or swimming; a single pose with a moving background is not
locomotion.

Bind hero spatial truth separately in root `spatialContracts[]`. Use
`grounding` for foot/seat contact, optional foreground paint order, and optional
subtitle clearance; use `locked-contact` when the relative subject/support
vector must remain invariant. Use `continuity` for adjacent causal scenes that
must preserve world, recurring family, framing, camera, and both scenes'
grounding. Use `gait` as the generic locomotion-cadence contract for an action
window that must achieve a minimum registered-state cadence and continue
through its final proof. These contracts measure the assembled runtime tree;
moving a subject upward, assigning a large descendant z-index inside the wrong
stacking context, or letting `activeUntil` freeze early cannot satisfy them.

Use `travel-facing` whenever a state-sequence character moves horizontally
through the directional `traverse` preset. Bind the ordered proof window,
`left|right` travel direction, positive minimum travel, exact expected facing,
and a human-readable rationale, plus a matching `gait` contract for the same
scene and node. Runtime proof samples the assembled pre-camera path, rejects
backtracking, checks every active registered state's facing, and rejects a
moving character whose locomotion frames are not cycling. An intentional
backward or sideways-looking performance remains possible only by declaring
the differing expected facing and rationale explicitly. Do not classify an
in-place `settle` as travel merely because it has local pose motion.

Use `path-locomotion` instead when the same state-sequence must travel through
arbitrary screen headings or optical depth. Read `path-locomotion-3d.md`. Author the path and looping
state family as separate treatments on one target. The path owns arc-length
position and tangent orientation; the state family owns cadence. One
`path-locomotion` spatial contract proves eight-sector coverage as requested,
heading error, turn continuity, gait cadence, and the optional
camera/world binding. Do not also author `travel-facing`, duplicate x/y/rotation
keyframes, or bake a second copy of the path into the camera.

Use continuous preset `traverse` for a subject whose world-relative path must be
materially larger than camera drift; runtime validation requires a normalized
path span of at least `0.45`. Use preset `sway` with
`motion.idle.preset=sway` and a bottom-biased `motion.pivot.y>=0.8` for rooted
foliage. `motion.pivot` changes the transform origin without changing a
registered member's full-canvas placement or top-left registration.

## Author Intent, Compile Execution

Storyboard v12 input owns `motionDirection`, `beats[].performanceRole`,
`beats[].treatments[]`, any layer source-package
intent, plus the v9 editorial authoring intent. It does not own
`compositionPlan`, source-package cost totals, resolved edit points,
responsive/transition plans, `directing`, sheet layouts, style-proof planning,
risk ranking, or fingerprints. `project:storyboard` compiles those fields and
rejects hand-authored derived values. Read `layer-complete-assets.md` before
authoring relative layers and `editorial-system-v9.md` for edit-point bindings
and advanced editorial transitions.

Every treatment declares:

- stable `id` and runtime `targetId`;
- `importance`: `hero`, `supporting`, or `ambient`;
- `necessity`: `required` or `enhancement`;
- one `changeClass`;
- orthogonal `motion`, `composition`, and optional `graphic` intent;
- `semanticRisk` and a proof binding for identity/topology/mechanism/diagram risk;
- a concise rationale describing why this mechanism is truthful.

The compiler turns those declarations into patterns, relationships, state schedules, continuous-motion targets, persistent visibility events, graphic targets, risk scores, sheet plans, and fingerprints. Production implements the compiled plan; it does not reinterpret the prose.

## Allocate Motion Without Sacrificing Hero Actions

Creative Plan v4 gives each production profile two planning ceilings:

- `assetBudget`: quota-consuming image attempts, split into a compiled base and
  an explicit source-recovery reserve;
- `motionBudget`: pose-sheet calls, cells per sheet, and continuous-motion targets.

For a one-scene project the default hard ceilings are draft `4+2=6`, balanced
`4+4=8`, and full-depth `6+8=14` image attempts. Full-depth reserves two
independent pose-sheet families in a one-scene film when two recurring hero
identities need real alternate states; never combine unrelated identities into
one sheet to fit a scene-count heuristic. The profile ceiling is not
permission to spend automatically: concept approval binds the exact
`sourcePackageDecision` plus `budgetDecision.imageAttemptLimit`. The approved
cap must cover compiled expected calls, cannot exceed the profile ceiling, and
is the limit enforced by reservation and project validation. Per-strategy
source-package costs are defined once in `layer-complete-assets.md`; choose
full-context layer edits only when the provider cannot reliably return the
registered sheet.

When reducing cost or complexity, remove in this order:

1. ambient enhancement motion;
2. supporting enhancement motion;
3. extra intermediate states inside an enhancement family;
4. enhancement state families.

Never turn a `required` pose or prop change into rotation, scaling, or a static hold merely to fit the profile. If required families exceed the approved profile, the storyboard is invalid: raise the profile or reduce story scope at the existing concept gate.

All related states for one identity/prop family stay on one provider-generated
sheet. The compiler chooses 2×2 for up to four states, 3×2 for five or six,
4×2 for seven or eight, 3×3 for nine, and 4×3 for ten through twelve. Every
compiled grid must have at least as many cells as the approved family has
states; a full sheet may contain empty cells, but it may never silently omit
states. Empty cells are preferable to unrelated identities. Layer source
packages and pose sheets have separate compiled accounting but share the same
hard ceiling. Recovery is deterministic local reprocessing, then a masked edit
of the complete original source context, then complete-source regeneration.
Isolated replacement-layer or replacement-cell generation is forbidden.

## Representative Story Routing

For a story such as 《曹冲称象》:

- opening paper texture and slow parallax: `depth-parallax` on the scene camera with authored background/focal/foreground depths;
- Cao Chong changes from holding a book to pointing: one `cao-actions` state family;
- question marks and a bouncing circle: editable shape/text nodes with continuous motion, not new character poses;
- elephant boards the boat: an elephant state family plus `supported-subject` contact;
- the waterline or marked displacement line: `registered-environment` plus an editable shape;
- stones accumulate and the scale balances: mechanism-risk states with proof moments;
- a quiet conclusion: static hold with only restrained ambient motion.

This is a per-beat decision. One film can intentionally use all mechanisms; a simple title film may use only free layers and continuous transforms.

## Keep Comic Text Native to Video

Do not bake dialogue, explanation, or narration into generated speech balloons.
The audio track carries speech and the subtitle surface carries readable text.
This prevents duplicated language, unreadable provider text, and subtitles
competing with balloons.

Use `graphic.role=visual-sfx` only for a discrete impact or motion sound that
benefits from a brief on-screen word such as `咚！`, `砰！`, or `嗖—`. It must:

- use `kind=typography` and `sfxKind=impact|motion`;
- contain 1–8 characters and use `stamp`, `shake`, or `drop-impact`;
- bind `audioBinding=beat-sound-cue` and the same beat's non-empty
  `soundCue`/`proofTimeId`;
- stay inside the selected Profile's `allowedKinds`, duration range, and
  `maxPerScene`;
- exist as an editable `role=visual-sfx` typography node, initially hidden,
  with synchronized show/emphasis/sound/hide events.

Wind, rain, traffic, crowd, room tone, and other environmental beds normally
remain audio-only. The style proof must include `graphic:visual-sfx` whenever
one is authored. Avoid decorative repeats, subtitle overlap, subject
occlusion, and any use that makes the frame read like a static comic page.

## Direct Scene Boundaries Separately

Scene boundaries are whole-film editorial decisions, not node reveal effects. Declare exactly one top-level boundary per adjacent pair with an editorial `intent` and a concrete `rationale`. Prefer intent-only authoring and let `project:storyboard` materialize the default recipe:

The concrete recipe comes from `styleProfile.motion.transitionSet`. The two
sets preserve the same narrative intent while changing only the visible
surface:

| Intent | `paper-story` | `clean-video` | Use |
| --- | --- | --- | --- |
| `continuity` | `slide`, paper edge, 0.45s | `slide`, clean edge, 0.4s | Same action or thought continues |
| `location-change` | `wipe`, paper edge, 0.5s | `wipe`, clean edge, 0.45s | The viewer moves to a new place |
| `time-passage` | `page-turn`, paper edge, 0.7s | `dip`, clean cover, 0.5s | A later moment or summarized interval begins |
| `focus-reveal` | `iris`, paper edge, 0.55s | `iris`, clean edge, 0.45s | Attention narrows onto a newly important subject |
| `chapter-reset` | `shutters`, paper edge, 0.65s | `dip`, clean cover, 0.55s | A chapter or tonal unit closes before the next opens |
| `impact` | `cut`, `motivation=impact`, 0s | `cut`, `motivation=impact`, 0s | A deliberately abrupt shock, reveal, or comic hit |

Narrative intent and execution treatment are separate. The neutral runtime
types are `cut|wipe|dip|slide|iris|page-turn|shutters`, with optional
`edgeStyle=clean|paper|torn`; `torn` is legal only for `wipe`. Any ordinary
intent may instead use `type=cut`, `motivation=rhythmic`,
`durationSeconds=0`, and a `beatId` that resolves to the outgoing final 20% or
incoming first 20%. Impact cuts use the `impact` intent and
`motivation=impact`; do not mislabel a rhythmic edit as semantic impact.
Spatial types reveal a fully opaque incoming scene through a hard clip or
translation; cover types swap scenes only during a guaranteed fully opaque
plateau. Never alpha-crossfade semantic scenes, and never simulate a vertically
scrolling long-comic reader. Budget the complete animated duration in both the
outgoing tail and incoming narration lead.

## Proof and Review

The compiler ranks treatments by semantic risk, discrete-state complexity,
composition coupling, importance, and necessity, then compiles a
`styleProofPlan`. The plan requires coverage for the highest semantic-risk
classes, each concrete coupled relationship, state-sequence behavior, and
motif-field behavior, and greedily reuses one source family where it can prove
multiple facets. Looping worlds additionally require source/render-scale RGB
and alpha seam proof, visible full-span semantic surfaces, real ground support
at both repeat edges, three-ratio worst-phase coverage, signed
camera-compensated world displacement, every declared subject's anchor
behavior, and its requested near-layer occlusion relation. If a film has no such high-risk facet, the highest-ranked
treatment becomes one `baseline:representative` target so the style gate never
becomes empty. `project:style-proof` renders every selected target and binds the report
to the plan fingerprint. A depth stack is proven as one family through neutral
reconstruction, reference comparison, exploded checkerboard, and both extremes
of every responsive reveal envelope; isolated-member motion stress is not
sufficient. Parallax rigs and motif fields also become fingerprinted composite
quality targets. A changed treatment, source package, reveal envelope, camera
rig, depth map, seed, field source, density, bounds, exclusions, or runtime
implementation invalidates the relevant evidence.

Final reports state the number of pose-sheet provider calls, deterministic state derivatives, and isolated calls avoided. Savings count only when provenance proves that one provider result produced multiple local derivatives.
