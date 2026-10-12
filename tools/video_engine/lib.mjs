import {existsSync} from 'node:fs';
import {createCanvas, GlobalFonts} from './runtime.mjs';

const mathFonts = ['STIX Two Text', 'STIXGeneral', 'Cambria Math', 'DejaVu Serif', 'Noto Serif', 'Times New Roman'];
const fontChoices = {
  MathUp: ['VIDEO_FONT_MATH', mathFonts, 'serif'],
  MathIt: ['VIDEO_FONT_MATH_ITALIC', mathFonts, 'serif'],
  MathSym: ['VIDEO_FONT_SYMBOL', ['STIX Two Math', 'STIXGeneral', ...mathFonts], 'serif'],
  Hei: ['VIDEO_FONT_CJK', ['Hiragino Sans GB', 'Noto Sans CJK SC', 'Noto Sans SC', 'Source Han Sans SC', 'Microsoft YaHei', 'WenQuanYi Zen Hei', 'PingFang SC', 'SimHei', 'Arial Unicode MS'], 'sans-serif'],
};
export const fontStatus = Object.entries(fontChoices).map(([family, [env, choices, fallback]]) => {
  const path = process.env[env];
  if (path) {
    const registered = existsSync(path) && GlobalFonts.registerFromPath(path, family);
    if (!registered) throw new Error(`无法注册指定字体：${env}`);
    return {family, selected: family, source: 'file', registered: true};
  }
  const selected = choices.find((name) => GlobalFonts.has(name));
  const registered = selected ? GlobalFonts.setAlias(selected, family) : false;
  return {family, selected: registered ? selected : fallback, source: registered ? 'system' : 'fallback', registered: Boolean(registered)};
});

export const W = 1920, H = 1080;
// About 5% margins; the caption band starts at captionTop, so content should stay above `bottom`.
export const SAFE = {left: 96, right: W - 96, top: 96, bottom: 940, captionTop: 968};

// Manim's palette, so the frames read as 3Blue1Brown at a glance.
export const C = {
  bg: '#0c0c0e', white: '#ffffff', grey: '#888888', dim: '#4a4a4f', faint: '#26262b',
  blue: '#58C4DD', teal: '#5CD0B3', green: '#83C167', yellow: '#F7D96F', gold: '#F0AC5F',
  red: '#FC6255', maroon: '#C55F73', purple: '#9A72AC', pink: '#D147BD',
};

export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const smooth = (t) => { t = clamp(t); return t * t * t * (t * (6 * t - 15) + 10); };
export const lerp = (a, b, t) => a + (b - a) * t;
export const ramp = (t, start, dur = 1) => smooth((t - start) / dur);

const measureCanvas = createCanvas(10, 10).getContext('2d');
const FONT = { up: 'MathUp', it: 'MathIt', sym: 'MathSym', hei: 'Hei' };
export const fontStr = (kind, size) => `${kind === 'it' ? 'italic ' : ''}${size}px "${FONT[kind] || FONT.hei}", "STIX Two Text", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif`;
function measure(ch, kind, size) { measureCanvas.font = fontStr(kind, size); return measureCanvas.measureText(ch).width; }

