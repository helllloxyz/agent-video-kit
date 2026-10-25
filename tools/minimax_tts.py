#!/usr/bin/env python3
"""Independent MiniMax synthesis/download helpers, extracted from ppt-copilot.

Python 3.9+, standard library only. Import this module or run it as a script.
No dependency on the original web app, account session, D1, or Node.js.
"""

import argparse
import csv
from datetime import datetime, timezone
import io
import json
import math
import os
from pathlib import Path
import re
import sys
import unicodedata
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener
import uuid


ROOT = Path(__file__).resolve().parents[1]
TEXT_LIMIT = 9000
STATUS_MESSAGES = {
    1000: "MiniMax 未知错误", 1001: "MiniMax 请求超时",
    1002: "MiniMax 请求频率超限", 1004: "API key 无效或与接入区域不匹配",
    1008: "MiniMax 账户余额不足", 1013: "MiniMax 内部错误",
    1026: "输入内容未通过审核", 1027: "输出内容未通过审核",
    1039: "MiniMax 用量限制", 2013: "音色或合成参数校验失败",
}


class TtsError(Exception):
    pass


def load_env(path=None):
    """Load simple KEY=value lines without executing shell code; OS env wins."""
    path = Path(path) if path else ROOT / ".env"
    if not path.exists():
        if path != ROOT / ".env":
            raise TtsError("环境配置文件不存在")
        return
    for number, line in enumerate(path.read_text(encoding="utf-8-sig").splitlines(), 1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        key, separator, value = line.partition("=")
        if not separator or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key.strip()):
            raise TtsError("环境配置文件第 %s 行格式无效" % number)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        os.environ.setdefault(key.strip(), value)


def settings(**overrides):
    config = {
        "api_key": os.environ.get("MINIMAX_API_KEY", "").strip(),
        "base_url": os.environ.get("MINIMAX_BASE_URL", "https://api.minimax.cn").rstrip("/"),
        "model": os.environ.get("MINIMAX_MODEL", "speech-2.8-hd"),
        "voice_id": os.environ.get("MINIMAX_VOICE_ID", ""),
        "speed": os.environ.get("MINIMAX_SPEED", "1"),
        "vol": os.environ.get("MINIMAX_VOL", "1"),
        "pitch": os.environ.get("MINIMAX_PITCH", "0"),
        "emotion": os.environ.get("MINIMAX_EMOTION", ""),
        "granularity": "sentence", "timeout": 120.0, "subtitle_time_unit": "auto",
    }
    config.update({key: value for key, value in overrides.items() if value is not None})
    for key, low, high in (("speed", .5, 2), ("vol", .1, 10), ("pitch", -12, 12), ("timeout", .1, 3600)):
        try:
            value = float(config[key])
        except (TypeError, ValueError):
            raise TtsError("%s 必须是数字" % key)
        if not math.isfinite(value) or not low <= value <= high:
            raise TtsError("%s 必须在 %s 到 %s 之间" % (key, low, high))
        if key == "pitch" and not value.is_integer():
            raise TtsError("pitch 必须是整数")
        config[key] = int(value) if key == "pitch" else value
    if config["granularity"] not in ("sentence", "word"):
        raise TtsError("granularity 必须是 sentence 或 word")
    if config["subtitle_time_unit"] not in ("auto", "ms", "s"):
        raise TtsError("subtitle_time_unit 必须是 auto、ms 或 s")
    validate_url(config["base_url"])
    return config


