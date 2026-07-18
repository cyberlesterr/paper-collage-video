---
name: make-paper-collage-video
description: Initialize, create, and resume configuration-driven layered paper-collage video workspaces with adaptive duration and scene planning, from a topic or brief through script, storyboard, image layers, fictional narration, preview review, final render, and technical acceptance. Use when Codex is asked to install, make, reproduce, continue, revise, or productize a paper-cutout, historical collage, layered illustration, or parallax explainer video with human approval gates.
---

# Make Paper Collage Video

Turn a human topic into an editable Remotion project while keeping the human in charge of intent, taste, rights, preview approval, and publication. Treat `production.json` as the resume source of truth and never skip its gates.

## Start or Resume

1. Read [references/setup.md](references/setup.md), locate or initialize the writable Remotion workspace, run its doctor, and work from that workspace root. Never generate projects inside the installed plugin cache.
2. Inspect `git status --short` when the workspace is a Git repository and preserve unrelated user changes.
3. If a slug already exists, run:

   ```bash
   npm run project:status -- <slug>
   ```

   Continue from the reported stage. Do not repeat an approval already recorded.
4. If no project exists, derive a lowercase hyphenated slug and run:

   ```bash
   npm run project:new -- <slug> --title="<title>"
   ```

5. Read [references/project-contract.md](references/project-contract.md) before creating or changing project files. Read [references/story-planning.md](references/story-planning.md) before resolving duration and scene count. Read [references/providers.md](references/providers.md) and [references/capability-negotiation.md](references/capability-negotiation.md) before selecting text, image, or voice generation services. Read [references/approval-gates.md](references/approval-gates.md) before generating creative assets, speech, or an external delivery.
6. Read [references/quality-motion.md](references/quality-motion.md) before bulk image production or timeline authoring. Read [references/execution-control.md](references/execution-control.md) before doing work. Obey its `auto-continue`/`wait-human` contract and tool-only image-generation isolation rules.

## Apply Defaults Deliberately

When the human supplies only a topic, use these reversible defaults and state them in the concept proposal:

- Use 1920×1080 and 30 fps unless the delivery format requires otherwise.
- Target a general Chinese-language audience.
- Infer duration and scene count independently from story beats, narration density, audience, and platform. Preserve whichever value the human explicitly supplied; do not ask merely because the other is missing.
- Use layered paper collage with background, rear, subject, and foreground depth.
- Require hash-bound asset quality review for every project. Reject non-v2 project files instead of migrating or interpreting old fields.
- Use the configured fictional narrator profile; prefer `儒雅逸辰 (ruyayichen)` only when the selected provider offers it.
- Do not clone a real person, publish, upload, or send externally.

Ask only for missing information that materially changes the subject, factual position, rights boundary, or output format. Record the answer in `brief.md`; do not make the human edit machine coordinates or JSON.

## Follow the Production Stages

### 0. Discover and Confirm Capabilities

New projects begin at `capability-review`. Inspect the current host's real callable text, image, and fictional-voice capabilities, then ask the human to confirm all unresolved choices in one structured form when the host offers one. Always offer configured providers, manual import, and a way to describe a user-supplied service. Fall back to a concise chat question when no form surface exists.

Persist each answer with `provider:select`. Do not put secrets in the selection. Once all three choices are confirmed, run:

```bash
npm run project:advance -- <slug> capabilities-ready --note="<human decision>"
```

Do not generate a sample merely to test availability. On resume, reuse confirmed selections only while their recorded host tools are still callable.

### 1. Prepare the Brief

Fill `projects/<slug>/brief.md` from the conversation. Record duration and scene count separately as user-specified or unspecified. Draft the minimum narrative beats and estimate spoken duration, then run `project:plan` to preserve explicit values and infer only the missing values. Do not mechanically use 30 seconds or three scenes.

```bash
npm run project:plan -- <slug> \
  [--requested-duration=<seconds>] [--requested-scenes=<count>] \
  --duration=<resolved-seconds> --scenes=<resolved-count> \
  [--narration-seconds=<estimate>] --rationale="<calculation basis>"
```

Only after the plan is resolved, run:

```bash
npm run project:advance -- <slug> brief-ready
```

Run `provider:status -- <slug>` before drafting. Use only the confirmed text provider. Record externally generated text through the provider request contract.

### 2. Propose the Concept and Stop

Prepare the narration draft, scene outline, layer hierarchy, asset list, factual assumptions, and style direction. Present the resolved duration and scene count compactly, labeling each as human-specified or Skill-inferred.

Do not generate images, bulk speech, music, or final assets yet. Stop and wait for an explicit concept decision.

- After approval, record it with `approve-concept` and a concise note.
- After requested changes, record `request-concept-revision`, revise, and ask again.

```bash
npm run project:advance -- <slug> approve-concept --note="<human decision>"
```

### 3. Confirm Style and Fictional Voice and Stop

