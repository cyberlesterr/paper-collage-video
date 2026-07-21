# 人机协作工作流

人负责意图、审美、事实/权利判断和外部发布授权。Codex 负责编剧、分镜、素材管理、动画和技术导演；本地脚本负责确定性状态、构建与质检。

## 默认用户路径

```text
主题
→ 概念 + 节奏故事板 + 时长/幕数 + 制作档位/预算 + provider（一次确认）
→ 风格样张 + 虚构音色（一次确认）
→ 自动批量生产、质检和预览
→ 预览批准或修改（一次确认）
→ 正式渲染并完成本地交付
```

外部上传、发送或发布不属于默认制作路径，只在用户实际请求时进行一次针对目标动作的授权。

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
→ complete
```

`brief` 和 `concept-review` 由组合确认命令一次完成。

## 1. 组合概念与 provider 确认

新项目位于 `capability-review`。Codex 只用当前宿主模型准备临时 brief/概念，不调用未确认的外部或付费 provider。

它执行一次精简 provider 检查，按四种时长/幕数输入模式完成计划，并选择：

- `draft`：低成本迭代，强复用，景深只用于关键场景；
- `balanced`：默认，逐幕背景、共享角色、少数重点地点独立景深；
- `full-depth`：完整视差和更多姿态，图片预算最高。

计划完成后，Codex 先用 `project:storyboard` 锁定全片叙事弧、逐幕蓝图、三个以上节拍、组合模式/关系和带可见断言的证明时刻。它不增加审批次数，而是与叙事、事实、制作档位/图片预算和 text/image/voice provider 一起由人一次确认。`project:confirm-concept` 批量写入 provider 选择并记录 `capabilities-ready`、`brief-ready`、`approve-concept`，直接进入 `style-review`。

## 2. 风格与虚构音色确认

只生成一张代表性样张和足够判断的短试听。样张生图前先把人物身份、复杂拓扑、功能机构和说明图分类并锁定通用语义契约；宿主生图预留真实尝试额度。新的关键运动语言或耦合拓扑在同一节点附一段 3–5 秒真实 v4 组合 proof。证明包同时包含原分辨率关系裁切、逐成员 alpha、棋盘格孤立图、紧裁图和相对位移 stress sheet；拓扑相关语义检查必须引用这些证据。`approve-style-voice` 会拒绝缺失、过期或仍待审核的耦合证明，但不会增加第四个人工等待节点。人批准且证明通过后进入批量生产；真人声音克隆需要单独的授权与合法参考材料。

## 3. 批量生产与质量门

素材按地点、人物组、旁白组或质检批次记录 checkpoint，不为每个小文件重复写状态。每个生成/导入输出仍保留独立 request 和 provider provenance。

生成时遵守概念批准的图片尝试预算；废稿、质量拒绝和生成后放弃的结果在发生额度消耗时同样计数。持续接触或共享边界的素材先生成一个完整母版，再从同一注册源家族派生前后遮挡、主体、上下环境带和 mask；不得分别生成后靠 z-index 拼接，也不得用粗多边形抠人物、动物等复杂轮廓。没有可靠分割能力时保留完整母版整体运动。角色 generation family 与图层 source family 独立。图片质量逐文件绑定 SHA-256 和语义契约指纹，组合质量绑定成员、变换、边界、cue、证明和语义目标。

组装后先运行 `project:composition-proof`，检查真实渲染的全帧、关系裁切、跨场景人物比较、机构受力链和说明图原分辨率裁切，再用 `project:quality record-batch` 记录组合语义检查。说明图 SVG 的程序噪声滤镜由运行时确定性拒绝。这个内部证据步骤不增加第四个人工门。

素材完成后只运行：

```bash
npm run project:assets-ready -- <slug>
```

该命令依次同步真实旁白时长、生成/导入字幕时间、核对故事板蓝图/v4 组合/关键帧/cue、核验组合证明指纹、执行资产与组合双质量门并推进到 `preview`。随后 `project:preview` 渲染半尺寸预览、技术报告和证明时刻联系表。

## 4. 预览、修改与正式交付

人查看预览并批准或用自然语言提出修改。修改会回到 `asset-production`，只重做受影响的批次和 hash 失效素材。

预览批准后运行 `project:render`。正式 MP4、报告、联系表和校验报告通过后，状态直接进入 `complete`。这只表示本地制作完成，不授权任何外部发布。

## 恢复与控制

每个新回合或中断后只运行一次：

```bash
npm run project:resume -- <slug>
```

- `auto-continue`：继续 `nextCommand` 或第一个未完成批次；
- `wait-human`：展示当前门禁产物、原因和明确回复方式；
- `complete`：报告本地交付产物。

不再同时运行 full status 和 `project:handoff-check`。只有诊断异常状态时才读取完整历史。

## 状态与来源边界

- `brief.md`：人的意图、事实、风格、格式和权利边界；
- `production.json`：阶段、审批、粗粒度批次、产物、事件历史；
- `storyboard.json`：已批准的叙事弧、节拍、组合关系、蓝图和证明断言；
- `project.json`：制作计划和 Remotion v4 递归组合执行树；
- `requests/*.json` / `assets-manifest.json`：逐素材输入、组合绑定与注册源家族；
- `quality-report.json`：逐文件和组合关系的技术/语义质量与指纹；
- `review.md`：自动审批摘要与自然语言修改历史。

这些文件各自只维护一种事实，避免在多个上下文中重复完整状态、请求或 provenance。

## 必须额外停下的情况

- 会改变核心立场、目标受众或已批准的制作档位/成本；
- 明确时长与幕数无法同时满足；
- provider 失效且切换服务会改变费用或授权；
- 需要真人克隆、品牌/肖像或授权不明素材；
- 准备上传、发送或发布到具体外部目标。
