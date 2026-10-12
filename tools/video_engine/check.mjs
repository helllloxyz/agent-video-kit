// Post-render check: probe streams, duration and chapters, extract evenly spaced frames and build a sheet.
import {mkdirSync, existsSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {resolve, join} from 'node:path';
import {createCanvas, loadImage, ffmpeg} from './runtime.mjs';

const {values: v} = parseArgs({options: {
  video: {type: 'string'}, 'output-dir': {type: 'string'}, count: {type: 'string', default: '24'},
  times: {type: 'string'}, overwrite: {type: 'boolean', default: false}, help: {type: 'boolean'},
}});
if (v.help) console.log('node tools/video_engine/check.mjs --video film.mp4 --output-dir DIR [--count 24 | --times 12.5,80,301 --overwrite]');
else {
  try { await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

async function main() {
  if (!v.video || !v['output-dir']) throw new Error('必须指定 --video 和 --output-dir');
  const video = resolve(v.video), out = resolve(v['output-dir']);
  if (!existsSync(video)) throw new Error('找不到视频文件');
  const sheetFile = join(out, 'frames-sheet.png');
  if (!v.overwrite && existsSync(sheetFile)) throw new Error('检查输出已存在；使用新目录或 --overwrite');
  const probe = spawnSync(ffmpeg, ['-hide_banner', '-i', video], {encoding: 'utf8'}).stderr;
  const d = probe.match(/Duration: (\d+):(\d+):([\d.]+)/);
  const duration = Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]);
  const chapters = [...probe.matchAll(/Chapter #\d+:\d+: start ([\d.]+), end ([\d.]+)\s+Metadata:\s+title\s+:\s+(.+)/g)].map((m) => ({start: Number(m[1]), end: Number(m[2]), title: m[3].trim()}));
  const videoStream = probe.match(/Video: ([^\n]+)/)?.[1] ?? null, audioStream = probe.match(/Audio: ([^\n]+)/)?.[1] ?? null;
  const count = Number(v.count);
  const times = v.times ? v.times.split(',').map(Number) : Array.from({length: count}, (_, i) => (i + 0.5) * duration / count);
  if (!times.length || times.some((t) => !(t >= 0 && t < duration))) throw new Error('抽帧时间越界');
  mkdirSync(join(out, 'frames'), {recursive: true});
  const files = [];
  for (const [i, t] of times.entries()) {
    const file = join(out, 'frames', `f${String(i + 1).padStart(3, '0')}_${t.toFixed(1)}s.png`);
    const r = spawnSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', video, '-frames:v', '1', file]);
    if (r.status !== 0) throw new Error(`抽帧失败：${t}s`);
    files.push({file, time: t});
  }
  const cols = 4, w = 480, h = 270, cv = createCanvas(cols * w, Math.ceil(files.length / cols) * h), c = cv.getContext('2d');
  c.fillStyle = '#0c0c0e'; c.fillRect(0, 0, cv.width, cv.height);
  for (const [i, f] of files.entries()) {
    c.drawImage(await loadImage(f.file), (i % cols) * w, Math.floor(i / cols) * h, w, h);
    const m = Math.floor(f.time / 60), s = (f.time % 60).toFixed(1).padStart(4, '0');
    c.fillStyle = '#ff0'; c.font = '18px sans-serif'; c.fillText(`${m}:${s}`, (i % cols) * w + 8, Math.floor(i / cols) * h + 22);
  }
  writeFileSync(sheetFile, cv.toBuffer('image/png'));
  const report = {video, duration, videoStream, audioStream, chapters, frames: files, sheet: sheetFile};
  writeFileSync(join(out, 'check.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ok: true, duration, audio: Boolean(audioStream), chapters: chapters.length, frames: files.length, sheet: sheetFile}));
}
