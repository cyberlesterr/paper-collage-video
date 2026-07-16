# Plugin Setup and Workspace Bootstrap

Read this reference before any production command. The installed plugin is immutable distribution code; projects run in a separate writable Remotion workspace.

## Locate or Create the Workspace

Treat the current directory as an existing workspace only when its `package.json` contains the `project:new`, `project:status`, `project:preview`, and `project:render` scripts.

If no valid workspace exists:

1. Resolve the selected skill directory from the skill path shown to Codex.
2. Resolve the plugin root two directories above it.
3. Choose the target directory supplied by the human. If none was supplied, create `paper-collage-video-workspace` under the current writable workspace root.
4. Run the bundled bootstrap script:

   ```bash
   node <plugin-root>/scripts/bootstrap-workspace.mjs \
     --target=<absolute-workspace-path> \
     --install
   ```

5. Change all subsequent commands to the generated workspace root.
6. Run:

   ```bash
   npm run doctor -- --ready
   ```

Do not write projects, dependencies, renders, or generated media into the installed plugin cache.

## Failure Contract

If bootstrap or doctor fails, preserve any created workspace and report:

- the exact failed check or command;
- the workspace path;
- the safe command that can resume setup;
- the one permission, dependency, or provider action required from the human.

Do not proceed to concept or asset generation until required local checks pass. Provider availability for image and narration generation may remain a later explicit capability check because those providers are host-specific.
