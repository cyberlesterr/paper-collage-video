# Story and Production Planning

Read this while resolving duration, scene count, or production profile. Duration and scene count are independent optional user constraints.

## Resolve Story Shape

| User supplied | Preserve | Infer |
|---|---|---|
| Neither | — | Duration and scene count |
| Duration only | Requested duration | Scene count |
| Scene count only | Requested scenes | Duration |
| Both | Both values | Pacing and allocation only |

Draft minimum coherent beats and estimate spoken duration before resolving the plan. For Chinese narration, roughly 3.5–4.5 Han characters/second is a planning aid. Reserve time for openings, subtitles, bounded pauses, and transition overlap. Treat an inferred duration as a provisional estimate, never as a quota that must be filled with static tails. Ask only when two explicit constraints are materially incompatible.

## Run Intake Before Cost Planning

For a title-only request, run the following immediately after `project:new`,
using the plugin root from the Skill path actually loaded into the task:

```bash
npm run project:intake -- <slug> --json \
  --presentation-root=<plugin-root>/assets/remotion-template
```

The command verifies that the workspace and loaded-plugin catalogs have the same
complete fingerprint. It returns a runtime path plus a separately authorized
presentation path for each card. Show every returned `presentationPath` before
the Ask Question UI; never show `runtimePath`, copy the files, remove extended
attributes, or fall back to a different cache. If one cannot actually be
displayed, stop at intake and report the host media/workspace scope failure.
Then collect:

- `16:9` (1920×1080) or `9:16` (1080×1920);
- one of the current catalog entries, identified by its returned id and label;
- parallax preference `auto`, `prefer`, or `minimal`.

The text-to-image PNGs use the same canonical turtle-and-hare forest
composition so the comparison isolates visual language. They are bundled,
versioned, fingerprinted assets: their generation happened once during plugin
development, while showing them during intake consumes no provider calls. They
do not replace the later story-specific style sample. Parallax is motion
treatment, not another visual style. Do not ask the production profile or cost
in the intake popup.

Confirming intake materializes the selected catalog entry as
`project.json.styleProfile`: a fingerprinted, immutable project snapshot of
generation directives, motion preferences, transition set, visual-SFX policy,
the exact neutral render surface treatment, required quality checks, review
focus, and reference image.
`project.json.theme` must equal `styleProfile.render.theme`; neither is a prose
hint or a palette suggestion. Planning scenarios bind the selected profile id,
catalog version, and profile fingerprint so a later style change invalidates
the scenario instead of silently changing production behavior.

## Compare Three Story and Production Scenarios

Using only the host model, author one shared story skeleton plus exactly three
scenario options and run:

```bash
npm run project:scenarios -- <slug> --input=<scenarios.json> --json
```

The shared skeleton must enumerate every story-critical visible action in
`commonStory.semanticActions`. Each option must cover each action explicitly
through one registered state, one local-motion target, or one compiled layer
package. The scenario compiler resolves that route against the option's actual
scene and rejects merely counting a pose family whose required state never
appears.

If the human supplied duration or scene count, copy it to `requested` and
preserve it in all three options. Otherwise bind public packages as follows:

| Internal id | User label | Story scope | Production behavior |
|---|---|---|---|
| `draft` | 轻量成片 | `concise` | Character/background/optional foreground plus local translate, fade, push/pull, breathe, bob, sway, jitter, tilt, and transitions. Generate only semantic states that transforms cannot represent; no enhancement state family by default. |
| `balanced` | 均衡动画 | `standard` | Local motion plus key character/prop sequences, normally 2–4 states; selectively layered hero scenes, depth and parallax. |
| `full-depth` | 完整纵深 | `expanded` | More required and enhancement families, 4–6 states where justified, rear/mid/front/near layers, parallax, looping worlds, weather and purposeful ambient motifs. |

Each option contains duration, scene count, narration estimate, per-scene beat,
character action, state-family intent, layer inventory, source packages,
parallax, ambient elements, local-motion targets, provider recommendation, cost
basis, final-film effect, and these compiled figures:

- style-proof, source-package, and pose-sheet provider calls;
- exact expected image calls, proposed human-approved cap, and profile hard
  ceiling;
- local derivatives and provider calls avoided;
- `profilePromise` and planned fulfillment.

Layer-capable scenario source packages use the exact strategy names and
compiled per-strategy call/derivative counts defined in
`layer-complete-assets.md`; the scenario compiler rejects any hand-authored
count that disagrees. An ordinary `single-background` is one call with no
derivatives, but it is intentionally not a compiled layer package. Do not use
any other planning-only aliases. Before proposing a
registered sheet for a viewport-filling environment, compare the
provider-native sheet cell dimensions with the largest authored display size
and camera zoom. A 2x2 package that would make one full-screen member
materially undersampled must be replaced by full-context edits or a native
`single-background` before the card reaches the human.

The card also records factual and rights risks, even when the list is empty.
The expected count includes the later story-specific style sample. Rejected or
abandoned attempts count after quota is consumed; exact reuse, registered-sheet
splits, masks, and deterministic normalization do not. The proposed cap must
cover expected calls and must not exceed the profile ceiling.

Present the cards together and recommend `均衡动画`, but never select it
silently. After the human chooses:

```bash
npm run project:plan -- <slug> --scenario=<draft|balanced|full-depth>
```

That card choice is the one combined scenario/concept/profile/cap/provider
approval. Automatically compile the selected storyboard afterwards. If its
state families and registered source packages match the approved card and its
complete calls stay inside the card, record the prior selection with
`project:confirm-concept`; do not add another routine confirmation. Material
drift returns to this same gate with a revised exact card.

