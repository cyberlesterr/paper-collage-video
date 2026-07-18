# Asset Quality, Motion, and Delivery

Read this reference before bulk image production, timeline authoring, or technical acceptance. New projects default to a required asset-quality gate. Legacy projects without a `quality` block remain advisory until intentionally migrated.

## Quality Is a Recorded Production Step

Run `project:quality <slug> prepare` after generated and processed image files exist. The report combines deterministic checks with a semantic visual rubric and stores the file hash for every asset. Changing a file invalidates its previous review.

The root workflow must visually inspect every pending asset before recording semantic checks. A prompt constraint is not proof that the generated image obeyed it. Check the original asset at useful resolution, not only a small contact sheet.

Typical profiles are:

- background: no text, watermark, or people; subtitle-safe area is usable; style matches the approved sample;
- environment layer: complete cutout, no text or watermark, correct style and intended depth role;
- character sheet: complete figures, stable identity, separated cells, uniform key background, no text or watermark;
- alpha character: complete subject, clean edge, stable identity, correct style;
- style sample: coherent subject, no text or watermark, and a reproducible visual language.

Record a reviewed asset with:

```bash
npm run project:quality -- <slug> record \
  --asset=<asset-id> --reviewer=<host-tool-or-human> \
  --pass=<comma-separated-required-checks> \
  --note="<brief visual evidence>"
```

Use `--fail=<checks>` when a violation is visible, revise or regenerate only that asset, then prepare and review again. Never mark a check passed merely to unblock `assets-ready`. `project:assets-ready` and rendering enforce the quality report only when `project.json.quality.mode` is `required`.

## Reuse Before Regeneration

Provider records include a request fingerprint derived from the provider, model, prompt or text, settings, references, and quality intent while excluding project-specific ids and output paths. Before generating, try:

```bash
npm run provider:reuse -- --request=projects/<slug>/requests/<request>.json
```

Reuse succeeds only when the fingerprint matches exactly and the cached file still matches its recorded hash. Reused images still enter the current project's quality report.

## Build Actual Depth

Keep the base background character-free. When the scene benefits from parallax, generate or extract independent rear, mid, and foreground cutouts and put them in `scene.environmentLayers`. Use `depth` from `-1` (rear) through `1` (near foreground), plus an explicit `z`.

Do not call a flattened illustration “layered” merely because a generic foreground strip is rendered over it. Important subjects, props that move, and foreground occluders should be independent assets.

## Author Narrative Motion

Use scene-specific motion only when it supports the beat:

- `camera.preset`: `push`, `pull`, `pan-left`, `pan-right`, or `static`;
- `camera.keyframes`: normalized `at` values from `0` to `1` with optional `x`, `y`, and `zoom`;
- `layer.motion.idle`: `float`, `breathe`, `grind`, `drift`, or `still`;
- `layer.motion`: tune `intensity`, `cycleSeconds`, `phase`, and `enterDurationSeconds`;
- `scene.transition`: `fade` or `none`, with an optional duration;
- `scene.audioEvents`: action-timed SFX using `atSeconds` or `fromFrame`.

Prefer seconds for new delay and audio-event authoring so behavior remains stable across fps values. Keep legacy frame fields for compatibility. At the style-and-voice gate, include a short motion proof when the project introduces a new or material motion language; this is part of the existing gate, not an additional approval.

## Delivery Profiles

The renderer adapts titles, subtitles, paper foreground, motion distances, and timing to the configured size and fps. Still generate backgrounds for the actual delivery aspect ratio and resolution. Import a licensed local font through `theme.fontFile` when typography must be reproducible across machines.

After narration is synchronized, run:

```bash
npm run project:subtitles -- <slug>
```

When `narration.timingSrc` points at provider or forced-alignment timing JSON, those timings win. Otherwise the command creates a punctuation- and length-aware fallback. Review reading-rate and line-length warnings.

Set `audio.mastering` when delivery loudness matters. Reports measure integrated LUFS and true peak and enforce the configured target/tolerance for new projects.
