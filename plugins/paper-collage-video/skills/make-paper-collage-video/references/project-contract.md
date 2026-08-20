# Project Contract

Read this only when creating/changing project files or diagnosing validation/state.

## Sources of Truth

| File | Purpose |
|---|---|
| `brief.md` | Human intent, audience, facts, format, style, rights, prohibitions |
| `production.json` | State, approvals, coarse work batches, artifacts, event history |
| `production-metrics.json` | Versioned wall-clock segments and observation-window summaries for production monitoring |
| `storyboard.json` | Approved schema-v12 motion direction, beat performance roles/treatments, editorial authoring, scene boundaries, layer source packages, and compiler-owned motion/edit/directing/proof plans and fingerprints |
| `motion-language-card.json` | Human-readable whole-film action grammar, pacing, scene phrases, final holds, exceptions, and approval/execution fingerprints |
| `dist/<slug>/visual-blueprint/index.json` | Same-source low-resolution full-film animatic, every-scene keyframes, motion clips, source coverage, and exact geometry/timing/runtime fingerprint |
| `visual-blueprint-review-request.json` | Hash-bound list of the current visual artifacts that must be shown to the human |
| `visual-blueprint-review-receipt.json` | Host-attributed current user-message decision bound to that request |
| `visual-blueprint-approval.json` | Attributable human approval of the current visual blueprint |
| `motion-approval.json` | Attributable style/voice-gate approval binding the human note, Style Profile, motion fingerprints, and visual blueprint |
| `project.json` | Frozen executable Style Profile, compiled motion contract, materialized theme, Creative Plan v4 ceilings/cap/source-package decision, exact provider-root plan, and v12 Remotion execution tree |
| `sound-effect-plan.json` | Deduplicated compiled sound cues, provider outputs, and exact scene/beat/event bindings |
| `requests/*.json` | Per-output generation/import request plus exact style/composition/provider-root binding |
| `semantic-contracts.json` | Reusable identity, topology, mechanism, diagram, and evidence-target invariants |
| `generation-attempts.jsonl` | Append-only quota reservation and real provider-attempt outcomes |
| `failure-circuit.jsonl` | Append-only command/provider/human-review failures and explicit circuit resolutions |
| `assets-manifest.json` | Provider provenance, source families, fingerprints, hashes, and active/superseded/rejected/recovery-source lifecycle |
| `world-topology-proof.json` | Provider-free current-world structure proof required before any looping-environment image attempt |
| `quality-report.json` | Hash-bound current asset/composite quality plus non-current asset history |
| `dist/<slug>/assets-ready-seal.json` | Current project, runtime, storyboard, validation, quality, audio, and subtitle delivery fingerprints required by preview/final rendering |
| `review.md` | Generated approval summary plus natural-language revision history |

Never ask the human to edit machine JSON. Paths in `project.json` are relative to `public/`; production artifacts are relative to the workspace root. A confirmed project must carry `intake.schemaVersion=2` plus a complete `styleProfile` snapshot whose catalog/profile fingerprints still match the current built-in catalog. Pending intake must keep `styleProfile=null`.

`production-metrics.json` records wrapped command time, human quality-review sessions, and image-attempt windows. Current visual decisions appear under `summary.byCategory["human-review"]`; the legacy `summary.aiReview` field remains an explicit measurement of any automated review work and should normally stay zero for visual pass/fail. Review sessions include evidence presentation and the wait until the human decision; image attempts likewise include the full reserve-to-close window. The runtime does not estimate provider-only inference time or tokens when the host does not expose them. `summary.unattributedMs` is deliberately unlabeled because it can contain human waits, agent work, or uninstrumented operations. A lazily created file for an older project reports partial coverage.

## Normal State Path

| Stage | Successful action | Next |
|---|---|---|
| `capability-review` | `project:intake`, `project:scenarios`, then `project:confirm-concept` | `style-review` after intake and combined scenario/profile/budget/provider approval |
| `style-review` | one style sample + displayed `project:visual-blueprint`, then `project:visual-review ... approve` with a current human receipt | `asset-production` |
| `asset-production` | `project:assets-ready` | `preview` |
| `preview` | successful `project:preview` | `human-review` |
| `human-review` | `approve-preview` | `final-render` |
| `final-render` | successful `project:render` | `complete` |

The combined confirmation is the normal path. The visual blueprint is the
single existing style/voice decision surface, not a new stage. Composition and
technical proofs remain machine evidence inside asset production, not another
human gate.

`complete` is the only local terminal stage. After a human separately authorizes
a named external destination/action, `approve-publish` records that exact
authorization while leaving the stage at `complete`; it is an audit event, not
an additional stage.

After `request-preview-revision`, a directing-only change uses
`project:revise-preview-directing`. It preserves approved concept/style
semantics, recompiles the edited authoring fields against the existing motion
budget, synchronizes the changed execution tree, and writes storyboard,
project, revision report, and production state as one transaction. If a new
state/source cannot be inferred, a scoped `--execution` candidate must provide
it; unresolved or out-of-scope execution changes fail before any write. The
command invalidates old render/proof artifacts and creates revalidation work
items. Concept, factual, provider, or production-profile changes still require
their owning approval path.

