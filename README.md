# Paper Collage Video Pipeline

[![CI](https://github.com/cyberlesterr/paper-collage-video/actions/workflows/ci.yml/badge.svg)](https://github.com/cyberlesterr/paper-collage-video/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

一个配置驱动的本地纸片分层视频生产系统。人负责内容意图、审美选择和最终批准；Codex 与本地工具负责文案拆镜、素材组织、抠图、动画、旁白同步、渲染和技术验收。

仓库中的 `tie-chu-mo-zhen` 已按 v2 协议从空项目重新开始，不继承旧素材、旧 provider 选择或旧审批。插件发行包另带一个 2 秒低电平测试音技术夹具 `starter-demo`，仅用于自动化烟雾测试。

当前公开预览版本为 `0.4.0`，仓库正在开发 `0.5.0` 的质量门与 Motion/Depth 协议；功能和协议仍可能在 `1.0.0` 前调整。

## 从 GitHub 安装 Plugin

面向普通用户的推荐路径是安装 Codex Plugin，不需要手动 clone 本仓库。仓库包含机器可读的 marketplace、插件清单、Skill、工作区初始化器和轻量 Remotion 模板。

用户可以直接把 GitHub 地址交给 Codex：

```text
请安装这个 Codex 插件并完成初始化验证：
https://github.com/cyberlesterr/paper-collage-video
```

Codex 对应执行：

```bash
codex plugin marketplace add cyberlesterr/paper-collage-video
codex plugin add paper-collage-video@paper-collage-video
```

安装后新建一个 Codex 任务，再说：

```text
用 $make-paper-collage-video 做一条约 30 秒的玄奘西行纸片分层视频。
```

首次调用会从插件自带模板创建独立、可写的 Remotion 工作区，安装依赖并运行环境诊断。项目、依赖和渲染结果不会写入 Codex 的插件缓存。用户可能仍需批准依赖下载、FFmpeg 安装或图片/语音提供方授权。

源码采用 [MIT License](LICENSE)。测试夹具、纸张纹理和其衍生媒体不采用 MIT，只能按 [ASSET_LICENSES.md](ASSET_LICENSES.md) 随仓库运行、测试和演示。

### 本地开发安装演练

仓库维护者可以从本地 marketplace 安装同一个插件：

```bash
npm run plugin:sync
codex plugin marketplace add /absolute/path/to/paper-collage-video
codex plugin add paper-collage-video@paper-collage-video
```

修改插件后重新运行 `npm run plugin:sync` 和插件校验，再按本地插件更新流程刷新缓存。插件源位于 `plugins/paper-collage-video/`；`skills/make-paper-collage-video/` 是制作流程的维护源，`plugin:sync` 会把它和轻量运行时同步到发行包。

## 最简单的用法

在 Codex 中直接说：

```text
用 $make-paper-collage-video 做一条约 30 秒的玄奘西行纸片分层视频。
```

Skill 的维护源位于 `skills/make-paper-collage-video/`，发行副本位于插件包中。它会先检测当前宿主真实可用的文本、生图和虚构语音能力，用一次表单（没有表单能力时改用聊天）让人确认或选择自定义服务；随后只在概念、风格/虚构音色、预览和发布四个创意/发布节点停下来让人决定。其他阶段标记为 `AUTO-CONTINUE`，单次工具调用结束不等于任务暂停。中断后再次调用同一个 Skill，它会先读取 `production.json` 和逐项工作清单，从当前阶段继续。

## 人在流程中的位置

正常制作一条新视频时，人先做一次可复用的能力确认，再参与四个内容节点：

1. 确认是否使用检测到的文本、生图和虚构语音能力，或选择自己的服务/手工导入。
2. 填写或口述 `brief.md`：主题、受众、平台、核心观点、风格和禁区。
3. 确认文案、镜头、风格样张和虚构旁白音色。
4. 查看 `preview.mp4`，用自然语言提出修改意见。
5. 查看最终视频和验收报告，作出发布批准。

人不需要手写人物坐标、处理透明通道、计算旁白帧数、修改 React 或执行 FFmpeg。`project.json` 是 Codex 和工具维护的机器协议。

完整的人机边界和审批节点见 [docs/workflow.md](docs/workflow.md)。

## 环境

- Node.js 20+
- FFmpeg / ffprobe
- Python 3.11+（只在处理色键素材表时需要）

当前 CI 在 Ubuntu、Node.js 20 和 Python 3.12 上运行；维护者同时在 macOS 上验证。代码包含 Windows 命令与虚拟环境路径适配，但尚未加入 Windows CI，因此当前属于尽力支持。

```bash
npm ci
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm run doctor -- --ready
npm run provider:status
```

Windows 使用 `.venv\\Scripts\\python.exe -m pip install -r requirements.txt`。

## 开发验证

```bash
npm test
npm run check
npm run bundle
npm run doctor -- --ready
```

`npm run dev` 打开不依赖任何生产项目的通用 Remotion 占位 composition。实际项目必须按 Skill 的状态机完成 provider、概念、风格/虚构音色和素材质量门后才能预览或正式渲染。

## 创建新项目

```bash
npm run project:new -- silk-road --title="玄奘西行"
```

这会创建：

```text
projects/silk-road/
  assets-manifest.json
  brief.md
  production.json
  project.json
  prompts.json
  providers.json
  quality-report.json
  requests/
  review.md

public/projects/silk-road/
  assets/style/
  assets/plates/
  assets/environment/rear/
  assets/environment/mid/
  assets/environment/foreground/
  assets/characters/source/
  assets/characters/alpha/
  audio/narration/
  audio/music/
  audio/sfx/
```

新项目先处于 `capability-review`：Codex 检测当前宿主能力并让人确认三类 provider；全部选择落盘后才进入 `brief`。随后由人填写或口述 `brief.md`。时长和幕数可以任选其一、同时指定或都不指定；Codex 保留明确值，只根据故事节拍和旁白估时补全缺失项，并通过 `project:plan` 写入 `project.json`。`production.json` 记录阶段、审批和产物。可以用 `--dry-run` 预览将创建的路径而不写文件：

```bash
npm run project:new -- silk-road --title="玄奘西行" --dry-run
```

## 项目命令

| 命令 | 作用 |
|---|---|
| `npm run project:new -- <slug>` | 创建人类简报、机器配置和素材目录 |
| `npm run project:plan -- <slug> ...` | 保留用户指定的时长/幕数，并补全未指定项 |
| `npm run project:status -- <slug>` | 显示当前阶段、审批、产物和下一步 |
| `npm run project:status -- <slug> --compact-json` | 输出不含冗长历史的机器可读控制信息 |
| `npm run provider:status -- <slug>` | 合并并检查文本、生图、语音 provider 配置 |
| `npm run provider:select -- <slug> <capability> <provider-id>` | 记录人确认的 provider、作用域和宿主工具 |
| `npm run provider:run -- --request=<file>` | 运行用户配置的命令适配器并登记资产来源 |
| `npm run provider:record -- --request=<file>` | 登记宿主工具或手工导入的本地输出 |
| `npm run provider:reuse -- --request=<file>` | 按 provider/model/输入指纹复用哈希有效的已有资产 |
| `npm run project:handoff-check -- <slug>` | 在回合结束前阻止 `AUTO-CONTINUE` 阶段被误当成人工停点 |
| `npm run project:checkpoint -- <slug> <id> <status>` | 记录素材、旁白、校验或渲染工作项的可恢复进度 |
| `npm run project:review-sync -- <slug>` | 从生产状态重新生成 `review.md` 的审批摘要 |
| `npm run project:advance -- <slug> <action>` | 记录明确的审批或确定性阶段完成事件 |
| `npm run project:assets-ready -- <slug>` | 校验素材并将状态从素材生产推进到预览 |
| `npm run project:sync -- <slug>` | 用 ffprobe 把真实旁白时长写回项目配置 |
| `npm run project:subtitles -- <slug>` | 优先使用时间戳 sidecar，否则按标点和阅读长度生成字幕时间 |
| `npm run project:quality -- <slug> <action>` | 准备、查看或记录与文件哈希绑定的图像质量检查 |
| `npm run project:validate -- <slug>` | 检查配置、素材、透明通道、色键残边、字幕和时长 |
| `npm run project:preview -- <slug>` | 校验后渲染 50% 预览，并生成报告 |
| `npm run project:render -- <slug>` | 校验后渲染正式成片，并生成报告 |
| `npm run project:report -- <slug>` | 对已有成片生成技术报告和关键帧联系表 |
| `npm run style:proof -- <slug> --input=<图片>` | 从唯一风格样片生成 3–5 秒蒙版视差与局部动作证明 |
| `npm run doctor -- --ready` | 检查 Node、FFmpeg、ffprobe、npm 和 Python 图像依赖 |
| `npm run plugin:sync` | 从维护源重新生成插件 Skill 和轻量 Remotion 工作区模板 |
| `npm run dev` | 在 Remotion Studio 中打开通用开发 composition |
| `npm test` | 运行生产状态、静默工具恢复和记录同步回归测试 |
| `npm run check` | TypeScript 类型检查 |

`project:preview` 和 `project:render` 都遵循 fail-fast：素材或配置存在错误时不会开始昂贵渲染；警告会写入报告但不阻塞。

新项目还会受到门控：文本、生图、语音 provider 未确认时不能进入简报；概念和风格/虚构音色未确认时不能渲染预览，预览未获人工批准时不能渲染正式成片。完整动作表见 [docs/workflow.md](docs/workflow.md)。

涉及人工决定的动作必须带 `--note="人的原话或明确结论"`；这样中断恢复时不会把技术通过误认为创意或发布批准。

## 自定义文本、生图和语音服务

工作区默认使用当前 Codex 宿主提供的文本、生图和虚构语音能力，不绑定厂商。配置按以下顺序深度合并：

1. `providers.json`：可共享的工作区默认值；
2. `providers.local.json`：本机覆盖，已加入 `.gitignore`；
3. `projects/<slug>/providers.json`：单项目覆盖。

Skill 不会只根据名称猜测能力存在：它先检查当前宿主的实际工具/Skill 元数据，再把检测到的候选、已有配置、手工导入和“我自己提供这个能力”放进一次确认表单。选择通过 `provider:select` 持久化；恢复任务时只要已选宿主工具仍存在，就不重复询问。

复制 `providers.local.example.json` 为 `providers.local.json`，即可把任意 CLI、SDK 包装脚本或私有 API 接到 `command` adapter。配置只保存 `requiredEnv` 的变量名，API key 仍放在环境变量中。异步服务由用户的 adapter 自行提交和轮询；稳定接口是“读取请求 JSON、写入指定输出、退出码为 0”。

每次输出都通过 `provider:run` 或 `provider:record` 写入 `assets-manifest.json`，记录 provider、模型/任务 id、请求指纹、SHA-256、大小、时间和请求快照。相同 provider、模型、输入和设置可以先用 `provider:reuse` 复用；图像仍需在当前项目通过质量检查。完整契约见 [Provider Configuration](skills/make-paper-collage-video/references/providers.md)。

## 角色素材表处理

一条命令完成四宫格拆分、软蒙版、通用去色键溢色和透明 PNG 输出。色键可自动从边框采样，也可以显式指定；选用服装中没有的高饱和颜色，不必固定为绿色：

```bash
npm run assets:process-sheet -- \
  public/projects/my-project/assets/characters/source/scene-sheet-green.png \
  public/projects/my-project/assets/characters/source \
  public/projects/my-project/assets/characters/alpha \
  scene 4 \
  --columns=2 \
  --key-color=auto \
  --matte-erode=1 \
  --names=emperor,maid-left,maid-right,officials
```

底层脚本仍可独立使用：

```bash
python3 scripts/split_sheet.py INPUT OUTPUT_DIR PREFIX COUNT --columns 2
python3 scripts/remove_chroma_key.py --input KEY.png --out ALPHA.png --key-color=auto --matte-erode=1 --force
```

## 项目协议

项目配置遵循 [schemas/project.schema.json](schemas/project.schema.json)。核心结构包括：

- `video`：宽高和帧率。
- `quality`：强制质量门使用的最低素材分辨率比例。
- `theme`：纸张、字幕、描边和前景颜色。
- `voice`：虚构音色或后续可选的克隆音色元数据。
- `audio`：背景音乐、角色音效和必填 LUFS/true-peak 交付规格。
- `scenes`：背景、环境景深层、镜头 keyframe、旁白、角色 motion、动作音效、转场和字幕。

镜头时长不是人工填写的常量，而是：

```text
round(旁白开始秒数 × fps) + ceil(真实旁白秒数 × fps) + ceil(尾部留白秒数 × fps)
```

后一个镜头按该镜头显式声明的 `transition.durationSeconds` 与前一个镜头交叠。项目作者只写秒数；帧数由渲染器根据 fps 推导。v1 字段不会被迁移或猜测。

生产状态遵循 [schemas/production.schema.json](schemas/production.schema.json)。它是断点恢复协议，不是创意配置：记录 `stage`、一次能力配置门禁、四个审批、逐项工作进度、已生成产物和追加式事件历史。审批与能力确认完成事件应通过 `project:advance` 记录，工作进度应通过 `project:checkpoint` 记录，不直接改 JSON。

`project:status` 会把阶段标为 `AUTO-CONTINUE`、`WAIT-HUMAN` 或 `COMPLETE`。只有 `WAIT-HUMAN` 可以作为正常的人机暂停点；`AUTO-CONTINUE` 阶段若发生真实阻塞，必须报告确切错误和需要的人为动作，不能以空白响应结束。

## 验收

`project:validate` 检查：

- 项目协议、slug、视频规格和唯一 id。
- 背景、人物、旁白、音乐、音效和纸张纹理是否存在。
- 人物 PNG 是否真的有透明区域。
- 按透明像素推断真实色键，检查可见半透明边缘是否仍有对应溢色。
- 背景宽高比是否与视频接近。
- 背景像素是否达到输出规格；同一素材在一次校验中只解码一次。
- 旁白配置时长是否等于 ffprobe 实测时长。
- 字幕范围、重叠、越界、单条长度和阅读速度。
- 每幕是否有 primary 主体，人物是否完全跑出画布。

`project:quality` 对实际使用的背景、环境层、角色、人物表和样张建立技术检查与语义检查；文件哈希变化会自动使旧审查失效。`project:report` 继续检查成片编码、分辨率、帧率、音轨、音量峰值、集成 LUFS 和 true peak，并以受控并发按场景前/后段生成最多八帧联系表。

## 当前重建项目

`projects/tie-chu-mo-zhen` 是用当前 v2 模板新建的空项目，目前停在 `capability-review`。它只保存新的项目骨架，不包含旧版故事稿、生成请求、人物图、背景、旁白、预览或历史批准。确认本次使用的文本、生图和虚构语音能力后，再由 Skill 从概念阶段重新制作。

## 贡献、支持与安全

- 参与开发前阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。
- 使用问题和支持边界见 [SUPPORT.md](SUPPORT.md)。
- 漏洞请按 [SECURITY.md](SECURITY.md) 私密报告，不要创建公开 Issue。
- 社区参与需要遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。
- 版本变化记录在 [CHANGELOG.md](CHANGELOG.md)。
- 维护者发布新版本时遵循 [docs/releasing.md](docs/releasing.md)。

## 许可与第三方条款

源码、脚本、Schema、模板、测试和文档采用 [MIT License](LICENSE)。仓库技术夹具、纸张纹理及其衍生媒体明确排除在 MIT 之外，只授予随本仓库或插件运行、测试、评审和演示所必需的有限权限；不得抽取为素材包、用于其他作品或商业产品、训练模型、再许可或出售。详见 [ASSET_LICENSES.md](ASSET_LICENSES.md)。

本项目依赖 Remotion，其特殊许可证在部分公司使用场景下要求购买 Company License。项目自己的许可证不会修改或替代 Remotion、FFmpeg、React、Sharp、NumPy、Pillow、外部生成服务或其他第三方组件的条款。详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
