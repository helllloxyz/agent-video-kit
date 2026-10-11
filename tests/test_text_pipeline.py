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
            source.write_text("## 大章\n" + "字" * 2000)
            process = subprocess.run([sys.executable, "tools/split_markdown.py", str(source),
                                      "--output-dir", str(output)], capture_output=True, text=True)
            self.assertEqual(process.returncode, 1)
            self.assertIn("超过 --max-chars 2000", process.stderr)
            self.assertFalse(output.exists())

    def test_default_limit_and_alias(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "source.md"
            source.write_text("## 一\n" + "甲" * 1000 + "\n## 二\n" + "乙" * 1000)
            for extra, expected in (([], "预览 2 份"), (["--max-char", "3000"], "预览 1 份")):
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


if __name__ == "__main__":
    unittest.main()
