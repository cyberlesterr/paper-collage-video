# Paper Collage Video v0.5.0

Second public preview of the configuration-driven paper-collage video pipeline
and Codex Plugin.

## Highlights

- Installable Codex Plugin that bootstraps an independent Remotion workspace.
- A clean v2 project protocol with seconds-only timeline authoring and no v1
  migration or compatibility branches.
- Mandatory hash-bound technical and semantic image quality review.
- Environment depth layers, camera keyframes, per-character narrative motion,
  scene transitions, action audio, and project-local fonts.
- Adaptive story planning when duration, scene count, both, or neither is given.
- Configurable text, image, and fictional-voice providers with provenance
  manifests and resumable work items.
- Capability selection plus four explicit human approvals for concept,
  style/voice, preview, and final publication; automatic stages remain
  resumable.
- Project validation, narration synchronization, subtitle alignment, LUFS and
  true-peak reporting, CPU-aware rendering, and scene-aware contact sheets.
- A lightweight two-second fixture used only for installation smoke tests;
  production projects and media are not bundled into the Plugin package.

## Complete Repository Demo

The Release has one media attachment only:
[Tie Chu Mo Zhen — 77.7-second 1080p final film](https://github.com/cyberlesterr/paper-collage-video/releases/download/v0.5.0/tie-chu-mo-zhen-final.mp4).
It demonstrates the v2 quality gate, six-scene timeline, depth and narrative
motion, subtitles, fictional narration, action sound effects, and delivery
checks. Preview renders, motion proofs, contact sheets, and source assets are
not attached.

The demo is repository-demo-only material rather than an MIT-licensed media
asset. See `ASSET_LICENSES.md` before redistributing or reusing it.

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
- Python 3.11 or newer for chroma-key character-sheet processing
- macOS and Ubuntu are validated; Windows support is currently best effort

Image and voice generation require capabilities or provider accounts selected
by the user. The project does not publish media automatically.

## Licensing

The software is MIT-licensed. Bundled showcase and fixture media is excluded
from MIT and is limited to repository demonstration, testing, and evaluation;
see `ASSET_LICENSES.md`. Remotion and other dependencies retain their own
licenses, including Remotion's Company License requirements in some commercial
use cases; see `THIRD_PARTY_NOTICES.md`.
