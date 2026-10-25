#!/usr/bin/env python3
"""对照 Markdown 源稿检查 MiniMax TTS 文本。

用法：
  python3 tools/check_tts.py 源.md 输出_TTS.txt
  python3 tools/check_tts.py 源目录 输出目录

比较时忽略空白、停顿标记和允许的语气标签。源文中的公式、有序列表编号、
表格、代码、图片视为可替换片段，其余正文（半角括号按全角计）必须逐字出现。
发现错误时退出码为 1。
"""

import argparse
import json
import re
import sys
from pathlib import Path

if __package__:
    from .video_hints import strip_source_comments, video_hints
else:
    from video_hints import strip_source_comments, video_hints

ALLOWED_TAGS = ("breath", "emm", "chuckle")
TAG_DENSITY_LIMIT = 2  # 每千字

PAUSE_RE = re.compile(r"<#([^<>]*?)#>")
PAUSE_VALUE_RE = re.compile(r"^\d{1,2}(\.\d{1,2})?$")
TAG_RE = re.compile(r"\(([A-Za-z][A-Za-z-]*)\)")
ALLOWED_TAG_RE = re.compile(r"\((?:%s)\)" % "|".join(ALLOWED_TAGS))
PRONOUNCEABLE_RE = re.compile(r"[\u3400-\u9fffA-Za-z0-9]")

FENCE_RE = re.compile(r"^[ \t]*(```|~~~)[^\n]*\n.*?^[ \t]*\1[^\n]*$", re.M | re.S)
MATH_RE = re.compile(
    r"\$\$.+?\$\$|\\\[.+?\\\]|\\\(.+?\\\)|(?<!\\)\$[^$\n]+?(?<!\\)\$", re.S
)

GAP_OPEN, GAP_CLOSE = "\ue000", "\ue001"
GAP_TOKEN_RE = re.compile(GAP_OPEN + r"(\d+)" + GAP_CLOSE)

RESIDUAL_ERRORS = [
    (re.compile(r"\$"), "残留美元符号（公式定界符）"),
    (re.compile(r"\\[A-Za-z]+"), "残留 LaTeX 命令"),
    (re.compile(r"\*\*|__"), "残留加粗标记"),
    (re.compile(r"`"), "残留反引号"),
    (re.compile(r"^\s*#{1,6}\s", re.M), "残留标题井号"),
    (re.compile(r"^\s*>\s?", re.M), "残留引用前缀"),
    (re.compile(r"^\s*[-*+]\s", re.M), "残留无序列表符号"),
    (re.compile(r"[{}]"), "残留花括号"),
    (re.compile(r"\^"), "残留上标符号"),
]
RESIDUAL_WARNINGS = [
    (re.compile(r"_"), "出现下划线，确认不是 LaTeX 下标"),
    (re.compile(r"\|"), "出现竖线，确认不是未转写的公式"),
    (re.compile(r"\]\("), "疑似残留 Markdown 链接"),
]


class Gap:
    def __init__(self, kind, text, line):
        self.kind = kind
        self.text = text
        self.line = line
        self.reading = None


def offset_to_line(text, offset):
    return text.count("\n", 0, offset) + 1


