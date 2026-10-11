# 视频渲染脚本接口

`tools/video_engine/` 提供通用画布、公式排版、时间轴、静帧和视频编码工具。Agent 负责编写任务分镜，直接调用仓库脚本；共享依赖配置见 [视频流程](video_workflow.md#环境与技术)。

## 调用

在仓库根运行，路径也可改为绝对路径；脚本支持从其他工作目录调用。先用通用示例检查环境：

```bash
node tools/video_engine/render.mjs info --scenes tools/video_engine/example.scenes.mjs --output-dir outputs/本次任务/video
node tools/video_engine/render.mjs stills --scenes tools/video_engine/example.scenes.mjs --output-dir outputs/本次任务/video
node tools/video_engine/sheet.mjs --input-dir outputs/本次任务/video/stills --output-file outputs/本次任务/video/sheet.png
node tools/video_engine/render.mjs sample --scenes tools/video_engine/example.scenes.mjs --output-dir outputs/本次任务/video --start 0 --duration 2
node tools/video_engine/render.mjs full --scenes tools/video_engine/example.scenes.mjs --output-dir outputs/本次任务/video
```

制作实际视频时，将 `--scenes` 换为任务的 `video/src/scenes.mjs`。默认 1920×1080、30fps，自动探测可用编码器；可用 `--fps` 和 `--encoder auto|libx264|h264_videotoolbox` 调整。已有文件默认拒绝覆盖，返修时显式使用 `--overwrite` 或新目录。

`info` 返回 JSON，不写文件；`stills` 按每个动画节拍输出 PNG 和 `stills-info.json`；`sample` 输出 `sample.mp4`；`full` 输出 `film.mp4`、`字幕.srt`、`章节.txt`、`chapters.ffmeta` 和 `render-info.json`。联系表支持 `--prefix s01`、`--cols 3`。

## 分镜接口

每个 `scenes.mjs` 导出非空数组 `scenes`。任务文件位于默认 `outputs/<任务>/video/src/` 时，可这样复用绘图工具：

```javascript
import {drawMath, drawText} from '../../../../tools/video_engine/lib.mjs';

export const scenes = [{
  chapter: '章节标题',
  lines: ['本节要讲的话。', ['需要额外停留的句子。', 1]],
  draw(ctx, T) {
    drawText(ctx, '核心概念', 960, 250, {size: 60});
    drawMath(ctx, String.raw`f(x)=x^{2}`, 960, 500, {prog: Math.max(0, Math.min(1, T.b(0)))});
  },
}];
```

`T.t` 是场景内秒数，`T.dur` 是场景时长，`T.b(i)` 是距第 i 个节拍开始的秒数，未开始时为负数。`lines` 模式按阅读速度估算时间并烧录字幕，结果标注 `reading_speed_estimate`。

有配音时，每个场景显式给出 `start`、`end` 和可选 `beats`，都用整条音轨上的绝对秒数，不能与 `lines` 估算混用。另导出 `captions = [{start, end, text}]` 和可选总时长 `duration`；字幕与分镜时间来自已对齐的服务时间轴。MiniMax 毫秒值需除以 1000。通过 `--audio <音频文件>` 传入音轨；脚本检查分镜总时长与音频是否一致（容差 0.25 秒），再编码。

## 绘图与字体

- `lib.mjs`：配色 `C`、尺寸 `W/H`、文字/公式、缓动、线段、箭头、曲线和数轴。
- `art.mjs`：卡片、图标、集合图、矩形分区和树图；标签与数据由分镜提供。
- 简易公式排版支持上下标、分数、根号、上划线、条件竖线、常用关系符及 `\c{颜色}{…}`、`\t{文字}`、`\op{算子}`、`\m{标记}{…}`。这是 TeX 子集，不支持的命令会报错，需显式转换为受支持写法或接入其他排版工具。
- 字体优先级见视频流程。按名称检测 macOS、Linux、Windows 的常见字体，不使用固定系统路径。可用 `VIDEO_FONT_CJK`、`VIDEO_FONT_MATH`、`VIDEO_FONT_MATH_ITALIC`、`VIDEO_FONT_SYMBOL` 指定字体文件；这些配置仅保存在使用者的环境中。信息 JSON 的 `fonts` 记录实际字体名称、来源和注册结果；若 `Hei` 显示 `source: "fallback"`，需安装或指定中文字体后再制作中文视频，并通过静帧确认字符覆盖。

## 验证

```bash
node --test tests/video_engine.test.mjs
```

测试覆盖时间轴、字幕保留、参数校验和本地短片渲染，不访问配音接口；渲染测试需要已安装共享依赖。实际任务仍按视频流程检查静帧、成片和章节覆盖，并另行制作封面。
