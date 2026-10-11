import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {buildTimeline, splitCaption, toSrt, chapterMetadata} from '../tools/video_engine/timeline.mjs';

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
});
