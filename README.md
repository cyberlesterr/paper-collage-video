# 长安入梦 · Remotion 纸片分层动画

一个可直接预览和渲染的 30 秒 Remotion 示例。它复刻的是“先拆透明图层，再用代码驱动景深”的工作流，而不是照搬原推文的素材。

## 运行

```bash
npm install
npm run dev
```

在 Remotion Studio 中选择 `Tang-Paper-Cutout`。渲染视频：

```bash
npm run render
```

快速渲染 960×540 的完整时间线预览：

```bash
npm run render:preview
```

只渲染代表帧：

```bash
npm run render:frame
```

## 图层结构

所有素材都在 `public/layers/`，每个 PNG 是一张 1920×1080 的透明画布：

1. `sky.png`：满画布背景
2. `mountains-back.png`：远景山脉
3. `clouds.png`：云带
4. `mountains-mid.png`：中景山脉
5. `palace.png`：长安城楼
6. `traveler.png`：骑马人物
7. `foreground.png`：前景草木与树枝

仓库也保留了同名 SVG 源文件。修改源文件后运行 `npm run assets:rasterize`，即可并行生成渲染速度更快的 PNG；视频时间线默认读取 PNG。

图层的深度、入场时间和基础位移集中在 `src/TangPaperCutout.tsx` 的 `LAYERS` 数组中。`depth` 越大，镜头移动时的视差越明显。

## 换成自己的 PNG 素材

- 保持每张素材的画布尺寸、原点和构图一致。
- 导出带透明通道的 PNG 或 WebP，不要逐层裁掉透明边缘。
- 把新素材放入 `public/layers/`，然后修改 `LAYERS` 中的 `source`。
- 远景使用较小的 `depth`（约 0.15–0.35），人物和近景使用较大的值（约 0.65–1）。
- 不要给每层都加同样幅度的缩放；那会重新变成“整张图一起动”。

## 可配置参数

在 Remotion Studio 的输入参数中可以修改：

- `title`：片尾中文标题
- `subtitle`：英文副标题
- `accent`：印章和强调色
- `showLayerLabels`：打开图层深度调试标签

## 为什么这个流程可行

Remotion 会按帧确定性地计算 React 样式，所以视差、缓动、片头和片尾在预览与最终渲染中保持一致。这个方案适合 10–60 秒的短片、诗词视觉化、历史故事和产品风格片。成片质量主要取决于素材拆层、遮挡关系和镜头节奏，而不是动画 API 的数量。
