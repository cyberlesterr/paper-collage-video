---
name: make-paper-collage-video
description: Create, resume, revise, or finalize editable, narrated Remotion videos in paper-cutout, hand-drawn, historical-collage, or comic-inspired (Korean/Japanese/Hong Kong/American) styles, including layered/parallax illustration, persistent travelling environments, functional diagrams, and recurring characters. Use for a new video brief or to continue an interrupted project tracked in production.json; drives style approval, motion/asset planning, provider budgeting, and quality review through to local final delivery.
---

# Make Paper Collage Video

Build an editable video while keeping the human in charge of concept, style/voice, preview judgment, rights, and external publication. Use `production.json` as the resume source of truth.

## Start With One Small State Read

1. Treat the current directory as a workspace only when `package.json` exposes `project:new`, `project:resume`, `project:preview`, and `project:render`. Otherwise read [references/setup.md](references/setup.md), bootstrap a writable workspace, and run its doctor. If this Skill was injected from a versioned plugin-cache path that no longer exists, stop and report a stale task snapshot — do not scan for or silently select the highest cached version; start a new host session/task so the loader formally exposes the installed version.
2. Inspect `git status --short` in Git workspaces and preserve unrelated changes.
3. For an existing slug, run only:

   ```bash
   npm run project:resume -- <slug>
   ```

   Continue from `control.mode` and the remaining work items. Do not repeat recorded approvals or read full history unless diagnosing state.
4. For a new project, derive a lowercase hyphenated slug and run `project:new`.

## Load Only the Current Stage Reference

- Workspace creation or doctor failure: [references/setup.md](references/setup.md)
- Provider discovery, confirmation, change, or output recording: [references/providers.md](references/providers.md)
- Duration, scenes, rhythmic storyboard, or production-profile planning: [references/story-planning.md](references/story-planning.md)
- Per-beat animation choice, effect routing, pose families, graphics, or directing budget: [references/motion-directing.md](references/motion-directing.md)
- Arbitrary 3D subject travel, tangent auto-orientation, optical-depth projection, bound locomotion loops, or world-bounded camera follow: [references/path-locomotion-3d.md](references/path-locomotion-3d.md)
- Whole-film action grammar, beat performance roles, motion approval fingerprints, or motion-language-card review: [references/motion-contract-v1.md](references/motion-contract-v1.md)
- Any rear/subject/front separation, relative layer motion, source package, reveal envelope, or oversized seamless travelling environment: [references/layer-complete-assets.md](references/layer-complete-assets.md)
- Any rigid vessel/frame with changing internal contents, fill levels, gauges, cavities, duplicated surfaces, or container-state alignment: [references/canonical-containers.md](references/canonical-containers.md)
- Narration resync, scene tails, intentional quiet holds, pacing, or dead-air failures: [references/timing-continuity.md](references/timing-continuity.md)
- Concept/style/preview decisions, rights, or external action: [references/approval-gates.md](references/approval-gates.md)
- Image review, depth, motion, subtitles, or delivery tuning: [references/quality-motion.md](references/quality-motion.md)
- Recurring identities, functional mechanisms, topology-sensitive subjects, or explanatory diagrams: [references/semantic-contracts.md](references/semantic-contracts.md)
- Editing project/state files or diagnosing validation: [references/project-contract.md](references/project-contract.md)
- Audio edit points, typography, annotations, data SVG, responsive directing, or advanced transitions: [references/editorial-system-v9.md](references/editorial-system-v9.md)
- Tool-only image generation, recovery, or an `auto-continue` blocker: [references/execution-control.md](references/execution-control.md)

Do not load every reference up front.

## Apply Reversible Defaults

- Keep 30 fps, a general Chinese-language audience, and the configured fictional narrator unless the brief requires otherwise. Do not silently default a title-only request to one aspect ratio or one visual style: the intake gate owns both.
- Preserve user-specified duration and scene count independently; infer only missing values.
- Recommend `balanced`, but never select it invisibly. Show `draft`, `balanced`, and `full-depth` as `轻量成片`, `均衡动画`, and `完整纵深`. Treat each profile ceiling as planning capacity, not spend authorization. The scenario card and combined decision must name an exact `budgetDecision.imageAttemptLimit` no greater than that ceiling and no lower than the complete scenario estimate; this narrower human-approved cap is what the attempt ledger enforces.
- A one-scene `full-depth` story still reserves two independent pose-sheet families when its required action belongs to two recurring identities. Never merge unrelated characters into one state sheet simply to conform to a scene-count heuristic.
- Do not clone a real person, use unclear third-party rights, publish, upload, or send externally without separate authorization.
- Ask only for missing information that materially changes the subject, factual position, rights boundary, delivery format, or material cost.

## New Project: Intake, Then Three Scenarios

