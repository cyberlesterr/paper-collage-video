# Asset, Composite, Motion, and Delivery Quality

Read this before style sampling, bulk images, v12 composition/motion-contract/v9 editorial
authoring, proof review, or delivery tuning.

## Two Quality Scopes

`quality-report.json` v7 contains the current executable `styleProfile`
reference/fingerprint/review focus, current `motionContract` summary and both
fingerprints, `eventTimeline`, current `assets`,
`composites`, non-current `assetHistory`, per-entry `reviewScope`, and one
`reviewSurfaceFingerprint` over the exact review targets, technical results, and
evidence hashes. A visible consumer uses `runtime-visible`; an active provider or
source asset not yet in the execution tree uses `source-asset`. A top-level
coupled source family declared `renderParticipation=derivation-only` is never
rendered and receives only deterministic source completeness, provenance, and
registered-derivation checks—no human composition, occlusion, depth, or
responsive review. If the same file also reaches a visible consumer,
`runtime-visible` wins. Manifest records marked `superseded`, `rejected`, or
`recovery-source` stay auditable but do not enter the current pass denominator
unless the execution tree still reaches that file. A passing file does not prove
that a person is inside a boat or trees remain above water. Both current quality
scopes must pass.

Run `project:quality <slug> prepare` after files exist. Then generate a review batch with `project:quality <slug> scaffold --output=projects/<slug>/quality-review-scaffold.json --reviewer=human:<id>`. The scaffold lists required/pending checks and current evidence records as `{file, sha256}` but never pre-populates `passedChecks`. Generate its contact sheet and show the current evidence to the human. Automatic code and AI may organize or measure evidence, but only the human decides seams, clipping, occlusion, damage, identity/style continuity, facing, loop cadence, depth, and composition. SHA-256 changes invalidate affected reviews; changing a bound semantic contract or generation family also invalidates them.

The schema-v4 scaffold binds the complete report fingerprint, every target fingerprint, and every evidence-file hash, and adds per-composite `evidenceClasses` (`full`/`crop`/`debug`/`temporal`) plus a fingerprint-bound temporal evidence strip for every motion-bearing composite. A composite is eligible only when a proof report contains both its current id and current fingerprint; scaffold generation stops instead of attaching an older same-id proof. Motion-bearing targets (whole-film `motion-contract`, `style-target`, `state-sequence`, `spatial-contract`, `looping-environment`, `parallax-rig`, `motif-field`, `canonical-container`, `event`, `editorial-transition`) fail closed when the temporal strip is missing or stale — static full/crop/debug frames alone cannot pass a motion review. `record-batch` rejects the whole input atomically when a report, target, evidence file, or temporal evidence has changed, so an old scaffold cannot approve removed targets, miss new ones, or present stale frames. Generate a current bound review surface with `project:quality <slug> contact-sheet --input=projects/<slug>/quality-review-scaffold.json`; its index records the report fingerprint, source evidence hashes, and generated page hashes. Never display an older unbound contact sheet as current.

Generating a non-empty scaffold starts one quality-review metric session and persists the scaffold's current evidence paths and hashes in the report. If the human approves the complete current surface, `accept-human --reviewer=human:<id> --note="<human wording>"` records all pending checks once and closes the session. If the human identifies defects, use the fingerprint-bound batch to record only the explicit failures; after revision, generate one new current surface. Any pass/fail payload with a non-human reviewer or empty note is rejected. Omit `evidenceFiles` to inherit the current fingerprint-bound set, or provide it explicitly only to override that set.

### Early Batch Review

Do not hold all human review until every asset exists. After a production batch completes, run `scaffold --assets=<id,...>` or `--scene=<sceneId>`: this writes a `reviewScope=batch` subset scaffold to `quality-review-scaffold.batch.json` (its contact sheets go to a separate `-batch` directory), show that sheet to the human, and record the decision with the same `accept-human`/`record-batch` commands against the batch scaffold. Reviews are per-asset, so an early decision is recorded once and the final full review only covers what remains. A batch scaffold binds the same current report fingerprint as a full one — recording new work invalidates it, so regenerate rather than reuse. Batch review is optional and never blocks production; the final `assertQualityReady` semantics are unchanged.

Registered members add topology-sensitive asset checks: `silhouette-fidelity`, `negative-space-clean`, and `background-leak-free`. A `supported-subject` composite also requires `motion-isolation-clean`. Passing any of those checks requires `evidenceFiles` from the current proof bundle. `key-edge-clean` only detects matte/color contamination; hard 0/255 alpha can pass that check while still deleting a limb or carrying background pixels.

