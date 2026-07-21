# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/)。

## [Unreleased]

## [0.8.0] - 2026-07-21

### Added

- 必需的节奏故事板：逐幕蓝图、归一化故事节拍和证明时刻。
- 人物/环境分层关键帧与按故事节拍绑定的视听 cue 运行时。
- 直接从证明时刻生成的动作联系表，以及故事板到成片的漂移校验。
- Composition Contract v4：递归组合树、`supported-subject`、`registered-environment`、共享坐标与源母版注册。
- 人物身份、主体拓扑、真实机构和说明图四类语义生产契约，以及跨场景/原分辨率证据目标。
- schema-v3 生图请求、追加式生成尝试账本、并发预算锁和最终画布尺寸校验。

### Changed

- 高风险素材不再只依靠提示词：必须绑定可验证的语义契约，多个风险合同会合并全部必需检查。
- 组合证明会清理旧输出，并在素材、节点、cue、证明时刻或合同指纹变化后使旧审核自动失效。
- 接触、遮挡和共享边界素材必须来自同一注册母版；不可靠抠图会退回刚性整图运动。
- 项目协议直接升级为 v4；不提供 v3 及更早数据的自动迁移或回退。

### Fixed

- 同框身份契约要求结构化角色指纹差异和逐场景的不可同脸证据。
- 机构契约要求完整零件连接、受力/传动路径、自由度、禁止形态和结构参考。
- 说明图 SVG 确定性拒绝会污染文字、箭头和边框的程序化噪声滤镜。
- 生图预算只计算真实 provider 生成/编辑尝试，确定性裁切、蒙版和 alpha 派生不重复计费。

## [0.6.0] - 2026-07-20

### Added

- `draft`、`balanced` 和 `full-depth` 制作档位，以及可验证的逐项目图片预算。
- 一次确认概念、制作档位和三类 provider 的组合命令，以及精简的恢复状态输出。
- 批量、原子写入的素材质量记录。

### Changed

- 项目协议直接升级为 v3；不提供 v2 数据迁移、回退或兼容分支。
- Skill 改为按当前阶段加载 reference，默认人工停顿从五次收敛为概念/provider、风格/音色、预览三次。
- `project:assets-ready` 统一负责时长同步、字幕生成、质量门和项目校验，正式本地渲染成功后直接完成交付。
- Provider 状态、质量状态和恢复状态支持紧凑输出，减少重复读取和长 JSON 回传。

## [0.5.0] - 2026-07-18

### Added

- Hash-bound asset quality reports with deterministic image checks and a recorded semantic visual rubric.
- Configurable camera keyframes, scene transitions, environment depth layers, character motion presets and action-timed sound effects.
- Request fingerprints and exact-match provider asset reuse across projects.
- Provider/forced-alignment subtitle timing support with a deterministic punctuation-aware fallback.
- Integrated LUFS and true-peak measurements with optional delivery targets.
- Optional project-local font files and responsive landscape/portrait UI layout.

### Changed

- Project schema v2 uses one mandatory quality path and seconds-only authoring fields; removed v1 compatibility branches are intentionally unsupported.
- The previous `tie-chu-mo-zhen` requests, approvals and media were removed; its workspace now starts fresh at the v2 capability gate.
- CI and releases validate the reusable engine and technical fixture without depending on production showcase media.
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

[Unreleased]: https://github.com/cyberlesterr/paper-collage-video/compare/v0.8.0...HEAD
[0.8.0]: https://github.com/cyberlesterr/paper-collage-video/compare/v0.6.0...v0.8.0
[0.6.0]: https://github.com/cyberlesterr/paper-collage-video/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/cyberlesterr/paper-collage-video/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/cyberlesterr/paper-collage-video/releases/tag/v0.4.0
