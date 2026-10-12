import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync} from 'node:fs';
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

test('math commands cannot silently disappear', {skip: !ready}, async () => {
  const {mathLayout} = await import('../tools/video_engine/lib.mjs');
  assert.throws(() => mathLayout(String.raw`\unknown{A}`, 40), /不受支持/);
  assert.throws(() => mathLayout(String.raw`\frac{1}{2`, 40), /花括号/);
  const box = mathLayout(String.raw`P(\overline{A}\mid B)=\frac{1}{2}`, 40);
  assert.ok(box.rules.length >= 2);
  assert.ok(box.glyphs.some((g) => g.ch === '|'));
  assert.ok(mathLayout(String.raw`x_2 > x_1 \;\Longrightarrow\; F\Big[F\big(x, y\big), z\Big]`, 40).glyphs.some((g) => g.ch === '⟹'));
  assert.throws(() => mathLayout(String.raw`\begin{aligned}a&=b\end{aligned}`, 40), /drawAligned/);
});

test('aligned rows split on line breaks and the first ampersand', {skip: !ready}, async () => {
  const {alignedRows} = await import('../tools/video_engine/lib.mjs');
  assert.deepEqual(alignedRows(String.raw`\begin{aligned} P &= 1 - Q \\ &= R \end{aligned}`), [['P', '= 1 - Q'], ['', '= R']]);
});