Every transparent foreground also receives `rectangular-alpha-band-free`. The detector scans horizontal and vertical runs whose alpha is 4–96, requires at least 24 pixels and 42% of the relevant axis, merges adjacent scan lines, and treats a band as thin at no more than 2.5% of the cross-axis. It correlates candidates within 1.2% of canvas edges, crop edges, or registered placement/rectangular clip edges; four compatible sides form an explicit rectangular-residue error. Broad soft transitions remain informational so ordinary paper shadows do not fail, while an unusually long uncorrelated straight band is a warning. Diagnostics name scale, orientation, exact coordinates, span, correlation, classification, and severity.

Every alpha-bearing asset also receives `alpha-topology-clean`. A bounded
connected-component pass rejects small, separated, rectangle-like fragments
that can escape long-band detection. When registered placement or rectangle
crop provenance exists, it also rejects a mostly filled component whose hard
edges align with perpendicular derivation boundaries. This check is for
detached residue and hard crop topology; irregular intentional silhouettes and
soft shadows remain subject to the existing evidence-backed visual review.
The detached-fragment heuristic is disabled, while hard derivation-boundary
checks remain active, for `scenery`/`foreground-occluder` looping strips and
the subject/front members of a `registered-depth-stack`: those contracts
explicitly represent multiple disconnected rocks, roots, leaves, or reeds.
Do not apply that exception to characters, props, ground/backdrop strips, or
untyped transparent images.

The same inspection runs once at original resolution and again after Lanczos
scaling to the asset's actual proof/render dimensions. Proof bundles contain
`*-alpha-bands.json` and `*-alpha-bands.png`; quality requires current passing
scale evidence for all three `supported-subject` and
`registered-depth-stack` members. These deterministic artifacts do not replace
visual inspection of the alpha mask, checkerboard, tight crop, or family proof.
`key-edge-clean` is a different chroma/matte test and cannot be used as a proxy
for rectangular crop residue.

For a registered member derived from a chroma-key sheet cell, quality also
requires `keying-provenance-current`: the adjacent `.key.json` must exist and
its SHA-256 must match the registered-family binding. Inspect internal negative
spaces as well as the outer silhouette; a clean outer edge does not excuse
ocean/background pixels trapped inside a window, handle, propeller, or foliage
hole.

When the source uses a provider-native observed plane, quality additionally
requires `observed-key-plane-current`. The `.key.json`, registered-family
binding, and source observation must agree on observed key color, policy
fingerprint, and source-bound observation fingerprint. This deterministic
check proves provenance freshness, not semantic cutout correctness; the
checkerboard, tight crop, negative spaces, reconstruction, and motion-stress
evidence still require human review.

Semantic risk adds evidence-backed checks:

- identity: `identity-family-consistent`, `identity-distinct-within-frame`, `cross-scene-identity-continuity`;
- mechanism: `mechanism-complete`, `load-path-readable`, `physical-plausibility`, `reference-conformant`;
- diagram: `diagram-edge-clean`, `small-text-legible`, `no-procedural-noise-on-semantic-lines`.

The runtime deterministically rejects `feTurbulence`, `feDisplacementMap`, and `feBlend` in diagram-critical SVG files. Raster diagrams and physical correctness still require original-resolution semantic evidence.

## Executable Style Profile Review

Every current source or visible asset inherits the selected profile's
`requiredAssetChecks`; its quality fingerprint binds the profile fingerprint
even when the file bytes are unchanged. Composition quality adds exactly one
whole-film `style-profile:<id>` target with the profile's
`requiredCompositeChecks`. Its fingerprint binds the profile snapshot, render
theme, transition set, visual-SFX policy, runtime, scenes, and participating
asset hashes. Therefore changing a palette, surface texture/edge/shadow
treatment, directive, required check, reference card, or profile id invalidates
stale asset/composite approvals.

The scaffold includes the frozen style-card reference as evidence and repeats
`styleProfile.quality.reviewFocus` for the reviewer. Asset approval must verify
`style-profile-conformant`; whole-film approval must verify
`style-profile-consistent`. A technically valid alpha edge or registered family
does not prove either check. Compare the actual evidence with the bundled
reference at useful resolution and judge the profile's named visual traits
across scenes, not just one isolated sample.

