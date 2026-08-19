# make-paper-collage-video Skill 优化（2026-08-18 · 已完成）

计划详情：`~/.claude/plans/glowing-dazzling-stearns.md`。目标：消灭流程自锁、杜绝付费后拒绝、修复已知 bug、收敛重复代码、精简文档；不动人审门/预算帽/真实质量检查；保留包装命令级熔断；不做旧项目兼容。

- [x] WP6.1 新建 `scripts/contract-utils.mjs`（stableValue/stableStringify/sha256Value/sha256Text/sha256File/parseCliValue）
- [x] WP1 人工退回与熔断解耦（revise 不再记失败；approve 不再查熔断；`assertExecutionRevisedAfterRejection` 本地守卫"退回后未修改不得重渲"；新蓝图写入时清理过期回执）
- [x] WP2 生图账本与熔断解耦（reserve 改为账本原生"同指纹已计费拒绝"检查；abandoned/failed-before-generation 未计费关闭不再阻止重试；预算帽仍是唯一花钱闸门）
- [x] WP3 providers.json `nativeCanvas` 一次性声明（schema + 默认 host-image + example；`verifyOutputFile` 自动合成 provider-native 政策，画布不匹配从"付费后拒绝"变为"登记观察 + 零调用归一化"）
- [x] WP4 F062：`mergeCompositeProofReports` 合并全部匹配证明报告的 proofFrames/temporalEvidence/assetEvidence
- [x] WP5 回执：`humanReviewReceiptFingerprint` 改排序哈希（key 顺序无关）；16 合 1 报错拆为逐项 issues；新增 `project:visual-review make-receipt` 代算全部哈希
- [x] WP6 冗余收敛：15 处 stableValue（3 变体）+ 22 处 valueFor 全部改共享 import；failure-circuit：OPERATIONAL_FILES 补 `quality-review-scaffold.reviewed.json`、有内容哈希的文本文件不再计 mtime、签名兜底用脱敏后末 3 行、脱敏逻辑合并为 scrubFailureLine
- [x] WP7 SKILL.md 250→135 行（修复双"12"编号；机制细节下沉 references；保留全部命令/门禁/唯一居所规则）；execution-control.md 熔断章节、providers.md nativeCanvas、approval-gates.md make-receipt 同步
- [x] 测试：重写 attempts 熔断用例与 circuit 用例（改为包装命令语义）；新增 F062 合并、nativeCanvas 观察、revise 守卫、回执乱序指纹 4 组回归；runtime 闭包清单 + 打包清单补 contract-utils
- [x] 验证：`npm run check`（tsc）通过；`npm test` 342/342 全绿（原 339 + 3 新回归）；`plugin:sync` 已分发且 skills/ 与 plugin 副本一致；无 fixture 残留

## 后续候选（2026-08-19 · 第二轮已完成）

- [x] T1 storyboard 脚手架生成器：`project:storyboard-scaffold` 从已批准 scenario 生成 schema-v12 骨架（真实项目冒烟：手写负担从 1692 行降为 24 个 `TODO(author)` 创意字段 + 空间合同义务清单）；`project:storyboard` 拒绝残留标记
- [x] T2 素材批次接触表人审前移：`project:quality scaffold --assets/--scene` 生成 `reviewScope=batch` 子集脚手架（独立 batch 接触表目录），早审逐资产记录直接计入最终审；可选非阻塞，终审语义不变
- [x] T3 references 定向去重：源包成本模型从 4 个文档收敛到 layer-complete-assets.md 单源（story-planning/project-contract/motion-directing/providers 改为指针）；其余跨文档出现经核实为角色视图（授权/证据/登记/字段参考），非重复，保留
- [x] T4 friction 报告：`project:friction -- <slug> [--json|--output=]` 只读汇总付费浪费/熔断史/时间分布 + 候选改进模板（真实项目冒烟：即刻呈现 14 次调用 7 次被拒的完整清单）
- [x] 验证：tsc 通过；348/348 测试全绿（+6 新回归）；plugin:sync 已分发、副本一致；无 fixture 残留
