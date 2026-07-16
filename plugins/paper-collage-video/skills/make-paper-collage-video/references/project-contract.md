# Project Contract

Read this reference when creating, resuming, validating, or rendering a paper-collage project.

## Sources of Truth

| File | Owner | Purpose |
|---|---|---|
| `projects/<slug>/brief.md` | Human intent, Codex transcription | Audience, message, format, style, facts, and prohibitions; never live approval status |
| `projects/<slug>/production.json` | State CLI | Current stage, approvals, recoverable work items, artifacts, and audit history |
| `projects/<slug>/project.json` | Codex and deterministic scripts | Remotion timeline, layers, subtitles, audio, and theme |
| `projects/<slug>/prompts.json` | Codex | Reproducible image-generation prompts and outputs |
| `projects/<slug>/review.md` | State CLI and Codex transcription | Auto-synced approval summary plus human feedback and revision history |

Never ask the human to maintain `project.json` or `production.json` directly.

## Path Layout

```text
projects/<slug>/
  brief.md
  production.json
  project.json
  prompts.json
  review.md

public/projects/<slug>/
  assets/plates/
  assets/characters/source/
  assets/characters/alpha/
  audio/narration/
  audio/music/
  audio/sfx/

dist/<slug>/
  preview.mp4
  final.mp4
  validation-report.json
  report.json
  contact-sheet.jpg
```

Store paths in `project.json` relative to `public/`, for example `projects/<slug>/assets/plates/01-bg.png`. Store production artifacts relative to the repository root.

## State Actions

| Current stage | Action | Next stage | Gate |
|---|---|---|---|
| `brief` | `brief-ready` | `concept-review` | Brief captures the request |
| `concept-review` | `approve-concept` | `style-review` | Explicit human concept approval |
| `concept-review` or `style-review` | `request-concept-revision` | `concept-review` | Human requests concept changes |
| `style-review` | `approve-style-voice` | `asset-production` | Explicit human sample and fictional voice approval |
| `style-review` | `request-style-voice-revision` | `style-review` | Human requests sample changes |
| `asset-production` | `assets-ready` | `preview` | Deterministic project validation passes |
| `preview` | successful `project:preview` | `human-review` | Preview and technical report pass |
| `human-review` | `approve-preview` | `final-render` | Human approves the preview |
| `human-review`, `final-render`, or `publish-approval` | `request-preview-revision` | `asset-production` | Human requests another creative pass |
| `final-render` | successful `project:render` | `publish-approval` | Final artifact and report pass |
| `publish-approval` | `approve-publish` | `complete` | Explicit human rights/content/platform approval |

Use:

```bash
npm run project:status -- <slug>
npm run project:status -- <slug> --control-json
npm run project:handoff-check -- <slug>
npm run project:checkpoint -- <slug> <id> <status>
npm run project:advance -- <slug> <action> --note="<decision>"
```

Render commands enforce prior approvals. Successful renders record their artifacts automatically. Re-rendering an already approved golden sample updates its artifact paths without rolling its workflow backward.

## Configuration Rules

- Follow `schemas/project.schema.json` for the animation contract.
- Follow `schemas/production.schema.json` for the state record.
- Give each scene one `primary` subject; use `secondary` and `tertiary` roles for decreasing motion strength.
- Keep backgrounds character-free and main figures in independent alpha PNG files.
- Use z-order and foreground occlusion for depth; do not fake all motion with a single flattened image.
- Let `project:sync` derive narration duration from media. Never guess final timeline duration after audio exists.
- Fix validation errors before rendering. Review warnings deliberately and record accepted visual risks in `review.md`.

## Deterministic Commands

```bash
npm run project:new -- <slug> --title="<title>"
npm run project:sync -- <slug>
npm run project:validate -- <slug>
npm run project:preview -- <slug>
npm run project:render -- <slug>
npm run project:report -- <slug>
npm run check
```

Use the repository scripts instead of reproducing their FFmpeg, ffprobe, Remotion, chroma-key, or report logic in ad hoc commands.