For the style gate, run:

```bash
npm run project:style-proof -- <slug> --duration=4
npm run project:quality -- <slug> prepare --scope=style
```

The schema-v7 style report uses `scope=style`, binds the complete
`styleProofPlan`, the motion execution fingerprint, and the attributable
motion approval fingerprint, then emits a structured composite for every selected directing
target, including `free` targets. Its current composite can satisfy the matching
quality target directly; a separate full-project composition proof is not
required merely to approve style. Inspect
`dist/<slug>/style-proof/evidence/` at useful resolution: alpha masks,
checkerboard isolates, tight crops, and before/shifted motion-stress sheets
where applicable. For a `registered-depth-stack`, inspect the family as a
whole: neutral reconstruction, reference comparison, checkerboard exploded
view, and both reveal-envelope extremes for 16:9, 9:16, and 1:1. These six
family artifacts must be current and show zero transparent output pixels;
isolated member motion stress cannot prove hidden content. Record participating
assets and the representative composite with those paths.
When the stack uses `stackingContext=scene`, render those extremes through the
same validated static carrier transform used by the scene. An oversized carrier
is part of the authored coverage surface; shrinking it back to one viewport in
the proof creates a false transparent-edge failure.
The same `--scope=style` must be retained for scaffold, contact-sheet, and
record-batch. It defers semantic evidence whose planned node has not yet been
produced, while keeping every currently rendered style target reviewable and
fingerprint-bound.

```json
{
  "reviews": [
    {
      "assetId": "traveler-subject",
      "reviewer": "human:reviewer",
      "passedChecks": ["subject-complete", "edge-clean", "silhouette-fidelity", "negative-space-clean", "background-leak-free"],
      "failedChecks": [],
      "evidenceFiles": [
        "dist/story/style-proof/evidence/traveler-subject-alpha.png",
        "dist/story/style-proof/evidence/traveler-subject-checkerboard.png",
        "dist/story/style-proof/evidence/traveler-subject-tight.png",
        "dist/story/style-proof/evidence/traveler-subject-motion-stress.jpg"
      ]
    }
  ]
}
```

After final local audio, actual timing data, and real v12 composition/v9
editorial groups/state sequences exist, run (the proof command synchronizes
measured narration duration first and reuses only project-, asset-, and
runtime-fingerprint-current frames/targets):

```bash
npm run project:composition-proof -- <slug>
npm run project:quality -- <slug> prepare
```

For a path-bound state sequence, explicit `stateAssertions` remain the authority
when they exist. When none are authored, quality evidence automatically binds
the sequence to the matching `path-locomotion` contract's start, turn, and
through proof times. A path-bound companion with the same `poseFamilyId` may
inherit those state-review times from the contracted lead in the same scene;
this does not make the companion another spatial-contract target or duplicate
the camera/world proof. This keeps continuously cycling, depth-directed
locomotion reviewable without pretending that one static state owns an entire
path phrase. One assertion for a node at one proof time is an exact visible-state
claim. Multiple assertions for the same node at the same proof time instead form
a registered-family coverage set: every named state must receive proof coverage,
while the state resolved at that instant must be one member of the set. They do
not claim that mutually exclusive states are visible simultaneously.
The project execution tree may append state assertions for newly realized
assets at an existing approved proof time. It must preserve every approved
proof id, time, label, kind, visible assertion, and storyboard state assertion;
it may not delete or rewrite the approved proof to make validation pass.

To deliberately bypass every proof cache layer, append `--force`. The generated report must say `cache.forced=true` and show zero reused frames, composites, and asset evidence.

It also creates `composition-proof/evidence/` alpha masks, checkerboard
isolates, tight crops, and motion-stress sheets for ordinary coupled assets
introduced after style approval. Depth stacks receive the six family artifacts
described above. Inspect full proof frames, relationship crops, debug frames,
and these post-style family sheets. Record composite reviews in the same atomic
batch file, using `compositeId` instead of `assetId`:

```json
{
  "reviews": [
    {
      "compositeId": "group:scene-01:boat-rig",
      "reviewer": "host-vision",
      "passedChecks": ["support-contact", "inside-or-on-readable", "front-occlusion", "shared-motion", "identity-continuity"],
      "failedChecks": [],
      "evidenceFiles": ["dist/story/composition-proof/crops/group-scene-01-boat-rig-final.png"],
      "note": "Establish, action, and final crops inspected at useful resolution"
    }
  ]
}
```

