# Lessons

## 2026-08-18 · 自带测试全绿不能证明代码没问题

- **纠正来源**：用户指出"你不能用它已经有的测试来判断它的代码是否有问题"。
- **模式**：项目自带测试只固化作者意图；设计层缺陷（如把人工创作反馈计入熔断）会被测试**保护**而非暴露。本仓库当时 339 测试全绿，但 `visual-blueprint-circuit.test.mjs` 恰恰断言了"两次人工退回即死锁"这一有问题的行为。
- **规则**：审查代码质量时，测试运行结果只作为"运行时未损坏"的基线信号；bug 结论必须来自源码阅读 + 真实运行证据（本仓库为 `projects/*/skill-friction-log.md` 与 `production-metrics.json`）的交叉验证。发现"测试固化的错误行为"时，修复方案必须同时重写对应测试。

## 2026-08-18 · 修改 JSON 配置文件禁用 Python round-trip 重写

- **模式**：用 `json.load` + `json.dump` 改一个字段会重排整个文件格式（缩进/内联对象展开），产生 199 行噪音 diff，违反手术式修改原则。
- **规则**：对已有 JSON/配置文件永远用精准文本编辑（Edit 工具锚定原文），不用解析-序列化回写；批量脚本改动后立即 `git diff --stat` 检查 diff 是否与意图成比例。

## 2026-08-18 · 本仓库改运行时脚本的固定收尾链

- **模式**：`scripts/` 与 `skills/` 是源，`plugins/paper-collage-video/` 是打包产物；新增脚本文件必须同时登记到 `sync-plugin-package.mjs` 的拷贝清单和 `runtime-surface-scope.test.mjs` 的静态闭包断言，否则打包一致性测试失败。
- **规则**：任何 `scripts/*.mjs` / `skills/**` 改动后按序执行：`npm run check` → `npm test` → `npm run plugin:sync` → 复跑受影响测试；SKILL.md 含被 `plugin-package.test.mjs` 断言的语义锚点短语（如 "post-completion audit event"），精简文档前先 grep 测试中的字面断言。

## 2026-08-20 · 生成器必须由"消费者接受产物"的往返测试守护

- **纠正来源**：Codex 黑盒实测（`process-friction-log.md` F-012）发现我上一轮交付的 `project:storyboard-scaffold` 生成的骨架**根本无法编译**——写了枚举里不存在的 `state-replacement`/`local-motion`，state-sequence 缺六个必填字段，action/settle 两拍 treatments 为空，treatment id 跨场重复。
- **模式**：我当时的测试只断言"生成物字段齐全、标记存在、数量正确"——全部是**生成器自比**。生成器唯一真实的契约是"产物能被下游消费者接受"，自比测试永远测不到这一点，还会给出虚假的安全感。
- **规则**：任何生成器（scaffold/模板/导出）必须有一条往返测试：生成 → 机械填充占位 → **交给真实消费者**（编译器/校验器/下游命令）→ 断言零 issue。没有这条测试的生成器视为未验证。附带：占位标记只能放在自由文本槽位；枚举槽位必须填合法默认值并在清单里列出待复核项，否则产物结构性不可用。

## 2026-08-20 · 手写输入面的契约必须可从命令获得

- **模式**：`sourcePackageDecision` 的真值只存在于 `storyboard.json` 内部，且只取 `generationBudget` 的 4 键投影；`project:storyboard` 当时连 `--json` 都没有，报错只说"必须一致"。Codex 机械复制整个 budget（8 键）4 次全失败后彻底放弃，**整条流水线卡死、视频没做出来**——而他那 4 个被比较的值全是对的。
- **规则**：凡是要求 agent 手写 JSON 去匹配机器计算值的门禁，必须同时具备三件事：(1) 有命令能打印 canonical 值或整份 scaffold；(2) 比较按值而非序列化（键序无关）；(3) 报错逐字段打印 expected/received 并指出多余字段。缺任何一件，正确答案就是不可达的。
- **附带**：规划期词汇表与执行期词汇表必须单源。两者独立定义时（本仓库 preset 枚举只有 2/10 交集），方案能通过规划门却在编译期全部推倒重来。