After concept approval, create only one representative style sample. Resolve the configured image and voice providers first. If a short voice audition is available, use the configured fictional voice and only enough text to judge it. Show the provider/model, sample, voice identity, and any material usage cost before bulk production. When the project introduces a material new motion language, include a 3–5 second motion proof in this same gate; do not add another approval gate.

Never substitute a real-person clone. Treat voice cloning as a separate, opt-in enhancement requiring explicit authorization and licensed reference material.

- After approval, record `approve-style-voice`.
- After requested changes, record `request-style-voice-revision` and remain at this gate.

```bash
npm run project:advance -- <slug> approve-style-voice --note="<human decision>"
```

### 4. Produce Assets and Configure the Timeline

After style and voice approval:

Record each material step with `project:checkpoint`. Keep the root workflow active while built-in image generation runs in bounded asset workers as described in `execution-control.md`; an image result is not a human gate.

1. Create a provider request for every generated/imported text, image, or narration output and keep its stable `assetId`. Declare the image quality kind/checks when they differ from the inferred profile.
2. Try `provider:reuse` before a paid or slow generation. A cache miss is expected and is not a blocker.
3. Generate each base background without main characters. Generate or extract independent rear/mid/foreground environment layers when parallax materially supports the scene.
4. Prefer provider-supported isolated transparency when it is reliable. Otherwise generate complete characters on a clean high-chroma key color that does not appear in the costume; green is not mandatory. Keep period/style constraints stable and forbid text or watermarks.
5. Split and key character sheets with `assets:process-sheet --key-color=auto --matte-erode=1` when appropriate. Review any `layer-key-edge` warning.
6. Run `provider:record` after host/manual output, or use `provider:run` for command adapters, so `assets-manifest.json` records the provider, request fingerprint, model/job id, hash, and request.
7. Run `project:quality prepare`, visually inspect every pending image, and record the required semantic checks. A generated result is incomplete until its hash-bound quality entry passes.
8. Generate or import per-scene narration with the approved fictional voice. Run `project:sync`, then `project:subtitles`; provider/forced-alignment timings win over the deterministic fallback.
9. Populate the v2 `project.json` with environment depth, scene camera, character motion, transition, action audio, z-order, and subtitles. Author all timeline offsets and durations in seconds; renderer frames are derived values only.
10. Run `project:validate`; fix errors and deliberately review warnings before continuing.
11. Run `project:assets-ready`. This action repeats deterministic validation and enforces required asset quality before advancing.

```bash
npm run project:checkpoint -- <slug> <work-item> in-progress --label="<label>"
npm run project:checkpoint -- <slug> <work-item> completed --artifact="<path>"
npm run project:quality -- <slug> prepare
npm run project:sync -- <slug>
npm run project:subtitles -- <slug>
npm run project:validate -- <slug>
npm run project:assets-ready -- <slug>
```

If a configured text, image, or voice provider is unavailable, stop with the exact missing capability and preserve the current stage. Do not invent successful artifacts or silently choose another paid service.

### 5. Render the Preview and Stop

Run:

```bash
npm run project:preview -- <slug>
```

The command synchronizes audio, validates assets, renders the half-scale preview, generates the report and contact sheet, and advances the state to `human-review` only after success.

Show the human clickable paths for `preview.mp4`, `contact-sheet.jpg`, and `report.json`. Summarize technical results separately from creative judgment. Stop for review.

- If changes are requested, append the natural-language feedback to `review.md`, record `request-preview-revision`, make the change, and return through asset validation and preview.
- If approved, record `approve-preview` with the human's words.

```bash
npm run project:advance -- <slug> approve-preview --note="<human decision>"
```

### 6. Render the Final and Stop at Publication

Only after preview approval, run:

```bash
npm run project:render -- <slug>
```

Report the final MP4, contact sheet, validation report, and technical acceptance result. The successful command advances to `publish-approval`.

Never upload, publish, share, or record `approve-publish` based on technical checks alone. Wait for the human to explicitly confirm content, facts, rights, and platform suitability. Even after recording that decision, do not perform an external publish unless separately asked and authorized.

## Maintain the Resume Record

Run `project:status -- <slug> --compact-json` after every interruption, tool failure, or new turn. Use `--control-json` only when the full state/history is specifically needed. Immediately before ending a turn, run `project:handoff-check -- <slug>`; if it blocks the handoff, continue to the next command or recoverable work item. Only a genuine blocker with explicit `--blocker` and `--needs-user` may override an `auto-continue` handoff. Do not ask the human to continue. Use only the documented actions; do not hand-edit approval statuses or history. Keep approval notes short and attributable to the current conversation.

Use `review.md` for human feedback, not as a second hand-maintained status source. State transitions synchronize its generated approval section automatically. Keep live approval status out of `brief.md`.

When implementation files change, run at least `npm run check` and the relevant project validation. Commit locally only when the human has asked for implementation and the worktree scope is understood.