// ---------- a tiny TeX-like layout engine ----------
// Supports: ^{} _{} \frac{}{} \sqrt{} \overline{} \big…\Bigg \c{color}{} \t{中文} \op{ln} \m{name}{} \, \; and plain characters.
const SYM = {
  cdot: '·', times: '×', div: '÷', pm: '±', infty: '∞', to: '→', rightarrow: '→', leftarrow: '←', mapsto: '↦',
  Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔', Longrightarrow: '⟹', implies: '⟹', iff: '⟺',
  neg: '¬', land: '∧', lor: '∨', cap: '∩', cup: '∪', in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆', forall: '∀', exists: '∃',
  le: '≤', ge: '≥', leq: '≤', geq: '≥', gt: '>', lt: '<', neq: '≠', ne: '≠', approx: '≈', equiv: '≡', propto: '∝', mid: '|', vert: '|',
  ldots: '…', cdots: '⋯', dots: '…', partial: '∂', sum: '∑', prod: '∏', int: '∫', R: 'ℝ', prime: '′',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', theta: 'θ', lambda: 'λ', mu: 'μ', pi: 'π', sigma: 'σ', tau: 'τ', phi: 'ϕ', omega: 'ω',
  Delta: 'Δ', Sigma: 'Σ', Omega: 'Ω',
};
const BIG = { big: 1.2, Big: 1.45, bigg: 1.7, Bigg: 2 };
function parse(s) {
  let i = 0;
  const arg = () => {
    if (i >= s.length) throw new Error('公式缺少命令参数');
    if (s[i] === '{') { i++; return group(); }
    const ch = s[i++]; return [{ type: 'ch', ch }];
  };
  const raw = () => { let depth = 0, out = ''; if (s[i] === '{') i++; while (i < s.length) { const ch = s[i++]; if (ch === '{') depth++; if (ch === '}') { if (depth === 0) break; depth--; } out += ch; } return out; };
  function group() {
    const out = [];
    while (i < s.length) {
      const ch = s[i];
      if (ch === '}') { i++; break; }
      if (ch === '{') { i++; out.push({ type: 'group', items: group() }); continue; }
      if (ch === '^' || ch === '_') {
        i++; const a = arg(); let prev = out.pop() || { type: 'group', items: [] };
        if (prev.type !== 'script') prev = { type: 'script', base: prev };
        prev[ch === '^' ? 'sup' : 'sub'] = a; out.push(prev); continue;
      }
      if (ch === '\\') {
        i++; let name = ''; while (i < s.length && /[a-zA-Z]/.test(s[i])) name += s[i++];
        if (!name) {
          const sym = s[i++];
          if (sym === '{' || sym === '}') out.push({ type: 'ch', ch: sym });
          else out.push({ type: 'space', w: sym === ',' ? 0.17 : sym === ';' ? 0.4 : 0.28 });
          continue;
        }
        if (name === 'quad') { out.push({ type: 'space', w: 1 }); continue; }
        if (name === 'qquad') { out.push({ type: 'space', w: 2 }); continue; }
        if (SYM[name]) { out.push({ type: 'ch', ch: SYM[name] }); continue; }
        if (name === 'left' || name === 'right') continue;
        if (name === 'sqrt') { out.push({ type: 'sqrt', items: arg() }); continue; }
        if (name === 'overline') { out.push({ type: 'overline', items: arg() }); continue; }
        if (name === 'frac') { const num = arg(), den = arg(); out.push({ type: 'frac', num, den }); continue; }
        if (name === 'c') { const color = raw(); out.push({ type: 'color', color, items: arg() }); continue; }
        if (name === 'm') { const mark = raw(); out.push({ type: 'mark', mark, items: arg() }); continue; }
        if (name === 't' || name === 'text') { out.push({ type: 'text', str: raw(), kind: 'hei' }); continue; }
        if (name === 'op' || name === 'mathrm') { out.push({ type: 'text', str: raw(), kind: 'up' }); continue; }
        if (BIG[name]) { out.push({ type: 'big', scale: BIG[name], items: arg() }); continue; }
        if (name === 'begin') throw new Error('多行 aligned 公式请用 drawAligned 按行绘制');
        throw new Error(`公式命令不受支持：\\${name}；请显式转换写法或使用其他公式排版工具`);
      }
      i++; out.push({ type: 'ch', ch });
    }
    return out;
  }
  return group();
}

const OPS = new Set(['=', '+', '−', '-', '<', '>', '≤', '≥', '≠', '≡', '⟺', '⇒', '⇔', '⟹', '→', '←', '×', '÷', '±', '≈', '∝', '↦', '∈', '∉', '⊂', '⊆', '∩', '∪', '∧', '∨']);
function glyphKind(ch) {
  if (/[A-Za-zα-ωϕ]/.test(ch)) return 'it';
  if (/[\u4e00-\u9fff，。：？！“”、（）]/.test(ch)) return 'hei';
  if (/[∘∫∑∏∂⁻¹⟺⇒⇐⇔⟹→←↦≈≡≠∝≤≥−×÷±·…⋯∞¬∧∨∩∪∈∉⊂⊆∀∃ℝ√′]/.test(ch)) return 'sym';
  return 'up';
}