At `capability-review`, use the current host model only to prepare a provisional brief and concept; do not call an unconfirmed external or paid provider.

1. Read `providers.md`, `story-planning.md`, `motion-directing.md`, and `approval-gates.md`.
2. Immediately run `project:intake -- <slug> --json`. Render every returned `visualStylePreset` image in the conversation before asking; the catalog is dynamic, so never assume a fixed count or hard-code style ids. Then use the host's Ask Question UI, when available, for exactly three selectors: `16:9` or `9:16`; one of the returned visual styles; and text-only parallax preference `auto|prefer|minimal`. Use a compact structured text fallback only when the host has no Ask Question UI. `分层视差` is not another visual style. Do not ask for production profile or cost in this popup. Record the answer with `project:intake`; confirmation freezes the catalog's executable `styleProfile` into `project.json` and materializes `theme` from it. Do not hand-edit either snapshot afterward.
3. Run `provider:status -- <slug> --compact-json` once and inspect actual callable host tools. Using only the current host model, write one common story skeleton and all three `planning-scenarios` inputs. If the user explicitly supplied duration or scene count, preserve it in every option. Otherwise bind `draft→concise`, `balanced→standard`, and `full-depth→expanded`. Each option must show its duration, scene count, beat rhythm, character/prop state families, rear/mid/front/near plan, parallax and ambient plan, free local-motion targets, exact expected image calls, proposed approved cap, hard ceiling, local derivatives, avoided calls, actual provider recommendation/cost basis, factual/rights risks, and final-film effect. Run `project:scenarios -- <slug> --input=<scenarios.json> --json`; this is still provider-free.
4. Present all three scenario cards together. Recommend `balanced` but let the human choose. This single decision is the combined story-scope/concept/profile/budget/provider approval, so each card must already contain the information above; do not add another routine confirmation after the selection.
5. After the human selects a card, continue automatically: run `project:plan -- <slug> --scenario=<draft|balanced|full-depth>`, fill `brief.md`, and author the selected schema-v12 storyboard. The plan carries a scenario fingerprint, `profilePromise`, and a fingerprinted `providerRootPlan` with one exact root for the style sample, every single background/source-package role, and every pose sheet — ceilings block overspend, the promise blocks a high-cost profile from quietly shipping low depth, and the root plan blocks a structurally valid local substitute from impersonating approved provider production. Its root count must equal the complete approved scenario estimate. The shared scenario must enumerate story-critical `semanticActions`; every option routes each one to an actual registered state, local-motion target, or layer package.

   **Motion and scene authoring**
   - Read `motion-contract-v1.md`; author one structured whole-film `motionDirection`; assign every beat a `performanceRole` plus `proofTimeId` — never descriptive `style.motionLanguage` prose.
   - Author one scene record per planned scene, one v9 `editorial` authoring contract, and exactly one `sceneTransitions[]` boundary per adjacent pair.
   - Read `editorial-system-v9.md` for actual-audio edit points, reusable typography, annotations, data SVG, responsive plans, or advanced transitions; never substitute estimated narration or TTS latency for final local-audio timing.
   - For each boundary, declare `intent` and `rationale`; normally omit `treatment` so `project:storyboard` routes the intent through the Style Profile's `transitionSet` deterministically. Comic-inspired profiles use ordinary cuts/wipes/dips/slides/irises/shutters — never a simulated vertically-scrolling comic canvas.
   - Classify each beat's visible change and author orthogonal `treatments` for motion, persistent visibility, composition relationship, graphic mechanism, semantic risk, importance, and necessity.
   - Before rear/subject/front source generation, read `layer-complete-assets.md`; choose `rigid-locked` or `bounded-relative`; author the stable source package, complete layer roles, depth order, source strategy, and three responsive reveal envelopes. `registered-depth-stack` only for a truly layer-complete finite family — an opaque flat master is never a source for relative member motion.
   - For a tracked subject traveling through a persistent horizontal world, route `world-travel` to `looping-environment` plus `scroll-world-x`; author ordered far/mid/ground/near strip intents and before/seam/after proof times; declare either an `activeFrom` cue or a complete `frozen=true` world lock. After compilation, run `project:world-topology-proof -- <slug>` before requesting any looping-world image. Every such request must carry the current proof binding; a missing, failed, or stale provider-free proof stops attempt reservation.
   - When narration names successive animals/people/objects that the traveler meets in one continuous world, author `scene.encounters[]`. Each contract binds exactly one narration cue and one world-anchored target to ordered `enter`, `approach`, `answer`, and `exit` beats. The target must cross the world physically and remain present between those phases; visibility/opacity events are not a valid encounter lifecycle.
   - For a state-sequence subject traveling through arbitrary screen directions and optical depth in one coherent finite world, read `path-locomotion-3d.md`. Author one independent `path-locomotion` treatment with `changeClass=path-travel`, one matching looping state family, one `path-locomotion` spatial contract, and an explicit `cameraFollow` object or `null`. Never duplicate the route as camera/scale keyframes or generate eight directional pose families when tangent rotation preserves the silhouette; when optical travel materially changes the silhouette, author registered planar/toward/away loops and bind them with one velocity-driven `pathViewBinding`.
   - Never hand-author compiler-derived `motionContract`, summaries, fingerprints, source-package totals, style-proof plans, sheet grids, or repeated world copies. Every scene needs at least three ordered beats and three proof moments, including a final state after `at=0.82`. `project:storyboard` rejects motion-language inconsistency, budget overflow, and `profilePromise` under-delivery.

   **Canonical containers**
   - When one rigid bottle, tank, gauge, cavity, or bezel keeps the same outer frame while its contents change, read `canonical-containers.md` and author one `canonical-container` intent, compiling to one clean plate, one unique canonical frame, one complete content-state sheet, one shared interior polygon, and one authoritative internal surface. Never model the same fill as separate water/waterline nodes or redraw the frame per state.

   **Sound and camera IDs**
   - `beat.soundCue` is only for a discrete event sound effect; narration only ever belongs to `scene.narration` — the compiler rejects the removed `audioCue` field so the two can't be conflated.
   - Camera treatments use the single target id `scene-camera`; scene-number aliases like `scene-04-camera` are invalid.
   - Never render dialogue, exposition, or narration as speech balloons in generated images — spoken content belongs to audio plus subtitles. A rare, short, editable `graphic.role=visual-sfx` typography node may reinforce a discrete impact/motion sound only when it binds the same beat's `soundCue`, stays within the Profile's per-scene count/duration range, begins hidden, and has explicit show/emphasis/hide events. Environmental sound (wind, rain, traffic, crowd) stays audio-only — never turn it into persistent decorative words.

   **Spatial contracts**
   - In the same pass, add root `spatialContracts[]` whenever a hero must touch a surface, stay locked while seated, clear subtitles, pass behind/in front of a named layer, preserve a causal setup across adjacent scenes, sustain locomotion through a proof window, move horizontally while a registered pose is active, or follow a curved two-dimensional route.
   - Grounding: binds the real subject anchor (prefer a registered state anchor), explicit support polyline, tolerances, proof ids, optional foreground paint relation, optional subtitle clearance.
   - Continuity: binds adjacent endpoints, world/subject/prop families, framing/camera tolerances, and both scenes' grounding contracts.
   - Gait: the generic locomotion-cadence contract for walking/running/flying/swimming — binds at least two registered states, minimum changes per second, and whether cycling must continue through the window end.
   - `travel-facing`: binds the ordered proof window, signed horizontal direction, minimum travel, exact expected facing, and rationale. Every `traverse`-preset state-sequence target requires one plus a matching `gait` contract for the same scene/node, including intentional reverse or sideways-looking travel — never merely because an in-place pose uses `settle`.
   - `path-locomotion`: binds one 3D cubic route, start/turn/end proofs, the registered locomotion states and cadence, minimum screen/depth travel, required toward/away directions, projection-scale delta, direction-sector coverage, heading-error and turn-rate limits, plus the exact path/camera/world relation. It replaces separate `travel-facing` and `gait` records for that same route because it proves both inside one contract.
   - Occlusion: declares an external foreground relation (`in-front-of-subject` or `behind-subject`) with proof times and minimum alpha-tight overlap. The evaluator checks the resolved paint order and alpha-tight overlap at every proof time and rejects a subject that was lifted above the foreground merely to stay visible. A grounding `frontOcclusion` requires its own matching occlusion contract; declared metadata alone never passes.
   - Action sequence: proves a multi-stage semantic action (`establish → anticipate/action → peak → settle`) as strictly ordered phase proof moments, each phase bound to an actor node, optional registered state, and optional signed travel. It binds the narration cue and requires every actor in `actors[]` to own a separate trajectory/occlusion contract covering the same window. Narration windows with several active motion actors fail closed unless every actor has such a contract.
   - Registered geometry: every registered pose-family/layer family is checked against alpha-tight `sourceRect` geometry (centroid, baseline, aspect/proportion/scale drift) and silhouette-facing consistency; a metadata `facing` that contradicts the rendered transform or the alpha silhouette direction fails.

