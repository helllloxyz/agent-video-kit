// All public time values use seconds. No scene module is imported implicitly.
const visibleLength = (s) => [...s.replace(/[\s，。、：；“”"‘’（）()？！…—,.:;?!]/g, '')].length;
const positive = (v) => Number.isFinite(v) && v > 0;

export function splitCaption(text, maxChars = 30) {
  const result = []; let current = '';
  for (const ch of text) {
    current += ch;
    if ([...current].length >= maxChars || /[。；？！]/.test(ch)) { result.push(current); current = ''; }
  }
  if (current) result.push(current);
  return result;
}

export function buildTimeline(scenes, options = {}) {
  if (!Array.isArray(scenes) || !scenes.length) throw new Error('scenes 必须是非空数组');
  const timed = scenes.every((s) => Number.isFinite(s.start) && Number.isFinite(s.end));
  if (!timed && scenes.some((s) => s.start !== undefined || s.end !== undefined)) throw new Error('不能混用显式时间与阅读速度估算');
  const speed = options.charsPerSecond ?? 4.6;
  if (!positive(speed)) throw new Error('charsPerSecond 必须大于零');
  let t = 0;
  const out = [], estimated = [];
  for (const s of scenes) {
    if (typeof s.chapter !== 'string' || typeof s.draw !== 'function') throw new Error('每个场景需要 chapter 和 draw(ctx, T)');
    if (timed) {
      if (s.start < t || s.end <= s.start) throw new Error('场景时间必须有序、不重叠且 end > start');
      const beats = s.beats ?? [s.start];
      if (!beats.length || beats.some((b, i) => !Number.isFinite(b) || b < s.start || b >= s.end || (i > 0 && b <= beats[i - 1]))) throw new Error('beats 必须是场景内严格递增的绝对秒数');
      out.push({scene: s, start: s.start, end: s.end, beats});
      t = s.end;
      continue;
    }
    if (!Array.isArray(s.lines) || !s.lines.length) throw new Error('无声场景需要非空 lines，或显式提供 start/end');
    const start = t; t += 0.8;
    const beats = [];
    for (const entry of s.lines) {
      const [text, extra = 0] = Array.isArray(entry) ? entry : [entry, 0];
      if (typeof text !== 'string' || !text.trim() || !Number.isFinite(extra) || extra < 0) throw new Error('lines 需要文本或 [文本, 非负额外停留秒数]');
      const read = Math.max(2.6, visibleLength(text) / speed + 0.6), dur = read + extra;
      beats.push(t);
      const pieces = splitCaption(text), total = pieces.reduce((a, p) => a + Math.max(1, visibleLength(p)), 0);
      let ct = t;
      pieces.forEach((p, i) => {
        const d = i === pieces.length - 1 ? t + dur - ct : read * Math.max(1, visibleLength(p)) / total;
        estimated.push({start: ct, end: ct + d, text: p}); ct += d;
      });
      t += dur;
    }
    t += 1.4;
    out.push({scene: s, start, end: t, beats});
  }
  const duration = options.duration ?? t;
  if (!positive(duration) || duration < t) throw new Error('duration 不能短于场景总时间');
  const captions = options.captions ?? estimated;
  if (!Array.isArray(captions)) throw new Error('captions 必须是数组');
  let last = 0;
  for (const c of captions) {
    if (!Number.isFinite(c.start) || !Number.isFinite(c.end) || c.start < last || c.end <= c.start || c.end > duration || typeof c.text !== 'string') throw new Error('字幕时间必须有序、不重叠且位于总时长内');
    last = c.end;
  }
  return {scenes: out, captions, duration, timing: timed ? 'explicit' : 'reading_speed_estimate'};
}

const pad = (n, w = 2) => String(n).padStart(w, '0');
export function srtTime(sec) {
  const ms = Math.round(sec * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`;
}
export function toSrt(captions) {
  return captions.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n');
}
export function chapterMetadata(scenes) {
  const escape = (s) => s.replace(/\\/g, '\\\\').replace(/[=;#]/g, '\\$&').replace(/\r?\n/g, ' ');
  return ';FFMETADATA1\n' + scenes.map((s) => `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${Math.round(s.start * 1000)}\nEND=${Math.round(s.end * 1000)}\ntitle=${escape(s.scene.chapter)}\n`).join('');
}
