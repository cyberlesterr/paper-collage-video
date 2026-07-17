# Contributing

感谢你愿意改进 Paper Collage Video。这个仓库同时维护源码工作区、Codex Plugin 和插件内置的轻量 Remotion 模板；提交改动时需要保持三者同步。

## 开始之前

- 先搜索已有 Issue，避免重复工作。
- 修复明确缺陷可以直接提交 Pull Request；较大的功能、协议或工作流变更请先开 Issue 讨论。
- 不要提交 API key、访问令牌、真人声音样本、未授权素材或包含个人信息的生产文件。
- 使用 AI 或外部服务生成的媒体必须记录来源，并确认服务条款允许本项目需要的使用和分发方式。

## 本地环境

需要 Node.js 20+、FFmpeg/ffprobe 和 Python 3.11+。

```bash
npm ci
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm run doctor -- --ready
```

Windows 虚拟环境中的 Python 路径为 `.venv\\Scripts\\python.exe`。

## 修改与生成文件

维护源位于：

- `src/`、`scripts/`、`schemas/`、`templates/`
- `skills/make-paper-collage-video/`
- 根目录的依赖和配置文件

`plugins/paper-collage-video/skills/` 与 `plugins/paper-collage-video/assets/remotion-template/` 是生成的发行副本。修改维护源后运行：

```bash
npm run plugin:sync
```

请勿只修改生成副本，否则下一次同步会覆盖这些变化。

## 提交前验证

```bash
npm test
npm run check
npm run doctor -- --ready
npm run project:validate -- tie-chu-mo-zhen
npm run plugin:sync
git diff --exit-code
```

涉及渲染、时间线或媒体处理的修改，还应至少跑一次轻量预览。不要把 `dist/`、`out/`、`build/` 或本机 provider 配置提交到仓库。

## Pull Request 要求

- 说明问题、解决方式和用户可见影响。
- 列出实际运行的验证命令。
- 对状态机、JSON Schema 或插件协议变更补充测试和迁移说明。
- 对新增素材说明来源、生成工具、授权状态和可再分发范围。
- 保持一次 PR 聚焦一个主题。

提交贡献即表示你有权提交相关代码和素材，并同意代码按
[MIT License](LICENSE) 分发。媒体不自动采用 MIT；请在
[ASSET_LICENSES.md](ASSET_LICENSES.md) 中记录明确授权范围。
