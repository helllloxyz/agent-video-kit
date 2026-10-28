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

只给讲稿或路径时，默认完成口播与画面适配、章节拆分、TTS 提取、纯脚本检查与字符串对齐、MiniMax 配音，按拆分段交付独立音频后停止，不拼接；无需重复说明步骤。明确要求“只转写”“先看文本”“暂不配音”时停在文本阶段。输出在独立的 `outputs/` 子目录中，保留原稿。视频由后续负责视频的模型接收任务清单和音频继续制作。

公式默认按有视频画面的用途简读：画面完整展示 LaTeX，语音优先讲关系、变化和理解重点，不逐项复述长公式；相邻正文已讲清的重复公式可以只展示。视频与分镜设计阶段在任务 `source/` 保存适配稿，尽量保留原文，补齐完整上屏材料与必要的引导、桥接，输入文章不变，再拆分、提取、检查和配音。口播按画面观察顺序讲清关键关系，为复杂材料留足理解时间，不以简短为目标；视频字幕默认跟随实际口播，完整公式单独上屏。明确要求“纯音频，脱离画面也能听懂”或“公式逐项读出”时使用完整读法；具体边界见 [TTS 转写 Prompt](docs/tts_rewrite_prompt.md)。

还可以请求：

> 用这份讲稿制作带配音的科普视频，完成文稿适配、配音、字幕同步和视频渲染。

> 用已有 MP3 和字幕制作视频，复用现有配音。

> 将这份讲稿做成无声视频，烧录字幕，供后期配音。

讲稿用 `<!-- visual: ... -->` 保存画面资料与制作安排，不朗读、不进口播字幕。`<!-- author: ... -->` 是作者要求，由整理阶段落实后去除；适配稿中的 `>` 是需要朗读的桥接、过场；第一步文章的引用仍按正常文章语义理解。统一使用上述 HTML 注释语法，两种旧标记均已停用；完整规则见 [视频制作提示约定](docs/video_hints.md)。

## 资源与目录

文字流程分为三个可独立迭代的步骤：

| 步骤 | 工作与产物 |
| --- | --- |
| [1. 文稿整理](docs/draft_to_manuscript_prompt.md) | 把初稿整理为完整、可独立阅读的科普文章，保留公式、推导与表格，可附 visual 想法。 |
| [2. 视频与分镜设计](docs/manuscript_to_storyboard_prompt.md) | 尽量维持原文，安排画面材料与镜头变化，只补必要的画面引导、解释与桥接；输出适配稿和分镜草案。 |
| [3. TTS 音频化](docs/tts_rewrite_prompt.md) | 从确定的适配稿提取台词，结合画面处理发音、公式讲解、格式与停顿，复核观察节奏；必要补充先回写适配稿，输出 TTS 和检查记录。 |

第二步继续思考并优化 `visual`，不照搬第一步的备忘，也不为口播整体改写文章。严格字符串检查针对“适配稿 → TTS”；“文章 → 适配稿”检查必要调整与内容完整性。配音后，视频制作将分镜草案绑定到实际音轨并渲染；仅请求前面某一步时停在该步。

| 资源 | 用途 |
| --- | --- |
| [AGENTS.md](AGENTS.md) | 音频/视频职责、默认任务路由及交接约定 |
| [docs/audio_workflow.md](docs/audio_workflow.md) | 音频模型按需加载：拆分、转写、脚本对齐、合成、检查和音频交付 |
| [docs/video_workflow.md](docs/video_workflow.md) | 视频执行步骤、共享环境、检查和交付规格 |
| [docs/video_hints.md](docs/video_hints.md) | `<!-- visual: ... -->` 视频提示的写法、朗读排除及交接规则 |
| [docs/manuscript_to_storyboard_prompt.md](docs/manuscript_to_storyboard_prompt.md) | 第二步：视频表达、完整画面材料与分镜草案 |
| [docs/tts_rewrite_prompt.md](docs/tts_rewrite_prompt.md) | 第三步：必要的音频化转换与严格文本检查 |
| [docs/draft_to_manuscript_prompt.md](docs/draft_to_manuscript_prompt.md) | 初稿整理为 Markdown 科普文稿，保留完整知识与 LaTeX，可附 visual 备忘 |
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
python3 tools/split_markdown.py outputs/本次任务/source/讲稿_适配稿.md --output-dir outputs/本次任务/parts
# 从拆分适配稿提取 TTS 后，检查台词并导出字符串对齐记录
python3 tools/check_tts.py outputs/本次任务/parts outputs/本次任务/tts \
  --alignment-dir outputs/本次任务/alignment --visual-headings
```

`--visual-headings` 用于标题只展示的视频口播；纯音频或复查原有已读标题的任务时不加，避免改变既有检查口径。

中文姓名或术语后的补充英文默认不进入 TTS，原稿与字幕保留；逐处审阅后保存 `caption_annotations.json`，检查追加 `--caption-annotations`，以明确映射恢复字幕，不自动删除所有括号内容。详见 [TTS 补注规则](docs/tts_rewrite_prompt.md#英文补注不朗读字幕保留)。

字符对齐记录包含参与适配的源稿行号、TTS 字符范围与公式读法，并单独记录不朗读的 `videoHints`，不含音频时间；公式简读含义与画面承接仍需逐条审阅。空公式读法会给出警告，须记录省读理由和展示安排，不意味着已有展示时间。使用任务副本时，行号属于副本；转写可能使文本增长，合成前另查 9000 UTF-16 字符上限。

已有任务后来补入视频提示时，按 [旧任务接续步骤](docs/video_hints.md#已有任务补入提示) 更新对齐与交接；提交的 TTS 文本未变时复用原有音频。

详细参数、agent 返回协议及函数调用见 [docs/tts.md](docs/tts.md)。本地测试不调用真实 MiniMax：

```bash
python3 -m unittest discover -s tests -v
node --test tests/*.test.mjs
```

音频交接测试需要可用的 FFmpeg；视频完整测试需要先按 [视频环境配置](docs/video_workflow.md#环境与技术) 安装共享依赖，未安装时会跳过依赖渲染环境的用例。
