# 人机协作工作流

## 角色定义

人是内容所有者、创意导演和最终验收人。Codex 是编剧助理、分镜师、素材管理员、动画执行和技术导演。本地脚本是确定性的构建与质检系统。

## 状态流转

```text
capability-review
→ brief
→ concept-review
→ style-review
→ asset-production
→ preview
→ human-review
→ final-render
→ publish-approval
```

### 0. capability-review

Codex 先读取 provider 配置，再检查当前宿主真正可调用的文本、生图和虚构语音工具。未确认的能力通过一次结构化表单交给人选择；没有表单能力时使用一条普通聊天消息。每类能力都可选择检测到的宿主工具、已配置服务、手工导入，或描述自己的服务。

选择由 `provider:select` 写入项目或经明确要求写入本机配置。表单与配置中不收集 API key。三类能力都确认且配置可用后记录 `capabilities-ready`，进入 `brief`。这是服务配置，不代表概念、批量生成、创意结果或发布获批。

### 1. brief

人提供：

- 主题、受众、平台和时长。
- 核心观点和期望情绪。
- 参考风格或允许 Codex 提案。
- 必须准确的事实、授权边界和禁止项。

系统产出：`projects/<slug>/brief.md`。完成后记录 `brief-ready`。

时长和幕数是两个独立的可选约束。人可以只指定时长、只指定幕数、同时指定，或都不指定。Codex 保留已指定的值，并根据叙事节拍、旁白估时和观看节奏只补全缺失项；缺失本身不会触发追问。补全结果通过 `project:plan` 写入 `project.json`，未完成时不能记录 `brief-ready`。

概念提案会分别标出“用户指定”和“Skill 推导”的值。实际旁白生成后仍由 `project:sync` 用媒体时长校准时间线；幕数必须符合已确认计划。时长明显偏离时，用户明确指定的目标会阻塞校验，Skill 推导的目标会产生待审警告。

文本、生图和语音能力由 `providers.json`、可选的本机 `providers.local.json` 与项目 `providers.json` 依次覆盖。进入本阶段前再次运行 `provider:status`；外部模型的输出通过请求文件和 `assets-manifest.json` 留下可复现记录。

### 2. concept-review

Codex 产出：

- 口播文案。
- 镜头和叙事层级。
- 背景、人物和前景素材清单。
- 风格方向与虚构旁白音色建议。

人只需确认“方向正确”或给出自然语言修改意见。未经确认，不生成创意素材和批量旁白。确认后记录 `approve-concept`。

### 3. style-review

Codex 只生成一张代表性风格样张；条件允许时同时提供一小段已配置虚构音色的试听。项目采用新的关键运动语言时，在同一门禁提供 3–5 秒 motion proof，不新增第五个人工门禁。人确认视觉方向、运动语言和虚构音色后记录 `approve-style-voice`，再进入批量素材生产。

### 4. asset-production

Codex 和工具负责：

- 生成无人物背景底板，以及真正需要视差的 rear/mid/foreground 独立环境层。
- 生成使用服装中未出现的高饱和色键人物素材表，不强制为绿色。
- 拆分、通用抠图、按真实键色去溢色和透明通道检查。
- 生成或导入虚构旁白。
- 用真实音频时长更新 `project.json`。
- 优先使用 provider/强制对齐时间戳，否则生成标点和阅读长度感知的字幕时间。
- 为镜头、角色动作、景深、转场和动作音效写入可配置 Motion/Depth 协议。

人只在涉及真人声音、品牌、肖像或外部版权素材时提供授权判断。

每个背景、人物素材表、旁白、透明图层、质量检查、时间线和校验步骤都使用 `project:checkpoint` 记录。生成前先尝试请求指纹缓存；缓存命中仍需进入当前项目的质量报告。内置图像生成产生的仅工具结果不能结束主流程；主流程继续处理下一工作项，并定期报告进度。

