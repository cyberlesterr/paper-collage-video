---
name: make-paper-collage-video
description: Initialize, create, and resume configuration-driven layered paper-collage video workspaces, from a topic or brief through script, storyboard, image layers, fictional narration, preview review, final render, and technical acceptance. Use when Codex is asked to install, make, reproduce, continue, revise, or productize a paper-cutout, historical collage, layered illustration, or parallax explainer video with human approval gates.
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

5. Read [references/project-contract.md](references/project-contract.md) before creating or changing project files. Read [references/approval-gates.md](references/approval-gates.md) before generating creative assets, speech, or an external delivery.
6. Read [references/execution-control.md](references/execution-control.md) before doing work. Obey its `auto-continue`/`wait-human` contract and tool-only image-generation isolation rules.

## Apply Defaults Deliberately

When the human supplies only a topic, use these reversible defaults and state them in the concept proposal:

- Produce about 30 seconds at 1920×1080 and 30 fps.
- Target a general Chinese-language audience.
- Use two or three scenes with one dominant subject in each scene.
- Use layered paper collage with background, rear, subject, and foreground depth.
- Use a fictional narrator; prefer `儒雅逸辰 (ruyayichen)` when available.
- Do not clone a real person, publish, upload, or send externally.

Ask only for missing information that materially changes the subject, factual position, rights boundary, or output format. Record the answer in `brief.md`; do not make the human edit machine coordinates or JSON.

## Follow the Production Stages

### 1. Prepare the Brief

Fill `projects/<slug>/brief.md` from the conversation. Keep unknown but non-blocking fields explicit and use the defaults above. Then run:

```bash
npm run project:advance -- <slug> brief-ready
```

### 2. Propose the Concept and Stop

Prepare the narration draft, scene outline, layer hierarchy, asset list, factual assumptions, and style direction. Present them compactly to the human.

Do not generate images, bulk speech, music, or final assets yet. Stop and wait for an explicit concept decision.

- After approval, record it with `approve-concept` and a concise note.
- After requested changes, record `request-concept-revision`, revise, and ask again.

```bash
npm run project:advance -- <slug> approve-concept --note="<human decision>"
```

### 3. Confirm Style and Fictional Voice and Stop

After concept approval, create only one representative style sample. If a short voice audition is available, use the configured fictional voice and only enough text to judge it. Show the sample, voice identity, and any material usage cost before bulk production.

Never substitute a real-person clone. Treat voice cloning as a separate, opt-in enhancement requiring explicit authorization and licensed reference material.

- After approval, record `approve-style-voice`.
- After requested changes, record `request-style-voice-revision` and remain at this gate.

```bash
npm run project:advance -- <slug> approve-style-voice --note="<human decision>"
```

### 4. Produce Assets and Configure the Timeline

After style and voice approval:

Record each material step with `project:checkpoint`. Keep the root workflow active while built-in image generation runs in bounded asset workers as described in `execution-control.md`; an image result is not a human gate.

1. Generate each background plate without main characters.
2. Generate complete characters on a clean green background, with stable period/style constraints and no text or watermark.
3. Split and key character sheets with `assets:process-sheet` when appropriate.
4. Generate or import per-scene narration with the approved fictional voice.
5. Populate `project.json` with scene layers, roles, positions, delays, z-order, subtitles, and audio.
6. Run `project:sync`, then `project:validate`; fix errors before continuing.
7. Run `assets-ready`. This action repeats the deterministic validation and refuses to advance on errors.

```bash
npm run project:checkpoint -- <slug> <work-item> in-progress --label="<label>"
npm run project:checkpoint -- <slug> <work-item> completed --artifact="<path>"
npm run project:sync -- <slug>
npm run project:validate -- <slug>
npm run project:advance -- <slug> assets-ready
```

If an image or speech provider is unavailable, stop with the exact missing capability and preserve the current stage. Do not invent successful artifacts.

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

Run `project:status -- <slug> --control-json` after every interruption, tool failure, or new turn. Immediately before ending a turn, run `project:handoff-check -- <slug>`; if it blocks the handoff, continue to the next command or recoverable work item. Only a genuine blocker with explicit `--blocker` and `--needs-user` may override an `auto-continue` handoff. Do not ask the human to continue. Use only the documented actions; do not hand-edit approval statuses or history. Keep approval notes short and attributable to the current conversation.

Use `review.md` for human feedback, not as a second hand-maintained status source. State transitions synchronize its generated approval section automatically. Keep live approval status out of `brief.md`.

When implementation files change, run at least `npm run check` and the relevant project validation. Commit locally only when the human has asked for implementation and the worktree scope is understood.
