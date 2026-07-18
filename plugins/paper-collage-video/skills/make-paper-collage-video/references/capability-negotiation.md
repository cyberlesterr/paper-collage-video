# Capability Discovery and Confirmation

Read this reference immediately after creating a project or resuming one at `capability-review`. This is an operational configuration gate, not one of the four creative/publication approvals.

## Discover Before Asking

Run:

```bash
npm run provider:status -- <slug> --json
```

The JSON status includes every configured provider candidate and its deterministic readiness. Then inspect the capabilities actually callable in the current agent host. Use the current tool registry and installed-skill metadata; do not infer availability from a product name in the prompt or from a provider entry alone.

Build candidates for all three required capabilities:

- `text`: the current host language model, plus configured ready command/manual providers;
- `image`: each genuinely callable image-generation tool or skill, plus configured ready command/manual providers;
- `voice`: each genuinely callable fictional TTS/voice tool or skill, plus configured ready command/manual providers.

Only name a tool, provider, or model when current metadata identifies it. Record the exact host tool id for image and voice selections. Never probe a capability by making a paid generation call before the human chooses it.

Every capability must retain an authorized fallback: an existing `manual-*` provider for importing a user-supplied result. A human may also describe their own service. Do not request or store an API key in chat, the form, or provider JSON; custom command providers list secret *environment variable names* in `requiredEnv`.

## Decide Whether Confirmation Is Needed

`provider:status` returns `allConfirmed` and a selection for each capability.

- If every selection is confirmed and every selected host tool still exists in the current host, record `capabilities-ready` and continue without asking again.
- If a selected host tool is missing, treat that capability as stale and ask again. Do not silently substitute another provider.
- If any selection is absent, ask once for all unresolved capabilities.
- A project using a removed schema is invalid. Create a fresh v2 project and repeat its provider and creative decisions; do not carry approvals or provider selections across by inference.

## Prefer One Structured Confirmation Form

If the current host exposes a structured follow-up form tool such as `ask_followup_questions`, call it once with one `single`/`default` field per unresolved capability, at most three fields total. Use the human's language. Each field should say which relevant capability was found and ask whether to use it.

For each field:

1. list the detected host candidate(s) by truthful user-facing name;
2. list configured usable providers;
3. include the relevant manual import option;
4. include `{ "id": "__other__", "label": "我自己提供这个能力" }` with an `otherPlaceholder` asking for the service/CLI name and integration method, never a secret.

Example shape (replace candidates with the discoveries from the current host):

```json
{
  "title": "确认本次制作能力",
  "prompt": "我检测到了当前可用的生成能力；确认后会记在项目里，以后可随时更换。",
  "submitLabel": "确认并继续",
  "messagePrefix": "本项目使用这些能力：",
  "fields": [
    {
      "id": "image_provider",
      "label": "检测到 GPT Image 生图能力，是否用于这个项目？",
      "type": "single",
      "variant": "default",
      "options": [
        {"id": "gpt-image", "label": "使用 GPT Image"},
        {"id": "manual-image", "label": "我提供生成好的图片"},
        {"id": "__other__", "label": "我自己提供生图能力"}
      ],
      "otherPlaceholder": "例如：本地 ComfyUI 命令，使用环境变量 COMFY_TOKEN"
    }
  ]
}
```

This example does not prove GPT Image is available. Show that option only when the current host really exposes it.

Plan the complete form before calling it. After calling the form tool, stop the turn and wait for the submitted answer. Do not select a provider or generate an asset until the answer is present in the conversation. Do not emit raw widget HTML.

If no form tool is callable, ask the same choices in one concise ordinary chat message and wait. The skill must remain usable without ChatCut or any particular UI plugin.

## Persist the Human's Choice

For each submitted choice, run:

```bash
npm run provider:select -- <slug> <text|image|voice> <provider-id> \
  --note="<human decision>" \
  [--scope=project|workspace] \
  [--label="<display name>"] \
  [--adapter=host|manual] \
  [--tool="<exact host tool id>"] \
  [--model="<known model id>"]
```

Use project scope by default. Use workspace scope only when the human explicitly wants the choice reused across projects. A new `command` provider must first be configured in ignored `providers.local.json`; never synthesize an API integration from a free-form name alone.

Re-run `provider:status -- <slug> --json`. For a new project at the configuration gate, continue only when `allConfirmed` is true:

```bash
npm run project:advance -- <slug> capabilities-ready \
  --note="<concise summary of the confirmed capability choices>"
```

`capabilities-ready` verifies the merged provider configuration and deterministic command readiness. The agent remains responsible for verifying that recorded host tool ids are callable in the current host.