The resulting Creative Plan remains schema v4 but adds `storyScope`,
`scenarioBinding`, and `profilePromise`. The scenario and option fingerprints
prevent a stale card from authorizing a changed plan. `project:plan -- <slug>
--json` with no other flag is a read-only display of the resolved decision.
Re-running it with `--scenario=` re-selects; when the option and its fingerprint
are unchanged this is idempotent and preserves `resolvedAt`/`selectedAt`, so a
`planDecision` already copied into a concept selection stays valid. Direct
`--duration/--scenes/--profile` planning remains a compatibility path, not the
default title-only workflow.

Do not hand-author the scenario input from prose. `project:scenarios` reports
every violation it finds in one run, and the exact per-option floors
(`minLocalMotionTargets` and friends) come from `profilePromise` rather than a
formula you have to rediscover. `localMotionTargets[].preset` and
`sourcePackages[].strategy` are drawn from the same executable vocabulary the
storyboard compiler uses, so a plan that passes this gate cannot become
unexecutable at compile time.

The profile has both ceilings and floors. Motion/image budgets cap spending and
complexity. `profilePromise` requires the storyboard to meet the selected
state-family, total-state, local-motion, layered-scene, parallax-scene, and
ambient-scene minimums. A `full-depth` plan cannot pass by rendering a
`draft`-level film.

The generic motion budget shown before scenario authoring is a scene-count
baseline, not permission to discard approved actions from a long continuous
shot. After the human selects an exact scenario, `project:plan` raises the
selected plan's state-family, per-family state, and continuous-target capacities
to cover that card when necessary. The scenario fingerprint and later
storyboard-consistency check still prevent unapproved families or targets, while
the exact provider-call estimate, approved attempt cap, and profile hard ceiling
remain unchanged. This is especially important for one-take stories that contain
several independently animated identities inside one scene.

Transforms may express emotion, emphasis, spatial translation, entrances,
camera movement, and ambient loops. They may not impersonate a changed
silhouette, limb pose, held prop, contact relation, mechanism state, true
running cycle, waking up, or another semantic state. Those require a registered
state family or the appropriate coupled composition. The compiler rejects both
budget overflow and profile under-delivery.

## Lock the Rhythmic Storyboard

After selecting a scenario and running `project:plan`, create a storyboard input and run:

```bash
npm run project:storyboard -- <slug> --input=<storyboard.json>
```

The storyboard is not another human gate. It is part of the existing combined concept decision and becomes the execution contract for production.

- Give the whole film one explicit arc and one shared visual/motion language.
- Give each planned scene a narrative role, single message, blueprint, estimated duration, and at least three ordered beats.
- Read `motion-contract-v1.md` and `motion-directing.md`. Author one v12
  `motionDirection`, assign every beat a `performanceRole`, and add one or more
  `treatments` to every beat.
  Author the visible change, motion or visibility mechanism, composition
  relationship, optional graphic mechanism, risk, importance, necessity, proof
  binding, and rationale. For relative rear/subject/front motion, also read
  `layer-complete-assets.md` and author the layer-complete source-package
  intent. Never hand-author `compositionPlan`, source-package cost totals,
  `directing`, or sheet grids; `project:storyboard` compiles them and rejects
  drift.
- Use normalized beat time (`at=0..1`) so rhythm survives narration resync.
- Choose one of the bounded blueprints: `layered-reveal`, `map-journey`, `archive-stack`, `character-procession`, `discovery-wipe`, `transformation-tableau`, `chapter-tableau`, or `quiet-lockup`.
- Define at least three proof moments per scene: an establishing state, an action/peak state, and a `final` state at or after `0.82`. Every proof needs a stable id, visible relationship assertions, and a `stateAssertions` array. Cover every planned sequence state at least once so its schedule can be verified deterministically.
- Declare exactly one top-level `sceneTransitions[]` record for every adjacent pair. Author narrative `intent` and `rationale`, normally letting the compiler choose the registered animated recipe. Use `intent=impact` plus an impact-cut treatment when abruptness is semantic. For ordinary intents, use a `rhythmic` cut only with a `beatId` in the outgoing final 20% or incoming first 20%. Every animated boundary must be opaque and covered by both the outgoing tail and incoming narration lead.
- Keep proof moments outside scene-boundary intervals so every sampled frame clearly proves the intended composition.
- In schema v12, every beat and treatment declares `proofTimeId` as an approved
  proof id or `null`; treatment proof must match its beat. `soundCue` names only
  a discrete event SFX, never narration. If a beat names one, it must bind an
  event-level proof and production must attach a real sound asset to at least
  one matching event using that same proof id. Narration remains exclusively in
  `scene.narration`.

The compiler protects required hero actions. If the selected profile cannot afford them, it rejects the storyboard instead of silently replacing a pose change with a cheap transform. Reduce enhancement motion first, raise the profile, or reduce story scope inside the existing concept decision.

The sum of scene estimates must stay within 8% of the resolved duration. Scene count must match exactly.

After real narration exists, `project:assets-ready` synchronizes exact media duration. When duration was inferred, the measured narration plus bounded tails and transitions becomes the execution duration, even when it is shorter than the estimate. When duration was explicit, a content deficit blocks validation; add narration or meaningful visual beats, add an approved audio passage, or revise the target instead of padding. Read `timing-continuity.md` before authoring scene tails.