An explicitly approved image-budget increase after concept approval uses
`project:increase-image-budget`. It leaves the production stage and original
scenario binding unchanged, updates only the exact approved total cap, and
appends `plan.imageBudgetRevisions[]` with the previous/new limits,
used/reserved counts, profile ceiling, timestamp, and human note. The command
is increase-only and rejects missing approval, broken revision chains, or a cap
above the current profile hard ceiling. Never hand-edit the machine plan.

Those post-revision validation work items are delivery gates, not advisory history.
`project:assets-ready` may atomically complete pending/in-progress
`directing-revision-*` items only after the current seal proves that the
storyboard and project execution tree are synchronized and all dependent
validation surfaces pass. It rejects every unrelated unfinished item and every
blocked item. `approve-preview`, preview rendering, and final rendering reject
any remaining unresolved work item, so a stale checkpoint cannot coexist with
an approved or delivered film.

When the human explicitly authorizes scene-scoped semantic changes, use
`project:revise-preview-semantic --authorization=<file>`. The authorization
names the exact scenes and evidence. The command preserves the approved
provider budget, rejects unauthorized story/style changes, records the concept
fingerprint delta, and invalidates every dependent style, proof, preview, final,
report, and contact-sheet artifact. A `locked-static` scene may lower only the
three motion-scene floors recorded in `profilePromiseRevision`; state-family,
layer, call, and semantic-action promises remain fixed.

`project:visual-review ... approve` requires a current schema-v2 visual
blueprint, its hash-bound review request, a host-attributed user-message receipt,
and exactly one active story-specific style sample. A free-text
`approve-style-voice` note, blanket autonomy, user absence, silence, or a
machine result cannot mint approval. The blueprint contract is derived from
the final schema-v12 execution tree while omitting only replaceable source
paths, hashes, and provider provenance. It therefore binds every scene,
duration, transform, z-order, camera, state-facing/playback schedule, path,
event, proof time, and transition to the current runtime. The renderer retains
real sources already present and substitutes deterministic labeled proxies only
for missing production sources. The review package contains a complete
low-resolution animatic, start/middle/end frames for every scene, and short
clips for motion-bearing scenes. The blueprint records whether current project
audio was retained or which narration/music/event sounds were omitted or
replaced by silence. Machine checks establish coverage, existence, hashes,
freshness, and this disclosure only; a human makes the visual decision after
the media is actually displayed. Approval atomically writes the review receipt,
`visual-blueprint-approval.json`, `motion-approval.json`, and production state. Every
non-style-sample provider request and `project:assets-ready` require that
approval to remain current. Replacing a proxy with a real source is legal;
changing the visual contract requires a new blueprint and human decision.

A mixed-surface registered sheet records the untouched provider-native RGB/RGBA
file as the provider root. `assets:derive-registered-family` is the only formal
path for explicit cell rectangles, separator removal, chroma-key-to-alpha,
registration-canvas scaling, key metadata, and the three local member records.
A resized/keyed project copy must never be recorded as though it were the raw
provider result.

Provider-native chroma cells use an observed key-plane contract. The request
declares `provider-native-observed/flat-v1`; the manifest records the requested
color separately from the accepted observed color and binds the observation
statistics to the source SHA. A historical rejected output can enter derivation
only as a `recovery-source` record produced by
`provider:recover-rejected-source`, never by hand-editing the manifest or
ledger. Its original attempt stays rejected and consumed.

Every manifest mutation uses the shared transaction helper: acquire the project
manifest lock, reread the complete current file, mutate and validate the whole
result, write a same-directory temporary file, then atomically rename it. This
prevents concurrent provider recording and deterministic derivation from
silently overwriting one another. A crashed stale lock may be recovered by the
helper; external code must not bypass the transaction with a stale read/write
pair.

## v12 Project, Motion Contract v1, v9 Editorial, Composition, and Boundary Tree

Schema v12 is the only supported Project, Storyboard Authoring, and Compiled
Storyboard contract. Creative Plan v4 owns the approved profile, its planning
ceiling, and `approvedImageBudget`: the narrower exact attempt cap authorized by
the human. Creative Plan v4 is a section **inside `project.json`** — there is no
separate `creative-plan.json` file. The storyboard compiler owns
`directingSummary.generationBudget`, including exact structural source-package
calls, pose-sheet calls, reserve, local derivatives, and avoided calls. Concept
approval requires an exact `sourcePackageDecision`, which is a four-key
projection of that budget (`requiredProviderImageCalls`,
`expectedProviderImageCalls`, `hardCeiling`, `sourcePackagePlans`) — not the
whole `generationBudget` object. Do not rebuild it by hand: take it from
`project:storyboard -- <slug> --input=<file> --json`, or let
`project:confirm-concept -- <slug> --scaffold` emit the entire selection file.
Concept approval also requires `budgetDecision.imageAttemptLimit`; it records
expected calls and the profile ceiling at approval time.

### What each call count includes

The scenario card and the compiled storyboard deliberately count on different
bases, so their numbers are not expected to match. Reconciling them by hand is
the wrong move — take each from its own owner.

| Field | Owner | Style sample | Pose-sheet calls | Pose-sheet avoided calls |
| --- | --- | --- | --- | --- |
| `providerEstimate.expectedImageCalls` | scenario card | included (always 1) | included | — |
| `providerEstimate.avoidedCalls` | scenario card | — | — | included |
| `generationBudget.requiredProviderImageCalls` | storyboard | **excluded** | included | — |
| `generationBudget.expectedProviderImageCalls` | storyboard | **excluded** | included | — |
| `generationBudget.avoidedCalls` | storyboard | — | — | **excluded** |

