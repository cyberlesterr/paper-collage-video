# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/)。

## [Unreleased]

### Added

- Hash-bound asset quality reports with deterministic image checks and a recorded semantic visual rubric.
- Configurable camera keyframes, scene transitions, environment depth layers, character motion presets and action-timed sound effects.
- Request fingerprints and exact-match provider asset reuse across projects.
- Provider/forced-alignment subtitle timing support with a deterministic punctuation-aware fallback.
- Integrated LUFS and true-peak measurements with optional delivery targets.
- Optional project-local font files and responsive landscape/portrait UI layout.

### Changed

- New projects require asset quality approval before `assets-ready`; legacy projects remain advisory until migrated.
- Narration probing, character matte extraction and contact-sheet frame extraction use bounded parallel work.
- Preview renders use a lighter review encoding profile and all renders use CPU-aware concurrency.
- Validation now checks background pixel density, subtitle length and reading speed, motion/depth fields and action audio timing.

### Fixed

- Image-processing commands now use `PYTHON_BIN`, then the workspace `.venv`, before falling back to the system Python.

## [0.4.0] - 2026-07-17

### Added

- Installable Codex Plugin with an isolated Remotion workspace bootstrap.
- Adaptive duration and scene planning for all four partial-input modes.
- Configurable text, image and fictional-voice providers with provenance records.
- Resumable production stages and four explicit human approval gates.
- Project validation, preview/final rendering, technical reports and contact sheets.
- Open-source contribution, support, security and community documentation.
- Dependabot configuration for npm and GitHub Actions, plus CodeQL scanning.
- Third-party licensing notices.
- MIT software license and a separate repository-demo-only media license.

### Fixed

- Preview rendering now caps Remotion concurrency at the CPU capacity reported
  by Node.js instead of requiring eight cores.

### Changed

- GitHub Actions use Node 24-based official action releases and explicit
  read-only repository permissions.
- The root workspace version now matches plugin version `0.4.0`.
- The repository now keeps one complete showcase, `tie-chu-mo-zhen`; older
  production demos and the legacy one-shot composition were removed.

[Unreleased]: https://github.com/cyberlesterr/paper-collage-video/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/cyberlesterr/paper-collage-video/releases/tag/v0.4.0
