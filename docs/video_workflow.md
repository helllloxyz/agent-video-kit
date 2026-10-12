# 视频任务详细流程

本文件负责执行步骤、环境和交付规格，表达与风格按 [视频 Prompt](video_prompt.md)。视频任务先读取这两份文件；任务范围按根目录 `AGENTS.md`，所有命令和资源路径相对于仓库根目录。脚本参数见 [脚本接口](video_engine.md)。

## 接收音频模型的产物

1. 读取任务目录、`manifest.json` 和 `音频交接.md`，找到原稿、TTS 稿、各段音频、同次字幕及时间轴。`manifest.json` 缺少 `decodedDurationMs` 或 `headings` 时，运行 `python3 tools/audio_handoff.py outputs/<任务>` 补齐（只读取已有产物，不调用配音接口）。已有音频直接复用；明确要求配音但尚无音频时，按 [音频流程](audio_workflow.md) 准备或接收交接。
2. 画面与公式以原始讲稿为准，即使 TTS 读法有误也不改变原式；配音使用已有音轨。
3. `alignment/` 仅记录原稿与 TTS 文本的对应，不含音频时间。服务字幕有句子级音频时间，句内位置按朗读字符插值，属于估算。

## 环境与技术

- 使用 Node.js 20+ 与 npm；共享依赖位于 `.local-deps/video`（`@napi-rs/canvas`、`ffmpeg-static`），首次在仓库根执行 `npm ci --prefix .local-deps/video`，按锁文件安装当前平台依赖及 FFmpeg。仓库渲染脚本直接加载共享依赖，各任务无需复制引擎或软链 `node_modules`，也不需要全局 FFmpeg。
- macOS 支持时优先使用 `h264_videotoolbox`，不可用时检测并使用实际可用的 H.264 编码器，如 `libx264`；不假定一定有硬件编码器。Agent 沙箱内硬件编码器可能初始化失败，用 `--encoder libx264` 即可，17 分钟成片在 Apple Silicon 上约需 2.5 分钟。
- 按名称检测已安装字体，中文优先 Hiragino Sans GB / Noto Sans CJK SC，公式优先 STIX；缺失时安装开放字体 Noto Sans CJK 与 DejaVu 或 STIX，或按 [脚本接口](video_engine.md#绘图与字体) 指定字体文件。字体不随仓库分发，不依赖固定系统路径；记录实际选择并检查字符覆盖。
- 任务代码放在本次 `video/src/`：`scenes.mjs` 写分镜表（句子范围、节拍、过渡），按章节拆分绘图代码（如 `ch_*.mjs`），本片共用的配色、字号和反复出现的图形放 `style.mjs`，封面放 `cover.mjs`。通用能力（新图标、公式命令、工具参数）回补到 `tools/video_engine/` 并补测试，不在任务里复制引擎。环境缺项时报告，不改全局配置。

## 视频制作

有配音时按以下顺序，每步产物都留在 `video/` 下，返修时可从任一步接续：

1. **准备时间轴**：`node tools/video_engine/prepare.mjs --job outputs/<任务>`，得到 `prepared/` 下的整条音轨、句子时间轴、章节和字幕。检查 `timeline.json` 的 `warnings` 与 `spokenFallbackFormulas`，抽查 `sentences.md` 的公式还原。
2. **分镜表**：按视频 Prompt 写 `video/分镜表.md`（时间范围与来源｜原稿段落｜问题｜对象｜动作与公式｜保留结论｜准确性风险），全片统一配色、对象和反复出现的意象；时间用 `sentences.md` 的句子编号。
3. **代表镜头**：先实现一两个典型镜头（如核心推导、带动态的对比），`stills --scene N` 出静帧、联系表，再用 `sample --audio` 截 30–60 秒带声片段，确认风格、字号、节拍与语音同步后再铺开。
4. **全片静帧**：逐章实现，`info` 校验分镜连续覆盖，`stills` 全量出图，逐镜头查看最后一个节拍及有过渡的节拍，检查文字与公式重叠、出界、字幕区遮挡（内容不低于 `SAFE.bottom`）和公式与原稿一致。
5. **成片与封面**：`full --audio prepared/audio.flac` 渲染，`cover` 出两张封面，`check.mjs` 抽帧复查时长、音视频流与章节，记录在 `video/制作说明.md`。

其他情形：

- 多段音频不能直接拼接每段从零开始的时间轴；`prepare.mjs` 已按实测时长累加偏移。仅有音频没有服务字幕时，先检查可用的转写/对齐工具；估算时间须注明，不为补时间轴重新合成。
- 无配音时制作无声视频与烧录字幕，用 `lines` 模式按约 4.6 字/秒安排阅读时间。

## 交付与限制

默认输出到当前任务目录下新的 `video/`，保留已有文本、音频和历史成片：

- 成片 `film.mp4`：1920×1080，30fps，内嵌章节，烧录字幕。
- 字幕 `字幕.srt`；`章节.txt`，可直接用于视频简介。
- 封面两张：`cover_16x9.png` 和 `cover_4x3.png`。
- `src/` 渲染代码、`分镜表.md`、`prepared/` 时间轴、`preview/` 静帧与样片、`check/` 抽帧检查、`制作说明.md`（运行命令、依赖、检查结果和已知限制）。

如实说明未完成的试听、渲染、同步或检查。长任务保存进度供其他模型接续，不发布或对外发送。