function layout(nodes, size, color, marks, inScript = false) {
  const box = { w: 0, asc: size * 0.7, desc: size * 0.22, glyphs: [], rules: [] };
  let prevCh = null, prevKind = null;
  const place = (b, dx, dy) => {
    for (const g of b.glyphs) box.glyphs.push({ ...g, x: g.x + dx, y: g.y + dy });
    for (const r of b.rules) box.rules.push({ ...r, x: r.x + dx, y: r.y + dy });
  };
  for (const n of nodes) {
    let b;
    if (n.type === 'ch') {
      let ch = n.ch === '-' ? '−' : n.ch;
      if (ch === ' ') { box.w += size * 0.25; continue; }
      const kind = glyphKind(ch);
      // Binary operators get space; a leading/unary minus or anything in a script does not.
      const unary = (ch === '−' || ch === '+') && (prevCh === null || OPS.has(prevCh) || prevCh === '(' || prevCh === ',');
      const pad = OPS.has(ch) && !inScript && !unary ? size * 0.24 : 0;
      // Italic correction: upright glyphs after a slanted letter would otherwise touch it, e.g. "C)" or "P(".
      if (prevKind === 'it' && kind !== 'it' && !pad) box.w += size * 0.06;
      prevKind = kind;
      const w = measure(ch, kind, size);
      box.glyphs.push({ ch, kind, size, color, x: box.w + pad, y: 0 });
      box.w += w + pad * 2 + (ch === ',' && !inScript ? size * 0.18 : 0) + (kind === 'it' ? size * 0.02 : 0);
      prevCh = ch;
      continue;
    }
    prevCh = 'x'; prevKind = null;
    if (n.type === 'space') { box.w += size * n.w; continue; }
    if (n.type === 'text') {
      const w = measure(n.str, n.kind, size);
      const chars = [...n.str];
      box.glyphs.push(...chars.map((ch, k) => ({ ch, kind: n.kind, size, color, x: box.w + measure(chars.slice(0, k).join(''), n.kind, size), y: 0 })));
      box.w += w + (n.kind === 'up' ? size * 0.08 : 0); continue;
    }
    if (n.type === 'group') b = layout(n.items, size, color, marks, inScript);
    else if (n.type === 'overline') {
      b = layout(n.items, size, color, marks, inScript);
      b.rules.push({x: size * 0.04, y: -b.asc - size * 0.14, w: Math.max(size * 0.3, b.w - size * 0.04), h: Math.max(2, size * 0.04), color});
      b.asc += size * 0.22;
    }
    else if (n.type === 'big') {
      // Scale delimiters about the math axis rather than the baseline.
      const inner = layout(n.items, size * n.scale, color, marks, inScript), dy = size * 0.25 * (n.scale - 1);
      b = { w: inner.w, asc: inner.asc - dy, desc: inner.desc + dy, glyphs: inner.glyphs.map((g) => ({ ...g, y: g.y + dy })), rules: inner.rules.map((r) => ({ ...r, y: r.y + dy })) };
    }
    else if (n.type === 'sqrt') {
      const inner = layout(n.items, size, color, marks, inScript), rs = size * 1.08, rw = measure('√', 'sym', rs);
      const top = inner.asc + size * 0.12, th = Math.max(2, size * 0.05);
      b = { w: rw + inner.w + size * 0.12, asc: top + th, desc: Math.max(inner.desc, size * 0.2), glyphs: [{ ch: '√', kind: 'sym', size: rs, color, x: 0, y: size * 0.04 }], rules: [{ x: rw - size * 0.03, y: -top, w: inner.w + size * 0.12, h: th, color }] };
      for (const g of inner.glyphs) b.glyphs.push({ ...g, x: g.x + rw + size * 0.04 });
      for (const r of inner.rules) b.rules.push({ ...r, x: r.x + rw + size * 0.04 });
    }
    else if (n.type === 'color') b = layout(n.items, size, C[n.color] || n.color, marks, inScript);
    else if (n.type === 'mark') { b = layout(n.items, size, color, marks, inScript); marks[n.mark] = { x: box.w, w: b.w, asc: b.asc, desc: b.desc }; }
    else if (n.type === 'script') {
      const base = layout([n.base], size, color, marks, inScript);
      b = { w: base.w, asc: base.asc, desc: base.desc, glyphs: [...base.glyphs], rules: [...base.rules] };
      let extra = 0;
      if (n.sup) { const s = layout(n.sup, size * 0.66, color, {}, true); for (const g of s.glyphs) b.glyphs.push({ ...g, x: g.x + base.w + size * 0.03, y: g.y - size * 0.42 }); for (const r of s.rules) b.rules.push({ ...r, x: r.x + base.w, y: r.y - size * 0.42 }); extra = Math.max(extra, s.w); b.asc = Math.max(b.asc, size * 0.42 + s.asc); }
      if (n.sub) { const s = layout(n.sub, size * 0.66, color, {}, true); for (const g of s.glyphs) b.glyphs.push({ ...g, x: g.x + base.w + size * 0.02, y: g.y + size * 0.24 }); for (const r of s.rules) b.rules.push({ ...r, x: r.x + base.w, y: r.y + size * 0.24 }); extra = Math.max(extra, s.w); b.desc = Math.max(b.desc, size * 0.24 + s.desc); }
      b.w += extra + size * 0.05;
    } else if (n.type === 'frac') {
      const fs = size * 0.86, num = layout(n.num, fs, color, {}), den = layout(n.den, fs, color, {});
      const w = Math.max(num.w, den.w) + size * 0.2, axis = -size * 0.27;
      b = { w: w + size * 0.12, asc: -axis + num.asc + num.desc + size * 0.1, desc: axis + den.asc + den.desc + size * 0.1, glyphs: [], rules: [] };
      for (const g of num.glyphs) b.glyphs.push({ ...g, x: g.x + size * 0.06 + (w - num.w) / 2, y: g.y + axis - num.desc - size * 0.1 });
      for (const r of num.rules) b.rules.push({ ...r, x: r.x + size * 0.06 + (w - num.w) / 2, y: r.y + axis - num.desc - size * 0.1 });
      for (const g of den.glyphs) b.glyphs.push({ ...g, x: g.x + size * 0.06 + (w - den.w) / 2, y: g.y + axis + den.asc + size * 0.1 });
      b.rules.push({ x: size * 0.06, y: axis, w, h: Math.max(2, size * 0.045), color });
    }
    if (b) { place(b, box.w, 0); box.w += b.w; box.asc = Math.max(box.asc, b.asc); box.desc = Math.max(box.desc, b.desc); }
  }
  return box;
}

