---
name: make-paper-collage-video
description: Initialize, create, resume, revise, or productize editable Remotion paper-collage videos with rhythmic storyboards, layered keyframe motion, audiovisual cues, proof-time validation, configurable providers, quality review, and local final delivery. Use for paper-cutout, historical collage, layered illustration, parallax explainer, or an interrupted project that has production.json.
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
4. Author one `storyboard.json` input with a whole-film arc, shared composition/motion language, and one scene record per planned scene. Every scene needs a named blueprint, at least three ordered beats, and at least three proof moments including a final state after `at=0.82`. Lock it with `project:storyboard`.
5. Present one compact decision containing:
   - narration position, scene outline, facts, style, reusable asset plan, and each scene's blueprint/beat rhythm;
   - requested versus inferred duration/scenes;
   - production profile and generated-image budget;
   - proposed text/image/voice providers, model/voice identity, and material cost.
6. Ask once to approve the concept, storyboard, budget, and all unresolved providers. On approval, write one selection JSON and run:

   ```bash
   npm run project:confirm-concept -- <slug> --input=<selection.json>
   ```

   This records all providers plus `capabilities-ready`, `brief-ready`, and `approve-concept`; do not ask for concept approval again.

If a custom provider or incompatible explicit duration/scenes cannot be resolved in the combined decision, remain at the gate and ask one concise question.

## Style and Fictional Voice Gate

At `style-review`, create one representative image and only enough fictional speech to judge the voice. Add a 3–5 second motion proof in the same gate only for a materially new motion language. Show provider/model, voice identity, sample artifacts, and known cost. After explicit approval, run:

```bash
npm run project:advance -- <slug> approve-style-voice --note="<explicit decision>"
```

After revisions, remain at this gate.

Never substitute a real-person clone. Treat cloning as a separate opt-in requiring licensed audio and transcript authorization.

## Produce in Batches

At `asset-production`:

1. Group checkpoints by recoverable batch or location, not by every file. Keep provider provenance per asset.
2. Create a request for every generated/imported output and try `provider:reuse` before paid or slow generation.
3. Stay within the approved asset budget: reuse locations, character sheets, and depth layers; reserve independent rear/mid/foreground assets for scenes where parallax materially supports the beat.
4. Prefer reliable transparent output; otherwise create complete high-chroma character sheets and process them with `assets:process-sheet`.
5. Run `provider:record` after host/manual output or `provider:run` for command adapters.
6. Run `project:quality prepare`. Inspect original-resolution images in small same-type batches and submit one `record-batch` JSON per reviewed batch. Do not pass a semantic check merely to unblock production.
7. Generate/import one narration file per scene so revisions remain local. Populate the v3 timeline in seconds. Copy each approved scene blueprint and proof-time list exactly into `scene.motion`; give every character and environment layer an authored `at=0..1` keyframe path; map every storyboard beat to one `scene.cues[]` entry by `beatId`. Use cue `sound` only when the approved beat calls for it.
8. Seal the production set with one command:

   ```bash
   npm run project:assets-ready -- <slug>
   ```

   It synchronizes narration, derives subtitles, validates the project, enforces hash-bound quality, and advances to preview. Do not run separate sync/subtitles/validate commands first.
9. Run `project:preview`. Continue autonomously until it reaches `human-review`.

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
