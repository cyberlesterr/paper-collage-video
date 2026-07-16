# Paper Collage Video Pipeline

一个配置驱动的本地纸片分层视频生产系统。人负责内容意图、审美选择和最终批准；Codex 与本地工具负责文案拆镜、素材组织、抠图、动画、旁白同步、渲染和技术验收。

仓库自带 `tang-demo` 黄金样例，它是回归基准，不是引擎里的硬编码题材。

## 从 GitHub 安装 Plugin

面向普通用户的推荐路径是安装 Codex Plugin，不需要手动 clone 本仓库。仓库包含机器可读的 marketplace、插件清单、Skill、工作区初始化器和轻量 Remotion 模板。

用户可以直接把 GitHub 地址交给 Codex：

```text
请安装这个 Codex 插件并完成初始化验证：
https://github.com/<github-owner>/<repository>
```

Codex 对应执行：

```bash
codex plugin marketplace add <github-owner>/<repository>
codex plugin add paper-collage-video@paper-collage-video
```

安装后新建一个 Codex 任务，再说：

```text
用 $make-paper-collage-video 做一条约 30 秒的玄奘西行纸片分层视频。
```

首次调用会从插件自带模板创建独立、可写的 Remotion 工作区，安装依赖并运行环境诊断。项目、依赖和渲染结果不会写入 Codex 的插件缓存。用户可能仍需批准依赖下载、FFmpeg 安装或图片/语音提供方授权。

当前仓库尚未配置真实 GitHub owner、公开许可证和正式 release；发布前必须补齐这些发行元数据。

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

Skill 的维护源位于 `skills/make-paper-collage-video/`，发行副本位于插件包中。它会从工作区初始化和简报开始，自动维护项目文件和生产状态，只在概念、风格/虚构音色、预览和发布四个节点停下来让人决定。其他阶段标记为 `AUTO-CONTINUE`，单次工具调用结束不等于任务暂停。中断后再次调用同一个 Skill，它会先读取 `production.json` 和逐项工作清单，从当前阶段继续。

## 人在流程中的位置

正常制作一条新视频时，人只需要参与四次：

1. 填写或口述 `brief.md`：主题、受众、平台、核心观点、风格和禁区。
2. 确认文案、镜头、风格样张和虚构旁白音色。
3. 查看 `preview.mp4`，用自然语言提出修改意见。
4. 查看最终视频和验收报告，作出发布批准。

人不需要手写人物坐标、处理透明通道、计算旁白帧数、修改 React 或执行 FFmpeg。`project.json` 是 Codex 和工具维护的机器协议。

完整的人机边界和审批节点见 [docs/workflow.md](docs/workflow.md)。

## 环境

- Node.js 20+
- FFmpeg / ffprobe
- Python 3.11+（只在处理绿幕素材表时需要）

```bash
npm install
python3 -m pip install -r requirements.txt
npm run doctor -- --ready
```

## 跑通黄金样例

```bash
npm run project:sync -- tang-demo
npm run project:validate -- tang-demo
npm run project:preview -- tang-demo
```

输出位于：

```text
dist/tang-demo/
  preview.mp4
  validation-report.json
  report.json
  contact-sheet.jpg
  frames/
```

正式渲染：

```bash
npm run project:render -- tang-demo
```

输出 `dist/tang-demo/final.mp4`，并重新生成验收报告和关键帧联系表。

## 创建新项目

```bash
npm run project:new -- silk-road --title="玄奘西行"
```

这会创建：

```text
projects/silk-road/
  brief.md
  production.json
  project.json
  prompts.json
  review.md

public/projects/silk-road/
  assets/plates/
  assets/characters/source/
  assets/characters/alpha/
  audio/narration/
  audio/music/
  audio/sfx/
```

接下来由人填写或口述 `brief.md`，Codex 根据简报维护 `project.json`、提示词和素材；`production.json` 记录阶段、审批和产物。可以用 `--dry-run` 预览将创建的路径而不写文件：

```bash
npm run project:new -- silk-road --title="玄奘西行" --dry-run
```

## 项目命令

