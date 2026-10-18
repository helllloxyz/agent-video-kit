#!/usr/bin/env python3
"""检查已合成的分段音频，生成 manifest.json、音频检查.json 和 音频交接.md；不合成、不拼接。

用法：
  python3 tools/audio_handoff.py <任务目录> [--source 原稿.md]

任务目录约定：parts/*.md、tts/<同名>_TTS.txt、alignment/<同名>.alignment.json、
audio/001/ 起按拆分稿顺序编号。已有 manifest.json 时保留其中的其他字段。
"""

import argparse
from array import array
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

if __package__:
    from .video_hints import strip_video_hints, video_hints
else:
    from video_hints import strip_video_hints, video_hints

ROOT = Path(__file__).resolve().parents[1]
RATE = 32000
SILENCE_DBFS = -45
HEADING_RE = re.compile(r"^ {0,3}(#{1,3})[ \t]+(.+?)[ \t]*#*[ \t]*$", re.M)


def find_ffmpeg():
    candidates = [os.environ.get("FFMPEG")]
    candidates += sorted(str(p) for p in (ROOT / ".local-deps/audio/imageio_ffmpeg/binaries").glob("ffmpeg*"))
    candidates.append(str(ROOT / ".local-deps/video/node_modules/ffmpeg-static/ffmpeg"))
    candidates.append(shutil.which("ffmpeg"))
    for path in candidates:
        if path and Path(path).is_file():
            return path
    raise SystemExit("找不到 FFmpeg：可设置 FFMPEG，或安装 .local-deps 中的音频/视频依赖")


def decode(ffmpeg, path):
    process = subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-i", str(path),
                              "-ac", "1", "-ar", str(RATE), "-f", "s16le", "-"], capture_output=True)
    if process.returncode != 0:
        raise ValueError("无法解码：%s" % process.stderr.decode("utf-8", "replace")[-300:])
    samples = array("h", process.stdout)
    if sys.byteorder != "little":
        samples.byteswap()
    return samples


def trailing_silence_ms(samples):
    block, threshold, silent = RATE // 100, 32768 * 10 ** (SILENCE_DBFS / 20), 0
    for end in range(len(samples), 0, -block):
        chunk = samples[max(0, end - block):end]
        if math.sqrt(sum(v * v for v in chunk) / len(chunk)) > threshold:
            break
        silent += 1
    return silent * 10


def headings(markdown, first_line):
    out = []
    markdown = strip_video_hints(markdown, preserve_layout=True)
    for match in HEADING_RE.finditer(markdown):
        line = markdown.count("\n", 0, match.start()) + first_line
        title = match[2].strip()
        if title:
            out.append({"level": len(match[1]), "title": title, "originalSourceLine": line})
    return out


def check_part(ffmpeg, job, index, part, source_offset, source_line):
    stem = part.stem
    tts, alignment, audio = job / "tts" / f"{stem}_TTS.txt", job / "alignment" / f"{stem}.alignment.json", job / "audio" / f"{index:03d}"
    markdown = part.read_text(encoding="utf-8")
    row = {"part": part.relative_to(job).as_posix(), "tts": tts.relative_to(job).as_posix(),
           "alignment": alignment.relative_to(job).as_posix(), "audioDir": audio.relative_to(job).as_posix(),
           "sourceCharacters": len(markdown), "headings": headings(markdown, source_line),
           "videoHints": [{**hint, "originalSourceLines": [n + source_line - 1 for n in hint["sourceLines"]]}
                          for hint in video_hints(markdown)]}
    if source_offset is not None:
        row.update(originalSourceRange=[source_offset, source_offset + len(markdown)], originalSourceFirstLine=source_line)
    errors, warnings = [], []
    if not tts.is_file():
        errors.append("缺少 TTS 稿")
    if not alignment.is_file():
        warnings.append("缺少字符串对齐文件；视频字幕无法把读法换回原式")
    elif not json.loads(alignment.read_text(encoding="utf-8")).get("passed"):
        errors.append("字符串对齐检查未通过")
    if not (audio / "result.json").is_file():
        return row, {"part": index, "synthesized": False, "errors": errors + ["尚无合成结果"], "warnings": warnings}
    result = json.loads((audio / "result.json").read_text(encoding="utf-8"))
    request = json.loads((audio / "request.json").read_text(encoding="utf-8"))
    text = tts.read_text(encoding="utf-8") if tts.is_file() else ""
    if "<-" in text:
        errors.append("TTS 稿残留视频制作提示 <- ... ->，不能作为已完成音频交接")
    if not result.get("ok"):
        errors.append("result.json 不是成功状态")
    if request.get("text") != text:
        errors.append("提交文本与当前 TTS 稿不一致")
    warnings += result.get("warnings", [])
    samples = decode(ffmpeg, audio / "speech.mp3")
    duration_ms = round(len(samples) * 1000 / RATE)
    timeline = json.loads((audio / "timeline.json").read_text(encoding="utf-8")) if (audio / "timeline.json").is_file() else {}
    subtitles = timeline.get("subtitles", [])
    if not subtitles:
        warnings.append("没有服务字幕")
    elif not all(0 <= s["startMs"] <= s["endMs"] <= duration_ms for s in subtitles):
        errors.append("字幕时间超出音频范围")
    row.update(audio=f"{row['audioDir']}/speech.mp3", timeline=f"{row['audioDir']}/timeline.json",
               srt=f"{row['audioDir']}/speech.srt", synthesisResult=f"{row['audioDir']}/result.json",
               ttsUtf16Characters=len(text.encode("utf-16-le")) // 2, decodedDurationMs=duration_ms,
               voiceId=result.get("voiceId"), paragraphTiming="character_interpolation_estimate")
    check = {"part": index, "synthesized": True, "decodedDurationMs": duration_ms,
             "providerAudioLengthMs": result.get("audioLengthMs"), "subtitlesCount": len(subtitles),
             "trailingSilenceEstimateMs": trailing_silence_ms(samples),
             "silenceMethod": "10ms RMS blocks below %d dBFS, approximate" % SILENCE_DBFS,
             "errors": errors, "warnings": warnings}
    return row, check


