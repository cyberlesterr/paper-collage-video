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

## Codex 黑盒实测 20 条缺陷（2026-08-20 · 已完成）

来源：`/Users/lester/Desktop/Remotion/projects/lang-lai-le-final/process-friction-log.md`（F-001…F-022，独立 agent 只读文档跑完整流程，**在概念确认门彻底卡死**）。计划：`~/.claude/plans/glowing-dazzling-stearns.md`。用户定：枚举单源化、20 条全修、不做旧项目兼容。

- [x] WP-A 词汇表单源化（F-012/F-013/F-010）：新建 `production-vocabulary.mjs` 一张表两视图（`SOURCE_PACKAGE_STRATEGIES` → `LAYER_SOURCE_STRATEGIES`/`STRATEGY_COSTS`）；planning/execution/container 三处重复定义全部收敛；schema 枚举与模块导出加漂移断言；scenario 门新增可执行 preset 校验（原 10 个规划 preset 只有 2 个可执行）；`localDerivatives` 与 `avoidedCalls` 统一计入姿态母版家族
- [x] WP-B 重建 storyboard scaffold（F-012）：按 `routeForChangeClass` 真实路由表重写；枚举槽位填合法默认值 + 清单列出待复核项，只有自由文本留 `TODO(author)`；state-sequence 双拍播放（establish 初态 + action 变化态）满足"至少两态且从 at=0 开始"；每拍保底 treatment；id 加场景前缀；`editorial.sceneDirecting` 自动生成；分层包用 `parallax-camera` 同时满足视差下限与 `maxContinuousTargets`
- [x] WP-C canonical 导出与 scaffold（F-015/F-020/F-022）：`project:storyboard --json` 输出 `directingSummary` + canonical `sourcePackageDecision`；新建 `selection-scaffold-lib.mjs` 支撑 `project:confirm-concept --scaffold`（只留 note 与 providerId 两处人工位）
- [x] WP-D 契约对齐与逐项报错（F-006/F-008）：`assertSourcePackageDecision`/`assertScenarioDecision` 改按值比较（键序无关）+ 逐字段 expected/received + 点名多余字段；scenario 校验改为 `collectIssues`/`throwCollected` 一次报全（原为首错即停，Codex 因此猜了 15 轮）
- [x] WP-E 流程闭环（F-016/F-017/F-018）：`--replace-unconfirmed-plan` 零消费前提下事务性清除未获批 motion contract 与派生产物，使文档要求的回退路径真正可执行；`assertStoryboardMatchesScenario` 前移到 storyboard 编译；`project:plan --scenario` 重选同档位幂等，不刷时间戳
- [x] WP-F CLI 人机工程（F-001/F-003/F-005）：新建 `cli-help-lib.mjs`，22 个命令 `--help` 打印用法并 exit 0；bootstrap 忽略 `.DS_Store` 等系统元数据并列出真正阻塞条目；`project:new` 缺 `--title=` 时显式提示
- [x] WP-G 能力证明与措辞（F-002/F-004/F-011/F-014）：host provider 缺 `outputAcquisition` 时 readiness 直接标注"确认前必须先证明能返回本地文件或公开下载地址，否则降级 command/manual"；`project-contract.md` 写明 Creative Plan 内嵌于 `project.json` 且 `sourcePackageDecision` 是 4 键投影；`setup.md` 说明依赖审计告警不是生产门、禁止擅自 `npm audit fix`
- [x] WP-H 文档同步：SKILL.md 第 4/6 步改为 `--title=` 与 `--scaffold` 路径；`story-planning.md` 去掉 `--json re-displays` 误导并说明幂等与单源词汇表；`approval-gates.md` 新增「Recording the Combined Concept Decision」
- [x] WP-I 端到端往返测试：新建 `tests/authoring-roundtrip.test.mjs` 复刻"不读 schema 只用命令输出"的边界，跑通 scenarios→plan→storyboard→confirm-concept 四门；另加按值比较/多余字段报错、bootstrap 元数据、`--help` exit 0 回归
- [x] 验证：tsc 通过；354/354 测试全绿（348 + 6 新增/重写）；`plugin:sync` 已分发、副本一致；真实项目（《狼来了》5 幕）脚手架生成 42 个 treatment、128 处待填散文并**编译通过**，对比 Codex 手写 1872 行

不属本 skill：F-019（人工批量改错）、F-021（ChatCut MCP 下载路径）。
