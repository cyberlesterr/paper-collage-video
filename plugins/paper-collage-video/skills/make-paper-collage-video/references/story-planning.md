# Duration and Scene Planning

Read this reference while preparing the brief. Treat duration and scene count as two independent optional user constraints. Do not ask merely because either value is missing.

## Resolve the Four Input Modes

| User supplied | Preserve | Infer |
|---|---|---|
| Neither | — | Duration and scene count |
| Duration only | Requested duration | Scene count |
| Scene count only | Requested scene count | Duration |
| Both | Requested duration and scene count | Only pacing and content allocation |

Never replace an explicit value with the old 30-second or three-scene defaults. If the two explicit constraints are materially incompatible with readable storytelling, explain the conflict and ask for one decision instead of silently overriding either value.

## Infer an Unspecified Value

1. Identify the minimum coherent visual beats: setup, problem, important reasoning/action changes, resolution, and takeaway when relevant. Do not create a scene merely to hit a round number.
2. Draft or outline the narration before resolving the plan. Estimate spoken duration from the selected voice when possible. Before an audition exists, use a language-appropriate conversational estimate; for Chinese narration, roughly 3.5–4.5 Han characters per second is a planning aid, not a hard rule.
3. Keep one dominant visual idea per scene. Merge adjacent beats when a fixed short duration requires it; split a beat only when the place, time, subject, or key action visibly changes.
4. Reserve time for scene openings, readable subtitles, pauses, tail frames, and transition overlap. The estimated narration must fit inside the target duration.
5. When only duration is specified, select as many scenes as the meaningful beats and readable pace can support. When only scene count is specified, size the duration to the narration and visual breathing room. When neither is specified, choose both from the story rather than defaulting mechanically to 30 seconds and three scenes.

There is no fixed maximum scene count or duration in the generic project protocol. For unusually long or dense requests, surface the resulting asset/cost implications at concept review.

## Persist the Resolution

Record user-supplied values only in `--requested-*`. Always provide both resolved values:

```bash
npm run project:plan -- <slug> \
  [--requested-duration=<seconds>] \
  [--requested-scenes=<count>] \
  --duration=<resolved-seconds> \
  --scenes=<resolved-count> \
  [--narration-seconds=<estimated-spoken-seconds>] \
  --rationale="<story beats, narration estimate, and pacing basis>"
```

The command records `none`, `duration-only`, `scenes-only`, or `both` in `project.json`. It rejects a resolved value that changes an explicit user constraint and rejects a narration estimate longer than the target film.

Run `project:plan` before `brief-ready`. At concept review, show both resolved values and label each as `用户指定` or `Skill 推导`. The concept approval is the human's opportunity to revise the inferred plan before image or bulk narration generation.

After real narration exists, `project:sync` still owns exact timeline duration. Validation requires the actual scene count to match the approved plan. When runtime differs from the target by more than 10% or two seconds, whichever is greater, an explicit human duration fails validation while a Skill-inferred duration produces a warning for review.