def parse_source(src, visual_headings=False):
    """返回 (parts, gaps)。parts 由 ('lit', 文本, 行号列表) 和 ('gap', [gap 下标]) 交替组成。"""
    gaps = []

    def new_gap(kind, text, line):
        gaps.append(Gap(kind, text, line))
        return f"{GAP_OPEN}{len(gaps) - 1}{GAP_CLOSE}"

    def replace_block(pattern, kind, text):
        def repl(m):
            line = offset_to_line(text, m.start())
            return new_gap(kind, m.group(0), line) + "\n" * m.group(0).count("\n")

        return pattern.sub(repl, text)

    # 提示是零朗读内容，不能当作允许任意读法的 gap，否则会漏检提示泄漏。
    text = strip_source_comments(src.replace("\r\n", "\n"), preserve_layout=True)
    text = replace_block(FENCE_RE, "代码", text)
    # 在公式替换前排除展示标题，避免标题里的公式成为可任意填入读法的 gap。
    if visual_headings:
        text = re.sub(r"^[ \t]{0,3}#{1,6}(?:[ \t]+[^\n]*|[ \t]*)$", "", text, flags=re.M)
    text = replace_block(MATH_RE, "公式", text)

    items = []  # ('c', 字符, 行号) 或 ('g', gap 下标)
    for lineno, line in enumerate(text.split("\n"), start=1):
        line = process_line(line, lineno, new_gap)
        pos = 0
        for m in GAP_TOKEN_RE.finditer(line):
            items.extend(("c", ch, lineno) for ch in line[pos:m.start()] if not ch.isspace())
            items.append(("g", int(m.group(1))))
            pos = m.end()
        items.extend(("c", ch, lineno) for ch in line[pos:] if not ch.isspace())

    parts = []
    for item in items:
        if item[0] == "g":
            if parts and parts[-1][0] == "gap":
                parts[-1][1].append(item[1])
            else:
                parts.append(("gap", [item[1]]))
        else:
            if parts and parts[-1][0] == "lit" and (not visual_headings or parts[-1][2][-1] == item[2]):
                parts[-1][1].append(item[1])
                parts[-1][2].append(item[2])
            else:
                parts.append(("lit", [item[1]], [item[2]]))
    parts = [(p[0], "".join(p[1]), p[2]) if p[0] == "lit" else p for p in parts]
    return parts, gaps


def process_line(line, lineno, new_gap):
    if re.match(r"^\s*\|", line):
        return new_gap("表格", line, lineno) if line.strip() else ""
    if re.match(r"^\s{0,3}([-*_])(\s*\1){2,}\s*$", line) or re.match(r"^\s*=+\s*$", line):
        return ""
    if re.match(r"^\s*\[[^\]]+\]:\s*\S+", line):
        return ""
    line = re.sub(r"^\s{0,3}(>\s?)+", "", line)
    line = re.sub(r"^\s{0,3}#{1,6}\s+", "", line)
    line = re.sub(r"\s+#+\s*$", "", line)
    line = re.sub(r"^\s*[-*+]\s+(\[[ xX]\]\s+)?", "", line)
    line = re.sub(r"^\s*\d+[.)]\s+", lambda m: new_gap("列表编号", m.group(0).strip(), lineno), line)
    line = re.sub(r"!\[[^\]]*\]\([^)]*\)", lambda m: new_gap("图片", m.group(0), lineno), line)
    line = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", line)
    line = re.sub(r"\[([^\]]+)\]\[[^\]]*\]", r"\1", line)
    line = re.sub(r"<(https?://[^>]+)>", lambda m: new_gap("网址", m.group(1), lineno), line)
    line = re.sub(r"`([^`]+)`", lambda m: new_gap("行内代码", m.group(0), lineno), line)
    line = re.sub(r"\*\*|__|~~", "", line)
    line = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"\1", line)
    line = re.sub(r"</?[A-Za-z][^>]*>", "", line)
    line = re.sub(r"\\([\\`*_{}\[\]()#+\-.!|>~])", r"\1", line)
    return line.replace("(", "（").replace(")", "）")


def normalize_output(out):
    text = PAUSE_RE.sub("", out)
    text = ALLOWED_TAG_RE.sub("", text)
    return "".join(ch for ch in text if not ch.isspace())