| 命令 | 作用 |
|---|---|
| `npm run project:new -- <slug>` | 创建人类简报、机器配置和素材目录 |
| `npm run project:status -- <slug>` | 显示当前阶段、审批、产物和下一步 |
| `npm run project:status -- <slug> --control-json` | 输出机器可读的 `auto-continue` / `wait-human` 控制信息 |
| `npm run project:handoff-check -- <slug>` | 在回合结束前阻止 `AUTO-CONTINUE` 阶段被误当成人工停点 |
| `npm run project:checkpoint -- <slug> <id> <status>` | 记录素材、旁白、校验或渲染工作项的可恢复进度 |
| `npm run project:review-sync -- <slug>` | 从生产状态重新生成 `review.md` 的审批摘要 |
| `npm run project:advance -- <slug> <action>` | 记录明确的审批或确定性阶段完成事件 |
| `npm run project:sync -- <slug>` | 用 ffprobe 把真实旁白时长写回项目配置 |
| `npm run project:validate -- <slug>` | 检查配置、素材、透明通道、绿边、字幕和时长 |
| `npm run project:preview -- <slug>` | 校验后渲染 50% 预览，并生成报告 |
| `npm run project:render -- <slug>` | 校验后渲染正式成片，并生成报告 |
| `npm run project:report -- <slug>` | 对已有成片生成技术报告和关键帧联系表 |
| `npm run doctor -- --ready` | 检查 Node、FFmpeg、ffprobe、npm 和 Python 图像依赖 |
| `npm run plugin:sync` | 从维护源重新生成插件 Skill 和轻量 Remotion 工作区模板 |
| `npm run dev` | 在 Remotion Studio 中打开黄金样例 |
| `npm test` | 运行生产状态、静默工具恢复和记录同步回归测试 |
| `npm run check` | TypeScript 类型检查 |

`project:preview` 和 `project:render` 都遵循 fail-fast：素材或配置存在错误时不会开始昂贵渲染；警告会写入报告但不阻塞。

新项目还会受到审批门控：概念和风格/虚构音色未确认时不能渲染预览，预览未获人工批准时不能渲染正式成片。完整动作表见 [docs/workflow.md](docs/workflow.md)。

涉及人工决定的动作必须带 `--note="人的原话或明确结论"`；这样中断恢复时不会把技术通过误认为创意或发布批准。

## 角色素材表处理

一条命令完成四宫格拆分、软蒙版、去绿溢色和透明 PNG 输出：

```bash
PYTHON_BIN=python3 npm run assets:process-sheet -- \
  public/projects/my-project/assets/characters/source/scene-sheet-green.png \
  public/projects/my-project/assets/characters/source \
  public/projects/my-project/assets/characters/alpha \
  scene 4 \
  --columns=2 \
  --names=emperor,maid-left,maid-right,officials
```

底层脚本仍可独立使用：

```bash
python3 scripts/split_sheet.py INPUT OUTPUT_DIR PREFIX COUNT --columns 2
python3 scripts/remove_chroma_key.py --input GREEN.png --out ALPHA.png --force
```

## 项目协议

项目配置遵循 [schemas/project.schema.json](schemas/project.schema.json)。核心结构包括：

- `video`：宽高、帧率和镜头重叠帧数。
- `theme`：纸张、字幕、描边和前景颜色。
- `voice`：虚构音色或后续可选的克隆音色元数据。
- `audio`：背景音乐和三类角色音效。
- `scenes`：背景、旁白、角色图层和字幕。

镜头时长不是人工填写的常量，而是：

```text
旁白开始帧 + ceil(真实旁白秒数 × fps) + 尾部留白帧
```

后一个镜头从前一个镜头结束前 `transitionFrames` 帧开始，以形成交叠转场。

生产状态遵循 [schemas/production.schema.json](schemas/production.schema.json)。它是断点恢复协议，不是创意配置：记录 `stage`、四个审批、逐项工作进度、已生成产物和追加式事件历史。审批应通过 `project:advance` 记录，工作进度应通过 `project:checkpoint` 记录，不直接改 JSON。

`project:status` 会把阶段标为 `AUTO-CONTINUE`、`WAIT-HUMAN` 或 `COMPLETE`。只有 `WAIT-HUMAN` 可以作为正常的人机暂停点；`AUTO-CONTINUE` 阶段若发生真实阻塞，必须报告确切错误和需要的人为动作，不能以空白响应结束。

## 验收

`project:validate` 检查：

- 项目协议、slug、视频规格和唯一 id。
- 背景、人物、旁白、音乐、音效和纸张纹理是否存在。
- 人物 PNG 是否真的有透明区域。
- 半透明边缘是否疑似存在绿溢色。
- 背景宽高比是否与视频接近。
- 旁白配置时长是否等于 ffprobe 实测时长。
- 字幕范围、重叠和越界。
- 每幕是否有 primary 主体，人物是否完全跑出画布。

`project:report` 继续检查成片编码、分辨率、帧率、音轨、音量峰值，并生成三帧联系表供人做最终视觉判断。

## 黄金样例

`projects/tang-demo` 保存简报、机器配置、提示词和验收记录；素材位于 `public/projects/tang-demo`。虚构旁白为“儒雅逸辰（ruyayichen）”，声音克隆不是 P0 的依赖。

此前的单镜头视差实验仍保留为 Remotion composition `Tang-Paper-Cutout-Prototype`，通用引擎 composition 为 `Paper-Collage`。