Semantic targets use ids such as `semantic:recurring-cast:cast-comparison`. When a target spans scenes, inspect every generated crop together before passing continuity. When a mechanism target is reviewed, explicitly compare its crop with the declared parts, connections, load paths, degrees of freedom, forbidden forms, and reference evidence.

```bash
npm run project:quality -- <slug> accept-human --reviewer=human:<id> --note="<human approval wording>" --quiet
```

Never pass a semantic check merely to unblock production. Changing a member, mask, group transform, boundary, anchor, keyframe, event, scene transition, or proof time changes the composite fingerprint and invalidates that review.
Replacing or editing a recorded evidence file also invalidates its review. During production review, each member decision must reference that proof bundle's alpha mask, checkerboard, tight crop, and motion-stress sheet; the composite decision must reference its full/crop/debug proof frames and member motion-stress sheets. An unrelated screenshot cannot satisfy the review.

Quality also creates exactly one `motion-contract:whole-film` target whenever a
compiled motion contract exists. Review establish/action/settle phrase coverage,
pacing cadence, camera strategy, transition strategy, ambient strategy, and
event/proof synchronization across all scenes. The target fingerprint binds the
exact contract, runtime surface, scene motion/camera/composition/events,
transitions, editorial fingerprint, and participating asset hashes. A passing
3–5 second style sample is necessary for the style gate but cannot substitute
for this whole-film motion review.

Composition-proof fingerprints use the `composition-proof` runtime surface
rather than the complete package identity. That surface excludes subtitle-only
renderer and subtitle-contract files, and the proof command renders a dedicated
project input with subtitles removed. A subtitle-only change therefore
invalidates final visual/subtitle evidence while preserving current asset and
composition reviews. Changes to composition, proof, quality, schema, or shared
renderer inputs still invalidate the affected proof targets.
Composite quality timing fingerprints include narration start/duration and
scene tails, but not narration transcript text or derived subtitle cues.
Whitespace-only phrasing and cue repartition therefore preserve visual reviews;
changing narration timing still invalidates them.

Subtitle review is bound to the encoded output, not only the React/CSS intent.
Inspect `subtitle-contact-sheet.jpg` for every narrated scene at the real
preview resolution. Confirm the requested punctuation policy, glyph clarity,
subject clearance, and the absence of unintended ink bleed. The final report's
`subtitle-typography-surface` check must list the resolved per-scene font
family, weight, and edge treatment. A passing composition proof cannot satisfy
this subtitle check because composition-proof intentionally hides subtitles.
The report's `subtitle-segmentation-surface` must also list cue count, longest
non-space cue length, and whether authored phrase spacing is present. Inspect
the encoded sheet to confirm that spaces read as semantic pauses and that cue
changes do not leave an orphaned one- or two-character tail.

## Pattern-Specific Review

- `supported-subject`: support contact, readable inside/on relation, shared carrier motion, identity continuity, and clean subject isolation under relative motion. The default `between-supports` layering also requires visible front occlusion; an explicitly authored `subject-front` relationship instead requires the complete subject to remain clearly above all support members.
- `registered-depth-stack`: exact clean rear/full subject/full front members,
  common registration/full canvas, strict rear-to-front depth, neutral
  reconstruction/reference conformity, no transparent exposure at either
  extreme of every responsive reveal envelope, and clean bounded relative
  motion. When `subjectTravelEnvelope` is authored, also inspect all three
  responsive lower-left/upper-right subject-only travel pairs and confirm the
  subject crosses the world while rear/front remain locally stable. When
  `stackingContext=scene`, also inspect the resolved static carrier size and at
  least one frame for every intended external interleave relation.
- `semantic-slice-derivative`: full source canvas preserved, current source
  SHA, exact alpha-component ownership, no component assigned twice or omitted,
  zero boundary-cut pixels, semantic role matches the visible object, and the
  final scene demonstrates the declared depth relation rather than only an
  isolated checkerboard.