On the storyboard side `expectedProviderImageCalls` is by construction equal to
`requiredProviderImageCalls`; there is no reserve added between them. The one
style sample is authorized separately at the style gate, which is why the
storyboard budget never carries it. `generationBudget.avoidedCalls` counts only
what layered source packages avoid; the isolated-state calls a pose sheet avoids
are reported by the scenario card and by `summary.directing.avoidedIsolatedStateCalls`.

Provider requests cannot silently add or change a
layer package afterward, and storyboard call-count drift invalidates the budget
approval. A scene has
`composition.nodes`; nodes are recursive `asset`, `state-sequence`,
`typography`, `shape`, `annotation`, `data-graphic`, `editorial-switch`,
`motif-field`, `world-strip`, or `group` records. Transforms are normalized to
the immediate parent. Node keyframes use additive normalized
`offsetX`/`offsetY`; `transform.x`/`transform.y` remain absolute placement and
camera keyframe `x`/`y` remain pixels. Older projects are not parsed or migrated;
regenerate their equivalent output from the latest contract when needed. There
is no legacy loader, dual schema, deprecated field, compatibility adapter, or
version-conditioned renderer branch.

Layer-capable planning and storyboard source-package strategy names and
per-strategy call/derivative costs are identical and defined once in
`layer-complete-assets.md`; the scenario compiler rejects any hand-authored
provider/local/avoided count that disagrees. Planning additionally counts an
ordinary `single-background` as one call with no derivatives; it is not copied
into the compiled layer-package decision. A low-resolution registered sheet is
not made acceptable merely because its members preserve a complete canvas;
viewport-filling members must also retain sufficient provider-native pixels at
their maximum display scale.

Every scenario-bound plan compiles one fingerprinted `providerRootPlan`. It has
exactly one root for the story-specific style sample, every
`single-background`, every role/call of each structured source package, and
every provider pose sheet not owned by a canonical container. Its root count
must equal `expectedProviderImageCalls`; an estimate without that exact
inventory is not executable approval.

Every scenario-bound `provider-generation` or `provider-edit` image request
binds exactly one current root through `scenarioRootBinding`. The request must
also match that root's scene, source package/role, or pose family. A
`manual-import`, local SVG/Canvas drawing, deterministic derivative, unrelated
provider output, or stale plan binding cannot fulfill a root. At
`project:assets-ready`, every root must resolve exactly once to an active
provider record or a formally registered rejected-output `recovery-source`.
Missing, duplicate, manually substituted, unknown, or stale roots are hard
errors and are included in the assets-ready seal.

For a scenario-bound plan, the generic scene-count motion budget is only the
minimum baseline. `project:plan` may raise `maxPoseSheetCalls`,
`maxStatesPerSheet`, and `maxContinuousTargets` to the exact selected scenario
demand, because one continuous shot can contain several independently animated
identities. This does not authorize extra storyboard content: the selected
scenario fingerprint, exact family/state/source-package comparison, provider
estimate, approved attempt cap, and profile hard ceiling remain authoritative.

Storyboard authoring owns one structured `motionDirection` plus one
`performanceRole` and `proofTimeId` per beat. The compiler owns
`motionContract`; it binds the Style Profile, per-scene phrase/treatment
coverage, transition recipes, and compiled editorial fingerprint. Its
`approvalFingerprint` covers stable human-visible motion semantics, while its
full `fingerprint` covers exact execution. Do not restore the superseded
`style.motionLanguage` prose field or hand-author either fingerprint. Read
`motion-contract-v1.md` for approval, revision, runtime, and whole-film quality
rules.

`node.motion.path` is the first-class finite 2D route primitive. It uses one or
more parent-normalized cubic Bézier segments, an arc-length progress schedule,
and path-tangent orientation with a canonical source-forward angle, smoothing,
and a maximum turn rate. It is valid only on a `state-sequence`; ordinary
keyframes may not compete for x/y/rotation, static rotation remains zero, and
idle is restricted to `still|breathe`. Geometry resolves against physical
parent width/height so 16:9, 9:16, and 1:1 preserve truthful tangent heading.
Read `path-locomotion-3d.md` for authoring and proof.

A top-level `supported-subject` or `registered-depth-stack` group may explicitly
declare `renderParticipation=derivation-only` when it exists only to bind a
registered technical source family. The renderer omits that complete subtree;
it cannot satisfy profile/directing promises, receive events or proof
assertions, or act as semantic/style evidence. Do not use `opacity=0` as this
contract. Visible derived consumers own composition, occlusion, depth,
responsive, and semantic review; the derivation-only family owns deterministic
completeness, provenance, and derivation integrity.

A top-level visible `registered-depth-stack` may instead declare
`stackingContext=scene` when an external scene subject must sit between its
registered planes. This does not loosen registration: the group may define one
static axis-aligned x/y/width/height/anchor layout carrier, but it cannot
animate, rotate, scale, fade, declare visibility, or create an isolated stacking
context. All three members retain the shared registration and reveal envelopes,
are laid out against the carrier's actual pixel dimensions, and use unique
integer `z` values that participate directly in the scene stacking order.
Spatial contracts remain the authority for required front occlusion.

