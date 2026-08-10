# Paper Collage Video

[![CI](https://github.com/cyberlesterr/paper-collage-video/actions/workflows/ci.yml/badge.svg)](https://github.com/cyberlesterr/paper-collage-video/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

一个给 Codex 使用的本地插画视频生产 Skill。它可以制作可编辑的纸片分层故事、漫画化叙事和说明型视频，并负责故事板、素材组织、动画、旁白同步、渲染与技术验收。

人始终决定内容意图、视觉方向、付费调用上限和最终成片；Skill 负责执行与验证。

当前公开稳定版本为 [`0.19.0`](https://github.com/cyberlesterr/paper-collage-video/releases/tag/v0.19.0)。项目仍处于 `1.0.0` 之前，内部协议可能继续调整，旧项目不会自动迁移。

## 演示

[观看《铁杵磨针》：77.7 秒、1080p 纸片故事](https://github.com/cyberlesterr/paper-collage-video/releases/download/v0.5.0/tie-chu-mo-zhen-final.mp4)

该演示来自较早版本，用于展示分层画面、景深运动、旁白、字幕和完整成片能力，不代表当前数据协议。演示素材的使用边界见 [ASSET_LICENSES.md](ASSET_LICENSES.md)。

## 安装与使用

推荐直接安装 Codex Plugin，不需要手动 clone 本仓库。可以把下面这段话交给 Codex：

```text
请安装这个 Codex 插件并完成初始化验证：
https://github.com/cyberlesterr/paper-collage-video
```

对应的安装命令是：

```bash
codex plugin marketplace add cyberlesterr/paper-collage-video
codex plugin add paper-collage-video@paper-collage-video
```

安装完成后，新建一个 Codex 任务并描述想做的视频：

```text
用 $make-paper-collage-video 做一条约 30 秒的玄奘西行纸片分层视频。
```

首次运行会创建独立、可写的 Remotion 工作区并进行环境诊断。项目文件、依赖和渲染结果不会写入插件缓存。依赖下载、FFmpeg 安装、Provider 授权和可能产生费用的调用仍可能需要人工批准。

## 人在流程中的位置

制作新视频时，Skill 通常只在这些内容节点等待：

1. 选择画幅、视觉风格和分层视差偏好。
2. 确认故事与制作方案、精确图片调用上限，以及文本、生图和虚构语音 Provider。
3. 一次查看故事专属风格样张、短试听、全片低清蓝图、每幕开头/中间/结尾和动态片段，提前确认最终构图与运动方向。
4. 查看 `preview.mp4`，批准成片方向或提出修改意见。

本地完成渲染不代表允许上传、发送或公开发布。外部发布必须另行获得授权。

## AI 与维护者入口

AI 执行制作时应遵循 [Skill 主入口](skills/make-paper-collage-video/SKILL.md) 及其按阶段引用的 references，而不是把本 README 当作生产协议。

常用文档：

- [完整制作流程与审批边界](docs/workflow.md)
- [项目合同](skills/make-paper-collage-video/references/project-contract.md)
- [Provider 配置与调用规则](skills/make-paper-collage-video/references/providers.md)
- [动作导演语言](skills/make-paper-collage-video/references/motion-directing.md)
- [质量与动作证明](skills/make-paper-collage-video/references/quality-motion.md)
- [Skill 演进原则](docs/skill-evolution-principles.md)
- [版本变化](CHANGELOG.md)

所有项目命令都由 Skill 按当前阶段调用。恢复中断任务时，优先使用：

```bash
npm run project:resume -- <slug>
```

## 本地开发

环境要求：

- Node.js 20+
- FFmpeg / ffprobe
- Python 3.11+（处理色键素材表时需要）

最小开发验证：

```bash
npm ci
npm run doctor -- --ready
npm test
npm run check
```

Skill 和运行时的维护源发生变化后，还必须运行：

```bash
npm run plugin:sync
```

`skills/make-paper-collage-video/` 是 Skill 维护源；`plugins/paper-collage-video/` 中的 Skill 和轻量工作区是生成的发行副本，不应单独修改。完整开发与提交要求见 [CONTRIBUTING.md](CONTRIBUTING.md)，发布流程见 [docs/releasing.md](docs/releasing.md)。

当前 CI 在 Ubuntu 上运行，维护者同时在 macOS 上验证。Windows 已做路径适配，但尚未纳入 CI，属于尽力支持。

## 支持、安全与许可

- 使用问题和支持边界：[SUPPORT.md](SUPPORT.md)
- 安全漏洞私密报告：[SECURITY.md](SECURITY.md)
- 第三方依赖与许可证：[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)

源码、脚本、Schema、模板、测试和文档采用 [MIT License](LICENSE)。测试夹具、纸张纹理、演示媒体及其衍生产物不采用 MIT，只能按照 [ASSET_LICENSES.md](ASSET_LICENSES.md) 规定的范围使用。

本项目依赖 Remotion；部分公司使用场景可能需要购买 Remotion Company License。项目自身许可证不会替代 Remotion、FFmpeg、React、Sharp、NumPy、Pillow、外部生成服务或其他第三方组件的条款。