- `registered-environment`: registration alignment, boundary respected, no duplicated semantic band, readable depth, readable final composition.
- `canonical-container`: source plate/frame/content-sheet hashes and family fingerprint are current; the frame and state sheet contain real transparency; there is exactly one clean-plate/contents/frame child in fixed paint order; all children preserve one registration canvas and have no independent motion; exactly one contents sequence owns the authoritative internal surface; every state has zero pixels outside the shared interior mask and passes center, bottom, fill-deviation, and retention thresholds; the final state passes minimum fill, maximum rim gap, and bottom-band coverage. Inspect the current mask overlay, complete progression, and terminal panel; a separate waterline/fill node cannot pass as decoration.
- `looping-environment`: the current provider-free topology proof matches the compiled world; every active strip binding matches its manifest derivative; RGB and alpha seams pass at source and render scale; outer tile-boundary salience passes, and `mirror-crop` also passes its internal fold; every semantic surface has visible full-span source support; a ground strip has real alpha support at both repeat edges; three-tile stitches are clean; 16:9, 9:16, and 1:1 have zero uncovered pixels at worst phase; far-to-near speed is strictly ordered; measured ground displacement has the authored sign and crosses a real seam; every tracked/participant subject follows its screen/world anchor contract; near-strip z-order is always proven, while real vertical overlap is required only when that subject binding does not explicitly set `requireNearOverlap=false`.
- `encounter-contract`: exactly one correct world participant owns enter/approach/answer/exit events in authored order; the answer event alone binds the intended narration cue within tolerance; the target traverses the declared entry/exit edges and minimum world distance; and no visibility event creates an opacity teleport. Inspect the four proof moments with the narration cue label and target id visible.
- `state-sequence`: state order correct, canvas and declared anchors stable within `anchorPolicy.maximumDrift`, every state has reviewable facing metadata that visually matches the actual silhouette, every identity-reference SHA matches an active manifest asset, identity is visually consistent, transitions are clean, and every state is bound to a current proof frame. A pose-state family requires a current anchor-overlay proof for every state. A state sequence authored as the `subject` inside one `supported-subject` or `registered-depth-stack` instead passes registration through complete full-canvas registered-family context for every visual state; do not require pose overlays in addition. Its parent group's alpha-band evidence count is the number of rendered family sources, including all state sources, not merely the number of child nodes.
- `spatial-contract/grounding`: every sampled registered foot/seat anchor resolves, remains within gap/penetration tolerance of the declared support polyline and inside its authored screen-space support band, and stays relatively stable for `locked-contact`; requested foreground relations use the actual cross-group paint order and alpha-tight overlap; requested subtitle clearance uses alpha-tight subject bounds against the active subtitle exclusion zone.
- `spatial-contract/continuity`: the endpoints are adjacent scenes; every typed pair stays within position/scale tolerance and, when requested, preserves its registered visual family; camera pose remains bounded and both sides bind their own passing grounding contract.
- `spatial-contract/gait`: all requested registered locomotion states occur inside the window, measured state changes per second meet the authored minimum, `activeUntil` does not precede the final locomotion proof, and the last active transition is close enough to the window end to reject a terminal freeze. If an exit sequence follows, additionally prove its ordered brake/landing/contact states and the final held contact state.
- `spatial-contract/travel-facing`: the assembled pre-camera subject path has the authored signed displacement, contains no reverse segment, every active state both declares and visibly exhibits the expected facing, and a matching `gait` contract proves that the moving character is actually cycling locomotion states. Inspect the arrow overlay and both endpoint crops; metadata alone cannot pass the human `travel-facing-readable` check.
- `spatial-contract/path-locomotion`: the assembled subject travels the required physical screen and optical-depth distance and directions; perspective scale and dynamic depth order visibly follow `z`; rendered rotation stays within the authored heading-error and turn-rate limits; every requested registered locomotion state cycles at the minimum cadence through the proof window; camera follow binds the same target and coherent world; and every sampled viewport stays inside declared world bounds. Inspect start, every named turn/depth reversal, end, the 3D path polyline, depth values, and heading arrows. Human review must pass `path-travel-clean`, `path-heading-readable`, `turn-continuity-clean`, `depth-projection-readable`, `depth-order-clean`, `camera-follow-coverage-clean`, and `locomotion-cycle-bound`.
- `spatial-contract/occlusion`: when `in-front-of-subject`, the foreground paints above the subject and its alpha-tight bounds overlap the subject at every proof time; the subject is never lifted above the foreground merely to stay visible. Inspect the debug overlay and both alpha masks; declared metadata alone cannot pass.
- `spatial-contract/action-sequence`: establish/action/peak/settle phases are strictly ordered and resolve their states and signed travel; the narration cue fires inside the window and every listed actor owns a trajectory/occlusion contract. Inspect the phase crops and cue labels together, never only the final endpoint.
- Registered geometry: every registered pose-family/layer family passes alpha-tight centroid, baseline, aspect/proportion, and scale drift limits, and silhouette-facing agrees with the declared facing; a mirrored or drifting member fails before review.
- Alpha-topology inspection treats detached components as intentional when
  their full-canvas bounds are declared by a current `semanticSliceBinding`, or
  when the asset is a typed multi-component scenery/foreground strip or a
  subject/front member of a `registered-depth-stack`. The typed exception
  suppresses only the detached-fragment heuristic; hard rectangular derivation
  boundaries still fail deterministically.
