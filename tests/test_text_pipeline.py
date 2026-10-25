"""拆分上限、正文保留、文末停顿和中英文对齐；不联网。"""

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools.check_tts import check_output_format, check_pair, output_offsets, normalize_output
from tools.split_markdown import pack_sections, split_sections
from tools.video_hints import strip_video_hints, strip_source_comments, video_hints


class TextPipelineTests(unittest.TestCase):
    def test_pack_complete_sections_and_keep_every_character(self):
        source = "# 总题\r\n\r\n## 一\r\n甲。\r\n\r\n## 二\r\n乙。\r\n\r\n## 三\r\n丙。\r\n"
        sections = split_sections(source)
        limit = len(sections[0][1]) + len(sections[1][1])
        chunks = pack_sections(sections, limit)
        self.assertEqual(len(chunks), 2)
        self.assertEqual("".join(text for _, text in chunks), source)
        self.assertTrue(all(len(text) <= limit for _, text in chunks))
        self.assertEqual(chunks[0][1], sections[0][1] + sections[1][1])

    def test_oversized_section_stops_before_output(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "source.md"
            output = Path(temp) / "parts"
            source.write_text("## 大章\n" + "字" * 3000)
            process = subprocess.run([sys.executable, "tools/split_markdown.py", str(source),
                                      "--output-dir", str(output)], capture_output=True, text=True)
            self.assertEqual(process.returncode, 1)
            self.assertIn("超过 --max-chars 3000", process.stderr)
            self.assertFalse(output.exists())

    def test_default_limit_and_alias(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "source.md"
            source.write_text("## 一\n" + "甲" * 1000 + "\n## 二\n" + "乙" * 1000)
            for extra, expected in (([], "预览 1 份"), (["--max-char", "2000"], "预览 2 份")):
                process = subprocess.run([sys.executable, "tools/split_markdown.py", str(source),
                                          "--dry-run"] + extra, capture_output=True, text=True)
                self.assertEqual(process.returncode, 0, process.stderr)
                self.assertIn(expected, process.stdout)

    def test_headings_inside_fences_and_frontmatter_are_not_boundaries(self):
        source = "---\n## 元数据\n---\n## 一\n````\n## 代码\n```\n````\n## 二\n正文"
        self.assertEqual([title for title, _ in split_sections(source)], ["一", "二"])

    def test_one_terminal_pause_is_valid_but_empty_or_stacked_are_not(self):
        self.assertEqual(check_output_format("正文。<#0.8#>\n")[0], [])
        for text in ("<#0.8#>", "<#0.8#>正文。", "正文。<#0.5#><#0.8#>",
                     "正文。<#0.8#>(breath)", "正文。<#100#>"):
            self.assertTrue(check_output_format(text)[0], text)

    def test_alignment_preserves_english_and_unicode_raw_offsets(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source, tts, target = root / "source.md", root / "tts.txt", root / "alignment.json"
            source.write_text("# 中英🙂\nCox (Richard T. Cox) 的 $P(A)$。")
            text = "中英🙂\nCox （Richard T. Cox） 的 A 的概率。<#0.8#>\n"
            tts.write_text(text)
            _, passed = check_pair(source, tts, target)
            self.assertTrue(passed)
            payload = json.loads(target.read_text())
            self.assertTrue(payload["passed"])
            for row in payload["segments"]:
                a, b = row["ttsRange"]
                self.assertEqual(text[a:b], row["ttsText"])
            self.assertEqual(payload["segments"][1]["sourceText"], "$P(A)$")
            self.assertEqual(payload["segments"][1]["ttsNormalizedText"], "A的概率")
            self.assertEqual("".join(text[i] for i in output_offsets(text)), normalize_output(text))
            tts.write_text(text.replace("Cox", "COX", 1))
            _, passed = check_pair(source, tts, target)
            self.assertFalse(passed)
            self.assertFalse(json.loads(target.read_text())["passed"])

    def test_visual_headings_and_display_material_keep_spoken_body_strict(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source, tts, target = root / "source.md", root / "tts.txt", root / "alignment.json"
            source.write_text("# 比较 $v$\n## 总量与速度\n刚才只看路程。\n"
                              "<!-- visual: 上屏内容：\n| 甲 | 100 米 |\n| 乙 | 90 米 |\n"
                              "$$v=s/t$$\n制作安排：突出时间列。 -->\n"
                              "还要比较时间。\n### 下一步\n我们再看变化。")
            spoken = "刚才只看路程。还要比较时间。我们再看变化。<#0.8#>"
            tts.write_text(spoken)
            self.assertFalse(check_pair(source, tts)[1])
            self.assertTrue(check_pair(source, tts, target, visual_headings=True)[1])
            payload = json.loads(target.read_text())
            self.assertTrue(payload["visualHeadings"])
            self.assertIn("100 米", payload["videoHints"][0]["text"])
            self.assertTrue(all(row["kind"] == "literal" for row in payload["segments"]))
            self.assertEqual(payload["segments"][0]["sourceLines"], [3, 3])
            for bad in (spoken.replace("还要比较时间。", ""),
                        "总量与速度" + spoken, "100 米" + spoken):
                tts.write_text(bad)
                self.assertFalse(check_pair(source, tts, visual_headings=True)[1])
            tts.write_text(spoken)
            run = subprocess.run([sys.executable, "tools/check_tts.py", str(source), str(tts),
                                  "--visual-headings"], capture_output=True, text=True)
            self.assertEqual(run.returncode, 0, run.stdout + run.stderr)

    def test_literal_set_braces_are_preserved_but_formula_braces_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source, tts = root / "source.md", root / "tts.txt"
            source.write_text('在 {0, 1} 上，$x^m$。')
            tts.write_text('在 {0, 1} 上，x 的 m 次方。<#0.8#>')
            self.assertTrue(check_pair(source, tts)[1])
            tts.write_text('在 {0, 1} 上，x 的 {m} 次方。<#0.8#>')
            report, passed = check_pair(source, tts)
            self.assertFalse(passed)
            self.assertIn('残留花括号', report)
            tts.write_text('在 0, 1 上，x 的 m 次方。<#0.8#>')
            self.assertFalse(check_pair(source, tts)[1])

    def test_video_hints_preserve_positions_and_do_not_split_chapters(self):
        source = "## 一 <!-- visual: 标题动画 -->\r\n正文🙂<!-- visual: 保留曲线\r\n## 这是提示，不是章节\r\n再放大 -->。\r\n## 二\r\n结束。"
        hints = video_hints(source)
        self.assertEqual(len(hints), 2)
        self.assertEqual([h["text"] for h in hints], ["标题动画", "保留曲线\r\n## 这是提示，不是章节\r\n再放大"])
        self.assertEqual(hints[1]["sourceLines"], [2, 4])
        for hint in hints:
            a, b = hint["sourceRange"]
            self.assertEqual(source[a:b], hint["sourceText"])
        clean = strip_video_hints(source, preserve_layout=True)
        self.assertEqual(len(clean), len(source))
        self.assertEqual(clean.count("\n"), source.count("\n"))
        sections = split_sections(source)
        self.assertEqual([title for title, _ in sections], ["一", "二"])
        self.assertEqual("".join(text for _, text in sections), source)

    def test_deprecated_markers_are_rejected_but_literals_are_protected(self):
        for marker in ("<@ 提示 >", "<* 说明 >", "<@ 未闭合", "<* 未闭合"):
            for operation in (video_hints, strip_source_comments, split_sections):
                with self.assertRaisesRegex(ValueError, "已停用标记"):
                    operation("正文" + marker)
        source = '`<@ 代码 >` `$x$ <* 代码 >` $x <@ y$\n```text\n<* 示例 >\n```'
        self.assertEqual(video_hints(source), [])
        self.assertEqual(strip_source_comments(source), source)

    def test_alignment_excludes_hints_without_allowing_them_as_readings(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source, tts, target = root / "source.md", root / "tts.txt", root / "alignment.json"
            source.write_text("## 示例 <!-- visual: 标题淡入 -->\n比较 $x^2$<!-- visual: 先画曲线\n再突出平方项 -->，得到结果。")
            spoken = "示例\n比较 x 的平方，得到结果。<#0.8#>"
            tts.write_text(spoken)
            report, passed = check_pair(source, tts, target)
            self.assertTrue(passed, report)
            payload = json.loads(target.read_text())
            self.assertEqual(len(payload["videoHints"]), 2)
            self.assertEqual(payload["videoHints"][1]["sourceLines"], [2, 3])
            self.assertFalse(any("<!--" in s["sourceText"] for s in payload["segments"]))
            self.assertEqual([s["sourceText"] for s in payload["segments"] if s["kind"] == "replacement"], ["$x^2$"])
            for text in (spoken.replace("示例", "示例标题淡入"), spoken + "\n<!-- visual: 镜头推进 -->"):
                tts.write_text(text)
                self.assertFalse(check_pair(source, tts)[1])
            tts.write_text(spoken)
            source.write_text("正文<@ 未闭合")
            self.assertFalse(check_pair(source, tts, target)[1])
            self.assertFalse(json.loads(target.read_text())["passed"])

    def test_html_comments_and_bridge_are_separate_from_spoken_content(self):
        source_text = ("<!-- author: 要求\n## 假标题\n-->\n## 第一章\n"
                       "> 承接上一节。\n> 现在比较变化。\n"
                       "<!-- visual: 上屏表格\n## 非章节\nx > 0\n-->\n"
                       "正文。<!-- 普通注释 -->\n## 第二章\n> 再看结果。")
        self.assertEqual([title for title, _ in split_sections(source_text)], ["第一章", "第二章"])
        hints = video_hints(source_text)
        self.assertEqual(len(hints), 1)
        self.assertIn("x > 0", hints[0]["text"])
        self.assertEqual(hints[0]["sourceLines"], [7, 10])
        start, end = hints[0]["sourceRange"]
        self.assertEqual(source_text[start:end], hints[0]["sourceText"])
        clean = strip_source_comments(source_text, preserve_layout=True)
        self.assertEqual(len(clean), len(source_text))
        self.assertIn("> 承接上一节。", clean)
        self.assertNotIn("author:", clean)
        self.assertIn("author:", strip_video_hints(source_text))
        with tempfile.TemporaryDirectory() as temp:
            src, tts, target = [Path(temp) / name for name in ("source.md", "tts.txt", "alignment.json")]
            src.write_text(source_text)
            spoken = "承接上一节。现在比较变化。正文。再看结果。<#0.8#>"
            tts.write_text(spoken)
            self.assertTrue(check_pair(src, tts, target, visual_headings=True)[1])
            for bad in (spoken.replace("承接上一节。", ""), "要求" + spoken,
                        "普通注释" + spoken, spoken + "<!-- visual: 泄漏 -->"):
                tts.write_text(bad)
                self.assertFalse(check_pair(src, tts, visual_headings=True)[1])
        for malformed in ("<!-- visual: 未结束", "<!-- author: 外层 <!-- 内层 --> -->"):
            with self.assertRaisesRegex(ValueError, "未闭合或存在嵌套"):
                video_hints(malformed)
        protected = '`<!-- visual: 代码 -->` $x<!-- visual: 公式 -->$'
        self.assertEqual(video_hints(protected), [])
        self.assertEqual(strip_source_comments(protected), protected)

    def test_unclosed_and_nested_hints_are_errors(self):
        for text in ("正文<!-- visual: 没有结束", "正文<!-- visual: 外层 <!-- 内层 --> -->"):
            with self.assertRaisesRegex(ValueError, "未闭合或存在嵌套"):
                split_sections(text)
        self.assertEqual(check_output_format("正文。<@ 未闭合")[0],
                         ["TTS 中残留已停用标记 <@ ... > 或 <* ... >；请先迁移源稿为 HTML 注释并重新提取 TTS"])
        self.assertEqual(check_output_format("正文 <说明>，0 < x < 1。<#0.8#>")[0], [])


if __name__ == "__main__":
    unittest.main()
