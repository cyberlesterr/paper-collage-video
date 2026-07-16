# Provider Configuration

Read this reference before drafting text with an external model or generating image and narration assets. The workspace supports `text`, `image`, and `voice` capabilities without binding the skill to a vendor.

## Resolution Order

Provider configuration is deep-merged in this order:

1. `providers.json` — shareable workspace defaults;
2. `providers.local.json` — optional machine-specific overrides, ignored by Git;
3. `projects/<slug>/providers.json` — optional project-specific overrides.

Run this before production:

```bash
npm run provider:status -- <slug>
```

`agent-check-required` is expected for a `host` provider: inspect the tools installed in the current host before invoking one. `error` means the configured command, environment variable, or provider id is unavailable and must be fixed or explicitly overridden.

Never put API keys, bearer tokens, cookies, or other secret values in provider JSON. List only their environment-variable names in `requiredEnv`; the adapter receives values from its process environment.

## Adapter Types

| Adapter | Use when | Execution |
|---|---|---|
| `host` | Codex already has a suitable model, skill, app, or generation tool | The root workflow invokes that capability, writes the local output, then runs `provider:record` |
| `command` | A user has a CLI, script, SDK wrapper, or private API adapter | `provider:run` spawns the configured executable directly, without a shell, waits for exit 0, verifies the output, and records provenance |
| `manual` | An authorized local asset or human-authored text is supplied | Copy it to the declared output, then run `provider:record` |

Use `providers.local.example.json` as the starting point for custom commands. An async web API belongs behind a small adapter that performs submission and polling itself. The stable skill contract is simply: consume the request JSON, write the declared output file, and exit successfully.

## Request Contract

Keep reproducible requests under `projects/<slug>/requests/`. Example image request:

```json
{
  "$schema": "../../../schemas/asset-request.schema.json",
  "schemaVersion": 1,
  "projectSlug": "my-film",
  "assetId": "scene-01-background",
  "capability": "image",
  "output": "public/projects/my-film/assets/plates/01-bg.png",
  "prompt": "Layered paper collage courtyard, no characters, no text",
  "model": "auto",
  "settings": {"width": 1920, "height": 1080}
}
```

Use `capability: "text"` with `prompt` for external script/storyboard generation. Use `capability: "voice"` with `text`, optional `voiceId`, and audio settings for fictional narration.

For a command adapter:

```bash
npm run provider:run -- --request=projects/<slug>/requests/<request>.json
```

For a host or manual adapter, generate or import the exact `output` file, then record it:

```bash
npm run provider:record -- \
  --request=projects/<slug>/requests/<request>.json \
  --provider=<provider-id> \
  --model=<actual-model> \
  --external-id=<optional-job-id>
```

The command adapter may use these literal placeholders in `command.args` or `command.cwd`:

- `{request}`, `{output}`, `{workspace}`, `{projectDir}`;
- `{projectSlug}`, `{assetId}`, `{capability}`;
- `{prompt}`, `{text}`, `{voiceId}`, `{model}`, `{settingsJson}`.

Arguments are passed as an array with `shell: false`; shell substitutions such as `$HOME`, semicolons, and backticks are not evaluated by the skill.

## Provenance and Resume Behavior

Every `provider:run` or `provider:record` call updates `projects/<slug>/assets-manifest.json` by stable `assetId`. Each entry records the provider, adapter, actual model when known, optional external job id, SHA-256, size, time, output path, and request snapshot.

Provider provenance does not replace `production.json`: keep material work items there with `project:checkpoint`. If a provider is unavailable, record the exact work-item blocker and preserve the current production stage. Do not manufacture an output or silently switch to a different paid service.
