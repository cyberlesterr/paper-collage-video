# Project Contract

Read this only when creating/changing project files or diagnosing validation/state.

## Sources of Truth

| File | Purpose |
|---|---|
| `brief.md` | Human intent, audience, facts, format, style, rights, prohibitions |
| `production.json` | State, approvals, coarse work batches, artifacts, event history |
| `project.json` | Resolved plan and v2 Remotion timeline |
| `prompts.json` | Small index of image requests and outputs |
| `providers.json` | Optional project provider overrides/selections |
| `requests/*.json` | Per-output generation/import request |
| `assets-manifest.json` | Provider/model/job provenance, fingerprints, hashes, snapshots |
| `quality-report.json` | Hash-bound technical and semantic image checks |
| `review.md` | Generated approval summary plus natural-language revision history |

Never ask the human to edit machine JSON. Do not copy live approvals into `brief.md`, full requests into checkpoints, or manifest history into `review.md`.

Paths in `project.json` are relative to `public/`; production artifacts are relative to the workspace root.

## Normal State Path

| Stage | Successful action | Next |
|---|---|---|
| `capability-review` | `project:confirm-concept` | `style-review` via provider/brief/concept records |
| `style-review` | `approve-style-voice` | `asset-production` |
| `asset-production` | `project:assets-ready` | `preview` |
| `preview` | successful `project:preview` | `human-review` |
| `human-review` | `approve-preview` | `final-render` |
| `final-render` | successful `project:render` | `complete` |

Separate `capabilities-ready`, `brief-ready`, and `approve-concept` actions remain supported for recovery/compatibility. `publish-approval` and `approve-publish` remain readable legacy/optional records but are not required for local completion. Revision requests return to concept, style, or asset production as appropriate.

## v2 Configuration Rules

- Preserve explicit duration/scenes; resolve a profile and asset budget before concept approval.
- Keep backgrounds character-free and main figures in independent alpha PNGs.
- Every scene declares `environmentLayers`, `camera`, `transition`, `audioEvents`; arrays may be empty when the beat does not need them.
- Every character layer declares narrative `motion` and role.
- Author all offsets/durations in seconds; renderer frames are derived.
- Let `project:assets-ready` own narration sync, subtitle derivation, validation, quality enforcement, and state advance.
- Fix validation errors before rendering. Review warnings and record accepted creative risks in `review.md`.
- Use repository scripts rather than reproducing ffprobe, FFmpeg, Remotion, chroma-key, or reporting logic ad hoc.
