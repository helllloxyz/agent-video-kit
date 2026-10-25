import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools import audio_handoff  # noqa: E402

SCRIPT = Path(audio_handoff.__file__)


class AudioHandoffTest(unittest.TestCase):
    def setUp(self):
        try:
            self.ffmpeg = audio_handoff.find_ffmpeg()
        except SystemExit:
            self.skipTest("FFmpeg 不可用")
        self.temp = tempfile.TemporaryDirectory()
        self.job = Path(self.temp.name)
        for name in ("parts", "tts", "alignment", "audio/001"):
            (self.job / name).mkdir(parents=True)
        self.source = self.job / "source.md"
        self.source.write_text("# 标题\n\n## 一、开场\n正文。\n\n### 小节\n更多。\n", encoding="utf-8")
        (self.job / "parts/001_一、开场.md").write_text(self.source.read_text(encoding="utf-8"), encoding="utf-8")
        text = "标题\n\n一、开场\n正文。<#0.8#>"
        (self.job / "tts/001_一、开场_TTS.txt").write_text(text, encoding="utf-8")
        (self.job / "alignment/001_一、开场.alignment.json").write_text('{"passed": true}', encoding="utf-8")
        audio = self.job / "audio/001"
        subprocess.run([self.ffmpeg, "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=32000",
                        "-t", "1.5", "-f", "wav", str(audio / "speech.mp3")], check=True)
        (audio / "request.json").write_text(json.dumps({"text": text}), encoding="utf-8")
        (audio / "result.json").write_text(json.dumps({"ok": True, "voiceId": "v", "audioLengthMs": 1500, "warnings": []}), encoding="utf-8")
        (audio / "timeline.json").write_text(json.dumps({"subtitles": [{"text": "标题", "startMs": 0, "endMs": 1400}]}), encoding="utf-8")

    def tearDown(self):
        self.temp.cleanup()

    def run_tool(self, *extra):
        return subprocess.run([sys.executable, str(SCRIPT), str(self.job), *extra], capture_output=True, text=True)

    def test_writes_manifest_with_headings_and_decoded_duration(self):
        process = self.run_tool("--source", str(self.source))
        self.assertEqual(process.returncode, 0, process.stderr + process.stdout)
        manifest = json.loads((self.job / "manifest.json").read_text(encoding="utf-8"))
        part = manifest["parts"][0]
        self.assertEqual(manifest["stage"], "audio_complete")
        self.assertAlmostEqual(part["decodedDurationMs"], 1500, delta=30)
        self.assertEqual([h["title"] for h in part["headings"]], ["标题", "一、开场", "小节"])
        self.assertEqual(part["headings"][2]["originalSourceLine"], 6)
        self.assertIn("一、开场", (self.job / "音频交接.md").read_text(encoding="utf-8"))

    def test_mismatched_request_text_is_an_error(self):
        (self.job / "audio/001/request.json").write_text(json.dumps({"text": "别的"}), encoding="utf-8")
        process = self.run_tool("--source", str(self.source))
        self.assertEqual(process.returncode, 1)
        self.assertEqual(json.loads((self.job / "manifest.json").read_text(encoding="utf-8"))["stage"], "audio_partial")

    def test_changed_source_is_rejected(self):
        self.source.write_text("改过的原稿", encoding="utf-8")
        self.assertNotEqual(self.run_tool("--source", str(self.source)).returncode, 0)

    def test_video_hints_are_handed_off_separately_from_headings(self):
        text = "## 一、开场 <!-- visual: 标题淡入 -->\n正文。\n<!-- visual: 保留对象\n## 非章节\n逐步放大 -->\n更多。\n"
        self.source.write_text(text, encoding="utf-8")
        (self.job / "parts/001_一、开场.md").write_text(text, encoding="utf-8")
        process = self.run_tool("--source", str(self.source))
        self.assertEqual(process.returncode, 0, process.stderr + process.stdout)
        row = json.loads((self.job / "manifest.json").read_text(encoding="utf-8"))["parts"][0]
        self.assertEqual([h["title"] for h in row["headings"]], ["一、开场"])
        self.assertEqual([h["text"] for h in row["videoHints"]], ["标题淡入", "保留对象\n## 非章节\n逐步放大"])
        self.assertEqual(row["videoHints"][1]["originalSourceLines"], [3, 5])
        self.assertIn("不进入配音、字幕", (self.job / "音频交接.md").read_text(encoding="utf-8"))

    def test_old_tts_containing_hints_is_not_marked_complete(self):
        text = "标题正文<* 说明 >。<#0.8#>"
        (self.job / "tts/001_一、开场_TTS.txt").write_text(text, encoding="utf-8")
        (self.job / "audio/001/request.json").write_text(json.dumps({"text": text}), encoding="utf-8")
        process = self.run_tool("--source", str(self.source))
        self.assertEqual(process.returncode, 1)
        self.assertIn("TTS 稿残留已停用标记", process.stdout)


if __name__ == "__main__":
    unittest.main()