def validate_url(url):
    if not isinstance(url, str):
        raise TtsError("请求地址必须是 URL 字符串")
    parsed = urlparse(url)
    if parsed.scheme not in ("https", "http") or not parsed.hostname or parsed.username or parsed.password:
        raise TtsError("请求地址必须是无内嵌凭据的 HTTP(S) URL")
    if parsed.scheme == "http" and parsed.hostname not in ("localhost", "127.0.0.1", "::1"):
        raise TtsError("远程请求必须使用 HTTPS")


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def request_bytes(url, timeout, body=None, api_key=None):
    validate_url(url)
    headers = {"User-Agent": "video-make-helper/1.0"}
    if api_key:
        headers["Authorization"] = "Bearer " + api_key
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    request = Request(url, data=data, headers=headers)
    # Authenticated requests must not forward secrets through redirects.
    opener = build_opener(NoRedirect()) if api_key else build_opener()
    try:
        with opener.open(request, timeout=timeout) as response:
            return response.read()
    except HTTPError as error:
        raise TtsError("HTTP %s：请检查接口、密钥、额度或下载链接是否过期" % error.code)
    except (URLError, TimeoutError, OSError):
        raise TtsError("网络请求失败或超时；合成可能已计费，请勿自动重复提交")


def check_response(payload):
    if not isinstance(payload, dict):
        raise TtsError("MiniMax 返回的 JSON 必须是对象")
    base = payload.get("base_resp") or {}
    code = base.get("status_code", 0)
    if str(code) != "0":
        raise TtsError(STATUS_MESSAGES.get(code, "MiniMax 业务错误（%s）" % code))
    return payload


def call_minimax(config, endpoint, body):
    if not config["api_key"]:
        raise TtsError("请在项目 .env 或环境变量中设置 MINIMAX_API_KEY")
    raw = request_bytes(config["base_url"] + endpoint, config["timeout"], body, config["api_key"])
    try:
        return check_response(json.loads(raw))
    except (ValueError, AttributeError):
        raise TtsError("MiniMax 响应格式无效")


def list_voices(config=None):
    config = config if config is not None else settings()
    payload = call_minimax(config, "/v1/get_voice", {"voice_type": "all"})
    voices = []
    for field, kind in (("voice_cloning", "cloned"), ("voice_generation", "generated"), ("system_voice", "system")):
        for row in payload.get(field) or []:
            if not row.get("voice_id"):
                continue
            description = row.get("description") or ""
            voices.append({"voiceId": row["voice_id"], "name": row.get("voice_name") or row["voice_id"],
                           "description": " ".join(description) if isinstance(description, list) else description,
                           "kind": kind})
    return voices


def choose_voice(config):
    if config["voice_id"]:
        return config["voice_id"]
    system = [voice for voice in list_voices(config) if voice["kind"] == "system"]
    if not system:
        raise TtsError("未找到系统音色，请设置 MINIMAX_VOICE_ID")
    chinese = [voice for voice in system if re.search(
        r"chinese|mandarin|中文|普通话|汉语", " ".join(str(v) for v in voice.values()), re.I)]
    return (chinese or system)[0]["voiceId"]


def build_request(text, config):
    if not isinstance(text, str) or not text.strip():
        raise TtsError("朗读文本不能为空")
    if "<!--" in text or "-->" in text:
        raise TtsError("朗读文本含 HTML 注释；请先排除 author、visual 及其他注释，再合成")
    if "<@" in text or "<*" in text:
        raise TtsError("朗读文本含已停用标记；请先将源稿改为 HTML 注释并重新提取 TTS，再合成")
    if len(text.encode("utf-16-le")) // 2 > TEXT_LIMIT:
        raise TtsError("单次最多 9000 个字符；请先分段，脚本不会改写或截断正文")
    voice = {"voice_id": config["voice_id"], "speed": config["speed"],
             "vol": config["vol"], "pitch": config["pitch"]}
    if config["emotion"]:
        voice["emotion"] = config["emotion"]
    return {"model": config["model"], "text": text, "stream": False, "voice_setting": voice,
            "audio_setting": {"sample_rate": 32000, "bitrate": 128000, "format": "mp3", "channel": 1},
            "language_boost": "auto", "output_format": "hex", "subtitle_enable": True,
            "subtitle_type": config["granularity"]}


def subtitle_rows(raw):
    if isinstance(raw, list):
        return [row for row in raw if isinstance(row, dict)]
    if isinstance(raw, dict):
        for key in ("subtitles", "subtitle", "segments", "sentences", "words", "data", "items", "result"):
            rows = subtitle_rows(raw.get(key))
            if rows:
                return rows
    return []


