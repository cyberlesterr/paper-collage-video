# Provider Selection and Provenance

Read this only when discovering, confirming, changing, invoking, or recording a text/image/voice provider.

## Discover and Confirm Once

Run `npm run provider:status -- <slug> --compact-json`, then verify recorded host tool ids against the current registry. `agent-check-required` is expected for a callable host provider; `error` is a real configuration problem. Do not probe availability with a paid call.

Collect text/image/voice selections with the combined concept decision and run `project:confirm-concept`. Use project scope unless the human explicitly asks to remember a workspace-wide choice. Never request or store secrets; command providers name environment variables in `requiredEnv`.

Use `provider:select` only for an isolated change or fallback. A provider switch or generated-image budget increase returns to the existing human decision; deterministic derivatives within an approved source family do not.

## Adapter Types

| Adapter | Use | Execution |
|---|---|---|
| `host` | Current Codex tool, skill, model, or app | Invoke, write local output, then `provider:record` |
| `command` | User CLI/wrapper/private adapter | `provider:run` executes without a shell and records success |
| `manual` | Authorized supplied or deterministic local asset | Copy/derive output, then `provider:record` |

## Schema-v2 Request and Reuse

Every image request requires `compositionBinding`. A free asset names its scene/node/role/canvas. A coupled asset also names the common registration and source master. Example derivative:

```json
{
  "$schema": "../../../schemas/asset-request.schema.json",
  "schemaVersion": 2,
  "projectSlug": "example",
  "assetId": "boat-front",
  "capability": "image",
  "output": "public/projects/example/assets/boat/front.png",
  "prompt": "Extract the front gunwale from the approved registered master",
  "compositionBinding": {
    "sceneId": "scene-01",
    "nodeId": "boat-front",
    "pattern": "supported-subject",
    "registrationId": "boat-family-01",
    "sourceMasterAssetId": "boat-master",
    "outputRole": "support-front",
    "canvas": {"width": 1600, "height": 900},
    "derivation": {"method": "alpha-extraction", "parentAssetId": "boat-master"}
  }
}
```

For a coupled family:

1. request/generate/import the complete master;
2. derive rear/subject/front, upper/lower bands, and masks from that master;
3. keep each derivative on the identical canvas and origin;
4. record every output so manifest v3 computes one family fingerprint.

Do not make independent text-to-image calls for registered members. Reuse requires the whole composition binding to match, so an unrelated water image cannot enter a registered river family merely because it looks similar.

```bash
npm run provider:reuse -- --request=projects/<slug>/requests/<asset>.json
npm run provider:run -- --request=projects/<slug>/requests/<asset>.json --provider=<id>
npm run provider:record -- --request=projects/<slug>/requests/<asset>.json --provider=<id> --model=<model>
```

The manifest owns provider/model/job, request and family fingerprints, output hash, master/derivative binding, and request snapshot. Production scheduling stays in `production.json`.
