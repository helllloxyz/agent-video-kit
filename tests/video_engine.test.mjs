import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {buildTimeline, splitCaption, toSrt, chapterMetadata, chapterList} from '../tools/video_engine/timeline.mjs';
import {latexToText, splitUnits, sentenceUnits, expandSegments} from '../tools/video_engine/captions.mjs';
import {loadPrepared} from '../tools/video_engine/story.mjs';

const draw = () => {};
const root = fileURLToPath(new URL('../', import.meta.url));
const ready = existsSync(join(root, '.local-deps/video/node_modules/@napi-rs/canvas'));

test('reading captions preserve all Unicode characters and punctuation', () => {
  const text = '中文🙂 and English。'.repeat(20);
  assert.equal(splitCaption(text).join(''), text);
  assert.ok(splitCaption(text).every((s) => [...s].length <= 30));
  const tl = buildTimeline([{chapter: '示例', lines: [[text, 0.5]], draw}]);
  assert.equal(tl.captions.map((c) => c.text).join(''), text);
  assert.equal(tl.timing, 'reading_speed_estimate');
  assert.ok(tl.captions.every((c) => c.end > c.start && c.end <= tl.duration));
});

test('explicit timing retains provided timestamps and rejects overlap or mixed modes', () => {
  const scenes = [{chapter: '一', start: 0, end: 1, beats: [0, 0.5], draw}, {chapter: '二', start: 1, end: 2, draw}];
  const captions = [{start: 0.1, end: 0.9, text: '测试'}];
  const tl = buildTimeline(scenes, {captions});
  assert.equal(tl.timing, 'explicit');
  assert.deepEqual(tl.captions, captions);
  assert.match(toSrt(tl.captions), /00:00:00,100 --> 00:00:00,900/);
  assert.throws(() => buildTimeline([...scenes, {chapter: '三', lines: ['字'], draw}]));
  assert.throws(() => buildTimeline([scenes[0], {...scenes[1], start: 0.5}]));
  assert.throws(() => buildTimeline(scenes, {captions: [{start: 0, end: 3, text: '越界'}]}));
  assert.throws(() => buildTimeline([{...scenes[0], beats: [NaN]}]));
});

test('raw video hints cannot leak through silent lines, explicit captions or chapter labels', () => {
  assert.throws(() => buildTimeline([{chapter: '一', lines: ['正文<@ 放大 >'], draw}]), /残留视频制作提示/);
  const scene = {chapter: '一', start: 0, end: 1, draw};
  assert.throws(() => buildTimeline([scene], {captions: [{start: 0, end: 1, text: '正文<@ 放大 >'}]}), /残留视频制作提示/);
  assert.throws(() => buildTimeline([{...scene, chapter: '一<@ 淡入 >'}]), /残留视频制作提示/);
  assert.equal(buildTimeline([{chapter: '一', lines: ['普通 <说明> 和 0 < x < 1'], draw}]).captions[0].text, '普通 <说明> 和 0 < x < 1');
});

