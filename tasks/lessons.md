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