`theme` is not free-form authoring after intake: it must equal
`styleProfile.render.theme`. The schema-v2 Profile owns palette plus a neutral
`surface` contract: optional texture, optional subject edge, and optional
subject shadow. Paper Profiles opt into paper texture/outline/shadow; comic
Profiles may set all three to `none`. The renderer must not add paper grain,
white cutout borders, or paper shadows when the selected surface disables them.
`theme.canvas` is a required opaque six-digit hex color. The renderer places it
beneath every scene-specific background and uses it as the dip cover, so even a
translucent scene treatment cannot expose pixels from the outgoing scene.

Subtitle typography is a scene surface, not a reason to mutate the frozen Style
Profile theme. `scene.appearance.subtitles` may independently declare a
non-empty `fontFamily`, integer `fontWeight` in `400..800`, and
`edgeTreatment=soft-shadow|crisp-outline|none`. Omitted fields preserve the
theme-backed legacy appearance. Use a screen-oriented Chinese font stack and
`crisp-outline` or `none` when small encoded previews make decorative serif
details or blurred shadows unreadable. The subtitle contract fingerprints and
reports the resolved typography for every narrated scene.

`narration.text` is also the lossless subtitle transcript. Whitespace is
ignored for narration/subtitle equality but retained on screen, so a
punctuation-free transcript must preserve single spaces at intentional phrase
boundaries. Subtitle derivation uses those spaces as preferred breakpoints and
balances a remaining unspaced run across the fewest legal cues; do not delete
both punctuation and spacing and expect sentence boundaries to be recoverable.

`state-sequence` is the first-class limited-animation primitive. It owns one `poseFamilyId`, a shared registration canvas, an `anchorPolicy`, ordered states, playback (`once`, `loop`, `ping-pong`), and a `cut` or bounded `crossfade`. Every authored state treatment and compiled state declares facing, normalized anchors, and an identity-reference asset id plus SHA-256. The compiler rejects one pose-family/state id reused with conflicting facings. The state-sheet processor verifies the current identity asset, rejects anchor drift, and writes fingerprinted per-state anchor overlays before registering derived cells. A reviewed left/right source state may be deterministically mirrored as a complete registered-cell derivative; the processor flips its anchors, records source/output facing plus provenance, and does not count that local correction as a provider call. A loop may declare `activeFrom` and ordered `activeStateIds` to keep authored prelude poses until the selected registered locomotion cycle starts; it may additionally declare `activeUntil` and `holdStateId`. The cycles are distributed only across that active window. With no later non-active states, the renderer switches directly to the hold. With later non-active states, the first must begin exactly at `activeUntil`, the renderer plays the ordered brake/landing/contact exit sequence once, and `holdStateId` must name its final state. Continuous transform/emphasis motion applies once to the node while the renderer selects registered visual states internally. Never replace this with overlapping assets and hand-authored opacity toggles.

One `poseFamilyId` denotes one registered provider state sheet even when a continuous scene uses multiple temporal node instances of that family (for example, a sleeping identity and its later chase). `directingSummary.poseSheetPlans.targetIds` must expose every reuse target, while provider demand, state-sheet calls, and the state-capacity ceiling count the shared family only once. This preserves truthful provider cost evidence without forcing a project-specific animation workaround.

Camera-coupled parallax is a first-class rig. Set
`camera.parallax={enabled:true,strength,focalDepth}` and assign relevant nodes
`depth=-1..1`. A valid `camera.follow` rig counts as visible camera
movement for parallax validation; do not add a second camera keyframe timeline
to a followed shot.
The renderer composes the global camera once and then adds a
deterministic depth-relative offset/scale to each carrier. A valid rig has
visible camera translation or zoom and at least two distinct depth levels.
Coupled `supported-subject` and `registered-environment` children must not
declare their own depth: assign depth to the group so contact, registration, and
masks remain stable. A `registered-depth-stack` is the deliberate exception:
its exact rear/subject/front children own strictly increasing depth and may have
bounded relative motion because their complete source package has been proven
against responsive reveal envelopes.

`camera.follow` is the optional camera half of path locomotion. It binds one
top-level path target, or the direct tracked screen subject of a top-level
`looping-environment`, and one top-level oversized world node, normalized
framing, look-ahead, smoothing, zoom, and normalized world bounds. Runtime
samples the target's exact resolved path and clamps the camera viewport inside
that world. It is mutually exclusive with camera keyframes and must not be
approximated by duplicating the subject route.

`motif-field` is a first-class decorative node. It owns reviewed motif sources, fixed seed, bounded count, distribution, internal motion preset/cycles, base size, variation ranges, required normalized `bounds`, and explicit rectangle/ellipse `exclusionZones`. Runtime placement uses bounded deterministic rejection with motif-footprint clearance, so title, face, and explanatory-data zones are reproducibly protected. One field expands at most 64 instances; all fields in one scene may total at most 192. `fall-drift`, `rise-drift`, and `burst` hide their wrap point, while `drift` and `orbit` close geometrically; `cycles` affects every preset. `rise-drift` computes a deterministic monotonically upward bottom-to-top lifecycle with slight expansion. Optional `worldBinding` names one top-level `looping-environment`, one existing strip role, and a bounded `relativeDriftAmplitude`; runtime then disables duplicate camera travel, applies the selected strip's signed world displacement per instance, wraps each instance inside the field bounds, and preserves only the small local drift. Configuration, exclusions, source files, world binding, and loop proof are fingerprinted. A motif field is not a semantic crowd, identity family, or substitute for generated pose states.

