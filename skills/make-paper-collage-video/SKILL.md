---
name: make-paper-collage-video
description: Create, resume, revise, or finalize editable, narrated Remotion videos in paper-cutout, hand-drawn, historical-collage, or comic-inspired (Korean/Japanese/Hong Kong/American) styles, including layered/parallax illustration, persistent travelling environments, functional diagrams, and recurring characters. Use for a new video brief or to continue an interrupted project tracked in production.json; drives style approval, motion/asset planning, provider budgeting, and quality review through to local final delivery.
---

# Make Paper Collage Video

Build an editable video while keeping the human in charge of concept, style/voice, preview judgment, rights, and external publication. Use `production.json` as the resume source of truth. Runtime commands validate their own contracts and print actionable errors — when one rejects an input, fix the named input instead of re-deriving the rule from this document.

## Start With One Small State Read

1. Treat the current directory as a workspace only when `package.json` exposes `project:new`, `project:resume`, `project:preview`, and `project:render`. Resolve this loaded Skill's plugin root and run its `bootstrap-workspace.mjs --target=<cwd> --status-json` once before the first project write or provider call. Require both `compatible=true` and `productionSessionCompatible=true`. If runtime compatibility is false, show the reported identities and managed/preserved scopes, obtain explicit upgrade approval (unless the current user message already authorizes it), then run `--upgrade` and repeat status plus doctor once. If only `session.targetMatchesCwd=false`, do not upgrade or copy anything: stop and require a new task whose primary local workspace is the target. Otherwise, or when no workspace exists, read [references/setup.md](references/setup.md), bootstrap a writable workspace, and run its doctor. If this Skill was injected from a versioned plugin-cache path that no longer exists, stop and report a stale task snapshot instead of guessing a cached version.
2. Inspect `git status --short` in Git workspaces and preserve unrelated changes.
3. For an existing slug, run only `npm run project:resume -- <slug>` and continue from `control.mode` and the remaining work items. Do not repeat recorded approvals or re-read full history unless diagnosing state.
4. For a new project, derive a lowercase hyphenated slug and run `project:new -- <slug> --title=<成片标题>`. The slug is an identifier, not the title; without `--title=` the project carries the slug as its display title.

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

- Keep 30 fps, a general Chinese-language audience, and the configured fictional narrator unless the brief requires otherwise. The intake gate owns aspect ratio and visual style — never default them silently from a title-only request.
- Preserve user-specified duration and scene count independently; infer only missing values.
- Recommend `balanced`, but never select it invisibly. Show `draft`, `balanced`, and `full-depth` as `轻量成片`, `均衡动画`, and `完整纵深`. A profile ceiling is planning capacity, not spend authorization: the human-approved `budgetDecision.imageAttemptLimit` is what the attempt ledger enforces.
- Do not clone a real person, use unclear third-party rights, publish, upload, or send externally without separate authorization.
- Ask only for missing information that materially changes the subject, factual position, rights boundary, delivery format, or material cost.

## New Project: Intake, Then Three Scenarios

At `capability-review`, use only the current host model; do not call an unconfirmed external or paid provider.

