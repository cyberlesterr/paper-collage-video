# Executable Whole-Film Motion Contract v1

Read this when authoring or revising the whole-film action language, assigning
beat performance roles, presenting the style/voice gate, or diagnosing a stale
motion approval.

## Authoring Contract

Storyboard v12 replaces descriptive `style.motionLanguage` prose with one
structured `motionDirection`. It declares:

- the whole-film summary and pacing;
- ordered performance grammar, anticipation/follow-through policy, pose
  strategy, and minimum final hold;
- camera, transition, and ambient strategies;
- an explicit rationale whenever project pacing differs from the selected
  executable Style Profile.

Every beat owns one `performanceRole`: `establish`, `anticipate`, `action`,
`follow-through`, `settle`, `hold`, or `transition`. The role order follows the
global grammar. Every role binds a `proofTimeId`; a `settle` binds a final proof
and leaves the declared final-hold window. Do not hand-author `motionContract`.

## Compiler Ownership

`project:storyboard` compiles `motionContract` from the direction, beat roles,
treatments, transition recipes, compiled editorial fingerprint, and current
Style Profile. It rejects:

- missing establish/action/settle phrases;
- hero actions that violate required anticipation or follow-through;
- ungrounded pacing deviations;
- camera, transition, ambient, or pose strategies with no matching execution;
- late settle beats or missing proof anchors.

The compiled contract carries two fingerprints:

- `approvalFingerprint`: the human-visible semantics—direction, Style Profile,
  scene phrase/role/proof mapping, locked-static exceptions, and transition
  intents;
- `fingerprint`: exact execution, including phrase timing, treatment coverage,
  transition recipes, and editorial timing.

A directing-only timing change may preserve `approvalFingerprint` while
changing `fingerprint`. A semantic role, grammar, proof binding, transition
intent, exception, or Style Profile change invalidates the approval.

## Existing Human Gate

This contract does not add a fourth gate. `project:storyboard` writes
`motion-language-card.json`. At the existing story-specific style and fictional
voice gate, show that card beside the style sample, voice audition, and 3–5
second proof. `project:style-proof` must bind both fingerprints. On explicit
approval of the current displayed review request,
`project:visual-review ... approve --receipt=<host-attributed-receipt>` writes
`motion-approval.json` with the reviewer, receipt fingerprint, human note,
Style Profile binding, both motion fingerprints, and current visual-blueprint
artifact hash. A free-text `approve-style-voice` call cannot create this record.

`project:assets-ready` rejects a missing or semantically stale motion approval.
Directing-only revisions may preserve the human approval, but changed exact
execution still invalidates proof/quality/render fingerprints. Semantic
revisions that change the approval fingerprint return to `style-review`.

## Runtime and Whole-Film Quality

Every compiled phrase must exist in runtime as both:

- a scene event bound by `beatId`; and
- the declared proof moment in `scene.motion.proofTimes`.

Quality report v7 creates `motion-contract:whole-film`. Review all scenes
together and pass the six contract checks only with current evidence:

- `motion-grammar-consistent`;
- `pacing-cadence-consistent`;
- `camera-strategy-consistent`;
- `transition-strategy-consistent`;
- `ambient-strategy-consistent`;
- `sync-anchors-current`.

One attractive style sample is not whole-film motion proof. The final quality
target binds the exact contract, runtime surface, scenes, events, transitions,
editorial fingerprint, and participating asset hashes.

The whole-film target is temporal-bound: it must carry a current
fingerprint-bound motion strip sampled across the film's proof moments, and
the schema-v4 scaffold refuses to generate, render, or record a review when
that strip is missing or stale. Multi-actor narration additionally requires
every active actor to own a trajectory/occlusion contract covering the
narration window; a single endpoint crop can never stand in for those checks.