6. If the compiled storyboard preserves the approved scenario's exact state families and registered source packages and stays inside its complete expected-call count, treat the prior card selection as the attributable approval; do not ask again. Write one selection JSON containing `scenarioDecision`, `planDecision`, `budgetDecision`, the compiled `sourcePackageDecision`, and provider selections copied exactly from the approved card, then run:

   ```bash
   npm run project:confirm-concept -- <slug> --input=<selection.json>
   ```

   The command rejects any state-family/source-package/card drift. If compilation changes a material promise, return to the same scenario gate with the revised exact card. Otherwise this records all providers plus `capabilities-ready`, `brief-ready`, and `approve-concept`. Never call an image provider before this command has recorded the exact cap. The story-specific style sample at the next gate is already counted in the scenario estimate and cap.

If a custom provider or incompatible explicit duration/scenes cannot be resolved in the combined decision, remain at the gate and ask one concise question.

## Style and Fictional Voice Gate

At `style-review`, create the fewest representative source families needed by the compiler-owned `styleProofPlan` and only enough fictional speech to judge the voice. Run `project:style-proof`; it must cover the plan's highest semantic-risk classes, each concrete coupled relationship, and state-sequence behavior instead of mechanically selecting one highest score — a low-risk film with none of those facets still gets one `baseline:representative` target, and one source package may cover several risks when the plan records that reuse.