- Semantic alpha-component slices must also reproduce the exact declared
  component bounds and alpha-pixel counts in the encoded PNG. Provenance counts
  alone cannot pass `semantic-slice-alpha-current`.
- When a semantic slice is intentionally derived from a preserved source
  revision whose asset id was later reused by a registered-family output, bind
  `sources[].sourceSha256` in `semantic-slices.json`. The derivation must resolve
  that exact manifest record instead of silently switching to the current
  active record.
- Chroma-key edge inspection requires both matching chroma direction and close
  RGB distance to the declared key color. Paper colors that merely share a hue
  direction with the key are not counted as key residue.

When a spatial contract is selected by `styleProofPlan`, `project:style-proof`
runs the same deterministic contract evaluator used by composition proof, stores
the passing `spatialProof` in the style report, and renders the contract-specific
debug overlay. Generic red-box endpoint crops are not executable evidence and
must not pass style approval.
- `parallax-rig`: depth order readable, camera coupling clean, registered groups stable, final composition readable.
- `motif-field`: density readable, bounds clean, exclusion zones clean, motion clean, loop clean, final composition readable. For `rise-drift`, verify monotonic bottom-to-top travel, slight expansion, and invisible respawn. For a world-bound field, also verify the referenced strip exists, horizontal travel has the same sign and phase family as that strip, instances wrap inside the field bounds, and local horizontal drift never exceeds `relativeDriftAmplitude`.
- `typography`: fit/overflow, font loading, reveal/emphasis edit-point binding, mixed-script legibility, and safe-area/exclusion compliance.
- `visual-sfx`: the short word is editable `role=visual-sfx` typography; its
  audible cue and show/emphasis event are synchronized; its hide event preserves
  the Profile duration; it never covers subtitles or the focal subject; the
  scene stays within the Profile density limit; and lettering, color, contour,
  and motion are consistent with the selected style. Dialogue, narration, and
  environmental ambience do not pass as visual-SFX content.
- `annotation`: semantic anchors, route validity, title/subtitle/motif exclusion clearance, lifecycle binding, and counter state.
- `data-graphic`: data/domain/format/geometry mapping, focus/reveal states, edit-point binding, and deterministic SVG output.
- `editorial-transition`: declared shape/position/scale/color/value continuity, hard-cut enforcement for match types, fallback policy, and before/at/after frames.
- `responsive-directing`: three explicit plans, bounded placements/crop/focus/exclusions, and density budget.
- bound event: visual event visible, sound event bound when required, proof time bound, final state preserved.
- semantic contract: every requested check is visible in its exact target shots; cross-scene checks compare all bound scenes rather than one attractive frame.

Deterministic checks already block missing slots, mismatched canvases,
non-registered or mixed-provenance families, incomplete layer roles, wrong
depth order, motion outside reveal envelopes, duplicate carrier motion,
off-zone contacts, absent front alpha, rectangular low-alpha crop residue,
incomplete upper/lower clips, duplicate semantic coverage, invalid targets,
missing required sounds, out-of-window proofs, stale style fingerprints, and
missing topology/family evidence. They do not infer whether every semantic part
is intact; that remains evidence-backed semantic review.

## Motion, Visibility, and Event Authoring

