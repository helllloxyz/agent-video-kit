# 视频渲染脚本接口

`tools/video_engine/` 提供通用画布、公式排版、配音时间轴准备、分镜时间计算、静帧、视频编码和成片抽检工具。Agent 只编写任务分镜与绘图代码，直接调用仓库脚本；共享依赖配置见 [视频流程](video_workflow.md#环境与技术)。

| 脚本 | 作用 |
| --- | --- |
| `prepare.mjs` | 读取音频交接的 `manifest.json`，拼接整条音轨，生成全片句子时间轴、章节和烧录字幕 |
| `story.mjs` | 分镜按句子编号写起止和节拍，换算为绝对秒数并校验覆盖 |
| `render.mjs` | `info`、`stills`、`sample`、`full`、`cover` 五种模式 |
| `sheet.mjs` | 静帧联系表 |
| `check.mjs` | 成片时长、音视频流、章节检查和抽帧联系表 |
| `captions.mjs` | 字幕切分、原稿公式还原（由 `prepare.mjs` 调用） |
| `lib.mjs`、`art.mjs` | 绘图、公式排版、图标与示意图 |

## 有配音时：准备时间轴

音频交接完成（`manifest.json` 含各段 `decodedDurationMs`，可由 `python3 tools/audio_handoff.py <任务目录>` 生成）后运行：

```bash
node tools/video_engine/prepare.mjs --job outputs/<任务>
```

默认输出到 `<任务>/video/prepared/`：

- `audio.flac`：按顺序拼接的整条音轨，长度与各段实测时长之和核对（±0.1 秒）。
- `timeline.json`：全片句子 `sentences[{id, part, start, end, spoken, text, chapter}]`、烧录字幕 `captions`、章节 `chapters`（顶层 `##` 标题）、小节 `sections`（`###`）、警告。
- `sentences.md`：按章节列出句子编号、时间和字幕文字，编写分镜时查表。

句子时间来自 MiniMax 同次字幕，多段按实际时长累加偏移。字幕默认 `--captions source`：用 alignment 把读法还原为原稿公式（如“A 竖线 C”显示为 `A|C`），过长公式（默认显示宽度超过 30）回退为朗读文字并在 `spokenFallbackFormulas` 中列出；`--captions spoken` 直接用朗读文字。`--caption-width 24` 控制每条字幕的显示宽度（ASCII 计 0.55），切分优先在标点处，长句均分，不在英文单词中间断开。

## 分镜接口

每个 `scenes.mjs` 导出非空数组 `scenes`。有配音时用 `story.mjs` 按句子编号写分镜：

```javascript
import {loadPrepared} from '../../../../tools/video_engine/story.mjs';
import {drawMath, drawText} from '../../../../tools/video_engine/lib.mjs';

const P = loadPrepared(new URL('../prepared/timeline.json', import.meta.url));
export const scenes = P.scenes([
  {from: 1, to: 4, beats: [1, 2, [3, '关键词'], [4, 0.5]], draw(ctx, T) {
    drawText(ctx, '核心概念', 960, 250, {size: 60, alpha: Math.min(1, Math.max(0, T.b(1)))});
  }},
  {from: 5, to: 9, beats: [5, 7], fadeIn: 0, draw(ctx, T) { /* … */ }},
]);
export const captions = P.captions;
export const duration = P.duration;
```

- `from`/`to` 是 `sentences.md` 中的句子编号。场景须连续覆盖全部句子且不跨章节，边界取相邻两句间隙的中点，首场景从 0 开始，末场景到音轨结束。章节标签自动取句子所在章节。
- 节拍可写句子编号（句首）、`[编号, '句中短语']`（按朗读字符插值到短语开头）或 `[编号, 0.4]`（句中比例）。句中位置属于估算。节拍须严格递增。
- 可选 `fadeIn`/`fadeOut`（秒，默认 0.5/0.6，0 表示直切，同一章节连续镜头建议直切）；`label: false` 隐藏左上章节标签，或给字符串覆盖。
- `T.t` 是场景内秒数，`T.dur` 场景时长，`T.abs` 全片秒数，`T.b(i)` 是距第 i 个节拍的秒数，未到时为负，超出节拍数时为 `-Infinity`。
- 导出 `cover(ctx, {width, height})` 时，`render.mjs cover` 输出 16:9（1920×1080）和 4:3（1440×1080）两张封面，绘图需按 `width` 居中。

无配音时可沿用 `lines` 模式：场景给 `chapter` 和 `lines: ['句子', ['需要停留的句子', 1]]`，按阅读速度估算时间并烧录字幕，结果标注 `reading_speed_estimate`；两种模式不能混用。

## 调用

在仓库根运行，路径也可改为绝对路径。先用通用示例检查环境：

```bash
node tools/video_engine/render.mjs info --scenes tools/video_engine/example.scenes.mjs --output-dir outputs/本次任务/video
```

制作任务时：

```bash
S=outputs/<任务>/video/src/scenes.mjs; O=outputs/<任务>/video
node tools/video_engine/render.mjs info   --scenes $S --output-dir $O/preview
node tools/video_engine/render.mjs stills --scenes $S --output-dir $O/preview --scene 3-6 --overwrite
node tools/video_engine/sheet.mjs --input-dir $O/preview/stills --output-file $O/preview/sheets/s03.png --prefix s03 --cols 4 --overwrite
node tools/video_engine/render.mjs sample --scenes $S --output-dir $O/preview --start 558 --duration 45 --audio $O/prepared/audio.flac --overwrite
node tools/video_engine/render.mjs full   --scenes $S --output-dir $O --audio $O/prepared/audio.flac
node tools/video_engine/render.mjs cover  --scenes $S --output-dir $O
node tools/video_engine/check.mjs --video $O/film.mp4 --output-dir $O/check --count 24
```

- `info` 返回 JSON（含实际字体、场景数、总时长），不写文件，可用来校验分镜覆盖。
- `stills` 在 `<输出目录>/stills/` 下按每个节拍输出 `sNN_bMM.png`，另写 `stills-info.json`；`--scene 3` 或 `--scene 3-6` 只渲染指定镜头。
- `sample` 输出 `sample.mp4`，可带音轨检查同步；`full` 输出 `film.mp4`、`字幕.srt`、`章节.txt`、`chapters.ffmeta`、`render-info.json`，烧录字幕，音频编码为 AAC 160k。
- `check.mjs` 用 `--count N` 均匀抽帧或 `--times 12,80.5` 指定时刻，输出 `frames/`、`frames-sheet.png` 和 `check.json`（时长、视频/音频流、章节）。
- 默认 1920×1080、30fps，自动探测编码器；`--encoder auto|libx264|h264_videotoolbox`。在受限沙箱中 `h264_videotoolbox` 可能无法初始化，此时用 `--encoder libx264`。已有文件默认拒绝覆盖，返修时显式 `--overwrite` 或换目录。

## 绘图与字体

- `lib.mjs`：配色 `C`、尺寸 `W/H`、安全区 `SAFE`（左右上 96px，内容底线 940，字幕区从 968 开始）、文字/公式、缓动、线段、箭头、曲线和数轴。
- `art.mjs`：卡片、图标（骰子、硬币、云、风、船、眼睛、闪电、开关）、集合图、矩形分区、树图和数轴。
- 简易公式排版是 TeX 子集：上下标、分数、根号、上划线、`\mid`、常用关系符与希腊字母、`\Longrightarrow`、`\big`/`\Big`/`\bigg`/`\Bigg` 定界符、`\c{颜色}{…}`、`\t{文字}`、`\op{算子}`、`\m{标记}{…}`；斜体后接直立字符时自动补斜体间距。`\left`/`\right` 被忽略。多行 `\begin{aligned}…\end{aligned}` 用 `drawAligned(ctx, src, x, y, {size, lineHeight, progs, alphas})` 绘制，按 `&` 对齐，返回每行边界供加框或标注；`drawMath` 遇到 `\begin` 会报错。不支持的命令同样报错，需改写为受支持写法。
- 字体优先级见视频流程。按名称检测 macOS、Linux、Windows 的常见字体，不使用固定系统路径。可用 `VIDEO_FONT_CJK`、`VIDEO_FONT_MATH`、`VIDEO_FONT_MATH_ITALIC`、`VIDEO_FONT_SYMBOL` 指定字体文件；这些配置仅保存在使用者的环境中。信息 JSON 的 `fonts` 记录实际字体；若 `Hei` 显示 `source: "fallback"`，需安装或指定中文字体后再制作中文视频。

## 验证

```bash
node --test tests/video_engine.test.mjs
```

测试覆盖时间轴与章节合并、字幕切分和公式还原、分镜句子换算、公式排版、参数校验和本地短片渲染，不访问配音接口；渲染测试需要已安装共享依赖。实际任务仍按视频流程检查静帧、成片和章节覆盖。
