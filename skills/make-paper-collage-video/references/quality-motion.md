# Asset Quality, Motion, and Delivery

Read this before style sampling, bulk images, timeline authoring, or delivery tuning.

## Review Images in Batches

Run `project:quality <slug> prepare` after image files exist. Technical checks and SHA-256 invalidation remain per file. Inspect originals in small same-type batches; a prompt is not evidence that the output complied.

Typical semantic checks:

- background: no text/watermark/people, usable subtitle-safe area, approved style;
- environment: complete cutout, correct depth role, no text/watermark, approved style;
- character sheet: complete/stable figures, separated cells, uniform key, no text/watermark;
- alpha character: complete subject, stable identity, clean edge, approved style;
- style sample: coherent subject and reproducible visual language.

Write one JSON per reviewed batch:

```json
{
  "reviews": [
    {
      "assetId": "scene-01-background",
      "reviewer": "host-vision",
      "passedChecks": ["no-text", "no-watermark", "no-people", "safe-area-clear", "style-consistent"],
      "failedChecks": [],
      "note": "Original inspected at useful resolution"
    }
  ]
}
```

```bash
npm run project:quality -- <slug> record-batch --input=<reviews.json> --quiet
```

Regenerate only failed assets, prepare again, and review their new hashes. Never disable the quality gate.

## Spend Depth Where It Matters

Honor the approved `draft`, `balanced`, or `full-depth` budget. Reuse environments for the same location and character sheets across scenes. Create independent rear/mid/foreground assets when parallax supports a visible story beat; an empty `environmentLayers` array is valid for simple scenes.

Use camera motion and per-layer keyframes intentionally. The baseline idle preset only supplies paper life; it cannot replace the authored scene path. Keyframes use normalized scene time and must cover `0..1`, so narration resync does not destroy the composition.

Map every approved storyboard beat to one audiovisual cue. Use `targetId` to direct the cue at the whole scene, a character, or an environment layer; use `reveal`, `pulse`, `stamp`, `shake`, `lift`, or `settle` to express the beat. A cue may carry a sound asset, but do not add sound merely to make the scene busy.

The contact sheet is a motion-proof sheet: it renders `scene.motion.proofTimes`. Inspect it for layer order, focal clarity, action peak, final composition, subtitle safety, and whether the frame actually communicates the storyboard message.

## Subtitles and Audio

`project:assets-ready` runs narration sync and subtitle derivation. Provider/forced-alignment timing wins; otherwise deterministic punctuation-aware timing is used. Review reading-speed warnings.

Tune `audio.narration.volume` from preview loudness rather than rewriting source audio. Reports enforce configured LUFS tolerance and true-peak headroom.
