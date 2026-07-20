# Project Contract

Read this only when creating/changing project files or diagnosing validation/state.

## Sources of Truth

| File | Purpose |
|---|---|
| `brief.md` | Human intent, audience, facts, format, style, rights, prohibitions |
| `production.json` | State, approvals, coarse work batches, artifacts, event history |
| `storyboard.json` | Approved story arc, scene blueprints, beats, and proof moments |
| `project.json` | Resolved plan and v3 Remotion execution timeline |
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

The combined confirmation is the normal path. Revision requests return to concept, style, or asset production as appropriate.

## v3 Configuration Rules

- Preserve explicit duration/scenes; resolve a profile and asset budget before concept approval.
- Keep backgrounds character-free and main figures in independent alpha PNGs.
- Every scene id and `motion.blueprint` must match `storyboard.json`.
- Every scene copies its approved `motion.proofTimes` exactly; reports sample these authored moments instead of arbitrary front/middle/back frames.
- Proof moments must remain outside transition fade intervals; a technically sampled but visually obscured frame is a validation error.
- Every scene declares `environmentLayers`, `motion`, `camera`, `transition`, and non-empty `cues`.
- Every storyboard beat has exactly one cue linked by `beatId`; cue time may drift from the planned beat by at most 0.035 normalized units.
- Every character and environment layer declares a keyframe path that starts at `at=0`, ends at `at=1`, and contains an authored transform/opacity value.
- Cue targets must be `scene` or an existing layer id. `reveal`, `pulse`, `stamp`, `shake`, `lift`, and `settle` are the supported actions.
- Author all offsets/durations in seconds; renderer frames are derived.
- Let `project:assets-ready` own narration sync, subtitle derivation, validation, quality enforcement, and state advance.
- Fix validation errors before rendering. Review warnings and record accepted creative risks in `review.md`.
- Use repository scripts rather than reproducing ffprobe, FFmpeg, Remotion, chroma-key, or reporting logic ad hoc.

Schema v3 is the only supported contract. Do not migrate, infer, or preserve v2 `audioEvents`, role-SFX, or motion-only scene data.