`world-strip` is valid only as a direct child of `looping-environment`. One
semantic node binds one active deterministic strip derivative, declares a
visible `surfaceRole`, and lets the renderer own repeated internal copies. The
derivative may declare a fingerprinted `alphaFeather` with non-overlapping
top/bottom pixel ramps when one strip must gradually take over from another
depth layer; the ramp is applied before canonical and render-scale seam proof
and is preserved in the manifest binding. It is not a generic opacity patch.
The
group owns horizontal world travel, ground reference, seam proof ids,
depth-derived speed range, overscan, start phase, and explicit
`subjectBindings`. It contains at least two strips, exactly one tracked
asset/state-sequence/group, and zero or more participant
assets/state-sequences/groups. A group participant receives the world offset
on its carrier; its registered support, subject, and front occluder remain
inside that group rather than becoming independently scrolling nodes.
Subjects independently choose screen or world anchoring and their relation to
the near strip. `requireNearOverlap` defaults to true for a requested physical
occlusion. Set it to false for sparse or low foreground decoration when the
subject must remain behind that layer in z-order but should not be forced to
intersect it merely to satisfy proof. Camera/parallax offsets are folded
into strip phase and safe internal scale; they must never translate or shrink
the viewport-sized carrier into an uncovered edge. An authored-and-compiled
`travel.activeUntil` is the optional terminal cue for a travelling world: the
phase advances only in its `activeFrom..activeUntil` window, applies its
declared easing, then remains at the completed phase. The renderer also stops
camera compensation at that terminal lock. Such a world must pass ordinary
seam/coverage/depth/repetition proof and `world-lock-clean` evidence at every
later proof moment. `travel.frozen=true` is the deliberate exception for a
still tableau that reuses registered strip assets: it locks world phase and
ignores camera offsets while retaining layer order; it must not be used to fake
a moving world. A frozen travel is mutually exclusive with both active-window
cues, and its quality review uses `world-lock-clean` rather than
motion/repetition checks.

`scene.encounters[]` is the executable narration-to-world encounter contract.
One record binds a tracked traveler, one world-anchored target, the owning
looping environment, exactly one narration cue, ordered
`enter`/`approach`/`answer`/`exit` beat ids, travel-consistent entry/exit edges,
minimum world displacement, and a cue tolerance. The four corresponding
project events bind the same contract and target; only `answer` binds the cue.
Validation checks actual narration timing, rejects a cue bound to a different
animal, and forbids target visibility events so a continuous-world actor cannot
appear or disappear by opacity teleport.

A root `worlds[]` contract binds every participating scene to one four-role
source map. Each `far`/`mid`/`ground`/`near` `world-strip` must reuse that
role's declared `loopingStripBinding.sourceAssetId`; matching role names alone
are insufficient to claim a continuous world. Each route traveler declares an
inclusive `fromProofTimeId`/`throughProofTimeId` safe-band window. It is in the
walkable band throughout that window, and may then be proven to leave frame
without falsely failing the route constraint. Use `monotonic-travel` when a
chase must never reverse: it samples every authored `offsetX` keyframe between its
proofs, permits a final zero-motion hold, and rejects any backward segment.

Root `spatialContracts[]` is the executable spatial-truth layer shared by the
Storyboard and Project. It has five kinds:

- `grounding` binds one scene, subject, support, at least two proof ids, a
  normalized or registered state anchor, an explicit support polyline, gap and
  penetration tolerances, an authored screen-space vertical support band, and
  relative-drift tolerance. Optional
  `frontOcclusion` binds the real cross-group paint relation and alpha overlap;
  optional `subtitleClearance` binds alpha-tight visible bounds to the active
  responsive profile's `role=subtitle` exclusion zone.
- `continuity` binds adjacent outgoing/incoming proof moments, typed world,
  subject, prop, or support node pairs, visual-family/framing tolerances, camera
  tolerances, and grounding contracts from both scenes. Use it for collision to
  pickup, action to aftermath, or any causal cut where a new field, stump,
  character scale, or resting location would be a false discontinuity.
- `gait` is the generic locomotion-cadence contract. It binds a state-sequence,
  proof window, at least two registered walking/running/flying/swimming states,
  a minimum state-change rate, and whether cycling must continue through the
  window end. It rejects a pose that freezes before the shot ends even if the
  background continues moving.
- `travel-facing` binds a horizontally moving state-sequence, ordered proof
  window, signed direction, minimum travel, exact expected facing, and rationale.
  It samples the assembled pre-camera path, rejects reverse segments, and checks
  every active state. A state-sequence target using directional `traverse` must
  have this contract plus a matching `gait` contract for the same scene and
  node, so legal metadata alone cannot approve a backward-facing or frozen
  moving character. An in-place `settle` does not require a travel contract.
