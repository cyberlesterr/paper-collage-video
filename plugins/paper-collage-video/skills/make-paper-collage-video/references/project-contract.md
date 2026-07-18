# Project Contract

Read this reference when creating, resuming, validating, or rendering a paper-collage project.

## Sources of Truth

| File | Owner | Purpose |
|---|---|---|
| `projects/<slug>/brief.md` | Human intent, Codex transcription | Audience, message, format, style, facts, and prohibitions; never live approval status |
| `projects/<slug>/production.json` | State CLI | Current stage, approvals, recoverable work items, artifacts, and audit history |
| `projects/<slug>/project.json` | Codex and deterministic scripts | Resolved creative plan plus Remotion timeline, layers, subtitles, audio, and theme |
| `projects/<slug>/prompts.json` | Codex | Reproducible image-generation prompts and outputs |
| `projects/<slug>/providers.json` | Codex and human configuration | Optional project override for text, image, and voice providers |
| `projects/<slug>/assets-manifest.json` | Provider CLI | Provider/model/job provenance, hashes, output paths, and request snapshots |
| `projects/<slug>/quality-report.json` | Quality CLI, Codex visual review | Hash-bound technical and semantic image checks |
| `projects/<slug>/review.md` | State CLI and Codex transcription | Auto-synced approval summary plus human feedback and revision history |

Never ask the human to maintain `project.json` or `production.json` directly.

## Path Layout

```text
projects/<slug>/
  brief.md
  production.json
  project.json
  prompts.json
  providers.json
  assets-manifest.json
  quality-report.json
  requests/
  review.md

public/projects/<slug>/
  assets/style/
  assets/plates/
  assets/environment/rear/
  assets/environment/mid/
  assets/environment/foreground/
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
| `capability-review` | `capabilities-ready` | `brief` | Explicit human provider choices are recorded and ready |
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
npm run project:status -- <slug> --compact-json
npm run project:handoff-check -- <slug>
npm run project:checkpoint -- <slug> <id> <status>
npm run project:advance -- <slug> <action> --note="<decision>"
```

Render commands enforce prior approvals. Successful renders record their artifacts automatically. Re-rendering an already approved golden sample updates its artifact paths without rolling its workflow backward.

## Configuration Rules

- Follow `schemas/project.schema.json` for the animation contract.
- Resolve the optional duration and scene constraints with `project:plan` before `brief-ready`; never overwrite an explicit user value.
- Follow `schemas/production.schema.json` for the state record.
- Follow `schemas/providers.schema.json` and `references/providers.md` for portable service selection. Keep secrets out of JSON.
- Follow `schemas/asset-request.schema.json` for provider requests; let provider scripts own `assets-manifest.json`.
- Give each scene one `primary` subject; use `secondary` and `tertiary` roles for decreasing motion strength.
- Keep backgrounds character-free and main figures in independent alpha PNG files.
- Use z-order and foreground occlusion for depth; do not fake all motion with a single flattened image.
- Use only `project.schemaVersion: 2`. Do not migrate or infer removed v1 fields.
- Every scene explicitly declares `environmentLayers`, `camera`, `transition`, `audioEvents`, and every character layer declares `motion`.
- Author `tailSeconds`, `startSeconds`, `delaySeconds`, `durationSeconds`, `atSeconds`, `fromSeconds`, and `toSeconds`; frame counts exist only in normalized renderer state.
- Run `project:quality` after image generation. Required quality mode must pass before `assets-ready`; changing an asset invalidates its prior review.
- Let `project:sync` derive narration duration from media. Never guess final timeline duration after audio exists.
- Run `project:subtitles` after sync. Prefer provider/forced-alignment timings and review the deterministic fallback.
- Fix validation errors before rendering. Review warnings deliberately and record accepted visual risks in `review.md`.

## Deterministic Commands

```bash
npm run project:new -- <slug> --title="<title>"
npm run project:plan -- <slug> --duration=<seconds> --scenes=<count> --rationale="<basis>"
npm run provider:status -- <slug>
npm run provider:select -- <slug> <capability> <provider-id> --note="<decision>"
npm run provider:reuse -- --request=projects/<slug>/requests/<request>.json
npm run project:quality -- <slug> prepare
npm run project:sync -- <slug>
npm run project:subtitles -- <slug>
npm run project:validate -- <slug>
npm run project:assets-ready -- <slug>
npm run project:preview -- <slug>
npm run project:render -- <slug>
npm run project:report -- <slug>
npm run check
```

Use the repository scripts instead of reproducing their FFmpeg, ffprobe, Remotion, chroma-key, or report logic in ad hoc commands.