- Bind every target, the complete plan fingerprint, and both motion-contract fingerprints, then render 3–5 seconds through real v12 composition nodes.
- Every selected target, including a `free` target, must produce a non-empty structured composite with current full-frame/crop/debug evidence.
- A selected spatial-contract target must also execute its deterministic contract proof and draw the contract-specific debug overlay; endpoint crops without a passing `spatialProof` cannot satisfy the style gate.
- Registered or semantic targets also require their quality-compatible member evidence and recorded checks. Inspect full-resolution relationship crops and the pattern-specific evidence from `quality-motion.md`; a registered depth stack requires family-level reconstruction and responsive envelope extremes.
- Show `motion-language-card.json` beside the provider/model, voice identity, sample artifacts, and known cost — it exposes the whole-film grammar, pacing, camera/transition/ambient strategy, per-scene phrase roles, final holds, exceptions, and approval fingerprint.

After explicit approval, run:

Before any style image call, classify its semantic risk. If it is not decorative, author and lock `semantic-contracts.json` as described in `semantic-contracts.md`; do not treat the prompt as the contract. Use schema-v8 image requests with the current project's exact `styleProfileBinding`, include every bound directive verbatim in the prompt, declare all profile-required asset checks, and choose an explicit output surface; every scenario-bound provider-generation/edit request must also carry the exact current `scenarioRootBinding`, and a layer-aware request must carry the exact compiled `layerPackageBinding`. Reserve quota-consuming attempts before invoking a host image provider.

```bash
npm run project:advance -- <slug> approve-style-voice --note="<explicit decision>"
```

`approve-style-voice` refuses any selected treatment whose style-proof composite is missing, empty, stale, or incomplete, or whose proof does not bind the current motion contract. It records the human note and exact motion approval in `motion-approval.json`. Registered/semantic targets additionally require their participating assets and composites to have current passed checks. This strengthens the existing gate; it does not add another human wait. Directing-only revisions may preserve the approval fingerprint while invalidating exact proof; semantic role/grammar/proof/intent/Profile changes return here.

Never substitute a real-person clone. Treat cloning as a separate opt-in requiring licensed audio and transcript authorization.

## Produce in Batches

At `asset-production`:

1. Group checkpoints by recoverable batch or location, not by every file. Keep provider provenance per asset.
2. Classify every image as `decorative`, `identity-critical`, `topology-critical`, `mechanism-critical`, or `diagram-critical`. Bind every critical request to a ready reusable semantic contract and its evidence targets. Keep recurring-character `generationFamily` separate from composition mask/source families.
3. Route relationships before generation: persistent `inside`/`on`/`held-by`/`worn-by` contact uses `supported-subject`; a shared shoreline/horizon/edge uses `registered-environment`; only independent elements use `free`. If no pattern represents the approved meaning, extend the reusable contract before bulk generation.
4. Execute each compiled layer source package exactly as described in `layer-complete-assets.md`.
   - A `registered-layer-sheet` is one 2×2 provider root containing reference plus three complete layers, declared as `outputSurface.mode=layer-sheet`: reference/rear are opaque, while subject/front use real alpha or, by default for a host image model without reliable native alpha, one explicitly declared flat chroma-key color.
   - For provider-native chroma cells, declare `keyPlane.mode=provider-native-observed` and `policyId=flat-v1` — never require the model to reproduce one exact RGB triplet. The runtime must prove one stable, connected, boundary-covering key plane, record requested and observed colors plus the observation fingerprint, and use only the observed color for deterministic keying.
   - Record the provider-native RGB sheet unchanged; put separator removal, explicit source-cell rectangles, keying, scaling, and key metadata inside the schema-v2 `registered-family` spec, then run `assets:derive-registered-family`. That CLI owns the three canvas-preserving local derivatives, manifest provenance, completeness, lifecycle, keying fingerprint, and optional group patching.
   - `context-preserving-layer-edits` remains one complete reference plus three edits that each retain that full reference context. Never use masks on a flat composed master to claim a hidden clean plate or full silhouette. If only a flat source exists, keep the family `rigid-locked` and limit motion to the whole source/group/camera.
