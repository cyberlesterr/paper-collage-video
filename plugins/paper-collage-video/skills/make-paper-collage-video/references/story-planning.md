# Story and Production Planning

Read this while resolving duration, scene count, or production profile. Duration and scene count are independent optional user constraints.

## Resolve Story Shape

| User supplied | Preserve | Infer |
|---|---|---|
| Neither | — | Duration and scene count |
| Duration only | Requested duration | Scene count |
| Scene count only | Requested scenes | Duration |
| Both | Both values | Pacing and allocation only |

Draft minimum coherent beats and estimate spoken duration before resolving the plan. For Chinese narration, roughly 3.5–4.5 Han characters/second is a planning aid. Reserve time for openings, subtitles, pauses, tails, and transition overlap. Ask only when two explicit constraints are materially incompatible.

## Choose a Production Profile

- `draft`: cheapest iteration; one background per scene, heavily reused character sheets, and depth only where essential.
- `balanced` (default): backgrounds per scene, shared character sheets, and independent depth assets for a few hero locations.
- `full-depth`: maximum parallax and pose variety; use only when the human accepts the larger asset/cost budget.

`project:plan` derives a generated-image ceiling from the profile and scene count. Count the style sample, unique generated backgrounds, environment layers, and character sheets. Reused files and deterministic alpha extractions do not consume new generation budget.

```bash
npm run project:plan -- <slug> \
  [--requested-duration=<seconds>] [--requested-scenes=<count>] \
  --duration=<resolved-seconds> --scenes=<resolved-count> \
  [--narration-seconds=<estimate>] --profile=<draft|balanced|full-depth> \
  --rationale="<story and pacing basis>"
```

Show requested versus inferred values, profile, and image budget in the combined concept/provider decision. Change the profile only through concept revision or another explicit budget decision.

After real narration exists, `project:assets-ready` synchronizes exact media duration. Explicit user duration drift blocks validation; inferred duration drift remains a warning for review.
