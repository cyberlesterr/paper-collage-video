# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/)。

## [Unreleased]

### Changed

- 将开发版本推进到 `0.19.1-dev.2`；scenario 现在把完整图片调用估算编译为逐项 `providerRootPlan`，每个真实 provider 请求必须绑定风格样张、单背景、source-package 角色或姿态母版中的一个批准根。
- 将开发版本推进到 `0.19.1-dev.1`，并同步升级 Remotion/CLI `4.0.505`、React/React DOM `19.2.8` 及对应类型包。
- 更新 `@emnapi/runtime` 锁文件到 `1.11.3`，并将 GitHub Actions 的 Python 设置动作升级到 `actions/setup-python@v7`。
- 重新生成 source、packaged plugin、starter proof 与 runtime fingerprint，确保依赖变化不会绕过可执行身份和发行包漂移检查。

### Fixed

- 阻止 `full-depth` 项目用少量 provider 图加大量 `manual-import`/本地 SVG 满足结构和质量计数后提前进入 human review；`assets-ready` 现在要求完整根资产逐项兑现，并拒绝本地漂移但仍沿用旧 `runtime-build.json` 的工作区。

## [0.19.0] - 2026-08-04

### Added

- Project/Storyboard v12 的动态 Style Catalog、可执行 Style Profile v2 与整片 Motion Contract：视觉表面、转场集合、节拍角色、镜头、环境运动和例外都进入可验证、可失效的正式协议。
- 注册状态主体的三维 Bézier `path-locomotion`：按物理像素弧长采样，支持切线自动朝向、角度展开、平滑与转速上限、景深投影、动态层级、速度驱动的平面/朝向/背向循环，以及绑定同一路径的世界边界相机跟随。
- 有限世界的 topology proof、连续旅途 encounter contracts、camera-compensated world-motion proof 与跨场景 trajectory/continuity 约束，用确定性证据覆盖进入、接近、回应、离开、转向、远近移动和视口覆盖。
- `semantic-slices`、provider-native source normalization、baked-checkerboard alpha 恢复、显式 source rectangle 状态表提取，以及完整注册家族/图层/容器的本地派生和来源链。
- 人工批准图片上限的追加式增额审计、递归 ESM runtime dependency closure，以及 source/package/installed-cache 可比较的完整 runtime identity。

### Changed

- 漫画化视频继续使用普通镜头和转场；对白、说明和旁白保留在音频与字幕中，只有绑定离散音效、显隐生命周期和质量证明的短视觉拟声字进入画面。
- 路径运动由单一 `path-locomotion` 合同拥有位移、景深、投影、层级和朝向；不再用重复 camera/scale keyframes 或多套方向素材模拟同一路径。
- Looping world、registered family、semantic depth slices、场景参与者和 provider 请求都必须先通过对应的 authoring、schema、证明、指纹和质量门，不能以项目特例或手工 opacity 堆叠替代。
- `complete` 保持本地制作终态；`approve-publish` 只在完成后记录一次具体目标、动作和范围，不构成可复用发布授权。

### Fixed

- 修复相机跟随路径与世界运动证明可能使用不同坐标面、嵌套父节点导致路径测量漂移，以及转向处角度跳变或朝向证明不足的问题。
- 修复 provider reservation/record/recovery 的模型身份可能漂移、已接受注册状态可能因局部修复被改写，以及 observed key plane、透明边缘和 source rectangle 证据不足的问题。
- 修复持续世界中的注册家族、稀疏前景、场景参与者和 encounter 生命周期可在可见结果与合同之间失配的问题。
- 移除不可达的旧 `publish-approval` 阶段，并让 runtime 指纹递归覆盖实际加载的本地 ESM 依赖和 Remotion 入口面。
- 将 Remotion 构建链的传递依赖 `fast-uri` 锁定到修复 CVE-2026-18446 的 `3.1.5`，并把最低安全版本纳入源码与发行包测试。

## [0.16.0] - 2026-07-27

### Added

- Project/Storyboard schema v10、layer-complete source package、`registered-depth-stack`、三画幅 reveal envelopes，以及在 provider 调用前锁定的完整 rear/subject/front 语义。
- Registered-family v2、asset-request v7 与 identity-bound state sheets：支持注册 sheet、完整上下文 layer edits、逐状态 anchor/facing/identity 证据和确定性本地派生。
- `looping-environment`、可见 world surfaces、多主体 screen/world anchor、near-layer 遮挡和带符号 trajectory contracts，用于可证明的持续横向世界与竞速叙事。
- Editorial v9 的实际音频 edit points、编辑型字体、解释型注释、数据驱动 SVG、响应式导演计划和语义高级切换。
- `motionPolicy=locked-static` 与受人工授权的 preview semantic revision；修订会保留 provider 上限并失效所有相关旧证明。
- 完全本地的 registered-family、alpha-band、VOX Phase 2 和 looping-world proof fixtures，包括 16:9、9:16、1:1 实际渲染和 fingerprint 报告。

### Changed

- 新项目先选择画幅、三张版本化视觉风格和视差偏好，再比较 draft/balanced/full-depth 三个完整故事、动画、provider 与成本方案；profile ceiling 只表示规划容量，真实调用受人类批准的精确 cap 约束。
- 每个故事关键动作必须路由到真实 registered state、local motion 或 layer package，不能只用计数声明覆盖。
- `project:assets-ready` 现在封印素材、质量、字幕、音频、时间线和 fingerprint；preview/final 只接受当前 seal，并将字幕证明与 composition proof 分离。
- 质量审核绑定 surface、target、report、evidence 和 contact-sheet 生命周期；任何相关 hash 变化都会使旧批准失效。
- 最新系统只维护当前 schema 和输出能力，不加载、迁移或保留旧项目格式的兼容分支。
- `remotion` 与 `@remotion/cli` 同步升级到 4.0.499；PostCSS 更新到兼容补丁 8.5.23，`fast-uri` 保持已修复的 3.1.4。

### Fixed

- 修复关键动作只在 scenario 计数、状态身份/朝向/锚点不可证、world strip 矩形合法但真实像素不可用，以及单主体模型无法表达多角色世界锚定的问题。
- 修复静态镜头被 profile 动画计数反向污染、人工语义修订没有正式入口，以及修订后旧 style/proof/render 证据仍可能被复用的问题。
- 修复质量审核可能跨 surface 或 target 复用、字幕交付证据未独立封印，以及资产变更后 preview/final 生命周期失效不完整的问题。
- 在 provider reservation 前阻断缺少完整 rear plate、subject silhouette、front overlay、共享注册画布、三画幅 reveal envelope 或 active identity reference 的生产计划。
- 缺失实际音频 timing、无效字体签名、annotation 越界、alpha/key edge 污染、状态锚点漂移、错误朝向和 trajectory 逆行现在会确定性阻断。

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

[Unreleased]: https://github.com/cyberlesterr/paper-collage-video/compare/v0.19.0...HEAD
[0.19.0]: https://github.com/cyberlesterr/paper-collage-video/compare/v0.16.0...v0.19.0
[0.16.0]: https://github.com/cyberlesterr/paper-collage-video/compare/v0.8.0...v0.16.0
[0.8.0]: https://github.com/cyberlesterr/paper-collage-video/compare/v0.6.0...v0.8.0
[0.6.0]: https://github.com/cyberlesterr/paper-collage-video/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/cyberlesterr/paper-collage-video/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/cyberlesterr/paper-collage-video/releases/tag/v0.4.0
