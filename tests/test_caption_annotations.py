import json
from pathlib import Path
import tempfile
import unittest
from tools.check_tts import check_pair


class CaptionAnnotationTests(unittest.TestCase):
    def run_pair(self, source, spoken, entries=None):
        with tempfile.TemporaryDirectory() as tmp:
            src, out, alignment = [Path(tmp)/name for name in ('s.md', 't.txt', 'a.json')]
            src.write_text(source)
            out.write_text(spoken)
            report, passed = check_pair(src, out, alignment, caption_annotations=entries)
            return passed, json.loads(alignment.read_text()), report

    def test_explicit_annotation_preserves_source_and_exact_reading(self):
        entry = {'sourceText': '阿采尔（J. Aczél）', 'spokenText': '阿采尔'}
        ok, payload, _ = self.run_pair('数学家阿采尔（J. Aczél）证明了。', '数学家阿采尔证明了。', [entry])
        self.assertTrue(ok)
        span = next(s for s in payload['segments'] if s['kind'] == 'caption_annotation')
        self.assertEqual(span['sourceText'], entry['sourceText'])
        self.assertEqual(span['ttsNormalizedText'], '阿采尔')
        self.assertEqual(span['ttsNormalizedRange'], [3, 6])
        for bad in ('数学家证明了。', '数学家别人证明了。', '数学家阿采尔否定了。', '数学家阿采尔（J. Aczél）证明了。'):
            self.assertFalse(self.run_pair('数学家阿采尔（J. Aczél）证明了。', bad, [entry])[0])
        self.assertFalse(self.run_pair('数学家阿采尔（J. Aczél）证明了。', '数学家阿采尔证明了。')[0])

    def test_mapping_does_not_allow_general_deletion(self):
        for source, spoken in [('条件（x>0）', '条件'), ('姓名（中文说明）', '姓名'), ('阿采尔证明了', '阿采尔'), ('阿采尔（J. Aczél）', '')]:
            self.assertFalse(self.run_pair(source, spoken, [{'sourceText': source, 'spokenText': spoken}])[0])

    def test_ascii_parentheses_and_mixed_term(self):
        for name, suffix in [('哈尔测度', '(Haar Measure)'), ('“左不变微分形式”', '（Maurer-Cartan 形式）')]:
            entry = {'sourceText': name+suffix, 'spokenText': name}
            self.assertTrue(self.run_pair(name+suffix+'。', name+'。', [entry])[0])

    def test_annotated_name_repeated_and_source_lines_retained(self):
        entry = {'sourceText': '阿采尔（J. Aczél）', 'spokenText': '阿采尔'}
        ok, payload, _ = self.run_pair('阿采尔（J. Aczél）。\n再看阿采尔（J. Aczél）。', '阿采尔。再看阿采尔。', [entry])
        self.assertTrue(ok)
        spans = [s for s in payload['segments'] if s['kind'] == 'caption_annotation']
        self.assertEqual([s['sourceLines'] for s in spans], [[1, 1], [2, 2]])
