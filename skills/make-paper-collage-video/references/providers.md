# Provider Selection and Provenance

Read this only when discovering, confirming, changing, invoking, or recording a text/image/voice provider.

## Discover Once

Run:

```bash
npm run provider:status -- <slug> --compact-json
```

Then verify recorded host tool ids against the current tool registry. `agent-check-required` is expected for host providers; `error` means the configured command, environment variable name, or provider is unavailable. Do not probe availability with a paid generation call.

Offer actual callable host tools, ready configured providers, manual import, and a user-supplied service. Never request or store secrets; command providers declare environment-variable names in `requiredEnv`.

## Confirm With the Concept

For the default new-project path, collect text/image/voice plus the concept decision once. Use project scope unless the human explicitly asks to remember choices across projects.

Selection file shape:

```json
{
  "scope": "project",
  "note": "User approved the concept, balanced budget, and these providers",
  "selections": {
    "text": {"providerId": "host-text"},
    "image": {
      "providerId": "gpt-image",
      "label": "GPT Image",
      "adapter": "host",
      "tool": "image_gen__imagegen"
    },
    "voice": {"providerId": "manual-voice"}
  }
}
```

Run `project:confirm-concept`. It writes all three choices once, verifies deterministic readiness, and advances directly to `style-review`. The agent still verifies that host tool ids are callable.

Use `provider:select` only for an isolated provider change or a fallback path. Do not run status again after a successful combined confirmation unless a host tool disappears.

## Adapter Types

| Adapter | Use | Execution |
|---|---|---|
| `host` | Current Codex tool, skill, model, or app | Invoke it, write the local file, then `provider:record` |
| `command` | User CLI/wrapper/private adapter | `provider:run` executes without a shell and records success |
| `manual` | Authorized supplied asset or text | Copy to the requested output, then `provider:record` |

Configure new command adapters in ignored `providers.local.json`. An async API belongs behind a small adapter that polls and writes the declared output.

## Request and Reuse Contract

Keep one request per generated/imported output under `projects/<slug>/requests/`. It records `assetId`, capability, output, generation input, model/settings, and optional image quality intent.

Minimal image request (validated by `schemas/asset-request.schema.json`):

```json
{
  "$schema": "../../../schemas/asset-request.schema.json",
  "schemaVersion": 1,
  "projectSlug": "<slug>",
  "assetId": "scene-01-bg",
  "capability": "image",
  "output": "public/projects/<slug>/assets/plates/01-bg.png",
  "prompt": "Layered paper-collage background; no people, text, logo, or watermark"
}
```

Before paid or slow generation, run `provider:reuse` with the request. An exact-match miss is normal. After host/manual output, run `provider:record`; command adapters use `provider:run`.

```bash
npm run provider:reuse -- --request=projects/<slug>/requests/<asset>.json
npm run provider:run -- --request=projects/<slug>/requests/<asset>.json --provider=<id>
npm run provider:record -- --request=projects/<slug>/requests/<asset>.json --provider=<id> --model=<model>
```

The manifest owns provider/model/job id, request fingerprint, output hash, path, and request snapshot. Production scheduling stays in `production.json`. Do not duplicate the full manifest into checkpoints or read it on resume unless diagnosing provenance.
