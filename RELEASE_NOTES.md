# Paper Collage Video v0.8.0

This release makes semantic correctness and composition relationships explicit
parts of the editable Remotion production contract instead of leaving them to
image-generation prompts.

## Highlights

- Installable Codex Plugin that bootstraps an independent Remotion workspace.
- Rhythmic storyboards with authored scene blueprints, beats, cues, keyframes,
  and proof times.
- Composition Contract v4 with registered `supported-subject` and
  `registered-environment` groups, shared canvases, source masters, relationship
  proofs, and stale-review invalidation.
- Reusable identity, topology, mechanism, and diagram contracts. Coexisting
  characters require structural differences; working objects require complete
  parts, connections, load paths, motion constraints, and reference evidence.
- Schema-v3 image requests with semantic bindings that combine every applicable
  contract instead of checking only one dominant risk.
- An append-only image-generation attempt ledger with atomic budget reservation,
  truthful rejected/abandoned accounting, exact reuse, and final-canvas size
  validation.
- Deterministic rejection of procedural SVG filters on diagram text, arrows,
  icons, and borders.
- Three default human decisions: concept/provider/budget, style/fictional voice,
  and rendered preview. Local final delivery remains separate from publication.
- A lightweight two-second fixture used only for installation smoke tests;
  production projects and media are not bundled into the Plugin package.

## Compatibility

- New projects use project schema v4; v3 and earlier projects are intentionally
  not migrated or silently downgraded.
- Ledger-enabled projects require schema-v3 image requests.
- Start a new Codex task after upgrading so the v0.8.0 Skill snapshot is loaded.

This release contains reusable source, the packaged Plugin, and technical test
fixtures only. It does not publish production project media or add a new manual
Release attachment. The older v0.5.0 repository demo remains available under
the limited terms in `ASSET_LICENSES.md`.

## Install

Give Codex the repository URL, or run:

```bash
codex plugin marketplace add cyberlesterr/paper-collage-video
codex plugin add paper-collage-video@paper-collage-video
```

Start a new Codex task and invoke `$make-paper-collage-video`. The Plugin will
create a writable workspace outside its installation cache and run environment
diagnostics before production begins.

## Requirements and Support

- Node.js 20 or newer
- FFmpeg and ffprobe
- Python 3.11 or newer for image processing and proof generation
- macOS and Ubuntu are validated; Windows support is currently best effort

Image and voice generation require capabilities or provider accounts selected
by the user. The project does not publish generated media automatically.

## Licensing

The software is MIT-licensed. Bundled showcase and fixture media is excluded
from MIT and is limited to repository demonstration, testing, and evaluation;
see `ASSET_LICENSES.md`. Remotion and other dependencies retain their own
licenses, including Remotion's Company License requirements in some commercial
use cases; see `THIRD_PARTY_NOTICES.md`.
