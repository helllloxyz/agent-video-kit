# TTS 脚本与 agent 调用约定

## 配置

脚本自动读取自身所在仓库根目录 `.env`。优先级：调用参数 > 已有环境变量 > `.env` > 默认值。文件只支持简单 `KEY=value` 和两端引号，不执行 shell 或展开变量，不要在值后追加注释。

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| `MINIMAX_API_KEY` | 必填 | 用户自己的 key |
| `MINIMAX_BASE_URL` | `https://api.minimax.cn` | 匹配账号区域；还支持 `https://api-bj.minimaxi.com`、`https://api.minimax.io` |
| `MINIMAX_MODEL` | `speech-2.8-hd` | 模型 ID |
| `MINIMAX_VOICE_ID` | 自动选择 | 优先首个中文系统音色，否则首个系统音色 |
| `MINIMAX_SPEED` | `1` | 0.5–2 |
| `MINIMAX_VOL` | `1` | 0.1–10 |
| `MINIMAX_PITCH` | `0` | -12–12 的整数 |
| `MINIMAX_EMOTION` | 留空 | 由模型按文本自动匹配 |

参数沿用源项目提取时的默认值；固定音色后不再查询音色列表。

## 调用

以下从克隆后的根目录执行。输入为已经准备好的 UTF-8 纯文本；正文、换行、停顿及语气标签原样保留，不自动改写 Markdown 或公式。上限沿用源项目的 9000 个 UTF-16 字符，超长先分段。

输入必须先按 [视频制作提示约定](video_hints.md) 排除 `<@ ... >` 提示，原稿与交接记录保留。脚本在任何联网请求前拒绝仍含 `<@` 的文本，不自动删除提示后提交付费合成；`<#0.8#>` 停顿标记不受影响。

```bash
python3 tools/minimax_tts.py voices
python3 tools/minimax_tts.py synthesize --text-file outputs/讲稿_TTS.txt

# 可选：固定音色、语速、字幕粒度和空的输出目录
python3 tools/minimax_tts.py synthesize --text-file outputs/讲稿_TTS.txt \
  --voice-id YOUR_VOICE_ID --speed 1.05 --granularity word \
  --output-dir outputs/chapter_01

# harness 可以通过标准输入传入正文
python3 tools/minimax_tts.py synthesize --stdin < outputs/讲稿_TTS.txt

# 只校验请求，不联网、计费或创建输出文件
python3 tools/minimax_tts.py synthesize --text '测试文字' --dry-run

# 重用已保存响应，只解码音频并重新下载字幕，不重新合成
python3 tools/minimax_tts.py recover --response-file outputs/上一轮/response.json

# 指定其他配置文件，选项放在子命令之前
python3 tools/minimax_tts.py --env-file /path/to/local.env voices
```

还支持 `--model`、`--vol`、`--pitch`、`--emotion`、`--timeout`（秒，默认 120）、`--subtitle-time-unit auto|ms|s`。恢复也支持 `--subtitle-time-unit` 和 `--output-dir`。显式输出目录必须为空；默认创建独立 `outputs/tts_*`，使用 UTC 时间和随机后缀避免覆盖。

## 返回协议与产物

成功时标准输出为一行 JSON，例如下列节选（实际还包含其他文件路径和计费信息）：

```json
{"ok":true,"status":"complete","outputDir":"/clone/outputs/tts_...","files":{"audio":"/clone/outputs/tts_.../speech.mp3","srt":"/clone/outputs/tts_.../speech.srt","timeline":"/clone/outputs/tts_.../timeline.json"},"warnings":[]}
```

返回包含 `audioLengthMs`、`audioBytes`、`usageCharacters`、`voiceId`。`ok: true` 且 `status: partial` 表示音频已保存，但字幕缺失或失败，见 `warnings`；此时退出码仍为 0，agent 应按任务需求判断是否接受。

| 文件 | 内容 |
| --- | --- |
| `speech.mp3` | 32 kHz、128 kbps、单声道，与源项目一致 |
| `speech.srt` | 字幕，仅拿到有效字幕时生成 |
| `timeline.json` | 毫秒时间轴：`audioLengthMs`、`granularity`、`paragraphs`、`subtitles` |
| `segments.csv` | 段落分镜表；无法对齐时退回字幕条目 |
| `subtitles.raw.json` | 下载的原始字幕 |
| `request.json` | 合成参数及正文，无密钥 |
| `response.json` | 原始合成响应，含音频 hex 及临时链接，无请求头 |
| `result.json` | 本次结果摘要 |

输出含正文及临时链接，不适合提交公共仓库。字幕字段兼容逻辑源自原项目；`time_begin`、`start_ms`、`startMs` 按毫秒处理，模糊字段最大结束时间小于 60 时推断为秒。推断有歧义时用 `recover --subtitle-time-unit ms` 或 `s` 重导出。字幕与正文字符数相差超过 20% 时不推断段落时间轴。

运行失败退出码为 1，标准错误为 `{"ok":false,"error":"..."}`；参数用法错误由 argparse 返回退出码 2。合成不自动重试，超时也可能计费。收到有效响应后先保存 `response.json` 再处理音频和字幕，字幕失败保留音频。恢复依赖已保存的响应，字幕链接过期后不保证能补回。远程请求使用 HTTPS，字幕下载不携带 API key。

## Python 模块调用

在根目录运行；其他目录可将克隆目录加入模块搜索路径。

```python
from tools.minimax_tts import load_env, settings, synthesize_speech, recover_synthesis

load_env()
config = settings()  # 或 settings(voice_id="YOUR_VOICE_ID", speed=1.05)
with open("outputs/讲稿_TTS.txt", encoding="utf-8") as source:
    result = synthesize_speech(source.read(), config=config)
print(result["files"]["audio"])

# 单独恢复无需 API key，不重新合成
# recovered = recover_synthesis(result["files"]["response"], config=config)
```

函数调用方捕获 `TtsError` 及文件读写异常。批量任务逐份调用并保存返回结果，不因为字幕失败重新合成。本次提取包含合成、下载与音色查询；未迁移网页历史数据库、音色复刻/删除及 AI 标语气。