def compare(parts, gaps, out_norm, alignment=None):
    errors = []
    pos = 0
    pending = None  # 前面待填的 gap 下标列表；'resync' 表示前一段比对失败
    lit_indexes = [i for i, p in enumerate(parts) if p[0] == "lit"]
    last_lit = lit_indexes[-1] if lit_indexes else -1
    trailing_gap = bool(parts) and parts[-1][0] == "gap"

    for i, part in enumerate(parts):
        if part[0] == "gap":
            if pending != "resync":
                pending = part[1]
            continue
        _, lit, lines = part
        if pending is None:
            idx = pos if out_norm.startswith(lit, pos) else -1
        elif i == last_lit and not trailing_gap:
            start = len(out_norm) - len(lit)
            idx = start if start >= pos and out_norm.endswith(lit) else -1
        else:
            idx = out_norm.find(lit, pos)

        if idx == -1:
            errors.append(diagnose(lit, lines, out_norm, pos, anchored=pending is None))
            pending = "resync"
            continue
        if isinstance(pending, list):
            assign_reading(gaps, pending, out_norm[pos:idx])
            if alignment is not None:
                alignment.append(replacement_span(gaps, pending, pos, idx, out_norm))
        if alignment is not None:
            alignment.append({"kind": "literal", "sourceLines": [lines[0], lines[-1]],
                              "sourceText": lit, "ttsNormalizedRange": [idx, idx + len(lit)],
                              "ttsNormalizedText": lit})
        pending = None
        pos = idx + len(lit)

    if isinstance(pending, list):
        assign_reading(gaps, pending, out_norm[pos:])
        if alignment is not None:
            alignment.append(replacement_span(gaps, pending, pos, len(out_norm), out_norm))
    elif pending is None and pos < len(out_norm):
        errors.append(f"输出末尾多出源文没有的文字：“{clip(out_norm[pos:], 40)}”")
    return errors


def replacement_span(gaps, ids, start, end, out_norm):
    group = [gaps[gid] for gid in ids]
    return {"kind": "replacement", "sourceLines": [group[0].line,
            max(g.line + g.text.count("\n") for g in group)],
            "sourceText": " ".join(g.text for g in group),
            "replacementKinds": [g.kind for g in group],
            "ttsNormalizedRange": [start, end], "ttsNormalizedText": out_norm[start:end]}


def output_offsets(out):
    """与 normalize_output 同步，保留非空白正文字符在原始 TTS 中的偏移。"""
    hidden = set()
    for pattern in (PAUSE_RE, ALLOWED_TAG_RE):
        for match in pattern.finditer(out):
            hidden.update(range(match.start(), match.end()))
    return [i for i, ch in enumerate(out) if i not in hidden and not ch.isspace()]


def assign_reading(gaps, ids, reading):
    for gid in ids:
        gaps[gid].reading = reading


def diagnose(lit, lines, out_norm, pos, anchored):
    def found(p):
        if anchored:
            return out_norm.startswith(lit[:p], pos)
        return out_norm.find(lit[:p], pos) != -1

    lo, hi = 0, len(lit)
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if found(mid):
            lo = mid
        else:
            hi = mid - 1
    p = lo
    line = lines[min(p, len(lines) - 1)]
    src_ctx = lit[max(0, p - 12):p] + "【此处】" + lit[p:p + 24]
    start = pos if anchored or p == 0 else out_norm.find(lit[:p], pos)
    e = start + p
    out_ctx = out_norm[max(0, e - 12):e] + "【此处】" + out_norm[e:e + 24]
    return f"源第 {line} 行附近正文不一致\n    源文：{src_ctx}\n    输出：{out_ctx}"


def check_output_format(out):
    errors, warnings = [], []

    for m in PAUSE_RE.finditer(out):
        value = m.group(1)
        ok = PAUSE_VALUE_RE.match(value) and 0.01 <= float(value) <= 99.99
        if not ok:
            errors.append(f"停顿标记格式或时长不合法：{m.group(0)}")
    stripped = PAUSE_RE.sub("", out)
    if "<#" in stripped or "#>" in stripped:
        errors.append("存在不完整的停顿标记")
    if "<!--" in stripped or "-->" in stripped:
        errors.append("TTS 中残留 HTML 注释；请排除注释后再合成")
    if "<@" in stripped or "<*" in stripped:
        errors.append("TTS 中残留已停用标记 <@ ... > 或 <* ... >；请先迁移源稿为 HTML 注释并重新提取 TTS")

    pieces = PAUSE_RE.split(out)[::2]
    if len(pieces) > 1:
        for n, piece in enumerate(pieces):
            if not PRONOUNCEABLE_RE.search(ALLOWED_TAG_RE.sub("", piece)):
                if n == 0:
                    errors.append("文件开头是停顿标记")
                elif n == len(pieces) - 1:
                    # 文末允许一个停顿；其后只能有空白，不能再跟语气标签或标点。
                    if piece.strip():
                        errors.append("文末停顿之后只能有空白")
                else:
                    errors.append(f"第 {n} 个和第 {n + 1} 个停顿标记之间没有可发音文字")

    for m in TAG_RE.finditer(out):
        if m.group(1) not in ALLOWED_TAGS:
            errors.append(f"不允许的标签或半角括号内容：{m.group(0)}")
    no_tags = TAG_RE.sub("", out)
    if "(" in no_tags or ")" in no_tags:
        errors.append(f"存在半角括号：{clip_around(no_tags, re.search(r'[()]', no_tags).start())}")

    for pattern, msg in RESIDUAL_ERRORS:
        m = pattern.search(stripped)
        if m:
            errors.append(f"{msg}：{clip_around(stripped, m.start())}")
    for pattern, msg in RESIDUAL_WARNINGS:
        m = pattern.search(stripped)
        if m:
            warnings.append(f"{msg}：{clip_around(stripped, m.start())}")

    tags = "|".join(ALLOWED_TAGS)
    if re.search(r"\((?:%s)\)\s*<#|#>\s*\((?:%s)\)" % (tags, tags), out):
        warnings.append("语气标签和停顿标记紧挨在一起")
    return errors, warnings


