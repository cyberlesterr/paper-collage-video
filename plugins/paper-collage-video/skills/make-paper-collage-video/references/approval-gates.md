# Human Decisions, Cost, and Rights

Read this before presenting or recording a human gate, making a material paid call, cloning a voice, or taking an external action.

## Default Creation Gates

Require explicit decisions for:

1. Initial intake: `16:9|9:16`, one style from the current built-in catalog, and text-only parallax preference.
2. Combined scenario, story scope, duration/scenes, production profile, exact budget cap, facts, and provider plan.
3. Story-specific visual sample, fictional voice, whole-film action-language card, and the same-source visual blueprint: full low-resolution animatic, every scene's start/middle/end, and short clips for motion-bearing scenes.
4. Rendered preview and requested creative changes.

The first intake never authorizes provider spend. The combined second decision may authorize both providers and concept when the request clearly names both. Preserve the human's wording. If approval is ambiguous, ask one concise question.

Do not create a fourth default gate after final render. Local final delivery completes the creation task.

Loudness normalization, dynamic control, true-peak limiting, codec headroom,
and other delivery mastering parameters are not creative approvals. Resolve
them automatically against the declared mastering contract and expose the
measured result in the report. Even an extreme source does not justify asking
the user to approve gain or compression; repair it technically or report a
genuine processing failure.

If preview feedback intentionally changes narration meaning, scene semantics, or
which scenes must be still, do not disguise it as a directing-only revision.
Record a schema-v1 semantic revision authorization containing the source
feedback, exact allowed scene ids, human note, and equivalent-quality evidence,
then run `project:revise-preview-semantic`. The command rejects top-level
story/style drift, records old/new concept fingerprints, recomputes only legal
locked-static motion floors, preserves the approved provider cap, and
invalidates all dependent style/proof/render evidence.

## Recording the Combined Concept Decision

Do not hand-author the selection file. `project:confirm-concept -- <slug>
--scaffold` prints it complete: `planDecision`, `scenarioDecision`,
`budgetDecision`, and the canonical `sourcePackageDecision` are derived from the
current plan, scenario card, and compiled storyboard. Only two things are yours
to supply — the human's own words in `note`, and each `selections[].providerId`.

`sourcePackageDecision` is a four-key projection of
`directingSummary.generationBudget`, not the whole object; copying the budget
wholesale fails on the extra keys. If you do rebuild it, take it from
`project:storyboard -- <slug> --input=<file> --json`. All decision comparisons
are by value, so key order does not matter, and a mismatch reports each field
with its expected and received value.

## Correcting Directing After Concept Approval

Once concept approval is recorded, `project:storyboard` stops accepting input and
`--replace-unconfirmed-plan` no longer applies, because a style sample has been
spent. That is not a dead end. For a directing, proof, or state-execution error
found before visual approval:

```bash
npm run project:revise-preview-directing -- <slug> --input=<storyboard.json> --source=style-review
```

Add `--execution=<candidate-project.json>` when the execution tree needs the
matching edit. The command accepts timing, treatment, proof, and boundary
changes, rejects arc/style/meaning drift, keeps the approved provider cap, and
synchronizes the execution tree atomically. Never hand-edit `production.json` or
`project.json` approval state to work around a contract error — if this command
rejects the change, the change itself is out of scope for this gate.

## Cost Boundary

- Before combined scenario/concept approval, use only the current host model for the common story and three scenarios; do not invoke an unconfirmed external/paid provider. Built-in style cards are versioned local text-to-image PNG assets and consume no provider calls when shown during intake.
- Before style approval, classify and contract any identity-, topology-,
  mechanism-, or diagram-critical sample, then create exactly one
  story-specific style sample and a short fictional-voice audition. Author the
  complete final execution tree before bulk production and run
  `project:visual-blueprint`: the actual renderer keeps real sources already
  present and uses deterministic labeled proxies for missing ones. It must cover
  the full film, every scene's start/middle/end, and motion-bearing clips.
  Geometry, layer order, facing, state playback, displacement, camera, timing,
  and transitions are therefore decided before the expensive asset pass.