The scene camera, camera-coupled depth offset, group transform, child local transform, ordinary keyframes plus optional path translation/orientation, idle motion, transient emphasis, and persistent visibility state compose in that order. A group carries its attached family once. Child keyframes use explicit parent-normalized additive `offsetX`/`offsetY` deltas and cover normalized time `0..1`; absolute node placement remains `transform.x`/`transform.y`, while camera keyframes retain pixel `x`/`y`. A path target forbids competing keyframe x/y/rotation and resolves arc length plus tangent in physical parent pixels, preserving speed and heading across aspect ratios. Narration resync therefore preserves the spatial relationship. `camera.follow` consumes the same resolved top-level path and clamps its viewport to one declared world surface; it is not a duplicate camera-keyframe animation. `looping-environment` keeps its viewport carrier fixed, folds camera/parallax into the internal strip phase and non-shrinking content scale, and repeats enough copies for gap-free coverage. Adjacent copies retain their logical phase spacing but overlap by a bounded raster guard so Chromium cannot expose a one-pixel antialiasing rail at fractional CSS coordinates. `motif-field` then expands its fixed-seed instances inside node-local bounds, deterministically rejects protected zones, and proves a closed or invisible loop edge. When `worldBinding` is present, the field uses the chosen strip displacement instead of duplicate scene-camera travel, wraps horizontal instance positions inside its own bounds, and composes the bounded local drift on top.

Map every approved beat to one or more ordered events. Target the group when the entire registered assembly reacts, or a child for a genuinely local action. `scene.events` schedules both visuals and sound; do not create a second audio event list. A visibility event persists after its window and requires a truthful initial state; an emphasis event is transient. Bind critical events to authored proof ids.

The normal contact sheet and final report reuse the authored proof moments and event timeline. A separate transition contact sheet samples every cut or opaque boundary; inspect it for false foreground/background combinations, edge gaps, uncovered midpoint swaps, spatial-direction errors, and cuts that miss the declared beat. The report must expose transition intent/type/motivation counts and cut ratio; any cut without valid rhythmic or impact motivation is a contract failure. Inspect establish, action/peak, and final states for relationship readability, subtitle safety, depth order, motif density/bounds/exclusions/loop edge, and preserved consequences.

Do not count imperceptible camera drift as story activity. Use `static` when stillness is intentional; non-static presets have a minimum visible movement floor. The rendered continuity report remains authoritative because authored motion can still disappear after compositing or encoding.

## Subtitles and Audio

`project:assets-ready` owns motion-approval validation, narration
synchronization, subtitle derivation, v12 composition/motion-contract/v9
editorial validation, current-proof enforcement, and all asset/composite/motion
quality gates. Provider or forced-alignment timing wins; actual final-audio
edit-point evidence is authoritative for editorial bindings. Review
reading-speed warnings. Every narration source must have non-empty transcript
text. Narrated scenes must keep subtitles visible, reconstruct that text after
whitespace normalization, use ordered cue ranges inside
the narration window, and cover at least 80% of that window. The renderer uses
duration-aware fades, so a short cue never receives overlapping interpolation
stops, and places the subtitle inside the active responsive safe area.

When a scene has a local conflict (a bird, title, or foreground that the
global safe area cannot avoid), author `editorial.sceneDirecting[]` with
`subtitlePlacement`: a per-scene anchor, safe-area rectangle, and exclusion
zones. The runtime renders cues inside that scene rect, and the subtitle
contract rejects any scene whose placement still intersects a non-subtitle
exclusion zone. The encoded subtitle sheet is the review surface for the
resolved placement.

The final report repeats those machine checks and extracts one frame from the
encoded video for every narrated scene into `subtitle-contact-sheet.jpg`. Treat
that sheet as the human visual proof for legibility, occlusion, clipping, and
font appearance; its existence is not OCR proof that the pixels spell the
expected text.

After narration registration and synchronization, `project:assets-ready` builds the deterministic timeline mix, encodes the real 96k preview AAC and 192k final AAC surfaces, and measures LUFS/true peak on both. If either encoded surface misses the mastering contract, the runtime automatically performs fingerprinted two-pass `loudnorm` mastering with codec headroom and up to three measured correction passes. This is a technical delivery operation, not a human approval gate: do not ask the user to choose narration gain, compression, or limiting. The report retains the unmastered mix, mastering method, targets, attempts, and both final probes. If automatic mastering still cannot pass, treat it as a technical audio defect to diagnose and repair, not a decision to delegate. Fresh renders and audio-only cache refreshes mux the exact measured mode-specific AAC stream with codec copy, so artifact audio never takes a second unverified gain/codec path; the final artifact report confirms equivalence and remains authoritative for the complete container.

Reports also intersect detected silence with sampled low-motion ranges. Silence with meaningful animation and a static explanatory image with narration are valid; only their unapproved overlap fails. Read `timing-continuity.md` for thresholds and proof-backed quiet holds. Never add background music solely to hide a continuity failure.
