# Agent Video Kit

供 Codex、DeepSeek harness 等 agent 使用的讲稿、配音与科普视频辅助项目。根目录 [AGENTS.md](AGENTS.md) 是统一入口，负责介绍资源并编排流程；详细的讲稿适配和视频制作规则分别保存在独立 Prompt 中。

讲稿检查与配音脚本仅使用 Python 3.9+ 标准库，无须启动网页或连接原项目数据库。视频部分提供制作 Prompt，由 agent 根据任务编写或复用渲染代码，需要另外准备 Node.js、画布、FFmpeg 和字体等渲染环境。

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

> 将 /完整路径/讲稿.md 转为 TTS 文本，检查通过后生成配音，保留音频、字幕和时间轴。

只要求“转换讲稿”时默认只生成朗读文本；明确要求配音时才调用语音 API。输出在独立的 `outputs/` 子目录中，保留原稿。

还可以请求：

> 用这份讲稿制作带配音的科普视频，完成文稿适配、配音、字幕同步和视频渲染。

> 用已有 MP3 和字幕制作视频，复用现有配音。

> 将这份讲稿做成无声视频，烧录字幕，供后期配音。

## 资源与目录

| 资源 | 用途 |
| --- | --- |
| [AGENTS.md](AGENTS.md) | 统一入口、任务判断、目录说明、执行流程及交付约定 |
| [tts_rewrite_prompt.md](tts_rewrite_prompt.md) | 从原 AGENTS.md 移出的 TTS 文稿适配规则，保留正文与公式转换约束 |
| [video_prompt.md](video_prompt.md) | 科普视频风格、动画、音画同步、渲染检查与交付规格 |
| [tools/minimax_tts.py](tools/minimax_tts.py) | MiniMax 请求、音频/字幕保存、时间轴、分镜表及响应恢复，也可作为 Python 模块调用 |
| [tools/check_tts.py](tools/check_tts.py) | 朗读文本与原稿逐字核对和标签检查 |
| [tools/split_markdown.py](tools/split_markdown.py) | 按原有章节拆分 Markdown |
| [docs/tts.md](docs/tts.md) | 配音配置、参数、返回协议和函数调用说明 |
| [.env.example](.env.example) | 用户本地 MiniMax 配置模板 |
| `outputs/` | 每次任务单独保存文本、音频、视频及过程记录 |
| `tests/` | 本地模拟服务测试，无真实语音费用 |

TTS 逻辑提取自 `ppt-copilot` 的 `lib/tts.ts` 和 `lib/tts-catalog.ts`。这里可以独立运行，不读取源项目的配置或密钥；模型与接口默认值沿用提取时实现，可通过环境变量调整。

详细参数、agent 返回协议及函数调用见 [docs/tts.md](docs/tts.md)。本地测试不调用真实 MiniMax：

```bash
python3 -m unittest discover -s tests -v
```
