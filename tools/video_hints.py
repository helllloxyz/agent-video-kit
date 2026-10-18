"""识别源稿中的 <- 视频制作提示 ->，保留原位置供视频阶段使用。"""

import re

# 公式、代码、网址和 HTML 注释中的标记不作为视频提示。
MATH = r"\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|(?<!\\)\$[^$\n]+?(?<!\\)\$"
CODE = r"(?P<fence>^ {0,3}(?P<marker>`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}(?P=marker)[ \t]*(?=\r?$))|(?P<inline>`+)[^`\n]*(?P=inline)"
TOKENS = re.compile(
    rf"(?P<protected>{CODE}|{MATH}|<!--[\s\S]*?-->|<(?:https?://|mailto:)[^<>\s]+>|<#[^<>]*>)"
    r"|(?P<hint><-(?:(?!<-|->)[\s\S])*->)|(?P<unclosed><-)",
    re.M,
)


def video_hints(text):
    """返回提示正文、原文、字符范围和行号；不推断音频时间。"""
    hints = []
    for match in TOKENS.finditer(text):
        if match.lastgroup == "unclosed":
            line = text.count("\n", 0, match.start()) + 1
            raise ValueError(f"源第 {line} 行视频提示 <- ... -> 未闭合或存在嵌套")
        if match.lastgroup != "hint":
            continue
        hints.append({"text": match[0][2:-2].strip(), "sourceText": match[0],
                      "sourceRange": [match.start(), match.end()],
                      "sourceLines": [text.count("\n", 0, match.start()) + 1,
                                      text.count("\n", 0, match.end() - 1) + 1]})
    return hints


def strip_video_hints(text, preserve_layout=False):
    """排除提示；保留换行，必要时以空格保留全部偏移，原稿不变。"""
    chunks, pos = [], 0
    for hint in video_hints(text):
        start, end = hint["sourceRange"]
        chunks.append(text[pos:start])
        chunks.append("".join(ch if ch in "\r\n" else " " if preserve_layout else ""
                              for ch in text[start:end]))
        pos = end
    return "".join(chunks) + text[pos:]
