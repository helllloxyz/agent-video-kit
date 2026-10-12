import {writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {spawn, spawnSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createCanvas, ffmpeg} from './runtime.mjs';
import {C, W, H, SAFE, smooth, clamp, drawText, textWidth, rect, fontStatus} from './lib.mjs';

const CAPTION = {top: SAFE.captionTop, size: 38};
import {buildTimeline, toSrt, chapterMetadata, chapterList} from './timeline.mjs';

const MODES = ['info', 'stills', 'sample', 'full', 'cover'];
const {values: v, positionals} = parseArgs({allowPositionals: true, options: {
  scenes: {type: 'string'}, 'output-dir': {type: 'string'}, encoder: {type: 'string', default: 'auto'},
  start: {type: 'string', default: '0'}, duration: {type: 'string'}, fps: {type: 'string', default: '30'},
  audio: {type: 'string'}, scene: {type: 'string'}, overwrite: {type: 'boolean', default: false}, help: {type: 'boolean'},
}});
if (v.help) {
  console.log('node tools/video_engine/render.mjs <info|stills|sample|full|cover> --scenes FILE --output-dir DIR [--scene 3|3-6 --start SEC --duration SEC --fps 30 --encoder auto|libx264|h264_videotoolbox --audio FILE --overwrite]');
} else {
  try { await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

async function main() {
  const mode = positionals[0] ?? 'info';
  if (positionals.length > 1 || !MODES.includes(mode)) throw new Error('未知模式；使用 --help 查看用法');
  if (!v.scenes || !v['output-dir']) throw new Error('必须显式指定 --scenes 和 --output-dir');
  const module = await import(pathToFileURL(resolve(v.scenes)));
  const output = resolve(v['output-dir']);
  if (mode === 'cover') return renderCovers(module, output);
  const TL = buildTimeline(module.scenes, {captions: module.captions, duration: module.duration});
  if (v.audio && TL.timing !== 'explicit') throw new Error('配音视频须显式指定场景和字幕时间，不能用阅读速度估算');
  if (v.audio && !existsSync(resolve(v.audio))) throw new Error('找不到 --audio 文件');
  if (v.audio) {
    const probe = spawnSync(ffmpeg, ['-hide_banner', '-i', resolve(v.audio)], {encoding: 'utf8', timeout: 15000});
    const match = probe.stderr?.match(/Duration: (\d+):(\d+):([\d.]+)/);
    if (!match || !/Audio:/.test(probe.stderr)) throw new Error('无法读取音频时长或音轨');
    const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
    if (Math.abs(seconds - TL.duration) > 0.25) throw new Error('分镜总时长与音频不一致（容差 0.25 秒）；请按实际音频调整时间轴');
  }
  const FPS = Number(v.fps), start = mode === 'sample' ? Number(v.start) : 0;
  const duration = mode === 'sample' ? Number(v.duration ?? Math.min(10, TL.duration - start)) : TL.duration;
  if (!Number.isInteger(FPS) || FPS < 1 || FPS > 120 || !Number.isFinite(start) || start < 0 || !Number.isFinite(duration) || duration <= 0 || start + duration > TL.duration + 1e-8) throw new Error('fps 或采样起点/时长越界');
  const info = {width: W, height: H, fps: FPS, duration: TL.duration, timing: TL.timing, fonts: fontStatus,
    scenes: TL.scenes.map((s) => ({chapter: s.scene.chapter, start: s.start, end: s.end, beats: s.beats}))};
  if (mode === 'info') { console.log(JSON.stringify(info, null, 2)); return; }
  const [first, last] = sceneRange(v.scene, TL.scenes.length);
  const stillFiles = TL.scenes.flatMap((s, i) => (i < first || i > last ? [] : s.beats.map((b, j) => ({
    file: join(output, 'stills', `s${String(i + 1).padStart(2, '0')}_b${String(j).padStart(2, '0')}.png`),
    time: (b + ([...s.beats.slice(1), s.end][j])) / 2,
  }))));
  const video = join(output, mode === 'sample' ? 'sample.mp4' : 'film.mp4');
  const targets = mode === 'stills' ? stillFiles.map((f) => f.file) : [video];
  if (!v.overwrite && targets.some(existsSync)) throw new Error('输出文件已存在；使用新目录或显式 --overwrite');
  mkdirSync(output, {recursive: true});
  const canvas = createCanvas(W, H), ctx = canvas.getContext('2d');
  function frame(t) {
    ctx.save(); ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    const S = TL.scenes.find((s) => t >= s.start && t < s.end);
    if (S) {
      const local = t - S.start, dur = S.end - S.start, fi = S.scene.fadeIn ?? 0.5, fo = S.scene.fadeOut ?? 0.6;
      S.scene.draw(ctx, {t: local, dur, abs: t, b: (i) => i < S.beats.length ? t - S.beats[i] : -Infinity});
      if (S.scene.label !== false) drawText(ctx, S.scene.label ?? S.scene.chapter, 60, 56, {size: 26, color: C.grey, align: 'left', alpha: 0.75});
      const fade = Math.max(fi > 0 ? 1 - smooth(local / fi) : 0, fo > 0 ? smooth((local - (dur - fo)) / fo) : 0);
      if (fade > 0) { ctx.globalAlpha = fade; ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
    }
    const cap = TL.captions.find((x) => t >= x.start && t < x.end);
    if (cap) {
      const alpha = clamp(Math.min((t - cap.start) / 0.12, (cap.end - t) / 0.12));
      const size = Math.min(CAPTION.size, CAPTION.size * (W - 160) / Math.max(1, textWidth(cap.text, CAPTION.size)));
      const w = textWidth(cap.text, size) + 56;
      rect(ctx, (W - w) / 2, CAPTION.top, w, 64, {fill: '#000000', alpha: 0.5 * alpha, r: 12});
      drawText(ctx, cap.text, W / 2, CAPTION.top + 33, {size, color: C.white, alpha});
    }
    ctx.restore();
  }
  if (mode === 'stills') {
    mkdirSync(join(output, 'stills'), {recursive: true});
    for (const item of stillFiles) { frame(item.time); writeFileSync(item.file, canvas.toBuffer('image/png')); }
    writeFileSync(join(output, 'stills-info.json'), JSON.stringify({...info, stills: stillFiles.map((f) => ({file: f.file, time: f.time}))}, null, 2));
    console.log(JSON.stringify({ok: true, stills: stillFiles.length, output})); return;
  }
  const codec = selectEncoder(v.encoder);
  if (mode === 'full') {
    const auxiliary = ['字幕.srt', 'chapters.ffmeta', '章节.txt', 'render-info.json'];
    if (!v.overwrite && auxiliary.some((name) => existsSync(join(output, name)))) throw new Error('交付文件已存在；使用新目录或 --overwrite');
    writeFileSync(join(output, '字幕.srt'), toSrt(TL.captions));
    writeFileSync(join(output, 'chapters.ffmeta'), chapterMetadata(TL.scenes));
    writeFileSync(join(output, '章节.txt'), chapterList(TL.scenes));
    writeFileSync(join(output, 'render-info.json'), JSON.stringify({...info, encoder: codec, audio: v.audio ? resolve(v.audio) : null}, null, 2));
  }
  const audioArgs = v.audio ? [...(start ? ['-ss', String(start)] : []), '-i', resolve(v.audio)] : [];
  const metadataIndex = v.audio ? '2' : '1';
  const args = [v.overwrite ? '-y' : '-n', '-hide_banner', '-loglevel', 'error',
    '-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', `${W}x${H}`, '-framerate', String(FPS), '-i', 'pipe:0',
    ...audioArgs, ...(mode === 'full' ? ['-i', join(output, 'chapters.ffmeta')] : []),
    '-map', '0:v', ...(v.audio ? ['-map', '1:a:0', '-c:a', 'aac', '-b:a', '160k'] : ['-an']),
    ...(mode === 'full' ? ['-map_metadata', metadataIndex, '-map_chapters', metadataIndex] : []),
    '-c:v', codec, ...(codec === 'libx264' ? ['-preset', 'veryfast', '-crf', '20'] : ['-b:v', '8000k']),
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-t', String(duration), video];
  const child = spawn(ffmpeg, args, {stdio: ['pipe', 'ignore', 'pipe']});
  let errors = '';
  child.stderr.on('data', (d) => { errors = (errors + d).slice(-12000); });
  child.stdin.on('error', () => {});
  const done = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`FFmpeg 失败：${errors || code}`))); });
  // Capture early encoder exits so backpressure cannot wait forever.
  done.catch(() => {});
  const began = Date.now();
  try {
    for (let i = 0; i < Math.ceil(duration * FPS); i++) {
      frame(start + i / FPS);
      const data = Buffer.from(canvas.data());
      await new Promise((resolve, reject) => child.stdin.write(data, (error) => error ? reject(error) : resolve()));
    }
    child.stdin.end(); await done;
  } catch (error) { child.kill(); await done.catch(() => {}); throw error; }
  console.log(JSON.stringify({ok: true, file: video, duration, encoder: codec, audio: Boolean(v.audio), seconds: Math.round((Date.now() - began) / 1000)}));
}

