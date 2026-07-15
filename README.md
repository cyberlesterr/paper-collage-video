# 唐朝纸片分层动画 · Remotion 复刻项目

这是按教程原文重新搭建的本地视频流水线第一版：两张无人物背景底板、两张角色素材表、八个独立透明角色图层、两段虚构旁白、逐句字幕、背景氛围与分级入场音效，最后由 Remotion 渲染为约 29.8 秒视频。

Remotion Studio 中有两个 composition：

- `Tang-Collage-Replica`：按原文工作流重做的正式第一版。
- `Tang-Paper-Cutout-Prototype`：此前用于验证视差机制的单镜头原型，保留作对照。

## 运行与渲染

```bash
npm install
npm run dev
```

渲染 1920×1080 正式版：

```bash
npm run render
```

渲染 960×540 的完整快速预览：

```bash
npm run render:preview
```

渲染代表帧：

```bash
npm run render:frame
```

类型检查：

```bash
npm run check
```

## 第一版流水线

```text
两镜头文案
→ Imagegen 生成无人物背景底板
→ Imagegen 生成 2×2 绿幕角色素材表
→ Python + Pillow + NumPy 拆表
→ 绿幕去除、软边与去绿溢色
→ Remotion 静态排版、层级和错峰入场
→ 虚构 TTS 旁白驱动镜头与字幕时长
→ 背景氛围、impact / whoosh / tick 音效
→ Remotion 渲染
→ FFmpeg / ffprobe 抽帧与技术验收
```

## 目录结构

```text
src/script.json                 文案、镜头、字幕、人物坐标和时长
src/ReplicaChapterScene.tsx     角色入场、图层遮挡、推镜、字幕和音效
src/MainVideo.tsx               两幕时间线、旁白和背景氛围
src/roleMotion.ts               primary / secondary / tertiary 动画参数
scripts/split_sheet.py          把规则角色素材表拆成独立图片
public/assets/plates/            两张无人物背景底板
public/assets/characters/source/ 绿幕素材表和拆分后的绿幕单体
public/assets/characters/alpha/  八个独立透明 PNG
public/audio/narration/          两段旁白
public/audio/music/              背景氛围
public/audio/sfx/                入场音效
```

## 镜头和角色层级

全景镜头以皇帝为 `primary`，两名侍女为 `secondary`，右侧群臣为 `tertiary`。特写镜头以捧礼盒使者为 `primary`，两名前排跪拜人物为 `secondary`，后排侍从为 `tertiary`。

三类角色沿用教程中的动画强度：

```ts
primary:   {distance: 78, rise: 55, startScale: 0.86}
secondary: {distance: 58, rise: 38, startScale: 0.90}
tertiary:  {distance: 38, rise: 22, startScale: 0.95}
```

人物没有同时出现，而是按“主角 → 配角 → 群像”建立画面。入场结束后保留约 1–2 像素的呼吸漂浮，背景则只做约 1.6% 的慢推镜。

## 旁白方案

第一版不需要参考录音，也不做声音克隆。旁白使用虚构音色：

- 提供方：豆包 TTS
- 音色：`儒雅逸辰（ruyayichen）`
- 语速：`speedRatio 0.94`
- 音高：`pitch -1`
- 风格：温润儒雅、克制、有文化纪录片的历史纵深感

两段生成音频的实测长度分别是 12.360 秒和 16.176 秒。`src/script.json` 的镜头与字幕以这两个真实时长为依据。声音克隆被明确留作后续优化，不是第一版的运行依赖。

## 素材生成原则

背景提示词要求“无人物、无文字、留出角色站位区”；角色提示词要求“唐代服饰、完整人物、明确朝向、古籍线描与复古纸片拼贴、白色剪纸描边、纯绿背景、无场景和水印”。两张角色素材表都采用四宫格，拆分后再做软蒙版和去绿溢色。

如果替换角色素材，请保持以下约束：

- 主角最大，配角次之，后排群像最小。
- 每张 PNG 只承担一个叙事角色或一个紧密人物组。
- 朝向必须服务于场景关系；左右人物应看向画面中心。
- 头、手、脚、衣摆与关键道具不可裁切。
- `z`、`delay`、`x`、`bottom`、`width` 全部集中在 `src/script.json`，先静态排版，再调整动画。

## 验收重点

- 两幕是否都有背景、后排、主体和前景层。
- 主角是否明显大于配角，且脸、手和礼盒不被遮挡。
- 透明 PNG 是否存在绿边、破洞或半透明污染。
- 角色是否错峰进入，音效是否落在入场帧。
- 字幕是否与旁白段落一致，并避开人物脚部和礼盒。
- 输出是否为 30 fps、包含视频流和混合后的音频流。
