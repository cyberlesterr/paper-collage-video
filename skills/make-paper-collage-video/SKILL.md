---
name: make-paper-collage-video
description: Initialize, create, resume, revise, or productize editable Remotion paper-collage videos with rhythmic storyboards, semantic identity/mechanism/diagram contracts, registered composition groups, layered keyframe motion, audiovisual cues, proof-time validation, budgeted providers, dual-scope quality review, and local final delivery. Use for paper-cutout, historical collage, layered illustration, parallax explainer, functional-object diagrams, recurring-character stories, or an interrupted project that has production.json.
---

# Make Paper Collage Video

Build an editable video while keeping the human in charge of concept, style/voice, preview judgment, rights, and external publication. Use `production.json` as the resume source of truth.

## Start With One Small State Read

1. Treat the current directory as a workspace only when `package.json` exposes `project:new`, `project:resume`, `project:preview`, and `project:render`. Otherwise read [references/setup.md](references/setup.md), bootstrap a writable workspace, and run its doctor.
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
- Concept/style/preview decisions, rights, or external action: [references/approval-gates.md](references/approval-gates.md)
- Image review, depth, motion, subtitles, or delivery tuning: [references/quality-motion.md](references/quality-motion.md)
- Recurring identities, functional mechanisms, topology-sensitive subjects, or explanatory diagrams: [references/semantic-contracts.md](references/semantic-contracts.md)
- Editing project/state files or diagnosing validation: [references/project-contract.md](references/project-contract.md)
- Tool-only image generation, recovery, or an `auto-continue` blocker: [references/execution-control.md](references/execution-control.md)

Do not load every reference up front.

## Apply Reversible Defaults

- Use 1920×1080, 30 fps, a general Chinese-language audience, layered paper collage, and the configured fictional narrator unless the brief requires otherwise.
- Preserve user-specified duration and scene count independently; infer only missing values.
- Default to the `balanced` production profile. Offer `draft` for cheaper iteration and `full-depth` for maximum parallax. Treat the plan's generated-image budget as a ceiling unless the human approves a profile change.
- Do not clone a real person, use unclear third-party rights, publish, upload, or send externally without separate authorization.
- Ask only for missing information that materially changes the subject, factual position, rights boundary, delivery format, or material cost.

## New Project: One Concept and Provider Decision

At `capability-review`, use the current host model only to prepare a provisional brief and concept; do not call an unconfirmed external or paid provider.

1. Read `providers.md`, `story-planning.md`, and `approval-gates.md`.
2. Run `provider:status -- <slug> --compact-json` once and inspect actual callable host tools.
3. Fill `brief.md`. Run `project:plan` with resolved duration, scenes, narration estimate, rationale, and `--profile=draft|balanced|full-depth`.
4. Author one `storyboard.json` input with a whole-film arc, shared composition/motion language, and one scene record per planned scene. Every scene needs a named blueprint, at least three ordered beats, a `compositionPlan`, and at least three proof moments with visible assertions including a final state after `at=0.82`. Lock it with `project:storyboard`.
5. Present one compact decision containing:
   - narration position, scene outline, facts, style, reusable asset plan, and each scene's blueprint/beat rhythm;
   - requested versus inferred duration/scenes;
   - production profile and generated-image budget;
   - proposed text/image/voice providers, model/voice identity, and material cost.
   - identity-, topology-, mechanism-, and diagram-critical risks that will require reusable semantic contracts before generation.
6. Ask once to approve the concept, storyboard, budget, and all unresolved providers. On approval, write one selection JSON and run:

   ```bash
   npm run project:confirm-concept -- <slug> --input=<selection.json>
   ```

   This records all providers plus `capabilities-ready`, `brief-ready`, and `approve-concept`; do not ask for concept approval again.

If a custom provider or incompatible explicit duration/scenes cannot be resolved in the combined decision, remain at the gate and ask one concise question.

## Style and Fictional Voice Gate

At `style-review`, create one representative image and only enough fictional speech to judge the voice. Add a 3–5 second proof in the same gate when motion is materially new or the project uses `supported-subject`/`registered-environment`; that proof must use a real v4 group and its registered derivatives, not a masked surrogate. For a coupled proof, run `style:proof`, inspect its full-resolution relationship crops, alpha masks, checkerboard isolates, tight crops, and motion-stress sheets, then record the required asset and composite semantic checks with those evidence files. Show provider/model, voice identity, sample artifacts, and known cost. After explicit approval, run:

Before any style image call, classify its semantic risk. If it is not decorative, author and lock `semantic-contracts.json` as described in `semantic-contracts.md`; do not treat the prompt as the contract. Use schema-v3 image requests and reserve quota-consuming attempts before invoking a host image provider.

```bash
npm run project:advance -- <slug> approve-style-voice --note="<explicit decision>"
```