- `path-locomotion` binds one state-sequence and coherent world, ordered
  start/turn/end proofs, requested locomotion states and cadence, minimum
  physical travel and 8-sector direction coverage, heading-error and turn-rate
  ceilings, and optional required camera follow. It samples every frame and
  proves route, tangent, turn, state loop, camera binding, and viewport/world
  coverage together; do not add redundant `travel-facing` or `gait` contracts
  for the same 2D path.

`project:storyboard` copies the array into `project.json`; project validation
rejects drift. The directing fingerprint, composition-proof target, runtime
surface fingerprint, and quality review all include the contract. These are
validation/proof contracts over ordinary composition nodes, not a
project-specific renderer branch.

A continuous `traverse` target must span at least `0.45` in normalized parent
space. A continuous `sway` target must use the `sway` idle primitive and a
bottom-biased motion pivot; the pivot is independent of registration placement.

The v9 `editorial` contract is also first class. It binds final local audio and timing evidence to cue/edit-point/binding plans, declares reusable typography/annotation/data/switch nodes, compiles three responsive directing plans, and compiles dimension-specific advanced transitions. Read `editorial-system-v9.md` for timing, layout, anchor, descriptor, quality, and proof requirements. Project validation compares the compiled editorial fingerprint with the Storyboard, verifies audio SHA/duration/timing data, checks actual transition targets against match descriptors, and rejects hidden renderer-only aspect-ratio behavior.

When a family needs multiple generated states, create one registered state sheet where practical and run `assets:process-state-sheet`. `generationFamily.identityMemberIds` identifies the recurring character(s) governed by identity contracts, while `generationFamily.stateMemberIds` names the complete ordered pose cells; never overload one list for both meanings. Every state keeps the same destination canvas; trimming individual silhouettes would destroy registration and cause visible jumping. The processing spec owns the complete chroma-key contract (`keyColor`, transparent/opaque thresholds, edge feather, matte erosion, and transparent-RGB edge padding); the processor must execute those exact values and fingerprint them rather than substituting internal defaults. If an otherwise usable provider sheet preserves clean gutters but a full silhouette crosses a nominal equal-grid boundary, the processing spec may declare `extraction.mode=explicit-source-rects`: one non-overlapping in-bounds source rectangle per state, a common destination canvas, and a placement for each rectangle. This is a deterministic full-sheet derivative and must not mix neighboring poses or count as a provider call. The derived records share a family fingerprint and do not count as additional provider calls. A failed cell is first reprocessed locally. Provider repair must be a masked edit of the complete original sheet and quality proof must show untargeted cells remained unchanged. If that cannot be guaranteed, regenerate the complete sheet. Independent replacement-cell generation is invalid for a multi-state family.

A `supported-subject` or `registered-depth-stack` raster family is authored with
registered-family schema v2 and materialized by
`assets:derive-registered-family`. Its three active manifest records carry a
strict `registeredFamilyBinding`: family/registration/source-master/source
package ids, common canvas/origin, role/slot/node id, source strategy and
lineage, completeness, reveal envelopes, hash, `trimmed=false`,
`outputCanvasPreserved=true`, context-preserving recovery policy, and one family
fingerprint. The CLI owns manifest registration and optional group-node
patching; do not manually assemble the binding. Re-derivation supersedes earlier
active records without deleting provenance. Project validation and quality
targets reject missing, mixed, tight-cropped, incomplete, or role-mismatched
families.

A state sequence may occupy the registered `subject` slot only when every state
has a complete family context. Author each subject from an active
`state-sheet-cell` with exact pose-family/state identity and explicit placement,
reuse the same support source package, and derive one three-member family per
state. Quality resolves each state record to its own family and rejects a
stateful subject when any rear or front context is missing.

If one registered family member contains multiple disconnected semantic
objects that need different scene order, author semantic-slices schema v1 and
run `assets:derive-semantic-slices`. Each active
`semantic-slice-derivative` record remains on the full source canvas and binds
one semantic role to an exact, hash-locked set of alpha-connected components.
The derivation report must prove that every qualifying source component is
assigned exactly once, output alpha totals equal source alpha totals, and
boundary cuts remain zero. A slice may become an independent scene actor or a
mask input to a refined three-member registered family; it is never a new
provider result.

Use only these patterns:

| Pattern | Intended relationship | Required structure |
|---|---|---|
| `free` | independent label, bird, leaf, stamp, or cutout | no persistent support/shared boundary |
| `supported-subject` | person in boat, object on table, hand holding prop | rear support, subject, front support, shared registration, contact and occlusion zones |
| `registered-depth-stack` | independently moving rear, subject, and front planes | clean rear plate, full subject silhouette, full front overlay, shared registration, strict depth, responsive reveal envelopes, and optional subject-only travel envelopes |
| `registered-environment` | land/water, sky/ground, wall/floor, tabletop edge | shared master canvas, registration, fixed boundary, upper/lower clipped members |
| `canonical-container` | one rigid bottle, tank, gauge, cavity, or bezel with changing internal contents | exactly one clean plate, one canonical frame, one contents state sequence, shared full-canvas registration/interior mask, one authoritative internal surface, measured ordered states, and a measured terminal state |
| `looping-environment` | car/train/boat travelling through a persistent horizontal world | two to four seamless `world-strip` roles, one non-scrolling tracked subject, ground reference, monotonic depth speeds, and before/seam/after proof bindings |