def normalize_subtitles(raw, time_unit="auto"):
    starts = ("time_begin", "start_time", "start", "begin", "startTime", "start_ms", "begin_time", "startMs")
    ends = ("time_end", "end_time", "end", "endTime", "end_ms", "finish_time", "endMs")
    texts = ("text", "word", "content", "token", "sentence")
    items = []
    explicit_ms = False
    for row in subtitle_rows(raw):
        text = next((row[k] for k in texts if row.get(k) is not None), None)
        start_key = next((k for k in starts if row.get(k) is not None), None)
        end = next((row[k] for k in ends if row.get(k) is not None), None)
        if text is None or start_key is None:
            continue
        try:
            start = float(row[start_key])
            end = start if end is None else float(end)
        except (ValueError, TypeError):
            continue
        if not math.isfinite(start) or not math.isfinite(end) or start < 0 or end < start:
            continue
        explicit_ms |= start_key in ("time_begin", "start_ms", "startMs")
        items.append({"text": str(text), "startMs": start, "endMs": end})
    # Preserve the app's seconds fallback for ambiguous field names. Known
    # MiniMax time_begin/time_end and *_ms fields are already milliseconds.
    scale = 1000 if time_unit == "s" or (time_unit == "auto" and not explicit_ms and items
                                        and max(item["endMs"] for item in items) < 60) else 1
    for item in items:
        item["startMs"] = round(item["startMs"] * scale)
        item["endMs"] = round(item["endMs"] * scale)
    return items


def srt_time(ms):
    total = max(0, round(ms))
    seconds, millis = divmod(total, 1000)
    minutes, seconds = divmod(seconds, 60)
    hours, minutes = divmod(minutes, 60)
    return "%02d:%02d:%02d,%03d" % (hours, minutes, seconds, millis)


SPOKEN_TAG_RE = re.compile(r"\([a-z][a-z-]*\)|<#[\d.]+#>", re.I)


def split_caption(text, max_chars=28):
    """Split at sentence, then clause punctuation; never merges separate service sentences."""
    text = SPOKEN_TAG_RE.sub("", text).strip()
    pieces = [p for p in re.split(r"(?<=[。！？；!?;])", text) if p.strip()]
    result = []
    for piece in pieces:
        while len(piece) > max_chars:
            cut = max((piece.rfind(mark, 0, max_chars) for mark in "，、：,:"), default=-1)
            cut = cut + 1 if cut >= max_chars // 3 else max_chars
            result.append(piece[:cut])
            piece = piece[cut:]
        if piece.strip():
            result.append(piece)
    return [p.strip() for p in result if p.strip()]


def build_srt(items, max_chars=28):
    """One or more blocks per service sentence; split times are character-interpolated estimates."""
    blocks, previous_end = [], 0
    for item in items:
        pieces = split_caption(item["text"], max_chars)
        weights = [max(1, len(re.sub(r"\s", "", p))) for p in pieces]
        start, span, seen = item["startMs"], item["endMs"] - item["startMs"], 0
        for piece, weight in zip(pieces, weights):
            begin = max(start + span * seen / sum(weights), previous_end)
            seen += weight
            end = max(start + span * seen / sum(weights), begin + 100)
            previous_end = end
            blocks.append("%s\n%s --> %s\n%s\n" % (len(blocks) + 1, srt_time(begin), srt_time(end), piece))
    return "\n".join(blocks)


