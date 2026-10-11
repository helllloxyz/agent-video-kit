#!/usr/bin/env python3
"""按顶层 ## 小节拆分 UTF-8 Markdown，仅使用 Python 标准库。"""

import argparse
from pathlib import Path
import re
import sys


HEADING = re.compile(r"^ {0,3}##(?:[ \t]+(.*)|[ \t]*)$")
FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})([^\r\n]*)$")


def split_sections(text):
    """保留原文与换行；导语归第一节，忽略围栏代码和 YAML front matter。"""
    lines = text.splitlines(keepends=True)
    headings = []
    fence = None
    in_frontmatter = False
    in_comment = False
    offset = 0

    for index, line in enumerate(lines):
        content = line.rstrip("\r\n")
        if index == 0:
            content = content.removeprefix("\ufeff")
            in_frontmatter = content == "---"
            if in_frontmatter:
                offset += len(line)
                continue
        if in_frontmatter:
            if content in ("---", "..."):
                in_frontmatter = False
        elif fence:
            marker, length = fence
            if re.fullmatch(r" {0,3}" + re.escape(marker) + r"{" + str(length) + r",}[ \t]*", content):
                fence = None
        elif in_comment:
            if "-->" in content:
                in_comment = False
        elif re.match(r"^ {0,3}<!--", content):
            in_comment = "-->" not in content[content.index("<!--") + 4:]
        else:
            opening = FENCE.fullmatch(content)
            if opening and not (opening[1][0] == "`" and "`" in opening[2]):
                fence = (opening[1][0], len(opening[1]))
            else:
                heading = HEADING.fullmatch(content)
                if heading:
                    title = re.sub(r"[ \t]+#+[ \t]*$", "", heading[1] or "").strip()
                    headings.append((offset, title or "未命名小节"))
        offset += len(line)

    if not headings:
        return [("全文", text)]

    sections = []
    for index, (start, title) in enumerate(headings):
        # 第一份从文件开头开始，因此原文不会遗失或重复。
        if index == 0:
            start = 0
        end = headings[index + 1][0] if index + 1 < len(headings) else len(text)
        sections.append((title, text[start:end]))
    return sections


def pack_sections(sections, max_chars):
    """仅在完整小节之间切分；超长单节保持完整。"""
    if max_chars is None:
        return sections
    chunks = []
    title = None
    parts = []
    size = 0
    for section_title, content in sections:
        if parts and size + len(content) > max_chars:
            chunks.append((title, "".join(parts)))
            title, parts, size = None, [], 0
        if not parts:
            title = section_title
        parts.append(content)
        size += len(content)
    if parts:
        chunks.append((title, "".join(parts)))
    return chunks


def filename_title(title):
    title = re.sub(r'[<>:"/\\|?*\x00-\x1f\x7f]', "_", title)
    return title.strip(" .")[:60] or "未命名小节"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="输入 Markdown 文件路径（UTF-8）")
    parser.add_argument("-o", "--output-dir", type=Path, help="输出目录，默认：原文件名_split")
    parser.add_argument("--max-chars", type=int, help="合并相邻小节的字符数目标；包含标点、空格和换行，不是 token 数；绝不拆开单节")
    parser.add_argument("--dry-run", action="store_true", help="只预览拆分结果，不写文件")
    args = parser.parse_args()
    if args.max_chars is not None and args.max_chars <= 0:
        parser.error("--max-chars 必须大于 0")

    source = args.input.expanduser().resolve()
    output = (args.output_dir.expanduser() if args.output_dir else source.parent / (source.stem + "_split")).resolve()
    try:
        with source.open("r", encoding="utf-8", newline="") as handle:
            original = handle.read()
        sections = split_sections(original)
        chunks = pack_sections(sections, args.max_chars)
        if "".join(content for _, content in chunks) != original:
            raise ValueError("拆分内容校验失败")
        planned = [(output / f"{index:03d}_{filename_title(title)}.md", content)
                   for index, (title, content) in enumerate(chunks, start=1)]
        if any(path == source for path, _ in planned):
            raise ValueError("输出文件不能与源文件相同")
        if not args.dry_run:
            if output.exists() and (not output.is_dir() or any(output.iterdir())):
                raise ValueError(f"输出目录已存在且非空，请指定一个新目录：{output}")
            output.mkdir(parents=True, exist_ok=True)
            for path, content in planned:
                with path.open("x", encoding="utf-8", newline="") as handle:
                    handle.write(content)
        for path, content in planned:
            print(f"{path.name}  {len(content)} 字符")
            if args.max_chars and len(content) > args.max_chars:
                print("  提示：这一小节超过字符数目标，已保持完整。", file=sys.stderr)
        print(f"{'预览' if args.dry_run else '已输出'} {len(chunks)} 份；目录：{output}")
    except (OSError, UnicodeError, ValueError) as error:
        parser.exit(1, f"错误：{error}\n")


if __name__ == "__main__":
    main()
