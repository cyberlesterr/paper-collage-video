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

`project:plan` derives a provider-generation attempt ceiling from the profile and scene count. Count the style sample, unique generated backgrounds, environment layers, character sheets, rejected results, and abandoned results when quota was consumed. Exact reuse and deterministic alpha extractions do not consume a new attempt.

```bash
npm run project:plan -- <slug> \
  [--requested-duration=<seconds>] [--requested-scenes=<count>] \
  --duration=<resolved-seconds> --scenes=<resolved-count> \
  [--narration-seconds=<estimate>] --profile=<draft|balanced|full-depth> \
  --rationale="<story and pacing basis>"
```

Show requested versus inferred values, profile, and image budget in the combined concept/provider decision. Change the profile only through concept revision or another explicit budget decision.

## Lock the Rhythmic Storyboard

After `project:plan`, create a storyboard input and run:

```bash
npm run project:storyboard -- <slug> --input=<storyboard.json>
```

The storyboard is not another human gate. It is part of the existing combined concept decision and becomes the execution contract for production.

- Give the whole film one explicit arc and one shared visual/motion language.
- Give each planned scene a narrative role, single message, blueprint, estimated duration, and at least three ordered beats.
- Add `compositionPlan.patterns` plus named relationships. Use `supported-subject` for persistent contact (`inside`, `on`, `held-by`, `worn-by`), `registered-environment` for a shared shoreline/horizon/tabletop/wall edge, and `free` only when no persistent contact or semantic boundary exists.
- Use normalized beat time (`at=0..1`) so rhythm survives narration resync.
- Choose one of the bounded blueprints: `layered-reveal`, `map-journey`, `archive-stack`, `character-procession`, `discovery-wipe`, `transformation-tableau`, `chapter-tableau`, or `quiet-lockup`.
- Define at least three proof moments per scene: an establishing state, an action/peak state, and a `final` state at or after `0.82`. Every proof needs a stable id and visible relationship assertions; describe what the pixels must prove, not merely what occurs.
- Keep proof moments outside the scene's fade-in/fade-out interval so every sampled frame clearly proves the intended composition.
- If a beat names an `audioCue`, production must attach a real sound asset to its matching cue.

The sum of scene estimates must stay within 8% of the resolved duration. Scene count must match exactly.

After real narration exists, `project:assets-ready` synchronizes exact media duration. Explicit user duration drift blocks validation; inferred duration drift remains a warning for review.
