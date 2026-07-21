# Project Contract

Read this only when creating/changing project files or diagnosing validation/state.

## Sources of Truth

| File | Purpose |
|---|---|
| `brief.md` | Human intent, audience, facts, format, style, rights, prohibitions |
| `production.json` | State, approvals, coarse work batches, artifacts, event history |
| `storyboard.json` | Approved arc, beats, composition patterns, relationships, and proof assertions |
| `project.json` | Resolved plan and v4 Remotion execution tree |
| `requests/*.json` | Per-output generation/import request plus composition binding |
| `semantic-contracts.json` | Reusable identity, topology, mechanism, diagram, and evidence-target invariants |
| `generation-attempts.jsonl` | Append-only quota reservation and real provider-attempt outcomes |
| `assets-manifest.json` | Provider provenance, source families, fingerprints, and hashes |
| `quality-report.json` | Hash-bound asset and composite quality |
| `review.md` | Generated approval summary plus natural-language revision history |

Never ask the human to edit machine JSON. Paths in `project.json` are relative to `public/`; production artifacts are relative to the workspace root.

## Normal State Path

| Stage | Successful action | Next |
|---|---|---|
| `capability-review` | `project:confirm-concept` | `style-review` via provider/brief/concept records |
| `style-review` | `approve-style-voice` | `asset-production` |
| `asset-production` | `project:assets-ready` | `preview` |
| `preview` | successful `project:preview` | `human-review` |
| `human-review` | `approve-preview` | `final-render` |
| `final-render` | successful `project:render` | `complete` |

The combined confirmation is the normal path. Composition proof is machine evidence inside the existing style or asset stage, not a fourth human gate.

When the approved storyboard uses `supported-subject` or `registered-environment`, `approve-style-voice` additionally requires a current schema-v3 `style-motion-proof.json`. The report fingerprint binds the representative group, member hashes, timing/proof inputs, and source family. Its full-resolution frames and per-member alpha/checkerboard/tight/motion-stress evidence must exist, and the participating asset/composite semantic checks must already be recorded. This is an executable precondition inside `style-review`, not another approval state.

## v4 Composition Tree

Schema v4 is the only supported project contract. A scene has `composition.nodes`; it must not contain legacy `background`, `layers`, or `environmentLayers` arrays. Nodes are recursive `asset` or `group` records. All transforms and keyframe deltas are normalized to the immediate parent.

Use only these patterns:

| Pattern | Intended relationship | Required structure |
|---|---|---|
| `free` | independent label, bird, leaf, stamp, or cutout | no persistent support/shared boundary |
| `supported-subject` | person in boat, object on table, hand holding prop | rear support, subject, front support, shared registration, contact and occlusion zones |
| `registered-environment` | land/water, sky/ground, wall/floor, tabletop edge | shared master canvas, registration, fixed boundary, upper/lower clipped members |

Groups own carrier motion; children own only local motion. Do not repeat the group's world path on attached children. Local z-order is deterministic: support rear, optional contact shadow, subject, support front. Registered environment members use the complete master canvas with top-left origin; textures may move within a fixed clip, but the boundary must not move across semantic content.

Coupled members share `registration.id`, `sourceMasterAssetId`, canvas dimensions, origin, and source-family provenance. Generate/import one complete master and derive members from it. Independent generation calls for the two sides of one contact or boundary are invalid.

Derivation method is part of correctness. Complex silhouettes and negative spaces require capable segmentation/matting or careful manual tracing; a coarse enclosing polygon is invalid even when it has clean hard alpha. When extraction quality cannot be proved, keep the complete master rigid and use whole-family/camera motion instead of fabricating independent parts.

## Proof and Cue Contract

- Scene id, blueprint, `compositionPlan`, proof ids/times/assertions, and beat ids must match the approved storyboard.
- Each scene has establish, action/peak, and final proof moments; final remains at or after `0.82` and proofs stay outside fades.
- Every node keyframe path starts at `0`, ends at `1`, and authors at least one value.
- `scene.cues` is the only visual/sound event source. Every storyboard beat has exactly one cue; cue drift is at most `0.035` normalized units.
- Cue targets are `scene` or an existing composition node. Supported actions come from `schemas/composition.schema.json`, including `drop-impact` and `carve`.
- Bind a critical cue to `proofTimeId`; the proof must fall inside its action window. If the approved beat names audio, the same cue owns the sound.

## Validation and Failure Routing

Run `project:composition-proof` after assembling real groups. It replaces the previous proof directory, then renders authored proof frames, focused relationship crops, semantic-contract targets, cross-scene comparisons, debug copies, and the cue table through the production renderer. `project:assets-ready` rejects missing/stale proof fingerprints, open generation reservations, over-budget attempts, and pending/failed asset or composite quality.

Fix a wrong mask, crop, anchor, registration, or derivative without another human decision when the approved meaning and budget remain unchanged. Regenerate `style:proof` or `project:composition-proof` after the fix; member hashes invalidate prior evidence automatically. Return to concept only when the relationship meaning changes. Return to provider/budget approval only for a provider switch or budget increase. Never hide a contract failure with arbitrary z-index, pixel nudges, or a coarse polygon matte.

Use repository scripts rather than reproducing ffprobe, FFmpeg, Remotion, extraction, proof, attempt accounting, or report logic ad hoc. Composition project v3 is not migrated or executed; schema-v2 asset requests remain legacy-readable only in projects without a generation-attempt ledger.