def chapter_span(row):
    titles = [h["title"] for h in row["headings"] if h["level"] == 2]
    return titles[0] if len(titles) == 1 else "%s 至 %s" % (titles[0], titles[-1]) if titles else "（无 ## 标题）"


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("job", type=Path)
    parser.add_argument("--source", type=Path, help="原稿；省略时沿用 manifest.json 中的 source")
    args = parser.parse_args()
    job = args.job.resolve()
    manifest_path = job / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.is_file() else {}
    parts = sorted((job / "parts").glob("*.md"))
    if not parts:
        raise SystemExit("任务目录缺少 parts/*.md")
    source_path = args.source or (Path(manifest["source"]) if manifest.get("source") else None)
    source = source_path.read_text(encoding="utf-8") if source_path else None
    joined = "".join(p.read_text(encoding="utf-8") for p in parts)
    if source is not None and joined != source:
        raise SystemExit("拆分稿顺序拼回后与原稿不一致；原稿可能已修改")
    ffmpeg, rows, checks, offset, line = find_ffmpeg(), [], [], 0, 1
    previous = {row.get("part"): row for row in manifest.get("parts", [])}
    for index, part in enumerate(parts, 1):
        row, check = check_part(ffmpeg, job, index, part, offset if source is not None else None, line)
        rows.append({**previous.get(row["part"], {}), **row})
        checks.append(check)
        text = part.read_text(encoding="utf-8")
        offset, line = offset + len(text), line + text.count("\n")
    voices = {row.get("voiceId") for row in rows if row.get("voiceId")}
    complete = all(c["synthesized"] and not c["errors"] for c in checks)
    if len(voices) > 1:
        checks.append({"part": None, "errors": ["各段音色不一致：%s" % sorted(voices)], "warnings": []})
        complete = False
    manifest.update(stage="audio_complete" if complete else "audio_partial",
                    audioGenerated=complete, audioDelivery="separate_parts_no_merge",
                    audioVerification="音频检查.json", parts=rows)
    manifest.setdefault("listened", False)
    manifest.setdefault("videoGenerated", False)
    if source is not None:
        manifest.update(source=str(source_path.resolve()), sourceSha256=hashlib.sha256(source.encode("utf-8")).hexdigest())
    (job / "音频检查.json").write_text(json.dumps(checks, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    lines = ["# 音频阶段交接", "",
             "状态：%s；各段独立交付，未拼接。" % ("全部配音通过检查" if complete else "未全部完成，见音频检查.json"), "",
             "原稿：%s" % manifest.get("source", "（未记录）"), "",
             "- alignment/ 由 check_tts.py 纯脚本生成，只记录原稿与朗读稿的字符对应，不含音频时间。",
             "- 各段 timeline.json 的 subtitles 来自 MiniMax，从零开始；paragraphs 按字符插值，属于估算。",
             "- 连续视频由视频流程按 decodedDurationMs 累加偏移；画面和公式以原稿为准。", "",
             "- 各段 videoHints 保留 <- ... -> 视频制作提示及源行号，只用于分镜和动画，不进入配音、字幕或章节标题，也不自带时长。", "",
             "| 段 | 章节 | 音频 | 实际时长（秒） | 字幕句数 |", "| --- | --- | --- | ---: | ---: |"]
    for index, (row, check) in enumerate(zip(rows, checks), 1):
        duration = "%.3f" % (row["decodedDurationMs"] / 1000) if "decodedDurationMs" in row else "—"
        lines.append("| %03d | %s | %s | %s | %s |" % (index, chapter_span(row), row.get("audio", "（未合成）"),
                                                       duration, check.get("subtitlesCount", "—")))
    issues = [f"- 第 {c['part']} 段：{m}" for c in checks for m in c["errors"] + c["warnings"]]
    lines += ["", "问题与警告：" if issues else "无错误或警告。", *issues,
              "", "已人工试听。" if manifest.get("listened") else "未人工试听，不宣称公式发音和听感已验证。", ""]
    (job / "音频交接.md").write_text("\n".join(lines), encoding="utf-8")
    print(json.dumps({"ok": complete, "stage": manifest["stage"], "checks": checks}, ensure_ascii=False, indent=2))
    return 0 if complete else 1


if __name__ == "__main__":
    sys.exit(main())
