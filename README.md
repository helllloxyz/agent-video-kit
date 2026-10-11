# Agent Video Kit

供 Codex、DeepSeek harness 等 agent 使用的讲稿、配音与科普视频辅助项目。根目录 [AGENTS.md](AGENTS.md) 保留音频与视频两部分的职责和路由；模型执行具体任务时，再按需加载 [音频详细流程](docs/audio_workflow.md) 或 [视频详细流程](docs/video_workflow.md) 及对应 Prompt。

讲稿检查与配音脚本仅使用 Python 3.9+ 标准库，无须启动网页或连接原项目数据库。视频渲染环境的配置与复用见 [视频详细流程](docs/video_workflow.md)。

## 配置

克隆仓库并创建本地配置：

```bash
git clone https://github.com/helllloxyz/agent-video-kit.git
cd agent-video-kit
cp .env.example .env
```

在 `.env` 填写 `MINIMAX_API_KEY`。国内站沿用源项目默认接入地址；国际站账号还需设置 `MINIMAX_BASE_URL=https://api.minimax.io`。默认模型沿用源项目的 `speech-2.8-hd`，未指定音色时优先选择系统中文音色；可通过 `.env` 固定模型和音色。`.env` 与生成文件已被 `.gitignore` 排除。

## 交给 agent 使用

让 agent 在克隆目录工作并加载 [AGENTS.md](AGENTS.md)。Codex 可以直接打开该目录；其他 harness 若不自动读取该文件，需要将它加入项目指令，并提供 Python 脚本执行能力。

示例请求：

> /完整路径/讲稿.md

只给讲稿或路径时，默认完成章节拆分、朗读适配、纯脚本检查与字符串对齐、MiniMax 配音，按拆分段交付独立音频后停止，不拼接；无需重复说明步骤。明确要求“只转写”“先看文本”“暂不配音”时停在文本阶段。输出在独立的 `outputs/` 子目录中，保留原稿。视频由后续负责视频的模型接收任务清单和音频继续制作。

还可以请求：

> 用这份讲稿制作带配音的科普视频，完成文稿适配、配音、字幕同步和视频渲染。

> 用已有 MP3 和字幕制作视频，复用现有配音。

> 将这份讲稿做成无声视频，烧录字幕，供后期配音。

## 资源与目录

| 资源 | 用途 |
| --- | --- |
| [AGENTS.md](AGENTS.md) | 音频/视频职责、默认任务路由及交接约定 |
| [docs/audio_workflow.md](docs/audio_workflow.md) | 音频模型按需加载：拆分、转写、脚本对齐、合成、检查和音频交付 |
| [docs/video_workflow.md](docs/video_workflow.md) | 视频执行步骤、共享环境、检查和交付规格 |
| [docs/tts_rewrite_prompt.md](docs/tts_rewrite_prompt.md) | 从原 AGENTS.md 移出的 TTS 文稿适配规则，保留正文与公式转换约束 |
| [docs/video_prompt.md](docs/video_prompt.md) | 科普视频的视觉风格、内容表达和画面节奏 |
| [tools/minimax_tts.py](tools/minimax_tts.py) | MiniMax 请求、音频/字幕保存、时间轴、分镜表及响应恢复，也可作为 Python 模块调用 |
| [tools/check_tts.py](tools/check_tts.py) | 朗读文本与原稿逐字核对和标签检查 |
| [tools/split_markdown.py](tools/split_markdown.py) | 按原有章节拆分 Markdown |
| [docs/tts.md](docs/tts.md) | 配音配置、参数、返回协议和函数调用说明 |
| [.env.example](.env.example) | 用户本地 MiniMax 配置模板 |
| `outputs/` | 每次任务单独保存文本、音频、视频及过程记录 |
| `.local-deps/video/` | 共享视频渲染依赖 |
| `.local-deps/audio/` | 共享音频侧本地工具（如 `imageio_ffmpeg`） |
| `tests/` | 本地模拟服务测试，无真实语音费用 |

TTS 逻辑提取自 `ppt-copilot` 的 `lib/tts.ts` 和 `lib/tts-catalog.ts`。这里可以独立运行，不读取源项目的配置或密钥；模型与接口默认值沿用提取时实现，可通过环境变量调整。

讲稿默认按顶层 `##` 切分，相邻完整章节合并，每份源稿最多 2000 字符；单章超限时报错，不自动拆段落。可用 `--max-chars`（或 `--max-char`）调整。TTS 适配时每份稿末尾默认加入 `<#0.8#>`，为后续配音拼接留出间隔。

```bash
python3 tools/split_markdown.py 讲稿.md --output-dir outputs/本次任务/parts
# 完成 TTS 适配后，检查正文并导出字符串对齐记录
python3 tools/check_tts.py outputs/本次任务/parts outputs/本次任务/tts \
  --alignment-dir outputs/本次任务/alignment
```

字符对齐记录包含原稿行号、TTS 字符范围与公式读法，不含音频时间；公式含义仍需逐条审阅。转写可能使文本增长，合成前另查 9000 UTF-16 字符上限。

详细参数、agent 返回协议及函数调用见 [docs/tts.md](docs/tts.md)。本地测试不调用真实 MiniMax：

```bash
python3 -m unittest discover -s tests -v
```