图片存在后运行 `project:quality prepare`。Codex 查看原尺寸资产，按类型记录无文字/水印、人物完整性、身份一致性、风格、安全区和边缘等语义检查。质量记录与文件 SHA-256 绑定，文件变化后自动回到待审。新项目默认 `required`，旧项目迁移前为 `advisory`。

全部素材通过确定性校验和要求的质量门后运行 `project:assets-ready -- <slug>`。校验或质量失败时状态不会进入预览。

### 5. preview

系统执行：

```bash
npm run project:preview -- <slug>
```

输出预览视频、技术校验、关键帧联系表。配置错误和缺失素材会在渲染前阻塞；成功后系统自动进入 `human-review`。

### 6. human-review

人查看预览，用自然语言描述问题，例如：

- 主角不够突出。
- 画面太喜庆，希望更克制。
- 第二幕进入得太快。
- 这句字幕挡住礼盒。
- 建筑年代看起来不对。

Codex 将意见翻译为文案、素材、层级、坐标、动画或音频调整，并记录到 `review.md`。人不直接维护机器参数。

通过时记录 `approve-preview`；要求修改时记录 `request-preview-revision`，状态回到素材生产并保留反馈历史。

### 7. final-render

系统执行：

```bash
npm run project:render -- <slug>
```

输出 `final.mp4`、`report.json` 和 `contact-sheet.jpg`，成功后系统自动进入 `publish-approval`。

### 8. publish-approval

技术报告只能证明文件和时间线正确。人仍需最终确认：

- 表达符合意图。
- 事实准确到可接受程度。
- 素材、声音和品牌使用有权发布。
- 作品符合平台和组织要求。

系统不会自动发布。

## 状态文件与命令

`projects/<slug>/production.json` 是断点恢复的机器记录。Codex 每次恢复任务先运行：

```bash
npm run project:status -- <slug> --compact-json
```

`control.mode` 的含义：

- `auto-continue`：无需人操作，继续下一命令或工作项，不得以“请继续”或空白响应结束。
- `wait-human`：展示本门禁产物、暂停原因和明确回复方式后等待。
- `complete`：报告完成；仍不得推断外部发布授权。

任何准备结束的回合还必须通过：

```bash
npm run project:handoff-check -- <slug>
```

`auto-continue` 阶段会返回非零状态并阻止正常交接。真实阻塞必须同时提供 `--blocker` 和 `--needs-user`，以保证用户能看到原因和唯一必要动作。

生产中的可恢复工作项通过以下命令记录：

```bash
npm run project:checkpoint -- <slug> <id> in-progress --label="工作项说明"
npm run project:checkpoint -- <slug> <id> completed --artifact="产物路径"
npm run project:checkpoint -- <slug> <id> blocked --note="确切阻塞原因"
```

外部或宿主生成输出另由 `provider:run` / `provider:record` 记录 provider、模型/任务 id、hash 和请求快照；它不替代生产状态，也不增加新的人工门禁。

审批和阶段完成事件通过以下命令记录：

```bash
npm run project:advance -- <slug> <action> --note="人的决定或验收说明"
```

允许的动作包括 `capabilities-ready`、`brief-ready`、`approve-concept`、`request-concept-revision`、`approve-style-voice`、`request-style-voice-revision`、`assets-ready`、`approve-preview`、`request-preview-revision` 和 `approve-publish`。预览与正式渲染成功事件由渲染命令自动记录。

审批状态只以 `production.json` 为准，并自动同步到 `review.md`。`brief.md` 不保存会过期的审批状态。

## 默认自治边界

在已确认的题材和风格范围内，Codex可以自主执行素材处理、代码修改、预览渲染和技术修复。以下情况必须停下来让人决定：

- 会改变作品核心立场或目标受众。
- 需要克隆真人声音或使用不明确授权的素材。
- 多个视觉方向会产生显著不同的品牌或叙事结果。
- 准备对外发布、上传或发送给第三方。