def clip(s, n):
    return s if len(s) <= n else s[:n] + "…"


def clip_around(s, i, n=15):
    return "…" + s[max(0, i - n):i + n].replace("\n", " ") + "…"


def md_cell(s):
    return clip(s.replace("\n", " ").replace("|", "\\|"), 120)


def check_pair(src_path, out_path, alignment_path=None, visual_headings=False):
    src = src_path.read_text(encoding="utf-8")
    out = out_path.read_text(encoding="utf-8")
    try:
        hints = video_hints(src)
        parts, gaps = parse_source(src, visual_headings=visual_headings)
    except ValueError as error:
        if alignment_path is not None:
            alignment_path.parent.mkdir(parents=True, exist_ok=True)
            alignment_path.write_text(json.dumps({"passed": False, "errors": [str(error)], "segments": []},
                                                 ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return f"## {src_path} → {out_path}\n\n结果：未通过\n\n- {error}", False
    out_norm = normalize_output(out)

    alignment = []
    errors = compare(parts, gaps, out_norm, alignment)
    # 原稿正文中的集合花括号必须原样保留；只豁免已精确匹配的正文位置，
    # 公式替换片段内的花括号仍按 LaTeX 残留检查。
    offsets = output_offsets(out)
    format_chars = list(out)
    for span in alignment:
        if span["kind"] == "literal":
            start, end = span["ttsNormalizedRange"]
            for index in offsets[start:end]:
                if out[index] in "{}":
                    format_chars[index] = " "
    fmt_errors, warnings = check_output_format("".join(format_chars))
    errors.extend(fmt_errors)

    for g in gaps:
        if g.kind == "公式" and g.reading == "":
            warnings.append(f"源第 {g.line} 行公式的读法为空，确认没有漏读：{clip(g.text, 40)}")

    tag_counts = {t: len(re.findall(r"\(%s\)" % t, out)) for t in ALLOWED_TAGS}
    total_tags = sum(tag_counts.values())
    chars = len(out_norm)
    if total_tags / max(chars, 1000) * 1000 > TAG_DENSITY_LIMIT:
        warnings.append(f"语气标签密度偏高：{total_tags} 处 / {chars} 字")

    if alignment_path is not None:
        offsets = output_offsets(out)
        for span in alignment:
            start, end = span["ttsNormalizedRange"]
            raw_start = offsets[start] if start < len(offsets) else len(out)
            raw_end = offsets[end - 1] + 1 if end > start else raw_start
            span["ttsRange"] = [raw_start, raw_end]
            span["ttsText"] = out[raw_start:raw_end]
        payload = {"source": str(src_path.resolve()), "tts": str(out_path.resolve()),
                   "passed": not errors, "errors": errors, "warnings": warnings,
                   "offsetUnit": "Python Unicode code points, zero-based, end-exclusive",
                   "note": "正文按字符串顺序精确匹配；替换片段仍需人工审阅含义。此文件不含音频时间。",
                   "visualHeadings": visual_headings, "videoHints": hints, "segments": alignment}
        alignment_path.parent.mkdir(parents=True, exist_ok=True)
        alignment_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    lines = [f"## {src_path} → {out_path}", ""]
    lines.append(f"结果：{'通过' if not errors else f'未通过（{len(errors)} 个错误）'}")
    tags = "，".join(f"{t} {c}" for t, c in tag_counts.items())
    lines.append(f"停顿 {len(PAUSE_RE.findall(out))} 处；语气标签 {tags}；正文 {chars} 字")
    if visual_headings:
        lines.append("Markdown 井号标题按只展示处理；标题仍保留在源稿及交接 headings 中。")
    if hints:
        destination = "原文与位置已写入 alignment.videoHints" if alignment_path is not None else "使用 --alignment-dir 可导出原文与位置"
        lines.append(f"视频制作提示 {len(hints)} 处，已从朗读比对中排除；{destination}。")
    if errors:
        lines += ["", "### 错误", ""]
        lines += [f"- {e}" for e in errors]
        if any(e.startswith("源第") for e in errors):
            lines.append("- （第一处正文不一致之后的比对可能连带出错，修正后重跑）")
    if warnings:
        lines += ["", "### 警告", ""]
        lines += [f"- {w}" for w in warnings]
    groups = [[gaps[gid] for gid in p[1]] for p in parts if p[0] == "gap"]
    if groups:
        lines += ["", "### 可替换片段对照", "", "| 源行 | 类型 | 原文 | 输出 |", "| --- | --- | --- | --- |"]
        for group in groups:
            kinds = "+".join(dict.fromkeys(g.kind for g in group))
            original = " ".join(g.text for g in group)
            reading = group[0].reading
            reading = "（比对失败，未定位）" if reading is None else reading
            lines.append(f"| {group[0].line} | {kinds} | {md_cell(original)} | {md_cell(reading)} |")
    return "\n".join(lines), not errors


def is_generated(path):
    return path.stem.lower().endswith("_tts")


def natural_key(path):
    return [int(s) if s.isdigit() else s for s in re.split(r"(\d+)", str(path))]


def collect_pairs(src, out):
    if src.is_file():
        target = out / f"{src.stem}_TTS.txt" if out.is_dir() else out
        return [(src, target)]
    skip_dirs = {".git", "outputs", "node_modules"}
    sources = [
        p for p in src.rglob("*")
        if p.suffix.lower() in (".md", ".markdown")
        and not is_generated(p)
        and not any(part in skip_dirs or part.startswith(".") for part in p.relative_to(src).parts)
    ]
    return [
        (p, out / p.relative_to(src).parent / f"{p.stem}_TTS.txt")
        for p in sorted(sources, key=natural_key)
    ]


def main():
    parser = argparse.ArgumentParser(description="对照源稿检查 MiniMax TTS 文本")
    parser.add_argument("source", type=Path, help="源 Markdown 文件或目录")
    parser.add_argument("output", type=Path, help="TTS 文本文件或输出目录")
    parser.add_argument("--alignment-dir", type=Path, help="另存原文与 TTS 字符串对齐 JSON；无音频时间")
    parser.add_argument("--visual-headings", action="store_true", help="井号标题只展示，不参与朗读比对；源稿标题保持不变")
    args = parser.parse_args()

    if not args.source.exists():
        sys.exit(f"源路径不存在：{args.source}")

    all_ok = True
    reports = []
    for src_path, out_path in collect_pairs(args.source, args.output):
        if not out_path.exists():
            reports.append(f"## {src_path}\n\n结果：未通过（找不到输出文件 {out_path}）")
            all_ok = False
            continue
        alignment_path = None
        if args.alignment_dir:
            relative = Path(src_path.name) if args.source.is_file() else src_path.relative_to(args.source)
            alignment_path = args.alignment_dir / relative.with_suffix(".alignment.json")
        report, ok = check_pair(src_path, out_path, alignment_path, visual_headings=args.visual_headings)
        reports.append(report)
        all_ok = all_ok and ok

    print("\n\n".join(reports) if reports else "没有找到需要检查的源文件")
    sys.exit(0 if all_ok and reports else 1)


if __name__ == "__main__":
    main()