const layoutCache = new Map();
export function mathLayout(src, size, color = C.white) {
  let depth = 0;
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '\\' && ['{', '}'].includes(src[i + 1])) { i++; continue; }
    if (src[i] === '{') depth++;
    if (src[i] === '}' && --depth < 0) throw new Error('公式花括号不匹配');
  }
  if (depth !== 0) throw new Error('公式花括号不匹配');
  const key = src + '|' + size + '|' + color;
  if (layoutCache.has(key)) return layoutCache.get(key);
  const marks = {};
  const box = layout(parse(src), size, color, marks);
  box.marks = marks;
  layoutCache.set(key, box);
  return box;
}

// Per-glyph "Write": outline sweeps in, then the fill takes over, like Manim's Write.
function drawGlyph(c, g, x, y, q, alpha) {
  if (q <= 0) return;
  c.font = fontStr(g.kind, g.size);
  const outline = q < 1 ? Math.min(1, q * 2.5) * (1 - smooth((q - 0.45) / 0.55)) : 0;
  const fill = smooth((q - 0.3) / 0.7);
  if (outline > 0.01) { c.globalAlpha = alpha * outline; c.strokeStyle = g.color; c.lineWidth = Math.max(1, g.size / 34); c.strokeText(g.ch, x, y); }
  if (fill > 0.01) { c.globalAlpha = alpha * fill; c.fillStyle = g.color; c.fillText(g.ch, x, y); }
}