5. Execute each compiled canonical container exactly as described in `canonical-containers.md`. Generate and record only its clean plate, unique canonical frame, and complete contents-only state sheet; then run `assets:derive-canonical-container`. The deterministic processor owns the shared interior mask, center/bottom registration, state metrics, terminal-fill checks, lifecycle, family fingerprint, and optional three-slot group patch. It rejects independently drifting members, duplicate authoritative surfaces, an opaque fake-alpha frame/sheet, excessive repair, and an incomplete terminal state.
6. Create schema-v8 requests and try `provider:reuse` before paid or slow generation. Bind the frozen executable Style Profile and exactly one current `providerRootPlan` root to every scenario-bound provider-generation/edit request; changing the profile, directives, root id, or plan fingerprint invalidates request reuse. A `manual-import`, local SVG/Canvas drawing, deterministic derivative, or provider image bound to a different root never fulfills that root. Follow both `storyboard.directingSummary.generationBudget.sourcePackagePlans` and `poseSheetPlans`, including their compiled per-state facings. Every multi-state identity/prop family still gets one registered 2×2 or 3×2 `stateSheetBinding` provider request, never one call per state. Bind one active identity-reference asset, an anchor policy, and per-state facing/anchors. Process it with `assets:process-state-sheet`; preserve one shared registration canvas for every state and retain the generated per-state anchor overlays. When a reviewed source state is correct except for left/right orientation, the state-sheet spec may apply a deterministic `horizontal-mirror` orientation transform to that complete registered cell, invert its anchors, record source/output facing and provenance, and avoid another provider call. When clean provider gutters prove a pose crossed a nominal equal-grid edge, an explicit non-overlapping source-rectangle extraction may deterministically re-register the complete sheet onto that shared canvas; record every source rectangle and placement. Never generate or splice an isolated replacement layer or state.
7. Validate a request with `provider:request validate` before invoking it.
   - When a provider is known to return a native canvas instead of the requested delivery canvas, declare root `providerSource` with minimum dimensions, aspect tolerance, and exact deterministic target canvas. Record the untouched provider output first, then run `assets:normalize-provider-source`; never resize it in place or claim the normalized derivative was the provider result.
   - Before a host provider-generation/edit call, run `provider:attempt reserve`; use the returned canonical invocation and pass its attempt id to `provider:record` — the record command inherits provider/model from that attempt. `provider:run` reserves automatically for command adapters.
   - Close abandoned attempts explicitly; never erase the ledger. If a succeeded attempt was closed but manifest writing failed, use `provider:recover-record`; do not reserve or count it again.
   - A rejected output may become a source only through `provider:recover-rejected-source`: run `--check` first, require the unchanged historical request/output, consumed rejected attempt, declared source SHA, and passing observed key-plane evidence. An `alpha` request returned as an opaque neutral baked transparency checkerboard may instead use the bounded `baked-checkerboard-alpha/checkerboard-alpha-v1` observation. Then record lifecycle `recovery-source` without changing or appending the attempt ledger. It remains a rejected attempt and is never reclassified as succeeded.
   - Use `provider:attempt summary` for read-only auditing; it must show the profile ceiling, human-approved cap, usage, reservations, and remaining capacity. Never invoke against a missing approval or the profile ceiling alone. Rejected, abandoned, and unused provider results still count when quota was consumed.
   - When the human explicitly increases the image budget after concept approval, run `project:increase-image-budget -- <slug> --limit=<exact-total-cap> --note=<decision>` before reserving another attempt. The command records an append-only old/new/usage/ceiling audit chain and may only increase the cap within the current profile hard ceiling. Never hand-edit `approvedImageBudget`.
   - Record the untouched provider-native registered sheet as the provider root; registered sheet cell crops, separator removal, keying, scaling, masks, alpha extractions, and exact reuse are fingerprinted local derivatives and do not consume another slot.
8. Keep manifest-v4 lifecycle truthful: new records are `active`; replacements preserve the prior record as `superseded`. Mark rejected or context-only sources with `project:asset-lifecycle`.
   - All provider and deterministic-derivative commands update `assets-manifest.json` through one lock-protected read/mutate/validate/atomic-rename transaction. Parallel independent derivations are safe, but never hand-edit the manifest or build a second writer around a stale in-memory snapshot.
   - Run `project:quality prepare` and inspect original-resolution evidence. Transparent members receive deterministic low-alpha band and connected-component topology analysis — detached rectangular fragments and hard rectangular silhouettes that follow a registered placement/crop boundary fail technical quality. A `registered-depth-stack` additionally requires neutral reconstruction, reference comparison, checkerboard exploded members, and both extremes of all three responsive reveal envelopes; isolated-asset motion stress is not family proof.
   - When a top-level `supported-subject` or `registered-depth-stack` exists only to bind a technical source family, declare `renderParticipation=derivation-only` — never hide it with `opacity=0`. It cannot satisfy directing/profile promises or receive events/proofs/semantic targets; quality limits it to deterministic completeness/provenance/derivation checks while visible consumers own visual review.
   - Parallax rigs and motif fields remain composite targets. Never pass a semantic check merely to unblock production.
