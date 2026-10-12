// Storyboard helpers over prepare.mjs output: scenes are written as sentence ranges, and
// start/end/beats/chapters are derived from the service timeline instead of typed by hand.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import {normalizeSpoken} from './captions.mjs';

export function loadPrepared(file) {
  const path = file instanceof URL ? fileURLToPath(file) : resolve(file);
  const data = JSON.parse(readFileSync(path, 'utf8'));
  const S = data.sentences;
  const sentence = (id) => {
    if (!Number.isInteger(id) || !S[id]) throw new Error(`句号越界：${id}（共 ${S.length} 句）`);
    return S[id];
  };

  // Time of a sentence, of a phrase inside it ([id, '词']), or of a fraction ([id, 0.5]).
  // Inside-sentence times are interpolated by spoken characters: estimates near the word, not word-level sync.
  function at(ref) {
    const [id, where = 0] = Array.isArray(ref) ? ref : [ref];
    const s = sentence(id);
    let frac = where;
    if (typeof where === 'string') {
      const all = normalizeSpoken(s.spoken), key = normalizeSpoken(where);
      let k = all.indexOf(key);
      if (k < 0) {
        // Allow phrases from the displayed source text for literal parts.
        const shown = normalizeSpoken(s.text), j = shown.indexOf(key);
        if (j < 0) throw new Error(`第 ${id} 句中找不到“${where}”`);
        k = Math.round(j * all.length / Math.max(1, shown.length));
      }
      frac = k / Math.max(1, all.length);
    }
    if (!(frac >= 0 && frac < 1)) throw new Error(`句内位置需在 [0, 1)：${JSON.stringify(ref)}`);
    return s.start + (s.end - s.start) * frac;
  }

  // specs: [{from, to, beats?, draw, ...}] in order, covering every sentence exactly once.
  // Scene boundaries sit in the pause between sentences; the first starts at 0, the last ends at duration.
  function scenes(specs) {
    let expect = 0;
    return specs.map((spec, k) => {
      const {from, to = from, beats, ...rest} = spec;
      if (from !== expect) throw new Error(`第 ${k + 1} 个场景应从第 ${expect} 句开始，实际为 ${from}`);
      if (!(to >= from)) throw new Error(`第 ${k + 1} 个场景 to 小于 from`);
      const a = sentence(from), b = sentence(to);
      if (a.chapter !== b.chapter) throw new Error(`第 ${k + 1} 个场景跨越章节（${from}–${to}）；请在章节边界拆开`);
      expect = to + 1;
      const start = from === 0 ? 0 : (S[from - 1].end + a.start) / 2;
      const end = to === S.length - 1 ? data.duration : (b.end + S[to + 1].start) / 2;
      const times = (beats ?? [from]).map((r) => Math.min(Math.max(at(r), start), end - 1e-3));
      if (times.some((t, i) => i && t <= times[i - 1])) throw new Error(`第 ${k + 1} 个场景的 beats 需严格递增`);
      return {chapter: data.chapters[a.chapter].title, ...rest, start, end, beats: times, from, to};
    }).map((scene, k, all) => {
      if (k === all.length - 1 && expect !== S.length) throw new Error(`分镜只覆盖到第 ${expect - 1} 句，共 ${S.length} 句`);
      return scene;
    });
  }

  return {...data, dir: dirname(path), audioPath: resolve(dirname(path), data.audio), sentence, at, scenes,
    captions: data.captions.map(({start, end, text}) => ({start, end, text}))};
}