function writeQ(prog, i, n) {
  if (prog >= 1) return 1;
  const w = Math.min(1, 5 / Math.max(n, 1)) * 0.9 + 0.1;
  const start = n > 1 ? (i / (n - 1)) * (1 - w) : 0;
  return clamp((prog - start) / w);
}

export function drawMath(c, src, x, y, o = {}) {
  const { size = 56, color = C.white, align = 'center', prog = 1, alpha = 1 } = o;
  if (alpha <= 0.002 || prog <= 0) return mathBounds(src, x, y, o);
  const box = mathLayout(src, size, color);
  const ox = align === 'center' ? x - box.w / 2 : align === 'right' ? x - box.w : x;
  c.save(); c.textBaseline = 'alphabetic'; c.textAlign = 'left';
  const n = box.glyphs.length + box.rules.length;
  box.glyphs.forEach((g, i) => drawGlyph(c, g, ox + g.x, y + g.y, writeQ(prog, i, n), alpha));
  box.rules.forEach((r, k) => { const q = writeQ(prog, box.glyphs.length + k, n); if (q <= 0) return; c.globalAlpha = alpha * smooth(q); c.fillStyle = r.color; c.fillRect(ox + r.x, y + r.y - r.h / 2, r.w * smooth(q), r.h); });
  c.restore();
  return mathBounds(src, x, y, o);
}

export function mathBounds(src, x, y, o = {}) {
  const { size = 56, color = C.white, align = 'center' } = o;
  const box = mathLayout(src, size, color);
  const ox = align === 'center' ? x - box.w / 2 : align === 'right' ? x - box.w : x;
  const marks = {};
  for (const [k, m] of Object.entries(box.marks)) marks[k] = { x: ox + m.x, w: m.w, cx: ox + m.x + m.w / 2, top: y - m.asc, bottom: y + m.desc };
  return { x: ox, w: box.w, top: y - box.asc, bottom: y + box.desc, marks };
}

// Rows of an aligned block: "\begin{aligned} a &= b \\ &= c \end{aligned}" → [['a', '= b'], ['', '= c']].
export function alignedRows(src) {
  return src.replace(/\\(begin|end)\{aligned\}/g, '').split(/\\\\/).map((r) => r.trim()).filter(Boolean)
    .map((r) => { const k = r.indexOf('&'); return k < 0 ? ['', r] : [r.slice(0, k).trim(), r.slice(k + 1).replace(/&/g, '').trim()]; });
}

// Multi-line derivation aligned at "&". o.progs / o.alphas give per-row write progress and opacity;
// o.colors gives per-row colors. Returns each row's bounds for highlighting.
export function drawAligned(c, src, x, y, o = {}) {
  const { size = 52, lineHeight = 1.75, align = 'center', progs = [], alphas = [], colors = [], color = C.white } = o;
  const rows = alignedRows(src);
  const lefts = rows.map(([l]) => (l ? mathLayout(l, size).w : 0)), rights = rows.map(([, r]) => mathLayout(r, size).w);
  const maxL = Math.max(...lefts), maxR = Math.max(...rights);
  const X = align === 'center' ? x + (maxL - maxR) / 2 : align === 'left' ? x + maxL : x - maxR;
  return rows.map(([l, r], i) => {
    const ry = y + i * size * lineHeight, ro = { size, color: colors[i] ?? color, prog: progs[i] ?? 1, alpha: alphas[i] ?? 1 };
    if (l) drawMath(c, l, X, ry, { ...ro, align: 'right' });
    drawMath(c, r, X, ry, { ...ro, align: 'left' });
    const top = Math.min(l ? mathBounds(l, X, ry, { size, align: 'right' }).top : Infinity, mathBounds(r, X, ry, { size, align: 'left' }).top);
    return { x: X - lefts[i], w: lefts[i] + rights[i], top, bottom: ry + size * 0.35, y: ry, anchor: X };
  });
}

