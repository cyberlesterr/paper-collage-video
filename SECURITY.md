# Security Policy

## Supported Versions

正式 Release 之后，仅最新的 minor 版本会获得安全修复。当前 `0.4.x` 仍属于首个公开发行准备阶段；`main` 上已确认的问题会优先修复并进入下一个 Release。

| Version | Supported |
|---|---|
| `0.4.x` | Yes |
| `< 0.4` | No |

## Reporting a Vulnerability

请不要通过公开 Issue 披露漏洞、密钥、可利用细节或真实用户数据。

优先使用仓库的 [Private vulnerability reporting](https://github.com/cyberlesterr/paper-collage-video/security/advisories/new) 提交报告。报告中请包含：

- 受影响版本或 commit；
- 最小复现步骤；
- 实际和预期行为；
- 可能影响；
- 已知的缓解措施。

维护者会尽力在 7 天内确认收到报告，并在确认影响后协调修复和披露时间。请在修复发布前避免公开利用细节。

## Security Boundaries

- `providers.local.json` 和 API key 必须保留在本机；仓库配置只记录环境变量名。
- `command` provider 会执行用户显式配置的本地程序。只使用你信任的适配器和工作目录。
- 项目不会自动上传或发布成片；外部 provider 会受到其自身隐私政策和服务条款约束。
- 素材、提示词、旁白和生产状态可能包含敏感内容，公开提交前必须人工检查。