test('FFmetadata escapes chapter metacharacters', () => {
  const tl = buildTimeline([{chapter: 'a=b;#\nnext', start: 0, end: 1, draw}]);
  assert.match(chapterMetadata(tl.scenes), /title=a\\=b\\;\\# next/);
});

test('consecutive scenes of one chapter form one chapter entry', () => {
  const tl = buildTimeline([{chapter: '一', start: 0, end: 1, draw}, {chapter: '一', start: 1, end: 2, draw}, {chapter: '二', start: 2, end: 65, draw}]);
  assert.equal((chapterMetadata(tl.scenes).match(/\[CHAPTER\]/g) || []).length, 2);
  assert.equal(chapterList(tl.scenes), '00:00 一\n00:02 二\n');
});

test('LaTeX becomes readable caption text', () => {
  assert.equal(latexToText(String.raw`$P(A \mid C) + P(\overline{A} \mid C) = 1$`), 'P(A|C) + P(A̅|C) = 1');
  assert.equal(latexToText(String.raw`$$x_2 > x_1 \;\Longrightarrow\; F(x_2, y) \gt F(x_1, y)$$`), 'x₂ > x₁ ⟹ F(x₂, y) > F(x₁, y)');
  assert.equal(latexToText(String.raw`$A + B = \overline{\overline{A}\,\overline{B}}$`), 'A + B = ¬(A̅ B̅)');
  assert.equal(latexToText(String.raw`$\boxed{F(a, x) = f^{-1}\big( f(a) + f(x) \big)}$`), 'F(a, x) = f⁻¹(f(a) + f(x))');
  assert.equal(latexToText(String.raw`$\mathbb{R}$`), 'ℝ');
  assert.equal(latexToText(String.raw`$v(x) = \left.\dfrac{\partial F(a,x)}{\partial a}\right|_{a=e}$`), 'v(x) = (∂F(a, x))/(∂a)|ₐ₌ₑ');
  assert.equal(latexToText(String.raw`$\frac{16}{17} \approx 94\%$`), '16/17 ≈ 94%');
  assert.equal(latexToText(String.raw`$\frac{0.8}{1+x}$`), '0.8/(1 + x)');
  assert.equal(latexToText(String.raw`$(a \ast b) \ast c$`), '(a * b) * c');
  assert.equal(latexToText(String.raw`$x \mapsto ax+b$`), 'x ↦ ax + b');
});

test('captions restore formulas, split balanced and keep Latin words whole', () => {
  const segments = [
    {kind: 'literal', ttsNormalizedRange: [0, 2]},
    {kind: 'replacement', sourceText: String.raw`$P(A \mid C)$`, ttsText: '在 C 条件下 A 的概率', ttsNormalizedRange: [2, 11]},
    {kind: 'literal', ttsNormalizedRange: [11, 40]},
  ];
  const {units} = sentenceUnits('比较在 C 条件下 A 的概率，这是一个很长的句子，用来检查 Probability as Logic 不被拆开。', 0, segments);
  const text = units.map((u) => u.text).join('');
  assert.match(text, /^比较 P\(A\|C\)，/);
  const pieces = splitUnits(units, 14);
  assert.ok(pieces.length >= 2);
  assert.ok(pieces.every((p) => !/Probabil$|^ity/.test(p.text)));
  assert.equal(pieces[pieces.length - 1].to, 1);
  assert.ok(pieces.every((p, i) => i === 0 || p.from === pieces[i - 1].to));
});

test('multi-formula replacements split by spoken lines', () => {
  const seg = {kind: 'replacement', sourceText: '1. $a=b$ 2. $c=d$', ttsText: '第一，a 等于 b\n第二，c 等于 d', ttsNormalizedRange: [10, 24]};
  const out = expandSegments([seg]);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((s) => s.ttsNormalizedRange), [[10, 17], [17, 24]]);
  assert.equal(expandSegments([{...seg, ttsNormalizedRange: [10, 30]}]).length, 1);
});

test('story scenes cover sentences contiguously and stay inside chapters', () => {
  const temp = mkdtempSync(join(tmpdir(), 'story-'));
  try {
    const file = join(temp, 'timeline.json');
    writeFileSync(file, JSON.stringify({duration: 10, audio: 'audio.flac', chapters: [{title: '一', start: 0, end: 5}, {title: '二', start: 5, end: 10}],
      sentences: [{start: 0.5, end: 2, chapter: 0, spoken: '甲乙丙丁', text: '甲乙丙丁'}, {start: 2.4, end: 4.8, chapter: 0, spoken: '戊己', text: '戊己'}, {start: 5.2, end: 9, chapter: 1, spoken: '庚辛', text: '庚辛'}],
      captions: [{start: 0.5, end: 2, text: '甲乙丙丁', sentence: 0}]}));
    const P = loadPrepared(file);
    const scenes = P.scenes([{from: 0, to: 1, beats: [0, [0, '丙'], 1], draw}, {from: 2, draw}]);
    assert.deepEqual(scenes.map((s) => [s.start, s.end, s.chapter]), [[0, 5, '一'], [5, 10, '二']]);
    assert.deepEqual(scenes[0].beats, [0.5, 1.25, 2.4]);
    assert.throws(() => P.scenes([{from: 0, to: 2, draw}]), /跨越章节/);
    assert.throws(() => P.scenes([{from: 0, draw}, {from: 2, draw}]), /应从第 1 句/);
    assert.throws(() => P.scenes([{from: 0, to: 1, draw}]), /只覆盖到/);
    assert.equal(buildTimeline(scenes, {captions: P.captions, duration: P.duration}).timing, 'explicit');
  } finally { rmSync(temp, {recursive: true, force: true}); }
});