// Chinese / plain text with the same write effect.
export function drawText(c, str, x, y, o = {}) {
  const { size = 40, color = C.white, align = 'center', prog = 1, alpha = 1, kind = 'hei' } = o;
  if (alpha <= 0.002 || prog <= 0) return;
  c.save(); c.font = fontStr(kind, size); c.textBaseline = 'middle'; c.textAlign = 'left';
  const chars = [...str]; const w = c.measureText(str).width;
  let ox = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  if (prog >= 1) { c.globalAlpha = alpha; c.fillStyle = color; c.fillText(str, ox, y); c.restore(); return w; }
  let acc = '';
  chars.forEach((ch, i) => { const gx = ox + c.measureText(acc).width; acc += ch; drawGlyph(c, { ch, kind, size, color }, gx, y, writeQ(prog, i, chars.length), alpha); });
  c.restore(); return w;
}

export function textWidth(str, size, kind = 'hei') { measureCanvas.font = fontStr(kind, size); return measureCanvas.measureText(str).width; }

// ---------- primitives ----------
export function line(c, x1, y1, x2, y2, o = {}) {
  const { color = C.white, width = 3, alpha = 1, prog = 1, dash = null } = o;
  if (alpha <= 0 || prog <= 0) return;
  c.save(); c.globalAlpha = alpha; c.strokeStyle = color; c.lineWidth = width; c.lineCap = 'round';
  if (dash) c.setLineDash(dash);
  c.beginPath(); c.moveTo(x1, y1); c.lineTo(lerp(x1, x2, prog), lerp(y1, y2, prog)); c.stroke(); c.restore();
}

export function arrow(c, x1, y1, x2, y2, o = {}) {
  const { color = C.white, width = 4, alpha = 1, prog = 1, head = 18 } = o;
  if (alpha <= 0 || prog <= 0) return;
  const ex = lerp(x1, x2, prog), ey = lerp(y1, y2, prog), a = Math.atan2(y2 - y1, x2 - x1);
  line(c, x1, y1, ex - Math.cos(a) * head * 0.6, ey - Math.sin(a) * head * 0.6, { color, width, alpha });
  c.save(); c.globalAlpha = alpha; c.fillStyle = color; c.beginPath();
  c.moveTo(ex, ey); c.lineTo(ex - head * Math.cos(a - 0.38), ey - head * Math.sin(a - 0.38)); c.lineTo(ex - head * Math.cos(a + 0.38), ey - head * Math.sin(a + 0.38)); c.closePath(); c.fill(); c.restore();
}

// Arc hop from x1 to x2 above a number line (used for "滑动").
export function hop(c, x1, x2, y, o = {}) {
  const { color = C.yellow, width = 4, alpha = 1, prog = 1, height = null, headSize = 16, below = false } = o;
  if (alpha <= 0 || prog <= 0) return;
  const h = (height ?? Math.min(160, Math.abs(x2 - x1) * 0.45 + 20)) * (below ? -1 : 1);
  const N = 60, pts = [];
  for (let i = 0; i <= N * prog; i++) { const t = i / N; pts.push([lerp(x1, x2, t), y - 4 * h * t * (1 - t)]); }
  c.save(); c.globalAlpha = alpha; c.strokeStyle = color; c.lineWidth = width; c.lineCap = 'round';
  c.beginPath(); pts.forEach(([px, py], i) => i ? c.lineTo(px, py) : c.moveTo(px, py)); c.stroke();
  if (pts.length > 2) {
    const [ax, ay] = pts[pts.length - 2], [bx, by] = pts[pts.length - 1], a = Math.atan2(by - ay, bx - ax);
    c.fillStyle = color; c.beginPath(); c.moveTo(bx, by); c.lineTo(bx - headSize * Math.cos(a - 0.4), by - headSize * Math.sin(a - 0.4)); c.lineTo(bx - headSize * Math.cos(a + 0.4), by - headSize * Math.sin(a + 0.4)); c.closePath(); c.fill();
  }
  c.restore();
  return pts.length ? pts[pts.length - 1] : [x1, y];
}