9. Generate/import one narration file per scene so revisions stay local. Before each production voice call, add `timingBinding` (storyboard scene id, allowed min/max media duration) to the request — `provider:record` measures the take and rejects an unfit one before assembly.

   **Node motion mechanics**
   - Implement the compiled plan exactly: node keyframes use parent-normalized additive `offsetX`/`offsetY`; absolute placement stays in `transform.x`/`transform.y`; only camera keyframes retain pixel `x`/`y`.
   - A compiled `path-locomotion` target is one `state-sequence` whose `motion.path` alone owns additive `x/y`, optical `z`, projection, dynamic depth order, and path-tangent rotation. Keep ordinary keyframe `offsetX/offsetY/scale/rotation` absent, static rotation at zero, and idle limited to `still|breathe`; bind the independently compiled looping state schedule to the same target. When camera follow is authored, use one oversized top-level world node and let `camera.follow` consume the same resolved path.
   - Travel proof is temporal, not a static endpoint: gait/travel-facing/path-locomotion evidence must show state rotation, path displacement, heading/velocity consistency, and no backward or jitter-only segments; the whole-film motion review consumes a fingerprint-bound temporal motion strip, never a batch of stills.
   - Continuous treatments need real keyframe/idle motion on the named target: `traverse` needs a large world-relative path, `sway` needs the sway idle primitive plus a bottom-biased motion pivot, `parallax-camera` needs `camera.parallax.enabled=true`, visible camera movement, and at least two distinct node depths.
   - Never lift a subject merely to clear subtitles: its alpha-tight visible bounds must clear the active subtitle exclusion zone while its declared foot/seat anchor still meets the support surface.

   **Occlusion and stacking**
   - A foreground inside one group cannot occlude a subject in a higher sibling stacking context. When a top-level visible `registered-depth-stack` must interleave with an external scene subject, use `stackingContext=scene`, keep the group carrier at identity, and assign unique member `z` values that satisfy the spatial contract.
   - A `locked-contact` subject must not receive local float/drift, or inherit a different moving carrier from its support.

   **Looping worlds and routes**
   - A compiled `looping-environment` needs a current passing `world-topology-proof.json`, active `looping-strip-derivative` manifest records, one `world-strip` per compiled role with a truthful visible surface role, exactly one tracked subject plus declared participants, explicit screen/world anchor and near-occlusion bindings, and `assets:derive-looping-strip` source/render seam evidence. The strip proof checks both edge equality and seam salience at the outer tile boundary; `mirror-crop` also checks its internal mirror fold, at source and every render scale. A subject behind a sparse or low foreground may set `requireNearOverlap=false`: z-order remains mandatory, but proof must not force decorative plants to cover the subject. Sparse foreground families may use deterministic `decorativeScatter` regions/placements so reviewed plants or rocks are split, resized, flipped, and reordered before the seamless tile is derived. Never place repeated copies manually or let camera transforms move the viewport-sized strip carrier away from coverage.
   - For a sustained world such as a route, declare root `worlds[]` plus each scene's `composition.world`: root strips bind the same declared source asset for every far/mid/ground/near role across scenes; each route traveler declares its inclusive safe-band proof window so an in-band racer may later make a formally checked offscreen exit; markers must be grounded in that band.
   - For causal competition/travel stories, declare `trajectoryContracts[]` for state-at-proof, relative order, signed travel distance, monotonic forward travel (may settle without reversing), offscreen exit, and sequence order. Add a `continuity` spatial contract when an outgoing result and incoming setup must reuse the same world/families/framing/grounding. Never rely on prose alone to prove overtaking, sleep/pass, wake/chase, collision/pickup, finish, or final stop.

   **Motif fields and state sequences**
   - A compiled motif field needs one matching deterministic `motif-field` node with the same preset/distribution/count/cycles/bounds/`exclusionZones` and optional `worldBinding`; use `rise-drift` for bottom-to-top bubbles. When the bubbles belong to a travelling `looping-environment`, bind them to the intended strip role and keep `relativeDriftAmplitude` small instead of letting camera motion carry the whole field.
   - Visibility treatments need a node `visibility.initial` plus a matching persistent visibility event; graphic treatments need editable `text` or `shape` nodes; coupled patterns need their registered group; every state family needs one `state-sequence` node with current identity, anchor, and facing evidence.
   - Sustained locomotion must meet its `gait` spatial contract — translating one frozen pose is not walking, running, flying, or swimming. When motion ends inside the scene, keep `activeStateIds` cycling through `activeUntil`, then order any non-active brake/landing/contact states from exactly `activeUntil` onward, with `holdStateId` as the final settled state.
   - Never emulate state replacement, a visibility lifecycle, depth parallax, a looping world, or a motif field with overlapping asset piles and opacity toggles.

   **Events**
   - Copy approved proof ids/times/assertions/stateAssertions exactly. Map every storyboard beat to one or more ordered `scene.events[]` records, keeping visual and sound on the same event when they're one beat. Use the storyboard's approved proof id for critical visual/sound events.
   - For every compiled encounter, bind the four matching events with `event.encounter.contractId` and its phase. Only the `answer` event carries the contract's narration cue. Project validation rejects a wrong target, missing/duplicated phase, mistimed cue, or any visibility event that teleports the encountered target.
