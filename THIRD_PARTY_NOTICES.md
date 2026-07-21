# Third-Party Notices

Paper Collage Video 使用多个独立维护的第三方组件。本文件提供重要提示，不替代各组件随包附带的完整许可证。

## Remotion

本项目固定使用 `remotion` 和 `@remotion/cli` `4.0.490`。Remotion 使用自己的特殊许可证，而不是 MIT、Apache-2.0 等常见开源许可证。

根据当前 Remotion 4 许可证，个人、非营利组织、员工不超过 3 人的营利组织以及非商业评估通常可以免费使用；不符合免费条件的营利组织需要购买 Company License。Remotion 还限制以销售、出租或再许可 Remotion 衍生产品为目的复制或修改 Remotion 本身。

使用者必须自行阅读并遵守 [Remotion License](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md)。本仓库自己的许可证不会覆盖、修改或替代 Remotion 的条款。

## JavaScript and Python Dependencies

React、TypeScript、Sharp、NumPy、Pillow 及其他传递依赖保留各自许可证。准确版本和 npm 包许可证元数据记录在 `package-lock.json`；Python 依赖范围记录在 `requirements.txt`。

## FFmpeg and Browser Runtime

FFmpeg/ffprobe 由使用者环境提供，其实际许可证取决于具体构建选项。Remotion 可能在首次渲染时下载兼容的 Chrome Headless Shell；该浏览器运行时受其自身条款约束。

## External Providers and Generated Outputs

文本、生图和语音 provider 不随本仓库提供。它们的模型、服务、输出权利、隐私政策和商业使用条件由对应服务商决定。资产清单中的 provider、模型和任务 id 只用于来源追踪，不代表项目维护者授予了额外权利。

仓库内示例媒体的有限使用范围另见 [ASSET_LICENSES.md](ASSET_LICENSES.md)。
