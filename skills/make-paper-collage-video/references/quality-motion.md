# Asset, Composite, Motion, and Delivery Quality

Read this before style sampling, bulk images, v4 composition authoring, proof review, or delivery tuning.

## Two Quality Scopes

`quality-report.json` v2 contains `assets` and `composites`. A passing file does not prove that a person is inside a boat or trees remain above water. Both scopes must pass.

Run `project:quality <slug> prepare` after files exist. Inspect original-resolution assets in small same-type batches and record their required semantic checks. SHA-256 changes invalidate only affected file reviews.

After narration files and real v4 groups exist, run (the proof command synchronizes measured narration duration first):

```bash
npm run project:composition-proof -- <slug>
npm run project:quality -- <slug> prepare
```

Inspect full proof frames, relationship crops, and debug frames. Record composite reviews in the same atomic batch file, using `compositeId` instead of `assetId`:

```json
{
  "reviews": [
    {
      "compositeId": "group:scene-01:boat-rig",
      "reviewer": "host-vision",
      "passedChecks": ["support-contact", "inside-or-on-readable", "front-occlusion", "shared-motion", "identity-continuity"],
      "failedChecks": [],
      "note": "Establish, action, and final crops inspected at useful resolution"
    }
  ]
}
```

```bash
npm run project:quality -- <slug> record-batch --input=<reviews.json> --quiet
```

Never pass a semantic check merely to unblock production. Changing a member, mask, group transform, boundary, anchor, keyframe, cue, or proof time changes the composite fingerprint and invalidates that review.

## Pattern-Specific Review

- `supported-subject`: support contact, readable inside/on relation, visible front occlusion, shared carrier motion, identity continuity.
- `registered-environment`: registration alignment, boundary respected, no duplicated semantic band, readable depth, readable final composition.
- bound cue: visual event visible, sound event bound when required, proof time bound, final state preserved.

Deterministic checks already block missing slots, mismatched canvases, duplicate carrier motion, off-zone contacts, absent front alpha, incomplete upper/lower clips, duplicate semantic coverage, invalid targets, missing required sounds, and out-of-window proofs. They do not decide whether the frame is elegant; that remains semantic review.

## Motion and Cue Authoring

The scene camera, group transform, child local transform, keyframes, idle motion, and cue transform compose in that order. A group carries its attached family once. Child keyframes are local deltas and cover normalized `0..1`; narration resync therefore preserves the spatial relationship.

Map every approved beat to one cue. Target the group when the entire registered assembly reacts, or a child for a genuinely local action. `scene.cues` schedules both visuals and sound; do not create a second audio event list. Bind critical events to authored proof ids.

The normal contact sheet and final report reuse the authored proof moments and cue event table. Inspect establish, action/peak, and final states for relationship readability, subtitle safety, and preserved consequences.

## Subtitles and Audio

`project:assets-ready` owns narration synchronization, subtitle derivation, v4 validation, current-proof enforcement, and both quality gates. Provider or forced-alignment timing wins; otherwise deterministic punctuation-aware timing is used. Review reading-speed warnings.

Tune `audio.narration.volume` from preview loudness rather than rewriting source audio. Reports enforce configured LUFS tolerance and true-peak headroom.