10. Run `project:composition-proof`; it synchronizes real narration duration, renders a subtitle-free composition surface, reuses only current surface-scoped fingerprints, renders changed relationship/semantic-contract/spatial-contract evidence, and creates per-member alpha/checkerboard/tight/alpha-band evidence plus family-aware layer-stack and canonical-container mask/progression/terminal proof.
    - Spatial debug frames draw the support polyline, resolved anchor/gap, subtitle zones, and pass/fail state; the proof also samples real state cadence, actual stacking paths, adjacent-scene families/framing, and alpha-tight subject/front bounds where required. A failing spatial or canonical-container proof stops the command.
    - Subtitle-only runtime changes invalidate subtitle/final-frame evidence but do not invalidate unrelated composition evidence; a spatial contract that requests subtitle clearance deliberately binds the active responsive subtitle zone. Use `--force` only for an intentional complete rerender.
    - Then run `project:quality <slug> scaffold`, generate its fingerprint-bound `contact-sheet`, inspect, and submit that same scaffold with `record-batch`. A changed report, target, proof, or evidence hash makes the scaffold/contact sheet stale and requires regeneration; when reviews remain, continue from the emitted incremental scaffold. Never treat a scaffold as an approval or display an unbound older contact sheet as current.
    - Scaffolds are schema-v4: motion-bearing composites carry `evidenceClasses` (`full`/`crop`/`debug`/`temporal`) and a current fingerprint-bound temporal motion strip; missing or stale temporal evidence fails closed at scaffold generation, contact-sheet creation, and `record-batch`. Whole-film motion review cannot be satisfied by static frames alone.
11. To inspect a proposed scene, use `project:scene-preview -- <slug> --scene=<sceneId>`; it renders the actual current project scene, not a style sample. To combine adjacent narration while a merged scene is being authored, use `project:stitch-narration -- <slug> --scenes=<a,b,...> --target-scene=<new-id>` and carry its provenance, SHA-256, text and subtitle offsets into the reviewed replacement scene. Use `project:budget` for the one read-only total (human cap, profile ceiling, expected, used, reserved, remaining, avoided), and `project:render-status` for persisted render lifecycle state. Never interpret quiet Remotion CLI output as a frame percentage.

12. Read `timing-continuity.md`, then seal the production set with one command:

   ```bash
   npm run project:assets-ready -- <slug>
   ```

   It first recomputes `runtime-build.json` and rejects any locally drifted schema/validator/quality/runtime file. It then synchronizes narration, caps padding tails when duration was inferred, derives visible subtitles, builds the deterministic timeline mix, automatically masters it to the declared LUFS/true-peak contract, encodes and measures both actual 96k preview AAC and 192k final AAC delivery surfaces, validates schema-v12 project/storyboard plus the approved motion contract and v9 editorial/state schedules/events/scene-boundary continuity, requires every approved provider root to have exactly one active provider-generation/edit record or formal rejected-output recovery source, rejects stale proof and motion-approval fingerprints, enforces asset/composite/whole-film motion quality, validates subtitle transcript/timing/safe-area/font contracts, writes a fingerprinted `assets-ready-seal.json`, and advances to preview.
   - Subtitle placement is scene-aware: author `sceneDirecting[].subtitlePlacement` with a per-scene anchor/safe-area and exclusion zones (bird, title, foreground); the runtime places cues inside the scene rect, the subtitle contract rejects unresolved exclusion conflicts, and the encoded subtitle sheet stays the review surface.

   - Loudness gain, compression, limiting, and codec headroom are automatic technical operations, never a human gate.
   - Direct `project:advance ... assets-ready` is not a substitute — it only accepts that current seal. In `preview` or `human-review`, the same command is an idempotent recheck and does not advance again.
   - Explicit duration deficits block here; add real content or revise the approved target instead of padding. This stage cannot claim rendered audiovisual coverage because no artifact exists yet. Do not run separate sync/subtitles/validate commands first.
   - A current seal also atomically marks pending/in-progress `directing-revision-*` work items completed, because the storyboard/project execution sync has now passed the canonical validation surface. Any unrelated unfinished item, or a blocked directing revision, stops assets-ready; preview approval and both render modes reject every unresolved work item rather than silently bypassing it.
   - A directing revision must attribute responsive placement, cue, binding, and scene-directing changes to the exact affected scene ids; only a genuinely global editorial change such as active profile, media, timebase, or responsive-profile policy invalidates every scene.