- The human owns every visual judgment on this surface, including visible
  seams, clipping, accidental occlusion, layer order, broken assets, facing,
  loop/displacement coordination, and overall appeal. Machine checks may
  confirm artifact readability, coverage, hashes, and freshness only. Show the
  style sample, animatic, contact sheet, clips, voice audition, and motion card
  together and record one approval or one revision response.
- The style/voice gate also owns motion-language and visual-blueprint approval.
  Show `motion-language-card.json` with the sample and blueprint. It must expose the
  whole-film grammar, pacing, camera/transition/ambient strategy, per-scene
  performance roles and proof anchors, final holds, exceptions, and
  `approvalFingerprint`. `project:visual-blueprint` writes a hash-bound review
  request. After the human explicitly decides the displayed current artifacts,
  generate the receipt with `project:visual-review -- <slug> make-receipt
  --decision=... --note="<user wording>" --reviewer=human:<id> --host=...
  --thread=... --message-ref=... --message-file=<user-message.txt>` — the
  command binds the current request and computes `userMessageSha256` and
  `receiptFingerprint` itself. Then `project:visual-review -- <slug>
  <approve|revise> --receipt=<path>` atomically writes the receipt and current
  Style Profile/motion/visual-blueprint bindings to `motion-approval.json` and
  `visual-blueprint-approval.json`. A blanket permission, user absence,
  silence, prior message, machine score, or agent note is not a receipt. This
  is not a fourth gate. A `revise` receipt records the human notes; regenerate
  the blueprint only after actually changing the execution tree.
- A directing-only timing or treatment refinement may keep that approval only
  when `approvalFingerprint` is unchanged; its exact execution fingerprint
  still invalidates stale proof, quality, and render artifacts. Changing motion
  grammar, performance roles, proof bindings, transition intent, locked-static
  exception, or Style Profile returns to this gate.
- After style approval, produce autonomously within the approved asset budget.
  Every non-style-sample provider request requires the current blueprint
  approval. Production assets may replace proxy sources without invalidating
  the contract; any geometry, z-order, facing, playback, timing, camera, or
  transition change requires a refreshed blueprint and human decision.
- A later image-budget increase requires one explicit exact total cap. Record it
  with `project:increase-image-budget`; the command preserves the original
  scenario proposal, appends the old/new cap plus used/reserved state and human
  note, and rejects any value above the current profile hard ceiling.
- Reuse exact-match assets and deterministic local processing before regeneration.
- Disclose the compiled source-package strategy, base/reserve/hard ceiling,
  one story-specific style-sample call, proposed exact image-attempt cap,
  provider calls, local derivatives, and avoided calls at the decision that authorizes them. Record the cap as
  `budgetDecision.imageAttemptLimit`; the profile ceiling alone is not provider
  authorization.

## Voice, Rights, and Accuracy

Use the confirmed fictional catalog voice. Real-person cloning is a separate opt-in requiring authorization for licensed reference audio and its transcript.

Stop for unclear logos, likenesses, private media, or third-party copyrighted assets. Offer a fictional or public-domain alternative without silently changing the brief.

Verify consequential historical, medical, legal, financial, or political claims with suitable current sources before locking narration. Record material uncertainty in the concept.

## External Publication

Technical validation does not prove factual, legal, brand, or editorial readiness. When the human actually requests upload, send, or publication:

1. confirm content, facts, rights, branding, and platform fit;
2. obtain one explicit authorization for the named destination/action;
3. before acting, record that exact authorization:

   ```bash
   npm run project:advance -- <slug> approve-publish --note="<destination + action + scope>"
   ```

4. perform only that authorized external action.

Never infer external authorization from preview approval or the existence of `final.mp4`.
Local production is already terminal at `complete`; `approve-publish` is an
optional post-completion audit event, not a stage and not blanket permission for
another destination or action.
