"""Local HTTP integration tests; no MiniMax traffic or billable requests."""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools import minimax_tts as tts


class TtsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.requests = []
        self.subtitle_fails = False
        self.status_code = 0
        self.audio_hex = b"ID3-local-test-audio".hex()
        test = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def send_json(self, body, status=200):
                raw = json.dumps(body, ensure_ascii=False).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                test.requests.append((self.path, self.headers.get("Authorization"), body))
                if self.path == "/v1/get_voice":
                    self.send_json({"base_resp": {"status_code": 0}, "system_voice": [
                        {"voice_id": "english-voice", "description": ["English"]},
                        {"voice_id": "chinese-voice", "description": ["Mandarin", "中文"]}]})
                elif self.path == "/v1/t2a_v2":
                    self.send_json({"base_resp": {"status_code": test.status_code},
                                    "data": {"audio": test.audio_hex, "subtitle_file": test.base + "/subtitles"},
                                    "extra_info": {"audio_length": 3200, "usage_characters": 8}})
                else:
                    self.send_json({}, 404)

            def do_GET(self):
                test.requests.append((self.path, self.headers.get("Authorization"), None))
                self.send_json([{ "text": "你好，世界。", "time_begin": 0, "time_end": 3200}],
                               404 if test.subtitle_fails else 200)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.base = "http://127.0.0.1:%s" % self.server.server_port
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.env = patch.dict(os.environ, {"MINIMAX_API_KEY": "test-secret", "MINIMAX_BASE_URL": self.base}, clear=True)
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def config(self, **kwargs):
        return tts.settings(**kwargs)

    def output(self, name="out"):
        return self.root / name

    def test_key_only_automatically_chooses_chinese_and_saves_artifacts(self):
        text = "你好，世界。\n"
        result = tts.synthesize_speech(text, self.output(), self.config())
        self.assertEqual(result["status"], "complete")
        self.assertEqual(result["voiceId"], "chinese-voice")
        self.assertEqual(Path(result["files"]["audio"]).read_bytes(), bytes.fromhex(self.audio_hex))
        self.assertEqual([row[0] for row in self.requests], ["/v1/get_voice", "/v1/t2a_v2", "/subtitles"])
        self.assertEqual(self.requests[1][1], "Bearer test-secret")
        self.assertIsNone(self.requests[2][1])
        request = self.requests[1][2]
        self.assertEqual(request["text"], text)
        self.assertEqual(request["audio_setting"]["format"], "mp3")
        self.assertTrue(request["subtitle_enable"])
        timeline = json.loads(Path(result["files"]["timeline"]).read_text())
        self.assertEqual(timeline["paragraphs"][0]["endMs"], 3200)
        self.assertIn("00:00:03,200", Path(result["files"]["srt"]).read_text())
        self.assertTrue(Path(result["files"]["segments"]).exists())
        for path in self.output().iterdir():
            self.assertNotIn(b"test-secret", path.read_bytes())

    def test_explicit_voice_skips_voice_lookup(self):
        tts.synthesize_speech("你好，世界。", self.output(), self.config(voice_id="my-voice", speed=1.1, pitch=-2))
        self.assertEqual(self.requests[0][0], "/v1/t2a_v2")
        self.assertEqual(self.requests[0][2]["voice_setting"],
                         {"voice_id": "my-voice", "speed": 1.1, "vol": 1, "pitch": -2})

    def test_failed_subtitle_keeps_paid_audio_then_recovery_uses_no_post_or_key(self):
        self.subtitle_fails = True
        result = tts.synthesize_speech("你好，世界。", self.output(), self.config(voice_id="voice"))
        self.assertEqual(result["status"], "partial")
        self.assertTrue(Path(result["files"]["audio"]).exists())
        self.assertNotIn("srt", result["files"])
        self.subtitle_fails = False
        self.requests.clear()
        recovered = tts.recover_synthesis(result["files"]["response"], self.output("recovered"), self.config(api_key=""))
        self.assertEqual(recovered["status"], "complete")
        self.assertEqual([row[0] for row in self.requests], ["/subtitles"])
        self.assertIsNone(self.requests[0][1])

    def test_provider_error_is_not_retried(self):
        self.status_code = 1008
        with self.assertRaisesRegex(tts.TtsError, "余额不足"):
            tts.synthesize_speech("你好", self.output(), self.config(voice_id="voice"))
        self.assertEqual(len(self.requests), 1)
        self.assertFalse((self.output() / "speech.mp3").exists())
        self.assertFalse(json.loads((self.output() / "result.json").read_text())["ok"])

    def test_bad_hex_response_is_preserved(self):
        self.audio_hex = "abc"
        with self.assertRaisesRegex(tts.TtsError, "hex"):
            tts.synthesize_speech("你好", self.output(), self.config(voice_id="voice"))
        self.assertTrue((self.output() / "response.json").exists())
        self.assertEqual(len(self.requests), 1)

    def test_validation_before_network_and_no_overwrite(self):
        for text in (" ", "字" * 9001, "😀" * 4501):
            with self.assertRaises(tts.TtsError):
                tts.synthesize_speech(text, self.output(), self.config())
        for kwargs in ({"speed": 0}, {"pitch": 1.5}, {"vol": float("nan")}, {"timeout": -1}):
            with self.assertRaises(tts.TtsError):
                self.config(**kwargs)
        self.output().mkdir()
        (self.output() / "existing.mp3").write_bytes(b"keep")
        with self.assertRaisesRegex(tts.TtsError, "必须为空"):
            tts.synthesize_speech("你好", self.output(), self.config())
        self.assertEqual(self.requests, [])
        self.assertEqual((self.output() / "existing.mp3").read_bytes(), b"keep")

    def test_subtitle_units_fields_and_bad_values(self):
        raw = {"data": {"subtitles": [{"word": "好", "start": .2, "end": 1.5}]}}
        self.assertEqual(tts.normalize_subtitles(raw)[0]["endMs"], 1500)
        self.assertEqual(tts.normalize_subtitles(raw, "ms")[0]["endMs"], 2)
        self.assertEqual(tts.normalize_subtitles([{"text": "好", "time_begin": 0, "time_end": 40}])[0]["endMs"], 40)
        self.assertEqual(tts.normalize_subtitles([{"text": "好", "startMs": 0, "endMs": 40}])[0]["endMs"], 40)
        self.assertEqual(tts.normalize_subtitles([{"text": "坏", "start": "nan", "end": 1}]), [])

    def test_paragraph_alignment_excludes_pause_and_sound_tags(self):
        timeline = tts.align_paragraphs("你好<#0.5#>\n世界(breath)", [
            {"text": "你好世界", "startMs": 0, "endMs": 4000}])
        self.assertEqual([row["endMs"] for row in timeline], [2000, 4000])
        self.assertEqual(tts.align_paragraphs("完全不同的长文", [{"text": "好", "startMs": 0, "endMs": 1000}]), [])

    def test_cloned_script_loads_own_env_from_unrelated_cwd(self):
        clone = self.root / "clone"
        (clone / "tools").mkdir(parents=True)
        shutil.copyfile(tts.__file__, clone / "tools" / "minimax_tts.py")
        (clone / ".env").write_text("MINIMAX_API_KEY=test-secret\nMINIMAX_BASE_URL=%s\n" % self.base)
        script = clone / "tools" / "minimax_tts.py"
        process = subprocess.run([sys.executable, str(script), "synthesize", "--text", "你好，世界。"],
                                 cwd=self.root, env={}, capture_output=True, text=True)
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertEqual(len(process.stdout.splitlines()), 1)
        result = json.loads(process.stdout)
        self.assertTrue(Path(result["outputDir"]).is_relative_to(clone.resolve() / "outputs"))
        self.assertEqual(result["voiceId"], "chinese-voice")

    def test_dry_run_needs_no_key_and_does_not_call_api(self):
        process = subprocess.run([sys.executable, tts.__file__, "synthesize", "--text", "你好<#0.5#>世界", "--dry-run"],
                                 cwd=self.root, env={}, capture_output=True, text=True)
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertTrue(json.loads(process.stdout)["dryRun"])
        self.assertEqual(self.requests, [])

    def test_env_parser_does_not_execute_shell_and_environment_wins(self):
        env_file = self.root / "custom.env"
        env_file.write_text("MINIMAX_API_KEY=other\nMINIMAX_VOICE_ID='literal$(echo bad)'\n")
        tts.load_env(env_file)
        self.assertEqual(os.environ["MINIMAX_API_KEY"], "test-secret")
        self.assertEqual(os.environ["MINIMAX_VOICE_ID"], "literal$(echo bad)")


if __name__ == "__main__":
    unittest.main()