12. Run `project:preview`. Its first preflight rejects a stale assets-ready seal or unresolved work item before narration sync, audio encoding, quality work, or frame rendering. Its post-render report is the first authoritative silence/low-motion union check and extracts one encoded subtitle frame per narrated scene. Fresh and audio-only renders both mux the exact already-measured delivery AAC stream; the renderer reuses an unchanged artifact, or reuses the existing video stream when only audio inputs/gain changed. Any visual fingerprint change forces a full frame render, followed by the same authoritative audio mux. Repair failures and continue autonomously until it reaches `human-review`.

Normal production commands update `projects/<slug>/production-metrics.json`. Treat AI-review and provider-attempt durations as end-to-end session windows, not provider-only inference time; do not infer token usage. Run `project:metrics -- <slug>` once when comparing completed projects or diagnosing a slowdown, rather than polling it during production.

If a confirmed provider becomes unavailable, preserve the stage and report the exact missing capability. Never invent artifacts or silently switch paid services.

## Preview, Final, and Publication

At `human-review`, show `preview.mp4`, `contact-sheet.jpg`, `subtitle-contact-sheet.jpg` when narration exists, `transition-contact-sheet.jpg` when the film has scene boundaries, and `report.json`, separating technical results from creative judgment. This is a review of the fully produced approved profile, not a structural placeholder: `validation-report.json.providerRealization.passed` must be true and its realized/expected roots must match before the preview can exist. Confirm `continuityAnalysis.passed` and `subtitleProof.passed`; the report rejects unapproved intervals that are both silent and low-motion, while the subtitle sheet is the encoded-frame review surface rather than OCR proof. Record revision feedback in `review.md` and `request-preview-revision`; after explicit approval run:

```bash
npm run project:advance -- <slug> approve-preview --note="<explicit decision>"
```

When the human requests a directing-only revision, export/edit the current compiled storyboard and run `project:revise-preview-directing -- <slug> --input=<storyboard.json>`. Use `--source=asset-production` only for explicit human feedback received after style approval but before assets are sealed; otherwise its default `preview` source requires the recorded preview revision request. The command accepts timing, treatments, proof timing, and legal scene-boundary changes; it rejects changes to the approved arc, style, scene/beat meaning, or proof assertions, recompiles against the approved motion budget, invalidates derived preview/final evidence, and creates one execution-sync work item per affected scene. It does not call a provider or silently change the production profile. A visibility-event proof may show its settled persistent state any time after the event begins and before the same target's next visibility change.

When the recorded human feedback explicitly changes scene meaning, narration, or deliberate stillness, use a schema-v1 authorization and run `project:revise-preview-semantic -- <slug> --input=<storyboard.json> --authorization=<authorization.json>`. Only listed scenes may change; top-level arc/style drift is rejected. A `motionPolicy=locked-static` scene must have a rationale and static-only treatments. The command records old/new concept fingerprints, preserves the approved provider cap, recalculates only legal motion-scene floors, and invalidates all downstream style/proof/render evidence.

After preview approval, run `project:render`. A successful final render completes the local production task and reports `final.mp4`, the contact sheet, validation report, and technical acceptance result.

Do not ask for a publication approval merely to mark local delivery complete. If the human later requests upload, sharing, or publication, verify content/facts/rights/platform suitability and obtain one just-in-time authorization for that external action.

After that authorization and before performing the named external action, record its destination, action, and scope:

```bash
npm run project:advance -- <slug> approve-publish --note="<destination + action + scope>"
```

`complete` remains the local lifecycle terminal state; `approve-publish` is an optional post-completion audit event, not another production stage or a reusable authorization for any other destination/action.

## Keep Turns Lean and Recoverable

- Run `project:resume` once at the start of a new turn or after an interruption; do not pair it with full status or `project:handoff-check`.
- At `asset-production`, a null `control.nextCommand` means continue `control.workItems.remaining[0]`; when no batch remains, resume returns the concrete `project:assets-ready` command.
- In `auto-continue`, continue to `control.nextCommand` or the next remaining work item. A tool result is not a human gate.
- End normally only at a human gate, completion, or a genuine blocker with one required user action.
- When implementation files change, run `npm run check`, relevant validation/tests, and `npm run plugin:sync` before validating the packaged Skill/runtime.
