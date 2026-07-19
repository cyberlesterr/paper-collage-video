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

A recoverable tool error is not a handoff. A genuine blocker may end an automatic stage only after recording the failed work batch and reporting one specific human/external action.

## Coarse Recoverable Batches

Use `project:checkpoint` for material batches such as one location's plates, a character-sheet group, narration set, quality-review batch, or timeline pass. Provider provenance remains per asset in `assets-manifest.json`.

Do not create `in-progress` and `completed` history entries for every small deterministic file operation. On resume, continue a pending/in-progress batch and never regenerate completed work without a revision request.

## Tool-Only Image Generation

When collaboration workers are available, delegate bounded built-in image-generation units only. Keep the root workflow responsible for approvals, prompts, asset selection, state transitions, timeline work, and user updates.

Before dispatching, tell the human that generation is running and no response is needed. After a worker returns, verify the workspace file and record its provider provenance/batch checkpoint. A worker result is not a human gate.

If workers are unavailable, prefer a pollable provider. If the only callable image surface forces the main turn to end and cannot resume, report that exact capability blocker before invoking it.