function sceneRange(spec, count) {
  if (!spec) return [0, count - 1];
  const m = spec.match(/^(\d+)(?:-(\d+))?$/);
  const a = m ? Number(m[1]) : NaN, b = m?.[2] ? Number(m[2]) : a;
  if (!m || a < 1 || b < a || b > count) throw new Error(`--scene 需为 1 到 ${count} 的序号或区间，如 3 或 3-6`);
  return [a - 1, b - 1];
}

// Covers: the scene module exports cover(ctx, {width, height}); 16:9 and 4:3 share the drawing code.
function renderCovers(module, output) {
  if (typeof module.cover !== 'function') throw new Error('分镜模块需导出 cover(ctx, {width, height})');
  const files = [['cover_16x9.png', 1920, 1080], ['cover_4x3.png', 1440, 1080]];
  if (!v.overwrite && files.some(([f]) => existsSync(join(output, f)))) throw new Error('封面已存在；使用新目录或 --overwrite');
  mkdirSync(output, {recursive: true});
  for (const [file, width, height] of files) {
    const canvas = createCanvas(width, height), ctx = canvas.getContext('2d');
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, width, height);
    module.cover(ctx, {width, height});
    writeFileSync(join(output, file), canvas.toBuffer('image/png'));
  }
  console.log(JSON.stringify({ok: true, covers: files.map(([f]) => join(output, f))}));
}

function selectEncoder(requested) {
  function available(codec) {
    return spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=size=64x64:rate=1', '-frames:v', '1', '-c:v', codec, '-f', 'null', '-'], {timeout: 15000}).status === 0;
  }
  if (!['auto', 'libx264', 'h264_videotoolbox'].includes(requested)) throw new Error('encoder 必须为 auto、libx264 或 h264_videotoolbox');
  if (requested !== 'auto') { if (!available(requested)) throw new Error(`编码器不可用：${requested}`); return requested; }
  if (process.platform === 'darwin' && available('h264_videotoolbox')) return 'h264_videotoolbox';
  if (available('libx264')) return 'libx264';
  throw new Error('没有可用的 H.264 编码器');
}