test('direct CLI works from another cwd; stills, sheet, full, no overwrite, encoder failure', {skip: !ready}, () => {
  const temp = mkdtempSync(join(tmpdir(), 'video-engine-'));
  try {
    const scenes = join(temp, 'scenes.mjs');
    writeFileSync(scenes, "export const scenes=[{chapter:'通用示例',start:0,end:1,beats:[0],draw(c){c.fillStyle='#58C4DD';c.fillRect(100,100,500,500)}}]; export const captions=[{start:0,end:1,text:'字幕'}];");
    const output = join(temp, 'output');
    const run = (script, args) => spawnSync(process.execPath, [join(root, 'tools/video_engine', script), ...args], {cwd: temp, encoding: 'utf8', timeout: 30000});
    const base = ['--scenes', scenes, '--output-dir', output, '--fps', '5'];
    for (const mode of ['info', 'stills', 'full']) {
      const p = run('render.mjs', [mode, ...base, '--encoder', 'libx264']);
      assert.equal(p.status, 0, p.stderr);
    }
    assert.ok(existsSync(join(output, 'film.mp4')));
    assert.equal(JSON.parse(readFileSync(join(output, 'render-info.json'))).timing, 'explicit');
    const sheet = run('sheet.mjs', ['--input-dir', join(output, 'stills'), '--output-file', join(output, 'sheet.png')]);
    assert.equal(sheet.status, 0, sheet.stderr);
    assert.notEqual(run('render.mjs', ['full', ...base]).status, 0);
    const bad = run('render.mjs', ['sample', '--scenes', scenes, '--output-dir', join(temp, 'bad'), '--encoder', 'invalid']);
    assert.notEqual(bad.status, 0);
    assert.notEqual(run('sheet.mjs', ['--input-dir', join(output, 'stills'), '--prefix', 'missing', '--output-file', join(temp, 'empty.png')]).status, 0);
    // An audio stream longer than the storyboard must never be silently truncated.
    const ffmpeg = sharedFfmpeg();
    const audio = join(temp, 'long.wav');
    assert.equal(spawnSync(ffmpeg, ['-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=32000:cl=mono', '-t', '2', audio]).status, 0);
    const mismatch = run('render.mjs', ['full', ...base, '--output-dir', join(temp, 'mismatch'), '--audio', audio]);
    assert.notEqual(mismatch.status, 0);
    assert.match(mismatch.stderr, /时长与音频不一致/);
    const matchingAudio = join(temp, 'matching.wav');
    assert.equal(spawnSync(ffmpeg, ['-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=32000', '-t', '1', matchingAudio]).status, 0);
    const muxedDir = join(temp, 'muxed');
    const muxed = run('render.mjs', ['full', ...base, '--output-dir', muxedDir, '--audio', matchingAudio, '--encoder', 'libx264']);
    assert.equal(muxed.status, 0, muxed.stderr);
    const probe = spawnSync(ffmpeg, ['-hide_banner', '-i', join(muxedDir, 'film.mp4')], {encoding: 'utf8'});
    assert.match(probe.stderr, /Audio: aac/);
    assert.match(probe.stderr, /Chapter #0:0/);
  } finally { rmSync(temp, {recursive: true, force: true}); }
});

import {createRequire} from 'node:module';
function sharedFfmpeg() { return createRequire(resolve(root, '.local-deps/video/package.json'))('ffmpeg-static'); }

test('video hints survive text/audio handoff but never enter prepared captions or chapters', {skip: !ready}, () => {
  const temp = mkdtempSync(join(tmpdir(), 'video-hints-'));
  try {
    const runPython = (script, args) => spawnSync('python3', [join(root, 'tools', script), ...args],
      {encoding: 'utf8', env: {...process.env, FFMPEG: sharedFfmpeg()}, timeout: 30000});
    for (const dir of ['parts', 'tts', 'alignment', 'audio/001']) mkdirSync(join(temp, dir), {recursive: true});
    const source = join(temp, 'source.md'), part = join(temp, 'parts/001.md');
    const tts = join(temp, 'tts/001_TTS.txt'), alignment = join(temp, 'alignment/001.alignment.json');
    const manuscript = '## 第一章 <@ 标题淡入 >\n正文 $x^2$<@ 放大曲线 >。\n';
    const spoken = '第一章\n正文 x 的平方。<#0.8#>';
    writeFileSync(source, manuscript); writeFileSync(part, manuscript); writeFileSync(tts, spoken);
    const checked = runPython('check_tts.py', [part, tts, '--alignment-dir', join(temp, 'alignment')]);
    assert.equal(checked.status, 0, checked.stderr + checked.stdout);
    const audio = join(temp, 'audio/001');
    const generated = spawnSync(sharedFfmpeg(), ['-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=32000', '-t', '2', join(audio, 'speech.mp3')]);
    assert.equal(generated.status, 0, generated.stderr?.toString());
    writeFileSync(join(audio, 'request.json'), JSON.stringify({text: spoken}));
    writeFileSync(join(audio, 'result.json'), JSON.stringify({ok: true, voiceId: 'local-test', warnings: []}));
    writeFileSync(join(audio, 'timeline.json'), JSON.stringify({subtitles: [
      {text: '第一章', startMs: 0, endMs: 400}, {text: '正文x的平方。', startMs: 500, endMs: 1800},
    ]}));
    const handoff = runPython('audio_handoff.py', [temp, '--source', source]);
    assert.equal(handoff.status, 0, handoff.stderr + handoff.stdout);
    const prepare = (out) => spawnSync(process.execPath, [join(root, 'tools/video_engine/prepare.mjs'), '--job', temp, '--output-dir', out], {encoding: 'utf8', timeout: 30000});
    const out = join(temp, 'video/prepared'), prepared = prepare(out);
    assert.equal(prepared.status, 0, prepared.stderr);
    const timeline = JSON.parse(readFileSync(join(out, 'timeline.json'), 'utf8'));
    assert.deepEqual(timeline.videoHints.map((h) => h.text), ['标题淡入', '放大曲线']);
    assert.equal(timeline.videoHints[1].source, 'parts/001.md');
    assert.equal(timeline.videoHints[1].part, 1);
    assert.equal(timeline.chapters[0].title, '第一章');
    assert.match(timeline.sentences[1].text, /x²/);
    assert.doesNotMatch(JSON.stringify([...timeline.sentences, ...timeline.captions, ...timeline.chapters]), /放大曲线|标题淡入|<@/);
    assert.doesNotMatch(toSrt(timeline.captions), /放大曲线|标题淡入|<@/);
    assert.match(readFileSync(join(out, 'sentences.md'), 'utf8'), /视频制作提示/);
    assert.equal(readFileSync(source, 'utf8'), manuscript);
    const stale = JSON.parse(readFileSync(alignment, 'utf8')); delete stale.videoHints;
    writeFileSync(alignment, JSON.stringify(stale));
    assert.match(prepare(join(temp, 'stale')).stderr, /alignment 未记录视频提示/);
  } finally { rmSync(temp, {recursive: true, force: true}); }
});

test('math commands cannot silently disappear', {skip: !ready}, async () => {
  const {mathLayout} = await import('../tools/video_engine/lib.mjs');
  assert.throws(() => mathLayout(String.raw`\unknown{A}`, 40), /不受支持/);
  assert.throws(() => mathLayout(String.raw`\frac{1}{2`, 40), /花括号/);
  const box = mathLayout(String.raw`P(\overline{A}\mid B)=\frac{1}{2}`, 40);
  assert.ok(box.rules.length >= 2);
  assert.ok(box.glyphs.some((g) => g.ch === '|'));
  assert.ok(mathLayout(String.raw`x_2 > x_1 \;\Longrightarrow\; F\Big[F\big(x, y\big), z\Big]`, 40).glyphs.some((g) => g.ch === '⟹'));
  assert.throws(() => mathLayout(String.raw`\begin{aligned}a&=b\end{aligned}`, 40), /drawAligned/);
  const star = mathLayout(String.raw`a \ast b`, 40).glyphs.find((g) => g.ch === '∗');
  assert.equal(star?.kind, 'sym');
  assert.ok(star.x > mathLayout('a', 40).w + 40 * 0.2, 'binary ∗ gets operator spacing');
  assert.ok(mathLayout(String.raw`94\%`, 40).glyphs.some((g) => g.ch === '%'), 'escaped percent is drawn');
});

test('italic math (opt-in) keeps the italic correction before upright glyphs and superscripts', {skip: !ready}, async () => {
  const {mathLayout, setStyle} = await import('../tools/video_engine/lib.mjs');
  setStyle({mathItalic: true});
  try {
    const paren = (src) => mathLayout(src, 40).glyphs.find((g) => g.ch === '(').x;
    assert.equal(paren(String.raw`\c{gold}{f}(x)`), paren('f(x)'));
    assert.ok(paren('f(x)') >= mathLayout('f', 40).w + 40 * 0.12, 'the overhanging italic f gets extra room');
    const supX = (tex) => mathLayout(tex, 40).glyphs.find((g) => g.ch === '1').x;
    const gap = (base) => supX(`${base}^{-1}`) - mathLayout(base, 40).w;
    assert.ok(gap('f') > gap('a') && gap('a') > gap('2'), 'superscripts after italic letters get italic correction, most after f');
  } finally { setStyle({mathItalic: false}); }
});

test('default style: Song text when a Regular face exists, sans captions, upright math; setStyle overrides', {skip: !ready}, async () => {
  const {setStyle, fontStr, registerFont, mathLayout, STYLE, fontStatus, C} = await import('../tools/video_engine/lib.mjs');
  const saved = {...STYLE};
  try {
    assert.deepEqual(saved, {text: 'song', caption: 'sans', mathItalic: false});
    assert.equal(C.bg, '#1d1c1a');
    assert.ok(C.panel && C.clay, 'palette exposes panel and accent tokens');
    assert.doesNotMatch(fontStr('it', 40), /italic/);
    const song = fontStatus.find((s) => s.family === 'Song');
    assert.match(fontStr('hei', 40, 'bold'), song.usable ? /^bold 40px "Song"/ : /^bold 40px "Hei"/, 'Song falls back to Hei without a Regular face');
    if (!song.usable) assert.match(song.note, /setup_fonts\.py/);
    assert.match(fontStr('sans', 40), /"Hei"/, 'sans always stays Hei, e.g. for captions');
    const paren = mathLayout('f(x)', 40).glyphs.find((g) => g.ch === '(').x;
    assert.ok(paren < mathLayout('f', 40).w + 40 * 0.05, 'upright letters get no italic correction');
    setStyle({text: 'sans', mathItalic: true});
    assert.match(fontStr('it', 40), /^italic /);
    assert.match(fontStr('hei', 40), /"Hei"/);
    assert.throws(() => setStyle({text: 'kai'}), /未知字体风格/);
    assert.throws(() => registerFont('Nope', '/x.ttf'), /未知字体族/);
    assert.throws(() => registerFont('Song', '/no/such/font.ttf'), /无法注册字体文件/);
  } finally { setStyle(saved); }
});

test('aligned rows split on line breaks and the first ampersand', {skip: !ready}, async () => {
  const {alignedRows} = await import('../tools/video_engine/lib.mjs');
  assert.deepEqual(alignedRows(String.raw`\begin{aligned} P &= 1 - Q \\ &= R \end{aligned}`), [['P', '= 1 - Q'], ['', '= R']]);
});