1. Read `providers.md`, `story-planning.md`, `motion-directing.md`, and `approval-gates.md`.
2. Run `project:intake -- <slug> --json --presentation-root=<plugin-root>/assets/remotion-template`. Render every returned `presentationPath` style card in the conversation (never `runtimePath`); if a card cannot actually be displayed, stop and report a host media blocker. Then ask exactly three selectors, using the host's Ask Question UI when available: `16:9` or `9:16`; one returned visual style (the catalog is dynamic — never hard-code ids or counts); and parallax preference `auto|prefer|minimal` (`分层视差` is not another style). Do not ask about production profile or cost in this popup. Record the answer with `project:intake`; confirmation freezes the executable `styleProfile` — do not hand-edit it afterward.
3. Run `provider:status -- <slug> --compact-json` once. Using the host model, write one common story skeleton and all three `planning-scenarios` inputs; preserve any user-fixed duration/scene count in every option, otherwise bind `draft→concise`, `balanced→standard`, `full-depth→expanded`. Each option must show duration, scene count, beat rhythm, state families, rear/mid/front/near plan, parallax and ambient plan, exact expected image calls, proposed approved cap, hard ceiling, local derivatives, avoided calls, provider recommendation/cost basis, factual/rights risks, and final-film effect. The shared scenario enumerates story-critical `semanticActions` routed to real registered states, local-motion targets, or layer packages. Run `project:scenarios -- <slug> --input=<scenarios.json> --json`.
4. Present all three scenario cards together and recommend `balanced`. This single selection is the combined story-scope/concept/profile/budget/provider approval; do not add another routine confirmation after it.
5. After selection, continue automatically: run `project:plan -- <slug> --scenario=<draft|balanced|full-depth>`, fill `brief.md`, then run `project:storyboard-scaffold -- <slug>` — it converts the approved scenario into a schema-v12 storyboard skeleton with real scene/beat/proof/treatment structure pre-filled and every remaining creative field marked `TODO(author)` (the compiler rejects leftover markers). Fill only the listed markers and the printed spatial-contract obligations instead of hand-writing the whole file. While authoring:
   - Read `motion-contract-v1.md` and author one structured whole-film `motionDirection`; every beat gets a `performanceRole` plus `proofTimeId`, never prose motion language. Every scene needs at least three ordered beats and three proof moments including a final state after `at=0.82`.
   - Author one scene record per planned scene, one v9 `editorial` contract, and exactly one `sceneTransitions[]` boundary per adjacent pair — declare `intent` and `rationale`, and normally omit `treatment` so the Style Profile routes it deterministically.
   - Read `layer-complete-assets.md` before any rear/subject/front source package; read `canonical-containers.md` when a rigid frame keeps its shell while contents change; read `path-locomotion-3d.md` for 3D travel and camera follow; read `editorial-system-v9.md` for actual-audio edit points, typography, annotations, and data SVG.
   - For a tracked subject in a persistent travelling world, route `world-travel` to `looping-environment` plus `scroll-world-x`; after compilation run `project:world-topology-proof -- <slug>` before any looping-world image request.
   - When narration names successive characters the traveler meets, author `scene.encounters[]` binding narration cues to physical `enter/approach/answer/exit` beats — opacity toggles are not an encounter lifecycle.
   - Add root `spatialContracts[]` for every support, continuity, gait, travel-facing, path-locomotion, occlusion, and action-sequence obligation (`motion-directing.md` defines each kind).
   - Never hand-author compiler-derived fields (motion contracts, summaries, fingerprints, sheet grids, world copies). `project:storyboard` compiles and rejects inconsistency, budget overflow, and `profilePromise` under-delivery with actionable errors.