export function dot(c, x, y, r = 9, o = {}) {
  const { color = C.white, alpha = 1, scale = 1 } = o;
  if (alpha <= 0 || scale <= 0) return;
  c.save(); c.globalAlpha = alpha; c.fillStyle = color; c.beginPath(); c.arc(x, y, r * scale, 0, Math.PI * 2); c.fill(); c.restore();
}

export function rect(c, x, y, w, h, o = {}) {
  const { fill = null, stroke = null, width = 3, alpha = 1, r = 0 } = o;
  if (alpha <= 0) return;
  c.save(); c.globalAlpha = alpha; c.beginPath(); if (r) c.roundRect(x, y, w, h, r); else c.rect(x, y, w, h);
  if (fill) { c.fillStyle = fill; c.fill(); }
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = width; c.stroke(); }
  c.restore();
}

// Curly brace under/over a span, Manim-style.
export function brace(c, x1, x2, y, o = {}) {
  const { color = C.white, alpha = 1, up = false, prog = 1, depth = 18 } = o;
  if (alpha <= 0 || prog <= 0) return;
  const d = up ? -depth : depth, m = (x1 + x2) / 2, q = Math.min(14, (x2 - x1) / 4);
  c.save(); c.globalAlpha = alpha * smooth(prog); c.strokeStyle = color; c.lineWidth = 3.5; c.lineJoin = 'round'; c.lineCap = 'round';
  c.beginPath(); c.moveTo(x1, y); c.quadraticCurveTo(x1, y + d * 0.5, x1 + q, y + d * 0.5);
  c.lineTo(m - q, y + d * 0.5); c.quadraticCurveTo(m, y + d * 0.5, m, y + d);
  c.quadraticCurveTo(m, y + d * 0.5, m + q, y + d * 0.5); c.lineTo(x2 - q, y + d * 0.5); c.quadraticCurveTo(x2, y + d * 0.5, x2, y); c.stroke(); c.restore();
  return [m, y + d];
}

export function curve(c, fn, x0, x1, toX, toY, o = {}) {
  const { color = C.blue, width = 4, alpha = 1, prog = 1, N = 240 } = o;
  if (alpha <= 0 || prog <= 0) return;
  c.save(); c.globalAlpha = alpha; c.strokeStyle = color; c.lineWidth = width; c.lineJoin = 'round'; c.beginPath();
  for (let i = 0; i <= N * prog; i++) { const x = lerp(x0, x1, i / N); const px = toX(x), py = toY(fn(x)); i ? c.lineTo(px, py) : c.moveTo(px, py); }
  c.stroke(); c.restore();
}

// Number line helper with an arbitrary x-range mapped onto [left, right].
export function numberLine(x0, x1, left = 180, right = 1740) {
  const X = (x) => left + (x - x0) / (x1 - x0) * (right - left);
  return { X, x0, x1, left, right, scale: (right - left) / (x1 - x0) };
}

export function drawAxisLine(c, nl, y, o = {}) {
  const { color = C.grey, alpha = 1, prog = 1, width = 3 } = o;
  if (alpha <= 0) return;
  line(c, nl.left - 20, y, lerp(nl.left - 20, nl.right + 20, prog), y, { color, width, alpha });
  if (prog >= 1) arrow(c, nl.right + 10, y, nl.right + 34, y, { color, width, alpha, head: 14 });
}

export function tick(c, x, y, o = {}) {
  const { color = C.white, alpha = 1, len = 14, width = 3 } = o;
  line(c, x, y - len, x, y + len, { color, alpha, width });
}
