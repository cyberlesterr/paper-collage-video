# Asset, Composite, Motion, and Delivery Quality

Read this before style sampling, bulk images, v4 composition authoring, proof review, or delivery tuning.

## Two Quality Scopes

`quality-report.json` v2 contains `assets` and `composites`. A passing file does not prove that a person is inside a boat or trees remain above water. Both scopes must pass.

Run `project:quality <slug> prepare` after files exist. Inspect original-resolution assets in small same-type batches and record their required semantic checks. SHA-256 changes invalidate affected file reviews; changing a bound semantic contract or generation family also invalidates them.

Registered members add topology-sensitive asset checks: `silhouette-fidelity`, `negative-space-clean`, and `background-leak-free`. A `supported-subject` composite also requires `motion-isolation-clean`. Passing any of those checks requires `evidenceFiles` from the current proof bundle. `key-edge-clean` only detects matte/color contamination; hard 0/255 alpha can pass that check while still deleting a limb or carrying background pixels.

Semantic risk adds evidence-backed checks:

- identity: `identity-family-consistent`, `identity-distinct-within-frame`, `cross-scene-identity-continuity`;
- mechanism: `mechanism-complete`, `load-path-readable`, `physical-plausibility`, `reference-conformant`;
- diagram: `diagram-edge-clean`, `small-text-legible`, `no-procedural-noise-on-semantic-lines`.

The runtime deterministically rejects `feTurbulence`, `feDisplacementMap`, and `feBlend` in diagram-critical SVG files. Raster diagrams and physical correctness still require original-resolution semantic evidence.

For style-gate coupled topology, run:

```bash
npm run style:proof -- <slug> --duration=4
npm run project:quality -- <slug> prepare
```

Inspect `dist/<slug>/style-proof/evidence/` at useful resolution: alpha masks, checkerboard isolates, tight crops, and before/shifted motion-stress sheets. Record participating assets and the representative composite with those paths:

```json
{
  "reviews": [
    {
      "assetId": "traveler-subject",
      "reviewer": "host-vision",
      "passedChecks": ["subject-complete", "edge-clean", "silhouette-fidelity", "negative-space-clean", "background-leak-free"],
      "failedChecks": [],
      "evidenceFiles": [
        "dist/story/style-proof/evidence/traveler-subject-alpha.png",
        "dist/story/style-proof/evidence/traveler-subject-checkerboard.png",
        "dist/story/style-proof/evidence/traveler-subject-tight.png",
        "dist/story/style-proof/evidence/traveler-subject-motion-stress.jpg"
      ]
    }
  ]
}
```

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
      "evidenceFiles": ["dist/story/composition-proof/crops/group-scene-01-boat-rig-final.png"],
      "note": "Establish, action, and final crops inspected at useful resolution"
    }
  ]
}
```

Semantic targets use ids such as `semantic:recurring-cast:cast-comparison`. When a target spans scenes, inspect every generated crop together before passing continuity. When a mechanism target is reviewed, explicitly compare its crop with the declared parts, connections, load paths, degrees of freedom, forbidden forms, and reference evidence.

```bash
npm run project:quality -- <slug> record-batch --input=<reviews.json> --quiet
```

Never pass a semantic check merely to unblock production. Changing a member, mask, group transform, boundary, anchor, keyframe, cue, or proof time changes the composite fingerprint and invalidates that review.
Replacing or editing a recorded evidence file also invalidates its review. At the style gate, each member review must reference that proof bundle's alpha mask, checkerboard, tight crop, and motion-stress sheet; the composite review must reference its full/crop/debug proof frames and member motion-stress sheets. An unrelated screenshot cannot satisfy the gate.

## Pattern-Specific Review

- `supported-subject`: support contact, readable inside/on relation, visible front occlusion, shared carrier motion, identity continuity, and clean subject isolation under relative motion.
- `registered-environment`: registration alignment, boundary respected, no duplicated semantic band, readable depth, readable final composition.
- bound cue: visual event visible, sound event bound when required, proof time bound, final state preserved.
- semantic contract: every requested check is visible in its exact target shots; cross-scene checks compare all bound scenes rather than one attractive frame.

Deterministic checks already block missing slots, mismatched canvases, duplicate carrier motion, off-zone contacts, absent front alpha, incomplete upper/lower clips, duplicate semantic coverage, invalid targets, missing required sounds, out-of-window proofs, stale style fingerprints, and missing topology evidence. They do not infer whether every semantic part is intact; that remains evidence-backed semantic review.

## Motion and Cue Authoring

The scene camera, group transform, child local transform, keyframes, idle motion, and cue transform compose in that order. A group carries its attached family once. Child keyframes are local deltas and cover normalized `0..1`; narration resync therefore preserves the spatial relationship.

Map every approved beat to one cue. Target the group when the entire registered assembly reacts, or a child for a genuinely local action. `scene.cues` schedules both visuals and sound; do not create a second audio event list. Bind critical events to authored proof ids.

The normal contact sheet and final report reuse the authored proof moments and cue event table. Inspect establish, action/peak, and final states for relationship readability, subtitle safety, and preserved consequences.

## Subtitles and Audio

`project:assets-ready` owns narration synchronization, subtitle derivation, v4 validation, current-proof enforcement, and both quality gates. Provider or forced-alignment timing wins; otherwise deterministic punctuation-aware timing is used. Review reading-speed warnings.

Tune `audio.narration.volume` from preview loudness rather than rewriting source audio. Reports enforce configured LUFS tolerance and true-peak headroom.
