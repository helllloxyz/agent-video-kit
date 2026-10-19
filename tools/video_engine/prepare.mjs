// Turn an audio handoff (manifest.json + per-part audio/timeline/alignment) into one continuous
// video timeline: concatenated audio, offset sentences, source-text captions and chapter times.
import {readFileSync, writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {resolve, join, relative} from 'node:path';
import {ffmpeg} from './runtime.mjs';
import {normalizeSpoken, cleanSpoken, sentenceUnits, splitUnits, expandSegments} from './captions.mjs';

const {values: v} = parseArgs({options: {
  job: {type: 'string'}, 'output-dir': {type: 'string'}, 'caption-width': {type: 'string', default: '24'},
  captions: {type: 'string', default: 'source'}, overwrite: {type: 'boolean', default: false}, help: {type: 'boolean'},
}});
function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }
const sec = (ms) => Math.round(ms) / 1000;
const headingKey = (title) => normalizeSpoken(title.replace(/\*\*|`/g, '').replace(/\(/g, '（').replace(/\)/g, '）').replace(/\$[^$]+\$/g, ''));

function main() {
  if (!v.job) throw new Error('必须指定 --job 任务目录');
  if (!['source', 'spoken'].includes(v.captions)) throw new Error('--captions 必须为 source 或 spoken');
  const job = resolve(v.job), out = resolve(v['output-dir'] ?? join(job, 'video/prepared'));
  const maxWidth = Number(v['caption-width']);
  if (!(maxWidth >= 8 && maxWidth <= 60)) throw new Error('--caption-width 需在 8 到 60 之间');
  const manifest = readJson(join(job, 'manifest.json'));
  if (!manifest.parts?.length || manifest.parts.some((p) => !Number.isFinite(p.decodedDurationMs))) throw new Error('manifest.json 缺少各段 decodedDurationMs；先运行 python3 tools/audio_handoff.py <任务目录>');
  const targets = ['audio.flac', 'timeline.json', 'sentences.md'].map((f) => join(out, f));
  if (!v.overwrite && targets.some(existsSync)) throw new Error('输出已存在；使用新目录或 --overwrite');

  const sentences = [], headings = [], warnings = [], videoHints = [];
  let offset = 0;
  const spokenFallback = new Set();
  manifest.parts.forEach((part, index) => {
    const tts = readFileSync(join(job, part.tts), 'utf8');
    if (tts.includes('<@')) throw new Error(`第 ${index + 1} 段 TTS 稿残留视频制作提示；先检查朗读稿及音频，再准备字幕`);
    const N = normalizeSpoken(tts);
    // Sentence text is cut from the TTS script (service subtitles may drop spaces); times come from the service.
    const clean = cleanSpoken(tts), rawAt = [...clean.matchAll(/\S/gu)].map((m) => m.index);
    if (rawAt.length !== N.length) throw new Error(`第 ${index + 1} 段 TTS 稿规范化长度不一致`);
    const rawSlice = ([a, b]) => clean.slice(rawAt[a], rawAt[b - 1] + clean.slice(rawAt[b - 1]).match(/^\S/u)[0].length);
    const timeline = readJson(join(job, part.timeline));
    const alignment = part.alignment && existsSync(join(job, part.alignment)) ? readJson(join(job, part.alignment)) : null;
    if (alignment && alignment.passed === false) throw new Error(`第 ${index + 1} 段 alignment 未通过；先重新运行 check_tts.py`);
    const hints = part.videoHints ?? alignment?.videoHints ?? [];
    if (hints.length && alignment && !Array.isArray(alignment.videoHints) && v.captions === 'source') throw new Error(`第 ${index + 1} 段 alignment 未记录视频提示；先重新运行 check_tts.py --alignment-dir，避免提示进入字幕`);
    videoHints.push(...hints.map((hint) => ({...hint, part: index + 1, source: part.part})));
    if (!alignment && v.captions === 'source') warnings.push(`第 ${index + 1} 段缺少 alignment，字幕使用朗读文本`);
    const segments = expandSegments(alignment?.segments ?? []);
    let cursor = 0;
    const local = timeline.subtitles.map((s) => {
      const key = normalizeSpoken(s.text), at = N.indexOf(key, cursor);
      if (!key) return null;
      if (at < 0) throw new Error(`第 ${index + 1} 段字幕在 TTS 稿中找不到：${s.text.slice(0, 30)}`);
      if (at !== cursor) warnings.push(`第 ${index + 1} 段字幕前有 ${at - cursor} 个朗读字符没有字幕时间：${N.slice(cursor, at).slice(0, 20)}`);
      cursor = at + key.length;
      return {s, range: [at, cursor]};
    }).filter(Boolean);
    if (cursor !== N.length) warnings.push(`第 ${index + 1} 段末尾 ${N.length - cursor} 个朗读字符没有字幕时间`);
    for (const {s, range} of local) {
      const mapped = v.captions === 'source' && alignment ? sentenceUnits(rawSlice(range), range[0], segments) : {units: [...rawSlice(range)].map((ch) => ({text: ch, weight: /\s/.test(ch) ? 0 : 1})), spokenFallback: 0};
      for (const src of mapped.fallbackSources ?? []) spokenFallback.add(src.replace(/\s+/g, ' ').slice(0, 80));
      sentences.push({id: sentences.length, part: index + 1, start: sec(offset + s.startMs), end: sec(offset + s.endMs),
        spoken: rawSlice(range).replace(/\s+/g, ' '), text: mapped.units.map((u) => u.text).join('').trim(), units: mapped.units, range});
    }
    const partHeadings = part.headings ?? [...readFileSync(join(job, part.part), 'utf8').matchAll(/^ {0,3}(#{1,3})[ \t]+(.+?)[ \t]*#*[ \t]*$/gm)].map((m) => ({level: m[1].length, title: m[2].trim()}));
    for (const h of partHeadings) {
      const key = headingKey(h.title), at = N.indexOf(key);
      if (!key || at < 0) throw new Error(`第 ${index + 1} 段找不到标题朗读位置：${h.title}`);
      const owner = local.findIndex(({range}) => at >= range[0] && at < range[1]);
      if (owner < 0) throw new Error(`标题没有对应字幕时间：${h.title}`);
      const {s, range} = local[owner];
      const exact = at === range[0];
      const ms = exact ? s.startMs : s.startMs + (s.endMs - s.startMs) * (at - range[0]) / (range[1] - range[0]);
      headings.push({level: h.level, title: h.title, sourceLine: h.originalSourceLine, start: sec(offset + ms),
        sentence: sentences.length - local.length + owner, timing: exact ? 'sentence_start' : 'character_interpolation_estimate'});
    }
    offset += part.decodedDurationMs;
  });
  const duration = sec(offset);

  const chapters = headings.filter((h) => h.level === 2);
  if (!chapters.length) throw new Error('原稿没有 ## 章节标题');
  chapters[0] = {...chapters[0], start: 0};
  chapters.forEach((c, i) => { c.end = i + 1 < chapters.length ? chapters[i + 1].start : duration; });
  const chapterAt = (t) => chapters.findLastIndex((c) => t >= c.start - 1e-6);
  for (const s of sentences) s.chapter = Math.max(0, chapterAt(s.start));

  const captions = [];
  for (const s of sentences) {
    for (const piece of splitUnits(s.units, maxWidth)) {
      const start = s.start + (s.end - s.start) * piece.from, end = s.start + (s.end - s.start) * piece.to;
      const prev = captions[captions.length - 1];
      captions.push({start: Math.max(start, prev?.end ?? 0), end: Math.max(end, (prev?.end ?? 0) + 0.1), text: piece.text, sentence: s.id});
    }
  }
  for (const c of captions) { c.start = Math.round(c.start * 1000) / 1000; c.end = Math.min(duration, Math.round(c.end * 1000) / 1000); }

  mkdirSync(out, {recursive: true});
  const inputs = manifest.parts.flatMap((p) => ['-i', join(job, p.audio)]);
  const concat = spawnSync(ffmpeg, [v.overwrite ? '-y' : '-n', '-hide_banner', '-loglevel', 'error', ...inputs,
    '-filter_complex', `concat=n=${manifest.parts.length}:v=0:a=1[a]`, '-map', '[a]', '-c:a', 'flac', targets[0]], {encoding: 'utf8'});
  if (concat.status !== 0) throw new Error(`音频拼接失败：${concat.stderr}`);
  const probe = spawnSync(ffmpeg, ['-hide_banner', '-i', targets[0]], {encoding: 'utf8'}).stderr.match(/Duration: (\d+):(\d+):([\d.]+)/);
  const actual = Number(probe[1]) * 3600 + Number(probe[2]) * 60 + Number(probe[3]);
  if (Math.abs(actual - duration) > 0.1) throw new Error(`拼接音频 ${actual}s 与各段实际时长之和 ${duration}s 不一致`);

  const result = {
    source: manifest.source, job: relative(out, job) || '.', audio: 'audio.flac', duration, captionMode: v.captions,
    timing: {sentences: 'minimax_sentence_subtitles_offset_by_decoded_durations', captions: 'sentence_split_by_spoken_characters_estimate'},
    parts: manifest.parts.reduce((a, p, i) => [...a, {index: i + 1, audio: p.audio, offset: i ? a[i - 1].offset + a[i - 1].duration : 0, duration: sec(p.decodedDurationMs)}], []),
    chapters, sections: headings.filter((h) => h.level === 3), title: headings.find((h) => h.level === 1)?.title ?? null,
    videoHints, spokenFallbackFormulas: [...spokenFallback], sentences: sentences.map(({units, range, ...s}) => s), captions, warnings,
  };
  writeFileSync(targets[1], JSON.stringify(result, null, 2) + '\n');
  const fmt = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${(t % 60).toFixed(2).padStart(5, '0')}`;
  const md = ['# 句级时间表', '', '供编写分镜：`id` 即 story.mjs 中的句号；时间为整条音轨上的秒数。字幕显示原稿文本，公式按原稿还原。', ''];
  for (const [ci, c] of chapters.entries()) {
    md.push(`## ${ci}. ${c.title}（${fmt(c.start)}–${fmt(c.end)}）`, '', '| id | 开始 | 结束 | 原稿文本 |', '| ---: | ---: | ---: | --- |');
    for (const s of sentences.filter((x) => x.chapter === ci)) md.push(`| ${s.id} | ${fmt(s.start)} | ${fmt(s.end)} | ${s.text.replace(/\|/g, '\\|')} |`);
    md.push('');
  }
  if (videoHints.length) {
    md.push('## 视频制作提示（不朗读、不作为字幕，无独立时间）', '');
    for (const hint of videoHints) md.push(`- 第 ${hint.part} 段，拆分稿第 ${hint.sourceLines.join('–')} 行：${hint.text.replace(/\s+/g, ' ')}`);
    md.push('');
  }
  writeFileSync(targets[2], md.join('\n'));
  console.log(JSON.stringify({ok: true, output: out, duration, sentences: sentences.length, captions: captions.length, chapters: chapters.length, sections: result.sections.length, spokenFallbackFormulas: result.spokenFallbackFormulas, warnings}, null, 2));
}

if (v.help) console.log('node tools/video_engine/prepare.mjs --job outputs/<任务> [--output-dir <任务>/video/prepared --caption-width 24 --captions source|spoken --overwrite]');
else {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
