# Execution Control

Read this reference before starting or resuming work. It defines when a turn may end and how tool-only results are contained.

## Stage Control

Run this at every new turn, after every interruption, and before ending a turn:

```bash
npm run project:status -- <slug> --control-json
```

Interpret `control.mode` strictly:

| Mode | Required behavior |
|---|---|
| `auto-continue` | Keep working. Do not ask the human to say “continue” and do not end merely because one tool call finished. |
| `wait-human` | Stop only after showing the gate's artifacts, why a decision is needed, and the exact acceptable reply. |
| `complete` | Report completion and artifacts. Do not infer external publication. |

A real blocker may end an `auto-continue` turn only after reporting the exact failure, preserved stage, attempted safe recovery, and the specific human or external action required. A raw tool error or a tool result bubble is never a handoff.

## Turn-End Contract

Before any final response, run:

```bash
npm run project:handoff-check -- <slug>
```

The command exits with code 2 during `auto-continue`. A genuine blocker requires both fields:

```bash
npm run project:handoff-check -- <slug> \
  --blocker="<exact failure>" \
  --needs-user="<single required action>"
```

Then follow this response contract:

1. Read `control.mode` from `project:status --control-json` and honor the handoff check result.
2. If it is `auto-continue`, continue to `control.nextCommand` or the next incomplete work item.
3. If it is `wait-human`, include all expected artifacts that already exist.
4. State exactly one of:
   - `无需你操作，我会继续。`
   - `请回复：<明确决定或修改意见>。`
   - `当前阻塞：<原因>；需要你：<唯一必要动作>。`
5. Never send an empty final response.

Send a short progress update before long calls and at least every 60 seconds while work is active. After a recoverable tool failure, state the recovery and continue without asking for permission unless new authority is actually required.

## Tool-Only Image Generation

Built-in image generation may require its calling turn to end without explanatory text. Contain that behavior so it cannot terminate the main video workflow:

1. When collaboration workers are available, delegate each bounded built-in image-generation unit to an asset worker. This skill explicitly permits workers only for image generation, copying the output into the workspace, and deterministic image validation.
2. Keep the root agent responsible for approvals, production-state transitions, prompts, final asset selection, timeline work, and user updates.
3. Before dispatching, tell the human that generation is running and no response is needed.
4. After the worker finishes, verify the workspace file and record the work item as `completed`; a worker's empty/tool-only final response is not a gate.
5. If workers are unavailable, prefer a generation provider that exposes a pollable job. If only a tool-only surface exists and the host cannot auto-resume, report that capability blocker before starting instead of invoking it and silently stopping.

Never use a human “continue” message as a scheduler for bulk generation.

## Recoverable Work Items

Track material production steps with:

```bash
npm run project:checkpoint -- <slug> <id> in-progress --label="<human-readable label>"
npm run project:checkpoint -- <slug> <id> completed --artifact="<workspace path>"
npm run project:checkpoint -- <slug> <id> blocked --note="<exact blocker>"
```

Use stable ids for background plates, character sheets, narration clips, alpha extraction, timeline configuration, validation, preview, and final render. On resume, continue the first pending, in-progress, or blocked item that can be recovered safely. Do not regenerate a completed artifact unless revision was requested.

## Gate Response Minimums

Every `wait-human` response must contain:

- why the workflow is paused;
- clickable or visible artifacts for this gate;
- technical results separately from creative judgment;
- the exact approval phrase or a request for concrete revision notes.

The four human gates are concept, style and fictional voice, rendered preview, and publication readiness. All other stages are autonomous.