`approve-style-voice` refuses coupled projects whose style-proof fingerprint is missing/stale, whose evidence bundle is incomplete, or whose participating assets/composite have pending semantic checks. This strengthens the existing gate; it does not add another human wait. After revisions, remain at this gate.

Never substitute a real-person clone. Treat cloning as a separate opt-in requiring licensed audio and transcript authorization.

## Produce in Batches

At `asset-production`:

1. Group checkpoints by recoverable batch or location, not by every file. Keep provider provenance per asset.
2. Classify every image as `decorative`, `identity-critical`, `topology-critical`, `mechanism-critical`, or `diagram-critical`. Bind every critical request to a ready reusable semantic contract and its evidence targets. Keep recurring-character `generationFamily` separate from composition mask/source families.
3. Route relationships before generation: persistent `inside`/`on`/`held-by`/`worn-by` contact uses `supported-subject`; a shared shoreline/horizon/edge uses `registered-environment`; only independent elements use `free`. If no pattern represents the approved meaning, extend the reusable contract before bulk generation.
4. For every coupled group, generate or import one complete master, derive all registered members and masks from it, and record the same `registrationId` and `sourceMasterAssetId`. Never generate coupled members independently or repair the relationship with arbitrary z-index offsets.
   - Do not use a coarse polygon matte for an articulated or internally open subject such as a person, animal, vehicle, chair, tree, rope, or bicycle. Use a capable segmentation/matting path or a carefully reviewed manual matte.
   - If reliable extraction is unavailable, preserve the approved complete master as one rigid visual family and limit motion to whole-master/camera movement. Less local motion is preferable to a damaged silhouette.
5. Create a schema-v3 request for every new image output and try `provider:reuse` before paid or slow generation. Before a host provider-generation/edit call, run `provider:attempt reserve`; pass its attempt id to `provider:record`. `provider:run` reserves automatically for command adapters. Close abandoned attempts explicitly; never erase the ledger.
6. Stay within the approved attempt budget. Rejected, abandoned, and unused provider results still count when quota was consumed. Deterministic masks, crops, alpha extractions, and exact reuse do not consume another slot.
7. Run `project:quality prepare`, inspect original-resolution files plus generated alpha/checkerboard/motion-stress/semantic-target evidence, and record asset reviews in batches with `evidenceFiles` for every evidence-required check. Do not pass a semantic check merely to unblock production. A hard-alpha `key-edge-clean` result proves only that no soft matte contamination was detected; it does not prove silhouette fidelity, identity distinctness, mechanism correctness, or subject completeness.
8. Generate/import one narration file per scene so revisions remain local. Assemble `scene.composition` with local child transforms and authored `at=0..1` keyframes. Copy approved proof ids/times/assertions exactly. Map every storyboard beat to one `scene.cues[]` entry; bind critical visual/sound events to `proofTimeId`.
9. Run `project:composition-proof`; it synchronizes real narration duration, replaces stale proof output, and renders relationship plus semantic-contract targets. Inspect real full frames, targeted crops, cross-scene comparisons, and debug frames. Run `project:quality prepare` again and record composite reviews using `compositeId`.
10. Seal the production set with one command:

   ```bash
   npm run project:assets-ready -- <slug>
   ```

   It synchronizes narration, derives subtitles, validates v4 composition and cues, rejects stale proof fingerprints, enforces both asset and composite quality, and advances to preview. Do not run separate sync/subtitles/validate commands first.
11. Run `project:preview`. Continue autonomously until it reaches `human-review`.

If a confirmed provider becomes unavailable, preserve the stage and report the exact missing capability. Never invent artifacts or silently switch paid services.

## Preview, Final, and Publication

At `human-review`, show `preview.mp4`, `contact-sheet.jpg`, and `report.json`, separating technical results from creative judgment. Record revision feedback in `review.md` and `request-preview-revision`; after explicit approval run:

```bash
npm run project:advance -- <slug> approve-preview --note="<explicit decision>"
```

After preview approval, run `project:render`. A successful final render completes the local production task and reports `final.mp4`, the contact sheet, validation report, and technical acceptance result.

Do not ask for a publication approval merely to mark local delivery complete. If the human later requests upload, sharing, or publication, verify content/facts/rights/platform suitability and obtain one just-in-time authorization for that external action.

## Keep Turns Lean and Recoverable

- Run `project:resume` once at the start of a new turn or after an interruption; do not pair it with full status or `project:handoff-check`.
- At `asset-production`, a null `control.nextCommand` means continue `control.workItems.remaining[0]`; when no batch remains, resume returns the concrete `project:assets-ready` command.
- In `auto-continue`, continue to `control.nextCommand` or the next remaining work item. A tool result is not a human gate.
- End normally only at a human gate, completion, or a genuine blocker with one required user action.
- When implementation files change, run `npm run check`, relevant validation/tests, and `npm run plugin:sync` before validating the packaged Skill/runtime.
