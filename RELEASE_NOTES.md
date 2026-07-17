# Paper Collage Video v0.4.0

First public preview release of the configuration-driven paper-collage video
pipeline and Codex Plugin.

## Highlights

- Installable Codex Plugin that bootstraps an independent Remotion workspace.
- Adaptive story planning when duration, scene count, both, or neither is given.
- Configurable text, image, and fictional-voice providers with provenance
  manifests and resumable work items.
- Capability selection plus four explicit human approvals for concept,
  style/voice, preview, and final publication; automatic stages remain
  resumable.
- Project validation, narration synchronization, CPU-aware preview rendering,
  technical reports, and scene-aware contact sheets.
- One complete four-scene showcase, `tie-chu-mo-zhen`, plus a lightweight
  two-second fixture used only for installation smoke tests.

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