6. Run `project:confirm-concept -- <slug> --scaffold` to emit the complete selection JSON: `planDecision`, `scenarioDecision`, `budgetDecision`, and the canonical `sourcePackageDecision` are all computed from the current plan/scenario/storyboard. Fill in only `note` (the human's own words) and each `selections[].providerId`; do not rebuild any decision by hand — `sourcePackageDecision` is a four-key projection of `generationBudget`, not a copy of it. Then run:

   ```bash
   npm run project:confirm-concept -- <slug> --input=<selection.json>
   ```

   This records all providers plus `capabilities-ready`, `brief-ready`, and `approve-concept`. Never call an image provider before this command has recorded the exact cap (the style sample at the next gate is already counted). If compilation changed a material promise, return to the scenario gate with the revised card: `project:scenarios -- <slug> --input=<revised.json> --replace-unconfirmed-plan` is executable while the budget is unapproved and nothing has been generated — it clears the derived, unapproved motion contract for you. If a custom provider or incompatible explicit duration/scenes cannot be resolved, stay at the gate and ask one concise question.

## Style and Fictional Voice Gate

At `style-review`, make the final film understandable before bulk production:

1. Create exactly one story-specific style sample and only enough fictional speech to judge the voice — the only provider calls allowed before this gate. Classify the sample's semantic risk first; if it is not decorative, author and lock `semantic-contracts.json` per `semantic-contracts.md`. Use a schema-v8 request bound to the current `styleProfileBinding` and `scenarioRootBinding`, and reserve the attempt before invoking the provider.
2. Run `project:materialize-execution -- <slug>` to turn the approved storyboard into the final schema-v12 execution tree. Every layer stack, state sequence, locomotion path, motif field, proof time, and scene transition is mapped from the compiled `compositionPlan`; the command prints which layout placements it filled with evenly-spaced placeholders so you can review them against the real composition. Do not hand-author this file — the storyboard already decided its structure. Missing production sources stay missing; the blueprint renderer substitutes deterministic labeled proxies. Do not fake completion with opacity piles. Use `--force` only to deliberately discard an existing tree, and `project:sync-directing` to re-sync an existing tree instead of rebuilding it.
3. Run `project:visual-blueprint -- <slug>`. It renders one low-resolution full-film animatic, a contact sheet with every scene's start/middle/end, and clips for motion-bearing scenes, using the actual renderer with deterministic labeled proxies for missing sources, and writes a hash-bound `visual-blueprint-review-request.json`.
4. Open or embed the style sample, animatic, contact sheet, keyframes, motion clips, voice audition, and `motion-language-card.json` in the conversation — listing paths or saying a command passed is not presentation. The human, not AI screening, judges composition, depth order, occlusion, seams, travel/facing, loop timing, camera, pacing, and overall direction. Ask for one combined approval or direct revision notes, then stop at `wait-human`.
5. Blanket autonomy, prior approval, silence, or a machine score is not a visual decision. Only after a user message explicitly decides the displayed artifacts, generate the receipt (the command computes every hash):

   ```bash
   npm run project:visual-review -- <slug> make-receipt --decision=<approved|revise> --note="<user wording>" --reviewer=human:<id> --host=<host> --thread=<threadId> --message-ref=<ref> --message-file=<user-message.txt>
   ```

   Then run `npm run project:visual-review -- <slug> approve --receipt=<path>` or `... revise --receipt=<path>`. Approval atomically records the receipt, blueprint approval, motion approval, and production state; every non-style-sample provider request stays blocked until it exists. After a `revise`, change the execution tree before re-rendering — an unchanged blueprint is rejected locally, and human revisions are recorded decisions, not failure-circuit events.
6. Replacing proxy sources with production assets keeps the approved blueprint; changing geometry, timing, z-order, facing, playback, camera, transitions, or runtime invalidates it. Never substitute a real-person clone; cloning is a separate opt-in requiring licensed audio and transcript authorization.

## Produce in Batches

At `asset-production`:

1. Group checkpoints by recoverable batch or location, not by every file. Keep provider provenance per asset.
2. Classify every image as `decorative`, `identity-critical`, `topology-critical`, `mechanism-critical`, or `diagram-critical`; bind every critical request to a ready reusable semantic contract. Route relationships before generation: persistent contact uses `supported-subject`, a shared shoreline/horizon uses `registered-environment`, only independent elements use `free`.
3. Execute compiled layer source packages exactly per `layer-complete-assets.md` and canonical containers per `canonical-containers.md`; process results with `assets:derive-registered-family` and `assets:derive-canonical-container` — the deterministic CLIs own derivatives, registration, lifecycle, and fingerprints. Every multi-state identity/prop family is one registered 2×2 or 3×2 sheet request processed by `assets:process-state-sheet`, never one call per state and never an isolated replacement cell. Speech stays in audio plus subtitles — never render dialogue or narration as balloons in generated images (`motion-directing.md` covers the narrow `visual-sfx` exception).
4. Validate each request with `provider:request validate` before invoking. Reserve quota with `provider:attempt reserve`, use the returned canonical invocation, and record with `provider:record` (it inherits provider/model from the attempt; `provider:run` reserves automatically). Try `provider:reuse` before paid or slow generation. A host that returns its own native canvas should declare `nativeCanvas` once in `providers.json`: recording then accepts and observes the native output, and `assets:normalize-provider-source` derives the exact delivery canvas with zero extra provider calls.
5. Keep the budget truthful: rejected and abandoned results still count when quota was consumed, and a rejected request fingerprint cannot be re-reserved unchanged — change the real inputs first. When the human explicitly raises the cap, run `project:increase-image-budget -- <slug> --limit=<exact-total> --note=<decision>`; never hand-edit `approvedImageBudget`. Use `provider:attempt summary` and `project:budget` for read-only totals. Close abandoned attempts explicitly; if a succeeded attempt was closed but manifest writing failed use `provider:recover-record`; a rejected output may become a source only through `provider:recover-rejected-source` (run `--check` first) and is never reclassified as succeeded.
6. All provider and derivative commands update `assets-manifest.json` through lock-protected transactions — never hand-edit it or build a second writer. New records are `active`; replacements keep the prior record `superseded`; mark rejected or context-only sources with `project:asset-lifecycle`. Read `quality-motion.md` for evidence rules; declare `renderParticipation=derivation-only` for families that exist only to bind technical sources.
7. Generate or import one narration file per scene so revisions stay local; add `timingBinding` (scene id, min/max media duration) to every production voice request so an unfit take is rejected before assembly.
8. Implement the compiled motion plan exactly — node keyframes use parent-normalized additive offsets, camera keyframes keep pixels, and a `path-locomotion` target lets `motion.path` own the route (details in `motion-directing.md` and `path-locomotion-3d.md`). Use `project:sync-directing` (or the revision commands' built-in sync) to map compiler-owned proof/state/path/visibility/sound plans into `project.json`; do not maintain a second manual timing implementation.
9. Run `project:composition-proof` (failing spatial or container proofs stop the command; `--force` only for an intentional complete rerender). Then run `project:quality <slug> scaffold`, generate its `contact-sheet`, and show the current sheet and evidence to the human. Record the single human decision with `project:quality <slug> accept-human --reviewer=human:<id> --note="<user wording>"`, or record only the explicitly named defects and revise. AI and automatic screening prepare technical evidence but never record visual pass/fail. Do not wait for the full asset set: after each completed batch, run `project:quality <slug> scaffold --assets=<ids>` (or `--scene=<id>`) plus its `contact-sheet --input=projects/<slug>/quality-review-scaffold.batch.json` and show that batch to the human — an early per-asset decision is recorded once and counts toward the final review, so appearance problems surface while the batch is still cheap to redo.
10. To inspect one scene use `project:scene-preview -- <slug> --scene=<sceneId>`; to merge narration while authoring a combined scene use `project:stitch-narration`; for persisted render lifecycle use `project:render-status` — never interpret quiet Remotion CLI output as a frame percentage.
11. Read `timing-continuity.md`, then seal the production set with one command:

    ```bash
    npm run project:assets-ready -- <slug>
    ```

    It synchronizes narration, caps inferred padding tails, derives subtitles, builds and masters the timeline mix, encodes both delivery AAC surfaces, validates the full schema-v12/motion/editorial/subtitle surface, requires every approved provider root to be realized, writes the fingerprinted seal, and advances to preview. Do not run separate sync/subtitles/validate commands first; in `preview` or `human-review` the same command is an idempotent recheck. Explicit duration deficits block here — add real content or revise the approved target instead of padding. A current seal also settles pending `directing-revision-*` work items; any other unresolved work item stops it. Loudness, compression, limiting, and codec headroom are automatic technical operations, never a human gate.
12. Run `project:preview`. Its preflight rejects a stale seal or unresolved work item; its post-render report is the authoritative silence/low-motion check and extracts one encoded subtitle frame per narrated scene. Repair failures and continue autonomously until `human-review`.

Failed wrapped commands record their input fingerprint in `failure-circuit.jsonl`: the identical input cannot rerun, and a second same-signature failure opens a circuit that requires a human decision via `project:failures -- <slug>`. Human blueprint revisions and rejected provider attempts are not circuit events — they live in the review receipt and the attempt ledger. If a confirmed provider becomes unavailable, preserve the stage and report the exact missing capability; never invent artifacts or silently switch paid services.

## Preview, Final, and Publication

At `human-review`, show `preview.mp4`, `contact-sheet.jpg`, `subtitle-contact-sheet.jpg` when narration exists, `transition-contact-sheet.jpg` when the film has scene boundaries, and `report.json`, separating technical results from creative judgment. Confirm `providerRealization.passed`, `continuityAnalysis.passed`, and `subtitleProof.passed`. Record revision feedback in `review.md` and `request-preview-revision`; after explicit approval run:

```bash
npm run project:advance -- <slug> approve-preview --note="<explicit decision>"
```

For a directing-only revision, export and edit the compiled storyboard and run `project:revise-preview-directing -- <slug> --input=<storyboard.json>`. Pass `--source=style-review` when you find a directing, proof, or state-execution error after concept approval but before visual approval — this is the supported correction path once `project:storyboard` has stopped accepting input and a style sample has already been spent, and it needs no budget change and no hand-edited approval state. Use `--source=asset-production` only for explicit feedback received after style approval but before the seal. It accepts timing/treatment/proof/boundary changes, rejects arc/style/meaning drift, synchronizes the execution tree atomically, and creates one revalidation work item per affected scene. When feedback explicitly changes scene meaning, narration, or deliberate stillness, use a schema-v1 authorization with `project:revise-preview-semantic -- <slug> --input=<storyboard.json> --authorization=<authorization.json>`; only listed scenes may change and the approved provider cap is preserved.

After preview approval, run `project:render`. A successful final render completes the local task and reports `final.mp4`, the contact sheet, validation report, and technical acceptance. `complete` is the local terminal state — do not ask for a publication approval merely to mark delivery. If the human later requests upload, sharing, or publication, verify content/facts/rights/platform suitability, obtain one just-in-time authorization for that exact external action, and record it before acting:

```bash
npm run project:advance -- <slug> approve-publish --note="<destination + action + scope>"
```

`approve-publish` is an optional post-completion audit event, not another production stage or a reusable authorization for any other destination/action.

## Keep Turns Lean and Recoverable

- Run `project:resume` once at the start of a new turn or after an interruption; do not pair it with full status or `project:handoff-check`.
- At `asset-production`, a null `control.nextCommand` means continue `control.workItems.remaining[0]`; when no batch remains, resume returns the concrete `project:assets-ready` command.
- In `auto-continue`, continue to `control.nextCommand` or the next remaining work item. A tool result is not a human gate.
- End normally only at a human gate, completion, or a genuine blocker with one required user action.
- When implementation files change, run `npm run check`, relevant validation/tests, and `npm run plugin:sync` before validating the packaged Skill/runtime.
