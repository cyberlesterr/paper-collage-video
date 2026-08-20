# Workspace Setup

Read this only when the current directory is not already a valid paper-collage workspace or doctor fails.

A valid workspace exposes `project:new`, `project:resume`, `project:preview`, and `project:render` in `package.json`. Never generate projects inside the immutable plugin cache.

Rendering chooses a CPU-aware concurrency automatically, capped at eight pages. If a full Chrome executable is required and becomes unresponsive under multipage rendering, retry the unchanged command with `PAPER_COLLAGE_RENDER_CONCURRENCY=1`. This is a supported execution control only; it does not change project content, frame rate, or output quality.

If the Skill path injected into the current task names a cache version that is missing or differs from the installed plugin registry, do not search for the newest directory and continue implicitly. The task snapshot is stale: report both versions and start a new host session/task so Skill instructions and packaged runtime are loaded from one version. A bootstrapped workspace doctor also compares its marker version with its package version.

`runtime-build.json` is the executable identity for proof and render behavior.
Version strings alone are insufficient: source, packaged template, and installed
cache must agree on `packageVersion`, the complete `fingerprint`, and its named
`surfaces`. The `composition-proof` surface deliberately excludes subtitle-only
implementation files, so it may remain stable while the complete fingerprint
changes. After Skill/runtime changes, run `npm run plugin:sync`, install that
packaged version, compare the installed manifest, and bootstrap a fresh workspace
before claiming the upgrade is active.

The packaged runtime includes deterministic no-provider acceptance fixtures for registered families and rectangular alpha residue:

```bash
npm run proof:registered-family
npm run proof:alpha-bands
```

The first reports truthful provider/local-derivative/avoided-call counts and emits a three-member composition sample. The second requires its normal-contour/shadow negative to pass and its ordinary/extreme rectangular positives to be detected at source and proof scale. These checks do not invoke image, voice, or video providers.

If no workspace exists, resolve the plugin root two directories above this Skill and run:

```bash
node <plugin-root>/scripts/bootstrap-workspace.mjs \
  --target=<absolute-writable-workspace> --install
```

Then work from that target and run:

```bash
npm run doctor -- --ready
npm run provider:status -- --compact-json
```

The bootstrap owns npm installation and `.venv`; do not ask the human to activate Python manually.

`npm install` may report dependency audit advisories. Those are not a production
gate: `doctor -- --ready` is. Do not run `npm audit fix` on your own initiative —
it can move the pinned runtime out from under `runtime-build.json` and invalidate
every fingerprint the project has already recorded. Report the advisory and let
the human decide.

The bootstrap ignores OS bookkeeping entries (`.DS_Store`, `Thumbs.db`, and
friends) when deciding whether a target directory is empty, and names the actual
blocking entries when it refuses.

For an existing workspace, inspect identity without writing:

```bash
node <plugin-root>/scripts/bootstrap-workspace.mjs \
  --target=<cwd> --status-json
```

The JSON reports loaded Skill/installed plugin version, workspace marker and
package versions, declared and recomputed runtime fingerprints, required
commands, canonical process cwd/target identity, the exact upgrade command, and
preserved user scopes. Production requires both `compatible=true` and
`productionSessionCompatible=true`. If runtime identity is compatible but
`session.targetMatchesCwd=false`, the plugin is not stale: the Codex task was
started with the wrong primary local workspace. Stop and start a new task from
the target; do not upgrade, copy managed runtime files, change extended
attributes, or continue through a separately authorized shell path. Run status
once per session/environment identity; do not repeat it after it passes unless
one of those inputs changes.

If the target already has a workspace marker from another plugin version, the
bootstrap stops instead of silently reusing stale runtime code. Upgrade the
managed runtime explicitly:

```bash
node <plugin-root>/scripts/bootstrap-workspace.mjs \
  --target=<absolute-writable-workspace> --upgrade --install
```

Upgrade replaces only packaged schemas, scripts, renderer source, fixtures,
tests, starter-demo, and dependency manifests. It preserves user projects,
`public/projects` and `dist` entries other than starter-demo,
`providers.local.json`, installed dependency/cache directories, and unrelated
user files. `providers.json` is merged so existing selections remain while new
optional capabilities become available.

If setup fails, preserve the target and report the failed check, workspace path, safe resume command, and one required permission/dependency/provider action. Do not proceed to generation until required local checks pass.
