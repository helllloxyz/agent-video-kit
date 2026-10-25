"""识别 visual HTML 注释，保留源位置供视频阶段使用。"""

import re

# 代码、公式、网址和停顿标记里的注释写法均作为字面内容。
MATH = r"\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|(?<!\\)\$[^$\n]+?(?<!\\)\$"
CODE = r"(?P<fence>^ {0,3}(?P<marker>`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}(?P=marker)[ \t]*(?=\r?$))|(?P<inline>`+)[^`\n]*(?P=inline)"
TOKENS = re.compile(
    rf"(?P<protected>{CODE}|{MATH}|<(?:https?://|mailto:)[^<>\s]+>|<#[^<>]*>)"
    r"|(?P<comment><!--(?:(?!<!--|-->)[\s\S])*-->)|(?P<bad_comment><!--)"
    r"|(?P<deprecated><[@*])",
    re.M,
)


def _annotations(text):
    for match in TOKENS.finditer(text):
        if match.lastgroup == "deprecated":
            line = text.count("\n", 0, match.start()) + 1
            raise ValueError(f"源第 {line} 行使用已停用标记；请将作者说明或画面提示改为 HTML 注释")
        if match.lastgroup == "bad_comment":
            line = text.count("\n", 0, match.start()) + 1
            raise ValueError(f"源第 {line} 行 HTML 注释未闭合或存在嵌套")
        if match.lastgroup != "comment":
            continue
        body = match[0][4:-3].strip()
        visual = re.match(r"visual\s*:", body) is not None
        if visual:
            body = re.sub(r"^visual\s*:\s*", "", body)
        yield visual, {"text": body, "sourceText": match[0],
                       "sourceRange": [match.start(), match.end()],
                       "sourceLines": [text.count("\n", 0, match.start()) + 1,
                                       text.count("\n", 0, match.end() - 1) + 1]}


def video_hints(text):
    """只交接 visual 注释，不交接 author 或普通注释。"""
    return [hint for visual, hint in _annotations(text) if visual]


def _strip(text, preserve_layout, all_comments):
    chunks, pos = [], 0
    for visual, hint in _annotations(text):
        if not visual and not all_comments:
            continue
        start, end = hint["sourceRange"]
        chunks.append(text[pos:start])
        chunks.append("".join(ch if ch in "\r\n" else " " if preserve_layout else ""
                              for ch in text[start:end]))
        pos = end
    return "".join(chunks) + text[pos:]


def strip_video_hints(text, preserve_layout=False):
    """只排除画面提示；用于核对只补 visual 的副本是否改动正文。"""
    return _strip(text, preserve_layout, False)


def strip_source_comments(text, preserve_layout=False):
    """排除所有 HTML 注释，保留换行及可选偏移。"""
    return _strip(text, preserve_layout, True)