Groups own carrier motion; children own only local motion. Do not repeat the group's world path on attached children. Local z-order is deterministic. The default `between-supports` order is support rear, optional contact shadow, subject, support front. Use `support.layering=subject-front` only when the approved visual language requires the complete subject silhouette to remain above every support member; quality review then proves `subject-front-clear` instead of front occlusion. Registered environment members use the complete master canvas with top-left origin; textures may move within a fixed clip, but the boundary must not move across semantic content.

When a Profile explicitly enables paper-outline/drop-shadow, apply them only to
character and prop cutouts. Never apply them automatically to full-canvas
support members: an opaque rear plate would expose its rectangular canvas
boundary as a false frame. A Profile with `mode=none` receives neither effect.

Coupled members share `registration.id`, `sourceMasterAssetId`, canvas
dimensions, origin, and source-family provenance. For rigid contact/boundary
families, use the registered source appropriate to that family and keep member
motion locked. For relative rear/subject/front motion, first compile one
layer-complete source package. Use either one registered 2x2 sheet containing
reference plus all three complete layers or one complete reference plus three
full-context edits. A flat composed master may remain reference evidence but
cannot supply hidden layer pixels. Independent or isolated member generation is
invalid. Source and proof-scale alpha-band diagnostics are fingerprinted with
the registered derivation, so a changed source package, mask, clip, placement,
reveal envelope, or render size invalidates cached evidence.

Derivation method is part of correctness. Complex silhouettes and negative spaces require capable segmentation/matting or careful manual tracing; a coarse enclosing polygon is invalid even when it has clean hard alpha. When extraction quality cannot be proved, keep the complete master rigid and use whole-family/camera motion instead of fabricating independent parts.

A `canonical-container` is deliberately stricter than a free stack of prop
images. Its child order is fixed to clean plate, contents, then frame. All
children preserve the full registration canvas, children cannot carry
independent transform motion, and only the contents sequence owns
`container-surface:<authoritativeSurfaceId>`. The family fingerprint binds the
three provider roots, one polygon mask, all state hashes/metrics, terminal
policy, and context-preserving recovery policy. A duplicate fill/waterline node,
frame redraw inside the contents sheet, or terminal state below its measured
threshold invalidates the composition.

Every adjacent scene pair has one top-level `sceneTransitions[]` record with
narrative `intent` and `rationale`. An intent-only schema-v12 authoring record
compiles through the selected Profile's `motion.transitionSet`; an explicit
treatment separately declares type, motivation, duration, optional direction,
optional `edgeStyle=clean|paper|torn`, and optional boundary beat. The neutral
runtime types are `slide`, `wipe`, `dip`, `iris`, `page-turn`, `shutters`, and
`cut`. `paper-story` selects paper edges/covers where appropriate;
`clean-video` selects ordinary video treatments without paper decoration.
Neither set scrolls a long comic canvas. A `cut` is either `rhythmic` with a
`beatId` in the outgoing final 20% or incoming first 20%, or `impact` with
narrative intent `impact`. All normal continuity, place, time, focus, and
chapter intents still default to animation. Spatial types use a hard clip or
opaque incoming-scene translation. Cover types swap only during a fully opaque
plateau. Alpha crossfades between semantic scenes are not supported. Animated
duration is type-bounded inside `0.2..1.5s`; the outgoing `tailSeconds` and
incoming narration lead must both cover it, and the report records
intent/type/motivation counts plus transition proof samples. Advanced v9 match
transitions are separately declared in `editorial.transitions[]`, bind an
actual-audio edit point, and require dimension-specific continuity proof plus
before/at/after frames.

## Proof and Event Contract

- Storyboard authors own v12 `motionDirection`, beat `performanceRole`,
  `treatments`, layer source-package intent, editorial authoring, and boundary
  intent; they do not hand-author `motionContract`, `compositionPlan`,
  source-package cost totals, resolved edit points,
  responsive/transition plans, `directing`, fingerprints, risk ranking, or
  pose-sheet grids. `project:storyboard` deterministically compiles those
  derived fields and default transition recipes, then rejects drift.
