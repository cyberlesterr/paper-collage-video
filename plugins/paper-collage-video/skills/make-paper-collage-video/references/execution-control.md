# Recovery and Tool-Only Execution

Read this only when resuming `auto-continue`, recovering a blocker, or invoking a built-in image tool whose calling turn may end without text.

## Resume Once

Run once at the beginning of a new turn or after an interruption:

```bash
npm run project:resume -- <slug>
```

- `auto-continue`: continue to `control.nextCommand` or the first remaining work item.
- `wait-human`: show the gate artifacts, reason, and exact acceptable response.
- `complete`: report local delivery artifacts; do not infer external publication.

Do not pair `project:resume` with full status or `project:handoff-check`. Use `project:status --control-json` only to diagnose corrupt or surprising state.

At `asset-production`, resume sets `nextCommand` to null while `workItems.remaining` is non-empty; continue the first remaining batch. Once the list is empty it returns the exact `project:assets-ready` command.

A directing revision deliberately creates one `directing-revision-<sceneId>`
work item per changed scene. Do not hand-mark those items complete merely to
unblock delivery. The canonical `project:assets-ready` command completes a
pending/in-progress directing-revision item only after the current
storyboard/project execution tree, proof, quality, audio, subtitles, and seal
all pass. An unrelated pending/in-progress item or any blocked item stops that
transition. `approve-preview`, preview rendering, and final rendering reject
every unresolved work item.

A recoverable tool error is not a handoff. A genuine blocker may end an automatic stage only after recording the failed work batch and reporting one specific human/external action.

## Failure Circuit

Wrapped production commands record their failures in
`projects/<slug>/failure-circuit.jsonl`. Human decisions are not failures:
blueprint revisions live in the review receipt, and rejected provider attempts
live in the generation-attempt ledger.

- After a first command failure, do not run the same operation with the same
  input fingerprint. Change a real input or fix the root cause; `--force` is
  not an override.
- A changed input gets one new attempt. If the same normalized failure occurs
  a second time, the circuit opens immediately. Stop autonomous retries, run
  `project:failures -- <slug> summary`, and show the exact risk to the human.
- Only `project:failures -- <slug> resolve --circuit=<id>
  --note="<human decision>"` reopens an open circuit. A changed input that
  succeeds automatically resolves a single earlier command failure.
- If a diagnosed sandbox or host-permission boundary is the only changed
  condition, label that real change with
  `PAPER_COLLAGE_EXECUTION_CONTEXT=<stable-label>`. The label enters the input
  fingerprint; it is evidence of a changed environment, not a generic retry
  bypass.
- Chromium-backed blueprint, proof, preview, and final-render operations run a
  host-permission preflight before rendering, metrics, or failure-circuit
  writes. In a restricted host, rerun once in an authorized execution context;
  do not count the denied launch as a content failure and do not poison the
  retry circuit.
- After a human `revise` receipt, the unchanged blueprint cannot be rerendered
  — `project:visual-blueprint` rejects it locally until the execution tree
  actually changes. Act on the revision notes in the receipt; no
  `project:failures` step is involved.
- A rejected (quota-consumed) image request cannot be re-reserved with the
  same request fingerprint — change the prompt or real parameters first. The
  human-approved `imageAttemptLimit` remains the only spend ceiling.

Pending review is not a tool failure. Generate the current visual surface once
and actually display its media to the human, then wait instead of polling status
commands or repeatedly regenerating contact sheets. Blanket autonomy or the
user being unavailable never converts `wait-human` into `auto-continue`.

## Coarse Recoverable Batches

Use `project:checkpoint` for material batches such as one location's plates, a character-sheet group, narration set, quality-review batch, or timeline pass. Provider provenance remains per asset in `assets-manifest.json`.

Do not create `in-progress` and `completed` history entries for every small deterministic file operation. On resume, continue a pending/in-progress batch and never regenerate completed work without a revision request.

## Tool-Only Image Generation

When collaboration workers are available, delegate bounded built-in image-generation units only. Keep the root workflow responsible for approvals, prompts, asset selection, state transitions, timeline work, and user updates.

Before dispatching, tell the human that generation is running and no response is needed. For schema-v8 provider-generation/edit requests, validate the current project's exact executable Style Profile binding and reserve an attempt before invoking the built-in image tool. After a worker returns, verify the workspace file and record it with the same attempt id. If the output is abandoned or generation fails, explicitly close the attempt with truthful quota consumption. A worker result is not a human gate.

Before any non-style-sample image dispatch, require the current
`visual-blueprint-approval.json`. The one style sample is the only image request
allowed before that approval.

If workers are unavailable, prefer a pollable provider. If the only callable image surface forces the main turn to end and cannot resume, report that exact capability blocker before invoking it.
