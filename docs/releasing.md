# Release Guide

本文件是维护者的正式公开发行清单。任何 Release 都必须来自通过 CI 的干净 commit；技术校验不能替代代码、素材和发布授权确认。

## 1. Confirm Scope and Rights

- 确认本次版本号，并同步 `package.json`、插件清单、bootstrap marker 和模板版本。
- 确认根目录存在正式 `LICENSE`，插件和 bootstrap 工作区会携带许可证副本。
- 检查 `ASSET_LICENSES.md`，确认新增图片、声音、音乐、字体和纹理均有来源与再分发策略。
- 检查 `THIRD_PARTY_NOTICES.md` 与当前 Remotion 版本和许可证相符。
- 检查 Git 状态，确认没有本机 provider 配置、密钥、私人提示词、未授权素材或生成产物。

## 2. Rebuild the Distribution Copy

```bash
npm ci
npm run plugin:sync
npm test
npm run check
npm run doctor -- --ready
npm run bundle
npm audit --audit-level=moderate
git diff --check
```

确认插件模板可以在独立临时目录初始化，并至少完成一次 `starter-demo` 预览。CI 会执行同等烟雾测试。

## 3. Review Release Metadata

- 更新 `CHANGELOG.md`，把目标版本从 `Unreleased` 移到带日期的版本段。
- README 中的安装命令、版本、支持平台和已知限制必须准确。
- 所有相对 Markdown 链接都应有效。
- GitHub 仓库应配置 description、topics、Issues、Private vulnerability reporting、Dependabot、CodeQL 和默认分支保护。
- `main` 必须要求 `Verify plugin and Remotion workspace / verify` 通过后才能合并。

## 4. Merge and Verify CI

将发行准备改动通过 Pull Request 合并到 `main`。不要在 CI 红色时创建 tag。

```bash
git fetch origin
git switch main
git pull --ff-only
git status --short
```

确认工作树干净、`main` 与远端一致，并在 GitHub Actions 页面确认目标 commit 的验证任务全部通过。

## 5. Create the Release

```bash
git tag -a v0.8.0 -m "Paper Collage Video v0.8.0"
git push origin v0.8.0
```

标签会触发 `Publish GitHub Release` 工作流。工作流会从该标签重新验证源码、测试、类型和 Remotion bundle，然后创建正式 Release。生产项目及其预览不再作为发布构建依赖，也不会自动上传媒体、provider 凭据、本机配置或权属未确认的素材。

只有本次版本明确批准了新的最终演示成片时，才在工作流成功后上传一份人工媒体附件。例如：

```bash
cp dist/tie-chu-mo-zhen/final.mp4 \
  dist/tie-chu-mo-zhen/tie-chu-mo-zhen-final.mp4
gh release upload <tag> \
  'dist/tie-chu-mo-zhen/tie-chu-mo-zhen-final.mp4#Tie Chu Mo Zhen final demo (MP4)'
```

同一个 Release 最多保留一份仓库演示媒体；不要追加预览、动作证明、联系表、源素材或 provider 产物。没有新的媒体发布授权时保持零附件。演示媒体不采用 MIT，受 `ASSET_LICENSES.md` 的 repository-demo-only 条款约束。

## 6. Post-Release Verification

- 从公开 GitHub URL 执行一次全新插件安装。
- 在新任务中调用 `$make-paper-collage-video`，确认 workspace bootstrap、doctor 和 starter preview 正常。
- 确认 Release、tag、README badge、许可证识别和安装命令均可公开访问。
- 为新版本创建一个最小测试项目，确认中断恢复和人工审批门禁仍按预期工作。
- 将结果记录到 Release notes；失败时修复后发布 patch 版本，不要移动已有公共 tag。