- Scene id, blueprint, compiled `compositionPlan`, proof ids/times/assertions/stateAssertions, and beat ids must match the approved storyboard. Beat-bound, treatment-bound, and state-bound proof intent is immutable. `stateAssertions` are execution/proof coverage, not story meaning; changing them routes through deterministic directing sync instead of fabricating a semantic revision.
- A compiled continuous target must exist and have visible keyframe/idle motion. `parallax-camera` additionally requires enabled camera parallax and a real depth spread. `scroll-world-x` instead requires one matching `looping-environment` whose axis, direction, distance, speed bounds, ground/tracked ids, seam proof ids, start phase, optional normalized `activeFrom` cue, optional terminal `activeUntil` lock, or `frozen=true` lock, and ordered strip roles/depths exactly match the compiler-owned plan. Before `activeFrom`, the world phase is held; when `activeUntil` is present the completed phase remains locked thereafter, otherwise the full authored travel completes by scene end. A frozen world holds phase throughout and must provide `world-lock-clean` evidence; a terminally locked travelling world must provide both its ordinary world-motion evidence and `world-lock-clean`. A compiled path target must exist as one matching `state-sequence` with exact `motion.path`, independent compiled loop playback, explicit camera-follow decision, and one matching `path-locomotion` spatial contract; ordinary x/y/rotation keyframes are forbidden on that target. A compiled `motif-field` target must exist with the exact preset, distribution, count, cycles, bounds, exclusions, and optional world binding; a world-bound target must resolve to an actual top-level looping world strip. A compiled visibility target must have a matching persistent event and truthful initial state; a compiled generic graphic target must exist as the declared editable node. A compiled `role=visual-sfx` graphic must be editable typography with exact text, start hidden, bind the same beat and discrete `soundCue`, and execute synchronized `fade-scale` show, declared emphasis, and `fade-scale` hide around its Profile-bounded duration. Every compiled state family must exist as one matching `state-sequence` node including its resolved playback plan.
- Each scene has establish, action/peak, and final proof moments; final remains at or after `0.82` and proofs stay outside scene-boundary intervals.
- A final state assertion must resolve to one fully opaque state, remain outside any state crossfade for at least that transition duration, and preserve the asserted state through the scene end.
- Every node keyframe path starts at `0`, ends at `1`, and authors at least one of `offsetX`, `offsetY`, `scale`, `rotation`, or `opacity`; legacy node-keyframe `x`/`y` is invalid rather than ambiguously interpreted.
- `scene.events` is the only visual/sound event source. Every storyboard beat has one or more ordered events; event drift is at most `0.035` normalized units. Every compiled sound plan entry binds the exact registered output path to its approved beat; narration never satisfies `soundCue`.
- A visibility event targets an existing composition node and persists after its window. A first `show` requires `visibility.initial=hidden`; a first `hide` requires an initially visible node. Supported transitions are `cut`, `fade-rise`, and `fade-scale`.
- Emphasis events are transient and use the bounded actions from `schemas/composition.schema.json`, including `drop-impact` and `carve`. They do not control persistent visibility.
- Bind a critical event to `proofTimeId`. Transient emphasis/hold proof remains inside its action window; visibility proof may show the settled persistent state after the action starts and before the same target's next visibility change. If the approved beat names audio, at least one matching event owns both that proof id and the sound.
- Use a `hold` event only for an approved quiet observation beat: target `scene`, bind a proof inside the window, and keep it within the runtime maximum. Never encode an unexplained wait as a long `tailSeconds`.

## Validation and Failure Routing

Run `project:composition-proof` after assembling real groups. It fingerprints
scene frames and targets with the current runtime build, reuses current
evidence, and renders only changed authored proof. Normal coupled families use
alpha/checkerboard/tight/motion-stress plus alpha-band evidence. A
`registered-depth-stack` additionally requires neutral reconstruction,
reference comparison, checkerboard exploded members, and both extremes of all
three responsive reveal envelopes. A stack with `subjectTravelEnvelope` also
renders the three subject-only travel extreme pairs; isolated member stress is not proof that
hidden pixels are complete. It never treats a cache entry as current without
matching source/config/registered-derivation/render-size/runtime fingerprints
and existing evidence files. `--force` disables frame, composite, and
asset-evidence reuse and records that decision in the report.
`project:assets-ready` first recomputes the checked-in `runtime-build.json` and
rejects any locally drifted schema, validator, quality, or rendering surface.
It rejects missing/stale proof fingerprints, open generation reservations,
missing or exceeded human-approved attempt caps, incomplete provider-root
realization, pending/failed asset or composite quality,
and audio without either a passing preflight or a fingerprinted, explicitly
accepted calibration decision. It then writes `assets-ready-seal.json`. Low-level
`project:advance ... assets-ready` and both render modes only accept a current
seal; any project, source media, storyboard, quality, subtitle, or runtime change
invalidates it and routes back through the canonical command.

Automatic quality code may measure file readability, dimensions, alpha
topology, registration, fingerprints, timing bindings, and proof completeness.
It may not decide seams, clipping, occlusion appearance, damaged artwork,
identity/style continuity, facing readability, loop cadence, depth readability,
or overall composition. Those semantic checks require `reviewer=human:<id>` and
the human's note. Generate one current fingerprint-bound contact sheet, show it
to the human, and use `accept-human` for one whole-surface approval.

Every wrapped production failure records the operation, input fingerprint, and
normalized failure signature in `failure-circuit.jsonl`. One unchanged failed
input is blocked even with `--force`. The second occurrence of the same failure
opens a circuit and stops autonomous retries until an explicit human resolution
is appended with `project:failures`. A changed input that succeeds resolves a
single prior command failure; it never auto-resolves an open circuit or a human
review stop.

Fix a wrong mask, crop, anchor, registration, or derivative without another human decision when the approved meaning and budget remain unchanged. Regenerate `project:style-proof` or `project:composition-proof` after the fix; member hashes invalidate prior evidence automatically. Return to concept only when the relationship meaning changes. Return to provider/budget approval only for a provider switch or budget increase. Never hide a contract failure with arbitrary z-index, pixel nudges, or a coarse polygon matte.

Use repository scripts rather than reproducing ffprobe, FFmpeg, Remotion,
extraction, layer/state-sheet processing, editorial/directing compilation,
proof, attempt accounting, or report logic ad hoc. Only the current Creative
Plan v4, project/storyboard schema v12, executable Style Profile schema v2,
motion-contract schema v1, quality-report schema v7, asset-request schema v8, registered-family schema v2,
and current style-proof contract are supported; older contracts are
intentionally not migrated or executed.
