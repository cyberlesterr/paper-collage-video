# Workspace Setup

Read this only when the current directory is not already a valid paper-collage workspace or doctor fails.

A valid workspace exposes `project:new`, `project:resume`, `project:preview`, and `project:render` in `package.json`. Never generate projects inside the immutable plugin cache.

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

If setup fails, preserve the target and report the failed check, workspace path, safe resume command, and one required permission/dependency/provider action. Do not proceed to generation until required local checks pass.