def align_paragraphs(text, items):
    def plain(value):
        value = SPOKEN_TAG_RE.sub("", value)
        return "".join(c for c in value if not c.isspace() and unicodedata.category(c)[0] not in "PS")
    paragraphs = [SPOKEN_TAG_RE.sub("", line).strip() for line in text.splitlines()]
    paragraphs = [line for line in paragraphs if line]
    stream = [(item, len(plain(item["text"]))) for item in items]
    total = sum(length for _, length in stream)
    expected = sum(len(plain(line)) for line in paragraphs)
    if not total or not expected or abs(total - expected) / expected > .2:
        return []

    def time_at(position):
        seen = 0
        for item, length in stream:
            if not length:
                continue
            if position <= seen + length:
                return round(item["startMs"] + (item["endMs"] - item["startMs"]) * (position - seen) / length)
            seen += length
        return items[-1]["endMs"]

    result, offset = [], 0
    for line in paragraphs:
        start = time_at(offset)
        offset += len(plain(line))
        result.append({"text": line, "startMs": start, "endMs": max(start, time_at(offset))})
    return result


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def new_output_dir(output_dir=None):
    path = Path(output_dir).expanduser().resolve() if output_dir else ROOT / "outputs" / (
        "tts_" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ_") + uuid.uuid4().hex[:8])
    path.mkdir(parents=True, exist_ok=True)
    if any(path.iterdir()):
        raise TtsError("输出目录必须为空，避免覆盖已有音频：%s" % path)
    return path


def save_synthesis(payload, request, output_dir, config):
    """Persist provider response before downloads; never repeats synthesis."""
    output_dir = Path(output_dir)
    write_json(output_dir / "response.json", payload)
    write_json(output_dir / "request.json", request)
    check_response(payload)
    data = payload.get("data") or {}
    audio_hex = data.get("audio")
    if not isinstance(audio_hex, str) or not re.fullmatch(r"(?:[0-9a-fA-F]{2})+", audio_hex.strip()):
        raise TtsError("音频 hex 数据为空或无效；已保存 response.json，请检查后恢复，不要重复合成")
    audio = bytes.fromhex(audio_hex.strip())
    audio_path = output_dir / "speech.mp3"
    audio_path.write_bytes(audio)
    warnings, subtitles = [], []
    subtitle_url = data.get("subtitle_file")
    if subtitle_url:
        try:
            # Temporary object-storage links do not receive the API key.
            raw = request_bytes(subtitle_url, min(config["timeout"], 60))
            (output_dir / "subtitles.raw.json").write_bytes(raw)
            subtitles = normalize_subtitles(json.loads(raw), config["subtitle_time_unit"])
            if not subtitles:
                warnings.append("字幕为空或字段无法识别；原始文件已保存")
        except (TtsError, ValueError) as error:
            warnings.append("字幕下载或解析失败：%s；音频已保留，可用 recover 重试下载" % error)
    else:
        warnings.append("MiniMax 未返回字幕链接，音频已保留")
    paragraphs = align_paragraphs(request.get("text", ""), subtitles)
    extra = payload.get("extra_info") or {}
    timeline = {"audioLengthMs": extra.get("audio_length", 0), "granularity": request.get("subtitle_type", "sentence"),
                "paragraphs": paragraphs, "subtitles": subtitles}
    write_json(output_dir / "timeline.json", timeline)
    files = {"audio": str(audio_path), "timeline": str(output_dir / "timeline.json"),
             "response": str(output_dir / "response.json"), "request": str(output_dir / "request.json")}
    if subtitles:
        (output_dir / "speech.srt").write_text(build_srt(subtitles), encoding="utf-8")
        files["srt"] = str(output_dir / "speech.srt")
        files["rawSubtitles"] = str(output_dir / "subtitles.raw.json")
        buffer = io.StringIO(newline="")
        writer = csv.writer(buffer)
        writer.writerow(["序号", "开始(秒)", "结束(秒)", "时长(秒)", "文本"])
        for index, row in enumerate(paragraphs or subtitles, 1):
            writer.writerow([index, "%.2f" % (row["startMs"] / 1000), "%.2f" % (row["endMs"] / 1000),
                             "%.2f" % ((row["endMs"] - row["startMs"]) / 1000), row["text"]])
        (output_dir / "segments.csv").write_text(buffer.getvalue(), encoding="utf-8-sig")
        files["segments"] = str(output_dir / "segments.csv")
    result = {"ok": True, "status": "partial" if warnings else "complete", "outputDir": str(output_dir),
              "files": files, "audioLengthMs": timeline["audioLengthMs"], "audioBytes": len(audio),
              "usageCharacters": extra.get("usage_characters", 0),
              "voiceId": request.get("voice_setting", {}).get("voice_id", ""), "warnings": warnings}
    write_json(output_dir / "result.json", result)
    return result


def synthesize_speech(text, output_dir=None, config=None):
    """Agent-callable entry point: synthesize once, save MP3 and timeline files."""
    config = dict(config if config is not None else settings())
    build_request(text, config)  # Validate before any network request.
    output = new_output_dir(output_dir)
    try:
        config["voice_id"] = choose_voice(config)
        request = build_request(text, config)
        write_json(output / "request.json", request)
        payload = call_minimax(config, "/v1/t2a_v2", request)
        return save_synthesis(payload, request, output, config)
    except (TtsError, OSError) as error:
        write_json(output / "result.json", {"ok": False, "error": str(error), "outputDir": str(output)})
        raise


def recover_synthesis(response_file, output_dir=None, config=None):
    """Re-download subtitles and decode saved audio without a billable POST."""
    config = config if config is not None else settings()
    source = Path(response_file).expanduser().resolve()
    payload = json.loads(source.read_text(encoding="utf-8"))
    request_file = source.with_name("request.json")
    request = json.loads(request_file.read_text(encoding="utf-8")) if request_file.exists() else {}
    return save_synthesis(payload, request, new_output_dir(output_dir), config)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", help="默认读取项目根目录 .env，已有环境变量优先")
    sub = parser.add_subparsers(dest="command", required=True)
    speech = sub.add_parser("synthesize", help="合成已准备好的 TTS 纯文本并保存文件")
    source = speech.add_mutually_exclusive_group(required=True)
    source.add_argument("--text-file", type=Path)
    source.add_argument("--text")
    source.add_argument("--stdin", action="store_true")
    speech.add_argument("--output-dir")
    for flag in ("voice-id", "model", "emotion"):
        speech.add_argument("--" + flag)
    for flag in ("speed", "vol", "pitch", "timeout"):
        speech.add_argument("--" + flag, type=float)
    speech.add_argument("--granularity", choices=("sentence", "word"))
    speech.add_argument("--subtitle-time-unit", choices=("auto", "ms", "s"))
    speech.add_argument("--dry-run", action="store_true", help="只校验并输出请求，不联网、不选择默认音色")
    sub.add_parser("voices", help="获取可用系统及自定义音色")
    recover = sub.add_parser("recover", help="从 response.json 恢复文件，不重新合成")
    recover.add_argument("--response-file", required=True)
    recover.add_argument("--output-dir")
    recover.add_argument("--subtitle-time-unit", choices=("auto", "ms", "s"))
    args = parser.parse_args(argv)
    try:
        load_env(args.env_file)
        overrides = {key: getattr(args, key, None) for key in (
            "voice_id", "model", "emotion", "speed", "vol", "pitch", "timeout", "granularity", "subtitle_time_unit")}
        config = settings(**overrides)
        if args.command == "voices":
            result = {"ok": True, "voices": list_voices(config)}
        elif args.command == "recover":
            result = recover_synthesis(args.response_file, args.output_dir, config)
        else:
            text = args.text_file.read_text(encoding="utf-8-sig") if args.text_file else (
                sys.stdin.read() if args.stdin else args.text)
            if args.dry_run:
                result = {"ok": True, "dryRun": True, "request": build_request(text, config),
                          "voiceSelection": "configured" if config["voice_id"] else "automatic-at-synthesis"}
            else:
                result = synthesize_speech(text, args.output_dir, config)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (TtsError, OSError, ValueError) as error:
        message = str(error)
        secret = os.environ.get("MINIMAX_API_KEY", "")
        if secret:
            message = message.replace(secret, "[REDACTED]")
        print(json.dumps({"ok": False, "error": message}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
