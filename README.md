# Agent Video Kit

供 Codex、DeepSeek harness 等 agent 使用的讲稿、配音与科普视频辅助项目。根目录 [AGENTS.md](AGENTS.md) 保留音频与视频两部分的职责和路由；模型执行具体任务时，再按需加载 [音频详细流程](docs/audio_workflow.md) 或 [视频详细流程](docs/video_workflow.md) 及对应 Prompt。

讲稿检查与配音脚本仅使用 Python 3.9+ 标准库，无须启动网页或连接数据库。视频渲染使用 Node.js 20+ 与 npm，安装与字体配置见 [视频详细流程](docs/video_workflow.md)；默认画面为暖色深底、宋体正文、黑体字幕和直立公式，首次制作视频前在仓库根运行 `npm ci --prefix .local-deps/video` 与 `python3 tools/video_engine/setup_fonts.py`。

## 配置

克隆仓库并创建本地配置：

```bash
git clone https://github.com/helllloxyz/agent-video-kit.git
cd agent-video-kit
cp .env.example .env
```

在 `.env` 填写 `MINIMAX_API_KEY`。默认使用国内站接入地址；国际站账号还需设置 `MINIMAX_BASE_URL=https://api.minimax.io`。默认模型为 `speech-2.8-hd`，未指定音色时优先选择系统中文音色；可通过 `.env` 固定模型和音色。`.env` 与生成文件已被 `.gitignore` 排除。

## 交给 agent 使用

让 agent 在克隆目录工作并加载 [AGENTS.md](AGENTS.md)。Codex 可以直接打开该目录；其他 harness 若不自动读取该文件，需要将它加入项目指令，并提供 Python 脚本执行能力。

示例请求：

> /完整路径/讲稿.md

只给讲稿或路径时，默认完成章节拆分、朗读适配、纯脚本检查与字符串对齐、MiniMax 配音，按拆分段交付独立音频后停止，不拼接；无需重复说明步骤。明确要求“只转写”“先看文本”“暂不配音”时停在文本阶段。输出在独立的 `outputs/` 子目录中，保留原稿。视频由后续负责视频的模型接收任务清单和音频继续制作。

还可以请求：

> 用这份讲稿制作带配音的科普视频，完成文稿适配、配音、字幕同步和视频渲染。

> 用已有 MP3 和字幕制作视频，复用现有配音。

> 将这份讲稿做成无声视频，烧录字幕，供后期配音。

讲稿可加入 `<@ ... >` 指导动画，例如：`两点逐渐靠近。<@ 让点 B 沿曲线向点 A 移动，割线随之转动 >`。标记内的内容保留在原稿中，只用于分镜和画面，不朗读、不进字幕，也不额外计算朗读时长。支持独立行及跨行，不支持嵌套。普通 `<...>` 不作为提示；完整规则见 [视频制作提示约定](docs/video_hints.md)。

## 资源与目录

如果输入仍是零散思路，可先使用[初稿整理 Prompt](docs/draft_to_manuscript_prompt.md)生成完整 Markdown 科普文稿，数学公式保留 LaTeX 格式。`## ？` 表示需要补标题，`<* ... >` 表示作者说明；输出保留大纲层级和顺序，并主动构思动态可视化例子，用 `<@ ... >` 留给后续视频制作。此阶段只写文稿，作者审阅后再进入朗读适配和配音。

| 资源 | 用途 |
| --- | --- |
| [AGENTS.md](AGENTS.md) | 音频/视频职责、默认任务路由及交接约定 |
| [docs/audio_workflow.md](docs/audio_workflow.md) | 音频模型按需加载：拆分、转写、脚本对齐、合成、检查和音频交付 |
| [docs/video_workflow.md](docs/video_workflow.md) | 视频执行步骤、共享环境、检查和交付规格 |
| [docs/video_hints.md](docs/video_hints.md) | `<@ ... >` 视频提示的写法、朗读排除及交接规则 |
| [docs/tts_rewrite_prompt.md](docs/tts_rewrite_prompt.md) | TTS 文稿适配规则、正文与公式转换约束 |
| [docs/draft_to_manuscript_prompt.md](docs/draft_to_manuscript_prompt.md) | 初稿整理为 Markdown 科普文稿，保留 LaTeX 公式并附动态可视化制作提示 |
| [docs/video_prompt.md](docs/video_prompt.md) | 科普视频的视觉风格、内容表达和画面节奏 |
| [tools/minimax_tts.py](tools/minimax_tts.py) | MiniMax 请求、音频/字幕保存、时间轴、分镜表及响应恢复，也可作为 Python 模块调用 |
| [tools/check_tts.py](tools/check_tts.py) | 朗读文本与原稿逐字核对和标签检查 |
| [tools/split_markdown.py](tools/split_markdown.py) | 按原有章节拆分 Markdown |
| [tools/video_hints.py](tools/video_hints.py) | 供拆分、检查与交接工具共用的视频提示解析模块，保留提示原文和源位置 |
| [tools/audio_handoff.py](tools/audio_handoff.py) | 配音完成后检查各段音频并生成 `manifest.json`、`音频交接.md` |
| [docs/tts.md](docs/tts.md) | 配音配置、参数、返回协议和函数调用说明 |
| [.env.example](.env.example) | 用户本地 MiniMax 配置模板 |
| `outputs/` | 每次任务单独保存文本、音频、视频及过程记录 |
| `.local-deps/video/` | 共享视频渲染依赖 |
| `.local-deps/audio/` | 共享音频侧本地工具（如 `imageio_ffmpeg`） |
| `.local-deps/fonts/` | 由 `setup_fonts.py` 从系统字体拆出的宋体 Regular/Bold，仅本地使用 |
| [tools/video_engine/](tools/video_engine/) | 视频工具：配音时间轴准备、分镜时间换算、渲染、封面和成片抽检；[接口与示例](docs/video_engine.md) |
| `tests/` | 文本、语音工具与视频渲染测试，无真实语音费用 |

讲稿默认按顶层 `##` 切分，相邻完整章节合并，每份源稿最多 3000 字符；单章超限时报错，不自动拆段落。可用 `--max-chars`（或 `--max-char`）调整。TTS 适配时每份稿末尾默认加入 `<#0.8#>`，为后续配音拼接留出间隔。

```bash
python3 tools/split_markdown.py 讲稿.md --output-dir outputs/本次任务/parts
# 完成 TTS 适配后，检查正文并导出字符串对齐记录
python3 tools/check_tts.py outputs/本次任务/parts outputs/本次任务/tts \
  --alignment-dir outputs/本次任务/alignment
```

字符对齐记录包含原稿行号、TTS 字符范围与公式读法，并单独记录不朗读的 `videoHints`，不含音频时间；公式含义仍需逐条审阅。转写可能使文本增长，合成前另查 9000 UTF-16 字符上限。

已有任务后来补入视频提示时，按 [旧任务接续步骤](docs/video_hints.md#已有任务补入提示) 更新对齐与交接；提交的 TTS 文本未变时复用原有音频。

详细参数、agent 返回协议及函数调用见 [docs/tts.md](docs/tts.md)。本地测试不调用真实 MiniMax：

```bash
python3 -m unittest discover -s tests -v
node --test tests/video_engine.test.mjs
```

音频交接测试需要可用的 FFmpeg；视频完整测试需要先按 [视频环境配置](docs/video_workflow.md#环境与技术) 安装共享依赖，未安装时会跳过依赖渲染环境的用例。
